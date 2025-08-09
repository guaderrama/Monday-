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
import { Avatar, AvatarFallback } from "./components/ui/avatar";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const STATUSES = ["Todo", "Doing", "Done"];

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

function AssigneePicker({ members, value, onChange, size = 20 }) {
  const selected = members.find(m => m.id === value);
  const initials = selected ? (selected.displayName || selected.username).split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2) : '•';
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
      <Avatar style={{ width:size, height:size }}><AvatarFallback>{initials}</AvatarFallback></Avatar>
      <Select value={value || ''} onValueChange={(v)=>onChange(v || null)}>
        <SelectTrigger className="w-[160px]"><SelectValue placeholder="Assign" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="">Unassigned</SelectItem>
          {members.map(u => <SelectItem key={u.id} value={u.id}>{u.displayName || u.username}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
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

function BoardView({ board, onRealtimeChange }) {
  const [groups, setGroups] = useState([]);
  const [items, setItems] = useState([]);
  const [members, setMembers] = useState([]);
  const [assigneeFilter, setAssigneeFilter] = useState(() => localStorage.getItem(`wb.assigneeFilter:${board?.id}`) || 'all');
  const [focusId, setFocusId] = useState(null);
  const [showDeleted, setShowDeleted] = useState(() => localStorage.getItem(`wb.showDeleted:${board?.id}`) === '1');
  const [view, setView] = useState(() => localStorage.getItem('wb.view') || 'kanban');
  const { connected } = useWebSocket(board?.id);
  useEffect(() => { onRealtimeChange?.(connected); }, [connected]);

  const refetch = React.useCallback(() => {
    if (!board) return; const h = getAuthHeaders();
    const params = showDeleted ? { includeDeleted: 1 } : {};
    axios.get(`${API}/members`, { headers: h }).then(r => setMembers(r.data));
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
  useEffect(() => { localStorage.setItem(`wb.assigneeFilter:${board?.id}`, assigneeFilter); }, [assigneeFilter, board?.id]);
  useEffect(() => { localStorage.setItem('wb.view', view); }, [view]);

  const assigneeMatches = (it) => {
    if (assigneeFilter === 'all') return true;
    if (assigneeFilter === 'unassigned') return !it.assigneeId;
    return it.assigneeId === assigneeFilter;
  };

  const laneItems = (groupId, status) => items
    .filter(it => it.groupId === groupId && it.status === status && (showDeleted || !it.deleted) && assigneeMatches(it))
    .sort((a,b) => (a.order||0)-(b.order||0));

  const updateItem = async (item, patch) => { const h = getAuthHeaders(); const res = await axios.patch(`${API}/items/${item.id}`, patch, { headers: h }); return res.data; };
  const createItem = async (groupId, name, statusOpt) => { const h = getAuthHeaders(); const res = await axios.post(`${API}/boards/${board.id}/items`, { name, groupId, order: Date.now(), status: statusOpt }, { headers: h }); const it = res.data; setItems(prev => [...prev, it]); return it; };

  const exportCSV = async () => {
    if (!board) return; const h = getAuthHeaders();
    const params = { boardId: board.id, includeDeleted: showDeleted ? 1 : 0 };
    if (assigneeFilter === 'unassigned') params.unassigned = 1;
    else if (assigneeFilter !== 'all') params.assigneeId = assigneeFilter;
    const res = await axios.get(`${API}/export/items.csv`, { params, headers: h, responseType: 'blob' });
    const blob = new Blob([res.data], { type: 'text/csv' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `items_${board.id}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  const softDelete = async (item) => {
    setItems(prev => showDeleted ? prev.map(x => x.id === item.id ? { ...x, deleted: true, deletedAt: new Date().toISOString() } : x) : prev.filter(x => x.id !== item.id));
    const h = getAuthHeaders(); const undo = async () => { const it = await updateItem(item, { deleted: false }); setItems(prev => { const exists = prev.some(x => x.id === it.id); return exists ? prev.map(x => x.id === it.id ? it : x) : [...prev, it]; }); };
    toast("Item deleted", { action: { label: "Undo", onClick: undo }, duration: 5000 });
    try { await axios.patch(`${API}/items/${item.id}`, { deleted: true }, { headers: h }); } catch { await undo(); }
  };

  // Keyboard delete
  useEffect(() => { const onKey = (e) => { if (!focusId) return; if (e.key === 'Delete') { const it = items.find(x => x.id === focusId); if (it) { e.preventDefault(); softDelete(it); } } }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [focusId, items, showDeleted]);

  const reorderCounter = useRef({});
  const maybeCompact = async (groupId, status, prev, next, idx) => { const key = `${groupId}:${status}`; reorderCounter.current[key] = (reorderCounter.current[key] || 0) + 1; const gap = next != null && prev != null ? Math.abs(next - prev) : 1; if (gap < 1e-3 || reorderCounter.current[key] % 10 === 0) { try { const h = getAuthHeaders(); await axios.post(`${API}/boards/${board.id}/order/compact`, { groupId, status }, { headers: h }); } catch {} } };

  const moveItem = async (item, toGroupId, toStatus, desiredOrder = null) => { const target = laneItems(toGroupId, toStatus); let newOrder = desiredOrder; if (newOrder == null) newOrder = target.length ? (target[target.length - 1].order || 0) + 1 : Date.now(); setItems(prev => prev.map(i => i.id === item.id ? { ...i, groupId: toGroupId, status: toStatus, order: newOrder } : i)); try { const upd = await updateItem(item, { groupId: toGroupId, status: toStatus, order: newOrder }); setItems(prev => prev.map(i => i.id === upd.id ? upd : i)); } catch { /*ignore*/ } };

  const [quickAdd, setQuickAdd] = useState({});

  const memberById = (id) => members.find(m => m.id === id);
  const initials = (name) => (name || '').split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2) || '•';

  const KanbanCard = ({ it }) => {
    const [local, setLocal] = useState(it);
    useEffect(() => { setLocal(it); }, [it.id, it.name, it.status, it.assigneeId, it.dueDate, it.deleted]);
    const commit = async (patch) => { setItems(prev => prev.map(x => x.id === it.id ? { ...x, ...patch } : x)); const upd = await updateItem(it, patch); setItems(prev => prev.map(x => x.id === it.id ? upd : x)); };
    const mem = memberById(local.assigneeId);
    return (
      <div className={`kb-card ${it.deleted ? 'deleted' : ''}`} draggable tabIndex={0} data-item-id={it.id}
        onFocus={() => setFocusId(it.id)} onDragStart={(e)=>{ e.currentTarget.classList.add('dragging'); e.dataTransfer.setData('text/plain', it.id); }} onDragEnd={(e)=>{ e.currentTarget.classList.remove('dragging'); }}>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <Avatar style={{ width:20, height:20 }}><AvatarFallback>{initials(mem?.displayName || mem?.username)}</AvatarFallback></Avatar>
          <div style={{ display:'flex', flexDirection:'column', gap:6, width:'45%' }}>
            <EditableText value={local.name} onCommit={(v)=>commit({ name: v })} />
            <AssigneePicker members={members} value={local.assigneeId || ''} onChange={(id)=>commit({ assigneeId: id || null })} size={16} />
          </div>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:8, alignItems:'flex-end' }}>
          <StatusSelect value={local.status} onChange={(v)=>commit({ status: v })} />
          <DatePickerInline value={local.dueDate} onChange={(d)=>commit({ dueDate: d ? new Date(d).toISOString() : null })} />
          <div><Button className="btn" onClick={() => softDelete(it)}>Delete</Button></div>
        </div>
      </div>
    );
  };

  const statuses = STATUSES;

  const HeaderControls = (
    <div style={{ display:'flex', gap:12, alignItems:'center' }}>
      <div className="small">Realtime: <span className={"ws-indicator" + (connected ? " ok" : "")} style={{ display:'inline-block', verticalAlign:'middle' }} /></div>
      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
        <Label htmlFor="showdel" className="small">Show deleted</Label>
        <Switch id="showdel" checked={showDeleted} onCheckedChange={setShowDeleted} />
      </div>
      <div style={{ display:'flex', gap:6, alignItems:'center' }}>
        <span className="small">Assignee</span>
        <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="All" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="unassigned">Unassigned</SelectItem>
            {members.map(m => <SelectItem key={m.id} value={m.id}>{m.displayName || m.username}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
        <Button className="btn" onClick={exportCSV}>Export CSV</Button>
        <input id="wb-import-file" type="file" accept=".csv" style={{ display:'none' }} onChange={(e)=>handleFilePicked(e.target.files[0])} />
        <Button className="btn" onClick={()=> document.getElementById('wb-import-file').click()}>Import CSV</Button>
      </div>
      <div style={{ display:'flex', gap:8, alignItems:'center', marginLeft:12 }}>
        <Button className="btn" onClick={()=> setView('table')} style={{ opacity: view==='table'?1:0.6 }}>Table</Button>
        <Button className="btn" onClick={()=> setView('kanban')} style={{ opacity: view==='kanban'?1:0.6 }}>Kanban</Button>
      </div>
    </div>
  );

  const KanbanView = (
    <div className="content">
      <div className="board-area">
        <div className="board-header"><div className="board-title">{board.name}</div>{HeaderControls}</div>
        <div className="kanban">
          {groups.map(g => (
            <div className="kb-swin" key={g.id}>
              <div className="kb-head">{g.name} <span className="small">{items.filter(i=>i.groupId===g.id && (showDeleted || !i.deleted) && assigneeMatches(i)).length} items</span></div>
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
      <div className="item-panel"><div className="small">Filter: {assigneeFilter}</div></div>
    </div>
  );

  const TableView = (
    <div className="content">
      <div className="board-area">
        <div className="board-header"><div className="board-title">{board.name}</div>{HeaderControls}</div>
        {groups.map(g => (
          <div key={g.id} className="group">
            <h4>{g.name} • {items.filter(i=>i.groupId===g.id && (showDeleted || !i.deleted) && assigneeMatches(i)).length}</h4>
            <Table className="table">
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Status</TableHead><TableHead>Assignee</TableHead><TableHead>Due</TableHead></TableRow></TableHeader>
              <TableBody>
                {items.filter(i=>i.groupId===g.id && (showDeleted || !i.deleted) && assigneeMatches(i)).sort((a,b)=> (a.order||0)-(b.order||0)).map(it => (
                  <TableRow key={it.id}>
                    <TableCell><EditableText value={it.name} onCommit={async (v)=>{ const upd = await updateItem(it, { name: v }); setItems(prev => prev.map(x => x.id === upd.id ? upd : x)); }} /></TableCell>
                    <TableCell><StatusSelect value={it.status} onChange={async (v)=>{ const upd = await updateItem(it, { status: v }); setItems(prev => prev.map(x => x.id === upd.id ? upd : x)); }} /></TableCell>
                    <TableCell><AssigneePicker members={members} value={it.assigneeId || ''} onChange={async (id)=>{ const upd = await updateItem(it, { assigneeId: id || null }); setItems(prev => prev.map(x => x.id === upd.id ? upd : x)); }} /></TableCell>
                    <TableCell className="small">{it.dueDate ? new Date(it.dueDate).toLocaleDateString() : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ))}
      </div>
      <div className="item-panel" />
    </div>
  );

  if (!board) return <div style={{ padding: 20 }}>Select a board from the left.</div>;
  return view === 'kanban' ? KanbanView : TableView;
}

function App() {
  const [boards, setBoards] = useState([]);
  const [currentBoardId, setCurrentBoardId] = useState(null);
  const [currentBoard, setCurrentBoard] = useState(null);
  const [wsOk, setWsOk] = useState(false);

  useEffect(() => { const h = getAuthHeaders(); axios.get(`${API}/bootstrap`, { headers: h }).then((r) => { setBoards(r.data.boards || []); if (r.data.boards?.length) setCurrentBoardId(r.data.boards[0].id); }).catch((e) => console.error("bootstrap failed", e)); }, []);
  useEffect(() => { setCurrentBoard(boards.find(b => b.id === currentBoardId) || null); }, [boards, currentBoardId]);

  return (
    <div className="app-shell">
      <Sidebar boards={boards} currentBoardId={currentBoardId} onSelect={setCurrentBoardId} />
      <main style={{ display:'flex', flexDirection:'column', minWidth:0 }}>
        {currentBoard && (
          <BoardView board={currentBoard} onRealtimeChange={setWsOk} />
        )}
      </main>
      <Toaster position="bottom-right" />
    </div>
  );
}

export default App;