# Ollama 加速说明

## 本应用已做的优化

1. **请求参数**（`src/main/ollama-chat.ts`）  
   - 直连 Ollama 时自动带上 `options`：`num_ctx=8192`、`num_predict=2048`，减小上下文和单次生成长度，加快推理。
2. **对话历史**  
   - 仅将最近 20 条消息发给模型，避免 prompt 过大（此前可能达到 5 万+ token）。

## 系统与环境

- **GPU**：Mac 上 Ollama 会用 Metal，首次跑某模型会编译 kernel，之后会快很多。
- **线程数**：  
  `export OLLAMA_NUM_THREADS=8`（按 CPU 核心数调整），再启动 Ollama。
- **保持更新**：  
  `ollama update` 或从 [ollama.com](https://ollama.com) 安装最新版。

## 模型选择

- 用**小一点或量化更好的模型**：如 `llama3.2:3b`、`qwen2.5:3b`、`phi3` 等，比 7B/8B 更快。
- 量化：同模型下 Q4 比 Q8 更快、更省显存。

## 本机限制上下文（可选）

若不需要很长上下文，可在启动 Ollama 时限制上下文长度以提速：

```bash
OLLAMA_CONTEXT_LENGTH=8192 ollama serve
```

或在运行模型时：

```bash
ollama run llama3.2 --ctx-size 8192
```

（本应用直连时已在请求里传 `num_ctx=8192`，一般无需再设。）

## 检查是否在用 GPU

```bash
ollama ps
```

若模型在用 Metal/GPU，会显示 GPU 占用；若几乎只有 CPU，说明未用上 GPU，可检查显卡驱动与 Ollama 版本。
