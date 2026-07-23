# Grok Build Desktop

[中文](./README.zh-CN.md) · English

Community **Electron** desktop GUI for [Grok Build](https://github.com/xai-org/grok-build).

- **Layout** — Codex-style command center (sidebar threads · main chat · inspector)
- **Look** — Grok Night: deep monochrome, magenta/violet accent, original Singularity mark
- **Runtime** — Official `grok` CLI as the agent backend (no reimplemented agent loop)

> Unofficial community client. **Not affiliated with xAI / SpaceXAI.**
>
> **Branding:** The UI uses an original “Singularity” mark (`src/renderer/assets/singularity.svg`). Do **not** ship official Grok/xAI logos or wordmarks as the app identity. The product name may describe interoperability with the Grok Build CLI; avoid implying official endorsement.

## Stack

| Layer | Tech |
|-------|------|
| Shell | Electron 34 |
| UI | React 18 + TypeScript + Vite ([electron-vite](https://electron-vite.org/)) |
| Agent | Spawn `grok` (`-p` / `streaming-json` today → ACP planned) |
| Terminal | `node-pty` + xterm.js |

## Requirements

- **Node.js** 18+
- **npm** (or compatible package manager)
- Optional for live mode: [Grok Build CLI](https://x.ai/cli) (`grok`)
- Optional: `git` on `PATH` (branch chip, Review panel)

Without the CLI, the app still runs in **Demo** mode so you can exercise the full UI.

## Develop

**Always start via Electron.** Opening only the Vite URL in a browser will show the UI without the main process (no `window.grokDesktop` bridge).

```bash
cd grok-build-desktop
npm install
npm run dev

# Linux / headless / no-GPU environments:
npm run dev:safe
```

A standalone **Grok Build Desktop** window should open. If you open `http://localhost:5173` in a browser instead, missing-bridge errors are expected.

### Optional: install Grok CLI

```bash
# macOS / Linux
curl -fsSL https://x.ai/cli/install.sh | bash

# Windows (PowerShell)
irm https://x.ai/cli/install.ps1 | iex
```

The in-app setup gate can also run the official install script after confirmation.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Electron + HMR |
| `npm run dev:safe` | Dev with no-sandbox / safer GPU flags (Linux-friendly) |
| `npm run build` | Compile main / preload / renderer |
| `npm run typecheck` | Typecheck both TS projects |
| `npm run rebuild:pty` | Rebuild `node-pty` for the current Electron ABI |
| `npm run pack` | Build + electron-builder `--dir` (unpacked app) |
| `npm run dist` | Build + platform installers |

## Packaging

Installers are **platform-specific**. Prefer building **on the target OS** (native modules such as `node-pty` do not cross-compile cleanly).

```bash
# On Windows
npm ci
npm run rebuild:pty
npm run dist -- --win

# On macOS
npm ci
npm run rebuild:pty
npm run dist -- --mac

# On Linux
npm ci
npm run rebuild:pty
npm run dist -- --linux
```

Configured targets (see `package.json` → `build`):

| Platform | Targets |
|----------|---------|
| Windows | NSIS |
| macOS | DMG |
| Linux | AppImage, deb |

Output directory: `release/`.

## Architecture

```
Renderer (React)
   ↕ contextBridge (preload)
Main process IPC
   ↕ child_process / node-pty
grok CLI  (~/.grok/bin/grok)   ← single agent backend
   ↕
~/.grok/auth.json              ← shared OAuth with the terminal CLI
~/.grok/sessions/              ← session list / resume
```

### Bootstrap

```
Detect CLI → need_cli  (confirm → official install script)
          → Check auth → need_auth  (spawn `grok login`)
          → ready → workspace (prompts only when ready)
```

- Desktop **does not** implement OAuth; it orchestrates `grok login` / `logout`.
- CLI install is **never silent** — a native confirm dialog runs first.
- No agent loop in the shell; prompts go to official `grok -p` (ACP next).

### Key files

| Path | Role |
|------|------|
| `src/main/grok-runtime.ts` | Bootstrap, install, login, spawn |
| `src/main/ipc.ts` | Typed IPC handlers |
| `src/main/terminal-manager.ts` | Embedded PTY sessions |
| `src/preload/index.ts` | `window.grokDesktop` |
| `src/renderer/components/SetupGate.tsx` | Install / login UI |
| `src/renderer/` | Workspace UI |
| `src/renderer/styles/tokens.css` | Design tokens |

## Features (current)

- Official `streaming-json` chat; session list / resume from `~/.grok/sessions`
- Account subscription / quota + avatar menu (language, zoom, upgrade links)
- Git branch chip + switch (blocked when dirty) + file-level diff in Review
- Session search (`Ctrl+K` / `⌘K`)
- Thought cards + tool cards (from session `updates.jsonl`)
- Terminal dock (`node-pty`), Skills page, i18n (zh / en)

## Roadmap

- [ ] Full **ACP** client (stdio JSON-RPC) instead of one-shot `-p`
- [ ] In-run permission cards (Approve / Deny) when the protocol exposes them
- [ ] Composer `@` / `/` / `$` pickers; follow-up queue while running
- [ ] Worktree isolation for parallel agents
- [ ] Auto-update + packaging smoke tests

## Design notes

Layout and density follow **ZCode / Codex-style** agent desktops (not a light “home” shell):

- Flat charcoal base (`#121212` / sidebar `#161616`)
- Empty home: large watermark, time-of-day greeting, **floating** composer
- Permission chip uses warm orange; accent remains magenta `#c084fc`

## License

[Apache-2.0](./LICENSE) (aligned with Grok Build). Brand marks belong to their owners — do not imply official endorsement.
