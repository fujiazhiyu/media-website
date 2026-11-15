import crypto from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(crypto.scrypt);
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${(await scrypt(password, salt, 64)).toString('hex')}`;
}
export class Auth {
  constructor(config) { this.config = config; this.sessions = new Map(); this.attempts = new Map(); this.active = 0; }
  valid(req) {
    if (!this.config.lan.enabled) return true;
    const token = /(?:^|;\s*)lf_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1];
    if (!token) return false;
    const expiry = this.sessions.get(token);
    if (!expiry || expiry < Date.now()) { this.sessions.delete(token); return false; }
    return true;
  }
  async login(req, res) {
    if (!this.config.lan.enabled) return res.json({ ok: true });
    const ip = req.socket.remoteAddress;
    const now = Date.now(), attempt = this.attempts.get(ip) ?? { count: 0, since: now };
    if (now - attempt.since > 15 * 60000) { attempt.count = 0; attempt.since = now; }
    if (attempt.count >= 8) return res.status(429).json({ error: '尝试次数过多，请 15 分钟后重试。' });
    const password = req.body?.password;
    if (typeof password !== 'string' || password.length > 256) return res.status(400).json({ error: '请输入有效密码。' });
    if (this.active >= 4) return res.status(503).json({ error: '登录请求繁忙，请稍后重试。' });
    attempt.count++; this.attempts.set(ip, attempt);
    if (this.attempts.size > 512) this.attempts.delete(this.attempts.keys().next().value);
    const [, salt, expected] = this.config.lan.passwordHash.split('$');
    this.active++;
    let actual;
    try { actual = await scrypt(password, salt, 64); } finally { this.active--; }
    if (!crypto.timingSafeEqual(actual, Buffer.from(expected, 'hex'))) return res.status(401).json({ error: '密码不正确。' });
    this.attempts.delete(ip);
    for (const [key, expiry] of this.sessions) if (expiry < now) this.sessions.delete(key);
    if (this.sessions.size >= 128) this.sessions.delete(this.sessions.keys().next().value);
    const token = crypto.randomBytes(32).toString('hex'), maxAge = this.config.lan.sessionHours * 3600;
    this.sessions.set(token, now + maxAge * 1000);
    res.set('Set-Cookie', `lf_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`);
    res.json({ ok: true });
  }
  logout(req, res) {
    const token = /lf_session=([a-f0-9]{64})/.exec(req.headers.cookie ?? '')?.[1];
    this.sessions.delete(token);
    res.set('Set-Cookie', 'lf_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0').json({ ok: true });
  }
}
