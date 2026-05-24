/* ── AvAgentOS Frontend ─────────────────────────────────────────── */
'use strict';

const AGENT_ICONS = {
  claude:   '🤖',
  gemini:   '✦',
  hermes:   '⚡',
  openclaw: '🦅',
  ollama:   '🦙',
  openai:   '🧠',
  generic:  '🔌',
};
const AGENT_COLORS = {
  claude:   '#00d4ff',
  gemini:   '#4285f4',
  hermes:   '#f59e0b',
  openclaw: '#10b981',
  ollama:   '#a855f7',
  openai:   '#22d3ee',
  generic:  '#64748b',
};

// ── State ──────────────────────────────────────────────────────────
const state = {
  agents: new Map(),
  activeAgentId: 'claude',
  chats: new Map(),         // agentId → [{role, content, ts}]
  totalMsgs: 0,
  logFilter: 'all',
  streaming: false,
  streamBuffer: '',
  logEntries: [],
};

// ── DOM ────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const el = {
  chatMessages:  $('chat-messages'),
  agentList:     $('agent-list'),
  agentTabsBar:  $('agent-tabs-bar'),
  detailTabs:    $('detail-tabs'),
  detailContent: $('detail-content'),
  logEntries:    $('log-entries'),
  chatInput:     $('chat-input'),
  btnSend:       $('btn-send'),
  typingIndicator: $('typing-indicator'),
  tiName:        $('ti-name'),
  activeAgentLabel: $('active-agent-label'),
  valAgents:     $('val-agents'),
  valOnline:     $('val-online'),
  valMsgs:       $('val-msgs'),
  connBadge:     $('conn-badge'),
  connLabel:     $('conn-label'),
  welcomeMsg:    $('welcome-msg'),
  scanStatus:    $('scan-status'),
  scanProgressFill: $('scan-progress-fill'),
  scanResults:   $('scan-results'),
};

// ── Socket.IO ──────────────────────────────────────────────────────
const socket = io({ reconnectionDelay: 1000 });

socket.on('connect', () => {
  setConnStatus(true);
  addLog('Socket connected', 'success');
});
socket.on('disconnect', () => {
  setConnStatus(false);
  addLog('Socket disconnected', 'warning');
});

socket.on('state:init', ({ agents, hasClaudeKey }) => {
  for (const agent of agents) {
    state.agents.set(agent.id, agent);
    if (!state.chats.has(agent.id)) state.chats.set(agent.id, []);
  }
  renderAgentList();
  renderTabs();
  renderDetailTabs();
  updateMetrics();
  if (!hasClaudeKey) {
    addLog('ANTHROPIC_API_KEY not set — copy .env.example to .env', 'warning');
  }
});

socket.on('agent:added', agent => {
  state.agents.set(agent.id, agent);
  if (!state.chats.has(agent.id)) state.chats.set(agent.id, []);
  renderAgentList();
  renderTabs();
  renderDetailTabs();
  updateMetrics();
  addLog(`Agent "${agent.name}" connected`, 'success');
});

socket.on('agent:removed', ({ id }) => {
  const agent = state.agents.get(id);
  state.agents.delete(id);
  if (state.activeAgentId === id) setActiveAgent('claude');
  renderAgentList();
  renderTabs();
  renderDetailTabs();
  updateMetrics();
  if (agent) addLog(`Agent "${agent.name}" removed`, 'warning');
});

socket.on('agent:status', ({ id, status, latency }) => {
  const agent = state.agents.get(id);
  if (!agent) return;
  agent.status = status;
  agent.latency = latency;
  updateAgentCard(id);
  updateMetrics();
  updateDetailContent();
});

socket.on('chat:stream:start', ({ agentId }) => {
  if (agentId !== state.activeAgentId) return;
  state.streaming = true;
  state.streamBuffer = '';
  const agent = state.agents.get(agentId);
  el.tiName.textContent = agent?.name || agentId;
  el.typingIndicator.classList.remove('hidden');
  hideWelcome();
});

socket.on('chat:stream:delta', ({ agentId, delta }) => {
  if (agentId !== state.activeAgentId) return;
  state.streamBuffer += delta;
  updateStreamBubble(state.streamBuffer);
});

socket.on('chat:stream:end', ({ agentId, fullText }) => {
  state.streaming = false;
  el.typingIndicator.classList.add('hidden');
  removeStreamBubble();

  const agent = state.agents.get(agentId);
  if (agent) agent.messageCount = (agent.messageCount || 0) + 1;
  state.totalMsgs++;
  el.valMsgs.textContent = state.totalMsgs;

  const chat = state.chats.get(agentId) || [];
  chat.push({ role: 'assistant', content: fullText, ts: Date.now() });
  state.chats.set(agentId, chat);

  if (agentId === state.activeAgentId) {
    appendMessage('agent', fullText, agent?.name || agentId);
  }

  setBtnSend(true);
  updateDetailContent();
});

socket.on('chat:error', ({ agentId, error }) => {
  state.streaming = false;
  el.typingIndicator.classList.add('hidden');
  removeStreamBubble();
  setBtnSend(true);
  if (agentId === state.activeAgentId) {
    appendSystemMsg(`Error: ${error}`);
  }
  addLog(`Error [${agentId}]: ${error}`, 'error');
});

socket.on('chat:cleared', ({ agentId }) => {
  state.chats.set(agentId, []);
  if (agentId === state.activeAgentId) renderChat(agentId);
});

socket.on('system:log', ({ message, level, ts }) => addLog(message, level, ts));

// ── Incoming messages from agents (push via /api/inbox) ───────────
socket.on('agent:inbox', ({ agent, message, ts }) => {
  // Find agent by name or type
  const agentEntry = [...state.agents.values()].find(a =>
    a.name.toLowerCase() === agent.toLowerCase() ||
    a.type.toLowerCase() === agent.toLowerCase()
  );
  const agentId = agentEntry?.id || agent;

  // Add to BOTH possible keys to be safe
  [agentId, agent].forEach(key => {
    if (!state.chats.has(key)) state.chats.set(key, []);
  });
  const entry = { role: 'assistant', content: message, ts: ts || new Date().toISOString() };
  state.chats.get(agentId).push(entry);

  // Always re-render active chat (if this agent is active)
  if (state.activeAgentId === agentId) {
    renderChat(agentId);
  } else {
    // Still show a notification badge on the tab
    const tab = el.agentTabsBar?.querySelector(`[data-id="${agentId}"]`);
    if (tab && !tab.querySelector('.inbox-dot')) {
      const dot = document.createElement('span');
      dot.className = 'inbox-dot';
      dot.style.cssText = 'display:inline-block;width:8px;height:8px;background:#f59e0b;border-radius:50%;margin-left:4px;';
      tab.appendChild(dot);
    }
  }

  // Flash agent card
  const card = document.querySelector(`[data-agent-id="${agentId}"]`);
  if (card) {
    card.classList.add('inbox-flash');
    setTimeout(() => card.classList.remove('inbox-flash'), 2000);
  }
});

socket.on('discover:started', () => {
  el.scanStatus.textContent = 'Scanning local network...';
  el.scanProgressFill.style.width = '0%';
  el.scanResults.innerHTML = '';
});

socket.on('discover:progress', ({ scanned, total }) => {
  el.scanProgressFill.style.width = `${(scanned / total * 100).toFixed(0)}%`;
  el.scanStatus.textContent = `Scanning... ${scanned}/${total} hosts`;
});

socket.on('discover:found', data => {
  const div = document.createElement('div');
  div.className = 'scan-result';
  div.innerHTML = `
    <div>
      <div class="scan-result-info">${data.name} — ${data.host}:${data.port}</div>
      <div class="scan-result-type">${data.type || 'unknown'}</div>
    </div>
    <button class="scan-result-add" data-host="${data.host}" data-port="${data.port}" data-name="${data.name}" data-type="${data.type || 'generic'}">ADD</button>
  `;
  div.querySelector('.scan-result-add').addEventListener('click', e => {
    const btn = e.currentTarget;
    addAgentQuick(btn.dataset.name, btn.dataset.type, btn.dataset.host, btn.dataset.port);
    btn.textContent = '✓';
    btn.disabled = true;
  });
  el.scanResults.appendChild(div);
});

socket.on('discover:done', ({ found }) => {
  el.scanProgressFill.style.width = '100%';
  el.scanStatus.textContent = found > 0
    ? `Scan complete — ${found} agent(s) found`
    : 'Scan complete — no agents found on this network';
  $('btn-start-scan').textContent = 'SCAN AGAIN';
  $('btn-start-scan').disabled = false;
});

// ── Rendering ──────────────────────────────────────────────────────
function renderAgentList() {
  el.agentList.innerHTML = '';
  for (const agent of state.agents.values()) {
    el.agentList.appendChild(buildAgentCard(agent));
  }
}

function buildAgentCard(agent) {
  const card = document.createElement('div');
  card.className = `agent-card status-${agent.status}`;
  card.dataset.id = agent.id;
  if (agent.id === state.activeAgentId) card.classList.add('active');
  const color = AGENT_COLORS[agent.type] || AGENT_COLORS.generic;
  card.style.setProperty('--agent-color', color);

  const statusLabel = { online: 'ONLINE', offline: 'OFFLINE', connecting: 'CONNECTING', error: 'ERROR', 'no-key': 'NO KEY' };
  const latencyStr = agent.latency ? `${agent.latency}ms` : '—';

  card.innerHTML = `
    <div class="agent-card-top">
      <div class="agent-avatar">${AGENT_ICONS[agent.type] || '🔌'}</div>
      <div class="agent-info">
        <div class="agent-name">${escHtml(agent.name)}</div>
        <div class="agent-type">${agent.type.toUpperCase()}</div>
      </div>
    </div>
    <div class="agent-status">
      <div class="agent-status-dot"></div>
      <span class="agent-status-text">${statusLabel[agent.status] || agent.status.toUpperCase()}</span>
    </div>
    <div class="agent-meta">
      <span>${agent.builtIn ? agent.model || '' : (agent.host ? `${agent.host}:${agent.port}` : '')}</span>
      <span class="agent-latency">${latencyStr}</span>
    </div>
    <div class="agent-actions">
      <button class="agent-btn btn-chat" data-id="${agent.id}">CHAT</button>
      ${!agent.builtIn ? `<button class="agent-btn btn-ping" data-id="${agent.id}">PING</button>` : ''}
      ${!agent.builtIn ? `<button class="agent-btn danger btn-remove" data-id="${agent.id}">✕</button>` : ''}
    </div>
  `;

  card.querySelector('.btn-chat')?.addEventListener('click', () => setActiveAgent(agent.id));
  card.querySelector('.btn-ping')?.addEventListener('click', e => { e.stopPropagation(); pingAgent(agent.id); });
  card.querySelector('.btn-remove')?.addEventListener('click', e => { e.stopPropagation(); removeAgent(agent.id); });
  card.addEventListener('click', () => setActiveAgent(agent.id));
  return card;
}

function updateAgentCard(id) {
  const existing = el.agentList.querySelector(`[data-id="${id}"]`);
  const agent = state.agents.get(id);
  if (!existing || !agent) return;
  const newCard = buildAgentCard(agent);
  el.agentList.replaceChild(newCard, existing);
}

function renderTabs() {
  el.agentTabsBar.innerHTML = '';
  for (const agent of state.agents.values()) {
    const tab = document.createElement('div');
    tab.className = `chat-tab${agent.id === state.activeAgentId ? ' active' : ''}`;
    tab.dataset.id = agent.id;
    tab.innerHTML = `<span class="tab-dot"></span>${escHtml(agent.name)}`;
    tab.addEventListener('click', () => setActiveAgent(agent.id));
    el.agentTabsBar.appendChild(tab);
  }
}

function renderDetailTabs() {
  el.detailTabs.innerHTML = '';
  for (const agent of state.agents.values()) {
    const tab = document.createElement('div');
    tab.className = `detail-tab${agent.id === state.activeAgentId ? ' active' : ''}`;
    tab.dataset.id = agent.id;
    tab.textContent = agent.name.toUpperCase();
    tab.addEventListener('click', () => setActiveAgent(agent.id));
    el.detailTabs.appendChild(tab);
  }
}

function renderChat(agentId) {
  el.chatMessages.innerHTML = '';
  const msgs = state.chats.get(agentId) || [];
  if (!msgs.length) {
    showWelcome();
    return;
  }
  for (const msg of msgs) {
    if (msg.role === 'user') {
      appendMessage('user', msg.content, 'YOU');
    } else {
      const agent = state.agents.get(agentId);
      appendMessage('agent', msg.content, agent?.name || agentId);
    }
  }
}

function setActiveAgent(id) {
  state.activeAgentId = id;
  const agent = state.agents.get(id);
  if (!agent) return;

  // Update header
  el.activeAgentLabel.textContent = `${agent.name.toUpperCase()} — MISSION CONTROL`;

  // Update tabs
  el.agentTabsBar.querySelectorAll('.chat-tab').forEach(t => t.classList.toggle('active', t.dataset.id === id));
  el.detailTabs.querySelectorAll('.detail-tab').forEach(t => t.classList.toggle('active', t.dataset.id === id));

  // Update agent cards
  el.agentList.querySelectorAll('.agent-card').forEach(c => c.classList.toggle('active', c.dataset.id === id));

  // Render chat
  renderChat(id);
  updateDetailContent();
}

function updateDetailContent() {
  const agent = state.agents.get(state.activeAgentId);
  if (!agent) return;

  const uptime = formatDuration(Date.now() - agent.connectedAt);
  const latency = agent.latency ? `${agent.latency}ms` : '—';
  const statusClass = agent.status;

  el.detailContent.innerHTML = `
    <div class="detail-block">
      <div class="detail-label">AGENT</div>
      <div class="detail-value">${escHtml(agent.name)}</div>
    </div>
    <div class="detail-block">
      <div class="detail-label">STATUS</div>
      <div class="detail-value ${statusClass}">${agent.status.toUpperCase()}</div>
    </div>
    <div class="detail-block">
      <div class="detail-label">TYPE</div>
      <div class="detail-value">${agent.type.toUpperCase()}</div>
    </div>
    ${agent.model ? `<div class="detail-block"><div class="detail-label">MODEL</div><div class="detail-value">${agent.model}</div></div>` : ''}
    ${!agent.builtIn ? `<div class="detail-block"><div class="detail-label">HOST</div><div class="detail-value">${agent.host}:${agent.port}</div></div>` : ''}
    <div class="detail-block">
      <div class="detail-label">MESSAGES</div>
      <div class="detail-value">${agent.messageCount || 0}</div>
    </div>
    <div class="detail-block">
      <div class="detail-label">LATENCY</div>
      <div class="detail-value">${latency}</div>
    </div>
    <div class="detail-block">
      <div class="detail-label">UPTIME</div>
      <div class="detail-value">${uptime}</div>
    </div>
  `;
}

// ── Chat ───────────────────────────────────────────────────────────
function appendMessage(role, content, senderName) {
  hideWelcome();
  const div = document.createElement('div');
  div.className = `msg msg-${role}`;
  const ts = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const rendered = role === 'agent' ? renderMarkdown(content) : escHtml(content).replace(/\n/g, '<br>');
  div.innerHTML = `
    <div class="msg-header">
      <span class="msg-sender">${escHtml(senderName)}</span>
      <span class="msg-ts">${ts}</span>
    </div>
    <div class="msg-bubble">${rendered}</div>
  `;
  el.chatMessages.appendChild(div);
  el.chatMessages.scrollTop = el.chatMessages.scrollHeight;

  // Syntax highlight code blocks
  div.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
}

function appendSystemMsg(text) {
  const div = document.createElement('div');
  div.className = 'msg msg-system';
  div.innerHTML = `<div class="msg-bubble">${escHtml(text)}</div>`;
  el.chatMessages.appendChild(div);
  el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
}

let streamBubble = null;
function updateStreamBubble(text) {
  if (!streamBubble) {
    hideWelcome();
    streamBubble = document.createElement('div');
    streamBubble.className = 'msg msg-agent';
    const agent = state.agents.get(state.activeAgentId);
    streamBubble.innerHTML = `
      <div class="msg-header">
        <span class="msg-sender">${escHtml(agent?.name || state.activeAgentId)}</span>
      </div>
      <div class="msg-bubble streaming-cursor"></div>
    `;
    el.chatMessages.appendChild(streamBubble);
  }
  const bubble = streamBubble.querySelector('.msg-bubble');
  bubble.innerHTML = renderMarkdown(text);
  bubble.classList.add('streaming-cursor');
  el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
}

function removeStreamBubble() {
  if (streamBubble) {
    streamBubble.querySelector('.msg-bubble')?.classList.remove('streaming-cursor');
    streamBubble = null;
  }
}

function sendMessage() {
  const text = el.chatInput.value.trim();
  if (!text || state.streaming) return;

  const agent = state.agents.get(state.activeAgentId);
  if (!agent) return;

  // Optimistic user message
  appendMessage('user', text, 'YOU');
  const chat = state.chats.get(state.activeAgentId) || [];
  chat.push({ role: 'user', content: text, ts: Date.now() });
  state.chats.set(state.activeAgentId, chat);

  el.chatInput.value = '';
  el.chatInput.style.height = 'auto';
  setBtnSend(false);

  socket.emit('chat:message', { agentId: state.activeAgentId, message: text });
}

function setBtnSend(enabled) {
  el.btnSend.disabled = !enabled;
}

function hideWelcome() {
  const w = $('welcome-msg');
  if (w) w.remove();
}

function showWelcome() {
  if (!el.chatMessages.querySelector('.welcome-screen')) {
    el.chatMessages.innerHTML = `
      <div id="welcome-msg" class="welcome-screen">
        <div class="welcome-logo">AV<br>AGENT<br>OS</div>
        <div class="welcome-text">Mission Control Online</div>
        <div class="welcome-sub">Begin your mission</div>
      </div>
    `;
  }
}

// ── Agent Actions ──────────────────────────────────────────────────
function pingAgent(id) {
  socket.emit('agent:ping', { id });
  addLog(`Pinging ${state.agents.get(id)?.name || id}...`, 'info');
}

function removeAgent(id) {
  const agent = state.agents.get(id);
  if (!agent || !confirm(`Remove agent "${agent.name}"?`)) return;
  fetch(`/api/agents/${id}`, { method: 'DELETE' });
}

function addAgentQuick(name, type, host, port) {
  fetch('/api/agents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, type, host, port }),
  });
}

// ── Log ────────────────────────────────────────────────────────────
function addLog(message, level = 'info', tsStr) {
  const entry = { message, level, ts: tsStr || new Date().toISOString() };
  state.logEntries.push(entry);
  if (state.logEntries.length > 500) state.logEntries.shift();
  if (state.logFilter === 'all' || state.logFilter === level) {
    renderLogEntry(entry);
  }
}

function renderLogEntry(entry) {
  const div = document.createElement('div');
  div.className = `log-entry log-${entry.level}`;
  div.dataset.level = entry.level;
  const ts = new Date(entry.ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  div.innerHTML = `<span class="log-ts">${ts}</span><span class="log-msg">${escHtml(entry.message)}</span>`;
  el.logEntries.appendChild(div);
  el.logEntries.scrollTop = el.logEntries.scrollHeight;
}

function filterLogs(level) {
  state.logFilter = level;
  el.logEntries.innerHTML = '';
  for (const entry of state.logEntries) {
    if (level === 'all' || entry.level === level) renderLogEntry(entry);
  }
}

// ── Metrics ────────────────────────────────────────────────────────
function updateMetrics() {
  const total = state.agents.size;
  const online = [...state.agents.values()].filter(a => a.status === 'online' || a.status === 'no-key').length;
  el.valAgents.textContent = total;
  el.valOnline.textContent = online;
}

function setConnStatus(connected) {
  el.connBadge.className = `status-badge ${connected ? 'connected' : 'disconnected'}`;
  el.connLabel.textContent = connected ? 'CONNECTED' : 'OFFLINE';
}

// ── Modals ─────────────────────────────────────────────────────────
function openAddModal() {
  $('modal-overlay').classList.remove('hidden');
  $('inp-name').focus();
}
function closeAddModal() {
  $('modal-overlay').classList.add('hidden');
  $('form-add-agent').reset();
}

$('btn-add-agent').addEventListener('click', openAddModal);
$('btn-modal-close').addEventListener('click', closeAddModal);
$('btn-modal-cancel').addEventListener('click', closeAddModal);
$('modal-overlay').addEventListener('click', e => { if (e.target === $('modal-overlay')) closeAddModal(); });

$('form-add-agent').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('inp-name').value.trim();
  const type = $('inp-type').value;
  const host = $('inp-host').value.trim();
  const port = $('inp-port').value;
  const endpoint = $('inp-endpoint').value.trim();
  const health = $('inp-health').value.trim();
  const apiKey = $('inp-apikey').value.trim();
  const format = $('inp-format').value;

  const config = {};
  if (endpoint) config.chatEndpoint = endpoint;
  if (health) config.healthEndpoint = health;
  if (format) config.format = format;

  const resp = await fetch('/api/agents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, type, host, port, apiKey, config }),
  });
  if (resp.ok) closeAddModal();
  else {
    const err = await resp.json();
    alert(err.error || 'Failed to add agent');
  }
});

// Discover modal
$('btn-scan').addEventListener('click', () => {
  $('modal-discover').classList.remove('hidden');
  el.scanResults.innerHTML = '';
  el.scanStatus.textContent = 'Ready to scan local network for agents.';
  el.scanProgressFill.style.width = '0%';
  $('btn-start-scan').textContent = 'START SCAN';
  $('btn-start-scan').disabled = false;
});
$('btn-discover-close').addEventListener('click', () => $('modal-discover').classList.add('hidden'));
$('btn-discover-cancel').addEventListener('click', () => $('modal-discover').classList.add('hidden'));
$('modal-discover').addEventListener('click', e => { if (e.target === $('modal-discover')) $('modal-discover').classList.add('hidden'); });

$('btn-start-scan').addEventListener('click', () => {
  $('btn-start-scan').disabled = true;
  socket.emit('discover:scan', {});
});

// ── Input handling ─────────────────────────────────────────────────
el.chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
el.chatInput.addEventListener('input', () => {
  el.chatInput.style.height = 'auto';
  el.chatInput.style.height = Math.min(el.chatInput.scrollHeight, 120) + 'px';
  setBtnSend(!!el.chatInput.value.trim() && !state.streaming);
});
el.btnSend.addEventListener('click', sendMessage);
$('btn-clear-chat').addEventListener('click', () => socket.emit('chat:clear', { agentId: state.activeAgentId }));
$('btn-broadcast').addEventListener('click', () => {
  const text = el.chatInput.value.trim() || prompt('Broadcast message to all online agents:');
  if (text) {
    el.chatInput.value = '';
    socket.emit('broadcast', { message: text });
  }
});

// Log filters
document.querySelectorAll('.lf-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.lf-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filterLogs(btn.dataset.level);
  });
});
$('btn-clear-log').addEventListener('click', () => {
  state.logEntries.length = 0;
  el.logEntries.innerHTML = '';
});

// ── Clock ──────────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  $('clock-time').textContent = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  $('clock-date').textContent = now.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }).toUpperCase();
}
updateClock();
setInterval(updateClock, 1000);

// ── Background Canvas ──────────────────────────────────────────────
(function initCanvas() {
  const canvas = $('bg-canvas');
  const ctx = canvas.getContext('2d');

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  const stars = Array.from({ length: 100 }, () => ({
    x: Math.random(),
    y: Math.random(),
    r: Math.random() * 1.2 + 0.3,
    a: Math.random() * 0.5 + 0.1,
    speed: Math.random() * 0.00015 + 0.00005,
  }));

  const gridSize = 60;

  function draw() {
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = 'rgba(0, 212, 255, 0.025)';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += gridSize) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y < H; y += gridSize) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // Stars
    const now = performance.now() * 0.001;
    for (const s of stars) {
      const opacity = s.a * (0.6 + 0.4 * Math.sin(now * s.speed * 1000 + s.x * 10));
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(180, 220, 255, ${opacity})`;
      ctx.fill();
    }

    requestAnimationFrame(draw);
  }
  draw();
})();

// ── Helpers ────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMarkdown(text) {
  if (typeof marked !== 'undefined') {
    marked.setOptions({ breaks: true, gfm: true });
    return marked.parse(text);
  }
  return escHtml(text).replace(/\n/g, '<br>');
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// ── Memory ─────────────────────────────────────────────────────────
const memState = { connected: false, notes: [], collapsed: false };

socket.on('memory:status', status => {
  memState.connected = status.connected;
  const dot   = $('memory-conn-dot');
  const label = $('memory-conn-label');
  const badge = $('memory-note-count');
  if (dot)   dot.className   = `mem-dot ${status.connected ? 'connected' : 'disconnected'}`;
  if (label) label.textContent = status.connected
    ? `${status.folderName} · ${status.noteCount} notes`
    : 'Not configured';
  if (badge) badge.textContent = status.noteCount || '—';
});

socket.on('memory:notes', notes => {
  memState.notes = notes;
  renderMemoryNotes(notes);
});

socket.on('memory:note-content', ({ relPath, content }) => {
  openNoteEditor(relPath, content || '');
});

socket.on('memory:save-result', ({ ok, agentId }) => {
  const btn = $('btn-save-memory');
  if (!btn) return;
  btn.classList.remove('saving');
  if (ok) {
    btn.classList.add('saved');
    btn.textContent = '✓';
    setTimeout(() => { btn.classList.remove('saved'); btn.textContent = '💾'; }, 2000);
    addLog(`Conversation saved to Obsidian`, 'success');
  } else {
    addLog('Memory not configured — set OBSIDIAN_VAULT_PATH in .env', 'warning');
  }
});

function renderMemoryNotes(notes) {
  const list = $('memory-notes-list');
  if (!list) return;
  list.innerHTML = '';
  if (!notes.length) {
    list.innerHTML = '<div style="padding:8px 12px;font-size:10px;color:var(--text-muted)">No notes found</div>';
    return;
  }
  for (const note of notes) {
    const div = document.createElement('div');
    div.className = 'mem-note';
    const isShared = note.name === 'shared-context.md';
    const isAgent  = note.name.startsWith('agents/');
    const tag = isShared ? 'SHARED' : isAgent ? 'AGENT' : note.name.startsWith('conversations/') ? 'CONV' : '';
    div.innerHTML = `
      <span class="mem-note-icon">📄</span>
      <div class="mem-note-info">
        <div class="mem-note-name">${escHtml(note.name)}</div>
        <div class="mem-note-preview">${escHtml(note.preview)}</div>
      </div>
      ${tag ? `<span class="mem-note-tag">${tag}</span>` : ''}
    `;
    div.addEventListener('click', () => socket.emit('memory:read-note', { relPath: note.name }));
    list.appendChild(div);
  }
}

// Memory panel toggle
$('btn-toggle-memory').addEventListener('click', () => {
  memState.collapsed = !memState.collapsed;
  $('memory-section').classList.toggle('memory-collapsed', memState.collapsed);
});

// Sync button
$('btn-memory-sync').addEventListener('click', e => {
  e.stopPropagation();
  socket.emit('memory:sync');
  addLog('Syncing Obsidian vault...', 'info');
});

// Save conversation button
$('btn-save-memory').addEventListener('click', () => {
  const btn = $('btn-save-memory');
  btn.classList.add('saving');
  socket.emit('memory:save-chat', { agentId: state.activeAgentId });
});

// New note button
$('btn-open-note-editor').addEventListener('click', () => openNoteEditor('', ''));

// Note editor modal
function openNoteEditor(relPath, content) {
  $('inp-note-path').value = relPath || '';
  $('note-editor-content').value = content || '';
  $('note-editor-title').textContent = relPath ? `EDIT: ${relPath}` : 'NEW NOTE';
  $('modal-note').classList.remove('hidden');
  ($('note-editor-content')).focus();
}
function closeNoteEditor() { $('modal-note').classList.add('hidden'); }

$('btn-note-close').addEventListener('click', closeNoteEditor);
$('btn-note-cancel').addEventListener('click', closeNoteEditor);
$('modal-note').addEventListener('click', e => { if (e.target === $('modal-note')) closeNoteEditor(); });

$('btn-note-save').addEventListener('click', () => {
  const relPath = $('inp-note-path').value.trim();
  const content = $('note-editor-content').value;
  if (!relPath) { alert('Enter a file path'); return; }
  socket.emit('memory:write-note', { relPath, content });
  closeNoteEditor();
  addLog(`Note saved: ${relPath}`, 'success');
});

// ── Init ───────────────────────────────────────────────────────────
addLog('AvAgentOS frontend loaded', 'info');
setBtnSend(false);
el.chatInput.addEventListener('input', () => setBtnSend(!!el.chatInput.value.trim() && !state.streaming));
