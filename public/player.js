import { $, el, button, icon, url, time, api, storage } from './utils.js';
import { GESTURE, clamp, horizontalGesture, gestureSeek, tapZone, resumePosition } from './gestures.js';

export class Player {
  constructor(container, { root, item, previous, next, notify }) {
    this.root = root; this.item = item; this.notify = notify; this.abort = new AbortController();
    this.key = `${root}:${item.path}`; this.lastSaved = 0; this.draggingProgress = false; this.closed = false;
    this.shell = el('section', 'player'); this.shell.setAttribute('aria-label', '视频播放器');
    this.surface = el('div', 'video-surface');
    this.video = el('video'); this.video.playsInline = true; this.video.preload = 'metadata'; this.video.controls = false; this.video.setAttribute('aria-label', item.name);
    this.video.src = url('stream', root, item.path);
    this.feedback = el('div', 'video-feedback'); this.feedback.hidden = true; this.feedback.setAttribute('aria-live', 'polite');
    this.center = button('播放视频', 'play', () => this.toggle(), 'center-play');
    this.surface.append(this.video, this.center, this.feedback);
    this.controls = el('div', 'player-controls');
    const seekRow = el('div', 'seek-row');
    this.seek = el('input', 'seek'); this.seek.type = 'range'; this.seek.min = 0; this.seek.max = 100; this.seek.step = .1; this.seek.value = 0; this.seek.disabled = true; this.seek.setAttribute('aria-label', '视频进度');
    seekRow.append(this.seek);
    const row = el('div', 'control-row');
    this.play = button('播放', 'play', () => this.toggle());
    const prev = button('上一条视频', 'skipBack', previous); prev.disabled = !previous;
    const nextButton = button('下一条视频', 'skipNext', next); nextButton.disabled = !next;
    this.back = el('button', 'seek-step', '−10s'); this.back.title = '后退 10 秒'; this.back.setAttribute('aria-label', '后退 10 秒'); this.back.onclick = () => this.jump(-10);
    this.forward = el('button', 'seek-step', '+10s'); this.forward.title = '前进 10 秒'; this.forward.setAttribute('aria-label', '前进 10 秒'); this.forward.onclick = () => this.jump(10);
    this.clock = el('span', 'player-time', '0:00 / 0:00');
    this.mute = button('静音', 'volume', () => { this.video.muted = !this.video.muted; });
    this.volume = el('input', 'volume'); this.volume.type = 'range'; this.volume.min = 0; this.volume.max = 1; this.volume.step = .05; this.volume.value = 1; this.volume.setAttribute('aria-label', '音量');
    this.volume.title = '部分手机需使用设备音量键';
    this.speed = el('select', 'speed'); this.speed.setAttribute('aria-label', '播放速度');
    for (const rate of [.5, 1, 1.25, 1.5, 2]) { const o = el('option', '', `${rate}×`); o.value = rate; o.selected = rate === 1; this.speed.append(o); }
    const full = button('全屏', 'fullscreen', () => this.fullscreen());
    row.append(prev, this.play, nextButton, this.back, this.forward, this.clock, el('span', 'control-spacer'), this.mute, this.volume, this.speed, full);
    this.controls.append(seekRow, row);
    this.shell.append(this.surface, this.controls);
    this.error = el('div', 'playback-error'); this.error.hidden = true; this.error.setAttribute('role', 'alert');
    const errorText = el('p', '', '浏览器无法解码这个视频，或文件已不可读。MKV、AVI、HEVC 等格式的兼容性取决于浏览器与设备。');
    const errorHelp = el('p', 'muted', '请下载原文件，再用 Windows「打开方式」选择 VLC、mpv 或其他已安装的本机播放器。本网站不进行实时转码。');
    const download = el('a', 'primary', '下载原文件'); download.href = url('download', root, item.path); download.download = '';
    this.error.append(errorText, errorHelp, download);
    this.details = el('div', 'player-details');
    this.details.append(el('p', 'muted small', '空格 播放 / 暂停　 ·　 双击两侧 ±10s　 ·　 左右滑动预览后跳转'));
    this.metadata = el('p', 'muted small', '正在读取视频信息…'); this.details.append(this.metadata);
    container.append(this.shell, this.error, this.details);
    this.bind(); this.loadMetadata();
  }
  on(node, event, fn, options = {}) { node.addEventListener(event, fn, { ...options, signal: this.abort.signal }); }
  bind() {
    this.on(this.video, 'loadedmetadata', () => {
      this.seek.disabled = !Number.isFinite(this.video.duration); this.seek.max = this.video.duration || 100;
      const positions = storage.get('lf-positions', {}), saved = resumePosition(positions?.[this.key]?.time, this.video.duration);
      if (saved) { this.video.currentTime = saved; this.notify(`已从 ${time(saved)} 继续播放`); }
      this.update();
    });
    this.on(this.video, 'timeupdate', () => { this.update(); if (Date.now() - this.lastSaved > 3000) this.save(); });
    this.on(this.video, 'play', () => { this.center.hidden = true; this.play.innerHTML = icon('pause'); this.play.setAttribute('aria-label', '暂停'); });
    this.on(this.video, 'pause', () => { this.center.hidden = false; this.play.innerHTML = icon('play'); this.play.setAttribute('aria-label', '播放'); this.save(); });
    this.on(this.video, 'ended', () => this.save(true));
    this.on(this.video, 'error', () => { this.error.hidden = false; this.center.hidden = true; });
    this.on(this.video, 'volumechange', () => { this.mute.innerHTML = icon(this.video.muted || this.video.volume === 0 ? 'mute' : 'volume'); this.mute.setAttribute('aria-label', this.video.muted ? '取消静音' : '静音'); this.volume.value = this.video.muted ? 0 : this.video.volume; });
    this.on(this.volume, 'input', () => { this.video.volume = Number(this.volume.value); this.video.muted = this.video.volume === 0; });
    this.on(this.speed, 'change', () => { this.video.playbackRate = Number(this.speed.value); });
    this.on(this.seek, 'input', () => { this.draggingProgress = true; this.clock.textContent = `${time(Number(this.seek.value))} / ${time(this.video.duration)}`; });
    this.on(this.seek, 'change', () => { this.video.currentTime = Number(this.seek.value); this.draggingProgress = false; this.update(); });
    this.on(this.seek, 'pointercancel', () => { this.draggingProgress = false; this.update(); });
    this.on(document, 'keydown', e => {
      if (e.target.closest('input,textarea,select,[contenteditable="true"]') || (e.code === 'Space' && e.target.closest('button,a'))) return;
      if (e.code === 'Space') { e.preventDefault(); this.toggle(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); this.jump((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 30 : 10)); }
    });
    this.on(window, 'pagehide', () => this.save());
    this.on(this.surface, 'pointerdown', e => {
      if (e.target.closest('button') || e.button > 0) return;
      if (!e.isPrimary) { this.pointer = null; return; }
      if (e.pointerType === 'touch' && (e.clientX < GESTURE.edgeGuard || e.clientX > window.innerWidth - GESTURE.edgeGuard)) return;
      this.pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, time: this.video.currentTime, horizontal: false, vertical: false };
    });
    this.on(this.surface, 'pointermove', e => {
      const p = this.pointer; if (!p || p.id !== e.pointerId) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      if (!p.horizontal && Math.abs(dy) > GESTURE.threshold && Math.abs(dy) > Math.abs(dx)) { p.vertical = true; return; }
      if (p.vertical) return;
      if (horizontalGesture(dx, dy) && Number.isFinite(this.video.duration)) {
        if (!p.horizontal) { clearTimeout(this.tapTimer); this.lastTap = null; }
        p.horizontal = true; this.surface.setPointerCapture(e.pointerId);
      }
      if (p.horizontal) {
        e.preventDefault(); p.target = gestureSeek(p.time, dx, this.video.duration);
        this.showFeedback(`${p.target >= p.time ? '+' : '−'}${Math.abs(p.target - p.time).toFixed(0)}s  ·  ${time(p.target)}`, true);
      }
    }, { passive: false });
    this.on(this.surface, 'pointerup', e => {
      const p = this.pointer; if (!p || p.id !== e.pointerId) return; this.pointer = null;
      if (this.surface.hasPointerCapture(e.pointerId)) this.surface.releasePointerCapture(e.pointerId);
      if (p.horizontal) {
        // Use release coordinates too: browsers may coalesce the final move event.
        const target = gestureSeek(p.time, e.clientX - p.x, this.video.duration);
        this.video.currentTime = target; this.showFeedback(`已定位 ${time(target)}`); this.update(); return;
      }
      if (p.vertical || Math.hypot(e.clientX - p.x, e.clientY - p.y) > GESTURE.tapSlop) return;
      const box = this.surface.getBoundingClientRect(), zone = tapZone(e.clientX - box.left, box.width), now = performance.now();
      if (zone === 'center') { clearTimeout(this.tapTimer); this.lastTap = null; this.toggle(); return; }
      if (this.lastTap?.zone === zone && now - this.lastTap.time <= GESTURE.doubleTapMs) { clearTimeout(this.tapTimer); this.jump(zone === 'left' ? -10 : 10); }
      else { clearTimeout(this.tapTimer); this.tapTimer = setTimeout(() => this.toggle(), GESTURE.doubleTapMs); }
      this.lastTap = { zone, time: now };
    });
    this.on(this.surface, 'pointercancel', () => { this.pointer = null; this.feedback.hidden = true; clearTimeout(this.tapTimer); this.lastTap = null; });
  }
  async loadMetadata() {
    try {
      const data = await api(url('metadata', this.root, this.item.path), { signal: this.abort.signal });
      this.metadata.textContent = [data.width && `${data.width} × ${data.height}`, data.videoCodec?.toUpperCase(), data.audioCodec?.toUpperCase()].filter(Boolean).join(' · ') || '媒体信息不可用';
    } catch (e) { if (e.name !== 'AbortError') this.metadata.textContent = '视频信息不可用；不影响浏览器尝试播放。'; }
  }
  toggle() { if (this.video.paused) this.video.play().catch(e => { if (e.name !== 'AbortError') { this.error.hidden = false; this.notify('无法播放，请查看格式兼容提示。'); } }); else this.video.pause(); }
  update() { if (!this.draggingProgress) { this.seek.value = this.video.currentTime; this.clock.textContent = `${time(this.video.currentTime)} / ${time(this.video.duration)}`; this.seek.setAttribute('aria-valuetext', `${time(this.video.currentTime)}，共 ${time(this.video.duration)}`); } }
  jump(delta) { if (!Number.isFinite(this.video.duration)) return; this.video.currentTime = clamp(this.video.currentTime + delta, 0, this.video.duration); this.showFeedback(`${delta > 0 ? '+' : '−'}${Math.abs(delta)}s`); this.update(); }
  showFeedback(message, hold = false) { clearTimeout(this.feedbackTimer); this.feedback.textContent = message; this.feedback.hidden = false; if (!hold) this.feedbackTimer = setTimeout(() => { this.feedback.hidden = true; }, 900); }
  save(ended = false) {
    if (!Number.isFinite(this.video.duration) || this.closed) return;
    const raw = storage.get('lf-positions', {}), values = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    values[this.key] = { time: ended ? 0 : this.video.currentTime, updated: Date.now() };
    storage.set('lf-positions', Object.fromEntries(Object.entries(values).filter(([, value]) => value && Number.isFinite(value.time) && Number.isFinite(value.updated)).sort((a, b) => b[1].updated - a[1].updated).slice(0, 200))); this.lastSaved = Date.now();
  }
  async fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (this.shell.requestFullscreen) await this.shell.requestFullscreen();
      else if (this.video.webkitEnterFullscreen) this.video.webkitEnterFullscreen();
      else this.notify('此浏览器不支持网页全屏。');
    } catch { this.notify('无法进入全屏，请使用浏览器的全屏功能。'); }
  }
  destroy() { this.save(); this.closed = true; this.abort.abort(); clearTimeout(this.tapTimer); clearTimeout(this.feedbackTimer); this.video.pause(); this.video.removeAttribute('src'); this.video.load(); }
}
