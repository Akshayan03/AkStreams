import {useEffect,useRef,useState} from 'react';
import {backoffDelay} from './lib/poll';

export function useOnline() {
  const [online,setOnline]=useState(()=>navigator.onLine);
  useEffect(()=>{
    const on=()=>setOnline(true),off=()=>setOnline(false);
    addEventListener('online',on);addEventListener('offline',off);
    return ()=>{removeEventListener('online',on);removeEventListener('offline',off);};
  },[]);
  return online;
}
export function useVisible() {
  const [visible,setVisible]=useState(()=>document.visibilityState!=='hidden');
  useEffect(()=>{
    const f=()=>setVisible(document.visibilityState!=='hidden');
    document.addEventListener('visibilitychange',f);
    return ()=>document.removeEventListener('visibilitychange',f);
  },[]);
  return visible;
}
/**
 * Runs `task` immediately whenever `key` changes, then every `intervalMs` while the page is
 * visible and online (null = no polling). Each run gets an AbortSignal that is aborted on
 * unmount, hide, offline or key change. Failures back off exponentially; returning to the
 * tab refreshes at once if an update is overdue. Returns the consecutive failure count.
 */
export function useRefreshingTask(task:(signal:AbortSignal)=>Promise<void>,intervalMs:number|null,key:string) {
  const visible=useVisible();
  const online=useOnline();
  const taskRef=useRef(task);
  taskRef.current=task;
  const [failures,setFailures]=useState(0);
  const lastRun=useRef(0);
  const lastKey=useRef<string|null>(null);
  useEffect(()=>{
    const fresh=lastKey.current!==key;
    lastKey.current=key;
    const polling=intervalMs!==null&&visible&&online;
    if(!fresh&&!polling)return;
    let timer:ReturnType<typeof setTimeout>|undefined;
    let controller:AbortController|null=null;
    let fails=0,stopped=false,completedOnce=false;
    const schedule=(delay:number)=>{ if(!stopped) timer=setTimeout(run,delay); };
    const run=async()=>{
      lastRun.current=Date.now();
      controller=new AbortController();
      try { await taskRef.current(controller.signal); fails=0; }
      catch(e){ if(controller.signal.aborted||(e as Error).name==='AbortError')return; fails++; }
      completedOnce=true;
      if(stopped)return;
      setFailures(fails);
      if(polling) schedule(backoffDelay(fails,intervalMs!));
    };
    schedule(fresh?0:Math.max(0,intervalMs!-(Date.now()-lastRun.current)));
    return ()=>{
      stopped=true;clearTimeout(timer);controller?.abort();
      if(fresh&&!completedOnce) lastKey.current=null; // aborted before first load: reload next time
    };
  },[key,intervalMs,visible,online]);
  return failures;
}
