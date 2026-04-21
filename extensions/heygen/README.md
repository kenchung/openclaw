# HeyGen (OpenClaw plugin)

Bundled HeyGen Video Agent provider for OpenClaw's `video_generate` tool.

## Enable

```bash
openclaw plugins enable heygen
```

Restart the Gateway after enabling.

```bash
openclaw gateway restart
```

## Authenticate

API key:

```bash
openclaw onboard --auth-choice heygen-api-key
```

Or set the `HEYGEN_API_KEY` environment variable directly.

## Make it the default video provider

```bash
openclaw config set agents.defaults.videoGenerationModel.primary "heygen/video_agent_v3"
```

## Supported modes

| Mode           | Notes                                                  |
| -------------- | ------------------------------------------------------ |
| Text-to-video  | Avatar id + voice id required via `providerOptions`.   |
| Image-to-video | Local or remote image attached as scene context.       |
| Video-to-video | Not supported by HeyGen Video Agent.                   |

Aspect ratios: `16:9` (landscape), `9:16` (portrait). `1:1` is not supported — HeyGen Video Agent orientation enum is `landscape | portrait` only.

## Provider options

HeyGen-specific options passed via `providerOptions`:

- `avatar_id` (string): HeyGen avatar group or look id.
- `voice_id` (string): HeyGen voice id.
- `style_id` (string): optional style template.
- `orientation` (string): `landscape` or `portrait`. Derived from `aspectRatio` if omitted.
- `callback_url` (string): optional webhook URL.
- `callback_id` (string): optional correlation id forwarded back on the webhook.
- `incognito_mode` (boolean): opt out of server-side logging.

## API reference

- Create session: `POST https://api.heygen.com/v3/video-agents`
- Session poll (when `video_id` is null on create): `GET https://api.heygen.com/v3/video-agents/{session_id}`
- Video poll: `GET https://api.heygen.com/v3/videos/{video_id}`
- Auth header: `X-Api-Key`

See the [HeyGen Video Agent API docs](https://developers.heygen.com/reference/list-video-agent-sessions.md) for full parameter coverage.
