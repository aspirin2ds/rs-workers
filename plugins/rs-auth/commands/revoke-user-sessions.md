---
description: Revoke all RS sessions for a user by user id.
argument-hint: <user-id>
allowed-tools: [mcp__rs_auth__revoke_user_sessions]
---

# Revoke RS User Sessions

## Arguments

The user invoked this command with: $ARGUMENTS

Expected format:

`<user-id>`

Examples:

- `user_123`

## Instructions

Treat `$ARGUMENTS` as the target `user-id` after trimming whitespace.

- `user-id` is required.

If the required argument is missing, explain the expected format and stop.

Call the RS Auth MCP `revoke_user_sessions` tool with the parsed value.

## Output

Return whether the user's sessions were revoked successfully and summarize the target user id.
