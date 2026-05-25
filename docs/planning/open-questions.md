# AvAgentOS — Open Questions
> Last updated: 2026-05-25

Unresolved questions that need decisions before or during the next phase.

---

## Bridge Pairing

**Q1: How does AvAgentOS know which bridge instance to trust?**
- Currently: any process on LAN that responds to `/health` is a candidate
- Risk: malicious process could impersonate a bridge
- Options: shared secret, mTLS, IP allowlist
- Priority: medium (LAN-only for now)

**Q2: Should the bridge register itself with AvAgentOS on startup?**
- Currently: AvAgentOS pings agents; agents are passive
- Alternative: bridge POSTs to `/api/inbox` on startup to announce itself
- Would enable: zero-config agent discovery

---

## Agent Identity

**Q3: What is the stable, canonical identity of an agent?**
- Currently: `agent_<timestamp>` (unstable — changes on re-registration)
- Problem: if project references `assigned_agent_id: "agent_1779570016501"` and agent is re-added, the link breaks
- Options: user-defined slug (`hermes-wsl`), UUID at first registration, fingerprint from `/health` response
- Priority: high — blocks stable project assignments

**Q4: Should agent ID be assigned by the agent (self-reported) or by AvAgentOS?**
- Currently: AvAgentOS assigns on registration
- Alternative: agent declares `id` in its `/health` response; AvAgentOS uses that

---

## Host Identity

**Q5: How is the AvAgentOS host itself identified?**
- Currently: `os.hostname()` is used as `from_device.hostname` in the command envelope
- Problem: hostnames are not unique on some networks
- Options: generate a UUID at first startup and persist it in `.env` or a state file

---

## Agent Capability Enrichment

**Q6: What capabilities should an agent declare?**
- Proposed fields: `skills[]`, `model`, `provider`, `max_tokens`, `cost_tier`, `languages[]`, `response_time_ms`
- Open: who defines the schema — AvAgentOS or the agent?
- Proposed: agent declares in `/health` response; AvAgentOS reads and stores
- See: `docs/contracts/agent-capability-profile.schema.md`

**Q7: How does AvAgentOS learn what a new agent can do?**
- Currently: user manually describes the agent
- Future: auto-discover from `/health` capability block
- Open: what if the agent can't self-describe?

---

## Model / Provider Metadata

**Q8: Should AvAgentOS track which model each agent uses?**
- Currently: stored as `config.model` but not displayed prominently
- Future: show model name in agent card; use it for routing
- Open: how to normalize model names across providers (Anthropic, Google, OpenRouter, local)?

---

## Skill Inventory

**Q9: Is there a global skill taxonomy or is it per-agent free text?**
- Options: predefined enum (`code`, `research`, `writing`, `math`, `hebrew`, etc.), free text, or tags
- Open: who curates the taxonomy?

---

## Task Routing

**Q10: How is a task routed to the most suitable agent?**
- Currently: user selects agent manually
- Proposed: suitability scoring based on declared capabilities vs task requirements
- Open: who scores the task? (Claude? AvAgentOS heuristic? User labels?)
- Open: what is the suitability score formula?
- See: `docs/contracts/task-routing-suitability.schema.md`

**Q11: Should there be a "default agent" fallback if no match is found?**
- Options: always Claude, always first-registered agent, error out and ask user
- Proposed: fallback to Claude with a warning

---

## Approval Gates

**Q12: Which commands require human approval before being sent to an agent?**
- Currently: none — all commands are sent immediately
- Proposed levels: none / log-only / require-confirm / blocked
- Open: who defines the risk level? Agent? AvAgentOS config? Per-project?
- Priority: medium (LAN-only, single user for now)

**Q13: Should there be a "dry run" mode that previews what will be sent?**
- Open: useful for high-risk operations (file writes, deploys)

---

## Audit

**Q14: Should AvAgentOS maintain a persistent audit log?**
- Currently: system log is in-memory only; lost on restart
- Options: append to `audit.json`, write to SQLite, write to Obsidian vault
- Open: what events to log (all commands? only writes? errors?)
- Priority: low (single user, no compliance requirement yet)

---

## Remote Execution Boundaries

**Q15: What can AvAgentOS instruct a remote agent to do?**
- Currently: send a chat message only — no direct file access, no shell execution
- Command queue (`/api/commands/:agent`) — message-only, agent decides what to do with it
- Open: should there be a "run this script" command type? Or is that always out of scope?
- Decision principle: AvAgentOS sends intents/messages; agents execute in their own sandbox

**Q16: Should the command queue support typed commands (not just free-text messages)?**
- Proposed: `{ type: "chat" | "file_write" | "run_task" | "status_check", payload: ... }`
- Open: do all agents need to implement all types?

---

## Product Transfer / Customer Deployment

**Q17: How would a second user install and run AvAgentOS?**
- Currently: no installer, manual setup, requires editing `.env`
- Open: should there be an `npx create-avagent-os` scaffolder?
- Open: should the bridge have a one-command install script?

**Q18: Is AvAgentOS intended to be a multi-tenant product or always single-user?**
- Currently: single user, no auth
- PRD mentions "future admin" role
- Open: when does multi-user become a priority? What triggers it?

**Q19: Should AvAgentOS be open-sourced?**
- Open: no decision yet
