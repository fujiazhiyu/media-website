import fs from 'node:fs/promises';
import path from 'node:path';

export function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function integer(value, fallback, min, max, name) {
  const n = value ?? fallback;
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} 必须是 ${min}–${max} 之间的整数。`);
  return n;
}
export function normalizeConfig(input = {}, baseDir = process.cwd()) {
  const lan = { enabled: false, passwordHash: '', sessionHours: 12, ...input.lan };
  if (typeof lan.enabled !== 'boolean') throw new Error('lan.enabled 必须为布尔值。');
  const host = input.host ?? '127.0.0.1';
  if (lan.enabled ? host !== '0.0.0.0' : host !== '127.0.0.1') throw new Error('本地模式 host 必须为 127.0.0.1；局域网模式必须显式设为 0.0.0.0。');
  if (lan.enabled && !/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(lan.passwordHash)) throw new Error('局域网模式需要有效的密码哈希。请先运行 npm run password。');
  lan.sessionHours = integer(lan.sessionHours, 12, 1, 168, 'lan.sessionHours');
  if (!Array.isArray(input.roots ?? [])) throw new Error('roots 必须是数组。');
  const ids = new Set();
  const roots = (input.roots ?? []).map(root => {
    if (!root || !/^[a-zA-Z0-9_-]{1,64}$/.test(root.id) || ids.has(root.id) || typeof root.name !== 'string' || !root.name.trim() || typeof root.path !== 'string' || !root.path.trim()) throw new Error('每个根目录需要唯一的字母数字 id、name 和 path。');
    ids.add(root.id);
    return { id: root.id, name: root.name, path: path.resolve(baseDir, root.path) };
  });
  const cacheDir = path.resolve(baseDir, input.cacheDir ?? '.cache');
  for (const root of roots) if (inside(root.path, cacheDir) || inside(cacheDir, root.path)) throw new Error('缓存目录与媒体根目录必须相互独立。');
  const t = input.thumbnail ?? {};
  return {
    host, port: integer(input.port, 8090, 1, 65535, 'port'), lan, roots, cacheDir,
    ffmpegPath: input.ffmpegPath ?? 'ffmpeg', ffprobePath: input.ffprobePath ?? 'ffprobe',
    textPreviewBytes: integer(input.textPreviewBytes, 1048576, 1024, 4 * 1048576, 'textPreviewBytes'),
    directoryCacheMs: integer(input.directoryCacheMs, 2000, 0, 30000, 'directoryCacheMs'),
    maxStreams: integer(input.maxStreams, 32, 2, 256, 'maxStreams'),
    thumbnail: {
      width: integer(t.width, 320, 80, 640, 'thumbnail.width'),
      concurrency: integer(t.concurrency, 2, 1, 4, 'thumbnail.concurrency'),
      maxQueue: integer(t.maxQueue, 128, 4, 512, 'thumbnail.maxQueue'),
      timeoutMs: integer(t.timeoutMs, 20000, 1000, 60000, 'thumbnail.timeoutMs'),
      maxCacheMB: integer(t.maxCacheMB, 1024, 16, 102400, 'thumbnail.maxCacheMB')
    }
  };
}
export async function loadConfig(filename) {
  try { return normalizeConfig(JSON.parse((await fs.readFile(filename, 'utf8')).replace(/^\uFEFF/, '')), path.dirname(filename)); }
  catch (e) {
    if (e.code === 'ENOENT') {
      console.warn('未找到 config.json，以本地空媒体库启动。请复制 config.example.json 并配置目录后重启。');
      return normalizeConfig({}, path.dirname(filename));
    }
    throw e;
  }
}
