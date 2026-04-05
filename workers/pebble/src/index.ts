import { Hono } from "hono";
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { mcpApiHandler } from "./lib/mcp";
import { processStoryGenerationBatch } from "./lib/story-generation/consumer";
import { generateStory } from "./lib/story-generation/ai";
import type { StoryQueueMessage } from "./lib/story-generation/types";

type Bindings = CloudflareBindings & { OAUTH_PROVIDER: OAuthHelpers };
type MaybeAuthOrigin = CloudflareBindings & { AUTH_WORKER_ORIGIN?: string };

const app = new Hono<{ Bindings: Bindings }>();

function getAuthWorkerOrigin(request: Request, env: MaybeAuthOrigin): string {
  const configured = env.AUTH_WORKER_ORIGIN?.trim();
  if (configured) {
    return configured.replace(/\/$/, "");
  }

  const url = new URL(request.url);
  if (url.hostname.startsWith("pebble-worker.")) {
    return `${url.protocol}//${url.hostname.replace(/^pebble-worker\./, "auth-worker.")}`;
  }

  return `${url.protocol}//auth-worker.rollingsagas.com`;
}

function redirectToAuthWorker(request: Request, env: MaybeAuthOrigin): Response {
  const target = new URL(request.url);
  target.protocol = new URL(getAuthWorkerOrigin(request, env)).protocol;
  target.host = new URL(getAuthWorkerOrigin(request, env)).host;
  return Response.redirect(target.toString(), 307);
}

app.get("/", (c) => {
  return c.text("Pebble worker is running.");
});

app.get("/authorize", (c) => {
  return redirectToAuthWorker(c.req.raw, c.env);
});

app.get("/authorize/resume", (c) => {
  return redirectToAuthWorker(c.req.raw, c.env);
});

app.post("/authorize", (c) => {
  return redirectToAuthWorker(c.req.raw, c.env);
});

const oauthWorker = new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: mcpApiHandler,
  defaultHandler: app,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
});

export default {
  fetch: oauthWorker.fetch.bind(oauthWorker),
  async queue(
    batch: MessageBatch<StoryQueueMessage>,
    env: CloudflareBindings,
    ctx: ExecutionContext,
  ) {
    await processStoryGenerationBatch(batch, env, ctx, generateStory);
  },
};
