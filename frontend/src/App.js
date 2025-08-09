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

// Header-based auth
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
    let url;
    try {
      const u = new URL(BACKEND_URL);
      const wsProto = u.protocol === "https:" ? "wss" : "ws";
      url = `${wsProto}://${u.host}/api/ws/boards/${boardId}`;
    } catch (e) { console.error("Invalid BACKEND_URL", BACKEND_URL); return; }
    const ws = new WebSocket(url);
    wsRef.current = ws;
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
      <div className="logo">
        <span className="dot" />
        <span>WorkBoards</span>
      </div>
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

function Topbar({ wsOk = false, view, setView }) {
  return (
    <div className="topbar">
      <div className="search">
        <input placeholder="Search items… (Press /)" />
      </div>
      <div className="header-actions">
        <div className={"ws-indicator" + (wsOk ? " ok" : "")} title={wsOk ? "Live" : "Disconnected"} />
        <div className="view-toggle">
          <button className={view === 'table' ? 'active' : ''} onClick={() => setView('table')}>Table</button>
          <button className={view === 'kanban' ? 'active' : ''} onClick={() => setView('kanban')}>Kanban</button>
        </div>
        <Button className="btn">New board</Button>
      </div>
    </div>
  );
}

function EditableText({ value, onCommit, className }) {
  const [v, setV] = useState(value || "");
  const [orig, setOrig] = useState(value || "");
  useEffect(() => { setV(value || ""); setOrig(value || ""); }, [value]);
  return (
    <Input
      className={className}
      value={v}
      onChange={(e)=>setV(e.target.value)}
      onBlur={async ()=>{ if (v !== orig) await onCommit(v); }}
      onKeyDown={(e)=>{ if (e.key === 'Enter') { e.currentTarget.blur(); } if (e.key === 'Escape') { setV(orig); e.currentTarget.blur(); } }}
    />
  );
}

function StatusSelect({ value, onChange }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[110px]">
        <SelectValue placeholder="Status" />
      </SelectTrigger>
      <SelectContent>
        {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
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
  const { connected } = useWebSocket(board?.id);
  useEffect(() => { onRealtimeChange?.(connected); }, [connected]);

  const refetch = React.useCallback(() => {
    if (!board) return;
    const h = getAuthHeaders();
    axios.get(`${API}/boards/${board.id}/groups`, { headers: h }).then((r) => setGroups(r.data));
    axios.get(`${API}/boards/${board.id}/items`, { headers: h }).then((r) => setItems(r.data));
  }, [board?.id]);

  useEffect(() => { if (board) refetch(); }, [board?.id, refetch]);
  useEffect(() => { if (!board || connected) return; const t = setInterval(() => refetch(), 5000); return () => clearInterval(t); }, [connected, board?.id, refetch]);

  useEffect(() => {
    const handler = (ev) => {
      const msg = ev.detail; if (!msg || !board) return;
      if (msg.type === "item.created" && msg.item.boardId === board.id) setItems(prev => [...prev, msg.item]);
      if (msg.type === "item.updated" && msg.item.boardId === board.id) setItems(prev => prev.map(i => i.id === msg.item.id ? msg.item : i));
    };
    window.addEventListener("wb:ws", handler);
    return () => window.removeEventListener("wb:ws", handler);
  }, [board?.id]);

  const laneItems = (groupId, status) => items.filter(it => it.groupId === groupId && it.status === status).sort((a,b) => (a.order||0)-(b.order||0));

  const updateItem = async (item, patch) => {
    const h = getAuthHeaders();
    const res = await axios.patch(`${API}/items/${item.id}`, patch, { headers: h });
    return res.data;
  };

  const createItem = async (groupId, name, statusOpt) => {
    const h = getAuthHeaders();
    const res = await axios.post(`${API}/boards/${board.id}/items`, { name, groupId, order: Date.now(), status: statusOpt }, { headers: h });
    const it = res.data; setItems(prev => [...prev, it]); return it;
  };

  const reorderCounter = useRef({});
  const maybeCompact = async (groupId, status, prev, next, idx) => {
    const key = `${groupId}:${status}`;
    reorderCounter.current[key] = (reorderCounter.current[key] || 0) + 1;
    const gap = next != null && prev != null ? Math.abs(next - prev) : 1;
    if (gap < 1e-3 || reorderCounter.current[key] % 10 === 0) {
      try {
        const h = getAuthHeaders();
        await axios.post(`${API}/boards/${board.id}/order/compact`, { groupId, status }, { headers: h });
      } catch {}
    }
  };

  const moveItem = async (item, toGroupId, toStatus, desiredOrder = null) => {
    const target = laneItems(toGroupId, toStatus);
    let newOrder = desiredOrder;
    if (newOrder == null) newOrder = target.length ? (target[target.length - 1].order || 0) + 1 : Date.now();
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, groupId: toGroupId, status: toStatus, order: newOrder } : i));
    try { const upd = await updateItem(item, { groupId: toGroupId, status: toStatus, order: newOrder }); setItems(prev => prev.map(i => i.id === upd.id ? upd : i)); } catch (e) { refetch(); }
  };

  const insertionIndexForDrop = (laneEl, groupId, status, clientY) => {
    const list = laneItems(groupId, status);
    const cards = Array.from(laneEl.querySelectorAll('.kb-card'));
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return i;
    }
    return list.length; // append
  };

  const KanbanCard = ({ it }) => {
    const [local, setLocal] = useState(it);
    useEffect(() => { setLocal(it); }, [it.id, it.name, it.status, it.assignee, it.dueDate]);
    const commit = async (patch) => {
      setItems(prev => prev.map(x => x.id === it.id ? { ...x, ...patch } : x));
      const upd = await updateItem(it, patch);
      setItems(prev => prev.map(x => x.id === it.id ? upd : x));
    };
    return (
      <div className="kb-card" draggable data-item-id={it.id} onDragStart={(e)=>{ e.dataTransfer.setData('text/plain', it.id); }}>
        <div style={{ display:'flex', flexDirection:'column', gap:6, width:'60%' }}>
          <EditableText value={local.name} onCommit={(v)=>commit({ name: v })} />
          <div className="small">Assignee</div>
          <EditableText value={local.assignee || ''} onCommit={(v)=>commit({ assignee: v || null })} />
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:8, alignItems:'flex-end' }}>
          <StatusSelect value={local.status} onChange={(v)=>commit({ status: v })} />
          <DatePickerInline value={local.dueDate} onChange={(d)=>commit({ dueDate: d ? new Date(d).toISOString() : null })} />
        </div>
      </div>
    );
  };

  const [quickAdd, setQuickAdd] = useState({});

  const statuses = STATUSES;
  const KanbanView = (
    <div className="content">
      <div className="board-area">
        <div className="board-header">
          <div className="board-title">{board.name}</div>
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
                  <div
                    key={st}
                    className="kb-lane"
                    data-lane={st}
                    data-group={g.id}
                    onDragOver={(e)=>{ e.preventDefault(); e.currentTarget.classList.add('dragover'); }}
                    onDragLeave={(e)=>{ e.currentTarget.classList.remove('dragover'); }}
                    onDrop={(e)=>{
                      e.preventDefault(); e.currentTarget.classList.remove('dragover');
                      const itemId = e.dataTransfer.getData('text/plain');
                      const it = items.find(x => x.id === itemId); if (!it) return;
                      const idx = insertionIndexForDrop(e.currentTarget, g.id, st, e.clientY);
                      const lane = laneItems(g.id, st);
                      let prev = null, next = null;
                      if (idx > 0) prev = lane[idx-1]?.order ?? null;
                      if (idx < lane.length) next = lane[idx]?.order ?? null;
                      let newOrder;
                      if (prev == null && next == null) newOrder = Date.now();
                      else if (prev == null) newOrder = next - 1;
                      else if (next == null) newOrder = prev + 1;
                      else newOrder = (prev + next) / 2;
                      moveItem(it, g.id, st, newOrder);
                      maybeCompact(g.id, st, prev, next, idx);
                    }}
                  >
                    {laneItems(g.id, st).map(it => (
                      <KanbanCard key={it.id} it={it} />
                    ))}
                    <div style={{ display:'flex', gap:8, alignItems:'center', marginTop:8 }}>
                      <Input
                        placeholder="Quick add…"
                        value={quickAdd[`${g.id}:${st}`] || ''}
                        onChange={(e)=>setQuickAdd(prev => ({ ...prev, [`${g.id}:${st}`]: e.target.value }))}
                        onKeyDown={async (e)=>{
                          if (e.key === 'Enter') {
                            const title = (quickAdd[`${g.id}:${st}`] || '').trim(); if (!title) return;
                            setQuickAdd(prev => ({ ...prev, [`${g.id}:${st}`]: '' }));
                            await createItem(g.id, title, st);
                          }
                          if (e.key === 'Escape') {
                            setQuickAdd(prev => ({ ...prev, [`${g.id}:${st}`]: '' }));
                          }
                        }}
                      />
                      <Button className="btn" onClick={async ()=>{ const title = (quickAdd[`${g.id}:${st}`] || '').trim(); if (!title) return; setQuickAdd(prev => ({ ...prev, [`${g.id}:${st}`]: '' })); await createItem(g.id, title, st); }}>Add</Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="item-panel">
        <div className="small">Drag within lane to reorder; Enter saves, Esc cancels. Quick add at lane bottom.</div>
      </div>
    </div>
  );

  if (!board) return <div style={{ padding: 20 }}>Select a board from the left.</div>;
  return view === 'kanban' ? KanbanView : (
    <div className="content">
      <div className="board-area">
        <div className="board-header">
          <div className="board-title">{board.name}</div>
        </div>
        {groups.map(g => (
          <div key={g.id} className="group">
            <h4>{g.name} • {items.filter(i=>i.groupId===g.id).length}</h4>
            <Table className="table">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.filter(i=>i.groupId===g.id).sort((a,b)=> (a.order||0)-(b.order||0)).map(it => (
                  <TableRow key={it.id} style={{ cursor:'pointer' }}>
                    <TableCell>
                      <Input defaultValue={it.name} onBlur={async (e) => { if (e.target.value !== it.name) { const upd = await updateItem(it, { name: e.target.value }); setItems(prev => prev.map(x => x.id === upd.id ? upd : x)); } }} />
                    </TableCell>
                    <TableCell>
                      <StatusSelect value={it.status} onChange={async (v)=>{ const upd = await updateItem(it, { status: v }); setItems(prev => prev.map(x => x.id === upd.id ? upd : x)); }} />
                    </TableCell>
                    <TableCell className="small">{it.dueDate ? new Date(it.dueDate).toLocaleDateString() : "—"}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell colSpan={3}>
                    <Button className="btn" onClick={async ()=>{ const name = prompt('Item name?'); if (!name) return; await createItem(g.id, name, 'Todo'); }}>+ Add item</Button>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        ))}
      </div>
      <div className="item-panel" />
    </div>
  );
}

function App() {
  const [boards, setBoards] = useState([]);
  const [currentBoardId, setCurrentBoardId] = useState(null);
  const [currentBoard, setCurrentBoard] = useState(null);
  const [wsOk, setWsOk] = useState(false);
  const [view, setView] = useState(() => localStorage.getItem('wb.view') || 'kanban');

  useEffect(() => {
    const h = getAuthHeaders();
    axios.get(`${API}/bootstrap`, { headers: h }).then((r) => {
      setBoards(r.data.boards || []);
      if (r.data.boards?.length) setCurrentBoardId(r.data.boards[0].id);
    }).catch((e) => console.error("bootstrap failed", e));
  }, []);

  useEffect(() => { setCurrentBoard(boards.find(b => b.id === currentBoardId) || null); }, [boards, currentBoardId]);
  useEffect(() => { localStorage.setItem('wb.view', view); }, [view]);

  return (
    <div className="app-shell">
      <Sidebar boards={boards} currentBoardId={currentBoardId} onSelect={setCurrentBoardId} />
      <main style={{ display:'flex', flexDirection:'column', minWidth:0 }}>
        <Topbar wsOk={wsOk} view={view} setView={setView} />
        <BoardView board={currentBoard} onRealtimeChange={setWsOk} view={view} />
      </main>
    </div>
  );
}

export default App;