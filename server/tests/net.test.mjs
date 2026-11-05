import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { isPrivateAddress, safeFetch, redactSecrets, redactUrl } from '../lib/net.mjs';

test('classifies private, reserved and mapped addresses', () => {
  for (const ip of ['127.0.0.1','10.1.2.3','172.16.0.1','172.31.255.255','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','224.0.0.1',
    '::1','::','fe80::1','fd00::1','::ffff:127.0.0.1','::ffff:7f00:1','64:ff9b::a9fe:a9fe','2002:7f00:1::1','not-an-ip'])
    assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ['8.8.8.8','1.1.1.1','172.32.0.1','2606:4700:4700::1111','::ffff:8.8.8.8'])
    assert.equal(isPrivateAddress(ip), false, ip);
});

function server(handler) {
  return new Promise(resolve => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => resolve(s)); });
}
const loopbackOnly = ip => ip === '127.0.0.1';

test('blocks loopback/private targets by default, including literal IPs and localhost names', async () => {
  for (const url of ['http://127.0.0.1:1/', 'http://localhost/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data', 'http://10.0.0.1/', 'file:///etc/passwd', 'https://user:pw@example.com/'])
    await assert.rejects(safeFetch(url), /Blocked|Unsupported|Credentials/, url);
});

test('re-validates every redirect hop', async t => {
  const s = await server((req, res) => {
    if (req.url === '/to-metadata') { res.writeHead(302, { location: 'http://169.254.169.254/' }); return res.end(); }
    if (req.url === '/to-ipv6') { res.writeHead(301, { location: 'http://[::1]:1/' }); return res.end(); }
    if (req.url === '/loop') { res.writeHead(302, { location: '/loop' }); return res.end(); }
    if (req.url === '/hop') { res.writeHead(307, { location: '/ok' }); return res.end(); }
    res.end('fine');
  });
  t.after(() => s.close());
  const base = `http://127.0.0.1:${s.address().port}`;
  await assert.rejects(safeFetch(`${base}/to-metadata`, { allowAddress: loopbackOnly }), /Blocked private/);
  await assert.rejects(safeFetch(`${base}/to-ipv6`, { allowAddress: loopbackOnly }), /Blocked private/);
  await assert.rejects(safeFetch(`${base}/loop`, { allowAddress: loopbackOnly }), /Too many redirects/);
  const ok = await safeFetch(`${base}/hop`, { allowAddress: loopbackOnly });
  assert.equal(ok.status, 200); assert.equal(ok.text(), 'fine');
});

test('caps body size, honours timeouts and decodes gzip', async t => {
  const zlib = await import('node:zlib');
  const s = await server((req, res) => {
    if (req.url === '/big') { res.writeHead(200); res.write(Buffer.alloc(5000)); return res.end(Buffer.alloc(5000)); }
    if (req.url === '/declared') { res.writeHead(200, { 'content-length': '999999' }); return res.end(); }
    if (req.url === '/slow') return setTimeout(() => res.end('late'), 2000);
    if (req.url === '/gzip') { res.writeHead(200, { 'content-encoding': 'gzip' }); return res.end(zlib.gzipSync(JSON.stringify({ a: 1 }))); }
    res.end();
  });
  t.after(() => { s.closeAllConnections(); s.close(); });
  const base = `http://127.0.0.1:${s.address().port}`;
  await assert.rejects(safeFetch(`${base}/big`, { allowAddress: loopbackOnly, maxBytes: 6000 }), /exceeded/);
  await assert.rejects(safeFetch(`${base}/declared`, { allowAddress: loopbackOnly, maxBytes: 1000 }), /too large/);
  await assert.rejects(safeFetch(`${base}/slow`, { allowAddress: loopbackOnly, timeoutMs: 200 }), /timed out/);
  assert.deepEqual((await safeFetch(`${base}/gzip`, { allowAddress: loopbackOnly })).json(), { a: 1 });
});

test('redacts secrets from messages and URLs', () => {
  assert.equal(redactSecrets('GET https://x.com/a?key=AIzaSECRET&part=1'), 'GET https://x.com/a?key=[redacted]&part=1');
  assert.equal(redactSecrets('https://bob:hunter2@host/p'), 'https://[redacted]@host/p');
  assert.equal(redactUrl('https://host.example/live/list.m3u?token=abc'), 'https://host.example/live/list.m3u');
});
