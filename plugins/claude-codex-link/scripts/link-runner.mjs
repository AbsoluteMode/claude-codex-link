import { uptime } from 'node:os';
import { loadMessage, saveState } from './link.mjs';
import { address, queueCodex, sendClaude } from './transports.mjs';

const id = process.argv[2];
const base = { pid: process.pid, boot_started_at: Date.now() - uptime() * 1000 };
try {
  const message = loadMessage(id);
  saveState(id, { ...base, status: 'sending' });
  let result;
  if (address(message.to).provider === 'claude') result = await sendClaude(message);
  else {
    if (message.delivery === 'live') throw Object.assign(new Error('Live Codex transport is not connected. No message was queued; choose queue explicitly if delayed delivery is acceptable.'), { notSent: true });
    result = await queueCodex(message);
  }
  saveState(id, { ...base, ...result, completed_at: new Date().toISOString() });
} catch (error) {
  saveState(id, { ...base, status: error.notSent ? 'failed' : 'unknown', error: error.message, completed_at: new Date().toISOString() });
}
