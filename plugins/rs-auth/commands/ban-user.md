---
description: Ban an RS user by id, with an optional reason and expiry.
argument-hint: <user-id> [| reason] [| expires-seconds]
allowed-tools: [mcp__rs_auth__ban_user]
---

# Ban RS User

## Arguments

The user invoked this command with: $ARGUMENTS

Expected format:

`<user-id> [| reason] [| expires-seconds]`

Examples:

- `user_123`
- `user_123 | abuse`
- `user_123 | repeated abuse | 604800`

## Instructions

Parse `$ARGUMENTS` by splitting on `|` and trimming whitespace.

- `user-id` is required.
- `reason` is optional.
- `expires-seconds` is optional and should be parsed as a number when present.

If the required argument is missing, explain the expected format and stop.

Call the RS Auth MCP `ban_user` tool with the parsed values.

## Output

Return whether the user was banned successfully and include the applied reason or expiry when provided.
