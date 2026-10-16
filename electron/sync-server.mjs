import https from 'node:https';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual, X509Certificate } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { generate } from 'selfsigned';
import { writeJson } from './store.mjs';
import { SyncRepository, fileHash } from './sync-store.mjs';
import { FILE_LIMIT, UUID, HASH, validateManifest } from './sync-protocol.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const compare = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const json = (res, value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'" }); res.end(JSON.stringify(value)); };
async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 4 * 1024 * 1024) throw Object.assign(new Error('同步请求过大。'), { status: 413 }); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export class SyncServer {
  constructor({ store, directory, seal = s => s, unseal = s => s, busy = () => false, changed = () => {} }) {
    this.store = store; this.directory = directory; this.seal = seal; this.unseal = unseal; this.busy = busy; this.changed = changed;
    this.repository = new SyncRepository(store, path.join(directory, 'incoming')); this.server = null; this.pairing = null; this.sockets = new Set(); this.revoked = new Set();
  }
  async init() {
    await fs.mkdir(this.directory, { recursive: true });
    try { this.config = JSON.parse(await fs.readFile(path.join(this.directory, 'service.json'), 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; this.config = { id: randomUUID(), port: 8790, publicUrl: '', enabled: false, devices: [] }; await this.persist(); }
    if (this.config.enabled) try { await this.start(); } catch (e) { this.error = e.message; }
    return this.status();
  }
  persist() { return writeJson(path.join(this.directory, 'service.json'), this.config); }
  status() {
    const addresses = this.addresses().map(h => `https://${h}:${this.config.port}`);
    return { platform: 'desktop', enabled: !!this.server?.listening, port: this.config.port, publicUrl: this.config.publicUrl, urls: this.config.publicUrl ? [this.config.publicUrl, ...addresses] : addresses, fingerprint: this.certificate ? new X509Certificate(this.certificate).fingerprint256 : '', devices: this.config.devices.map(({ id, name, pairedAt }) => ({ id, name, pairedAt })), pairing: this.pairing && this.pairing.expires > Date.now() ? { code: this.pairing.code, expiresAt: new Date(this.pairing.expires).toISOString() } : null, error: this.error || '' };
  }
  addresses() { return [...new Set(['127.0.0.1', ...Object.values(os.networkInterfaces()).flat().filter(x => x?.family === 'IPv4' && !x.internal).map(x => x.address)])]; }
  async configure(value) {
    const port = Number(value.port); if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('同步端口须为 1024–65535。');
    let publicUrl = String(value.publicUrl || '').trim().replace(/\/+$/, '');
    if (publicUrl) { const u = new URL(publicUrl); if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || u.pathname.includes('%') || /\/\.{1,2}(\/|$)/.test(u.pathname)) throw new Error('外网同步地址必须是无账号和查询参数的 HTTPS 地址。'); publicUrl = u.href.replace(/\/+$/, ''); }
    await this.stop(); this.config.port = port; this.config.publicUrl = publicUrl; this.config.enabled = !!value.enabled;
    await this.persist(); this.error = '';
    if (value.enabled) await this.start(); return this.status();
  }
  async start() {
    if (this.server) return;
    const hosts = [...this.addresses(), 'localhost', os.hostname(), ...(this.config.publicUrl ? [new URL(this.config.publicUrl).hostname] : [])];
    const certFile = path.join(this.directory, 'certificate.json'); let certificate;
    try { certificate = JSON.parse(await fs.readFile(certFile, 'utf8')); const c = new X509Certificate(certificate.cert); if (new Date(c.validTo).getTime() < Date.now() + 86400000 || hosts.some(h => !(net.isIP(h) ? c.checkIP(h) : c.checkHost(h)))) certificate = null; } catch (e) { if (e.code !== 'ENOENT' && e instanceof SyntaxError) throw e; }
    if (!certificate) {
      const pems = await generate([{ name: 'commonName', value: 'Q Character Sync' }], { keySize: 2048, algorithm: 'sha256', notBeforeDate: new Date(Date.now() - 300000), notAfterDate: new Date(Date.now() + 365 * 86400000), extensions: [{ name: 'basicConstraints', cA: false }, { name: 'keyUsage', digitalSignature: true, keyEncipherment: true }, { name: 'extKeyUsage', serverAuth: true }, { name: 'subjectAltName', altNames: [...new Set(hosts)].map(h => net.isIP(h) ? { type: 7, ip: h } : { type: 2, value: h }) }] });
      certificate = { cert: pems.cert, key: this.seal(pems.private) }; await writeJson(certFile, certificate);
    }
    this.certificate = certificate.cert;
    const server = https.createServer({ key: this.unseal(certificate.key), cert: certificate.cert, minVersion: 'TLSv1.2' }, (req, res) => { void this.handle(req, res).catch(e => { if (!res.headersSent) json(res, { error: e.message || '同步失败。' }, e.status || 400); else res.destroy(); }); });
    server.requestTimeout = 120000; server.headersTimeout = 15000; server.keepAliveTimeout = 1000;
    server.on('connection', socket => { this.sockets.add(socket); socket.on('close', () => this.sockets.delete(socket)); });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(this.config.port, '0.0.0.0', resolve); });
    server.on('error', e => { this.error = e.message; }); this.server = server;
  }
  async stop() { this.pairing = null; const server = this.server; this.server = null; if (server) { for (const socket of this.sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); } await this.store.pending; }
  pairCode() { if (!this.server?.listening) throw new Error('请先开启同步服务。'); this.pairing = { code: String(randomInt(10000000, 100000000)), expires: Date.now() + 120000, failures: 0 }; return this.status(); }
  async revoke(id) { const found = this.config.devices.some(d => d.id === id); if (!found) return this.status(); this.revoked.add(id); this.config.devices = this.config.devices.filter(d => d.id !== id); for (const socket of this.sockets) if (socket.syncDevice === id) socket.destroy(); await this.persist(); await this.store.pending; return this.status(); }
  authenticate(req) {
    const header = req.headers.authorization || '', token = /^Bearer ([a-zA-Z0-9_-]{43})$/.exec(header)?.[1];
    const device = token && this.config.devices.find(d => compare(d.tokenHash, sha(token)) && !this.revoked.has(d.id));
    if (!device) throw Object.assign(new Error('同步设备未配对或授权已撤销。'), { status: 401 }); req.socket.syncDevice = device.id;
    return () => { if (!this.server || this.revoked.has(device.id) || !this.config.devices.some(d => d.id === device.id)) throw Object.assign(new Error('设备授权已撤销。'), { status: 401 }); };
  }
  checkIdle(id) { if (this.busy(id)) throw Object.assign(new Error('电脑正在生成或编辑此作品，请稍后同步。'), { status: 409 }); }
  async handle(req, res) {
    // Native clients only: no browser Origin, CORS, cookies, redirects or filesystem paths.
    if (req.headers.origin) throw Object.assign(new Error('请使用配对后的 Q Character 应用同步。'), { status: 403 });
    const raw = req.url || ''; if (raw.includes('%') || raw.includes('..') || raw.includes('?') || raw.includes('\\')) throw new Error('同步路径无效。');
    const route = raw.match(/\/qsync\/v1(\/.*)?$/)?.[1] || (raw.endsWith('/qsync/v1') ? '/' : null);
    if (!route) throw Object.assign(new Error('同步接口不存在。'), { status: 404 });
    if (route === '/pair' && req.method === 'POST') {
      const b = await body(req), p = this.pairing;
      if (!p || p.expires < Date.now() || p.failures >= 8 || !compare(p.code, String(b.code || ''))) { if (p) p.failures++; throw Object.assign(new Error('配对码不正确、已过期或尝试过多，请在电脑重新生成。'), { status: 403 }); }
      this.pairing = null; const token = randomBytes(32).toString('base64url'), id = randomUUID();
      this.config.devices.push({ id, name: String(b.name || 'Android 手机').slice(0, 60), tokenHash: sha(token), pairedAt: new Date().toISOString() });
      await this.persist(); json(res, { protocol: 1, serverId: this.config.id, deviceId: id, token }); return;
    }
    const allowed = this.authenticate(req);
    if (route === '/info' && req.method === 'GET') { json(res, { protocol: 1, serverId: this.config.id, name: 'Q Character Windows' }); return; }
    if (route === '/projects' && req.method === 'GET') { const projects = await this.store.list(); allowed(); json(res, { projects: projects.map(p => ({ id: p.id, name: p.name, updatedAt: p.updatedAt, assets: p.assets.length })) }); return; }
    const match = /^\/projects\/([a-f0-9-]{36})(?:\/(manifest|commit|missing|files\/([a-f0-9]{64})))?$/.exec(route);
    if (!match || !UUID.test(match[1])) throw Object.assign(new Error('同步接口不存在。'), { status: 404 });
    const [, id, operation, hash] = match;
    if (operation === 'manifest' && req.method === 'GET') { this.checkIdle(id); const m = await this.repository.snapshot(id); allowed(); json(res, { manifest: m }); return; }
    if (operation === 'missing' && req.method === 'POST') {
      const m = validateManifest((await body(req)).manifest); if (m.project.id !== id) throw new Error('作品编号不一致。');
      const current = await this.repository.snapshot(id), available = new Set(current?.files.map(f => f.sha256) ?? []), missing = [];
      for (const f of m.files) if (!available.has(f.sha256) && !await this.repository.hasBlob(f)) missing.push(f.sha256);
      allowed(); json(res, { missing }); return;
    }
    if (hash && req.method === 'GET') { const asset = await this.repository.asset(id, hash); allowed(); res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': asset.size, 'Cache-Control': 'no-store' }); await pipeline(createReadStream(asset.file), res); return; }
    if (hash && req.method === 'PUT') {
      const size = Number(req.headers['content-length']); if (!HASH.test(hash) || !Number.isSafeInteger(size) || size < 1 || size > FILE_LIMIT) throw new Error('素材大小无效。');
      await fs.mkdir(this.repository.cache, { recursive: true });
      const cached = await fs.readdir(this.repository.cache, { withFileTypes: true }); let total = 0;
      for (const item of cached) if (item.isFile() && /^[a-f0-9]{64}\.blob$/.test(item.name)) { const f = path.join(this.repository.cache, item.name), s = await fs.stat(f); if (Date.now() - s.mtimeMs > 7 * 86400000) await fs.unlink(f); else total += s.size; }
      if (total + size > 1024 * 1024 * 1024) throw new Error('同步暂存空间已满，请稍后重试。');
      const temp = path.join(this.repository.cache, `${randomUUID()}.tmp`); let received = 0;
      try {
        await pipeline(req, new Transform({ transform(chunk, _, cb) { received += chunk.length; if (received > size) cb(new Error('素材长度不符。')); else { try { allowed(); cb(null, chunk); } catch (e) { cb(e); } } } }), createWriteStream(temp, { flags: 'wx' }));
        if (received !== size || await fileHash(temp) !== hash) throw new Error('素材传输校验失败。'); allowed(); await fs.rename(temp, this.repository.blob(hash)); json(res, { uploaded: true });
      } finally { await fs.unlink(temp).catch(() => {}); } return;
    }
    if (operation === 'commit' && req.method === 'POST') {
      const b = await body(req), manifest = validateManifest(b.manifest); if (manifest.project.id !== id) throw new Error('作品编号不一致。');
      this.checkIdle(id); const result = await this.repository.commit(manifest, b.expected ?? null, () => { allowed(); this.checkIdle(id); });
      this.changed(id); json(res, { manifest: result }); return;
    }
    throw Object.assign(new Error('同步操作不支持。'), { status: 405 });
  }
}
