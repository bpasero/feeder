---
name: exercise-ui
description: |
  Drive the feed-reader UI with Playwright + system Chrome to verify changes
  with a real render. Use whenever you've made a UI/CSS/layout change in this
  repo and want to confirm it actually looks right (not just type-checks), or
  when reproducing a UI bug. The driver lives at .claude/playwright/drive.mjs;
  screenshots cache to /tmp/pw/.
---

# exercise-ui — verify UI changes with a real render

This project ships a Claude-only Playwright driver at `.claude/playwright/`.
It launches **system Chrome** via `channel: 'chrome'` so there is no Chromium
download (auto-mode blocks the playwright CDN). `.claude/` is gitignored, so
none of this tooling lands in the shipped app, CI, or the repo at all.

## When to use

- After any CSS / layout / component change, before reporting the task done.
- When reproducing a UI bug (interaction sequence + screenshot for evidence).
- When checking dark mode, mobile widths, or hover/focus states.
- When the user asks for a "screenshot" or "show me what it looks like".

Skip for pure logic / parser / store / worker changes — Vitest is faster.

## Quick recipe

```bash
# 1) Start the dev server in the background.
npm run dev > "$CLAUDE_JOB_DIR/vite.log" 2>&1 &
until grep -q "ready in" "$CLAUDE_JOB_DIR/vite.log"; do sleep 0.3; done

# 2) Drive the UI and capture.
mkdir -p /tmp/pw
node .claude/playwright/drive.mjs \
  --url http://localhost:5173 \
  --wait 500 \
  --out /tmp/pw/<descriptive-name>.png

# 3) Read the PNG back with the Read tool to actually look at it.

# 4) Stop the dev server when done.
kill $(lsof -ti:5173)
```

If your flow needs the worker proxy (feed fetches, reader mode), also run
`npm run worker:dev` on `:8787`. **Known dev gotcha:** the page's CSP
`connect-src 'self' https: ws: wss:` blocks `http://localhost:8787`, so seed
fetches fail in dev unless the CSP is loosened. Production is unaffected.

## Driver flags (`.claude/playwright/drive.mjs`)

| Flag | Purpose |
|------|---------|
| `--url <url>` | Required. Page to load. |
| `--out <path>` | PNG output. Default: `/tmp/pw/screenshot-<ts>.png`. |
| `--width / --height` | Viewport. Default 1280x800 at deviceScale 2. |
| `--full-page` | Full-page screenshot. |
| `--wait <ms>` | Extra wait after actions. |
| `--wait-selector <s>` | Block until selector appears. |
| `--click <selector>` | Click. Repeatable; applied in order. |
| `--type <sel>=<val>` | Fill an input. Repeatable. |
| `--press <Key>` | Keyboard event. |
| `--scroll <n>` | Mouse-wheel scroll by n pixels. |
| `--eval "<expr>"` | Run JS in page; included as `evalResult` in summary. |
| `--headed` | Show the browser (useful when troubleshooting selectors). |
| `--timeout <ms>` | Navigation / action timeout. Default 30000. |

The driver prints a JSON summary to stdout: title, finalUrl, console,
pageErrors, failedRequests, evalResult, timings, screenshot path.

**Always check `pageErrors` and `console` for `error` entries.** A screenshot
can look fine while React has thrown — the visual is misleading without the
console.

## Multi-step flows

For anything more than 2–3 actions, write a one-shot script that imports
`drive` (or use Playwright directly) rather than chaining flag after flag:

```js
// .claude/playwright/<scratch>.mjs
import { drive } from './drive.mjs';
const r = await drive({
  url: 'http://localhost:5173',
  click: [
    { kind: 'click', selector: '[aria-label="Add feed"]' },
    { kind: 'type', selector: 'input[name="url"]', value: 'https://…' },
    { kind: 'press', key: 'Enter' },
  ],
  waitSelector: ['li.feed-row'],
  out: '/tmp/pw/added-feed.png',
});
console.log(JSON.stringify(r, null, 2));
```

## Common selectors in this app

- Header sidebar toggle: top-left button in `header`
- Reader pane toggle: top-right button in `header`
- Feed list: `aside` (the left column)
- Item list: middle column with `0 items` / `Mark all read` header
- Reader pane: right column, header text "Reader"

When in doubt, run with `--eval "[...document.querySelectorAll('button')].map(b => b.outerHTML).slice(0,20)"` to enumerate.

## Permissions

Already wired in `.claude/settings.local.json`:
`Bash(node .claude/playwright/*)`, `Bash(mkdir -p /tmp/pw*)`,
`Bash(lsof -ti:*)`, `Read(/tmp/pw/**)`, plus `Bash(npm *)`.

## See also

- Memory: `reference_playwright_driver.md`
- Workflow: Benjamin prefers Playwright + screenshot for UI verification
  (see memory `feedback_workflow.md`).
