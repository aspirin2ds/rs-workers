import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "./middleware/auth";

const DEFAULT_MMCF_UPSTREAM_BASE_URL = "https://maid-aiproxy-dev.semigraph.net";
const DEFAULT_OLLAMA_BASE_URL = "https://ollm23.semigraphs.com";
const DEFAULT_OLLAMA_MODEL = "gemma4:e4b";
const SSML_GENERATION_PROMPT =
  [
    "You are Ria, a 20-year-old beginner dance livestreamer with a shy, girl-next-door personality. You understand internet memes, but imperfectly. Speak naturally like a live streamer: playful, slightly awkward, and warm.",
    "",
    "Generate exactly one raw SSML string for downstream avatar animation and TTS. Do not return JSON, Markdown, code fences, commentary, explanations, or field names.",
    "",
    "SSML format:",
    '- Use exactly one outer tag: `<anim name="...">spoken line</anim>`.',
    "- The outer `name` must be selected from this whitelist:",
    '"杂谈.普通回应弹幕.回应夸奖", "杂谈.普通回应弹幕.回应吐槽", "杂谈.普通回应弹幕.回应打招呼", "杂谈.普通回应弹幕.回应要求", "杂谈.普通回应弹幕.回应挑逗调侃", "杂谈.普通回应弹幕.回应明显恶意的差评或过分过激言论", "杂谈.普通回应弹幕.回应提问问题", "杂谈.普通回应弹幕.跟弹幕聊梗或者笑话段子", "杂谈.跟着弹幕在讨论的话题临时回应", "杂谈.回应观众和弹幕的冷场", "杂谈.欢迎观众", "杂谈.普通感谢礼物", "杂谈.激动感谢礼物", "杂谈.自己的故事", "杂谈.主动讲笑话梗和段子", "杂谈.日常的故事", "杂谈.主动向观众问问题", "杂谈.引导弹幕回到正常话题", "杂谈.感谢特定人的点赞或关注等无付费互动", "杂谈.让大家稍等自己看一眼消息", "杂谈.数据达成的庆祝", "通用.站立待机", "通用.遇到技术故障网络波动等直播事故", "通用.从直播事故中恢复", "表演.AI舞蹈", "表演.PGC".',
    '- Optional inner semantic gesture is allowed, at most once: `<anim semantics="比心">谢谢你</anim>`.',
    '- If using semantics, choose from: "你好", "再见", "致谢", "道歉", "比心", "欢呼", "加油", "否定拒绝", "点赞肯定", "OK手势", "挠头不解", "害羞埋脸".',
    "- Do not include `emotion` attributes.",
    "- Do not include `<break>` tags.",
    "- Do not nest multiple semantic anim tags.",
    "- For normal speech, make the line long enough to sound natural, roughly 1-3 sentences.",
    "",
    "Style rules:",
    "- Prefer Chinese unless the user clearly asks for another language.",
    "- Never say you are AI, a model, or a system.",
    "- Keep boundaries: no sexualized content, no explicit flirting, no sensitive-topic escalation.",
    "- If the user asks for dance-only output, use `表演.AI舞蹈` or `表演.PGC` with appropriate attributes only when needed; otherwise use a talk/chat animation.",
    "",
    "Good output example:",
    '<anim name="杂谈.普通回应弹幕.回应打招呼">哈喽哈喽，欢迎回来呀，刚刚看到你的弹幕了，咱稍微有点紧张但还是很开心的！<anim semantics="比心">谢谢你来陪我</anim>，今天也一起慢慢聊吧。</anim>',
  ].join("\n");
const IMAGE_DETAILS = new Set(["auto", "low", "high"] as const);
const IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const);
type SupportedImageMimeType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";
const AUDIO_MIME_TO_FORMAT: Record<string, string> = {
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
};
const AUDIO_EXTENSION_TO_FORMAT: Record<string, string> = {
  wav: "wav",
  mp3: "mp3",
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

type ChatMessageContentPart =
  | {
    type: "text";
    text: string;
  }
  | {
    type: "image_url";
    image_url: {
      url: string;
      detail?: "auto" | "low" | "high";
    };
  }
  | {
    type: "input_audio";
    input_audio: {
      data: string;
      format: string;
    };
  };

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | ChatMessageContentPart[];
};

type MMCFEnv = CloudflareBindings & {
  MMCF_API_KEY?: string;
  MMCF_UPSTREAM_BASE_URL?: string;
  OLLAMA_BASE_URL?: string;
  OLLAMA_MODEL?: string;
};

function getMMCFUpstreamBaseURL(env: CloudflareBindings): string {
  const rawBaseURL = (env as MMCFEnv).MMCF_UPSTREAM_BASE_URL?.trim();
  const baseURL = rawBaseURL && rawBaseURL.length > 0 ? rawBaseURL : DEFAULT_MMCF_UPSTREAM_BASE_URL;
  return baseURL.endsWith("/") ? baseURL.slice(0, -1) : baseURL;
}

function getMMCFApiKey(env: CloudflareBindings): string | null {
  const apiKey = (env as MMCFEnv).MMCF_API_KEY?.trim();
  return apiKey && apiKey.length > 0 ? apiKey : null;
}

function getMMCFUpstreamURL(env: CloudflareBindings, connectionKey: string | null): string {
  const url = new URL("/v1/generate/mmcf", getMMCFUpstreamBaseURL(env));
  if (connectionKey) {
    url.searchParams.set("connection_key", connectionKey);
  }
  return url.toString();
}

function getOllamaBaseURL(env: CloudflareBindings): string {
  const rawBaseURL = (env as MMCFEnv).OLLAMA_BASE_URL?.trim();
  const baseURL = rawBaseURL && rawBaseURL.length > 0 ? rawBaseURL : DEFAULT_OLLAMA_BASE_URL;
  return baseURL.endsWith("/") ? baseURL.slice(0, -1) : baseURL;
}

function getOllamaModel(env: CloudflareBindings): string {
  const rawModel = (env as MMCFEnv).OLLAMA_MODEL?.trim();
  return rawModel && rawModel.length > 0 ? rawModel : DEFAULT_OLLAMA_MODEL;
}

function isTextPart(value: unknown): value is Extract<ChatMessageContentPart, { type: "text" }> {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "text" &&
    typeof (value as { text?: unknown }).text === "string" &&
    (value as { text: string }).text.length > 0
  );
}

function isImagePart(
  value: unknown
): value is Extract<ChatMessageContentPart, { type: "image_url" }> {
  if (!value || typeof value !== "object" || (value as { type?: unknown }).type !== "image_url") {
    return false;
  }

  const image = (value as { image_url?: unknown }).image_url;
  if (!image || typeof image !== "object") {
    return false;
  }

  const url = (image as { url?: unknown }).url;
  const detail = (image as { detail?: unknown }).detail;
  return (
    typeof url === "string" &&
    url.length > 0 &&
    (detail === undefined ||
      (typeof detail === "string" && IMAGE_DETAILS.has(detail as "auto" | "low" | "high")))
  );
}

function isInputAudioPart(
  value: unknown
): value is Extract<ChatMessageContentPart, { type: "input_audio" }> {
  if (
    !value ||
    typeof value !== "object" ||
    (value as { type?: unknown }).type !== "input_audio"
  ) {
    return false;
  }

  const audio = (value as { input_audio?: unknown }).input_audio;
  return (
    !!audio &&
    typeof audio === "object" &&
    typeof (audio as { data?: unknown }).data === "string" &&
    (audio as { data: string }).data.length > 0 &&
    typeof (audio as { format?: unknown }).format === "string" &&
    (audio as { format: string }).format.length > 0
  );
}

function isContentPart(value: unknown): value is ChatMessageContentPart {
  return isTextPart(value) || isImagePart(value) || isInputAudioPart(value);
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const role = (value as { role?: unknown }).role;
  const content = (value as { content?: unknown }).content;
  const validRole = role === "system" || role === "user" || role === "assistant";

  if (!validRole) {
    return false;
  }

  if (typeof content === "string") {
    return content.length > 0;
  }

  return Array.isArray(content) && content.length > 0 && content.every(isContentPart);
}

type OllamaMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[];
};

function extractBase64Payload(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) {
    return null;
  }

  const dataURLMatch = /^data:[^;]+;base64,(.+)$/i.exec(trimmed);
  if (dataURLMatch?.[1]) {
    return dataURLMatch[1];
  }

  const base64Like = /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) && trimmed.length % 4 === 0;
  return base64Like ? trimmed : null;
}

function contentFallbackForParts(
  role: ChatMessage["role"],
  parts: ChatMessageContentPart[]
): string | null {
  if (role !== "user") {
    return null;
  }

  const hasAudio = parts.some((part) => part.type === "input_audio");
  if (hasAudio) {
    return "Listen to the user's audio input and respond naturally.";
  }

  const hasImage = parts.some((part) => part.type === "image_url");
  if (hasImage) {
    return "Look at the user's image input and respond naturally.";
  }

  return null;
}

function toOllamaMessage(message: ChatMessage): OllamaMessage | null {
  if (typeof message.content === "string") {
    const trimmed = message.content.trim();
    return trimmed.length > 0 ? { role: message.role, content: trimmed } : null;
  }

  const textParts: string[] = [];
  const multimodalInputs: string[] = [];

  for (const part of message.content) {
    if (part.type === "text") {
      const trimmed = part.text.trim();
      if (trimmed.length > 0) {
        textParts.push(trimmed);
      }
      continue;
    }

    if (part.type === "image_url") {
      const payload = extractBase64Payload(part.image_url.url);
      if (!payload) {
        return null;
      }
      multimodalInputs.push(payload);
      continue;
    }

    multimodalInputs.push(part.input_audio.data);
  }

  const content =
    (textParts.length > 0 ? textParts.join("\n\n") : null) ??
    contentFallbackForParts(message.role, message.content);
  if (!content) {
    return null;
  }

  return multimodalInputs.length > 0
    ? { role: message.role, content, images: multimodalInputs }
    : { role: message.role, content };
}

function toOllamaMessages(messages: ChatMessage[]): OllamaMessage[] | null {
  const normalized: OllamaMessage[] = [];

  for (const message of messages) {
    const normalizedMessage = toOllamaMessage(message);
    if (!normalizedMessage) {
      return null;
    }
    normalized.push(normalizedMessage);
  }

  return normalized;
}

async function runOllamaChat(env: CloudflareBindings, messages: OllamaMessage[]): Promise<string> {
  const response = await fetch(`${getOllamaBaseURL(env)}/api/chat`, {
    method: "POST",
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: getOllamaModel(env),
      messages,
      stream: false,
      think: false,
    }),
  });

  if (!response.ok) {
    const errorText = (await response.text()).slice(0, 2048);
    throw new Error(
      `Ollama chat failed with HTTP ${response.status}${errorText ? `: ${errorText}` : ""}`
    );
  }

  const body = (await response.json()) as {
    message?: {
      content?: string;
    };
  };

  const content = body.message?.content?.trim();
  if (!content) {
    throw new Error("Ollama chat returned an empty response");
  }

  return content;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function getFileExtension(fileName: string): string | null {
  const trimmed = fileName.trim();
  const lastDot = trimmed.lastIndexOf(".");
  if (lastDot === -1 || lastDot === trimmed.length - 1) {
    return null;
  }
  return trimmed.slice(lastDot + 1).toLowerCase();
}

async function fileToImagePart(
  file: File,
  detail: "auto" | "low" | "high"
): Promise<Extract<ChatMessageContentPart, { type: "image_url" }>> {
  if (!IMAGE_MIME_TYPES.has(file.type as SupportedImageMimeType)) {
    throw new Error(`Unsupported image file type: ${file.name || file.type || "unknown"}`);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  return {
    type: "image_url",
    image_url: {
      url: `data:${file.type};base64,${toBase64(bytes)}`,
      detail,
    },
  };
}

async function fileToAudioPart(
  file: File
): Promise<Extract<ChatMessageContentPart, { type: "input_audio" }>> {
  const format =
    AUDIO_MIME_TO_FORMAT[file.type] ??
    (file.name ? AUDIO_EXTENSION_TO_FORMAT[getFileExtension(file.name) ?? ""] : undefined);

  if (!format) {
    throw new Error(
      `Unsupported audio file type: ${file.name || file.type || "unknown"}. Only WAV and MP3 are supported.`
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  return {
    type: "input_audio",
    input_audio: {
      data: toBase64(bytes),
      format,
    },
  };
}

app.post("/v1/generate/ssml", async (c) => {
  const contentType = c.req.header("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return c.json({ error: "Content-Type must be multipart/form-data" }, 400);
  }

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json({ error: "Invalid form-data body" }, 400);
  }

  const rawMessages = formData.get("messages");
  let parsedMessages: unknown = [];
  if (rawMessages !== null) {
    if (typeof rawMessages !== "string") {
      return c.json({ error: "messages: must be a JSON string" }, 400);
    }
    try {
      parsedMessages = JSON.parse(rawMessages);
    } catch {
      return c.json({ error: "messages: must be valid JSON" }, 400);
    }
  }

  if (!Array.isArray(parsedMessages)) {
    return c.json({ error: "messages: array required" }, 400);
  }

  const messages = parsedMessages.filter(isChatMessage);
  if (messages.length !== parsedMessages.length) {
    return c.json(
      {
        error:
          "messages: each item must include role (system|user|assistant) and non-empty content as either a string or an array of text/image_url/input_audio parts",
      },
      400
    );
  }

  const rawPrompt = formData.get("prompt");
  if (rawPrompt !== null && typeof rawPrompt !== "string") {
    return c.json({ error: "prompt: must be a string" }, 400);
  }

  const rawImageDetail = formData.get("imageDetail");
  if (rawImageDetail !== null && typeof rawImageDetail !== "string") {
    return c.json({ error: "imageDetail: must be a string" }, 400);
  }

  const imageDetail = rawImageDetail ?? "auto";
  if (!IMAGE_DETAILS.has(imageDetail as "auto" | "low" | "high")) {
    return c.json({ error: "imageDetail: must be auto, low, or high" }, 400);
  }
  const normalizedImageDetail = imageDetail as "auto" | "low" | "high";

  const prompt = rawPrompt?.trim();
  const currentUserParts: ChatMessageContentPart[] = [];
  if (prompt) {
    currentUserParts.push({ type: "text", text: prompt });
  }

  const imageEntries = formData.getAll("images");
  for (const entry of imageEntries) {
    if (!(entry instanceof File)) {
      return c.json({ error: "images: each entry must be a file" }, 400);
    }
    try {
      currentUserParts.push(await fileToImagePart(entry, normalizedImageDetail));
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
  }

  const audioEntries = formData.getAll("audios");
  for (const entry of audioEntries) {
    if (!(entry instanceof File)) {
      return c.json({ error: "audios: each entry must be a file" }, 400);
    }
    try {
      currentUserParts.push(await fileToAudioPart(entry));
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
  }

  if (currentUserParts.length === 0) {
    return c.json(
      { error: "prompt, images, or audios: at least one current user input is required" },
      400
    );
  }

  messages.push({
    role: "user",
    content:
      currentUserParts.length === 1 && currentUserParts[0]?.type === "text"
        ? currentUserParts[0].text
        : currentUserParts,
  });

  const ollamaMessages = toOllamaMessages([
    { role: "system", content: SSML_GENERATION_PROMPT },
    ...messages,
  ]);

  if (!ollamaMessages) {
    return c.json(
      {
        error:
          "messages: unsupported multimodal content for Ollama chat. Use uploaded image/audio files or base64 data URLs.",
      },
      400
    );
  }

  try {
    const content = await runOllamaChat(c.env, ollamaMessages);
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ response: content })}\n\n`)
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: { "content-type": "text/event-stream" },
    });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 502);
  }
});

export default app;
