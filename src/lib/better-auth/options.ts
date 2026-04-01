import type { BetterAuthOptions } from "better-auth";

export const betterAuthOptions: BetterAuthOptions = {
  appName: "cf-better-auth",
  basePath: "/api/auth",
  emailAndPassword: {
    enabled: true,
  },
};
