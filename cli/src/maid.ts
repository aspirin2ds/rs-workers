export type ChatMessageContentPart =
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

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | ChatMessageContentPart[];
};

export type PromptTurn = {
  role: "user" | "assistant";
  content: string | ChatMessageContentPart[];
};

export function buildMessages(systemPrompt: string, turns: PromptTurn[]): ChatMessage[] {
  return [
    { role: "system", content: systemPrompt.trim() },
    ...turns.map((turn) => ({
      role: turn.role,
      content:
        typeof turn.content === "string"
          ? turn.content.trim()
          : turn.content,
    })),
  ];
}

export async function* streamChat(
  baseUrl: string,
  token: string,
  messages: ChatMessage[]
): AsyncGenerator<string> {
  const response = await fetch(`${baseUrl}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ messages }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Chat failed: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ""}`
    );
  }
  if (!response.body) {
    throw new Error("Chat response has no body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";

  const extractText = (value: unknown): string | null => {
    if (typeof value === "string") {
      return value;
    }
    if (!value || typeof value !== "object") {
      return null;
    }

    const record = value as {
      response?: unknown;
      content?: unknown;
      message?: { content?: unknown };
      delta?: { content?: unknown };
      choices?: Array<{
        delta?: { content?: unknown };
        message?: { content?: unknown };
        text?: unknown;
      }>;
    };

    const direct =
      extractText(record.response) ??
      extractText(record.content) ??
      extractText(record.delta?.content) ??
      extractText(record.message?.content);
    if (direct) {
      return direct;
    }

    if (Array.isArray(record.choices)) {
      for (const choice of record.choices) {
        const choiceText =
          extractText(choice?.delta?.content) ??
          extractText(choice?.message?.content) ??
          extractText(choice?.text);
        if (choiceText) {
          return choiceText;
        }
      }
    }

    return null;
  };

  const parseDataLine = (line: string): string | null => {
    if (!line.startsWith("data:")) return null;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]" || eventName === "done") return null;
    try {
      return extractText(JSON.parse(data));
    } catch {
      // Some streams can emit bare text payloads instead of JSON.
      return data;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) {
        eventName = "message";
        continue;
      }
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim().toLowerCase();
        continue;
      }
      const chunk = parseDataLine(line);
      if (chunk) yield chunk;
    }
  }

  const tail = buffer.trim();
  if (tail) {
    const chunk = parseDataLine(tail);
    if (chunk) yield chunk;
  }
}
