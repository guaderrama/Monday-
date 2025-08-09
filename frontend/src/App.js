import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import axios from "axios";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui/table";
import { Button } from "./components/ui/button";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Header-based auth per your choice (1B)
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
    } catch (e) {
      console.error("Invalid BACKEND_URL", BACKEND_URL);
      return;
    }
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        window.dispatchEvent(new CustomEvent("wb:ws", { detail: msg }));
      } catch {}
    };
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

function BoardView({ board, onRealtimeChange, view }) {
  const [groups, setGroups] = useState([]);
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const { connected } = useWebSocket(board?.id);
  useEffect(() => { onRealtimeChange?.(connected); }, [connected]);

  const refetch = React.useCallback(() => {
    if (!board) return;
    const h = getAuthHeaders();
    axios.get(`${API}/boards/${board.id}/groups`, { headers: h }).then((r) => setGroups(r.data));
    axios.get(`${API}/boards/${board.id}/items`, { headers: h }).then((r) => setItems(r.data));
  }, [board?.id]);

  // Load groups + items
  useEffect(() => {
    if (!board) return;
    refetch();
  }, [board?.id, refetch]);

  // If websocket disconnected, poll items every 5s as fallback
  useEffect(() => {
    if (!board) return;
    if (connected) return; // no polling when live
    const t = setInterval(() => refetch(), 5000);
    return () => clearInterval(t);
  }, [connected, board?.id, refetch]);

  // Realtime events
  useEffect(() => {
    const handler = (ev) => {
      const msg = ev.detail;
      if (!msg || !board) return;
      if (msg.type === "item.created" && msg.item.boardId === board.id) {
        setItems((prev) => [...prev, msg.item]);
      }
      if (msg.type === "item.updated" && msg.item.boardId === board.id) {
        setItems((prev) => prev.map(i => i.id === msg.item.id ? msg.item : i));
      }
    };
    window.addEventListener("wb:ws", handler);
    return () => window.removeEventListener("wb:ws", handler);
  }, [board?.id]);

  const groupsById = useMemo(() => Object.fromEntries(groups.map(g => [g.id, g])), [groups]);
  const laneItems = (groupId, status) => items
    .filter(it => it.groupId === groupId && it.status === status)
    .sort((a,b) => (a.order||0)-(b.order||0));

  const createItem = async (groupId) => {
    const name = prompt("Item name?");
    if (!name) return;
    const h = getAuthHeaders();
    try {
      const res = await axios.post(`${API}/boards/${board.id}/items`, { name, groupId, order: Date.now() }, { headers: h });
      const it = res.data;
      setItems(prev => [...prev, it]);
    } catch (e) { console.error("create item failed", e); }
  };

  const cycleStatus = (item) => {
    const order = ["Todo", "Doing", "Done"];
    const idx = order.indexOf(item.status);
    return order[(idx + 1) % order.length];
  };

  const updateItem = async (item, patch) => {
    const h = getAuthHeaders();
    const res = await axios.patch(`${API}/items/${item.id}`, patch, { headers: h });
    return res.data;
  };

  const moveItem = async (item, toGroupId, toStatus) => {
    // compute order at end of lane
    const target = laneItems(toGroupId, toStatus);
    const newOrder = target.length ? (target[target.length - 1].order || 0) + 1 : Date.now();
    // optimistic update
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, groupId: toGroupId, status: toStatus, order: newOrder } : i));
    try {
      const upd = await updateItem(item, { groupId: toGroupId, status: toStatus, order: newOrder });
      setItems(prev => prev.map(i => i.id === upd.id ? upd : i));
    } catch (e) {
      console.error("move failed", e);
      refetch();
    }
  };

  const addGroup = async () => {
    const name = prompt("Group name?") || "New Group";
    const h = getAuthHeaders();
    try {
      const res = await axios.post(`${API}/boards/${board.id}/groups`, { name, order: (groups[groups.length-1]?.order || 0) + 1 }, { headers: h });
      setGroups(prev => [...prev, res.data]);
    } catch (e) { console.error("create group failed", e); }
  };

  if (!board) return <div style={{ padding: 20 }}>Select a board from the left.</div>;

  const TableView = (
    <div className="content">
      <div className="board-area">
        <div className="board-header">
          <div className="board-title">{board.name}</div>
          <div className="small">Realtime: <span className={"ws-indicator" + (connected ? " ok" : "")} style={{ display:'inline-block', verticalAlign:'middle' }} /></div>
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
                  <TableRow key={it.id} onClick={() => setSelected(it)} style={{ cursor:'pointer' }}>
                    <TableCell>
                      <input defaultValue={it.name} onBlur={async (e) => { if (e.target.value !== it.name) await updateItem(it, { name: e.target.value }); }} style={{ width:'100%', background:'transparent', border:'1px solid var(--wb-border)', borderRadius:8, padding:'6px 8px', color:'var(--wb-text)' }} />
                    </TableCell>
                    <TableCell>
                      <span className={`status-pill status-${it.status}`} onClick={async () => { const next = cycleStatus(it); const updated = await updateItem(it, { status: next }); setItems(prev => prev.map(x => x.id === updated.id ? updated : x)); }} style={{ cursor:'pointer' }}>{it.status}</span>
                    </TableCell>
                    <TableCell className="small">{it.dueDate ? new Date(it.dueDate).toLocaleDateString() : "—"}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell colSpan={3}>
                    <Button className="btn" onClick={() => createItem(g.id)}>+ Add item</Button>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        ))}
      </div>
      <div className="item-panel">
        {!selected ? (
          <div className="small">Select an item to see details</div>
        ) : (
          <div>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <h3 style={{ margin:0 }}>{selected.name}</h3>
              <span className={`status-pill status-${selected.status}`}>
                {selected.status}
              </span>
            </div>
            <div className="small" style={{ marginTop:8 }}>Item ID: {selected.id}</div>
            <div className="small" style={{ marginTop:8 }}>Group: {groupsById[selected.groupId]?.name}</div>
            <div className="small" style={{ marginTop:8 }}>Created: {new Date(selected.createdAt).toLocaleString()}</div>
            <div style={{ height: 1, background: 'var(--wb-border)', margin:'16px 0' }} />
            <div className="small">Activity (coming soon) • Comments (coming soon)</div>
          </div>
        )}
      </div>
    </div>
  );

  const statuses = ["Todo","Doing","Done"];
  const KanbanView = (
    <div className="content">
      <div className="board-area">
        <div className="board-header">
          <div className="board-title">{board.name}</div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <Button className="btn" onClick={addGroup}>+ New group</Button>
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
                      e.preventDefault();
                      e.currentTarget.classList.remove('dragover');
                      const itemId = e.dataTransfer.getData('text/plain');
                      const it = items.find(x => x.id === itemId);
                      if (!it) return;
                      moveItem(it, g.id, st);
                    }}
                  >
                    {laneItems(g.id, st).map(it => (
                      <div
                        key={it.id}
                        className="kb-card"
                        draggable
                        data-item-id={it.id}
                        onDragStart={(e)=>{ e.dataTransfer.setData('text/plain', it.id); }}
                      >
                        <div className="title">{it.name}</div>
                        <div className="pill">{it.status}</div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <div className="kb-actions">
                <Button className="btn" onClick={() => createItem(g.id)}>+ Add item</Button>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="item-panel">
        {!selected ? (
          <div className="small">Drag items between lanes. Select an item in Table view to see details.</div>
        ) : null}
      </div>
    </div>
  );

  return view === 'kanban' ? KanbanView : TableView;
}

function App() {
  const [boards, setBoards] = useState([]);
  const [currentBoardId, setCurrentBoardId] = useState(null);
  const [currentBoard, setCurrentBoard] = useState(null);
  const [wsOk, setWsOk] = useState(false);
  const [view, setView] = useState(() => localStorage.getItem('wb.view') || 'table');

  // Bootstrap workspace and boards
  useEffect(() => {
    const h = getAuthHeaders();
    axios.get(`${API}/bootstrap`, { headers: h }).then((r) => {
      setBoards(r.data.boards || []);
      if (r.data.boards?.length) {
        setCurrentBoardId(r.data.boards[0].id);
      }
    }).catch((e) => console.error("bootstrap failed", e));
  }, []);

  useEffect(() => {
    setCurrentBoard(boards.find(b => b.id === currentBoardId) || null);
  }, [boards, currentBoardId]);

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