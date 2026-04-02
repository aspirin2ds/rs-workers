---
description: Remove an RS user ban by user id.
argument-hint: <user-id>
allowed-tools: [mcp__rs_auth__unban_user]
---

# Unban RS User

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

Call the RS Auth MCP `unban_user` tool with the parsed value.

## Output

Return whether the user was unbanned successfully and summarize the target user id.
