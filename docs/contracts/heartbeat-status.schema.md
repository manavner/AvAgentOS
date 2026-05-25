# Contract: Heartbeat / Status
> Version: 0.1 | Status: Implemented (basic) | Last updated: 2026-05-25

Describes the health check protocol between AvAgentOS and remote agents/bridges.

---

## Purpose

- Determine if an agent is reachable
- Measure latency
- Optionally receive capability metadata

---

## Current Implementation

AvAgentOS pings all non-built-in agents every 30 seconds via `pingAgent(agentId)` in `server.js`.

**Request:**
```
GET http://{host}:{port}{healthEndpoint}
Timeout: 5000ms
```

- Default health endpoint: `/health` (generic agents), `/api/status` (Hermes bridge)
- Custom endpoint: `agent.config.healthEndpoint` if set

**Minimum acceptable response:**
```json
{ "status": "ok" }
```
Any HTTP 200 response counts as "online". Non-200 or timeout = "offline".

---

## Proposed Extended Response

Agents should return a richer response to enable capability detection:

```yaml
status: "ok"                    # required — "ok" | "degraded" | "error"
service: "hermes-bridge"        # string — service name
version: "3.1.0"               # string — semver
agents: ["hermes", "cheapworker"]  # list — for bridges: hosted agent IDs

# Optional capability block (see agent-capability-profile.schema.md)
capabilities:
  model: "claude-opus-4-7"
  provider: "anthropic"
  skills: ["code", "research"]
  cost_tier: "high"
  can_stream: false
```

---

## AvAgentOS Ping Loop

```
Every 30 seconds:
  for each non-built-in agent:
    GET /health (5s timeout)
    if 200 → status = "online", record latency
    if error/timeout → status = "offline"
    emit "agent:status" via Socket.io to dashboard
```

**Manual ping:** `POST /api/agents/:id/ping` triggers immediate ping.

**Socket event trigger:** `socket.on("agent:ping", { id })` triggers ping from frontend.

---

## Status Values

| Value | Meaning |
|---|---|
| `online` | Health check returned HTTP 200 |
| `offline` | Timeout or connection refused |
| `connecting` | Just registered, first ping pending |
| `error` | HTTP error (non-200 response) |
| `no-key` | Built-in agent, API key not configured |

---

## Agent-Side Recommendation

Any agent or bridge should expose:
```
GET /health   → { "status": "ok", ... }
```

If the agent is a bridge hosting multiple agents, also expose:
```
GET /agent/{id}/health   → { "status": "ok", "agent": "{id}", ... }
```
