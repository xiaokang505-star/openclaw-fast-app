import { normalizeRequestedAppName } from './gui-executor';

export type GuiTaskRisk = 'low' | 'medium' | 'high';

export type GuiTaskStep =
  | { id: string; action: 'open_app'; app: string; timeoutMs?: number; maxRetries?: number }
  | { id: string; action: 'type_text'; text: string; timeoutMs?: number; maxRetries?: number }
  | { id: string; action: 'hotkey'; combo: string; timeoutMs?: number; maxRetries?: number }
  | { id: string; action: 'press_key'; key: 'enter' | 'esc' | 'tab'; timeoutMs?: number; maxRetries?: number }
  | { id: string; action: 'wait'; ms: number; timeoutMs?: number; maxRetries?: number };

export type GuiTaskPlan = {
  id: string;
  userIntent: string;
  risk: GuiTaskRisk;
  steps: GuiTaskStep[];
  createdAt: string;
};

function newStepId(i: number): string {
  return `step-${i + 1}`;
}

function splitByConnectors(text: string): string[] {
  return text
    .split(/(?:，|,|。|；|;|并且|然后|接着|再|并| and then | then )/i)
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseSingleSegment(segment: string, stepIndex: number): GuiTaskStep | null {
  const openZh = segment.match(/(?:帮我)?打开\s*([A-Za-z0-9\u4e00-\u9fa5._ -]{1,40})/);
  if (openZh?.[1]) {
    const cleaned = openZh[1].replace(/(找|搜索|查找|联系人|并且|并|然后|接着).*/u, '').trim();
    const app = normalizeRequestedAppName(cleaned);
    if (app) return { id: newStepId(stepIndex), action: 'open_app', app, timeoutMs: 12000, maxRetries: 0 };
  }
  const openEn = segment.match(/\bopen\s+([A-Za-z0-9._ -]{1,40})/i);
  if (openEn?.[1]) {
    const app = normalizeRequestedAppName(openEn[1]);
    if (app) return { id: newStepId(stepIndex), action: 'open_app', app, timeoutMs: 12000, maxRetries: 0 };
  }
  const typeZhQuoted = segment.match(/(?:输入|键入)\s*[“"](.+)[”"]\s*$/);
  if (typeZhQuoted?.[1]) {
    return { id: newStepId(stepIndex), action: 'type_text', text: typeZhQuoted[1], timeoutMs: 10000, maxRetries: 0 };
  }
  const typeEnQuoted = segment.match(/\btype\s+["'](.+)["']\s*$/i);
  if (typeEnQuoted?.[1]) {
    return { id: newStepId(stepIndex), action: 'type_text', text: typeEnQuoted[1], timeoutMs: 10000, maxRetries: 0 };
  }
  const hotkey = segment.match(/(?:按下|发送|触发)\s*(cmd\+space|command\+space|cmd\+tab|command\+tab|cmd\+q|command\+q|cmd\+w|command\+w|cmd\+c|command\+c|cmd\+v|command\+v|cmd\+a|command\+a|cmd\+s|command\+s)/i);
  if (hotkey?.[1]) {
    return { id: newStepId(stepIndex), action: 'hotkey', combo: hotkey[1], timeoutMs: 10000, maxRetries: 0 };
  }
  if (/(按回车|回车发送|按下回车|press enter)/i.test(segment)) {
    return { id: newStepId(stepIndex), action: 'press_key', key: 'enter', timeoutMs: 8000, maxRetries: 0 };
  }
  if (/(按esc|按下esc|press esc)/i.test(segment)) {
    return { id: newStepId(stepIndex), action: 'press_key', key: 'esc', timeoutMs: 8000, maxRetries: 0 };
  }
  if (/(按tab|按下tab|press tab)/i.test(segment)) {
    return { id: newStepId(stepIndex), action: 'press_key', key: 'tab', timeoutMs: 8000, maxRetries: 0 };
  }
  const waitM = segment.match(/(?:等待|wait)\s*(\d{1,4})\s*(?:毫秒|ms)/i);
  if (waitM?.[1]) {
    return { id: newStepId(stepIndex), action: 'wait', ms: Math.max(1, Number(waitM[1])), timeoutMs: 10000, maxRetries: 0 };
  }
  return null;
}

function extractContactName(text: string): string | null {
  const quoted =
    text.match(/(?:找到|搜索|查找)\s*(?:联系人)?\s*[“"']([^“”"']+)[”"']/) ||
    text.match(/(?:联系人)\s*[“"']([^“”"']+)[”"']/);
  if (quoted?.[1]?.trim()) return quoted[1].trim();
  const plain =
    text.match(/(?:找到|搜索|查找)\s*(?:联系人)?\s*([A-Za-z0-9\u4e00-\u9fa5_-]{2,24})/) ||
    text.match(/联系人\s*([A-Za-z0-9\u4e00-\u9fa5_-]{2,24})/);
  if (plain?.[1]?.trim()) return plain[1].trim();
  return null;
}

function extractMessageContent(text: string): string | null {
  const quoted =
    text.match(/(?:发(?:一条|个)?消息|发送(?:一条|个)?消息)\s*[：:，,\s]*[“"']([^“”"']+)[”"']/) ||
    text.match(/给(?:他|她|对方)?.{0,8}(?:发(?:一条|个)?消息|发送(?:一条|个)?消息)\s*[：:，,\s]*[“"']([^“”"']+)[”"']/);
  if (quoted?.[1]?.trim()) return quoted[1].trim();
  const plain =
    text.match(/(?:发(?:一条|个)?消息|发送(?:一条|个)?消息)\s*[：:，,\s]*([^\n。！？!?]{2,80})/) ||
    text.match(/给(?:他|她|对方)?.{0,8}(?:发(?:一条|个)?消息|发送(?:一条|个)?消息)\s*[：:，,\s]*([^\n。！？!?]{2,80})/);
  if (plain?.[1]?.trim()) return plain[1].trim().replace(/[”"']+$/g, '').trim();
  return null;
}

export function buildGuiTaskPlan(text: string, risk: GuiTaskRisk): GuiTaskPlan | null {
  const segments = splitByConnectors(text);
  const steps: GuiTaskStep[] = [];
  for (const seg of segments) {
    const step = parseSingleSegment(seg, steps.length);
    if (step) steps.push(step);
  }
  // 复合语义补全：找到联系人“X” => cmd+f, 输入X, 回车
  const contact = extractContactName(text);
  if (contact) {
    steps.push({
      id: newStepId(steps.length),
      action: 'hotkey',
      combo: 'cmd+f',
      timeoutMs: 8000,
      maxRetries: 0,
    });
    steps.push({
      id: newStepId(steps.length),
      action: 'type_text',
      text: contact,
      timeoutMs: 10000,
      maxRetries: 0,
    });
    steps.push({
      id: newStepId(steps.length),
      action: 'press_key',
      key: 'enter',
      timeoutMs: 8000,
      maxRetries: 0,
    });
    steps.push({
      id: newStepId(steps.length),
      action: 'wait',
      ms: 2000,
      timeoutMs: 5000,
      maxRetries: 0,
    });
  }
  // 复合语义补全：发一条消息“Y” => 输入Y, 回车
  const msg = extractMessageContent(text);
  if (msg) {
    steps.push({
      id: newStepId(steps.length),
      action: 'type_text',
      text: msg,
      timeoutMs: 10000,
      maxRetries: 0,
    });
    steps.push({
      id: newStepId(steps.length),
      action: 'wait',
      ms: 1000,
      timeoutMs: 3000,
      maxRetries: 0,
    });
    steps.push({
      id: newStepId(steps.length),
      action: 'press_key',
      key: 'enter',
      timeoutMs: 8000,
      maxRetries: 0,
    });
  }
  if (steps.length === 0) return null;
  return {
    id: `gui-task-${Date.now()}`,
    userIntent: text,
    risk,
    steps,
    createdAt: new Date().toISOString(),
  };
}
