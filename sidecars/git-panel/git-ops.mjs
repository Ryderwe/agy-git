import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DATA_DIR = join(homedir(), '.gemini', 'antigravity', 'plugin_data', 'agy-git');
const SETTINGS_FILE = join(DATA_DIR, 'settings.json');

export function loadSettings() {
  try {
    if (existsSync(SETTINGS_FILE)) {
      const parsed = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
      return {
        lastRepo: typeof parsed.lastRepo === 'string' ? parsed.lastRepo : '',
        recentRepos: Array.isArray(parsed.recentRepos) ? parsed.recentRepos.filter(p => typeof p === 'string') : [],
        ai: parsed.ai && typeof parsed.ai === 'object' ? {
          baseUrl: typeof parsed.ai.baseUrl === 'string' ? parsed.ai.baseUrl : '',
          apiKey: typeof parsed.ai.apiKey === 'string' ? parsed.ai.apiKey : '',
          model: typeof parsed.ai.model === 'string' ? parsed.ai.model : '',
          language: typeof parsed.ai.language === 'string' && parsed.ai.language ? parsed.ai.language : 'zh-CN',
          scope: parsed.ai.scope === 'staged' ? 'staged' : 'all'
        } : { baseUrl: '', apiKey: '', model: '', language: 'zh-CN', scope: 'all' }
      };
    }
  } catch {}
  return { lastRepo: '', recentRepos: [], ai: { baseUrl: '', apiKey: '', model: '', language: 'zh-CN', scope: 'all' } };
}

export function saveSettings(next) {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), 'utf8');
  } catch {}
}

export function saveAiSettings(ai) {
  const cur = loadSettings();
  const next = {
    ...cur,
    ai: {
      baseUrl: String(ai?.baseUrl || '').trim(),
      apiKey: String(ai?.apiKey || '').trim(),
      model: String(ai?.model || '').trim(),
      language: String(ai?.language || 'zh-CN').trim() || 'zh-CN',
      scope: ai?.scope === 'staged' ? 'staged' : 'all'
    }
  };
  saveSettings(next);
  return next.ai;
}

export function rememberRepo(repoPath) {
  const clean = resolve(repoPath);
  const cur = loadSettings();
  const recentRepos = [clean, ...cur.recentRepos.filter(p => p !== clean)].slice(0, 12);
  const next = { ...cur, lastRepo: clean, recentRepos };
  saveSettings(next);
  return next;
}

async function runGit(cwd, args, timeoutMs = 20000) {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    });
    return { stdout: stdout ?? '', stderr: stderr ?? '' };
  } catch (err) {
    const msg = (err.stderr || err.stdout || err.message || 'Git 命令执行失败').toString().trim();
    throw new Error(msg);
  }
}

export async function resolveRepoRoot(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new Error('请先选择或输入 Git 仓库路径');
  }
  const target = resolve(inputPath.trim().replace(/^~/, homedir()));
  if (!existsSync(target)) {
    throw new Error(`路径不存在: ${target}`);
  }
  const { stdout } = await runGit(target, ['rev-parse', '--show-toplevel']);
  return stdout.trim();
}

export async function getStatus(repoPath) {
  const root = await resolveRepoRoot(repoPath);
  rememberRepo(root);
  const { stdout } = await runGit(root, ['status', '--porcelain=v2', '--branch', '-z']);
  const tokens = stdout.split('\0');
  let branch = 'HEAD';
  let upstream = '';
  let ahead = 0;
  let behind = 0;
  let detached = false;
  const staged = [];
  const unstaged = [];

  for (let i = 0; i < tokens.length; i++) {
    const line = tokens[i];
    if (!line) continue;
    if (line.startsWith('# branch.head ')) {
      branch = line.slice('# branch.head '.length);
      if (branch === '(detached)') detached = true;
    } else if (line.startsWith('# branch.upstream ')) {
      upstream = line.slice('# branch.upstream '.length);
    } else if (line.startsWith('# branch.ab ')) {
      const m = line.match(/\+(\d+)\s+-(\d+)/);
      if (m) {
        ahead = Number(m[1]);
        behind = Number(m[2]);
      }
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const parts = line.split(' ');
      const xy = parts[1];
      const x = xy[0];
      const y = xy[1];
      let filePath = '';
      let origPath = '';
      if (line.startsWith('2 ')) {
        filePath = parts.slice(9).join(' ');
        origPath = tokens[++i] || '';
      } else {
        filePath = parts.slice(8).join(' ');
      }
      if (x !== '.') {
        staged.push({ path: filePath, origPath, status: x });
      }
      if (y !== '.') {
        unstaged.push({ path: filePath, origPath, status: y });
      }
    } else if (line.startsWith('u ')) {
      const parts = line.split(' ');
      const xy = parts[1];
      const filePath = parts.slice(10).join(' ');
      unstaged.push({ path: filePath, origPath: '', status: xy, unmerged: true });
    } else if (line.startsWith('? ')) {
      const filePath = line.slice(2);
      unstaged.push({ path: filePath, origPath: '', status: '?' });
    }
  }

  let branches = [];
  try {
    const br = await runGit(root, ['branch', '--format=%(refname:short)']);
    branches = br.stdout.split('\n').map(s => s.trim()).filter(Boolean);
  } catch {}

  let lastCommit = '';
  try {
    const lc = await runGit(root, ['log', '-1', '--pretty=%h %s']);
    lastCommit = lc.stdout.trim();
  } catch {}

  let remotes = [];
  try {
    const rm = await runGit(root, ['remote']);
    remotes = rm.stdout.split('\n').map(s => s.trim()).filter(Boolean);
  } catch {}

  return {
    root,
    branch,
    detached,
    upstream,
    ahead,
    behind,
    staged,
    unstaged,
    branches,
    lastCommit,
    remotes,
    hasOrigin: remotes.includes('origin')
  };
}

export async function getDiff(repoPath, filePath, isStaged) {
  const root = await resolveRepoRoot(repoPath);
  if (!filePath) throw new Error('缺少文件路径');
  const args = isStaged
    ? ['diff', '--cached', '--no-color', '--', filePath]
    : ['diff', '--no-color', '--', filePath];
  const { stdout } = await runGit(root, args);
  if (!stdout && !isStaged) {
    // Possibly untracked file; preview first 200 lines
    const full = join(root, filePath);
    if (existsSync(full)) {
      try {
        const content = readFileSync(full, 'utf8');
        const lines = content.split('\n').slice(0, 200);
        return `--- /dev/null\n+++ b/${filePath}\n@@ -0,0 +1,${lines.length} @@\n` + lines.map(l => `+${l}`).join('\n');
      } catch {
        return '(二进制或不可读文件)';
      }
    }
  }
  return stdout || '(无文本差异)';
}

export async function stageFiles(repoPath, files) {
  const root = await resolveRepoRoot(repoPath);
  if (!files || !files.length) {
    await runGit(root, ['add', '-A']);
  } else {
    await runGit(root, ['add', '--', ...files]);
  }
  return getStatus(root);
}

export async function unstageFiles(repoPath, files) {
  const root = await resolveRepoRoot(repoPath);
  const args = (!files || !files.length)
    ? ['reset', 'HEAD', '--']
    : ['reset', 'HEAD', '--', ...files];
  try {
    await runGit(root, args);
  } catch (err) {
    // Handle unborn HEAD (initial commit)
    const rmArgs = (!files || !files.length)
      ? ['rm', '--cached', '-r', '.']
      : ['rm', '--cached', '--', ...files];
    await runGit(root, rmArgs);
  }
  return getStatus(root);
}

export async function discardFile(repoPath, filePath, status) {
  const root = await resolveRepoRoot(repoPath);
  if (!filePath) throw new Error('缺少文件路径');
  if (status === '?') {
    await runGit(root, ['clean', '-f', '--', filePath]);
  } else {
    await runGit(root, ['checkout', '--', filePath]);
  }
  return getStatus(root);
}

export async function commitChanges(repoPath, message, amend = false) {
  const root = await resolveRepoRoot(repoPath);
  const msg = (message || '').trim();
  if (!msg && !amend) throw new Error('请输入提交消息');
  const args = ['commit'];
  if (amend) args.push('--amend');
  if (msg) args.push('-m', msg);
  else args.push('--no-edit');
  const res = await runGit(root, args);
  return {
    output: (res.stdout || res.stderr || '提交成功').trim(),
    status: await getStatus(root)
  };
}

export async function pushChanges(repoPath, setUpstream = false) {
  const root = await resolveRepoRoot(repoPath);
  const st = await getStatus(root);
  const args = ['push'];
  if (setUpstream || !st.upstream) {
    args.push('-u', 'origin', st.branch);
  }
  const res = await runGit(root, args, 60000);
  return {
    output: (res.stderr || res.stdout || 'Push 成功').trim(),
    status: await getStatus(root)
  };
}

export async function pullChanges(repoPath) {
  const root = await resolveRepoRoot(repoPath);
  const res = await runGit(root, ['pull'], 60000);
  return {
    output: (res.stdout || res.stderr || 'Pull 成功').trim(),
    status: await getStatus(root)
  };
}

export async function fetchChanges(repoPath) {
  const root = await resolveRepoRoot(repoPath);
  const res = await runGit(root, ['fetch', '--all', '--prune'], 60000);
  return {
    output: (res.stderr || res.stdout || 'Fetch 完成').trim(),
    status: await getStatus(root)
  };
}

export async function checkoutBranch(repoPath, branchName, create = false) {
  const root = await resolveRepoRoot(repoPath);
  const name = (branchName || '').trim();
  if (!name) throw new Error('请输入分支名称');
  const args = create ? ['checkout', '-b', name] : ['checkout', name];
  await runGit(root, args);
  return getStatus(root);
}

export async function getLog(repoPath, limit = 50) {
  const root = await resolveRepoRoot(repoPath);
  const count = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const sep = '\x1f';
  const recSep = '\x1e';
  const format = `%H${sep}%h${sep}%an${sep}%ar${sep}%D${sep}%s${recSep}`;
  let stdout = '';
  try {
    ({ stdout } = await runGit(root, ['log', `-n${count}`, `--pretty=format:${format}`]));
  } catch (err) {
    if (String(err.message).includes('does not have any commits')) return [];
    throw err;
  }
  return stdout
    .split(recSep)
    .map(r => r.trim())
    .filter(Boolean)
    .map(rec => {
      const [hash, shortHash, author, date, refs, subject] = rec.split(sep);
      return {
        hash: hash || '',
        shortHash: shortHash || '',
        author: author || '',
        date: date || '',
        refs: refs ? refs.split(',').map(s => s.trim()).filter(Boolean) : [],
        subject: subject || ''
      };
    });
}

export async function getCommitDetail(repoPath, hash) {
  const root = await resolveRepoRoot(repoPath);
  if (!hash || !/^[a-fA-F0-9]{4,40}$/.test(hash.trim())) {
    throw new Error('无效的 Commit Hash');
  }
  const { stdout } = await runGit(root, ['show', '--stat', '--no-color', hash.trim()]);
  return stdout;
}

function parseLogOutput(stdout) {
  const sep = '\x1f';
  const recSep = '\x1e';
  return String(stdout || '')
    .split(recSep)
    .map(r => r.trim())
    .filter(Boolean)
    .map(rec => {
      const [hash, shortHash, author, date, refs, subject] = rec.split(sep);
      return {
        hash: hash || '',
        shortHash: shortHash || '',
        author: author || '',
        date: date || '',
        refs: refs ? refs.split(',').map(s => s.trim()).filter(Boolean) : [],
        subject: subject || ''
      };
    });
}

export async function getRemoteCommits(repoPath, doFetch = false, limit = 30) {
  const root = await resolveRepoRoot(repoPath);
  if (doFetch) {
    await runGit(root, ['fetch', '--all', '--prune'], 60000);
  }
  const st = await getStatus(root);
  if (!st.upstream) {
    return { upstream: '', incoming: [], remoteLog: [], status: st };
  }
  const sep = '\x1f';
  const recSep = '\x1e';
  const format = `%H${sep}%h${sep}%an${sep}%ar${sep}%D${sep}%s${recSep}`;
  const count = Math.min(Math.max(Number(limit) || 30, 1), 100);
  let incoming = [];
  let remoteLog = [];
  try {
    const { stdout } = await runGit(root, ['log', `HEAD..${st.upstream}`, `-n${count}`, `--pretty=format:${format}`]);
    incoming = parseLogOutput(stdout);
  } catch {}
  try {
    const { stdout } = await runGit(root, ['log', st.upstream, `-n${count}`, `--pretty=format:${format}`]);
    remoteLog = parseLogOutput(stdout);
  } catch {}
  return {
    upstream: st.upstream,
    incoming,
    remoteLog,
    status: st
  };
}

export async function resetToCommit(repoPath, hash, mode = 'soft') {
  const root = await resolveRepoRoot(repoPath);
  if (!hash || !/^[a-fA-F0-9]{4,40}$/.test(hash.trim())) {
    throw new Error('无效的 Commit Hash');
  }
  const flag = mode === 'hard' ? '--hard' : (mode === 'mixed' ? '--mixed' : '--soft');
  await runGit(root, ['reset', flag, hash.trim()]);
  return getStatus(root);
}

export async function revertCommit(repoPath, hash) {
  const root = await resolveRepoRoot(repoPath);
  if (!hash || !/^[a-fA-F0-9]{4,40}$/.test(hash.trim())) {
    throw new Error('无效的 Commit Hash');
  }
  await runGit(root, ['revert', '--no-edit', hash.trim()]);
  return getStatus(root);
}

export async function listTags(repoPath) {
  const root = await resolveRepoRoot(repoPath);
  const sep = '\x1f';
  const recSep = '\x1e';
  const format = `%(refname:short)${sep}%(objectname:short)${sep}%(creatordate:relative)${sep}%(contents:subject)${recSep}`;
  const { stdout } = await runGit(root, ['tag', '-l', '--sort=-creatordate', `--format=${format}`]);
  return stdout
    .split(recSep)
    .map(r => r.trim())
    .filter(Boolean)
    .map(rec => {
      const [name, hash, date, message] = rec.split(sep);
      return {
        name: name || '',
        hash: hash || '',
        date: date || '',
        message: message || ''
      };
    });
}

export async function createTag(repoPath, name, message = '', target = 'HEAD', pushAfter = false) {
  const root = await resolveRepoRoot(repoPath);
  const tagName = (name || '').trim();
  if (!tagName || /\s/.test(tagName)) throw new Error('请输入有效的 Tag 名称（不能包含空格）');
  const ref = (target || 'HEAD').trim();
  const msg = (message || '').trim();
  if (msg) {
    await runGit(root, ['tag', '-a', tagName, ref, '-m', msg]);
  } else {
    await runGit(root, ['tag', tagName, ref]);
  }
  let pushOutput = '';
  if (pushAfter) {
    const res = await runGit(root, ['push', 'origin', tagName], 60000);
    pushOutput = (res.stderr || res.stdout || '').trim();
  }
  return {
    tags: await listTags(root),
    status: await getStatus(root),
    output: pushOutput
  };
}

export async function pushTag(repoPath, name = '') {
  const root = await resolveRepoRoot(repoPath);
  const tagName = (name || '').trim();
  const args = tagName ? ['push', 'origin', tagName] : ['push', 'origin', '--tags'];
  const res = await runGit(root, args, 60000);
  return {
    output: (res.stderr || res.stdout || (tagName ? `已推送 Tag ${tagName}` : '已推送全部 Tag')).trim(),
    tags: await listTags(root)
  };
}

export async function deleteTag(repoPath, name) {
  const root = await resolveRepoRoot(repoPath);
  const tagName = (name || '').trim();
  if (!tagName) throw new Error('缺少 Tag 名称');
  await runGit(root, ['tag', '-d', tagName]);
  return {
    tags: await listTags(root),
    status: await getStatus(root)
  };
}

export async function removeIndexLock(repoPath) {
  const root = await resolveRepoRoot(repoPath);
  const { stdout } = await runGit(root, ['rev-parse', '--git-dir']);
  const gitDirRaw = stdout.trim();
  const gitDir = resolve(root, gitDirRaw);
  const lockFile = join(gitDir, 'index.lock');
  if (existsSync(lockFile)) {
    unlinkSync(lockFile);
  }
  return getStatus(root);
}

export async function initRepo(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') {
    throw new Error('请先输入要初始化的目录路径');
  }
  const dir = resolve(targetPath.trim().replace(/^~/, homedir()));
  if (!existsSync(dir)) {
    throw new Error(`目录不存在: ${dir}`);
  }
  try {
    await runGit(dir, ['init', '-b', 'main']);
  } catch {
    await runGit(dir, ['init']);
  }
  return getStatus(dir);
}

export async function addRemoteAndPush(repoPath, remoteUrl) {
  const root = await resolveRepoRoot(repoPath);
  const url = (remoteUrl || '').trim();
  if (!url) throw new Error('请输入远程仓库地址');
  const st = await getStatus(root);
  if (st.hasOrigin) {
    await runGit(root, ['remote', 'set-url', 'origin', url]);
  } else {
    await runGit(root, ['remote', 'add', 'origin', url]);
  }
  let hasHead = false;
  try {
    await runGit(root, ['rev-parse', '--verify', 'HEAD']);
    hasHead = true;
  } catch {}
  if (!hasHead) {
    return {
      output: '已绑定 origin 远程仓库（当前尚无提交，请先提交后再 Push）',
      status: await getStatus(root)
    };
  }
  const res = await runGit(root, ['push', '-u', 'origin', st.branch], 60000);
  return {
    output: (res.stderr || res.stdout || '已绑定远程仓库并完成 Push').trim(),
    status: await getStatus(root)
  };
}

export async function createGithubRepoAndPush(repoPath, { name = '', visibility = 'private', description = '' } = {}) {
  const root = await resolveRepoRoot(repoPath);
  const repoName = (name || '').trim() || root.split('/').filter(Boolean).pop();
  if (!repoName || /\s/.test(repoName)) {
    throw new Error('请输入有效的 GitHub 仓库名称（不能包含空格）');
  }
  let hasHead = false;
  try {
    await runGit(root, ['rev-parse', '--verify', 'HEAD']);
    hasHead = true;
  } catch {}

  const args = [
    'repo', 'create', repoName,
    visibility === 'public' ? '--public' : '--private',
    '--source=.',
    '--remote=origin'
  ];
  if (hasHead) args.push('--push');
  if (description && description.trim()) {
    args.push('--description', description.trim());
  }

  try {
    const { stdout, stderr } = await execFileAsync('gh', args, {
      cwd: root,
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024
    });
    const out = (stdout || stderr || '').trim();
    return {
      output: hasHead
        ? (out || `已创建 GitHub 仓库 ${repoName} 并推送`)
        : `已创建 GitHub 仓库 ${repoName} 并绑定 origin（当前尚无提交，请先提交后再 Push）`,
      status: await getStatus(root)
    };
  } catch (err) {
    const msg = (err.stderr || err.stdout || err.message || '').toString().trim();
    if (/ENOENT|command not found/i.test(msg)) {
      throw new Error('未检测到 GitHub CLI (gh)，请先安装 gh 或在下方直接填写已有远程仓库 URL');
    }
    if (/auth login|not logged/i.test(msg)) {
      throw new Error('GitHub CLI 未登录，请先在终端执行 gh auth login，或在下方直接填写远程仓库 URL');
    }
    throw new Error(msg || '创建 GitHub 仓库失败');
  }
}

export async function generateCommitMessage(repoPath) {
  const root = await resolveRepoRoot(repoPath);
  const st = await getStatus(root);
  if (!st.staged.length && !st.unstaged.length) {
    throw new Error('当前工作区没有需要提交的更改');
  }

  const settings = loadSettings();
  const ai = settings.ai || {};
  const scope = ai.scope === 'staged' ? 'staged' : 'all';
  const language = ai.language || 'zh-CN';
  if (scope === 'staged' && !st.staged.length) {
    throw new Error('当前设置为「仅已暂存改动」，但暂存区为空，请先暂存文件或切换为「全部改动」');
  }

  const apiKey = ai.apiKey || process.env.OPENAI_API_KEY || '';
  const baseUrl = (ai.baseUrl || (apiKey ? 'https://api.openai.com/v1' : '')).replace(/\/+$/, '');
  const model = ai.model || 'gpt-4o-mini';

  let diffText = '';
  try {
    if (scope === 'staged') {
      const { stdout } = await runGit(root, ['diff', '--cached', '--no-color']);
      diffText = stdout || '';
    } else {
      const stagedOut = st.staged.length ? (await runGit(root, ['diff', '--cached', '--no-color'])).stdout : '';
      const unstagedOut = st.unstaged.length ? (await runGit(root, ['diff', '--no-color'])).stdout : '';
      const untracked = st.unstaged.filter(f => f.status === '?').map(f => `? ${f.path}`).join('\n');
      diffText = [
        stagedOut ? `=== Staged Changes ===\n${stagedOut}` : '',
        unstagedOut ? `=== Unstaged Changes ===\n${unstagedOut}` : '',
        untracked ? `=== Untracked Files ===\n${untracked}` : ''
      ].filter(Boolean).join('\n\n');
    }
  } catch {}
  if (!diffText) {
    const targetList = scope === 'staged' ? st.staged : [...st.staged, ...st.unstaged];
    const files = targetList.map(f => `${f.status} ${f.path}`).join('\n');
    diffText = `Changed files:\n${files}`;
  }
  const clippedDiff = diffText.slice(0, 12000);

  const langMap = {
    'zh-CN': 'Simplified Chinese (简体中文)',
    'zh-TW': 'Traditional Chinese (繁體中文)',
    'en': 'English',
    'ja': 'Japanese (日本語)',
    'auto': 'the primary language used in the code comments/project'
  };
  const langInstruction = langMap[language] || language;

  if (baseUrl) {
    const apiBase = /\/v1$/i.test(baseUrl) ? baseUrl : `${baseUrl}/v1`;
    const sysPrompt = `You are a git commit message generator. Write a concise, clear Conventional Commits message (e.g. feat: ..., fix: ..., refactor: ...). Write the commit description in ${langInstruction}. Output ONLY the commit message text without markdown fences.`;
    const userPrompt = `Generate a commit message for this git diff:\n\n${clippedDiff}`;
    const cleanMsg = (txt) => String(txt || '').replace(/^```[\w]*\n?|\n?```$/g, '').trim();

    const extractResponsesText = (data) => {
      if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text;
      if (Array.isArray(data?.output)) {
        for (const item of data.output) {
          if (typeof item?.text === 'string' && item.text.trim()) return item.text;
          if (Array.isArray(item?.content)) {
            for (const c of item.content) {
              if (typeof c?.text === 'string' && c.text.trim()) return c.text;
            }
          }
        }
      }
      return '';
    };

    const tryChatCompletions = async () => {
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      const res = await fetch(`${apiBase}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [
            { role: 'system', content: sysPrompt },
            { role: 'user', content: userPrompt }
          ]
        }),
        signal: AbortSignal.timeout(30000)
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        const err = new Error(`AI 接口返回错误 (${res.status}): ${errText.slice(0, 200)}`);
        err.status = res.status;
        err.body = errText;
        throw err;
      }
      const data = await res.json();
      return cleanMsg(data?.choices?.[0]?.message?.content);
    };

    const parseResponsesSse = (sseText) => {
      let deltaAcc = '';
      let finalText = '';
      for (const line of String(sseText || '').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const evt = JSON.parse(payload);
          if (evt?.type === 'response.output_text.delta' && typeof evt.delta === 'string') {
            deltaAcc += evt.delta;
          } else if (evt?.type === 'response.completed' && evt.response) {
            const full = extractResponsesText(evt.response);
            if (full) finalText = full;
          }
        } catch {}
      }
      return finalText || deltaAcc;
    };

    const tryResponses = async (useStream = false) => {
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      const res = await fetch(`${apiBase}/responses`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          instructions: sysPrompt,
          input: userPrompt,
          ...(useStream ? { stream: true } : {})
        }),
        signal: AbortSignal.timeout(30000)
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        if (!useStream && res.status === 400 && /stream/i.test(errText)) {
          return tryResponses(true);
        }
        const err = new Error(`AI 接口返回错误 (${res.status}): ${errText.slice(0, 200)}`);
        err.status = res.status;
        err.body = errText;
        throw err;
      }
      const ctype = res.headers.get('content-type') || '';
      if (useStream || ctype.includes('text/event-stream')) {
        const raw = await res.text();
        return cleanMsg(parseResponsesSse(raw));
      }
      const data = await res.json();
      return cleanMsg(extractResponsesText(data));
    };

    const tryAnthropicMessages = async () => {
      const headers = {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01'
      };
      if (apiKey) {
        headers['x-api-key'] = apiKey;
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
      const res = await fetch(`${apiBase}/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          max_tokens: 512,
          system: sysPrompt,
          messages: [{ role: 'user', content: userPrompt }]
        }),
        signal: AbortSignal.timeout(30000)
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        const err = new Error(`AI 接口返回错误 (${res.status}): ${errText.slice(0, 200)}`);
        err.status = res.status;
        err.body = errText;
        throw err;
      }
      const data = await res.json();
      const textBlock = Array.isArray(data?.content) ? data.content.find(c => typeof c?.text === 'string') : null;
      return cleanMsg(textBlock?.text);
    };

    const attempts = [tryResponses, tryChatCompletions, tryAnthropicMessages];
    let lastErr = null;
    for (const fn of attempts) {
      try {
        const content = await fn();
        if (content) return { message: content, source: 'custom-ai' };
      } catch (err) {
        lastErr = err;
        const body = String(err.body || err.message || '');
        const retryable = err.status === 400 || err.status === 404 || err.status === 405 || body.includes('gateway_protocol_policy_denied');
        if (!retryable) throw err;
      }
    }
    throw lastErr || new Error('AI 未返回有效提交消息');
  }

  // 2. Try Antigravity built-in LanguageServerService/GenerateCommitMessage
  const addr = process.env.ANTIGRAVITY_LS_ADDRESS || 'localhost:5387';
  const token = process.env.ANTIGRAVITY_CSRF_TOKEN || '';
  if (token) {
    try {
      const res = await fetch(`http://${addr}/exa.language_server_pb.LanguageServerService/GenerateCommitMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-codeium-csrf-token': token
        },
        body: JSON.stringify({ workspaceUri: pathToFileURL(root).href }),
        signal: AbortSignal.timeout(25000)
      });
      if (res.ok) {
        const data = await res.json();
        const msg = data?.commitMessage || data?.message || data?.result || '';
        if (typeof msg === 'string' && msg.trim()) {
          return { message: msg.trim(), source: 'antigravity-ls' };
        }
      }
    } catch {}
  }

  throw new Error('Antigravity 内置接口暂不可用，请点击输入框上方「AI 设置」配置兼容接口（如 DeepSeek / OpenAI / 本地 Ollama）');
}

function uriToLocalPath(uri) {
  if (!uri || typeof uri !== 'string') return '';
  try {
    if (uri.startsWith('file://')) return fileURLToPath(uri);
  } catch {}
  return '';
}

async function fetchTrajectories() {
  const addr = process.env.ANTIGRAVITY_LS_ADDRESS || 'localhost:5387';
  const token = process.env.ANTIGRAVITY_CSRF_TOKEN || '';
  if (!token) return null;
  try {
    const res = await fetch(`http://${addr}/exa.language_server_pb.LanguageServerService/GetAllCascadeTrajectories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-codeium-csrf-token': token
      },
      body: '{}',
      signal: AbortSignal.timeout(3000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.trajectorySummaries || null;
  } catch {
    return null;
  }
}

export async function discoverWorkspaceRepo(hintName = '', conversationId = '') {
  const settings = loadSettings();
  const summaries = await fetchTrajectories();
  const discoveredRepos = [];

  if (summaries) {
    const entries = Object.entries(summaries);
    // 1. Exact match for current conversationId
    if (conversationId && summaries[conversationId]) {
      const wsList = summaries[conversationId].workspaces || summaries[conversationId].trajectoryMetadata?.workspaces || [];
      for (const ws of wsList) {
        const candidate = uriToLocalPath(ws.gitRootAbsoluteUri) || uriToLocalPath(ws.workspaceFolderAbsoluteUri);
        if (candidate && existsSync(candidate)) {
          try {
            const root = await resolveRepoRoot(candidate);
            return { repo: root, recentRepos: [...new Set([root, ...settings.recentRepos])].slice(0, 12), autoDetected: true };
          } catch {
            return { repo: '', nonGitWorkspace: candidate, recentRepos: settings.recentRepos, autoDetected: false };
          }
        }
      }
    }

    // 2. Collect all workspace repos sorted by lastUserViewTime / lastModifiedTime
    entries.sort((a, b) => {
      const ta = Date.parse(a[1]?.annotations?.lastUserViewTime || a[1]?.lastModifiedTime || 0) || 0;
      const tb = Date.parse(b[1]?.annotations?.lastUserViewTime || b[1]?.lastModifiedTime || 0) || 0;
      return tb - ta;
    });
    for (const [, summary] of entries) {
      const wsList = summary?.workspaces || summary?.trajectoryMetadata?.workspaces || [];
      for (const ws of wsList) {
        const candidate = uriToLocalPath(ws.gitRootAbsoluteUri) || uriToLocalPath(ws.workspaceFolderAbsoluteUri);
        if (candidate && existsSync(candidate) && !discoveredRepos.includes(candidate)) {
          discoveredRepos.push(candidate);
        }
      }
    }
    for (const candidate of discoveredRepos) {
      try {
        const root = await resolveRepoRoot(candidate);
        return { repo: root, recentRepos: [...new Set([root, ...discoveredRepos, ...settings.recentRepos])].slice(0, 12), autoDetected: true };
      } catch {}
    }
  }

  if (settings.lastRepo && existsSync(settings.lastRepo)) {
    try {
      const root = await resolveRepoRoot(settings.lastRepo);
      if (!hintName || root.toLowerCase().includes(hintName.toLowerCase())) {
        return { repo: root, recentRepos: settings.recentRepos };
      }
    } catch {}
  }
  for (const c of settings.recentRepos) {
    if (c && existsSync(c)) {
      try {
        const root = await resolveRepoRoot(c);
        return { repo: root, recentRepos: settings.recentRepos };
      } catch {}
    }
  }
  return { repo: settings.lastRepo || '', recentRepos: settings.recentRepos };
}
