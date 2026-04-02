import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins";
import { admin } from "better-auth/plugins";
import { bearer } from "better-auth/plugins";
import { Resend } from "resend";
import { betterAuthOptions } from "./options";

const KV_MIN_TTL = 60;

export const auth = (env: CloudflareBindings) => {
  const resend = new Resend(env.RESEND_API_KEY);

  return betterAuth({
    ...betterAuthOptions,
    database: env.RS_DB,
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    socialProviders: {
      ...betterAuthOptions.socialProviders,
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },
    secondaryStorage: {
      get: async (key) => await env.RS_KV.get(key),
      set: async (key, value, ttl) => {
        await env.RS_KV.put(key, value, {
          expirationTtl: ttl ? Math.max(ttl, KV_MIN_TTL) : undefined,
        });
      },
      delete: async (key) => await env.RS_KV.delete(key),
    },
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        overrideDefaultEmailVerification: true,
        sendVerificationOTP: async ({ email, otp, type }) => {
          await resend.emails.send({
            from: "Auth <noreply@auth.rollingsagas.com>",
            to: [email],
            subject:
              type === "sign-in"
                ? `Your sign-in code: ${otp}`
                : type === "email-verification"
                  ? `Verify your email: ${otp}`
                  : `Your verification code: ${otp}`,
            text: `Your verification code is: ${otp}\n\nThis code expires in 10 minutes.`,
          });
        },
      }),
      admin(),
      bearer(),
    ],
  });
};
