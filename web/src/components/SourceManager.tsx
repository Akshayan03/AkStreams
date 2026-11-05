import {useCallback,useEffect,useState} from 'react';
import type {FormEvent} from 'react';
import {CheckCircle2,Link2,Plus,RefreshCw,Trash2} from 'lucide-react';
import * as api from '../api';
import type {CustomList,CustomSource} from '../types';
import {timeAgo} from '../lib/time';
import {LiveStatusPill,Pill} from './ui';

const KIND={hls:'HLS stream',youtube:'YouTube (embedded)',external:'Web page (opens in new tab)'} as const;
const message=(e:unknown)=>e instanceof Error?e.message:String(e);

/** Owner-authorized source import. With an event, the source is attached to that game only. */
export function AddSourceForm({eventId=null,eventLabel='',onAdded,onCancel}:{eventId?:string|null;eventLabel?:string;onAdded:(s:CustomSource)=>void;onCancel?:()=>void}) {
  const [url,setUrl]=useState('');
  const [label,setLabel]=useState('');
  const [attach,setAttach]=useState(Boolean(eventId));
  const [authorized,setAuthorized]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [added,setAdded]=useState<CustomSource|null>(null);
  async function submit(e:FormEvent) {
    e.preventDefault();
    setBusy(true);setError('');setAdded(null);
    try {
      const {source}=await api.addSource({url,label,authorized,...(attach&&eventId?{eventId,eventLabel}:{})});
      setAdded(source);setUrl('');setLabel('');setAuthorized(false);onAdded(source);
    } catch(err) { setError(message(err)); }
    finally { setBusy(false); }
  }
  return <form className="add-source" onSubmit={submit} aria-label="Add source">
    <div className="add-source-head"><strong><Plus size={15}/> Add a source you're authorized to watch</strong>
      {onCancel&&<button type="button" className="link-button" onClick={onCancel}>Close</button>}</div>
    <label className="field"><span>Stream or watch URL</span>
      <input type="url" required inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://… (.m3u8, YouTube video/live link, or official watch page)" value={url} onChange={e=>setUrl(e.target.value)}/></label>
    <label className="field"><span>Label <small>(optional)</small></span>
      <input type="text" maxLength={120} placeholder="e.g. Team official stream" value={label} onChange={e=>setLabel(e.target.value)}/></label>
    {eventId&&<label className="check"><input type="checkbox" checked={attach} onChange={e=>setAttach(e.target.checked)}/><span>Attach to this game only ({eventLabel})</span></label>}
    <label className="check"><input type="checkbox" required checked={authorized} onChange={e=>setAuthorized(e.target.checked)}/><span>I'm authorized to watch this source (an official service, or a stream I own or subscribe to).</span></label>
    <p className="muted small-print">The URL is checked from this computer. Private or local network addresses are rejected. It is saved only in a git-ignored file on this machine, and any tokens in it are never shown back. Direct HLS and YouTube links play inside AKStreams; other pages open on their own site.</p>
    {error&&<div className="alert small" role="alert">{error}</div>}
    {added&&<div className="success-note" role="status"><CheckCircle2 size={15}/> Saved “{added.label}” · {KIND[added.kind]} · {added.displayUrl}{added.check&&!added.check.ok?` · ${added.check.detail}`:''}</div>}
    <div className="error-actions"><button className="primary-button" type="submit" disabled={busy}>{busy?'Checking…':'Save source'}</button></div>
  </form>;
}

export function MySourcesView({onOpenEvent}:{onOpenEvent:(eventId:string)=>void}) {
  const [data,setData]=useState<CustomList|null>(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);
  const [confirm,setConfirm]=useState<string|null>(null);
  const load=useCallback((signal?:AbortSignal)=>{
    setLoading(true);
    api.customSources(signal).then(d=>{setData(d);setError('');}).catch(e=>{ if((e as Error).name!=='AbortError') setError(message(e)); }).finally(()=>setLoading(false));
  },[]);
  useEffect(()=>{ const c=new AbortController(); load(c.signal); return ()=>c.abort(); },[load]);
  const act=async(fn:()=>Promise<unknown>)=>{ try { await fn(); setConfirm(null); load(); } catch(e){ setError(message(e)); } };
  const list=data?.sources??[];
  return <main className="main-content" id="main">
    <div className="section-intro with-action"><div><div className="eyebrow">WORKSPACE</div><h1>My sources</h1>
      <p>Streams and official watch links you have added. A source attached to a game is offered only for that game. Unattached sources are listed under Live channels and are never shown as a confirmed game.</p></div>
      <button className="icon-button" onClick={()=>load()} aria-label="Reload my sources" disabled={loading}><RefreshCw size={18} className={loading?'spinning':''}/></button></div>
    {error&&<div className="alert" role="alert">{error}</div>}
    <AddSourceForm onAdded={()=>load()}/>
    <h2 className="list-title">Saved <span className="title-count">{list.length}</span></h2>
    {data&&!list.length&&<div className="empty-state"><Link2 size={28}/><h3>No sources yet</h3><p>Open a game and choose "Add source" to attach a stream to it, or add a general channel above.</p></div>}
    <ul className="my-sources" aria-label="Saved sources">{list.map(s=><li key={s.id} className={`my-source ${s.enabled?'':'is-disabled'}`} data-source-id={s.id}>
      <div className="my-source-main">
        <strong>{s.label}</strong>
        <small>{KIND[s.kind]} · <code>{s.displayUrl}</code></small>
        <small>{s.eventId?<>Attached to <button className="link-button inline" onClick={()=>onOpenEvent(s.eventId!)}>{s.eventLabel||s.eventId}</button></>:'Not attached to a game (channel)'} · added {timeAgo(s.createdAt)}</small>
        {s.check&&<small className={s.check.ok?'':'warn-text'}>{s.check.detail}</small>}
      </div>
      <div className="my-source-side">
        <Pill tone={s.enabled?'ok':undefined}>{s.enabled?'ENABLED':'DISABLED'}</Pill>
        {s.check&&s.check.liveStatus!=='unknown'&&<LiveStatusPill status={s.check.liveStatus}/>}
        <button className="secondary-button" onClick={()=>act(()=>api.updateSource(s.id,{enabled:!s.enabled}))}>{s.enabled?'Disable':'Enable'}</button>
        {confirm===s.id
          ?<button className="secondary-button danger" onClick={()=>act(()=>api.removeSource(s.id))}><Trash2 size={14}/> Confirm remove</button>
          :<button className="secondary-button" onClick={()=>setConfirm(s.id)} aria-label={`Remove ${s.label}`}><Trash2 size={14}/> Remove</button>}
      </div>
    </li>)}</ul>
    {data&&<p className="muted small-print">Stored in <code>{data.storedIn}</code> on this computer (git-ignored, owner-only file permissions). Delete that file to remove everything.</p>}
  </main>;
}
