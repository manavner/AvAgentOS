# Contract: Task Routing Suitability
> Version: 0.1 | Status: Proposed (not implemented) | Last updated: 2026-05-25

Describes the proposed model for routing tasks to the most suitable agent based on declared capabilities.

---

## Purpose

- Allow AvAgentOS to suggest or automatically select the best agent for a task
- Avoid sending expensive tasks to cheap agents and vice versa
- Enable skill-based routing (e.g., "only send code tasks to Hermes")

---

## Current State

Task routing is manual — the user selects the agent from the agent list or the Projects "Assign Agent" dropdown. There is no automatic routing.

---

## Proposed: Suitability Score

A suitability score is computed per agent, per task. Score range: 0.0 – 1.0.

### Task Descriptor

```yaml
task:
  type: "chat" | "code" | "research" | "writing" | "file_op" | "unknown"
  language: "he" | "en" | null        # expected response language
  complexity: "low" | "medium" | "high"
  requires_tools: false               # does the task need tool/function calling?
  requires_long_context: false        # does it need >32k tokens?
  project_id: "proj_1748110000000"   # optional — for project-context tasks
```

### Scoring Factors

| Factor | Weight | How to compute |
|---|---|---|
| Skill match | 40% | Skills intersection between task type and agent's declared skills |
| Language match | 20% | Agent declares the required language |
| Complexity vs cost_tier | 20% | High complexity → prefer high/medium tier; low complexity → prefer low/free |
| Tool use match | 10% | Task requires tools → agent must declare `can_use_tools: true` |
| Long context match | 10% | Task requires long context → agent must declare `max_tokens > 32000` |

### Example Routing Decision

```json
{
  "task": {
    "type": "code",
    "language": "en",
    "complexity": "high",
    "requires_tools": true,
    "requires_long_context": false
  },
  "candidates": [
    {
      "agent_id": "claude",
      "score": 0.85,
      "reasons": ["skill:code", "tool-use:yes", "complexity:high→high-tier"]
    },
    {
      "agent_id": "agent_1779570016501",
      "score": 0.75,
      "reasons": ["skill:code", "tool-use:yes", "latency:slower"]
    },
    {
      "agent_id": "gemini",
      "score": 0.60,
      "reasons": ["skill:code partial", "language:en", "no memory"]
    }
  ],
  "recommended": "claude"
}
```

---

## Proposed API Endpoint (future)

```
POST /api/route
Body: { task: TaskDescriptor }
Response: { recommended_agent_id: string, candidates: ScoredAgent[] }
```

---

## Open Questions

- Who labels the task type? (user, Claude, heuristic?) → see `open-questions.md` Q10
- Is score computed server-side (AvAgentOS) or by asking Claude to recommend? → open
- Should routing be advisory (show suggestion) or automatic (auto-select)?
- What if no agent scores above a minimum threshold (e.g., 0.4)?

---

## Implementation Notes (when ready to implement)

1. Extend `pingAgent()` to store `capabilities` block from `/health` response into `agents.json`
2. Build `scoreAgentForTask(agent, task)` function in `server.js`
3. Add `POST /api/route` endpoint
4. Add UI: task type selector + "Suggest Agent" button in chat input area
