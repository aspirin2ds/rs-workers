/// <reference types="@types/node" />
import { betterAuth } from "better-auth";
import { emailOTP, admin } from "better-auth/plugins";
import { betterAuthOptions } from "./src/lib/better-auth/options";

const { BETTER_AUTH_URL, BETTER_AUTH_SECRET } = process.env;

export const auth = betterAuth({
  ...betterAuthOptions,
  database: {} as any,
  baseURL: BETTER_AUTH_URL,
  secret: BETTER_AUTH_SECRET,
  plugins: [
    emailOTP({
      sendVerificationOTP: async () => {},
    }),
    admin(),
  ],
});
