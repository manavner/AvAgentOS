# AvAgentOS — Decision Log
> Last updated: 2026-05-25

All important architectural and product decisions, in reverse-chronological order.

---

## 2026-05-24 — Projects screen design decisions

**D-010: Phase field = free text**
- Rejected: predefined enum (Phase 0 / Phase 1 / etc.)
- Chosen: free text input
- Reason: projects have too many diverse phases; enum would be too constraining

**D-009: "Ask Agent" query language = Hebrew**
- Default query: `מה הסטאטוס בפרויקט {name}?`
- Reason: primary user (Avner) works with Hermes in Hebrew

**D-008: Projects tab = top-level nav tab**
- Rejected: nested panel inside Mission Control
- Chosen: separate tab in the top nav bar (alongside "Mission Control")
- Reason: Projects is a first-class screen, not a widget

**D-007: Import from Hermes = one-time modal**
- User can query any connected agent for a JSON list of their projects
- Response is parsed and bulk-imported
- Reason: avoid complex sync protocol; simple one-shot import

---

## 2026-05-24 — Bridge decisions

**D-006: Bridge v3.1 adds local (non-Docker) agent support**
- `agents_config.json` now supports `type: "local"` with a `bin` field
- Local agents are invoked via `hermes --profile X --one-shot "..."` subprocess
- Reason: user has Hermes installed natively in WSL, not always running in Docker

**D-005: Single bridge process for all Hermes agents**
- One `bridge.py` process handles all agents
- Routing: URL-based (`/agent/{id}/...`) preferred; model-field fallback for backward compat
- `agents_config.json` is hot-reloaded every 5 seconds — no restart needed
- Reason: simpler operations, single port (8765) to manage on Linux

---

## 2026-05-24 — Command envelope decision

**D-004: Command envelope injected as `user` JSON field**
- Every HTTP chat request from AvAgentOS includes `user: JSON.stringify(envelope)`
- Envelope contains: `request_id`, `timestamp`, `source: "avagentos"`, `from_user`, `from_device`, `gui_session`, `permissions`
- Reason: agents need to know who is sending what, for logging and future permission gating
- See: `docs/contracts/command-envelope.schema.md`

---

## 2026-05-23 — Architecture decisions

**D-003: Agent registration model — hybrid (manual + auto-onboard)**
- Agents can be added manually (name, host, port, format, API key)
- Auto-Onboard: paste a discovery report → server parses IP, creates agent entry, generates bridge config
- Agents are persisted in `agents.json`; built-in agents (Claude, Gemini, OpenRouter) are never saved
- Reason: most agents need manual setup; auto-onboard reduces friction for Hermes

**D-002: No frontend framework — vanilla HTML/CSS/JS**
- Rejected: React, Vue, Svelte
- Chosen: pure HTML + CSS custom properties + vanilla JS + Socket.io client
- Reason: zero build tooling, easy to audit, runs directly in browser, no transpilation
- Trade-off: more verbose DOM manipulation, no component system

**D-001: AvAgentOS as standalone repo**
- Rejected: embedding inside Hermes repo, or as a Hermes plugin
- Chosen: independent repo at `D:\Avner Man Software\AvAgentOS`
- Reason: separate concerns — AvAgentOS is a control plane, not part of any agent
- Trade-off: no shared code with Hermes; communication is HTTP-only

---

## Pending / Deferred Decisions

**PD-001: Task routing by difficulty / model / skills**
- Not yet decided: how to define agent suitability score
- See `open-questions.md` → "Task routing"

**PD-002: Authentication / authorization**
- Not yet decided: how to authenticate users to the dashboard
- Current state: no auth — dashboard is open to anyone on LAN
- See `open-questions.md` → "Approval gates"

**PD-003: Agent identity — stable ID format**
- Current: `agent_<timestamp>` (e.g. `agent_1779570016501`)
- Not yet decided: whether to use a UUID, hostname-based ID, or user-defined slug
- Impact: if ID changes, project assignments break

**PD-004: Audit log**
- Not yet decided: whether to write a persistent audit log and where
- Current state: system log is in-memory, lost on server restart
