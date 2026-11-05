import http from 'node:http';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { getEvents,getDemoEvents,getEventById,isValidDate,isValidTimeZone,todayIn,SERVER_TIME_ZONE } from './providers/schedule.mjs';
import { getPlaylistChannels } from './providers/playlist.mjs';
import { providerInfo,resolveSources,demoStreamsEnabled,forgetSources } from './providers/index.mjs';
import { getOfficialBroadcasts } from './providers/official.mjs';
import { listCustom,addCustom,updateCustom,removeCustom,openUrl,customChannels,warmCustom,InputError } from './providers/custom.mjs';
import { redactSecrets } from './lib/net.mjs';

const LOOPBACK_HOSTS = new Set(['localhost','127.0.0.1','[::1]','::1']);
const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
  '.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.json':'application/json','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8','.webmanifest':'application/manifest+json' };
export const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: https:",
  "media-src 'self' blob: https: http:", "connect-src 'self' https: http:", "worker-src 'self' blob:",
  "frame-src https://www.youtube-nocookie.com https://www.youtube.com", "font-src 'self'", "object-src 'none'",
  "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join('; ');
const SECURITY_HEADERS = { 'x-content-type-options':'nosniff', 'referrer-policy':'strict-origin-when-cross-origin',
  'x-frame-options':'DENY', 'cross-origin-opener-policy':'same-origin', 'content-security-policy':CSP };
const EVENT_ID_RE = /^(soccer|basketball)\|(\d{4}-\d{2}-\d{2})\|([-\w]{1,40})$/;
const MAX_BODY_BYTES = 16_384;
const CUSTOM_RE = /^\/api\/custom-sources(?:\/([a-f0-9]{16})(\/open)?)?$/;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, tooLarge = false;
    req.on('data', chunk => {
      size += chunk.length;
      // Keep draining (bounded by requestTimeout) so the 413 response can still be delivered.
      if (size > MAX_BODY_BYTES) { if (!tooLarge) { tooLarge = true; chunks.length = 0; reject(new InputError('Request body too large.', 413)); } return; }
      chunks.push(chunk);
    });
    req.on('end', () => { if (tooLarge) return; try { resolve(size ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new InputError('Request body is not valid JSON.')); } });
    req.on('error', reject);
  });
}

/**
 * @param {{port:number, distDir:string, extraHosts?:string[], extraOrigins?:string[], rateLimit?:number}} options
 */
export function createApp({ port, distDir, extraHosts = [], extraOrigins = [], rateLimit = 240 }) {
  const allowedHosts = new Set([...LOOPBACK_HOSTS, ...extraHosts.map(h => h.toLowerCase())]);
  const allowedOrigins = () => new Set([`http://localhost:${port}`,`http://127.0.0.1:${port}`,`http://[::1]:${port}`,
    'http://localhost:5173','http://127.0.0.1:5173', ...extraOrigins]);
  const rateBuckets=new Map();
  function limited(ip) {
    const now=Date.now(),prev=rateBuckets.get(ip)||{start:now,count:0};
    if(now-prev.start>60_000) { prev.start=now; prev.count=0; }
    prev.count++;rateBuckets.set(ip,prev);
    if(rateBuckets.size>3000) for(const [key,value] of rateBuckets) if(now-value.start>60_000) rateBuckets.delete(key);
    return prev.count>rateLimit;
  }
  const send=(res,data,code=200,extra={})=>{
    res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...SECURITY_HEADERS,...extra});
    res.end(JSON.stringify(data));
  };
  async function serveStatic(req,res,pathname) {
    let rel;
    try { rel = decodeURIComponent(pathname); } catch { return send(res,{error:'Bad path'},400); }
    if (rel.includes('\0')) return send(res,{error:'Bad path'},400);
    let file = path.resolve(distDir, `.${path.posix.normalize(rel)}`);
    if (file !== distDir && !file.startsWith(distDir + path.sep)) return send(res,{error:'Not found'},404);
    let info = await stat(file).catch(() => null);
    if (!info || info.isDirectory()) {
      if (path.extname(rel)) return send(res,{error:'Not found'},404);
      file = path.join(distDir,'index.html'); info = await stat(file).catch(() => null);
      if (!info) { res.writeHead(503,{'content-type':'text/plain; charset=utf-8',...SECURITY_HEADERS}); return res.end('AKStreams web build not found. Run `npm run build` (or `npm start`, which builds first).\n'); }
    }
    const immutable = rel.startsWith('/assets/');
    res.writeHead(200,{'content-type':MIME[path.extname(file)]||'application/octet-stream','content-length':info.size,
      'cache-control':immutable?'public, max-age=31536000, immutable':'no-cache',...SECURITY_HEADERS});
    if (req.method==='HEAD') return res.end();
    createReadStream(file).on('error',()=>res.destroy()).pipe(res);
  }
  async function request(req,res) {
    // DNS-rebinding guard: only answer to loopback host names.
    const hostHeader=String(req.headers.host||'').toLowerCase();
    const hostname=hostHeader.startsWith('[') ? hostHeader.slice(0, hostHeader.indexOf(']')+1) : hostHeader.split(':')[0];
    if(!allowedHosts.has(hostname)) return send(res,{error:'Host not allowed'},421);
    const origin=req.headers.origin;
    const originOk=!origin || allowedOrigins().has(origin);
    const cors=origin && originOk ? {'access-control-allow-origin':origin,'vary':'Origin'} : {};
    if(limited(req.socket.remoteAddress||'unknown')) return send(res,{error:'Rate limit exceeded'},429,{'retry-after':'30'});
    if(req.method==='OPTIONS') { res.writeHead(originOk?204:403,{...cors,'access-control-allow-methods':'GET,HEAD,POST,PATCH,DELETE,OPTIONS','access-control-allow-headers':'content-type','access-control-max-age':'600'});return res.end(); }
    let url;
    try { url=new URL(req.url,'http://localhost'); } catch { return send(res,{error:'Bad request'},400); }
    const route=url.pathname;
    const mutating=['POST','PATCH','DELETE'].includes(req.method);
    if(req.method!=='GET'&&req.method!=='HEAD'&&!(mutating&&CUSTOM_RE.test(route))) return send(res,{error:'Method not allowed'},405,{allow:'GET, HEAD, OPTIONS'});
    if(mutating) {
      // CSRF: writes need an allowed Origin, a same-site fetch and a JSON body (forces CORS preflight).
      const site=String(req.headers['sec-fetch-site']||'');
      if(!origin||!originOk||(site&&!['same-origin','same-site'].includes(site))) return send(res,{error:'Cross-site request refused'},403);
      if(req.method!=='DELETE'&&!/^application\/json\b/i.test(String(req.headers['content-type']||''))) return send(res,{error:'Expected Content-Type: application/json'},415,cors);
    }
    if(!route.startsWith('/api/') && route!=='/health') return serveStatic(req,res,route);
    if(!originOk) return send(res,{error:'Origin not allowed'},403);
    try {
      if(route==='/health'||route==='/api/health') return send(res,{ok:true,name:'AKStreams API',time:new Date().toISOString(),timeZone:SERVER_TIME_ZONE},200,cors);
      if(route==='/api/providers') { await warmCustom(); return send(res,{providers:providerInfo(),demoStreams:demoStreamsEnabled()},200,cors); }
      if(route==='/api/channels') {
        const [playlist,mine]=await Promise.all([getPlaylistChannels(),customChannels()]);
        return send(res,{...playlist,channels:[...mine,...playlist.channels],configured:playlist.configured||mine.length>0},200,cors);
      }
      if(route==='/api/official') return send(res,await getOfficialBroadcasts(),200,cors);
      const custom=route.match(CUSTOM_RE);
      if(custom) {
        const [,id,open]=custom;
        if(open) {
          if(req.method!=='GET'&&req.method!=='HEAD') return send(res,{error:'Method not allowed'},405,cors);
          if(req.headers['sec-fetch-site']==='cross-site') return send(res,{error:'Cross-site request refused'},403);
          const target=await openUrl(id);
          if(!target) return send(res,{error:'Unknown or disabled source'},404,cors);
          res.writeHead(302,{...SECURITY_HEADERS,...cors,location:target,'cache-control':'no-store','referrer-policy':'no-referrer'});
          return res.end();
        }
        try {
          if(!id&&(req.method==='GET'||req.method==='HEAD')) return send(res,await listCustom(),200,cors);
          if(!id&&req.method==='POST') {
            const source=await addCustom(await readJsonBody(req));
            forgetSources([source.eventId]);
            console.log(`Owner source added: ${source.kind} ${source.displayUrl}${source.eventId?` (attached to ${source.eventId})`:''}`);
            return send(res,{source},201,cors);
          }
          if(id&&req.method==='PATCH') { const {source,affected}=await updateCustom(id,await readJsonBody(req)); forgetSources(affected); return send(res,{source},200,cors); }
          if(id&&req.method==='DELETE') { const {affected}=await removeCustom(id); forgetSources(affected); res.writeHead(204,{...SECURITY_HEADERS,...cors}); return res.end(); }
          return send(res,{error:'Method not allowed'},405,cors);
        } catch(error) {
          if(error instanceof InputError) return send(res,{error:error.message},error.status,cors);
          throw error;
        }
      }
      if(route==='/api/events') {
        const tz=url.searchParams.get('tz')||SERVER_TIME_ZONE;
        if(!isValidTimeZone(tz)) return send(res,{error:'Invalid time zone'},400,cors);
        const date=url.searchParams.get('date')||todayIn(tz);
        const sport=url.searchParams.get('sport')||'all';
        if(!isValidDate(date)) return send(res,{error:'Invalid date (expected YYYY-MM-DD between 2000 and 2100)'},400,cors);
        if(!['all','soccer','basketball'].includes(sport)) return send(res,{error:'Invalid sport (all, soccer or basketball)'},400,cors);
        const result=url.searchParams.get('demo')==='1'?getDemoEvents(date,sport,tz):await getEvents(date,sport,tz);
        return send(res,result,200,cors);
      }
      const eventMatch=route.match(/^\/api\/events\/([^/]+)(\/sources)?$/);
      if(eventMatch) {
        let id;
        try { id=decodeURIComponent(eventMatch[1]); } catch { return send(res,{error:'Invalid event ID'},400,cors); }
        const parsed=id.match(EVENT_ID_RE);
        if(!parsed||!isValidDate(parsed[2])) return send(res,{error:'Invalid event ID'},400,cors);
        const {event,errors}=await getEventById(id);
        if(!event) return send(res,{error:errors.length?'Schedule provider unavailable; could not load this event':'Event not found',upstreamErrors:errors},errors.length?502:404,cors);
        if(!eventMatch[2]) return send(res,{event,fetchedAt:new Date().toISOString()},200,cors);
        const resolution=await resolveSources(event,url.searchParams.get('refresh')==='1');
        return send(res,{event,...resolution,providers:providerInfo()},200,cors);
      }
      return send(res,{error:'Not found'},404,cors);
    } catch(error) {
      console.error('API request failed:',route,redactSecrets(error?.message||error));
      return send(res,{error:'Unable to complete request'},500,cors);
    }
  }
  const server=http.createServer((req,res)=>{ request(req,res).catch(error=>{ console.error('Unhandled request error:',redactSecrets(error?.message||error)); if(!res.headersSent) send(res,{error:'Internal error'},500); else res.destroy(); }); });
  server.requestTimeout=30_000; server.headersTimeout=15_000; server.keepAliveTimeout=5_000;
  server.maxHeadersCount=60;
  return server;
}
