import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if (existsSync(path.join(root,'.env'))) { try { process.loadEnvFile(path.join(root,'.env')); } catch (error) { console.warn('Could not read .env:',error.message); } }
const { createApp } = await import('./app.mjs');
const { providerInfo } = await import('./providers/index.mjs');

const PORT=Number(process.env.PORT || 8787);
const HOST=(process.env.HOST || '127.0.0.1').trim();
if(!Number.isInteger(PORT)||PORT<1||PORT>65535) { console.error(`Invalid PORT "${process.env.PORT}"`); process.exit(1); }
// Local-only app: refuse to bind anything but loopback.
if(!['127.0.0.1','localhost','::1'].includes(HOST)) { console.error(`Refusing to bind HOST=${HOST}: AKStreams only listens on loopback (127.0.0.1 or ::1).`); process.exit(1); }

const server=createApp({ port:PORT, distDir:path.join(root,'web','dist'),
  extraOrigins:(process.env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(s=>/^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(s)) });
server.on('error',error=>{
  console.error(error.code==='EADDRINUSE'?`Port ${PORT} is already in use. Set PORT to a free port.`:`Server error: ${error.message}`);
  process.exit(1);
});
server.listen(PORT,HOST,()=>{
  const shown=HOST==='::1'?'[::1]':HOST;
  console.log(`AKStreams running at http://${shown}:${PORT}  (API: /api, health: /health)`);
  for (const p of providerInfo()) console.log(`  provider ${p.id}: ${p.enabled?'configured':'not configured'}${p.issues?.length?` — ${p.issues.join(' ')}`:''}`);
});

let closing=false;
function shutdown(signal) {
  if(closing) return; closing=true;
  console.log(`${signal} received, shutting down…`);
  server.close(()=>{ console.log('AKStreams stopped.'); process.exit(0); });
  server.closeIdleConnections();
  setTimeout(()=>{ server.closeAllConnections(); process.exit(0); },4000).unref();
}
process.on('SIGINT',()=>shutdown('SIGINT'));
process.on('SIGTERM',()=>shutdown('SIGTERM'));
