import { spawn } from 'node:child_process';
import { HttpError } from './errors.js';

export class ProcessRunner {
  constructor() { this.children = new Set(); this.closed = false; }
  run(command, args, timeout = 20000, maxOutput = 1024 * 1024) {
    if (this.closed) return Promise.reject(new HttpError(503, '服务正在停止。'));
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
      this.children.add(child);
      let stdout = '', stderr = '', bytes = 0, timedOut = false;
      const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
      const capture = (chunk, isError) => {
        bytes += chunk.length;
        if (bytes > maxOutput) { child.kill(); return; }
        if (isError) stderr += chunk.toString(); else stdout += chunk.toString();
      };
      child.stdout.on('data', b => capture(b, false)); child.stderr.on('data', b => capture(b, true));
      const done = () => { clearTimeout(timer); this.children.delete(child); };
      child.on('error', e => { done(); reject(e); });
      child.on('close', code => { done(); if (code === 0 && !timedOut && bytes <= maxOutput) resolve(stdout); else reject(new Error(timedOut ? '媒体处理超时' : `媒体处理失败 (${code}) ${stderr.slice(-300)}`)); });
    });
  }
  close() { this.closed = true; for (const child of this.children) child.kill(); }
}
