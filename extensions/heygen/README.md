# HeyGen (OpenClaw plugin)

Bundled HeyGen avatar video provider for OpenClaw's `video_generate` tool.

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
openclaw config set agents.defaults.videoGenerationModel.primary "heygen/avatar_iv"
```

## Supported modes

| Mode           | Notes                                                  |
| -------------- | ------------------------------------------------------ |
| Text-to-video  | Avatar id + voice id required via `providerOptions`.   |
| Image-to-video | Talking-photo generation from a local or remote image. |
| Video-to-video | Not supported.                                         |

Aspect ratios: `16:9`, `9:16`, `1:1`.

## Provider options

HeyGen-specific options passed via `providerOptions`:

- `avatar_id` (string): HeyGen avatar group or look id.
- `voice_id` (string): HeyGen voice id (required).
- `style_id` (string): optional style template.
- `orientation` (string): `landscape`, `portrait`, or `square`. Derived from `aspectRatio` if omitted.
- `callback_url` (string): optional webhook URL.
- `callback_id` (string): optional correlation id forwarded back on the webhook.

## API reference

- Generate: `POST https://api.heygen.com/v2/video/generate`
- Status: `GET https://api.heygen.com/v1/video_status.get?video_id=<id>`
- Auth header: `X-Api-Key`

See the [HeyGen API docs](https://docs.heygen.com/reference) for full parameter coverage.
