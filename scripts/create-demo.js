// Optional, generated fixtures only. Never writes into a user's configured media roots.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { ProcessRunner } from '../server/process.js';
const project = fileURLToPath(new URL('../', import.meta.url));
const base = path.join(project, '.demo');
await fs.mkdir(path.join(base, 'media', '山野与日常'), { recursive: true });
await fs.mkdir(path.join(base, 'media', '影片片段'), { recursive: true });
await fs.mkdir(path.join(base, 'notes', '空文件夹'), { recursive: true });
const palettes = [ ['#234d64', '#79b9cf', '#d3c5a0'], ['#3f4666', '#d4aab1', '#806c9e'], ['#335e56', '#a3b4a1', '#dfd0af'] ];
for (let i = 0; i < palettes.length; i++) {
  const [dark, light, accent] = palettes[i];
  const svg = `<svg width="1200" height="800" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="${light}"/><stop offset="1" stop-color="${accent}"/></linearGradient></defs><rect width="1200" height="800" fill="url(#sky)"/><circle cx="880" cy="210" r="85" fill="${accent}"/><path d="M0 620 280 250 550 570 800 360 1200 710V800H0Z" fill="${dark}" opacity=".7"/><path d="M0 740 380 510 660 720 1010 480 1200 630V800H0Z" fill="${dark}"/><path d="M0 770Q400 640 680 780T1200 730V800H0Z" fill="${light}" opacity=".3"/></svg>`;
  const image = sharp(Buffer.from(svg)).jpeg({ quality: 90 });
  await image.toFile(path.join(base, 'media', '山野与日常', i === 0 ? 'cover.jpg' : `山色 ${i + 1} 中文.jpg`));
}
await fs.writeFile(path.join(base, 'notes', '欢迎阅读.md'), '# 你的本地媒体库\n\n这是可删除的演示文件，不包含私人媒体。\n\n图片、视频与文字，都留在本地。\n<script>alert("文本不会执行")</script>\n', 'utf8');
await fs.writeFile(path.join(base, 'notes', '中文 & 空格 100%.txt'), '中文、空格、&、% 文件名均可正常读取。\n');
const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg';
const ffprobe = process.env.FFPROBE_PATH ?? 'ffprobe';
const runner = new ProcessRunner();
try {
  await runner.run(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '90', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '32', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', '-y', path.join(base, 'media', '影片片段', '播放与手势测试.mp4')], 60000);
  console.log('已生成 90 秒 H.264/AAC 测试视频。');
} catch { console.warn('FFmpeg 不可用，跳过演示视频；请安装后重新运行 npm run demo。'); }
finally { runner.close(); }
const config = { host: '127.0.0.1', port: 8090, roots: [{ id: 'demo-media', name: '影像收藏', path: '.demo/media' }, { id: 'demo-notes', name: '文字与笔记', path: '.demo/notes' }], cacheDir: '.cache', ffmpegPath: ffmpeg, ffprobePath: ffprobe };
await fs.writeFile(path.join(project, 'config.demo.json'), JSON.stringify(config, null, 2));
console.log('演示资料已准备好。运行 npm run start:demo。正式目录仍在 config.json 配置。');
