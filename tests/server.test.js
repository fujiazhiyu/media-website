import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import iconv from 'iconv-lite';
import { fixture } from './fixtures.js';
import { normalizeConfig, inside } from '../server/config.js';
import { parseRange } from '../server/range.js';
import { hashPassword } from '../server/auth.js';
import { Thumbnails } from '../server/thumbnails.js';

test('配置默认仅监听本机，局域网必须显式开启且配置哈希', () => {
  const c = normalizeConfig(); assert.equal(c.host, '127.0.0.1'); assert.equal(c.port, 8090); assert.equal(c.lan.enabled, false);
  assert.throws(() => normalizeConfig({ host: '0.0.0.0' }));
  assert.throws(() => normalizeConfig({ host: '0.0.0.0', lan: { enabled: true } }));
  assert.throws(() => normalizeConfig({ roots: [{ id: 'x', name: 'a', path: '.' }], cacheDir: '.cache' }));
  assert.equal(inside(path.resolve('media'), path.resolve('media-private')), false);
  if (process.platform === 'win32') { assert.equal(inside('D:\\Media', 'd:\\MEDIA\\sub'), true); assert.equal(inside('D:\\Media', 'E:\\Media'), false); }
});
test('Range 解析处理首尾、无效值和大文件偏移', () => {
  assert.deepEqual(parseRange('bytes=2-4', 10), { start: 2, end: 4 });
  assert.deepEqual(parseRange('bytes=-3', 10), { start: 7, end: 9 });
  assert.deepEqual(parseRange('bytes=8-999', 10), { start: 8, end: 9 });
  assert.deepEqual(parseRange('bytes=4294967296-', 5368709120), { start: 4294967296, end: 5368709119 });
  for (const value of ['bytes=10-', 'bytes=5-2', 'bytes=-0', 'bytes=0-1,3-4', 'bytes=-', 'items=0-1', 'bytes=99999999999999999-']) assert.equal(parseRange(value, 10), false, value);
});
test('文件 API / 安全 / 文本 / 缓存集成', async t => {
  const f = await fixture(); t.after(() => f.close());
  await t.test('首页可用、两个根目录不泄露绝对路径', async () => {
    const home = await fetch(f.base); assert.equal(home.status, 200); assert.match(await home.text(), /帧间/);
    const r = await f.request('roots'), text = await r.text(); assert.equal(r.status, 200); assert.equal(JSON.parse(text).roots.length, 2); assert.ok(!text.includes(f.temp));
  });
  await t.test('空目录、中文特殊文件名和自然排序', async () => {
    assert.deepEqual((await (await f.request('list', 'media', '空文件夹')).json()).items, []);
    const list = await (await f.request('list')).json();
    assert.equal(list.items[0].type, 'folder');
    assert.deepEqual(list.items.filter(i => i.name.startsWith('file')).map(i => i.name), ['file1.txt', 'file2.txt', 'file10.txt']);
    const r = await f.request('text', 'notes', '中文 & 空格 # 100%.txt'); assert.equal(r.status, 200); assert.match((await r.json()).content, /你好/);
    assert.equal((await f.request('list', 'media', 'missing')).status, 404);
  });
  await t.test('目录越界、盘符、编码、Windows ADS 和未配置根被拦截', async () => {
    for (const endpoint of ['list', 'stream', 'download', 'text', 'thumbnail', 'metadata']) {
      for (const input of ['../media-private/secret.txt', '..\\media-private\\secret.txt', '/etc/passwd', 'C:\\Windows\\win.ini', 'D:secret', '\\\\localhost\\c$\\Windows', 'a/../../secret.txt', 'a\0b', 'sample.mp4:secret']) {
        const r = await f.request(endpoint, 'media', input); assert.ok([400, 403, 404].includes(r.status), `${endpoint} ${input} => ${r.status}`);
      }
      assert.equal((await f.request(endpoint, 'unknown', '')).status, 404);
    }
    for (const value of ['%2e%2e%2fmedia-private%2fsecret.txt', '%252e%252e%252fmedia-private%252fsecret.txt', '..%5cmedia-private%5csecret.txt']) {
      const r = await fetch(`${f.base}/api/text?root=media&path=${value}`); assert.ok([400, 403, 404].includes(r.status)); assert.ok(!(await r.text()).includes('private-secret'));
    }
    assert.equal((await fetch(`${f.base}/api/list?root=media&path=a&path=b`)).status, 400);
  });
  await t.test('Windows Junction / 符号链接越界与内部链接', async () => {
    const outsideLink = path.join(f.media, 'outside-link');
    await fs.symlink(f.outside, outsideLink, process.platform === 'win32' ? 'junction' : 'dir');
    for (const endpoint of ['list', 'stream', 'download', 'thumbnail', 'text', 'metadata']) {
      assert.equal((await f.request(endpoint, 'media', endpoint === 'list' ? 'outside-link' : 'outside-link/secret.txt')).status, 403);
    }
    const list = await (await f.request('list', 'media', '', { headers: { 'Cache-Control': 'no-cache' } })).json();
    assert.ok(!list.items.some(i => i.name === 'outside-link'));
    await fs.symlink(path.join(f.media, '相册'), path.join(f.media, 'inside-link'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal((await f.request('stream', 'media', 'inside-link/cover.png')).status, 200);
  });
  await t.test('文本安全、1 MiB 截断、GB18030 和 UTF16 BOM', async () => {
    const r = await f.request('text', 'notes', '中文 & 空格 # 100%.txt');
    assert.match(r.headers.get('content-type'), /application\/json/); assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match((await r.json()).content, /<script>/);
    const large = await (await f.request('text', 'notes', 'large.log')).json(); assert.equal(large.truncated, true); assert.equal(large.previewBytes, 1048576); assert.equal(large.encoding, 'utf-8');
    await fs.writeFile(path.join(f.notes, 'gbk.txt'), iconv.encode('常见中文编码兼容', 'gb18030'));
    const gbk = await (await f.request('text', 'notes', 'gbk.txt')).json(); assert.equal(gbk.encoding, 'gb18030'); assert.equal(gbk.content, '常见中文编码兼容');
    await fs.writeFile(path.join(f.notes, 'utf16.txt'), iconv.encode('中文 Unicode', 'utf16le', { addBOM: true }));
    assert.equal((await (await f.request('text', 'notes', 'utf16.txt')).json()).content, '中文 Unicode');
    assert.equal((await f.request('stream', 'media', 'unknown.html')).status, 415);
    const download = await f.request('download', 'media', 'unknown.html'); assert.equal(download.status, 200); assert.match(download.headers.get('content-disposition'), /^attachment/); assert.equal(download.headers.get('content-type'), 'application/octet-stream');
  });
  await t.test('HTTP 206 / 416 / HEAD / If-Range / suffix', async () => {
    const r = await f.request('stream', 'media', 'sample.mp4', { headers: { Range: 'bytes=2-5' } });
    assert.equal(r.status, 206); assert.equal(r.headers.get('content-range'), 'bytes 2-5/36'); assert.equal(r.headers.get('accept-ranges'), 'bytes'); assert.equal(r.headers.get('content-length'), '4'); assert.equal(await r.text(), '2345');
    for (const range of ['bytes=36-', 'bytes=5-2', 'bytes=0-1,3-4', 'bytes=-0', 'broken']) { const bad = await f.request('stream', 'media', 'sample.mp4', { headers: { Range: range } }); assert.equal(bad.status, 416); assert.equal(bad.headers.get('content-range'), 'bytes */36'); }
    const head = await f.request('stream', 'media', 'sample.mp4', { method: 'HEAD', headers: { Range: 'bytes=2-5' } }); assert.equal(head.status, 200); assert.equal(head.headers.get('content-length'), '36'); assert.equal((await head.arrayBuffer()).byteLength, 0);
    const suffix = await f.request('stream', 'media', 'sample.mp4', { headers: { Range: 'bytes=-3' } }); assert.equal(await suffix.text(), 'xyz');
    const full = await f.request('stream', 'media', 'sample.mp4', { headers: { Range: 'bytes=2-5', 'If-Range': '"old"' } }); assert.equal(full.status, 200); assert.equal((await full.text()).length, 36);
    const empty = await f.request('download', 'notes', 'empty.txt', { headers: { Range: 'bytes=0-' } }); assert.equal(empty.status, 416);
  });
  await t.test('超过 4 GiB 的真实文件按偏移读取，无需完整下载', async () => {
    const file = path.join(f.media, 'huge.mp4'), h = await fs.open(file, 'w');
    const length = 5 * 1024 ** 3;
    await h.truncate(length); await h.write(Buffer.from('tail'), 0, 4, length - 4); await h.close();
    const r = await f.request('stream', 'media', 'huge.mp4', { headers: { Range: `bytes=${length - 4}-` } });
    assert.equal(r.status, 206); assert.equal(r.headers.get('content-range'), `bytes ${length - 4}-${length - 1}/${length}`); assert.equal(await r.text(), 'tail');
    assert.equal((await f.request('stream', 'media', 'huge.mp4', { method: 'HEAD' })).headers.get('content-length'), String(length));
  });
  await t.test('缩略图去重、磁盘命中、304、源文件修改后失效、文件夹封面', async () => {
    const source = '相册/cover.png';
    const responses = await Promise.all(Array.from({ length: 8 }, () => f.request('thumbnail', 'media', source)));
    for (const r of responses) { assert.equal(r.status, 200); await r.arrayBuffer(); }
    const first = await f.request('thumbnail', 'media', source); assert.equal(first.headers.get('x-thumbnail-cache'), 'HIT'); const tag = first.headers.get('etag');
    const meta = await sharp(Buffer.from(await first.arrayBuffer())).metadata(); assert.equal(meta.width, 320); assert.equal(meta.height, 240);
    assert.equal((await f.request('thumbnail', 'media', source, { headers: { 'If-None-Match': tag } })).status, 304);
    const persistent = new Thumbnails(f.config, f.service.library); await persistent.init(); assert.equal((await persistent.thumbnail('media', source)).cached, true); persistent.close();
    await sharp({ create: { width: 400, height: 800, channels: 3, background: '#cc8844' } }).png().toFile(path.join(f.media, source));
    const changed = await f.request('thumbnail', 'media', source, { headers: { 'If-None-Match': tag } }); assert.equal(changed.status, 200); assert.notEqual(changed.headers.get('etag'), tag);
    assert.equal((await f.request('thumbnail', 'media', '相册')).headers.get('etag'), changed.headers.get('etag'));
    assert.equal((await f.request('thumbnail', 'media', '空文件夹')).status, 404);
    assert.equal((await f.request('thumbnail', 'media', 'sample.mp4')).status, 422);
  });
  await t.test('JPEG / PNG / WEBP / GIF 缩略图与源目录只读', async () => {
    const dir = path.join(f.media, 'formats'); await fs.mkdir(dir);
    for (const format of ['jpeg', 'png', 'webp', 'gif']) await sharp({ create: { width: 640, height: 480, channels: 3, background: '#527a9d' } }).toFormat(format).toFile(path.join(dir, `图片.${format}`));
    const beforeNames = await fs.readdir(dir), before = await Promise.all(beforeNames.map(n => fs.stat(path.join(dir, n))));
    for (const name of beforeNames) { const r = await f.request('thumbnail', 'media', `formats/${name}`); assert.equal(r.status, 200); const meta = await sharp(Buffer.from(await r.arrayBuffer())).metadata(); assert.equal(meta.width, 320); assert.equal(meta.height, 240); }
    assert.deepEqual(await fs.readdir(dir), beforeNames);
    const after = await Promise.all(beforeNames.map(n => fs.stat(path.join(dir, n))));
    assert.deepEqual(after.map(s => [s.size, s.mtimeMs, s.ctimeMs]), before.map(s => [s.size, s.mtimeMs, s.ctimeMs]));
  });
  await t.test('跨站与 DNS rebinding 请求被拒绝，服务仍能处理正常请求', async () => {
    assert.equal((await fetch(`${f.base}/api/roots`, { headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await fetch(`${f.base}/api/roots`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    assert.equal((await f.request('roots')).status, 200);
  });
  await t.test('数百文件目录读取、列表缓存与强制刷新', async () => {
    const dir = path.join(f.media, 'many'); await fs.mkdir(dir);
    for (let start = 0; start < 500; start += 25) await Promise.all(Array.from({ length: 25 }, (_, i) => fs.writeFile(path.join(dir, `记录${start + i}.txt`), String(start + i))));
    const first = await (await f.request('list', 'media', 'many')).json(); assert.equal(first.items.length, 500); assert.equal(first.items[2].name, '记录2.txt');
    const cached = await f.service.library.list('media', 'many'); assert.equal(cached, f.service.library.cache.get('media:many').data);
    await fs.writeFile(path.join(dir, '新增.txt'), 'new');
    const refreshed = await (await fetch(`${f.base}/api/list?root=media&path=many&refresh=1`)).json(); assert.equal(refreshed.items.length, 501);
    const invalidRoot = normalizeConfig({ roots: [{ id: 'offline', name: '离线目录', path: path.join(f.temp, 'not-mounted') }], cacheDir: path.join(f.temp, 'other-cache') });
    const { FileLibrary } = await import('../server/files.js'); assert.equal((await new FileLibrary(invalidRoot).roots())[0].available, false);
  });
});
test('局域网登录保护全部媒体 API、密码错误、登录退出与限速', async t => {
  const passwordHash = await hashPassword('test-password-123');
  const f = await fixture({ lan: true, passwordHash }); t.after(() => f.close());
  for (const endpoint of ['roots', 'list', 'thumbnail', 'stream', 'text', 'download', 'metadata', 'status']) assert.equal((await f.request(endpoint)).status, 401);
  const login = password => fetch(`${f.base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  assert.equal((await login('wrong')).status, 401);
  const good = await login('test-password-123'); assert.equal(good.status, 200); const cookie = good.headers.get('set-cookie'); assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
  assert.equal((await f.request('roots', 'media', '', { headers: { Cookie: cookie.split(';')[0] } })).status, 200);
  await fetch(`${f.base}/api/logout`, { method: 'POST', headers: { Cookie: cookie.split(';')[0] } });
  assert.equal((await f.request('roots', 'media', '', { headers: { Cookie: cookie.split(';')[0] } })).status, 401);
  for (let i = 0; i < 8; i++) assert.equal((await login('wrong')).status, 401);
  assert.equal((await login('test-password-123')).status, 429);
});
test('FFmpeg / ffprobe 真实视频缩略图、元数据、磁盘缓存', async t => {
  const f = await fixture({ video: true }); t.after(() => f.close());
  if (!f.hasVideo) { t.skip('未安装可用 FFmpeg；用 FFMPEG_PATH 配置后重跑。'); return; }
  const thumb = await f.request('thumbnail', 'media', 'valid.mp4'); assert.equal(thumb.status, 200); const meta = await sharp(Buffer.from(await thumb.arrayBuffer())).metadata(); assert.equal(meta.width, 320);
  const second = await f.request('thumbnail', 'media', 'valid.mp4'); assert.equal(second.headers.get('x-thumbnail-cache'), 'HIT'); await second.arrayBuffer();
  const info = await (await f.request('metadata', 'media', 'valid.mp4')).json(); assert.equal(info.videoCodec, 'h264'); assert.equal(info.audioCodec, 'aac'); assert.ok(info.duration >= 89);
  let active = 0, peak = 0, started = 0;
  const original = f.service.thumbs.runner.run.bind(f.service.thumbs.runner);
  f.service.thumbs.runner.run = async (...args) => { active++; started++; peak = Math.max(peak, active); try { return await original(...args); } finally { active--; } };
  for (let i = 0; i < 8; i++) await fs.copyFile(path.join(f.media, 'valid.mp4'), path.join(f.media, `queue${i}.mp4`));
  await Promise.all(Array.from({ length: 8 }, async (_, i) => { const r = await f.request('thumbnail', 'media', `queue${i}.mp4`); assert.equal(r.status, 200); await r.arrayBuffer(); }));
  assert.equal(started, 8); assert.equal(peak, 2); assert.equal(active, 0);
});
