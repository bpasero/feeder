#!/usr/bin/env node
// Claude-only Playwright driver for the feed app.
// Drives system Chrome via channel:'chrome' — no Chromium download needed.
//
// Usage:
//   node .claude/playwright/drive.mjs --url http://localhost:5173 --out /tmp/pw/home.png
//   node .claude/playwright/drive.mjs --url http://localhost:5173 \
//     --click '[aria-label="Toggle sidebar"]' --wait 300 --out /tmp/pw/collapsed.png
//   node .claude/playwright/drive.mjs --url http://localhost:5173 \
//     --eval "document.querySelectorAll('article').length"
//
// For multi-step flows, import { drive } from this file in a one-shot script.

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

function parseArgs(argv) {
  const args = { click: [], type: [], waitSelector: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--url': args.url = next(); break;
      case '--out': args.out = next(); break;
      case '--width': args.width = Number(next()); break;
      case '--height': args.height = Number(next()); break;
      case '--full-page': args.fullPage = true; break;
      case '--wait': args.wait = Number(next()); break;
      case '--wait-selector': args.waitSelector.push(next()); break;
      case '--click': args.click.push({ kind: 'click', selector: next() }); break;
      case '--type': {
        const v = next();
        const eq = v.indexOf('=');
        if (eq < 0) throw new Error(`--type expects selector=value, got: ${v}`);
        args.click.push({ kind: 'type', selector: v.slice(0, eq), value: v.slice(eq + 1) });
        break;
      }
      case '--press': args.click.push({ kind: 'press', key: next() }); break;
      case '--scroll': args.click.push({ kind: 'scroll', amount: Number(next()) }); break;
      case '--eval': args.eval = next(); break;
      case '--timeout': args.timeout = Number(next()); break;
      case '--headed': args.headed = true; break;
      case '--device-scale': args.deviceScaleFactor = Number(next()); break;
      case '--no-screenshot': args.noScreenshot = true; break;
      case '--help':
      case '-h':
        console.log('See top of drive.mjs for usage.');
        process.exit(0);
      default:
        throw new Error(`Unknown flag: ${a}`);
    }
  }
  if (!args.url) throw new Error('--url is required');
  args.width ??= 1280;
  args.height ??= 800;
  args.wait ??= 0;
  args.timeout ??= 30000;
  args.deviceScaleFactor ??= 2;
  if (!args.out && !args.noScreenshot) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    args.out = `/tmp/pw/screenshot-${stamp}.png`;
  }
  return args;
}

export async function drive(opts) {
  const summary = {
    url: opts.url,
    screenshot: null,
    console: [],
    pageErrors: [],
    failedRequests: [],
    evalResult: undefined,
    timings: {},
  };

  const t0 = Date.now();
  const browser = await chromium.launch({ channel: 'chrome', headless: !opts.headed });
  const context = await browser.newContext({
    viewport: { width: opts.width, height: opts.height },
    deviceScaleFactor: opts.deviceScaleFactor,
  });
  const page = await context.newPage();

  page.on('console', (msg) => {
    summary.console.push({ type: msg.type(), text: msg.text() });
  });
  page.on('pageerror', (err) => {
    summary.pageErrors.push({ message: err.message, stack: err.stack });
  });
  page.on('requestfailed', (req) => {
    summary.failedRequests.push({ url: req.url(), failure: req.failure()?.errorText });
  });

  try {
    summary.timings.launchMs = Date.now() - t0;
    const tNav = Date.now();
    await page.goto(opts.url, { waitUntil: 'networkidle', timeout: opts.timeout });
    summary.timings.navMs = Date.now() - tNav;

    for (const sel of opts.waitSelector || []) {
      await page.waitForSelector(sel, { timeout: opts.timeout });
    }

    for (const step of opts.click || []) {
      if (step.kind === 'click') {
        await page.click(step.selector, { timeout: opts.timeout });
      } else if (step.kind === 'type') {
        await page.fill(step.selector, step.value, { timeout: opts.timeout });
      } else if (step.kind === 'press') {
        await page.keyboard.press(step.key);
      } else if (step.kind === 'scroll') {
        await page.mouse.wheel(0, step.amount);
      }
    }

    if (opts.wait) await page.waitForTimeout(opts.wait);

    if (opts.eval) {
      summary.evalResult = await page.evaluate(opts.eval);
    }

    if (!opts.noScreenshot && opts.out) {
      await mkdir(dirname(opts.out), { recursive: true });
      await page.screenshot({ path: opts.out, fullPage: !!opts.fullPage });
      summary.screenshot = opts.out;
    }

    summary.title = await page.title();
    summary.finalUrl = page.url();
  } finally {
    await context.close();
    await browser.close();
    summary.timings.totalMs = Date.now() - t0;
  }
  return summary;
}

const isMain = fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  try {
    const opts = parseArgs(process.argv);
    const summary = await drive(opts);
    console.log(JSON.stringify(summary, null, 2));
  } catch (err) {
    console.error('drive.mjs error:', err.message);
    process.exit(1);
  }
}
