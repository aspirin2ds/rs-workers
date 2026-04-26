# rs-workers

A monorepo of Cloudflare Workers for the RS platform, managed with [Turborepo](https://turbo.build/) and [pnpm](https://pnpm.io/).

## Structure

```
rs-workers/
├── workers/
│   └── auth        # Authentication worker (Better Auth)
├── packages/
│   └── db          # Shared database package (Drizzle ORM + D1)
├── turbo.json
└── pnpm-workspace.yaml
```

### `workers/auth`

Authentication and authorization worker built with [Hono](https://hono.dev/) and [Better Auth](https://www.better-auth.com/). Provides Better Auth routes and session management.

**Bindings:** Cloudflare D1 (`DB`), KV (`KV`)

**Native iOS social login:** native apps should sign in with Google or Apple on-device, then send the provider ID token to Better Auth at `/api/auth/sign-in/social`. The auth worker verifies the provider token and creates the Better Auth session.

Required/optional secrets:

- `GOOGLE_CLIENT_ID`: Google web OAuth client ID, used by the existing web OAuth redirect flow.
- `GOOGLE_CLIENT_SECRET`: Google web OAuth client secret.
- `GOOGLE_IOS_CLIENT_ID`: optional Google iOS OAuth client ID accepted for native ID-token sign-in.
- `APPLE_CLIENT_ID`: Apple Service ID used by Better Auth's Apple provider.
- `APPLE_CLIENT_SECRET`: Apple client-secret JWT for the Service ID.
- `APPLE_APP_BUNDLE_IDENTIFIER`: Apple native iOS app bundle ID, required so Better Auth accepts native Apple ID tokens whose audience is the app bundle ID.

Web Google sign-in should use Better Auth's redirect flow:

```ts
await authClient.signIn.social({
  provider: "google",
  callbackURL: "/dashboard",
});
```

Native iOS Google sign-in should get an ID token from Google Sign-In on-device and pass it to Better Auth:

```ts
await authClient.signIn.social({
  provider: "google",
  idToken: { token: googleIdToken },
});
```

The auth worker keeps `GOOGLE_CLIENT_ID` as the web OAuth client for redirect sign-in and verifies native Google ID tokens against both `GOOGLE_CLIENT_ID` and `GOOGLE_IOS_CLIENT_ID`.

### `packages/db`

Shared database schema and migrations using [Drizzle ORM](https://orm.drizzle.team/) with Cloudflare D1.

## Getting Started

```sh
pnpm install
```

### Development

```sh
pnpm dev
```

### Deploy

```sh
pnpm deploy
```

### Database

```sh
# Generate schema from Better Auth config
pnpm --filter @repo/auth-worker auth:schema

# Generate Drizzle migrations
pnpm db:generate

# Apply migrations locally
pnpm db:migrate:local

# Apply migrations to remote D1
pnpm db:migrate:remote
```

### Type Generation

Generate Cloudflare bindings types from `wrangler.jsonc`:

```sh
pnpm --filter @repo/auth-worker cf-typegen
```
