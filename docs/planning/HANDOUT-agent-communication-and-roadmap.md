# HANDOUT — AvAgentOS Agent Communication & Roadmap

> נכתב עבור השוואה מול עבודה של סוכן/מפתח נוסף, כדי לזהות מה דומה, מה שונה, ולבנות מסמך משותף.
>
> תאריך: 2026-05-26 11:55 IDT<br>
> פרויקט: AvAgentOS<br>
> נתיב מקומי ב־Deamon-1: `/home/deamond_1/AI-Agents-Workspace/users/Avner/projects/AvAgentOS`<br>
> מצב: MVP מקומי עובד — Dashboard + Hermes Bridge + תקשורת בסיסית לסוכן מקומי.

---

## 1. מטרת המסמך

המסמך הזה מתאר את המצב הנוכחי של AvAgentOS בנושא תקשורת עם סוכנים, מה כבר עובד, מה תוקן במהלך ההפעלה המקומית על Deamon-1, ומה תוכנן להמשך הרחבת הפרויקט.

המטרה המעשית:

1. לשלוח את המסמך לצד השני.
2. להשוות מול מה שהוא בנה/תכנן.
3. לסמן:
   - מה דומה.
   - מה שונה.
   - מה חסר בכל צד.
   - מה צריך להיכנס למסמך ארכיטקטורה/PRD משותף.

---

## 2. תקציר מנהלים

AvAgentOS הוא Mission Control מקומי לניהול/תיאום סוכני AI. כרגע יש Dashboard בדפדפן, שרת Node.js, ו־Hermes Bridge בפייתון שמאפשר ל־AvAgentOS לדבר עם Hermes/Deamon agents דרך HTTP API.

ב־MVP הנוכחי המשתמש יכול:

- לפתוח Dashboard ב־`http://localhost:3131`.
- לבחור סוכן.
- לשלוח הודעת chat.
- לקבל תשובה בחזרה בצ׳אט.
- לראות סטטוס online/offline של סוכנים.
- לעבוד מול Bridge מקומי ב־`127.0.0.1:8765`.

הזרימה שנבדקה בפועל:

```text
Browser / AvAgentOS UI
→ Socket.IO
→ server.js
→ HTTP request to Hermes Bridge
→ bridge.py
→ Hermes CLI / Deamon-1 local agent
→ response
→ server.js
→ Socket.IO
→ UI chat
```

---

## 3. רכיבי המערכת הנוכחיים

### 3.1 Dashboard / Frontend

קבצים עיקריים:

```text
public/index.html
public/app.js
public/style.css
```

תפקידים:

- הצגת רשימת סוכנים.
- בחירת סוכן פעיל.
- תיבת כתיבת הודעה.
- הצגת תשובות בצ׳אט.
- system log.
- תצוגת פרויקטים קיימת/מתוכננת.
- שליטה בתצוגת טקסט:
  - הגדלת/הקטנת אותיות.
  - כיוון טקסט RTL/LTR/AUTO לעברית/אנגלית.

### 3.2 Backend / Mission Control Server

קובץ עיקרי:

```text
server.js
```

תפקידים:

- Express server על port `3131`.
- Socket.IO לתקשורת realtime עם הדפדפן.
- API לניהול agents.
- API לניהול projects.
- ניתוב הודעות chat לסוכן הנבחר.
- ping/health checks לסוכנים.
- command queue / inbox בסיסיים.

### 3.3 Hermes Bridge

קבצים עיקריים:

```text
hermes-bridge/bridge.py
hermes-bridge/agents_config.json
```

תפקידים:

- FastAPI server על port `8765`.
- endpoint לכל agent:

```text
/agent/{agent_id}/health
/agent/{agent_id}/api/v1/chat/completions
```

- תמיכה בשני סוגי agents:
  - Docker/container based agents.
  - Local agents שמריצים Hermes CLI ישירות מתוך WSL/Linux.

---

## 4. מצב ריצה נוכחי שנבדק

נכון לזמן כתיבת המסמך:

```text
AvAgentOS Dashboard: http://localhost:3131
Hermes Bridge:       http://127.0.0.1:8765
```

Listeners שנראו מקומית:

```text
3131 — node server.js
8765 — python3 bridge.py
```

Bridge status:

```json
{
  "status": "ok",
  "service": "hermes-multi-bridge",
  "version": "3.0.0",
  "agents": ["hermes", "cheapworker", "deamon-1"]
}
```

Agents גלויים ב־AvAgentOS בזמן הבדיקה:

```text
Deamon-1 Local — hermes — 127.0.0.1:8765 — online
Hermes Local   — hermes — 127.0.0.1:8765 — online
OpenRouter     — built-in / external provider — online if configured
Claude         — built-in — online if key configured
Gemini         — built-in — online if key configured
```

הערה: הופיעה גם רשומת agent בשם `aeccee7df199` על IP פנימי `172.18.0.4` במצב offline. זו כנראה רשומת discovery/legacy ואינה חלק מה־MVP היציב כרגע.

---

## 5. איך AvAgentOS מתקשר עם סוכנים

### 5.1 תקשורת מה־UI לשרת

הדפדפן לא מדבר ישירות עם הסוכן. הוא מדבר עם `server.js` דרך Socket.IO.

שליחת הודעה מתבצעת כ־event:

```text
chat:message
```

עם payload עקרוני:

```json
{
  "agentId": "<selected-agent-id>",
  "message": "הודעת המשתמש"
}
```

השרת מחזיר events כגון:

```text
chat:stream:start
chat:stream:end
chat:error
agent:status
system:log
```

### 5.2 תקשורת מהשרת לסוכן חיצוני

עבור agents מסוג Hermes, השרת בונה HTTP request ל־Bridge.

דוגמה עקרונית:

```text
POST http://127.0.0.1:8765/agent/deamon-1/api/v1/chat/completions
```

מבנה הבקשה הוא OpenAI-compatible בקירוב:

```json
{
  "model": "...",
  "messages": [
    { "role": "user", "content": "..." }
  ]
}
```

### 5.3 תקשורת Bridge ל־Hermes local

עבור `type: "local"`, ה־Bridge מפעיל Hermes CLI מקומי.

דוגמה מה־config:

```json
{
  "id": "deamon-1",
  "type": "local",
  "container": null,
  "profile": null,
  "bin": "/home/deamond_1/.local/bin/hermes",
  "cwd": "/home/deamond_1/AI-Agents-Workspace",
  "description": "Deamon-1 native WSL Hermes agent",
  "default_user": "avner"
}
```

בפועל נבדק ש־`deamon-1` עונה:

```text
User: ענה במילה אחת בלבד: מחובר
Agent: מחובר
```

---

## 6. Agents: מה עובד ומה לא עובד כרגע

### 6.1 עובד כרגע

#### Deamon-1 Local

```text
Host: 127.0.0.1
Port: 8765
Endpoint: /agent/deamon-1/api/v1/chat/completions
Health: /agent/deamon-1/health
Status: online
```

תפקיד:

- הסוכן המקומי המרכזי ב־WSL.
- כרגע זה החיבור הכי יציב ל־MVP.

#### Hermes Local

```text
Host: 127.0.0.1
Port: 8765
Endpoint: /agent/deamon-1/api/v1/chat/completions
Health: /agent/deamon-1/health
Status: online
```

תפקיד:

- alias נוח ל־Hermes המקומי.
- כרגע מצביע לאותו `deamon-1` כדי שלא יהיו רשומות offline מבלבלות.

### 6.2 לא יציב / לא פעיל כרגע

#### hermes / cheapworker legacy

רשומות ישנות הצביעו ל־:

```text
192.168.178.107:8765
```

הכתובת לא ענתה בבדיקה, ולכן הן היו offline.

בנוסף, בתוך `agents_config.json`, סוכנים אלו היו מוגדרים בעבר כ־Docker/container based:

```text
container: hermes
container: hermes-gateway
```

אבל במכונה הנוכחית:

```text
docker: command not found
```

כלומר בלי Docker או בלי שינוי ל־local mode הם לא יכולים לעבוד.

#### cheapworker

כדי ש־cheapworker יעבוד כ־local profile צריך ליצור/להגדיר profile מתאים ב־Hermes:

```text
cheapworker profile does not exist
```

החלטת MVP: לא להציג אותו כ־READY עד שיש profile/provider/model מוגדרים.

---

## 7. תיקונים שנעשו במהלך הפעלת ה־MVP על Deamon-1

### 7.1 התקנת dependencies והרצת שרת

הבעיה הראשונית:

```text
Cannot find module 'express'
```

פתרון:

```text
npm install
npm start
```

### 7.2 חיבור Bridge מקומי

נמצא ש־Bridge מקומי מאזין על:

```text
127.0.0.1:8765
```

נוסף/הוגדר agent מקומי:

```text
Deamon-1 Local
```

### 7.3 תיקוני UI / Layout

בעיה:

- אזורים תחתונים עלו אחד על השני.
- פרופורציות של הצ׳אט היו לא נוחות.

Root cause:

- ב־CSS ה־body grid הוגדר עם 3 rows, אבל בפועל היו 4 אזורי layout: topbar, nav, main, bottom.

תיקון:

- הוגדרה שורת nav נפרדת.
- הוקטנה שורת bottom.
- הוגדרו overflow/min-height נכונים לאזור הצ׳אט.

### 7.4 תיקון cursor / caret בתיבת כתיבה

בעיה:

- כשהעכבר מעל תיבת הכתיבה הוא נראה כאילו נעלם.

תיקון:

- caret color ברור.
- focus glow.
- cursor מתאים לאזור input.

### 7.5 תיקון timeout / הודעה שנייה

בעיה:

- הודעה שנייה לפעמים לא נענתה / נראתה תקועה.

תיקונים:

- timeout ב־server.js הוגדל מ־90s ל־180s.
- timeout ב־bridge.py הוגדל מ־60s ל־180s.
- נוסף watchdog ב־UI שמחזיר את הממשק ממצב waiting אם אין תשובה.

בדיקת regression שבוצעה:

```text
message 1 → מחובר
message 2 → מחובר
```

דרך flow מלא של AvAgentOS.

### 7.6 שליטה בתצוגת טקסט

נוספו controls בצ׳אט:

```text
A−   current px   A+   A=   ימין   LEFT   AUTO
```

מטרות:

- להגדיל/להקטין אותיות.
- RTL לעברית.
- LTR לאנגלית/קוד.
- AUTO לזיהוי אוטומטי.

הבחירה נשמרת ב־localStorage.

---

## 8. API / Contracts רלוונטיים

קיימים docs/contracts עבור הרחבה עתידית:

```text
docs/contracts/command-envelope.schema.md
docs/contracts/agent-capability-profile.schema.md
docs/contracts/bridge-registration.schema.md
docs/contracts/heartbeat-status.schema.md
docs/contracts/task-routing-suitability.schema.md
```

העיקרון שכבר תוכנן:

- AvAgentOS לא צריך להיות רק צ׳אט.
- כל הודעה/פקודה צריכה להפוך בהמשך ל־Command Envelope עם metadata.
- Agent צריך להצהיר capabilities/skills/model/host/status.
- AvAgentOS יוכל לבצע routing לפי התאמת משימה לסוכן.

---

## 9. תכנון עתידי להרחבת הפרויקט

### 9.1 Agent Capability Metadata

כל agent יצהיר על יכולותיו:

```json
{
  "id": "deamon-1",
  "name": "Deamon-1 Local",
  "skills": ["coding", "debugging", "hebrew", "local-files"],
  "model": "...",
  "provider": "...",
  "cost_tier": "medium",
  "languages": ["he", "en"],
  "response_time_ms": 10000,
  "risk_level": "local-agent"
}
```

מטרה:

- לדעת מי מתאים למה.
- לא לבחור סוכן ידנית לכל משימה.
- להציג למשתמש למה נבחר סוכן מסוים.

### 9.2 Task Routing

במקום שהמשתמש יבחר agent ידנית, AvAgentOS יקבל משימה ויבחר route:

```text
Task → classify → compare to agent capabilities → choose agent(s) → dispatch
```

אפשרויות routing:

- סוכן יחיד.
- כמה סוכנים במקביל.
- סוכן planner + סוכני worker.
- fallback ל־default agent.

### 9.3 Approval Gates

נדרש מנגנון approval לפני פעולות מסוכנות:

דוגמאות requiring approval:

- כתיבה/מחיקה של קבצים.
- package install.
- git push.
- פתיחת LAN/public port.
- פעולות credentials/secrets.
- הפעלת שירותים קבועים/cron.

מודל מוצע:

```text
risk: none | log-only | require-confirm | blocked
```

### 9.4 Persistent Audit Log

כרגע system log הוא בעיקר runtime/in-memory.

עתידית צריך:

- audit trail של פקודות.
- מי שלח.
- לאיזה agent.
- מה ה־agent ענה.
- האם הייתה approval.
- סטטוס הצלחה/כישלון.

אפשרויות שמירה:

```text
audit.json
SQLite
Obsidian vault
```

### 9.5 Bridge Registration / Zero Config Discovery

כרגע AvAgentOS מחזיק רשומות agents, וה־Bridge passive.

תכנון אפשרי:

```text
Bridge starts
→ POST /api/register-bridge
→ AvAgentOS validates trust
→ agents appear automatically
```

צריך להחליט על trust model:

- shared secret.
- mTLS.
- IP allowlist.
- local-only by default.

### 9.6 Stable Agent Identity

כרגע חלק מה־IDs הם timestamp-based:

```text
agent_1779700485642
```

בעיה:

- אם agent נמחק ונרשם מחדש, project assignments יכולים להישבר.

פתרון עתידי:

- agent-declared stable ID.
- UUID persisted first time.
- fingerprint from `/health`.
- user-defined slug, למשל `deamon-1-local`.

### 9.7 Projects + Agent Memory Sync

יש Projects tab ותכנון/יישום בסיסי ל־projects.

המשך:

- קישור project ל־agent.
- Ask Agent על project.
- import מה־Hermes memory.
- sync אוטומטי מ־agent memory/Obsidian.
- project handoff generated automatically.

### 9.8 Multi-Agent Coordination

שלבים אפשריים:

1. ידני: המשתמש בוחר agent.
2. חצי-אוטומטי: AvAgentOS מציע agent.
3. אוטומטי: task router בוחר.
4. orchestration: planner מחלק sub-tasks לסוכנים.
5. review loop: סוכן אחד מבצע, אחר מבקר.

### 9.9 Remote Execution Boundaries

כרגע command queue הוא message-only — לא shell execution ישיר.

עיקרון בטיחות מוצע:

```text
AvAgentOS sends intent/message.
Agent executes only inside its own sandbox and policy.
High-risk actions require explicit approval.
```

לא לאפשר בשלב מוקדם:

- arbitrary shell execution מה־dashboard.
- file writes מרחוק בלי approval.
- public exposure בלי auth.

### 9.10 Packaging / Deployment

כדי להפוך את זה למוצר/מערכת נוחה:

- one-command start ל־Dashboard.
- one-command start ל־Bridge.
- install script ל־WSL/Linux.
- health page.
- reset/repair agents button.
- export/import config בלי secrets.

---

## 10. נקודות להשוואה מול העבודה של הצד השני

נא להשוות לפי הסעיפים הבאים:

### 10.1 Architecture

- האם גם אצלכם יש הפרדה בין Dashboard / Server / Bridge?
- האם הסוכן מדבר ישירות עם UI או דרך backend?
- האם התקשורת realtime היא Socket.IO/WebSocket/SSE/HTTP polling?

### 10.2 Agent Registry

- איפה נשמרת רשימת agents?
- האם יש stable ID?
- האם agent יכול לרשום את עצמו?
- האם יש offline/online health checks?

### 10.3 Message Protocol

- מה payload של הודעת chat?
- האם יש command envelope?
- האם יש metadata כמו user/device/project/permissions?
- האם יש streaming חלקי או response מלא בלבד?

### 10.4 Bridge

- האם יש bridge נפרד?
- האם הוא תומך local agents?
- האם הוא תומך Docker/container agents?
- האם יש hot reload ל־config?

### 10.5 Safety

- האם יש approval gates?
- האם יש audit log?
- האם יש auth?
- איך מטפלים ב־secrets?
- האם יש הפרדה בין chat intent לבין shell execution?

### 10.6 UX

- איך בוחרים agent?
- האם יש default agent?
- האם יש RTL/LTR לעברית/אנגלית?
- האם יש controls לגודל טקסט?
- האם errors/timeouts מוצגים במקום ברור?

### 10.7 Roadmap

- האם אתם מתכננים capability metadata?
- האם יש task routing?
- האם יש multi-agent orchestration?
- האם יש project/memory integration?
- האם יש deployment/installer plan?

---

## 11. פערים ידועים כרגע אצלנו

1. אין authentication ל־dashboard.
2. אין audit log persistent.
3. אין approval gates אמיתיים.
4. אין stable canonical agent identity.
5. אין task routing אוטומטי.
6. external agent streaming עדיין לא streaming אמיתי — לרוב full response.
7. cheapworker לא מוגדר כ־local profile פעיל.
8. חלק מה־built-ins תלויים במפתחות ב־`.env` ולא נבדקו/לא נוגעים במסמך הזה.
9. יש runtime files כמו `agents.json` שהם ignored ולא חלק מגיט.
10. יש רשומות legacy/offline שצריך לנקות/לנהל טוב יותר בעתיד.

---

## 12. המלצה למסמך משותף בין שני הצדדים

המסמך המשותף כדאי שיהיה בנוי כך:

```text
1. Vision / Product Goal
2. Architecture Overview
3. Agent Communication Protocol
4. Agent Registry & Identity
5. Bridge Design
6. Message / Command Envelope Schema
7. Capability Metadata Schema
8. Task Routing Strategy
9. Safety / Permissions / Approval Gates
10. Audit / Observability
11. UX Requirements
12. Runtime / Deployment
13. Current Implementation Comparison
14. Open Questions
15. Next Milestones
```

---

## 13. הצעת אבני דרך להמשך

### Milestone 1 — Stable Local MVP

- Dashboard עובד.
- Bridge עובד.
- Deamon-1 Local עובד.
- Hermes Local עובד.
- הסרת/סימון רשומות legacy.
- UI ברור ל־chat, RTL/LTR, font size, timeout/error.

### Milestone 2 — Agent Registry v2

- stable agent IDs.
- health schema.
- capability metadata.
- UI מציג model/provider/skills.

### Milestone 3 — Safety Layer

- approval gates.
- audit log.
- config ל־risk levels.
- no direct remote shell by default.

### Milestone 4 — Task Routing

- classify task.
- score agents.
- suggest/auto-select agent.
- allow multi-agent execution.

### Milestone 5 — Project Coordination

- Projects sync.
- agent memory import/export.
- handoff generation.
- progress tracking.

---

## 14. מצב Git בזמן כתיבת המסמך

Branch:

```text
main...origin/main
```

שינויים מקומיים ידועים:

```text
M hermes-bridge/agents_config.json
M hermes-bridge/bridge.py
M public/app.js
M public/index.html
M public/style.css
M server.js
```

המסמך הזה נוסף כקובץ חדש:

```text
docs/planning/HANDOUT-agent-communication-and-roadmap.md
```

לא בוצע commit/push במסגרת הכנת המסמך.

---

## 15. Safety notes

לא נכללו במסמך:

- API keys.
- tokens.
- `.env` content.
- `agents.json` content מלא.
- סיסמאות.
- credentials.

כל התיאורים הם מבניים/ארכיטקטוניים בלבד.

---

## 16. שאלה לצד השני

אנא החזרו מסמך השוואה בפורמט הבא:

```text
## Same / Similar
- ...

## Different
- ...

## Missing on our side
- ...

## Missing on your side
- ...

## Suggested merged architecture
- ...

## Decisions needed
- ...

## Next joint milestones
- ...
```
