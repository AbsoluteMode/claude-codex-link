import { randomUUID } from 'node:crypto';
import { linkSync, lstatSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';

export function readPrivateJson(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Expected a regular private message file.');
  return JSON.parse(readFileSync(path, 'utf8'));
}
// Publish an immutable, complete record atomically. Only the winner may send.
export function createRecord(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx' });
  try { linkSync(temporary, path); } finally { unlinkSync(temporary); }
}
