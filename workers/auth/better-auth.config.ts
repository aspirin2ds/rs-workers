/// <reference types="@types/node" />
import { betterAuth } from "better-auth";
import { emailOTP, admin, bearer } from "better-auth/plugins";
import { betterAuthOptions } from "./src/lib/better-auth/options";

const {
  BETTER_AUTH_URL,
  BETTER_AUTH_SECRET,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
} = process.env;

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
  },
  plugins: [
    emailOTP({
      sendVerificationOTP: async () => {},
    }),
    admin(),
    bearer(),
  ],
});
