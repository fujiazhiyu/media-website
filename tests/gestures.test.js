import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GESTURE, horizontalGesture, gestureSeek, tapZone, resumePosition } from '../public/gestures.js';
import { WorkQueue } from '../server/queue.js';
test('横向手势阈值、方向判定、长度映射、60 秒与首尾边界', () => {
  assert.equal(horizontalGesture(24, 0), false); assert.equal(horizontalGesture(25, 4), true); assert.equal(horizontalGesture(25, 60), false);
  assert.equal(gestureSeek(100, 120, 500), 110); assert.equal(gestureSeek(100, -120, 500), 90);
  assert.equal(gestureSeek(100, 10000, 500), 160); assert.equal(gestureSeek(100, -10000, 500), 40);
  assert.equal(gestureSeek(5, -120, 500), 0); assert.equal(gestureSeek(495, 120, 500), 500); assert.equal(GESTURE.edgeGuard, 24);
  assert.equal(tapZone(10, 300), 'left'); assert.equal(tapZone(150, 300), 'center'); assert.equal(tapZone(290, 300), 'right');
});
test('播放续播位置与临近结尾从头开始', () => { assert.equal(resumePosition(30, 90), 30); assert.equal(resumePosition(85, 90), 0); assert.equal(resumePosition(-20, 90), 0); assert.equal(resumePosition(100, 90), 0); });
test('生成队列并发上限、拥塞与关闭时释放等待任务', async () => {
  const q = new WorkQueue(2, 4); let active = 0, peak = 0;
  await Promise.all(Array.from({ length: 6 }, () => q.run(async () => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 15)); active--; })));
  assert.equal(peak, 2); assert.equal(active, 0);
  let release; const blocked = q.run(() => new Promise(r => { release = r; }));
  const pending = Array.from({ length: 5 }, () => q.run(() => new Promise(() => {})).catch(e => e.status));
  await new Promise(r => setTimeout(r, 0)); q.close(); release(); await blocked;
  assert.equal(await pending[4], 503);
  // The second active job is intentionally unresolved; promises alone do not hold Node open.
  assert.equal(await pending[1], 503);
});
