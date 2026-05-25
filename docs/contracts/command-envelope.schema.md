# Contract: Command Envelope
> Version: 1.0 | Status: Implemented | Last updated: 2026-05-25

Every HTTP request sent from AvAgentOS to a remote agent includes a `user` field containing a JSON-stringified command envelope. This allows agents to identify the source, user, and context of every request.

---

## Purpose

- Let agents know who is sending a request (user identity, device)
- Carry session context (active project, topic)
- Carry permission level for the request
- Lay groundwork for future audit logging and approval gating

---

## Transport

The envelope is serialized as JSON and passed in the `user` field of the OpenAI-compatible chat request body:

```json
{
  "model": "hermes",
  "messages": [...],
  "stream": false,
  "user": "{\"envelope_version\":\"1.0\", ...}"
}
```

Agents that do not support the `user` field will ignore it safely.

---

## Schema

```yaml
envelope_version: "1.0"          # string, semver

request_id: "req_1748120000000"  # string, unique per request

timestamp: "2026-05-25T10:00:00.000Z"  # ISO 8601 UTC

source: "avagentos"              # always "avagentos" for now

from_user:
  user_id: "1532243300"          # string — user identifier
  display_name: "Avner Man"      # string — human-readable name
  auth_level: "local_gui_verified"  # enum: local_gui_verified | api_key | unauthenticated

from_device:
  device_id: "AVNER-PC"         # string — os.hostname() for now
  hostname: "AVNER-PC"          # string — same as device_id currently

gui_session:
  session_id: null | "sess_..."  # string | null — future socket session ID
  topic: null | "string"         # string | null — conversation topic if known
  project_id: null | "proj_..."  # string | null — active project ID if relevant

permissions:
  role: "owner"                  # enum: owner | admin | user | read-only
  risk_level_allowed: "write_project"  # enum: read-only | write_project | execute | unrestricted
```

---

## Example (full)

```json
{
  "envelope_version": "1.0",
  "request_id": "req_1748120123456",
  "timestamp": "2026-05-25T10:02:03.456Z",
  "source": "avagentos",
  "from_user": {
    "user_id": "1532243300",
    "display_name": "Avner Man",
    "auth_level": "local_gui_verified"
  },
  "from_device": {
    "device_id": "AVNER-PC",
    "hostname": "AVNER-PC"
  },
  "gui_session": {
    "session_id": null,
    "topic": "daemon-companion-ai",
    "project_id": "proj_1748110000000"
  },
  "permissions": {
    "role": "owner",
    "risk_level_allowed": "write_project"
  }
}
```

---

## Implementation Notes

- Generated in `server.js` by `buildEnvelope(sessionContext)` function (line ~407)
- `user_id`, `display_name`, `role`, `risk_level_allowed` are currently hardcoded from `.env` vars: `DEFAULT_USER_ID`, `DEFAULT_USER_NAME`, `DEFAULT_USER_ROLE`
- `session_id` is always `null` for now (Socket.io session not yet threaded through)
- Future: agents should log `request_id` in their own audit trail
