import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ensurePrivateDirectory } from './lib.mjs';
import { createRecord, readPrivateJson } from './link-storage.mjs';
import { UUID } from './transports.mjs';

export const ROOM_ROLES = ['codex', 'claude', 'antigravity'];

function roomDirectory(linkDir, roomId) {
  if (!UUID.test(roomId)) throw new Error('room_id must be a UUID from link_rooms.');
  return join(linkDir, 'rooms', roomId.toLowerCase());
}

function records(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (!entry.isFile() || !entry.name.endsWith('.json') || !UUID.test(entry.name.slice(0, -5))) return [];
    try { return [readPrivateJson(join(directory, entry.name))]; }
    catch { return []; }
  });
}

function ordered(a, b) {
  return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
}

function loadRoom(directory) {
  if (!lstatSync(directory, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error('Room is unavailable. Use link_rooms to find its ID.');
  }
  return readPrivateJson(join(directory, 'room.json'));
}

export function openRoom(linkDir, { name }) {
  const title = name.trim();
  if (!title) throw new Error('name must contain visible text.');
  const id = randomUUID();
  const directory = roomDirectory(linkDir, id);
  ensurePrivateDirectory(linkDir);
  ensurePrivateDirectory(join(linkDir, 'rooms'));
  mkdirSync(directory, { mode: 0o700 });
  mkdirSync(join(directory, 'messages'), { mode: 0o700 });
  const room = { id, name: title, created_at: new Date().toISOString() };
  createRecord(join(directory, 'room.json'), room);
  return room;
}

export function listRooms(linkDir, { limit = 30 }) {
  const root = join(linkDir, 'rooms');
  if (!lstatSync(root, { throwIfNoEntry: false })?.isDirectory()) return { rooms: [], has_more: false };
  const rooms = readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    if (!entry.isDirectory() || !UUID.test(entry.name)) return [];
    try { return [loadRoom(join(root, entry.name))]; }
    catch { return []; }
  }).sort((a, b) => ordered(b, a));
  return { rooms: rooms.slice(0, limit), has_more: rooms.length > limit };
}

export function readRoom(linkDir, { room_id: roomId, limit = 20, before }) {
  const directory = roomDirectory(linkDir, roomId);
  const room = loadRoom(directory);
  const messages = records(join(directory, 'messages')).sort(ordered);
  if (before && !UUID.test(before)) throw new Error('before must be a message UUID.');
  const end = before ? messages.findIndex(message => message.id === before.toLowerCase()) : messages.length;
  if (end === -1) throw new Error('The requested message is missing from this room.');
  const start = Math.max(0, end - limit);
  return { room, messages: messages.slice(start, end), next_before: start ? messages[start].id : null };
}

export function postToRoom(linkDir, { room_id: roomId, from, text, in_reply_to, message_id = randomUUID() }) {
  const author = process.env.HARNESS_LINK_ROOM_ROLE || from;
  if (!ROOM_ROLES.includes(author)) throw new Error('from must be codex, claude, or antigravity.');
  if (from && from !== author) throw new Error('from differs from this client’s room role.');
  if (!text.trim()) throw new Error('text must contain visible content.');
  if (!UUID.test(message_id)) throw new Error('message_id must be a UUID.');
  const directory = roomDirectory(linkDir, roomId);
  const room = loadRoom(directory);
  const messages = join(directory, 'messages');
  let parent;
  if (in_reply_to) {
    if (!UUID.test(in_reply_to)) throw new Error('in_reply_to must be a message UUID.');
    in_reply_to = in_reply_to.toLowerCase();
    try { parent = readPrivateJson(join(messages, `${in_reply_to}.json`)); }
    catch { throw new Error('You can only reply to an existing message in this room.'); }
  }
  const payload = { id: message_id.toLowerCase(), room_id: room.id, from: author, text, in_reply_to: in_reply_to || null };
  const postedAt = parent ? Math.max(Date.now(), Date.parse(parent.created_at) + 1) : Date.now();
  const message = { ...payload, created_at: new Date(postedAt).toISOString() };
  const path = join(messages, `${message.id}.json`);
  try { createRecord(path, message); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const prior = readPrivateJson(path);
    if (Object.keys(payload).some(key => prior[key] !== payload[key])) {
      throw new Error('message_id already belongs to a different message.');
    }
    return { ...prior, duplicate: true };
  }
  return { ...message, duplicate: false };
}
