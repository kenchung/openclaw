import { beforeAll, describe, expect, it, vi } from "vitest";
import { expectExplicitVideoGenerationCapabilities } from "../../test/helpers/media-generation/provider-capability-assertions.js";
import {
  getProviderHttpMocks,
  installProviderHttpMockCleanup,
} from "../../test/helpers/media-generation/provider-http-mocks.js";

const { postJsonRequestMock, fetchWithTimeoutMock, assertOkOrThrowHttpErrorMock } =
  getProviderHttpMocks();

let buildHeyGenVideoGenerationProvider: typeof import("./video-generation-provider.js").buildHeyGenVideoGenerationProvider;

beforeAll(async () => {
  ({ buildHeyGenVideoGenerationProvider } = await import("./video-generation-provider.js"));
});

installProviderHttpMockCleanup();

function mockHeyGenSuccessfulRun(params?: { videoId?: string; videoUrl?: string }) {
  const videoId = params?.videoId ?? "vid_abc123";
  const videoUrl = params?.videoUrl ?? "https://cdn.heygen.com/out.mp4";
  postJsonRequestMock.mockResolvedValue({
    response: {
      json: async () => ({ data: { video_id: videoId } }),
    },
    release: vi.fn(async () => {}),
  });
  fetchWithTimeoutMock
    .mockResolvedValueOnce({
      json: async () => ({
        data: {
          id: videoId,
          status: "completed",
          video_url: videoUrl,
          thumbnail_url: "https://cdn.heygen.com/thumb.jpg",
          duration: 12,
        },
      }),
      headers: new Headers(),
    })
    .mockResolvedValueOnce({
      arrayBuffer: async () => Buffer.from("mp4-bytes"),
      headers: new Headers({ "content-type": "video/mp4" }),
    });
  return { videoId, videoUrl };
}

describe("heygen video generation provider", () => {
  it("declares explicit mode capabilities", () => {
    expectExplicitVideoGenerationCapabilities(buildHeyGenVideoGenerationProvider());
  });

  it("submits a text-to-video request, polls it, and downloads the output", async () => {
    const { videoId } = mockHeyGenSuccessfulRun();

    const provider = buildHeyGenVideoGenerationProvider();
    const result = await provider.generateVideo({
      provider: "heygen",
      model: "avatar_iv",
      prompt: "Hello, I am Ken.",
      cfg: {},
      aspectRatio: "16:9",
      providerOptions: {
        avatar_id: "avatar_demo_1",
        voice_id: "voice_demo_1",
      },
    });

    expect(postJsonRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://api.heygen.com/v2/video/generate",
      }),
    );
    const request = postJsonRequestMock.mock.calls[0]?.[0] as { body?: Record<string, unknown> };
    expect(request.body).toMatchObject({
      aspect_ratio: "16:9",
      dimension: { width: 1280, height: 720 },
      video_inputs: [
        {
          character: {
            type: "avatar",
            avatar_id: "avatar_demo_1",
          },
          voice: {
            type: "text",
            input_text: "Hello, I am Ken.",
            voice_id: "voice_demo_1",
          },
        },
      ],
    });
    expect(fetchWithTimeoutMock).toHaveBeenNthCalledWith(
      1,
      `https://api.heygen.com/v1/video_status.get?video_id=${videoId}`,
      expect.objectContaining({ method: "GET" }),
      120000,
      fetch,
    );
    expect(result.videos).toHaveLength(1);
    expect(result.metadata).toEqual(
      expect.objectContaining({
        videoId,
        status: "completed",
        videoUrl: "https://cdn.heygen.com/out.mp4",
      }),
    );
  });

  it("maps 16:9, 9:16, and 1:1 aspect ratios to landscape, portrait, and square dimensions", async () => {
    const provider = buildHeyGenVideoGenerationProvider();
    const providerOptions = { avatar_id: "a1", voice_id: "v1" };

    mockHeyGenSuccessfulRun({ videoId: "vid_landscape" });
    await provider.generateVideo({
      provider: "heygen",
      model: "avatar_iv",
      prompt: "hello",
      aspectRatio: "16:9",
      cfg: {},
      providerOptions,
    });
    const landscape = postJsonRequestMock.mock.calls[0]?.[0] as { body?: Record<string, unknown> };
    expect(landscape.body).toMatchObject({
      aspect_ratio: "16:9",
      dimension: { width: 1280, height: 720 },
    });

    postJsonRequestMock.mockClear();
    fetchWithTimeoutMock.mockClear();
    mockHeyGenSuccessfulRun({ videoId: "vid_portrait" });
    await provider.generateVideo({
      provider: "heygen",
      model: "avatar_iv",
      prompt: "hello",
      aspectRatio: "9:16",
      cfg: {},
      providerOptions,
    });
    const portrait = postJsonRequestMock.mock.calls[0]?.[0] as { body?: Record<string, unknown> };
    expect(portrait.body).toMatchObject({
      aspect_ratio: "9:16",
      dimension: { width: 720, height: 1280 },
    });

    postJsonRequestMock.mockClear();
    fetchWithTimeoutMock.mockClear();
    mockHeyGenSuccessfulRun({ videoId: "vid_square" });
    await provider.generateVideo({
      provider: "heygen",
      model: "avatar_iv",
      prompt: "hello",
      aspectRatio: "1:1",
      cfg: {},
      providerOptions,
    });
    const square = postJsonRequestMock.mock.calls[0]?.[0] as { body?: Record<string, unknown> };
    expect(square.body).toMatchObject({
      aspect_ratio: "1:1",
      dimension: { width: 960, height: 960 },
    });
  });

  it("converts local image buffers into data URLs for image-to-video requests", async () => {
    mockHeyGenSuccessfulRun();

    const provider = buildHeyGenVideoGenerationProvider();
    await provider.generateVideo({
      provider: "heygen",
      model: "avatar_iv",
      prompt: "Animate this photo",
      cfg: {},
      aspectRatio: "9:16",
      inputImages: [{ buffer: Buffer.from("png-bytes"), mimeType: "image/png" }],
      providerOptions: {
        voice_id: "voice_demo_1",
      },
    });

    const request = postJsonRequestMock.mock.calls[0]?.[0] as { body?: Record<string, unknown> };
    const videoInputs = (
      request.body as { video_inputs: Array<{ character: Record<string, unknown> }> }
    ).video_inputs;
    expect(videoInputs[0].character).toMatchObject({
      type: "talking_photo",
      talking_photo_url: expect.stringMatching(/^data:image\/png;base64,/u),
    });
  });

  it("rejects video reference inputs since HeyGen has no video-to-video mode", async () => {
    const provider = buildHeyGenVideoGenerationProvider();

    await expect(
      provider.generateVideo({
        provider: "heygen",
        model: "avatar_iv",
        prompt: "restyle this clip",
        cfg: {},
        inputVideos: [{ url: "https://example.com/in.mp4" }],
        providerOptions: { avatar_id: "a1", voice_id: "v1" },
      }),
    ).rejects.toThrow("HeyGen video generation does not support video reference inputs.");
    expect(postJsonRequestMock).not.toHaveBeenCalled();
  });

  it("rejects unsupported aspect ratios", async () => {
    const provider = buildHeyGenVideoGenerationProvider();

    await expect(
      provider.generateVideo({
        provider: "heygen",
        model: "avatar_iv",
        prompt: "hello",
        cfg: {},
        aspectRatio: "21:9",
        providerOptions: { avatar_id: "a1", voice_id: "v1" },
      }),
    ).rejects.toThrow(/HeyGen video generation does not support aspect ratio 21:9/u);
    expect(postJsonRequestMock).not.toHaveBeenCalled();
  });

  it("translates 401 HTTP failures into an authentication error", async () => {
    postJsonRequestMock.mockResolvedValue({
      response: { json: async () => ({}) },
      release: vi.fn(async () => {}),
    });
    assertOkOrThrowHttpErrorMock.mockImplementationOnce(async () => {
      throw new Error("HeyGen video generation failed: 401 Unauthorized");
    });

    const provider = buildHeyGenVideoGenerationProvider();

    await expect(
      provider.generateVideo({
        provider: "heygen",
        model: "avatar_iv",
        prompt: "hello",
        cfg: {},
        aspectRatio: "16:9",
        providerOptions: { avatar_id: "a1", voice_id: "v1" },
      }),
    ).rejects.toThrow(/HeyGen authentication failed/u);
  });

  it("translates 402 HTTP failures into a credit limit error", async () => {
    postJsonRequestMock.mockResolvedValue({
      response: { json: async () => ({}) },
      release: vi.fn(async () => {}),
    });
    assertOkOrThrowHttpErrorMock.mockImplementationOnce(async () => {
      throw new Error("HeyGen video generation failed: 402 Payment Required");
    });

    const provider = buildHeyGenVideoGenerationProvider();

    await expect(
      provider.generateVideo({
        provider: "heygen",
        model: "avatar_iv",
        prompt: "hello",
        cfg: {},
        aspectRatio: "16:9",
        providerOptions: { avatar_id: "a1", voice_id: "v1" },
      }),
    ).rejects.toThrow(/HeyGen credit limit reached/u);
  });

  it("surfaces the failure_message when polling returns a failed status", async () => {
    postJsonRequestMock.mockResolvedValue({
      response: {
        json: async () => ({ data: { video_id: "vid_fail" } }),
      },
      release: vi.fn(async () => {}),
    });
    fetchWithTimeoutMock.mockResolvedValueOnce({
      json: async () => ({
        data: {
          id: "vid_fail",
          status: "failed",
          error: { code: "generation_failed", message: "avatar id not found" },
        },
      }),
      headers: new Headers(),
    });

    const provider = buildHeyGenVideoGenerationProvider();

    await expect(
      provider.generateVideo({
        provider: "heygen",
        model: "avatar_iv",
        prompt: "hello",
        cfg: {},
        aspectRatio: "16:9",
        providerOptions: { avatar_id: "a1", voice_id: "v1" },
      }),
    ).rejects.toThrow(/avatar id not found/u);
  });
});
