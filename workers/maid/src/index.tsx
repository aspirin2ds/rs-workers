import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "./middleware/auth";

const DEFAULT_MMCF_UPSTREAM_BASE_URL = "https://maid-aiproxy-dev.semigraph.net";
/// Workers AI model used for SSML generation. Override via the `WORKERS_AI_MODEL` env var.
const DEFAULT_WORKERS_AI_MODEL = "@cf/google/gemma-4-26b-a4b-it";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/// Extended message type for the /v1/chat endpoint: user turns may include an
/// image as a data URI (e.g. "data:image/jpeg;base64,..."). Only user-role
/// messages may carry an image; system/assistant image fields are ignored.
type ChatMessageWithImage = ChatMessage & { image?: string };

type MaidEnv = CloudflareBindings & {
  MMCF_API_KEY?: string;
  MMCF_UPSTREAM_BASE_URL?: string;
  WORKERS_AI_MODEL?: string;
};

const app = new Hono<AuthEnv>();

app.use("*", authMiddleware);

app.get("/", (c) => {
  return c.json({ message: "Maid worker is running." });
});

app.post("/v1/generate/mmcf", async (c) => {
  const contentType = c.req.header("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return c.json({ error: "Content-Type must be application/json" }, 400);
  }

  const apiKey = getMMCFApiKey(c.env);
  if (!apiKey) {
    return c.json({ error: "MMCF upstream is not configured" }, 503);
  }

  const connectionKey = c.req.query("connection_key") ?? null;
  const body = await c.req.arrayBuffer();
  const upstreamResponse = await fetch(getMMCFUpstreamURL(c.env, connectionKey), {
    method: "POST",
    headers: {
      "accept": "application/octet-stream",
      "content-type": "application/json",
      "x-maid-apikey": apiKey,
    },
    body,
  });

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: {
      "content-type": upstreamResponse.headers.get("content-type") ?? "application/octet-stream",
    },
  });
});

function getMMCFUpstreamBaseURL(env: CloudflareBindings): string {
  const rawBaseURL = (env as MaidEnv).MMCF_UPSTREAM_BASE_URL?.trim();
  const baseURL = rawBaseURL && rawBaseURL.length > 0 ? rawBaseURL : DEFAULT_MMCF_UPSTREAM_BASE_URL;
  return baseURL.endsWith("/") ? baseURL.slice(0, -1) : baseURL;
}

function getMMCFApiKey(env: CloudflareBindings): string | null {
  const apiKey = (env as MaidEnv).MMCF_API_KEY?.trim();
  return apiKey && apiKey.length > 0 ? apiKey : null;
}

function getMMCFUpstreamURL(env: CloudflareBindings, connectionKey: string | null): string {
  const url = new URL("/v1/generate/mmcf", getMMCFUpstreamBaseURL(env));
  if (connectionKey) {
    url.searchParams.set("connection_key", connectionKey);
  }
  return url.toString();
}

function getWorkersAIModel(env: CloudflareBindings): string {
  const raw = (env as MaidEnv).WORKERS_AI_MODEL?.trim();
  return raw && raw.length > 0 ? raw : DEFAULT_WORKERS_AI_MODEL;
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const role = (value as { role?: unknown }).role;
  const content = (value as { content?: unknown }).content;
  const validRole = role === "system" || role === "user" || role === "assistant";
  return validRole && typeof content === "string" && content.length > 0;
}

function isChatMessageWithImage(value: unknown): value is ChatMessageWithImage {
  if (!isChatMessage(value)) return false;
  const image = (value as { image?: unknown }).image;
  return image === undefined || image === null || typeof image === "string";
}

/// Converts a ChatMessageWithImage to the Workers AI messages format.
/// User messages with an image are expanded to a content-array with a text
/// part + an image_url part (data URI); all other messages stay as plain strings.
function toAIMessage(msg: ChatMessageWithImage): { role: string; content: unknown } {
  if (msg.role === "user" && typeof msg.image === "string" && msg.image.length > 0) {
    return {
      role: "user",
      content: [
        { type: "text", text: msg.content },
        { type: "image_url", image_url: { url: msg.image } },
      ],
    };
  }
  return { role: msg.role, content: msg.content };
}

/// Shared SSE streaming helper: pipes a Workers AI ReadableStream through a
/// transform that normalises per-chunk SSE events to `data: {"text":"..."}` /
/// `data: {"done":true}` and returns a streaming Response.
function streamAIToSSE(upstream: ReadableStream<Uint8Array>): Response {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let sseBuffer = "";
  let emittedDone = false;

  function processEvent(event: string, controller: TransformStreamDefaultController<Uint8Array>) {
    for (const rawLine of event.split("\n")) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice("data:".length).trim();
      if (payload.length === 0) continue;
      if (payload === "[DONE]") {
        if (!emittedDone) {
          controller.enqueue(encoder.encode(`data: {"done":true}\n\n`));
          emittedDone = true;
        }
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        continue;
      }
      const text = extractStreamingDelta(parsed);
      if (text) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
      }
    }
  }

  const transformer = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      sseBuffer += decoder.decode(chunk, { stream: true });
      let boundary;
      while ((boundary = sseBuffer.indexOf("\n\n")) !== -1) {
        const event = sseBuffer.slice(0, boundary);
        sseBuffer = sseBuffer.slice(boundary + 2);
        processEvent(event, controller);
      }
    },
    flush(controller) {
      sseBuffer += decoder.decode();
      if (sseBuffer.trim().length > 0) processEvent(sseBuffer, controller);
      if (!emittedDone) controller.enqueue(encoder.encode(`data: {"done":true}\n\n`));
    },
  });

  return new Response(upstream.pipeThrough(transformer), {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "x-accel-buffering": "no",
    },
  });
}

/// Per-chunk text extractor for streaming responses. Different Workers AI models emit
/// different SSE payload shapes: simple chat models send `{ response: "delta" }`,
/// OpenAI-compatible models (incl. Gemma) send `{ choices: [{ delta: { content: "delta" } }] }`.
/// Some emit `{ choices: [{ message: { content: "..." } }] }` even in stream mode. Returns
/// the next text fragment or null for non-text chunks (e.g. role announcements).
function extractStreamingDelta(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  const r = obj as Record<string, unknown>;

  if (typeof r.response === "string" && r.response.length > 0) return r.response;

  const choices = r.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0] as Record<string, unknown> | undefined;
    const delta = first?.delta as Record<string, unknown> | undefined;
    if (typeof delta?.content === "string" && delta.content.length > 0) return delta.content;
    const message = first?.message as Record<string, unknown> | undefined;
    if (typeof message?.content === "string" && message.content.length > 0) return message.content;
  }

  return null;
}

app.post("/v1/generate/ssml", async (c) => {
  const contentType = c.req.header("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return c.json({ error: "Content-Type must be application/json" }, 400);
  }

  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!payload || typeof payload !== "object") {
    return c.json({ error: "Body must be a JSON object" }, 400);
  }

  const rawMessages = (payload as { messages?: unknown }).messages;
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    return c.json({ error: "messages: non-empty array required" }, 400);
  }

  const messages = rawMessages.filter(isChatMessage);
  if (messages.length !== rawMessages.length) {
    return c.json(
      { error: "messages: each item must have role (system|user|assistant) and non-empty string content" },
      400
    );
  }

  if (messages[messages.length - 1]?.role !== "user") {
    return c.json({ error: "messages: last item must be a user turn" }, 400);
  }

  const model = getWorkersAIModel(c.env);

  let aiResult: unknown;
  try {
    aiResult = await c.env.AI.run(
      model as Parameters<CloudflareBindings["AI"]["run"]>[0],
      { messages, stream: true }
    );
  } catch (error) {
    return c.json({ error: (error as Error).message }, 502);
  }

  if (!(aiResult instanceof ReadableStream)) {
    return c.json({ error: "Workers AI did not return a stream" }, 502);
  }

  return streamAIToSSE(aiResult as ReadableStream<Uint8Array>);
});

/// General-purpose remote chat endpoint. Accepts a messages array where user
/// turns may include an optional `image` field (data URI, e.g.
/// `data:image/jpeg;base64,...`). System and assistant messages are text-only.
/// Streams back SSE in the same `data: {"text":"..."}` / `data: {"done":true}`
/// format as /v1/generate/ssml.
app.post("/v1/chat", async (c) => {
  const contentType = c.req.header("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return c.json({ error: "Content-Type must be application/json" }, 400);
  }

  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!payload || typeof payload !== "object") {
    return c.json({ error: "Body must be a JSON object" }, 400);
  }

  const rawMessages = (payload as { messages?: unknown }).messages;
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    return c.json({ error: "messages: non-empty array required" }, 400);
  }

  const messages = rawMessages.filter(isChatMessageWithImage);
  if (messages.length !== rawMessages.length) {
    return c.json(
      { error: "messages: each item must have role (system|user|assistant), non-empty string content, and optional string image" },
      400
    );
  }

  if (messages[messages.length - 1]?.role !== "user") {
    return c.json({ error: "messages: last item must be a user turn" }, 400);
  }

  const model = getWorkersAIModel(c.env);
  const aiMessages = messages.map(toAIMessage);

  let aiResult: unknown;
  try {
    aiResult = await c.env.AI.run(
      model as Parameters<CloudflareBindings["AI"]["run"]>[0],
      { messages: aiMessages, stream: true } as Parameters<CloudflareBindings["AI"]["run"]>[1]
    );
  } catch (error) {
    return c.json({ error: (error as Error).message }, 502);
  }

  if (!(aiResult instanceof ReadableStream)) {
    return c.json({ error: "Workers AI did not return a stream" }, 502);
  }

  return streamAIToSSE(aiResult as ReadableStream<Uint8Array>);
});

export default app;
