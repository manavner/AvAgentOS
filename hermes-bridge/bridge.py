#!/usr/bin/env python3
"""
Hermes Multi-Agent Bridge  v3.0
================================
One bridge process → all Hermes agents.

Features:
  • agents_config.json  — editable while bridge is running (hot-reload every 5s)
  • POST /agents        — register a new agent live, no restart needed
  • PUT  /agents/{id}   — update an agent live
  • DELETE /agents/{id} — remove an agent live
  • POST /reload        — force config reload right now
  • Routes chat by URL  /agent/{id}/...  OR  by model field
"""

import os, uuid, time, re, json, subprocess, threading, queue
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional

# ── Config ────────────────────────────────────────────────────────
PORT        = int(os.getenv("PORT",    "8765"))
TIMEOUT     = int(os.getenv("TIMEOUT", "60"))
SILENCE     = float(os.getenv("SILENCE", "3.0"))
HERMES_BIN  = os.getenv("HERMES_BIN",  "/opt/hermes/.venv/bin/hermes")
CONFIG_FILE = Path(os.getenv("AGENTS_CONFIG", "agents_config.json"))

# ── App ───────────────────────────────────────────────────────────
app = FastAPI(title="Hermes Multi-Agent Bridge", version="3.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

# ── Pydantic models ───────────────────────────────────────────────
class Message(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    model:       Optional[str]   = None
    messages:    List[Message]
    temperature: Optional[float] = None
    max_tokens:  Optional[int]   = None
    stream:      Optional[bool]  = False
    user:        Optional[str]   = None  # user identity — injected by AvAgentOS

class AgentDef(BaseModel):
    id:          str
    container:   Optional[str] = None   # None for local agents
    type:        Optional[str] = "docker"  # "docker" | "local"
    profile:     Optional[str] = None
    bin:         Optional[str] = None
    description: Optional[str] = ""

# ── Agent registry ────────────────────────────────────────────────
_agents: dict   = {}   # id → dict
_cfg_mtime: float = 0
_lock = threading.Lock()

DEFAULT_CONFIG = {
    "agents": [
        {
            "id":          "hermes",
            "container":   "hermes",
            "profile":     None,
            "description": "Main Hermes agent"
        }
    ]
}

def _load_config(force: bool = False):
    global _cfg_mtime
    if not CONFIG_FILE.exists():
        CONFIG_FILE.write_text(
            json.dumps(DEFAULT_CONFIG, indent=2, ensure_ascii=False),
            encoding="utf-8"
        )
        print(f"  ✓ Created {CONFIG_FILE}")

    mtime = CONFIG_FILE.stat().st_mtime
    if not force and mtime == _cfg_mtime:
        return

    try:
        data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        new_agents = {a["id"]: a for a in data.get("agents", [])}
        with _lock:
            _agents.clear()
            _agents.update(new_agents)
            _cfg_mtime = mtime
        print(f"  ✓ Agents loaded: {list(_agents.keys())}")
    except Exception as exc:
        print(f"  ⚠ Config error: {exc}")

def _save_config():
    with _lock:
        data = {"agents": list(_agents.values())}
    CONFIG_FILE.write_text(
        json.dumps(data, indent=2, ensure_ascii=False),
        encoding="utf-8"
    )

def _watcher():
    """Background thread: hot-reload config every 5 s."""
    while True:
        time.sleep(5)
        _load_config()

# ── ANSI stripper ─────────────────────────────────────────────────
_ANSI = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')

def _strip(text: str) -> str:
    return _ANSI.sub("", text).strip()

# ── Core: run hermes inside a container ──────────────────────────
def call_hermes(agent_id: str, message: str, user: str = None) -> str:
    with _lock:
        agent = dict(_agents.get(agent_id, {}))

    if not agent:
        return f"[Bridge: unknown agent '{agent_id}']"

    bin_path   = agent.get("bin") or HERMES_BIN
    container  = agent.get("container")
    agent_type = agent.get("type", "docker")  # "docker" | "local"

    # ── Identity envelope ─────────────────────────────────────────
    resolved_user = user or agent.get("default_user")
    user_profiles  = agent.get("user_profiles", {})
    profile = (user_profiles.get(resolved_user)
               if resolved_user and user_profiles
               else agent.get("profile"))

    # Inject envelope block before the message so Hermes knows who is asking
    if resolved_user:
        try:
            env = json.loads(resolved_user)   # full envelope from AvAgentOS
            fu  = env.get("from_user", {})
            fd  = env.get("from_device", {})
            gs  = env.get("gui_session", {})
            pm  = env.get("permissions", {})
            envelope_block = (
                f"[AVAGENTOS ENVELOPE]\n"
                f"source: {env.get('source','avagentos')}\n"
                f"request_id: {env.get('request_id','?')}\n"
                f"user_id: {fu.get('user_id','?')}\n"
                f"display_name: {fu.get('display_name','?')}\n"
                f"auth_level: {fu.get('auth_level','?')}\n"
                f"device: {fd.get('hostname','?')}\n"
                f"role: {pm.get('role','?')}\n"
                f"risk_allowed: {pm.get('risk_level_allowed','?')}\n"
                f"project_id: {gs.get('project_id') or 'none'}\n"
                f"session_id: {gs.get('session_id') or 'none'}\n"
                f"[/AVAGENTOS ENVELOPE]\n\n"
            )
            # also use user_id for profile resolution
            uid = fu.get("display_name", resolved_user).lower().replace(" ","_")
            if user_profiles and uid in user_profiles:
                profile = user_profiles[uid]
        except (json.JSONDecodeError, TypeError):
            # plain string fallback
            envelope_block = f"[User: {resolved_user}]\n\n"
        message = envelope_block + message

    # "local" = hermes runs natively (WSL / Linux), no docker exec
    if agent_type == "local" or not container:
        cmd = [bin_path]
        _cwd = agent.get("cwd", None)  # optional working dir for local agents
    else:
        workdir = agent.get("workdir", "/root")  # default to /root where hermes memory lives
        cmd = ["docker", "exec", "-i", "-w", workdir, container, bin_path]
        _cwd = None

    if profile:
        cmd += ["--profile", profile]
    cmd += ["-z", message, "chat"]

    lines = []
    proc  = None
    try:
        proc = subprocess.Popen(
            cmd,
            cwd=_cwd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
        proc.stdin.close()

        q = queue.Queue()

        def _reader():
            try:
                for line in proc.stdout:
                    q.put(line)
            finally:
                q.put(None)

        threading.Thread(target=_reader, daemon=True).start()

        deadline   = time.time() + TIMEOUT
        got_output = False

        while True:
            remaining = max(0.0, deadline - time.time())
            if remaining == 0.0:
                print(f"  ⚠ [{agent_id}] hard timeout")
                break
            try:
                line = q.get(timeout=min(remaining, SILENCE))
                if line is None:
                    break
                cleaned = _strip(line)
                if cleaned:
                    lines.append(cleaned)
                    got_output = True
            except queue.Empty:
                if got_output:
                    break

    except Exception as exc:
        return f"[Bridge error: {exc}]"
    finally:
        if proc:
            try:
                proc.terminate()
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()
            except Exception:
                pass

    return "\n".join(lines) if lines else "(no response)"

# ── Response builder ──────────────────────────────────────────────
def _resp(text: str, model: str = "hermes") -> dict:
    return {
        "id":      f"chatcmpl-{uuid.uuid4().hex[:8]}",
        "object":  "chat.completion",
        "created": int(time.time()),
        "model":   model,
        "choices": [{"index": 0,
                     "message": {"role": "assistant", "content": text},
                     "finish_reason": "stop"}],
        "usage":   {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }

def _user_msg(req: ChatRequest) -> str:
    msg = next((m.content for m in reversed(req.messages) if m.role == "user"), None)
    if not msg:
        raise HTTPException(400, "No user message")
    return msg

# ── Startup ───────────────────────────────────────────────────────
@app.on_event("startup")
def _startup():
    _load_config(force=True)
    threading.Thread(target=_watcher, daemon=True).start()
    print(f"  ✓ Watching {CONFIG_FILE} for changes (every 5s)")

# ── Agent management ──────────────────────────────────────────────
@app.get("/agents")
def list_agents():
    with _lock:
        return {"agents": list(_agents.values())}

@app.post("/agents", status_code=201)
def add_agent(a: AgentDef):
    """Add or overwrite an agent — no bridge restart needed."""
    with _lock:
        _agents[a.id] = a.dict()
    _save_config()
    print(f"  ✓ Agent registered: {a.id} → {a.container}"
          + (f" --profile {a.profile}" if a.profile else ""))
    return {"ok": True, "agent": a.dict()}

@app.put("/agents/{agent_id}")
def update_agent(agent_id: str, a: AgentDef):
    if agent_id not in _agents:
        raise HTTPException(404, f"Agent '{agent_id}' not found")
    with _lock:
        _agents[agent_id] = a.dict()
    _save_config()
    return {"ok": True, "agent": a.dict()}

@app.delete("/agents/{agent_id}")
def delete_agent(agent_id: str):
    if agent_id not in _agents:
        raise HTTPException(404, f"Agent '{agent_id}' not found")
    with _lock:
        del _agents[agent_id]
    _save_config()
    return {"ok": True, "deleted": agent_id}

@app.post("/reload")
def reload():
    """Force config reload right now."""
    global _cfg_mtime
    _cfg_mtime = 0
    _load_config(force=True)
    with _lock:
        keys = list(_agents.keys())
    return {"ok": True, "agents": keys}

# ── Health ────────────────────────────────────────────────────────
@app.get("/health")
@app.get("/api/status")
def health():
    with _lock:
        keys = list(_agents.keys())
    return {"status": "ok", "service": "hermes-multi-bridge",
            "version": "3.0.0", "agents": keys}

@app.get("/agent/{agent_id}/health")
def agent_health(agent_id: str):
    with _lock:
        agent = _agents.get(agent_id)
    if not agent:
        raise HTTPException(404, f"Agent '{agent_id}' not found")
    return {"status": "ok", "agent": agent_id, "config": agent}

# ── Models list ───────────────────────────────────────────────────
@app.get("/v1/models")
@app.get("/api/v1/models")
def models():
    with _lock:
        data = [{"id": k, "object": "model",
                 "created": int(time.time()), "owned_by": "hermes"}
                for k in _agents]
    return {"object": "list", "data": data}

# ── Chat — routed by URL path ─────────────────────────────────────
@app.post("/agent/{agent_id}/v1/chat/completions")
@app.post("/agent/{agent_id}/api/v1/chat/completions")
def chat_by_path(agent_id: str, req: ChatRequest):
    if agent_id not in _agents:
        raise HTTPException(404, f"Agent '{agent_id}' not found")
    msg = _user_msg(req)
    print(f"  → [{agent_id}] user={req.user!r} {msg[:60]!r}")
    t0  = time.time()
    txt = call_hermes(agent_id, msg, user=req.user)
    print(f"  ✓ [{agent_id}] {time.time()-t0:.1f}s  {txt[:60]!r}")
    return _resp(txt, agent_id)

# ── Chat — routed by model field (backward-compat) ────────────────
@app.post("/v1/chat/completions")
@app.post("/api/v1/chat/completions")
def chat_by_model(req: ChatRequest):
    with _lock:
        first = next(iter(_agents), None)
        # match model field → agent id, fall back to first agent
        agent_id = req.model if req.model in _agents else first
    if not agent_id:
        raise HTTPException(503, "No agents configured")
    msg = _user_msg(req)
    print(f"  → [{agent_id}] user={req.user!r} {msg[:60]!r}")
    t0  = time.time()
    txt = call_hermes(agent_id, msg, user=req.user)
    print(f"  ✓ [{agent_id}] {time.time()-t0:.1f}s  {txt[:60]!r}")
    return _resp(txt, agent_id)

# ── Main ──────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    print(f"""
  ╔════════════════════════════════════════╗
  ║   Hermes Multi-Agent Bridge  v3.0      ║
  ║   Single bridge · Hot config · Live    ║
  ╠════════════════════════════════════════╣
  ║  Config  : {str(CONFIG_FILE):<29}║
  ║  Port    : {PORT:<29}║
  ║  Timeout : {TIMEOUT:<28}s║
  ╚════════════════════════════════════════╝
""")
    uvicorn.run(app, host="0.0.0.0", port=PORT)
