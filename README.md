# HMCL Rewrite (TypeScript)

Hello Minecraft! Launcher 的 TypeScript 重写版：Electron 主进程 + Web 前端，
核心逻辑为框架无关的 `@hmcl/core` 库。

> 状态：**骨架 + 游戏启动/下载核心模块已完成**。账户体系目前仅支持离线登录；
> Forge / Fabric 等加载器安装、微软 OAuth、Java 自动下载尚未实现（见文末路线图）。

## 运行

```bash
pnpm install
pnpm dev        # 开发模式（Electron + Vite HMR）
pnpm build      # 产物输出到 out/
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
└── renderer/  React UI：实例列表 / 版本下载 / 启动日志
```

### 与原版 HMCL 的对应关系

| 本项目 | HMCL (Java) | 忠实度 |
|---|---|---|
| `version/resolve.ts` | `DefaultGameRepositorySnapshot.resolve` + `uniqueLibraries` | 继承折叠(DFS+环检测)、子覆盖父、arguments 拼接、按 `group:artifact`+rules 去重且高版本胜出 |
| `version/library.ts` | `Library` + `CompatibilityRule` | natives classifier 候选序、`${arch}` 替换、rules 最后匹配生效语义 |
| `download/mirrors.ts` | `BMCLAPIDownloadProvider` | URL 前缀替换表(piston-meta→镜像根、libraries→/maven 等) |
| `launch/command.ts` | `DefaultLauncher.generateCommandLine` | 完整占位符表、默认 JVM 参数(G1GC/log4j 加固/编码)、旧新参数格式兼容、Quick Play 与 `--server` 分支 |
| `game/assets.ts` | `GameAssetDownloadTask` | 资产索引下载、content-addressed 对象、pre-1.6 virtual 重建 |
| `java/detect.ts` | Java 工具类 | 常规目录扫描、`-version` 输出解析 |

## 已知限制（后续路线图）

1. **Mod 加载器安装**：Forge/Fabric/NeoForge 安装器未实现（启动已兼容其版本 JSON）。
2. **微软登录**：仅离线档案；OAuth 设备码流程待接入。
3. **Java 自动下载**：目前只做本机检测。
4. **断点续传 / ETag 缓存**：下载器暂用整文件重试。
5. **整合包**：CurseForge/Modrinth 导入待实现。
