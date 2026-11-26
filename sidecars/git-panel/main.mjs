import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkoutBranch,
  commitChanges,
  createTag,
  deleteTag,
  discardFile,
  discoverWorkspaceRepo,
  fetchChanges,
  generateCommitMessage,
  getCommitDetail,
  getDiff,
  getLog,
  getRemoteCommits,
  getStatus,
  listTags,
  loadSettings,
  pullChanges,
  pushChanges,
  pushTag,
  removeIndexLock,
  resetToCommit,
  revertCommit,
  saveAiSettings,
  stageFiles,
  unstageFiles
} from './git-ops.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const UI_INJECT_SOURCE = readFileSync(join(HERE, 'ui-inject.js'), 'utf8');

function devToolsPortFile() {
  if (process.env.ANTIGRAVITY_CDP_PORT_FILE) return process.env.ANTIGRAVITY_CDP_PORT_FILE;
  if (process.platform === 'win32') {
    return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Antigravity', 'DevToolsActivePort');
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort');
  }
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'Antigravity', 'DevToolsActivePort');
}

const HUB_TITLE_RE = /(?:(?:^| - |\(\d+\) )Antigravity(?:\s*(?:\([^)]+\)|\[[^\]]+\]))?|(?:\s|^)(?:\((?:SSH|WSL):\s*[^)]+\)|\[(?:SSH|WSL):\s*[^\]]+\]))$/;
const HUB_PATH_RE = /^\/(?:c\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}|powertools|customizations|automations)(?:\/|$)/;

function isHubTarget(target) {
  try {
    const url = new URL(target.url);
    if (target.type !== 'page' || url.protocol !== 'https:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      return false;
    }
    return HUB_TITLE_RE.test(target.title || '') || HUB_PATH_RE.test(url.pathname);
  } catch {
    return false;
  }
}

function connectCdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const pending = new Map();
    const listeners = new Set();
    let seq = 0;
    const timer = setTimeout(() => { socket.close(); reject(new Error('CDP timeout')); }, 4000);
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP error')); });
    socket.addEventListener('close', () => {
      for (const p of pending.values()) { clearTimeout(p.t); p.reject(new Error('CDP closed')); }
      pending.clear();
    });
    socket.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      const p = pending.get(msg.id);
      if (p) {
        clearTimeout(p.t);
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
      } else {
        for (const fn of listeners) fn(msg);
      }
    });
    socket.addEventListener('open', () => {
      clearTimeout(timer);
      resolve({
        socket,
        onEvent: (fn) => listeners.add(fn),
        send(method, params = {}) {
          if (socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('CDP closed'));
          return new Promise((res, rej) => {
            const id = ++seq;
            const t = setTimeout(() => { pending.delete(id); rej(new Error(`${method} timeout`)); }, 10000);
            pending.set(id, { resolve: res, reject: rej, t });
            socket.send(JSON.stringify({ id, method, params }));
          });
        }
      });
    });
  });
}

async function handleRpc(method, params = {}) {
  switch (method) {
    case 'discover': return discoverWorkspaceRepo(params.hint, params.conversationId);
    case 'status': return getStatus(params.repo);
    case 'diff': return getDiff(params.repo, params.file, Boolean(params.staged));
    case 'stage': return stageFiles(params.repo, params.files);
    case 'unstage': return unstageFiles(params.repo, params.files);
    case 'discard': return discardFile(params.repo, params.file, params.status);
    case 'commit': return commitChanges(params.repo, params.message, Boolean(params.amend));
    case 'push': return pushChanges(params.repo, Boolean(params.setUpstream));
    case 'pull': return pullChanges(params.repo);
    case 'fetch': return fetchChanges(params.repo);
    case 'checkout': return checkoutBranch(params.repo, params.branch, Boolean(params.create));
    case 'log': return getLog(params.repo, params.limit);
    case 'remoteCommits': return getRemoteCommits(params.repo, Boolean(params.doFetch), params.limit);
    case 'commitDetail': return getCommitDetail(params.repo, params.hash);
    case 'reset': return resetToCommit(params.repo, params.hash, params.mode);
    case 'revert': return revertCommit(params.repo, params.hash);
    case 'tags': return listTags(params.repo);
    case 'createTag': return createTag(params.repo, params.name, params.message, params.target, Boolean(params.pushAfter));
    case 'pushTag': return pushTag(params.repo, params.name);
    case 'deleteTag': return deleteTag(params.repo, params.name);
    case 'removeIndexLock': return removeIndexLock(params.repo);
    case 'generateCommitMsg': return generateCommitMessage(params.repo);
    case 'getAiSettings': return loadSettings().ai;
    case 'saveAiSettings': return saveAiSettings(params.ai);
    default: throw new Error(`未知操作: ${method}`);
  }
}

const clients = new Map();
let cdpConnected = false;
let everConnected = false;
let missingPortPolls = 0;

const DATA_DIR = join(homedir(), '.gemini', 'antigravity', 'plugin_data', 'agy-git');
const RELAUNCH_STATE_FILE = join(DATA_DIR, 'relaunch-state.json');

function readRelaunchState() {
  try {
    if (existsSync(RELAUNCH_STATE_FILE)) return JSON.parse(readFileSync(RELAUNCH_STATE_FILE, 'utf8'));
  } catch {}
  return {};
}

function writeRelaunchState(state) {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(RELAUNCH_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch {}
}

function recordCdpReady() {
  const prev = readRelaunchState();
  if (prev.consecutiveAutoRelaunches) {
    writeRelaunchState({ ...prev, consecutiveAutoRelaunches: 0 });
  }
}

function maybeAutoRelaunchMac() {
  if (process.platform !== 'darwin' || everConnected) return;
  if (!process.env.ANTIGRAVITY_LS_ADDRESS || process.env.ELECTRON_OZONE_PLATFORM_HINT === 'headless') return;
  const now = Date.now();
  const state = readRelaunchState();
  if (state.lastLsAddress === process.env.ANTIGRAVITY_LS_ADDRESS) return;
  if (state.lastAt && now - state.lastAt < 60000) return;
  if ((state.consecutiveAutoRelaunches || 0) >= 2) return;

  const appCandidates = ['/Applications/Antigravity.app', join(homedir(), 'Applications', 'Antigravity.app')];
  const appPath = appCandidates.find(p => existsSync(p));
  if (!appPath) return;

  writeRelaunchState({
    ...state,
    lastAt: now,
    lastLsAddress: process.env.ANTIGRAVITY_LS_ADDRESS,
    consecutiveAutoRelaunches: (state.consecutiveAutoRelaunches || 0) + 1
  });

  const script = `osascript -e 'tell application "Antigravity" to quit' >/dev/null 2>&1 || true; for i in $(seq 1 20); do pgrep -x Antigravity >/dev/null 2>&1 || break; sleep 0.25; done; open -a ${JSON.stringify(appPath)} --args --remote-debugging-port=0`;
  const child = spawn('/bin/sh', ['-c', script], { detached: true, stdio: 'ignore' });
  child.unref();
}

async function attachTarget(target) {
  const client = await connectCdp(target.webSocketDebuggerUrl);
  const origin = new URL(target.url).origin;
  await client.send('Runtime.enable');
  await client.send('Runtime.addBinding', { name: '__agyGitHost' });

  client.onEvent(async (ev) => {
    if (ev.method !== 'Runtime.bindingCalled' || ev.params?.name !== '__agyGitHost') return;
    let req;
    try { req = JSON.parse(ev.params.payload); } catch { return; }
    if (!Number.isInteger(req.id)) return;
    try {
      const data = await handleRpc(req.method, req.params);
      await client.send('Runtime.evaluate', {
        expression: `globalThis.__agyGitResolve?.(${req.id}, true, ${JSON.stringify(data)})`
      });
    } catch (err) {
      await client.send('Runtime.evaluate', {
        expression: `globalThis.__agyGitResolve?.(${req.id}, false, ${JSON.stringify(err.message || '执行失败')})`
      });
    }
  });

  await client.send('Runtime.evaluate', { expression: UI_INJECT_SOURCE });
  clients.set(target.id, { client, origin, wsUrl: target.webSocketDebuggerUrl });
  cdpConnected = true;
  everConnected = true;
  missingPortPolls = 0;
  recordCdpReady();
}

async function pollCdp() {
  try {
    const port = Number(readFileSync(devToolsPortFile(), 'utf8').split('\n')[0]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return;
    const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return;
    const targets = await res.json();
    const hubs = Array.isArray(targets) ? targets.filter(isHubTarget) : [];
    const activeIds = new Set(hubs.map(t => t.id));
    for (const [id, entry] of clients) {
      if (!activeIds.has(id)) {
        try { entry.client.socket.close(); } catch {}
        clients.delete(id);
      }
    }
    for (const target of hubs) {
      const existing = clients.get(target.id);
      if (existing && existing.wsUrl !== target.webSocketDebuggerUrl) {
        try { existing.client.socket.close(); } catch {}
        clients.delete(target.id);
      }
      if (!clients.has(target.id)) {
        try { await attachTarget(target); } catch {}
      } else {
        try {
          const chk = await clients.get(target.id).client.send('Runtime.evaluate', {
            expression: `Boolean(globalThis.__agyGit?.version === '1.5.0')`,
            returnByValue: true
          });
          if (chk?.result?.value !== true) {
            await clients.get(target.id).client.send('Runtime.evaluate', { expression: UI_INJECT_SOURCE });
          }
        } catch {
          try { clients.get(target.id)?.client.socket.close(); } catch {}
          clients.delete(target.id);
        }
      }
    }
  } catch {
    cdpConnected = clients.size > 0;
    if (!everConnected && !clients.size) {
      missingPortPolls++;
      if (missingPortPolls >= 2) maybeAutoRelaunchMac();
    }
  }
}

setInterval(pollCdp, 4000);
void pollCdp();

// Minimal Web UI for Sidecar Aux Pane (Extensions -> Git Control)
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html>
<html><head><meta charset="utf-8"><title>Git Control</title>
<style>body{font-family:-apple-system,sans-serif;background:#18181b;color:#f4f4f5;padding:16px;font-size:13px;line-height:1.5}
.card{border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:14px;background:rgba(255,255,255,0.03)}
code{background:rgba(255,255,255,0.08);padding:2px 6px;border-radius:4px}</style></head>
<body><div class="card">
<h3 style="margin:0 0 8px 0">Git Control (v1.0.0)</h3>
<p style="margin:0 0 8px 0">CDP 状态：<b>${cdpConnected ? '已连接，右上角标题栏已挂载 Git 按钮' : '等待 Antigravity 调试端口连接（重启 Antigravity 后自动生效）'}</b></p>
<p style="margin:0;opacity:0.75">请点击窗口右上角标题栏中的 <code>Git</code> 按钮打开快捷面板，进行暂存、取消暂存、查看 Diff、编写提交消息、提交与 Push。</p>
</div></body></html>`);
});

const port = Number(process.env.SIDECAR_PORT || process.env.PORT || 0);
server.listen(port, '127.0.0.1');
