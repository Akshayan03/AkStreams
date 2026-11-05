import http from 'node:http';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getEvents,getDemoEvents } from './providers/schedule.mjs';
import { getPlaylistChannels } from './providers/playlist.mjs';
import { providerInfo,resolveSources } from './providers/index.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if (existsSync(path.join(root,'.env'))) { try { process.loadEnvFile(path.join(root,'.env')); } catch {} }
const PORT=Number(process.env.PORT || 8787);
const validDate=x=>/^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(new Date(`${x}T12:00:00Z`).getTime());
const send=(res,data,code=200)=>{
  res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*'});
  res.end(JSON.stringify(data));
};
const rateBuckets=new Map();
function limited(ip) {
  const now=Date.now(),prev=rateBuckets.get(ip)||{start:now,count:0};
  if(now-prev.start>60_000) { prev.start=now; prev.count=0; }
  prev.count++;rateBuckets.set(ip,prev);
  if(rateBuckets.size>3000) for(const [key,value] of rateBuckets) if(now-value.start>60_000) rateBuckets.delete(key);
  return prev.count>120;
}
async function request(req,res) {
  if(limited(req.socket.remoteAddress||'unknown')) return send(res,{error:'Rate limit exceeded'},429);
  if(req.method==='OPTIONS') { res.writeHead(204,{'access-control-allow-origin':'*','access-control-allow-methods':'GET,OPTIONS'});return res.end(); }
  if(req.method!=='GET') return send(res,{error:'Method not allowed'},405);
  try {
    const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
    const route=url.pathname;
    if(route==='/health'||route==='/api/health') return send(res,{ok:true,name:'AKStreams API',time:new Date().toISOString()});
    if(route==='/api/providers') return send(res,{providers:providerInfo()});
    if(route==='/api/channels') return send(res,{channels:await getPlaylistChannels()});
    if(route==='/api/events') {
      const date=url.searchParams.get('date')||new Date().toISOString().slice(0,10);
      const sport=url.searchParams.get('sport')||'all';
      if(!validDate(date)||!['all','soccer','basketball'].includes(sport))return send(res,{error:'Invalid date or sport'},400);
      const result=url.searchParams.get('demo')==='1'?getDemoEvents(date,sport):await getEvents(date,sport);
      return send(res,result);
    }
    const streamMatch=route.match(/^\/api\/events\/([^/]+)\/sources$/);
    if(streamMatch) {
      const id=decodeURIComponent(streamMatch[1]);
      const [sport,date,providerId]=id.split('|');
      if(!['soccer','basketball'].includes(sport)||!validDate(date)||!/^[-\w]+$/.test(providerId||'')) return send(res,{error:'Invalid event ID'},400);
      const demo=providerId.startsWith('demo-');
      const payload=demo?getDemoEvents(date,sport):await getEvents(date,sport);
      const event=payload.events.find(e=>e.id===id);
      if(!event)return send(res,{error:'Event not found',upstreamErrors:payload.errors},404);
      const resolution=await resolveSources(event,url.searchParams.get('refresh')==='1');
      return send(res,{event,sources:resolution.sources,providerErrors:resolution.providerErrors,providers:providerInfo()});
    }
    return send(res,{error:'Not found'},404);
  } catch(error) { console.error('API request failed:',error);return send(res,{error:'Unable to complete request',detail:process.env.NODE_ENV==='development'?String(error):undefined},500); }
}
const server=http.createServer((req,res)=>{void request(req,res)});
server.listen(PORT,()=>console.log(`AKStreams API running at http://localhost:${PORT}`));
