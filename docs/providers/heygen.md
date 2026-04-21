---
title: "HeyGen"
summary: "HeyGen avatar video generation setup in OpenClaw"
read_when:
  - You want to use HeyGen avatar video generation in OpenClaw
  - You need the HeyGen API key/env setup
  - You want to make HeyGen the default video provider
---

# HeyGen

OpenClaw ships a bundled `heygen` provider for avatar video generation.

| Property    | Value                                                        |
| ----------- | ------------------------------------------------------------ |
| Provider id | `heygen`                                                     |
| Auth        | `HEYGEN_API_KEY`                                             |
| API         | HeyGen video generation (`GET /v1/video_status.get` polling) |

## Getting started

<Steps>
  <Step title="Set the API key">
    ```bash
    openclaw onboard --auth-choice heygen-api-key
    ```
  </Step>
  <Step title="Set HeyGen as the default video provider">
    ```bash
    openclaw config set agents.defaults.videoGenerationModel.primary "heygen/avatar_iv"
    ```
  </Step>
  <Step title="Generate a video">
    Ask the agent to generate a video. HeyGen will be used automatically.
  </Step>
</Steps>

## Supported modes

| Mode           | Model                 | Reference input           |
| -------------- | --------------------- | ------------------------- |
| Text-to-video  | `avatar_iv` (default) | None (avatar_id required) |
| Image-to-video | `avatar_iv`           | 1 local or remote image   |
| Video-to-video | Not supported.        | -                         |

<Note>
HeyGen is identity-first: every request needs an avatar plus a voice. Pass
`avatar_id` and `voice_id` via `providerOptions`, or skip `avatar_id` and pass
a reference image to drive a talking-photo look.
</Note>

<Warning>
HeyGen does not support video-to-video.
</Warning>

## Aspect ratios

HeyGen accepts `16:9`, `9:16`, and `1:1`. The plugin maps each to HeyGen's
`dimension` (landscape, portrait, square).

## Provider options

The following HeyGen-specific options can be passed via `providerOptions`:

- `avatar_id` (string): HeyGen avatar group or look id.
- `voice_id` (string): HeyGen voice id (required).
- `style_id` (string): optional style template.
- `orientation` (string): `landscape`, `portrait`, or `square`. Derived from `aspectRatio` if omitted.
- `callback_url` (string): optional webhook URL.
- `callback_id` (string): optional correlation id forwarded back on the webhook.

## Configuration

```json5
{
  agents: {
    defaults: {
      videoGenerationModel: {
        primary: "heygen/avatar_iv",
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

  <Accordion title="Status polling">
    After submitting a generation request, OpenClaw polls
    `GET /v1/video_status.get?video_id=<id>` until the video is ready. No extra
    configuration is needed for the polling behavior.
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
