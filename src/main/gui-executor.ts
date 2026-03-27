import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export type GuiActionResult = {
  success: boolean;
  action?: 'open_app' | 'hotkey' | 'type_text' | 'press_key' | 'wait';
  detail?: string;
  error?: string;
};

export function normalizeRequestedAppName(input: string): string {
  let s = input.trim();
  if (!s) return s;
  // 去掉常见自然语言前缀，避免把整句当应用名
  s = s.replace(/^(我电脑上的|我电脑里(的)?|电脑上的|本机的|本机上(的)?|我的)\s*/u, '');
  // 去掉常见描述性后缀
  s = s.replace(/\s*(这个|那个)?\s*(软件|应用程序|应用|app|APP)\s*$/u, '');
  // 去掉句末标点
  s = s.replace(/[。！!，,；;：:\s]+$/u, '');
  return s.trim();
}

function escAppleScriptText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function runOsa(script: string): Promise<void> {
  await execFileAsync('osascript', ['-e', script], { timeout: 10000 });
}

const APP_ALIASES: Record<string, string[]> = {
  微信: ['WeChat', '微信'],
  wechat: ['WeChat', '微信'],
  百度网盘: ['百度网盘', 'BaiduNetdisk'],
  百度云盘: ['百度网盘', 'BaiduNetdisk'],
  /** Finder.app 在 CoreServices，不在 /Applications；须能被枚举或走别名 */
  finder: ['Finder'],
  Finder: ['Finder'],
  访达: ['Finder'],
  浏览器: ['Google Chrome', 'Safari', 'Microsoft Edge'],
};

async function listInstalledApps(): Promise<Array<{ name: string; fullPath: string }>> {
  /** CoreServices：Finder、Dock 等系统壳层应用，不在 /Applications */
  const roots = ['/Applications', '/System/Applications', '/System/Library/CoreServices'];
  const out: Array<{ name: string; fullPath: string }> = [];
  for (const root of roots) {
    let entries: fs.Dirent[] = [];
    try {
      entries = await fs.promises.readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (!ent.isDirectory() || !ent.name.endsWith('.app')) continue;
      const full = path.join(root, ent.name);
      out.push({ name: ent.name.slice(0, -4), fullPath: full });
    }
  }
  return out;
}

function dedupeStrings(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

type RankedApp = { name: string; fullPath: string; score: number };

function normalizeToken(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
}

function scoreNameMatch(query: string, name: string): number {
  const q = normalizeToken(query);
  const n = normalizeToken(name);
  if (!q || !n) return 0;
  if (q === n) return 100;
  if (n.startsWith(q) || q.startsWith(n)) return 85;
  if (n.includes(q) || q.includes(n)) return 72;
  let common = 0;
  for (const ch of new Set(q.split(''))) {
    if (n.includes(ch)) common += 1;
  }
  const ratio = common / Math.max(1, new Set(q.split('')).size);
  return Math.round(ratio * 60);
}

async function resolveAppCandidates(requested: string): Promise<{ ranked: RankedApp[]; rawCandidates: string[] }> {
  const base = normalizeRequestedAppName(requested);
  if (!base) return { ranked: [], rawCandidates: [] };
  const alias = APP_ALIASES[base] ?? APP_ALIASES[base.toLowerCase()] ?? [];
  const candidates = dedupeStrings([base, ...alias]);
  const apps = await listInstalledApps();
  const ranked: RankedApp[] = [];
  for (const app of apps) {
    let best = 0;
    for (const c of candidates) {
      best = Math.max(best, scoreNameMatch(c, app.name));
    }
    if (best > 0) {
      ranked.push({ name: app.name, fullPath: app.fullPath, score: best });
    }
  }
  ranked.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return { ranked, rawCandidates: candidates };
}

export async function openApp(appName: string): Promise<GuiActionResult> {
  if (process.platform !== 'darwin') {
    return { success: false, error: '当前仅实现 macOS GUI 执行器。' };
  }
  const name = normalizeRequestedAppName(appName);
  if (!name) return { success: false, error: '应用名为空。' };
  const { ranked, rawCandidates } = await resolveAppCandidates(name);
  const top = ranked.slice(0, 3);
  if (top.length === 0) {
    return {
      success: false,
      action: 'open_app',
      error: `打开应用失败：未找到匹配应用（请求：${name}）。可尝试更具体名称。`,
    };
  }
  // 低置信度时不盲开，先给候选，避免误操作。
  if (top[0].score < 60) {
    return {
      success: false,
      action: 'open_app',
      error: `未能高置信度匹配应用「${name}」。候选：${top.map((x) => x.name).join(' / ')}。请指定更精确名称。`,
    };
  }
  // 前两名分差太小也不盲开，避免打开错误应用。
  if (top.length >= 2 && top[0].score - top[1].score < 8) {
    return {
      success: false,
      action: 'open_app',
      error: `应用名「${name}」存在歧义。候选：${top.map((x) => x.name).join(' / ')}。请明确指定。`,
    };
  }
  const candidates = dedupeStrings([
    top[0].name,
    top[0].fullPath,
    ...rawCandidates,
  ]);
  const errors: string[] = [];
  for (const c of candidates) {
    try {
      await execFileAsync('open', ['-a', c], { timeout: 10000 });
      return { success: true, action: 'open_app', detail: `已尝试打开应用：${c}` };
    } catch (e1) {
      errors.push(String((e1 as Error).message || e1));
    }
    try {
      await runOsa(`tell application "${escAppleScriptText(c)}" to activate`);
      return { success: true, action: 'open_app', detail: `已尝试打开应用：${c}` };
    } catch (e2) {
      errors.push(String((e2 as Error).message || e2));
    }
  }
  return {
    success: false,
    action: 'open_app',
    error: `打开应用失败：目标「${name}」。候选：${top.map((x) => `${x.name}(${x.score})`).join(' / ')}；错误：${errors.slice(0, 2).join(' ; ')}`,
  };
}

export async function pressHotkey(raw: string): Promise<GuiActionResult> {
  if (process.platform !== 'darwin') {
    return { success: false, error: '当前仅实现 macOS GUI 执行器。' };
  }
  const normalized = raw.toLowerCase().replace(/\s+/g, '');
  const map: Record<string, { key: string; mods: string[]; text: string }> = {
    'cmd+space': { key: 'space', mods: ['command down'], text: 'cmd+space' },
    'command+space': { key: 'space', mods: ['command down'], text: 'cmd+space' },
    'cmd+tab': { key: 'tab', mods: ['command down'], text: 'cmd+tab' },
    'command+tab': { key: 'tab', mods: ['command down'], text: 'cmd+tab' },
    'cmd+q': { key: 'q', mods: ['command down'], text: 'cmd+q' },
    'command+q': { key: 'q', mods: ['command down'], text: 'cmd+q' },
    'cmd+w': { key: 'w', mods: ['command down'], text: 'cmd+w' },
    'command+w': { key: 'w', mods: ['command down'], text: 'cmd+w' },
    'cmd+c': { key: 'c', mods: ['command down'], text: 'cmd+c' },
    'command+c': { key: 'c', mods: ['command down'], text: 'cmd+c' },
    'cmd+v': { key: 'v', mods: ['command down'], text: 'cmd+v' },
    'command+v': { key: 'v', mods: ['command down'], text: 'cmd+v' },
    'cmd+a': { key: 'a', mods: ['command down'], text: 'cmd+a' },
    'command+a': { key: 'a', mods: ['command down'], text: 'cmd+a' },
    'cmd+s': { key: 's', mods: ['command down'], text: 'cmd+s' },
    'command+s': { key: 's', mods: ['command down'], text: 'cmd+s' },
    'cmd+f': { key: 'f', mods: ['command down'], text: 'cmd+f' },
    'command+f': { key: 'f', mods: ['command down'], text: 'cmd+f' },
  };
  const conf = map[normalized];
  if (!conf) {
    return { success: false, action: 'hotkey', error: `暂不支持快捷键：${raw}` };
  }
  try {
    const using = conf.mods.length ? ` using {${conf.mods.join(', ')}}` : '';
    await runOsa(`tell application "System Events" to keystroke "${conf.key}"${using}`);
    return { success: true, action: 'hotkey', detail: `已发送快捷键：${conf.text}` };
  } catch (e) {
    return { success: false, action: 'hotkey', error: `发送快捷键失败：${(e as Error).message}` };
  }
}

export async function typeText(text: string): Promise<GuiActionResult> {
  if (process.platform !== 'darwin') {
    return { success: false, error: '当前仅实现 macOS GUI 执行器。' };
  }
  const t = text.trim();
  if (!t) return { success: false, error: '输入文本为空。' };
  try {
    await runOsa(`tell application "System Events" to keystroke "${escAppleScriptText(t)}"`);
    return { success: true, action: 'type_text', detail: `已输入文本（${t.length} 字符）` };
  } catch (e) {
    return { success: false, action: 'type_text', error: `输入文本失败：${(e as Error).message}` };
  }
}

export async function pressKey(key: 'enter' | 'esc' | 'tab'): Promise<GuiActionResult> {
  if (process.platform !== 'darwin') {
    return { success: false, error: '当前仅实现 macOS GUI 执行器。' };
  }
  const map: Record<'enter' | 'esc' | 'tab', string> = {
    enter: 'return',
    esc: 'escape',
    tab: 'tab',
  };
  try {
    await runOsa(`tell application "System Events" to key code ${map[key] === 'return' ? 36 : map[key] === 'escape' ? 53 : 48}`);
    return { success: true, action: 'press_key', detail: `已按下按键：${key}` };
  } catch (e) {
    return { success: false, action: 'press_key', error: `按键执行失败：${(e as Error).message}` };
  }
}

export function detectDirectGuiAction(text: string): null | { kind: 'open_app'; app: string } | { kind: 'hotkey'; combo: string } | { kind: 'type_text'; content: string } {
  const openZh = text.match(/(?:帮我)?打开\s*([A-Za-z0-9\u4e00-\u9fa5._ -]{2,40})/);
  if (openZh?.[1]) {
    const app = normalizeRequestedAppName(openZh[1]);
    if (app) return { kind: 'open_app', app };
  }

  const openEn = text.match(/\bopen\s+([A-Za-z0-9._ -]{2,40})/i);
  if (openEn?.[1]) {
    const app = normalizeRequestedAppName(openEn[1]);
    if (app) return { kind: 'open_app', app };
  }

  const hotkey = text.match(/(?:按下|发送|触发)\s*(cmd\+space|command\+space|cmd\+tab|command\+tab|cmd\+q|command\+q|cmd\+w|command\+w|cmd\+c|command\+c|cmd\+v|command\+v|cmd\+a|command\+a|cmd\+s|command\+s)/i);
  if (hotkey?.[1]) return { kind: 'hotkey', combo: hotkey[1] };

  const typeZh = text.match(/(?:输入|键入)\s*[“"](.*)[”"]\s*$/);
  if (typeZh?.[1]) return { kind: 'type_text', content: typeZh[1] };

  const typeEn = text.match(/\btype\s+["'](.+)["']\s*$/i);
  if (typeEn?.[1]) return { kind: 'type_text', content: typeEn[1] };

  return null;
}
