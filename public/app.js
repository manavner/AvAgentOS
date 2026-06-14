/* ── AvAgentOS Frontend ─────────────────────────────────────────── */
'use strict';

const AGENT_ICONS = {
  claude:   '🤖',
  gemini:   '✦',
  hermes:   '⚡',
  openclaw: '🦅',
  ollama:   '🦙',
  openai:   '🧠',
  openrouter:'🧭',
  generic:  '🔌',
};
const AGENT_COLORS = {
  claude:   '#00d4ff',
  gemini:   '#4285f4',
  hermes:   '#f59e0b',
  openclaw: '#10b981',
  ollama:   '#a855f7',
  openai:   '#22d3ee',
  openrouter:'#8b5cf6',
  generic:  '#64748b',
};
const LLM_TYPES = new Set(['claude', 'gemini', 'openai', 'openrouter', 'ollama']);

// ── State ──────────────────────────────────────────────────────────
const state = {
  agents: new Map(),
  activeAgentId: null,
  chats: new Map(),         // agentId → [{role, content, ts}]
  totalMsgs: 0,
  logFilter: 'all',
  streaming: false,
  streamBuffer: '',
  responseTimer: null,
  logEntries: [],
  display: {
    fontSize: Number(localStorage.getItem('avagentos.chatFontSize')) || 13,
    textDir: localStorage.getItem('avagentos.textDir') || 'auto',
  },
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
  fontSizeLabel: $('font-size-label'),
  btnSend:       $('btn-send'),
  typingIndicator: $('typing-indicator'),
  tiName:        $('ti-name'),
  activeAgentLabel: $('active-agent-label'),
  valAgents:     $('val-agents'),
  valLlms:       $('val-llms'),
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
  setActiveAgent(pickDefaultAgentId());
  if (!hasClaudeKey) {
    addLog('ANTHROPIC_API_KEY not set — copy .env.example to .env', 'warning');
  }
});

function pickDefaultAgentId() {
  const agents = [...state.agents.values()];
  return agents.find(a => a.status === 'online' && a.type === 'hermes' && /deamon|local/i.test(`${a.name} ${a.id}`))?.id
    || agents.find(a => a.status === 'online' && a.type === 'hermes')?.id
    || agents.find(a => a.status === 'online')?.id
    || agents.find(a => a.status === 'no-key')?.id
    || agents[0]?.id
    || null;
}

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
  clearResponseTimer();
  state.responseTimer = setTimeout(() => {
    if (!state.streaming) return;
    state.streaming = false;
    el.typingIndicator.classList.add('hidden');
    removeStreamBubble();
    appendSystemMsg('Timeout: לא התקבלה תשובה מהסוכן בזמן. אפשר לשלוח שוב או לבדוק שהסוכן Online.');
    setBtnSend(!!el.chatInput.value.trim());
  }, 185000);
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
  clearResponseTimer();
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

  setBtnSend(!!el.chatInput.value.trim());
  updateDetailContent();
});

socket.on('chat:error', ({ agentId, error }) => {
  state.streaming = false;
  clearResponseTimer();
  el.typingIndicator.classList.add('hidden');
  removeStreamBubble();
  setBtnSend(!!el.chatInput.value.trim());
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
  const allAgents = [...state.agents.values()];
  const agents = uniqueAgentsForDisplay(allAgents.filter(a => !isLlmAgent(a)));
  const llms = uniqueAgentsForDisplay(allAgents.filter(isLlmAgent));

  appendAgentSection('AGENTS', agents);
  appendAgentSection('LLMS', llms);
}

function appendAgentSection(title, agents) {
  if (!agents.length) return;
  const section = document.createElement('div');
  section.className = 'agent-list-section';
  section.innerHTML = `<div class="agent-section-title">${escHtml(title)}</div>`;
  for (const agent of agents) {
    section.appendChild(buildAgentCard(agent));
  }
  el.agentList.appendChild(section);
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
  const displayName = getAgentDisplayName(agent);
  const categoryLabel = isLlmAgent(agent) ? 'LLM' : 'AGENT';
  const subtype = agent.type ? agent.type.toUpperCase() : 'GENERIC';

  card.innerHTML = `
    <div class="agent-card-top">
      <div class="agent-avatar">${AGENT_ICONS[agent.type] || '🔌'}</div>
      <div class="agent-info">
        <div class="agent-name">${escHtml(displayName)}</div>
        <div class="agent-type">${categoryLabel} · ${subtype}</div>
      </div>
    </div>
    <div class="agent-status">
      <div class="agent-status-dot"></div>
      <span class="agent-status-text">${statusLabel[agent.status] || agent.status.toUpperCase()}</span>
    </div>
    <div class="agent-meta">
      <span>${escHtml(agent.builtIn ? agent.model || '' : (agent.host ? `${agent.host}:${agent.port}` : ''))}</span>
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
  for (const agent of uniqueAgentsForDisplay([...state.agents.values()])) {
    const tab = document.createElement('div');
    tab.className = `chat-tab${agent.id === state.activeAgentId ? ' active' : ''}`;
    tab.dataset.id = agent.id;
    tab.innerHTML = `<span class="tab-dot"></span>${escHtml(getAgentDisplayName(agent))}`;
    tab.addEventListener('click', () => setActiveAgent(agent.id));
    el.agentTabsBar.appendChild(tab);
  }
}

function renderDetailTabs() {
  el.detailTabs.innerHTML = '';
  for (const agent of uniqueAgentsForDisplay([...state.agents.values()])) {
    const tab = document.createElement('div');
    tab.className = `detail-tab${agent.id === state.activeAgentId ? ' active' : ''}`;
    tab.dataset.id = agent.id;
    tab.textContent = getAgentDisplayName(agent).toUpperCase();
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
  if (!id) return;
  state.activeAgentId = id;
  const agent = state.agents.get(id);
  if (!agent) return;

  // Update header
  const statusLabel = agent.status === 'online' ? 'READY' : agent.status.toUpperCase();
  const displayName = getAgentDisplayName(agent);
  el.activeAgentLabel.textContent = `${displayName.toUpperCase()} — ${statusLabel}`;
  el.chatInput.placeholder = `שלח הנחיה אל ${displayName} — התשובה תופיע כאן במרכז`;

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
      <div class="detail-label">${isLlmAgent(agent) ? 'LLM' : 'AGENT'}</div>
      <div class="detail-value">${escHtml(getAgentDisplayName(agent))}</div>
    </div>
    <div class="detail-block">
      <div class="detail-label">STATUS</div>
      <div class="detail-value ${statusClass}">${agent.status.toUpperCase()}</div>
    </div>
    <div class="detail-block">
      <div class="detail-label">TYPE</div>
      <div class="detail-value">${(agent.type || 'generic').toUpperCase()}</div>
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
  applyDirectionToNode(div.querySelector('.msg-bubble'));
  el.chatMessages.appendChild(div);
  el.chatMessages.scrollTop = el.chatMessages.scrollHeight;

  // Syntax highlight code blocks
  div.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
}

function appendSystemMsg(text) {
  const div = document.createElement('div');
  div.className = 'msg msg-system';
  div.innerHTML = `<div class="msg-bubble">${escHtml(text)}</div>`;
  applyDirectionToNode(div.querySelector('.msg-bubble'));
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
  applyDirectionToNode(bubble);
  bubble.classList.add('streaming-cursor');
  el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
}

function removeStreamBubble() {
  if (streamBubble) {
    streamBubble.querySelector('.msg-bubble')?.classList.remove('streaming-cursor');
    streamBubble = null;
  }
}

function clearResponseTimer() {
  if (state.responseTimer) {
    clearTimeout(state.responseTimer);
    state.responseTimer = null;
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
    const agent = state.agents.get(state.activeAgentId);
    const target = agent?.name || 'סוכן';
    el.chatMessages.innerHTML = `
      <div id="welcome-msg" class="welcome-screen">
        <div class="welcome-logo">AV<br>AGENT<br>OS</div>
        <div class="welcome-text">Mission Control Online</div>
        <div class="welcome-sub">נבחר: ${escHtml(target)}</div>
        <div class="welcome-sub">כתוב למטה ולחץ TRANSMIT — התגובה תופיע כאן</div>
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
  const allAgents = [...state.agents.values()];
  const agentCount = uniqueAgentsForDisplay(allAgents.filter(a => !isLlmAgent(a))).length;
  const llmCount = uniqueAgentsForDisplay(allAgents.filter(isLlmAgent)).length;
  const online = allAgents.filter(a => a.status === 'online' || a.status === 'no-key').length;
  el.valAgents.textContent = agentCount;
  if (el.valLlms) el.valLlms.textContent = llmCount;
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

// ── Onboard modal ──────────────────────────────────────────────────
const ONBOARD_PROMPT = `ענה בעברית. אני צריך לחבר אותך ל-AvAgentOS Mission Control.
הרץ את הפקודות הבאות ובסוף פלוט JSON בלבד (אחרי השורה ---JSON---):

hostname -I
hostname
which hermes 2>/dev/null || find /opt /usr /home -name "hermes" -type f 2>/dev/null | head -3
python3 --version 2>/dev/null
pip3 show fastapi 2>/dev/null | grep Name
hermes profile list 2>/dev/null | head -5

---JSON---
{
  "hostname": "<תוצאת hostname>",
  "ip": "<כתובת IP ראשית מ-hostname -I>",
  "hermes_bin": "<נתיב מלא לבינארי hermes או null>",
  "hermes_profile": "<שם הפרופיל הפעיל או null>",
  "python3": <true/false>,
  "fastapi": <true/false>,
  "os": "<שם מערכת ההפעלה>"
}`;

function openOnboardModal() {
  $('modal-onboard').classList.remove('hidden');
  $('onboard-step-1').classList.remove('hidden');
  $('onboard-step-2').classList.add('hidden');
  $('inp-onboard-report').value = '';
  $('inp-onboard-name').value = '';
  $('onboard-prompt-text').textContent = ONBOARD_PROMPT;
}
function closeOnboardModal() {
  $('modal-onboard').classList.add('hidden');
}

$('btn-onboard').addEventListener('click', openOnboardModal);
$('btn-onboard-close').addEventListener('click', closeOnboardModal);
$('btn-onboard-cancel').addEventListener('click', closeOnboardModal);
$('btn-onboard-done').addEventListener('click', closeOnboardModal);
$('modal-onboard').addEventListener('click', e => { if (e.target === $('modal-onboard')) closeOnboardModal(); });

$('btn-copy-prompt').addEventListener('click', () => {
  navigator.clipboard.writeText(ONBOARD_PROMPT).then(() => {
    $('btn-copy-prompt').textContent = '✅ הועתק!';
    setTimeout(() => { $('btn-copy-prompt').textContent = '📋 העתק פרומפט'; }, 2000);
  });
});

$('btn-onboard-submit').addEventListener('click', async () => {
  const report = $('inp-onboard-report').value.trim();
  const name   = $('inp-onboard-name').value.trim();
  if (!report) { alert('הדבק את תשובת הסוכן תחילה'); return; }

  $('btn-onboard-submit').textContent = '⏳ מנתח...';
  $('btn-onboard-submit').disabled = true;

  try {
    const res  = await fetch('/api/onboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ report, name }),
    });
    const data = await res.json();

    const resultEl = $('onboard-result');
    if (!data.ok) {
      resultEl.innerHTML = `<div class="onboard-error">❌ ${data.error}</div>`;
    } else {
      const d = data.detected;
      const steps = data.setupSteps.map(s => `<li>${s.replace(/\n/g,'<br>')}</li>`).join('');
      resultEl.innerHTML = `
        <div class="onboard-success">
          <div class="onboard-row">✅ IP זוהה: <strong>${d.ip}</strong></div>
          <div class="onboard-row">🖥 שם מחשב: <strong>${d.hostname || '—'}</strong></div>
          <div class="onboard-row">⚡ Hermes: <strong>${d.hermesBin || '—'}</strong></div>
          <div class="onboard-row">🐍 Python3: <strong>${d.hasPython ? '✅' : '❌'}</strong>
            &nbsp; FastAPI: <strong>${d.hasFastAPI ? '✅' : '❌'}</strong></div>
          <div class="onboard-row">📡 אסטרטגיה: <strong>${data.strategy === 'direct' ? 'חיבור ישיר' : 'Bridge נדרש'}</strong></div>
          ${data.online
            ? '<div class="onboard-online">🟢 הסוכן כבר ONLINE!</div>'
            : data.setupSteps.length
              ? `<div class="onboard-steps"><strong>צעדים להשלמת החיבור:</strong><ol>${steps}</ol></div>`
              : '<div class="onboard-online">🟢 סוכן נוסף לדשבורד!</div>'
          }
          ${data.bridgeEntry ? `<details><summary>Bridge config entry</summary><pre>${JSON.stringify(data.bridgeEntry,null,2)}</pre></details>` : ''}
        </div>`;
    }

    $('onboard-step-1').classList.add('hidden');
    $('onboard-step-2').classList.remove('hidden');
  } catch (err) {
    alert('שגיאה: ' + err.message);
  } finally {
    $('btn-onboard-submit').textContent = '⚡ חבר אוטומטית';
    $('btn-onboard-submit').disabled = false;
  }
});

// ── Display controls ────────────────────────────────────────────────
function clampFontSize(size) {
  return Math.max(11, Math.min(24, Number(size) || 13));
}

function setChatFontSize(size) {
  state.display.fontSize = clampFontSize(size);
  document.documentElement.style.setProperty('--chat-font-size', `${state.display.fontSize}px`);
  localStorage.setItem('avagentos.chatFontSize', String(state.display.fontSize));
  if (el.fontSizeLabel) el.fontSizeLabel.textContent = `${state.display.fontSize}px`;
}

function applyDirectionToNode(node) {
  if (!node) return;
  const dir = state.display.textDir;
  if (dir === 'rtl' || dir === 'ltr') node.setAttribute('dir', dir);
  else node.setAttribute('dir', 'auto');
}

function setTextDirection(dir) {
  state.display.textDir = ['rtl', 'ltr', 'auto'].includes(dir) ? dir : 'auto';
  localStorage.setItem('avagentos.textDir', state.display.textDir);
  document.body.classList.toggle('text-dir-rtl', state.display.textDir === 'rtl');
  document.body.classList.toggle('text-dir-ltr', state.display.textDir === 'ltr');
  document.body.classList.toggle('text-dir-auto', state.display.textDir === 'auto');
  applyDirectionToNode(el.chatInput);
  document.querySelectorAll('.msg-bubble, #prp-content').forEach(applyDirectionToNode);
  ['rtl', 'ltr', 'auto'].forEach(mode => {
    document.getElementById(`btn-dir-${mode}`)?.classList.toggle('active', state.display.textDir === mode);
  });
}

function initDisplayControls() {
  setChatFontSize(state.display.fontSize);
  setTextDirection(state.display.textDir);
  $('btn-font-dec')?.addEventListener('click', () => setChatFontSize(state.display.fontSize - 1));
  $('btn-font-inc')?.addEventListener('click', () => setChatFontSize(state.display.fontSize + 1));
  $('btn-font-reset')?.addEventListener('click', () => setChatFontSize(13));
  $('btn-dir-rtl')?.addEventListener('click', () => setTextDirection('rtl'));
  $('btn-dir-ltr')?.addEventListener('click', () => setTextDirection('ltr'));
  $('btn-dir-auto')?.addEventListener('click', () => setTextDirection('auto'));
}

initDisplayControls();

// ── Input handling ─────────────────────────────────────────────────
el.chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
el.chatInput.addEventListener('input', () => {
  el.chatInput.style.height = 'auto';
  el.chatInput.style.height = Math.min(el.chatInput.scrollHeight, 88) + 'px';
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
function isLlmAgent(agent) {
  if (!agent) return false;
  return LLM_TYPES.has(String(agent.type || '').toLowerCase()) || agent.category === 'llm' || agent.kind === 'llm';
}

function getAgentDisplayName(agent) {
  if (!agent) return '';
  return String(
    agent.nickname ||
    agent.alias ||
    agent.display_name ||
    agent.displayName ||
    agent.config?.nickname ||
    agent.config?.alias ||
    agent.name ||
    agent.id ||
    'Agent'
  ).trim();
}

function getAgentDisplayKey(agent) {
  return `${isLlmAgent(agent) ? 'llm' : 'agent'}:${getAgentDisplayName(agent).toLowerCase()}`;
}

function uniqueAgentsForDisplay(agents) {
  const seen = new Set();
  const unique = [];
  for (const agent of agents) {
    const key = getAgentDisplayKey(agent);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(agent);
  }
  return unique;
}

function appendAgentOptions(selectEl, label, agents, selectedId) {
  const list = uniqueAgentsForDisplay(agents);
  if (!list.length) return;
  const group = document.createElement('optgroup');
  group.label = label;
  for (const agent of list) {
    const opt = document.createElement('option');
    opt.value = agent.id;
    opt.textContent = getAgentDisplayName(agent);
    if (selectedId === agent.id) opt.selected = true;
    group.appendChild(opt);
  }
  selectEl.appendChild(group);
}

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

// ── View switching (Mission Control ↔ Projects) ────────────────────
const viewNav = document.getElementById('view-nav');
const mainGrid = document.getElementById('main-grid');
const projectsView = document.getElementById('projects-view');
const agentDetail = document.getElementById('agent-detail');

viewNav?.querySelectorAll('.view-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    viewNav.querySelectorAll('.view-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const view = btn.dataset.view;
    if (view === 'projects') {
      mainGrid.classList.add('hidden');
      agentDetail.classList.add('hidden');
      projectsView.classList.remove('hidden');
      loadProjects();
    } else {
      mainGrid.classList.remove('hidden');
      agentDetail.classList.remove('hidden');
      projectsView.classList.add('hidden');
    }
  });
});

// ── Projects ───────────────────────────────────────────────────────
const projState = { projects: [] };

async function loadProjects() {
  const res = await fetch('/api/projects');
  projState.projects = await res.json();
  renderProjects();
}

function renderProjects() {
  const tbody = document.getElementById('projects-tbody');
  const empty = document.getElementById('projects-empty');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!projState.projects.length) {
    empty?.classList.remove('hidden');
    return;
  }
  empty?.classList.add('hidden');
  for (const p of projState.projects) {
    const agent = state.agents.get(p.assigned_agent_id);
    const agentName = agent ? escHtml(agent.name) : '<span style="color:var(--text-muted)">—</span>';
    const updated = p.updated_at ? new Date(p.updated_at).toLocaleDateString('he-IL') : '—';
    const statusClass = { active: 'status-active', in_progress: 'status-inprog', blocked: 'status-blocked', done: 'status-done', archived: 'status-archived' }[p.status] || '';
    const tr = document.createElement('tr');
    tr.dataset.id = p.id;
    tr.innerHTML = `
      <td><div class="proj-name">${escHtml(p.display_name || p.name)}</div><div class="proj-id">${escHtml(p.name)}</div></td>
      <td>${agentName}</td>
      <td><span class="proj-phase">${escHtml(p.phase || '—')}</span></td>
      <td><span class="proj-status ${statusClass}">${escHtml(p.status || '—')}</span></td>
      <td>${updated}</td>
      <td class="proj-actions">
        <button class="proj-btn btn-ask" data-id="${p.id}" title="שאל את הסוכן">🔄 Ask</button>
        <button class="proj-btn btn-edit" data-id="${p.id}" title="ערוך">✏️</button>
        <button class="proj-btn btn-del danger" data-id="${p.id}" title="מחק">✕</button>
      </td>
    `;
    tr.querySelector('.btn-ask').addEventListener('click', () => askAgent(p.id));
    tr.querySelector('.btn-edit').addEventListener('click', () => openProjectModal(p));
    tr.querySelector('.btn-del').addEventListener('click', () => deleteProject(p.id));
    tbody.appendChild(tr);
  }
}

async function askAgent(projectId) {
  const btn = document.querySelector(`.btn-ask[data-id="${projectId}"]`);
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
  try {
    const res = await fetch(`/api/projects/${projectId}/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    const data = await res.json();
    if (data.ok) {
      showResponsePanel(data.project?.display_name || projectId, data.response);
      // Update local state
      const idx = projState.projects.findIndex(p => p.id === projectId);
      if (idx >= 0) projState.projects[idx] = data.project;
      renderProjects();
    } else {
      showResponsePanel('שגיאה', data.error || 'Unknown error');
    }
  } catch (err) {
    showResponsePanel('שגיאה', err.message);
  } finally {
    if (btn) { btn.textContent = '🔄 Ask'; btn.disabled = false; }
  }
}

function showResponsePanel(title, content) {
  const panel = document.getElementById('project-response-panel');
  document.getElementById('prp-title').textContent = title;
  const contentEl = document.getElementById('prp-content');
  contentEl.innerHTML = renderMarkdown(content);
  applyDirectionToNode(contentEl);
  panel?.classList.remove('hidden');
  panel?.scrollIntoView({ behavior: 'smooth' });
}

document.getElementById('btn-prp-close')?.addEventListener('click', () => {
  document.getElementById('project-response-panel')?.classList.add('hidden');
});

async function deleteProject(id) {
  const p = projState.projects.find(x => x.id === id);
  if (!confirm(`מחק פרויקט "${p?.display_name || id}"?`)) return;
  await fetch(`/api/projects/${id}`, { method: 'DELETE' });
  projState.projects = projState.projects.filter(x => x.id !== id);
  renderProjects();
}

// ── Project modal ──────────────────────────────────────────────────
function openProjectModal(project = null) {
  const modal = document.getElementById('modal-project');
  document.getElementById('project-modal-title').textContent = project ? 'EDIT PROJECT' : 'NEW PROJECT';
  document.getElementById('inp-proj-id').value = project?.id || '';
  document.getElementById('inp-proj-name').value = project?.name || '';
  document.getElementById('inp-proj-display').value = project?.display_name || '';
  document.getElementById('inp-proj-phase').value = project?.phase || '';
  document.getElementById('inp-proj-desc').value = project?.description || '';

  // Populate agent dropdown. Keep real agents and LLMs separate, both selectable.
  const sel = document.getElementById('inp-proj-agent');
  sel.innerHTML = '<option value="">— ללא —</option>';
  const allSelectableAgents = [...state.agents.values()];
  appendAgentOptions(sel, 'AGENTS', allSelectableAgents.filter(a => !isLlmAgent(a)), project?.assigned_agent_id);
  appendAgentOptions(sel, 'LLMS', allSelectableAgents.filter(isLlmAgent), project?.assigned_agent_id);

  const statusSel = document.getElementById('inp-proj-status');
  if (project?.status) statusSel.value = project.status;

  modal?.classList.remove('hidden');
  document.getElementById('inp-proj-name').focus();
}

function closeProjectModal() {
  document.getElementById('modal-project')?.classList.add('hidden');
  document.getElementById('form-project')?.reset();
}

document.getElementById('btn-new-project')?.addEventListener('click', () => openProjectModal());
document.getElementById('btn-project-modal-close')?.addEventListener('click', closeProjectModal);
document.getElementById('btn-project-cancel')?.addEventListener('click', closeProjectModal);
document.getElementById('modal-project')?.addEventListener('click', e => { if (e.target.id === 'modal-project') closeProjectModal(); });

document.getElementById('form-project')?.addEventListener('submit', async e => {
  e.preventDefault();
  const id = document.getElementById('inp-proj-id').value;
  const body = {
    name: document.getElementById('inp-proj-name').value.trim(),
    display_name: document.getElementById('inp-proj-display').value.trim(),
    assigned_agent_id: document.getElementById('inp-proj-agent').value || null,
    phase: document.getElementById('inp-proj-phase').value.trim(),
    status: document.getElementById('inp-proj-status').value,
    description: document.getElementById('inp-proj-desc').value.trim(),
  };
  if (!body.display_name) body.display_name = body.name;

  const res = await fetch(id ? `/api/projects/${id}` : '/api/projects', {
    method: id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.ok) {
    const proj = await res.json();
    if (id) {
      const idx = projState.projects.findIndex(p => p.id === id);
      if (idx >= 0) projState.projects[idx] = proj; else projState.projects.push(proj);
    } else {
      projState.projects.push(proj);
    }
    renderProjects();
    closeProjectModal();
  } else {
    const err = await res.json();
    alert(err.error || 'Failed to save project');
  }
});

// ── Import from Hermes ─────────────────────────────────────────────
function openImportModal() {
  const modal = document.getElementById('modal-import');
  const sel = document.getElementById('inp-import-agent');
  sel.innerHTML = '';
  for (const agent of state.agents.values()) {
    if (agent.type === 'hermes' && (agent.status === 'online')) {
      const opt = document.createElement('option');
      opt.value = agent.id;
      opt.textContent = agent.name;
      sel.appendChild(opt);
    }
  }
  if (!sel.options.length) {
    sel.innerHTML = '<option value="">אין סוכני Hermes מחוברים</option>';
  }
  document.getElementById('import-status').textContent = '';
  modal?.classList.remove('hidden');
}

function closeImportModal() {
  document.getElementById('modal-import')?.classList.add('hidden');
}

document.getElementById('btn-import-projects')?.addEventListener('click', openImportModal);
document.getElementById('btn-import-close')?.addEventListener('click', closeImportModal);
document.getElementById('btn-import-cancel')?.addEventListener('click', closeImportModal);

document.getElementById('btn-import-run')?.addEventListener('click', async () => {
  const agentId = document.getElementById('inp-import-agent').value;
  const query = document.getElementById('inp-import-query').value.trim();
  const statusEl = document.getElementById('import-status');
  const btn = document.getElementById('btn-import-run');
  if (!agentId) { alert('בחר סוכן'); return; }

  btn.disabled = true; btn.textContent = '⏳ מייבא...';
  statusEl.textContent = 'שולח שאילתה לסוכן...';

  try {
    // Create a temp project just to use the query endpoint — or call agent directly
    const res = await fetch(`/api/projects/import-query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, query }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    // Try to parse JSON from response
    const text = data.response;
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('לא נמצא JSON בתגובה. תגובת הסוכן:\n' + text.substring(0, 300));

    const items = JSON.parse(jsonMatch[0]);
    let added = 0;
    for (const item of items) {
      if (!item.name) continue;
      const body = { name: item.name, display_name: item.display_name || item.name, phase: item.phase || '', description: item.description || '', assigned_agent_id: agentId, status: item.status || 'active' };
      const r = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (r.ok) { const p = await r.json(); projState.projects.push(p); added++; }
    }
    statusEl.textContent = `✅ יובאו ${added} פרויקטים`;
    renderProjects();
    setTimeout(closeImportModal, 2000);
  } catch (err) {
    statusEl.textContent = '❌ ' + err.message;
  } finally {
    btn.disabled = false; btn.textContent = '⬇ ייבא';
  }
});

// ── Init ───────────────────────────────────────────────────────────
addLog('AvAgentOS frontend loaded', 'info');
setBtnSend(false);
el.chatInput.addEventListener('input', () => setBtnSend(!!el.chatInput.value.trim() && !state.streaming));
