import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const files = ['server.js'];
for (const dir of ['server', 'public', 'scripts', 'tests']) {
  for (const name of await fs.readdir(dir)) if (name.endsWith('.js')) files.push(`${dir}/${name}`);
}
for (const file of files) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) { console.error(r.stderr); process.exitCode = 1; }
}
if (!process.exitCode) console.log(`语法检查通过：${files.length} 个 JavaScript 文件。`);
