import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { normalizeConfig } from '../server/config.js';
import { createApp } from '../server/app.js';
import { ProcessRunner } from '../server/process.js';

export async function fixture({ lan = false, passwordHash = '', video = false } = {}) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'local-frame-test-'));
  const media = path.join(temp, 'media'), notes = path.join(temp, 'notes'), outside = path.join(temp, 'media-private');
  for (const dir of [media, notes, outside, path.join(media, '空文件夹'), path.join(media, '相册')]) await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(outside, 'secret.txt'), 'private-secret');
  await fs.writeFile(path.join(notes, '中文 & 空格 # 100%.txt'), '<script>globalThis.PREVIEW_PWNED=true</script>\n你好');
  await fs.writeFile(path.join(notes, 'large.log'), '文'.repeat(500000));
  await fs.writeFile(path.join(notes, 'empty.txt'), '');
  for (const name of ['file10.txt', 'file2.txt', 'file1.txt']) await fs.writeFile(path.join(media, name), name);
  const image = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#538baf' } }).png().toBuffer();
  await fs.writeFile(path.join(media, '相册', 'cover.png'), image);
  await fs.writeFile(path.join(media, '相册', '图片 2.png'), image);
  await fs.writeFile(path.join(media, '相册', '图片 10.png'), image);
  await fs.writeFile(path.join(media, 'sample.mp4'), Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz'));
  await fs.writeFile(path.join(media, 'unknown.html'), '<script>alert(1)</script>');
  const config = normalizeConfig({ host: lan ? '0.0.0.0' : '127.0.0.1', lan: { enabled: lan, passwordHash }, roots: [{ id: 'media', name: '媒体', path: media }, { id: 'notes', name: '文字', path: notes }], cacheDir: path.join(temp, '.cache'), ffmpegPath: process.env.FFMPEG_PATH ?? 'ffmpeg', ffprobePath: process.env.FFPROBE_PATH ?? 'ffprobe' }, temp);
  let hasVideo = false;
  if (video) {
    const runner = new ProcessRunner();
    try {
      await runner.run(config.ffmpegPath, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=12', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '90', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '38', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', '-y', path.join(media, 'valid.mp4')], 60000);
      await fs.copyFile(path.join(media, 'valid.mp4'), path.join(media, 'valid2.mp4')); hasVideo = true;
    } catch { /* Tests that require real codecs explicitly skip when FFmpeg is missing. */ }
    finally { runner.close(); }
  }
  const service = await createApp(config, { logger: { error() {} } });
  const server = await new Promise((resolve, reject) => { const s = service.app.listen(0, '127.0.0.1', () => resolve(s)); s.on('error', reject); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (endpoint, root = 'media', relative = '', options = {}) => fetch(`${base}/api/${endpoint}?${new URLSearchParams({ root, path: relative })}`, options);
  return { temp, media, notes, outside, config, service, server, base, request, hasVideo,
    async close() { service.close(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); await fs.rm(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); }
  };
}
