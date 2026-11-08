import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (path.endsWith('.mjs')) {
      const r = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' });
      if (r.status !== 0) process.exit(r.status || 1);
    }
  }
}
walk('plugins/claude-codex-link/scripts');
