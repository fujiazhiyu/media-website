export const $ = (selector, root = document) => root.querySelector(selector);
const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"/><path d="M9 21v-8h6v8"/>',
  folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path d="M3 9h18"/>',
  video: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m10 8 6 4-6 4Z"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
  text: '<path d="M14 2H5v20h14V7Z"/><path d="M14 2v5h5M8 12h8M8 16h6"/>',
  file: '<path d="M14 2H5v20h14V7Z"/><path d="M14 2v5h5"/>',
  search: '<circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/>',
  refresh: '<path d="M20 7a9 9 0 1 0 1 8M20 2v6h-6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  back: '<path d="m14 5-7 7 7 7"/>',
  next: '<path d="m10 5 7 7-7 7"/>',
  play: '<path d="m8 4 12 8-12 8Z"/>',
  pause: '<path d="M8 4v16M16 4v16"/>',
  volume: '<path d="M11 4 6 8H2v8h4l5 4ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  mute: '<path d="M11 4 6 8H2v8h4l5 4ZM16 9l6 6m0-6-6 6"/>',
  fullscreen: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  zoomIn: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6M7 10h6m-3-3v6"/>',
  zoomOut: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6M7 10h6"/>',
  fit: '<path d="M4 8V4h4m8 0h4v4M4 16v4h4m8 0h4v-4M8 12h8"/>',
  skipBack: '<path d="M4 5v14m16-14L7 12l13 7Z"/>',
  skipNext: '<path d="M20 5v14M4 5l13 7-13 7Z"/>',
  warning: '<path d="m12 3 10 18H2Z"/><path d="M12 9v5m0 3v.1"/>'
};
export function icon(name) { return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.file}</svg>`; }
export function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
export function button(label, glyph, action, className = 'icon-button') { const b = el('button', className); b.type = 'button'; b.setAttribute('aria-label', label); b.title = label; b.innerHTML = icon(glyph); b.addEventListener('click', action); return b; }
export function url(endpoint, root, path = '') { return `/api/${endpoint}?${new URLSearchParams({ root, path })}`; }
export async function api(endpoint, options) { const response = await fetch(endpoint, options); const data = await response.json(); if (!response.ok) { const error = new Error(data.error ?? '请求失败，请稍后重试。'); error.status = response.status; throw error; } return data; }
export function time(seconds) { if (!Number.isFinite(seconds)) return '0:00'; const n = Math.max(0, Math.floor(seconds)); return n >= 3600 ? `${Math.floor(n / 3600)}:${String(Math.floor(n / 60) % 60).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}` : `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; }
export function size(bytes) { if (bytes === null || bytes === undefined) return '文件夹'; if (!bytes) return '0 B'; const u = Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024))); return `${(bytes / 1024 ** u).toFixed(u ? 1 : 0)} ${['B', 'KB', 'MB', 'GB'][u]}`; }
export const labels = { folder: '文件夹', image: '图片', video: '视频', text: '文本', file: '文件' };
export const storage = {
  get(key, fallback = null) { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Private mode / quota must not break playback. */ } }
};
