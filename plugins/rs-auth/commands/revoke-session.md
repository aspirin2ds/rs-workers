---
description: Revoke a single RS session by session token.
argument-hint: <session-token>
allowed-tools: [mcp__rs_auth__revoke_session]
---

# Revoke RS Session

## Arguments

The user invoked this command with: $ARGUMENTS

Expected format:

`<session-token>`

## Instructions

Treat `$ARGUMENTS` as the target `session-token` after trimming whitespace.

- `session-token` is required.

If the required argument is missing, explain the expected format and stop.

Call the RS Auth MCP `revoke_session` tool with the parsed value.

## Output

Return whether the session was revoked successfully without echoing the full token back to the user.
