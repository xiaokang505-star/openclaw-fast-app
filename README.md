# OpenClaw 安装助手

帮助用户在电脑上快速安装与配置 [OpenClaw](https://docs.openclaw.ai/setup) 的 Electron 桌面应用。

## 功能概览

- **安装引导模式**：按步骤检测环境（Node、npm、OpenClaw、网关、配置），引导用户完成安装与配置。
- **必备设置菜单**：配置 Node 环境地址、npm 源地址、OpenClaw 包等，支持环境恢复与自定义。
- **免费本地模型（规划中）**：通过 electron-ollama 与 Ollama 适配器，支持纯本地、零成本的 OpenClaw 使用方式。

详见 [doc/00-项目分析与规划.md](doc/00-项目分析与规划.md) 与 [doc/01-执行方案.md](doc/01-执行方案.md)。**多 Ollama 算力分布（规划）**：[doc/03-llv-ollama-算力分布方案.md](doc/03-llv-ollama-算力分布方案.md)。

## 环境要求

- Node.js 24+
- npm 或 pnpm

## 开发

```bash
# 安装依赖
npm install

# 先构建 Vue 渲染进程，再编译主进程，最后启动 Electron
npm start
```

**命令顺序**：所有构建与启动均按「先 Vue，再 Electron」执行：

- `npm run build:renderer`：仅构建 Vue 渲染进程（输出到 `dist/renderer`）。
- `npm run build`：先执行 `build:renderer`，再执行 `tsc`（主进程与 preload）。
- `npm start` / `npm run dev`：先执行 `build:renderer`，再 `tsc`，最后 `electron .`。

仅改 Vue 时执行 `npm run build:renderer` 后重新 `npm start`；仅改主进程/preload 时执行 `tsc` 后重新 `npm start`。

## 项目结构

```
openclaw-exe/
├── doc/                 # 规划与执行文档
├── src/
│   ├── main/            # Electron 主进程（TypeScript）
│   ├── preload/         # 预加载脚本，暴露安全 API 给渲染进程
│   └── renderer/        # 渲染进程：Vue 3 + Vite
│       ├── index.html   # Vite 入口
│       ├── vite.config.ts
│       └── src/
│           ├── main.ts  # Vue 入口
│           ├── App.vue
│           ├── styles.css
│           └── env.d.ts # 类型与全局声明
├── dist/                # 编译输出（main、preload、renderer）
├── package.json
└── tsconfig.json
```

## 打包

```bash
npm run build
npm run dist   # 生成安装包到 release/
```

## 许可

MIT
