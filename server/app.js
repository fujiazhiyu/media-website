import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import iconv from 'iconv-lite';
import { FileLibrary, fileType } from './files.js';
import { Thumbnails } from './thumbnails.js';
import { HttpError, publicError } from './errors.js';
import { parseRange } from './range.js';
import { Auth } from './auth.js';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const mime = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.ogv': 'video/ogg', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp', '.ico': 'image/x-icon' };
export async function createApp(config, options = {}) {
  const app = express(), library = new FileLibrary(config), thumbs = new Thumbnails(config, library, options.logger ?? console), auth = new Auth(config);
  await thumbs.init();
  let activeStreams = 0;
  let toolStatus;
  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Cross-Origin-Resource-Policy': 'same-origin', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" });
    // Reject cross-site requests (including DNS rebinding through a foreign Host).
    const host = req.headers.host ?? '';
    if (!config.lan.enabled && !/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)) return res.status(403).json({ error: '不允许的访问主机。' });
    if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: '不允许跨站访问。' });
    if (req.headers.origin && req.headers.origin !== `http://${host}` && req.headers.origin !== `https://${host}`) return res.status(403).json({ error: '不允许跨域访问。' });
    next();
  });
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use(express.json({ limit: '2kb' }));
  app.get('/api/session', (req, res) => res.json({ authenticated: auth.valid(req), lan: config.lan.enabled }));
  app.post('/api/login', (req, res) => auth.login(req, res));
  app.post('/api/logout', (req, res) => auth.logout(req, res));
  app.use('/api', (req, res, next) => auth.valid(req) ? next() : res.status(401).json({ error: '请先输入局域网访问密码。' }));
  app.get('/api/roots', async (_req, res) => res.json({ roots: await library.roots() }));
  app.get('/api/status', async (_req, res) => {
    toolStatus ??= thumbs.tools();
    res.json({ ...(await toolStatus), lan: config.lan.enabled, thumbnailConcurrency: config.thumbnail.concurrency });
  });
  app.get('/api/list', async (req, res) => res.json(await library.list(req.query.root, req.query.path, req.query.refresh === '1')));
  app.get('/api/metadata', async (req, res) => res.json(await thumbs.metadata(req.query.root, req.query.path)));
  app.get('/api/thumbnail', async (req, res) => {
    const result = await thumbs.thumbnail(req.query.root, req.query.path);
    // Revalidate each browser visit so replacing a cover cannot leave a stale thumbnail.
    res.set({ 'Cache-Control': 'private, no-cache', ETag: `"${result.key}"`, 'X-Thumbnail-Cache': result.cached ? 'HIT' : 'MISS' });
    if (req.headers['if-none-match'] === `"${result.key}"`) return res.status(304).end();
    res.type('webp').sendFile(result.file, { cacheControl: false, lastModified: false, dotfiles: 'allow' }, e => { if (e && !res.headersSent) res.status(404).end(); });
  });
  app.get('/api/text', async (req, res) => {
    const item = await library.resolve(req.query.root, req.query.path);
    if (!item.stat.isFile() || fileType(item.relative) !== 'text') throw new HttpError(415, '此类型不支持文本预览，请下载原文件。');
    const handle = await fs.open(item.real, 'r');
    try {
      const stat = await handle.stat(), length = Math.min(stat.size, config.textPreviewBytes);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, 0);
      const bytes = buffer.subarray(0, bytesRead);
      let encoding = 'utf-8', content;
      if (bytes[0] === 0xff && bytes[1] === 0xfe) { encoding = 'utf-16le'; content = iconv.decode(bytes, encoding); }
      else if (bytes[0] === 0xfe && bytes[1] === 0xff) { encoding = 'utf-16be'; content = iconv.decode(bytes, encoding); }
      else {
        try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: stat.size > length }); }
        catch { encoding = 'gb18030'; content = iconv.decode(bytes, encoding); }
      }
      res.json({ content, encoding, truncated: stat.size > bytesRead, previewBytes: bytesRead, size: stat.size });
    } finally { await handle.close(); }
  });
  const serveFile = async (req, res) => {
    const item = await library.resolve(req.query.root, req.query.path);
    if (!item.stat.isFile()) throw new HttpError(400, '请选择文件。');
    const download = req.path === '/api/download';
    if (!download && !mime[path.extname(item.relative).toLowerCase()]) throw new HttpError(415, '此文件只能下载。');
    if (activeStreams >= config.maxStreams) throw new HttpError(503, '同时读取的文件过多，请稍后重试。');
    activeStreams++;
    let handle, streaming = false;
    let released = false;
    const release = () => { if (!released) { released = true; activeStreams--; } };
    try {
      handle = await fs.open(item.real, 'r');
      const stat = await handle.stat();
      if (res.destroyed) return;
      const etag = `"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`;
      const rangeHeader = req.headers['if-range'] && req.headers['if-range'] !== etag ? null : req.headers.range;
      // RFC 9110: Range applies to GET; HEAD returns full representation headers.
      const range = req.method === 'HEAD' ? null : parseRange(rangeHeader, stat.size);
      res.set({ 'Accept-Ranges': 'bytes', ETag: etag, 'Last-Modified': stat.mtime.toUTCString(), 'Cache-Control': 'private, no-cache' });
      if (range === false) { res.set('Content-Range', `bytes */${stat.size}`); res.status(416).end(); return; }
      if (download) res.attachment(path.basename(item.relative));
      res.set('Content-Type', download ? 'application/octet-stream' : mime[path.extname(item.relative).toLowerCase()]);
      const start = range?.start ?? 0, end = range?.end ?? stat.size - 1;
      res.status(range ? 206 : 200).set('Content-Length', String(Math.max(0, end - start + 1)));
      if (range) res.set('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      if (req.method === 'HEAD' || stat.size === 0) { res.end(); return; }
      const stream = handle.createReadStream({ start, end, highWaterMark: 64 * 1024, autoClose: true });
      handle = null; streaming = true;
      res.once('close', () => { stream.destroy(); release(); });
      stream.on('error', () => { release(); if (!res.headersSent) res.status(500).end(); else res.destroy(); });
      stream.on('close', release);
      stream.pipe(res);
    } finally { if (handle) await handle.close().catch(() => {}); if (!streaming) release(); }
  };
  app.get('/api/stream', serveFile);
  app.get('/api/download', serveFile);
  app.use(express.static(publicDir, { etag: true, maxAge: 0 }));
  app.use((_req, _res, next) => next(new HttpError(404, '页面不存在。')));
  app.use((error, req, res, _next) => {
    if (res.headersSent) { res.destroy(); return; }
    const safe = error.type === 'entity.parse.failed' ? new HttpError(400, '请求内容不是有效 JSON。') : error.type === 'entity.too.large' ? new HttpError(413, '请求内容过大。') : publicError(error);
    if (safe.status >= 500 && safe.status !== 503) (options.logger ?? console).error(`[${new Date().toISOString()}] ${req.method} ${req.path}: ${error.message}`);
    if (safe.status === 503) res.set('Retry-After', '3');
    res.status(safe.status).json({ error: safe.message });
  });
  return { app, library, thumbs, close: () => thumbs.close() };
}
