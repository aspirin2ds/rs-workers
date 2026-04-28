# RealtimeKit + Workers AI Backend Design

## Status

Draft

## Goal

Enable a backend in this monorepo that uses Cloudflare RealtimeKit for live meeting transport and session management, and Workers AI for real-time inference over meeting media and transcripts.

The immediate target is an **observer AI** architecture:

- users join a RealtimeKit meeting from web or mobile clients
- the backend provisions meetings, participants, and tokens
- live transcript and sampled media are sent into Workers AI
- AI output is returned as structured UI data such as captions, summaries, moderation flags, prompts, and assistant messages

This design does **not** assume that the AI can publish synthesized audio or video back into the room as a native meeting participant. That capability needs a separate spike and may require dropping from RealtimeKit to Realtime SFU.

## Repo Context

Current repo shape:

- `workers/auth`: Better Auth session and user identity
- `workers/maid`: authenticated Hono worker already bound to `env.AI`
- `packages/db`: shared D1 schema via Drizzle

Current boundary is already useful:

- `auth` should remain the source of user identity and session validation
- `maid` should become the application-facing AI and realtime backend
- shared persistence belongs in `packages/db`

This avoids creating a second application backend when `workers/maid` already has auth middleware, D1 access, and Workers AI binding configured.

## Product Constraints From Current Cloudflare Docs

Based on current Cloudflare docs as of April 28, 2026:

- RealtimeKit provides REST APIs for apps, meetings, presets, participants, sessions, recordings, and webhooks.
- RealtimeKit participant tokens are time-bound and support refresh.
- RealtimeKit built-in AI is centered on transcription and summary generation.
- Real-time transcription is powered by Workers AI and can stream transcript events.
- RealtimeKit sits on top of Realtime SFU.

Important implication:

RealtimeKit is a good fit for meeting lifecycle and transcript-driven AI, but it should not be treated as proof that arbitrary live media-agent behavior is available at the SDK layer. For multimodal inference, we should plan around:

- transcript events from RealtimeKit
- explicit client-side media sampling
- optional track recording/export for offline or asynchronous processing

## Scope

### In scope

- meeting creation and participant provisioning
- participant token issuance and refresh
- preset strategy for host, guest, observer, and AI-observer roles
- webhook ingestion for meeting, participant, transcript, summary, and recording lifecycle events
- transcript-driven inference using Workers AI
- frame and short audio snippet inference initiated by the client
- meeting-scoped runtime state using Durable Objects
- persistence for meeting metadata, artifacts, and audit trails

### Out of scope for v1

- server-side AI participant that injects live audio/video back into the meeting
- custom SFU media routing
- full recording analytics pipeline
- cross-region state replication beyond Cloudflare defaults

## Primary Use Cases

### MVP

- live captions
- rolling meeting summary
- action item extraction
- moderation and policy signals
- assistant suggestions surfaced in UI

### Phase 2

- image/frame understanding from sampled video
- lightweight audio classification from short snippets
- post-meeting enrichment over transcripts and recordings

### Deferred spike

- AI voice assistant that speaks into the room

## Architecture

## High-level

```text
Client SDK/UI
  -> RealtimeKit SDK joins meeting with participant token
  -> calls maid worker for app APIs
  -> optionally uploads sampled frames/audio snippets

workers/auth
  -> validates session and user identity

workers/maid
  -> meeting APIs
  -> participant token APIs
  -> webhook receiver
  -> inference APIs
  -> calls Cloudflare RealtimeKit REST API
  -> calls Workers AI
  -> coordinates Durable Object state

Durable Object per meeting
  -> transient runtime state
  -> rolling transcript window
  -> inference throttling
  -> active participant presence

D1
  -> meeting metadata
  -> participant mappings
  -> inference events
  -> audit trail

R2
  -> sampled media artifacts
  -> exported recordings
  -> debug payloads when enabled
```

## Worker Responsibilities

### `workers/auth`

No major product expansion is required here.

Responsibilities:

- continue to own login/session cookies
- expose authenticated user identity to `workers/maid` via service binding

### `workers/maid`

This worker should absorb the realtime backend.

New responsibilities:

- create and manage RealtimeKit app resources used by Maid
- create meetings and participants
- refresh participant tokens
- verify and process RealtimeKit webhooks
- expose inference endpoints for transcript, image, and audio snippet analysis
- host meeting-scoped coordination logic through Durable Objects

Recommended route groups:

- `POST /realtime/meetings`
- `GET /realtime/meetings/:meetingId`
- `POST /realtime/meetings/:meetingId/participants`
- `POST /realtime/meetings/:meetingId/participants/:participantId/token`
- `GET /realtime/meetings/:meetingId/runtime`
- `POST /realtime/meetings/:meetingId/inference/frame`
- `POST /realtime/meetings/:meetingId/inference/audio-snippet`
- `POST /realtime/webhooks/realtimekit`

## RealtimeKit Resource Strategy

## App layout

Use one RealtimeKit App per environment:

- `maid-realtime-staging`
- `maid-realtime-production`

Store app IDs in worker secrets/config rather than discovering them on each request.

## Presets

Create presets outside hot-path request handling and treat them as environment configuration.

Recommended presets:

- `host`
  - full meeting access
  - transcription enabled
- `guest`
  - standard media participation
  - transcription enabled when policy allows
- `observer`
  - view/listen only
  - no publishing
- `ai-observer`
  - view-only or minimal privileges
  - transcription enabled
  - used only when we need a first-class AI participant identity for auditability

Presets should be managed by infra scripts or an admin-only endpoint, not created ad hoc.

## Meeting model

A RealtimeKit meeting is the long-lived room template. A session is the live instance created when participants join.

In Maid terms:

- application object: `realtime_room`
- Cloudflare object: `meeting`
- live occurrence: `session`

One Maid room maps to one RealtimeKit meeting. Multiple sessions may occur over time against the same room.

## Authentication and Authorization

## User auth

All application-facing realtime endpoints in `workers/maid` should continue to use the existing `authMiddleware`.

## Service auth to Cloudflare API

`workers/maid` will need account-level credentials for the RealtimeKit REST API:

- `CF_ACCOUNT_ID`
- `CF_REALTIMEKIT_APP_ID`
- `CF_REALTIMEKIT_API_TOKEN`

The token should be scoped to the minimum Realtime permissions needed.

## Participant token flow

1. authenticated Maid client calls `POST /realtime/meetings/:meetingId/participants`
2. `workers/maid` validates Maid authorization for that room
3. `workers/maid` creates or reuses a RealtimeKit participant for the user
4. `workers/maid` returns:
   - `meetingId`
   - `participantId`
   - `participantToken`
   - `presetName`
   - expiration metadata if available
5. client joins via RealtimeKit SDK

Refresh flow:

1. client detects token nearing expiry or expiry error
2. client calls `POST /realtime/meetings/:meetingId/participants/:participantId/token`
3. backend calls the RealtimeKit refresh token API
4. client updates SDK session

## Runtime State Design

Use one Durable Object instance per active meeting.

Suggested responsibilities:

- track active Maid users to RealtimeKit participant IDs
- maintain a rolling transcript buffer
- deduplicate webhook events
- fan out structured runtime state to clients if needed
- rate-limit inference calls per meeting
- manage meeting-level feature flags such as:
  - transcription enabled
  - frame sampling enabled
  - moderation enabled
  - debug artifact retention enabled

Suggested internal shape:

```ts
type MeetingRuntimeState = {
  meetingId: string;
  activeSessionId: string | null;
  participants: Record<string, {
    userId: string;
    participantId: string;
    presetName: string;
    joinedAt: number;
  }>;
  transcriptWindow: Array<{
    at: number;
    participantId: string;
    text: string;
    isFinal: boolean;
  }>;
  latestSummary: string | null;
  inferenceFlags: {
    moderation: boolean;
    frameSampling: boolean;
    assistantPrompts: boolean;
  };
  dedupe: {
    webhookEventIds: string[];
  };
};
```

Durable Object state is not the system of record. It is meeting-runtime coordination only.

## Persistence Design

## D1 tables

Add new tables in `packages/db` for durable metadata and audit trails.

Recommended initial tables:

- `realtime_room`
  - Maid room metadata
  - Cloudflare app/meeting IDs
  - owner user ID
  - status and configuration
- `realtime_participant`
  - Maid user to RealtimeKit participant mapping
  - preset used
  - last token refresh timestamp
- `realtime_session`
  - session lifecycle snapshots
  - start/end timestamps
  - participant counts
- `realtime_webhook_event`
  - event ID
  - event type
  - payload hash
  - processed timestamp
  - processing status
- `realtime_inference_event`
  - meeting/session/user IDs
  - inference kind
  - input artifact reference
  - output JSON
  - latency
  - model ID
- `realtime_artifact`
  - R2 object key
  - MIME type
  - retention class
  - linked meeting/session/event IDs

## R2 layout

Recommended object prefixes:

- `realtime/meetings/{meetingId}/frames/...`
- `realtime/meetings/{meetingId}/audio-snippets/...`
- `realtime/meetings/{meetingId}/recordings/...`
- `realtime/meetings/{meetingId}/debug/...`

Retention policy should differ by artifact class:

- transcript-derived structured outputs: longer retention allowed
- sampled raw media: shortest retention by default
- debug artifacts: disabled unless explicitly enabled

## Inference Pipeline

## 1. Transcript-driven inference

This is the lowest-risk real-time path and should be the first production feature.

Flow:

1. meeting is created with `ai_config.transcription`
2. participant presets opt into transcription where allowed
3. RealtimeKit emits transcript events
4. webhook handler normalizes transcript segments
5. Durable Object appends to rolling transcript window
6. `workers/maid` periodically or event-driven calls Workers AI
7. result is stored and exposed to clients

Inference tasks:

- rolling summary
- action items
- moderation
- assistant suggestions
- topic extraction

## 2. Frame inference

RealtimeKit docs do not currently establish a server-side frame feed suitable for arbitrary Workers AI vision tasks, so v1 should use controlled client-side sampling.

Flow:

1. client captures frame every N seconds or on event trigger
2. client sends frame to `POST /realtime/meetings/:meetingId/inference/frame`
3. backend validates participant membership and rate limit
4. backend optionally stores artifact in R2
5. backend runs Workers AI vision model
6. structured result is persisted and returned

Use cases:

- scene description
- unsafe content detection
- object/activity detection
- slide or whiteboard understanding

## 3. Audio snippet inference

For arbitrary audio inference outside RealtimeKit built-in transcription:

1. client captures short audio snippet
2. client sends snippet to backend
3. backend runs:
   - speech-to-text if transcript is needed
   - classification if direct audio model exists
4. backend stores result and emits UI-safe output

This should remain sparse and event-driven. Continuous arbitrary client uploads would be expensive and operationally noisy.

## API Design

## `POST /realtime/meetings`

Creates a Maid room and backing RealtimeKit meeting.

Request:

```json
{
  "title": "Weekly Standup",
  "mode": "group_call",
  "features": {
    "transcription": true,
    "summarization": true,
    "moderation": true,
    "frameSampling": false
  }
}
```

Behavior:

- creates D1 `realtime_room`
- calls RealtimeKit create meeting API
- configures `ai_config.transcription`
- optionally enables summarization on end

Response:

```json
{
  "roomId": "rr_123",
  "meetingId": "cf_meeting_uuid",
  "status": "ready"
}
```

## `POST /realtime/meetings/:meetingId/participants`

Creates or reuses a participant mapping and returns a join token.

Request:

```json
{
  "role": "guest"
}
```

Response:

```json
{
  "meetingId": "cf_meeting_uuid",
  "participantId": "cf_participant_id",
  "token": "jwt-or-token",
  "preset": "guest"
}
```

## `POST /realtime/meetings/:meetingId/participants/:participantId/token`

Refreshes a participant token.

## `GET /realtime/meetings/:meetingId/runtime`

Returns sanitized live state for UI:

- active session presence
- latest transcript snippets
- latest summary
- inference feature state
- moderation notices

## `POST /realtime/meetings/:meetingId/inference/frame`

Accepts image payload or upload reference and returns structured vision result.

## `POST /realtime/meetings/:meetingId/inference/audio-snippet`

Accepts short audio and returns transcript/classification result.

## `POST /realtime/webhooks/realtimekit`

Receives and processes RealtimeKit events:

- `meeting.started`
- `meeting.ended`
- `meeting.participantJoined`
- `meeting.participantLeft`
- `meeting.transcript`
- `meeting.summary`
- `recording.statusUpdate`
- `livestreaming.statusUpdate`

This handler must be idempotent.

## Webhook Processing

Recommended pipeline:

1. verify webhook authenticity if Cloudflare provides signature headers for the configured webhook
2. calculate payload hash
3. reject already-processed event IDs
4. write raw event metadata to D1
5. dispatch to event-type handler
6. update Durable Object runtime state
7. enqueue heavier side effects if needed

Event handling examples:

- `meeting.started`
  - open or update runtime state
  - create `realtime_session`
- `meeting.participantJoined`
  - update live participant map
- `meeting.transcript`
  - append transcript entries
  - trigger transcript inference
- `meeting.summary`
  - persist summary
  - notify clients
- `meeting.ended`
  - close active session
  - schedule cleanup

## Workers AI Integration

## Existing fit

`workers/maid` already has:

- `env.AI`
- authenticated routes
- streaming AI response precedent

That makes it the right place to consolidate inference.

## Suggested internal modules

- `src/lib/realtimekit/client.ts`
  - typed wrapper around RealtimeKit REST API
- `src/lib/realtimekit/webhooks.ts`
  - payload validation and normalization
- `src/lib/realtime/runtime-do.ts`
  - Durable Object implementation
- `src/lib/realtime/service.ts`
  - application orchestration
- `src/lib/inference/transcript.ts`
  - transcript-driven AI prompts
- `src/lib/inference/frame.ts`
  - image inference
- `src/lib/inference/audio.ts`
  - audio snippet inference
- `src/routes/realtime.ts`
  - Hono route group

## Model strategy

Use model selection as configuration, not inline literals in route handlers.

Suggested config classes:

- chat/text reasoning model for summaries and assistant suggestions
- vision-capable model for frame inference
- speech model only when RealtimeKit transcript is insufficient or unavailable

Add AI Gateway in front of these calls if cross-model observability and policy control become important.

## Security and Privacy

Controls required before production:

- verify room membership before issuing participant tokens
- shortest practical token lifetime and refresh only for active users
- webhook authentication and replay protection
- explicit per-room feature flags for transcript/media analysis
- opt-in and retention controls for raw media storage
- redact or avoid storing raw transcript where not required
- log model and prompt versions for auditability

## Failure Modes

### RealtimeKit API unavailable

- fail meeting creation and token refresh cleanly
- surface retryable error codes to clients

### Webhook delays or loss

- treat webhooks as eventually consistent
- reconcile active session state via RealtimeKit session APIs when necessary

### Inference overload

- Durable Object enforces per-meeting backpressure
- drop low-priority frame inference before transcript inference

### Token expiry during session

- support proactive refresh from client
- cache participant mapping so refresh does not recreate users

## Rollout Plan

## Phase 0: foundation

- add design-approved env vars and bindings
- add RealtimeKit API client
- add D1 schema for realtime entities

## Phase 1: meeting lifecycle

- create meeting API
- create participant API
- token refresh API
- minimal runtime endpoint

## Phase 2: transcript intelligence

- webhook ingestion
- transcript persistence
- rolling summary and action items via Workers AI

## Phase 3: sampled multimedia inference

- frame endpoint
- audio snippet endpoint
- artifact storage and retention

## Phase 4: production hardening

- idempotency
- observability
- dashboards and alerts
- cleanup jobs

## Open Questions

1. Should Maid allow any authenticated user to create meetings, or only certain roles?
2. Do we need one persistent Maid room per business object, or ad hoc ephemeral meetings?
3. Is storing raw transcript allowed under product/privacy requirements?
4. Do we need client-visible live AI output over polling, SSE, or Realtime data channels?
5. Is AI voice response a roadmap requirement, or can UI-only outputs satisfy the first release?
6. Do we want to add R2 now, or defer raw media retention until after the transcript MVP?

## Recommendation

Proceed with `workers/maid` as the realtime backend and implement the first release around transcript-driven intelligence.

That path is aligned with:

- the current repo structure
- existing auth and Workers AI bindings
- current documented RealtimeKit capabilities

If later requirements include a true live AI participant publishing audio/video into the meeting, run a dedicated architecture spike against Realtime SFU before committing to that product shape.

## References

- RealtimeKit overview: https://developers.cloudflare.com/realtime/realtimekit/
- RealtimeKit concepts: https://developers.cloudflare.com/realtime/realtimekit/concepts/
- Participant tokens and refresh: https://developers.cloudflare.com/realtime/realtimekit/concepts/participant/
- RealtimeKit transcription: https://developers.cloudflare.com/realtime/realtimekit/ai/transcription/
- RealtimeKit summary: https://developers.cloudflare.com/realtime/realtimekit/ai/summary/
- RealtimeKit API reference: https://developers.cloudflare.com/api/resources/realtime_kit/
- Refresh participant token API: https://developers.cloudflare.com/api/resources/realtime_kit/subresources/meetings/methods/refresh_participant_token/
- Workers AI bindings: https://developers.cloudflare.com/workers-ai/configuration/bindings/
- Realtime SFU introduction: https://developers.cloudflare.com/realtime/sfu/introduction/
