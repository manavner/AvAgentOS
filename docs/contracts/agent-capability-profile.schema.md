# Contract: Agent Capability Profile
> Version: 0.1 | Status: Proposed (not yet implemented) | Last updated: 2026-05-25

An agent capability profile describes what an agent can do, what model it uses, and how suitable it is for different task types. This is a proposed extension to the `/health` endpoint response.

---

## Purpose

- Allow AvAgentOS to display agent capabilities in the UI
- Enable automatic task routing based on skill matching
- Allow the user to see at a glance which agent to use for a given task

---

## Current State

Currently the `/health` response is minimal:
```json
{ "status": "ok", "name": "hermes", "version": "3.0" }
```

The capability profile extends this.

---

## Proposed Schema

```yaml
# Returned by GET /health or GET /api/status
status: "ok"                    # required
name: "hermes-main"             # string — display name
version: "3.0.0"               # string

# ── Capability block (optional, but preferred) ──────────────────
capabilities:
  model: "claude-opus-4-7"     # string — primary model being used
  provider: "anthropic"        # enum: anthropic | google | openai | openrouter | local | other
  cost_tier: "high"            # enum: free | low | medium | high
  max_tokens: 200000           # integer | null
  response_time_ms: 3000       # integer — expected P50 latency in ms | null

  languages:                   # list of ISO 639-1 codes or free text
    - "en"
    - "he"

  skills:                      # list of capability tags (free text for now)
    - "code"
    - "research"
    - "writing"
    - "tool-use"
    - "memory"
    - "long-context"

  can_stream: false            # boolean — supports streaming responses?
  can_use_tools: true          # boolean — supports tool/function calling?

  description: "Main Hermes agent — Anthropic Claude via hermes CLI"
```

---

## Full Example

```json
{
  "status": "ok",
  "name": "hermes-main",
  "version": "3.1.0",
  "capabilities": {
    "model": "claude-opus-4-7",
    "provider": "anthropic",
    "cost_tier": "high",
    "max_tokens": 200000,
    "response_time_ms": 4000,
    "languages": ["en", "he"],
    "skills": ["code", "research", "writing", "tool-use", "memory", "long-context"],
    "can_stream": false,
    "can_use_tools": true,
    "description": "Main Hermes agent — Anthropic Claude"
  }
}
```

---

## Implementation Notes

- AvAgentOS should request `/health` on every ping and merge `capabilities` into the stored agent record
- If `/health` returns no `capabilities` block, the agent is treated as a generic agent
- Skills list is free text for now — no global taxonomy yet (see `open-questions.md` Q9)
- `cost_tier` is informational only — no billing enforcement
