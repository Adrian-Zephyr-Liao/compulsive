# Compulsive

[English](./README.md) · 简体中文

Compulsive 是一个面向 macOS 的本地 Git 项目管理工具。它提供 `cpl` 命令和可复用的
TypeScript API，用于按规则克隆项目、登记已有仓库、快速查找仓库，以及安全整理目录。
同一个仓库还可以加入多个 Workspace，并按需选择共享 checkout 的链接模式或隔离分支的
Git worktree 模式。

## 安装

```bash
npm install --global @adrian-zephyr/compulsive
cpl init
```

首次初始化时可以指定管理根目录：

```bash
cpl init --root /Users/your-name/Code
```

初始化操作是幂等的。重复执行不会覆盖现有根目录或仓库索引。

## 目录规则

远程仓库按照主机、所有者路径和仓库名称分类：

```text
/Users/your-name/Code/github.com/vuejs/core
/Users/your-name/Code/gitlab.com/group/subgroup/project
```

没有 `origin` 远程地址的仓库使用 `local/<repository>` 逻辑分类。在明确确认
`cpl organize` 之前，仓库始终保留在原位置。

## 命令

```bash
cpl clone https://github.com/vuejs/core.git
cpl add /Users/your-name/Projects/my-local-tool
cpl scan /Users/your-name/Projects
cpl scan /Users/your-name/Projects --register
cpl list
cpl list core --json
cpl search core
cpl search core --json
cpl search frontend --workspace Product
cpl go core
cpl organize my-local-tool --dry-run
cpl organize my-local-tool --yes
cpl organize --all --dry-run
cpl organize --all --yes
cpl forget my-local-tool --yes
cpl doctor
```

`clone`、`go` 和执行成功的 `organize` 会把安全转义后的 `cd -- 'path'` 命令复制到
macOS 剪贴板并打印出来。剪贴板不可用时只会显示警告，不会把成功的 Git 操作判定为失败。

`scan` 默认只预览，只有传入 `--register` 才会登记仓库。`forget` 仅删除索引记录，绝不
删除仓库文件。

在交互终端中直接运行 `cpl`，会打开支持键入过滤的仓库与 Workspace 混合选择器；
`cpl search` 只搜索仓库，`cpl workspace` 只搜索 Workspace。选择目标后会复制并打印安全的
`cd` 命令。脚本和管道环境不会显示交互提示。

批量迁移时，先登记扫描结果，再统一预演全部目标路径：

```bash
cpl scan /Users/your-name/Projects --register
cpl organize --all --dry-run
cpl organize --all --yes
```

`organize --all` 会在移动前预检所有已登记仓库。任意仓库存在目标冲突时，不会开始移动；
执行过程中遇到意外文件系统错误时会停止处理后续仓库。批量模式不会反复覆盖剪贴板。

## Workspace

Workspace 是相关项目的组合目录，不改变仓库的规范存储位置。默认目录是仓库管理根目录的
同级 `Workspaces`，例如 `/Users/your-name/Code` 对应
`/Users/your-name/Workspaces`。

链接模式是默认选择。同一个 canonical 仓库可以同时加入多个 Workspace，各处共享当前
分支、未提交修改和构建文件：

```bash
cpl workspace create Product
cpl workspace create Platform
cpl workspace add Product api
cpl workspace add Platform api --alias shared-api
cpl workspace list
cpl workspace show Product
cpl workspace go Product
cpl search shared --workspace Platform
```

需要独立分支和工作目录时，显式使用 Git worktree。复用现有分支：

```bash
cpl workspace add Product web --worktree --branch feature/product-web
```

创建新分支必须同时提供 `--create-branch`，分支名会严格使用 `--branch` 的原值：

```bash
cpl workspace add Product worker \
  --worktree \
  --branch feature/product-worker \
  --create-branch
```

常用维护命令：

```bash
cpl workspace sync Product
cpl workspace remove Product api --yes
cpl workspace delete Product --yes
```

`workspace remove` 和 `workspace delete` 只删除由 Compulsive 管理的精确链接或干净 worktree，
绝不删除 canonical 仓库。脏 worktree、意外文件、目录或被替换的链接都会阻止操作；
Workspace 中无关的用户文件会原样保留。`workspace` 可以缩写为 `ws`。

## 配置文件

Compulsive 支持类似 unbuild 的项目配置。在运行 `cpl` 的目录中创建
`compulsive.config.ts`：

```ts
export default {
  rootDir: "/Users/your-name/Code",
  workspaceRoot: "/Users/your-name/Workspaces",
  scanRoots: ["/Users/your-name/Projects"],
  ui: {
    color: "auto", // auto | always | never
    unicode: true,
  },
};
```

配置由 `c12` 加载，支持 TypeScript、JavaScript、JSON 和 JSONC。如果项目中也安装了
Compulsive，可以使用带类型提示的辅助函数：

```ts
import { defineConfig } from "@adrian-zephyr/compulsive";

export default defineConfig({
  rootDir: "/Users/your-name/Code",
  workspaceRoot: "/Users/your-name/Workspaces",
  scanRoots: ["/Users/your-name/Projects"],
  ui: { color: "auto", unicode: true },
});
```

通过 `cpl --config <path> <command>` 可以指定任意配置文件，`cpl config file` 用于查看
当前生效的文件。配置文件为首次初始化和终端主题提供默认值，不会静默覆盖已经初始化的
仓库索引。适用时，`--root`、`--color` 和 `--no-color` 的优先级更高。

TypeScript 和 JavaScript 配置会被 Node.js 执行，因此只能使用可信配置。如果不需要执行
代码，建议使用 `compulsive.config.jsonc`。

持久化设置也可以通过命令直接管理：

```bash
cpl config show
cpl config file
cpl config set-root /Users/your-name/Code
cpl config set-workspace-root /Users/your-name/Workspaces
cpl config add-scan-root /Users/your-name/Projects
cpl config remove-scan-root /Users/your-name/Projects
```

在 macOS 上，状态保存在 `/Users/your-name/Library/Application Support/compulsive`。
自动化和隔离测试可以通过 `CPL_HOME` 修改应用数据目录。

## 终端体验

人类可读输出包含紧凑的仓库卡片、状态符号、彩色诊断、交互选择、确认提示和加载动画。
颜色会在非 TTY 环境中自动关闭，并遵循 `NO_COLOR`；也可以使用 `--color` 或
`--no-color` 强制指定。`--json` 始终输出单个纯 JSON 值，不包含提示、动画或 ANSI
控制字符。

CLI 使用职责单一的轻量工具：`mri` 负责参数解析，`picocolors` 负责 ANSI 样式，
`@clack/prompts` 负责交互，`c12` 负责现代配置加载。

## 结构化输出与退出码

支持 `--json` 的命令会把一个 JSON 值写入 stdout，并把诊断信息写入 stderr。

| 退出码 | 含义                     |
| -----: | ------------------------ |
|    `0` | 成功                     |
|    `2` | 输入、远程地址或配置错误 |
|    `3` | 未找到仓库               |
|    `4` | 匹配歧义或路径冲突       |
|    `5` | Git 或文件系统失败       |

## 库 API

```ts
import { createRepositoryManager } from "@adrian-zephyr/compulsive";

const manager = createRepositoryManager();
await manager.initialize({ rootDir: "/Users/your-name/Code" });

const repository = await manager.clone({
  remote: "git@github.com:vuejs/core.git",
});

console.log(repository.absolutePath);
```

包同时提供 ESM、CommonJS 入口和 TypeScript 类型声明。公开操作会抛出
`CompulsiveError`，其中 `code` 是稳定且可供程序读取的错误码。

## 安全模型

- Git 始终通过参数数组启动，不拼接 shell 命令。
- 远程地址写入索引前会移除凭据。
- 扫描不会进入仓库内部、`node_modules`、构建产物目录或符号链接。
- 整理操作会拒绝目标占用、嵌套仓库、过期路径和跨磁盘移动。
- 移动后必须重新验证为 Git 仓库，才会更新索引。
- Workspace link 在仓库移动后会自动同步；路径冲突时保留用户内容并返回诊断。
- Workspace 删除只移除受管链接和干净 worktree，绝不删除 canonical 仓库。
- `forget` 和仓库整理流程都不会删除仓库目录。

## 开发

Compulsive 使用 Vite+：

```bash
vp install
vp check
vp test --run
vp pack --publint --attw
```

## 许可证

MIT
