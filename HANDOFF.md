# AvAgentOS — Handoff 2026-06-17

## מה נעשה היום

### 1. ניקוי סוכנים
- נמחקו 3 סוכני רפאים מ-LAN (192.168.178.x) שנשארו ב-`agents.json` מסשן ישן
- נוסף **TTL אוטומטי** — סוכן non-builtIn שב-offline מעל 24 שעות נמחק אוטומטית (בודק כל שעה)

### 2. איחוד סוכני Hermes
- `hermes-live`, `cheap_buddy`, `reviewer` — כולם אותה התקנת Hermes מקומית
- אוחדו לסוכן אחד בשם **AvnerBF** (כשם הבוט בטלגרם)
- `hermes-live` נשמר כבסיס (WebSocket ישיר, streaming)

### 3. תיקון auto-open tiles
- הוסר פילטר "online בלבד" — עכשיו כל הסוכנים נפתחים כ-tiles (גם offline)

---

## מה צריך להמשיך מחר

### משימה עיקרית: חיבור Hermes Docker לבוט טלגרם חדש

**מצב Docker:**
```
hermes          port 8642   (API פנימי)
hermes-dashboard-auth  port 9119  (nginx + basic auth)
```

**בעיה:** הדוקר ו-Hermes המקומי מנסים לאזין לאותו בוט טלגרם → conflict.

**פתרון מוסכם:** ליצור בוט טלגרם חדש לדוקר.

**הצעדים שנשארו:**
1. פתח @BotFather בטלגרם → `/newbot` → קבל טוקן חדש
2. מצא את `docker-compose.yml` של Hermes (לא נמצא עדיין — כנראה ב-`C:\Users\AVNER\` או תיקיית Docker)
3. עדכן `TELEGRAM_BOT_TOKEN` בקובץ ה-compose
4. `docker compose up -d --force-recreate hermes`
5. חבר את הבוט החדש ל-AvAgentOS דרך Auto-Onboard

**Credentials דוקר:**
- Dashboard: `http://127.0.0.1:9119`
- Username: `avner`
- Password: `PxaW3ldx797VeORP6QRGcx96dpFkfo9x`

---

## מצב סוכנים נוכחי

| סוכן | סוג | סטטוס | הערה |
|------|-----|--------|------|
| AvnerBF | hermes-live | online | WebSocket → port 9120 |
| Ollama | ollama | online | port 11434 |
| LM Studio | lmstudio | online | port 1234 |
| Claude | claude | no-key | צריך ANTHROPIC_API_KEY |
| Gemini | gemini | online | עומס זמני לפעמים |
| OpenRouter | openrouter | error | צריך OPENROUTER_API_KEY |
| Hermes Docker | - | לא מחובר | המשימה למחר |

---

## קבצים ששונו היום
- `server.js` — TTL cleanup, שינוי שם ל-AvnerBF, הסרת cheap_buddy/reviewer
- `public/app.js` — auto-open כל הסוכנים (לא רק online)
- `agents.json` — ריק (נמחקו סוכני הרפאים)
