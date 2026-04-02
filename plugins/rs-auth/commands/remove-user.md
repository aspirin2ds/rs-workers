---
description: Permanently delete an RS user by user id.
argument-hint: <user-id>
allowed-tools: [mcp__rs_auth__remove_user]
---

# Remove RS User

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

This is destructive. Before calling the tool, explicitly confirm in the response that this command permanently deletes the user and only proceed when the user's intent is clearly deletion-oriented from the slash command invocation.

Call the RS Auth MCP `remove_user` tool with the parsed value.

## Output

Return whether the user was deleted successfully and summarize the deleted target user id.
