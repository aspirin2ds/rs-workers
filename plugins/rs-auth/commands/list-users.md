---
description: List RS users, optionally filtered by a search string.
argument-hint: [search text]
allowed-tools: [mcp__rs_auth__list_users]
---

# List RS Users

## Arguments

The user invoked this command with: $ARGUMENTS

## Instructions

Call the RS Auth MCP `list_users` tool.

- If `$ARGUMENTS` is empty, list users with default settings.
- If `$ARGUMENTS` is present, pass it as `searchValue` and use `email` as the default `searchField`.
- Return a concise summary with each user's id, email, name, and role when available.
- If many users match, prefer a compact summary and mention the count.

## Output

Return:

- total results if available
- a readable list of matching users
