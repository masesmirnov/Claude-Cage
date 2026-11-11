import React, {useEffect, useRef, useState} from "react";
import {ArrowLeft, Bookmark, BookmarkMinus, BookmarkPlus, Check, ChevronDown, ChevronRight, Folder, RefreshCw} from "lucide-react";
import {InlineSelect} from "./inline-select";
import {browserRequest} from "./transport.mjs";

function webURL(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url : null;
  } catch { return null; }
}

export function PhoneFavorites({frame, navigate, onClose}) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState(null);
  const back = useRef(null);
  const [folderID, setFolderID] = useState("");
  const [expanded, setExpanded] = useState(() => new Set());
  const request = useRef(null);
  const page = webURL(frame.url);
  const saved = data?.items.find(item => item.url === frame.url);

  const sync = async (body) => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setError("");
    try {
      const next = await browserRequest("/favorites", {body,signal:controller.signal});
      if (controller.signal.aborted) return;
      if (!Array.isArray(next?.items) || !Array.isArray(next?.folders)) throw new Error("The favorites returned by the computer have an invalid format. Update Cage on the computer.");
      setData(next);
      setFolderID(previous => next.folders.some(folder => folder.id === previous) ? previous : "");
      if (body) {
        setEditor(null);
        if (body.folder_id) setExpanded(previous => new Set(previous).add(body.folder_id));
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      setData(null); setEditor(null);
      const unsupported = e.status === 404 || e.status === 405 || e instanceof SyntaxError;
      setError(unsupported ? "This computer does not support shared favorites yet. Update Cage on the computer." :
        body && !e.status ? "The save result is unconfirmed. Refresh the favorites." : e.message);
    } finally {
      if (request.current === controller) {
        request.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
  };
  useEffect(() => {
    back.current?.focus({preventScroll:true});
    void sync();
    return () => {request.current?.abort(); request.current = null;};
  }, []);

  const open = async url => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      if (await navigate(url)) onClose();
      else setError("The web page is not open yet. Check the remote connection.");
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const remove = item => sync({action:"delete", id:item.id});
  const entries = items => <ul className="phone-bookmarks">{items.map(item =>
    <li key={item.id}>
      <button className="bookmark-open" type="button" disabled={busy} onClick={() => open(item.url)}>
        <Bookmark size={16}/><span><strong>{item.title || item.url}</strong><small>{webURL(item.url)?.host || item.url}</small></span>
      </button>
      <button className="icon-button" type="button" disabled={busy} aria-label={"Remove favorite " + (item.title || item.url)}
        onClick={() => remove(item)}><BookmarkMinus size={17}/></button>
    </li>
  )}</ul>;

  return <section className="phone-favorites" aria-label="Favorites on the computer">
    <div className="bookmark-heading"><button className="icon-button" type="button" ref={back} aria-label="Back to the web page" onClick={onClose}><ArrowLeft size={18}/></button><h2>Favorites</h2>
      <button className="icon-button" type="button" disabled={busy} aria-label="Refresh favorites" onClick={() => sync()}><RefreshCw size={18}/></button>
    </div>
    {error && <p className="notice" role="alert">{error}</p>}
    {!data && !error && <p className="nav-note" role="status">Reading the favorites on the computer…</p>}
    {data && <>
      {page && <div className="bookmark-current">
        {editor?.url === frame.url && !saved ? <form onSubmit={event => {
          event.preventDefault();
          void sync({action:"save",title:editor.title,url:editor.url,folder_id:folderID});
        }}>
          <InlineSelect label="Save to" value={folderID} disabled={busy} onChange={setFolderID} icon={<Folder size={16}/>}
            options={[{value:"",label:"Uncategorized"}, ...data.folders.map(folder => ({value:folder.id,label:folder.title}))]} />
          <div className="bookmark-save-actions">
            <button className="action" type="button" disabled={busy} onClick={() => setEditor(null)}>Cancel</button>
            <button className="action primary" type="submit" disabled={busy}><Check size={15}/>Save favorite</button>
          </div>
        </form> : <button className="action secondary" type="button" disabled={busy} onClick={() => {
          if (saved) void remove(saved);
          else {setFolderID(""); setEditor({url:frame.url,title:Array.from(frame.title?.trim() || page.host).slice(0,250).join("")});}
        }}>{saved ? <BookmarkMinus size={17}/> : <BookmarkPlus size={17}/>}{saved ? "Remove this page from favorites" : "Favorite this page"}</button>}
      </div>}
      {data.folders.map(folder => {
        const shown = expanded.has(folder.id);
        const items = data.items.filter(item => item.folder_id === folder.id);
        return <div key={folder.id} className="bookmark-folder">
          <button type="button" className="bookmark-folder-trigger" aria-expanded={shown} onClick={() => setExpanded(previous => {
            const next = new Set(previous);
            if (next.has(folder.id)) next.delete(folder.id); else next.add(folder.id);
            return next;
          })}>{shown ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}<Folder size={17}/><span>{folder.title}</span></button>
          {shown && (items.length ? entries(items) : <p className="tree-empty">This folder has no favorites yet</p>)}
        </div>;
      })}
      {entries(data.items.filter(item => !item.folder_id || !data.folders.some(folder => folder.id === item.folder_id)))}
      {!data.folders.length && !data.items.length && <p className="nav-note">No favorites yet.</p>}
    </>}
  </section>;
}
