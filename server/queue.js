import { HttpError } from './errors.js';
export class WorkQueue {
  constructor(concurrency, maxQueue) { this.concurrency = concurrency; this.maxQueue = maxQueue; this.active = 0; this.pending = []; this.closed = false; }
  run(task) {
    if (this.closed || this.pending.length >= this.maxQueue) return Promise.reject(new HttpError(503, '缩略图队列繁忙，请稍后刷新。'));
    return new Promise((resolve, reject) => { this.pending.push({ task, resolve, reject }); this.pump(); });
  }
  pump() {
    while (!this.closed && this.active < this.concurrency && this.pending.length) {
      const job = this.pending.shift(); this.active++;
      Promise.resolve().then(job.task).then(job.resolve, job.reject).finally(() => { this.active--; this.pump(); });
    }
  }
  close() { this.closed = true; for (const job of this.pending.splice(0)) job.reject(new HttpError(503, '服务正在停止。')); }
}
