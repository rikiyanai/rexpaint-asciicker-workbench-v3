/**
 * Focused auto-wall/auto-box contract checks.
 * Run with: node --experimental-vm-modules tests/web/rexpaint-editor-adaptive-stroke.test.mjs
 * The VM loader is used because the repository's root package declares CommonJS
 * while the browser editor tools are native ES modules.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const modulePath = fileURLToPath(new URL('../../web/rexpaint-editor/tools/adaptive-stroke-tool.js', import.meta.url));
const source = await readFile(modulePath, 'utf8');
const toolModule = new vm.SourceTextModule(source, { identifier: modulePath });
await toolModule.link(() => {
  throw new Error('AdaptiveStrokeTool must not load external dependencies');
});
await toolModule.evaluate();

const { AdaptiveStrokeTool, SlopeStrokeTool } = toolModule.namespace;
const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];

function cloneCell(cell) {
  return { glyph: cell.glyph, fg: [...cell.fg], bg: [...cell.bg] };
}

class MemoryCanvas {
  constructor(width = 8, height = 6) {
    this.width = width;
    this.height = height;
    this.cells = new Map();
    this.calls = [];
    this.operation = null;
    this.operationCount = 0;
  }

  getCell(x, y) {
    return cloneCell(this.cells.get(`${x},${y}`) || { glyph: 0, fg: WHITE, bg: BLACK });
  }

  setCell(x, y, glyph, fg, bg) {
    const key = `${x},${y}`;
    const before = this.getCell(x, y);
    if (this.operation && !this.operation.before.has(key)) {
      this.operation.before.set(key, before);
    }
    const next = { glyph, fg: [...fg], bg: [...bg] };
    this.cells.set(key, next);
    this.calls.push([x, y, glyph, [...fg], [...bg]]);
  }

  beginOperation(label = 'edit') {
    if (this.operation) return;
    this.operation = { label, before: new Map() };
  }

  endOperation() {
    const operation = this.operation;
    this.operation = null;
    if (!operation || operation.before.size === 0) return null;
    this.operationCount++;
    const after = new Map([...operation.before.keys()].map((key) => [key, this.getCell(...key.split(',').map(Number))]));
    const apply = (cells) => {
      for (const [key, cell] of cells) this.cells.set(key, cloneCell(cell));
    };
    return {
      label: operation.label,
      undo: () => apply(operation.before),
      redo: () => apply(after),
    };
  }
}

function drawStroke(tool, canvas, points) {
  canvas.beginOperation('adaptive-stroke');
  tool.startDrag(points[0].x, points[0].y);
  for (const point of points.slice(1)) tool.drag(point.x, point.y);
  tool.endDrag();
  return canvas.endOperation();
}

function glyphAt(canvas, x, y) {
  return canvas.getCell(x, y).glyph;
}

function run(name, fn) {
  try {
    fn();
    process.stdout.write(`✓ ${name}\n`);
  } catch (error) {
    process.stderr.write(`✗ ${name}\n${error.stack || error}\n`);
    process.exitCode = 1;
  }
}

run('horizontal and vertical strokes choose matching CP437 wall glyphs', () => {
  const canvas = new MemoryCanvas();
  const tool = new AdaptiveStrokeTool();
  tool.setCanvas(canvas);

  drawStroke(tool, canvas, [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }]);
  assert.deepEqual([glyphAt(canvas, 1, 0), glyphAt(canvas, 2, 0), glyphAt(canvas, 3, 0)], [196, 196, 196]);

  drawStroke(tool, canvas, [{ x: 0, y: 1 }, { x: 0, y: 2 }, { x: 0, y: 3 }]);
  assert.deepEqual([glyphAt(canvas, 0, 1), glyphAt(canvas, 0, 2), glyphAt(canvas, 0, 3)], [179, 179, 179]);
});

run('turns update the shared cell into the correct corner', () => {
  const canvas = new MemoryCanvas();
  const tool = new AdaptiveStrokeTool();
  tool.setCanvas(canvas);
  drawStroke(tool, canvas, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]);

  assert.equal(glyphAt(canvas, 1, 0), 191); // ┐: west + south
  assert.equal(glyphAt(canvas, 0, 0), 196); // horizontal endpoint
  assert.equal(glyphAt(canvas, 1, 1), 179); // vertical endpoint
});

run('revisiting a cell accumulates topology into a junction', () => {
  const canvas = new MemoryCanvas();
  const tool = new AdaptiveStrokeTool();
  tool.setCanvas(canvas);
  drawStroke(tool, canvas, [
    { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 2 },
    { x: 1, y: 2 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 },
  ]);

  assert.equal(glyphAt(canvas, 2, 1), 197); // ┼: north, east, south, west
  const centerWrites = canvas.calls.filter(([x, y]) => x === 2 && y === 1);
  assert.equal(centerWrites.at(-1)[2], 197);
});

run('both diagonal directions become deterministic orthogonal corners', () => {
  const canvas = new MemoryCanvas();
  const tool = new AdaptiveStrokeTool();
  tool.setCanvas(canvas);

  drawStroke(tool, canvas, [{ x: 0, y: 0 }, { x: 1, y: 1 }]);
  assert.equal(glyphAt(canvas, 1, 0), 191); // horizontal-first down-right turn
  assert.equal(glyphAt(canvas, 1, 1), 179);

  drawStroke(tool, canvas, [{ x: 0, y: 3 }, { x: 1, y: 2 }]);
  assert.equal(glyphAt(canvas, 1, 3), 217); // horizontal-first up-right turn
  assert.equal(glyphAt(canvas, 1, 2), 179);
});

run('selected double-line glyphs choose double-line CP437 topology', () => {
  const canvas = new MemoryCanvas();
  const tool = new AdaptiveStrokeTool();
  tool.setCanvas(canvas);
  tool.setGlyph(205); // ═
  drawStroke(tool, canvas, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]);

  assert.equal(glyphAt(canvas, 1, 0), 187); // ╗ in the double-line family
  assert.equal(glyphAt(canvas, 0, 0), 205);
  assert.equal(glyphAt(canvas, 1, 1), 186);
});

run('a whole stroke is one undoable canvas operation with stable redo', () => {
  const canvas = new MemoryCanvas();
  canvas.setCell(0, 0, 65, [1, 2, 3], [4, 5, 6]);
  canvas.calls = [];
  const original = canvas.getCell(0, 0);
  const tool = new AdaptiveStrokeTool();
  tool.setCanvas(canvas);
  const command = drawStroke(tool, canvas, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]);

  assert.equal(canvas.operationCount, 1);
  assert.equal(command.label, 'adaptive-stroke');
  command.undo();
  assert.deepEqual(canvas.getCell(0, 0), original);
  assert.equal(glyphAt(canvas, 1, 0), 0);
  command.redo();
  assert.equal(glyphAt(canvas, 0, 0), 196);
  assert.equal(glyphAt(canvas, 1, 0), 191);
});

run('bounds and cancel stop later samples without writing outside the canvas', () => {
  const canvas = new MemoryCanvas(3, 3);
  const tool = new AdaptiveStrokeTool();
  tool.setCanvas(canvas);
  tool.startDrag(-1, 0);
  assert.equal(tool.isDragging, false);
  assert.equal(canvas.calls.length, 0);

  tool.startDrag(0, 0);
  tool.drag(1, 0);
  tool.drag(3, 0); // break the path at the bounds
  tool.drag(1, 1); // starts a disconnected in-bounds segment
  tool.cancelDrag();
  const writesAtCancel = canvas.calls.length;
  tool.drag(2, 1);
  assert.equal(canvas.calls.length, writesAtCancel);
  assert.ok(canvas.calls.every(([x, y]) => x >= 0 && y >= 0 && x < 3 && y < 3));
  assert.equal(tool.isDragging, false);
});

run('disabled glyph apply mode preserves glyphs while colors still apply', () => {
  const canvas = new MemoryCanvas();
  canvas.setCell(0, 0, 65, [1, 2, 3], [4, 5, 6]);
  const tool = new AdaptiveStrokeTool();
  tool.setCanvas(canvas);
  tool.setColors([20, 30, 40], [50, 60, 70]);
  tool.setApplyModes({ glyph: false });
  drawStroke(tool, canvas, [{ x: 0, y: 0 }, { x: 1, y: 0 }]);

  assert.equal(glyphAt(canvas, 0, 0), 65);
  assert.equal(glyphAt(canvas, 1, 0), 0);
  assert.deepEqual(canvas.getCell(0, 0).fg, [20, 30, 40]);
  assert.deepEqual(canvas.getCell(1, 0).bg, [50, 60, 70]);
});

run('slope brush changes glyphs for horizontal, vertical, and both diagonals', () => {
  const canvas = new MemoryCanvas();
  const tool = new SlopeStrokeTool();
  tool.setCanvas(canvas);
  drawStroke(tool, canvas, [{ x: 0, y: 0 }, { x: 3, y: 0 }]);
  assert.equal(glyphAt(canvas, 1, 0), 45); // -
  drawStroke(tool, canvas, [{ x: 0, y: 0 }, { x: 0, y: 3 }]);
  assert.equal(glyphAt(canvas, 0, 1), 124); // |
  drawStroke(tool, canvas, [{ x: 0, y: 0 }, { x: 2, y: 2 }]);
  assert.equal(glyphAt(canvas, 1, 1), 92); // \
  drawStroke(tool, canvas, [{ x: 0, y: 3 }, { x: 2, y: 1 }]);
  assert.equal(glyphAt(canvas, 1, 2), 47); // /
});

run('slope brush updates direction when the stroke turns', () => {
  const canvas = new MemoryCanvas();
  const tool = new SlopeStrokeTool();
  tool.setCanvas(canvas);
  drawStroke(tool, canvas, [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }]);
  assert.equal(glyphAt(canvas, 1, 0), 45);
  assert.equal(glyphAt(canvas, 2, 0), 124);
  assert.equal(glyphAt(canvas, 2, 1), 124);
});

run('slope brush breaks the path across an out-of-bounds pointer gap', () => {
  const canvas = new MemoryCanvas(4, 4);
  const tool = new SlopeStrokeTool();
  tool.setCanvas(canvas);
  tool.startDrag(0, 0);
  tool.drag(1, 0);
  tool.drag(5, 0);
  tool.drag(3, 3);
  tool.endDrag();
  assert.equal(glyphAt(canvas, 2, 1), 0);
  assert.equal(glyphAt(canvas, 2, 2), 0);
  assert.equal(glyphAt(canvas, 3, 3), 45);
});

if (process.exitCode) process.exit(process.exitCode);
process.stdout.write('11 passed, 0 failed\n');
