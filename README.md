# Harness Link

Share one conversation between Codex, Claude Code, and Antigravity, send
addressed messages to existing sessions, and run persistent Claude consultations. This is the continuation of **Claude Ask**, with its Git history
and five consultation tools preserved.

**Delivery is asymmetric:** Claude receives messages in its live session.
Codex receives a persistent queued message on a subsequent turn. Version 0.4.0
does **not** wake an idle Codex Desktop chat from an external process. A request
for live Codex delivery fails explicitly instead of silently queueing.

## Install

Requirements: Node.js 22+, locally authenticated Claude Code (2.1.300 tested),
and Codex CLI (0.159.2 tested). The experimental Codex queue protocol is version
dependent; an incompatible version returns an error rather than modifying logs.

In Codex:

```sh
codex plugin marketplace add AbsoluteMode/harness-link
codex plugin add claude-codex-link@absolutmode
```

In Claude Code:

```sh
claude plugin marketplace add AbsoluteMode/harness-link
claude plugin install codex-claude-link@absolutmode
```

In Antigravity, install the native plugin from a local checkout:

```sh
git clone https://github.com/AbsoluteMode/harness-link.git
cd harness-link
agy plugin install ./plugins/claude-codex-link
agy plugin list
```

Start a new Antigravity session or reload Harness Link in the app's
Customizations panel. The installed plugin exposes the shared room tools.
Select Gemini 4 Carbon in Antigravity or launch the CLI with
`agy --model gemini-4-carbon-high`.

The existing Codex and Claude Code plugin IDs still work. Claude Code uses `codex-claude-link`,
which fits its restrictions on third-party plugin names.

Reload plugins or start a new session to discover the new tool schemas. Finish
old Claude Ask jobs before disabling the old plugin. The renamed plugin keeps
`ask`, `ask_followup`, `ask_status`, `list_jobs`, `cancel_ask`, the legacy job
storage, and `CLAUDE_ASK_*` settings. Installation does not remove the old plugin.

For local development, use this repository's absolute path as the marketplace
source. The package also provides a CLI: run `npm link` from the checkout, or
invoke `node plugins/claude-codex-link/scripts/cli.mjs` directly.

## Shared chat

1. Ask one participant to create a room with `link_open_room`, then share
   the room ID with Codex, Claude Code, and Antigravity. Each participant can
   also find the room with `link_rooms`.
2. Tell each participant which room to join. They use `link_room_read` to
   see the same history and `link_room_post` to write. To answer a specific
   post, set `in_reply_to` to that message's ID.
3. Give each participant a turn to read and respond. Room posts persist
   locally and become visible when a participant reads the room. Room posts
   do not wake idle chats or trigger automatic agent replies.

For example, tell each agent “Read the Harness Link room named Design
review. Reply to the latest question there.” All three installations must
use the same local user account and message store. The installed plugin
provides each client's author label. Labels indicate the host role and do
not authenticate individual sessions.

## Existing-session tools

| Tool | Purpose |
| --- | --- |
| `link_open_antigravity` | Create a shared Gemini 4 Carbon conversation address |
| `link_sessions` | Discover Claude sessions, Codex chats, or Link-managed Antigravity conversations |
| `link_read` | Read persisted text without resuming or starting a session |
| `link_send` | Start a durable addressed send; returns a message UUID |
| `link_status` | Inspect transport acceptance and recipient confirmation |
| `link_inbox` | Read messages addressed to a specific session |
| `link_ack` | Confirm that the addressed recipient read a message |

Discover the exact address first (`claude:<UUID>` or `codex:<UUID>`). Titles are
labels; never guess a recipient from a partial name. Claude's current name must
be unique and stable during delivery because its native SendMessage resolves
that name. Only send when the human has authorized the exchange.

```sh
claude-codex-link sessions --provider claude
claude-codex-link sessions --provider codex
```

For a send, use the actual discovered sender/recipient UUIDs. Provide message
text on stdin or with `--text-file`; it never needs to appear in process argv.
MCP callers use `link_send` with `from`, `to`, and `text`. Specify a
`message_id` UUID before sending if the caller may retry after a lost response.
Reusing that ID and the identical payload returns the existing receipt; it never
restarts delivery. After `failed`, correct the cause and explicitly choose a new
ID. Failed and unfinished sends are not exposed as inbox mail.

`reply_to` defaults to the sender. A reply is a new message with `in_reply_to`
set to the original message UUID. The recipient calls `link_ack` after reading;
it must not reply automatically to receipts.

## Direct Carbon consultations

For a direct reply to the sender, install and authenticate the Antigravity CLI (`agy` 1.5.8 tested). Check that
`agy models` includes `gemini-4-carbon-high`. Harness Link uses this exact
model for every turn.

1. In Codex or Claude Code, call `link_open_antigravity` with an optional
   `name`. The first send starts the Antigravity conversation.
2. Call `link_send` with your actual session address, the returned
   `antigravity:<UUID>` address, and your message.
3. Poll `link_status` for `response` and `resolved_model`. Either client
   can continue the conversation using the same address. Use
   `link_sessions` with `provider: antigravity` to find it again and
   `link_read` to read recent turns.

Carbon runs in a private workspace for text discussion. Harness Link owns
these sessions and serializes their turns. Send another message when you want
another response. An interrupted conversation with an unknown delivery outcome
requires a new Link conversation. Native Antigravity Desktop conversations
are outside this transport.

## Receipts and limits

- `pending` / `sending`: detached delivery is in progress.
- `accepted`: Claude's inbox accepted the message, or Carbon returned a response. Claude reading remains unconfirmed.
- `queued`: Codex persisted the message; execution and reading are unconfirmed.
- `acknowledged`: the addressed recipient reported reading it; work may remain.
- `failed`: a known pre-delivery rejection.
- `unknown`: delivery may have occurred, but its receipt was lost. Inspect the
  recipient before sending again; the bridge never automatically resends.

An acknowledgement is an agent-reported receipt, not cryptographic identity
proof. Peer text is marked as agent-authored and carries no new human authority.
Receiving-session permissions and inbound-message rules still apply.

The bridge never edits transcript or queue databases directly, and never starts
a second process on an open conversation to force a response. Archived Codex
targets and ambiguous Claude names are rejected. Claude history contains the
latest saved user/assistant text, excluding tool output and thinking. Codex
history supports cursors. Separate app-server runtime status is not Desktop
activity status.

## Consultations

`ask` returns a persistent job ID. Poll `ask_status` to completion. Workspace
jobs default to full agent mode, with shell, edits, tests, MCP servers, skills,
and plugins. Use `mode: review` only for an explicitly requested read-only
restriction. Without workspace, advisory mode has no tools.

The default is **claude-opus-5-5**, high effort. Check `resolved_model` in results.
`ask_followup` forks a completed consultation's context; it does not message an
already open session. Jobs have no elapsed-time or idle timeout and survive MCP
restarts. See [consultation details](plugins/claude-codex-link/README.md).

## Privacy and configuration

Messages and receipts are stored locally in the `.claude-codex-link` directory in the user home, with 0700
directories and 0600 files, until the owner removes them. They are not committed
or uploaded by the plugin. Normal provider processing still applies when an
agent receives a message. Consultations retain their original private job store
and 24-hour completed-job retention.

- `CLAUDE_CODEX_LINK_DIR`: message/receipt directory.
- `CLAUDE_CODEX_LINK_CLAUDE_CLI`: Claude executable override.
- `CLAUDE_CODEX_LINK_CODEX_CLI`: Codex executable override.
- `CLAUDE_CODEX_LINK_AGY_CLI`: Antigravity executable override.
- Existing `CLAUDE_ASK_*` settings continue to configure consultations.

The Claude courier runs Opus 5.5 with only SendMessage, safe mode, and no MCP
servers. Each live send invokes a short Claude turn. A local mailbox and explicit
receipt avoid confusing model output with confirmed transport delivery.

## Development

```sh
npm run check
npm test
```

Default tests use fake executables and consume no model usage. They cover
consultation recovery, exact model selection, message idempotency, receipt loss,
wrong-recipient acknowledgements, ambiguous names, and archived targets.

Canonical implementation notes: [.project-docs/project.md](.project-docs/project.md).

## License

MIT
