import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { applyDefaultDiscordChannelStub } from './openclaw-config';

const CONFIG_PATH = path.join(os.homedir(), '.openclaw', 'openclaw.json');
const OLLAMA_PROVIDER_ID = 'ollama-local';
/** 使用原生 Ollama API（无 /v1），避免 tool calling 与流式异常；见 OpenClaw 文档 providers/ollama */
const OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
/** OpenClaw 网关要求模型 contextWindow ≥ 16000，此处写 32768 以保证通过校验 */
const OLLAMA_CONTEXT_WINDOW = 32768;
/** 将 ollama-local provider 合并进已有 config 对象（不写文件），供一次性「一键应用」使用 */
export function mergeOllamaProviderIntoConfig(
  config: Record<string, unknown> | null,
  selectedModelName: string
): Record<string, unknown> {
  const base = config && typeof config === 'object' ? { ...config } : {};
  const modelId = selectedModelName.includes('/') ? selectedModelName : `${OLLAMA_PROVIDER_ID}/${selectedModelName}`;
  const modelEntry = {
    id: modelId,
    name: `${selectedModelName} (本地)`,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0 },
    contextWindow: OLLAMA_CONTEXT_WINDOW,
    maxTokens: 2048,
  };
  const models = (base.models && typeof base.models === 'object' ? { ...(base.models as object) } : {}) as Record<string, unknown>;
  const providers = (models.providers && typeof models.providers === 'object' ? { ...(models.providers as object) } : {}) as Record<string, unknown>;
  providers[OLLAMA_PROVIDER_ID] = {
    baseUrl: OLLAMA_BASE_URL,
    api: 'ollama',
    apiKey: 'ollama-local',
    models: [modelEntry],
  };
  models.providers = providers;
  base.models = models;
  return base;
}

/** 将用户选择的 Ollama 模型写入 openclaw.json 的 models.providers["ollama-local"]，合并不覆盖其它 provider */
export async function writeOllamaProvider(selectedModelName: string): Promise<{ success: boolean; error?: string }> {
  let config: Record<string, unknown> = {};
  try {
    await fs.promises.access(CONFIG_PATH, fs.constants.R_OK);
    const raw = await fs.promises.readFile(CONFIG_PATH, 'utf8');
    config = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // 文件不存在或解析失败，使用空对象
  }
  config = mergeOllamaProviderIntoConfig(config, selectedModelName);
  applyDefaultDiscordChannelStub(config);
  const dir = path.dirname(CONFIG_PATH);
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    return { success: true };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}
