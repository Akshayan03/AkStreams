// Bounded, SSRF-aware upstream HTTP client. Every server-side fetch goes through here:
// - only http/https, no credentials in URLs, HTTPS->HTTP downgrades refused
// - DNS answers and IP literals are checked against private/reserved ranges at connect
//   time (custom lookup), so redirects and DNS rebinding cannot reach the LAN/loopback
// - redirects are followed manually and re-validated, response bodies are size-capped
// - a global semaphore bounds concurrent upstream requests
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import zlib from 'node:zlib';

const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(addr, prefix, 'ipv4');
for (const [addr, prefix] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
  ['2001:db8::', 32], ['100::', 64],
]) blocked.addSubnet(addr, prefix, 'ipv6');

function embeddedIPv4(ip) {
  const lower = ip.toLowerCase();
  const mapped = lower.match(/^(?:::ffff:|::ffff:0:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return mapped[1];
  const hex = lower.match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) { const a = parseInt(hex[1], 16), b = parseInt(hex[2], 16); return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`; }
  const sixToFour = lower.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4}):/);
  if (sixToFour) { const a = parseInt(sixToFour[1], 16), b = parseInt(sixToFour[2], 16); return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`; }
  return null;
}
export function isPrivateAddress(ip) {
  const family = net.isIP(ip);
  if (!family) return true;
  if (family === 4) return blocked.check(ip, 'ipv4');
  const v4 = embeddedIPv4(ip);
  if (v4) return blocked.check(v4, 'ipv4');
  return blocked.check(ip, 'ipv6');
}

export class UpstreamError extends Error {
  constructor(message, { status, code } = {}) { super(message); this.name = 'UpstreamError'; this.status = status; this.code = code; }
}

// Removes query strings/credentials so URLs never leak tokens into logs or API responses.
export function redactUrl(value) {
  try { const u = new URL(value); return `${u.protocol}//${u.host}${u.pathname.length > 40 ? `${u.pathname.slice(0, 40)}…` : u.pathname}`; }
  catch { return '[invalid url]'; }
}
export function redactSecrets(text) {
  return String(text).replace(/([?&](?:key|token|api_key|apikey|password|pass|auth|sig|signature)=)[^&\s"']+/gi, '$1[redacted]')
    .replace(/\/\/[^/\s:@]+:[^/\s@]+@/g, '//[redacted]@');
}

// Simple counting semaphore shared by all upstream calls.
let active = 0;
const waiting = [];
export const MAX_UPSTREAM_CONCURRENCY = 6;
async function acquire() {
  if (active < MAX_UPSTREAM_CONCURRENCY) { active++; return; }
  await new Promise(resolve => waiting.push(resolve));
  active++;
}
function release() { active--; const next = waiting.shift(); if (next) next(); }
export function upstreamStats() { return { active, queued: waiting.length }; }

function guardedLookup(allowAddress) {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error);
      const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: options.family || 4 }];
      const bad = list.find(a => !allowAddress(a.address));
      if (bad || !list.length) return callback(new UpstreamError(`Blocked private or reserved address for ${hostname}`, { code: 'BLOCKED_ADDRESS' }));
      if (options.all) return callback(null, list);
      return callback(null, list[0].address, list[0].family);
    });
  };
}

function validateTarget(url, allowAddress, previous) {
  if (!['http:', 'https:'].includes(url.protocol)) throw new UpstreamError(`Unsupported protocol ${url.protocol}`, { code: 'BLOCKED_PROTOCOL' });
  if (url.username || url.password) throw new UpstreamError('Credentials in URLs are not allowed', { code: 'BLOCKED_CREDENTIALS' });
  if (previous?.protocol === 'https:' && url.protocol === 'http:') throw new UpstreamError('Redirect downgraded HTTPS to HTTP', { code: 'BLOCKED_DOWNGRADE' });
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) throw new UpstreamError(`Blocked local hostname ${host}`, { code: 'BLOCKED_ADDRESS' });
  if (net.isIP(host) && !allowAddress(host)) throw new UpstreamError(`Blocked private or reserved address ${host}`, { code: 'BLOCKED_ADDRESS' });
}

function once(url, { method, headers, timeoutMs, maxBytes, allowAddress, signal }) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(url, {
      method, headers: { 'user-agent': 'AKStreams/0.2 (local)', 'accept-encoding': 'gzip, deflate, br', ...headers },
      lookup: guardedLookup(allowAddress), signal, timeout: timeoutMs,
    }, res => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) { res.resume(); return resolve({ redirect: res.headers.location, status }); }
      const declared = Number(res.headers['content-length'] || 0);
      if (declared > maxBytes) { res.destroy(); return reject(new UpstreamError(`Response too large (${declared} bytes)`, { code: 'TOO_LARGE' })); }
      const encoding = String(res.headers['content-encoding'] || '').toLowerCase();
      const stream = encoding === 'gzip' ? res.pipe(zlib.createGunzip()) : encoding === 'deflate' ? res.pipe(zlib.createInflate())
        : encoding === 'br' ? res.pipe(zlib.createBrotliDecompress()) : res;
      const chunks = []; let size = 0;
      stream.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) { res.destroy(); stream.destroy(); reject(new UpstreamError(`Response exceeded ${maxBytes} bytes`, { code: 'TOO_LARGE' })); return; }
        chunks.push(chunk);
      });
      stream.on('end', () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }));
      stream.on('error', error => reject(error));
    });
    req.on('timeout', () => req.destroy(new UpstreamError(`Upstream timed out after ${timeoutMs} ms`, { code: 'TIMEOUT' })));
    req.on('error', error => reject(error instanceof UpstreamError ? error : new UpstreamError(error.code === 'ABORT_ERR' ? 'Request aborted' : `Network error: ${error.code || error.message}`, { code: error.code })));
    req.end();
  });
}

/**
 * @param {string} input
 * @param {{method?:string,headers?:Record<string,string>,timeoutMs?:number,maxBytes?:number,maxRedirects?:number,
 *   allowAddress?:(ip:string)=>boolean,signal?:AbortSignal}} [options]
 */
export async function safeFetch(input, options = {}) {
  const opts = { method: 'GET', headers: {}, timeoutMs: 8000, maxBytes: 2_000_000, maxRedirects: 3,
    allowAddress: ip => !isPrivateAddress(ip), ...options };
  let url;
  try { url = new URL(input); } catch { throw new UpstreamError('Invalid URL', { code: 'INVALID_URL' }); }
  let previous = null;
  await acquire();
  try {
    for (let hop = 0; hop <= opts.maxRedirects; hop++) {
      validateTarget(url, opts.allowAddress, previous);
      const result = await once(url, opts);
      if (!result.redirect) {
        const body = result.body;
        return { ok: result.status >= 200 && result.status < 300, status: result.status, headers: result.headers, url: url.href,
          text: () => body.toString('utf8'), json: () => JSON.parse(body.toString('utf8')) };
      }
      previous = url;
      try { url = new URL(result.redirect, url); } catch { throw new UpstreamError('Invalid redirect location', { code: 'INVALID_URL' }); }
    }
    throw new UpstreamError(`Too many redirects (>${opts.maxRedirects})`, { code: 'TOO_MANY_REDIRECTS' });
  } finally { release(); }
}
