from fastapi import FastAPI, APIRouter, WebSocket, WebSocketDisconnect, Header, HTTPException, Depends
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Any
import uuid
from datetime import datetime

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI(title="WorkBoards API (Preview)")

# Create a router with the /api prefix
api = APIRouter(prefix="/api")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# -----------------------------
# Simple header-based auth/tenant
# -----------------------------
# X-Workspace-Id: string UUID per tenant
# X-User-Id: string UUID or name pseudo-id
# X-User-Name: optional display name

async def get_ctx(workspace_id: Optional[str] = Header(None, alias="X-Workspace-Id"),
                  user_id: Optional[str] = Header(None, alias="X-User-Id")) -> Dict[str, str]:
    if not workspace_id or not user_id:
        raise HTTPException(status_code=401, detail="Missing X-Workspace-Id or X-User-Id headers")
    return {"workspace_id": workspace_id, "user_id": user_id}

# -----------------------------
# Models
# -----------------------------
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
    status: str = "Todo"  # simplified V1 column for Kanban
    dueDate: Optional[datetime] = None

class Comment(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    itemId: str
    authorId: str
    body: str
    createdAt: datetime = Field(default_factory=datetime.utcnow)

# -----------------------------
# Utilities
# -----------------------------
async def ensure_workspace(ctx: Dict[str, str]):
    ws = await db.workspaces.find_one({"id": ctx["workspace_id"]})
    if not ws:
        # Auto-provision demo workspace for quick start
        ws_obj = Workspace(id=ctx["workspace_id"], name="Demo Workspace", ownerId=ctx["user_id"]) 
        await db.workspaces.insert_one(ws_obj.model_dump())
        # Seed a demo board/groups/items
        board = Board(workspaceId=ws_obj.id, name="Projects", description="Sample board")
        await db.boards.insert_one(board.model_dump())
        g1 = Group(boardId=board.id, name="Backlog", order=1)
        g2 = Group(boardId=board.id, name="In Progress", order=2)
        g3 = Group(boardId=board.id, name="Done", order=3)
        for g in [g1, g2, g3]:
            await db.groups.insert_one(g.model_dump())
        # items
        for i in range(1, 7):
            await db.items.insert_one(Item(boardId=board.id, groupId=g1.id, name=f"Task {i}", order=i, createdBy=ctx["user_id"], status="Todo").model_dump())

# -----------------------------
# API ROUTES
# -----------------------------
@api.get("/")
async def root():
    return {"message": "WorkBoards API running"}

@api.get("/bootstrap")
async def bootstrap(ctx: Dict[str, str] = Depends(get_ctx)):
    await ensure_workspace(ctx)
    ws_id = ctx["workspace_id"]
    boards = await db.boards.find({"workspaceId": ws_id}).to_list(50)
    # Return boards with groups and a count
    for b in boards:
        b["groups"] = await db.groups.find({"boardId": b["id"]}).to_list(100)
    return {"workspaceId": ws_id, "boards": boards}

# Boards
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
    return [Board(**b) for b in boards]

# Groups
@api.post("/boards/{board_id}/groups", response_model=Group)
async def create_group(board_id: str, body: Dict[str, Any], ctx: Dict[str, str] = Depends(get_ctx)):
    await ensure_workspace(ctx)
    g = Group(boardId=board_id, name=body.get("name", "Group"), order=body.get("order", 0))
    await db.groups.insert_one(g.model_dump())
    return g

@api.get("/boards/{board_id}/groups", response_model=List[Group])
async def list_groups(board_id: str, ctx: Dict[str, str] = Depends(get_ctx)):
    groups = await db.groups.find({"boardId": board_id}).sort("order", 1).to_list(200)
    return [Group(**g) for g in groups]

# Items
class ItemCreate(BaseModel):
    name: str
    groupId: str
    order: float = 0

@api.post("/boards/{board_id}/items", response_model=Item)
async def create_item(board_id: str, item: ItemCreate, ctx: Dict[str, str] = Depends(get_ctx)):
    await ensure_workspace(ctx)
    it = Item(boardId=board_id, groupId=item.groupId, name=item.name, order=item.order, createdBy=ctx["user_id"]) 
    await db.items.insert_one(it.model_dump())
    # realtime event
    await broadcast_board(board_id, {"type": "item.created", "item": it.model_dump()})
    return it

class ItemUpdate(BaseModel):
    name: Optional[str] = None
    groupId: Optional[str] = None
    status: Optional[str] = None
    dueDate: Optional[datetime] = None
    order: Optional[float] = None

@api.get("/boards/{board_id}/items", response_model=List[Item])
async def list_items(board_id: str, ctx: Dict[str, str] = Depends(get_ctx)):
    items = await db.items.find({"boardId": board_id}).sort("order", 1).to_list(1000)
    return [Item(**i) for i in items]

@api.patch("/items/{item_id}", response_model=Item)
async def update_item(item_id: str, patch: ItemUpdate, ctx: Dict[str, str] = Depends(get_ctx)):
    doc = {k: v for k, v in patch.model_dump(exclude_none=True).items()}
    if not doc:
        found = await db.items.find_one({"id": item_id})
        if not found:
            raise HTTPException(status_code=404, detail="Item not found")
        return Item(**found)
    await db.items.update_one({"id": item_id}, {"$set": doc})
    updated = await db.items.find_one({"id": item_id})
    if updated:
        await broadcast_board(updated["boardId"], {"type": "item.updated", "item": updated})
        return Item(**updated)
    raise HTTPException(status_code=404, detail="Item not found")

# -----------------------------
# WebSocket Hub (per board)
# -----------------------------
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
    # Expect headers for workspace/user; no strict check for speed but available for future
    await manager.connect(board_id, websocket)
    try:
        while True:
            # Echo pings or ignore incoming client messages
            _ = await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(board_id, websocket)
    except Exception:
        manager.disconnect(board_id, websocket)

# -----------------------------
# Health and demo
# -----------------------------
@api.post("/status")
async def create_status_check(body: Dict[str, Any]):
    status_obj = {"id": str(uuid.uuid4()), "client_name": body.get("client_name", "anon"), "timestamp": datetime.utcnow()}
    await db.status_checks.insert_one(status_obj)
    return status_obj

@api.get("/status")
async def get_status_checks():
    status_checks = await db.status_checks.find().to_list(100)
    return status_checks

# Include router
app.include_router(api)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()