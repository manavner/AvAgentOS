# PRD — AvAgentOS Projects Screen

Last updated: 2026-05-24
Owner: Avner / AvAgentOS
Status: draft
Parent: AvAgentOS Mission Control

---

## 1. Purpose

Add a Projects screen to AvAgentOS that allows tracking project assignments across agents, monitoring phase progress, and querying agents for live status updates.

---

## 2. Problem

Currently there is no way to see which agent is working on which project, what phase each project is in, or to request a status update from the assigned agent — without manually opening a chat.

---

## 3. Target users

- **Avner (now):** single admin/user, sees all projects and all agents.
- **Future users:** multiple users; each sees their assigned projects.
- **Future admin:** one network admin who sees all users, all projects, all agents.

---

## 4. In-scope (this phase)

- Projects list view: name, assigned agent, phase, last updated.
- Add / Edit / Delete project (manual, via form).
- Assign project to one agent (dropdown from connected agents).
- Phase field: free text OR predefined list (TBD — see open questions).
- **"Ask Agent" button:** sends `"what is the status of project <name>"` to the assigned agent and displays the response inline.
- Persist projects to `projects.json` on the AvAgentOS server.
- Projects tab / panel in the existing dashboard UI.

---

## 5. Out of scope (not now)

- Automatic sync / import of projects from Hermes memory (future).
- Multi-user project ownership and permissions (future).
- Admin vs user role separation (future).
- Task subtraction inside a project (future).
- Assigning a project to multiple agents simultaneously (future).
- Gantt / timeline view (future).
- Notifications / alerts on phase change (future).

---

## 6. User flow

1. User opens AvAgentOS dashboard → clicks **"Projects"** tab.
2. Sees a table of projects (empty on first use).
3. Clicks **"+ New Project"** → fills in: name, agent (dropdown), phase, optional description.
4. Project appears in the table.
5. User clicks **"Ask Agent"** on a row → AvAgentOS sends the status query to the assigned agent → response appears in a small panel below the row (or a modal).
6. User can edit phase manually after receiving the response.
7. User can delete a project.

---

## 7. Data model

```json
{
  "id": "proj_<timestamp>",
  "name": "daemon-companion-ai",
  "display_name": "Daemon Companion AI",
  "assigned_agent_id": "agent_1779570016501",
  "phase": "Phase 0 — Discovery",
  "status": "in_progress",
  "description": "",
  "created_at": "ISO8601",
  "updated_at": "ISO8601",
  "last_agent_response": "",
  "last_queried_at": null
}
```

---

## 8. Deliverables

| File | Purpose |
|---|---|
| `projects.json` | persistent data store |
| `server.js` additions | REST API: GET/POST/PUT/DELETE `/api/projects`, POST `/api/projects/:id/query` |
| `public/index.html` | Projects tab button |
| `public/app.js` | Projects panel logic + Ask Agent handler |
| `public/style.css` | Projects panel styles |

---

## 9. API endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/projects` | list all projects |
| POST | `/api/projects` | create project |
| PUT | `/api/projects/:id` | update project |
| DELETE | `/api/projects/:id` | delete project |
| POST | `/api/projects/:id/query` | ask assigned agent for status |

---

## 10. Decisions (resolved)

1. **Phase field** — free text. ✅
2. **"Ask Agent" query language** — Hebrew by default. ✅
3. **Projects tab location** — new top tab in dashboard. ✅
4. **Import from Hermes** — yes, one-time import button included. ✅

---

## 11. Acceptance criteria

- [ ] Projects tab visible in dashboard.
- [ ] Can add a project with name, agent, phase.
- [ ] Project appears in list after creation.
- [ ] "Ask Agent" button sends query to assigned agent and shows response.
- [ ] Projects survive server restart (saved to `projects.json`).
- [ ] Can edit and delete a project.
- [ ] No secrets, personal paths, or credentials exposed.

---

## 12. Handoff contract (for future phases)

The next phase (multi-user / admin) may rely on:
- `project.id` as stable identifier.
- `project.assigned_agent_id` matching a valid agent in `agents.json`.
- REST API at `/api/projects` being stable.

The next phase must NOT assume:
- User identity is embedded in projects yet (not in this phase).
- Multi-agent assignment exists.
- Automatic sync with Hermes memory exists.

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| "Ask Agent" takes 60s (Hermes timeout) | Show loading spinner; non-blocking |
| `projects.json` corrupted | Wrap in try/catch; keep backup |
| Agent offline when querying | Show error inline, don't crash |
