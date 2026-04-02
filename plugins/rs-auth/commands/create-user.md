---
description: Create an RS user from email, name, and password arguments.
argument-hint: <email> | <name> | <password> [| role]
allowed-tools: [mcp__rs_auth__create_user]
---

# Create RS User

## Arguments

The user invoked this command with: $ARGUMENTS

Expected format:

`<email> | <name> | <password> [| role]`

Examples:

- `alice@example.com | Alice Chen | temp-password-123`
- `admin@example.com | Admin User | temp-password-123 | admin`

## Instructions

Parse `$ARGUMENTS` by splitting on `|` and trimming whitespace.

- `email` is required.
- `name` is required.
- `password` is required.
- `role` is optional and defaults to `user`.

If the required arguments are missing, explain the expected format and stop.

Call the RS Auth MCP `create_user` tool with the parsed values.

## Output

Return whether the user was created successfully and summarize the created user's identity without echoing the password.
