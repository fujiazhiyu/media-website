import readline from 'node:readline';
import { hashPassword } from '../server/auth.js';

let password = '';
if (process.stdin.isTTY) {
  process.stdout.write('新的访问密码（12–256 位，不回显）：');
  readline.emitKeypressEvents(process.stdin); process.stdin.setRawMode(true); process.stdin.resume();
  password = await new Promise(resolve => {
    process.stdin.on('keypress', (text, key) => {
      if (key?.ctrl && key.name === 'c') { process.stdin.setRawMode(false); process.exit(130); }
      if (key?.name === 'return') { process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); resolve(password); }
      else if (key?.name === 'backspace') password = password.slice(0, -1);
      else if (text && !key?.ctrl && !key?.meta) password += text;
    });
  });
} else { for await (const chunk of process.stdin) password += chunk; password = password.replace(/[\r\n]+$/, ''); }
if (password.length < 12 || password.length > 256) { console.error('密码长度必须为 12–256 位。'); process.exitCode = 1; }
else { console.log('将以下值复制到 config.json 的 lan.passwordHash：'); console.log(await hashPassword(password)); }
