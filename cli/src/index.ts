#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { Command } from "commander";
import { input, password, select } from "@inquirer/prompts";
import {
  type AuthClient,
  clearToken,
  getSession,
  loadToken,
  requestOtp,
  requestPasswordResetOtp,
  resetPasswordWithOtp,
  saveToken,
  signInWithOtp,
  signInWithPassword,
  signOut,
} from "./auth.js";
import {
  buildMessages,
  type ChatMessageContentPart,
  type PromptTurn,
  streamChat,
} from "./maid.js";

const DEFAULT_MAID_URL = process.env.MAID_API_URL ?? "http://localhost:8788";

function assertSecureUrl(raw: string, label: string): string {
  const url = new URL(raw);
  const isLoopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1";
  if (url.protocol !== "https:" && !isLoopback) {
    throw new Error(
      `Refusing plain HTTP for non-local ${label} host "${url.hostname}". Use https:// or override --${label}-url.`
    );
  }
  return raw;
}

const DEFAULT_URL = process.env.MAID_AUTH_URL ?? "http://localhost:8787";
const IMAGE_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};
const AUDIO_FORMATS: Record<string, string> = {
  ".wav": "wav",
  ".mp3": "mp3",
  ".flac": "flac",
  ".opus": "opus",
  ".ogg": "opus",
  ".aac": "aac",
  ".m4a": "aac",
};

const program = new Command();

program
  .name("maid-cli")
  .description("CLI for the maid-auth worker")
  .option("--base-url <url>", "auth worker base URL", DEFAULT_URL)
  .option(
    "--origin <url>",
    "Origin header sent to Better Auth (must match BETTER_AUTH_URL or trustedOrigins; defaults to --base-url)"
  );

function getClient(): AuthClient {
  const opts = program.opts<{ baseUrl: string; origin?: string }>();
  const url = new URL(opts.baseUrl);
  const isLoopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1";
  if (url.protocol !== "https:" && !isLoopback) {
    throw new Error(
      `Refusing plain HTTP for non-local host "${url.hostname}". Use https:// or override --base-url.`
    );
  }
  const origin =
    opts.origin ?? process.env.MAID_AUTH_ORIGIN ?? new URL(opts.baseUrl).origin;
  return { baseUrl: opts.baseUrl, origin };
}

function collectOption(value: string, previous: string[] = []): string[] {
  previous.push(value);
  return previous;
}

async function fileToImagePart(
  filePath: string,
  detail: "auto" | "low" | "high"
): Promise<ChatMessageContentPart> {
  const absolutePath = resolve(filePath);
  const mimeType = IMAGE_MIME_TYPES[extname(absolutePath).toLowerCase()];
  if (!mimeType) {
    throw new Error(`Unsupported image file type: ${filePath}`);
  }

  const bytes = await readFile(absolutePath);
  return {
    type: "image_url",
    image_url: {
      url: `data:${mimeType};base64,${bytes.toString("base64")}`,
      detail,
    },
  };
}

async function fileToAudioPart(filePath: string): Promise<ChatMessageContentPart> {
  const absolutePath = resolve(filePath);
  const format = AUDIO_FORMATS[extname(absolutePath).toLowerCase()];
  if (!format) {
    throw new Error(`Unsupported audio file type: ${filePath}`);
  }

  const bytes = await readFile(absolutePath);
  return {
    type: "input_audio",
    input_audio: {
      data: bytes.toString("base64"),
      format,
    },
  };
}

async function buildUserTurnContent(opts: {
  prompt?: string;
  image?: string[];
  audio?: string[];
  imageDetail: "auto" | "low" | "high";
}): Promise<string | ChatMessageContentPart[]> {
  const prompt = opts.prompt?.trim();
  const images = opts.image ?? [];
  const audio = opts.audio ?? [];

  if (images.length === 0 && audio.length === 0) {
    if (!prompt) {
      throw new Error("A prompt is required when no image or audio files are provided.");
    }
    return prompt;
  }

  const parts: ChatMessageContentPart[] = [];
  if (prompt) {
    parts.push({ type: "text", text: prompt });
  }

  for (const filePath of images) {
    parts.push(await fileToImagePart(filePath, opts.imageDetail));
  }

  for (const filePath of audio) {
    parts.push(await fileToAudioPart(filePath));
  }

  if (parts.length === 0) {
    throw new Error("At least one prompt, image, or audio input is required.");
  }

  return parts;
}

function describeContent(content: string | ChatMessageContentPart[]): string {
  if (typeof content === "string") {
    return content;
  }

  const summary = content.map((part) => {
    if (part.type === "text") {
      return part.text;
    }
    if (part.type === "image_url") {
      return "[image]";
    }
    return "[audio]";
  });

  return summary.join(" ").trim();
}

program
  .command("login")
  .description("Sign in and save bearer token under ~/.maid-cli/token.json")
  .option("-m, --method <method>", "sign-in method: password | otp")
  .option("-e, --email <email>", "email address")
  .action(async (opts: { method?: string; email?: string }) => {
    const method =
      opts.method ??
      (await select({
        message: "Sign-in method",
        choices: [
          { name: "Email + password", value: "password" },
          { name: "Email OTP", value: "otp" },
        ],
      }));

    if (method !== "password" && method !== "otp") {
      throw new Error(`Unknown method: ${method}`);
    }

    const email =
      opts.email ??
      (await input({
        message: "Email",
        validate: (v) => v.includes("@") || "Invalid email",
      }));

    const client = getClient();
    let token: string;

    if (method === "password") {
      const pwd = await password({ message: "Password", mask: "*" });
      token = await signInWithPassword(client, email, pwd);
    } else {
      await requestOtp(client, email);
      console.log(`OTP sent to ${email}`);
      const otp = await input({
        message: "Enter the 6-digit code",
        validate: (v) => /^\d{6}$/.test(v) || "Must be 6 digits",
      });
      token = await signInWithOtp(client, email, otp);
    }

    await saveToken(token);
    console.log("Logged in.");
  });

program
  .command("me")
  .description("Show the current session user")
  .action(async () => {
    const token = await loadToken();
    if (!token) {
      console.error("Not logged in. Run `maid-cli login`.");
      process.exitCode = 1;
      return;
    }
    const session = await getSession(getClient(), token);
    if (!session) {
      console.error("Session expired. Run `maid-cli login` again.");
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify(session.user, null, 2));
  });

program
  .command("token")
  .description("Print stored bearer token (use with shell substitution)")
  .action(async () => {
    const token = await loadToken();
    if (!token) {
      process.exitCode = 1;
      return;
    }
    process.stdout.write(token);
  });

program
  .command("reset")
  .description("Reset your password via emailed OTP code")
  .option("-e, --email <email>", "email of the account to reset")
  .action(async (opts: { email?: string }) => {
    const client = getClient();

    const email =
      opts.email ??
      (await input({
        message: "Email",
        validate: (v) => v.includes("@") || "Invalid email",
      }));

    await requestPasswordResetOtp(client, email);
    console.log(`Reset code sent to ${email} (if the account exists).`);

    const otp = await input({
      message: "Enter the 6-digit code",
      validate: (v) => /^\d{6}$/.test(v) || "Must be 6 digits",
    });

    const newPassword = await password({
      message: "New password",
      mask: "*",
      validate: (v) => v.length >= 8 || "Must be at least 8 characters",
    });
    await password({
      message: "Confirm password",
      mask: "*",
      validate: (v) => v === newPassword || "Passwords do not match",
    });

    await resetPasswordWithOtp(client, email, otp, newPassword);
    console.log("Password reset.");
  });

program
  .command("logout")
  .description("Sign out and clear the stored token")
  .action(async () => {
    const token = await loadToken();
    if (token) {
      await signOut(getClient(), token).catch(() => {});
    }
    await clearToken();
    console.log("Logged out.");
  });

program
  .command("chat")
  .description("Interactive or one-shot chat with Workers AI Gemma via the maid worker")
  .option("--maid-url <url>", "maid worker base URL", DEFAULT_MAID_URL)
  .option(
    "--system <prompt>",
    "system prompt",
    "You are a friendly assistant."
  )
  .option("-p, --prompt <text>", "send a single prompt and exit")
  .option("--image <path>", "attach an image file", collectOption, [])
  .option("--audio <path>", "attach an audio file", collectOption, [])
  .option(
    "--image-detail <detail>",
    "image detail level: auto | low | high",
    "auto"
  )
  .action(
    async (opts: {
      maidUrl: string;
      system: string;
      prompt?: string;
      image: string[];
      audio: string[];
      imageDetail: "auto" | "low" | "high";
    }) => {
    const token = await loadToken();
    if (!token) {
      console.error("Not logged in. Run `maid-cli login`.");
      process.exitCode = 1;
      return;
    }
    const maidUrl = assertSecureUrl(opts.maidUrl, "maid");
    const imageDetail = opts.imageDetail;
    if (imageDetail !== "auto" && imageDetail !== "low" && imageDetail !== "high") {
      throw new Error(`Invalid --image-detail value: ${imageDetail}`);
    }
    const turns: PromptTurn[] = [];
    const pendingImages: string[] = [];
    const pendingAudio: string[] = [];
    const hasOneShotInput =
      typeof opts.prompt === "string" || opts.image.length > 0 || opts.audio.length > 0;

    if (hasOneShotInput) {
      const userContent = await buildUserTurnContent({
        prompt: opts.prompt,
        image: opts.image,
        audio: opts.audio,
        imageDetail,
      });
      turns.push({ role: "user", content: userContent });
      let assistant = "";
      const messages = buildMessages(opts.system, turns);
      for await (const tok of streamChat(maidUrl, token, messages)) {
        process.stdout.write(tok);
        assistant += tok;
      }
      process.stdout.write("\n");
      return;
    }

    console.log("Chat with Gemma. Empty line, 'exit', or Ctrl-C to quit.\n");
    console.log(
      "Commands: /image <path>, /audio <path>, /attachments, /clearattachments, /send\n"
    );

    while (true) {
      let userText: string;
      try {
        userText = await input({ message: "you" });
      } catch {
        break;
      }
      const trimmed = userText.trim();
      if (trimmed === "exit" || trimmed === "quit") break;

      if (trimmed.startsWith("/image ")) {
        const filePath = trimmed.slice("/image ".length).trim();
        if (!filePath) {
          console.error("[error] Usage: /image <path>\n");
          continue;
        }
        pendingImages.push(filePath);
        console.log(`[attached] image ${filePath}\n`);
        continue;
      }

      if (trimmed.startsWith("/audio ")) {
        const filePath = trimmed.slice("/audio ".length).trim();
        if (!filePath) {
          console.error("[error] Usage: /audio <path>\n");
          continue;
        }
        pendingAudio.push(filePath);
        console.log(`[attached] audio ${filePath}\n`);
        continue;
      }

      if (trimmed === "/attachments") {
        if (pendingImages.length === 0 && pendingAudio.length === 0) {
          console.log("[attachments] none\n");
          continue;
        }
        for (const filePath of pendingImages) {
          console.log(`[attachments] image ${filePath}`);
        }
        for (const filePath of pendingAudio) {
          console.log(`[attachments] audio ${filePath}`);
        }
        console.log("");
        continue;
      }

      if (trimmed === "/clearattachments") {
        pendingImages.length = 0;
        pendingAudio.length = 0;
        console.log("[attachments] cleared\n");
        continue;
      }

      const wantsAttachmentOnlySend = trimmed === "/send";
      if (!trimmed && pendingImages.length === 0 && pendingAudio.length === 0) {
        break;
      }
      if (!trimmed && (pendingImages.length > 0 || pendingAudio.length > 0)) {
        console.error("[error] Type a prompt, use /send, or clear the pending attachments.\n");
        continue;
      }

      let userContent: string | ChatMessageContentPart[];
      try {
        userContent = await buildUserTurnContent({
          prompt: wantsAttachmentOnlySend ? undefined : trimmed,
          image: pendingImages,
          audio: pendingAudio,
          imageDetail,
        });
      } catch (err) {
        console.error(`[error] ${(err as Error).message}\n`);
        continue;
      }

      turns.push({ role: "user", content: userContent });
      pendingImages.length = 0;
      pendingAudio.length = 0;
      console.log(`you > ${describeContent(userContent)}`);
      process.stdout.write("ai  > ");
      let assistant = "";
      try {
        const messages = buildMessages(opts.system, turns);
        for await (const tok of streamChat(maidUrl, token, messages)) {
          process.stdout.write(tok);
          assistant += tok;
        }
        process.stdout.write("\n\n");
        turns.push({ role: "assistant", content: assistant });
      } catch (err) {
        process.stdout.write("\n");
        console.error(`[error] ${(err as Error).message}\n`);
        turns.pop();
      }
    }
    }
  );

await program.parseAsync();
