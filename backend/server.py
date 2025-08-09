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

SEED_MEMBERS = [
    {"id": "u-alex", "username": "alex", "displayName": "Alex"},
    {"id": "u-jordan", "username": "jordan", "displayName": "Jordan"},
    {"id": "u-riley", "username": "riley", "displayName": "Riley"},
    {"id": "u-sam", "username": "sam", "displayName": "Sam"},
]

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

class View(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    boardId: str
    workspaceId: str
    name: str
    type: str  # "table" | "kanban"
    configJSON: Dict[str, Any] = Field(default_factory=dict)
    createdAt: datetime = Field(default_factory=datetime.utcnow)
    updatedAt: datetime = Field(default_factory=datetime.utcnow)

class ViewCreate(BaseModel):
    name: str
    type: str
    configJSON: Dict[str, Any] = Field(default_factory=dict)

class ViewUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    configJSON: Optional[Dict[str, Any]] = None

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

async def ensure_members(workspace_id: str) -> List[Dict[str, Any]]:
    existing = await db.members.find({"workspaceId": workspace_id}).to_list(20)
    if existing:
        return [strip_mongo(m) for m in existing]
    for m in SEED_MEMBERS:
        rec = {**m, "workspaceId": workspace_id}
        await db.members.insert_one(rec)
    existing = await db.members.find({"workspaceId": workspace_id}).to_list(20)
    return [strip_mongo(m) for m in existing]

def strip_mongo(doc: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(doc, dict):
        return doc
    d = dict(doc)
    d.pop("_id", None)
    return d

@api.get("/")
async def root():
    return {"message": "WorkBoards API running"}

# Members endpoints
@api.get("/members")
async def get_members(ctx: Dict[str, str] = Depends(get_ctx)):
    ms = await ensure_members(ctx["workspace_id"])
    return ms

class MemberPatch(BaseModel):
    displayName: str

@api.patch("/members/{member_id}")
async def patch_member(member_id: str, body: MemberPatch, ctx: Dict[str, str] = Depends(get_ctx)):
    await ensure_members(ctx["workspace_id"])  # seed if missing
    await db.members.update_one({"workspaceId": ctx["workspace_id"], "id": member_id}, {"$set": {"displayName": body.displayName}})
    m = await db.members.find_one({"workspaceId": ctx["workspace_id"], "id": member_id})
    if not m:
        raise HTTPException(status_code=404, detail="Member not found")
    return strip_mongo(m)

# Views endpoints
@api.get("/boards/{board_id}/views", response_model=List[View])
async def list_views(board_id: str, ctx: Dict[str, str] = Depends(get_ctx)):
    board = await db.boards.find_one({"id": board_id})
    if not board or board.get("workspaceId") != ctx["workspace_id"]:
        raise HTTPException(status_code=404, detail="Board not found")
    vs = await db.views.find({"boardId": board_id, "workspaceId": ctx["workspace_id"]}).sort("createdAt", 1).to_list(200)
    return [View(**strip_mongo(v)) for v in vs]

@api.post("/boards/{board_id}/views", response_model=View)
async def create_view(board_id: str, body: ViewCreate, ctx: Dict[str, str] = Depends(get_ctx)):
    board = await db.boards.find_one({"id": board_id})
    if not board or board.get("workspaceId") != ctx["workspace_id"]:
        raise HTTPException(status_code=404, detail="Board not found")
    now = datetime.utcnow()
    v = View(boardId=board_id, workspaceId=ctx["workspace_id"], name=body.name, type=body.type, configJSON=body.configJSON, createdAt=now, updatedAt=now)
    await db.views.insert_one(v.model_dump())
    return v

@api.patch("/views/{view_id}", response_model=View)
async def update_view(view_id: str, body: ViewUpdate, ctx: Dict[str, str] = Depends(get_ctx)):
    v = await db.views.find_one({"id": view_id})
    if not v or v.get("workspaceId") != ctx["workspace_id"]:
        raise HTTPException(status_code=404, detail="View not found")
    doc: Dict[str, Any] = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    doc["updatedAt"] = datetime.utcnow()
    await db.views.update_one({"id": view_id}, {"$set": doc})
    nv = await db.views.find_one({"id": view_id})
    return View(**strip_mongo(nv))

@api.delete("/views/{view_id}")
async def delete_view(view_id: str, ctx: Dict[str, str] = Depends(get_ctx)):
    v = await db.views.find_one({"id": view_id})
    if not v or v.get("workspaceId") != ctx["workspace_id"]:
        raise HTTPException(status_code=404, detail="View not found")
    await db.views.delete_one({"id": view_id})
    return {"ok": True}

@api.get("/bootstrap")
async def bootstrap(ctx: Dict[str, str] = Depends(get_ctx)):
    await ensure_workspace(ctx)
    await ensure_members(ctx["workspace_id"])  # ensure members too
    ws_id = ctx["workspace_id"]
    boards = [strip_mongo(b) for b in await db.boards.find({"workspaceId": ws_id}).to_list(50)]
    for b in boards:
        groups = [strip_mongo(g) for g in await db.groups.find({"boardId": b["id"]}).to_list(100)]
        b["groups"] = groups
    return {"workspaceId": ws_id, "boards": boards}

# ... existing items/group/export/import endpoints continue below ...
# (UNCHANGED content omitted for brevity in this patch)