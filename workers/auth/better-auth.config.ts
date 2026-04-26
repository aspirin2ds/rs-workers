/// <reference types="@types/node" />
import { betterAuth } from "better-auth";
import { emailOTP, admin, bearer } from "better-auth/plugins";
import { betterAuthOptions } from "./src/lib/better-auth/options";

const {
  BETTER_AUTH_URL,
  BETTER_AUTH_SECRET,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  APPLE_CLIENT_ID,
  APPLE_CLIENT_SECRET,
  APPLE_APP_BUNDLE_IDENTIFIER,
} = process.env;

const appleProvider = APPLE_CLIENT_ID && APPLE_CLIENT_SECRET
  ? {
      clientId: APPLE_CLIENT_ID,
      clientSecret: APPLE_CLIENT_SECRET,
      appBundleIdentifier: APPLE_APP_BUNDLE_IDENTIFIER,
    }
  : undefined;

export const auth = betterAuth({
  ...betterAuthOptions,
  database: {} as any,
  baseURL: BETTER_AUTH_URL,
  secret: BETTER_AUTH_SECRET,
  socialProviders: {
    ...betterAuthOptions.socialProviders,
    google: {
      clientId: GOOGLE_CLIENT_ID as string,
      clientSecret: GOOGLE_CLIENT_SECRET as string,
    },
    ...(appleProvider ? { apple: appleProvider } : {}),
  },
  trustedOrigins: [
    BETTER_AUTH_URL ? new URL(BETTER_AUTH_URL).origin : "",
    "https://appleid.apple.com",
  ].filter(Boolean),
  plugins: [
    emailOTP({
      sendVerificationOTP: async () => {},
    }),
    admin(),
    bearer(),
  ],
});
