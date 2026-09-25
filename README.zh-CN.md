# Ming

**放心地评审 AI 编写的代码。**

AI 编程助手可以一次改动整个仓库。Ming 将真实的本地 diff 变成聚焦、由人主导的评审，让你在决定保留哪些改动之前看清它们。它运行在浏览器中，不需要 Ming 账号或应用服务器。

[简体中文](README.zh-CN.md) · [English](README.md)

## 为什么需要 Ming

AI 生成的摘要告诉你它打算做什么；Ming 展示它实际改了什么，将改动整理成可以逐项判断的主题，并让每个判断始终对应具体 diff。

### 项目亮点

- **从 AI 总结走向代码证据。** Ming 将庞杂的 diff 整理成按目的划分的评审主题，每个主题都对应具体代码和检查要点。哪些已经评审、哪些需要再看、哪些未被 AI 分类，都由你决定。
- **知道何时该重新评审。** Ming 打开期间会同步本地改动。diff 变化后，旧主题仍可查看，但会标记为过期，直到你重新生成。简短的 AI 标题也会在后台生成，不打断当前工作。
- **保留最终决定权，也掌握自己的代码。** Ming 只读取仓库，不修改文件；项目与评审保存在浏览器中。Rust/WebAssembly harness 负责规划和校验 AI 任务；只有下文所述的任务会从浏览器直接向 DeepSeek 发送代码。

## 快速开始

在近期版本的 Chromium 系浏览器中打开 [Ming](https://yorkie.github.io/ming/)。Ming 让你直接在浏览器中评审本地 Git 仓库：查看真实 diff、按需整理成 AI 主题，并记录评审决定。无需安装或注册 Ming 账号；浏览器询问时授予文件夹访问权限即可。

1. 点击 **Add project**，选择包含 `.git` 目录的本地 Git 仓库根目录，并授予读取权限。
2. 打开 **Reviews**。新项目默认开启实时更新，也可点击 **Scan changes** 手动刷新。默认与当前分支的本地远端跟踪引用比较；需要时可在项目设置中选择其他比较引用。
3. 查看 **Changes** 和 **Commits**。如需使用 **Topics**，先在 **MING Console → Copilot** 配置 DeepSeek API 密钥，再点击 **Generate AI topics**。主题生成需要手动启动。
4. 对照 diff 逐项评审主题，并标记为已评审或需要再看。diff 更新后，旧主题仍会显示，但会标记为过期，直到你重新生成。

### 适合这些场景

**AI 刚完成一轮编码：** 扫描工作区、查看改动文件，再生成主题，集中评审相关修改。每个主题都能回到需要核查的代码。

**代码还在持续变化：** Agent 或同事修改本地仓库时保持 Ming 页面打开。实时更新会刷新评审；过期提示会告诉你哪些旧主题需要重新检查。

**分享分支之前：** 将当前分支与远端跟踪引用或其他目标比较。用 **Commits** 理解历史、用 **Changes** 检查 diff、用 **Topics** 记录评审进度。

界面支持中文和英文。项目与评审页面的 URL 可以分享，但其他浏览器或浏览器配置文件仍需单独添加本地仓库并授予文件夹权限。

## 工作原理

| 部分 | 职责 |
| --- | --- |
| File System Access API + `isomorphic-git` | 读取本地仓库、工作区和本地已有的 Git 引用 |
| 扫描与 AI Worker | 在 UI 线程之外执行 Git 检查和模型请求 |
| 编译为 WebAssembly 的 Rust `ming-core` | 解析 diff、计算快照哈希、规划有界 AI 任务并校验模型输出 |
| IndexedDB | 保存项目句柄、每组分支对应的评审、主题、评审状态和 AI 用量 |
| Vue 3 | 展示文件、差异、主题、后台任务和 MING Console |

Ming 不会执行 Git fetch、push、commit、checkout，也不会修改仓库文件。它不需要自己的后端。Jev 加速是后续设计方向，目前尚未接入。

### 隐私与 AI 请求

DeepSeek API 密钥保存在当前浏览器的 local storage。配置密钥后，**扫描到变化的 diff 会自动将有界的差异上下文从浏览器直接发送给 DeepSeek，用于生成评审标题**。**只有你手动启动或重新启动主题任务时，已保存的 diff 才会发送给 DeepSeek 用于生成主题。** Ming 不会把仓库内容上传到 Ming 服务器。从 Ming 移除项目只会删除浏览器中的记录，不会删除磁盘上的仓库。

## 构建与贡献

如需在本地运行 Ming，请安装 Node.js、带有 `wasm32-unknown-unknown` 目标的 Rust 和 `wasm-pack`。浏览器需支持 File System Access API；选择文件夹需要 localhost 或 HTTPS。

```sh
npm ci
rustup target add wasm32-unknown-unknown
npm run build:wasm
npm run dev
```

```sh
npm run check
npm run build
```

`npm run build` 会在 `dist/` 生成静态站点。静态托管服务应为 `/projects/`、`/console/` 等前端路由提供 `index.html`。仓库中的 [GitHub Pages 工作流](.github/workflows/deploy-pages.yml) 会为这些路由准备可直接访问的入口文件。

请保持仓库访问只读，并为 Git 检查、持久化或 Rust 任务行为的改动添加有针对性的测试。

## 当前限制

- 仓库必须包含 `.git` **目录**；使用 `.git` 文件的关联工作树暂不支持。
- 单次扫描最多处理 200 个改动文件，扫描 500 个目录后会停止。二进制文件和超过 2 MB 的文本文件不会生成文本 diff。
- Markdown Rich diff 要求前后文本总计不超过 1 MB。文件预览仅支持 UTF-8 文本，大小上限可配置。
- 提交比较只读取本地远端跟踪引用；Ming 不会连接 Git 远端刷新引用。
- 文件夹权限和 IndexedDB 数据属于当前浏览器配置文件与站点来源。实时更新只在 Ming 页面打开期间运行。
- AI 主题只是评审辅助，不代表正确性结论。大型 diff 可能超出 AI 上下文预算；完整的本地差异仍可在 **Changes** 中查看。

## 许可证

Ming 采用 [MIT 开源协议](LICENSE)。
