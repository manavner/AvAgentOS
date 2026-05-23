/**
 * AvAgentOS — Obsidian Memory Module
 * Reads/writes markdown files from an Obsidian vault.
 * Injects shared context into all agent system prompts.
 */
const fs   = require('fs');
const path = require('path');

class ObsidianMemory {
  constructor(vaultPath, folderName = 'AvAgentOS') {
    this.vaultPath  = vaultPath ? vaultPath.trim() : null;
    this.folderName = folderName;
    this.memPath    = this.vaultPath ? path.join(this.vaultPath, folderName) : null;
    this.notes      = new Map();   // relPath → { content, modified }
    this.lastSync   = null;
    this.connected  = false;
  }

  get isConfigured() {
    return !!(this.vaultPath && fs.existsSync(this.vaultPath));
  }

  // ── Init ──────────────────────────────────────────────────────
  async init() {
    if (!this.isConfigured) return false;

    // Create AvAgentOS folder in vault if needed
    if (!fs.existsSync(this.memPath)) {
      fs.mkdirSync(this.memPath, { recursive: true });
      fs.mkdirSync(path.join(this.memPath, 'agents'),        { recursive: true });
      fs.mkdirSync(path.join(this.memPath, 'conversations'), { recursive: true });

      // Seed initial shared context
      this._write('shared-context.md', `# Shared Memory — AvAgentOS

This file is **automatically injected** into every agent (Claude, Gemini, Hermes, etc.).
Edit it inside Obsidian to give all agents shared knowledge.

## About This System
- AvAgentOS Mission Control — local AI command center
- Running on Windows at http://localhost:3131
- Built-in agents: Claude (claude-opus-4-7), Gemini (gemini-3.5-flash)

## My LAN Agents
- [Add your Hermes agent IPs here]
- [Add OpenClaw endpoint here]

## Shared Knowledge
[Write anything all agents should always know]

## Current Projects
[List active projects here]
`);
      this._write('agents/claude.md',  `# Claude — Personal Memory\n\nAgent-specific notes for Claude.\n`);
      this._write('agents/gemini.md',  `# Gemini — Personal Memory\n\nAgent-specific notes for Gemini.\n`);
    }

    await this.sync();
    this.connected = true;
    return true;
  }

  // ── Sync vault → memory store ─────────────────────────────────
  async sync() {
    if (!this.isConfigured) return false;
    try {
      this.notes.clear();
      this._readDir(this.memPath, '');
      this.lastSync = Date.now();
      return true;
    } catch (err) {
      console.error('[Memory] Sync error:', err.message);
      return false;
    }
  }

  _readDir(dir, prefix) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel  = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        this._readDir(full, rel);
      } else if (entry.name.endsWith('.md')) {
        try {
          const content  = fs.readFileSync(full, 'utf-8');
          const modified = fs.statSync(full).mtime;
          this.notes.set(rel, { content, modified, path: full });
        } catch {}
      }
    }
  }

  // ── Context building ──────────────────────────────────────────
  /** Returns the context string to append to any agent's system prompt */
  buildContextForAgent(agentId) {
    const parts = [];

    const shared = this.notes.get('shared-context.md');
    if (shared?.content) parts.push(`## Shared Memory\n${shared.content}`);

    const agentNote = this.notes.get(`agents/${agentId}.md`);
    if (agentNote?.content) parts.push(`## ${agentId} Memory\n${agentNote.content}`);

    if (!parts.length) return '';
    return `\n\n---\n# Obsidian Memory (live from vault)\n${parts.join('\n\n')}`;
  }

  // ── Write helpers ─────────────────────────────────────────────
  _write(relPath, content) {
    const full = path.join(this.memPath, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
    this.notes.set(relPath, { content, modified: new Date(), path: full });
  }

  writeNote(relPath, content) {
    if (!this.isConfigured) return false;
    try { this._write(relPath, content); return true; }
    catch (err) { console.error('[Memory] Write error:', err.message); return false; }
  }

  appendToNote(relPath, content) {
    const existing = this.notes.get(relPath)?.content || `# ${path.basename(relPath, '.md')}\n\n`;
    return this.writeNote(relPath, existing + content);
  }

  // ── Save conversation ─────────────────────────────────────────
  saveConversation(agentId, messages) {
    if (!this.isConfigured || !messages.length) return false;
    const date = new Date().toISOString().split('T')[0];
    const time = new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    const file = `conversations/${date}-${agentId}.md`;

    let block = `\n## ${time}\n\n`;
    for (const m of messages.slice(-30)) {
      block += m.role === 'user'
        ? `**אתה:** ${m.content}\n\n`
        : `**${agentId}:** ${m.content}\n\n`;
    }
    block += '---\n';

    return this.appendToNote(file, block);
  }

  // ── Read / list ───────────────────────────────────────────────
  getNoteContent(relPath) {
    return this.notes.get(relPath)?.content || null;
  }

  listNotes() {
    return [...this.notes.entries()].map(([name, data]) => ({
      name,
      size: data.content.length,
      modified: data.modified,
      preview: data.content.replace(/#+\s*/g, '').replace(/\n+/g, ' ').substring(0, 80),
    }));
  }

  getStatus() {
    return {
      connected:  this.connected && this.isConfigured,
      vaultPath:  this.vaultPath,
      memPath:    this.memPath,
      folderName: this.folderName,
      noteCount:  this.notes.size,
      lastSync:   this.lastSync,
    };
  }
}

module.exports = ObsidianMemory;
