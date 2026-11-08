import { spawn } from 'node:child_process';

// JSONL transport shared by the documented Codex app-server and stdio MCP.
export class RpcClient {
  constructor(command, args, options = {}) {
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    this.closed = false;
    this.child = spawn(command, args, { ...options, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.resume(); // Diagnostics may include local configuration; never log them.
    this.child.stdin.on('error', () => {});
    this.child.once('error', () => this.fail('Transport could not start.'));
    this.child.once('exit', () => this.fail('Transport disconnected.'));
    this.child.stdout.on('data', chunk => {
      this.buffer += chunk;
      if (this.buffer.length > 8 * 1024 * 1024) return this.close('Transport output exceeded its limit.');
      let end;
      while ((end = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 1);
        if (!line.trim()) continue;
        let message;
        try { message = JSON.parse(line); } catch { return this.close('Invalid transport response.'); }
        if (message.method) {
          // Never mistake a server request (including an approval request) for
          // a response. This client does not grant permissions on its caller's behalf.
          if (message.id !== undefined) this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Client method not supported.' } }) + '\n');
          continue;
        }
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(Object.assign(new Error(message.error.message || 'Transport request failed.'), { rejected: true }));
        else pending.resolve(message.result);
      }
    });
  }
  fail(message) {
    this.closed = true;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error(message)); }
    this.pending.clear();
  }
  notify(method, params = {}) {
    if (this.closed) throw new Error('Transport is closed.');
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }
  request(method, params = {}, timeoutMs = 30_000) {
    if (this.closed) return Promise.reject(new Error('Transport is closed.'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Transport acknowledgement timed out; delivery may have occurred.'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  close(message = 'Transport closed.') {
    this.fail(message);
    this.child.stdin.end();
    this.child.kill('SIGTERM');
  }
}
