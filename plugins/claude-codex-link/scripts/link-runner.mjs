import { uptime } from 'node:os';
import { LINK_DIR, loadMessage, saveState } from './link.mjs';
import { sendAntigravity } from './antigravity.mjs';
import { address, queueCodex, sendClaude } from './transports.mjs';

const id = process.argv[2];
const base = { pid: process.pid, boot_started_at: Date.now() - uptime() * 1000 };
try {
  const message = loadMessage(id);
  saveState(id, { ...base, status: 'sending' });
  let result;
  const { provider } = address(message.to);
  if (provider === 'claude') result = await sendClaude(message);
  else if (provider === 'antigravity') result = await sendAntigravity(LINK_DIR, message);
  else {
    if (message.delivery === 'live') throw Object.assign(new Error('Live Codex transport is not connected. No message was queued; choose queue explicitly if delayed delivery is acceptable.'), { notSent: true });
    result = await queueCodex(message);
  }
  saveState(id, { ...base, ...result, completed_at: new Date().toISOString() });
} catch (error) {
  saveState(id, { ...base, status: error.notSent ? 'failed' : 'unknown', error: error.message, completed_at: new Date().toISOString() });
}
