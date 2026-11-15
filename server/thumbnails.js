import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { fileType } from './files.js';
import { WorkQueue } from './queue.js';
import { ProcessRunner } from './process.js';
import { HttpError } from './errors.js';
import { inside } from './config.js';

sharp.cache({ memory: 32, files: 0, items: 32 });
sharp.concurrency(1);
export class Thumbnails {
  constructor(config, library, logger = console) {
    this.config = config; this.library = library; this.logger = logger;
    this.queue = new WorkQueue(config.thumbnail.concurrency, config.thumbnail.maxQueue);
    this.runner = new ProcessRunner(); this.inflight = new Map(); this.failed = new Map(); this.generated = 0;
  }
  async init() {
    await fs.mkdir(this.config.cacheDir, { recursive: true });
    const cacheReal = await fs.realpath(this.config.cacheDir);
    for (const root of this.config.roots) {
      let real;
      try { real = await fs.realpath(root.path); } catch { continue; }
      if (inside(real, cacheReal) || inside(cacheReal, real)) throw new Error('真实缓存目录与媒体目录重叠，请检查 Junction/符号链接配置。');
    }
    this.config.cacheDir = cacheReal;
    await this.prune();
  }
  key(item) {
    return crypto.createHash('sha256').update(JSON.stringify([3, item.real, item.stat.size, item.stat.mtimeMs, item.stat.ctimeMs, this.config.thumbnail.width])).digest('hex');
  }
  async exists(file) { try { return (await fs.stat(file)).size > 0; } catch { return false; } }
  async cached(item, suffix, produce) {
    const key = `${this.key(item)}${suffix}`, output = path.join(this.config.cacheDir, key);
    if (await this.exists(output)) return { file: output, key, cached: true };
    if (this.failed.has(key) && Date.now() - this.failed.get(key) < 60000) throw new HttpError(422, '此文件暂时无法生成预览。');
    if (this.inflight.has(key)) return this.inflight.get(key);
    const pending = this.queue.run(async () => {
      const temp = `${output}.${crypto.randomBytes(6).toString('hex')}.tmp${suffix}`;
      try {
        // Reauthorize immediately before any processor opens the source.
        const checked = await this.library.resolve(item.root.id, item.relative);
        if (this.key(checked) !== this.key(item)) throw new HttpError(409, '文件已变更，请重试。');
        await produce(temp, checked);
        await fs.rename(temp, output);
        if (++this.generated % 32 === 0) await this.prune();
        return { file: output, key, cached: false };
      } catch (e) {
        if (!(e instanceof HttpError)) this.logger.warn?.(`[${new Date().toISOString()}] 预览失败 ${item.root.id}/${item.relative}: ${e.message}`);
        if (!(e instanceof HttpError) || e.status !== 503) {
          if (this.failed.size > 256) this.failed.delete(this.failed.keys().next().value);
          this.failed.set(key, Date.now());
        }
        throw e instanceof HttpError ? e : new HttpError(422, '预览生成失败。请检查文件、FFmpeg 安装或查看服务日志。');
      } finally { await fs.unlink(temp).catch(() => {}); }
    });
    this.inflight.set(key, pending);
    try { return await pending; } finally { this.inflight.delete(key); }
  }
  async probe(item) {
    const output = await this.runner.run(this.config.ffprobePath, ['-v', 'error', '-protocol_whitelist', 'file', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height', '-of', 'json', item.real], this.config.thumbnail.timeoutMs);
    const info = JSON.parse(output), video = info.streams?.find(s => s.codec_type === 'video');
    return { duration: Number(info.format?.duration) || null, width: video?.width ?? null, height: video?.height ?? null, videoCodec: video?.codec_name ?? null, audioCodec: info.streams?.find(s => s.codec_type === 'audio')?.codec_name ?? null };
  }
  async metadata(root, relative) {
    const item = await this.library.resolve(root, relative);
    if (!item.stat.isFile() || fileType(item.real) !== 'video') throw new HttpError(400, '此文件不是视频。');
    const result = await this.cached(item, '.json', async (temp, source) => fs.writeFile(temp, JSON.stringify(await this.probe(source))));
    return JSON.parse(await fs.readFile(result.file, 'utf8'));
  }
  async thumbnail(root, relative) {
    const item = await this.library.resolve(root, relative);
    if (item.stat.isDirectory()) {
      for (const candidate of await this.library.coverCandidates(root, relative)) {
        try { return await this.thumbnail(root, candidate.path); }
        catch (e) { if ([503, 409].includes(e.status)) throw e; }
      }
      throw new HttpError(404, '文件夹暂无可用封面。');
    }
    const type = fileType(item.real);
    if (!['image', 'video'].includes(type)) throw new HttpError(400, '此文件没有缩略图。');
    return this.cached(item, '.webp', async (temp, source) => {
      if (type === 'image') {
        await sharp(source.real, { animated: false, limitInputPixels: 100000000, failOn: 'error' }).rotate().resize({ width: this.config.thumbnail.width, withoutEnlargement: true }).webp({ quality: 76 }).timeout({ seconds: Math.ceil(this.config.thumbnail.timeoutMs / 1000) }).toFile(temp);
      } else {
        const args = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-threads', '1', '-filter_threads', '1', '-protocol_whitelist', 'file'];
        const tail = ['-i', source.real, '-frames:v', '1', '-vf', `scale=${this.config.thumbnail.width}:-2`, '-an', '-threads', '1', '-y', temp];
        await this.runner.run(this.config.ffmpegPath, [...args, '-ss', '1', ...tail], this.config.thumbnail.timeoutMs);
        if (!(await this.exists(temp))) await this.runner.run(this.config.ffmpegPath, [...args, '-ss', '0', ...tail], this.config.thumbnail.timeoutMs);
        if (!(await this.exists(temp))) throw new Error('没有可用的视频帧');
      }
    });
  }
  async prune() {
    const entries = await fs.readdir(this.config.cacheDir, { withFileTypes: true });
    const files = [];
    for (const e of entries) {
      if (!e.isFile() || !/^[a-f0-9]{64}\.(webp|json)$/.test(e.name)) continue;
      const filename = path.join(this.config.cacheDir, e.name);
      const stat = await fs.stat(filename).catch(() => null);
      if (stat) files.push({ filename, size: stat.size, mtime: stat.mtimeMs });
    }
    let total = files.reduce((sum, f) => sum + f.size, 0);
    const max = this.config.thumbnail.maxCacheMB * 1048576;
    for (const file of files.sort((a, b) => a.mtime - b.mtime)) {
      if (total <= max) break;
      await fs.unlink(file.filename).catch(() => {}); total -= file.size;
    }
  }
  async tools() {
    const result = await Promise.all([this.config.ffmpegPath, this.config.ffprobePath].map(command => this.runner.run(command, ['-version'], 3000).then(() => true, () => false)));
    return { ffmpeg: result[0], ffprobe: result[1] };
  }
  close() { this.queue.close(); this.runner.close(); }
}
