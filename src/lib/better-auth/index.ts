import { betterAuth } from "better-auth";
import { betterAuthOptions } from "./options";

const KV_MIN_TTL = 60;

export const auth = (env: CloudflareBindings) => {
  return betterAuth({
    ...betterAuthOptions,
    database: env.DB,
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    secondaryStorage: {
      get: async (key) => await env.KV.get(key),
      set: async (key, value, ttl) => {
        await env.KV.put(key, value, {
          expirationTtl: ttl ? Math.max(ttl, KV_MIN_TTL) : undefined,
        });
      },
      delete: async (key) => await env.KV.delete(key),
    },
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60, // 5 minutes
      },
    },
  });
};
