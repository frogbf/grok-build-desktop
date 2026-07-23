# Grok Build Desktop

[English](./README.md) · 中文

面向 [Grok Build](https://github.com/xai-org/grok-build) 的社区 **Electron** 桌面客户端。

- **布局** — Codex 风格工作台（侧栏会话 · 主对话 · 检视面板）
- **视觉** — Grok Night：深色单色底 + 品红/紫强调色 + 原创 Singularity 标识
- **运行时** — 官方 `grok` CLI 作为 agent 后端（不在桌面端重写 agent 循环）

> 非官方社区客户端，**与 xAI / SpaceXAI 无隶属关系**。
>
> **品牌说明：** 界面使用原创 “Singularity” 标识（`src/renderer/assets/singularity.svg`）。**请勿**将官方 Grok/xAI logo 或字标作为应用身份标识。产品名称可描述与 Grok Build CLI 的互操作，避免暗示官方背书。

## 技术栈

| 层级 | 技术 |
|------|------|
| 壳层 | Electron 34 |
| 界面 | React 18 + TypeScript + Vite（[electron-vite](https://electron-vite.org/)） |
| Agent | 拉起 `grok`（当前 `-p` / `streaming-json`，后续 ACP） |
| 终端 | `node-pty` + xterm.js |

## 环境要求

- **Node.js** 18+
- **npm**（或兼容包管理器）
- 实时模式可选：[Grok Build CLI](https://x.ai/cli)（`grok`）
- 可选：系统 `PATH` 中的 `git`（分支芯片、Review 面板）

未安装 CLI 时应用仍以 **Demo** 模式运行，可完整体验界面。

## 开发

**必须通过 Electron 启动。** 仅在浏览器打开 Vite 地址时，只有渲染层、没有主进程，不会注入 `window.grokDesktop`。

```bash
cd grok-build-desktop
npm install
npm run dev

# Linux / 无 GPU / 远程桌面等环境推荐：
npm run dev:safe
```

成功时应弹出独立窗口 **Grok Build Desktop**。若用浏览器访问 `http://localhost:5173`，出现「无法连接主进程 / 未注入桌面桥接」属于预期行为。

### 可选：安装 Grok CLI

```bash
# macOS / Linux
curl -fsSL https://x.ai/cli/install.sh | bash

# Windows（PowerShell）
irm https://x.ai/cli/install.ps1 | iex
```

应用内引导页也可在确认后执行官方安装脚本。

## 常用脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | Electron + 热更新 |
| `npm run dev:safe` | 开发态关闭 sandbox 等（更适合 Linux） |
| `npm run build` | 编译 main / preload / renderer |
| `npm run typecheck` | 两端 TypeScript 检查 |
| `npm run rebuild:pty` | 按当前 Electron ABI 重建 `node-pty` |
| `npm run pack` | 构建 + electron-builder `--dir`（未打包目录） |
| `npm run dist` | 构建 + 生成安装包 |

## 打包发布

安装包**按平台区分**。含 `node-pty` 等原生模块时，**建议在目标操作系统上打包**（交叉编译容易出问题）。

```bash
# Windows 上
npm ci
npm run rebuild:pty
npm run dist -- --win

# macOS 上
npm ci
npm run rebuild:pty
npm run dist -- --mac

# Linux 上
npm ci
npm run rebuild:pty
npm run dist -- --linux
```

当前配置目标（见 `package.json` → `build`）：

| 平台 | 产物 |
|------|------|
| Windows | NSIS |
| macOS | DMG |
| Linux | AppImage、deb |

输出目录：`release/`。

## 架构

```
渲染进程 (React)
   ↕ contextBridge（preload）
主进程 IPC
   ↕ child_process / node-pty
grok CLI  (~/.grok/bin/grok)   ← 唯一 agent 后端
   ↕
~/.grok/auth.json              ← 与终端 CLI 共用 OAuth
~/.grok/sessions/              ← 会话列表 / 恢复
```

### 启动状态机

```
检测 CLI → need_cli  （确认后执行官方安装脚本）
        → 检测登录 → need_auth  （拉起 `grok login`）
        → ready → 工作区（仅就绪后可发 prompt）
```

- 桌面端**不实现** OAuth，只编排 `grok login` / `logout`。
- CLI 安装**不会静默执行**，先走系统确认对话框。
- 壳层不包含 agent 循环；对话走官方 `grok -p`（后续 ACP）。

### 关键文件

| 路径 | 职责 |
|------|------|
| `src/main/grok-runtime.ts` | 引导、安装、登录、拉起 CLI |
| `src/main/ipc.ts` | 类型化 IPC |
| `src/main/terminal-manager.ts` | 内嵌 PTY |
| `src/preload/index.ts` | `window.grokDesktop` |
| `src/renderer/components/SetupGate.tsx` | 安装 / 登录界面 |
| `src/renderer/` | 工作区 UI |
| `src/renderer/styles/tokens.css` | 设计 token |

## 已有能力

- 官方 `streaming-json` 对话；从 `~/.grok/sessions` 列会话 / 恢复
- 账号订阅 / 配额 + 头像菜单（语言、缩放、升级链接）
- Git 分支芯片与切换（脏工作区拦截）+ Review 文件级 diff
- 会话搜索（`Ctrl+K` / `⌘K`）
- 思考卡片、工具卡片（来自会话 `updates.jsonl`）
- 底部终端（`node-pty`）、技能页、中英文 i18n

## 路线图

- [ ] 完整 **ACP** 客户端（stdio JSON-RPC），替代一次性 `-p`
- [ ] 运行中权限卡片（协议支持时的批准 / 拒绝）
- [ ] Composer 的 `@` / `/` / `$` 选择器；运行中追问队列
- [ ] 并行 agent 的 worktree 隔离
- [ ] 自动更新 + 打包冒烟测试

## 设计说明

布局与密度参考 **ZCode / Codex 风格** agent 桌面（而非浅色 Home）：

- 扁平炭黑底（`#121212` / 侧栏 `#161616`）
- 空首页：大水印、时段问候、**浮动**输入卡片
- 权限芯片用暖橙色；强调色保持品红 `#c084fc`

## 许可证

[Apache-2.0](./LICENSE)（与 Grok Build 对齐）。品牌标识归其所有者所有——请勿暗示官方背书。
