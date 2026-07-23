# Grok Build Desktop

Community **Electron** GUI for [Grok Build](https://github.com/xai-org/grok-build).

- **Layout**: Codex-style command center (sidebar threads · main chat · inspector)
- **Look**: Grok Night — deep monochrome + magenta/violet accent + singularity mark
- **Runtime**: official `grok` CLI as backend (no reimplemented agent loop)

> Unofficial community client. Not affiliated with xAI / SpaceXAI.
>
> **Branding:** The UI uses an original “Singularity” mark (accretion disk / event horizon SVG in `src/renderer/assets/singularity.svg`). Do **not** ship official Grok/xAI logos or wordmarks as the app identity. Product name may describe interoperability with Grok Build CLI; avoid implying official endorsement.

## Stack

| Layer | Tech |
|-------|------|
| Shell | Electron 34 |
| UI | React 18 + TypeScript + Vite (electron-vite) |
| Agent | spawn `grok` (`-p` / stream-json today → ACP next) |

## Develop

**必须用 Electron 启动**，不要只在浏览器打开 Vite 地址。

```bash
cd grok-build-desktop
npm install
npm run dev
# Linux / 无 GPU 环境推荐：
npm run dev:safe
```

成功时会弹出 **独立桌面窗口**（Grok Build Desktop）。  
若浏览器访问 `http://localhost:5173`，页面能显示 UI，但 **没有主进程**，会提示「无法连接主进程 / 未注入桌面桥接」——这是预期行为。

Requires Node 18+. Optional: install Grok CLI for live mode:

```bash
curl -fsSL https://x.ai/cli/install.sh | bash
```

Without CLI, the app runs in **Demo** mode and still exercises the full UI.

## Architecture

```
Renderer (React)
   ↕ contextBridge preload
Main process IPC
   ↕ child_process
grok CLI  (~/.grok/bin/grok)   ← single agent backend
   ↕
~/.grok/auth.json              ← shared OAuth with terminal CLI
```

### Bootstrap state machine

```
DetectCLI → need_cli (confirm → official install script)
         → CheckAuth → need_auth (spawn `grok login`)
         → ready → workspace (prompt only when ready)
```

- Desktop **does not** implement OAuth; it orchestrates `grok login` / `logout`.
- CLI install is **never silent** — native confirm dialog first.
- No agent loop in the shell; prompts go to official `grok -p` (ACP next).

Key files:

- `src/main/grok-runtime.ts` — bootstrap, install, login, spawn
- `src/main/ipc.ts` — typed IPC handlers
- `src/preload/index.ts` — `window.grokDesktop`
- `src/renderer/components/SetupGate.tsx` — install/login UI
- `src/renderer/` — ZCode-style workspace

## Design notes

Layout and density are modeled after **ZCode / Codex-style** agent desktops (not Claude’s light Home):

- Flat charcoal `#121212` / sidebar `#161616` — no purple wash
- Left: 新建任务 / 搜索 / 技能 · 项目分组线程 · 相对时间
- Center empty: large watermark + 时段问候 + **floating** composer card
- Composer toolbar: `+` · 权限模式(暖橙「完全访问」) · 模型 · 强度 · 圆形发送
- Inspector only appears after a run (not on home)

Tokens: `src/renderer/styles/tokens.css`  
Grok accent remains magenta `#c084fc`; permission chip uses ZCode-like warm orange.

## Roadmap

### Done (v0.1 → v0.2)

- [x] Official `streaming-json` chat + session list / resume from `~/.grok/sessions`
- [x] Real account subscription / quota + avatar user menu (language, zoom, upgrade)
- [x] Git branch chip + switch (dirty-blocked) + file-level diff in Review
- [x] Session search (`Ctrl+K`)
- [x] Thought cards + tool cards (from `updates.jsonl`)
- [x] Terminal dock (`node-pty`), Skills page, i18n zh/en

### Next

- [ ] Full **ACP** client (stdio JSON-RPC) instead of one-shot `-p`
- [ ] In-run permission cards (Approve / Deny) when protocol exposes them
- [ ] Composer `@` / `/` / `$` pickers; follow-up queue while running
- [ ] Worktree isolation for parallel agents
- [ ] Auto-update + packaging smoke tests

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Electron + HMR |
| `npm run build` | Compile main/preload/renderer |
| `npm run typecheck` | `tsc` both projects |
| `npm run dist` | electron-builder packages |

## License

Apache-2.0 (aligned with Grok Build). Brand marks belong to their owners — do not imply official endorsement.
