import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import axios from "axios";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui/table";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Calendar } from "./components/ui/calendar";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const STATUSES = ["Todo", "Doing", "Done"];
const DEMO_USERS = [
  { id: "u-alex", name: "Alex" },
  { id: "u-jordan", name: "Jordan" },
  { id: "u-riley", name: "Riley" },
  { id: "u-sam", name: "Sam" },
];

const getAuthHeaders = () => {
  let ws = localStorage.getItem("wb.ws");
  let uid = localStorage.getItem("wb.uid");
  if (!ws) { ws = crypto.randomUUID(); localStorage.setItem("wb.ws", ws); }
  if (!uid) { uid = crypto.randomUUID(); localStorage.setItem("wb.uid", uid); }
  return { "X-Workspace-Id": ws, "X-User-Id": uid };
};

function useWebSocket(boardId) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  useEffect(() => {
    if (!boardId) return;
    let url; try { const u = new URL(BACKEND_URL); const wsProto = u.protocol === "https:" ? "wss" : "ws"; url = `${wsProto}://${u.host}/api/ws/boards/${boardId}`; } catch { return; }
    const ws = new WebSocket(url); wsRef.current = ws;
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    ws.onmessage = (ev) => { try { const msg = JSON.parse(ev.data); window.dispatchEvent(new CustomEvent("wb:ws", { detail: msg })); } catch {} };
    const ping = setInterval(() => { try { ws.send("ping"); } catch {} }, 15000);
    return () => { clearInterval(ping); try { ws.close(); } catch {} };
  }, [boardId]);
  return { connected };
}

function Sidebar({ boards, currentBoardId, onSelect }) {
  return (
    <aside className="sidebar">
      <div className="logo"><span className="dot" /><span>WorkBoards</span></div>
      <div className="section-title">Boards</div>
      <div className="boards">
        {boards.map(b => (
          <a key={b.id} href="#" className="board-btn" onClick={(e) => { e.preventDefault(); onSelect(b.id); }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: currentBoardId === b.id ? "#2b6ef3" : "#3b3f4a" }} />
            <span>{b.name}</span>
          </a>
        ))}
      </div>
    </aside>
  )
}

function Topbar({ wsOk = false, view, setView, onExport, onImportOpen }) {
  return (
    <div className="topbar">
      <div className="search"><input placeholder="Search items… (Press /)" /></div>
      <div className="header-actions">
        <div className={"ws-indicator" + (wsOk ? " ok" : "")} title={wsOk ? "Live" : "Disconnected"} />
        <div className="view-toggle">
          <button className={view === 'table' ? 'active' : ''} onClick={() => setView('table')}>Table</button>
          <button className={view === 'kanban' ? 'active' : ''} onClick={() => setView('kanban')}>Kanban</button>
        </div>
        <Button className="btn" onClick={onExport}>Export CSV</Button>
        <Button className="btn" onClick={onImportOpen}>Import CSV</Button>
      </div>
    </div>
  );
}

function EditableText({ value, onCommit, className }) {
  const [v, setV] = useState(value || "");
  const [orig, setOrig] = useState(value || "");
  useEffect(() => { setV(value || ""); setOrig(value || ""); }, [value]);
  return (
    <Input className={className} value={v} onChange={(e)=>setV(e.target.value)}
      onBlur={async ()=>{ if (v !== orig) await onCommit(v); }}
      onKeyDown={(e)=>{ if (e.key === 'Enter') { e.currentTarget.blur(); } if (e.key === 'Escape') { setV(orig); e.currentTarget.blur(); } }} />
  );
}

function StatusSelect({ value, onChange }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[110px]"><SelectValue placeholder="Status" /></SelectTrigger>
      <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function AssigneePicker({ value, onChange }) {
  return (
    <Select value={value || ''} onValueChange={(v)=>onChange(v || null)}>
      <SelectTrigger className="w-[140px]"><SelectValue placeholder="Assign" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="">Unassigned</SelectItem>
        {DEMO_USERS.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function DatePickerInline({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const dateVal = value ? new Date(value) : undefined;
  return (
    <div style={{ position:'relative' }}>
      <Button className="btn" onClick={()=>setOpen(o=>!o)}>{dateVal ? dateVal.toLocaleDateString() : 'Set due'}</Button>
      {open && (
        <div style={{ position:'absolute', zIndex:20, top:'110%', left:0, background:'rgba(0,0,0,0.85)', border:'1px solid var(--wb-border)', borderRadius:12, padding:8 }}>
          <Calendar mode="single" selected={dateVal} onSelect={(d)=>{ setOpen(false); onChange(d ? new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) : null); }} />
        </div>
      )}
    </div>
  );
}

function BoardView({ board, onRealtimeChange, view }) {
  const [groups, setGroups] = useState([]);
  const [items, setItems] = useState([]);
  const [focusId, setFocusId] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importPreview, setImportPreview] = useState({ headers: [], rows: [] });
  const { connected } = useWebSocket(board?.id);
  useEffect(() => { onRealtimeChange?.(connected); }, [connected]);

  const refetch = React.useCallback(() => {
    if (!board) return; const h = getAuthHeaders();
    axios.get(`${API}/boards/${board.id}/groups`, { headers: h }).then((r) => setGroups(r.data));
    axios.get(`${API}/boards/${board.id}/items`, { headers: h }).then((r) => setItems(r.data));
  }, [board?.id]);

  useEffect(() => { if (board) refetch(); }, [board?.id, refetch]);
  useEffect(() => { if (!board || connected) return; const t = setInterval(() => refetch(), 5000); return () => clearInterval(t); }, [connected, board?.id, refetch]);

  useEffect(() => {
    const handler = (ev) => { const msg = ev.detail; if (!msg || !board) return;
      if (msg.type === "item.created" && msg.item.boardId === board.id) setItems(prev => [...prev, msg.item]);
      if (msg.type === "item.updated" && msg.item.boardId === board.id) setItems(prev => prev.map(i => i.id === msg.item.id ? msg.item : i)); };
    window.addEventListener("wb:ws", handler); return () => window.removeEventListener("wb:ws", handler);
  }, [board?.id]);

  const laneItems = (groupId, status) => items.filter(it => it.groupId === groupId && it.status === status).sort((a,b) => (a.order||0)-(b.order||0));

  const updateItem = async (item, patch) => { const h = getAuthHeaders(); const res = await axios.patch(`${API}/items/${item.id}`, patch, { headers: h }); return res.data; };
  const createItem = async (groupId, name, statusOpt) => { const h = getAuthHeaders(); const res = await axios.post(`${API}/boards/${board.id}/items`, { name, groupId, order: Date.now(), status: statusOpt }, { headers: h }); const it = res.data; setItems(prev => [...prev, it]); return it; };

  const reorderCounter = useRef({});
  const maybeCompact = async (groupId, status, prev, next, idx) => { const key = `${groupId}:${status}`; reorderCounter.current[key] = (reorderCounter.current[key] || 0) + 1; const gap = next != null && prev != null ? Math.abs(next - prev) : 1; if (gap < 1e-3 || reorderCounter.current[key] % 10 === 0) { try { const h = getAuthHeaders(); await axios.post(`${API}/boards/${board.id}/order/compact`, { groupId, status }, { headers: h }); } catch {} } };

  const moveItem = async (item, toGroupId, toStatus, desiredOrder = null) => { const target = laneItems(toGroupId, toStatus); let newOrder = desiredOrder; if (newOrder == null) newOrder = target.length ? (target[target.length - 1].order || 0) + 1 : Date.now(); setItems(prev => prev.map(i => i.id === item.id ? { ...i, groupId: toGroupId, status: toStatus, order: newOrder } : i)); try { const upd = await updateItem(item, { groupId: toGroupId, status: toStatus, order: newOrder }); setItems(prev => prev.map(i => i.id === upd.id ? upd : i)); } catch { refetch(); } };

  const [quickAdd, setQuickAdd] = useState({});

  // Export CSV
  const exportCSV = async () => {
    if (!board) return; const h = getAuthHeaders();
    const res = await axios.get(`${API}/export/items.csv`, { params: { boardId: board.id }, headers: h, responseType: 'blob' });
    const blob = new Blob([res.data], { type: 'text/csv' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `items_${board.id}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  // Import CSV: preview first 5 rows
  const handleFilePicked = async (file) => {
    if (!file) return; const reader = new FileReader(); reader.onload = () => { const txt = reader.result.toString(); const lines = txt.split(/\r?\n/).slice(0, 6).filter(Boolean); if (!lines.length) return; const headers = lines[0].split(',').map(h => h.trim()); const rows = lines.slice(1).map(l => l.split(',')); setImportPreview({ headers, rows }); setImportOpen(true); }; reader.readAsText(file);
  };

  const confirmImport = async (file) => {
    if (!file || !board) return; const h = getAuthHeaders(); const form = new FormData(); form.append('file', file); form.append('boardId', board.id); const res = await axios.post(`${API}/import/items.csv?boardId=${board.id}`, form, { headers: h }); const data = res.data; alert(`Import done. Created: ${data.createdCount}, Errors: ${data.errorRows.length}`); if (data.errorRows.length) { const header = 'rowNumber,reason\n'; const csv = header + data.errorRows.map(e => `${e.rowNumber},"${e.reason.replaceAll('"','''')}"`).join('\n'); const blob = new Blob([csv], { type: 'text/csv' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'errors.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); } setImportOpen(false); refetch(); };

  // Keyboard shortcuts for moves (card must be focused)
  useEffect(() => {
    const onKey = (e) => { if (!focusId) return; const it = items.find(x => x.id === focusId); if (!it) return; const laneIndex = STATUSES.indexOf(it.status); if ((e.altKey && e.key === 'ArrowLeft') || (!e.altKey && (e.key === 'h' || e.key === 'H'))) { if (laneIndex > 0) { e.preventDefault(); moveItem(it, it.groupId, STATUSES[laneIndex - 1], null); } } if ((e.altKey && e.key === 'ArrowRight') || (!e.altKey && (e.key === 'l' || e.key === 'L'))) { if (laneIndex < STATUSES.length - 1) { e.preventDefault(); moveItem(it, it.groupId, STATUSES[laneIndex + 1], null); } } if ((e.altKey && e.key === 'ArrowUp') || e.key === 'k' || e.key === 'K') { e.preventDefault(); // move up within lane
      const lane = laneItems(it.groupId, it.status); const idx = lane.findIndex(x => x.id === it.id); if (idx > 0) { const prevPrev = lane[idx-2]?.order ?? null; const prev = lane[idx-1].order; const newOrder = prevPrev == null ? prev - 1 : (prevPrev + prev) / 2; moveItem(it, it.groupId, it.status, newOrder); } }
      if ((e.altKey && e.key === 'ArrowDown') || e.key === 'j' || e.key === 'J') { e.preventDefault(); const lane = laneItems(it.groupId, it.status); const idx = lane.findIndex(x => x.id === it.id); if (idx < lane.length - 1) { const next = lane[idx+1].order; const nextNext = lane[idx+2]?.order ?? null; const newOrder = nextNext == null ? next + 1 : (next + nextNext) / 2; moveItem(it, it.groupId, it.status, newOrder); } } };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [focusId, items]);

  const KanbanCard = ({ it }) => {
    const [local, setLocal] = useState(it);
    useEffect(() => { setLocal(it); }, [it.id, it.name, it.status, it.assigneeId, it.dueDate]);
    const commit = async (patch) => { setItems(prev => prev.map(x => x.id === it.id ? { ...x, ...patch } : x)); const upd = await updateItem(it, patch); setItems(prev => prev.map(x => x.id === it.id ? upd : x)); };
    return (
      <div className="kb-card" draggable tabIndex={0} data-item-id={it.id}
        onFocus={() => setFocusId(it.id)}
        onDragStart={(e)=>{ e.currentTarget.classList.add('dragging'); e.dataTransfer.setData('text/plain', it.id); }}
        onDragEnd={(e)=>{ e.currentTarget.classList.remove('dragging'); }}>
        <div style={{ display:'flex', flexDirection:'column', gap:6, width:'45%' }}>
          <EditableText value={local.name} onCommit={(v)=>commit({ name: v })} />
          <AssigneePicker value={local.assigneeId || ''} onChange={(id)=>commit({ assigneeId: id || null })} />
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:8, alignItems:'flex-end' }}>
          <StatusSelect value={local.status} onChange={(v)=>commit({ status: v })} />
          <DatePickerInline value={local.dueDate} onChange={(d)=>commit({ dueDate: d ? new Date(d).toISOString() : null })} />
        </div>
      </div>
    );
  };

  const statuses = STATUSES;
  const KanbanView = (
    <div className="content">
      <div className="board-area">
        <div className="board-header"><div className="board-title">{board.name}</div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <div className="small">Realtime: <span className={"ws-indicator" + (connected ? " ok" : "")} style={{ display:'inline-block', verticalAlign:'middle' }} /></div>
          </div>
        </div>
        <div className="kanban">
          {groups.map(g => (
            <div className="kb-swin" key={g.id}>
              <div className="kb-head">{g.name} <span className="small">{items.filter(i=>i.groupId===g.id).length} items</span></div>
              <div className="kb-row">
                {statuses.map(st => (
                  <div key={st} className="kb-lane" data-lane={st} data-group={g.id}
                    onDragOver={(e)=>{ e.preventDefault(); e.currentTarget.classList.add('dragover'); }}
                    onDragLeave={(e)=>{ e.currentTarget.classList.remove('dragover'); }}
                    onDrop={(e)=>{
                      e.preventDefault(); e.currentTarget.classList.remove('dragover');
                      const itemId = e.dataTransfer.getData('text/plain'); const it = items.find(x => x.id === itemId); if (!it) return;
                      const cards = Array.from(e.currentTarget.querySelectorAll('.kb-card'));
                      let idx = 0; for (let i = 0; i < cards.length; i++) { const r = cards[i].getBoundingClientRect(); if (e.clientY < r.top + r.height/2) { idx = i; break; } else { idx = i + 1; } }
                      const lane = laneItems(g.id, st);
                      let prev = null, next = null; if (idx > 0) prev = lane[idx-1]?.order ?? null; if (idx < lane.length) next = lane[idx]?.order ?? null;
                      let newOrder; if (prev == null && next == null) newOrder = Date.now(); else if (prev == null) newOrder = next - 1; else if (next == null) newOrder = prev + 1; else newOrder = (prev + next) / 2;
                      moveItem(it, g.id, st, newOrder); maybeCompact(g.id, st, prev, next, idx);
                    }}>
                    {laneItems(g.id, st).map(it => (<KanbanCard key={it.id} it={it} />))}
                    <div style={{ display:'flex', gap:8, alignItems:'center', marginTop:8 }}>
                      <Input placeholder="Quick add…" value={quickAdd[`${g.id}:${st}`] || ''}
                        onChange={(e)=>setQuickAdd(prev => ({ ...prev, [`${g.id}:${st}`]: e.target.value }))}
                        onKeyDown={async (e)=>{ if (e.key === 'Enter') { const title = (quickAdd[`${g.id}:${st}`] || '').trim(); if (!title) return; setQuickAdd(prev => ({ ...prev, [`${g.id}:${st}`]: '' })); await createItem(g.id, title, st); } if (e.key === 'Escape') { setQuickAdd(prev => ({ ...prev, [`${g.id}:${st}`]: '' })); } }} />
                      <Button className="btn" onClick={async ()=>{ const title = (quickAdd[`${g.id}:${st}`] || '').trim(); if (!title) return; setQuickAdd(prev => ({ ...prev, [`${g.id}:${st}`]: '' })); await createItem(g.id, title, st); }}>Add</Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="item-panel"><div className="small">Tip: Alt+←/→ or H/L to move across lanes; Alt+↑/↓ or J/K to reorder in-lane.</div>
        {/* Import modal */}
        {importOpen && (
          <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:50 }}>
            <div style={{ width:620, background:'#111316', border:'1px solid var(--wb-border)', borderRadius:12, padding:16 }}>
              <div style={{ fontWeight:700, marginBottom:8 }}>Import CSV Preview</div>
              <div className="small" style={{ marginBottom:8 }}>Detected headers: {importPreview.headers.join(', ')}</div>
              <div style={{ maxHeight:240, overflow:'auto', border:'1px solid var(--wb-border)', borderRadius:8 }}>
                <table className="table"><tbody>
                  {importPreview.rows.map((r,i)=> (
                    <tr key={i}>{r.map((c,j)=> (<td key={j} className="small" style={{ padding:8, borderBottom:'1px solid var(--wb-border)' }}>{c}</td>))}</tr>
                  ))}
                </tbody></table>
              </div>
              <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:12 }}>
                <Button className="btn" onClick={()=>setImportOpen(false)}>Cancel</Button>
                <Button className="btn" onClick={async ()=>{ const inp = document.getElementById('wb-import-file'); const file = inp && inp.files && inp.files[0]; await confirmImport(file); }}>Import</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  if (!board) return <div style={{ padding: 20 }}>Select a board from the left.</div>;

  return (
    <>
      <div className="content">
        <div className="board-area">
          <div className="board-header">
            <div className="board-title">{board.name}</div>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <input id="wb-import-file" type="file" accept=".csv" style={{ display:'none' }} onChange={(e)=>handleFilePicked(e.target.files[0])} />
              <Topbar wsOk={connected} view={view} setView={()=>{}} onExport={exportCSV} onImportOpen={()=>{ document.getElementById('wb-import-file').click(); }} />
            </div>
          </div>
        </div>
      </div>
      {view === 'kanban' ? (
        // reuse KanbanView inline
        <div style={{ display:'contents' }}>{KanbanView}</div>
      ) : (
        // simplified Table view reusing Kanban editor primitives
        <div className="content"><div className="board-area"><div className="board-header"><div className="board-title">{board.name}</div></div>{groups.map(g => (
          <div key={g.id} className="group"><h4>{g.name} • {items.filter(i=>i.groupId===g.id).length}</h4>
            <Table className="table"><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Status</TableHead><TableHead>Assignee</TableHead><TableHead>Due</TableHead></TableRow></TableHeader>
            <TableBody>{items.filter(i=>i.groupId===g.id).sort((a,b)=> (a.order||0)-(b.order||0)).map(it => (
              <TableRow key={it.id}><TableCell><Input defaultValue={it.name} onBlur={async (e) => { if (e.target.value !== it.name) { const upd = await updateItem(it, { name: e.target.value }); setItems(prev => prev.map(x => x.id === upd.id ? upd : x)); } }} /></TableCell>
              <TableCell><StatusSelect value={it.status} onChange={async (v)=>{ const upd = await updateItem(it, { status: v }); setItems(prev => prev.map(x => x.id === upd.id ? upd : x)); }} /></TableCell>
              <TableCell><AssigneePicker value={it.assigneeId || ''} onChange={async (id)=>{ const upd = await updateItem(it, { assigneeId: id || null }); setItems(prev => prev.map(x => x.id === upd.id ? upd : x)); }} /></TableCell>
              <TableCell className="small">{it.dueDate ? new Date(it.dueDate).toLocaleDateString() : "—"}</TableCell></TableRow>))}
              <TableRow><TableCell colSpan={4}><Button className="btn" onClick={async ()=>{ const name = prompt('Item name?'); if (!name) return; await createItem(g.id, name, 'Todo'); }}>+ Add item</Button></TableCell></TableRow>
            </TableBody></Table>
          </div>
        ))}</div><div className="item-panel" /></div>
      )}
    </>
  );
}

function App() {
  const [boards, setBoards] = useState([]);
  const [currentBoardId, setCurrentBoardId] = useState(null);
  const [currentBoard, setCurrentBoard] = useState(null);
  const [wsOk, setWsOk] = useState(false);
  const [view, setView] = useState(() => localStorage.getItem('wb.view') || 'kanban');

  useEffect(() => { const h = getAuthHeaders(); axios.get(`${API}/bootstrap`, { headers: h }).then((r) => { setBoards(r.data.boards || []); if (r.data.boards?.length) setCurrentBoardId(r.data.boards[0].id); }).catch((e) => console.error("bootstrap failed", e)); }, []);
  useEffect(() => { setCurrentBoard(boards.find(b => b.id === currentBoardId) || null); }, [boards, currentBoardId]);
  useEffect(() => { localStorage.setItem('wb.view', view); }, [view]);

  return (
    <div className="app-shell">
      <Sidebar boards={boards} currentBoardId={currentBoardId} onSelect={setCurrentBoardId} />
      <main style={{ display:'flex', flexDirection:'column', minWidth:0 }}>
        {currentBoard && (
          <BoardView board={currentBoard} onRealtimeChange={setWsOk} view={view} />
        )}
      </main>
    </div>
  );
}

export default App;