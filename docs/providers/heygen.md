---
title: "HeyGen"
summary: "HeyGen Video Agent setup in OpenClaw"
read_when:
  - You want to use HeyGen avatar video generation in OpenClaw
  - You need the HeyGen API key/env setup
  - You want to make HeyGen the default video provider
---

# HeyGen

OpenClaw ships a bundled `heygen` provider for HeyGen's Video Agent API.

| Property    | Value                                                                     |
| ----------- | ------------------------------------------------------------------------- |
| Provider id | `heygen`                                                                  |
| Auth        | `HEYGEN_API_KEY`                                                          |
| API         | HeyGen Video Agent (`POST /v3/video-agents` + `GET /v3/videos/{id}`)      |

## Getting started

<Steps>
  <Step title="Set the API key">
    ```bash
    openclaw onboard --auth-choice heygen-api-key
    ```
  </Step>
  <Step title="Set HeyGen as the default video provider">
    ```bash
    openclaw config set agents.defaults.videoGenerationModel.primary "heygen/video_agent_v3"
    ```
  </Step>
  <Step title="Generate a video">
    Ask the agent to generate a video. HeyGen will be used automatically.
  </Step>
</Steps>

## Supported modes

| Mode           | Model             | Reference input           |
| -------------- | ----------------- | ------------------------- |
| Text-to-video  | `video_agent_v3`  | None (avatar_id + voice_id required) |
| Image-to-video | `video_agent_v3`  | 1 local or remote image (scene context) |
| Video-to-video | Not supported.    | —                         |

<Note>
HeyGen is identity-first: every request needs an avatar plus a voice. Pass
`avatar_id` and `voice_id` via `providerOptions`. A reference image is optional
scene context, not the avatar source.
</Note>

<Warning>
HeyGen Video Agent does not support video-to-video.
</Warning>

## Aspect ratios

HeyGen Video Agent accepts `16:9` (landscape) and `9:16` (portrait). `1:1` is
not supported — the `orientation` enum is `landscape | portrait` only.

## Provider options

The following HeyGen-specific options can be passed via `providerOptions`:

- `avatar_id` (string): HeyGen avatar group or look id.
- `voice_id` (string): HeyGen voice id.
- `style_id` (string): optional style template.
- `orientation` (string): `landscape` or `portrait`. Derived from `aspectRatio` if omitted.
- `callback_url` (string): optional webhook URL.
- `callback_id` (string): optional correlation id forwarded back on the webhook.
- `incognito_mode` (boolean): opt out of server-side logging.

## Configuration

```json5
{
  agents: {
    defaults: {
      videoGenerationModel: {
        primary: "heygen/video_agent_v3",
      },
    },
  },
}
```

## Advanced notes

<AccordionGroup>
  <Accordion title="Authentication header">
    HeyGen uses `X-Api-Key`, not `Authorization: Bearer`. The plugin sets this
    automatically from `HEYGEN_API_KEY`.
  </Accordion>

  <Accordion title="Session vs. video polling">
    `POST /v3/video-agents` creates a session. Most generate-mode responses
    include `video_id` immediately; async or non-generate sessions return it
    later. The plugin polls `GET /v3/video-agents/{session_id}` until
    `video_id` is populated, then polls `GET /v3/videos/{video_id}` until the
    video completes.
  </Accordion>

  <Accordion title="Failure surfacing">
    When the video status is `failed`, the plugin surfaces the server's
    `failure_message` instead of a generic error so callers can see why
    HeyGen rejected the job (avatar unavailable, moderation flag, etc.).
  </Accordion>
</AccordionGroup>

## Related

<CardGroup cols={2}>
  <Card title="Video generation" href="/tools/video-generation" icon="video">
    Shared tool parameters, provider selection, and async behavior.
  </Card>
  <Card title="Configuration reference" href="/gateway/configuration-reference#agent-defaults" icon="gear">
    Agent default settings including video generation model.
  </Card>
</CardGroup>
