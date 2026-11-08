---
id: claude-codex-link
type: project
title: Claude/Codex Link
summary: Existing Claude Ask consultations plus addressed Claude Code and Codex session messaging.
status: confirmed
tags: [claude, codex, messaging, mcp]
canonical_for: [project-overview]
verified_at: 2026-11-08
sources:
  - type: user-confirmed
    reference: User requested extending claude-ask and renaming it Claude/Codex Link in this chat on 2026-11-08.
    confirmed_at: 2026-11-08
  - type: repository
    reference: plugins/claude-codex-link/scripts/link.mjs
    confirmed_at: 2026-11-08
related: [processes/session-link.md]
---

# Claude/Codex Link

The repository extends the existing Claude Ask code and preserves Git history.
Consultation tool names and the legacy job storage remain compatible. The new
plugin identity is `claude-codex-link`; the display name is Claude/Codex Link.

The Node.js stdio MCP server exposes consultations and addressed peer messaging.
A CLI exposes the same messaging operations. Runtime data is private and local;
no runtime transcripts, message payloads, or credentials belong in this repository.

For delivery semantics, installation, and verification see
[session operations](processes/session-link.md).
