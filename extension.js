'use strict';
const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { exec, spawn } = require('child_process');
const { parseResetTime, LIMIT_RE } = require('./parser');

const POLL_MS = 5000;
let timer = null;        // timeout dell'invio programmato
let pollTimer = null;
let status;
let scheduledAt = null;
let target = null;       // { sessionId, cwd } della sessione che ha colpito il limite
const offsets = new Map(); // file -> byte già letti
let startedAt = Date.now();

const cfg = () => vscode.workspace.getConfiguration('claudeAutoContinue');

function activate(ctx) {
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = 'claudeAutoContinue.toggle';
  ctx.subscriptions.push(status);

  ctx.subscriptions.push(
    vscode.commands.registerCommand('claudeAutoContinue.toggle', async () => {
      await cfg().update('enabled', !cfg().get('enabled'), vscode.ConfigurationTarget.Global);
      refreshStatus();
    }),
    vscode.commands.registerCommand('claudeAutoContinue.listCommands', async () => {
      const all = (await vscode.commands.getCommands(true)).filter(c => /claude|anthropic/i.test(c)).sort();
      const doc = await vscode.workspace.openTextDocument({ content: all.join('\n') || '(nessun comando trovato)', language: 'plaintext' });
      vscode.window.showTextDocument(doc);
    }),
    vscode.commands.registerCommand('claudeAutoContinue.sendNow', () => inject()),
    vscode.commands.registerCommand('claudeAutoContinue.cancel', () => { clearSchedule(); refreshStatus(); }),
    vscode.commands.registerCommand('claudeAutoContinue.scheduleAt', async () => {
      const v = await vscode.window.showInputBox({ prompt: 'Orario di reset (HH:MM, 24h)', placeHolder: '15:05',
        validateInput: s => /^\d{1,2}:\d{2}$/.test(s) ? null : 'Formato HH:MM' });
      if (!v) return;
      const [h, m] = v.split(':').map(Number);
      const t = new Date(); t.setHours(h, m, 0, 0);
      if (t <= new Date()) t.setDate(t.getDate() + 1);
      schedule(t);
    }),
    vscode.workspace.onDidChangeConfiguration(e => e.affectsConfiguration('claudeAutoContinue') && refreshStatus()),
  );

  pollTimer = setInterval(poll, POLL_MS);
  ctx.subscriptions.push({ dispose: () => { clearInterval(pollTimer); clearSchedule(); } });
  refreshStatus();
}

function refreshStatus() {
  if (!cfg().get('enabled')) { status.text = '$(debug-pause) Auto-continua: off'; status.tooltip = 'Clic per attivare'; }
  else if (scheduledAt) {
    status.text = `$(clock) Continua alle ${scheduledAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    status.tooltip = 'Invio programmato. Clic per disattivare.';
  } else { status.text = '$(play-circle) Auto-continua'; status.tooltip = 'In ascolto del limite di Claude Code. Clic per disattivare.'; }
  status.show();
}

function clearSchedule() { if (timer) clearTimeout(timer); timer = null; scheduledAt = null; }

function schedule(resetAt) {
  clearSchedule();
  const at = new Date(resetAt.getTime() + cfg().get('delaySeconds', 60) * 1000);
  scheduledAt = at;
  // setTimeout non regge >24.8 giorni; i limiti sono di ore, ma ricontrolliamo se il PC va in sospensione.
  const tick = () => {
    const left = at.getTime() - Date.now();
    if (left <= 0) { clearSchedule(); inject(); target = null; refreshStatus(); return; }
    timer = setTimeout(tick, Math.min(left, 30000));
  };
  tick();
  refreshStatus();
  vscode.window.setStatusBarMessage(`Claude Auto Continue: invio alle ${at.toLocaleTimeString()}`, 5000);
}

function transcriptsRoot() {
  return cfg().get('transcriptsDir') || path.join(os.homedir(), '.claude', 'projects');
}

function recentJsonl(root) {
  const out = [];
  let dirs;
  try { dirs = fs.readdirSync(root, { withFileTypes: true }); } catch { return out; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dir = path.join(root, d.name);
    let files; try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const p = path.join(dir, f);
      try { const st = fs.statSync(p); if (Date.now() - st.mtimeMs < 6 * 3600e3) out.push({ p, size: st.size }); } catch {}
    }
  }
  return out;
}

function poll() {
  if (!cfg().get('enabled')) return;
  for (const { p, size } of recentJsonl(transcriptsRoot())) {
    // Al primo avvistamento leggiamo solo la coda (ultimi 64KB), così recuperiamo un limite appena colpito.
    let from = offsets.has(p) ? offsets.get(p) : Math.max(0, size - 65536);
    if (size < from) from = 0;
    if (size === from) { offsets.set(p, size); continue; }
    let chunk = '';
    try {
      const fd = fs.openSync(p, 'r');
      const buf = Buffer.alloc(size - from);
      fs.readSync(fd, buf, 0, buf.length, from);
      fs.closeSync(fd);
      chunk = buf.toString('utf8');
    } catch { continue; }
    offsets.set(p, size);
    for (const line of chunk.split('\n')) handleLine(line, p);
  }
}

function handleLine(line, file) {
  if (!line || !LIMIT_RE.test(line)) return;
  let rec; try { rec = JSON.parse(line); } catch { return; }
  const msg = rec && rec.message;
  if (!msg) return;
  const content = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: String(msg.content || '') }];
  const text = content.filter(c => c && c.type === 'text').map(c => c.text).join('\n');
  const ref = rec.timestamp ? new Date(rec.timestamp) : new Date();
  const reset = parseResetTime(text, ref);
  if (!reset || reset.getTime() + 120000 < Date.now()) return; // già passato
  if (scheduledAt && Math.abs(scheduledAt.getTime() - reset.getTime() - cfg().get('delaySeconds', 60) * 1000) < 1000) return;
  target = { sessionId: rec.sessionId || path.basename(file, '.jsonl'), cwd: rec.cwd };
  schedule(reset);
}

// Sessione che ha colpito il limite; in mancanza (invio manuale) la più recente su disco.
function currentTarget() {
  if (target) return target;
  let best;
  for (const f of recentJsonl(transcriptsRoot())) {
    try { const m = fs.statSync(f.p).mtimeMs; if (!best || m > best.m) best = { m, p: f.p }; } catch {}
  }
  return best ? { sessionId: path.basename(best.p, '.jsonl') } : null;
}

// Comandi che l'estensione Claude Code potrebbe esporre per portare il focus sul pannello (barra laterale inclusa).
// 'Open in Side Bar' viene prima: 'Focus Input' (Ctrl+Esc) è un toggle editor<->Claude e potrebbe togliere il focus invece di darlo.
const FOCUS_CANDIDATES = ['claude-vscode.sidebar.open', 'claude-vscode.focus'];

async function focusChat() {
  const custom = cfg().get('focusCommand');
  const all = await vscode.commands.getCommands(true);
  const cmd = custom || FOCUS_CANDIDATES.find(c => all.includes(c));
  if (cmd) { await vscode.commands.executeCommand(cmd); return cmd; }
  // Ripiego: porta il focus sulla barra laterale secondaria (destra) dove di norma sta la chat.
  await vscode.commands.executeCommand('workbench.action.focusAuxiliaryBar');
  return 'workbench.action.focusAuxiliaryBar';
}

// Digita il testo e preme Invio a livello di sistema operativo nella finestra/campo con il focus.
function typeCommand(text, ctrlEnter) {
  if (process.platform === 'darwin') {
    const t = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `osascript -e 'tell application "System Events" to keystroke "${t}"' -e 'tell application "System Events" to key code 36${ctrlEnter ? ' using control down' : ''}'`;
  }
  if (process.platform === 'win32') {
    const t = text.replace(/[+^%~(){}\[\]]/g, m => `{${m}}`).replace(/'/g, "''");
    return `powershell -NoProfile -c "(New-Object -ComObject WScript.Shell).SendKeys('${t}${ctrlEnter ? '^{ENTER}' : '{ENTER}'}')"`;
  }
  const t = text.replace(/'/g, `'\\''`);
  return `xdotool type --delay 30 -- '${t}' && xdotool key ${ctrlEnter ? 'ctrl+Return' : 'Return'}`;
}

function inject() {
  const message = cfg().get('message', 'continua');
  const method = cfg().get('method');
  const t = currentTarget();
  if (method === 'terminal') {
    const term = vscode.window.activeTerminal || vscode.window.terminals[0];
    if (!term) { vscode.window.showWarningMessage('Claude Auto Continue: nessun terminale aperto.'); return; }
    term.sendText(message, true);
    return;
  }
  if (method === 'cli') {
    // Riprende esattamente la sessione che ha colpito il limite, senza passare dalla UI.
    if (!t) { vscode.window.showWarningMessage('Claude Auto Continue: sessione non trovata.'); return; }
    const bin = cfg().get('claudePath') || 'claude';
    const cp = spawn(bin, ['--resume', t.sessionId, '-p', message], { cwd: t.cwd && fs.existsSync(t.cwd) ? t.cwd : undefined, shell: process.platform === 'win32' });
    let out = ''; cp.stdout.on('data', d => out += d); cp.stderr.on('data', d => out += d);
    cp.on('error', e => vscode.window.showErrorMessage('claude CLI: ' + e.message));
    cp.on('close', code => vscode.window.showInformationMessage(`Claude Auto Continue (sessione ${t.sessionId.slice(0, 8)}): ${code === 0 ? 'completato' : 'errore ' + code}. ${out.trim().slice(0, 200)}`));
    return;
  }
  // chat: porta il focus sul pannello Claude Code già aperto (barra laterale destra compresa), scrive e invia.
  focusChat().then(used => {
    if (!cfg().get('autoSubmit', true)) { vscode.window.showInformationMessage(`Claude Auto Continue: pannello a fuoco (${used}). Scrivi "${message}" e premi Invio.`); return; }
    const sub = cfg().get('submitCommand') || typeCommand(message, vscode.workspace.getConfiguration('claudeCode').get('useCtrlEnterToSend', false));
    setTimeout(() => exec(sub, err => err && vscode.window.showErrorMessage('Invio automatico fallito: ' + err.message)), cfg().get('submitDelayMs', 1200));
  }, e => vscode.window.showErrorMessage('Focus sul pannello fallito: ' + e.message));
}

function deactivate() { clearSchedule(); clearInterval(pollTimer); }
module.exports = { activate, deactivate };
