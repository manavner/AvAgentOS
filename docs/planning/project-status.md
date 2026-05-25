# AvAgentOS — Project Status
> Last updated: 2026-05-25

---

## Phase

**Phase 2 — Feature Buildout**

Phase 1 (scaffold + basic agent chat) is complete. Phase 2 is in progress: adding coordination features (Projects, Obsidian memory, multi-agent support, bridge v3).

---

## Status

**Active development — uncommitted working changes present**

The server is functional. Current working changes add the Projects screen and additional built-in agents (Gemini, OpenRouter). These changes are ready to commit.

---

## Active Work

- Projects screen (add/edit/delete/query) — implemented, not committed
- Gemini built-in agent — implemented, not committed
- OpenRouter built-in agent — implemented, not committed
- Hermes Bridge v3.1 local mode — implemented, not committed to git; not deployed to WSL host
- This handoff documentation — being written now

---

## Completed Work

| Item | Commit | Date |
|---|---|---|
| Initial dashboard v1.0 (Claude chat, agent panel, system log) | `0141405` | ~2026-05-23 |
| start.bat launcher | `aba7f77` | ~2026-05-23 |
| Hermes Bridge + agent persistence + inbox/command queue | `c41891d` | ~2026-05-23 |
| Multi-agent bridge v3.0 | `04e0cdf` | ~2026-05-24 |
| Auto-Onboard wizard | `6e0ee02` | ~2026-05-24 |
| Bridge v3.1 local agent support | `b5d931d` | ~2026-05-24 |
| Projects PRD written | docs/planning/prd/ | 2026-05-24 |
| Projects screen implementation | working tree | 2026-05-24–25 |
| Gemini + OpenRouter built-in agents | working tree | 2026-05-24–25 |

---

## Next Gate

**Commit current changes** → test Projects screen end-to-end → decide next feature.

Candidate next features (unordered):
1. Agent capability metadata (skills, model, suitability)
2. Task routing by capability
3. Approval gate for high-risk commands
4. Multi-user / auth layer
5. Automatic project sync from Hermes memory
6. Audit log / history

---

## Open Blockers

| Blocker | Impact | Owner |
|---|---|---|
| `.env` must be configured with API keys | Claude/Gemini won't work without keys | User |
| Bridge not deployed to WSL host | Hermes agents offline | User |
| Gemini not tested end-to-end | Unknown if Gemini SDK integration works | Hermes |
| OpenRouter not tested end-to-end | Unknown if OpenRouter agent works | Hermes |

---

## Runtime / Dev Notes

- **Start server:** `node server.js` or `npm start` from `D:\Avner Man Software\AvAgentOS`
- **Dev mode (auto-restart):** `npm run dev`
- **Port:** 3131
- **Dashboard URL:** `http://localhost:3131`
- **No build step** — vanilla JS, no compilation needed
- **Bridge (Linux/WSL):** `cd hermes-bridge && python bridge.py` — requires FastAPI, uvicorn, pydantic
- **Bridge port:** 8765

---

## Current Repo Structure Summary

```
AvAgentOS/
├── server.js              ← Main backend (Express + Socket.io + AI clients)
├── memory.js              ← Obsidian vault memory module
├── package.json
├── package-lock.json
├── .env                   ← API keys (NOT in git)
├── .env.example           ← Key template (safe to commit)
├── .gitignore
├── agents.json            ← Saved external agent registry
├── projects.json          ← Projects store (auto-created)
├── start.bat              ← Full launcher (npm install + server)
├── start-server.bat       ← Quick launcher (node server.js only)
├── public/
│   ├── index.html         ← Full dashboard UI
│   ├── app.js             ← Frontend logic (~1000+ lines)
│   └── style.css          ← Dark sci-fi theme (~1200+ lines)
├── hermes-bridge/
│   ├── bridge.py          ← Multi-agent bridge v3.1 (FastAPI)
│   ├── agents_config.json ← Bridge agent list (hot-reloaded)
│   ├── requirements.txt   ← Python deps
│   ├── Dockerfile
│   └── start.bat          ← Windows launcher for bridge
├── docs/
│   ├── planning/
│   │   ├── prd/
│   │   │   └── projects-screen-prd.md
│   │   ├── agent-handoff-current-state.md   ← this handoff
│   │   ├── project-status.md                ← this file
│   │   ├── decision-log.md
│   │   └── open-questions.md
│   └── contracts/
│       ├── command-envelope.schema.md
│       ├── agent-capability-profile.schema.md
│       ├── bridge-registration.schema.md
│       ├── heartbeat-status.schema.md
│       └── task-routing-suitability.schema.md
└── node_modules/          ← npm packages (not in git)
```
