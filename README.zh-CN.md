# HMCL Rewrite

Hello Minecraft! Launcher (HMCL) 的 TypeScript 重写版：Electron 主进程 + Web 前端，
核心逻辑位于框架无关的 `@hmcl/core` 库，UI 与交互尽量贴合原版 HMCL 的
Material Design 风格。

本项目是原版 GPL-3.0 项目基础上的独立重写实现，与 HMCL-dev 官方无隶属关系，
不包含任何官方二进制或资源文件。

> **状态**：骨架 + 游戏启动 / 下载核心模块已完成，支持离线账户与一键启动。
> 加载器安装（Forge / Fabric / NeoForge）、微软 OAuth、Java 自动下载尚未实现
> （见路线图）。

英文版见 [README.md](README.md)。
For the English version, see [README.md](README.md)。

---

## 功能

- 游戏版本管理：版本清单解析、继承折叠、库去重（对齐原版 `resolve` 语义）
- 文件下载：并发下载器（SHA-1 校验 / 失败重试）+ BMCLAPI / Mojang 镜像切换
- 游戏目录：`.minecraft` 布局、资产索引与 pre-1.6 virtual 重建
- 启动：命令行构建、natives 解压、离线认证、启动编排
- UI：实例列表 / 版本下载 / 设置 / 启动日志，Material 3（monet）主题，
  支持背景图与透明窗口模式

---

## 运行

要求：Node.js ≥ 20 与 pnpm。

```bash
pnpm install
pnpm dev        # 开发模式（Electron + Vite HMR）
pnpm build      # 产物输出到 out/
pnpm start      # 预览构建产物
pnpm typecheck  # 全部包严格类型检查
pnpm test       # 单元测试（离线）
pnpm test:smoke # 冒烟测试（需要网络，验证真实下载链路）
```

## 架构

```
packages/
├── core/      @hmcl/core   核心库（Node 环境，无 UI 依赖）
│   ├── platform/    OS/架构检测（Mojang 规则名映射）
│   ├── version/     版本清单模型、继承解析、库去重、参数求值
│   ├── download/    并发下载器（SHA-1 校验/重试）+ 镜像(BMCLAPI/Mojang)
│   ├── game/        .minecraft 目录布局、资产索引与虚拟资产重建
│   ├── launch/      命令行构建、natives 解压、离线认证、启动编排
│   └── java/        Java 运行时扫描与版本解析
├── shared/    @hmcl/shared IPC 契约类型（主进程 ↔ 渲染端）
├── main/      Electron 主进程：设置持久化、IPC handler、启动管理
├── preload/   contextBridge 暴露类型化 window.hmcl API
└── renderer/  React UI：实例列表 / 版本下载 / 设置 / 启动日志
```

### 与原版 HMCL 的对应关系

| 本项目 | HMCL (Java) | 忠实度 |
|---|---|---|
| `version/resolve.ts` | `DefaultGameRepositorySnapshot.resolve` + `uniqueLibraries` | 继承折叠（DFS+环检测）、子覆盖父、arguments 拼接、按 `group:artifact`+rules 去重且高版本胜出 |
| `version/library.ts` | `Library` + `CompatibilityRule` | natives classifier 候选序、`${arch}` 替换、rules 最后匹配生效语义 |
| `download/mirrors.ts` | `BMCLAPIDownloadProvider` | URL 前缀替换表（piston-meta→镜像根、libraries→/maven 等） |
| `launch/command.ts` | `DefaultLauncher.generateCommandLine` | 完整占位符表、默认 JVM 参数（G1GC/log4j 加固/编码）、旧新参数格式兼容、Quick Play 与 `--server` 分支 |
| `game/assets.ts` | `GameAssetDownloadTask` | 资产索引下载、content-addressed 对象、pre-1.6 virtual 重建 |
| `java/detect.ts` | Java 工具类 | 常规目录扫描、`-version` 输出解析 |

---

## 已知限制（后续路线图）

1. **Mod 加载器安装**：Forge / Fabric / NeoForge 安装器未实现（启动已兼容其版本 JSON）。
2. **微软登录**：仅离线档案；OAuth 设备码流程待接入。
3. **Java 自动下载**：目前只做本机检测。
4. **断点续传 / ETag 缓存**：下载器暂用整文件重试。
5. **整合包**：CurseForge / Modrinth 导入待实现。

---

## 开源协议

本项目以 **[GPL-3.0](/LICENSE)** 协议开源（与原版 HMCL 一致）。