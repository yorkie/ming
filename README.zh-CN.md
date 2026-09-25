# Ming

**按主题审查每一次真实改动。**

Ming 是一个在浏览器中运行的本地 Git 代码评审工作台。它将大段工作区差异整理成可逐项检查的主题，让每个主题始终关联原始代码，并记录你的评审进度。仓库保留在你的电脑上；使用 Ming 不需要账号或应用服务器。

[简体中文](README.zh-CN.md) · [English](README.md)

## 为什么需要 Ming

AI 编程助手可能一次修改几十个文件。它对意图的总结有帮助，但是否保留这些改动，仍要看实际 diff。Ming 为这一步提供独立的工作流：比较工作区、按改动目的逐项检查，并把评审结果与具体代码关联起来。

### 项目亮点

- **按意图组织评审主题。** 可以让 DeepSeek 将改动范围归为多个主题。每个主题都有摘要、检查要点和对应的 diff；你可以标记已评审或需要再看。未被分配的改动也会保留在页面上。
- **持续关注本地改动。** 页面打开期间，Ming 优先使用 `FileSystemObserver`，不可用时改用定时检查。扫描在 Worker 中执行，遵循 `.gitignore`，并按来源分支与目标引用维护一组评审。你也可以随时手动扫描。
- **旧主题不会被误当作最新结果。** diff 变化后，Ming 保留原主题及其对应的旧版差异，标记为过期并提供重新生成入口。生成期间旧内容仍可查看；新主题生成后需要重新评审。
- **标题异步生成，不阻塞评审。** 改动更新时，评审列表先显示文件数。配置 DeepSeek 密钥后，后台任务会生成简短标题并替换文件数；失败时继续显示文件数。
- **运行在浏览器中的 Rust AI harness。** Rust/WebAssembly 负责规划和校验任务，浏览器 Worker 执行模型请求。同一套 harness 支持主题评审和标题生成，并通过上下文限制和快照校验避免旧结果覆盖新 diff。
- **不只阅读 AI 摘要。** 你可以浏览仓库文件、通过文件树定位改动、阅读语法高亮的 diff、比较本地提交与远端跟踪引用，还可以在 Markdown 源码与渲染后的 Rich diff 之间切换。
- **清楚掌握数据去向。** Ming 只读取所选仓库，不修改仓库内容。项目和评审保存在浏览器中；MING Console 可按项目查看 AI 请求与 Token 使用明细。

## 快速开始

需要 Node.js、带有 `wasm32-unknown-unknown` 目标的 Rust、`wasm-pack`，以及支持 File System Access API 的浏览器。选择文件夹需要 localhost 或 HTTPS 等安全上下文，建议使用近期版本的 Chromium 系浏览器。

```sh
npm ci
rustup target add wasm32-unknown-unknown
npm run build:wasm
npm run dev
```

打开 Vite 输出的本地地址，然后：

1. 点击 **Add project**，选择包含 `.git` 目录的本地 Git 仓库根目录，并授予读取权限。
2. 打开 **Reviews**。新项目默认开启实时更新，也可以点击 **Scan changes** 手动扫描。默认与当前分支的本地远端跟踪引用比较；需要时可在项目设置中选择其他引用。
3. 查看 **Changes** 和 **Commits**。如需使用 **Topics**，先在 **MING Console → Copilot** 配置 DeepSeek API 密钥，再点击 **Generate AI topics**。主题生成需要手动启动，扫描不会自动生成主题。
4. 对照 diff 逐项评审主题。diff 更新后，重新生成过期主题并再次评审。

界面支持中文和英文。项目与评审页面的 URL 可以分享，但其他浏览器或浏览器配置文件仍需单独添加仓库并授予文件夹权限。

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

目前尚未为此仓库选择许可证。
