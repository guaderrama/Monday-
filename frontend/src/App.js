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

function ViewSelector({ boardId, members, state, setState, onRefreshViews }) {
  const [views, setViews] = useState([]);
  const [selectedId, setSelectedId] = useState(() => new URLSearchParams(window.location.search).get('viewId') || localStorage.getItem(`wb.viewId:${boardId}`) || '');

  const fetchViews = async () => {
    const h = getAuthHeaders(); const r = await axios.get(`${API}/boards/${boardId}/views`, { headers: h }); setViews(r.data);
  };
  useEffect(() => { fetchViews(); onRefreshViews && onRefreshViews(fetchViews); }, [boardId]);
  useEffect(() => { if (selectedId) localStorage.setItem(`wb.viewId:${boardId}`, selectedId); else localStorage.removeItem(`wb.viewId:${boardId}`); const url = new URL(window.location.href); if (selectedId) url.searchParams.set('viewId', selectedId); else url.searchParams.delete('viewId'); window.history.replaceState({}, '', url.toString()); }, [selectedId, boardId]);

  useEffect(() => {
    // If selectedId matches a custom view, apply its config
    const v = views.find(x => x.id === selectedId);
    if (v) {
      const cfg = v.configJSON || {};
      setState((s) => ({ ...s,
        type: v.type || s.type,
        showDeleted: !!cfg.showDeleted,
        text: cfg.filters?.text || '',
        statuses: cfg.filters?.statuses || STATUSES,
        assigneeFilter: cfg.filters?.assigneeId === 'unassigned' ? 'unassigned' : (cfg.filters?.assigneeId || 'all'),
        sort: cfg.sort || { field: 'order', dir: 'asc' },
      }));
    }
  }, [selectedId, views]);

  const currentConfig = () => ({
    filters: {
      text: state.text || '',
      statuses: state.statuses || STATUSES,
      assigneeId: state.assigneeFilter === 'all' ? null : state.assigneeFilter,
    },
    sort: state.sort || { field: 'order', dir: 'asc' },
    showDeleted: !!state.showDeleted,
    ui: { collapsedGroups: state.collapsedGroups || [] },
  });

  const saveAsNew = async () => {
    const name = prompt('View name?'); if (!name) return; const h = getAuthHeaders();
    const body = { name, type: state.type, configJSON: currentConfig() };
    const r = await axios.post(`${API}/boards/${boardId}/views`, body, { headers: h });
    setViews((arr) => [...arr, r.data]); setSelectedId(r.data.id);
  };

  const saveChanges = async () => {
    if (!selectedId) { await saveAsNew(); return; }
    const h = getAuthHeaders(); const body = { configJSON: currentConfig(), type: state.type };
    const r = await axios.patch(`${API}/views/${selectedId}`, body, { headers: h });
    setViews((arr) => arr.map(v => v.id === r.data.id ? r.data : v));
  };

  const renameView = async () => {
    const v = views.find(x => x.id === selectedId); if (!v) return;
    const name = prompt('Rename view', v.name); if (!name) return;
    const h = getAuthHeaders(); const r = await axios.patch(`${API}/views/${selectedId}`, { name }, { headers: h });
    setViews((arr) => arr.map(v => v.id === r.data.id ? r.data : v));
  };

  const deleteView = async () => {
    if (!selectedId) return; if (!confirm('Delete this view?')) return; const h = getAuthHeaders(); await axios.delete(`${API}/views/${selectedId}`, { headers: h }); setViews((arr) => arr.filter(v => v.id !== selectedId)); setSelectedId('');
  };

  return (
    <div style={{ display:'flex', gap:8, alignItems:'center' }}>
      <Select value={selectedId || (state.type === 'kanban' ? 'kanban-default' : 'table-default')} onValueChange={(val)=>{
        if (val === 'table-default') { setSelectedId(''); setState(s => ({ ...s, type: 'table', text:'', statuses: STATUSES, assigneeFilter:'all', showDeleted:false })); return; }
        if (val === 'kanban-default') { setSelectedId(''); setState(s => ({ ...s, type: 'kanban', text:'', statuses: STATUSES, assigneeFilter:'all', showDeleted:false })); return; }
        setSelectedId(val);
      }}>
        <SelectTrigger className="w-[240px]"><SelectValue placeholder="Select view" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="table-default">Table (Default)</SelectItem>
          <SelectItem value="kanban-default">Kanban (Default)</SelectItem>
          <div style={{ borderTop:'1px solid var(--wb-border)', margin:'6px 0' }} />
          {views.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button className="btn" onClick={saveChanges}>Save changes</Button>
      <Button className="btn" onClick={saveAsNew}>Save as new</Button>
      {selectedId && <Button className="btn" onClick={renameView}>Rename</Button>}
      {selectedId && <Button className="btn" onClick={deleteView}>Delete</Button>}
    </div>
  );
}

function BoardView({ board, onRealtimeChange }) {
  const [groups, setGroups] = useState([]);
  const [items, setItems] = useState([]);
  const [members, setMembers] = useState([]);
  const [state, setState] = useState(() => ({ type: (localStorage.getItem('wb.view') || 'kanban'), text:'', statuses: STATUSES, assigneeFilter:'all', sort:{ field:'order', dir:'asc' }, showDeleted: localStorage.getItem(`wb.showDeleted:${board?.id}`)==='1', collapsedGroups: [] }));
  const [focusId, setFocusId] = useState(null);
  const { connected } = useWebSocket(board?.id);
  useEffect(() => { onRealtimeChange?.(connected); }, [connected]);

  const refetch = React.useCallback(() => {
    if (!board) return; const h = getAuthHeaders(); const params = state.showDeleted ? { includeDeleted: 1 } : {};
    axios.get(`${API}/members`, { headers: h }).then(r => setMembers(r.data));
    axios.get(`${API}/boards/${board.id}/groups`, { headers: h }).then((r) => setGroups(r.data));
    axios.get(`${API}/boards/${board.id}/items`, { headers: h, params }).then((r) => setItems(r.data));
  }, [board?.id, state.showDeleted]);

  useEffect(() => { if (board) refetch(); }, [board?.id, refetch]);
  useEffect(() => { if (!board || connected) return; const t = setInterval(() => refetch(), 5000); return () => clearInterval(t); }, [connected, board?.id, refetch]);

  useEffect(() => {
    const handler = (ev) => { const msg = ev.detail; if (!msg || !board) return; const it = msg.item; if (!it || it.boardId !== board.id) return;
      setItems(prev => {
        if (msg.type === 'item.created') return [...prev, it];
        if (msg.type === 'item.updated') return prev.map(x => x.id === it.id ? it : x);
        if (msg.type === 'item.deleted') return state.showDeleted ? prev.map(x => x.id === it.id ? it : x) : prev.filter(x => x.id !== it.id);
        if (msg.type === 'item.restored') { const exists = prev.some(x => x.id === it.id); return exists ? prev.map(x => x.id === it.id ? it : x) : [...prev, it]; }
        return prev;
      });
    };
    window.addEventListener("wb:ws", handler); return () => window.removeEventListener("wb:ws", handler);
  }, [board?.id, state.showDeleted]);

  useEffect(() => { localStorage.setItem(`wb.showDeleted:${board?.id}`, state.showDeleted ? '1' : '0'); }, [state.showDeleted, board?.id]);

  const matchesFilters = (it) => {
    if (!state.statuses.includes(it.status)) return false;
    if (state.assigneeFilter === 'unassigned' && it.assigneeId) return false;
    if (state.assigneeFilter !== 'all' && state.assigneeFilter !== 'unassigned' && it.assigneeId !== state.assigneeFilter) return false;
    if (state.text && !(`${it.name||''}`.toLowerCase().includes(state.text.toLowerCase()))) return false;
    return true;
  };

  const laneItems = (groupId, status) => items.filter(it => it.groupId === groupId && it.status === status && (state.showDeleted || !it.deleted) && matchesFilters(it)).sort((a,b) => (a.order||0)-(b.order||0));

  const updateItem = async (item, patch) => { const h = getAuthHeaders(); const res = await axios.patch(`${API}/items/${item.id}`, patch, { headers: h }); return res.data; };
  const createItem = async (groupId, name, statusOpt) => { const h = getAuthHeaders(); const res = await axios.post(`${API}/boards/${board.id}/items`, { name, groupId, order: Date.now(), status: statusOpt }, { headers: h }); const it = res.data; setItems(prev => [...prev, it]); return it; };

  const reorderCounter = useRef({});
  const maybeCompact = async (groupId, status, prev, next, idx) => { const key = `${groupId}:${status}`; reorderCounter.current[key] = (reorderCounter.current[key] || 0) + 1; const gap = next != null && prev != null ? Math.abs(next - prev) : 1; if (gap < 1e-3 || reorderCounter.current[key] % 10 === 0) { try { const h = getAuthHeaders(); await axios.post(`${API}/boards/${board.id}/order/compact`, { groupId, status }, { headers: h }); } catch {} } };
  const moveItem = async (item, toGroupId, toStatus, desiredOrder = null) => { const target = laneItems(toGroupId, toStatus); let newOrder = desiredOrder; if (newOrder == null) newOrder = target.length ? (target[target.length - 1].order || 0) + 1 : Date.now(); setItems(prev => prev.map(i => i.id === item.id ? { ...i, groupId: toGroupId, status: toStatus, order: newOrder } : i)); try { const upd = await updateItem(item, { groupId: toGroupId, status: toStatus, order: newOrder }); setItems(prev => prev.map(i => i.id === upd.id ? upd : i)); } catch { /*ignore*/ } };

  const [quickAdd, setQuickAdd] = useState({});

  // View header
  const HeaderControls = (
    <div style={{ display:'flex', gap:12, alignItems:'center', flexWrap:'wrap' }}>
      <ViewSelector boardId={board.id} members={members} state={state} setState={setState} />
      <div className="small">Realtime: <span className={"ws-indicator" + (connected ? " ok" : "")} style={{ display:'inline-block', verticalAlign:'middle' }} /></div>
      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
        <Label className="small">Show deleted</Label>
        <Switch checked={state.showDeleted} onCheckedChange={(v)=>setState(s=>({ ...s, showDeleted:v }))} />
      </div>
      <div style={{ display:'flex', gap:6, alignItems:'center' }}>
        <span className="small">Assignee</span>
        <Select value={state.assigneeFilter} onValueChange={(val)=>setState(s=>({ ...s, assigneeFilter: val }))}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="All" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="unassigned">Unassigned</SelectItem>
            {members.map(m => <SelectItem key={m.id} value={m.id}>{m.displayName || m.username}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div style={{ display:'flex', gap:6, alignItems:'center' }}>
        <span className="small">Statuses</span>
        <div style={{ display:'flex', gap:6 }}>
          {STATUSES.map(st => (
            <button key={st} className="btn" style={{ opacity: state.statuses?.includes(st) ? 1 : 0.45 }} onClick={()=> setState(s=> ({ ...s, statuses: s.statuses?.includes(st) ? s.statuses.filter(x=>x!==st) : [...(s.statuses||[]), st] }))}>{st}</button>
          ))}
        </div>
      </div>
      <div style={{ display:'flex', gap:6, alignItems:'center' }}>
        <Input placeholder="Search name…" value={state.text} onChange={(e)=> setState(s=> ({ ...s, text: e.target.value }))} />
      </div>
      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
        <Button className="btn" onClick={async ()=>{
          const h = getAuthHeaders();
          const params = { boardId: board.id, includeDeleted: state.showDeleted ? 1 : 0 };
          if (state.assigneeFilter === 'unassigned') params.unassigned = 1; else if (state.assigneeFilter !== 'all') params.assigneeId = state.assigneeFilter;
          if (state.statuses && state.statuses.length && state.statuses.length < STATUSES.length) params.statuses = state.statuses.join(',');
          if (state.text) params.text = state.text;
          const res = await axios.get(`${API}/export/items.csv`, { params, headers: h, responseType: 'blob' });
          const blob = new Blob([res.data], { type: 'text/csv' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `items_${board.id}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
        }}>Export CSV</Button>
      </div>
    </div>
  );

  const statuses = STATUSES;
  const KanbanView = (
    <div className="content">
      <div className="board-area">
        <div className="board-header"><div className="board-title">{board.name}</div>{HeaderControls}</div>
        <div className="kanban">
          {groups.map(g => (
            <div className="kb-swin" key={g.id}>
              <div className="kb-head">{g.name} <span className="small">{items.filter(i=>i.groupId===g.id && (state.showDeleted || !i.deleted) && matchesFilters(i)).length} items</span></div>
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
                    {laneItems(g.id, st).map(it => (
                      <div key={it.id} className="kb-card" tabIndex={0} onFocus={()=>setFocusId(it.id)}>{/* render minimal card */}
                        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                          <Avatar style={{ width:18, height:18 }}><AvatarFallback>{((members.find(m=>m.id===it.assigneeId)?.displayName||'U')[0]||'•')}</AvatarFallback></Avatar>
                          <span>{it.name}</span>
                        </div>
                      </div>
                    ))}
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
    </div>
  );

  const TableView = (
    <div className="content">
      <div className="board-area">
        <div className="board-header"><div className="board-title">{board.name}</div>{HeaderControls}</div>
        {groups.map(g => (
          <div key={g.id} className="group">
            <h4>{g.name} • {items.filter(i=>i.groupId===g.id && (state.showDeleted || !i.deleted) && matchesFilters(i)).length}</h4>
            <Table className="table">
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Status</TableHead><TableHead>Assignee</TableHead><TableHead>Due</TableHead></TableRow></TableHeader>
              <TableBody>
                {items.filter(i=>i.groupId===g.id && (state.showDeleted || !i.deleted) && matchesFilters(i)).sort((a,b)=> (a.order||0)-(b.order||0)).map(it => (
                  <TableRow key={it.id}>
                    <TableCell>{it.name}</TableCell>
                    <TableCell>{it.status}</TableCell>
                    <TableCell>{members.find(m=>m.id===it.assigneeId)?.displayName || '—'}</TableCell>
                    <TableCell className="small">{it.dueDate ? new Date(it.dueDate).toLocaleDateString() : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ))}
      </div>
    </div>
  );

  return state.type === 'kanban' ? KanbanView : TableView;
}

function App() {
  const [boards, setBoards] = useState([]);
  const [currentBoardId, setCurrentBoardId] = useState(null);
  const [currentBoard, setCurrentBoard] = useState(null);

  useEffect(() => { const h = getAuthHeaders(); axios.get(`${API}/bootstrap`, { headers: h }).then((r) => { setBoards(r.data.boards || []); if (r.data.boards?.length) setCurrentBoardId(r.data.boards[0].id); }).catch((e) => console.error("bootstrap failed", e)); }, []);
  useEffect(() => { setCurrentBoard(boards.find(b => b.id === currentBoardId) || null); }, [boards, currentBoardId]);

  return (
    <div className="app-shell">
      <Sidebar boards={boards} currentBoardId={currentBoardId} onSelect={setCurrentBoardId} />
      <main style={{ display:'flex', flexDirection:'column', minWidth:0 }}>
        {currentBoard && (
          <BoardView board={currentBoard} onRealtimeChange={()=>{}} />
        )}
      </main>
      <Toaster position="bottom-right" />
    </div>
  );
}

export default App;