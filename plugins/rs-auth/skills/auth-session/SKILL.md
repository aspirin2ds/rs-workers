---
name: me
description: Inspect the current RS auth session and handle invalid or expired Better Auth sessions.
---

# Auth Session

Use this skill when the task is about the current authenticated user, session validity, or whether Codex is still connected to the RS auth worker.

## Preferred Tool

- `get-session`

## Workflow

1. Call `get-session`.
2. If the session is valid, summarize the authenticated user and session state.
3. If the session is invalid or expired, state that re-authentication is required.
4. Do not reveal raw session secrets or tokens.

## Response Shape

Return a concise summary of:

- session validity
- user id
- email
- name
- role

## Notes

- Keep the response operational. The point is to confirm whether follow-up admin actions can proceed.
- If the user asks for admin work but the session is invalid, stop there and tell them to re-authenticate first.
