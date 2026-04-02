---
name: rs-auth
description: Use the RS Auth plugin for Better Auth session checks and MCP-backed user administration.
---

# RS Auth

Use this skill for any task involving RS authentication, Better Auth session state, user lookup, or account administration.

## Route The Request

Use `me` when the task is about the current authenticated session, re-authentication, or session validity.

Use `admin` when the task is about listing users, creating accounts, role changes, bans, unbans, or session revocation for a target user.

## Tool Map

| Need | MCP tools |
| --- | --- |
| Inspect current auth state | `get-session` |
| Search or review users | `list-users`, `list-user` |
| Create a user | `create-user` |
| Change access | `set-role`, `ban-user`, `unban-user` |
| Revoke sessions | `revoke-session`, `revoke-user-sessions` |
| Permanently delete a user | `remove-user` |

## Working Rules

- Prefer read operations first when the request is ambiguous.
- Resolve a target user by id or email before making a mutating call.
- Keep secrets out of responses. Never echo passwords or full session tokens.
- Treat `remove-user` as destructive and only use it when the request is explicitly deletion-oriented.
- If the MCP server reports an invalid or expired session, tell the user they need to authenticate through the auth worker OAuth flow before retrying.

## Example Requests

- "Check whether my RS auth session is still valid."
- "Find all admin users and list their emails."
- "Create a user for <alice@example.com>."
- "Ban this user for 7 days and revoke their sessions."
