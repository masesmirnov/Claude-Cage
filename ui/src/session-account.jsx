import React, { useEffect, useRef, useState } from "react";
import { InlineSelect } from "./inline-select";
import "./session-account.css";

const failures = {rate_limit:"The request was rate limited. Check the usage limit, then choose to wait or hand off",authentication_failed:"The account sign-in is no longer valid. Sign in again",account_on_hold:"The account is restricted and automatic handoff has stopped",overloaded:"The service is temporarily overloaded; the original account is kept",server_error:"The service had a temporary error; the original account is kept"};

// Desktop and mobile use the same session operation and durable request ID.
export function SessionAccount({ id, request, onChanged, compact = false }) {
  const [open,setOpen]=useState(false), [view,setView]=useState(null), [busy,setBusy]=useState(false), [error,setError]=useState("");
  const [target,setTarget]=useState(""), [confirmed,setConfirmed]=useState(false), [continueTask,setContinueTask]=useState(false);
  const pending=useRef(null), current=useRef({request,onChanged}); current.current={request,onChanged};
  const terminalID=useRef(null);
  const path="/sessions/"+id+"/account";
  useEffect(() => {
    let live=true,timer;
    const load=async()=>{
      try {
        const result=await current.current.request(path,{body:{action:"inspect"}});
        if(live) {
          setView(result); setTarget(previous=>result.candidates.some(a=>a.id===previous)?previous:(result.candidates[0]?.id || ""));
          const next=result.session.desktop_terminal_id;
          if(terminalID.current && next && next!==terminalID.current)current.current.onChanged?.(result.session);
          terminalID.current=next;
        }
      } catch(e) { if(live && open) setError(e.message); }
      if(live) timer=setTimeout(load,open?2000:10000);
    };
    void load(); return()=>{live=false;clearTimeout(timer);};
  },[id,path,open]);
  const change=async(body)=>{
    if(busy)return; setBusy(true);setError("");
    try {
      const result=await current.current.request(path,{body}); setView(result);current.current.onChanged?.(result.session);
      if(body.action==="switch") {pending.current=null;setConfirmed(false);}
    } catch(e){setError(e.message);} finally{setBusy(false);}
  };
  if(!view?.supported)return null;
  const session=view.session, sw=session.account_switch;
  const switching=sw && sw.phase!=="completed";
  return <section className={`session-account ${compact?"session-account--compact":""}`} aria-label="Session account">
    <button type="button" className="quiet-button" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>
      {session.account_label || "Claude account"} · {session.account_failure?"Needs attention":switching?"Handing off":"Bound to session"}
    </button>
    {open && <div className="session-account-options">
      <p>Current account: {session.account_label || session.account_id}. Reconnecting the session keeps this account.</p>
      {session.account_failure && <p role="status">{failures[session.account_failure] || "An error occurred this turn; the original session is kept"}</p>}
      {sw && <p role="status">{sw.phase==="completed"?"Handed off to ":"Handoff target: "}{sw.target_label}{sw.error && ` · ${sw.error}`}</p>}
      <label>Switch authorization for this session<InlineSelect aria-label="Switch authorization for this session" disabled={busy || switching} value={view.switch_policy} onValueChange={policy=>change({action:"policy",policy})}>
        <option value="ask">Ask every time</option><option value="allow">Continue automatically when the usage limit runs out</option><option value="wait">Always wait for the original account</option>
      </InlineSelect></label>
      {!switching && <>
        <label>Handoff account<InlineSelect aria-label="Handoff account" value={target} disabled={busy || !view.candidates.length} onValueChange={value=>{setTarget(value);setConfirmed(false);pending.current=null;}}>
          {view.candidates.length?view.candidates.map(a=><option key={a.id} value={a.id}>{a.label}</option>):<option value="">No available accounts</option>}
        </InlineSelect></label>
        {!view.candidates.length && <p>In account settings, put accounts that may share session history into the same handoff group.</p>}
        <p>The history is continued by the target account, and the cache may be rebuilt. Running tools, background tasks and unconfirmed results block switching.</p>
        <label className="check-line"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} />Allow handing this session's history to the selected account</label>
        <label className="check-line"><input type="checkbox" checked={continueTask} onChange={e=>{setContinueTask(e.target.checked);pending.current=null;}} />Continue the unfinished task after restoring</label>
        <button type="button" disabled={busy || !target || !confirmed} onClick={()=>{
          pending.current ||= {action:"switch",target,request_id:crypto.randomUUID(),source_id:view.source_id,confirm:true,continue:continueTask};
          void change(pending.current);
        }}>{busy?"Handing off…":"Switch and restore history"}</button>
      </>}
      {switching && sw.phase!=="starting" && <button disabled={busy} onClick={()=>change({action:"switch",request_id:sw.id,source_id:view.source_id,target,confirm:true})}>Retry account handoff</button>}
      {switching && sw.phase==="preparing" && <button disabled={busy} onClick={()=>change({action:"cancel",request_id:sw.id})}>Cancel handoff and keep the original account</button>}
      {switching && sw.phase==="starting" && <p>Waiting for the target account to connect. Keep this page open, or reopen it from the session list.</p>}
      {error && <p role="alert">{error}</p>}
    </div>}
  </section>;
}
