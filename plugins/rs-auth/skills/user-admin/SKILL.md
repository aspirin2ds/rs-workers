---
name: admin
description: Administer RS users through the auth MCP server, including search, creation, role changes, bans, and session revocation.
---

# User Admin

Use this skill for RS user administration tasks.

## Preferred Tools

- `list-users` or `list-user` to locate a target user
- `create-user` to provision a user
- `set-role` to change roles
- `ban-user` and `unban-user` to manage account access
- `revoke-session` and `revoke-user-sessions` to invalidate sessions
- `remove-user` only for explicit deletion requests

## Safe Workflow

1. Start with `list-users` or `list-user` when the target is identified by email, name, or partial text.
2. Confirm the target user id before running a mutating operation.
3. Execute the smallest mutation that satisfies the request.
4. Summarize the result without exposing secrets.

## Guardrails

- Do not attempt self-destructive changes such as banning yourself, deleting yourself, or changing your own role.
- Treat `remove-user` as permanent and destructive.
- When a ban duration is provided, pass it as seconds.
- If the task is really about the current session rather than a target user, switch to `rs:me`.

## Example Requests

- "List all RS admins."
- "Create a user for <alice@example.com> with role user."
- "Promote user_123 to admin."
- "Ban user_123 for abuse for 604800 seconds."
- "Revoke all sessions for user_123."
