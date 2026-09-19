# HMCL Rewrite

A TypeScript rewrite of Hello Minecraft! Launcher (HMCL), built with an
Electron main process and a React web frontend. All core logic lives in the
framework-agnostic `@hmcl/core` package, and the UI mirrors the original
HMCL's Material Design look and feel.

This is an independent rewrite built on top of the original GPL-3.0 project.
It is not affiliated with HMCL-dev and contains no official binaries or assets.

> **Status**: The skeleton and game-launch / download core modules are done,
> with offline accounts and one-click launch supported. Loader installers
> (Forge / Fabric / NeoForge), Microsoft OAuth and automatic Java download
> are not implemented yet (see roadmap).

中文版见 [README.zh-CN.md](README.zh-CN.md)。
For the Chinese version, see [README.zh-CN.md](README.zh-CN.md).

---

## Features

- Game version management: version manifest parsing, inheritance folding,
  library deduplication (aligned with the original `resolve` semantics)
- Downloading: concurrent downloader (SHA-1 checksum / retry) with
  BMCLAPI / Mojang mirror switching
- Game directory: `.minecraft` layout, asset index and pre-1.6 virtual rebuild
- Launching: command-line building, natives extraction, offline auth,
  launch orchestration
- UI: instance list / version download / settings / launch log, Material 3
  (monet) theme with background-image and transparent-window support

---

## Getting Started

Requirements: Node.js >= 20 and pnpm.

```bash
pnpm install
pnpm dev        # development mode (Electron + Vite HMR)
pnpm build      # outputs to out/
pnpm start      # preview the build
pnpm typecheck  # strict type-check across all packages
pnpm test       # unit tests (offline)
pnpm test:smoke # smoke tests (require network; exercise the real download path)
```

## Architecture

```
packages/
├── core/      @hmcl/core   core library (Node environment, no UI deps)
│   ├── platform/    OS/architecture detection (Mojang rule-name mapping)
│   ├── version/     version manifest models, inheritance resolution, library dedup, argument evaluation
│   ├── download/    concurrent downloader (SHA-1 checksum/retry) + mirrors (BMCLAPI/Mojang)
│   ├── game/        .minecraft layout, asset index & virtual-asset rebuild
│   ├── launch/      command-line building, natives extraction, offline auth, launch orchestration
│   └── java/        Java runtime scanning & version parsing
├── shared/    @hmcl/shared IPC contract types (main ↔ renderer)
├── main/      Electron main process: settings persistence, IPC handlers, launch management
├── preload/   contextBridge exposing a typed window.hmcl API
└── renderer/  React UI: instance list / version download / settings / launch log
```

### Correspondence with original HMCL

| This repo | HMCL (Java) | Fidelity |
|---|---|---|
| `version/resolve.ts` | `DefaultGameRepositorySnapshot.resolve` + `uniqueLibraries` | inheritance folding (DFS + cycle detection), child overrides parent, argument concatenation, dedup by `group:artifact` + rules with higher versions winning |
| `version/library.ts` | `Library` + `CompatibilityRule` | natives classifier candidate order, `${arch}` substitution, last-match-wins rules semantics |
| `download/mirrors.ts` | `BMCLAPIDownloadProvider` | URL prefix rewrite table (piston-meta → mirror root, libraries → /maven, etc.) |
| `launch/command.ts` | `DefaultLauncher.generateCommandLine` | full placeholder table, default JVM args (G1GC/log4j hardening/encoding), old & new argument-format compatibility, Quick Play and `--server` branches |
| `game/assets.ts` | `GameAssetDownloadTask` | asset index download, content-addressed objects, pre-1.6 virtual rebuild |
| `java/detect.ts` | Java utility classes | common directory scanning, `-version` output parsing |

---

## Known Limitations (Roadmap)

1. **Loader installers**: Forge / Fabric / NeoForge installers not implemented
   (launch already handles their version JSON).
2. **Microsoft login**: offline-only; device-code OAuth flow pending.
3. **Automatic Java download**: only local detection for now.
4. **Resume / ETag caching**: the downloader retries whole files.
5. **Modpacks**: CurseForge / Modrinth import pending.

---

## License

This project is licensed under the **[GPL-3.0](/LICENSE)** License, matching the
original HMCL project.