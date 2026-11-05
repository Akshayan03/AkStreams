import test from 'node:test';
import assert from 'node:assert/strict';
import { matchEventTitle,channelMatchesBroadcaster,isPublicHttpUrl,dedupeSources } from '../lib/match.mjs';
import { parseM3U } from '../providers/playlist.mjs';
import { parseESPN } from '../providers/schedule.mjs';
const match={home:'Toronto Raptors',away:'Boston Celtics',broadcasters:['TSN','NBA League Pass']};
test('requires both teams',()=>{
  assert.equal(matchEventTitle(match,'Toronto Raptors vs Boston Celtics LIVE').status,'playable');
  assert.equal(matchEventTitle(match,'Toronto Raptors highlights').status,'rejected');
  assert.equal(matchEventTitle(match,'Toronto Raptors vs Boston Celtics LIVE watchalong').status,'rejected');
  assert.equal(matchEventTitle(match,'NHL Toronto vs Boston').status,'rejected');
});
test('recognizes channel names as candidates',()=>{
  assert.equal(channelMatchesBroadcaster('TSN',match.broadcasters),true);
  assert.equal(channelMatchesBroadcaster('Sky Sports',match.broadcasters),false);
});
test('parses and validates playlist',()=>{
  const list=parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="Raptors vs Celtics" group-title="Sports",Game\nhttps://example.com/live.m3u8\n#EXTINF:-1,Local\nhttp://127.0.0.1/secret\n');
  assert.equal(list.length,1);
  assert.equal(list[0].title,'Raptors vs Celtics');
  assert.equal(list[0].kind,'hls');
  assert.equal(isPublicHttpUrl('http://localhost/a'),false);
  assert.equal(isPublicHttpUrl('https://example.com/a'),true);
});
test('deduplicates stream URLs',()=>{
  const src={kind:'hls',url:'https://example.com/video.m3u8',confidence:75};
  assert.equal(dedupeSources([src,src]).length,1);
});
test('maps ESPN events',()=>{
  const raw={events:[{id:'123',date:'2026-11-02T22:30:00Z',status:{type:{state:'in'}},competitions:[{competitors:[
    {homeAway:'home',team:{displayName:'Boston Celtics'},score:'70'},
    {homeAway:'away',team:{displayName:'Toronto Raptors'},score:'65'}],broadcasts:[{names:['TSN']}]}]}]};
  const [evt]=parseESPN(raw,'basketball','NBA','2026-11-02');
  assert.equal(evt.status,'live');assert.equal(evt.home,'Boston Celtics');assert.deepEqual(evt.broadcasters,['TSN']);
});
test('matches numbered broadcaster channels but not unrelated ones',()=>{
  assert.equal(channelMatchesBroadcaster('TSN 1',['TSN']),true);
  assert.equal(channelMatchesBroadcaster('TSNX',['TSN']),false);
  assert.equal(channelMatchesBroadcaster('Sky Sports Main Event',['Sky Sports']),true);
});
test('ranks title matches above candidates and embeddable above external',()=>{
  const list=dedupeSources([
    {kind:'hls',url:'a',confidence:55,status:'candidate',title:'c'},
    {kind:'external',url:'b',confidence:98,status:'playable',title:'b'},
    {kind:'youtube',url:'c',confidence:98,status:'playable',title:'a'}]);
  assert.deepEqual(list.map(s=>s.url),['c','b','a']);
});
test('rejects private, IPv6-loopback and numeric-host stream URLs',()=>{
  for (const u of ['http://[::1]/x','http://169.254.169.254/','http://2130706433/','http://printer.local/x','https://x.internal/a','ftp://example.com/a'])
    assert.equal(isPublicHttpUrl(u),false,u);
  assert.equal(isPublicHttpUrl('https://cdn.example.com/live.m3u8'),true);
});
