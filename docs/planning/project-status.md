# AvAgentOS — Project Status
> Last updated: 2026-06-17 04:37 IDT

---

## Phase

**Phase 2 — Feature Buildout / Deamon-1 local agent coordination**

Phase 1 scaffold/basic agent chat is considered complete from previous work. Phase 2 is focused on coordination features: Projects, multi-agent support, Hermes Bridge local profile routing, capability metadata, risk metadata, and future approval gates.

---

## Status

**Ready for local commit — source/documentation changes reviewed for handoff completeness**

Current Deamon-1 checkout:

```text
/home/deamond_1/AI-Agents-Workspace/users/Avner/projects/AvAgentOS
```

Current branch:

```text
main
```

Current working tree summary before this commit pass:

```text
 M docs/planning/agent-handoff-current-state.md
 M docs/planning/project-status.md
 M hermes-bridge/agents_config.json
 M hermes-bridge/bridge.py
 M server.js
```

Generated `hermes-bridge/__pycache__/` was excluded from the commit scope.

---

## Active Work

- Deamon-1 local Hermes agents are being modeled as default bridge-hosted agents inside AvAgentOS.
- `cheap_buddy` is the correct low-cost Hermes profile name on Deamon-1.
- `cheapworker` exists only as a legacy alias in bridge config.
- `reviewer` is proposed as a read-only reviewer profile; verify profile existence/configuration before relying on it.
- Agent capability metadata is being added to bridge config and exposed through bridge health.
- Dashboard ping logic can merge returned capabilities into agent records.
- Dashboard has a new `/api/agent-contracts` endpoint exposing default local agent definitions.

---

## Completed Work / Existing Base

Previously documented base features:

| Item | Status |
|---|---|
| Initial dashboard v1.0 | Existing |
| Claude chat | Existing, requires configured API key |
| Agent panel and system log | Existing |
| Hermes Bridge + agent persistence + inbox/command queue | Existing |
| Multi-agent bridge v3.x | Existing |
| Auto-Onboard wizard | Existing |
| Projects screen | Implemented previously; needs fresh verification |
| Gemini + OpenRouter built-in agents | Implemented previously; needs configured keys and fresh verification |
| Obsidian Memory integration | Existing optional integration; requires configured vault path |
| Command envelope contract | Existing in docs/contracts |
| Local bridge capability metadata | Current uncommitted work |
| Default Deamon-1 local agent registry | Current uncommitted work |

---

## Next Gate

**Safe local-only verification gate** before commit or broader runtime use:

```bash
cd /home/deamond_1/AI-Agents-Workspace/users/Avner/projects/AvAgentOS
python -m py_compile hermes-bridge/bridge.py
node --check server.js
git status --short
```

If checks pass and Avner approves runtime testing:

```bash
npm start
# or
node server.js
```

Expected dashboard URL:

```text
http://localhost:3131
```

Expected bridge URL when bridge is running:

```text
http://127.0.0.1:8765
```

Do not expose to LAN/public or configure services/startup without explicit approval.

---

## Candidate Next Features / Decisions

1. Agent capability metadata UI display.
2. Task routing by capability and cost tier.
3. Approval gates based on `riskLevel` and command envelope auth level.
4. Stable agent identity policy for local/remote agents.
5. Persistent audit log.
6. Decide whether default local agents should be auto-seeded, manually added, or generated from bridge discovery.
7. Verify and define reviewer profile lifecycle.

---

## Open Blockers

| Blocker | Impact | Owner |
|---|---|---|
| Runtime not freshly verified after current changes | Unknown whether server/bridge start cleanly | Hermes/Avner |
| `reviewer` profile may not exist/configured | Reviewer agent may fail if selected | Hermes/Avner |
| `__pycache__` untracked | Must not be committed | Hermes |
| API keys/config required in `.env` for built-in cloud agents | Claude/Gemini/OpenRouter may not work without local config | Avner local setup |
| Approval gates not enforced yet | `riskLevel` is metadata unless enforcement is added | Hermes |
| Stable identity policy not finalized | Project assignments may break for non-default agents | Avner/Hermes |

---

## Runtime / Dev Notes

- Start server from repo root with `node server.js` or `npm start`.
- Dashboard port: `3131`.
- Dashboard URL: `http://localhost:3131`.
- Bridge port: `8765`.
- Bridge routing: `POST /agent/{id}/api/v1/chat/completions`.
- Bridge health: `GET /agent/{id}/health`.
- No build step for frontend; vanilla JS/CSS/HTML.
- Never read or print `.env`, `agents.json` if it may include secrets, auth files, tokens, or credential caches.

---

## Safety Boundaries

- Local-only/read-only/synthetic checks first.
- No Git push without explicit approval.
- No public/LAN exposure, firewall changes, cron, gateway, startup services, or remote-control services without explicit approval.
- No destructive filesystem/Git/Docker/package/service commands without explicit approval.
- Do not access Windows personal folders unless Avner approves an exact path and task.
