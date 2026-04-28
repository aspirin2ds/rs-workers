import type { BetterAuthOptions } from "better-auth";

export const betterAuthOptions: BetterAuthOptions = {
  appName: "maid-auth",
  basePath: "/api/auth",
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
  },
  socialProviders: {
    google: {
      clientId: "",
      clientSecret: "",
    },
  },
};
