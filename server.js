import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './server/config.js';
import { createApp } from './server/app.js';

const projectDir = path.dirname(fileURLToPath(import.meta.url));
const index = process.argv.indexOf('--config');
const filename = path.resolve(projectDir, index >= 0 ? process.argv[index + 1] ?? 'config.json' : process.env.MEDIA_CONFIG ?? 'config.json');
try {
  const config = await loadConfig(filename);
  const service = await createApp(config);
  const server = service.app.listen(config.port, config.host, () => {
    console.log(`[${new Date().toISOString()}] Local Frame 已启动：http://localhost:${config.port}（${config.lan.enabled ? '局域网密码保护' : '仅本机'}）`);
    console.log(`已配置 ${config.roots.length} 个根目录。`);
  });
  server.on('error', e => { console.error(`启动失败：${e.code === 'EADDRINUSE' ? '端口已被占用，请修改 config.json 的 port。' : e.message}`); service.close(); process.exitCode = 1; });
  server.requestTimeout = 30000; server.headersTimeout = 15000; server.keepAliveTimeout = 5000;
  let stopping = false;
  const stop = () => {
    if (stopping) return; stopping = true;
    console.log('正在停止服务…'); service.close();
    server.close(() => { console.log('服务已停止。'); });
    const timer = setTimeout(() => { server.closeAllConnections(); }, 5000); timer.unref();
  };
  process.on('SIGINT', stop); process.on('SIGTERM', stop); process.on('SIGBREAK', stop);
} catch (e) { console.error(`配置或启动失败：${e.message}`); process.exitCode = 1; }
