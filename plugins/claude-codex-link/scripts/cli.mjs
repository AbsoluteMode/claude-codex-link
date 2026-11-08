#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { handleLink } from './link.mjs';

const [command, ...rest] = process.argv.slice(2);
const names = { sessions: 'link_sessions', read: 'link_read', send: 'link_send', status: 'link_status', inbox: 'link_inbox', ack: 'link_ack' };
try {
  if (!names[command]) {
    console.log('Claude/Codex Link\nCommands: sessions, read, send, status, inbox, ack\nOptions map to MCP fields: --provider claude|codex, --session provider:UUID, --to, --from, --reply-to, --message-id, --recipient, --delivery queue|live.\nSend body via --stdin or --text-file PATH (never argv). Example: printf hello | claude-codex-link send --from codex:UUID --to claude:UUID --stdin');
    process.exit(command ? 1 : 0);
  }
  const args = {};
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === '--stdin') { args.text = readFileSync(0, 'utf8'); continue; }
    if (flag === '--text-file') { args.text = readFileSync(rest[++i], 'utf8'); continue; }
    if (!/^--[a-z-]+$/.test(flag) || rest[i + 1] === undefined) throw new Error('Invalid CLI option.');
    const key = flag.slice(2).replaceAll('-', '_');
    if (key === 'text') throw new Error('Use --stdin or --text-file so message text stays out of argv.');
    args[key] = key === 'limit' ? Number(rest[++i]) : rest[++i];
  }
  console.log(JSON.stringify(await handleLink(names[command], args), null, 2));
} catch (error) { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; }
