from fastapi import FastAPI, APIRouter, WebSocket, WebSocketDisconnect, Header, HTTPException, Depends, File, UploadFile, Form, Query
from fastapi.responses import JSONResponse, StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Any, Tuple
import uuid
from datetime import datetime
import io
import csv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="WorkBoards API (Preview)")
api = APIRouter(prefix="/api")

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

DEMO_USERS = {
    "u-alex": "Alex",
    "u-jordan": "Jordan",
    "u-riley": "Riley",
    "u-sam": "Sam",
}
NAME_TO_DEMO_ID = {v.lower(): k for k, v in DEMO_USERS.items()}

async def get_ctx(workspace_id: Optional[str] = Header(None, alias="X-Workspace-Id"),
                  user_id: Optional[str] = Header(None, alias="X-User-Id")) -> Dict[str, str]:
    if not workspace_id or not user_id:
        raise HTTPException(status_code=401, detail="Missing X-Workspace-Id or X-User-Id headers")
    return {"workspace_id": workspace_id, "user_id": user_id}

class Workspace(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    plan: str = "free"
    ownerId: Optional[str] = None
    createdAt: datetime = Field(default_factory=datetime.utcnow)

class Board(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    workspaceId: str
    name: str
    description: Optional[str] = None
    createdAt: datetime = Field(default_factory=datetime.utcnow)

class Group(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    boardId: str
    name: str
    order: float = 0

class Item(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    boardId: str
    groupId: str
    name: str
    order: float = 0
    createdBy: Optional[str] = None
    createdAt: datetime = Field(default_factory=datetime.utcnow)
    updatedAt: datetime = Field(default_factory=datetime.utcnow)
    status: str = "Todo"
    dueDate: Optional[datetime] = None
    assigneeId: Optional[str] = None
    deleted: bool = False
    deletedAt: Optional[datetime] = None

class Comment(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    itemId: str
    authorId: str
    body: str
    createdAt: datetime = Field(default_factory=datetime.utcnow)

async def ensure_workspace(ctx: Dict[str, str]):
    ws = await db.workspaces.find_one({"id": ctx["workspace_id"]})
    if not ws:
        ws_obj = Workspace(id=ctx["workspace_id"], name="Demo Workspace", ownerId=ctx["user_id"]) 
        await db.workspaces.insert_one(ws_obj.model_dump())
        board = Board(workspaceId=ws_obj.id, name="Projects", description="Sample board")
        await db.boards.insert_one(board.model_dump())
        g1 = Group(boardId=board.id, name="Backlog", order=1)
        g2 = Group(boardId=board.id, name="In Progress", order=2)
        g3 = Group(boardId=board.id, name="Done", order=3)
        for g in [g1, g2, g3]:
            await db.groups.insert_one(g.model_dump())
        for i in range(1, 6+1):
            await db.items.insert_one(Item(boardId=board.id, groupId=g1.id, name=f"Task {i}", order=i, createdBy=ctx["user_id"], status="Todo").model_dump())

def strip_mongo(doc: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(doc, dict):
        return doc
    d = dict(doc)
    d.pop("_id", None)
    return d

@api.get("/")
async def root():
    return {"message": "WorkBoards API running"}

@api.get("/bootstrap")
async def bootstrap(ctx: Dict[str, str] = Depends(get_ctx)):
    await ensure_workspace(ctx)
    ws_id = ctx["workspace_id"]
    boards = [strip_mongo(b) for b in await db.boards.find({"workspaceId": ws_id}).to_list(50)]
    for b in boards:
        groups = [strip_mongo(g) for g in await db.groups.find({"boardId": b["id"]}).to_list(100)]
        b["groups"] = groups
    return {"workspaceId": ws_id, "boards": boards}

@api.post("/boards", response_model=Board)
async def create_board(body: Dict[str, Any], ctx: Dict[str, str] = Depends(get_ctx)):
    await ensure_workspace(ctx)
    board = Board(workspaceId=ctx["workspace_id"], name=body.get("name", "Untitled"), description=body.get("description"))
    await db.boards.insert_one(board.model_dump())
    return board

@api.get("/boards", response_model=List[Board])
async def list_boards(ctx: Dict[str, str] = Depends(get_ctx)):
    await ensure_workspace(ctx)
    boards = await db.boards.find({"workspaceId": ctx["workspace_id"]}).to_list(100)
    return [Board(**strip_mongo(b)) for b in boards]

@api.post("/boards/{board_id}/groups", response_model=Group)
async def create_group(board_id: str, body: Dict[str, Any], ctx: Dict[str, str] = Depends(get_ctx)):
    await ensure_workspace(ctx)
    g = Group(boardId=board_id, name=body.get("name", "Group"), order=body.get("order", 0))
    await db.groups.insert_one(g.model_dump())
    return g

@api.get("/boards/{board_id}/groups", response_model=List[Group])
async def list_groups(board_id: str, ctx: Dict[str, str] = Depends(get_ctx)):
    groups = await db.groups.find({"boardId": board_id}).sort("order", 1).to_list(200)
    return [Group(**strip_mongo(g)) for g in groups]

class ItemCreate(BaseModel):
    name: str
    groupId: str
    order: float = 0
    status: Optional[str] = None
    assigneeId: Optional[str] = None
    dueDate: Optional[datetime] = None

@api.post("/boards/{board_id}/items", response_model=Item)
async def create_item(board_id: str, item: ItemCreate, ctx: Dict[str, str] = Depends(get_ctx)):
    await ensure_workspace(ctx)
    now = datetime.utcnow()
    it = Item(boardId=board_id, groupId=item.groupId, name=item.name, order=item.order, createdBy=ctx["user_id"],
              status=item.status or "Todo", assigneeId=item.assigneeId, dueDate=item.dueDate, createdAt=now, updatedAt=now)
    await db.items.insert_one(it.model_dump())
    await broadcast_board(board_id, {"type": "item.created", "item": it.model_dump()})
    return it

class ItemUpdate(BaseModel):
    name: Optional[str] = None
    groupId: Optional[str] = None
    status: Optional[str] = None
    dueDate: Optional[datetime] = None
    order: Optional[float] = None
    assigneeId: Optional[str] = None
    deleted: Optional[bool] = None
    deletedAt: Optional[datetime] = None

@api.get("/boards/{board_id}/items", response_model=List[Item])
async def list_items(board_id: str, includeDeleted: Optional[int] = Query(0), ctx: Dict[str, str] = Depends(get_ctx)):
    q: Dict[str, Any] = {"boardId": board_id}
    if not includeDeleted:
        q["deleted"] = {"$ne": True}
    items = await db.items.find(q).sort("order", 1).to_list(5000)
    for it in items:
        if not it.get("updatedAt"):
            it["updatedAt"] = it.get("createdAt") or datetime.utcnow()
    return [Item(**strip_mongo(i)) for i in items]

@api.patch("/items/{item_id}", response_model=Item)
async def update_item(item_id: str, patch: ItemUpdate, ctx: Dict[str, str] = Depends(get_ctx)):
    doc = {k: v for k, v in patch.model_dump(exclude_none=True).items()}
    now = datetime.utcnow()
    doc["updatedAt"] = now
    if "deleted" in doc and doc["deleted"] is True and not doc.get("deletedAt"):
        doc["deletedAt"] = now
    if "deleted" in doc and doc["deleted"] is False:
        doc["deletedAt"] = None

    await db.items.update_one({"id": item_id}, {"$set": doc})
    updated = await db.items.find_one({"id": item_id})
    if updated:
        upd = strip_mongo(updated)
        event_type = "item.updated"
        if "deleted" in doc:
            event_type = "item.deleted" if doc["deleted"] else "item.restored"
        await broadcast_board(upd["boardId"], {"type": event_type, "item": upd})
        return Item(**upd)
    raise HTTPException(status_code=404, detail="Item not found")

class LanePayload(BaseModel):
    groupId: str
    status: str

@api.post("/boards/{board_id}/order/compact")
async def compact_lane(board_id: str, body: LanePayload, ctx: Dict[str, str] = Depends(get_ctx)):
    docs = await db.items.find({"boardId": board_id, "groupId": body.groupId, "status": body.status, "deleted": {"$ne": True}}).sort("order", 1).to_list(5000)
    new_order = 1000.0
    changed = []
    for d in docs:
        if float(d.get("order", 0)) != float(new_order):
            await db.items.update_one({"id": d["id"]}, {"$set": {"order": new_order, "updatedAt": datetime.utcnow()}})
            d["order"] = new_order
            changed.append(strip_mongo(d))
        new_order += 1000.0
    for doc in changed:
        await broadcast_board(board_id, {"type": "item.updated", "item": doc})
    return {"compacted": len(changed)}

@api.get("/export/items.csv")
async def export_items_csv(boardId: str = Query(...), groupId: Optional[str] = Query(None), includeDeleted: Optional[int] = Query(0), ctx: Dict[str, str] = Depends(get_ctx)):
    board = await db.boards.find_one({"id": boardId})
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    if board.get("workspaceId") != ctx["workspace_id"]:
        raise HTTPException(status_code=403, detail="Forbidden")

    groups = await db.groups.find({"boardId": boardId}).to_list(1000)
    gmap = {g["id"]: g["name"] for g in groups}

    q: Dict[str, Any] = {"boardId": boardId}
    if groupId:
        q["groupId"] = groupId
    if not includeDeleted:
        q["deleted"] = {"$ne": True}
    items = await db.items.find(q).sort("order", 1).to_list(5000)

    def row_iter():
        sio = io.StringIO()
        writer = csv.writer(sio)
        writer.writerow(["id","name","groupId","groupName","status","order","assigneeId","assigneeName","dueDate","createdAt","updatedAt","deleted"])
        yield sio.getvalue(); sio.seek(0); sio.truncate(0)
        for it in items:
            it = strip_mongo(it)
            gid = it.get("groupId"); gname = gmap.get(gid, "")
            aid = it.get("assigneeId"); aname = DEMO_USERS.get(aid, "") if aid else ""
            due = it.get("dueDate"); due_s = ""
            if due:
                try:
                    if isinstance(due, str):
                        due_s = due[:10]
                    else:
                        due_s = due.strftime("%Y-%m-%d")
                except: due_s = ""
            created = it.get("createdAt"); created_s = created.isoformat() if isinstance(created, datetime) else str(created)
            updated = it.get("updatedAt") or created; updated_s = updated.isoformat() if isinstance(updated, datetime) else str(updated)
            writer.writerow([
                it.get("id"), it.get("name"), gid, gname, it.get("status"), it.get("order"), aid or "", aname, due_s, created_s, updated_s, bool(it.get("deleted"))
            ])
            yield sio.getvalue(); sio.seek(0); sio.truncate(0)

    headers = {"Content-Disposition": f"attachment; filename=items_{boardId}.csv"}
    return StreamingResponse(row_iter(), media_type="text/csv", headers=headers)

# ----------------------------- WebSockets -----------------------------
class ConnectionManager:
    def __init__(self):
        self.connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, board_id: str, websocket: WebSocket):
        await websocket.accept()
        self.connections.setdefault(board_id, []).append(websocket)

    def disconnect(self, board_id: str, websocket: WebSocket):
        arr = self.connections.get(board_id, [])
        if websocket in arr:
            arr.remove(websocket)
        if not arr and board_id in self.connections:
            del self.connections[board_id]

    async def broadcast(self, board_id: str, message: Dict[str, Any]):
        arr = self.connections.get(board_id, [])
        to_remove = []
        for ws in arr:
            try:
                await ws.send_json(message)
            except WebSocketDisconnect:
                to_remove.append(ws)
            except Exception:
                to_remove.append(ws)
        for ws in to_remove:
            self.disconnect(board_id, ws)

manager = ConnectionManager()

async def broadcast_board(board_id: str, payload: Dict[str, Any]):
    await manager.broadcast(board_id, payload)

@app.websocket("/api/ws/boards/{board_id}")
async def ws_board(websocket: WebSocket, board_id: str):
    await manager.connect(board_id, websocket)
    try:
        while True:
            _ = await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(board_id, websocket)
    except Exception:
        manager.disconnect(board_id, websocket)

@api.post("/status")
async def create_status_check(body: Dict[str, Any]):
    status_obj = {"id": str(uuid.uuid4()), "client_name": body.get("client_name", "anon"), "timestamp": datetime.utcnow()}
    await db.status_checks.insert_one(status_obj)
    return status_obj

@api.get("/status")
async def get_status_checks():
    status_checks = await db.status_checks.find().to_list(100)
    return status_checks

app.include_router(api)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()