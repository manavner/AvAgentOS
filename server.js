const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');
const os = require('os');
const fs = require('fs');
const fetch = require('node-fetch');
const ObsidianMemory = require('./memory');
require('dotenv').config();

const AGENTS_FILE    = path.join(__dirname, 'agents.json');
const PROJECTS_FILE  = path.join(__dirname, 'projects.json');
const HISTORIES_DIR  = path.join(__dirname, 'data', 'histories');

// ── History persistence ───────────────────────────────────────────
if (!fs.existsSync(HISTORIES_DIR)) fs.mkdirSync(HISTORIES_DIR, { recursive: true });

function historyFile(agentId) {
  return path.join(HISTORIES_DIR, `${agentId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
}

function saveHistory(agentId) {
  try {
    const hist = histories.get(agentId);
    if (hist) fs.writeFileSync(historyFile(agentId), JSON.stringify(hist, null, 2));
  } catch (e) { /* non-fatal */ }
}

function loadHistory(agentId) {
  try {
    const f = historyFile(agentId);
    if (fs.existsSync(f)) {
      const data = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (Array.isArray(data)) return data;
    }
  } catch (e) { /* non-fatal */ }
  return [];
}

// ── Projects store ────────────────────────────────────────────────
const projects = new Map(); // id → project

function saveProjects() {
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify([...projects.values()], null, 2));
}

function loadProjects() {
  try {
    if (!fs.existsSync(PROJECTS_FILE)) return;
    const saved = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'));
    for (const p of saved) projects.set(p.id, p);
    console.log(`  ✓ Loaded ${saved.length} project(s)`);
  } catch (e) {
    console.log(`  ⚠ Could not load projects.json: ${e.message}`);
  }
}

function saveAgents() {
  const toSave = [...agents.values()].filter(a => !a.builtIn);
  fs.writeFileSync(AGENTS_FILE, JSON.stringify(toSave, null, 2));
}

function loadAgents() {
  try {
    if (!fs.existsSync(AGENTS_FILE)) return;
    const saved = JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8'));
    for (const agent of saved) {
      agent.status = 'connecting';
      agents.set(agent.id, agent);
      histories.set(agent.id, loadHistory(agent.id));
    }
    console.log(`  ✓ Loaded ${saved.length} saved agent(s)`);
  } catch (e) {
    console.log(`  ⚠ Could not load agents.json: ${e.message}`);
  }
}

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3131;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Agent Registry ───────────────────────────────────────────────
const agents = new Map();
const histories = new Map();

const DEFAULT_BRIDGE_HOST = process.env.HERMES_BRIDGE_HOST || '127.0.0.1';
const DEFAULT_BRIDGE_PORT = Number(process.env.HERMES_BRIDGE_PORT || 8765);

function bridgeHostedAgent({ id, name, bridgeId, description, role, riskLevel, capabilities, host, port }) {
  return {
    id,
    name,
    type: 'hermes',
    host: host || DEFAULT_BRIDGE_HOST,
    port: port || DEFAULT_BRIDGE_PORT,
    apiKey: null,
    config: {
      format: 'openai',
      model: bridgeId,
      chatEndpoint: `/agent/${bridgeId}/api/v1/chat/completions`,
      healthEndpoint: `/agent/${bridgeId}/health`,
      bridgeAgentId: bridgeId,
    },
    status: 'connecting',
    description,
    icon: 'hermes',
    builtIn: false,
    managedBy: 'avagentos-default-registry',
    role,
    riskLevel,
    capabilities,
    connectedAt: Date.now(),
    messageCount: 0,
    latency: null,
  };
}

const AVNERAI_BRIDGE_HOST = '192.168.178.118';
const AVNERAI_BRIDGE_PORT = 8765;

const MACHINE3_BRIDGE_HOST = '192.168.178.107';
const MACHINE3_BRIDGE_PORT = 8765;

const DEFAULT_LOCAL_AGENTS = [
  // ── AvnerBF — Primary Orchestrator ───────────────────────────────
  {
    ...bridgeHostedAgent({
      id: 'hermes-live',
      name: 'AvnerBF',
      bridgeId: 'hermes-live',
      description: 'AvnerBF — ראשי | מתאם סוכנים, כלים, זיכרון, Telegram',
      role: 'Primary orchestrator — delegates tasks to all other agents',
      riskLevel: 'write_project',
      capabilities: {
        provider: 'configured-by-active-hermes-profile',
        cost_tier: 'high',
        languages: ['he', 'en'],
        skills: ['orchestration', 'planning', 'tool-use', 'workspace-tasks', 'streaming', 'agent-delegation'],
        can_stream: true,
        can_use_tools: true,
      },
    }),
    orchestrator: true,
    sortOrder: 0,
    orchestratorCapabilities: [
      {
        category: 'ניהול משימות',
        icon: '🎯',
        items: [
          {
            name: 'פירוק משימה',
            description: 'קבלת משימה מורכבת → פירוק לתת-משימות → שליחה לסוכנים המתאימים',
            howTo: 'תגיד לי: "פרק את המשימה הבאה ושלח לסוכנים: [תיאור המשימה]"',
            example: 'פרק: "בנה דוח שבועי" — שלח סיכום לcheap_buddy, ניתוח קוד לAvnerAIBuddy',
          },
          {
            name: 'איסוף תוצאות',
            description: 'ממתין לתשובות מכל הסוכנים ומסנתז לתשובה אחת מאוחדת',
            howTo: 'אוטומטי לאחר פירוק משימה',
            example: 'לאחר שכל הסוכנים סיימו — אני מאחד ומציג תוצאה אחת',
          },
        ],
      },
      {
        category: 'ניטור סוכנים',
        icon: '📡',
        items: [
          {
            name: 'בדיקת זמינות',
            description: 'בדיקה מי מהסוכנים זמין לפני שליחת משימה',
            howTo: 'תגיד: "מי זמין עכשיו?" או "תבדוק את כל הסוכנים"',
            example: 'מציג רשימה של סוכנים ONLINE/OFFLINE ועומס נוכחי',
          },
          {
            name: 'סוכן חלופי',
            description: 'אם הסוכן המבוקש offline — בוחר אוטומטית חלופה עם יכולות דומות',
            howTo: 'אוטומטי — לא צריך לעשות כלום',
            example: 'AvnerAIBuddy offline? → אנסה machine3-hermes במקום',
          },
        ],
      },
      {
        category: 'ניהול עלויות',
        icon: '💰',
        items: [
          {
            name: 'ניתוב חכם לפי עלות',
            description: 'בחירה אוטומטית של סוכן זול/יקר לפי סוג המשימה',
            howTo: 'תגיד: "שלח את זה לסוכן הזול ביותר" או "השתמש בסוכן הטוב ביותר"',
            example: 'סיכום טקסט → cheap_buddy | תכנות מורכב → AvnerBF',
          },
          {
            name: 'דוח עלויות',
            description: 'הצגת כמה הוצאנו לפי סוכן',
            howTo: 'תגיד: "תראה לי דוח עלויות" (בפיתוח)',
            example: 'cheap_buddy: $0.02 | AvnerBF: $0.45 | סה"כ: $0.47',
          },
        ],
      },
      {
        category: 'זיכרון משותף',
        icon: '🧠',
        items: [
          {
            name: 'שמירה ב-Obsidian',
            description: 'שמירת תוצאות מסוכנים לזיכרון משותף ב-Obsidian',
            howTo: 'תגיד: "שמור את התוצאה" או "תזכור את מה שאמר AvnerAIBuddy"',
            example: 'יוצר note ב-Obsidian עם תוצאת הסוכן + timestamp',
          },
          {
            name: 'הקשר לסוכנים',
            description: 'שליחת הקשר מהזיכרון לסוכן לפני שהוא מתחיל משימה',
            howTo: 'תגיד: "שלח עם הקשר מהפגישה האחרונה"',
            example: 'מוסיף context רלוונטי מ-Obsidian לפרומפט של הסוכן',
          },
        ],
      },
    ],
  },
  // ── AvnerAIBuddy (192.168.178.118) ──────────────────────────────
  bridgeHostedAgent({
    id: 'avneraiBuddy',
    name: 'AvnerAIBuddy',
    bridgeId: 'avneraiBuddy',
    host: AVNERAI_BRIDGE_HOST,
    port: AVNERAI_BRIDGE_PORT,
    description: 'AvnerAIBuddy — Hermes default profile on Deamon-1',
    role: 'Main Hermes agent on Deamon-1 machine',
    riskLevel: 'write_project',
    capabilities: {
      provider: 'configured-by-hermes-profile',
      cost_tier: 'high',
      languages: ['he', 'en'],
      skills: ['orchestration', 'tool-use', 'workspace-tasks'],
      can_stream: false,
      can_use_tools: true,
    },
  }),
  bridgeHostedAgent({
    id: 'avnerai-cheap',
    name: 'AvnerAI Cheap',
    bridgeId: 'cheap_buddy',
    host: AVNERAI_BRIDGE_HOST,
    port: AVNERAI_BRIDGE_PORT,
    description: 'AvnerAIBuddy cheap_buddy profile on Deamon-1',
    role: 'Low-cost worker on Deamon-1',
    riskLevel: 'write_project',
    capabilities: {
      provider: 'openrouter',
      cost_tier: 'low',
      languages: ['he', 'en'],
      skills: ['routine-code', 'summaries', 'tool-use'],
      can_stream: false,
      can_use_tools: true,
    },
  }),
  // ── Machine 3 (192.168.178.107) ──────────────────────────────────
  bridgeHostedAgent({
    id: 'machine3-hermes',
    name: 'Hermes Docker 107',
    bridgeId: 'hermes-docker-3',
    host: MACHINE3_BRIDGE_HOST,
    port: MACHINE3_BRIDGE_PORT,
    description: 'Hermes Docker on 192.168.178.107',
    role: 'Hermes agent in Docker on third LAN machine',
    riskLevel: 'write_project',
    capabilities: {
      provider: 'configured-by-active-hermes-profile',
      cost_tier: 'high',
      languages: ['he', 'en'],
      skills: ['orchestration', 'planning', 'tool-use', 'workspace-tasks'],
      can_stream: false,
      can_use_tools: true,
    },
  }),
  // ── Local agents ─────────────────────────────────────────────────
  bridgeHostedAgent({
    id: 'hermes-docker',
    name: 'AvnerBF Docker',
    bridgeId: 'hermes-docker',
    description: 'AvnerBF Docker — Hermes agent in Docker container',
    role: 'Hermes agent running in Docker with independent Telegram bot',
    riskLevel: 'write_project',
    capabilities: {
      provider: 'configured-by-active-hermes-profile',
      cost_tier: 'high',
      languages: ['he', 'en'],
      skills: ['orchestration', 'planning', 'tool-use', 'workspace-tasks', 'streaming'],
      can_stream: true,
      can_use_tools: true,
    },
  }),
  // ── OpenAI Codex (desktop app) ───────────────────────────────────
  {
    id: 'codex',
    name: 'Codex',
    type: 'codex',
    status: 'online',
    builtIn: true,
    sortOrder: 2,
    icon: 'codex',
    description: 'OpenAI Codex — desktop agent for autonomous coding tasks',
    role: 'Autonomous coding agent — runs tasks in sandbox, edits files, executes code',
    bin: 'C:\\Users\\AVNER\\AppData\\Local\\OpenAI\\Codex\\bin\\fb2111b91430cb17\\codex.exe',
    capabilities: {
      provider: 'openai',
      cost_tier: 'high',
      languages: ['he', 'en'],
      skills: ['code-editing', 'file-management', 'autonomous-tasks', 'sandboxed-execution', 'debugging'],
      can_stream: false,
      can_use_tools: true,
    },
    connectedAt: Date.now(),
    messageCount: 0,
    latency: null,
  },
  // ── Claude Code (this session) ────────────────────────────────────
  {
    id: 'claude-code',
    name: 'Claude Code',
    type: 'claude-code',
    status: 'online',
    builtIn: true,
    sortOrder: 1,
    icon: 'claude',
    description: 'Claude Code CLI — סשן עבודה נוכחי על קוד',
    role: 'Active coding agent — edits files, runs tests, manages git',
    capabilities: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      cost_tier: 'high',
      languages: ['he', 'en'],
      skills: ['code-editing', 'file-management', 'git', 'testing', 'debugging', 'refactoring'],
      can_stream: true,
      can_use_tools: true,
    },
    connectedAt: Date.now(),
    messageCount: 0,
    latency: null,
  },
];

function seedDefaultLocalAgents() {
  for (const agent of DEFAULT_LOCAL_AGENTS) {
    if (agents.has(agent.id)) continue;
    agents.set(agent.id, { ...agent, connectedAt: Date.now() });
    histories.set(agent.id, loadHistory(agent.id));
  }
}

// ── Obsidian Memory ──────────────────────────────────────────────
const memory = new ObsidianMemory(
  process.env.OBSIDIAN_VAULT_PATH,
  process.env.OBSIDIAN_MEMORY_FOLDER || 'AvAgentOS'
);
memory.init().then(ok => {
  if (ok) {
    syslog(`Obsidian vault connected (${memory.notes.size} notes)`, 'success');
    io.emit('memory:status', memory.getStatus());
    io.emit('memory:notes', memory.listNotes());
  } else {
    syslog('Obsidian: set OBSIDIAN_VAULT_PATH in .env to enable memory', 'warning');
  }
});
// Re-sync every 3 minutes
setInterval(async () => {
  if (memory.isConfigured) {
    await memory.sync();
    io.emit('memory:status', memory.getStatus());
    io.emit('memory:notes', memory.listNotes());
  }
}, 3 * 60 * 1000);

// ── AI Clients ───────────────────────────────────────────────────
const claudeClient = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const googleClient = process.env.GOOGLE_API_KEY
  ? new GoogleGenerativeAI(process.env.GOOGLE_API_KEY)
  : null;

// ── Load saved agents & projects ─────────────────────────────────
loadAgents();
loadProjects();

// ── OpenRouter built-in (if key provided) ────────────────────────
if (process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY !== 'your_openrouter_key_here') {
  agents.set('openrouter', {
    id: 'openrouter',
    name: 'OpenRouter',
    type: 'openrouter',
    host: 'https://openrouter.ai',
    port: 443,
    apiKey: process.env.OPENROUTER_API_KEY,
    config: { model: process.env.OPENROUTER_DEFAULT_MODEL || 'qwen/qwen3-235b-a22b' },
    status: 'online',
    description: `OpenRouter → ${process.env.OPENROUTER_DEFAULT_MODEL || 'qwen/qwen3-235b-a22b'}`,
    icon: 'openrouter',
    builtIn: true,
    connectedAt: Date.now(),
    messageCount: 0,
    latency: null,
  });
  histories.set('openrouter', loadHistory('openrouter'));
}

// ── Built-in Agents ───────────────────────────────────────────────
agents.set('claude', {
  id: 'claude',
  name: 'Claude',
  type: 'claude',
  model: process.env.CLAUDE_MODEL || 'claude-opus-4-7',
  status: claudeClient ? 'online' : 'no-key',
  description: 'Anthropic Claude AI',
  icon: 'claude',
  builtIn: true,
  connectedAt: Date.now(),
  messageCount: 0,
  latency: null,
});
histories.set('claude', loadHistory('claude'));

agents.set('gemini', {
  id: 'gemini',
  name: 'Gemini',
  type: 'gemini',
  model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  status: googleClient ? 'online' : 'no-key',
  description: 'Google Gemini AI',
  icon: 'gemini',
  builtIn: true,
  connectedAt: Date.now(),
  messageCount: 0,
  latency: null,
});
histories.set('gemini', loadHistory('gemini'));

agents.set('ollama', {
  id: 'ollama',
  name: 'Ollama',
  type: 'ollama',
  host: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
  port: 11434,
  model: process.env.OLLAMA_MODEL || null,
  status: 'connecting',
  description: 'Ollama — local LLM server',
  icon: 'ollama',
  builtIn: true,
  connectedAt: Date.now(),
  messageCount: 0,
  latency: null,
  config: {
    format: 'openai',
    chatEndpoint: '/v1/chat/completions',
    healthEndpoint: '/api/tags',
  },
});
histories.set('ollama', loadHistory('ollama'));

agents.set('lmstudio', {
  id: 'lmstudio',
  name: 'LM Studio',
  type: 'lmstudio',
  host: process.env.LMSTUDIO_HOST || 'http://127.0.0.1:1234',
  port: 1234,
  model: process.env.LMSTUDIO_MODEL || null,
  status: 'connecting',
  description: 'LM Studio — local LLM server',
  icon: 'lmstudio',
  builtIn: true,
  connectedAt: Date.now(),
  messageCount: 0,
  latency: null,
  config: {
    format: 'openai',
    chatEndpoint: '/v1/chat/completions',
    healthEndpoint: '/v1/models',
  },
});
histories.set('lmstudio', loadHistory('lmstudio'));

seedDefaultLocalAgents();

// ── REST API ─────────────────────────────────────────────────────
app.get('/api/agents', (req, res) => res.json([...agents.values()]));
app.get('/api/agent-contracts', (req, res) => res.json({ agents: DEFAULT_LOCAL_AGENTS }));

app.post('/api/agents', async (req, res) => {
  const { id: requestedId, name, type, host, port, apiKey, config, role, riskLevel, capabilities } = req.body;
  if (!name || !host) return res.status(400).json({ error: 'name and host required' });

  const id = requestedId
    ? String(requestedId).toLowerCase().replace(/[^a-z0-9_-]/g, '-')
    : `agent_${Date.now()}`;
  if (agents.has(id)) return res.status(409).json({ error: `agent id already exists: ${id}` });
  const agent = {
    id, name,
    type: (type || 'generic').toLowerCase(),
    host, port: Number(port) || 8080,
    apiKey: apiKey || null,
    config: config || {},
    status: 'connecting',
    description: `${type || 'Agent'} at ${host}:${port || 8080}`,
    icon: type?.toLowerCase() || 'generic',
    builtIn: false,
    role: role || null,
    riskLevel: riskLevel || 'approval_required',
    capabilities: capabilities || null,
    connectedAt: Date.now(),
    messageCount: 0,
    latency: null,
  };

  agents.set(id, agent);
  histories.set(id, loadHistory(id));

  pingAgent(id).then(ok => {
    agent.status = ok !== false ? 'online' : 'offline';
    io.emit('agent:status', { id, status: agent.status, latency: agent.latency });
  });

  io.emit('agent:added', agent);
  saveAgents();
  syslog(`Agent "${name}" added (${host}:${port || 8080})`, 'info');
  res.json(agent);
});

app.delete('/api/agents/:id', (req, res) => {
  const agent = agents.get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Not found' });
  if (agent.builtIn) return res.status(403).json({ error: 'Cannot remove built-in agents' });
  agents.delete(req.params.id);
  histories.delete(req.params.id);
  saveAgents();
  io.emit('agent:removed', { id: req.params.id });
  syslog(`Agent "${agent.name}" removed`, 'warning');
  res.json({ success: true });
});

app.post('/api/agents/:id/ping', async (req, res) => {
  const agent = agents.get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Not found' });
  const latency = await pingAgent(req.params.id);
  res.json({ id: req.params.id, status: agent.status, latency });
});

app.get('/api/memory', (req, res) => res.json({ status: memory.getStatus(), notes: memory.listNotes() }));
app.post('/api/memory/sync', async (req, res) => {
  await memory.sync(); res.json({ status: memory.getStatus(), notes: memory.listNotes() });
  io.emit('memory:status', memory.getStatus());
  io.emit('memory:notes', memory.listNotes());
});

// ── Command queue — agents pull pending commands ─────────────────
const commandQueue = new Map(); // agentName → [{id, message, ts}]

app.post('/api/commands/:agent', (req, res) => {
  const agent = req.params.agent;
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  if (!commandQueue.has(agent)) commandQueue.set(agent, []);
  const cmd = { id: Date.now(), message, ts: new Date().toISOString() };
  commandQueue.get(agent).push(cmd);
  res.json({ ok: true, id: cmd.id });
});

app.get('/api/commands/:agent', (req, res) => {
  const agent = req.params.agent;
  const cmds = commandQueue.get(agent) || [];
  commandQueue.set(agent, []); // clear after reading
  res.json({ commands: cmds });
});

// ── Onboard — auto-parse discovery report & register agent ───────
app.post('/api/onboard', async (req, res) => {
  const { report, name } = req.body;
  if (!report) return res.status(400).json({ error: 'report required' });

  // 1. Try to extract JSON block from the report
  let data = {};
  const jsonMatch = report.match(/\{[\s\S]*?\}/);
  if (jsonMatch) {
    try { data = JSON.parse(jsonMatch[0]); } catch {}
  }

  // 2. Fallback regex parsing
  const ipRx   = /\b(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)\b/;
  const ip       = data.ip        || (report.match(ipRx) || [])[0];
  const hostname = data.hostname  || (report.match(/hostname[:\s]+([a-zA-Z0-9._-]+)/i) || [])[1];
  const hermesBin= data.hermes_bin|| (report.match(/\/[^\s\n]*hermes[^\s\n]*/g)||[])
                                       .find(p => p.includes('bin') || p.includes('venv'));
  const hasPython  = data.python3  !== undefined ? data.python3  : /python3?\s+3\./i.test(report);
  const hasFastAPI = data.fastapi  !== undefined ? data.fastapi  : /fastapi/i.test(report);
  const profile    = data.hermes_profile || null;

  if (!ip) {
    return res.json({ ok: false, error: 'לא נמצאה כתובת IP בדו"ח', detected: data });
  }

  const needsBridge = !!(hermesBin && hasPython && hasFastAPI);
  const agentId     = `agent_${Date.now()}`;
  const agentName   = name || hostname || `Agent@${ip}`;
  const bridgePort  = 8765;
  const agentIdSlug = (agentName).toLowerCase().replace(/[^a-z0-9]/g, '-');

  const agent = {
    id: agentId,
    name: agentName,
    type: 'hermes',
    host: ip,
    port: bridgePort,
    apiKey: null,
    config: {
      format: 'openai',
      chatEndpoint:   `/agent/${agentIdSlug}/api/v1/chat/completions`,
      healthEndpoint: `/agent/${agentIdSlug}/health`,
    },
    status: 'connecting',
    description: `${hostname || 'WSL'} @ ${ip}`,
    icon: 'hermes',
    builtIn: false,
    connectedAt: Date.now(),
    messageCount: 0,
    latency: null,
  };

  agents.set(agentId, agent);
  histories.set(agentId, loadHistory(agentId));
  saveAgents();
  io.emit('agent:added', agent);
  syslog(`⚡ Onboarding "${agentName}" @ ${ip}`, 'info');

  // 3. Ping to check if bridge is already running
  const pingOk = await pingAgent(agentId);

  // 4. Build bridge config entry (for agents_config.json on remote)
  const bridgeEntry = needsBridge ? {
    id:          agentIdSlug,
    container:   null,
    type:        'local',
    bin:         hermesBin,
    profile:     profile || null,
    description: agentName,
  } : null;

  const setupSteps = needsBridge && agent.status !== 'online' ? [
    `1. העתק bridge.py ו-agents_config.json ל-${ip}`,
    `2. הוסף לagents_config.json:\n${JSON.stringify(bridgeEntry, null, 2)}`,
    `3. על ${ip}: python bridge.py`,
    `4. הסוכן יופיע ONLINE אוטומטית`,
  ] : [];

  res.json({
    ok: true,
    agentId,
    detected: { ip, hostname, hermesBin, hasPython, hasFastAPI, profile },
    strategy: needsBridge ? 'bridge-needed' : 'direct',
    online: agent.status === 'online',
    setupSteps,
    bridgeEntry,
  });
});

// ── Projects API ─────────────────────────────────────────────────
app.get('/api/projects', (req, res) => res.json([...projects.values()]));

app.post('/api/projects', (req, res) => {
  const { name, display_name, assigned_agent_id, phase, status, description } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const id = `proj_${Date.now()}`;
  const now = new Date().toISOString();
  const project = {
    id, name,
    display_name: display_name || name,
    assigned_agent_id: assigned_agent_id || null,
    phase: phase || '',
    status: status || 'active',
    description: description || '',
    created_at: now,
    updated_at: now,
    last_agent_response: '',
    last_queried_at: null,
  };
  projects.set(id, project);
  saveProjects();
  syslog(`📋 Project "${name}" created`, 'info');
  res.json(project);
});

app.put('/api/projects/:id', (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const allowed = ['name','display_name','assigned_agent_id','active_agent_id','phase','status','description','last_agent_response','last_queried_at'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) project[key] = req.body[key];
  }
  project.updated_at = new Date().toISOString();
  saveProjects();
  res.json(project);
});

app.delete('/api/projects/:id', (req, res) => {
  if (!projects.has(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const name = projects.get(req.params.id).name;
  projects.delete(req.params.id);
  saveProjects();
  syslog(`📋 Project "${name}" deleted`, 'warning');
  res.json({ success: true });
});

app.post('/api/projects/:id/query', async (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const agent = agents.get(project.assigned_agent_id);
  if (!agent) return res.status(400).json({ error: 'No agent assigned or agent not found' });

  const query = req.body.query || `מה הסטאטוס בפרויקט ${project.name}?`;
  try {
    const text = await callAgentDirect(agent, query, { project_id: project.name, topic: project.name });
    project.last_agent_response = text;
    project.last_queried_at = new Date().toISOString();
    project.updated_at = project.last_queried_at;
    saveProjects();
    syslog(`📋 Query sent to ${agent.name} for project "${project.name}"`, 'info');
    res.json({ ok: true, response: text, project });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Agent progress reporting ──────────────────────────────────────
app.post('/api/projects/:id/progress', (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const { agent_id, message, status, phase } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  const now = new Date().toISOString();
  const entry = { ts: now, agent_id: agent_id || null, message, status: status || null, phase: phase || null };
  if (!project.activity_log) project.activity_log = [];
  project.activity_log.unshift(entry);
  if (project.activity_log.length > 50) project.activity_log.length = 50;
  if (status) project.status = status;
  if (phase) project.phase = phase;
  project.updated_at = now;
  project.active_agent_id = agent_id || project.active_agent_id || null;
  saveProjects();
  syslog(`📋 [${project.display_name || project.name}] ${agents.get(agent_id)?.name || agent_id || 'Agent'}: ${message}`, 'info');
  io.emit('project:updated', project);
  res.json({ ok: true, project });
});

app.post('/api/projects/import-query', async (req, res) => {
  const { agentId, query } = req.body;
  const agent = agents.get(agentId);
  if (!agent) return res.status(400).json({ error: 'Agent not found' });
  try {
    const text = await callAgentDirect(agent, query);
    res.json({ ok: true, response: text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Command Envelope ──────────────────────────────────────────────
function buildEnvelope(sessionContext = {}) {
  return {
    envelope_version: '1.0',
    request_id:  `req_${Date.now()}`,
    timestamp:   new Date().toISOString(),
    source:      'avagentos',
    from_user: {
      user_id:      process.env.DEFAULT_USER_ID      || '1532243300',
      display_name: process.env.DEFAULT_USER_NAME    || 'Avner Man',
      auth_level:   'local_gui_verified',
    },
    from_device: {
      device_id: os.hostname(),
      hostname:  os.hostname(),
    },
    gui_session: {
      session_id: sessionContext.session_id || null,
      topic:      sessionContext.topic      || null,
      project_id: sessionContext.project_id || null,
    },
    permissions: {
      role:              process.env.DEFAULT_USER_ROLE || 'owner',
      risk_level_allowed: 'write_project',
    },
  };
}

// ── Direct agent call (for REST endpoints) ────────────────────────
async function callAgentDirect(agent, userMessage, sessionContext = {}) {
  const baseUrl = agent.host?.startsWith('http')
    ? agent.host.replace(/\/$/, '')
    : `http://${agent.host}:${agent.port}`;
  const defaultEndpoint = (agent.type === 'hermes' || agent.type === 'openrouter')
    ? '/api/v1/chat/completions' : '/v1/chat/completions';
  const endpoint = agent.config?.chatEndpoint || defaultEndpoint;
  const envelope = buildEnvelope(sessionContext);
  const body = { model: agent.config?.model || 'default', messages: [{ role: 'user', content: userMessage }], stream: false, user: JSON.stringify(envelope) };
  const headers = { 'Content-Type': 'application/json' };
  if (agent.apiKey?.trim()) headers['Authorization'] = `Bearer ${agent.apiKey}`;
  const res = await fetch(`${baseUrl}${endpoint}`, { method: 'POST', headers, body: JSON.stringify(body), timeout: 180000 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || data.message || data.response || JSON.stringify(data);
}

// ── Inbox — agents push messages here ────────────────────────────
app.post('/api/inbox', (req, res) => {
  const { agent, message, type } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  const agentName = agent || 'unknown';
  syslog(`📨 ${agentName}: ${message.substring(0, 120)}`, 'success');
  io.emit('agent:inbox', { agent: agentName, message, type: type || 'message', ts: new Date().toISOString() });
  res.json({ ok: true, received: true });
});

app.get('/api/network', (req, res) => {
  const ifaces = os.networkInterfaces();
  const addresses = [];
  for (const iface of Object.values(ifaces)) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        const parts = addr.address.split('.');
        addresses.push({ address: addr.address, subnet: `${parts[0]}.${parts[1]}.${parts[2]}` });
      }
    }
  }
  res.json({ addresses });
});

// ── Socket.IO ────────────────────────────────────────────────────
io.on('connection', (socket) => {
  syslog(`Dashboard connected`, 'info');
  socket.emit('state:init', {
    agents: [...agents.values()],
    hasClaudeKey: !!process.env.ANTHROPIC_API_KEY,
  });
  socket.emit('memory:status', memory.getStatus());
  socket.emit('memory:notes', memory.listNotes());
  // Ping all non-builtin agents so new clients see up-to-date status
  for (const [id, agent] of agents) {
    if (!agent.builtIn || agent.type === 'ollama' || agent.type === 'lmstudio') {
      pingAgent(id);
    }
  }

  socket.on('chat:message', async ({ agentId, message }) => {
    if (!message?.trim()) return;
    const agent = agents.get(agentId);
    if (!agent) return socket.emit('chat:error', { agentId, error: 'Agent not found' });
    if (agent.type === 'claude-code') {
      await handleClaudeCode(socket, message);
    } else if (agent.type === 'codex') {
      socket.emit('chat:stream:start', { agentId });
      socket.emit('chat:stream:end', { agentId, fullText: '🧬 Codex הוא סוכן קוד עצמאי — פתח את אפליקציית Codex ישירות לצ\'אט.' });
    } else if (agent.type === 'claude') {
      await handleClaude(socket, message);
    } else if (agent.type === 'gemini') {
      await handleGemini(socket, message);
    } else if (agent.type === 'ollama') {
      if (!agent.model) return socket.emit('chat:error', { agentId, error: 'Ollama: no model loaded. Load a model in Ollama first.' });
      await handleAgent(socket, agentId, message);
    } else if (agent.type === 'lmstudio') {
      if (!agent.model) return socket.emit('chat:error', { agentId, error: 'LM Studio: no model loaded. Load a model in LM Studio and start the local server.' });
      await handleAgent(socket, agentId, message);
    } else {
      await handleAgent(socket, agentId, message);
    }
  });

  socket.on('chat:clear', ({ agentId }) => {
    if (histories.has(agentId)) {
      histories.set(agentId, []);
      saveHistory(agentId);
    }
    socket.emit('chat:cleared', { agentId });
  });

  socket.on('agent:ping', async ({ id }) => {
    const lat = await pingAgent(id);
    const a = agents.get(id);
    socket.emit('agent:status', { id, status: a?.status, latency: lat });
  });

  socket.on('broadcast', async ({ message }) => {
    syslog(`Broadcast: "${message.substring(0, 60)}..."`, 'info');
    for (const [id, agent] of agents) {
      if (agent.status === 'online' || agent.status === 'no-key') {
        if (agent.type === 'claude') {
          handleClaude(socket, `[BROADCAST] ${message}`);
        } else if (agent.type === 'gemini') {
          handleGemini(socket, `[BROADCAST] ${message}`);
        } else if (agent.status === 'online') {
          handleAgent(socket, id, message);
        }
      }
    }
  });

  socket.on('memory:sync', async () => {
    const ok = await memory.sync();
    socket.emit('memory:status', memory.getStatus());
    socket.emit('memory:notes', memory.listNotes());
    syslog(ok ? `Memory synced (${memory.notes.size} notes)` : 'Memory sync failed', ok ? 'success' : 'error');
  });

  socket.on('memory:save-chat', ({ agentId }) => {
    const hist = histories.get(agentId) || [];
    const ok = memory.saveConversation(agentId, hist);
    syslog(ok ? `Conversation saved to Obsidian` : 'Memory not configured', ok ? 'success' : 'warning');
    socket.emit('memory:save-result', { ok, agentId });
    if (ok) { socket.emit('memory:notes', memory.listNotes()); }
  });

  socket.on('memory:write-note', ({ relPath, content }) => {
    const ok = memory.writeNote(relPath, content);
    syslog(ok ? `Note saved: ${relPath}` : 'Note write failed', ok ? 'success' : 'error');
    if (ok) socket.emit('memory:notes', memory.listNotes());
  });

  socket.on('memory:read-note', ({ relPath }) => {
    const content = memory.getNoteContent(relPath);
    socket.emit('memory:note-content', { relPath, content });
  });

  socket.on('discover:scan', async ({ subnet, ports }) => {
    syslog('Starting LAN discovery scan...', 'info');
    socket.emit('discover:started');
    const found = await scanLAN(subnet, ports, socket);
    socket.emit('discover:done', { found: found.length });
  });

  socket.on('disconnect', () => {
    syslog('Dashboard disconnected', 'warning');
  });
});

// ── Claude Code Handler (spawns claude -p) ───────────────────────
async function handleClaudeCode(socket, userMessage) {
  const agentId = 'claude-code';
  const history = histories.get(agentId) || [];
  history.push({ role: 'user', content: userMessage });
  socket.emit('chat:stream:start', { agentId });

  const { spawn } = require('child_process');
  // Build conversation context as a single prompt with history prefix
  const contextLines = history.slice(-10, -1).map(m =>
    `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
  ).join('\n');
  const fullPrompt = contextLines
    ? `${contextLines}\nUser: ${userMessage}`
    : userMessage;

  let full = '';
  try {
    await new Promise((resolve, reject) => {
      const proc = spawn('claude', ['-p', fullPrompt, '--output-format', 'text'], {
        shell: true, env: process.env,
      });
      proc.stdout.on('data', chunk => {
        const text = chunk.toString();
        full += text;
        socket.emit('chat:stream:delta', { agentId, delta: text });
      });
      proc.stderr.on('data', chunk => {
        const msg = chunk.toString().trim();
        if (msg) syslog(`claude-code stderr: ${msg}`, 'warning');
      });
      proc.on('close', code => code === 0 ? resolve() : reject(new Error(`claude exited with code ${code}`)));
      proc.on('error', reject);
    });
    history.push({ role: 'assistant', content: full });
    if (history.length > 20) history.splice(0, 2);
    histories.set(agentId, history);
    saveHistory(agentId);
    socket.emit('chat:stream:end', { agentId, fullText: full });
    syslog(`Claude Code responded (${full.length} chars)`, 'success');
  } catch (err) {
    socket.emit('chat:error', { agentId, error: err.message });
    syslog(`Claude Code error: ${err.message}`, 'error');
    history.pop();
  }
}

// ── Claude Handler ───────────────────────────────────────────────
async function handleClaude(socket, userMessage, agentId = 'claude') {
  if (!claudeClient) {
    return socket.emit('chat:error', { agentId, error: 'ANTHROPIC_API_KEY not set in .env' });
  }
  const agent = agents.get('claude');
  const history = histories.get(agentId) || histories.get('claude');
  history.push({ role: 'user', content: userMessage });
  agent.messageCount++;
  socket.emit('chat:stream:start', { agentId });

  try {
    let full = '';
    const basePrompt = process.env.SYSTEM_PROMPT || `You are Claude, the AI core of AvAgentOS — a mission control system for managing AI agents on a local network. The user can connect Hermes agents, OpenClaw, and other HTTP agents. Help coordinate agents, answer questions, and act as the intelligent hub of the system. Be concise and direct.`;
    const systemPrompt = basePrompt + memory.buildContextForAgent('claude');

    const stream = await claudeClient.messages.stream({
      model: agent.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: history,
    });
    for await (const ev of stream) {
      if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
        full += ev.delta.text;
        socket.emit('chat:stream:delta', { agentId, delta: ev.delta.text });
      }
    }
    history.push({ role: 'assistant', content: full });
    if (history.length > 50) history.splice(0, 2);
    saveHistory(agentId);
    socket.emit('chat:stream:end', { agentId, fullText: full });
    syslog(`Claude responded (${full.length} chars)`, 'success');
  } catch (err) {
    socket.emit('chat:error', { agentId, error: err.message });
    syslog(`Claude error: ${err.message}`, 'error');
    history.pop();
  }
}

// ── Gemini Handler ───────────────────────────────────────────────
async function handleGemini(socket, userMessage) {
  if (!googleClient) {
    return socket.emit('chat:error', { agentId: 'gemini', error: 'GOOGLE_API_KEY not set in .env' });
  }
  const agent = agents.get('gemini');
  const history = histories.get('gemini');
  agent.messageCount++;
  socket.emit('chat:stream:start', { agentId: 'gemini' });

  try {
    const basePrompt = process.env.SYSTEM_PROMPT ||
      `You are Gemini, an AI assistant operating within AvAgentOS — a mission control system for managing AI agents on a local network. Help coordinate agents, answer questions, and act as an intelligent hub. Be concise and direct.`;
    const systemPrompt = basePrompt + memory.buildContextForAgent('gemini');

    const model = googleClient.getGenerativeModel({
      model: agent.model,
      systemInstruction: systemPrompt,
    });

    // Convert history to Gemini format (role: user/model)
    const geminiHistory = history.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const chat = model.startChat({ history: geminiHistory });

    let full = '';
    const result = await chat.sendMessageStream(userMessage);

    for await (const chunk of result.stream) {
      const delta = chunk.text();
      if (delta) {
        full += delta;
        socket.emit('chat:stream:delta', { agentId: 'gemini', delta });
      }
    }

    history.push({ role: 'user', content: userMessage });
    history.push({ role: 'assistant', content: full });
    if (history.length > 50) history.splice(0, 2);
    saveHistory('gemini');
    socket.emit('chat:stream:end', { agentId: 'gemini', fullText: full });
    syslog(`Gemini responded (${full.length} chars)`, 'success');
  } catch (err) {
    socket.emit('chat:error', { agentId: 'gemini', error: err.message });
    syslog(`Gemini error: ${err.message}`, 'error');
  }
}

// ── Hermes Telegram Handler ──────────────────────────────────────
async function handleHermesTelegram(socket, agentId, userMessage) {
  const token  = process.env.HERMES_TELEGRAM_TOKEN;
  const chatId = process.env.HERMES_TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return socket.emit('chat:error', { agentId, error: 'HERMES_TELEGRAM_TOKEN or HERMES_TELEGRAM_CHAT_ID not set in .env' });
  }

  const agent = agents.get(agentId);
  const history = histories.get(agentId) || [];
  history.push({ role: 'user', content: userMessage });
  agent.messageCount++;
  socket.emit('chat:stream:start', { agentId });

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: userMessage }),
    });
    if (!res.ok) throw new Error(`Telegram API error: ${res.status}`);

    // Response will come back via /api/inbox → socket agent:inbox
    socket.emit('chat:stream:end', { agentId, fullText: '_(message sent to Hermes via Telegram — reply incoming)_' });
    syslog(`→ Hermes [Telegram]: "${userMessage.substring(0, 60)}"`, 'info');
  } catch (err) {
    socket.emit('chat:error', { agentId, error: err.message });
    syslog(`Hermes Telegram error: ${err.message}`, 'error');
    history.pop();
  }
}

// ── Agent Handler ────────────────────────────────────────────────
async function handleAgent(socket, agentId, userMessage) {
  const agent = agents.get(agentId);
  if (!agent?.host) {
    socket.emit('chat:error', { agentId, error: `Agent "${agentId}" has no network endpoint configured.` });
    return;
  }
  const history = histories.get(agentId) || [];
  history.push({ role: 'user', content: userMessage });
  agent.messageCount++;
  socket.emit('chat:stream:start', { agentId });

  try {
    // Support full URLs (https://openrouter.ai) or host:port (192.168.1.1:8080)
    const baseUrl = agent.host?.startsWith('http')
      ? agent.host.replace(/\/$/, '')
      : `http://${agent.host}:${agent.port}`;
    // hermes-dashboard and openrouter use /api/v1/..., most others use /v1/...
    const defaultEndpoint = (agent.type === 'hermes' || agent.type === 'openrouter')
      ? '/api/v1/chat/completions'
      : '/v1/chat/completions';
    const endpoint = agent.config?.chatEndpoint || defaultEndpoint;
    const fmt = agent.config?.format || 'openai';

    // Hermes dashboard uses provider name as model, or pass-through to openrouter/openai-codex
    const defaultModel = agent.type === 'hermes' ? 'openai-codex' : 'default';
    const resolvedModel = agent.config?.model || agent.model || defaultModel;

    // Build identity envelope — hardcoded now, will come from session/auth in future
    const envelope = buildEnvelope({ project_id: null });

    let body;
    if (fmt === 'openai') {
      body = { model: resolvedModel, messages: history, stream: false, user: JSON.stringify(envelope) };
    } else if (fmt === 'anthropic') {
      body = { messages: history, max_tokens: 2048 };
    } else if (fmt === 'simple') {
      body = { message: userMessage };
    } else {
      body = { messages: history, message: userMessage };
    }

    const headers = { 'Content-Type': 'application/json' };
    // Only send Authorization if apiKey is set AND dashboard doesn't use empty-key (no-auth) mode
    if (agent.apiKey && agent.apiKey.trim() !== '') {
      headers['Authorization'] = `Bearer ${agent.apiKey}`;
    }

    const res = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST', headers, body: JSON.stringify(body),
      timeout: 180000,
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

    const data = await res.json();
    let text = data.choices?.[0]?.message?.content
      || data.content?.[0]?.text
      || data.message || data.response || data.output
      || JSON.stringify(data, null, 2);

    history.push({ role: 'assistant', content: text });
    if (history.length > 50) history.splice(0, 2);
    saveHistory(agentId);
    socket.emit('chat:stream:end', { agentId, fullText: text });
    syslog(`${agent.name} responded (${text.length} chars)`, 'success');
  } catch (err) {
    agent.status = 'error';
    io.emit('agent:status', { id: agentId, status: 'error' });
    socket.emit('chat:error', { agentId, error: err.message });
    syslog(`${agent.name} error: ${err.message}`, 'error');
    history.pop();
  }
}

// ── LAN Discovery ────────────────────────────────────────────────
async function pingAgent(agentId) {
  const agent = agents.get(agentId);
  if (!agent) return false;
  if (agent.builtIn && agent.type !== 'ollama' && agent.type !== 'lmstudio') return 1;
  try {
    const start = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const defaultHealth = agent.type === 'hermes' ? '/api/status' : '/health';
    const healthPath = agent.config?.healthEndpoint || defaultHealth;
    const baseUrl = agent.host?.startsWith('http') ? agent.host.replace(/\/$/, '') : `http://${agent.host}:${agent.port}`;
    const res = await fetch(`${baseUrl}${healthPath}`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    const latency = Date.now() - start;
    const data = await res.json().catch(() => ({}));
    agent.status = res.ok ? 'online' : 'error';
    agent.latency = latency;
    agent.lastPing = Date.now();
    if (data.capabilities) agent.capabilities = { ...(agent.capabilities || {}), ...data.capabilities };
    if (data.config?.capabilities) agent.capabilities = { ...(agent.capabilities || {}), ...data.config.capabilities };
    if (data.agent && !agent.config?.bridgeAgentId) {
      agent.config = { ...(agent.config || {}), bridgeAgentId: data.agent };
    }
    if (data.hostname) agent.hostname = data.hostname;
    if (agent.type === 'ollama' && Array.isArray(data.models) && data.models.length > 0) {
      if (!agent.model) agent.model = data.models[0].name;
      agent.description = `Ollama — ${data.models.map(m => m.name).join(', ')}`;
    }
    if (agent.type === 'lmstudio' && Array.isArray(data.data) && data.data.length > 0) {
      if (!agent.model) agent.model = data.data[0].id;
      agent.description = `LM Studio — ${data.data.map(m => m.id).join(', ')}`;
    }
    agent.lastSeenOnline = Date.now();
    io.emit('agent:status', { id: agentId, status: agent.status, latency });
    return latency;
  } catch {
    agent.status = 'offline';
    agent.lastPing = Date.now();
    io.emit('agent:status', { id: agentId, status: 'offline' });
    return false;
  }
}

async function scanLAN(subnet, scanPorts = [8080, 8000, 3000, 5000, 7860, 11434, 1234], socket) {
  if (!subnet) {
    const ifaces = os.networkInterfaces();
    outer: for (const iface of Object.values(ifaces)) {
      for (const addr of iface) {
        if (addr.family === 'IPv4' && !addr.internal) {
          const p = addr.address.split('.');
          subnet = `${p[0]}.${p[1]}.${p[2]}`;
          break outer;
        }
      }
    }
  }
  if (!subnet) return [];

  const found = [];
  const batch = 20;
  const hosts = Array.from({ length: 254 }, (_, i) => `${subnet}.${i + 1}`);

  for (let i = 0; i < hosts.length; i += batch) {
    const slice = hosts.slice(i, i + batch);
    const checks = slice.flatMap(h => scanPorts.map(p => probeHost(h, p)));
    const results = await Promise.allSettled(checks);
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        found.push(r.value);
        socket.emit('discover:found', r.value);
        syslog(`Found: ${r.value.name} at ${r.value.host}:${r.value.port}`, 'success');
      }
    }
    socket.emit('discover:progress', { scanned: Math.min(i + batch, 254), total: 254 });
  }
  return found;
}

async function probeHost(host, port) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 1200);
    const res = await fetch(`http://${host}:${port}/health`, { signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    return {
      host, port,
      name: data.name || data.agent_name || data.id || `Agent@${host}:${port}`,
      type: data.type || data.agent_type || 'generic',
      version: data.version || null,
    };
  } catch { return null; }
}

// ── Health ping loop ─────────────────────────────────────────────
pingAgent('ollama');    // initial check on startup
pingAgent('lmstudio'); // initial check on startup
setInterval(() => {
  for (const [id, agent] of agents) {
    if (!agent.builtIn || agent.type === 'ollama' || agent.type === 'lmstudio') pingAgent(id);
  }
}, 30000);

// ── TTL cleanup — remove non-builtIn agents offline > 24h ────────
const AGENT_TTL_MS = 24 * 60 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [id, agent] of agents) {
    if (agent.builtIn) continue;
    if (agent.status === 'offline' || agent.status === 'error') {
      const lastSeen = agent.lastSeenOnline || agent.connectedAt || 0;
      if (now - lastSeen > AGENT_TTL_MS) {
        agents.delete(id);
        histories.delete(id);
        saveAgents();
        io.emit('agent:removed', { id });
        syslog(`Agent "${agent.name}" removed — offline > 24h (TTL)`, 'warning');
      }
    }
  }
}, 60 * 60 * 1000); // check every hour

function syslog(message, level = 'info') {
  io.emit('system:log', { message, level, ts: new Date().toISOString() });
}

// ── Start ─────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════╗`);
  console.log(`  ║        AvAgentOS  v1.0               ║`);
  console.log(`  ║  Mission Control  →  localhost:${PORT}  ║`);
  console.log(`  ╚══════════════════════════════════════╝\n`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log(`  ⚠  No ANTHROPIC_API_KEY — copy .env.example to .env\n`);
  }
  syslog('AvAgentOS online', 'success');
});
