# Agent Handoff — Current State
> Updated: 2026-06-17 04:37 IDT | Branch: main | Handoff from: Hermes Deamon-1 / Telegram

---

=== AVAGENTOS_HANDOFF_START ===
Project: AvAgentOS Mission Control
Repository path: /home/deamond_1/AI-Agents-Workspace/users/Avner/projects/AvAgentOS
Windows-facing historical path: D:\Avner Man Software\AvAgentOS
Current branch: main
Git status: main is ahead of origin/main by 1 commit; pending local changes in docs/planning/agent-handoff-current-state.md, docs/planning/project-status.md, hermes-bridge/agents_config.json, hermes-bridge/bridge.py, and server.js before this commit pass.
Current phase: Phase 2 — Feature Buildout / local agent coordination
What I read: DEAMON_LOCAL_CONTEXT.md, AVNER_AGENT_RULES.md, ACTIVE_TOPICS.md, HERMES_NODE_SETUP_CHECKLIST.md, existing AvAgentOS handoff/status/decision/open-question docs.
What I changed: updated docs/planning/agent-handoff-current-state.md and docs/planning/project-status.md to reflect the current Deamon-1/AvAgentOS state; verified required handoff fields; prepared the current source/docs changes for a local Git commit; removed generated __pycache__ from the commit scope.
Important files: server.js, hermes-bridge/bridge.py, hermes-bridge/agents_config.json, public/app.js, public/index.html, public/style.css, docs/planning/*, docs/contracts/*.
Architecture summary: AvAgentOS is still a Node/Express + Socket.io local mission-control dashboard. Hermes Bridge is FastAPI on port 8765 and routes to local Hermes profiles through /agent/{id}/api/v1/chat/completions. Current uncommitted work enriches bridge/local-agent capability metadata and seeds default Deamon-1 local agents in the dashboard.
Contracts/status: Command envelope is still sent through the HTTP user field. Bridge /health now exposes capabilities. Dashboard can read capabilities from bridge health responses. New /api/agent-contracts returns default local agent definitions.
Next safe step: after this commit, optionally run a local runtime smoke test of dashboard http://localhost:3131 with bridge http://127.0.0.1:8765, then push only if Avner explicitly approves.
Do not do: do not read .env, agents.json secrets, auth files, tokens, browser/profile data, or Windows personal folders. Do not push, expose LAN/public access, enable cron/gateway/services, or run destructive commands without explicit approval.
Open questions: whether default local agents should be persisted automatically or only shown as managed registry entries; whether reviewer profile exists/configured on this node; whether agent identity should be fully standardized as agent-declared stable IDs; whether approval gates should block write_project actions before dispatch.
Commands/checks run: read planning/context docs; git status --short --branch; git remote -v; git branch --show-current; git diff --stat; required handoff field check; read handoff/project-status files; date; python3 -m py_compile hermes-bridge/bridge.py; node --check server.js; python3 -m json.tool hermes-bridge/agents_config.json.
=== AVAGENTOS_HANDOFF_END ===

---

## Current Project Status

AvAgentOS is Avner's local Mission Control/control-plane for coordinating Hermes/Deamon agents. In the current Deamon-1 checkout, the active repository is:

```text
/home/deamond_1/AI-Agents-Workspace/users/Avner/projects/AvAgentOS
```

The app is expected to run locally on port 3131, with Hermes Bridge expected on port 8765.

Before this commit pass, the working tree had uncommitted source/documentation changes in:

```text
hermes-bridge/agents_config.json
hermes-bridge/bridge.py
server.js
docs/planning/agent-handoff-current-state.md
docs/planning/project-status.md
```

There was also an untracked generated directory, excluded from commit scope:

```text
hermes-bridge/__pycache__/
```

Do not commit `__pycache__/`; remove it or ensure `.gitignore` covers it before commit.

---

## Current Uncommitted Work Summary

### server.js

Adds/updates default local bridge-hosted agents:

- `cheap_buddy` — low-cost Hermes worker profile on Deamon-1.
- `reviewer` — proposed read-only reviewer profile for code/plan/risk checks.

Adds helper functions and behavior:

- `DEFAULT_BRIDGE_HOST` / `DEFAULT_BRIDGE_PORT` from env with local defaults.
- `bridgeHostedAgent(...)` helper for Hermes bridge-backed dashboard agents.
- `DEFAULT_LOCAL_AGENTS` registry.
- `seedDefaultLocalAgents()` so default Deamon-1 agents appear in the dashboard.
- `GET /api/agent-contracts` to expose default local agent definitions.
- Agent creation now accepts optional requested `id`, `role`, `riskLevel`, and `capabilities`.
- Agent IDs from requests are normalized to lowercase safe slugs.
- `pingAgent()` now reads bridge health JSON and merges returned capabilities into the dashboard agent record.

### hermes-bridge/bridge.py

Extends bridge agent definitions with metadata fields:

- `cwd`
- `default_user`
- `user_profiles`
- `capabilities`

Updates `/agent/{id}/health` response to include:

- `status`
- `agent`
- `name`
- `version`
- `capabilities`
- `config`

### hermes-bridge/agents_config.json

Adds capability blocks for local agents and introduces/keeps these local identities:

- `default`
- `cheapworker` as a legacy alias for `cheap_buddy`
- `cheap_buddy`
- `reviewer`
- `deamon-1`
- `avneraibuddy`

Important durable fact: on Deamon-1 the low-cost Hermes profile is named `cheap_buddy`, not `cheapworker`. `cheapworker` should be treated as a legacy alias only.

---

## What Was Previously Built

Previous handoff indicated these features already existed or were in progress:

- Projects screen with CRUD and "Ask Agent" flow.
- Gemini integration.
- OpenRouter integration.
- Hermes Bridge v3.1 with Docker and local mode.
- Auto-Onboard wizard.
- Obsidian Memory integration.
- Command envelope contract.
- Agent persistence and project persistence.

Those older items may still need fresh verification in this Deamon-1 checkout before relying on them.

---

## Current Architecture Understanding

```text
AvAgentOS dashboard/server
├── server.js                         Node/Express/Socket.io backend, port 3131
├── public/                           Vanilla HTML/CSS/JS frontend
├── memory.js                         Optional Obsidian vault reader/writer
├── docs/contracts/                   Command/capability/registration contracts
└── hermes-bridge/
    ├── bridge.py                     FastAPI bridge, port 8765
    └── agents_config.json            Hot-reloaded local agent registry
```

Bridge routing:

```text
POST /agent/{id}/api/v1/chat/completions
GET  /agent/{id}/health
```

Dashboard now expects bridge health to provide capability metadata where available.

---

## What Is Working / Likely Working

Not freshly tested in this handoff pass, but code indicates:

- Dashboard can seed local Hermes bridge-backed agents.
- Bridge can represent local agents with capability metadata.
- Dashboard can query bridge health and merge capability metadata.
- Stable local IDs are possible for default agents such as `cheap_buddy` and `deamon-1`.

Needs local runtime verification before marking complete.

---

## Known Blockers / Risks

1. Runtime not verified in this handoff pass.
2. `reviewer` profile may not exist/configured yet; verify with Hermes profile tooling before relying on it.
3. `hermes-bridge/__pycache__/` is untracked generated output and should not be committed.
4. `.env` and agent registry files may contain secrets; do not read or print them.
5. Approval gates are not yet enforced in the dashboard; `riskLevel` is metadata at this point unless code elsewhere enforces it.
6. Built-in/default local agents are seeded in memory; confirm intended persistence behavior before broadening this pattern.

---

## Next Recommended Step

When Avner returns, continue with a safe local-only verification gate:

```bash
cd /home/deamond_1/AI-Agents-Workspace/users/Avner/projects/AvAgentOS
python -m py_compile hermes-bridge/bridge.py
node --check server.js
git status --short
```

Then, if checks pass and Avner approves runtime testing:

```bash
npm start
# or
node server.js
```

Open/check:

```text
http://localhost:3131
```

If testing bridge too, verify bridge separately on local-only host/port before wiring anything to LAN.

---

## Safety Boundaries

- Do not read or print `.env`, `auth.json`, API keys, OAuth tokens, private keys, browser cookies, passwords, or credential caches.
- Do not access Windows personal folders without exact explicit approval.
- Do not push to GitHub without Avner approval.
- Do not expose the dashboard publicly or configure LAN/firewall/service startup without explicit approval.
- Do not run destructive filesystem, Docker, Git, service, or package-management commands without explicit approval.
- Prefer local-only synthetic smoke tests first.

---

## Resume Phrase

```text
עבור ל-AvAgentOS והמשך לפי docs/planning/agent-handoff-current-state.md
```
