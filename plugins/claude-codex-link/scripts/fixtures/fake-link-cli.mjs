#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
const args = process.argv.slice(2);
const claudeId = '11111111-1111-4111-8111-111111111111';
const record = value => appendFileSync(process.env.LINK_TEST_DELIVERIES, JSON.stringify(value) + '\n');
if (args[0] === 'agents') {
  const session = { sessionId: claudeId, name: 'link-fixture', cwd: '/tmp', status: 'idle' };
  console.log(JSON.stringify(process.env.LINK_TEST_MODE === 'ambiguous' ? [session, { ...session, sessionId: '22222222-2222-4222-8222-222222222222' }] : [session]));
} else if (args[0] === '-p') {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const data = JSON.parse(input);
  record({ transport: 'claude', args, body: data.message });
  console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool-1', name: 'SendMessage', input: { recipient: data.recipient_name, content: data.message } }] } }));
  console.log(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: JSON.stringify({ success: true, msg_id: 'accepted-1' }) }] } }));
  console.log(JSON.stringify({ type: 'result', modelUsage: { 'claude-opus-5-5': {} }, result: 'sent' }));
} else {
  for await (const line of createInterface({ input: process.stdin })) {
    const m = JSON.parse(line);
    if (m.id === undefined) continue;
    let result = {};
    if (m.method === 'thread/read') result = { thread: { id: m.params.threadId } };
    if (m.method === 'thread/list') result = { data: [{ id: claudeId, name: 'test', cwd: '/tmp', status: { type: 'notLoaded' } }], nextCursor: null };
    if (m.method === 'thread/queue/add') {
      if (process.env.LINK_TEST_MODE === 'archived') {
        console.log(JSON.stringify({ id: m.id, error: { code: -32600, message: 'Session is archived.' } })); continue;
      }
      record({ transport: 'codex', ...m.params });
      if (process.env.LINK_TEST_MODE === 'disconnect') process.exit(0);
      result = { queuedSubmission: { id: m.params.clientUserMessageId } };
    }
    console.log(JSON.stringify({ id: m.id, result }));
  }
}
