(() => {
  if (globalThis.__agyGit?.version === '1.6.0') return;
  try { globalThis.__agyGit?.dispose?.(); } catch {}

  const STYLE_ID = 'agy-git-styles';
  const TRIGGER_ID = 'agy-git-titlebar-trigger';
  const POPOVER_ID = 'agy-git-popover';

  let seq = 0;
  const pending = new Map();
  globalThis.__agyGitResolve = (id, ok, payload) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    clearTimeout(p.timer);
    if (ok) p.resolve(payload);
    else p.reject(new Error(typeof payload === 'string' ? payload : '请求失败'));
  };

  function callHost(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (typeof globalThis.__agyGitHost !== 'function') {
        reject(new Error('Git 后台服务未连接'));
        return;
      }
      const id = ++seq;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('操作超时'));
      }, 65000);
      pending.set(id, { resolve, reject, timer });
      try {
        globalThis.__agyGitHost(JSON.stringify({ id, method, params }));
      } catch (err) {
        pending.delete(id);
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  function currentConversationId() {
    const m = location.pathname.match(/^\/c\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : '';
  }

  const state = {
    open: false,
    tab: 'changes', // 'changes' | 'history' | 'tags'
    repo: localStorage.getItem('agy-git-repo') || '',
    lastConvoId: currentConversationId(),
    manualRepoOverride: false,
    recentRepos: [],
    status: null,
    logs: [],
    historyView: 'local', // 'local' | 'remote'
    remoteInfo: { upstream: '', incoming: [], remoteLog: [] },
    tags: [],
    commitMsg: '',
    loading: false,
    busyAction: '',
    error: '',
    toast: '',
    diffTarget: null, // { path, staged, text }
    selectedCommit: null, // { hash, shortHash, detail }
    confirmReset: null, // { hash, shortHash, mode }
    tagForm: { name: '', message: '', target: 'HEAD', pushAfter: true },
    showRepoInput: false,
    showBranchInput: false,
    showAiSettings: false,
    showCreateRemote: false,
    nonGitWorkspace: '',
    remoteForm: { name: '', visibility: 'private', description: '', url: '' },
    aiSettings: { baseUrl: '', apiKey: '', model: '', language: 'zh-CN', scope: 'all' },
    newBranchName: '',
    confirmDiscard: ''
  };

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${TRIGGER_ID} {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        height: 26px;
        padding: 0 8px;
        margin-right: 4px;
        border-radius: 6px;
        border: 1px solid rgba(128, 128, 128, 0.22);
        background: rgba(128, 128, 128, 0.08);
        color: inherit;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        user-select: none;
        transition: background 0.15s ease, border-color 0.15s ease;
        -webkit-app-region: no-drag;
      }
      #${TRIGGER_ID}:hover {
        background: rgba(128, 128, 128, 0.16);
        border-color: rgba(128, 128, 128, 0.38);
      }
      #${TRIGGER_ID} .agy-git-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 16px;
        height: 16px;
        padding: 0 4px;
        border-radius: 999px;
        background: #2563eb;
        color: #fff;
        font-size: 10px;
        font-weight: 600;
        line-height: 1;
      }
      #${POPOVER_ID} {
        position: fixed;
        top: 42px;
        right: 14px;
        width: 440px;
        max-height: calc(100vh - 64px);
        display: flex;
        flex-direction: column;
        border-radius: 12px;
        border: 1px solid rgba(128, 128, 128, 0.25);
        background: var(--vscode-editorWidget-background, #18181b);
        color: var(--vscode-foreground, #f4f4f5);
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
        z-index: 99999;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 12.5px;
        overflow: hidden;
      }
      #${POPOVER_ID}.agy-light {
        background: #ffffff;
        color: #18181b;
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.14);
      }
      #${POPOVER_ID} * { box-sizing: border-box; }
      .agy-git-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 12px;
        border-bottom: 1px solid rgba(128, 128, 128, 0.18);
        gap: 8px;
      }
      .agy-git-title-group {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        flex: 1;
      }
      .agy-git-repo-name {
        font-weight: 600;
        font-size: 13px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        cursor: pointer;
      }
      .agy-git-branch-pill {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 7px;
        border-radius: 999px;
        background: rgba(56, 189, 248, 0.14);
        color: #38bdf8;
        font-size: 11px;
        font-weight: 500;
        cursor: pointer;
        flex-shrink: 0;
      }
      #${POPOVER_ID}.agy-light .agy-git-branch-pill {
        background: rgba(37, 99, 235, 0.1);
        color: #2563eb;
      }
      .agy-git-icon-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 24px;
        padding: 0 7px;
        border-radius: 6px;
        border: 1px solid transparent;
        background: transparent;
        color: inherit;
        font-size: 11.5px;
        cursor: pointer;
        opacity: 0.82;
      }
      .agy-git-icon-btn:hover {
        background: rgba(128, 128, 128, 0.15);
        opacity: 1;
      }
      .agy-git-toolbar {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        border-bottom: 1px solid rgba(128, 128, 128, 0.14);
      }
      .agy-git-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        height: 26px;
        padding: 0 9px;
        border-radius: 6px;
        border: 1px solid rgba(128, 128, 128, 0.24);
        background: rgba(128, 128, 128, 0.08);
        color: inherit;
        font-size: 11.5px;
        font-weight: 500;
        cursor: pointer;
      }
      .agy-git-btn:hover:not(:disabled) {
        background: rgba(128, 128, 128, 0.18);
      }
      .agy-git-btn:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
      .agy-git-btn-primary {
        background: #2563eb;
        border-color: #2563eb;
        color: #fff;
      }
      .agy-git-btn-primary:hover:not(:disabled) {
        background: #1d4ed8;
      }
      .agy-git-body {
        overflow-y: auto;
        padding: 10px 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        flex: 1;
      }
      .agy-git-input, .agy-git-textarea {
        width: 100%;
        border-radius: 7px;
        border: 1px solid rgba(128, 128, 128, 0.28);
        background: rgba(128, 128, 128, 0.07);
        color: inherit;
        font-family: inherit;
        font-size: 12px;
        padding: 7px 9px;
        outline: none;
      }
      .agy-git-input:focus, .agy-git-textarea:focus {
        border-color: #3b82f6;
      }
      .agy-git-textarea {
        resize: vertical;
        min-height: 58px;
        line-height: 1.4;
      }
      .agy-git-commit-actions {
        display: flex;
        gap: 6px;
        margin-top: 6px;
      }
      .agy-git-section-hdr {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        opacity: 0.72;
        margin-bottom: 4px;
      }
      .agy-git-file-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .agy-git-file-row {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 6px;
        border-radius: 6px;
        cursor: pointer;
      }
      .agy-git-file-row:hover {
        background: rgba(128, 128, 128, 0.12);
      }
      .agy-git-file-status {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px;
        font-weight: 700;
        width: 16px;
        text-align: center;
        flex-shrink: 0;
      }
      .agy-git-st-M { color: #f59e0b; }
      .agy-git-st-A { color: #22c55e; }
      .agy-git-st-D { color: #ef4444; }
      .agy-git-st-Q { color: #38bdf8; }
      .agy-git-file-name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 12px;
      }
      .agy-git-file-actions {
        display: flex;
        align-items: center;
        gap: 2px;
        flex-shrink: 0;
      }
      .agy-git-diff-box {
        border-radius: 7px;
        border: 1px solid rgba(128, 128, 128, 0.22);
        background: rgba(0, 0, 0, 0.22);
        padding: 8px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px;
        line-height: 1.45;
        max-height: 190px;
        overflow: auto;
        white-space: pre;
      }
      #${POPOVER_ID}.agy-light .agy-git-diff-box {
        background: #f4f4f5;
      }
      .agy-git-msg-err {
        padding: 6px 9px;
        border-radius: 6px;
        background: rgba(239, 68, 68, 0.14);
        color: #f87171;
        font-size: 11.5px;
        word-break: break-word;
      }
      .agy-git-msg-ok {
        padding: 6px 9px;
        border-radius: 6px;
        background: rgba(34, 197, 94, 0.14);
        color: #4ade80;
        font-size: 11.5px;
        word-break: break-word;
      }
      #${POPOVER_ID}.agy-light .agy-git-msg-ok { color: #16a34a; }
      #${POPOVER_ID}.agy-light .agy-git-msg-err { color: #dc2626; }
      .agy-git-tabs {
        display: flex;
        padding: 0 12px;
        gap: 4px;
        border-bottom: 1px solid rgba(128, 128, 128, 0.16);
      }
      .agy-git-tab {
        padding: 7px 10px;
        font-size: 12px;
        font-weight: 500;
        border: none;
        border-bottom: 2px solid transparent;
        background: transparent;
        color: inherit;
        opacity: 0.65;
        cursor: pointer;
      }
      .agy-git-tab:hover { opacity: 0.95; }
      .agy-git-tab.active {
        opacity: 1;
        border-bottom-color: #3b82f6;
        font-weight: 600;
      }
      .agy-git-commit-item {
        padding: 7px 8px;
        border-radius: 7px;
        border: 1px solid rgba(128, 128, 128, 0.16);
        background: rgba(128, 128, 128, 0.04);
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .agy-git-commit-item:hover {
        background: rgba(128, 128, 128, 0.09);
      }
      .agy-git-hash {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px;
        padding: 1px 5px;
        border-radius: 4px;
        background: rgba(128, 128, 128, 0.16);
      }
      .agy-git-ref-pill {
        font-size: 10px;
        padding: 1px 5px;
        border-radius: 4px;
        background: rgba(56, 189, 248, 0.14);
        color: #38bdf8;
      }
      #${POPOVER_ID}.agy-light .agy-git-ref-pill {
        background: rgba(37, 99, 235, 0.1);
        color: #2563eb;
      }
    `;
    document.head.appendChild(style);
  }

  function isLightTheme() {
    const bg = getComputedStyle(document.body).backgroundColor || '';
    const m = bg.match(/\d+/g);
    if (!m) return false;
    const lum = (Number(m[0]) * 299 + Number(m[1]) * 587 + Number(m[2]) * 114) / 1000;
    return lum > 140;
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  function renderTrigger() {
    const anchor = document.querySelector('[data-testid="titlebar-more-actions"]');
    if (!anchor || !anchor.parentElement) return;
    let btn = document.getElementById(TRIGGER_ID);
    if (!btn) {
      btn = document.createElement('button');
      btn.id = TRIGGER_ID;
      btn.type = 'button';
      btn.title = 'Git Control (暂存 / 提交 / Push)';
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        state.open = !state.open;
        renderPopover();
        if (state.open) await refreshStatus();
      });
      anchor.parentElement.insertBefore(btn, anchor);
    }
    const st = state.status;
    const branchText = st?.branch ? st.branch : 'Git';
    const totalChanges = st ? (st.staged.length + st.unstaged.length) : 0;
    const renderKey = `${branchText}:${totalChanges}`;
    if (btn.dataset.renderKey === renderKey) return;
    btn.dataset.renderKey = renderKey;
    btn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
        <line x1="6" y1="3" x2="6" y2="15"></line>
        <circle cx="18" cy="6" r="3"></circle>
        <circle cx="6" cy="18" r="3"></circle>
        <path d="M18 9a9 9 0 0 1-9 9"></path>
      </svg>
      <span style="max-width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(branchText)}</span>
      ${totalChanges > 0 ? `<span class="agy-git-badge">${totalChanges}</span>` : ''}
    `;
  }

  function setToast(msg) {
    state.toast = msg;
    state.error = '';
    renderPopover();
    setTimeout(() => {
      if (state.toast === msg) {
        state.toast = '';
        renderPopover();
      }
    }, 3500);
  }

  async function refreshStatus(repoOverride) {
    const convoId = currentConversationId();
    const convoChanged = convoId && convoId !== state.lastConvoId;
    if (convoChanged) {
      state.lastConvoId = convoId;
      state.manualRepoOverride = false;
    }

    const shouldAutoDiscover = !repoOverride && (!state.repo || (convoChanged && !state.manualRepoOverride));
    if (shouldAutoDiscover) {
      try {
        const hint = (document.title || '').split(' - ')[0] || '';
        const res = await callHost('discover', { hint, conversationId: convoId });
        state.recentRepos = res.recentRepos || [];
        if (res.repo) {
          state.repo = res.repo;
          state.nonGitWorkspace = '';
          localStorage.setItem('agy-git-repo', res.repo);
          state.showRepoInput = false;
        } else if (res.nonGitWorkspace) {
          state.nonGitWorkspace = res.nonGitWorkspace;
          state.repo = res.nonGitWorkspace;
          state.status = null;
          state.showRepoInput = false;
          renderTrigger();
          renderPopover();
          return;
        } else if (!state.repo) {
          state.showRepoInput = true;
          renderPopover();
          return;
        }
      } catch (err) {
        if (!state.repo) {
          state.error = err.message;
          renderPopover();
          return;
        }
      }
    }
    state.loading = true;
    renderPopover();
    try {
      const st = await callHost('status', { repo: repoOverride || state.repo });
      state.status = st;
      state.nonGitWorkspace = '';
      state.repo = st.root;
      localStorage.setItem('agy-git-repo', st.root);
      state.error = '';
      if (state.open && state.tab === 'history') {
        if (state.historyView === 'remote') {
          state.remoteInfo = await callHost('remoteCommits', { repo: st.root, doFetch: false, limit: 30 });
        } else {
          state.logs = await callHost('log', { repo: st.root, limit: 50 });
        }
      } else if (state.open && state.tab === 'tags') {
        state.tags = await callHost('tags', { repo: st.root });
      }
    } catch (err) {
      state.error = err.message;
      state.status = null;
      state.showRepoInput = true;
    } finally {
      state.loading = false;
      renderTrigger();
      renderPopover();
    }
  }

  async function runAction(label, fn, { silent = false } = {}) {
    if (!silent) {
      state.busyAction = label;
      state.error = '';
      renderPopover();
    } else {
      state.error = '';
    }
    try {
      await fn();
    } catch (err) {
      state.error = err.message;
    } finally {
      state.busyAction = '';
      renderTrigger();
      renderPopover();
    }
  }

  function renderFileRow(item, isStaged) {
    const cls = item.status === '?' ? 'Q' : (['M', 'A', 'D'].includes(item.status) ? item.status : 'M');
    const confirming = !isStaged && state.confirmDiscard === item.path;
    return `
      <div class="agy-git-file-row" data-diff-path="${escapeHtml(item.path)}" data-diff-staged="${isStaged ? '1' : '0'}">
        <span class="agy-git-file-status agy-git-st-${cls}">${escapeHtml(item.status)}</span>
        <span class="agy-git-file-name" title="${escapeHtml(item.path)}">${escapeHtml(item.path)}</span>
        <div class="agy-git-file-actions">
          ${!isStaged ? (
            confirming
              ? `<button class="agy-git-icon-btn" style="color:#ef4444;opacity:1;" data-discard-confirm="${escapeHtml(item.path)}" data-discard-status="${escapeHtml(item.status)}" title="确认放弃更改">确认</button>
                 <button class="agy-git-icon-btn" data-discard-cancel="1" title="取消">取消</button>`
              : `<button class="agy-git-icon-btn" data-discard-ask="${escapeHtml(item.path)}" title="放弃更改">↺</button>`
          ) : ''}
          ${isStaged
            ? `<button class="agy-git-icon-btn" data-unstage="${escapeHtml(item.path)}" title="取消暂存">−</button>`
            : `<button class="agy-git-icon-btn" data-stage="${escapeHtml(item.path)}" title="暂存">+</button>`}
        </div>
      </div>
    `;
  }

  function renderPopover() {
    let pop = document.getElementById(POPOVER_ID);
    if (!state.open) {
      if (pop) pop.remove();
      return;
    }
    if (!pop) {
      pop = document.createElement('div');
      pop.id = POPOVER_ID;
      pop.addEventListener('click', (e) => e.stopPropagation());
      document.body.appendChild(pop);
    }
    pop.className = isLightTheme() ? 'agy-light' : '';
    const prevBodyScrollTop = pop.querySelector('.agy-git-body')?.scrollTop || 0;

    const st = state.status;
    const repoLabel = st?.root ? st.root.split('/').filter(Boolean).pop() : (state.repo ? state.repo.split('/').filter(Boolean).pop() : '选择仓库');
    const busy = Boolean(state.busyAction);

    pop.innerHTML = `
      <div class="agy-git-header">
        <div class="agy-git-title-group">
          <span class="agy-git-repo-name" id="agy-git-toggle-repo" title="${escapeHtml(state.repo || '点击切换仓库')}">${escapeHtml(repoLabel)} ▾</span>
          ${st ? `<span class="agy-git-branch-pill" id="agy-git-toggle-branch" title="点击切换或新建分支">${escapeHtml(st.branch)}${st.ahead ? ` ↑${st.ahead}` : ''}${st.behind ? ` ↓${st.behind}` : ''}</span>` : ''}
        </div>
        <div style="display:flex;gap:2px;">
          <button class="agy-git-icon-btn" id="agy-git-refresh" title="刷新">${state.loading ? '…' : '↻'}</button>
          <button class="agy-git-icon-btn" id="agy-git-close" title="关闭">✕</button>
        </div>
      </div>

      ${state.showRepoInput ? `
        <div style="padding:8px 12px;border-bottom:1px solid rgba(128,128,128,0.14);display:flex;flex-direction:column;gap:6px;">
          <div style="display:flex;gap:6px;">
            <input class="agy-git-input" id="agy-git-repo-input" placeholder="输入本地 Git 仓库路径，如 ~/projects/demo" value="${escapeHtml(state.repo)}" />
            <button class="agy-git-btn agy-git-btn-primary" id="agy-git-repo-apply">打开</button>
          </div>
          ${state.recentRepos.length ? `
            <div style="display:flex;flex-wrap:wrap;gap:4px;">
              ${state.recentRepos.slice(0, 5).map(r => `<button class="agy-git-icon-btn" data-pick-repo="${escapeHtml(r)}" style="border:1px solid rgba(128,128,128,0.2);">${escapeHtml(r.split('/').filter(Boolean).pop() || r)}</button>`).join('')}
            </div>
          ` : ''}
        </div>
      ` : ''}

      ${state.showBranchInput && st ? `
        <div style="padding:8px 12px;border-bottom:1px solid rgba(128,128,128,0.14);display:flex;flex-direction:column;gap:6px;">
          <div style="display:flex;gap:6px;">
            <input class="agy-git-input" id="agy-git-branch-input" placeholder="新分支名称..." value="${escapeHtml(state.newBranchName)}" />
            <button class="agy-git-btn agy-git-btn-primary" id="agy-git-branch-create">新建并切换</button>
          </div>
          ${st.branches?.length ? `
            <div style="display:flex;flex-wrap:wrap;gap:4px;max-height:76px;overflow:auto;">
              ${st.branches.map(b => `<button class="agy-git-icon-btn" data-checkout="${escapeHtml(b)}" style="border:1px solid rgba(128,128,128,0.2);${b === st.branch ? 'font-weight:700;border-color:#3b82f6;' : ''}">${escapeHtml(b)}</button>`).join('')}
            </div>
          ` : ''}
        </div>
      ` : ''}

      ${st ? `
        <div class="agy-git-toolbar">
          <button class="agy-git-btn" id="agy-git-pull" ${busy ? 'disabled' : ''}>↓ Pull</button>
          <button class="agy-git-btn agy-git-btn-primary" id="agy-git-push" ${busy ? 'disabled' : ''}>↑ Push${st.ahead ? ` (${st.ahead})` : ''}</button>
          <button class="agy-git-btn" id="agy-git-fetch" ${busy ? 'disabled' : ''}>Fetch</button>
          ${!st.hasOrigin ? `<button class="agy-git-icon-btn" id="agy-git-open-remote" title="创建或绑定远程仓库">+ 远程</button>` : ''}
          <span style="margin-left:auto;font-size:11px;opacity:0.65;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px;" title="${escapeHtml(st.lastCommit)}">${escapeHtml(st.lastCommit)}</span>
        </div>
        ${state.showCreateRemote ? `
          <div style="padding:10px 12px;border-bottom:1px solid rgba(128,128,128,0.16);background:rgba(128,128,128,0.05);display:flex;flex-direction:column;gap:6px;">
            <div style="display:flex;align-items:center;justify-content:space-between;">
              <span style="font-weight:600;font-size:12px;">创建 GitHub 仓库并推送</span>
              <button class="agy-git-icon-btn" id="agy-git-close-remote">✕</button>
            </div>
            <div style="display:flex;gap:6px;">
              <input class="agy-git-input" id="agy-git-gh-name" placeholder="仓库名称" value="${escapeHtml(state.remoteForm.name || repoLabel)}" />
              <select class="agy-git-input" style="width:96px;" id="agy-git-gh-vis">
                <option value="private" ${state.remoteForm.visibility !== 'public' ? 'selected' : ''}>Private</option>
                <option value="public" ${state.remoteForm.visibility === 'public' ? 'selected' : ''}>Public</option>
              </select>
            </div>
            <input class="agy-git-input" id="agy-git-gh-desc" placeholder="仓库描述（可选）" value="${escapeHtml(state.remoteForm.description)}" />
            <div style="display:flex;justify-content:flex-end;">
              <button class="agy-git-btn agy-git-btn-primary" id="agy-git-gh-create" ${busy ? 'disabled' : ''}>创建 GitHub 仓库并 Push</button>
            </div>
            <div style="border-top:1px dashed rgba(128,128,128,0.22);padding-top:6px;display:flex;gap:6px;align-items:center;">
              <input class="agy-git-input" id="agy-git-remote-url" placeholder="或绑定已有远程 URL (https://... / git@...)" value="${escapeHtml(state.remoteForm.url)}" />
              <button class="agy-git-btn" id="agy-git-remote-bind" ${busy ? 'disabled' : ''}>绑定并 Push</button>
            </div>
          </div>
        ` : ''}
        <div class="agy-git-tabs">
          <button class="agy-git-tab ${state.tab === 'changes' ? 'active' : ''}" data-tab="changes">变更 (${st.staged.length + st.unstaged.length})</button>
          <button class="agy-git-tab ${state.tab === 'history' ? 'active' : ''}" data-tab="history">历史</button>
          <button class="agy-git-tab ${state.tab === 'tags' ? 'active' : ''}" data-tab="tags">Tag${state.tags.length ? ` (${state.tags.length})` : ''}</button>
        </div>
      ` : ''}

      <div class="agy-git-body">
        ${state.error ? `
          <div class="agy-git-msg-err" style="display:flex;flex-direction:column;gap:6px;">
            <div>${escapeHtml(state.error)}</div>
            ${/index\.lock/i.test(state.error) ? `<div><button class="agy-git-btn" style="background:#ef4444;border-color:#ef4444;color:#fff;" id="agy-git-remove-lock" ${busy ? 'disabled' : ''}>🗑 一键删除 index.lock</button></div>` : ''}
          </div>
        ` : ''}
        ${state.toast ? `<div class="agy-git-msg-ok">${escapeHtml(state.toast)}</div>` : ''}
        ${state.busyAction ? `<div style="font-size:11.5px;opacity:0.75;">正在执行: ${escapeHtml(state.busyAction)}...</div>` : ''}

        ${st && state.tab === 'changes' ? `
          <div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
              <span style="font-size:11px;opacity:0.7;">提交消息</span>
              <div style="display:flex;gap:4px;">
                <button class="agy-git-icon-btn" id="agy-git-toggle-ai-cfg" title="配置 AI 接口">⚙ AI 设置</button>
                <button class="agy-git-btn" style="height:22px;padding:0 8px;font-size:11px;" id="agy-git-ai-gen" ${busy || (!st.staged.length && !st.unstaged.length) ? 'disabled' : ''}>✨ AI 生成</button>
              </div>
            </div>
            ${state.showAiSettings ? `
              <div style="padding:8px;margin-bottom:6px;border-radius:7px;border:1px solid rgba(128,128,128,0.22);background:rgba(128,128,128,0.05);display:flex;flex-direction:column;gap:5px;">
                <div style="font-size:11px;opacity:0.75;">AI 提交消息设置（支持 /v1/responses、/chat/completions 与 /messages）</div>
                <div style="display:flex;gap:5px;">
                  <select class="agy-git-input" id="agy-git-ai-lang" title="提交消息语言">
                    <option value="zh-CN" ${state.aiSettings.language === 'zh-CN' ? 'selected' : ''}>语言：简体中文</option>
                    <option value="en" ${state.aiSettings.language === 'en' ? 'selected' : ''}>语言：English</option>
                    <option value="zh-TW" ${state.aiSettings.language === 'zh-TW' ? 'selected' : ''}>语言：繁體中文</option>
                    <option value="ja" ${state.aiSettings.language === 'ja' ? 'selected' : ''}>语言：日本語</option>
                    <option value="auto" ${state.aiSettings.language === 'auto' ? 'selected' : ''}>语言：自动匹配</option>
                  </select>
                  <select class="agy-git-input" id="agy-git-ai-scope" title="分析改动范围">
                    <option value="all" ${state.aiSettings.scope !== 'staged' ? 'selected' : ''}>范围：全部改动</option>
                    <option value="staged" ${state.aiSettings.scope === 'staged' ? 'selected' : ''}>范围：仅已暂存改动</option>
                  </select>
                </div>
                <input class="agy-git-input" id="agy-git-ai-url" placeholder="Base URL，如 https://api.openai.com/v1" value="${escapeHtml(state.aiSettings.baseUrl)}" />
                <div style="display:flex;gap:5px;">
                  <input class="agy-git-input" type="password" id="agy-git-ai-key" placeholder="API Key（本地 Ollama 可留空）" value="${escapeHtml(state.aiSettings.apiKey)}" />
                  <input class="agy-git-input" style="width:120px;" id="agy-git-ai-model" placeholder="模型名" value="${escapeHtml(state.aiSettings.model)}" />
                </div>
                <div style="display:flex;justify-content:flex-end;gap:5px;">
                  <button class="agy-git-btn" id="agy-git-ai-cancel">取消</button>
                  <button class="agy-git-btn agy-git-btn-primary" id="agy-git-ai-save">保存</button>
                </div>
              </div>
            ` : ''}
            <textarea class="agy-git-textarea" id="agy-git-commit-msg" placeholder="输入提交消息，或点击右上角「✨ AI 生成」..." ${busy ? 'disabled' : ''}>${escapeHtml(state.commitMsg)}</textarea>
            <div class="agy-git-commit-actions">
              <button class="agy-git-btn agy-git-btn-primary" style="flex:1;" id="agy-git-commit" ${busy || !st.staged.length ? 'disabled' : ''}>提交已暂存 (${st.staged.length})</button>
              <button class="agy-git-btn" id="agy-git-commit-push" ${busy || !st.staged.length ? 'disabled' : ''}>提交并 Push</button>
            </div>
          </div>

          <div>
            <div class="agy-git-section-hdr">
              <span>已暂存的更改 (${st.staged.length})</span>
              ${st.staged.length ? `<button class="agy-git-icon-btn" id="agy-git-unstage-all" ${busy ? 'disabled' : ''}>全部取消暂存</button>` : ''}
            </div>
            <div class="agy-git-file-list">
              ${st.staged.length ? st.staged.map(f => renderFileRow(f, true)).join('') : '<div style="font-size:11.5px;opacity:0.5;padding:2px 4px;">暂无已暂存文件</div>'}
            </div>
          </div>

          <div>
            <div class="agy-git-section-hdr">
              <span>未暂存的更改 (${st.unstaged.length})</span>
              ${st.unstaged.length ? `<button class="agy-git-icon-btn" id="agy-git-stage-all" ${busy ? 'disabled' : ''}>全部暂存</button>` : ''}
            </div>
            <div class="agy-git-file-list">
              ${st.unstaged.length ? st.unstaged.map(f => renderFileRow(f, false)).join('') : '<div style="font-size:11.5px;opacity:0.5;padding:2px 4px;">工作区干净</div>'}
            </div>
          </div>

          ${state.diffTarget ? `
            <div>
              <div class="agy-git-section-hdr">
                <span>Diff: ${escapeHtml(state.diffTarget.path)} (${state.diffTarget.staged ? '已暂存' : '工作区'})</span>
                <button class="agy-git-icon-btn" id="agy-git-close-diff">关闭</button>
              </div>
              <div class="agy-git-diff-box">${escapeHtml(state.diffTarget.text)}</div>
            </div>
          ` : ''}
        ` : ''}

        ${st && state.tab === 'history' ? `
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
            <button class="agy-git-btn ${state.historyView === 'local' ? 'agy-git-btn-primary' : ''}" data-hist-view="local">本地提交</button>
            <button class="agy-git-btn ${state.historyView === 'remote' ? 'agy-git-btn-primary' : ''}" data-hist-view="remote">远程提交${st.behind ? ` (待拉取 ${st.behind})` : ''}</button>
            ${state.historyView === 'remote' ? `<button class="agy-git-icon-btn" style="margin-left:auto;" id="agy-git-remote-fetch" ${busy ? 'disabled' : ''}>↻ 检查远程</button>` : ''}
          </div>
          ${state.confirmReset ? `
            <div class="agy-git-msg-err" style="display:flex;flex-direction:column;gap:6px;">
              <div>确认将当前分支 <b>${escapeHtml(st.branch)}</b> ${state.confirmReset.mode === 'hard' ? '彻底 Hard 回退' : 'Soft 回退'}到 <code>${escapeHtml(state.confirmReset.shortHash)}</code>？${state.confirmReset.mode === 'hard' ? '（未提交的本地修改将被丢弃！）' : '（改动会保留在暂存区）'}</div>
              <div style="display:flex;gap:6px;">
                <button class="agy-git-btn" style="background:#ef4444;border-color:#ef4444;color:#fff;" id="agy-git-reset-confirm" ${busy ? 'disabled' : ''}>确认回退</button>
                <button class="agy-git-btn" id="agy-git-reset-cancel">取消</button>
              </div>
            </div>
          ` : ''}
          ${state.selectedCommit ? `
            <div>
              <div class="agy-git-section-hdr">
                <span>提交详情: ${escapeHtml(state.selectedCommit.shortHash)}</span>
                <button class="agy-git-icon-btn" id="agy-git-close-commit">关闭</button>
              </div>
              <div class="agy-git-diff-box">${escapeHtml(state.selectedCommit.detail)}</div>
            </div>
          ` : ''}
          ${state.historyView === 'local' ? `
            <div style="display:flex;flex-direction:column;gap:6px;">
              ${state.logs.length ? state.logs.map(c => `
                <div class="agy-git-commit-item">
                  <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                    <span class="agy-git-hash">${escapeHtml(c.shortHash)}</span>
                    <span style="font-weight:600;flex:1;min-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(c.subject)}">${escapeHtml(c.subject)}</span>
                  </div>
                  ${c.refs.length ? `<div style="display:flex;gap:4px;flex-wrap:wrap;">${c.refs.map(r => `<span class="agy-git-ref-pill">${escapeHtml(r)}</span>`).join('')}</div>` : ''}
                  <div style="display:flex;align-items:center;justify-content:space-between;font-size:11px;opacity:0.72;gap:6px;">
                    <span>${escapeHtml(c.author)} · ${escapeHtml(c.date)}</span>
                    <div style="display:flex;gap:3px;">
                      <button class="agy-git-icon-btn" data-commit-detail="${escapeHtml(c.hash)}" data-commit-short="${escapeHtml(c.shortHash)}" title="查看改动">详情</button>
                      <button class="agy-git-icon-btn" data-commit-tag="${escapeHtml(c.shortHash)}" title="在此提交打 Tag">Tag</button>
                      <button class="agy-git-icon-btn" data-reset-ask="${escapeHtml(c.hash)}" data-reset-short="${escapeHtml(c.shortHash)}" data-reset-mode="soft" title="Soft 回退（保留改动）">Soft</button>
                      <button class="agy-git-icon-btn" style="color:#f87171;" data-reset-ask="${escapeHtml(c.hash)}" data-reset-short="${escapeHtml(c.shortHash)}" data-reset-mode="hard" title="Hard 回退（丢弃未提交改动）">Hard</button>
                      <button class="agy-git-icon-btn" data-revert-hash="${escapeHtml(c.hash)}" title="Revert（生成反向提交）">Revert</button>
                    </div>
                  </div>
                </div>
              `).join('') : '<div style="font-size:12px;opacity:0.6;">暂无提交历史</div>'}
            </div>
          ` : `
            ${!state.remoteInfo.upstream ? `<div style="font-size:12px;opacity:0.65;">当前分支尚未关联远程上游分支（可先执行 Push 建立关联）。</div>` : `
              <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
                <span style="font-size:11.5px;opacity:0.78;">上游分支: <b>${escapeHtml(state.remoteInfo.upstream)}</b></span>
                ${state.remoteInfo.incoming.length ? `<button class="agy-git-btn agy-git-btn-primary" id="agy-git-remote-pull" ${busy ? 'disabled' : ''}>↓ 拉取全部远程提交 (${state.remoteInfo.incoming.length})</button>` : ''}
              </div>
              <div>
                <div class="agy-git-section-hdr"><span>待拉取的远程提交 (${state.remoteInfo.incoming.length})</span></div>
                <div style="display:flex;flex-direction:column;gap:5px;">
                  ${state.remoteInfo.incoming.length ? state.remoteInfo.incoming.map(c => `
                    <div class="agy-git-commit-item">
                      <div style="display:flex;align-items:center;gap:6px;">
                        <span class="agy-git-hash">${escapeHtml(c.shortHash)}</span>
                        <span style="font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(c.subject)}">${escapeHtml(c.subject)}</span>
                      </div>
                      <div style="display:flex;align-items:center;justify-content:space-between;font-size:11px;opacity:0.72;">
                        <span>${escapeHtml(c.author)} · ${escapeHtml(c.date)}</span>
                        <button class="agy-git-icon-btn" data-commit-detail="${escapeHtml(c.hash)}" data-commit-short="${escapeHtml(c.shortHash)}">详情</button>
                      </div>
                    </div>
                  `).join('') : '<div style="font-size:11.5px;opacity:0.55;padding:2px 4px;">本地已与远程同步，无待拉取提交</div>'}
                </div>
              </div>
              <div>
                <div class="agy-git-section-hdr"><span>远程分支最近提交 (${state.remoteInfo.remoteLog.length})</span></div>
                <div style="display:flex;flex-direction:column;gap:5px;">
                  ${state.remoteInfo.remoteLog.map(c => `
                    <div class="agy-git-commit-item">
                      <div style="display:flex;align-items:center;gap:6px;">
                        <span class="agy-git-hash">${escapeHtml(c.shortHash)}</span>
                        <span style="font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(c.subject)}">${escapeHtml(c.subject)}</span>
                      </div>
                      <div style="display:flex;align-items:center;justify-content:space-between;font-size:11px;opacity:0.72;">
                        <span>${escapeHtml(c.author)} · ${escapeHtml(c.date)}</span>
                        <button class="agy-git-icon-btn" data-commit-detail="${escapeHtml(c.hash)}" data-commit-short="${escapeHtml(c.shortHash)}">详情</button>
                      </div>
                    </div>
                  `).join('')}
                </div>
              </div>
            `}
          `}
        ` : ''}

        ${st && state.tab === 'tags' ? `
          <div style="display:flex;flex-direction:column;gap:6px;padding:8px;border-radius:8px;border:1px solid rgba(128,128,128,0.18);background:rgba(128,128,128,0.04);">
            <div style="display:flex;gap:6px;">
              <input class="agy-git-input" id="agy-git-tag-name" placeholder="Tag 名称，如 v1.0.0" value="${escapeHtml(state.tagForm.name)}" />
              <input class="agy-git-input" style="width:92px;" id="agy-git-tag-target" placeholder="HEAD" value="${escapeHtml(state.tagForm.target)}" title="目标提交（默认 HEAD）" />
            </div>
            <input class="agy-git-input" id="agy-git-tag-msg" placeholder="附注说明（可选，留空为轻量 Tag）" value="${escapeHtml(state.tagForm.message)}" />
            <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
              <label style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;cursor:pointer;">
                <input type="checkbox" id="agy-git-tag-push-after" ${state.tagForm.pushAfter ? 'checked' : ''} />
                创建后立即推送到 origin
              </label>
              <button class="agy-git-btn agy-git-btn-primary" id="agy-git-tag-create" ${busy ? 'disabled' : ''}>创建 Tag</button>
            </div>
          </div>

          <div class="agy-git-section-hdr" style="margin-top:2px;">
            <span>本地 Tags (${state.tags.length})</span>
            ${state.tags.length ? `<button class="agy-git-icon-btn" id="agy-git-tag-push-all" ${busy ? 'disabled' : ''}>推送全部 Tag</button>` : ''}
          </div>
          <div style="display:flex;flex-direction:column;gap:5px;">
            ${state.tags.length ? state.tags.map(t => `
              <div class="agy-git-commit-item" style="flex-direction:row;align-items:center;justify-content:space-between;gap:8px;">
                <div style="min-width:0;flex:1;">
                  <div style="display:flex;align-items:center;gap:6px;">
                    <span style="font-weight:600;">${escapeHtml(t.name)}</span>
                    <span class="agy-git-hash">${escapeHtml(t.hash)}</span>
                    <span style="font-size:11px;opacity:0.6;">${escapeHtml(t.date)}</span>
                  </div>
                  ${t.message ? `<div style="font-size:11px;opacity:0.72;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(t.message)}</div>` : ''}
                </div>
                <div style="display:flex;gap:3px;flex-shrink:0;">
                  <button class="agy-git-icon-btn" data-tag-push="${escapeHtml(t.name)}" ${busy ? 'disabled' : ''}>Push</button>
                  <button class="agy-git-icon-btn" style="color:#f87171;" data-tag-del="${escapeHtml(t.name)}" ${busy ? 'disabled' : ''}>删除</button>
                </div>
              </div>
            `).join('') : '<div style="font-size:12px;opacity:0.55;">暂无本地 Tag</div>'}
          </div>
        ` : ''}

        ${!st ? `
          <div style="display:flex;flex-direction:column;gap:8px;padding:6px 2px;">
            <div style="font-size:12px;opacity:0.8;">${state.nonGitWorkspace || state.repo ? `目录 <code>${escapeHtml(state.nonGitWorkspace || state.repo)}</code> 尚未初始化 Git 仓库。` : '请在上方输入或选择一个本地目录路径。'}</div>
            ${(state.nonGitWorkspace || state.repo) ? `
              <div>
                <button class="agy-git-btn agy-git-btn-primary" id="agy-git-init-repo" ${busy ? 'disabled' : ''}>⚡ 初始化 Git 仓库 (git init)</button>
              </div>
            ` : ''}
          </div>
        ` : ''}
      </div>
    `;

    // Bind events
    pop.querySelector('#agy-git-close')?.addEventListener('click', () => { state.open = false; renderPopover(); });
    pop.querySelector('#agy-git-remove-lock')?.addEventListener('click', () => {
      runAction('删除 index.lock', async () => {
        state.status = await callHost('removeIndexLock', { repo: state.repo });
        state.error = '';
        setToast('已删除 index.lock，请重试刚才的操作');
      });
    });
    pop.querySelector('#agy-git-refresh')?.addEventListener('click', () => refreshStatus());
    pop.querySelector('#agy-git-toggle-repo')?.addEventListener('click', () => { state.showRepoInput = !state.showRepoInput; renderPopover(); });
    pop.querySelector('#agy-git-toggle-branch')?.addEventListener('click', () => { state.showBranchInput = !state.showBranchInput; renderPopover(); });

    const repoInput = pop.querySelector('#agy-git-repo-input');
    pop.querySelector('#agy-git-repo-apply')?.addEventListener('click', () => {
      const v = repoInput?.value?.trim();
      if (v) { state.repo = v; state.manualRepoOverride = true; state.showRepoInput = false; state.diffTarget = null; refreshStatus(v); }
    });
    repoInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') pop.querySelector('#agy-git-repo-apply')?.click();
    });
    pop.querySelectorAll('[data-pick-repo]').forEach(el => {
      el.addEventListener('click', () => {
        const v = el.getAttribute('data-pick-repo');
        state.repo = v;
        state.manualRepoOverride = true;
        state.showRepoInput = false;
        state.diffTarget = null;
        refreshStatus(v);
      });
    });

    const branchInput = pop.querySelector('#agy-git-branch-input');
    branchInput?.addEventListener('input', (e) => { state.newBranchName = e.target.value; });
    pop.querySelector('#agy-git-branch-create')?.addEventListener('click', () => {
      const name = branchInput?.value?.trim();
      if (!name) return;
      runAction('新建分支', async () => {
        state.status = await callHost('checkout', { repo: state.repo, branch: name, create: true });
        state.newBranchName = '';
        state.showBranchInput = false;
        setToast(`已切换到新分支 ${name}`);
      });
    });
    pop.querySelectorAll('[data-checkout]').forEach(el => {
      el.addEventListener('click', () => {
        const b = el.getAttribute('data-checkout');
        runAction('切换分支', async () => {
          state.status = await callHost('checkout', { repo: state.repo, branch: b, create: false });
          state.showBranchInput = false;
          setToast(`已切换到分支 ${b}`);
        });
      });
    });

    const msgArea = pop.querySelector('#agy-git-commit-msg');
    msgArea?.addEventListener('input', (e) => { state.commitMsg = e.target.value; });
    msgArea?.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        pop.querySelector('#agy-git-commit')?.click();
      }
    });

    pop.querySelector('#agy-git-toggle-ai-cfg')?.addEventListener('click', async () => {
      state.showAiSettings = !state.showAiSettings;
      if (state.showAiSettings) {
        try { state.aiSettings = await callHost('getAiSettings'); } catch {}
      }
      renderPopover();
    });
    pop.querySelector('#agy-git-ai-cancel')?.addEventListener('click', () => { state.showAiSettings = false; renderPopover(); });
    pop.querySelector('#agy-git-ai-save')?.addEventListener('click', async () => {
      const next = {
        baseUrl: pop.querySelector('#agy-git-ai-url')?.value || '',
        apiKey: pop.querySelector('#agy-git-ai-key')?.value || '',
        model: pop.querySelector('#agy-git-ai-model')?.value || '',
        language: pop.querySelector('#agy-git-ai-lang')?.value || 'zh-CN',
        scope: pop.querySelector('#agy-git-ai-scope')?.value || 'all'
      };
      try {
        state.aiSettings = await callHost('saveAiSettings', { ai: next });
        state.showAiSettings = false;
        setToast('AI 接口设置已保存');
      } catch (err) {
        state.error = err.message;
        renderPopover();
      }
    });
    pop.querySelector('#agy-git-ai-gen')?.addEventListener('click', () => {
      runAction('AI 生成提交消息', async () => {
        const res = await callHost('generateCommitMsg', { repo: state.repo });
        if (res?.message) {
          state.commitMsg = res.message;
          setToast('已生成提交消息');
        }
      });
    });

    pop.querySelector('#agy-git-stage-all')?.addEventListener('click', () => {
      runAction('全部暂存', async () => { state.status = await callHost('stage', { repo: state.repo, files: [] }); });
    });
    pop.querySelector('#agy-git-unstage-all')?.addEventListener('click', () => {
      runAction('全部取消暂存', async () => { state.status = await callHost('unstage', { repo: state.repo, files: [] }); });
    });

    pop.querySelectorAll('[data-stage]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const file = el.getAttribute('data-stage');
        runAction('暂存', async () => { state.status = await callHost('stage', { repo: state.repo, files: [file] }); }, { silent: true });
      });
    });
    pop.querySelectorAll('[data-unstage]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const file = el.getAttribute('data-unstage');
        runAction('取消暂存', async () => { state.status = await callHost('unstage', { repo: state.repo, files: [file] }); }, { silent: true });
      });
    });
    pop.querySelectorAll('[data-discard-ask]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        state.confirmDiscard = el.getAttribute('data-discard-ask');
        renderPopover();
      });
    });
    pop.querySelectorAll('[data-discard-cancel]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        state.confirmDiscard = '';
        renderPopover();
      });
    });
    pop.querySelectorAll('[data-discard-confirm]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const file = el.getAttribute('data-discard-confirm');
        const stCode = el.getAttribute('data-discard-status');
        state.confirmDiscard = '';
        runAction('放弃更改', async () => { state.status = await callHost('discard', { repo: state.repo, file, status: stCode }); });
      });
    });

    pop.querySelectorAll('[data-diff-path]').forEach(el => {
      el.addEventListener('click', async () => {
        const file = el.getAttribute('data-diff-path');
        const staged = el.getAttribute('data-diff-staged') === '1';
        try {
          const text = await callHost('diff', { repo: state.repo, file, staged });
          state.diffTarget = { path: file, staged, text };
          renderPopover();
        } catch (err) {
          state.error = err.message;
          renderPopover();
        }
      });
    });
    pop.querySelector('#agy-git-close-diff')?.addEventListener('click', () => { state.diffTarget = null; renderPopover(); });

    pop.querySelector('#agy-git-commit')?.addEventListener('click', () => {
      runAction('提交', async () => {
        const res = await callHost('commit', { repo: state.repo, message: state.commitMsg });
        state.status = res.status;
        state.commitMsg = '';
        state.diffTarget = null;
        setToast('提交成功');
      });
    });

    pop.querySelector('#agy-git-init-repo')?.addEventListener('click', () => {
      const targetPath = state.nonGitWorkspace || state.repo;
      if (!targetPath) return;
      runAction('初始化 Git 仓库', async () => {
        state.status = await callHost('initRepo', { path: targetPath });
        state.nonGitWorkspace = '';
        state.repo = state.status.root;
        localStorage.setItem('agy-git-repo', state.status.root);
        setToast('已初始化 Git 仓库');
      });
    });

    pop.querySelector('#agy-git-open-remote')?.addEventListener('click', () => {
      if (!state.remoteForm.name && state.repo) {
        state.remoteForm.name = state.repo.split('/').filter(Boolean).pop() || '';
      }
      state.showCreateRemote = !state.showCreateRemote;
      renderPopover();
    });
    pop.querySelector('#agy-git-close-remote')?.addEventListener('click', () => { state.showCreateRemote = false; renderPopover(); });
    pop.querySelector('#agy-git-gh-name')?.addEventListener('input', (e) => { state.remoteForm.name = e.target.value; });
    pop.querySelector('#agy-git-gh-vis')?.addEventListener('change', (e) => { state.remoteForm.visibility = e.target.value; });
    pop.querySelector('#agy-git-gh-desc')?.addEventListener('input', (e) => { state.remoteForm.description = e.target.value; });
    pop.querySelector('#agy-git-remote-url')?.addEventListener('input', (e) => { state.remoteForm.url = e.target.value; });

    pop.querySelector('#agy-git-gh-create')?.addEventListener('click', () => {
      const repoName = pop.querySelector('#agy-git-gh-name')?.value?.trim() || state.remoteForm.name;
      const visibility = pop.querySelector('#agy-git-gh-vis')?.value || 'private';
      const description = pop.querySelector('#agy-git-gh-desc')?.value || '';
      runAction('创建 GitHub 仓库并推送', async () => {
        const res = await callHost('createGithubRepo', {
          repo: state.repo,
          name: repoName,
          visibility,
          description
        });
        state.status = res.status;
        state.showCreateRemote = false;
        setToast(res.output || '已创建 GitHub 仓库');
      });
    });

    pop.querySelector('#agy-git-remote-bind')?.addEventListener('click', () => {
      const url = pop.querySelector('#agy-git-remote-url')?.value?.trim() || state.remoteForm.url;
      runAction('绑定远程仓库并推送', async () => {
        const res = await callHost('addRemotePush', { repo: state.repo, url });
        state.status = res.status;
        state.showCreateRemote = false;
        state.remoteForm.url = '';
        setToast(res.output || '已绑定远程仓库');
      });
    });

    pop.querySelector('#agy-git-commit-push')?.addEventListener('click', () => {
      runAction('提交并 Push', async () => {
        const cRes = await callHost('commit', { repo: state.repo, message: state.commitMsg });
        state.status = cRes.status;
        state.commitMsg = '';
        state.diffTarget = null;
        if (!cRes.status?.hasOrigin) {
          if (!state.remoteForm.name && state.repo) {
            state.remoteForm.name = state.repo.split('/').filter(Boolean).pop() || '';
          }
          state.showCreateRemote = true;
          setToast('已提交本地代码！当前无远程仓库，请在上方创建或绑定远程仓库');
          return;
        }
        const pRes = await callHost('push', { repo: state.repo });
        state.status = pRes.status;
        setToast('已提交并推送到远程');
      });
    });

    pop.querySelector('#agy-git-push')?.addEventListener('click', () => {
      if (state.status && !state.status.hasOrigin) {
        if (!state.remoteForm.name && state.repo) {
          state.remoteForm.name = state.repo.split('/').filter(Boolean).pop() || '';
        }
        state.showCreateRemote = true;
        state.toast = '当前仓库尚未关联远程仓库，请在此创建 GitHub 仓库或绑定远程 URL';
        renderPopover();
        return;
      }
      runAction('Push', async () => {
        const res = await callHost('push', { repo: state.repo });
        state.status = res.status;
        setToast(res.output || 'Push 成功');
      });
    });
    pop.querySelector('#agy-git-pull')?.addEventListener('click', () => {
      runAction('Pull', async () => {
        const res = await callHost('pull', { repo: state.repo });
        state.status = res.status;
        setToast(res.output || 'Pull 成功');
      });
    });
    pop.querySelector('#agy-git-fetch')?.addEventListener('click', () => {
      runAction('Fetch', async () => {
        const res = await callHost('fetch', { repo: state.repo });
        state.status = res.status;
        setToast(res.output || 'Fetch 完成');
      });
    });

    pop.querySelectorAll('[data-tab]').forEach(el => {
      el.addEventListener('click', async () => {
        const nextTab = el.getAttribute('data-tab');
        state.tab = nextTab;
        renderPopover();
        if (nextTab === 'history' && state.repo) {
          try {
            if (state.historyView === 'remote') {
              state.remoteInfo = await callHost('remoteCommits', { repo: state.repo, doFetch: true, limit: 30 });
              state.status = state.remoteInfo.status;
            } else {
              state.logs = await callHost('log', { repo: state.repo, limit: 50 });
            }
            renderTrigger();
            renderPopover();
          } catch (err) { state.error = err.message; renderPopover(); }
        } else if (nextTab === 'tags' && state.repo) {
          try { state.tags = await callHost('tags', { repo: state.repo }); renderPopover(); } catch (err) { state.error = err.message; renderPopover(); }
        }
      });
    });

    pop.querySelectorAll('[data-hist-view]').forEach(el => {
      el.addEventListener('click', async () => {
        const view = el.getAttribute('data-hist-view');
        state.historyView = view;
        renderPopover();
        if (view === 'remote' && state.repo) {
          runAction('检查远程提交', async () => {
            state.remoteInfo = await callHost('remoteCommits', { repo: state.repo, doFetch: true, limit: 30 });
            state.status = state.remoteInfo.status;
          });
        } else if (view === 'local' && state.repo) {
          try { state.logs = await callHost('log', { repo: state.repo, limit: 50 }); renderPopover(); } catch (err) { state.error = err.message; renderPopover(); }
        }
      });
    });

    pop.querySelector('#agy-git-remote-fetch')?.addEventListener('click', () => {
      runAction('检查远程提交', async () => {
        state.remoteInfo = await callHost('remoteCommits', { repo: state.repo, doFetch: true, limit: 30 });
        state.status = state.remoteInfo.status;
        setToast(`远程同步检查完成（待拉取 ${state.remoteInfo.incoming.length} 条）`);
      });
    });

    pop.querySelector('#agy-git-remote-pull')?.addEventListener('click', () => {
      runAction('拉取远程提交', async () => {
        const res = await callHost('pull', { repo: state.repo });
        state.status = res.status;
        state.remoteInfo = await callHost('remoteCommits', { repo: state.repo, doFetch: false, limit: 30 });
        state.logs = await callHost('log', { repo: state.repo, limit: 50 });
        setToast(res.output || '已拉取全部远程提交');
      });
    });

    pop.querySelectorAll('[data-commit-detail]').forEach(el => {
      el.addEventListener('click', async () => {
        const hash = el.getAttribute('data-commit-detail');
        const shortHash = el.getAttribute('data-commit-short');
        try {
          const detail = await callHost('commitDetail', { repo: state.repo, hash });
          state.selectedCommit = { hash, shortHash, detail };
          renderPopover();
        } catch (err) {
          state.error = err.message;
          renderPopover();
        }
      });
    });
    pop.querySelector('#agy-git-close-commit')?.addEventListener('click', () => { state.selectedCommit = null; renderPopover(); });

    pop.querySelectorAll('[data-commit-tag]').forEach(el => {
      el.addEventListener('click', async () => {
        state.tagForm.target = el.getAttribute('data-commit-tag') || 'HEAD';
        state.tab = 'tags';
        renderPopover();
        try { state.tags = await callHost('tags', { repo: state.repo }); renderPopover(); } catch {}
      });
    });

    pop.querySelectorAll('[data-reset-ask]').forEach(el => {
      el.addEventListener('click', () => {
        state.confirmReset = {
          hash: el.getAttribute('data-reset-ask'),
          shortHash: el.getAttribute('data-reset-short'),
          mode: el.getAttribute('data-reset-mode')
        };
        renderPopover();
      });
    });
    pop.querySelector('#agy-git-reset-cancel')?.addEventListener('click', () => { state.confirmReset = null; renderPopover(); });
    pop.querySelector('#agy-git-reset-confirm')?.addEventListener('click', () => {
      const target = state.confirmReset;
      if (!target) return;
      state.confirmReset = null;
      runAction(`回退到 ${target.shortHash}`, async () => {
        state.status = await callHost('reset', { repo: state.repo, hash: target.hash, mode: target.mode });
        state.logs = await callHost('log', { repo: state.repo, limit: 50 });
        setToast(`已 ${target.mode.toUpperCase()} 回退到 ${target.shortHash}`);
      });
    });

    pop.querySelectorAll('[data-revert-hash]').forEach(el => {
      el.addEventListener('click', () => {
        const hash = el.getAttribute('data-revert-hash');
        runAction('Revert 提交', async () => {
          state.status = await callHost('revert', { repo: state.repo, hash });
          state.logs = await callHost('log', { repo: state.repo, limit: 50 });
          setToast('已生成 Revert 反向提交');
        });
      });
    });

    pop.querySelector('#agy-git-tag-name')?.addEventListener('input', (e) => { state.tagForm.name = e.target.value; });
    pop.querySelector('#agy-git-tag-target')?.addEventListener('input', (e) => { state.tagForm.target = e.target.value; });
    pop.querySelector('#agy-git-tag-msg')?.addEventListener('input', (e) => { state.tagForm.message = e.target.value; });
    pop.querySelector('#agy-git-tag-push-after')?.addEventListener('change', (e) => { state.tagForm.pushAfter = e.target.checked; });

    pop.querySelector('#agy-git-tag-create')?.addEventListener('click', () => {
      runAction('创建 Tag', async () => {
        const res = await callHost('createTag', {
          repo: state.repo,
          name: state.tagForm.name,
          message: state.tagForm.message,
          target: state.tagForm.target || 'HEAD',
          pushAfter: state.tagForm.pushAfter
        });
        state.tags = res.tags;
        state.status = res.status;
        const createdName = state.tagForm.name;
        state.tagForm.name = '';
        state.tagForm.message = '';
        state.tagForm.target = 'HEAD';
        setToast(state.tagForm.pushAfter ? `已创建并推送 Tag ${createdName}` : `已创建 Tag ${createdName}`);
      });
    });

    pop.querySelector('#agy-git-tag-push-all')?.addEventListener('click', () => {
      runAction('推送全部 Tag', async () => {
        const res = await callHost('pushTag', { repo: state.repo, name: '' });
        state.tags = res.tags;
        setToast(res.output || '已推送全部 Tag');
      });
    });

    pop.querySelectorAll('[data-tag-push]').forEach(el => {
      el.addEventListener('click', () => {
        const name = el.getAttribute('data-tag-push');
        runAction(`推送 Tag ${name}`, async () => {
          const res = await callHost('pushTag', { repo: state.repo, name });
          state.tags = res.tags;
          setToast(res.output || `已推送 Tag ${name}`);
        });
      });
    });

    pop.querySelectorAll('[data-tag-del]').forEach(el => {
      el.addEventListener('click', () => {
        const name = el.getAttribute('data-tag-del');
        runAction(`删除 Tag ${name}`, async () => {
          const res = await callHost('deleteTag', { repo: state.repo, name });
          state.tags = res.tags;
          state.status = res.status;
          setToast(`已删除本地 Tag ${name}`);
        });
      });
    });

    const nextBody = pop.querySelector('.agy-git-body');
    if (nextBody && prevBodyScrollTop > 0) {
      nextBody.scrollTop = prevBodyScrollTop;
    }
  }

  const docClickHandler = () => {
    if (state.open) {
      state.open = false;
      renderPopover();
    }
  };
  document.addEventListener('click', docClickHandler);

  injectStyles();
  renderTrigger();
  void refreshStatus();
  const timer = setInterval(() => {
    renderTrigger();
    const cid = currentConversationId();
    if (cid && cid !== state.lastConvoId) {
      void refreshStatus();
    }
  }, 2000);

  globalThis.__agyGit = {
    version: '1.6.0',
    dispose() {
      clearInterval(timer);
      document.removeEventListener('click', docClickHandler);
      document.getElementById(TRIGGER_ID)?.remove();
      document.getElementById(POPOVER_ID)?.remove();
      document.getElementById(STYLE_ID)?.remove();
      delete globalThis.__agyGit;
    }
  };
})();
