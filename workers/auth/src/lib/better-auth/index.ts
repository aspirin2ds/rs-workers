import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins";
import { admin } from "better-auth/plugins";
import { bearer } from "better-auth/plugins";
import { Resend } from "resend";
import { decodeProtectedHeader, importJWK, jwtVerify } from "jose";
import { betterAuthOptions } from "./options";

const KV_MIN_TTL = 60;
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_TRUSTED_ORIGIN = "https://appleid.apple.com";
const DEFAULT_JWKS_TTL_MS = 5 * 60 * 1000;
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";

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
type CachedPublicKey = Awaited<ReturnType<typeof importJWK>>;
type JwksCacheEntry = {
  expiresAt: number;
  importedKeys: Map<string, CachedPublicKey>;
  keysByKid: Map<string, GoogleJwk>;
};

const jwksCache = new Map<string, JwksCacheEntry>();
const jwksFetches = new Map<string, Promise<JwksCacheEntry>>();

function getTtlMs(response: Response) {
  const cacheControl = response.headers.get("cache-control");
  const match = cacheControl?.match(/max-age=(\d+)/i);

  if (match) {
    return Number.parseInt(match[1], 10) * 1000;
  }

  return DEFAULT_JWKS_TTL_MS;
}

async function fetchJwks(url: string) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Unable to fetch OAuth public keys from ${url}`);
  }

  const data = await response.json<{ keys?: GoogleJwk[] }>();

  if (!data.keys?.length) {
    throw new Error(`OAuth public keys not found at ${url}`);
  }

  return {
    expiresAt: Date.now() + getTtlMs(response),
    importedKeys: new Map<string, CachedPublicKey>(),
    keysByKid: new Map(
      data.keys
        .filter((key): key is GoogleJwk & { kid: string } => Boolean(key.kid))
        .map((key) => [key.kid, key])
    ),
  } satisfies JwksCacheEntry;
}

async function getJwks(url: string, forceRefresh = false) {
  const cached = jwksCache.get(url);

  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  const inflight = jwksFetches.get(url);

  if (inflight) {
    return await inflight;
  }

  const fetchPromise = fetchJwks(url)
    .then((entry) => {
      jwksCache.set(url, entry);
      return entry;
    })
    .finally(() => {
      jwksFetches.delete(url);
    });

  jwksFetches.set(url, fetchPromise);

  return await fetchPromise;
}

async function getCachedPublicKey(url: string, kid: string, alg: string) {
  let jwks = await getJwks(url);
  let jwk = jwks.keysByKid.get(kid);

  if (!jwk) {
    jwks = await getJwks(url, true);
    jwk = jwks.keysByKid.get(kid);
  }

  if (!jwk) {
    throw new Error(`OAuth public key not found for kid ${kid}`);
  }

  const cacheKey = `${kid}:${alg}`;
  const cachedKey = jwks.importedKeys.get(cacheKey);

  if (cachedKey) {
    return cachedKey;
  }

  const importedKey = await importJWK(jwk, alg);
  jwks.importedKeys.set(cacheKey, importedKey);

  return importedKey;
}

async function getGooglePublicKey(kid: string, alg: string) {
  return await getCachedPublicKey(GOOGLE_JWKS_URL, kid, alg);
}

async function getApplePublicKey(kid: string, alg: string) {
  return await getCachedPublicKey(APPLE_JWKS_URL, kid, alg);
}

function getOptionalEnv(env: CloudflareBindings, key: keyof OptionalAuthEnv) {
  return (env as CloudflareBindings & OptionalAuthEnv)[key]?.trim();
}

function getGoogleClientIds(env: CloudflareBindings) {
  return [env.GOOGLE_CLIENT_ID, getOptionalEnv(env, "GOOGLE_IOS_CLIENT_ID")]
    .filter((clientId): clientId is string => Boolean(clientId));
}

function getAppleAudiences(env: CloudflareBindings) {
  return [
    getOptionalEnv(env, "APPLE_CLIENT_ID"),
    getOptionalEnv(env, "APPLE_APP_BUNDLE_IDENTIFIER"),
  ].filter((audience): audience is string => Boolean(audience));
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

async function verifyAppleIdToken(
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
      await getApplePublicKey(kid, alg),
      {
        algorithms: [alg],
        audience: getAppleAudiences(env),
        issuer: APPLE_ISSUER,
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
      ...(appleProvider
        ? {
            apple: {
              ...appleProvider,
              verifyIdToken: (token, nonce) =>
                verifyAppleIdToken(env, token, nonce),
            },
          }
        : {}),
    },
    trustedOrigins: [getAllowedOrigin(env), APPLE_TRUSTED_ORIGIN],
    advanced: {
      ipAddress: {
        ipAddressHeaders: ["cf-connecting-ip"],
      },
    },
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
    emailAndPassword: {
      ...betterAuthOptions.emailAndPassword,
      enabled: true,
      sendResetPassword: async ({ user, url }) => {
        void resend.emails.send({
          from: "Auth <noreply@auth.rollingsagas.com>",
          to: [user.email],
          subject: "Reset your password",
          text: `Click to reset your password: ${url}\n\nThis link expires in 1 hour.`,
        });
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
