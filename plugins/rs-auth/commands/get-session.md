---
description: Check the current RS auth session exposed through the RS Auth MCP server.
argument-hint: none
allowed-tools: [mcp__rs_auth__get_session]
---

# Get RS Session

## Arguments

The user invoked this command with: $ARGUMENTS

This command does not accept arguments.

## Instructions

Call the RS Auth MCP `get_session` tool.

- If the session is valid, summarize the current authenticated user and session state.
- If the session is invalid or expired, state that re-authentication is required.
- Do not print raw session secrets.

## Output

Return a concise summary of:

- session validity
- user id
- email
- name
- role
