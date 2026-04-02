---
description: Set an RS user's role.
argument-hint: <user-id> | <user|admin>
allowed-tools: [mcp__rs_auth__set_role]
---

# Set RS User Role

## Arguments

The user invoked this command with: $ARGUMENTS

Expected format:

`<user-id> | <user|admin>`

Examples:

- `user_123 | admin`
- `user_123 | user`

## Instructions

Parse `$ARGUMENTS` by splitting on `|` and trimming whitespace.

- `user-id` is required.
- `role` is required and must be `user` or `admin`.

If the arguments are invalid, explain the expected format and stop.

Call the RS Auth MCP `set_role` tool with the parsed values.

## Output

Return whether the role change succeeded and summarize the updated target user and role.
