/**
 * Adaptive Stroke Tool - Cell alternate mode for auto-wall / auto-box drawing.
 *
 * Each stroke is retained as a graph of orthogonal cell connections. The
 * graph's per-cell connection mask selects a CP437 box-drawing glyph, so turns
 * and revisits update existing cells into corners and junctions instead of
 * stamping the currently selected glyph. Cell mutations are deliberately
 * issued through canvas.setCell so the document owner can record one undo
 * transaction for the full pointer stroke.
 */

const NORTH = 1;
const EAST = 2;
const SOUTH = 4;
const WEST = 8;

const SINGLE_LINE_GLYPHS = Object.freeze({
  0: 196,  // ─ (an isolated click has no direction; use the horizontal wall)
  1: 179,  // │
  2: 196,  // ─
  3: 192,  // └
  4: 179,  // │
  5: 179,  // │
  6: 218,  // ┌
  7: 195,  // ├
  8: 196,  // ─
  9: 217,  // ┘
  10: 196, // ─
  11: 193, // ┴
  12: 191, // ┐
  13: 180, // ┤
  14: 194, // ┬
  15: 197, // ┼
});

const DOUBLE_LINE_GLYPHS = Object.freeze({
  0: 205,  // ═
  1: 186,  // ║
  2: 205,  // ═
  3: 200,  // ╚
  4: 186,  // ║
  5: 186,  // ║
  6: 201,  // ╔
  7: 204,  // ╠
  8: 205,  // ═
  9: 188,  // ╝
  10: 205, // ═
  11: 202, // ╩
  12: 187, // ╗
  13: 185, // ╣
  14: 203, // ╦
  15: 206, // ╬
});

const DOUBLE_LINE_SET = new Set(Object.values(DOUBLE_LINE_GLYPHS));

function cellKey(x, y) {
  return `${x},${y}`;
}

function edgeKey(a, b) {
  const first = cellKey(a.x, a.y);
  const second = cellKey(b.x, b.y);
  return first < second ? `${first}|${second}` : `${second}|${first}`;
}

function directionMask(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 1 && dy === 0) return EAST;
  if (dx === -1 && dy === 0) return WEST;
  if (dx === 0 && dy === 1) return SOUTH;
  if (dx === 0 && dy === -1) return NORTH;
  return 0;
}

/**
 * Visit every grid cell between pointer samples using only orthogonal steps.
 * Diagonal samples become a deterministic staircase (horizontal-first on
 * ties), which keeps the stroke representable by box-drawing topology. This
 * is a pointer-path adapter, not the editor's generic straight-line tool.
 */
function* orthogonalSteps(start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const xCount = Math.abs(dx);
  const yCount = Math.abs(dy);
  const xStep = Math.sign(dx);
  const yStep = Math.sign(dy);
  let xTaken = 0;
  let yTaken = 0;
  let x = start.x;
  let y = start.y;

  while (xTaken < xCount || yTaken < yCount) {
    let moveX;
    if (xTaken >= xCount) {
      moveX = false;
    } else if (yTaken >= yCount) {
      moveX = true;
    } else {
      // Compare the next normalized progress on each axis without floats.
      moveX = (xTaken + 1) * yCount <= (yTaken + 1) * xCount;
    }

    if (moveX) {
      x += xStep;
      xTaken++;
    } else {
      y += yStep;
      yTaken++;
    }
    yield { x, y };
  }
}

/**
 * Auto-wall/auto-box brush for whole-sheet Cell drawing.
 */
export class AdaptiveStrokeTool {
  constructor() {
    this.canvas = null;
    this.glyph = 0;
    this.fg = [255, 255, 255];
    this.bg = [0, 0, 0];
    this.lineStyle = 'single';
    this.applyModes = {
      glyph: true,
      foreground: true,
      background: true,
    };

    this.isDragging = false;
    this.lastCell = null;
    this._nodes = new Map();
    this._edges = new Set();
    this._strokeLineStyle = 'single';
  }

  setCanvas(canvas) {
    this.canvas = canvas;
  }

  /** Selects single or double walls from the active CP437 glyph, if possible. */
  setGlyph(code) {
    this.glyph = Number(code) & 0xFF;
    this.lineStyle = DOUBLE_LINE_SET.has(this.glyph) ? 'double' : 'single';
  }

  setLineStyle(style) {
    if (style !== 'single' && style !== 'double') return false;
    this.lineStyle = style;
    return true;
  }

  setColors(fg, bg) {
    this.fg = [...fg];
    this.bg = [...bg];
  }

  setApplyModes(modes = {}) {
    for (const channel of ['glyph', 'foreground', 'background']) {
      if (typeof modes[channel] === 'boolean') {
        this.applyModes[channel] = modes[channel];
      }
    }
  }

  /** One-cell click, kept compatible with Cell-style tool adapters. */
  paint(x, y) {
    this.startDrag(x, y);
    this.endDrag();
  }

  startDrag(x, y) {
    if (!this._isValidCell(x, y)) return;

    this._resetStroke();
    this.isDragging = true;
    this._strokeLineStyle = this.lineStyle;
    const cell = { x, y };
    const node = { ...cell, mask: 0 };
    this._nodes.set(cellKey(x, y), node);
    this.lastCell = cell;
    this._paintNode(node);
  }

  drag(x, y) {
    if (!this.isDragging) return;
    if (!this._isValidCell(x, y)) {
      // Do not join a later in-bounds sample across an off-canvas gap.
      this.lastCell = null;
      return;
    }

    const target = { x, y };
    if (!this.lastCell) {
      const node = this._getOrCreateNode(target);
      this._paintNode(node);
      this.lastCell = target;
      return;
    }

    let previous = this.lastCell;
    for (const next of orthogonalSteps(previous, target)) {
      this._connect(previous, next);
      previous = next;
    }
    this.lastCell = target;
  }

  endDrag() {
    this._resetStroke();
  }

  /** Stop accepting pointer samples; existing writes remain in the caller's undo transaction. */
  cancelDrag() {
    this._resetStroke();
  }

  deactivate() {
    this.cancelDrag();
  }

  _isValidCell(x, y) {
    if (!this.canvas || !Number.isInteger(x) || !Number.isInteger(y)) return false;
    if (Number.isFinite(this.canvas.width) && (x < 0 || x >= this.canvas.width)) return false;
    if (Number.isFinite(this.canvas.height) && (y < 0 || y >= this.canvas.height)) return false;
    return true;
  }

  _getOrCreateNode(cell) {
    const key = cellKey(cell.x, cell.y);
    let node = this._nodes.get(key);
    if (!node) {
      node = { x: cell.x, y: cell.y, mask: 0 };
      this._nodes.set(key, node);
    }
    return node;
  }

  _connect(from, to) {
    const forward = directionMask(from, to);
    if (!forward) return;
    const key = edgeKey(from, to);
    if (this._edges.has(key)) return;

    const first = this._getOrCreateNode(from);
    const second = this._getOrCreateNode(to);
    const reverse = directionMask(to, from);
    first.mask |= forward;
    second.mask |= reverse;
    this._edges.add(key);

    // Stable write order makes the resulting canvas operation reproducible.
    this._paintNode(first);
    this._paintNode(second);
  }

  _paintNode(node) {
    if (!this.canvas || typeof this.canvas.setCell !== 'function') return;
    const existing = typeof this.canvas.getCell === 'function'
      ? this.canvas.getCell(node.x, node.y)
      : null;
    const glyph = (this._strokeLineStyle === 'double' ? DOUBLE_LINE_GLYPHS : SINGLE_LINE_GLYPHS)[node.mask];
    const nextGlyph = this.applyModes.glyph ? glyph : (existing ? existing.glyph : this.glyph);
    const nextFg = this.applyModes.foreground ? [...this.fg] : (existing ? [...existing.fg] : [...this.fg]);
    const nextBg = this.applyModes.background ? [...this.bg] : (existing ? [...existing.bg] : [...this.bg]);

    if (existing
      && existing.glyph === nextGlyph
      && existing.fg?.[0] === nextFg[0]
      && existing.fg?.[1] === nextFg[1]
      && existing.fg?.[2] === nextFg[2]
      && existing.bg?.[0] === nextBg[0]
      && existing.bg?.[1] === nextBg[1]
      && existing.bg?.[2] === nextBg[2]) {
      return;
    }

    try {
      this.canvas.setCell(node.x, node.y, nextGlyph, nextFg, nextBg);
    } catch (error) {
      console.warn(`AdaptiveStrokeTool paint error at (${node.x}, ${node.y}): ${error.message}`);
    }
  }

  _resetStroke() {
    this.isDragging = false;
    this.lastCell = null;
    this._nodes.clear();
    this._edges.clear();
  }
}

// Export the mapping for focused contract tests and any future UI diagnostics.
export const ADAPTIVE_STROKE_GLYPHS = Object.freeze({
  single: SINGLE_LINE_GLYPHS,
  double: DOUBLE_LINE_GLYPHS,
});

const SLOPE_GLYPHS = Object.freeze({
  horizontal: 45, // -
  vertical: 124,  // |
  rising: 47,     // /
  falling: 92,    // \
});

function* lineCells(start, end) {
  let x = start.x;
  let y = start.y;
  const dx = Math.abs(end.x - start.x);
  const sx = start.x < end.x ? 1 : -1;
  const dy = -Math.abs(end.y - start.y);
  const sy = start.y < end.y ? 1 : -1;
  let error = dx + dy;
  while (x !== end.x || y !== end.y) {
    const twice = 2 * error;
    if (twice >= dy) { error += dy; x += sx; }
    if (twice <= dx) { error += dx; y += sy; }
    yield { x, y };
  }
}

function slopeGlyph(dx, dy) {
  if (dx === 0) return SLOPE_GLYPHS.vertical;
  const magnitude = Math.abs(dy / dx);
  if (magnitude > 1.6) return SLOPE_GLYPHS.vertical;
  if (magnitude > 0.75) return Math.sign(dx) === Math.sign(dy)
    ? SLOPE_GLYPHS.falling
    : SLOPE_GLYPHS.rising;
  return SLOPE_GLYPHS.horizontal;
}

/**
 * Direction-sensitive ASCII brush recovered from the documented later brush
 * contract. Unlike Auto-wall, this tool quantizes each pointer segment's
 * slope to -, |, /, or \\ and therefore keeps diagonal intent visible.
 */
export class SlopeStrokeTool {
  constructor() {
    this.canvas = null;
    this.fg = [255, 255, 255];
    this.bg = [0, 0, 0];
    this.applyModes = { glyph: true, foreground: true, background: true };
    this.isDragging = false;
    this.lastCell = null;
  }

  setCanvas(canvas) { this.canvas = canvas; }
  setGlyph() {}
  setColors(fg, bg) { this.fg = [...fg]; this.bg = [...bg]; }
  setApplyModes(modes = {}) {
    for (const channel of ['glyph', 'foreground', 'background']) {
      if (typeof modes[channel] === 'boolean') this.applyModes[channel] = modes[channel];
    }
  }

  startDrag(x, y) {
    if (!this._isValidCell(x, y)) return;
    this.isDragging = true;
    this.lastCell = { x, y };
    this._paint(x, y, SLOPE_GLYPHS.horizontal);
  }

  drag(x, y) {
    if (!this.isDragging) return;
    if (!this._isValidCell(x, y)) {
      this.lastCell = null;
      return;
    }
    const target = { x, y };
    if (!this.lastCell) {
      this.lastCell = target;
      this._paint(target.x, target.y, SLOPE_GLYPHS.horizontal);
      return;
    }
    const dx = target.x - this.lastCell.x;
    const dy = target.y - this.lastCell.y;
    if (dx === 0 && dy === 0) return;
    const glyph = slopeGlyph(dx, dy);
    this._paint(this.lastCell.x, this.lastCell.y, glyph);
    for (const cell of lineCells(this.lastCell, target)) this._paint(cell.x, cell.y, glyph);
    this.lastCell = target;
  }

  endDrag() { this.cancelDrag(); }
  deactivate() { this.cancelDrag(); }
  cancelDrag() { this.isDragging = false; this.lastCell = null; }

  _isValidCell(x, y) {
    return !!this.canvas && Number.isInteger(x) && Number.isInteger(y)
      && (!Number.isFinite(this.canvas.width) || (x >= 0 && x < this.canvas.width))
      && (!Number.isFinite(this.canvas.height) || (y >= 0 && y < this.canvas.height));
  }

  _paint(x, y, glyph) {
    const existing = typeof this.canvas.getCell === 'function' ? this.canvas.getCell(x, y) : null;
    const nextGlyph = this.applyModes.glyph ? glyph : (existing?.glyph ?? 0);
    const nextFg = this.applyModes.foreground ? [...this.fg] : [...(existing?.fg ?? this.fg)];
    const nextBg = this.applyModes.background ? [...this.bg] : [...(existing?.bg ?? this.bg)];
    this.canvas.setCell(x, y, nextGlyph, nextFg, nextBg);
  }
}

export const SLOPE_STROKE_GLYPHS = SLOPE_GLYPHS;
