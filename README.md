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
| `npm run icons:ico` | Generate `resources/icon.ico` from PNGs (Windows) |
| `npm run pack` | Build + electron-builder `--dir` (unpacked app) |
| `npm run pack:win` | Unpacked Windows app dir only |
| `npm run dist` | Build + platform installers |
| `npm run dist:win` | Windows NSIS + portable (`x64`; rebuilds pty + ico) |
| `npm run dist:mac` | macOS DMG |
| `npm run dist:linux` | Linux AppImage + deb |

## Packaging

Installers are **platform-specific**. Prefer building **on the target OS** (native modules such as `node-pty` do not cross-compile cleanly).

```bash
# On Windows (recommended one-shot)
npm ci
npm run dist:win

# On macOS
npm ci
npm run dist:mac

# On Linux
npm ci
npm run dist:linux
```

### GitHub Actions (remote multi-platform)

No local Mac/Linux machine required. CI builds each OS on its native runner:

| Trigger | What runs |
|---------|-----------|
| **Actions → Build → Run workflow** | Manual build (`platforms`: `all` / `win` / `mac` / `linux`) |
| **Push tag `v*`** (e.g. `v0.1.1`) | Win + Mac + Linux → draft **GitHub Release** with artifacts |
| **Pull request** | Typecheck only |

1. Push this repo to GitHub (enable Actions).
2. Open **Actions** → **Build** → **Run workflow** (or `git tag v0.1.1 && git push origin v0.1.1`).
3. Download **Artifacts** from the finished run (`windows-x64`, `macos`, `linux`), or publish the draft Release.

Builds are **unsigned** by default (`CSC_IDENTITY_AUTO_DISCOVERY=false`). macOS may show “unidentified developer”; Windows may show SmartScreen. Code signing secrets can be added later.

Workflow file: [`.github/workflows/build.yml`](./.github/workflows/build.yml).

### Windows notes

| Topic | Detail |
|-------|--------|
| **Build tools** | Visual Studio **Build Tools** (C++ workload) + Python are required to rebuild `node-pty` |
| **Targets** | **NSIS** installer + **portable** `.exe` (x64) |
| **Icons** | `npm run icons:ico` writes multi-size `resources/icon.ico` (also run by `dist:win`) |
| **Shell integration** | `appId` / `AppUserModelId` = `com.community.grok-build-desktop`; single-instance focus |
| **Code signing** | Not configured yet. Unsigned builds may trigger SmartScreen (“Unknown publisher”) |
| **Auto-update** | Not wired yet (see Roadmap) |
| **Runtime deps** | App does **not** bundle the Grok CLI; install via setup gate or [x.ai/cli](https://x.ai/cli) |

Configured targets (see `package.json` → `build`):

| Platform | Targets |
|----------|---------|
| Windows | NSIS, portable (x64) |
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
