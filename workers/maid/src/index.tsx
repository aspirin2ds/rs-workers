import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "./middleware/auth";

const CHAT_MODEL = "@cf/google/gemma-4-26b-a4b-it";
const IMAGE_DETAILS = new Set(["auto", "low", "high"] as const);

const app = new Hono<AuthEnv>();

app.use("*", authMiddleware);

app.get("/", (c) => {
  return c.json({ message: "Maid worker is running." });
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

app.post("/chat", async (c) => {
  let body: {
    messages?: unknown[];
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return c.json({ error: "messages: non-empty array required" }, 400);
  }

  const messages = body.messages.filter(isChatMessage);

  if (messages.length !== body.messages.length) {
    return c.json(
      {
        error:
          "messages: each item must include role (system|user|assistant) and non-empty content as either a string or an array of text/image_url/input_audio parts",
      },
      400
    );
  }

  const stream = (await c.env.AI.run(CHAT_MODEL as keyof AiModels, {
    messages,
    stream: true,
  })) as ReadableStream;

  return new Response(stream, {
    headers: { "content-type": "text/event-stream" },
  });
});

export default app;
