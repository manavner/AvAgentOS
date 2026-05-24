#!/usr/bin/env python3
"""
Hermes Bridge v2.1
==================
Calls hermes one-shot via docker exec (-z flag).
Reliable: works regardless of what the container's main process is.
Each request spawns a fresh hermes process; exits cleanly after reply.
"""

import os, uuid, time, re, subprocess, threading, queue
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional

# ── Config ────────────────────────────────────────────────────────
CONTAINER  = os.getenv("HERMES_CONTAINER", "hermes")
HERMES_BIN = os.getenv("HERMES_BIN", "/opt/hermes/.venv/bin/hermes")
PORT       = int(os.getenv("PORT", "8765"))
TIMEOUT    = int(os.getenv("TIMEOUT", "60"))
SILENCE    = float(os.getenv("SILENCE", "3.0"))   # stop after N s of silence

# ── App ───────────────────────────────────────────────────────────
app = FastAPI(title="Hermes Bridge", version="2.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

# ── Models ────────────────────────────────────────────────────────
class Message(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    model: Optional[str] = "hermes"
    messages: List[Message]
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    stream: Optional[bool] = False


# ── ANSI stripper ─────────────────────────────────────────────────
ANSI = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')

def strip_ansi(text: str) -> str:
    return ANSI.sub('', text).strip()


# ── Hermes caller (one-shot via docker exec) ───────────────────────
def call_hermes(message: str) -> str:
    """
    Run:  docker exec -i <container> hermes -z "<message>" chat
    Collect stdout until the process exits OR 3 s of silence, whichever
    comes first.  Hard-kills after TIMEOUT seconds.
    """
    cmd = ["docker", "exec", "-i", CONTAINER, HERMES_BIN, "-z", message, "chat"]
    lines  = []
    proc   = None

    try:
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding='utf-8',
            errors='replace',
            bufsize=1,
        )
        proc.stdin.close()

        q = queue.Queue()

        def _reader():
            try:
                for line in proc.stdout:
                    q.put(line)
            finally:
                q.put(None)          # sentinel – always fires when stdout closes

        threading.Thread(target=_reader, daemon=True).start()

        deadline    = time.time() + TIMEOUT
        got_output  = False

        while True:
            remaining = max(0.0, deadline - time.time())
            if remaining == 0.0:
                print("  ⚠ Hermes: hard timeout reached")
                break
            try:
                line = q.get(timeout=min(remaining, SILENCE))
                if line is None:
                    break                        # process exited cleanly
                cleaned = strip_ansi(line).strip()
                if cleaned:
                    lines.append(cleaned)
                    got_output = True
            except queue.Empty:
                if got_output:
                    break                        # silence after real output = done

    except Exception as exc:
        return f"[Bridge error: {exc}]"
    finally:
        if proc is not None:
            try:
                proc.terminate()
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()
            except Exception:
                pass

    return "\n".join(lines) if lines else "(no response)"


# ── Response builder ──────────────────────────────────────────────
def make_response(text: str, model: str = "hermes") -> dict:
    return {
        "id":      f"chatcmpl-{uuid.uuid4().hex[:8]}",
        "object":  "chat.completion",
        "created": int(time.time()),
        "model":   model,
        "choices": [{
            "index":         0,
            "message":       {"role": "assistant", "content": text},
            "finish_reason": "stop",
        }],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }


# ── Endpoints ─────────────────────────────────────────────────────
@app.get("/health")
@app.get("/api/status")
def health():
    return {
        "status":    "ok",
        "service":   "hermes-bridge",
        "version":   "2.1.0",
        "container": CONTAINER,
    }

@app.get("/v1/models")
@app.get("/api/v1/models")
def models():
    return {
        "object": "list",
        "data":   [{"id": "hermes", "object": "model",
                    "created": int(time.time()), "owned_by": "nous-research"}],
    }

@app.post("/v1/chat/completions")
@app.post("/api/v1/chat/completions")
def chat(req: ChatRequest):
    user_msg = next(
        (m.content for m in reversed(req.messages) if m.role == "user"), None
    )
    if not user_msg:
        raise HTTPException(400, "No user message")

    print(f"  → Hermes: {user_msg[:80]!r}")
    t0   = time.time()
    text = call_hermes(user_msg)
    print(f"  ✓ {time.time()-t0:.1f}s  reply: {text[:80]!r}")
    return make_response(text, req.model or "hermes")


# ── Main ──────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    print(f"""
  ╔══════════════════════════════════╗
  ║      Hermes Bridge  v2.1         ║
  ║   docker exec -z  (one-shot)     ║
  ╠══════════════════════════════════╣
  ║  Container : {CONTAINER:<20}║
  ║  Hermes    : {HERMES_BIN[-20:]:<20}║
  ║  Port      : {PORT:<20}║
  ║  Timeout   : {TIMEOUT:<19}s║
  ╚══════════════════════════════════╝
""")
    uvicorn.run(app, host="0.0.0.0", port=PORT)
