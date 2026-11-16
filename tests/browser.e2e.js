import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { fixture } from './fixtures.js';
import { hashPassword } from '../server/auth.js';

const output = path.resolve('test-results');
await fs.mkdir(output, { recursive: true });
const closeViewer = async page => { if (await page.locator('#viewer').evaluate(v => v.open)) await page.locator('#viewer-close').click(); };
const setTime = (page, value) => page.locator('video').evaluate((v, time) => { v.pause(); v.currentTime = time; }, value);
const currentTime = page => page.locator('video').evaluate(v => v.currentTime);
const near = (actual, expected, tolerance = 1) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≈ ${expected}`);

test('真实浏览器画廊与播放器端到端验收', { timeout: 180000 }, async t => {
  const f = await fixture({ video: true }); t.after(() => f.close());
  const channels = process.env.BROWSER_CHANNELS?.split(',') ?? ['chrome', 'msedge'];
  for (const channel of channels) await t.test(channel, { timeout: 80000 }, async t => {
    const browser = await chromium.launch({ headless: true, channel, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}) });
    t.after(() => browser.close());
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = []; page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(f.base);
    await page.getByRole('button', { name: '媒体库：媒体', exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, `${channel}-home.png`), fullPage: true });
    await page.getByRole('button', { name: '媒体库：媒体', exact: true }).click();
    await page.getByRole('button', { name: '文件夹：空文件夹', exact: true }).waitFor();
    await page.locator('#search').fill('file2'); assert.equal(await page.locator('.media-card').count(), 1);
    await page.locator('#search').fill(''); await page.locator('#list-view').click(); assert.equal(await page.locator('#entries').evaluate(e => e.classList.contains('list-view')), true);
    await page.locator('#grid-view').click();
    await page.getByRole('button', { name: '文件夹：空文件夹', exact: true }).click(); await page.getByText('这里还是空的', { exact: true }).waitFor();
    await page.getByRole('button', { name: '返回上一级' }).click();
    await page.getByRole('button', { name: '文件夹：相册', exact: true }).click();
    await page.getByRole('button', { name: '图片：图片 2.png', exact: true }).click(); await page.locator('.full-image').waitFor();
    await page.waitForFunction(() => document.querySelector('.full-image')?.naturalWidth > 0);
    await page.getByRole('button', { name: '放大', exact: true }).click(); assert.equal(await page.locator('.full-image').evaluate(i => i.classList.contains('zoomed')), true);
    await page.getByRole('button', { name: '下一张图片' }).click(); assert.equal(await page.locator('#viewer-title').textContent(), '图片 10.png');
    await page.getByRole('button', { name: '上一张图片' }).click(); assert.equal(await page.locator('#viewer-title').textContent(), '图片 2.png');
    await page.getByRole('button', { name: '适应窗口' }).click(); await closeViewer(page);
    await page.getByRole('button', { name: '文字', exact: true }).click();
    await page.getByRole('button', { name: '文本：中文 & 空格 # 100%.txt', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.text-preview')?.textContent.includes('<script>'));
    assert.equal(await page.evaluate(() => globalThis.PREVIEW_PWNED), undefined); await closeViewer(page);
    await page.getByRole('button', { name: '文本：large.log', exact: true }).click(); await page.getByText(/文件较大，仅显示前/).waitFor(); await closeViewer(page);
    if (!f.hasVideo) { t.diagnostic('FFmpeg 缺失，未运行真实解码/手势；这些条目不能标为已验证。'); }
    else {
      await page.getByRole('button', { name: '媒体', exact: true }).click();
      await page.getByRole('button', { name: '视频：valid.mp4', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1);
      await page.getByRole('button', { name: '播放视频', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('video')?.currentTime > .1);
      await setTime(page, 30); await page.locator('#viewer-title').click();
      await page.keyboard.press('ArrowRight'); near(await currentTime(page), 40);
      await page.keyboard.press('Shift+ArrowLeft'); near(await currentTime(page), 10);
      await page.keyboard.press('Space'); assert.equal(await page.locator('video').evaluate(v => v.paused), false); await page.keyboard.press('Space');
      await page.getByRole('slider', { name: '视频进度' }).focus(); const focusedTime = await currentTime(page); await page.keyboard.press('ArrowRight'); assert.ok(Math.abs(await currentTime(page) - focusedTime) < 2);
      await page.locator('#viewer-title').click(); await setTime(page, 30);
      const surface = await page.locator('.video-surface').boundingBox();
      const right = { x: surface.x + surface.width * .85, y: surface.y + surface.height * .65 }, left = { x: surface.x + surface.width * .15, y: right.y };
      await page.mouse.click(right.x, right.y); await page.mouse.click(right.x, right.y); near(await currentTime(page), 40);
      await page.mouse.click(right.x, right.y); near(await currentTime(page), 50); assert.equal(await page.locator('video').evaluate(v => v.paused), true);
      await page.waitForTimeout(350); await page.mouse.click(left.x, left.y); await page.mouse.click(left.x, left.y); near(await currentTime(page), 40);
      await page.waitForTimeout(350); await setTime(page, 30);
      const startX = surface.x + surface.width * .4, y = right.y;
      await page.mouse.move(startX, y); await page.mouse.down(); await page.mouse.move(startX + 120, y, { steps: 8 });
      near(await currentTime(page), 30); assert.match(await page.locator('.video-feedback').textContent(), /0:40/);
      await page.mouse.up(); near(await currentTime(page), 40);
      await page.getByRole('slider', { name: '视频进度' }).evaluate(e => { e.value = 50; e.dispatchEvent(new Event('input', { bubbles: true })); });
      near(await currentTime(page), 40);
      await page.getByRole('slider', { name: '视频进度' }).evaluate(e => e.dispatchEvent(new Event('change', { bubbles: true }))); near(await currentTime(page), 50);
      await page.getByRole('combobox', { name: '播放速度' }).selectOption('1.5'); assert.equal(await page.locator('video').evaluate(v => v.playbackRate), 1.5);
      await page.getByRole('button', { name: '静音', exact: true }).click(); assert.equal(await page.locator('video').evaluate(v => v.muted), true);
      await page.getByRole('button', { name: '全屏', exact: true }).click(); await page.waitForFunction(() => !!document.fullscreenElement);
      assert.equal(await page.locator('.player-controls').isVisible(), false);
      const fullscreenSurface = await page.locator('.video-surface').boundingBox();
      near(fullscreenSurface.height, await page.evaluate(() => innerHeight)); near(fullscreenSurface.y, 0);
      const fullX = fullscreenSurface.width / 2, fullY = fullscreenSurface.height / 2;
      await page.mouse.click(fullX, fullY); await page.locator('.player-controls').waitFor({ state: 'visible' });
      assert.equal(await page.locator('video').evaluate(v => v.paused), true);
      assert.deepEqual(await page.locator('.video-surface').boundingBox(), fullscreenSurface);
      assert.equal(await page.locator('.player-controls').evaluate(e => getComputedStyle(e).position), 'absolute');
      assert.ok((await page.locator('.player-controls').boundingBox()).height < 110);
      await page.screenshot({ path: path.join(output, `${channel}-fullscreen-overlay.png`) });
      await page.locator('.player-controls').waitFor({ state: 'hidden', timeout: 5000 });
      await page.mouse.dblclick(fullX, fullY, { delay: 60 }); await page.waitForFunction(() => !document.querySelector('video').paused);
      await page.mouse.dblclick(fullX, fullY, { delay: 60 }); await page.waitForFunction(() => document.querySelector('video').paused);
      assert.equal(await page.locator('.player-controls').isVisible(), false);
      await page.evaluate(() => document.exitFullscreen());
      await page.locator('.player-controls').waitFor({ state: 'visible' });
      await setTime(page, 30); await page.screenshot({ path: path.join(output, `${channel}-player.png`) }); await closeViewer(page);
      await page.getByRole('button', { name: '视频：valid.mp4', exact: true }).click(); await page.waitForFunction(() => document.querySelector('video')?.currentTime >= 29); near(await currentTime(page), 30);
      await page.getByRole('button', { name: '下一条视频' }).click(); assert.equal(await page.locator('#viewer-title').textContent(), 'valid2.mp4');
      await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1); await setTime(page, 85); await closeViewer(page);
      await page.getByRole('button', { name: '视频：valid2.mp4', exact: true }).click(); await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1); near(await currentTime(page), 0); await closeViewer(page);
      await page.getByRole('button', { name: '视频：sample.mp4', exact: true }).click(); await page.locator('.playback-error').waitFor({ state: 'visible' }); await closeViewer(page);
    }
    assert.deepEqual(errors, []);
    if (channel === channels[0]) {
      const many = path.join(f.media, 'many'); await fs.mkdir(many, { recursive: true });
      for (let start = 0; start < 500; start += 25) await Promise.all(Array.from({ length: 25 }, (_, i) => fs.writeFile(path.join(many, `记录${start + i}.txt`), 'fixture')));
    }
    await page.goto(`${f.base}/#root=media&path=many`); await page.waitForFunction(() => document.querySelectorAll('.media-card').length === 500);
    let rescans = 0; page.on('request', req => { if (req.url().includes('/api/list')) rescans++; });
    await page.locator('#search').fill('499'); assert.equal(await page.locator('.media-card').count(), 1);
    await page.locator('#list-view').click(); await page.locator('#grid-view').click(); assert.equal(rescans, 0);
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    const phone = await mobile.newPage(); phone.setDefaultTimeout(10000); phone.on('pageerror', error => errors.push(error.message));
    await phone.goto(`${f.base}/#root=media&path=`); await phone.getByRole('button', { name: '文件夹：相册', exact: true }).waitFor();
    assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await phone.screenshot({ path: path.join(output, `${channel}-mobile.png`), fullPage: true });
    await phone.locator('#mobile-help').click(); await phone.locator('#help-dialog').waitFor({ state: 'visible' }); await phone.locator('#help-close').click();
    if (f.hasVideo) {
      await phone.getByRole('button', { name: '视频：valid.mp4', exact: true }).click(); await phone.waitForFunction(() => document.querySelector('video')?.readyState >= 1); await setTime(phone, 30);
      const surface = await phone.locator('.video-surface').boundingBox(), session = await mobile.newCDPSession(phone);
      const x = surface.x + 90, y = surface.y + surface.height * .6;
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let dx = 15; dx <= 120; dx += 15) { await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx, y }] }); await phone.waitForTimeout(30); }
      await phone.waitForFunction(() => document.querySelector('.video-feedback')?.textContent.includes('0:40'));
      near(await currentTime(phone), 30); assert.match(await phone.locator('.video-feedback').textContent(), /0:40/);
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); near(await currentTime(phone), 40);
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x + 120, y }] });
      for (let dx = 15; dx <= 120; dx += 15) { await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 120 - dx, y }] }); await phone.waitForTimeout(30); }
      near(await currentTime(phone), 40);
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); near(await currentTime(phone), 30);
      const tapX = surface.x + surface.width * .85;
      await phone.touchscreen.tap(tapX, y); await phone.touchscreen.tap(tapX, y); await phone.touchscreen.tap(tapX, y); near(await currentTime(phone), 50);
      assert.equal(await phone.locator('video').evaluate(v => v.paused), true);
      await phone.screenshot({ path: path.join(output, `${channel}-mobile-player.png`) });
      await session.detach();
      await phone.getByRole('button', { name: '全屏', exact: true }).click(); await phone.waitForFunction(() => !!document.fullscreenElement);
      assert.equal(await phone.locator('.player-controls').isVisible(), false);
      const full = await phone.locator('.video-surface').boundingBox(), tx = full.width / 2, ty = full.height / 2;
      await phone.touchscreen.tap(tx, ty); await phone.locator('.player-controls').waitFor({ state: 'visible' });
      assert.equal(await phone.locator('video').evaluate(v => v.paused), true);
      assert.deepEqual(await phone.locator('.video-surface').boundingBox(), full);
      await phone.touchscreen.tap(tx, ty); await phone.locator('.player-controls').waitFor({ state: 'hidden' });
      await phone.touchscreen.tap(tx, ty); await phone.touchscreen.tap(tx, ty); await phone.waitForFunction(() => !document.querySelector('video').paused);
      await phone.touchscreen.tap(tx, ty); await phone.touchscreen.tap(tx, ty); await phone.waitForFunction(() => document.querySelector('video').paused);
      await phone.evaluate(() => document.exitFullscreen());
    }
    await closeViewer(phone);
    for (const viewport of [{ width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 844, height: 390 }]) {
      await phone.setViewportSize(viewport); assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${channel} overflow at ${viewport.width}`);
    }
    assert.deepEqual(errors, []); await mobile.close(); await context.close();
  });
});

test('局域网手机登录、密码错误、解锁和退出界面', { timeout: 30000 }, async t => {
  const f = await fixture({ lan: true, passwordHash: await hashPassword('browser-password-123') }); t.after(() => f.close());
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNELS?.split(',')[0] ?? 'chrome', ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}) }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); page.setDefaultTimeout(10000);
  await page.goto(f.base); await page.locator('#login-dialog').waitFor({ state: 'visible' });
  await page.locator('#password').fill('wrong'); await page.getByRole('button', { name: '解锁媒体库' }).click(); await page.getByText('密码不正确。', { exact: true }).waitFor();
  await page.locator('#password').fill('browser-password-123'); await page.getByRole('button', { name: '解锁媒体库' }).click();
  await page.getByRole('button', { name: '媒体库：媒体', exact: true }).waitFor(); assert.equal(await page.locator('#login-dialog').evaluate(d => d.open), false);
  assert.equal((await page.request.get(`${f.base}/api/roots`)).status(), 200);
  await page.locator('#mobile-logout').click(); await page.locator('#login-dialog').waitFor({ state: 'visible' }); assert.equal((await page.request.get(`${f.base}/api/roots`)).status(), 401);
});
