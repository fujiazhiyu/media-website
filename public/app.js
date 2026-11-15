import { $, el, button, icon, url, size, labels, api, storage } from './utils.js';
import { Player } from './player.js';

const state = { roots: [], items: [], root: '', path: '', type: 'all', view: storage.get('lf-view', 'grid') === 'list' ? 'list' : 'grid', request: null };
let player, viewerAbort, toastTimer;
const viewer = $('#viewer'), content = $('#viewer-content');
function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false; toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3500); }
function navigate(root = '', path = '') {
  const hash = root ? `#${new URLSearchParams({ root, path })}` : '';
  if (location.hash === hash) load(); else location.hash = hash;
}
function renderNav() {
  $('#root-nav').replaceChildren();
  $('#home').innerHTML = `${icon('home')}<span>全部媒体库</span>`;
  $('#home').classList.toggle('active', !state.root);
  $('#home').setAttribute('aria-current', !state.root ? 'page' : 'false');
  for (const root of state.roots) {
    const b = button(root.name, 'folder', () => navigate(root.id), 'nav-item');
    b.append(el('span', '', root.name)); b.classList.toggle('active', root.id === state.root);
    b.setAttribute('aria-current', root.id === state.root ? 'page' : 'false');
    if (!root.available) b.append(el('span', 'unavailable', '!'));
    $('#root-nav').append(b);
  }
}
function breadcrumbs() {
  const nav = $('#breadcrumbs'); nav.replaceChildren();
  const home = el('button', 'crumb', '媒体库'); home.onclick = () => navigate(); nav.append(home);
  if (!state.root) return;
  const root = state.roots.find(r => r.id === state.root);
  const add = (name, p) => { nav.append(el('span', 'crumb-separator', '/')); const b = el('button', 'crumb', name); b.onclick = () => navigate(state.root, p); nav.append(b); };
  add(root?.name ?? '未配置的媒体库', '');
  const parts = state.path.split('/').filter(Boolean);
  parts.forEach((part, index) => add(part, parts.slice(0, index + 1).join('/')));
  nav.lastElementChild?.setAttribute('aria-current', 'page');
}
function emptyState(title, message, setup = false) {
  const empty = $('#empty'); empty.replaceChildren(); empty.hidden = false;
  const glyph = el('div', 'empty-glyph'); glyph.innerHTML = icon('folder');
  empty.append(glyph, el('h2', '', title), el('p', 'muted', message));
  if (setup) {
    const steps = el('ol', 'setup-steps');
    for (const text of ['复制 config.example.json 为 config.json。', '将 roots 中的 path 修改为你的媒体文件夹。', '重启服务，刷新页面。']) steps.append(el('li', '', text));
    empty.append(steps, el('p', 'muted small', '完整安装、局域网访问与后台运行步骤见项目 README.md。'));
  }
}
function previewCard(item, isRoot = false) {
  const b = el('button', 'media-card'); b.type = 'button';
  b.setAttribute('aria-label', `${isRoot ? '媒体库' : labels[item.type]}：${item.name}`);
  const preview = el('div', `card-preview ${item.type}`);
  const glyph = el('div', 'placeholder-icon'); glyph.innerHTML = icon(item.type); preview.append(glyph);
  if (['folder', 'image', 'video'].includes(item.type) && item.available !== false) {
    const img = el('img'); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
    img.src = url('thumbnail', isRoot ? item.id : state.root, isRoot ? '' : item.path);
    img.addEventListener('load', () => { preview.classList.add('has-image'); });
    img.addEventListener('error', () => img.remove(), { once: true }); preview.append(img);
  }
  const tag = el('span', 'type-tag'); tag.innerHTML = icon(item.type); tag.append(document.createTextNode(isRoot ? '媒体库' : labels[item.type])); preview.append(tag);
  if (item.type === 'video') { const play = el('span', 'card-play'); play.innerHTML = icon('play'); preview.append(play); }
  const info = el('div', 'card-info'), name = el('div', 'card-name', item.name); name.title = item.name;
  const meta = el('div', 'card-meta');
  meta.append(el('span', '', isRoot ? (item.available ? '打开媒体库' : '目录不可用') : size(item.size)));
  if (!isRoot && item.modified) meta.append(el('span', '', new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(item.modified))));
  info.append(name, meta); b.append(preview, info);
  b.addEventListener('click', () => isRoot ? navigate(item.id) : openItem(item)); return b;
}
function render() {
  const entries = $('#entries'); entries.replaceChildren(); $('#empty').hidden = true;
  entries.classList.toggle('list-view', state.view === 'list');
  $('#grid-view').classList.toggle('selected', state.view === 'grid'); $('#grid-view').setAttribute('aria-pressed', state.view === 'grid');
  $('#list-view').classList.toggle('selected', state.view === 'list'); $('#list-view').setAttribute('aria-pressed', state.view === 'list');
  const query = $('#search').value.trim().toLocaleLowerCase();
  const items = state.items.filter(i => (!query || i.name.toLocaleLowerCase().includes(query)) && (state.type === 'all' || state.type === i.type));
  $('#item-count').textContent = `${items.length} ${!state.root ? '个媒体库' : '个项目'}${items.length !== state.items.length ? ` / 共 ${state.items.length} 个` : ''}`;
  const fragment = document.createDocumentFragment();
  if (state.root && state.path) { const up = button('返回上一级', 'back', () => navigate(state.root, state.path.split('/').slice(0, -1).join('/')), 'parent-card'); up.append(el('span', '', '返回上一级')); fragment.append(up); }
  for (const item of items) fragment.append(previewCard(item, !state.root));
  entries.append(fragment);
  if (!items.length) {
    if (!state.root && !state.roots.length) emptyState('把你的媒体库带进来', '配置一个或多个文件夹，即可开始浏览图片、视频与文字。', true);
    else emptyState(query || state.type !== 'all' ? '没有找到匹配的文件' : '这里还是空的', query || state.type !== 'all' ? '试试其他文件名，或切换到「全部」。' : '当前文件夹没有可读取的文件。');
  }
}
async function load(refresh = false) {
  state.request?.abort(); state.request = new AbortController(); const { signal } = state.request;
  const route = new URLSearchParams(location.hash.slice(1)); state.root = route.get('root') ?? ''; state.path = route.get('path') ?? '';
  if (viewer.open) viewer.close();
  $('#entries').setAttribute('aria-busy', 'true'); $('#entries').replaceChildren(); $('#empty').hidden = true; $('#notice').hidden = true; $('#item-count').textContent = '正在读取…';
  try {
    const data = await api('/api/roots', { signal }); state.roots = data.roots;
    renderNav(); breadcrumbs();
    $('#page-title').textContent = state.root ? state.path.split('/').filter(Boolean).at(-1) ?? state.roots.find(r => r.id === state.root)?.name ?? '媒体库' : '我的媒体库';
    $('#section-label').textContent = state.root ? '浏览文件夹' : '留在本地，自在浏览';
    $('#page-description').textContent = state.root ? '打开一张图片，或从一部影片开始。' : '你的图片、影片与文字，收在这里。';
    $('#type-filters').hidden = !state.root;
    if (state.root) {
      const list = await api(`${url('list', state.root, state.path)}${refresh ? '&refresh=1' : ''}`, { signal });
      state.items = list.items;
      if (list.unreadable) { $('#notice').textContent = `有 ${list.unreadable} 个项目无法读取或链接超出媒体库，已跳过。`; $('#notice').hidden = false; }
    } else state.items = state.roots.map(r => ({ ...r, type: 'folder' }));
    render();
  } catch (e) {
    if (e.name === 'AbortError') return;
    state.items = []; $('#item-count').textContent = '读取失败';
    if (e.status === 401) { $('#root-nav').replaceChildren(); $('#login-dialog').showModal(); }
    else emptyState('暂时无法打开', e.message);
  } finally { if (!signal.aborted) $('#entries').setAttribute('aria-busy', 'false'); }
}
function cleanupViewer() {
  player?.destroy(); player = null; viewerAbort?.abort(); content.replaceChildren();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
function openItem(item) {
  if (item.type === 'folder') { $('#search').value = ''; state.type = 'all'; updateTabs(); navigate(state.root, item.path); return; }
  cleanupViewer(); viewerAbort = new AbortController();
  $('#viewer-title').textContent = item.name; $('#viewer-kind').textContent = `${labels[item.type]} · ${size(item.size)}`;
  $('#viewer-download').href = url('download', state.root, item.path); $('#viewer-download').download = '';
  if (item.type === 'video') {
    const videos = state.items.filter(i => i.type === 'video'), index = videos.indexOf(item);
    player = new Player(content, { root: state.root, item, notify: toast, previous: index > 0 ? () => openItem(videos[index - 1]) : null, next: index < videos.length - 1 ? () => openItem(videos[index + 1]) : null });
  } else if (item.type === 'image') imageViewer(item);
  else if (item.type === 'text') textViewer(item, viewerAbort.signal);
  else { const info = el('div', 'unknown-preview'); info.innerHTML = icon('file'); info.append(el('h3', '', '此文件暂不支持网页预览'), el('p', 'muted', '点击右上角下载原文件，用本机应用打开。')); content.append(info); }
  if (!viewer.open) viewer.showModal();
  $('#viewer-close').focus();
}
function imageViewer(item) {
  const images = state.items.filter(i => i.type === 'image'), index = images.indexOf(item);
  const stage = el('div', 'image-stage'), img = el('img', 'full-image'); img.alt = item.name; img.src = url('stream', state.root, item.path);
  img.addEventListener('error', () => { stage.replaceChildren(el('p', 'notice', '无法预览此图片，请下载原文件。')); }, { signal: viewerAbort.signal });
  stage.append(img); const row = el('div', 'image-controls'); let scale = 1;
  const zoomLabel = el('span', 'muted', '适应窗口');
  const zoom = amount => { scale = Math.min(5, Math.max(.25, scale + amount)); img.style.width = `${scale * 100}%`; img.classList.toggle('zoomed', scale !== 1); zoomLabel.textContent = `${Math.round(scale * 100)}%`; };
  const prev = button('上一张图片', 'back', () => openItem(images[index - 1])); prev.disabled = index === 0;
  const next = button('下一张图片', 'next', () => openItem(images[index + 1])); next.disabled = index === images.length - 1;
  row.append(prev, el('span', 'muted', `${index + 1} / ${images.length}`), next, el('span', 'control-spacer'), button('缩小', 'zoomOut', () => zoom(-.25)), zoomLabel, button('放大', 'zoomIn', () => zoom(.25)), button('适应窗口', 'fit', () => { scale = 1; img.style.width = ''; img.classList.remove('zoomed'); zoomLabel.textContent = '适应窗口'; }));
  content.append(stage, row);
}
async function textViewer(item, signal) {
  const note = el('p', 'text-note muted', '正在读取文本…'), pre = el('pre', 'text-preview'); pre.tabIndex = 0;
  content.append(note, pre);
  try { const data = await api(url('text', state.root, item.path), { signal }); pre.textContent = data.content; note.textContent = `${data.encoding.toUpperCase()} · 纯文本预览${data.truncated ? ` · 文件较大，仅显示前 ${size(data.previewBytes)}，下载可查看全文。` : ''}`; }
  catch (e) { if (e.name !== 'AbortError') note.textContent = e.message; }
}
function updateTabs() { for (const b of $('#type-filters').children) { const selected = b.dataset.type === state.type; b.classList.toggle('selected', selected); b.setAttribute('aria-pressed', selected); } }
$('#home').onclick = () => { $('#search').value = ''; state.type = 'all'; updateTabs(); navigate(); };
$('#refresh').innerHTML = icon('refresh'); $('#refresh').onclick = () => load(true);
$('#search-icon').innerHTML = icon('search'); $('#grid-view').innerHTML = icon('grid'); $('#list-view').innerHTML = icon('list');
$('#viewer-close').innerHTML = icon('close'); $('#viewer-download').innerHTML = icon('download');
$('#viewer-close').onclick = () => viewer.close(); viewer.addEventListener('close', cleanupViewer);
viewer.addEventListener('click', e => { if (e.target === viewer) viewer.close(); });
$('#help').onclick = () => $('#help-dialog').showModal(); $('#help-close').onclick = () => $('#help-dialog').close();
$('#mobile-help').onclick = () => $('#help-dialog').showModal();
$('#search').oninput = render;
$('#type-filters').onclick = e => { if (!e.target.dataset.type) return; state.type = e.target.dataset.type; updateTabs(); render(); };
for (const view of ['grid', 'list']) $(`#${view}-view`).onclick = () => { state.view = view; storage.set('lf-view', view); render(); };
$('#login-dialog').addEventListener('cancel', e => e.preventDefault());
$('#login-form').onsubmit = async e => {
  e.preventDefault(); const submit = $('#login-form button'); submit.disabled = true; $('#login-error').textContent = '';
  try { await api('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('#password').value }) }); $('#password').value = ''; $('#login-dialog').close(); await load(); }
  catch (error) { $('#login-error').textContent = error.message; }
  finally { submit.disabled = false; }
};
$('#logout').onclick = async () => {
  try { await api('/api/logout', { method: 'POST' }); location.reload(); } catch (e) { toast(e.message); }
};
$('#mobile-logout').onclick = () => $('#logout').click();
window.addEventListener('hashchange', () => { $('#search').value = ''; state.type = 'all'; updateTabs(); load(); });
document.addEventListener('keydown', e => { if (e.key === '/' && !document.querySelector('dialog[open]') && !e.target.closest('input,textarea,select,[contenteditable="true"]')) { e.preventDefault(); $('#search').focus(); } });
async function init() {
  try {
    const session = await api('/api/session'); $('#connection').textContent = session.lan ? '局域网 · 密码保护' : '本地连接'; $('#logout').hidden = !session.lan; $('#mobile-logout').hidden = !session.lan;
    if (!session.authenticated) { $('#login-dialog').showModal(); $('#item-count').textContent = '请先解锁媒体库'; return; }
    await load();
    const tools = await api('/api/status');
    if (!tools.ffmpeg || !tools.ffprobe) toast('FFmpeg / ffprobe 不可用。视频可尝试播放，缩略图与媒体信息需安装工具后重启。');
  } catch (e) { emptyState('无法连接媒体库', e.message); }
}
init();
