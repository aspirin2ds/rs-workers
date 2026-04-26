import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins";
import { admin } from "better-auth/plugins";
import { bearer } from "better-auth/plugins";
import { Resend } from "resend";
import { decodeProtectedHeader, importJWK, jwtVerify } from "jose";
import { betterAuthOptions } from "./options";

const KV_MIN_TTL = 60;
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const APPLE_TRUSTED_ORIGIN = "https://appleid.apple.com";

type OptionalAuthEnv = Partial<
  Record<
    | "GOOGLE_IOS_CLIENT_ID"
    | "APPLE_CLIENT_ID"
    | "APPLE_CLIENT_SECRET"
    | "APPLE_APP_BUNDLE_IDENTIFIER",
    string
  >
>;

type GoogleJwk = JsonWebKey & { kid?: string; alg?: string };

async function getGooglePublicKey(kid: string, alg: string) {
  const response = await fetch("https://www.googleapis.com/oauth2/v3/certs");

  if (!response.ok) {
    throw new Error("Unable to fetch Google OAuth public keys");
  }

  const data = await response.json<{ keys?: GoogleJwk[] }>();
  const jwk = data.keys?.find((key) => key.kid === kid);

  if (!jwk) {
    throw new Error("Google OAuth public key not found");
  }

  return importJWK(jwk, alg);
}

function getOptionalEnv(env: CloudflareBindings, key: keyof OptionalAuthEnv) {
  return (env as CloudflareBindings & OptionalAuthEnv)[key]?.trim();
}

function getGoogleClientIds(env: CloudflareBindings) {
  return [env.GOOGLE_CLIENT_ID, getOptionalEnv(env, "GOOGLE_IOS_CLIENT_ID")]
    .filter((clientId): clientId is string => Boolean(clientId));
}

function getAllowedOrigin(env: CloudflareBindings): string {
  return new URL(env.BETTER_AUTH_URL).origin;
}

async function verifyGoogleIdToken(
  env: CloudflareBindings,
  token: string,
  nonce?: string
) {
  try {
    const { kid, alg } = decodeProtectedHeader(token);

    if (!kid || !alg) {
      return false;
    }

    const { payload } = await jwtVerify(
      token,
      await getGooglePublicKey(kid, alg),
      {
        algorithms: [alg],
        audience: getGoogleClientIds(env),
        issuer: GOOGLE_ISSUERS,
        maxTokenAge: "1h",
      }
    );

    return nonce ? payload.nonce === nonce : true;
  } catch {
    return false;
  }
}

function getAppleProvider(env: CloudflareBindings) {
  const clientId = getOptionalEnv(env, "APPLE_CLIENT_ID");
  const clientSecret = getOptionalEnv(env, "APPLE_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    return undefined;
  }

  return {
    clientId,
    clientSecret,
    appBundleIdentifier: getOptionalEnv(env, "APPLE_APP_BUNDLE_IDENTIFIER"),
  };
}

export const auth = (env: CloudflareBindings) => {
  const resend = new Resend(env.RESEND_API_KEY);
  const appleProvider = getAppleProvider(env);

  return betterAuth({
    ...betterAuthOptions,
    database: env.DB,
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    socialProviders: {
      ...betterAuthOptions.socialProviders,
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        verifyIdToken: (token, nonce) => verifyGoogleIdToken(env, token, nonce),
      },
      ...(appleProvider ? { apple: appleProvider } : {}),
    },
    trustedOrigins: [getAllowedOrigin(env), APPLE_TRUSTED_ORIGIN],
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
