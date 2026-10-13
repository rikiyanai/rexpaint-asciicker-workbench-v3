#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

const DEFAULT_WORKBENCH_URL = process.env.WORKBENCH_URL || "http://127.0.0.1:5071/workbench";

function parseArgs(argv) {
  const out = {
    url: DEFAULT_WORKBENCH_URL,
    timeoutSec: 90,
    clickTest: true,
    forceOpen: true,
    headed: false,
    moveSec: 0,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url" && argv[i + 1]) out.url = argv[++i];
    else if (a === "--timeout-sec" && argv[i + 1]) out.timeoutSec = Math.max(10, Number(argv[++i]) || 90);
    else if (a === "--no-click-test") out.clickTest = false;
    else if (a === "--no-force-open") out.forceOpen = false;
    else if (a === "--headed") out.headed = true;
    else if (a === "--move-sec" && argv[i + 1]) out.moveSec = Math.max(0, Number(argv[++i]) || 0);
  }
  return out;
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch (_e) {
    const fallback = process.env.PLAYWRIGHT_IMPORT ||
      path.join(os.homedir(), ".codex/skills/develop-web-game/node_modules/playwright/index.js");
    return await import(pathToFileURL(fallback).href);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.headed) {
    throw new Error("debug_workbench_skin_dock_playwright.mjs refuses headless execution. Re-run with --headed.");
  }
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(process.cwd(), "output", "playwright", `skin-dock-debug-${ts}`);
  await fs.mkdir(outDir, { recursive: true });

  const pwMod = await loadPlaywright();
  const chromium = pwMod?.chromium || pwMod?.default?.chromium;
  if (!chromium) throw new Error("Playwright chromium export not found");
  const launchArgs = [];
  const browser = await chromium.launch({ headless: !args.headed, args: launchArgs });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    serviceWorkers: "block",
  });
  const page = await context.newPage();

  const consoleLogs = [];
  const pageErrors = [];
  const requestFails = [];
  page.on("console", (msg) => {
    consoleLogs.push({
      t: Date.now(),
      type: msg.type(),
      text: msg.text(),
    });
  });
  page.on("pageerror", (err) => {
    pageErrors.push({ t: Date.now(), error: String(err) });
  });
  page.on("requestfailed", (req) => {
    requestFails.push({
      t: Date.now(),
      url: req.url(),
      method: req.method(),
      failure: req.failure()?.errorText || "unknown",
    });
  });

  await page.goto(args.url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1000);

  const timeline = [];
  async function snap(label) {
    const data = await page.evaluate((label0) => {
      const fallback = () => ({
        label: label0,
        wbStatus: String(document.getElementById("wbStatus")?.textContent || ""),
        webbuildState: String(document.getElementById("webbuildState")?.textContent || ""),
        quickBtnDisabled: !!document.getElementById("webbuildQuickTestBtn")?.disabled,
      });
      const data = window.__wb_debug && typeof window.__wb_debug.getWebbuildDebugState === "function"
        ? { label: label0, ...window.__wb_debug.getWebbuildDebugState() }
        : fallback();
      try {
        const runtime = document.getElementById("webbuildFrame")?.contentWindow;
        const diagText = typeof runtime?.MultiplayerDiagJson === "function" ? runtime.MultiplayerDiagJson() : "";
        data.runtime = {
          diag: diagText ? JSON.parse(diagText) : null,
          worldReady: typeof runtime?.GameWorldReady === "function" ? runtime.GameWorldReady() : null,
          visibleLocalPlayers: typeof runtime?.VisibleLocalPlayers === "function" ? runtime.VisibleLocalPlayers() : null,
          visibleLocalBodyPlayers: typeof runtime?.VisibleLocalBodyPlayers === "function" ? runtime.VisibleLocalBodyPlayers() : null,
          actorRenderDir: typeof runtime?.ActorRenderDir === "function" ? runtime.ActorRenderDir() : null,
          actorAnim: typeof runtime?.ActorAnim === "function" ? runtime.ActorAnim() : null,
          actorFrame: typeof runtime?.ActorFrame === "function" ? runtime.ActorFrame() : null,
        };
      } catch (error) {
        data.runtime = { error: String(error) };
      }
      return data;
    }, label);
    timeline.push({ t: Date.now(), ...data });
    return data;
  }

  const initial = await snap("initial");
  if (args.forceOpen) {
    await page.evaluate(() => {
      if (window.__wb_debug && typeof window.__wb_debug.openWebbuild === "function") {
        window.__wb_debug.openWebbuild(true);
      } else {
        document.getElementById("webbuildOpenBtn")?.click();
      }
    });
    await page.waitForTimeout(500);
    await snap("after_force_open");
  }

  if (args.clickTest) {
    const s = await snap("before_click_test");
    if (!s.quickBtnDisabled) {
      await page.evaluate(() => {
        if (window.__wb_debug && typeof window.__wb_debug.testSkinDock === "function") {
          window.__wb_debug.testSkinDock();
        } else {
          document.getElementById("webbuildQuickTestBtn")?.click();
        }
      });
      await page.waitForTimeout(500);
      await snap("after_click_test");
    }
  }

  const started = Date.now();
  while (Date.now() - started < args.timeoutSec * 1000) {
    const s = await snap("poll");
    const wbStatus = String(s.wbStatus || "");
    const webbuildState = String(s.webbuildState || "");
    if (/Applied XP as web skin/i.test(wbStatus) || /skin applied/i.test(webbuildState)) break;
    if (/failed|error/i.test(wbStatus) || /access error/i.test(webbuildState)) break;
    await page.waitForTimeout(1000);
  }

  const iframeBeforePath = path.join(outDir, "skin-dock-iframe-before.png");
  await page.locator("#webbuildFrame").screenshot({ path: iframeBeforePath });
  if (args.moveSec > 0) {
    const runtimeFrame = page.frames().find((frame) => frame.url().includes("/termpp-web-flat/index.html"));
    if (runtimeFrame) {
      await runtimeFrame.locator("#asciicker_canvas").click({ position: { x: 400, y: 250 } });
      await page.keyboard.down("w");
      await page.waitForTimeout(args.moveSec * 1000);
      await page.keyboard.up("w");
      await page.waitForTimeout(500);
      await snap("after_move");
    }
  }
  const iframeAfterPath = path.join(outDir, "skin-dock-iframe-after.png");
  await page.locator("#webbuildFrame").screenshot({ path: iframeAfterPath });
  const screenshotPath = path.join(outDir, "skin-dock-debug.png");
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await snap("final");

  const result = {
    url: args.url,
    timeoutSec: args.timeoutSec,
    clickTest: args.clickTest,
    forceOpen: args.forceOpen,
    timeline,
    pageErrors,
    requestFails,
    consoleLogs,
    screenshotPath,
    iframeBeforePath,
    iframeAfterPath,
  };
  const resultPath = path.join(outDir, "skin-dock-debug.json");
  await fs.writeFile(resultPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ resultPath, screenshotPath, iframeBeforePath, iframeAfterPath, final: timeline[timeline.length - 1], pageErrors, requestFails: requestFails.slice(-5) }, null, 2));

  await context.close();
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
