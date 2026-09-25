# Ming

**Review AI-written code with confidence.**

AI assistants can change an entire repository in one pass. Ming turns the actual local diff into a focused, human-led review before you decide what to keep. It runs in your browser, with no Ming account or application server.

[简体中文](README.zh-CN.md) · [English](README.md)

## Why Ming

An AI-generated summary tells you what the assistant intended. Ming shows what it actually changed, organizes that work into decisions you can make one topic at a time, and keeps every decision anchored to the diff.

### Highlights

- **Move from AI summary to evidence.** Ming turns a sprawling diff into purpose-driven review topics, each tied to the exact code and concrete checks. You decide what has been reviewed, what needs another look, and what the AI left unclassified.
- **Know when the code has moved on.** Local changes update the review while Ming is open. When a diff changes, old topics remain visible but are marked out of date until you regenerate them. A concise AI title arrives in the background without interrupting your work.
- **Keep the final say—and your code.** Ming reads your repository without modifying it and stores projects and reviews in your browser. Its Rust/WebAssembly harness plans and validates AI tasks; DeepSeek receives code directly from the browser only for the tasks described below.

## Get started

Open [Ming](https://yorkie.github.io/ming/) in a current Chromium-based browser. Ming lets you review a local Git repository in your browser: inspect the actual diff, organize it into AI topics when useful, and record your decisions. No installation or Ming account is required. Grant folder access when the browser asks.

1. **Add project** and select the root of a local Git repository containing a `.git` directory. Ming asks for read access.
2. Open **Reviews**. Live updates are enabled by default for new projects; **Scan changes** refreshes the review manually. The current branch is compared with its local remote-tracking ref by default. You can choose another comparison ref in project settings.
3. Inspect **Changes** and **Commits**. To use **Topics**, add a DeepSeek API key in **MING Console → Copilot**, then click **Generate AI topics**. Topic generation is manual.
4. Review each topic against its diff and mark it reviewed or needing another look. If the diff changes, Ming keeps the previous topics visible and marks them out of date until you regenerate them.

### When to use Ming

**After an AI coding pass:** Scan the working tree, inspect the changed files, then generate topics to review related edits together. Every topic links back to the code you need to verify.

**While code is still changing:** Keep Ming open as an agent or teammate edits the local repository. Live updates refresh the review; an out-of-date notice tells you when previous topics need another pass.

**Before sharing a branch:** Compare your branch with its remote-tracking ref or another target. Use **Commits** to understand the history, **Changes** to inspect the diff, and **Topics** to track your review.

The interface supports English and Chinese. Project and review URLs are shareable, but another browser or profile must add the local repository and grant folder access separately.

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

To run Ming locally, install Node.js, Rust with the `wasm32-unknown-unknown` target, and `wasm-pack`. Use a browser with the File System Access API; folder selection requires localhost or HTTPS.

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

Ming is released under the [MIT License](LICENSE).
