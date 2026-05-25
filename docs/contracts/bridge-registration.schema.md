# Contract: Bridge Registration
> Version: 0.1 | Status: Partially implemented | Last updated: 2026-05-25

Describes how the Hermes bridge registers its agents with AvAgentOS, and how AvAgentOS registers an agent entry pointing at the bridge.

---

## Two-Direction Model

```
AvAgentOS (Windows :3131)   ←→   Hermes Bridge (Linux/WSL :8765)
```

**Direction 1 — AvAgentOS → Bridge:** AvAgentOS stores one agent entry per bridge-hosted agent. Each entry points to the bridge with a per-agent URL path.

**Direction 2 — Bridge → AvAgentOS (proposed):** Bridge announces itself on startup via `POST /api/inbox`. Not yet implemented.

---

## AvAgentOS Agent Record for a Bridge-Hosted Agent

This is stored in `agents.json` and passed to the frontend:

```yaml
id: "agent_1779570016501"          # AvAgentOS-assigned, timestamp-based
name: "Hermes-WSL"                  # display name
type: "hermes"
host: "192.168.1.50"                # bridge host IP
port: 8765                           # bridge port

config:
  format: "openai"                   # request format
  chatEndpoint: "/agent/hermes/api/v1/chat/completions"  # per-agent path
  healthEndpoint: "/agent/hermes/health"
  model: null                        # passed as model field in request (routes to agent)

status: "online" | "offline" | "connecting" | "error"
icon: "hermes"
builtIn: false
connectedAt: 1748120000000           # unix ms
messageCount: 0
latency: 150                         # last ping latency in ms
```

---

## Bridge `agents_config.json` Entry

The bridge's own config file describes each hosted agent:

```yaml
# Docker-hosted agent
id: "hermes"
container: "hermes"        # Docker container name
type: "docker"             # default
profile: null              # Hermes profile name (null = default)
bin: "/opt/hermes/.venv/bin/hermes"  # path to hermes binary inside container (optional)
description: "Main Hermes agent"
default_user: "avner"
user_profiles:
  avner: null              # null = default profile for this user
  admin: null

# Local (non-Docker) agent
id: "hermes-local"
container: null
type: "local"              # runs directly as subprocess
profile: null
bin: "/opt/hermes/.venv/bin/hermes"  # required for local type
description: "Hermes local install"
```

---

## Bridge API Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` or `/api/status` | Bridge health + agent list |
| GET | `/agents` | List all registered agents |
| POST | `/agents` | Register a new agent (hot-reload) |
| PUT | `/agents/{id}` | Update agent config |
| DELETE | `/agents/{id}` | Remove agent |
| POST | `/reload` | Force config reload |
| GET | `/agent/{id}/health` | Per-agent health check |
| POST | `/agent/{id}/api/v1/chat/completions` | Chat with specific agent |
| POST | `/api/v1/chat/completions` | Chat, routed by `model` field |

---

## Auto-Onboard Flow

1. User runs discovery prompt on remote machine → pastes output into AvAgentOS Auto-Onboard wizard
2. AvAgentOS `POST /api/onboard` parses: IP, hostname, Hermes bin path, profile
3. Creates agent entry (pointing to bridge port 8765)
4. Pings bridge to check if already running
5. Returns setup steps if bridge is not yet running:
   - Copy `bridge.py` + `agents_config.json` to remote
   - Add agent entry to `agents_config.json`
   - Run `python bridge.py`

---

## Open Questions

- Should bridge announce itself to AvAgentOS on startup? (see `open-questions.md` Q2)
- Should bridge have a stable ID that AvAgentOS trusts? (see `open-questions.md` Q1)
