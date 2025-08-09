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

function Topbar({ wsOk = false }) {
  return (
    <div className="topbar">
      <div className="search">
        <input placeholder="Search items… (Press /)" />
      </div>
      <div className="header-actions">
        <div className={"ws-indicator" + (wsOk ? " ok" : "")} title={wsOk ? "Live" : "Disconnected"} />
        <Button className="btn">New board</Button>
      </div>
    </div>
  );
}

function BoardView({ board, onRealtimeChange }) {
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
  const itemsByGroup = useMemo(() => {
    const map = {};
    for (const g of groups) map[g.id] = [];
    for (const it of items) {
      if (!map[it.groupId]) map[it.groupId] = [];
      map[it.groupId].push(it);
    }
    for (const k of Object.keys(map)) map[k] = map[k].sort((a,b) => (a.order||0)-(b.order||0));
    return map;
  }, [groups, items]);

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

  if (!board) return <div style={{ padding: 20 }}>Select a board from the left.</div>;

  return (
    <div className="content">
      <div className="board-area">
        <div className="board-header">
          <div className="board-title">{board.name}</div>
          <div className="small">Realtime: <span className={"ws-indicator" + (connected ? " ok" : "")} style={{ display:'inline-block', verticalAlign:'middle' }} /></div>
        </div>
        {groups.map(g => (
          <div key={g.id} className="group">
            <h4>{g.name} • {itemsByGroup[g.id]?.length || 0}</h4>
            <Table className="table">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(itemsByGroup[g.id] || []).map(it => (
                  <TableRow key={it.id} onClick={() => setSelected(it)} style={{ cursor:'pointer' }}>
                    <TableCell>
                      <input defaultValue={it.name} onBlur={async (e) => { if (e.target.value !== it.name) await updateItem(it, { name: e.target.value }); }} style={{ width:'100%', background:'transparent', border:'1px solid var(--wb-border)', borderRadius:8, padding:'6px 8px', color:'var(--wb-text)' }} />
                    </TableCell>
                    <TableCell>
                      <span className={`status-pill status-${it.status}`} onClick={() => updateItem(it, { status: cycleStatus(it) })} style={{ cursor:'pointer' }}>{it.status}</span>
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
}

function App() {
  const [wsOk, setWsOk] = useState(false);
  const [boards, setBoards] = useState([]);
  const [currentBoardId, setCurrentBoardId] = useState(null);
  const [currentBoard, setCurrentBoard] = useState(null);

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

  return (
    <div className="app-shell">
      <Sidebar boards={boards} currentBoardId={currentBoardId} onSelect={setCurrentBoardId} />
      <main style={{ display:'flex', flexDirection:'column', minWidth:0 }}>
        <Topbar wsOk={wsOk} />
        <BoardView board={currentBoard} onRealtimeChange={setWsOk} />
      </main>
    </div>
  );
}

export default App;