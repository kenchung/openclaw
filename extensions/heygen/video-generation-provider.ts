import { isProviderApiKeyConfigured } from "openclaw/plugin-sdk/provider-auth";
import { resolveApiKeyForProvider } from "openclaw/plugin-sdk/provider-auth-runtime";
import {
  assertOkOrThrowHttpError,
  createProviderOperationDeadline,
  fetchWithTimeout,
  postJsonRequest,
  resolveProviderOperationTimeoutMs,
  resolveProviderHttpRequestConfig,
  waitProviderOperationPollInterval,
} from "openclaw/plugin-sdk/provider-http";
import { normalizeOptionalString } from "openclaw/plugin-sdk/text-runtime";
import type {
  GeneratedVideoAsset,
  VideoGenerationProvider,
  VideoGenerationRequest,
  VideoGenerationResult,
} from "openclaw/plugin-sdk/video-generation";

const DEFAULT_HEYGEN_BASE_URL = "https://api.heygen.com";
const DEFAULT_HEYGEN_MODEL = "avatar_iv";
const DEFAULT_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_ATTEMPTS = 120;
const MAX_DURATION_SECONDS = 120;

const HEYGEN_ASPECT_RATIOS = ["16:9", "9:16", "1:1"] as const;
type HeyGenOrientation = "landscape" | "portrait" | "square";

type HeyGenVideoGenerateResponse = {
  error?: { code?: string | number; message?: string } | null;
  data?: {
    video_id?: string;
  };
};

type HeyGenVideoStatus = "pending" | "processing" | "completed" | "failed" | "waiting";

type HeyGenVideoStatusResponse = {
  error?: { code?: string | number; message?: string } | null;
  data?: {
    id?: string;
    status?: HeyGenVideoStatus;
    video_url?: string;
    thumbnail_url?: string;
    duration?: number;
    error?: { code?: string | number; message?: string } | null;
    callback_id?: string | null;
  };
};

function resolveHeyGenBaseUrl(req: VideoGenerationRequest): string {
  return (
    normalizeOptionalString(req.cfg?.models?.providers?.heygen?.baseUrl) ?? DEFAULT_HEYGEN_BASE_URL
  );
}

function aspectRatioToOrientation(aspectRatio: string | undefined): HeyGenOrientation {
  switch (normalizeOptionalString(aspectRatio)) {
    case "16:9":
    case undefined:
      return "landscape";
    case "9:16":
      return "portrait";
    case "1:1":
      return "square";
    default:
      throw new Error(
        `HeyGen video generation does not support aspect ratio ${aspectRatio}. Supported: ${HEYGEN_ASPECT_RATIOS.join(", ")}.`,
      );
  }
}

function resolveProviderOption(opts: Record<string, unknown>, key: string): string | undefined {
  const raw = opts[key];
  if (typeof raw !== "string") {
    return undefined;
  }
  return normalizeOptionalString(raw);
}

function resolveImageAsset(
  req: VideoGenerationRequest,
): { type: "url"; url: string } | { type: "buffer"; dataUrl: string } | undefined {
  const image = req.inputImages?.[0];
  if (!image) {
    return undefined;
  }
  const url = normalizeOptionalString(image.url);
  if (url) {
    return { type: "url", url };
  }
  if (!image.buffer) {
    throw new Error("HeyGen image-to-video input is missing image data.");
  }
  const mimeType = normalizeOptionalString(image.mimeType) ?? "image/png";
  return {
    type: "buffer",
    dataUrl: `data:${mimeType};base64,${image.buffer.toString("base64")}`,
  };
}

function buildCharacterSegment(params: {
  req: VideoGenerationRequest;
  avatarId: string | undefined;
}): Record<string, unknown> {
  const imageAsset = resolveImageAsset(params.req);
  if (imageAsset) {
    return {
      type: "talking_photo",
      talking_photo_url: imageAsset.type === "url" ? imageAsset.url : imageAsset.dataUrl,
    };
  }
  if (!params.avatarId) {
    throw new Error(
      "HeyGen text-to-video requires an avatar_id (pass via providerOptions.avatar_id) or a reference image input.",
    );
  }
  return {
    type: "avatar",
    avatar_id: params.avatarId,
    avatar_style: "normal",
  };
}

function buildVideoGenerateBody(req: VideoGenerationRequest): Record<string, unknown> {
  const opts = req.providerOptions ?? {};
  const avatarId = resolveProviderOption(opts, "avatar_id");
  const voiceId = resolveProviderOption(opts, "voice_id");
  const styleId = resolveProviderOption(opts, "style_id");
  const orientation = (resolveProviderOption(opts, "orientation") ??
    aspectRatioToOrientation(req.aspectRatio)) as HeyGenOrientation;
  const callbackUrl = resolveProviderOption(opts, "callback_url");
  const callbackId = resolveProviderOption(opts, "callback_id");

  if (!voiceId) {
    throw new Error(
      "HeyGen video generation requires a voice_id (pass via providerOptions.voice_id).",
    );
  }

  const character = buildCharacterSegment({ req, avatarId });
  const voice: Record<string, unknown> = {
    type: "text",
    input_text: req.prompt,
    voice_id: voiceId,
  };

  const dimension = orientationToDimension(orientation);

  const videoInputs: Array<Record<string, unknown>> = [
    {
      character,
      voice,
    },
  ];

  const body: Record<string, unknown> = {
    video_inputs: videoInputs,
    dimension,
    aspect_ratio: req.aspectRatio ?? orientationToAspectRatio(orientation),
  };

  if (styleId) {
    body.style = styleId;
  }
  if (callbackUrl) {
    body.callback_url = callbackUrl;
  }
  if (callbackId) {
    body.callback_id = callbackId;
  }

  return body;
}

function orientationToAspectRatio(orientation: HeyGenOrientation): string {
  switch (orientation) {
    case "portrait":
      return "9:16";
    case "square":
      return "1:1";
    case "landscape":
    default:
      return "16:9";
  }
}

function orientationToDimension(orientation: HeyGenOrientation): {
  width: number;
  height: number;
} {
  switch (orientation) {
    case "portrait":
      return { width: 720, height: 1280 };
    case "square":
      return { width: 960, height: 960 };
    case "landscape":
    default:
      return { width: 1280, height: 720 };
  }
}

function translateHeyGenHttpError(error: unknown): Error {
  if (!(error instanceof Error)) {
    return new Error(String(error));
  }
  const message = error.message;
  if (/\b401\b|unauthorized|invalid api key/i.test(message)) {
    return new Error(`HeyGen authentication failed: ${message}`);
  }
  if (/\b402\b|payment required|insufficient.*credit|quota/i.test(message)) {
    return new Error(`HeyGen credit limit reached: ${message}`);
  }
  return error;
}

async function pollHeyGenVideoStatus(params: {
  videoId: string;
  headers: Headers;
  timeoutMs?: number;
  baseUrl: string;
  fetchFn: typeof fetch;
}): Promise<HeyGenVideoStatusResponse["data"]> {
  const deadline = createProviderOperationDeadline({
    timeoutMs: params.timeoutMs,
    label: `HeyGen video generation task ${params.videoId}`,
  });
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    const response = await fetchWithTimeout(
      `${params.baseUrl}/v1/video_status.get?video_id=${encodeURIComponent(params.videoId)}`,
      {
        method: "GET",
        headers: params.headers,
      },
      resolveProviderOperationTimeoutMs({ deadline, defaultTimeoutMs: DEFAULT_TIMEOUT_MS }),
      params.fetchFn,
    );
    try {
      await assertOkOrThrowHttpError(response, "HeyGen video status request failed");
    } catch (error) {
      throw translateHeyGenHttpError(error);
    }
    const payload = (await response.json()) as HeyGenVideoStatusResponse;
    const data = payload.data;
    switch (data?.status) {
      case "completed":
        return data;
      case "failed": {
        const failureMessage =
          normalizeOptionalString(data.error?.message) ||
          normalizeOptionalString(payload.error?.message) ||
          "HeyGen video generation failed";
        throw new Error(failureMessage);
      }
      case "pending":
      case "processing":
      case "waiting":
      default:
        await waitProviderOperationPollInterval({ deadline, pollIntervalMs: POLL_INTERVAL_MS });
        break;
    }
  }
  throw new Error(`HeyGen video generation task ${params.videoId} did not finish in time`);
}

async function downloadHeyGenVideo(params: {
  url: string;
  timeoutMs?: number;
  fetchFn: typeof fetch;
}): Promise<GeneratedVideoAsset> {
  const response = await fetchWithTimeout(
    params.url,
    { method: "GET" },
    params.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    params.fetchFn,
  );
  await assertOkOrThrowHttpError(response, "HeyGen generated video download failed");
  const mimeType = normalizeOptionalString(response.headers.get("content-type")) ?? "video/mp4";
  const arrayBuffer = await response.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType,
    fileName: `video-1.${mimeType.includes("webm") ? "webm" : "mp4"}`,
    metadata: { sourceUrl: params.url },
  };
}

export function buildHeyGenVideoGenerationProvider(): VideoGenerationProvider {
  return {
    id: "heygen",
    label: "HeyGen",
    defaultModel: DEFAULT_HEYGEN_MODEL,
    models: [DEFAULT_HEYGEN_MODEL],
    isConfigured: ({ agentDir }) =>
      isProviderApiKeyConfigured({
        provider: "heygen",
        agentDir,
      }),
    capabilities: {
      providerOptions: {
        avatar_id: "string",
        voice_id: "string",
        style_id: "string",
        orientation: "string",
        callback_url: "string",
        callback_id: "string",
      },
      generate: {
        maxVideos: 1,
        maxDurationSeconds: MAX_DURATION_SECONDS,
        aspectRatios: HEYGEN_ASPECT_RATIOS,
        supportsAspectRatio: true,
        supportsAudio: true,
      },
      imageToVideo: {
        enabled: true,
        maxVideos: 1,
        maxInputImages: 1,
        maxDurationSeconds: MAX_DURATION_SECONDS,
        aspectRatios: HEYGEN_ASPECT_RATIOS,
        supportsAspectRatio: true,
        supportsAudio: true,
      },
      videoToVideo: {
        enabled: false,
      },
    },
    async generateVideo(req): Promise<VideoGenerationResult> {
      if ((req.inputVideos?.length ?? 0) > 0) {
        throw new Error("HeyGen video generation does not support video reference inputs.");
      }

      const auth = await resolveApiKeyForProvider({
        provider: "heygen",
        cfg: req.cfg,
        agentDir: req.agentDir,
        store: req.authStore,
      });
      if (!auth.apiKey) {
        throw new Error("HeyGen API key missing");
      }

      const fetchFn = fetch;
      const deadline = createProviderOperationDeadline({
        timeoutMs: req.timeoutMs,
        label: "HeyGen video generation",
      });
      const requestBody = buildVideoGenerateBody(req);
      const { baseUrl, allowPrivateNetwork, headers, dispatcherPolicy } =
        resolveProviderHttpRequestConfig({
          baseUrl: resolveHeyGenBaseUrl(req),
          defaultBaseUrl: DEFAULT_HEYGEN_BASE_URL,
          defaultHeaders: {
            "X-Api-Key": auth.apiKey,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          provider: "heygen",
          capability: "video",
          transport: "http",
        });

      const { response, release } = await postJsonRequest({
        url: `${baseUrl}/v2/video/generate`,
        headers,
        body: requestBody,
        timeoutMs: resolveProviderOperationTimeoutMs({
          deadline,
          defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
        }),
        fetchFn,
        allowPrivateNetwork,
        dispatcherPolicy,
      });

      try {
        try {
          await assertOkOrThrowHttpError(response, "HeyGen video generation failed");
        } catch (error) {
          throw translateHeyGenHttpError(error);
        }
        const submitted = (await response.json()) as HeyGenVideoGenerateResponse;
        if (submitted.error) {
          const code = submitted.error.code;
          const message =
            normalizeOptionalString(submitted.error.message) ?? "HeyGen video generation failed";
          throw translateHeyGenHttpError(new Error(`${code ?? "error"}: ${message}`));
        }
        const videoId = normalizeOptionalString(submitted.data?.video_id);
        if (!videoId) {
          throw new Error("HeyGen video generation response missing video_id");
        }
        const completed = await pollHeyGenVideoStatus({
          videoId,
          headers,
          timeoutMs: resolveProviderOperationTimeoutMs({
            deadline,
            defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
          }),
          baseUrl,
          fetchFn,
        });
        const videoUrl = normalizeOptionalString(completed?.video_url);
        if (!videoUrl) {
          throw new Error("HeyGen video generation completed without a video URL");
        }
        const video = await downloadHeyGenVideo({
          url: videoUrl,
          timeoutMs: resolveProviderOperationTimeoutMs({
            deadline,
            defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
          }),
          fetchFn,
        });
        return {
          videos: [video],
          model: normalizeOptionalString(req.model) ?? DEFAULT_HEYGEN_MODEL,
          metadata: {
            videoId,
            status: completed?.status,
            videoUrl,
            thumbnailUrl: completed?.thumbnail_url,
            duration: completed?.duration,
            callbackId: completed?.callback_id ?? undefined,
          },
        };
      } finally {
        await release();
      }
    },
  };
}
