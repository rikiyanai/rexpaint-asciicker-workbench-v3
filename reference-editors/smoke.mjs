import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const baseUrl = process.env.REFERENCE_EDITORS_URL || "http://127.0.0.1:8765";
const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const failures = [];

page.on("pageerror", error => failures.push(`pageerror: ${error.message}`));
page.on("requestfailed", request => {
  failures.push(`requestfailed: ${request.url()} (${request.failure()?.errorText || "unknown"})`);
});

async function requireVisible(selector, label) {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: "visible", timeout: 10_000 });
  if (!(await locator.isVisible())) failures.push(`${label} is not visible`);
}

const results = [];

let verifiedFiles = 0;
for (const editor of manifest.editors) {
  for (const file of editor.files) {
    const payload = readFileSync(join(root, file.path));
    const sha256 = createHash("sha256").update(payload).digest("hex");
    if (sha256 !== file.sha256) failures.push(`hash mismatch: ${file.path}`);
    verifiedFiles += 1;
  }
}
results.push({ editor: "manifest", editors: manifest.editors.length, verifiedFiles });

await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
const links = await page.locator("nav a").count();
if (links !== 3) failures.push(`landing page has ${links} editor links, expected 3`);
results.push({ editor: "landing", title: await page.title(), links });

await page.goto(`${baseUrl}/patorjk-ascii-art-sketchpad/`, { waitUntil: "networkidle" });
await requireVisible('[role="grid"]', "PatorJK grid");
const patorCells = page.locator(".aae-cell");
const patorBefore = await patorCells.evaluateAll(cells => cells.map(cell => cell.textContent).join(""));
const strokeStart = await patorCells.nth(5 * 133 + 8).boundingBox();
const strokeEnd = await patorCells.nth(5 * 133 + 20).boundingBox();
if (!strokeStart || !strokeEnd) {
  failures.push("PatorJK stroke cells are unavailable");
} else {
  await page.mouse.move(strokeStart.x + strokeStart.width / 2, strokeStart.y + strokeStart.height / 2);
  await page.mouse.down();
  await page.mouse.move(strokeEnd.x + strokeEnd.width / 2, strokeEnd.y + strokeEnd.height / 2, { steps: 12 });
  await page.mouse.up();
}
const patorAfter = await patorCells.evaluateAll(cells => cells.map(cell => cell.textContent).join(""));
if (patorAfter === patorBefore) failures.push("PatorJK pointer stroke did not change the grid");
await page.getByRole("button", { name: "Tools", exact: true }).click();
await requireVisible('[role="group"][aria-label="Tools"]', "PatorJK tools panel");
results.push({ editor: "patorjk", title: await page.title(), grid: true, stroke: patorAfter !== patorBefore, tools: true });

await page.goto(`${baseUrl}/codexvault-glyphlab/`, { waitUntil: "networkidle" });
await requireVisible("#fontPill", "GlyphLab font status");
if ((await page.locator('#fontFile[type="file"]').count()) !== 1) {
  failures.push("GlyphLab font input is missing");
}
const fontPath = process.env.REFERENCE_EDITOR_FONT || "/System/Library/Fonts/Symbol.ttf";
if (!existsSync(fontPath)) {
  failures.push(`GlyphLab smoke font is missing: ${fontPath}`);
} else {
  await page.locator("#fontFile").setInputFiles(fontPath);
  await page.waitForFunction(
    () => Number.parseInt(document.querySelector("#glyphCount")?.textContent || "0", 10) > 0,
    undefined,
    { timeout: 30_000 },
  );
}
const glyphCount = Number.parseInt(await page.locator("#glyphCount").textContent() || "0", 10);
results.push({ editor: "glyphlab", title: await page.title(), fontInput: true, glyphCount });

await page.goto(`${baseUrl}/codexvault-grid-studio/`, {
  waitUntil: "domcontentloaded",
  timeout: 60_000,
});
await requireVisible("canvas", "Grid Studio canvas");
const canvasBefore = await page.locator("#gridCanvas").evaluate(canvas => canvas.toDataURL());
const canvasBox = await page.locator("#gridCanvas").boundingBox();
if (!canvasBox) {
  failures.push("Grid Studio canvas bounds are unavailable");
} else {
  await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
}
const canvasAfter = await page.locator("#gridCanvas").evaluate(canvas => canvas.toDataURL());
if (canvasAfter === canvasBefore) failures.push("Grid Studio pencil click did not change the canvas");
const framesBefore = await page.locator("#frameList").locator(":scope > *").count();
await page.locator("#addFrameBtn").click();
const framesAfter = await page.locator("#frameList").locator(":scope > *").count();
if (framesAfter <= framesBefore) failures.push("Grid Studio Add Frame did not add a frame");
results.push({
  editor: "grid-studio",
  title: await page.title(),
  canvas: true,
  painted: canvasAfter !== canvasBefore,
  frameAdded: framesAfter > framesBefore,
});

await browser.close();

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures, results }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, failures: [], results }, null, 2));
