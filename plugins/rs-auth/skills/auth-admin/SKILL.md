---
name: auth-admin
description: Use the RS Auth plugin to inspect the current auth session and administer RS users through the deployed auth MCP server.
---

# RS Auth Admin

Use this skill when the task is about RS authentication, Better Auth sessions, or user administration.

## Prefer these tools

- `get-session` to inspect the current authenticated session.
- `list-users` or `list-user` to search and review users.
- `create-user` to provision a user.
- `set-role` to promote or demote a user.
- `ban-user` and `unban-user` to manage access.
- `revoke-session` and `revoke-user-sessions` to invalidate sessions.
- `remove-user` only when the request is explicitly destructive.

## Working rules

- Prefer read operations first when the request is ambiguous.
- Confirm identity-sensitive changes by checking the target user ID or email from `list-users` before mutating anything.
- Do not attempt self-destructive admin changes such as changing your own role, banning yourself, or deleting yourself; the MCP server rejects those flows.
- When `get-session` reports an invalid or expired Better Auth session, tell the user they need to re-authenticate through the auth worker's OAuth flow.

## Examples

- "List all RS admins and show their emails."
- "Create a user for alice@example.com with role user."
- "Ban this user for 7 days with a reason."
- "Check whether my RS session is still valid."
