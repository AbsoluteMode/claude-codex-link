---
id: session-link-operations
type: process
title: Session link operations
summary: Install the renamed plugin and distinguish inbox acceptance from recipient acknowledgement.
status: observed
tags: [installation, messages, receipts, testing]
canonical_for: [session-link-operations]
verified_at: 2026-11-08
sources:
  - type: repository
    reference: plugins/claude-codex-link/scripts/transports.mjs
    confirmed_at: 2026-11-08
  - type: url
    reference: https://code.claude.com/docs/en/cross-session-messaging
    confirmed_at: 2026-11-08
  - type: url
    reference: https://learn.chatgpt.com/docs/app-server
    confirmed_at: 2026-11-08
related: [../project.md]
---

# Session link operations

## Delivery

Claude discovery uses `claude agents --json`. Send resolves the exact UUID to a
unique live name, then invokes an isolated Opus 5.5 courier with only SendMessage.
Messages remain subject to the recipient's inbound policy. The transport receipt
is `accepted`; only an explicit recipient call to `link_ack` is `acknowledged`.

Codex listing, history, and queueing use the installed CLI's app-server JSONL
protocol. Queue requests include the bridge message UUID as clientUserMessageId.
They do not start, resume, fork, or interrupt a conversation. An archived target
is rejected. External Desktop wake-up is unavailable in this version: `live`
fails without silently queueing. Deferred delivery is the default.

Messages and receipts use private files under the `.claude-codex-link` directory in the user home (0700
directories, 0600 files). They remain until explicitly removed by the owner.
`CLAUDE_CODEX_LINK_DIR` overrides this directory. Reusing a UUID with an identical
payload returns the existing receipt without retrying; a changed payload is
rejected. A confirmed failure needs a corrected send with a new UUID. Failed or
unfinished sends are hidden from the inbox. Unreadable records are skipped so
one interrupted writer cannot prevent reading unrelated messages. After a
lost acknowledgement, delivery is `unknown` and is never automatically retried.
A recipient acknowledgement is reported by the calling agent, not cryptographic
proof of its identity or proof that the requested work is complete.

## Install

The root README contains the host-specific commands. Installing under the new
identity does not migrate or delete the old plugin. Finish old consultations,
then disable the old plugin to avoid duplicate tools. Legacy `CLAUDE_ASK_*`
variables and job storage remain supported.

## Verify

Run `npm run check` and `npm test`. The default tests use fake executables and
consume no model usage. For live verification use a disposable Claude receiver
and an isolated Codex thread; do not use unrelated user conversations.

Never edit transcript or queue databases directly. Never start a second
headless process over a live Desktop conversation to force delivery.

## Verification on 2026-11-08

The old consultation test suite and 11 new message tests pass locally. A real
Opus 5.5 courier delivered to an isolated running Claude session, which replied
from that same session. A real Codex queue message survived closing the sending
app-server and was consumed when its isolated test thread resumed. This verifies
deferred delivery, not automatic Desktop wake-up.

A second isolated Claude receiver loaded the MCP server and called `link_ack`;
the sender observed `acknowledged`. The receiver may acknowledge before the
courier finishes saving its transport receipt, so both states are retained.
