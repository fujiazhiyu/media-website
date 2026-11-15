import fs from 'node:fs/promises';
import path from 'node:path';
import { inside } from './config.js';
import { HttpError } from './errors.js';

const images = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.bmp', '.ico']);
const videos = new Set(['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi', '.ogv']);
const texts = new Set(['.txt', '.md', '.json', '.log', '.csv', '.srt', '.yaml', '.yml', '.vtt', '.ini']);
export const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
export function fileType(name) {
  const ext = path.extname(name).toLowerCase();
  return images.has(ext) ? 'image' : videos.has(ext) ? 'video' : texts.has(ext) ? 'text' : 'file';
}
export function relativeInput(value = '') {
  if (typeof value !== 'string' || value.length > 4096 || /[\x00-\x1f\x7f:]/.test(value) || path.win32.isAbsolute(value) || path.posix.isAbsolute(value)) throw new HttpError(400, '无效的相对路径。');
  const rel = value.replaceAll('\\', '/');
  if (rel.split('/').some(p => p === '..' || p === '.' || /[. ]$/.test(p))) throw new HttpError(403, '此路径不在允许访问的目录内。');
  return rel;
}
export class FileLibrary {
  constructor(config) { this.config = config; this.cache = new Map(); }
  async resolve(rootId, value = '') {
    if (typeof rootId !== 'string') throw new HttpError(400, '请选择媒体库。');
    const root = this.config.roots.find(r => r.id === rootId);
    if (!root) throw new HttpError(404, '媒体库未配置。');
    const relative = relativeInput(value);
    const rootReal = await fs.realpath(root.path);
    const requested = path.resolve(rootReal, relative);
    if (!inside(rootReal, requested)) throw new HttpError(403, '此路径不在允许访问的目录内。');
    const real = await fs.realpath(requested);
    if (!inside(rootReal, real)) throw new HttpError(403, '链接目标不在允许访问的目录内。');
    const stat = await fs.stat(real);
    if (!stat.isFile() && !stat.isDirectory()) throw new HttpError(403, '不支持读取此文件类型。');
    return { root, rootReal, relative, real, stat };
  }
  async roots() {
    return Promise.all(this.config.roots.map(async ({ id, name }) => {
      try { const r = await this.resolve(id); return { id, name, available: r.stat.isDirectory() }; }
      catch { return { id, name, available: false }; }
    }));
  }
  async list(rootId, value = '', refresh = false) {
    const dir = await this.resolve(rootId, value);
    if (!dir.stat.isDirectory()) throw new HttpError(400, '此路径不是文件夹。');
    const key = `${rootId}:${dir.relative}`;
    const cached = this.cache.get(key);
    if (!refresh && cached && Date.now() - cached.at < this.config.directoryCacheMs && cached.mtime === dir.stat.mtimeMs) return cached.data;
    const entries = await fs.readdir(dir.real, { withFileTypes: true });
    const items = [];
    let cursor = 0, unreadable = 0;
    // Bounded stat/realpath work keeps a directory with hundreds of files responsive.
    await Promise.all(Array.from({ length: Math.min(16, entries.length) }, async () => {
      while (cursor < entries.length) {
        const entry = entries[cursor++];
        const relative = [dir.relative, entry.name].filter(Boolean).join('/');
        try {
          const item = await this.resolve(rootId, relative);
          items.push({ name: entry.name, path: relative, type: item.stat.isDirectory() ? 'folder' : fileType(entry.name), size: item.stat.isFile() ? item.stat.size : null, modified: item.stat.mtime.toISOString() });
        } catch { unreadable++; }
      }
    }));
    items.sort((a, b) => Number(b.type === 'folder') - Number(a.type === 'folder') || collator.compare(a.name, b.name));
    const data = { root: rootId, path: dir.relative, items, unreadable };
    if (this.cache.size >= 64) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, { at: Date.now(), mtime: dir.stat.mtimeMs, data });
    return data;
  }
  async coverCandidates(rootId, relative) {
    const list = await this.list(rootId, relative);
    const media = list.items.filter(i => i.type === 'image' || i.type === 'video');
    return [...media.filter(i => /^cover\.(jpg|png)$/i.test(i.name)), ...media.filter(i => !/^cover\.(jpg|png)$/i.test(i.name))].slice(0, 12);
  }
}
