# Ming

**Review what changed, one topic at a time.**

Ming is a browser-based workspace for reviewing local Git changes. It turns a large working-tree diff into reviewable topics, keeps each topic linked to the original code, and lets you record what you have checked. The repository stays on your computer; there is no Ming account or application server.

[简体中文](README.zh-CN.md) · [English](README.md)

## Why Ming

An AI coding assistant can change dozens of files in one pass. A summary of its intent is useful, but the decision to keep the work depends on the actual diff. Ming gives that decision its own workflow: compare the working tree, inspect changes by purpose, and track review progress without losing the connection to individual lines.

### Highlights

- **A review stack organized by intent.** Ask DeepSeek to group change ranges into topics. Each topic has a summary, checks, and its relevant diff. Mark it reviewed or flag it for another look. Unassigned ranges remain visible.
- **Local changes stay in view.** Ming watches a repository while the page is open, using `FileSystemObserver` where available and a timer otherwise. Scans run in a worker, respect `.gitignore`, and update one review per source/target branch pair. A manual scan is always available.
- **Old topics are never silently presented as current.** When the diff changes, Ming keeps the previous topics and their original diff, marks them out of date, and offers regeneration. The old topics remain visible while new ones are generated; review status starts fresh with the replacement.
- **AI titles without blocking review.** A changed review first shows its file count. With a DeepSeek key configured, a background task generates a short title and replaces that count when ready. Failure leaves the file count in place.
- **A browser-hosted Rust AI harness.** Rust/WebAssembly plans and validates review tasks; a browser worker executes provider requests. The same harness handles topic reviews and titles, with bounded context and snapshot checks that prevent an old result from overwriting a newer diff.
- **Inspect more than the AI summary.** Browse files, jump through a changed-file tree, read syntax-highlighted diffs, compare local commit history with remote-tracking refs, and view Markdown changes as source or a rendered Rich diff.
- **Know where data goes.** Ming reads the selected repository without writing to it. Projects and reviews live in browser storage. AI usage, including request and token details, is visible by project in MING Console.

## Get started

You need Node.js, Rust with the `wasm32-unknown-unknown` target, `wasm-pack`, and a browser with the File System Access API. Folder selection requires a secure context such as localhost or HTTPS; a current Chromium-based browser is recommended.

```sh
npm ci
rustup target add wasm32-unknown-unknown
npm run build:wasm
npm run dev
```

Open the local URL printed by Vite, then:

1. **Add project** and select the root of a local Git repository containing a `.git` directory. Ming asks for read access.
2. Open **Reviews**. Live updates are enabled by default for new projects, or you can click **Scan changes**. By default, the current branch is compared with its local remote-tracking ref; choose another ref in project settings if needed.
3. Read **Changes** and **Commits**. To use **Topics**, add a DeepSeek API key in **MING Console → Copilot**, then click **Generate AI topics**. Topic generation is manual; scanning does not start it.
4. Review each topic against its diff. When the diff changes, regenerate the out-of-date topics and review them again.

The interface supports English and Chinese. Project and review URLs are shareable, but another browser or profile must add the repository and grant folder access separately.

## How Ming works

| Layer | Role |
| --- | --- |
| File System Access API + `isomorphic-git` | Read the local repository, working tree, and locally available Git refs |
| Scan and AI workers | Keep Git inspection and provider requests off the UI thread |
| Rust `ming-core` compiled to WebAssembly | Parse diffs, hash snapshots, plan bounded AI tasks, and validate model output |
| IndexedDB | Store project handles, one review per branch pair, topics, review status, and AI usage |
| Vue 3 | Present files, diffs, topics, background tasks, and MING Console |

Ming makes no Git fetch, push, commit, checkout, or repository-file changes. It does not require its own backend. Future acceleration through Jev is a design consideration, not an active integration.

### Privacy and AI requests

The DeepSeek API key is stored in this browser's local storage. With a key configured, **scanning a changed diff automatically sends bounded diff context directly from the browser to DeepSeek to generate a review title**. **Topic generation sends the saved diff to DeepSeek only when you start or restart that task.** Ming does not upload repository content to a Ming server. Removing a project deletes its browser records, not its files on disk.

## Build and contribute

```sh
npm run check
npm run build
```

`npm run build` creates a static site in `dist/`. A static host should serve `index.html` for client-side routes such as `/projects/` and `/console/`. The [GitHub Pages workflow](.github/workflows/deploy-pages.yml) prepares direct-link entry files for those routes.

Keep repository access read-only and add focused tests for Git inspection, persistence, or Rust task behavior.

## Current limits

- Repositories must have a `.git` directory; linked worktrees with a `.git` file are not supported.
- A scan handles up to 200 changed files and stops after 500 scanned directories. Binary files and text files over 2 MB do not get text diffs.
- Rich Markdown diff requires at most 1 MB of combined before/after text. File previews are UTF-8 text, with a configurable size limit.
- Commit comparison reads local remote-tracking refs; Ming does not contact a Git remote to refresh them.
- Browser folder permissions and IndexedDB data belong to that browser profile and origin. Live updates run only while Ming is open.
- AI topics are review aids, not correctness verdicts. Large diffs may exceed the AI context budget; the complete local diff remains available in **Changes**.

## License

A license has not been selected yet.
