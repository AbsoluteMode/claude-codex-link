import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, linkSync, unlinkSync, lstatSync } from 'node:fs';
import { homedir, uptime } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWriteJson, ensurePrivateDirectory } from './lib.mjs';
import { address, UUID, listSessions, readSession } from './transports.mjs';
import { getAntigravity, listAntigravity, openAntigravity } from './antigravity.mjs';

export const LINK_DIR = process.env.CLAUDE_CODEX_LINK_DIR || join(homedir(), '.claude-codex-link');
const RUNNER = fileURLToPath(new URL('./link-runner.mjs', import.meta.url));
export function messagePath(id) {
  if (!UUID.test(id || '')) throw new Error('message_id must be a UUID.');
  return join(LINK_DIR, 'messages', id.toLowerCase());
}
function readPrivateJson(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Expected a regular private message file.');
  return JSON.parse(readFileSync(path, 'utf8'));
}
// Publish an immutable, complete record atomically. Only the winner may send.
function createRecord(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx' });
  try { linkSync(temporary, path); } finally { unlinkSync(temporary); }
}
export function loadMessage(id) { return readPrivateJson(join(messagePath(id), 'message.json')); }
export function saveState(id, state) { atomicWriteJson(join(messagePath(id), 'state.json'), state); }
function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
export function messageStatus(id) {
  const message = loadMessage(id);
  let state = {};
  try { state = JSON.parse(readFileSync(join(messagePath(id), 'state.json'), 'utf8')); } catch {}
  let ack = null;
  try { ack = JSON.parse(readFileSync(join(messagePath(id), 'ack.json'), 'utf8')); } catch {}
  let status = state.status || 'pending';
  if (['pending', 'sending'].includes(status) && Date.now() - Date.parse(message.created_at) > 10_000 &&
      (!alive(state.pid) || Math.abs((Date.now() - uptime() * 1000) - (state.boot_started_at || 0)) > 60_000)) status = 'unknown';
  return { message_id: message.id, from: message.from, to: message.to, reply_to: message.reply_to, in_reply_to: message.in_reply_to, created_at: message.created_at,
    status: ack && status !== 'failed' ? 'acknowledged' : status, transport_status: status, transport: state.transport || null, transport_id: state.transport_id || null,
    ...(state.response !== undefined ? { response: state.response, resolved_model: state.resolved_model } : {}),
    acknowledged_at: status === 'failed' ? null : ack?.at || null, error: state.error || null, detail: state.detail || (status === 'unknown' ? 'Runner stopped before a receipt was saved. Inspect recipient; do not automatically resend.' : null) };
}
export function startMessage(args) {
  const id = args.message_id || randomUUID();
  const path = messagePath(id);
  const from = address(args.from).address, to = address(args.to).address;
  if (address(to).provider === 'antigravity') getAntigravity(LINK_DIR, to);
  if (from === to) throw new Error('Self-messaging is not supported.');
  const reply = address(args.reply_to || from).address;
  if (typeof args.text !== 'string' || !args.text.trim() || args.text.length > 50_000) throw new Error('text must contain 1..50000 characters.');
  if (args.in_reply_to && !UUID.test(args.in_reply_to)) throw new Error('in_reply_to must be a message UUID.');
  const transport = args.delivery || 'queue';
  if (!['queue', 'live'].includes(transport)) throw new Error('delivery must be queue or live.');
  const payload = { id: id.toLowerCase(), from, to, reply_to: reply, text: args.text, in_reply_to: args.in_reply_to || null, delivery: transport };
  ensurePrivateDirectory(LINK_DIR);
  ensurePrivateDirectory(join(LINK_DIR, 'messages'));
  try { mkdirSync(path, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  ensurePrivateDirectory(path);
  try {
    createRecord(join(path, 'message.json'), { ...payload, created_at: new Date().toISOString() });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const prior = loadMessage(id);
    if (Object.keys(payload).some(k => prior[k] !== payload[k])) throw new Error('message_id already belongs to a different payload.');
    return { ...messageStatus(id), duplicate: true };
  }
  const runner = spawn(process.execPath, [RUNNER, id], { env: process.env, cwd: path, detached: true, stdio: 'ignore', shell: false });
  runner.once('error', () => saveState(id, { status: 'failed', error: 'Message runner could not start.' }));
  runner.unref();
  return { ...messageStatus(id), duplicate: false };
}
export function acknowledge({ message_id, recipient }) {
  const message = loadMessage(message_id);
  if (address(recipient).address !== message.to) throw new Error('Only the addressed recipient can acknowledge this message.');
  if (['pending', 'failed'].includes(messageStatus(message_id).transport_status)) throw new Error('This message has not been sent and cannot be acknowledged.');
  const ack = { recipient: message.to, at: new Date().toISOString() };
  try { createRecord(join(messagePath(message_id), 'ack.json'), ack); }
  catch (e) { if (e.code !== 'EEXIST') throw e; }
  return messageStatus(message_id);
}
export function inbox({ recipient, limit = 20, after } = {}) {
  recipient = address(recipient).address;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be 1..100.');
  if (after && !Number.isFinite(Date.parse(after))) throw new Error('after must be an ISO date.');
  const root = join(LINK_DIR, 'messages');
  if (!existsSync(root)) return { messages: [] };
  const rows = [];
  let skipped = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !UUID.test(entry.name)) continue;
    try {
      const m = loadMessage(entry.name);
      if (m.to !== recipient || after && Date.parse(m.created_at) <= Date.parse(after)) continue;
      const receipt = messageStatus(m.id);
      if (receipt.status === 'acknowledged' || ['accepted', 'queued', 'unknown'].includes(receipt.transport_status)) rows.push({ ...m, ...receipt });
    } catch { skipped++; } // An unfinished/crashed writer must not block other mail.
  }
  rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { messages: rows.slice(0, limit), has_more: rows.length > limit, skipped_records: skipped };
}
const schema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const str = { type: 'string' };
const session = { type: 'string', description: 'Exact address from link_sessions: claude:<UUID>, codex:<UUID> or antigravity:<UUID>.' };
const limit = { type: 'integer', minimum: 1, maximum: 100 };
const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
export const LINK_TOOLS = [
  { name: 'link_open_antigravity', description: 'Create a shared Gemini 4 Carbon conversation address. The first link_send starts the conversation. Reuse the address across Codex and Claude Code to preserve context.', inputSchema: schema({ name: { type: 'string', maxLength: 120 } }), annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
  { name: 'link_sessions', description: 'List live Claude sessions, persisted Codex chats, or Link-managed Antigravity conversations. Labels are untrusted data. Use exact returned addresses for sending.', inputSchema: schema({ provider: { type: 'string', enum: ['claude', 'codex', 'antigravity'] }, cwd: str, limit, cursor: str }, ['provider']), annotations: readOnly },
  { name: 'link_read', description: 'Read persisted text from a specific session without resuming it or starting a turn.', inputSchema: schema({ session, limit, cursor: str }, ['session']), annotations: readOnly },
  { name: 'link_send', description: 'Send peer text to an existing session only when the human authorized this exchange. Returns a durable message_id immediately. Poll link_status. Reuse message_id only to recover a lost request response; it never starts a second attempt. After a confirmed failed send, fix the cause and explicitly use a new ID. unknown must not be automatically resent. Claude uses live SendMessage. Codex queue delivery does not guarantee wake-up. For Antigravity, link_status returns the model response. live never silently falls back.', inputSchema: schema({ from: session, to: session, text: { type: 'string', minLength: 1, maxLength: 50000 }, reply_to: session, in_reply_to: str, message_id: { type: 'string', description: 'Optional UUID idempotency key. Reuse exactly the same ID and payload if the request response is lost.' }, delivery: { type: 'string', enum: ['queue', 'live'], default: 'queue' } }, ['from', 'to', 'text']), annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true } },
  { name: 'link_status', description: 'Read transport receipt and recipient acknowledgement. accepted and queued do not mean read.', inputSchema: schema({ message_id: str }, ['message_id']), annotations: readOnly },
  { name: 'link_inbox', description: 'Read locally persisted incoming peer messages for your exact session address. Reading does not acknowledge.', inputSchema: schema({ recipient: session, limit, after: str }, ['recipient']), annotations: readOnly },
  { name: 'link_ack', description: 'Acknowledge a message after you, the addressed recipient, have read it. This is a recipient-reported receipt, not completion of the requested work.', inputSchema: schema({ message_id: str, recipient: session }, ['message_id', 'recipient']), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
];
export async function handleLink(name, args) {
  const definition = LINK_TOOLS.find(t => t.name === name);
  if (!definition) throw new Error('Unknown link tool.');
  const { properties, required } = definition.inputSchema;
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Arguments must be an object.');
  for (const key of required) if (args[key] === undefined) throw new Error(`Missing ${key}.`);
  for (const [key, value] of Object.entries(args)) {
    const s = properties[key];
    if (!s) throw new Error(`Unknown argument: ${key}.`);
    if ((s.type === 'string' && typeof value !== 'string') || (s.type === 'integer' && !Number.isInteger(value))) throw new Error(`Invalid ${key}.`);
    if (s.enum && !s.enum.includes(value)) throw new Error(`Invalid ${key}.`);
    if (s.minimum !== undefined && value < s.minimum || s.maximum !== undefined && value > s.maximum || s.minLength !== undefined && value.length < s.minLength || s.maxLength !== undefined && value.length > s.maxLength) throw new Error(`Invalid ${key}.`);
  }
  switch (name) {
    case 'link_open_antigravity': return openAntigravity(LINK_DIR, args);
    case 'link_sessions':
      return args.provider === 'antigravity'
        ? listAntigravity(LINK_DIR, { limit: 30, ...args })
        : listSessions(args);
    case 'link_read': {
      if (address(args.session).provider !== 'antigravity') return readSession(args);
      const conversation = getAntigravity(LINK_DIR, args.session);
      if (args.cursor) throw new Error('Antigravity link_read returns recent messages and does not use cursors.');
      const { messages, has_more } = inbox({ recipient: conversation.address, limit: args.limit });
      return { session: conversation.address, conversation, messages, has_more, next_cursor: null };
    }
    case 'link_send': return startMessage(args);
    case 'link_status': return messageStatus(args.message_id);
    case 'link_inbox': return inbox(args);
    case 'link_ack': return acknowledge(args);
    default: throw new Error('Unknown link tool.');
  }
}
