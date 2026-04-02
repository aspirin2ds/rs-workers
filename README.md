# rs-workers

A monorepo of Cloudflare Workers for the RS platform, managed with [Turborepo](https://turbo.build/) and [pnpm](https://pnpm.io/).

## Structure

```
rs-workers/
├── workers/
│   └── auth        # Authentication worker (Better Auth, MCP, OAuth)
├── packages/
│   └── db          # Shared database package (Drizzle ORM + D1)
├── turbo.json
└── pnpm-workspace.yaml
```

### `workers/auth`

Authentication and authorization worker built with [Hono](https://hono.dev/), [Better Auth](https://www.better-auth.com/), and the [MCP SDK](https://modelcontextprotocol.io/). Provides OAuth, session management, and admin tools via MCP.

**Bindings:** Cloudflare D1 (`RS_DB`), KV (`RS_KV`, `OAUTH_KV`)

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
