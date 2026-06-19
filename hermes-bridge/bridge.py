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

import os, sys, uuid, time, re, json, subprocess, threading, queue, asyncio
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import urllib.request

# websockets installed locally in ./ws_deps
_WS_DEPS = Path(__file__).parent / "ws_deps"
if str(_WS_DEPS) not in sys.path:
    sys.path.insert(0, str(_WS_DEPS))

# ── Config ────────────────────────────────────────────────────────
PORT        = int(os.getenv("PORT",    "8765"))
TIMEOUT     = int(os.getenv("TIMEOUT", "180"))
SILENCE     = float(os.getenv("SILENCE", "3.0"))
HERMES_BIN  = os.getenv("HERMES_BIN",  "/opt/hermes/.venv/bin/hermes")
_HERE = Path(__file__).parent
CONFIG_FILE = Path(os.getenv("AGENTS_CONFIG", _HERE / "agents_config.json"))

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
    id:            str
    container:     Optional[str] = None   # None for local agents
    type:          Optional[str] = "docker"  # "docker" | "local"
    profile:       Optional[str] = None
    bin:           Optional[str] = None
    cwd:           Optional[str] = None
    description:   Optional[str] = ""
    default_user:  Optional[str] = None
    user_profiles: Optional[Dict[str, Optional[str]]] = None
    capabilities:  Optional[Dict[str, Any]] = None

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
    _using_python_module = bin_path.endswith("python.exe") or bin_path.endswith("python")

    if agent_type == "local" or not container:
        if _using_python_module:
            cmd = [bin_path, "-m", "hermes_cli.main"]
        else:
            cmd = [bin_path]
        _cwd = agent.get("cwd", None)
    else:
        workdir = agent.get("workdir", "/root")
        cmd = ["docker", "exec", "-i", "-w", workdir, container, bin_path]
        _cwd = None

    if profile and not _using_python_module:
        cmd += ["--profile", profile]

    # UTF-8 env for subprocess
    import tempfile
    sub_env = os.environ.copy()
    sub_env["PYTHONUTF8"] = "1"
    sub_env["PYTHONIOENCODING"] = "utf-8"

    _wrapper_py = None
    if _using_python_module:
        # Write a temp wrapper script with the message embedded as a Python literal.
        # This avoids Windows command-line Unicode encoding issues entirely.
        _wrapper_py = tempfile.NamedTemporaryFile(mode="w", encoding="utf-8",
                                                   suffix=".py", delete=False)
        _wrapper_py.write(
            f"import sys\n"
            f"sys.argv = [sys.argv[0], '-z', {repr(message)}]\n"
            f"from hermes_cli.main import main\n"
            f"main()\n"
        )
        _wrapper_py.close()
        cmd = [bin_path, _wrapper_py.name]
    else:
        cmd += ["-z", message]

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
            env=sub_env,
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
        if _wrapper_py:
            try:
                os.unlink(_wrapper_py.name)
            except Exception:
                pass

    return "\n".join(lines) if lines else "(no response)"

# ── Hermes-Live: WebSocket JSON-RPC to Dashboard ─────────────────
def _hermes_live_token(host: str, username: str = None, password: str = None) -> str:
    """Fetch the session token injected into the Dashboard HTML."""
    import base64
    try:
        req = urllib.request.Request(f"{host}/")
        if username and password:
            creds = base64.b64encode(f"{username}:{password}".encode()).decode()
            req.add_header("Authorization", f"Basic {creds}")
        with urllib.request.urlopen(req, timeout=4) as r:
            html = r.read().decode("utf-8", errors="replace")
        m = re.search(r'__HERMES_SESSION_TOKEN__\s*=\s*"([^"]+)"', html)
        return m.group(1) if m else ""
    except Exception:
        return ""


def call_hermes_live(agent: dict, message: str, user: str = None) -> str:
    """Send a message to the running Hermes Dashboard via WebSocket JSON-RPC."""
    import websockets.sync.client as _wsc
    import base64

    host = agent.get("host", "http://127.0.0.1:9120").rstrip("/")
    ws_host = host.replace("http://", "ws://").replace("https://", "wss://")
    username = agent.get("username")
    password = agent.get("password")
    token = _hermes_live_token(host, username, password)

    ws_url = f"{ws_host}/api/ws"
    if token:
        ws_url += f"?token={token}"

    # Basic auth header for WebSocket handshake
    extra_headers = {}
    if username and password:
        creds = base64.b64encode(f"{username}:{password}".encode()).decode()
        extra_headers["Authorization"] = f"Basic {creds}"

    timeout = agent.get("timeout", TIMEOUT)
    collected: list[str] = []

    try:
        with _wsc.connect(ws_url, open_timeout=6, additional_headers=extra_headers) as ws:
            rid = uuid.uuid4().hex[:8]

            # ── create a fresh session ────────────────────────────
            ws.send(json.dumps({
                "jsonrpc": "2.0", "id": rid + "_c",
                "method": "session.create",
                "params": {"profile": agent.get("profile") or None},
            }))

            session_id = None
            deadline = time.time() + 10
            while time.time() < deadline:
                raw = ws.recv(timeout=5)
                msg = json.loads(raw)
                # session.create response
                if msg.get("id") == rid + "_c":
                    session_id = (msg.get("result") or {}).get("session_id")
                    break

            if not session_id:
                return "[hermes-live: could not create session]"

            # ── inject envelope / user context ────────────────────
            text = message
            if user:
                try:
                    env = json.loads(user)
                    fu = env.get("from_user", {})
                    text = (
                        f"[AVAGENTOS ENVELOPE]\n"
                        f"user_id: {fu.get('user_id','?')}\n"
                        f"display_name: {fu.get('display_name','?')}\n"
                        f"auth_level: {fu.get('auth_level','?')}\n"
                        f"[/AVAGENTOS ENVELOPE]\n\n"
                    ) + text
                except (json.JSONDecodeError, TypeError):
                    text = f"[User: {user}]\n\n" + text

            # ── submit prompt ─────────────────────────────────────
            ws.send(json.dumps({
                "jsonrpc": "2.0", "id": rid + "_p",
                "method": "prompt.submit",
                "params": {"session_id": session_id, "text": text},
            }))

            # ── collect streaming events until message.complete ────
            # Hermes Dashboard uses: method="event", params.type="message.delta"
            # with params.payload.text for content, and params.type="message.complete"
            # to signal end of turn.
            deadline = time.time() + timeout
            while time.time() < deadline:
                remaining = max(1.0, deadline - time.time())
                try:
                    raw = ws.recv(timeout=min(remaining, SILENCE * 2))
                except TimeoutError:
                    if collected:
                        break
                    continue
                msg = json.loads(raw)
                method = msg.get("method", "")
                params = msg.get("params", {})
                event_type = params.get("type", "")
                payload = params.get("payload", {})

                if method == "event":
                    if event_type == "message.delta":
                        tok = payload.get("text", "") if isinstance(payload, dict) else ""
                        if tok:
                            collected.append(tok)
                    elif event_type == "message.complete":
                        # payload may contain the full assembled text
                        full = payload.get("text", "") if isinstance(payload, dict) else ""
                        if full and not collected:
                            collected.append(full)
                        break
                    elif event_type == "error":
                        err = payload.get("message", str(payload))
                        return f"[hermes-live error: {err}]"
                # legacy / fallback event names
                elif method == "stream.token":
                    tok = params.get("token", "")
                    if tok:
                        collected.append(tok)
                elif method in ("stream.end", "agent.done"):
                    break

    except Exception as exc:
        return f"[hermes-live error: {exc}]"

    return "".join(collected).strip() or "(no response)"


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
    import socket
    with _lock:
        keys = list(_agents.keys())
    return {"status": "ok", "service": "hermes-multi-bridge",
            "version": "3.0.0", "agents": keys,
            "hostname": socket.gethostname()}

@app.get("/agent/{agent_id}/health")
def agent_health(agent_id: str):
    import socket
    with _lock:
        agent = _agents.get(agent_id)
    if not agent:
        raise HTTPException(404, f"Agent '{agent_id}' not found")
    return {
        "status": "ok",
        "agent": agent_id,
        "name": agent.get("description") or agent_id,
        "version": "3.0.0",
        "hostname": socket.gethostname(),
        "capabilities": agent.get("capabilities", {}),
        "config": agent,
    }

# ── Models list ───────────────────────────────────────────────────
@app.get("/v1/models")
@app.get("/api/v1/models")
def models():
    with _lock:
        data = [{"id": k, "object": "model",
                 "created": int(time.time()), "owned_by": "hermes"}
                for k in _agents]
    return {"object": "list", "data": data}

def _dispatch(agent_id: str, req: ChatRequest) -> str:
    """Route to the right backend based on agent type."""
    with _lock:
        agent = dict(_agents.get(agent_id, {}))
    if agent.get("type") == "hermes-live":
        return call_hermes_live(agent, _user_msg(req), user=req.user)
    return call_hermes(agent_id, _user_msg(req), user=req.user)


# ── Chat — routed by URL path ─────────────────────────────────────
@app.post("/agent/{agent_id}/v1/chat/completions")
@app.post("/agent/{agent_id}/api/v1/chat/completions")
def chat_by_path(agent_id: str, req: ChatRequest):
    if agent_id not in _agents:
        raise HTTPException(404, f"Agent '{agent_id}' not found")
    msg = _user_msg(req)
    print(f"  → [{agent_id}] user={req.user!r} {msg[:60]!r}")
    t0  = time.time()
    txt = _dispatch(agent_id, req)
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
    txt = _dispatch(agent_id, req)
    print(f"  ✓ [{agent_id}] {time.time()-t0:.1f}s  {txt[:60]!r}")
    return _resp(txt, agent_id)

# ── Main ──────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    import sys
    sys.stdout.reconfigure(encoding="utf-8")
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
