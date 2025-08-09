import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import axios from "axios";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui/table";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Calendar } from "./components/ui/calendar";
import { Switch } from "./components/ui/switch";
import { Label } from "./components/ui/label";
import { Toaster } from "./components/ui/sonner";
import { toast } from "sonner";

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
  const [showDeleted, setShowDeleted] = useState(() => localStorage.getItem(`wb.showDeleted:${board?.id}`) === '1');
  const { connected } = useWebSocket(board?.id);
  useEffect(() => { onRealtimeChange?.(connected); }, [connected]);

  const refetch = React.useCallback(() => {
    if (!board) return; const h = getAuthHeaders();
    const params = showDeleted ? { includeDeleted: 1 } : {};
    axios.get(`${API}/boards/${board.id}/groups`, { headers: h }).then((r) => setGroups(r.data));
    axios.get(`${API}/boards/${board.id}/items`, { headers: h, params }).then((r) => setItems(r.data));
  }, [board?.id, showDeleted]);

  useEffect(() => { if (board) refetch(); }, [board?.id, refetch]);
  useEffect(() => { if (!board || connected) return; const t = setInterval(() => refetch(), 5000); return () => clearInterval(t); }, [connected, board?.id, refetch]);

  useEffect(() => {
    const handler = (ev) => { const msg = ev.detail; if (!msg || !board) return; const it = msg.item; if (!it || it.boardId !== board.id) return;
      if (msg.type === "item.created") setItems(prev => [...prev, it]);
      if (msg.type === "item.updated") setItems(prev => prev.map(x => x.id === it.id ? it : x));
      if (msg.type === "item.deleted") setItems(prev => showDeleted ? prev.map(x => x.id === it.id ? it : x) : prev.filter(x => x.id !== it.id));
      if (msg.type === "item.restored") setItems(prev => { const exists = prev.some(x => x.id === it.id); return exists ? prev.map(x => x.id === it.id ? it : x) : [...prev, it]; }); };
    window.addEventListener("wb:ws", handler); return () => window.removeEventListener("wb:ws", handler);
  }, [board?.id, showDeleted]);

  useEffect(() => { localStorage.setItem(`wb.showDeleted:${board?.id}`, showDeleted ? '1' : '0'); }, [showDeleted, board?.id]);

  const laneItems = (groupId, status) => items.filter(it => it.groupId === groupId && it.status === status && (showDeleted || !it.deleted)).sort((a,b) => (a.order||0)-(b.order||0));

  const updateItem = async (item, patch) => { const h = getAuthHeaders(); const res = await axios.patch(`${API}/items/${item.id}`, patch, { headers: h }); return res.data; };
  const createItem = async (groupId, name, statusOpt) => { const h = getAuthHeaders(); const res = await axios.post(`${API}/boards/${board.id}/items`, { name, groupId, order: Date.now(), status: statusOpt }, { headers: h }); const it = res.data; setItems(prev => [...prev, it]); return it; };

  const softDelete = async (item) => {
    // optimistic: mark deleted
    setItems(prev => showDeleted ? prev.map(x => x.id === item.id ? { ...x, deleted: true, deletedAt: new Date().toISOString() } : x) : prev.filter(x => x.id !== item.id));
    const h = getAuthHeaders(); const timerRef = { t: null };
    const undo = async () => { if (timerRef.t) { clearTimeout(timerRef.t); timerRef.t = null; } const it = await updateItem(item, { deleted: false }); setItems(prev => { const exists = prev.some(x => x.id === it.id); return exists ? prev.map(x => x.id === it.id ? it : x) : [...prev, it]; }); };
    toast("Item deleted", { action: { label: "Undo", onClick: undo }, duration: 5000 });
    try { await axios.patch(`${API}/items/${item.id}`, { deleted: true }, { headers: h }); } catch (e) { await undo(); }
  };

  // Keyboard delete
  useEffect(() => {
    const onKey = (e) => { if (!focusId) return; if (e.key === 'Delete') { const it = items.find(x => x.id === focusId); if (it) { e.preventDefault(); softDelete(it); } } };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [focusId, items, showDeleted]);

  const reorderCounter = useRef({});
  const maybeCompact = async (groupId, status, prev, next, idx) => { const key = `${groupId}:${status}`; reorderCounter.current[key] = (reorderCounter.current[key] || 0) + 1; const gap = next != null && prev != null ? Math.abs(next - prev) : 1; if (gap < 1e-3 || reorderCounter.current[key] % 10 === 0) { try { const h = getAuthHeaders(); await axios.post(`${API}/boards/${board.id}/order/compact`, { groupId, status }, { headers: h }); } catch {} } };

  const moveItem = async (item, toGroupId, toStatus, desiredOrder = null) => { const target = laneItems(toGroupId, toStatus); let newOrder = desiredOrder; if (newOrder == null) newOrder = target.length ? (target[target.length - 1].order || 0) + 1 : Date.now(); setItems(prev => prev.map(i => i.id === item.id ? { ...i, groupId: toGroupId, status: toStatus, order: newOrder } : i)); try { const upd = await updateItem(item, { groupId: toGroupId, status: toStatus, order: newOrder }); setItems(prev => prev.map(i => i.id === upd.id ? upd : i)); } catch { /*ignore*/ } };

  const [quickAdd, setQuickAdd] = useState({});

  const KanbanCard = ({ it }) => {
    const [local, setLocal] = useState(it);
    useEffect(() => { setLocal(it); }, [it.id, it.name, it.status, it.assigneeId, it.dueDate, it.deleted]);
    const commit = async (patch) => { setItems(prev => prev.map(x => x.id === it.id ? { ...x, ...patch } : x)); const upd = await updateItem(it, patch); setItems(prev => prev.map(x => x.id === it.id ? upd : x)); };
    return (
      <div className={`kb-card ${it.deleted ? 'deleted' : ''}`} draggable tabIndex={0} data-item-id={it.id}
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
          <div>
            <Button className="btn" onClick={() => softDelete(it)}>Delete</Button>
          </div>
        </div>
      </div>
    );
  };

  const statuses = STATUSES;

  const KanbanView = (
    <div className="content">
      <div className="board-area">
        <div className="board-header">
          <div className="board-title">{board.name}</div>
          <div style={{ display:'flex', gap:12, alignItems:'center' }}>
            <div className="small">Realtime: <span className={"ws-indicator" + (connected ? " ok" : "")} style={{ display:'inline-block', verticalAlign:'middle' }} /></div>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <Label htmlFor="showdel" className="small">Show deleted</Label>
              <Switch id="showdel" checked={showDeleted} onCheckedChange={setShowDeleted} />
            </div>
            <Button className="btn" onClick={async ()=>{ const h = getAuthHeaders(); const res = await axios.get(`${API}/export/items.csv`, { params: { boardId: board.id, includeDeleted: showDeleted ? 1 : 0 }, headers: h, responseType: 'blob' }); const blob = new Blob([res.data], { type: 'text/csv' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `items_${board.id}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); }}>Export CSV</Button>
            <input id="wb-import-file" type="file" accept=".csv" style={{ display:'none' }} onChange={(e)=>handleFilePicked(e.target.files[0])} />
            <Button className="btn" onClick={()=> document.getElementById('wb-import-file').click()}>Import CSV</Button>
          </div>
        </div>
        <div className="kanban">
          {groups.map(g => (
            <div className="kb-swin" key={g.id}>
              <div className="kb-head">{g.name} <span className="small">{items.filter(i=>i.groupId===g.id && (showDeleted || !i.deleted)).length} items</span></div>
              <div className="kb-row">
                {statuses.map(st => (
                  <div key={st} className="kb-lane" data-lane={st} data-group={g.id}
                    onDragOver={(e)=>{ e.preventDefault(); e.currentTarget.classList.add('dragover'); }}
                    onDragLeave={(e)=>{ e.currentTarget.classList.remove('dragover'); }}
                    onDrop={(e)=>{
                      e.preventDefault(); e.currentTarget.classList.remove('dragover');
                      const itemId = e.dataTransfer.getData('text/plain'); const it = items.find(x => x.id === itemId); if (!it) return;
                      const cards = Array.from(e.currentTarget.querySelectorAll('.kb-card')); let idx = 0; for (let i = 0; i < cards.length; i++) { const r = cards[i].getBoundingClientRect(); if (e.clientY < r.top + r.height/2) { idx = i; break; } else { idx = i + 1; } }
                      const lane = laneItems(g.id, st); let prev = null, next = null; if (idx > 0) prev = lane[idx-1]?.order ?? null; if (idx < lane.length) next = lane[idx]?.order ?? null; let newOrder; if (prev == null && next == null) newOrder = Date.now(); else if (prev == null) newOrder = next - 1; else if (next == null) newOrder = prev + 1; else newOrder = (prev + next) / 2; moveItem(it, g.id, st, newOrder); maybeCompact(g.id, st, prev, next, idx);
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
      <div className="item-panel"><div className="small">Tip: Delete key soft-deletes. Undo is available for 5s in the toast.</div></div>
    </div>
  );

  // Export/Import helpers reused
  const handleFilePicked = async (file) => { if (!file) return; const reader = new FileReader(); reader.onload = () => { const txt = reader.result.toString(); const lines = txt.split(/\r?\n/).slice(0, 6).filter(Boolean); if (!lines.length) return; const headers = lines[0].split(',').map(h => h.trim()); const rows = lines.slice(1).map(l => l.split(',')); alert(`Preview: ${headers.join(', ')}\nRows: ${rows.length}`); const h = getAuthHeaders(); const form = new FormData(); form.append('file', file); form.append('boardId', board.id); axios.post(`${API}/import/items.csv?boardId=${board.id}`, form, { headers: h }).then(res => { const data = res.data; toast.success(`Import created ${data.createdCount}. Errors: ${data.errorRows.length}`); if (data.errorRows.length) { const header = 'rowNumber,reason\n'; const csv = header + data.errorRows.map(e => `${e.rowNumber},"${e.reason.replaceAll('"','''')}"`).join('\n'); const blob = new Blob([csv], { type: 'text/csv' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'errors.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); } }).finally(() => { setTimeout(() => { const params = showDeleted ? { includeDeleted: 1 } : {}; axios.get(`${API}/boards/${board.id}/items`, { headers: getAuthHeaders(), params }).then((r) => setItems(r.data)); }, 400); }); }; reader.readAsText(file); };

  if (!board) return <div style={{ padding: 20 }}>Select a board from the left.</div>;

  return KanbanView; // default to Kanban in this simplified render
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
      <Toaster position="bottom-right" />
    </div>
  );
}

export default App;