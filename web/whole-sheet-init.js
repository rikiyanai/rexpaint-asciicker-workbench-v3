/**
 * Whole-Sheet XP Editor Integration
 *
 * REXPaint-style left-sidebar + canvas layout (spec sections 3.1-3.9).
 * Hydrates from backend session layers (state.layers), NOT from JS XP file I/O.
 * Supports cell draw, eyedropper, erase with active-layer-aware editing.
 *
 * Layout regions:
 *   Left sidebar: Mode, Glyph, Palette, Tools/Apply, Image/Draw, Layers, Info
 *   Center: Whole-sheet canvas (primary editing surface)
 */

import { Canvas } from './rexpaint-editor/canvas.js';
import { LayerStack } from './rexpaint-editor/layer-stack.js';
import { CP437Font } from './rexpaint-editor/cp437-font.js';
import { CellTool } from './rexpaint-editor/tools/cell-tool.js';
import { AdaptiveStrokeTool, SlopeStrokeTool } from './rexpaint-editor/tools/adaptive-stroke-tool.js?v=20261012-slope1';
import { LineTool } from './rexpaint-editor/tools/line-tool.js';
import { OvalTool } from './rexpaint-editor/tools/oval-tool.js';
import { RectTool } from './rexpaint-editor/tools/rect-tool.js';
import { FillTool } from './rexpaint-editor/tools/fill-tool.js';
import { SelectTool } from './rexpaint-editor/tools/select-tool.js';
import { TextTool } from './rexpaint-editor/tools/text-tool.js';
import {
  captureVisibleSelectionClipboard,
  countClipboardCells,
  getActiveWritableLayerIndex,
  getVisibleUnlockedLayerIndices,
  resolveWritableClipboardLayers,
} from './whole-sheet-clipboard.mjs';
import {
  buildClearedEditorCell,
  cloneEditorCell,
  shouldCopyCellOnLayerMerge,
} from './whole-sheet-cell-ops.mjs';
import { shouldCycleActiveLayerOnWheel } from './whole-sheet-input-policy.mjs';
import { attach as attachGestures, detach as detachGestures, isGestureActive, snapToLevel } from './touch-gestures.mjs';
import {
  saveDraft as _persistSaveDraft,
  cleanupStaleDrafts as _persistCleanup,
  isAvailable as _persistIsAvailable,
} from './persistence.mjs';

const _BP = String(window.__WB_BASE_PATH || '');
const FONT_URL = _BP + '/termpp-web-flat/fonts/cp437_12x12.png';
const CELL_SIZE = 12;
const PALETTE_CELL = 11;
const HISTORY_LIMIT = 50;
const DRAFT_SAVE_DEBOUNCE_MS = 2000;
const DRAFT_UNDO_BOUND = 5;

/** Debounce timer for draft auto-save. */
let _draftSaveTimer = null;

/**
 * Build a draft payload from current editor state.
 * Mirrors the session save payload structure from workbench.js.
 * Undo history is bounded to last DRAFT_UNDO_BOUND entries.
 */
function _buildDraftPayload() {
  if (!editorState.mounted) return null;
  const snapshot = _buildDocumentSnapshot();
  if (!snapshot) return null;
  const boundedHistory = editorState.history.slice(-DRAFT_UNDO_BOUND);
  return {
    timestamp: Date.now(),
    sessionId: editorState.currentSessionId || '',
    // Document state (mirrors saveSessionState payload)
    layers: snapshot.layers,
    layerNames: snapshot.layerNames,
    activeLayer: snapshot.activeLayer,
    visibleLayers: snapshot.visibleLayers,
    lockedLayers: snapshot.lockedLayers,
    gridCols: snapshot.gridCols,
    gridRows: snapshot.gridRows,
    frameW: snapshot.frameW,
    frameH: snapshot.frameH,
    canvasZoom: snapshot.canvasZoom,
    gridVisible: snapshot.gridVisible,
    gridStep: snapshot.gridStep,
    gridCustomW: snapshot.gridCustomW,
    gridCustomH: snapshot.gridCustomH,
    // Editor state
    activeTool: editorState.activeTool,
    mode: editorState.mode,
    drawGlyph: editorState.drawGlyph,
    drawFg: editorState.drawFg,
    drawBg: editorState.drawBg,
    applyGlyph: editorState.applyGlyph,
    applyFg: editorState.applyFg,
    applyBg: editorState.applyBg,
    // Bounded undo history (last N snapshots only)
    history: boundedHistory,
  };
}

/**
 * Schedule a debounced draft save.
 * Resets the timer on each call — only fires once activity settles.
 */
function _scheduleDraftSave() {
  if (!_persistIsAvailable()) return;
  if (_draftSaveTimer !== null) {
    clearTimeout(_draftSaveTimer);
  }
  _draftSaveTimer = setTimeout(() => {
    _draftSaveTimer = null;
    const payload = _buildDraftPayload();
    if (payload) {
      _persistSaveDraft(payload).catch(() => { /* silent */ });
    }
  }, DRAFT_SAVE_DEBOUNCE_MS);
}

const DEFAULT_PALETTE = [
  // Grayscale
  [0,0,0],[17,17,17],[34,34,34],[51,51,51],[68,68,68],[85,85,85],[102,102,102],[119,119,119],
  [136,136,136],[153,153,153],[170,170,170],[187,187,187],[204,204,204],[221,221,221],[238,238,238],[255,255,255],
  // Saturated hues
  [255,0,0],[255,85,0],[255,170,0],[255,255,0],[170,255,0],[85,255,0],[0,255,0],[0,255,85],
  [0,255,170],[0,255,255],[0,170,255],[0,85,255],[0,0,255],[85,0,255],[170,0,255],[255,0,170],
  // Light / pastel
  [255,128,128],[255,170,128],[255,213,128],[255,255,128],[213,255,128],[170,255,128],[128,255,128],[128,255,170],
  [128,255,213],[128,255,255],[128,213,255],[128,170,255],[128,128,255],[170,128,255],[213,128,255],[255,128,213],
  // Dark
  [128,0,0],[128,43,0],[128,85,0],[128,128,0],[85,128,0],[43,128,0],[0,128,0],[0,128,43],
  [0,128,85],[0,128,128],[0,85,128],[0,43,128],[0,0,128],[43,0,128],[85,0,128],[128,0,85],
];
const PALETTE_COLS = 16;
const PALETTE_ROWS = Math.ceil(DEFAULT_PALETTE.length / PALETTE_COLS);

// ── Inline tool classes ──

class EyedropperTool {
  constructor() {
    this.canvas = null;
    this._onSample = null;
  }
  setCanvas(canvas) { this.canvas = canvas; }
  setOnSample(fn) { this._onSample = fn; }
  startDrag(x, y) { this._sample(x, y); }
  drag(x, y) { this._sample(x, y); }
  endDrag() {}
  _sample(x, y) {
    if (!this.canvas) return;
    if (x < 0 || y < 0 || x >= this.canvas.width || y >= this.canvas.height) return;
    const ls = this.canvas.layerStack;
    let cell;
    if (ls) {
      const activeLayer = ls.getActiveLayer();
      cell = activeLayer ? activeLayer.getCell(x, y) : null;
    }
    if (!cell) {
      try { cell = this.canvas.getCell(x, y); } catch (_) { return; }
    }
    if (cell && this._onSample) {
      this._onSample(cell.glyph, [...(cell.fg || [255,255,255])], [...(cell.bg || [0,0,0])]);
    }
  }
}

class EraseTool {
  constructor() {
    this.canvas = null;
    this.isDragging = false;
    this.lastX = 0;
    this.lastY = 0;
  }
  setCanvas(canvas) { this.canvas = canvas; }
  startDrag(x, y) {
    this.isDragging = true;
    this.lastX = x;
    this.lastY = y;
    this._erase(x, y);
  }
  drag(x, y) {
    if (!this.isDragging) return;
    const cells = this._line(this.lastX, this.lastY, x, y);
    for (const c of cells) this._erase(c.x, c.y);
    this.lastX = x;
    this.lastY = y;
  }
  endDrag() { this.isDragging = false; }
  _erase(x, y) {
    if (!this.canvas) return;
    if (x < 0 || y < 0 || x >= this.canvas.width || y >= this.canvas.height) return;
    const activeLayer = this.canvas.layerStack && this.canvas.layerStack.getActiveLayer();
    if (activeLayer) {
      const cell = activeLayer.getCell(x, y);
      if (cell && cell.bg && cell.bg[0] === 255 && cell.bg[1] === 0 && cell.bg[2] === 255) return;
    }
    this.canvas.setCell(x, y, 0, [255, 255, 255], [255, 0, 255]);
  }
  _line(x0, y0, x1, y1) {
    const cells = [];
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy, x = x0, y = y0;
    while (true) {
      cells.push({ x, y });
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
    return cells;
  }
}

// ── Tool adapters (bridge startDrag/drag/endDrag to underlying tool APIs) ──

class LineToolAdapter {
  constructor() { this._tool = new LineTool(); }
  setCanvas(c) { this._tool.setCanvas(c); }
  setGlyph(code) { this._tool.setGlyph(code); }
  setColors(fg, bg) { this._tool.setColors(fg, bg); }
  setApplyModes(modes) { this._tool.setApplyModes(modes); }
  startDrag(x, y) { this._tool.startLine(x, y); }
  drag(x, y) { this._tool.drawLine(x, y); }
  endDrag() { this._tool.endLine(); }
}

class RectToolAdapter {
  constructor() { this._tool = new RectTool(); this._tool.setMode('outline'); }
  setCanvas(c) { this._tool.setCanvas(c); }
  setGlyph(code) { this._tool.setGlyph(code); }
  setColors(fg, bg) { this._tool.setColors(fg, bg); }
  setApplyModes(modes) { this._tool.setApplyModes(modes); }
  setMode(mode) { this._tool.setMode(mode); }
  startDrag(x, y) { this._tool.startRect(x, y); }
  drag(x, y) { this._tool.drawRect(x, y); }
  endDrag() { this._tool.endRect(); }
}

class FillToolAdapter {
  constructor() { this._tool = new FillTool(); }
  setCanvas(c) { this._tool.setCanvas(c); }
  setGlyph(code) { this._tool.setGlyph(code); }
  setColors(fg, bg) { this._tool.setColors(fg, bg); }
  setApplyModes(modes) { this._tool.setApplyModes(modes); }
  startDrag(x, y) { this._tool.fill(x, y); }
  drag() {}
  endDrag() {}
}

class OvalToolAdapter {
  constructor() { this._tool = new OvalTool(); this._tool.setMode('outline'); }
  setCanvas(c) { this._tool.setCanvas(c); }
  setGlyph(code) { this._tool.setGlyph(code); }
  setColors(fg, bg) { this._tool.setColors(fg, bg); }
  setApplyModes(modes) { this._tool.setApplyModes(modes); }
  setMode(mode) { this._tool.setMode(mode); }
  startDrag(x, y) { this._tool.startDrag(x, y); }
  drag(x, y) { this._tool.drag(x, y); }
  endDrag() { this._tool.endDrag(); }
  cancelDrag() { this._tool.isDrawing = false; }
}

class TextToolAdapter {
  constructor() { this._tool = new TextTool(); }
  setCanvas(c) { this._tool.setCanvas(c); }
  setColors(fg, bg) { this._tool.setColors(fg, bg); }
  setApplyModes(modes) { this._tool.setApplyModes(modes); }
  setText(text) { this._tool.setText(text); }
  paint(x, y) { this._tool.paint(x, y); }
  startDrag(x, y) { _startTextEdit(x, y); }
  drag() {}
  endDrag() {}
}

class SelectToolAdapter {
  constructor() { this._tool = new SelectTool(); }
  setCanvas(c) { this._tool.setCanvas(c); }
  startDrag(x, y) { this._tool.startSelection(x, y); }
  drag(x, y) { this._tool.updateSelection(x, y); }
  endDrag() { this._tool.endSelection(); }
  startSelection(x, y) { this._tool.startSelection(x, y); }
  updateSelection(x, y) { this._tool.updateSelection(x, y); }
  endSelection() { this._tool.endSelection(); }
  getSelectionBounds() { return this._tool.getSelectionBounds(); }
  clearSelection() { this._tool.clearSelection(); }
  deactivate() { this._tool.deactivate(); }
}

function _forEachTool(fn) {
  for (const t of [
    editorState.cellTool,
    editorState.slopeStrokeTool,
    editorState.adaptiveStrokeTool,
    editorState.lineTool,
    editorState.rectTool,
    editorState.ovalTool,
    editorState.fillTool,
    editorState.textTool,
  ]) {
    if (t) fn(t);
  }
}

function _setToolGlyph(tool, glyph) {
  if (tool && typeof tool.setGlyph === 'function') tool.setGlyph(glyph);
}

function _setToolColors(tool, fg, bg) {
  if (tool && typeof tool.setColors === 'function') tool.setColors(fg, bg);
}

function _setToolApplyModes(tool, modes) {
  if (tool && typeof tool.setApplyModes === 'function') tool.setApplyModes(modes);
}

const FIT_ZOOM = 0;
const CANVAS_ZOOM_MIN = 0.5;
const CANVAS_ZOOM_MAX = 6;
const CANVAS_ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2, 3, 4];

// ── Editor state ──

let editorState = {
  mounted: false,
  canvas: null,
  layerStack: null,
  cp437Font: null,
  cellTool: null,
  slopeStrokeTool: null,
  adaptiveStrokeTool: null,
  eyedropperTool: null,
  eraseTool: null,
  lineTool: null,
  ovalTool: null,
  rectTool: null,
  fillTool: null,
  textTool: null,
  selectTool: null,
  mode: 'browse',
  activeTool: 'cell',
  gridCols: 0,
  gridRows: 0,
  containerEl: null,
  currentSessionId: '',
  drawGlyph: 64,
  drawFg: [255, 255, 255],
  drawBg: [0, 0, 0],
  // B3/B4 recents — last-used colors per channel (LRU, max 8 each).
  recentFg: [],
  recentBg: [],
  applyGlyph: true,
  applyFg: true,
  applyBg: true,
  onCellEdited: null,
  onStrokeComplete: null,
  onActiveLayerChanged: null,
  onLayerVisibilityChanged: null,
  onAddLayer: null,
  onDeleteLayer: null,
  onMoveLayer: null,
  onSave: null,
  onExport: null,
  onResize: null,
  onBrowseList: null,
  onBrowseOpen: null,
  onBrowseRename: null,
  onBrowseDuplicate: null,
  onBrowseDelete: null,
  onBrowsePreview: null,
  onBrowseNewRaw: null,
  onDocumentStateChange: null,
  onHistoryStateChange: null,
  // U3: tap-hold inspect state
  _tapHoldTimer: null,
  _tapHoldStartX: 0,
  _tapHoldStartY: 0,
  _tapHoldFired: false,
  _lastTouchPointerType: '',
  _strokeDirty: false,
  _pendingHistorySnapshot: null,
  _gestureStartZoom: null,
  history: [],
  future: [],
  // Clipboard state (W19-W22 parity)
  clipboard: null,       // {bounds: {x, y, w, h}, layers: [{layerIndex, cells: [...]}, ...]}
  pasteMode: false,
  browseItems: [],
  browseSelectedId: '',
  browseLoading: false,
  browseError: '',
  canvasZoom: FIT_ZOOM,
  appliedCanvasZoom: 1,
  gridVisible: false,
  gridStep: 'frame',
  gridCustomW: 1,
  gridCustomH: 1,
  gridTemplatePresets: [],
  sessionKind: '',
  metadataStatus: '',
  viewportResizeObserver: null,
  layerNames: [],
  // Match-source cell for Replace FG/BG (W29/W30 parity).
  // Set only from explicit sample actions (eyedropper).
  // Contract: lastSampledCell.fg is the match target for Replace FG,
  //           lastSampledCell.bg is the match target for Replace BG.
  lastSampledCell: null,  // {glyph, fg: [r,g,b], bg: [r,g,b]}
  textEdit: null,         // {anchorX, anchorY, cursorX, cursorY, active, dirty}
  spacePan: {
    armed: false,
    dragging: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    scrollLeft: 0,
    scrollTop: 0,
  },
  _gestureActive: false,
};

// Optional app-shell host for the root editor's Browse surface. The list and
// selection state remain owned here even before a document is mounted.
let browseAppHostEl = null;

function _normalizeCanvasZoomValue(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return FIT_ZOOM;
  if (n <= FIT_ZOOM) return FIT_ZOOM;
  return Math.max(CANVAS_ZOOM_MIN, Math.min(CANVAS_ZOOM_MAX, n));
}

function _zoomLabel(z) {
  const n = Number(z || 0);
  if (!Number.isFinite(n) || n <= 0) return '0x';
  const fixed = n >= 1 ? n.toFixed(2) : n.toFixed(3);
  return `${fixed.replace(/\.?0+$/, '')}x`;
}

function _fitCanvasZoom() {
  const scrollWrap = document.getElementById('wholeSheetScroll');
  if (!scrollWrap || !editorState.gridCols || !editorState.gridRows) return 1;
  const baseW = Math.max(1, editorState.gridCols * CELL_SIZE);
  const baseH = Math.max(1, editorState.gridRows * CELL_SIZE);
  const viewW = Math.max(1, scrollWrap.clientWidth);
  const viewH = Math.max(1, scrollWrap.clientHeight);
  const fit = Math.min(viewW / baseW, viewH / baseH);
  // Paintable floor: Fit never shrinks below CANVAS_ZOOM_MIN (0.5x). A 126x80
  // sheet in a 390px viewport used to land at ~0.22x — a tiny strip that
  // cannot be painted. Below the floor the scroll wrap pans instead.
  return Math.max(CANVAS_ZOOM_MIN, Math.min(1, Number.isFinite(fit) ? fit : 1));
}

function _resolvedCanvasZoom() {
  editorState.canvasZoom = _normalizeCanvasZoomValue(editorState.canvasZoom);
  if (editorState.canvasZoom > FIT_ZOOM) return editorState.canvasZoom;
  return _fitCanvasZoom();
}

function _canvasZoomStateValue() {
  return editorState.canvasZoom > FIT_ZOOM ? editorState.canvasZoom : _resolvedCanvasZoom();
}

function _applyCanvasZoom({ preserveCenter = false } = {}) {
  const canvasEl = document.getElementById('wholeSheetCanvas');
  const scrollWrap = document.getElementById('wholeSheetScroll');
  if (!canvasEl || !scrollWrap) return;

  const prevZoom = Math.max(0.05, Number(editorState.appliedCanvasZoom || 1));
  const centerX = preserveCenter ? (scrollWrap.scrollLeft + (scrollWrap.clientWidth / 2)) / prevZoom : 0;
  const centerY = preserveCenter ? (scrollWrap.scrollTop + (scrollWrap.clientHeight / 2)) / prevZoom : 0;

  const nextZoom = _resolvedCanvasZoom();
  canvasEl.style.width = `${Math.max(1, Math.round(canvasEl.width * nextZoom))}px`;
  canvasEl.style.height = `${Math.max(1, Math.round(canvasEl.height * nextZoom))}px`;
  canvasEl.style.margin = '0 auto';
  editorState.appliedCanvasZoom = nextZoom;
  // Small-screen hook (styles owned elsewhere): flag when the sheet exceeds
  // the viewport so pan chrome can surface without JS restyle here.
  try {
    scrollWrap.dataset.overflowX = String(canvasEl.width * nextZoom > scrollWrap.clientWidth + 1);
    scrollWrap.dataset.overflowY = String(canvasEl.height * nextZoom > scrollWrap.clientHeight + 1);
  } catch (_e) { /* dataset best-effort only */ }

  const input = document.getElementById('wsCanvasZoomInput');
  if (input) input.value = String(editorState.canvasZoom);
  const valueEl = document.getElementById('wsCanvasZoomValue');
  if (valueEl) {
    valueEl.textContent = editorState.canvasZoom <= FIT_ZOOM
      ? `Fit (${_zoomLabel(nextZoom)})`
      : _zoomLabel(nextZoom);
  }

  if (preserveCenter) {
    const nextLeft = Math.max(0, (centerX * nextZoom) - (scrollWrap.clientWidth / 2));
    const nextTop = Math.max(0, (centerY * nextZoom) - (scrollWrap.clientHeight / 2));
    scrollWrap.scrollLeft = nextLeft;
    scrollWrap.scrollTop = nextTop;
  }
}

function _stepCanvasZoom(delta) {
  const current = _canvasZoomStateValue();
  let next = CANVAS_ZOOM_STEPS[0];
  if (delta > 0) {
    next = CANVAS_ZOOM_STEPS.find((value) => value > (current + 0.001)) || CANVAS_ZOOM_STEPS[CANVAS_ZOOM_STEPS.length - 1];
  } else {
    const reversed = [...CANVAS_ZOOM_STEPS].reverse();
    next = reversed.find((value) => value < (current - 0.001)) || CANVAS_ZOOM_STEPS[0];
  }
  editorState.canvasZoom = next;
  _applyCanvasZoom({ preserveCenter: true });
  _emitDocumentStateChange('zoom');
}

function _toggleGridVisibility() {
  const next = !editorState.gridVisible;
  editorState.gridVisible = next;
  const gridBtn = document.getElementById('wsGridToggle');
  if (gridBtn) gridBtn.classList.toggle('ws-toggle-on', next);
  if (next) _applyGridStepToCanvas();
  if (editorState.canvas) editorState.canvas.setGridVisible(next);
  _emitDocumentStateChange('grid-toggle');
}

function _coerceGridSize(value, fallback = 1) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return Math.max(1, Number(fallback) || 1);
  return Math.max(1, Math.floor(n));
}

function _normalizeGridStepToken(value) {
  const token = String(value || 'frame').trim();
  if (!token) return 'frame';
  if (/^\d+$/.test(token)) return String(_coerceGridSize(token, 1));
  if (token === 'frame' || token === 'custom' || token === 'layer0_metadata') return token;
  if (token.startsWith('template:')) return token;
  return 'frame';
}

function _findTemplateGridPreset(tokenOrKey) {
  const key = String(tokenOrKey || '').replace(/^template:/, '');
  return (editorState.gridTemplatePresets || []).find((preset) => String(preset?.key || '') === key) || null;
}

function _metadataGridDimensions() {
  const status = String(editorState.metadataStatus || '');
  if (status !== 'valid' && status !== 'generated') return null;
  return {
    width: _coerceGridSize(editorState.frameW, editorState.gridCols || 1),
    height: _coerceGridSize(editorState.frameH, editorState.gridRows || 1),
  };
}

function _ensureValidGridStepToken() {
  const token = _normalizeGridStepToken(editorState.gridStep);
  if (token.startsWith('template:') && !_findTemplateGridPreset(token)) {
    editorState.gridStep = 'frame';
    return;
  }
  editorState.gridStep = token;
}

function _resolveGridStepConfig() {
  _ensureValidGridStepToken();
  const token = editorState.gridStep;
  if (token === 'frame') {
    return {
      token,
      width: _coerceGridSize(editorState.frameW, editorState.gridCols || 1),
      height: _coerceGridSize(editorState.frameH, editorState.gridRows || 1),
    };
  }
  if (token === 'custom') {
    return {
      token,
      width: _coerceGridSize(editorState.gridCustomW, 1),
      height: _coerceGridSize(editorState.gridCustomH, 1),
    };
  }
  if (token === 'layer0_metadata') {
    const dims = _metadataGridDimensions();
    if (dims) {
      return { token, width: dims.width, height: dims.height };
    }
    return {
      token,
      width: _coerceGridSize(editorState.frameW, editorState.gridCols || 1),
      height: _coerceGridSize(editorState.frameH, editorState.gridRows || 1),
    };
  }
  if (token.startsWith('template:')) {
    const preset = _findTemplateGridPreset(token);
    if (preset) {
      return {
        token,
        width: _coerceGridSize(preset.width, editorState.frameW || 1),
        height: _coerceGridSize(preset.height, editorState.frameH || 1),
      };
    }
  }
  const step = _coerceGridSize(token, 1);
  return { token: String(step), width: step, height: step };
}

function _syncGridControlsUI() {
  const select = document.getElementById('wsGridStep');
  if (select) select.value = editorState.gridStep;
  const customW = document.getElementById('wsGridCustomW');
  const customH = document.getElementById('wsGridCustomH');
  const customActive = editorState.gridStep === 'custom';
  if (customW) {
    customW.value = String(_coerceGridSize(editorState.gridCustomW, 1));
    customW.disabled = !customActive;
  }
  if (customH) {
    customH.value = String(_coerceGridSize(editorState.gridCustomH, 1));
    customH.disabled = !customActive;
  }
  const metaOption = document.getElementById('wsGridStepLayer0Meta');
  if (metaOption) {
    const dims = _metadataGridDimensions();
    metaOption.disabled = !dims;
    metaOption.textContent = dims
      ? `Layer0 Meta (${dims.width}×${dims.height})`
      : 'Layer0 Meta';
  }
  _syncFindReplaceScopeUI();
}

function _coerceGridOffset(value, fallback, maxInclusive) {
  const n = Number(value);
  const safeFallback = Math.max(0, Number(fallback) || 0);
  const bounded = Number.isFinite(maxInclusive) ? Math.max(0, Math.floor(maxInclusive)) : null;
  const next = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : safeFallback;
  if (bounded === null) return next;
  return Math.max(0, Math.min(bounded, next));
}

function _syncFindReplaceScopeUI() {
  const scopeSel = document.getElementById('wsFrScope');
  const xInput = document.getElementById('wsFrGridCellX');
  const yInput = document.getElementById('wsFrGridCellY');
  const hint = document.getElementById('wsFrGridHint');
  if (!scopeSel) return;
  const resolved = _resolveGridStepConfig();
  const maxX = Math.max(0, Number(resolved.width || 1) - 1);
  const maxY = Math.max(0, Number(resolved.height || 1) - 1);
  const gridScope = scopeSel.value === 'grid_frames';
  if (xInput) {
    xInput.min = '0';
    xInput.max = String(maxX);
    xInput.disabled = !gridScope;
    xInput.value = String(_coerceGridOffset(xInput.value, xInput.value, maxX));
  }
  if (yInput) {
    yInput.min = '0';
    yInput.max = String(maxY);
    yInput.disabled = !gridScope;
    yInput.value = String(_coerceGridOffset(yInput.value, yInput.value, maxY));
  }
  if (hint) {
    hint.textContent = gridScope ? `Frame-local cell 0-${maxX}, 0-${maxY}` : '';
  }
}

function _disconnectViewportResizeObserver() {
  if (editorState.viewportResizeObserver) {
    editorState.viewportResizeObserver.disconnect();
    editorState.viewportResizeObserver = null;
  }
}

function _observeCanvasViewport() {
  _disconnectViewportResizeObserver();
  if (typeof ResizeObserver !== 'function') return;
  const shell = document.getElementById('wholeSheetViewportShell');
  if (!shell) return;
  editorState.viewportResizeObserver = new ResizeObserver(() => {
    if (editorState.canvasZoom <= FIT_ZOOM) _applyCanvasZoom();
  });
  editorState.viewportResizeObserver.observe(shell);
}

// ── mount ──

async function mount({
  container,
  gridCols,
  gridRows,
  frameW,
  frameH,
  layers,
  layerNames,
  activeLayer,
  visibleLayers,
  lockedLayers,
  currentSessionId,
  sessionKind,
  metadataStatus,
  gridCustomW,
  gridCustomH,
  gridTemplatePresets,
  canvasZoom,
  gridVisible,
  gridStep,
  onCellEdited,
  onStrokeComplete,
  onActiveLayerChanged,
  onLayerVisibilityChanged,
  onAddLayer,
  onDeleteLayer,
  onMoveLayer,
  onSave,
  onExport,
  onResize,
  onBrowseList,
  onBrowseOpen,
  onBrowseRename,
  onBrowseDuplicate,
  onBrowseDelete,
  onBrowsePreview,
  onBrowseNewRaw,
  onDocumentStateChange,
  onHistoryStateChange,
}) {
  if (editorState.mounted) unmount();

  editorState.gridCols = gridCols;
  editorState.gridRows = gridRows;
  editorState.frameW = frameW || gridCols;
  editorState.frameH = frameH || gridRows;
  editorState.containerEl = container;
  editorState.currentSessionId = String(currentSessionId || '').trim();
  editorState.sessionKind = String(sessionKind || '').trim();
  editorState.metadataStatus = String(metadataStatus || '').trim();
  editorState.layerNames = Array.isArray(layerNames) ? [...layerNames] : [];
  editorState.canvasZoom = _normalizeCanvasZoomValue(canvasZoom);
  editorState.gridVisible = !!gridVisible;
  editorState.gridStep = _normalizeGridStepToken(gridStep);
  editorState.gridCustomW = _coerceGridSize(gridCustomW, 1);
  editorState.gridCustomH = _coerceGridSize(gridCustomH, 1);
  editorState.gridTemplatePresets = Array.isArray(gridTemplatePresets) ? gridTemplatePresets.map((preset) => ({
    key: String(preset?.key || ''),
    label: String(preset?.label || preset?.key || ''),
    width: _coerceGridSize(preset?.width, 1),
    height: _coerceGridSize(preset?.height, 1),
  })).filter((preset) => preset.key) : [];
  _ensureValidGridStepToken();
  editorState.onCellEdited = onCellEdited || null;
  editorState.onStrokeComplete = onStrokeComplete || null;
  editorState.onActiveLayerChanged = onActiveLayerChanged || null;
  editorState.onLayerVisibilityChanged = onLayerVisibilityChanged || null;
  editorState.onAddLayer = onAddLayer || null;
  editorState.onDeleteLayer = onDeleteLayer || null;
  editorState.onMoveLayer = onMoveLayer || null;
  editorState.onSave = onSave || null;
  editorState.onExport = onExport || null;
  editorState.onResize = onResize || null;
  editorState.onBrowseList = onBrowseList || null;
  editorState.onBrowseOpen = onBrowseOpen || null;
  editorState.onBrowseRename = onBrowseRename || null;
  editorState.onBrowseDuplicate = onBrowseDuplicate || null;
  editorState.onBrowseDelete = onBrowseDelete || null;
  editorState.onBrowsePreview = onBrowsePreview || null;
  editorState.onBrowseNewRaw = onBrowseNewRaw || null;
  editorState.onDocumentStateChange = onDocumentStateChange || null;
  editorState.onHistoryStateChange = onHistoryStateChange || null;
  editorState.history = [];
  editorState.future = [];
  editorState._pendingHistorySnapshot = null;

  // Build DOM — REXPaint-style sidebar + canvas layout
  container.innerHTML = '';

  const layout = document.createElement('div');
  layout.className = 'ws-layout';

  // Left sidebar (spec sections 3.1-3.6, 3.9)
  const sidebar = _buildSidebar(layers.length, activeLayer, layerNames, visibleLayers, gridCols, gridRows);
  layout.appendChild(sidebar);

  // Center canvas area (spec section 3.7)
  const canvasArea = document.createElement('div');
  canvasArea.className = 'ws-canvas-area';

  const viewportShell = document.createElement('div');
  viewportShell.id = 'wholeSheetViewportShell';
  viewportShell.className = 'subpanel-shell ws-viewport-shell';
  viewportShell.dataset.panelNumber = '10A';
  viewportShell.dataset.panelTag = 'whole-sheet-view';

  const zoomRow = document.createElement('div');
  zoomRow.className = 'ws-zoom-row';

  const zoomLabel = document.createElement('label');
  zoomLabel.setAttribute('for', 'wsCanvasZoomInput');
  zoomLabel.textContent = '10A Whole-Sheet Zoom';
  zoomRow.appendChild(zoomLabel);

  const zoomInput = document.createElement('input');
  zoomInput.type = 'range';
  zoomInput.id = 'wsCanvasZoomInput';
  zoomInput.min = String(FIT_ZOOM);
  zoomInput.max = String(CANVAS_ZOOM_MAX);
  zoomInput.step = '0.25';
  zoomInput.value = String(editorState.canvasZoom);
  zoomInput.addEventListener('input', () => {
    editorState.canvasZoom = _normalizeCanvasZoomValue(zoomInput.value);
    _applyCanvasZoom({ preserveCenter: true });
  });
  zoomRow.appendChild(zoomInput);

  const zoomValue = document.createElement('span');
  zoomValue.id = 'wsCanvasZoomValue';
  zoomValue.className = 'small';
  zoomValue.textContent = 'Fit';
  zoomRow.appendChild(zoomValue);

  // FL-MOB-02: translucent pan chrome adjacent to zoom bar (mobile only via CSS)
  const scrollChrome = document.createElement('div');
  scrollChrome.className = 'ws-scroll-chrome';
  [
    { label: '◄', title: 'Pan left',  dx: -96, dy:   0 },
    { label: '►', title: 'Pan right', dx:  96, dy:   0 },
    { label: '▲', title: 'Pan up',    dx:   0, dy: -96 },
    { label: '▼', title: 'Pan down',  dx:   0, dy:  96 },
  ].forEach(({ label, title, dx, dy }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ws-scroll-chrome-btn';
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.textContent = label;
    btn.addEventListener('click', () => {
      const sw = document.getElementById('wholeSheetScroll');
      if (!sw) return;
      if (dx !== 0) sw.scrollLeft = Math.max(0, sw.scrollLeft + dx);
      if (dy !== 0) sw.scrollTop  = Math.max(0, sw.scrollTop  + dy);
    });
    scrollChrome.appendChild(btn);
  });
  zoomRow.appendChild(scrollChrome);

  viewportShell.appendChild(zoomRow);

  const scrollWrap = document.createElement('div');
  scrollWrap.id = 'wholeSheetScroll';
  scrollWrap.className = 'ws-scroll-wrap';
  viewportShell.appendChild(scrollWrap);

  const canvasEl = document.createElement('canvas');
  canvasEl.id = 'wholeSheetCanvas';
  canvasEl.style.imageRendering = 'pixelated';
  canvasEl.style.cursor = 'crosshair';
  scrollWrap.appendChild(canvasEl);

  canvasArea.appendChild(viewportShell);
  layout.appendChild(canvasArea);
  container.appendChild(layout);

  // U5: Shared drawer backdrop — visible when any drawer is open on mobile
  const drawerBackdrop = document.createElement('div');
  drawerBackdrop.className = 'ws-drawer-backdrop';
  drawerBackdrop.addEventListener('click', () => {
    if (typeof window.toggleDrawer === 'function') window.toggleDrawer(null);
  });
  container.appendChild(drawerBackdrop);

  // Create Canvas renderer
  const canvas = new Canvas(canvasEl, gridCols, gridRows, CELL_SIZE);
  editorState.canvas = canvas;

  // Load CP437 bitmap font
  const font = new CP437Font(FONT_URL, 12, 12);
  try {
    await font.load();
    editorState.cp437Font = font;
    await canvas.setFont(font);
  } catch (e) {
    console.warn('[whole-sheet] CP437 font load failed, using monospace fallback:', e.message);
  }

  // Build LayerStack from backend session layers
  const layerStack = new LayerStack(gridCols, gridRows);
  layerStack.layers.splice(0, 1);

  for (let li = 0; li < layers.length; li++) {
    const name = (layerNames && layerNames[li]) || `Layer ${li}`;
    layerStack.addLayer(name);
    const stackLayer = layerStack.layers[li];
    const flatCells = layers[li];
    if (!Array.isArray(flatCells)) continue;
    for (let i = 0; i < flatCells.length; i++) {
      const cell = flatCells[i];
      if (!cell) continue;
      const x = i % gridCols;
      const y = Math.floor(i / gridCols);
      if (x >= gridCols || y >= gridRows) continue;
      const glyph = Number(cell.glyph || 0);
      const fg = Array.isArray(cell.fg) ? cell.fg.map(Number) : [255, 255, 255];
      const bg = Array.isArray(cell.bg) ? cell.bg.map(Number) : [0, 0, 0];
      stackLayer.setCell(x, y, glyph & 0xFF, fg, bg);
    }
  }

  // Set active/visible layers
  const aLayer = (typeof activeLayer === 'number' && activeLayer >= 0 && activeLayer < layerStack.layers.length)
    ? activeLayer : Math.min(2, layerStack.layers.length - 1);
  layerStack.selectLayer(aLayer);

  if (visibleLayers && visibleLayers.size > 0) {
    for (let i = 0; i < layerStack.layers.length; i++) {
      layerStack.layers[i].setVisible(visibleLayers.has(i));
    }
  }
  if (lockedLayers && lockedLayers.size > 0) {
    for (let i = 0; i < layerStack.layers.length; i++) {
      layerStack.layers[i].setLocked(lockedLayers.has(i));
    }
  }

  editorState.layerStack = layerStack;
  canvas.setLayerStack(layerStack);

  // Populate layers panel now that LayerStack is ready
  _updateLayersPanelUI();

  // Create CellTool
  const cellTool = new CellTool();
  cellTool.setGlyph(editorState.drawGlyph);
  cellTool.setColors(editorState.drawFg, editorState.drawBg);
  cellTool.setApplyModes({
    glyph: editorState.applyGlyph,
    foreground: editorState.applyFg,
    background: editorState.applyBg,
  });
  editorState.cellTool = cellTool;

  // Direction-sensitive brush: quantizes pointer slope to -, |, /, or \\.
  const slopeStrokeTool = new SlopeStrokeTool();
  slopeStrokeTool.setColors(editorState.drawFg, editorState.drawBg);
  slopeStrokeTool.setApplyModes({
    glyph: editorState.applyGlyph,
    foreground: editorState.applyFg,
    background: editorState.applyBg,
  });
  editorState.slopeStrokeTool = slopeStrokeTool;

  // Canonical REXPaint Cell alternate mode: context-sensitive auto-walls.
  const adaptiveStrokeTool = new AdaptiveStrokeTool();
  adaptiveStrokeTool.setGlyph(editorState.drawGlyph);
  adaptiveStrokeTool.setColors(editorState.drawFg, editorState.drawBg);
  adaptiveStrokeTool.setApplyModes({
    glyph: editorState.applyGlyph,
    foreground: editorState.applyFg,
    background: editorState.applyBg,
  });
  editorState.adaptiveStrokeTool = adaptiveStrokeTool;

  // Create EyedropperTool
  const eyedropperTool = new EyedropperTool();
  eyedropperTool.setOnSample((glyph, fg, bg) => {
    _applyEyedropperSample(glyph, fg, bg);
  });
  editorState.eyedropperTool = eyedropperTool;

  // Create EraseTool
  const eraseTool = new EraseTool();
  editorState.eraseTool = eraseTool;

  // Create Line/Rect/Fill tool adapters
  editorState.lineTool = new LineToolAdapter();
  editorState.rectTool = new RectToolAdapter();
  editorState.ovalTool = new OvalToolAdapter();
  editorState.fillTool = new FillToolAdapter();
  editorState.textTool = new TextToolAdapter();
  editorState.selectTool = new SelectToolAdapter();
  canvas.setSelectionTool(editorState.selectTool);
  for (const t of [editorState.lineTool, editorState.rectTool, editorState.ovalTool, editorState.fillTool, editorState.textTool]) {
    _setToolGlyph(t, editorState.drawGlyph);
    _setToolColors(t, editorState.drawFg, editorState.drawBg);
    _setToolApplyModes(t, { glyph: editorState.applyGlyph, foreground: editorState.applyFg, background: editorState.applyBg });
  }

  // Activate default tool
  editorState.activeTool = 'cell';
  canvas.toolActivated(cellTool);

  // Proxy canvas.setCell for callbacks
  const originalSetCell = canvas.setCell.bind(canvas);
  canvas.setCell = function(x, y, glyph, fg, bg) {
    // Reject edits on locked layers
    if (editorState.layerStack) {
      const al = editorState.layerStack.getActiveLayer();
      if (al && al.locked) return;
    }
    if (!editorState._strokeDirty) _beginDocumentTransaction();
    originalSetCell(x, y, glyph, fg, bg);
    editorState._strokeDirty = true;
    if (editorState.onCellEdited) {
      const layerIndex = editorState.layerStack ? editorState.layerStack.activeIndex : 0;
      editorState.onCellEdited(x, y, glyph & 0xFF, [...fg], [...bg], layerIndex);
    }
  };

  // Stroke-complete detection
  canvasEl.addEventListener('pointerup', _onStrokeEnd);
  canvasEl.addEventListener('pointercancel', _onStrokeEnd);

  // U3: tap-hold inspect for touch devices
  canvasEl.addEventListener('pointerdown', _onTapHoldStart);
  canvasEl.addEventListener('pointerup', _onTapHoldEnd);
  canvasEl.addEventListener('pointercancel', _onTapHoldEnd);

  // Mouse tracking (mouseleave handles both stroke-end and hover clear)
  canvasEl.addEventListener('pointermove', _onCanvasPointerMove);
  canvasEl.addEventListener('pointerleave', _onCanvasPointerLeave);
  canvasEl.addEventListener('wheel', _onCanvasWheel, { passive: false });

  // Keyboard shortcuts
  document.addEventListener('keydown', _onKeyDown);
  document.addEventListener('keyup', _onKeyUp);

  // Paste-mode interceptor (capturing phase fires before Canvas's own pointerdown)
  editorState._pasteInterceptor = (e) => {
    if (!editorState.pasteMode) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    const rect = canvasEl.getBoundingClientRect();
    const pixelsPerCell = rect.width > 0 && canvasEl.width > 0
      ? (rect.width / canvasEl.width) * CELL_SIZE
      : (canvas.cellSize || CELL_SIZE);
    const cx = Math.floor((e.clientX - rect.left) / pixelsPerCell);
    const cy = Math.floor((e.clientY - rect.top) / pixelsPerCell);
    _pasteAt(cx, cy);
  };
  canvasEl.addEventListener('pointerdown', editorState._pasteInterceptor, true);

  // Two-pointer pinch-zoom / pan gesture tracking
  attachGestures(canvasEl, {
    onGestureStart() {
      // The first finger already painted before the second arrived. The
      // user's intent is pan/zoom, not an edit — revert the stray cell
      // instead of committing it.
      _revertActiveStroke();
      editorState._gestureStartZoom = editorState.appliedCanvasZoom || 1;
      editorState._gestureActive = true;
      if (editorState.canvas) editorState.canvas._gestureActive = true;
    },
    onPinch(zoomDelta) {
      const sw = document.getElementById('wholeSheetScroll');
      if (!sw) return;
      // zoomDelta is a multiplicative ratio (>1 = zoom in, <1 = zoom out)
      const next = Math.max(CANVAS_ZOOM_MIN, Math.min(CANVAS_ZOOM_MAX, (editorState.appliedCanvasZoom || 1) * zoomDelta));
      editorState.canvasZoom = next;
      _applyCanvasZoom({ preserveCenter: true });
    },
    onPan(dx, dy) {
      const sw = document.getElementById('wholeSheetScroll');
      if (!sw) return;
      sw.scrollLeft -= dx;
      sw.scrollTop -= dy;
    },
    onGestureEnd(snapFn) {
      editorState._gestureActive = false;
      if (editorState.canvas) editorState.canvas._gestureActive = false;
      // Snap to nearest discrete zoom level
      const current = editorState.appliedCanvasZoom || 1;
      const snapped = snapFn(current);
      editorState.canvasZoom = snapped;
      _applyCanvasZoom({ preserveCenter: true });
      // Emit only when the gesture actually changed the zoom. A pure pan
      // (zoom unchanged) must not mark the session dirty or trigger a save —
      // that silently persisted pending work and cleared dirty ownership at
      // the end of every two-finger gesture.
      const startZoom = editorState._gestureStartZoom;
      editorState._gestureStartZoom = null;
      if (snapped !== (startZoom == null ? snapped : startZoom)) {
        _emitDocumentStateChange('zoom');
      }
    },
  });

  editorState.mounted = true;
  _bindMobileKeyboard();
  canvas.setGridVisible(editorState.gridVisible);
  _applyGridStepToCanvas();
  canvas.render();
  _applyCanvasZoom();
  _observeCanvasViewport();
  _updateToolUI();
  _renderGlyphPicker();
  _renderPaletteGrid();
  _renderRecentsRow();
  _updateInfoDrawState();
  _updateInfoApplyModes();
  _applyModeUI();
  _updateHistoryButtons();
  void _refreshBrowseItems({ preserveSelection: false });

  // Tier A: clean up stale drafts on mount
  _persistCleanup(7).catch(() => { /* silent */ });

}

// ── Stroke tracking ──

function _onStrokeEnd() {
  if (editorState._strokeDirty) {
    _commitLayerMutation();
  }
}

// ── Clipboard operations (W19-W22) ──

/**
 * W19: Copy current selection to clipboard.
 * Stores cell data with positions relative to selection origin.
 * @returns {boolean} true if copied
 */
function _applyLayerCellEdit(layerIndex, x, y, cell) {
  const layerStack = editorState.layerStack;
  const canvas = editorState.canvas;
  const layer = layerStack && layerStack.layers ? layerStack.layers[layerIndex] : null;
  if (!layer || !canvas) return false;

  if (!editorState._strokeDirty) _beginDocumentTransaction();

  layer.setCell(x, y, cell.glyph, cell.fg, cell.bg);
  if (canvas._dirtyCells) canvas._dirtyCells.add(y * canvas.width + x);
  editorState._strokeDirty = true;

  if (editorState.onCellEdited) {
    editorState.onCellEdited(x, y, cell.glyph, [...cell.fg], [...cell.bg], layerIndex);
  }
  return true;
}

function _commitLayerMutation() {
  if (!editorState._strokeDirty) return false;
  editorState._strokeDirty = false;
  _pushPendingHistorySnapshot();
  if (editorState.onStrokeComplete) editorState.onStrokeComplete();
  if (editorState.canvas) editorState.canvas.render();
  _scheduleDraftSave();
  return true;
}

function _beginDocumentTransaction() {
  if (!editorState.mounted || !editorState.layerStack) return;
  if (!editorState._strokeDirty) {
    editorState._pendingHistorySnapshot = _buildDocumentSnapshot();
  }
  editorState._strokeDirty = true;
}

function _cancelDocumentTransaction() {
  editorState._strokeDirty = false;
  editorState._pendingHistorySnapshot = null;
  _updateHistoryButtons();
}

/**
 * Revert an in-progress stroke to its pre-stroke document snapshot without
 * pushing a history entry. Canvas paints on pointerdown, so by the time a
 * tap-hold inspect or a two-finger gesture reveals the touch was not meant
 * as an edit, a stray cell is already painted — this undoes it exactly.
 * @returns {boolean} true if a dirty stroke was reverted
 */
function _revertActiveStroke() {
  if (!editorState._strokeDirty) return false;
  const snap = editorState._pendingHistorySnapshot;
  editorState._strokeDirty = false;
  editorState._pendingHistorySnapshot = null;
  if (snap) {
    _applyDocumentSnapshot(snap);
    // The stray cells already reached the workbench mirror through
    // onCellEdited during the stroke — resync it through the same
    // authoritative channel undo/redo use, or state.layers keeps the
    // paint the canvas no longer shows and save/export leak it.
    _emitDocumentStateChange('stroke-revert');
  }
  _updateHistoryButtons();
  return true;
}

function _copySelection() {
  const tool = editorState.selectTool;
  if (!tool) return false;
  const bounds = tool.getSelectionBounds();
  if (!bounds) return false;

  const clipboard = captureVisibleSelectionClipboard(editorState.layerStack, bounds);
  if (!clipboard || countClipboardCells(clipboard) === 0) return false;

  editorState.clipboard = clipboard;
  return true;
}

/**
 * W22: Delete/clear cells inside current selection (glyph→0, transparent).
 * Commits through the root-owned history path.
 * @returns {boolean} true if cleared
 */
function _deleteSelection() {
  const tool = editorState.selectTool;
  if (!tool) return false;
  const bounds = tool.getSelectionBounds();
  if (!bounds) return false;
  const canvas = editorState.canvas;
  if (!canvas) return false;
  const layerIndex = getActiveWritableLayerIndex(editorState.layerStack);
  if (layerIndex === null) return false;
  const layer = editorState.layerStack?.layers?.[layerIndex];
  if (!layer) return false;

  for (let y = bounds.y; y < bounds.y + bounds.height; y++) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
      _applyLayerCellEdit(layerIndex, x, y, buildClearedEditorCell(layer.getCell(x, y)));
    }
  }
  return _commitLayerMutation();
}

function _deleteSelectionAcrossVisibleUnlockedLayers() {
  const tool = editorState.selectTool;
  if (!tool) return false;
  const bounds = tool.getSelectionBounds();
  if (!bounds) return false;
  const layerIndices = getVisibleUnlockedLayerIndices(editorState.layerStack);
  if (!layerIndices || layerIndices.length === 0) return false;

  for (const layerIndex of layerIndices) {
    const layer = editorState.layerStack?.layers?.[layerIndex];
    if (!layer) continue;
    for (let y = bounds.y; y < bounds.y + bounds.height; y++) {
      for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
        _applyLayerCellEdit(layerIndex, x, y, buildClearedEditorCell(layer.getCell(x, y)));
      }
    }
  }
  return _commitLayerMutation();
}

/**
 * W21: Cut = copy then delete.
 * @returns {boolean} true if cut succeeded
 */
function _cutSelection() {
  const layerIndices = getVisibleUnlockedLayerIndices(editorState.layerStack);
  if (!layerIndices || layerIndices.length === 0) return false;
  if (!_copySelection()) return false;
  return _deleteSelectionAcrossVisibleUnlockedLayers();
}

/**
 * W20: Enter paste mode. Next mousedown on the canvas places clipboard contents.
 * Escape or tool switch cancels.
 * @returns {boolean} true if paste mode entered
 */
const _PASTE_CURSOR_SVG = "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20'><path d='M10 3v14M3 10h14' stroke='%232ecc71' stroke-width='3' stroke-linecap='round'/></svg>\") 10 10, copy";

const _RECENTS_MAX = 8;

function _hideRecentsContextMenu() {
  const el = document.getElementById('wsRecentsContextMenu');
  if (el) el.remove();
  document.removeEventListener('mousedown', _onRecentsContextMenuDocClick, true);
  document.removeEventListener('keydown', _onRecentsContextMenuKey, true);
}

function _onRecentsContextMenuDocClick(e) {
  const el = document.getElementById('wsRecentsContextMenu');
  if (!el) return;
  if (el.contains(e.target)) return;
  _hideRecentsContextMenu();
}

function _onRecentsContextMenuKey(e) {
  if (e.key === 'Escape') _hideRecentsContextMenu();
}

function _showRecentsContextMenu(channel, anchorEl, clientX, clientY) {
  _hideRecentsContextMenu();
  const list = channel === 'bg' ? editorState.recentBg : editorState.recentFg;
  if (!list || list.length === 0) return;
  const menu = document.createElement('div');
  menu.id = 'wsRecentsContextMenu';
  menu.className = 'ws-recents-ctx';
  const heading = document.createElement('div');
  heading.className = 'ws-recents-ctx-heading';
  heading.textContent = `Recent ${channel === 'bg' ? 'bg' : 'fg'} colors`;
  menu.appendChild(heading);
  const grid = document.createElement('div');
  grid.className = 'ws-recents-ctx-grid';
  for (const rgb of list) {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'ws-recents-ctx-swatch';
    sw.style.background = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    sw.title = `rgb(${rgb.join(',')})`;
    sw.addEventListener('click', () => {
      if (channel === 'fg') editorState.drawFg = [...rgb];
      else editorState.drawBg = [...rgb];
      _pushRecentColor(channel, rgb);
      const fgEl = document.getElementById('wsFgColor');
      const bgEl = document.getElementById('wsBgColor');
      if (fgEl) fgEl.value = _rgbToHex(editorState.drawFg);
      if (bgEl) bgEl.value = _rgbToHex(editorState.drawBg);
      _forEachTool((t) => _setToolColors(t, editorState.drawFg, editorState.drawBg));
      _renderGlyphPicker(); _renderPaletteGrid(); _updateInfoDrawState();
      _hideRecentsContextMenu();
    });
    grid.appendChild(sw);
  }
  menu.appendChild(grid);
  document.body.appendChild(menu);
  // Position near pointer, clamped to viewport.
  const rect = menu.getBoundingClientRect();
  let left = clientX || (anchorEl?.getBoundingClientRect().right ?? 0);
  let top = clientY || (anchorEl?.getBoundingClientRect().bottom ?? 0);
  if (left + rect.width > window.innerWidth) left = window.innerWidth - rect.width - 4;
  if (top + rect.height > window.innerHeight) top = window.innerHeight - rect.height - 4;
  menu.style.left = Math.max(4, left) + 'px';
  menu.style.top = Math.max(4, top) + 'px';
  // Defer attaching outside-close listeners so the originating contextmenu
  // event doesn't trip them.
  setTimeout(() => {
    document.addEventListener('mousedown', _onRecentsContextMenuDocClick, true);
    document.addEventListener('keydown', _onRecentsContextMenuKey, true);
  }, 0);
}

function _pushRecentColor(channel, rgb) {
  if (!Array.isArray(rgb) || rgb.length !== 3) return;
  const key = `${rgb[0]},${rgb[1]},${rgb[2]}`;
  const list = channel === 'bg' ? editorState.recentBg : editorState.recentFg;
  const idx = list.findIndex((c) => `${c[0]},${c[1]},${c[2]}` === key);
  if (idx >= 0) list.splice(idx, 1);
  list.unshift([rgb[0], rgb[1], rgb[2]]);
  if (list.length > _RECENTS_MAX) list.length = _RECENTS_MAX;
  _renderRecentsRow();
}

function _renderRecentsRow() {
  const host = document.getElementById('wsRecentsRow');
  if (!host) return;
  host.innerHTML = '';
  const _mkSwatch = (rgb, channel) => {
    const s = document.createElement('button');
    s.type = 'button';
    s.className = 'ws-recent-swatch';
    s.style.background = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    s.title = `recent ${channel}: rgb(${rgb.join(',')}). LMB = apply to ${channel}; RMB = apply to ${channel === 'fg' ? 'bg' : 'fg'}.`;
    s.addEventListener('click', () => {
      if (channel === 'fg') editorState.drawFg = [...rgb];
      else editorState.drawBg = [...rgb];
      const fgEl = document.getElementById('wsFgColor');
      const bgEl = document.getElementById('wsBgColor');
      if (fgEl) fgEl.value = _rgbToHex(editorState.drawFg);
      if (bgEl) bgEl.value = _rgbToHex(editorState.drawBg);
      _forEachTool((t) => _setToolColors(t, editorState.drawFg, editorState.drawBg));
      _renderGlyphPicker(); _renderPaletteGrid(); _updateInfoDrawState();
    });
    s.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const swapTo = channel === 'fg' ? 'bg' : 'fg';
      if (swapTo === 'fg') editorState.drawFg = [...rgb];
      else editorState.drawBg = [...rgb];
      const fgEl = document.getElementById('wsFgColor');
      const bgEl = document.getElementById('wsBgColor');
      if (fgEl) fgEl.value = _rgbToHex(editorState.drawFg);
      if (bgEl) bgEl.value = _rgbToHex(editorState.drawBg);
      _forEachTool((t) => _setToolColors(t, editorState.drawFg, editorState.drawBg));
      _renderGlyphPicker(); _renderPaletteGrid(); _updateInfoDrawState();
    });
    return s;
  };
  const fgGroup = document.createElement('div');
  fgGroup.className = 'ws-recents-group';
  const fgLbl = document.createElement('span');
  fgLbl.className = 'ws-recents-label';
  fgLbl.textContent = 'fg';
  fgGroup.appendChild(fgLbl);
  for (const c of editorState.recentFg) fgGroup.appendChild(_mkSwatch(c, 'fg'));
  host.appendChild(fgGroup);
  const bgGroup = document.createElement('div');
  bgGroup.className = 'ws-recents-group';
  const bgLbl = document.createElement('span');
  bgLbl.className = 'ws-recents-label';
  bgLbl.textContent = 'bg';
  bgGroup.appendChild(bgLbl);
  for (const c of editorState.recentBg) bgGroup.appendChild(_mkSwatch(c, 'bg'));
  host.appendChild(bgGroup);
}

function _ensurePasteGhost() {
  let el = document.getElementById('wsPasteGhost');
  if (!el) {
    el = document.createElement('div');
    el.id = 'wsPasteGhost';
    el.className = 'ws-paste-ghost';
    document.body.appendChild(el);
  }
  return el;
}

function _hidePasteGhost() {
  const el = document.getElementById('wsPasteGhost');
  if (el) el.style.display = 'none';
}

function _updatePasteGhost(cx, cy) {
  if (!editorState.pasteMode) { _hidePasteGhost(); return; }
  const clip = editorState.clipboard;
  if (!clip) { _hidePasteGhost(); return; }
  const clipW = Math.max(0, Number(clip.bounds?.w) || 0);
  const clipH = Math.max(0, Number(clip.bounds?.h) || 0);
  if (!clipW || !clipH) { _hidePasteGhost(); return; }
  const canvas = editorState.canvas;
  const canvasEl = canvas && canvas.canvasElement;
  if (!canvasEl) { _hidePasteGhost(); return; }
  const rect = canvasEl.getBoundingClientRect();
  if (rect.width <= 0 || canvasEl.width <= 0) { _hidePasteGhost(); return; }
  const pixelsPerCell = (rect.width / canvasEl.width) * CELL_SIZE;
  const el = _ensurePasteGhost();
  el.style.display = 'block';
  el.style.left = (rect.left + cx * pixelsPerCell) + 'px';
  el.style.top = (rect.top + cy * pixelsPerCell) + 'px';
  el.style.width = (clipW * pixelsPerCell) + 'px';
  el.style.height = (clipH * pixelsPerCell) + 'px';
}

let _wsStatusTimer = null;
function _showWorkbenchStatus(message, ms = 2500) {
  let el = document.getElementById('wsStatusToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'wsStatusToast';
    el.className = 'ws-status-toast';
    const host = document.querySelector('.ws-canvas-area') || document.body;
    host.appendChild(el);
  }
  el.textContent = String(message || '');
  el.classList.add('ws-status-toast-show');
  if (_wsStatusTimer) clearTimeout(_wsStatusTimer);
  _wsStatusTimer = setTimeout(() => {
    el.classList.remove('ws-status-toast-show');
    _wsStatusTimer = null;
  }, ms);
}

function _enterPasteMode() {
  if (editorState.pasteMode) { _cancelPasteMode(); return false; }
  if (!editorState.clipboard || countClipboardCells(editorState.clipboard) === 0) return false;
  editorState.pasteMode = true;
  const canvasEl = editorState.canvas && editorState.canvas.canvasElement;
  if (canvasEl) canvasEl.style.cursor = _PASTE_CURSOR_SVG;
  const btn = document.getElementById('wsPasteSelection');
  if (btn) { btn.classList.add('ws-tool-active'); btn.classList.add('ws-paste-armed'); }
  return true;
}

function _cancelPasteMode() {
  if (!editorState.pasteMode) return;
  editorState.pasteMode = false;
  const canvasEl = editorState.canvas && editorState.canvas.canvasElement;
  if (canvasEl) canvasEl.style.cursor = 'crosshair';
  const btn = document.getElementById('wsPasteSelection');
  if (btn) { btn.classList.remove('ws-tool-active'); btn.classList.remove('ws-paste-armed'); }
  _hidePasteGhost();
}

/**
 * Place clipboard contents at cell (cx, cy).
 * Commits through the root-owned history path.
 */
function _pasteAt(cx, cy) {
  const clip = editorState.clipboard;
  if (!clip || countClipboardCells(clip) === 0) return;
  const canvas = editorState.canvas;
  if (!canvas) return;

  const layerEntries = resolveWritableClipboardLayers(editorState.layerStack, clip);
  if (!layerEntries || layerEntries.length === 0) {
    // All referenced layers are locked or out-of-range — silent no-op was the
    // pre-codex-review failure mode. Surface it (codex 2026-06-03 MEDIUM).
    const allLocked = Array.isArray(clip.layers) && clip.layers.length > 0
      && clip.layers.every((e) => {
        const i = Number(e?.layerIndex);
        if (!Number.isInteger(i)) return true;
        const L = editorState.layerStack?.layers?.[i];
        return !L || L.locked;
      });
    if (allLocked) {
      console.warn('[workbench] Paste skipped: all target layers are locked.');
      _showWorkbenchStatus('Paste blocked: target layers locked');
    }
    return;
  }
  const clipW = Math.max(0, Number(clip.bounds?.w) || 0);
  const clipH = Math.max(0, Number(clip.bounds?.h) || 0);
  if (!clipW || !clipH) return;

  for (const entry of layerEntries) {
    for (let i = 0; i < entry.cells.length; i++) {
      const nx = cx + (i % clipW);
      const ny = cy + ((i / clipW) | 0);
      if (nx >= 0 && nx < canvas.width && ny >= 0 && ny < canvas.height) {
        _applyLayerCellEdit(entry.layerIndex, nx, ny, entry.cells[i]);
      }
    }
  }

  _commitLayerMutation();
  // Paste mode stays armed — user can keep stamping until Escape or tool switch
}

// ── Selection transforms (W24-W27) ──

/**
 * Flip a 2D cell matrix horizontally (reverse each row).
 * Ported from workbench.js selectionMatrixFlipH.
 */
function _selectionMatrixFlipH(matrix) {
  return (Array.isArray(matrix) ? matrix : []).map(row =>
    Array.isArray(row) ? [...row].reverse().map(c => ({ ...c })) : []
  );
}

/**
 * Flip a 2D cell matrix vertically (reverse row order).
 * Ported from workbench.js selectionMatrixFlipV.
 */
function _selectionMatrixFlipV(matrix) {
  return [...(Array.isArray(matrix) ? matrix : [])].reverse().map(row =>
    Array.isArray(row) ? row.map(c => ({ ...c })) : []
  );
}

/**
 * Rotate a 2D cell matrix 90 degrees.
 * Ported from workbench.js selectionMatrixRotate.
 * @param {boolean} clockwise — true for CW, false for CCW
 */
function _selectionMatrixRotate(matrix, clockwise) {
  const src = Array.isArray(matrix) ? matrix : [];
  const h = src.length;
  const w = h > 0 && Array.isArray(src[0]) ? src[0].length : 0;
  if (!h || !w) return [];
  const out = [];
  if (clockwise) {
    for (let y = 0; y < w; y++) {
      const row = [];
      for (let x = 0; x < h; x++) row.push({ ...(src[h - 1 - x]?.[y] || { glyph: 0, fg: [255, 255, 255], bg: [0, 0, 0] }) });
      out.push(row);
    }
  } else {
    for (let y = 0; y < w; y++) {
      const row = [];
      for (let x = 0; x < h; x++) row.push({ ...(src[x]?.[w - 1 - y] || { glyph: 0, fg: [255, 255, 255], bg: [0, 0, 0] }) });
      out.push(row);
    }
  }
  return out;
}

/**
 * Apply a transform to the current whole-sheet selection.
 * One undoable operation in the root-owned history stack.
 * For rotate, updates selection bounds to reflect width/height swap.
 * @param {'rot_cw'|'rot_ccw'|'flip_h'|'flip_v'} kind
 * @returns {boolean} true if transform applied
 */
function _transformSelection(kind) {
  const tool = editorState.selectTool;
  if (!tool) return false;
  const bounds = tool.getSelectionBounds();
  if (!bounds) return false;
  const canvas = editorState.canvas;
  if (!canvas) return false;

  // Read source matrix from canvas
  const srcMatrix = [];
  for (let y = bounds.y; y < bounds.y + bounds.height; y++) {
    const row = [];
    for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
      const cell = canvas.getCell(x, y);
      row.push(cell ? { glyph: cell.glyph, fg: [...cell.fg], bg: [...cell.bg] } : { glyph: 0, fg: [255, 255, 255], bg: [0, 0, 0] });
    }
    srcMatrix.push(row);
  }

  // Apply transform
  let dstMatrix;
  if (kind === 'flip_h') dstMatrix = _selectionMatrixFlipH(srcMatrix);
  else if (kind === 'flip_v') dstMatrix = _selectionMatrixFlipV(srcMatrix);
  else if (kind === 'rot_cw') dstMatrix = _selectionMatrixRotate(srcMatrix, true);
  else if (kind === 'rot_ccw') dstMatrix = _selectionMatrixRotate(srcMatrix, false);
  else return false;

  const dstH = dstMatrix.length;
  const dstW = dstH > 0 ? dstMatrix[0].length : 0;
  if (!dstH || !dstW) return false;

  // Check that rotated result fits on canvas
  if (bounds.x + dstW > canvas.width || bounds.y + dstH > canvas.height) return false;

  // setCell proxy starts one root-owned history transaction on first cell edit.
  // Clear source region first
  for (let y = bounds.y; y < bounds.y + bounds.height; y++) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
      canvas.setCell(x, y, 0, [255, 255, 255], [255, 0, 255]);
    }
  }

  // Write transformed cells
  for (let dy = 0; dy < dstH; dy++) {
    for (let dx = 0; dx < dstW; dx++) {
      const c = dstMatrix[dy][dx];
      canvas.setCell(bounds.x + dx, bounds.y + dy, c.glyph, c.fg, c.bg);
    }
  }

  _commitLayerMutation();

  // Update selection bounds to match transformed dimensions
  tool.startSelection(bounds.x, bounds.y);
  tool.updateSelection(bounds.x + dstW - 1, bounds.y + dstH - 1);
  tool.endSelection();

  canvas.render();
  return true;
}

// ── Bulk-edit operations (W28-W30) ──

/**
 * W28: Fill selection with active glyph/fg/bg.
 * One undoable operation via stroke pattern.
 * @returns {boolean} true if any cells changed
 */
function _fillSelection() {
  const tool = editorState.selectTool;
  if (!tool) return false;
  const bounds = tool.getSelectionBounds();
  if (!bounds) return false;
  const canvas = editorState.canvas;
  if (!canvas) return false;

  const { drawGlyph, drawFg, drawBg } = editorState;
  let changed = 0;
  for (let y = bounds.y; y < bounds.y + bounds.height; y++) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
      canvas.setCell(x, y, drawGlyph, drawFg, drawBg);
      changed++;
    }
  }
  if (!changed) return false;
  _commitLayerMutation();
  canvas.render();
  return true;
}

/**
 * W29/W30: Replace FG or BG color in selection.
 * Match source: editorState.lastSampledCell (set by eyedropper).
 * Replacement: current drawFg (for 'fg') or drawBg (for 'bg').
 * @param {'fg'|'bg'} channel
 * @returns {boolean} true if any cells changed
 */
function _replaceSelectionColor(channel) {
  const tool = editorState.selectTool;
  if (!tool) return false;
  const bounds = tool.getSelectionBounds();
  if (!bounds) return false;
  const canvas = editorState.canvas;
  if (!canvas) return false;
  const sample = editorState.lastSampledCell;
  if (!sample) return false;

  const matchColor = channel === 'bg' ? sample.bg : sample.fg;
  const replColor = channel === 'bg' ? editorState.drawBg : editorState.drawFg;
  let changed = 0;
  for (let y = bounds.y; y < bounds.y + bounds.height; y++) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
      const cell = canvas.getCell(x, y);
      if (!cell) continue;
      const curColor = channel === 'bg' ? cell.bg : cell.fg;
      if (!_colorsEqual(curColor, matchColor)) continue;
      if (channel === 'bg') {
        canvas.setCell(x, y, cell.glyph, [...cell.fg], [...replColor]);
      } else {
        canvas.setCell(x, y, cell.glyph, [...replColor], [...cell.bg]);
      }
      changed++;
    }
  }
  if (!changed) return false;
  _commitLayerMutation();
  canvas.render();
  return true;
}

/**
 * W31: Find & Replace in selection, whole-sheet canvas, or per-grid-frame scope.
 * Scope semantics (whole-sheet contract):
 *   - 'selection': operates on current selection bounds only
 *   - 'canvas': operates on entire canvas (all cells)
 *   - 'grid_frames': operates on one frame-local coordinate within each current-grid partition
 * @returns {boolean} true if any cells changed
 */
function _findReplace() {
  const canvas = editorState.canvas;
  if (!canvas) return false;

  const matchGlyph = !!document.getElementById('wsFrMatchGlyph')?.checked;
  const matchFg = !!document.getElementById('wsFrMatchFg')?.checked;
  const matchBg = !!document.getElementById('wsFrMatchBg')?.checked;
  if (!matchGlyph && !matchFg && !matchBg) return false;

  const replGlyphOn = !!document.getElementById('wsFrReplGlyph')?.checked;
  const replFgOn = !!document.getElementById('wsFrReplFg')?.checked;
  const replBgOn = !!document.getElementById('wsFrReplBg')?.checked;
  if (!replGlyphOn && !replFgOn && !replBgOn) return false;

  const findGlyph = Math.max(0, Math.min(255, Number(document.getElementById('wsFrFindGlyphVal')?.value) || 0));
  const findFg = _hexToRgb(document.getElementById('wsFrFindFgVal')?.value || '#ffffff');
  const findBg = _hexToRgb(document.getElementById('wsFrFindBgVal')?.value || '#000000');
  const replGlyph = Math.max(0, Math.min(255, Number(document.getElementById('wsFrReplGlyphVal')?.value) || 0));
  const replFg = _hexToRgb(document.getElementById('wsFrReplFgVal')?.value || '#ffffff');
  const replBg = _hexToRgb(document.getElementById('wsFrReplBgVal')?.value || '#000000');

  const scope = document.getElementById('wsFrScope')?.value || 'selection';

  let changed = 0;
  const applyAtCell = (x, y) => {
    const cell = canvas.getCell(x, y);
    if (!cell) return;
    if (matchGlyph && (cell.glyph & 0xFF) !== findGlyph) return;
    if (matchFg && !_colorsEqual(cell.fg || [0, 0, 0], findFg)) return;
    if (matchBg && !_colorsEqual(cell.bg || [0, 0, 0], findBg)) return;
    const ng = replGlyphOn ? replGlyph : (cell.glyph & 0xFF);
    const nf = replFgOn ? [...replFg] : [...(cell.fg || [0, 0, 0])];
    const nb = replBgOn ? [...replBg] : [...(cell.bg || [0, 0, 0])];
    if ((cell.glyph & 0xFF) === ng && _colorsEqual(cell.fg || [0, 0, 0], nf) && _colorsEqual(cell.bg || [0, 0, 0], nb)) {
      return;
    }
    canvas.setCell(x, y, ng, nf, nb);
    changed++;
  };

  if (scope === 'grid_frames') {
    const resolved = _resolveGridStepConfig();
    const localX = _coerceGridOffset(
      document.getElementById('wsFrGridCellX')?.value,
      0,
      Math.max(0, Number(resolved.width || 1) - 1)
    );
    const localY = _coerceGridOffset(
      document.getElementById('wsFrGridCellY')?.value,
      0,
      Math.max(0, Number(resolved.height || 1) - 1)
    );
    for (let frameY = 0; frameY < canvas.height; frameY += Math.max(1, Number(resolved.height || 1))) {
      for (let frameX = 0; frameX < canvas.width; frameX += Math.max(1, Number(resolved.width || 1))) {
        const x = frameX + localX;
        const y = frameY + localY;
        if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) continue;
        applyAtCell(x, y);
      }
    }
  } else {
    let x1, y1, x2, y2;
    if (scope === 'canvas') {
      x1 = 0; y1 = 0; x2 = canvas.width - 1; y2 = canvas.height - 1;
    } else {
      const tool = editorState.selectTool;
      if (!tool) return false;
      const bounds = tool.getSelectionBounds();
      if (!bounds) return false;
      x1 = bounds.x; y1 = bounds.y;
      x2 = bounds.x + bounds.width - 1; y2 = bounds.y + bounds.height - 1;
    }
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        applyAtCell(x, y);
      }
    }
  }
  if (!changed) return false;
  _commitLayerMutation();
  canvas.render();
  return true;
}

// ── Eyedropper sample ──

function _flattenLayerCells(layer, cols, rows) {
  const out = [];
  const safeCols = Math.max(1, Number(cols) || 1);
  const safeRows = Math.max(1, Number(rows) || 1);
  for (let y = 0; y < safeRows; y++) {
    for (let x = 0; x < safeCols; x++) {
      const idx = y * safeCols + x;
      const cell = layer?.getCell ? layer.getCell(x, y) : null;
      out.push({
        idx,
        glyph: Number(cell?.glyph || 0),
        fg: Array.isArray(cell?.fg) ? cell.fg.map(Number) : [255, 255, 255],
        bg: Array.isArray(cell?.bg) ? cell.bg.map(Number) : [0, 0, 0],
      });
    }
  }
  return out;
}

function _buildDocumentSnapshot() {
  const layerStack = editorState.layerStack;
  const layers = layerStack?.layers || [];
  return {
    gridCols: editorState.gridCols,
    gridRows: editorState.gridRows,
    frameW: editorState.frameW,
    frameH: editorState.frameH,
    layers: layers.map((layer) => _flattenLayerCells(layer, editorState.gridCols, editorState.gridRows)),
    layerNames: layers.map((layer, index) => layer?.name || editorState.layerNames[index] || `Layer ${index}`),
    activeLayer: layerStack ? layerStack.activeIndex : 0,
    visibleLayers: layers.reduce((acc, layer, index) => {
      if (layer?.visible !== false) acc.push(index);
      return acc;
    }, []),
    lockedLayers: layers.reduce((acc, layer, index) => {
      if (layer?.locked) acc.push(index);
      return acc;
    }, []),
    canvasZoom: editorState.canvasZoom,
    appliedCanvasZoom: editorState.appliedCanvasZoom,
    gridVisible: !!editorState.gridVisible,
    gridStep: _normalizeGridStepToken(editorState.gridStep),
    gridCustomW: _coerceGridSize(editorState.gridCustomW, 1),
    gridCustomH: _coerceGridSize(editorState.gridCustomH, 1),
  };
}

function _buildLayerStackFromSnapshot(snapshot, cols, rows) {
  const flatLayers = Array.isArray(snapshot?.layers) && snapshot.layers.length
    ? snapshot.layers
    : [[]];
  const names = Array.isArray(snapshot?.layerNames) ? snapshot.layerNames : [];
  const visible = new Set((snapshot?.visibleLayers || []).map((value) => Number(value)).filter((value) => Number.isFinite(value)));
  const locked = new Set((snapshot?.lockedLayers || []).map((value) => Number(value)).filter((value) => Number.isFinite(value)));
  const stack = new LayerStack(cols, rows);
  stack.layers.splice(0, 1);

  for (let li = 0; li < flatLayers.length; li++) {
    stack.addLayer(names[li] || `Layer ${li}`);
    const layer = stack.layers[li];
    const flatCells = Array.isArray(flatLayers[li]) ? flatLayers[li] : [];
    for (let i = 0; i < flatCells.length; i++) {
      const cell = flatCells[i];
      if (!cell) continue;
      const x = i % cols;
      const y = Math.floor(i / cols);
      if (x >= cols || y >= rows) continue;
      const glyph = Number(cell.glyph || 0);
      const fg = Array.isArray(cell.fg) ? cell.fg.map(Number) : [255, 255, 255];
      const bg = Array.isArray(cell.bg) ? cell.bg.map(Number) : [0, 0, 0];
      layer.setCell(x, y, glyph & 0xFF, fg, bg);
    }
    layer.setVisible(visible.size ? visible.has(li) : true);
    layer.setLocked(locked.has(li));
  }

  const activeLayer = Math.max(0, Math.min(stack.layers.length - 1, Number(snapshot?.activeLayer || 0)));
  stack.selectLayer(activeLayer);
  return stack;
}

function _applyGridStepToCanvas() {
  if (!editorState.canvas || typeof editorState.canvas.setGridStep !== 'function') return;
  const resolved = _resolveGridStepConfig();
  editorState.canvas.setGridStep(resolved.width, resolved.height);
  _syncGridControlsUI();
}

function _applyDocumentSnapshot(snapshot) {
  if (!snapshot || !editorState.canvas) return false;
  const cols = Math.max(1, Number(snapshot.gridCols || editorState.gridCols || 1));
  const rows = Math.max(1, Number(snapshot.gridRows || editorState.gridRows || 1));
  editorState.gridCols = cols;
  editorState.gridRows = rows;
  editorState.frameW = Math.max(1, Number(snapshot.frameW || editorState.frameW || cols));
  editorState.frameH = Math.max(1, Number(snapshot.frameH || editorState.frameH || rows));
  editorState.layerNames = Array.isArray(snapshot.layerNames) ? [...snapshot.layerNames] : [];
  editorState.canvasZoom = _normalizeCanvasZoomValue(snapshot.canvasZoom);
  editorState.gridVisible = !!snapshot.gridVisible;
  editorState.gridStep = _normalizeGridStepToken(snapshot.gridStep);
  editorState.gridCustomW = _coerceGridSize(snapshot.gridCustomW, editorState.gridCustomW || 1);
  editorState.gridCustomH = _coerceGridSize(snapshot.gridCustomH, editorState.gridCustomH || 1);
  _ensureValidGridStepToken();

  const stack = _buildLayerStackFromSnapshot(snapshot, cols, rows);
  editorState.layerStack = stack;
  editorState.canvas.resizeGrid(cols, rows);
  editorState.canvas.setLayerStack(stack);
  editorState.canvas.setGridVisible(editorState.gridVisible);
  _applyGridStepToCanvas();
  _syncGridControlsUI();
  _updateLayersPanelUI();
  const dimsEl = document.getElementById('wsDims');
  if (dimsEl) dimsEl.textContent = `${cols}\u00d7${rows} · ${stack.layers.length}L`;
  _applyCanvasZoom({ preserveCenter: true });
  if (editorState.canvas) {
    editorState.canvas._fullRenderNeeded = true;
    editorState.canvas.render();
  }
  return true;
}

function _emitDocumentStateChange(reason) {
  if (typeof editorState.onDocumentStateChange === 'function') {
    editorState.onDocumentStateChange(_buildDocumentSnapshot(), String(reason || 'document-change'));
  }
}

function _historyState() {
  return {
    canUndo: editorState.history.length > 0,
    canRedo: editorState.future.length > 0,
    historyDepth: editorState.history.length,
    futureDepth: editorState.future.length,
  };
}

function _updateHistoryButtons() {
  const hist = _historyState();
  const undoBtn = document.getElementById('wsUndoBtn');
  if (undoBtn) undoBtn.disabled = !hist.canUndo;
  const redoBtn = document.getElementById('wsRedoBtn');
  if (redoBtn) redoBtn.disabled = !hist.canRedo;
  if (typeof editorState.onHistoryStateChange === 'function') {
    editorState.onHistoryStateChange({ ...hist });
  }
}

function _clearHistory() {
  editorState.history = [];
  editorState.future = [];
  editorState._pendingHistorySnapshot = null;
  _updateHistoryButtons();
}

function _pushPendingHistorySnapshot() {
  const snap = editorState._pendingHistorySnapshot;
  editorState._pendingHistorySnapshot = null;
  if (!snap) {
    _updateHistoryButtons();
    return false;
  }
  editorState.history.push(snap);
  if (editorState.history.length > HISTORY_LIMIT) editorState.history.shift();
  editorState.future = [];
  _updateHistoryButtons();
  return true;
}

function _updateApplyToggleButtons() {
  const glyphBtn = document.getElementById('wsApplyGlyph');
  if (glyphBtn) glyphBtn.classList.toggle('ws-toggle-on', editorState.applyGlyph);
  const fgBtn = document.getElementById('wsApplyFg');
  if (fgBtn) fgBtn.classList.toggle('ws-toggle-on', editorState.applyFg);
  const bgBtn = document.getElementById('wsApplyBg');
  if (bgBtn) bgBtn.classList.toggle('ws-toggle-on', editorState.applyBg);
}

function _setApplyChannel(channel, on) {
  const key = channel === 'glyph'
    ? 'applyGlyph'
    : (channel === 'foreground' ? 'applyFg' : 'applyBg');
  const current = !!editorState[key];
  const next = !!on;
  if (current === next) return true;

  const activeCount = [editorState.applyGlyph, editorState.applyFg, editorState.applyBg].filter(Boolean).length;
  if (!next && current && activeCount <= 1) return false;

  editorState[key] = next;
  if (channel === 'glyph') _forEachTool((t) => _setToolApplyModes(t, { glyph: next }));
  else if (channel === 'foreground') _forEachTool((t) => _setToolApplyModes(t, { foreground: next }));
  else _forEachTool((t) => _setToolApplyModes(t, { background: next }));
  _updateApplyToggleButtons();
  _updateInfoApplyModes();
  return true;
}

function _toggleApplyChannel(channel) {
  const key = channel === 'glyph'
    ? 'applyGlyph'
    : (channel === 'foreground' ? 'applyFg' : 'applyBg');
  return _setApplyChannel(channel, !editorState[key]);
}

function _soloApplyChannel(channel) {
  const desired = {
    glyph: channel === 'glyph',
    foreground: channel === 'foreground',
    background: channel === 'background',
  };
  const alreadySolo = editorState.applyGlyph === desired.glyph
    && editorState.applyFg === desired.foreground
    && editorState.applyBg === desired.background;
  const next = alreadySolo
    ? { glyph: true, foreground: true, background: true }
    : desired;
  _setApplyChannel('glyph', next.glyph);
  _setApplyChannel('foreground', next.foreground);
  _setApplyChannel('background', next.background);
}

function _cancelShapeDrag() {
  const tool = editorState.activeTool === 'line'
    ? editorState.lineTool
    : (editorState.activeTool === 'rect'
      ? editorState.rectTool
      : (editorState.activeTool === 'oval' ? editorState.ovalTool : null));
  if (tool && typeof tool.cancelDrag === 'function') {
    tool.cancelDrag();
  }
}

function _startTextEdit(x, y) {
  if (!editorState.canvas || !editorState.layerStack) return;
  const activeLayer = editorState.layerStack.getActiveLayer();
  if (!activeLayer || activeLayer.locked) return;
  editorState.textEdit = {
    active: true,
    dirty: false,
    anchorX: x,
    anchorY: y,
    cursorX: x,
    cursorY: y,
    positions: [],
  };
  _focusMobileKeyboard();
}

function _mobileKeyboardInput() {
  return document.getElementById('mobileKeyboardInput');
}

function _focusMobileKeyboard() {
  const input = _mobileKeyboardInput();
  // Desktop 390px emulation (body.wb-viewport-mobile) counts as mobile: layout
  // mirrors the narrow media query, so keyboard focus must work there too.
  const narrowViewport = window.matchMedia?.('(max-width: 768px)').matches
    || document.body.classList.contains('wb-viewport-mobile');
  if (!input || !narrowViewport) return false;
  try {
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
    if (navigator.virtualKeyboard && typeof navigator.virtualKeyboard.show === 'function') {
      Promise.resolve(navigator.virtualKeyboard.show()).catch(() => {});
    }
    return document.activeElement === input;
  } catch (_error) {
    return false;
  }
}

function _bindMobileKeyboard() {
  const input = _mobileKeyboardInput();
  if (!input || input.dataset.rexpaintBound === 'true') return;
  input.dataset.rexpaintBound = 'true';
  input.addEventListener('beforeinput', (event) => {
    if (!editorState.textEdit?.active) return;
    const type = String(event.inputType || '');
    if (type === 'deleteContentBackward') {
      event.preventDefault();
      _applyTextBackspace();
    } else if (type === 'insertLineBreak' || type === 'insertParagraph') {
      event.preventDefault();
      _applyTextEnter();
    } else if (type.startsWith('insert') && event.data) {
      event.preventDefault();
      for (const ch of String(event.data)) _applyTextCharacter(ch);
    }
    input.value = '';
  });
}

function openMobileKeyboard() {
  if (!editorState.mounted || !editorState.canvas) return false;
  _setMode('paint');
  _switchTool('text');
  _bindMobileKeyboard();
  const status = document.getElementById('wholeSheetStatus');
  if (status) status.textContent = 'Text: tap the canvas, then type';
  return _focusMobileKeyboard();
}

function _commitTextEdit() {
  const session = editorState.textEdit;
  editorState.textEdit = null;
  if (!session?.dirty) return false;
  return _commitLayerMutation();
}

function _cancelTextEdit() {
  editorState.textEdit = null;
  if (!editorState._strokeDirty) return false;
  _cancelDocumentTransaction();
  return true;
}

function _applyTextCharacter(ch) {
  const session = editorState.textEdit;
  const tool = editorState.textTool;
  if (!session?.active || !tool || !editorState.canvas) return false;
  const activeLayer = editorState.layerStack?.getActiveLayer?.();
  const { cursorX, cursorY } = session;
  if (cursorX < 0 || cursorY < 0 || cursorX >= editorState.canvas.width || cursorY >= editorState.canvas.height) return false;
  const priorCell = cloneEditorCell(activeLayer?.getCell(cursorX, cursorY));
  tool.setText(String(ch).slice(0, 1));
  tool.paint(cursorX, cursorY);
  session.dirty = true;
  session.positions.push({ x: cursorX, y: cursorY, priorCell });
  session.cursorX += 1;
  return true;
}

function _applyTextEnter() {
  const session = editorState.textEdit;
  if (!session?.active || !editorState.canvas) return false;
  session.cursorX = session.anchorX;
  session.cursorY = Math.min(editorState.canvas.height - 1, session.cursorY + 1);
  return true;
}

function _applyTextBackspace() {
  const session = editorState.textEdit;
  if (!session?.active || !editorState.canvas) return false;
  const last = session.positions.pop();
  if (!last) return true;
  session.cursorX = last.x;
  session.cursorY = last.y;
  const priorCell = cloneEditorCell(last.priorCell);
  editorState.canvas.setCell(last.x, last.y, priorCell.glyph, priorCell.fg, priorCell.bg);
  session.dirty = true;
  return true;
}

function _handleTextKey(e) {
  if (editorState.activeTool !== 'text' || !editorState.textEdit?.active) return false;
  if (e.key === 'Escape') {
    _commitTextEdit();
    _switchTool('text');
    return true;
  }
  if (e.key === 'Backspace') {
    _applyTextBackspace();
    return true;
  }
  if (e.key === 'Enter') {
    _applyTextEnter();
    return true;
  }
  if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
    _applyTextCharacter(e.key);
    return true;
  }
  return false;
}

function _swapFgBg() {
  const tmp = editorState.drawFg;
  editorState.drawFg = editorState.drawBg;
  editorState.drawBg = tmp;
  _forEachTool((t) => _setToolColors(t, editorState.drawFg, editorState.drawBg));
  const fgEl = document.getElementById('wsFgColor');
  if (fgEl) fgEl.value = _rgbToHex(editorState.drawFg);
  const bgEl = document.getElementById('wsBgColor');
  if (bgEl) bgEl.value = _rgbToHex(editorState.drawBg);
  _renderGlyphPicker();
  _renderPaletteGrid();
  _updateInfoDrawState();
}

function _applyEyedropperSample(glyph, fg, bg) {
  editorState.drawGlyph = glyph & 0xFF;
  editorState.drawFg = [...fg];
  editorState.drawBg = [...bg];
  _pushRecentColor('fg', editorState.drawFg);
  _pushRecentColor('bg', editorState.drawBg);
  // W29/W30 match-source contract: eyedropper is the explicit sample action.
  editorState.lastSampledCell = { glyph: glyph & 0xFF, fg: [...fg], bg: [...bg] };

  _forEachTool((t) => {
    _setToolGlyph(t, editorState.drawGlyph);
    _setToolColors(t, editorState.drawFg, editorState.drawBg);
  });

  const glyphEl = document.getElementById('wsGlyphCode');
  if (glyphEl) glyphEl.value = String(editorState.drawGlyph);
  const charEl = document.getElementById('wsGlyphChar');
  if (charEl) charEl.value = (glyph > 31 && glyph < 127) ? String.fromCharCode(glyph) : '';
  const fgEl = document.getElementById('wsFgColor');
  if (fgEl) fgEl.value = _rgbToHex(editorState.drawFg);
  const bgEl = document.getElementById('wsBgColor');
  if (bgEl) bgEl.value = _rgbToHex(editorState.drawBg);

  _renderGlyphPicker();
  _renderPaletteGrid();
  _updateInfoDrawState();
}

// ── Tool switching ──

function _switchTool(name) {
  if (!editorState.mounted || !editorState.canvas) return;
  _cancelPasteMode();
  const previousTool = editorState.canvas.activeTool;
  if (previousTool && previousTool !== editorState.selectTool && typeof previousTool.cancelDrag === 'function') {
    previousTool.cancelDrag();
  }
  _onStrokeEnd();
  if (editorState.activeTool === 'text' && name !== 'text') {
    _commitTextEdit();
  }
  editorState.activeTool = name;
  const canvasEl = editorState.canvas.canvasElement;
  switch (name) {
    case 'cell':
      editorState.canvas.toolActivated(editorState.cellTool);
      if (canvasEl) canvasEl.style.cursor = 'crosshair';
      break;
    case 'adaptive':
      editorState.canvas.toolActivated(editorState.adaptiveStrokeTool);
      if (canvasEl) canvasEl.style.cursor = 'crosshair';
      break;
    case 'slope':
      editorState.canvas.toolActivated(editorState.slopeStrokeTool);
      if (canvasEl) canvasEl.style.cursor = 'crosshair';
      break;
    case 'eyedropper':
      editorState.canvas.toolActivated(editorState.eyedropperTool);
      if (canvasEl) canvasEl.style.cursor = 'copy';
      break;
    case 'erase':
      editorState.canvas.toolActivated(editorState.eraseTool);
      if (canvasEl) canvasEl.style.cursor = 'not-allowed';
      break;
    case 'line':
      editorState.canvas.toolActivated(editorState.lineTool);
      if (canvasEl) canvasEl.style.cursor = 'crosshair';
      break;
    case 'rect':
      editorState.canvas.toolActivated(editorState.rectTool);
      if (canvasEl) canvasEl.style.cursor = 'crosshair';
      break;
    case 'oval':
      editorState.canvas.toolActivated(editorState.ovalTool);
      if (canvasEl) canvasEl.style.cursor = 'crosshair';
      break;
    case 'fill':
      editorState.canvas.toolActivated(editorState.fillTool);
      if (canvasEl) canvasEl.style.cursor = 'crosshair';
      break;
    case 'text':
      editorState.canvas.toolActivated(editorState.textTool);
      if (canvasEl) canvasEl.style.cursor = 'text';
      break;
    case 'select':
      editorState.canvas.toolActivated(editorState.selectTool);
      if (canvasEl) canvasEl.style.cursor = 'cell';
      break;
    default:
      return;
  }
  _updateToolUI();
}

function _updateToolUI() {
  const names = {
    cell: 'Cell',
    slope: 'Slope brush',
    adaptive: 'Auto-wall',
    eyedropper: 'Eyedropper',
    erase: 'Erase',
    line: 'Line',
    rect: 'Rect',
    oval: 'Oval',
    fill: 'Fill',
    text: 'Text',
    select: 'Select',
  };
  const toolEl = document.getElementById('wsActiveTool');
  if (toolEl) toolEl.textContent = names[editorState.activeTool] || editorState.activeTool;

  for (const id of ['wsToolCell', 'wsToolSlope', 'wsToolAdaptive', 'wsToolEyedropper', 'wsToolErase', 'wsToolLine', 'wsToolRect', 'wsToolOval', 'wsToolFill', 'wsToolText', 'wsToolSelect']) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    const toolName = id.replace('wsTool', '').toLowerCase();
    btn.classList.toggle('ws-tool-active', toolName === editorState.activeTool);
  }
  // U6: update mobile status strip on tool change
  if (typeof window._updateMobileStatus === 'function') window._updateMobileStatus();
  // CR-1: dismiss touch toolbar on tool change (event-driven, replaces setInterval)
  if (typeof window._hideTouchToolbar === 'function') window._hideTouchToolbar();
}

// ── Keyboard shortcuts ──

function _onKeyDown(e) {
  if (!editorState.mounted) return;
  if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'Tab') {
    _setMode(editorState.mode === 'paint' ? 'browse' : 'paint');
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (e.key === ' ') {
    editorState.spacePan.armed = true;
  }
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  if (editorState.mode === 'browse') {
    if (e.key === 'ArrowDown') {
      _moveBrowseSelection(1);
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.key === 'ArrowUp') {
      _moveBrowseSelection(-1);
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.key === 'Enter') {
      void _browseOpenSelected();
      e.preventDefault();
      e.stopPropagation();
    }
    return;
  }

  if (_handleTextKey(e)) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  // Ctrl/Cmd+key shortcuts before tool shortcuts
  if (e.ctrlKey || e.metaKey) {
    if (e.shiftKey && e.key.toLowerCase() === 's') {
      if (editorState.onExport) editorState.onExport();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.shiftKey && e.key.toLowerCase() === 'm') {
      _mergeActiveLayerDown();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (/^[1-9]$/.test(e.key)) {
      _toggleLayerVisibility(Number(e.key) - 1);
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    switch (e.key.toLowerCase()) {
      case 'z':
        undo();
        e.preventDefault();
        e.stopPropagation();
        return;
      case 'y':
        redo();
        e.preventDefault();
        e.stopPropagation();
        return;
      case 'c':   // W19 — copy selection
        _copySelection();
        e.preventDefault();
        e.stopPropagation();
        return;
      case 'v':   // W20 — paste (enter paste mode)
        _enterPasteMode();
        e.preventDefault();
        e.stopPropagation();
        return;
      case 'x':   // W21 — cut selection
        _cutSelection();
        e.preventDefault();
        e.stopPropagation();
        return;
      case 'a':   // W23 — select all (bonus, trivial)
        if (editorState.selectTool && editorState.canvas) {
          _switchTool('select');
          const st = editorState.selectTool;
          st.startSelection(0, 0);
          st.updateSelection(editorState.canvas.width - 1, editorState.canvas.height - 1);
          st.endSelection();
          editorState.canvas.render();
        }
        e.preventDefault();
        e.stopPropagation();
        return;
      case 's':
        if (editorState.onSave) editorState.onSave();
        e.preventDefault();
        e.stopPropagation();
        return;
      case 'r':
        void _promptResizeDocument();
        e.preventDefault();
        e.stopPropagation();
        return;
      case 'g':
        _toggleGridVisibility();
        e.preventDefault();
        e.stopPropagation();
        return;
      case 'l':
        _addLayer();
        e.preventDefault();
        e.stopPropagation();
        return;
    }
    if (e.key === 'PageUp') {
      _stepCanvasZoom(1);
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.key === 'PageDown') {
      _stepCanvasZoom(-1);
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // Let other Ctrl/Cmd combos pass through
    return;
  }

  if (e.shiftKey && /^[1-9]$/.test(e.key)) {
    _toggleLayerLock(Number(e.key) - 1);
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  // Escape — cancel paste mode
  if (e.key === 'Escape') {
    if (editorState.pasteMode) {
      _cancelPasteMode();
      e.preventDefault();
      return;
    }
    _cancelShapeDrag();
    if (_cancelTextEdit()) {
      editorState.canvas?.render();
      e.preventDefault();
      return;
    }
  }

  // Delete — W22 delete/clear selection
  if (e.key === 'Delete' || e.key === 'Backspace') {
    _deleteSelection();
    e.preventDefault();
    return;
  }

  // W24/W25 — rotate selection CW/CCW (matches inspector [ ] keys)
  if (e.key === ']') {
    _transformSelection('rot_cw');
    e.preventDefault();
    return;
  }
  if (e.key === '[') {
    _transformSelection('rot_ccw');
    e.preventDefault();
    return;
  }

  if (e.shiftKey && (e.key === 'G' || e.key === 'F' || e.key === 'B')) {
    if (e.key === 'G') _soloApplyChannel('glyph');
    else if (e.key === 'F') _soloApplyChannel('foreground');
    else _soloApplyChannel('background');
    e.preventDefault();
    return;
  }

  if (e.key === '<') {
    _stepCanvasZoom(-1);
    e.preventDefault();
    return;
  }
  if (e.key === '>') {
    _stepCanvasZoom(1);
    e.preventDefault();
    return;
  }

  if (/^[1-9]$/.test(e.key)) {
    _switchActiveLayer(Number(e.key) - 1);
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  // Plain key tool shortcuts — only fire without modifiers
  switch (e.key.toLowerCase()) {
    case 'g':
      _toggleApplyChannel('glyph');
      e.preventDefault();
      break;
    case 'f':
      _toggleApplyChannel('foreground');
      e.preventDefault();
      break;
    case 'b':
      _toggleApplyChannel('background');
      e.preventDefault();
      break;
    case 'c':
      _switchTool(editorState.activeTool === 'cell' ? 'slope' : (editorState.activeTool === 'slope' ? 'adaptive' : 'cell'));
      e.preventDefault();
      break;
    case 'e':
      _switchTool('erase');
      e.preventDefault();
      break;
    case 'd':
      _switchTool('eyedropper');
      e.preventDefault();
      break;
    case 'l':
      _switchTool('line');
      e.preventDefault();
      break;
    case 'r':
      _switchTool('rect');
      e.preventDefault();
      break;
    case 'o':
      _switchTool('oval');
      e.preventDefault();
      break;
    case 'i':
      _switchTool('fill');
      e.preventDefault();
      break;
    case 't':
      _switchTool('text');
      e.preventDefault();
      break;
    case 's':
      _switchTool('select');
      e.preventDefault();
      break;
    case 'x':
      _swapFgBg();
      e.preventDefault();
      break;
  }
}

function _onKeyUp(e) {
  if (e.key === ' ') {
    editorState.spacePan.armed = false;
    editorState.spacePan.dragging = false;
    editorState.spacePan.pointerId = null;
  }
}

// ── Glyph picker ──

function _setDrawGlyph(code) {
  code = Math.max(0, Math.min(255, code));
  editorState.drawGlyph = code;
  _forEachTool((t) => _setToolGlyph(t, code));

  const glyphEl = document.getElementById('wsGlyphCode');
  if (glyphEl) glyphEl.value = String(code);
  const charEl = document.getElementById('wsGlyphChar');
  if (charEl) charEl.value = (code > 31 && code < 127) ? String.fromCharCode(code) : '';

  _renderGlyphPicker();
  _updateInfoDrawState();
}

function _renderGlyphPicker() {
  const canvas = document.getElementById('wsGlyphPickerCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const font = editorState.cp437Font;
  const cw = CELL_SIZE;
  const ch = CELL_SIZE;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let code = 0; code < 256; code++) {
    const col = code % 16;
    const row = Math.floor(code / 16);
    const x = col * cw;
    const y = row * ch;
    const sel = (code === editorState.drawGlyph);

    if (font && font.spriteSheet) {
      const fg = sel ? editorState.drawFg : [0, 0, 0];
      const bg = sel ? editorState.drawBg : [255, 255, 255];
      font.drawGlyph(ctx, code, x, y, fg, bg);
    } else if (code > 31 && code < 127) {
      if (sel) {
        ctx.fillStyle = `rgb(${editorState.drawBg[0]},${editorState.drawBg[1]},${editorState.drawBg[2]})`;
        ctx.fillRect(x, y, cw, ch);
      }
      const fc = sel ? editorState.drawFg : [0, 0, 0];
      ctx.fillStyle = `rgb(${fc[0]},${fc[1]},${fc[2]})`;
      ctx.font = `${Math.floor(cw * 0.7)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String.fromCharCode(code), x + cw / 2, y + ch / 2);
    }

    if (sel) {
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, cw - 2, ch - 2);
    }
  }
}

// ── Sidebar builders ──

function _buildSection(title) {
  const section = document.createElement('div');
  section.className = 'ws-sidebar-section';
  const h4 = document.createElement('h4');
  h4.textContent = title;
  section.appendChild(h4);
  return section;
}

function _placeholder(text) {
  const el = document.createElement('div');
  el.className = 'ws-placeholder';
  el.textContent = text;
  return el;
}

function _buildBrowseDrawer() {
  const browseSection = _buildSection('Browse');
  browseSection.id = 'wsBrowseSection';
  browseSection.dataset.modeScope = 'browse';

  const browseControls = document.createElement('div');
  browseControls.className = 'ws-ta-cols';

  const browsePrimary = document.createElement('div');
  browsePrimary.className = 'ws-ta-col';
  const browsePrimaryLabel = document.createElement('span');
  browsePrimaryLabel.className = 'ws-ta-label';
  browsePrimaryLabel.textContent = 'Document';
  browsePrimary.appendChild(browsePrimaryLabel);

  const openBtn = document.createElement('button');
  openBtn.id = 'wsBrowseOpen';
  openBtn.className = 'ws-tool-btn';
  openBtn.textContent = 'Open selected';
  openBtn.title = 'Open the selected document in the Edit workspace (same as double-clicking its row)';
  openBtn.addEventListener('click', () => { void _browseOpenSelected(); });
  browsePrimary.appendChild(openBtn);

  const renameBtn = document.createElement('button');
  renameBtn.id = 'wsBrowseRename';
  renameBtn.className = 'ws-tool-btn';
  renameBtn.textContent = 'Rename';
  renameBtn.addEventListener('click', () => { void _browseRenameSelected(); });
  browsePrimary.appendChild(renameBtn);

  const browseSecondary = document.createElement('div');
  browseSecondary.className = 'ws-ta-col';
  const browseSecondaryLabel = document.createElement('span');
  browseSecondaryLabel.className = 'ws-ta-label';
  browseSecondaryLabel.textContent = 'Manage';
  browseSecondary.appendChild(browseSecondaryLabel);

  const duplicateBtn = document.createElement('button');
  duplicateBtn.id = 'wsBrowseDuplicate';
  duplicateBtn.className = 'ws-tool-btn';
  duplicateBtn.textContent = 'Duplicate';
  duplicateBtn.addEventListener('click', () => { void _browseDuplicateSelected(); });
  browseSecondary.appendChild(duplicateBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.id = 'wsBrowseDelete';
  deleteBtn.className = 'ws-tool-btn';
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', () => { void _browseDeleteSelected(); });
  browseSecondary.appendChild(deleteBtn);

  browseControls.appendChild(browsePrimary);
  browseControls.appendChild(browseSecondary);
  browseSection.appendChild(browseControls);

  const reloadBtn = document.createElement('button');
  reloadBtn.id = 'wsBrowseReload';
  reloadBtn.className = 'ws-tool-btn';
  reloadBtn.textContent = 'Refresh';
  reloadBtn.style.width = '100%';
  reloadBtn.style.marginTop = '4px';
  reloadBtn.addEventListener('click', () => { void _refreshBrowseItems({ preserveSelection: true }); });
  browseSection.appendChild(reloadBtn);

  const newRawBtn = document.createElement('button');
  newRawBtn.id = 'wsBrowseNewRaw';
  newRawBtn.className = 'ws-tool-btn';
  newRawBtn.textContent = 'New raw XP (no template)';
  newRawBtn.title = 'Create a blank raw XP document without template or bundle selection';
  newRawBtn.style.width = '100%';
  newRawBtn.style.marginTop = '4px';
  newRawBtn.addEventListener('click', () => { void _browseNewRawSelected(); });
  browseSection.appendChild(newRawBtn);

  const browseStatus = document.createElement('div');
  browseStatus.id = 'wsBrowseStatus';
  browseStatus.className = 'ws-placeholder';
  browseStatus.textContent = 'Loading documents...';
  browseSection.appendChild(browseStatus);

  const previewWrap = document.createElement('div');
  previewWrap.id = 'wsBrowsePreviewWrap';
  previewWrap.className = 'ws-browse-preview-wrap';
  const previewMeta = document.createElement('div');
  previewMeta.id = 'wsBrowsePreviewMeta';
  previewMeta.className = 'ws-placeholder';
  previewMeta.textContent = 'Select a document to preview its whole sheet.';
  previewWrap.appendChild(previewMeta);
  const previewCanvas = document.createElement('canvas');
  previewCanvas.id = 'wsBrowsePreview';
  previewCanvas.className = 'ws-browse-preview-canvas';
  previewCanvas.style.imageRendering = 'pixelated';
  previewCanvas.style.maxWidth = '100%';
  previewWrap.appendChild(previewCanvas);
  browseSection.appendChild(previewWrap);

  const sliceBtn = document.createElement('button');
  sliceBtn.id = 'wsBrowseSliceSource';
  sliceBtn.className = 'ws-tool-btn';
  sliceBtn.textContent = 'Slice source…';
  sliceBtn.title = 'Open the Edit workspace at the source-slicing surface';
  sliceBtn.style.width = '100%';
  sliceBtn.style.marginTop = '4px';
  sliceBtn.addEventListener('click', () => { _browseGotoSourceSlicing(); });
  browseSection.appendChild(sliceBtn);

  const browseList = document.createElement('div');
  browseList.id = 'wsBrowseList';
  browseList.className = 'ws-browse-list';
  browseSection.appendChild(browseList);

  const browseDrawer = document.createElement('div');
  browseDrawer.className = 'ws-drawer';
  browseDrawer.dataset.drawer = 'browse';
  browseDrawer.appendChild(browseSection);
  return browseDrawer;
}

function _buildSidebar(layerCount, activeLayer, layerNames, visibleLayers, gridCols, gridRows) {
  const sidebar = document.createElement('div');
  sidebar.className = 'ws-sidebar';

  // 3.1 Mode
  const modeSection = _buildSection('Mode');
  const modeGroup = document.createElement('div');
  modeGroup.className = 'ws-tool-group';
  const paintBtn = document.createElement('button');
  paintBtn.id = 'wsModePaint';
  paintBtn.textContent = 'PAINT';
  paintBtn.className = 'ws-tool-btn ws-tool-active';
  paintBtn.addEventListener('click', () => _setMode('paint'));
  const browseBtn = document.createElement('button');
  browseBtn.id = 'wsModeBrowse';
  browseBtn.textContent = 'BROWSE';
  browseBtn.className = 'ws-tool-btn';
  browseBtn.title = 'Browse documents';
  browseBtn.addEventListener('click', () => _setMode('browse'));
  modeGroup.appendChild(paintBtn);
  modeGroup.appendChild(browseBtn);
  modeSection.appendChild(modeGroup);

  // U5: Drawer wrappers — transparent on desktop (display:contents), bottom-sheet on mobile
  const toolsDrawer = document.createElement('div');
  toolsDrawer.className = 'ws-drawer';
  toolsDrawer.dataset.drawer = 'tools';
  toolsDrawer.appendChild(modeSection);
  // (remaining tools-drawer sections appended below)

  if (!browseAppHostEl) sidebar.appendChild(_buildBrowseDrawer());

  // 3.2 Glyph — 16x16 CP437 picker (spec §3.2)
  const glyphSection = _buildSection('Glyph');
  glyphSection.dataset.modeScope = 'paint';

  const pickerCanvas = document.createElement('canvas');
  pickerCanvas.id = 'wsGlyphPickerCanvas';
  pickerCanvas.className = 'ws-glyph-picker-canvas';
  pickerCanvas.width = 16 * CELL_SIZE;
  pickerCanvas.height = 16 * CELL_SIZE;
  pickerCanvas.style.imageRendering = 'pixelated';
  pickerCanvas.style.cursor = 'pointer';
  pickerCanvas.title = 'Click to select glyph';

  pickerCanvas.addEventListener('click', (e) => {
    const rect = pickerCanvas.getBoundingClientRect();
    const scaleX = pickerCanvas.width / rect.width;
    const scaleY = pickerCanvas.height / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;
    const col = Math.floor(px / CELL_SIZE);
    const row = Math.floor(py / CELL_SIZE);
    if (col < 0 || col >= 16 || row < 0 || row >= 16) return;
    _setDrawGlyph(row * 16 + col);
  });

  glyphSection.appendChild(pickerCanvas);

  const glyphRow = document.createElement('div');
  glyphRow.className = 'ws-glyph-row';
  const glyphInput = document.createElement('input');
  glyphInput.type = 'number';
  glyphInput.id = 'wsGlyphCode';
  glyphInput.min = '0';
  glyphInput.max = '255';
  glyphInput.value = String(editorState.drawGlyph);
  glyphInput.style.width = '48px';
  const glyphChar = document.createElement('input');
  glyphChar.type = 'text';
  glyphChar.id = 'wsGlyphChar';
  glyphChar.maxLength = 1;
  glyphChar.value = String.fromCharCode(editorState.drawGlyph);
  glyphChar.style.width = '28px';
  glyphChar.title = 'Type a character';

  glyphInput.addEventListener('change', () => {
    _setDrawGlyph(Math.max(0, Math.min(255, parseInt(glyphInput.value, 10) || 0)));
  });
  glyphChar.addEventListener('input', () => {
    if (glyphChar.value.length === 1) {
      _setDrawGlyph(glyphChar.value.charCodeAt(0) & 0xFF);
    }
  });

  glyphRow.appendChild(glyphInput);
  glyphRow.appendChild(glyphChar);
  glyphSection.appendChild(glyphRow);
  toolsDrawer.appendChild(glyphSection);

  // 3.3 Palette (spec §3.3: color grid + fg/bg swatches)
  const paletteSection = _buildSection('Palette');
  paletteSection.dataset.modeScope = 'paint';

  const paletteCanvas = document.createElement('canvas');
  paletteCanvas.id = 'wsPaletteCanvas';
  paletteCanvas.className = 'ws-palette-canvas';
  paletteCanvas.width = PALETTE_COLS * PALETTE_CELL;
  paletteCanvas.height = PALETTE_ROWS * PALETTE_CELL;
  paletteCanvas.style.imageRendering = 'pixelated';
  paletteCanvas.style.cursor = 'pointer';
  paletteCanvas.title = 'LMB = set foreground, RMB = set background';
  paletteCanvas.addEventListener('click', (e) => _onPaletteClick(e, 'fg'));
  paletteCanvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    _onPaletteClick(e, 'bg');
  });
  paletteSection.appendChild(paletteCanvas);

  const swatchRow = document.createElement('div');
  swatchRow.className = 'ws-swatch-row';

  const fgLabel = document.createElement('span');
  fgLabel.className = 'ws-swatch-label';
  fgLabel.textContent = 'f';
  const fgInput = document.createElement('input');
  fgInput.type = 'color';
  fgInput.id = 'wsFgColor';
  fgInput.value = _rgbToHex(editorState.drawFg);
  fgInput.title = 'Foreground color';
  // Use 'change' not 'input' so only the final committed picker value pushes to recents
  // (codex review 2026-06-03: input fires on every intermediate drag value, polluting LRU).
  fgInput.addEventListener('change', () => {
    editorState.drawFg = _hexToRgb(fgInput.value);
    _pushRecentColor('fg', editorState.drawFg);
    _forEachTool((t) => _setToolColors(t, editorState.drawFg, editorState.drawBg));
    _renderGlyphPicker();
    _renderPaletteGrid();
    _updateInfoDrawState();
  });
  // B3: right-click the fg swatch opens recents context menu.
  fgInput.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    _showRecentsContextMenu('fg', fgInput, e.clientX, e.clientY);
  });

  const bgLabel = document.createElement('span');
  bgLabel.className = 'ws-swatch-label';
  bgLabel.textContent = 'b';
  const bgInput = document.createElement('input');
  bgInput.type = 'color';
  bgInput.id = 'wsBgColor';
  bgInput.value = _rgbToHex(editorState.drawBg);
  bgInput.title = 'Background color';
  // Use 'change' not 'input' so only the final committed picker value pushes to recents
  // (codex review 2026-06-03: input fires on every intermediate drag value, polluting LRU).
  bgInput.addEventListener('change', () => {
    editorState.drawBg = _hexToRgb(bgInput.value);
    _pushRecentColor('bg', editorState.drawBg);
    _forEachTool((t) => _setToolColors(t, editorState.drawFg, editorState.drawBg));
    _renderGlyphPicker();
    _renderPaletteGrid();
    _updateInfoDrawState();
  });
  // B3: right-click the bg swatch opens recents context menu.
  bgInput.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    _showRecentsContextMenu('bg', bgInput, e.clientX, e.clientY);
  });

  const swapBtn = document.createElement('button');
  swapBtn.id = 'wsSwapFgBg';
  swapBtn.textContent = '⇄';
  swapBtn.className = 'ws-tool-btn';
  swapBtn.title = 'Swap foreground / background (X)';
  swapBtn.addEventListener('click', _swapFgBg);

  swatchRow.appendChild(fgLabel);
  swatchRow.appendChild(fgInput);
  swatchRow.appendChild(swapBtn);
  swatchRow.appendChild(bgLabel);
  swatchRow.appendChild(bgInput);
  paletteSection.appendChild(swatchRow);

  // Dedicated transparent-key row — MAG (255,0,255) primary, YEL (255,255,0) secondary (Y9-2).
  // FL-2026-06-03: user reported picking "magenta-ish" from palette and it not being the canonical
  // transparent key — these pin to the exact values used by the runtime renderer.
  const transparentRow = document.createElement('div');
  transparentRow.className = 'ws-transparent-row';
  transparentRow.title = 'Transparent keys: MAG (255,0,255) makes a cell see-through in the runtime; YEL (255,255,0) is the Y9-2 secondary transparent key. LMB = set foreground, RMB = set background.';
  const _mkTransparentBtn = (rgb, label, title) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ws-transparent-btn';
    b.textContent = label;
    b.title = title;
    b.style.background = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    b.style.color = rgb[0] + rgb[1] + rgb[2] > 384 ? '#000' : '#fff';
    b.addEventListener('click', () => {
      editorState.drawFg = [...rgb];
      _pushRecentColor('fg', editorState.drawFg);
      const fgEl = document.getElementById('wsFgColor');
      if (fgEl) fgEl.value = _rgbToHex(editorState.drawFg);
      _forEachTool((t) => _setToolColors(t, editorState.drawFg, editorState.drawBg));
      _renderGlyphPicker(); _renderPaletteGrid(); _updateInfoDrawState();
    });
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      editorState.drawBg = [...rgb];
      _pushRecentColor('bg', editorState.drawBg);
      const bgEl = document.getElementById('wsBgColor');
      if (bgEl) bgEl.value = _rgbToHex(editorState.drawBg);
      _forEachTool((t) => _setToolColors(t, editorState.drawFg, editorState.drawBg));
      _renderGlyphPicker(); _renderPaletteGrid(); _updateInfoDrawState();
    });
    return b;
  };
  transparentRow.appendChild(_mkTransparentBtn([255,0,255], 'MAG transparent', 'Primary transparent key (255,0,255) — runtime renders as see-through. LMB = FG, RMB = BG.'));
  transparentRow.appendChild(_mkTransparentBtn([255,255,0], 'YEL transparent-2', 'Secondary transparent key (255,255,0) — Y9-2 engine. LMB = FG, RMB = BG.'));
  paletteSection.appendChild(transparentRow);

  // B5: prefilled FBG-combo subpalette derived from Y9-2 semantic_maps/player-0100.json
  // canonical palette_roles. Each button selects FG+BG together (LMB) or swaps (RMB).
  const fbgRow = document.createElement('div');
  fbgRow.className = 'ws-fbg-combo-row';
  fbgRow.title = 'Canonical FG/BG combos from Y9-2 player-0100. LMB = apply (fg,bg). RMB = apply swapped (bg,fg).';
  const _mkFbgBtn = (fg, bg, label, hint) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ws-fbg-combo-btn';
    b.title = `${label} — fg=rgb(${fg.join(',')}) bg=rgb(${bg.join(',')}). ${hint}`;
    const fgHalf = document.createElement('span');
    fgHalf.className = 'ws-fbg-half ws-fbg-half-top';
    fgHalf.style.background = `rgb(${fg[0]},${fg[1]},${fg[2]})`;
    const bgHalf = document.createElement('span');
    bgHalf.className = 'ws-fbg-half ws-fbg-half-bot';
    bgHalf.style.background = `rgb(${bg[0]},${bg[1]},${bg[2]})`;
    b.appendChild(fgHalf);
    b.appendChild(bgHalf);
    const _apply = (f, g) => {
      editorState.drawFg = [...f];
      editorState.drawBg = [...g];
      _pushRecentColor('fg', editorState.drawFg);
      _pushRecentColor('bg', editorState.drawBg);
      const fgEl = document.getElementById('wsFgColor');
      const bgEl = document.getElementById('wsBgColor');
      if (fgEl) fgEl.value = _rgbToHex(editorState.drawFg);
      if (bgEl) bgEl.value = _rgbToHex(editorState.drawBg);
      _forEachTool((t) => _setToolColors(t, editorState.drawFg, editorState.drawBg));
      _renderGlyphPicker(); _renderPaletteGrid(); _updateInfoDrawState();
    };
    b.addEventListener('click', () => _apply(fg, bg));
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); _apply(bg, fg); });
    return b;
  };
  // Source: docs/research/ascii/semantic_maps/player-0100.json → palette_roles
  // (vendor symlink to asciicker-Y9-2). If the Y9-2 source updates, revise this
  // list to match. Last synced: 2026-06-03 (codex review 2026-06-03: provenance).
  const FBG_COMBOS = [
    { fg: [0,0,0],       bg: [255,255,85],  label: 'hair on subcell',  hint: 'black hair fg over yellow subcell-fill bg' },
    { fg: [170,0,0],     bg: [255,85,85],   label: 'mouth on skin',    hint: 'dark-red detail on light-red skin' },
    { fg: [255,255,255], bg: [255,85,85],   label: 'shine on skin',    hint: 'white highlight on skin' },
    { fg: [0,0,0],       bg: [255,85,85],   label: 'eye on skin',      hint: 'black eye on skin' },
    { fg: [170,0,170],   bg: [255,255,85],  label: 'shirt edge',       hint: 'purple shirt fg on yellow subcell-fill bg' },
    { fg: [0,0,170],     bg: [85,85,255],   label: 'pants seam',       hint: 'dark-blue fg on bright-blue pants bg' },
    { fg: [170,85,0],    bg: [255,255,85],  label: 'boot edge',        hint: 'brown boot fg on yellow subcell-fill bg' },
    { fg: [255,255,255], bg: [0,0,170],     label: 'pants highlight',  hint: 'white highlight on dark-blue pants' },
  ];
  for (const c of FBG_COMBOS) fbgRow.appendChild(_mkFbgBtn(c.fg, c.bg, c.label, c.hint));
  paletteSection.appendChild(fbgRow);

  // B4: recents subpalette — auto-tracks last 8 fg + 8 bg selections.
  const recentsRow = document.createElement('div');
  recentsRow.id = 'wsRecentsRow';
  recentsRow.className = 'ws-recents-row';
  recentsRow.title = 'Recently-used colors (FG row top, BG row bottom). LMB applies to the same channel; RMB applies to the opposite channel.';
  paletteSection.appendChild(recentsRow);

  toolsDrawer.appendChild(paletteSection);

  // 3.4 Tools / Apply (spec §3.4: two-column layout)
  const toolsSection = _buildSection('Tools / Apply');
  toolsSection.dataset.modeScope = 'paint';
  const taCols = document.createElement('div');
  taCols.className = 'ws-ta-cols';

  // Left column — Tools: Undo, Redo, Grid
  const toolsCol = document.createElement('div');
  toolsCol.className = 'ws-ta-col';
  const toolsLabel = document.createElement('span');
  toolsLabel.className = 'ws-ta-label';
  toolsLabel.textContent = 'Tools';
  toolsCol.appendChild(toolsLabel);

  const undoBtn = document.createElement('button');
  undoBtn.id = 'wsUndoBtn';
  undoBtn.className = 'ws-tool-btn';
  undoBtn.textContent = 'Undo';
  undoBtn.title = 'Undo (Ctrl+Z)';
  undoBtn.addEventListener('click', () => { undo(); });
  toolsCol.appendChild(undoBtn);

  const redoBtn = document.createElement('button');
  redoBtn.id = 'wsRedoBtn';
  redoBtn.className = 'ws-tool-btn';
  redoBtn.textContent = 'Redo';
  redoBtn.title = 'Redo (Ctrl+Y)';
  redoBtn.addEventListener('click', () => { redo(); });
  toolsCol.appendChild(redoBtn);

  toolsCol.appendChild(_buildToggle('Grid', 'wsGridToggle', editorState.gridVisible, (on) => {
    editorState.gridVisible = !!on;
    if (editorState.canvas) {
      if (on) _applyGridStepToCanvas();
      editorState.canvas.setGridVisible(on);
    }
    _emitDocumentStateChange('grid-toggle');
  }));

  const gridStepSel = document.createElement('select');
  gridStepSel.id = 'wsGridStep';
  gridStepSel.title = 'Grid cell spacing';
  gridStepSel.style.cssText = 'width:146px;padding:2px;font-size:11px;background:var(--bg);color:var(--fg);border:1px solid #2a3345;';
  const frameOpt = document.createElement('option');
  frameOpt.value = 'frame';
  frameOpt.textContent = 'Frame';
  gridStepSel.appendChild(frameOpt);
  const metaOpt = document.createElement('option');
  metaOpt.id = 'wsGridStepLayer0Meta';
  metaOpt.value = 'layer0_metadata';
  metaOpt.textContent = 'Layer0 Meta';
  gridStepSel.appendChild(metaOpt);
  for (const v of [1, 2, 4, 8, 16]) {
    const opt = document.createElement('option');
    opt.value = String(v);
    opt.textContent = `${v}\u00d7${v}`;
    gridStepSel.appendChild(opt);
  }
  for (const preset of editorState.gridTemplatePresets) {
    const opt = document.createElement('option');
    opt.value = `template:${preset.key}`;
    opt.textContent = `Template: ${preset.label} (${preset.width}\u00d7${preset.height})`;
    gridStepSel.appendChild(opt);
  }
  const customOpt = document.createElement('option');
  customOpt.value = 'custom';
  customOpt.textContent = 'Custom';
  gridStepSel.appendChild(customOpt);
  gridStepSel.value = editorState.gridStep;
  gridStepSel.addEventListener('change', () => {
    editorState.gridStep = _normalizeGridStepToken(gridStepSel.value);
    _applyGridStepToCanvas();
    _emitDocumentStateChange('grid-step');
  });
  toolsCol.appendChild(gridStepSel);

  const gridCustomRow = document.createElement('div');
  gridCustomRow.className = 'ws-inline-row';
  gridCustomRow.style.cssText = 'display:flex;gap:4px;align-items:center;flex-wrap:nowrap;';

  const gridCustomW = document.createElement('input');
  gridCustomW.id = 'wsGridCustomW';
  gridCustomW.type = 'number';
  gridCustomW.min = '1';
  gridCustomW.title = 'Custom grid width';
  gridCustomW.value = String(_coerceGridSize(editorState.gridCustomW, 1));
  gridCustomW.style.cssText = 'width:56px;padding:2px;font-size:11px;background:var(--bg);color:var(--fg);border:1px solid #2a3345;';
  gridCustomW.addEventListener('change', () => {
    editorState.gridCustomW = _coerceGridSize(gridCustomW.value, editorState.gridCustomW || 1);
    _syncGridControlsUI();
    if (editorState.gridStep === 'custom') {
      _applyGridStepToCanvas();
      _emitDocumentStateChange('grid-custom-width');
    }
  });
  gridCustomRow.appendChild(gridCustomW);

  const timesLabel = document.createElement('span');
  timesLabel.textContent = '\u00d7';
  gridCustomRow.appendChild(timesLabel);

  const gridCustomH = document.createElement('input');
  gridCustomH.id = 'wsGridCustomH';
  gridCustomH.type = 'number';
  gridCustomH.min = '1';
  gridCustomH.title = 'Custom grid height';
  gridCustomH.value = String(_coerceGridSize(editorState.gridCustomH, 1));
  gridCustomH.style.cssText = 'width:56px;padding:2px;font-size:11px;background:var(--bg);color:var(--fg);border:1px solid #2a3345;';
  gridCustomH.addEventListener('change', () => {
    editorState.gridCustomH = _coerceGridSize(gridCustomH.value, editorState.gridCustomH || 1);
    _syncGridControlsUI();
    if (editorState.gridStep === 'custom') {
      _applyGridStepToCanvas();
      _emitDocumentStateChange('grid-custom-height');
    }
  });
  gridCustomRow.appendChild(gridCustomH);
  toolsCol.appendChild(gridCustomRow);
  _syncGridControlsUI();

  // Right column — Apply: G, F, B toggles
  const applyCol = document.createElement('div');
  applyCol.className = 'ws-ta-col';
  const applyLabel = document.createElement('span');
  applyLabel.className = 'ws-ta-label';
  applyLabel.textContent = 'Apply';
  applyCol.appendChild(applyLabel);

  applyCol.appendChild(_buildToggle('G', 'wsApplyGlyph', editorState.applyGlyph, (on) => {
    _setApplyChannel('glyph', on);
  }));
  applyCol.appendChild(_buildToggle('F', 'wsApplyFg', editorState.applyFg, (on) => {
    _setApplyChannel('foreground', on);
  }));
  applyCol.appendChild(_buildToggle('B', 'wsApplyBg', editorState.applyBg, (on) => {
    _setApplyChannel('background', on);
  }));

  taCols.appendChild(toolsCol);
  taCols.appendChild(applyCol);
  toolsSection.appendChild(taCols);
  toolsDrawer.appendChild(toolsSection);

  // 3.5 Image / Draw (spec §3.5: two-column layout)
  const imageDrawSection = _buildSection('Image / Draw');
  imageDrawSection.dataset.modeScope = 'paint';
  const idCols = document.createElement('div');
  idCols.className = 'ws-ta-cols';

  // Left column — Image: Save, Export, Resize
  const imageCol = document.createElement('div');
  imageCol.className = 'ws-ta-col';
  const imageLabel = document.createElement('span');
  imageLabel.className = 'ws-ta-label';
  imageLabel.textContent = 'Image';
  imageCol.appendChild(imageLabel);
  const resizeBtn = document.createElement('button');
  resizeBtn.id = 'wsResizeBtn';
  resizeBtn.className = 'ws-tool-btn';
  resizeBtn.textContent = 'Resize';
  resizeBtn.title = 'Resize image (Ctrl+R)';
  resizeBtn.addEventListener('click', () => { void _promptResizeDocument(); });
  imageCol.appendChild(resizeBtn);

  const duplicateFileActions = document.createElement('details');
  duplicateFileActions.className = 'ws-duplicate-file-actions';
  duplicateFileActions.dataset.diagnosticSurface = 'duplicate-file-actions';
  const duplicateFileSummary = document.createElement('summary');
  duplicateFileSummary.textContent = 'More file actions';
  duplicateFileActions.appendChild(duplicateFileSummary);

  const saveBtn = document.createElement('button');
  saveBtn.id = 'wsSaveBtn';
  saveBtn.className = 'ws-tool-btn';
  saveBtn.textContent = 'Save';
  saveBtn.title = 'Save session to server';
  saveBtn.addEventListener('click', () => { if (editorState.onSave) editorState.onSave(); });
  duplicateFileActions.appendChild(saveBtn);

  const exportBtn = document.createElement('button');
  exportBtn.id = 'wsExportBtn';
  exportBtn.className = 'ws-tool-btn';
  exportBtn.textContent = 'Export';
  exportBtn.title = 'Export XP file (save + download)';
  exportBtn.addEventListener('click', () => { if (editorState.onExport) editorState.onExport(); });
  duplicateFileActions.appendChild(exportBtn);
  imageCol.appendChild(duplicateFileActions);

  // Right column — Draw: active tool selector
  const drawCol = document.createElement('div');
  drawCol.className = 'ws-ta-col';
  const drawLabel = document.createElement('span');
  drawLabel.className = 'ws-ta-label';
  drawLabel.textContent = 'Draw';
  drawCol.appendChild(drawLabel);

  const toolCellBtn = document.createElement('button');
  toolCellBtn.id = 'wsToolCell';
  toolCellBtn.dataset.tool = 'cell';
  toolCellBtn.textContent = 'Cell';
  toolCellBtn.className = 'ws-tool-btn ws-tool-active';
  toolCellBtn.addEventListener('click', () => _switchTool('cell'));
  drawCol.appendChild(toolCellBtn);

  const toolSlopeBtn = document.createElement('button');
  toolSlopeBtn.id = 'wsToolSlope';
  toolSlopeBtn.dataset.tool = 'slope';
  toolSlopeBtn.textContent = 'Slope brush';
  toolSlopeBtn.className = 'ws-tool-btn';
  toolSlopeBtn.addEventListener('click', () => _switchTool('slope'));
  drawCol.appendChild(toolSlopeBtn);

  const moreDrawTools = document.createElement('details');
  moreDrawTools.className = 'ws-more-draw-tools';
  const moreDrawToolsSummary = document.createElement('summary');
  moreDrawToolsSummary.textContent = 'More tools';
  moreDrawTools.appendChild(moreDrawToolsSummary);

  const toolAdaptiveBtn = document.createElement('button');
  toolAdaptiveBtn.id = 'wsToolAdaptive';
  toolAdaptiveBtn.dataset.tool = 'adaptive';
  toolAdaptiveBtn.textContent = 'Auto-wall';
  toolAdaptiveBtn.className = 'ws-tool-btn';
  toolAdaptiveBtn.title = 'Context-sensitive auto-wall / auto-box brush (press C again)';
  toolAdaptiveBtn.addEventListener('click', () => _switchTool('adaptive'));
  moreDrawTools.appendChild(toolAdaptiveBtn);

  const toolEyedropperBtn = document.createElement('button');
  toolEyedropperBtn.id = 'wsToolEyedropper';
  toolEyedropperBtn.dataset.tool = 'eyedropper';
  toolEyedropperBtn.textContent = 'Pick';
  toolEyedropperBtn.className = 'ws-tool-btn';
  toolEyedropperBtn.title = 'Eyedropper (D)';
  toolEyedropperBtn.addEventListener('click', () => _switchTool('eyedropper'));
  moreDrawTools.appendChild(toolEyedropperBtn);

  const toolEraseBtn = document.createElement('button');
  toolEraseBtn.id = 'wsToolErase';
  toolEraseBtn.dataset.tool = 'erase';
  toolEraseBtn.textContent = 'Erase';
  toolEraseBtn.className = 'ws-tool-btn';
  toolEraseBtn.title = 'Erase tool (E)';
  toolEraseBtn.addEventListener('click', () => _switchTool('erase'));
  moreDrawTools.appendChild(toolEraseBtn);

  const toolLineBtn = document.createElement('button');
  toolLineBtn.id = 'wsToolLine';
  toolLineBtn.dataset.tool = 'line';
  toolLineBtn.textContent = 'Line';
  toolLineBtn.className = 'ws-tool-btn';
  toolLineBtn.title = 'Line tool (L)';
  toolLineBtn.addEventListener('click', () => _switchTool('line'));
  moreDrawTools.appendChild(toolLineBtn);

  const toolRectBtn = document.createElement('button');
  toolRectBtn.id = 'wsToolRect';
  toolRectBtn.dataset.tool = 'rect';
  toolRectBtn.textContent = 'Rect';
  toolRectBtn.className = 'ws-tool-btn';
  toolRectBtn.title = 'Rectangle tool (R)';
  toolRectBtn.addEventListener('click', () => _switchTool('rect'));
  moreDrawTools.appendChild(toolRectBtn);

  const toolOvalBtn = document.createElement('button');
  toolOvalBtn.id = 'wsToolOval';
  toolOvalBtn.dataset.tool = 'oval';
  toolOvalBtn.textContent = 'Oval';
  toolOvalBtn.className = 'ws-tool-btn';
  toolOvalBtn.title = 'Oval tool (O)';
  toolOvalBtn.addEventListener('click', () => _switchTool('oval'));
  moreDrawTools.appendChild(toolOvalBtn);

  const toolFillBtn = document.createElement('button');
  toolFillBtn.id = 'wsToolFill';
  toolFillBtn.dataset.tool = 'fill';
  toolFillBtn.textContent = 'Fill';
  toolFillBtn.className = 'ws-tool-btn';
  toolFillBtn.title = 'Flood fill tool (I)';
  toolFillBtn.addEventListener('click', () => _switchTool('fill'));
  moreDrawTools.appendChild(toolFillBtn);

  const toolSelectBtn = document.createElement('button');
  toolSelectBtn.id = 'wsToolSelect';
  toolSelectBtn.dataset.tool = 'select';
  toolSelectBtn.textContent = 'Select';
  toolSelectBtn.className = 'ws-tool-btn';
  toolSelectBtn.title = 'Selection tool (S)';
  toolSelectBtn.addEventListener('click', () => _switchTool('select'));
  drawCol.appendChild(toolSelectBtn);

  const toolTextBtn = document.createElement('button');
  toolTextBtn.id = 'wsToolText';
  toolTextBtn.dataset.tool = 'text';
  toolTextBtn.textContent = 'Text';
  toolTextBtn.className = 'ws-tool-btn';
  toolTextBtn.title = 'Text tool (T)';
  toolTextBtn.addEventListener('click', () => _switchTool('text'));
  drawCol.appendChild(toolTextBtn);
  drawCol.appendChild(moreDrawTools);

  const clipboardGroup = document.createElement('div');
  clipboardGroup.className = 'ws-tool-group';
  clipboardGroup.style.cssText = 'margin-top:4px; gap:2px;';

  const copyBtn = document.createElement('button');
  copyBtn.id = 'wsCopySelection';
  copyBtn.textContent = 'Copy';
  copyBtn.className = 'ws-tool-btn';
  copyBtn.title = 'Copy selection (Ctrl+C)';
  copyBtn.addEventListener('click', () => _copySelection());
  clipboardGroup.appendChild(copyBtn);

  const cutBtn = document.createElement('button');
  cutBtn.id = 'wsCutSelection';
  cutBtn.textContent = 'Cut';
  cutBtn.className = 'ws-tool-btn';
  cutBtn.title = 'Cut selection (Ctrl+X)';
  cutBtn.addEventListener('click', () => _cutSelection());
  clipboardGroup.appendChild(cutBtn);

  const pasteBtn = document.createElement('button');
  pasteBtn.id = 'wsPasteSelection';
  pasteBtn.textContent = 'Paste';
  pasteBtn.className = 'ws-tool-btn';
  pasteBtn.title = 'Paste selection (Ctrl+V)';
  pasteBtn.addEventListener('click', () => _enterPasteMode());
  clipboardGroup.appendChild(pasteBtn);

  const clearBtn = document.createElement('button');
  clearBtn.id = 'wsClearSelection';
  clearBtn.textContent = 'Clear';
  clearBtn.className = 'ws-tool-btn';
  clearBtn.title = 'Clear selection (Delete)';
  clearBtn.addEventListener('click', () => _deleteSelection());
  clipboardGroup.appendChild(clearBtn);

  moreDrawTools.appendChild(clipboardGroup);

  // W24-W27: Selection transform buttons (shipped UI triggers)
  const transformGroup = document.createElement('div');
  transformGroup.className = 'ws-tool-group';
  transformGroup.style.cssText = 'margin-top:4px; gap:2px;';

  const rotCwBtn = document.createElement('button');
  rotCwBtn.id = 'wsRotateCW';
  rotCwBtn.textContent = 'Rot CW';
  rotCwBtn.className = 'ws-tool-btn';
  rotCwBtn.title = 'Rotate selection clockwise (])';
  rotCwBtn.addEventListener('click', () => _transformSelection('rot_cw'));
  transformGroup.appendChild(rotCwBtn);

  const rotCcwBtn = document.createElement('button');
  rotCcwBtn.id = 'wsRotateCCW';
  rotCcwBtn.textContent = 'Rot CCW';
  rotCcwBtn.className = 'ws-tool-btn';
  rotCcwBtn.title = 'Rotate selection counter-clockwise ([)';
  rotCcwBtn.addEventListener('click', () => _transformSelection('rot_ccw'));
  transformGroup.appendChild(rotCcwBtn);

  const flipHBtn = document.createElement('button');
  flipHBtn.id = 'wsFlipH';
  flipHBtn.textContent = 'Flip H';
  flipHBtn.className = 'ws-tool-btn';
  flipHBtn.title = 'Flip selection horizontally';
  flipHBtn.addEventListener('click', () => _transformSelection('flip_h'));
  transformGroup.appendChild(flipHBtn);

  const flipVBtn = document.createElement('button');
  flipVBtn.id = 'wsFlipV';
  flipVBtn.textContent = 'Flip V';
  flipVBtn.className = 'ws-tool-btn';
  flipVBtn.title = 'Flip selection vertically';
  flipVBtn.addEventListener('click', () => _transformSelection('flip_v'));
  transformGroup.appendChild(flipVBtn);

  moreDrawTools.appendChild(transformGroup);

  // W28-W30: Bulk-edit buttons (shipped UI triggers)
  const bulkGroup = document.createElement('div');
  bulkGroup.className = 'ws-tool-group';
  bulkGroup.style.cssText = 'margin-top:4px; gap:2px;';

  const fillSelBtn = document.createElement('button');
  fillSelBtn.id = 'wsFillSel';
  fillSelBtn.textContent = 'Fill Sel';
  fillSelBtn.className = 'ws-tool-btn';
  fillSelBtn.title = 'Fill selection with active glyph/fg/bg (W28)';
  fillSelBtn.addEventListener('click', () => _fillSelection());
  bulkGroup.appendChild(fillSelBtn);

  const replaceFgBtn = document.createElement('button');
  replaceFgBtn.id = 'wsReplaceFg';
  replaceFgBtn.textContent = 'Repl FG';
  replaceFgBtn.className = 'ws-tool-btn';
  replaceFgBtn.title = 'Replace FG color in selection (eyedropper match → current FG) (W29)';
  replaceFgBtn.addEventListener('click', () => _replaceSelectionColor('fg'));
  bulkGroup.appendChild(replaceFgBtn);

  const replaceBgBtn = document.createElement('button');
  replaceBgBtn.id = 'wsReplaceBg';
  replaceBgBtn.textContent = 'Repl BG';
  replaceBgBtn.className = 'ws-tool-btn';
  replaceBgBtn.title = 'Replace BG color in selection (eyedropper match → current BG) (W30)';
  replaceBgBtn.addEventListener('click', () => _replaceSelectionColor('bg'));
  bulkGroup.appendChild(replaceBgBtn);

  moreDrawTools.appendChild(bulkGroup);
  // Mobile authoring: keep all brushes and grouped actions visible on narrow
  // screens instead of buried in collapsed <details> (UQ-013 small-screen lane).
  const _narrowScreenQuery = window.matchMedia ? window.matchMedia('(max-width: 768px)') : null;
  const _syncMobileDetailsOpen = () => {
    if (!_narrowScreenQuery || !_narrowScreenQuery.matches) return;
    moreDrawTools.open = true;
    duplicateFileActions.open = true;
  };
  _syncMobileDetailsOpen();
  if (_narrowScreenQuery && typeof _narrowScreenQuery.addEventListener === 'function') {
    _narrowScreenQuery.addEventListener('change', _syncMobileDetailsOpen);
  }

  idCols.appendChild(imageCol);
  idCols.appendChild(drawCol);
  imageDrawSection.appendChild(idCols);
  toolsDrawer.appendChild(imageDrawSection);

  // W31: Find & Replace sidebar section (collapsible)
  const frSection = document.createElement('div');
  frSection.className = 'ws-sidebar-section';
  frSection.dataset.modeScope = 'paint';
  const frDetails = document.createElement('details');
  const frSummary = document.createElement('summary');
  frSummary.textContent = 'Find & Replace';
  frSummary.style.cssText = 'cursor:pointer;font-size:10px;color:#5a6a7a;text-transform:uppercase;letter-spacing:0.06em;';
  frDetails.appendChild(frSummary);

  const frWrap = document.createElement('div');
  frWrap.style.cssText = 'margin-top:6px;display:flex;flex-direction:column;gap:4px;font-size:10px;';

  // Match criteria row
  const frMatchLabel = document.createElement('span');
  frMatchLabel.textContent = 'Match';
  frMatchLabel.style.cssText = 'font-size:9px;color:#4a5a6a;text-transform:uppercase;letter-spacing:0.05em;';
  frWrap.appendChild(frMatchLabel);

  const _frChkRow = (id, label, colorId, defaultColor, isNumber) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:4px;';
    const chk = document.createElement('input');
    chk.type = 'checkbox'; chk.id = id;
    row.appendChild(chk);
    const lbl = document.createElement('span');
    lbl.textContent = label; lbl.style.cssText = 'font-size:10px;color:var(--muted);min-width:16px;';
    row.appendChild(lbl);
    if (isNumber) {
      const inp = document.createElement('input');
      inp.type = 'number'; inp.id = colorId; inp.min = '0'; inp.max = '255'; inp.value = '0';
      inp.style.cssText = 'width:48px;font-size:10px;padding:1px 3px;';
      row.appendChild(inp);
    } else {
      const inp = document.createElement('input');
      inp.type = 'color'; inp.id = colorId; inp.value = defaultColor;
      inp.style.cssText = 'width:24px;height:16px;padding:0;border:1px solid #445;cursor:pointer;';
      row.appendChild(inp);
    }
    return row;
  };

  frWrap.appendChild(_frChkRow('wsFrMatchGlyph', 'G', 'wsFrFindGlyphVal', '', true));
  frWrap.appendChild(_frChkRow('wsFrMatchFg', 'FG', 'wsFrFindFgVal', '#ffffff', false));
  frWrap.appendChild(_frChkRow('wsFrMatchBg', 'BG', 'wsFrFindBgVal', '#000000', false));

  // Replace criteria row
  const frReplLabel = document.createElement('span');
  frReplLabel.textContent = 'Replace';
  frReplLabel.style.cssText = 'font-size:9px;color:#4a5a6a;text-transform:uppercase;letter-spacing:0.05em;margin-top:4px;';
  frWrap.appendChild(frReplLabel);

  frWrap.appendChild(_frChkRow('wsFrReplGlyph', 'G', 'wsFrReplGlyphVal', '', true));
  frWrap.appendChild(_frChkRow('wsFrReplFg', 'FG', 'wsFrReplFgVal', '#ffffff', false));
  frWrap.appendChild(_frChkRow('wsFrReplBg', 'BG', 'wsFrReplBgVal', '#000000', false));

  // Scope + Apply button
  const frActionRow = document.createElement('div');
  frActionRow.style.cssText = 'display:flex;align-items:center;gap:4px;margin-top:4px;';
  const frScopeSel = document.createElement('select');
  frScopeSel.id = 'wsFrScope';
  frScopeSel.style.cssText = 'font-size:10px;padding:2px;background:var(--bg);color:var(--fg);border:1px solid #2a3345;';
  const optSel = document.createElement('option'); optSel.value = 'selection'; optSel.textContent = 'Selection';
  const optCanvas = document.createElement('option'); optCanvas.value = 'canvas'; optCanvas.textContent = 'Canvas';
  const optGridFrames = document.createElement('option'); optGridFrames.value = 'grid_frames'; optGridFrames.textContent = 'Grid Frames';
  frScopeSel.appendChild(optSel);
  frScopeSel.appendChild(optCanvas);
  frScopeSel.appendChild(optGridFrames);
  frScopeSel.addEventListener('change', () => _syncFindReplaceScopeUI());
  frActionRow.appendChild(frScopeSel);
  const frApplyBtn = document.createElement('button');
  frApplyBtn.id = 'wsFrApply';
  frApplyBtn.textContent = 'Apply';
  frApplyBtn.className = 'ws-tool-btn';
  frApplyBtn.style.cssText = 'font-size:10px;padding:2px 8px;';
  frApplyBtn.addEventListener('click', () => _findReplace());
  frActionRow.appendChild(frApplyBtn);
  frWrap.appendChild(frActionRow);

  const frGridRow = document.createElement('div');
  frGridRow.style.cssText = 'display:flex;align-items:center;gap:4px;';
  const frGridLabel = document.createElement('span');
  frGridLabel.textContent = 'At';
  frGridLabel.style.cssText = 'font-size:10px;color:var(--muted);min-width:16px;';
  frGridRow.appendChild(frGridLabel);
  const frGridX = document.createElement('input');
  frGridX.id = 'wsFrGridCellX';
  frGridX.type = 'number';
  frGridX.min = '0';
  frGridX.value = '0';
  frGridX.style.cssText = 'width:48px;font-size:10px;padding:1px 3px;';
  frGridX.addEventListener('change', () => _syncFindReplaceScopeUI());
  frGridRow.appendChild(frGridX);
  const frGridSep = document.createElement('span');
  frGridSep.textContent = ',';
  frGridRow.appendChild(frGridSep);
  const frGridY = document.createElement('input');
  frGridY.id = 'wsFrGridCellY';
  frGridY.type = 'number';
  frGridY.min = '0';
  frGridY.value = '0';
  frGridY.style.cssText = 'width:48px;font-size:10px;padding:1px 3px;';
  frGridY.addEventListener('change', () => _syncFindReplaceScopeUI());
  frGridRow.appendChild(frGridY);
  frWrap.appendChild(frGridRow);

  const frGridHint = document.createElement('div');
  frGridHint.id = 'wsFrGridHint';
  frGridHint.style.cssText = 'font-size:9px;color:#5a6a7a;min-height:12px;';
  frWrap.appendChild(frGridHint);
  _syncFindReplaceScopeUI();

  frDetails.appendChild(frWrap);
  frSection.appendChild(frDetails);
  toolsDrawer.appendChild(frSection);
  sidebar.appendChild(toolsDrawer);

  // 3.6 Layers (Edit concern: hidden in Browse via paint modeScope)
  const layersSection = _buildSection('Layers');
  layersSection.dataset.modeScope = 'paint';
  const layersPanel = document.createElement('div');
  layersPanel.id = 'wsLayersPanel';
  layersPanel.className = 'ws-layers-panel';
  layersSection.appendChild(layersPanel);

  const layersDrawer = document.createElement('div');
  layersDrawer.className = 'ws-drawer';
  layersDrawer.dataset.drawer = 'layers';
  layersDrawer.appendChild(layersSection);
  sidebar.appendChild(layersDrawer);

  // 3.9 Info (spec §3.9: cursor pos, dims, active layer, glyph/fg/bg under cursor)
  const statusSection = document.createElement('div');
  statusSection.className = 'ws-sidebar-section ws-status-section';
  statusSection.dataset.modeScope = 'paint';
  const statusH4 = document.createElement('h4');
  statusH4.textContent = 'Info';
  statusSection.appendChild(statusH4);

  // Cursor/hover group
  const cursorGrp = document.createElement('div');
  cursorGrp.className = 'ws-info-group';

  const posRow = document.createElement('div');
  posRow.className = 'ws-info-row';
  const posLabel = document.createElement('span');
  posLabel.className = 'ws-info-label';
  posLabel.textContent = 'Pos';
  const posVal = document.createElement('span');
  posVal.id = 'wsPos';
  posVal.textContent = '-,-';
  posRow.appendChild(posLabel);
  posRow.appendChild(posVal);
  cursorGrp.appendChild(posRow);

  const hoverRow = document.createElement('div');
  hoverRow.className = 'ws-info-row';
  const hoverLabel = document.createElement('span');
  hoverLabel.className = 'ws-info-label';
  hoverLabel.textContent = 'Cell';
  const hoverGlyph = document.createElement('span');
  hoverGlyph.id = 'wsHoverGlyph';
  hoverGlyph.textContent = '--';
  const hoverFg = document.createElement('span');
  hoverFg.id = 'wsHoverFg';
  hoverFg.className = 'ws-info-swatch ws-info-swatch-empty';
  hoverFg.title = 'fg under cursor';
  const hoverBg = document.createElement('span');
  hoverBg.id = 'wsHoverBg';
  hoverBg.className = 'ws-info-swatch ws-info-swatch-empty';
  hoverBg.title = 'bg under cursor';
  hoverRow.appendChild(hoverLabel);
  hoverRow.appendChild(hoverGlyph);
  hoverRow.appendChild(hoverFg);
  hoverRow.appendChild(hoverBg);
  cursorGrp.appendChild(hoverRow);
  statusSection.appendChild(cursorGrp);

  // Draw state group
  const drawGrp = document.createElement('div');
  drawGrp.className = 'ws-info-group';

  const drawRow = document.createElement('div');
  drawRow.className = 'ws-info-row';
  const drawInfoLabel = document.createElement('span');
  drawInfoLabel.className = 'ws-info-label';
  drawInfoLabel.textContent = 'Draw';
  const drawGlyphEl = document.createElement('span');
  drawGlyphEl.id = 'wsDrawGlyph';
  const dg = editorState.drawGlyph;
  const dch = (dg > 31 && dg < 127) ? String.fromCharCode(dg) : '\u00b7';
  drawGlyphEl.textContent = dg + ' (' + dch + ')';
  const drawFgSw = document.createElement('span');
  drawFgSw.id = 'wsDrawFgSwatch';
  drawFgSw.className = 'ws-info-swatch';
  drawFgSw.style.background = _rgbToHex(editorState.drawFg);
  drawFgSw.title = 'draw fg';
  const drawBgSw = document.createElement('span');
  drawBgSw.id = 'wsDrawBgSwatch';
  drawBgSw.className = 'ws-info-swatch';
  drawBgSw.style.background = _rgbToHex(editorState.drawBg);
  drawBgSw.title = 'draw bg';
  drawRow.appendChild(drawInfoLabel);
  drawRow.appendChild(drawGlyphEl);
  drawRow.appendChild(drawFgSw);
  drawRow.appendChild(drawBgSw);
  drawGrp.appendChild(drawRow);

  const applyRow = document.createElement('div');
  applyRow.className = 'ws-info-row';
  const applyInfoLabel = document.createElement('span');
  applyInfoLabel.className = 'ws-info-label';
  applyInfoLabel.textContent = 'Apply';
  applyRow.appendChild(applyInfoLabel);
  for (const [ch, on, id] of [['G', editorState.applyGlyph, 'wsInfoApplyG'], ['F', editorState.applyFg, 'wsInfoApplyF'], ['B', editorState.applyBg, 'wsInfoApplyB']]) {
    const tag = document.createElement('span');
    tag.id = id;
    tag.className = 'ws-info-apply-tag' + (on ? ' ws-info-apply-on' : '');
    tag.textContent = ch;
    applyRow.appendChild(tag);
  }
  drawGrp.appendChild(applyRow);
  statusSection.appendChild(drawGrp);

  // Status group
  const statsGrp = document.createElement('div');
  statsGrp.className = 'ws-info-group';

  const layerRow = document.createElement('div');
  layerRow.className = 'ws-info-row';
  const layerLabel = document.createElement('span');
  layerLabel.className = 'ws-info-label';
  layerLabel.textContent = 'Layer';
  const layerVal = document.createElement('span');
  layerVal.id = 'wsActiveLayerInfo';
  layerVal.textContent = String(typeof activeLayer === 'number' ? activeLayer : 0);
  layerRow.appendChild(layerLabel);
  layerRow.appendChild(layerVal);
  statsGrp.appendChild(layerRow);

  const toolRow = document.createElement('div');
  toolRow.className = 'ws-info-row';
  const toolLabel = document.createElement('span');
  toolLabel.className = 'ws-info-label';
  toolLabel.textContent = 'Tool';
  const toolVal = document.createElement('span');
  toolVal.id = 'wsActiveTool';
  toolVal.textContent = 'Cell';
  toolRow.appendChild(toolLabel);
  toolRow.appendChild(toolVal);
  statsGrp.appendChild(toolRow);

  const dimsRow = document.createElement('div');
  dimsRow.className = 'ws-info-row';
  const dimsLabel = document.createElement('span');
  dimsLabel.className = 'ws-info-label';
  dimsLabel.textContent = 'Size';
  const dimsVal = document.createElement('span');
  dimsVal.id = 'wsDims';
  dimsVal.textContent = gridCols + '\u00d7' + gridRows + ' \u00b7 ' + layerCount + 'L';
  dimsRow.appendChild(dimsLabel);
  dimsRow.appendChild(dimsVal);
  statsGrp.appendChild(dimsRow);

  statusSection.appendChild(statsGrp);

  const infoDrawer = document.createElement('div');
  infoDrawer.className = 'ws-drawer';
  infoDrawer.dataset.drawer = 'info';
  infoDrawer.appendChild(statusSection);
  sidebar.appendChild(infoDrawer);

  return sidebar;
}

// ── Browse whole-sheet preview ──
// Row select fetches the selected session read-only (no document switch) and
// renders its whole sheet into the Browse drawer preview canvas. Open still
// owns the real document switch via onBrowseOpen.
let browsePreviewCache = new Map();
let browsePreviewPendingId = '';

function _browsePreviewCell(cell) {
  if (!cell) return { glyph: 0, fg: [0, 0, 0], bg: [0, 0, 0] };
  const glyph = Number(cell.glyph ?? cell[0] ?? 0) || 0;
  const fg = Array.isArray(cell.fg) ? cell.fg.map(Number) : (Array.isArray(cell[1]) ? cell[1].map(Number) : [255, 255, 255]);
  const bg = Array.isArray(cell.bg) ? cell.bg.map(Number) : (Array.isArray(cell[2]) ? cell[2].map(Number) : [0, 0, 0]);
  return { glyph, fg, bg };
}

// Transparent keys see through to whatever is beneath. A flattened single-
// layer preview has nothing beneath, so they flatten to the canvas default
// (black — same as Canvas.clear and the composite empty fallback), never
// literal magenta. Otherwise every blank document previews as a magenta
// sheet even though the keys mean "empty/see-through".
function _browseFlattenTransparentBg(bg) {
  const b = Array.isArray(bg) ? bg : [0, 0, 0];
  const isMag = b[0] === 255 && b[1] === 0 && b[2] === 255;
  const isYel = b[0] === 255 && b[1] === 255 && b[2] === 0;
  return (isMag || isYel) ? [0, 0, 0] : b;
}

function _normalizeBrowsePreview(data) {
  const cols = Math.max(1, Number(data?.grid_cols || data?.gridCols || 0) || 1);
  const rows = Math.max(1, Number(data?.grid_rows || data?.gridRows || 0) || 1);
  let layer = null;
  const layers = Array.isArray(data?.layers) ? data.layers : null;
  if (layers && layers.length) {
    // Prefer the topmost non-empty layer so raw-XP imports preview their art.
    for (let li = layers.length - 1; li >= 0; li--) {
      const flat = Array.isArray(layers[li]) ? layers[li] : [];
      const nonEmpty = flat.some((c) => Number(c?.glyph ?? c?.[0] ?? 0) > 32);
      if (nonEmpty) { layer = flat; break; }
    }
    if (!layer) layer = Array.isArray(layers[0]) ? layers[0] : [];
  } else if (Array.isArray(data?.cells)) {
    layer = data.cells;
  }
  return { cols, rows, cells: Array.isArray(layer) ? layer : [] };
}

// Browse previews share the editor CP437 bitmap font when it is ready. Before
// the editor mounts (or if the font fails), previews fall back to color
// blocks and re-render with glyphs once the font arrives.
let _browseFont = null;
let _browseFontLoading = false;

function _browseGlyphFont() {
  if (editorState.cp437Font && editorState.cp437Font.spriteSheet) return editorState.cp437Font;
  if (_browseFont && _browseFont.spriteSheet) return _browseFont;
  if (!_browseFontLoading) {
    _browseFontLoading = true;
    try {
      const f = new CP437Font(FONT_URL, CELL_SIZE, CELL_SIZE);
      f.load().then(() => { _browseFont = f; _redrawBrowsePreviews(); }).catch(() => {});
    } catch (_e) { /* block fallback stays */ }
  }
  return null;
}

function _redrawBrowsePreviews() {
  try {
    const canvas = document.getElementById('wsBrowsePreview');
    const meta = document.getElementById('wsBrowsePreviewMeta');
    const selected = _selectedBrowseItem();
    if (canvas && selected) {
      const cached = browsePreviewCache.get(String(selected.session_id || ''));
      if (cached) _drawBrowsePreview(canvas, meta, selected, cached);
    }
    for (const item of editorState.browseItems) {
      const sid = String(item.session_id || '');
      const cached = browsePreviewCache.get(sid);
      if (!cached) continue;
      const thumbs = document.querySelectorAll(`canvas[data-browse-thumb-for="${sid}"]`);
      for (const thumb of thumbs) _drawSheetThumb(thumb, cached);
    }
  } catch (_e) { /* redraw best-effort only */ }
}

function _drawBrowsePreviewCell(ctx, preview, x, y, cellPx, font) {
  const cols = Math.max(1, preview.cols | 0);
  const { glyph, fg, bg } = _browsePreviewCell(preview.cells[y * cols + x]);
  const flatBg = _browseFlattenTransparentBg(bg);
  const px = x * cellPx;
  const py = y * cellPx;
  const css = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
  if (font && (glyph & 0xFF) !== 0) {
    // Legible path: real CP437 glyphs in cell fg over cell bg.
    font.drawGlyph(ctx, glyph & 0xFF, px, py, fg, flatBg);
    return;
  }
  if (glyph === 223) {
    ctx.fillStyle = css(fg); ctx.fillRect(px, py, cellPx, Math.ceil(cellPx / 2));
    ctx.fillStyle = css(flatBg); ctx.fillRect(px, py + Math.ceil(cellPx / 2), cellPx, Math.floor(cellPx / 2));
  } else if (glyph === 220) {
    ctx.fillStyle = css(flatBg); ctx.fillRect(px, py, cellPx, Math.ceil(cellPx / 2));
    ctx.fillStyle = css(fg); ctx.fillRect(px, py + Math.ceil(cellPx / 2), cellPx, Math.floor(cellPx / 2));
  } else {
    ctx.fillStyle = css(glyph > 32 ? fg : flatBg); ctx.fillRect(px, py, cellPx, cellPx);
  }
}

// Shared sheet renderer: glyph path draws every cell at the native 12px
// font stride into an offscreen canvas, then scales the whole sheet into
// the target box (smooth downscale, crisp integer-neutral upscale). Block
// path (font not yet loaded) draws directly at whole-cell stride. Either
// way the target keeps the sheet aspect and fits within maxW/maxH.
function _renderSheetToCanvas(canvas, preview, maxW, maxH) {
  const cols = Math.max(1, preview.cols | 0);
  const rows = Math.max(1, preview.rows | 0);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const font = _browseGlyphFont();
  if (font) {
    const off = document.createElement('canvas');
    off.width = cols * CELL_SIZE;
    off.height = rows * CELL_SIZE;
    const octx = off.getContext('2d');
    if (!octx) return;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const { glyph, fg, bg } = _browsePreviewCell(preview.cells[y * cols + x]);
        font.drawGlyph(octx, glyph & 0xFF, x * CELL_SIZE, y * CELL_SIZE, fg, _browseFlattenTransparentBg(bg));
      }
    }
    const s = Math.min(maxW / off.width, maxH / off.height);
    canvas.width = Math.max(1, Math.round(off.width * s));
    canvas.height = Math.max(1, Math.round(off.height * s));
    ctx.imageSmoothingEnabled = s < 1;
    ctx.drawImage(off, 0, 0, off.width, off.height, 0, 0, canvas.width, canvas.height);
    return;
  }
  const cellPx = Math.max(1, Math.floor(Math.min(maxW / cols, maxH / rows)));
  canvas.width = cols * cellPx;
  canvas.height = rows * cellPx;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      _drawBrowsePreviewCell(ctx, preview, x, y, cellPx, null);
    }
  }
}

function _drawBrowsePreview(canvas, meta, item, preview) {
  const cols = Math.max(1, preview.cols | 0);
  const rows = Math.max(1, preview.rows | 0);
  // Useful-size cap: fit within 560x360 backing px (a 126x80 sheet lands at
  // ~560x355 — legible, not postage-stamp).
  _renderSheetToCanvas(canvas, preview, 560, 360);
  if (meta) {
    const kind = item?.session_kind ? ` · ${item.session_kind}` : '';
    meta.textContent = `${_browseDisplayLabel(item)} · ${cols}\u00d7${rows}${kind}`;
  }
}

// Per-row thumbnail: same glyph renderer at a small box (backing sized to
// the sheet aspect, CSS constrains display). Shares browsePreviewCache.
function _drawSheetThumb(canvas, preview) {
  _renderSheetToCanvas(canvas, preview, 144, 96);
}

// In-flight thumbnail fetches, keyed by session id (no duplicate fetches).
// Bounded queue: full-session preview loads are heavy, so at most
// BROWSE_THUMB_CONCURRENCY run at once; the rest wait their turn.
const BROWSE_THUMB_CONCURRENCY = 3;
let _browseThumbActive = 0;
const _browseThumbQueue = [];
const _browseThumbQueued = new Set();

function _ensureBrowseThumb(item) {
  const sid = String(item?.session_id || '');
  if (!sid || browsePreviewCache.has(sid) || _browseThumbQueued.has(sid)) return;
  if (typeof editorState.onBrowsePreview !== 'function') return;
  _browseThumbQueued.add(sid);
  _browseThumbQueue.push(sid);
  void _pumpBrowseThumbs();
}

async function _pumpBrowseThumbs() {
  if (_browseThumbActive >= BROWSE_THUMB_CONCURRENCY) return;
  const sid = _browseThumbQueue.shift();
  if (!sid) return;
  _browseThumbActive++;
  try {
    const data = await editorState.onBrowsePreview(sid);
    browsePreviewCache.set(sid, _normalizeBrowsePreview(data));
    try {
      const thumbs = document.querySelectorAll(`canvas[data-browse-thumb-for="${sid}"]`);
      const cached = browsePreviewCache.get(sid);
      for (const thumb of thumbs) _drawSheetThumb(thumb, cached);
    } catch (_e) { /* draw best-effort only */ }
    if (String(editorState.browseSelectedId || '') === sid) void _previewBrowseSelected();
  } catch (_e) { /* row keeps its empty thumb box; selection retry covers */ }
  finally {
    _browseThumbActive--;
    _browseThumbQueued.delete(sid);
    void _pumpBrowseThumbs();
  }
}

async function _previewBrowseSelected() {
  const canvas = document.getElementById('wsBrowsePreview');
  const meta = document.getElementById('wsBrowsePreviewMeta');
  if (!canvas) return;
  const selected = _selectedBrowseItem();
  if (!selected) {
    if (meta) meta.textContent = editorState.browseItems.length ? 'Select a document to preview its whole sheet.' : 'No documents';
    return;
  }
  const sid = String(selected.session_id || '');
  const cached = browsePreviewCache.get(sid);
  if (cached) { _drawBrowsePreview(canvas, meta, selected, cached); return; }
  if (typeof editorState.onBrowsePreview !== 'function') {
    if (meta) meta.textContent = 'Preview unavailable';
    return;
  }
  // A thumbnail fetch for this row may already be in flight (queued by list
  // render): join it instead of issuing a duplicate full-session load.
  if (_browseThumbQueued.has(sid)) {
    if (meta) meta.textContent = `Loading preview: ${_browseDisplayLabel(selected)}…`;
    const t0 = Date.now();
    while (!browsePreviewCache.has(sid) && Date.now() - t0 < 20000) {
      await new Promise((r) => setTimeout(r, 60));
      if (String(editorState.browseSelectedId || '') !== sid) return;
    }
    const joined = browsePreviewCache.get(sid);
    if (joined && String(editorState.browseSelectedId || '') === sid) {
      _drawBrowsePreview(canvas, meta, selected, joined);
      return;
    }
    // Thumbnail fetch failed or timed out: fall through to a direct fetch.
  }
  if (browsePreviewPendingId === sid) return;
  browsePreviewPendingId = sid;
  if (meta) meta.textContent = `Loading preview: ${_browseDisplayLabel(selected)}…`;
  try {
    const data = await editorState.onBrowsePreview(sid);
    browsePreviewCache.set(sid, _normalizeBrowsePreview(data));
    if (String(editorState.browseSelectedId || '') === sid) {
      _drawBrowsePreview(canvas, meta, selected, browsePreviewCache.get(sid));
    }
  } catch (err) {
    if (String(editorState.browseSelectedId || '') === sid && meta) {
      meta.textContent = `Preview failed: ${String(err)}`;
    }
  } finally {
    if (browsePreviewPendingId === sid) browsePreviewPendingId = '';
  }
}

async function _browseNewRawSelected() {
  if (typeof editorState.onBrowseNewRaw !== 'function') {
    _setBrowseStatus('New raw XP unavailable');
    return;
  }
  try {
    _setBrowseStatus('Creating raw XP…');
    const created = await editorState.onBrowseNewRaw();
    if (created && created.session_id) {
      editorState.currentSessionId = String(created.session_id);
      browsePreviewCache.delete(String(created.session_id));
    }
    await _refreshBrowseItems({ preserveSelection: false });
    _setMode('paint');
  } catch (err) {
    _setBrowseStatus(`New raw XP failed: ${String(err)}`);
  }
}

function _browseGotoSourceSlicing() {
  _setMode('paint');
  window.dispatchEvent(new CustomEvent('browse-goto-source-slicing'));
  const target = document.getElementById('sourceCanvasShell') || document.getElementById('uploadConvertPanel');
  if (target && typeof target.scrollIntoView === 'function') {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function _selectedBrowseItem() {
  return editorState.browseItems.find((item) => String(item.session_id || '') === String(editorState.browseSelectedId || '')) || null;
}

function _setBrowseStatus(text) {
  const el = document.getElementById('wsBrowseStatus');
  if (!el) return;
  el.textContent = String(text || '');
}

function _updateBrowseControls() {
  const selected = _selectedBrowseItem();
  const busy = !!editorState.browseLoading;
  const isCurrent = !!(selected && String(selected.session_id || '') === String(editorState.currentSessionId || ''));
  const bundleOwner = selected && selected.bundle_owner ? selected.bundle_owner : null;

  const openBtn = document.getElementById('wsBrowseOpen');
  const renameBtn = document.getElementById('wsBrowseRename');
  const duplicateBtn = document.getElementById('wsBrowseDuplicate');
  const deleteBtn = document.getElementById('wsBrowseDelete');
  const reloadBtn = document.getElementById('wsBrowseReload');

  if (openBtn) openBtn.disabled = busy || !selected || isCurrent;
  if (renameBtn) renameBtn.disabled = busy || !selected;
  if (duplicateBtn) duplicateBtn.disabled = busy || !selected;
  if (deleteBtn) {
    deleteBtn.disabled = busy || !selected || !!bundleOwner || isCurrent;
    if (bundleOwner) {
      deleteBtn.title = `Delete blocked: bundle ${bundleOwner.bundle_id} owns this session`;
    } else if (isCurrent) {
      deleteBtn.title = 'Open another document before deleting the active document';
    } else {
      deleteBtn.title = 'Delete selected document';
    }
  }
  if (reloadBtn) reloadBtn.disabled = busy;
}

// Unique fallback labels: named documents keep their name; everything else
// renders kind + geometry + short id + saved time so rows never collapse
// into N identical labels (e.g. ten `player 126x80 root_blank` rows).
function _browseShortTime(item) {
  const epoch = Number(item?.updated_at_epoch);
  if (Number.isFinite(epoch) && epoch > 0) {
    const d = new Date(epoch * 1000);
    if (!Number.isNaN(d.getTime())) {
      const pad = (n) => String(n).padStart(2, '0');
      return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
  }
  const iso = String(item?.updated_at || '').trim();
  return iso ? iso.slice(0, 16).replace('T', ' ') : '';
}

function _browseDisplayLabel(item) {
  const named = String(item?.name || '').trim();
  if (named) return String(item?.label || named);
  const kind = String(item?.session_kind || 'doc');
  const sid = String(item?.session_id || '');
  const short = sid ? sid.slice(0, 8) : 'unknown';
  const geom = (item?.grid_cols && item?.grid_rows) ? ` ${item.grid_cols}x${item.grid_rows}` : '';
  const when = _browseShortTime(item);
  return `${kind}${geom} ${short}${when ? ` · ${when}` : ''}`;
}

function _renderBrowseList() {
  const listEl = document.getElementById('wsBrowseList');
  if (!listEl) return;
  listEl.innerHTML = '';

  if (!editorState.browseItems.length) {
    const empty = document.createElement('div');
    empty.className = 'ws-placeholder';
    empty.textContent = editorState.browseLoading ? 'Loading documents...' : 'No documents';
    listEl.appendChild(empty);
    _updateBrowseControls();
    return;
  }

  for (const item of editorState.browseItems) {
    const sid = String(item.session_id || '');
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'ws-browse-item';
    if (sid === String(editorState.browseSelectedId || '')) row.classList.add('ws-browse-item-selected');
    if (sid === String(editorState.currentSessionId || '')) row.classList.add('ws-browse-item-current');

    const thumb = document.createElement('canvas');
    thumb.className = 'ws-browse-thumb';
    thumb.setAttribute('data-browse-thumb-for', sid);
    // Functional-minimum layout (styles owned elsewhere): fixed box, keep
    // sheet aspect, pixelated upscale.
    thumb.style.cssText = 'width:72px;height:48px;flex:none;image-rendering:pixelated;object-fit:contain;background:#000;';
    thumb.width = 72;
    thumb.height = 48;
    const cachedThumb = browsePreviewCache.get(sid);
    if (cachedThumb) {
      _drawSheetThumb(thumb, cachedThumb);
    } else {
      _ensureBrowseThumb(item);
    }

    const textWrap = document.createElement('span');
    textWrap.className = 'ws-browse-item-text';
    textWrap.style.cssText = 'display:flex;flex-direction:column;min-width:0;flex:1;';

    const title = document.createElement('span');
    title.className = 'ws-browse-item-title';
    title.textContent = _browseDisplayLabel(item);

    const details = [];
    if (item.grid_cols && item.grid_rows) details.push(`${item.grid_cols}x${item.grid_rows}`);
    if (item.session_kind) details.push(String(item.session_kind));
    if (item.action_key) details.push(String(item.action_key));
    else if (item.family) details.push(String(item.family));
    if (item.bundle_owner && item.bundle_owner.bundle_id) {
      details.push(`bundle ${item.bundle_owner.bundle_id}:${item.bundle_owner.action_key}`);
    }

    const meta = document.createElement('span');
    meta.className = 'ws-browse-item-meta';
    meta.textContent = details.join(' · ') || sid;

    textWrap.appendChild(title);
    textWrap.appendChild(meta);
    row.appendChild(thumb);
    row.appendChild(textWrap);
    row.addEventListener('click', () => {
      editorState.browseSelectedId = sid;
      _renderBrowseList();
      void _previewBrowseSelected();
    });
    // Single row-open path: double-click delegates to the Open selected
    // button so both share one handler (_browseOpenSelected via click).
    row.addEventListener('dblclick', () => {
      editorState.browseSelectedId = sid;
      const openBtn = document.getElementById('wsBrowseOpen');
      if (openBtn && !openBtn.disabled) openBtn.click();
      else void _browseOpenSelected();
    });
    listEl.appendChild(row);
  }

  _updateBrowseControls();
  void _previewBrowseSelected();
}

async function _refreshBrowseItems({ preserveSelection = true } = {}) {
  if (typeof editorState.onBrowseList !== 'function') {
    editorState.browseItems = [];
    editorState.browseSelectedId = '';
    _setBrowseStatus('Browse list unavailable');
    _renderBrowseList();
    return [];
  }
  editorState.browseLoading = true;
  _setBrowseStatus('Loading documents...');
  _updateBrowseControls();
  try {
    const payload = await editorState.onBrowseList();
    const items = Array.isArray(payload) ? payload : (Array.isArray(payload?.sessions) ? payload.sessions : []);
    editorState.browseItems = items;
    const selectedStillExists = preserveSelection
      && items.some((item) => String(item.session_id || '') === String(editorState.browseSelectedId || ''));
    if (!selectedStillExists) {
      const current = items.find((item) => String(item.session_id || '') === String(editorState.currentSessionId || ''));
      editorState.browseSelectedId = String((current || items[0] || {}).session_id || '');
    }
    _setBrowseStatus(`${items.length} document${items.length === 1 ? '' : 's'}`);
    _renderBrowseList();
    return items;
  } catch (err) {
    editorState.browseItems = [];
    editorState.browseSelectedId = '';
    _setBrowseStatus(`Browse load failed: ${String(err)}`);
    _renderBrowseList();
    return [];
  } finally {
    editorState.browseLoading = false;
    _updateBrowseControls();
  }
}

function mountBrowseApp({ container, currentSessionId, onBrowseList, onBrowseOpen, onBrowseRename, onBrowseDuplicate, onBrowseDelete, onBrowsePreview, onBrowseNewRaw } = {}) {
  if (!container) return false;
  browseAppHostEl = container;
  editorState.currentSessionId = String(currentSessionId || editorState.currentSessionId || '');
  editorState.onBrowseList = onBrowseList || editorState.onBrowseList;
  editorState.onBrowseOpen = onBrowseOpen || editorState.onBrowseOpen;
  editorState.onBrowseRename = onBrowseRename || editorState.onBrowseRename;
  editorState.onBrowseDuplicate = onBrowseDuplicate || editorState.onBrowseDuplicate;
  editorState.onBrowseDelete = onBrowseDelete || editorState.onBrowseDelete;
  editorState.onBrowsePreview = onBrowsePreview || editorState.onBrowsePreview;
  editorState.onBrowseNewRaw = onBrowseNewRaw || editorState.onBrowseNewRaw;

  const existingDrawer = document.getElementById('wsBrowseSection')?.closest('[data-drawer="browse"]');
  const browseDrawer = existingDrawer || _buildBrowseDrawer();
  if (browseDrawer.parentElement !== container) container.replaceChildren(browseDrawer);
  browseDrawer.classList.remove('ws-drawer');
  browseDrawer.removeAttribute('data-drawer');
  _applyModeUI();
  void _refreshBrowseItems({ preserveSelection: false });
  return true;
}

function _moveBrowseSelection(delta) {
  if (!editorState.browseItems.length) return;
  const ids = editorState.browseItems.map((item) => String(item.session_id || ''));
  let idx = ids.indexOf(String(editorState.browseSelectedId || ''));
  if (idx < 0) idx = 0;
  idx = Math.max(0, Math.min(ids.length - 1, idx + delta));
  editorState.browseSelectedId = ids[idx];
  _renderBrowseList();
}

async function _browseOpenSelected() {
  const selected = _selectedBrowseItem();
  if (!selected || typeof editorState.onBrowseOpen !== 'function') return;
  try {
    await editorState.onBrowseOpen(String(selected.session_id || ''));
    editorState.currentSessionId = String(selected.session_id || '');
    // Open leaves Browse: the loaded sheet stays visible in the Edit workspace.
    _setMode('paint');
    _setBrowseStatus(`Editing ${_browseDisplayLabel(selected)}`);
    void _refreshBrowseItems({ preserveSelection: true });
  } catch (err) {
    _setBrowseStatus(`Open failed: ${String(err)}`);
  }
}

async function _browseRenameSelected() {
  const selected = _selectedBrowseItem();
  if (!selected || typeof editorState.onBrowseRename !== 'function') return;
  const seed = String(selected.name || selected.label || '').trim();
  const nextName = window.prompt('Rename document', seed);
  if (nextName === null) return;
  const clean = String(nextName || '').trim();
  if (!clean) return;
  try {
    await editorState.onBrowseRename(String(selected.session_id || ''), clean);
    await _refreshBrowseItems({ preserveSelection: true });
  } catch (err) {
    _setBrowseStatus(`Rename failed: ${String(err)}`);
  }
}

async function _browseDuplicateSelected() {
  const selected = _selectedBrowseItem();
  if (!selected || typeof editorState.onBrowseDuplicate !== 'function') return;
  try {
    const duplicated = await editorState.onBrowseDuplicate(String(selected.session_id || ''));
    await _refreshBrowseItems({ preserveSelection: false });
    if (duplicated && duplicated.session_id) {
      editorState.browseSelectedId = String(duplicated.session_id);
      _renderBrowseList();
    }
  } catch (err) {
    _setBrowseStatus(`Duplicate failed: ${String(err)}`);
  }
}

async function _browseDeleteSelected() {
  const selected = _selectedBrowseItem();
  if (!selected || typeof editorState.onBrowseDelete !== 'function') return;
  if (selected.bundle_owner) return;
  if (String(selected.session_id || '') === String(editorState.currentSessionId || '')) return;
  const ok = window.confirm(`Delete session "${selected.label || selected.session_id}"?`);
  if (!ok) return;
  try {
    await editorState.onBrowseDelete(String(selected.session_id || ''));
    await _refreshBrowseItems({ preserveSelection: false });
  } catch (err) {
    _setBrowseStatus(`Delete failed: ${String(err)}`);
  }
}

function _applyModeUI() {
  const mode = editorState.mode === 'browse' ? 'browse' : 'paint';
  const paintBtn = document.getElementById('wsModePaint');
  const browseBtn = document.getElementById('wsModeBrowse');
  if (paintBtn) paintBtn.classList.toggle('ws-tool-active', mode === 'paint');
  if (browseBtn) browseBtn.classList.toggle('ws-tool-active', mode === 'browse');

  for (const section of document.querySelectorAll('.ws-sidebar-section[data-mode-scope]')) {
    const scope = String(section.dataset.modeScope || '');
    section.style.display = scope === mode ? '' : 'none';
  }

  // Browse is documents + previews: layer chrome stays an Edit concern.
  const browse = mode === 'browse';
  for (const drawer of document.querySelectorAll('.ws-drawer[data-drawer="layers"]')) {
    drawer.style.display = browse ? 'none' : '';
  }
  for (const toggle of document.querySelectorAll('[data-drawer-toggle="layers"]')) {
    toggle.style.display = browse ? 'none' : '';
  }

  const canvasEl = document.getElementById('wholeSheetCanvas');
  const scrollWrap = document.getElementById('wholeSheetScroll');
  if (canvasEl) {
    canvasEl.style.pointerEvents = mode === 'browse' ? 'none' : '';
    canvasEl.style.opacity = mode === 'browse' ? '0.72' : '1';
  }
  if (scrollWrap) {
    scrollWrap.classList.toggle('ws-browse-preview', mode === 'browse');
  }
  if (mode === 'browse') {
    _onCanvasPointerLeave();
  } else {
    _switchTool(editorState.activeTool);
  }
  _updateBrowseControls();
}

function _setMode(mode) {
  const nextMode = String(mode || '').toLowerCase() === 'browse' ? 'browse' : 'paint';
  if (editorState.mode === nextMode) {
    if (nextMode === 'browse') void _refreshBrowseItems({ preserveSelection: true });
    window.dispatchEvent(new CustomEvent('whole-sheet-mode-change', { detail: { mode: nextMode } }));
    return;
  }
  editorState.mode = nextMode;
  _applyModeUI();
  window.dispatchEvent(new CustomEvent('whole-sheet-mode-change', { detail: { mode: nextMode } }));
  if (nextMode === 'browse') {
    // The current document may have been edited: drop its cached preview so
    // reselecting it re-fetches a fresh whole sheet. Other documents cannot
    // change without being opened, so their cached previews stay valid.
    browsePreviewCache.delete(String(editorState.currentSessionId || ''));
    void _refreshBrowseItems({ preserveSelection: true });
  }
}

// ── Toggle button builder ──

function _buildToggle(label, id, initial, onChange) {
  const btn = document.createElement('button');
  btn.id = id;
  btn.textContent = label;
  btn.className = 'ws-toggle' + (initial ? ' ws-toggle-on' : '');
  btn.title = `Toggle ${label}`;
  btn.addEventListener('click', () => {
    const on = !btn.classList.contains('ws-toggle-on');
    const accepted = onChange(on);
    if (accepted === false) return;
    btn.classList.toggle('ws-toggle-on', on);
  });
  return btn;
}

// ── Layer panel ──

function _updateLayersPanelUI() {
  const panel = document.getElementById('wsLayersPanel');
  if (!panel || !editorState.layerStack) return;

  panel.innerHTML = '';
  const layers = editorState.layerStack.layers;
  const activeIdx = editorState.layerStack.activeIndex;

  // Header row: title + Add/Delete buttons
  const header = document.createElement('div');
  header.className = 'ws-layers-header';

  const addBtn = document.createElement('button');
  addBtn.className = 'ws-layer-add-btn';
  addBtn.textContent = '+';
  addBtn.title = 'Add layer';
  addBtn.addEventListener('click', (e) => { e.stopPropagation(); _addLayer(); });

  const delBtn = document.createElement('button');
  delBtn.className = 'ws-layer-del-btn';
  delBtn.textContent = '−';
  delBtn.title = 'Delete active layer';
  delBtn.disabled = layers.length <= 1;
  delBtn.addEventListener('click', (e) => { e.stopPropagation(); _deleteActiveLayer(); });

  header.appendChild(addBtn);
  header.appendChild(delBtn);
  panel.appendChild(header);

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const row = document.createElement('div');
    row.className = 'ws-layer-row';
    if (i === activeIdx) row.classList.add('ws-layer-active');
    if (!layer.visible) row.classList.add('ws-layer-hidden');
    if (layer.locked) row.classList.add('ws-layer-locked');

    const visBtn = document.createElement('button');
    visBtn.className = 'ws-layer-vis-btn' + (layer.visible ? ' ws-layer-visible' : '');
    visBtn.textContent = layer.visible ? 'V' : '-';
    visBtn.title = layer.visible ? 'Hide layer' : 'Show layer';
    visBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      _toggleLayerVisibility(i);
    });

    const lockBtn = document.createElement('button');
    lockBtn.className = 'ws-layer-lock-btn' + (layer.locked ? ' ws-layer-locked-btn' : '');
    lockBtn.textContent = layer.locked ? 'L' : 'U';
    lockBtn.title = layer.locked ? 'Unlock layer' : 'Lock layer';
    lockBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      _toggleLayerLock(i);
    });

    const idxSpan = document.createElement('span');
    idxSpan.className = 'ws-layer-index';
    idxSpan.textContent = String(i);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'ws-layer-name';
    nameSpan.textContent = layer.name || `Layer ${i}`;

    const upBtn = document.createElement('button');
    upBtn.className = 'ws-layer-move-btn';
    upBtn.textContent = '↑';
    upBtn.title = 'Move layer up';
    upBtn.disabled = i === 0;
    upBtn.addEventListener('click', (e) => { e.stopPropagation(); _moveLayerUp(i); });

    const downBtn = document.createElement('button');
    downBtn.className = 'ws-layer-move-btn';
    downBtn.textContent = '↓';
    downBtn.title = 'Move layer down';
    downBtn.disabled = i === layers.length - 1;
    downBtn.addEventListener('click', (e) => { e.stopPropagation(); _moveLayerDown(i); });

    row.appendChild(visBtn);
    row.appendChild(lockBtn);
    row.appendChild(idxSpan);
    row.appendChild(nameSpan);
    row.appendChild(upBtn);
    row.appendChild(downBtn);
    row.addEventListener('click', () => _switchActiveLayer(i));
    panel.appendChild(row);
  }

  // Update status info
  const infoEl = document.getElementById('wsActiveLayerInfo');
  if (infoEl && editorState.layerStack) {
    const layer = editorState.layerStack.layers[activeIdx];
    infoEl.textContent = `${activeIdx}${layer ? ' (' + (layer.name || '') + ')' : ''}`;
  }
  // U6: update mobile status strip on layer change
  if (typeof window._updateMobileStatus === 'function') window._updateMobileStatus();
}

function _switchActiveLayer(index) {
  if (!editorState.layerStack) return;
  if (index < 0 || index >= editorState.layerStack.layers.length) return;

  editorState.layerStack.selectLayer(index);
  _updateLayersPanelUI();
  if (editorState.canvas) {
    editorState.canvas._fullRenderNeeded = true;
    editorState.canvas.render();
  }
  if (editorState.onActiveLayerChanged) editorState.onActiveLayerChanged(index);
  _emitDocumentStateChange('active-layer');
  _scheduleDraftSave();
}

function _toggleLayerVisibility(index) {
  if (!editorState.layerStack) return;
  const layer = editorState.layerStack.layers[index];
  if (!layer) return;

  const newVisible = !layer.visible;
  _beginDocumentTransaction();
  layer.setVisible(newVisible);
  _updateLayersPanelUI();

  if (editorState.canvas) { editorState.canvas._fullRenderNeeded = true; editorState.canvas.render(); }
  _commitLayerMutation();

  if (editorState.onLayerVisibilityChanged) {
    editorState.onLayerVisibilityChanged(index, newVisible);
  }
  _emitDocumentStateChange('layer-visibility');
}

function _toggleLayerLock(index) {
  if (!editorState.layerStack) return;
  const layer = editorState.layerStack.layers[index];
  if (!layer) return;
  _beginDocumentTransaction();
  layer.setLocked(!layer.locked);
  _updateLayersPanelUI();
  _commitLayerMutation();
  _emitDocumentStateChange('layer-lock');
}

function _addLayer() {
  if (!editorState.layerStack) return;
  const newIndex = editorState.layerStack.layers.length;
  _beginDocumentTransaction();
  editorState.layerStack.addLayer(`Layer ${newIndex}`);
  editorState.layerStack.selectLayer(newIndex);
  _updateLayersPanelUI();
  if (editorState.canvas) { editorState.canvas._fullRenderNeeded = true; editorState.canvas.render(); }
  _commitLayerMutation();
  if (editorState.onAddLayer) editorState.onAddLayer(newIndex);
  _emitDocumentStateChange('layer-add');
}

function _deleteActiveLayer() {
  if (!editorState.layerStack) return;
  if (editorState.layerStack.layers.length <= 1) return;
  const deletedIndex = editorState.layerStack.activeIndex;
  _beginDocumentTransaction();
  editorState.layerStack.removeLayer(deletedIndex);
  const newActive = editorState.layerStack.activeIndex;
  _updateLayersPanelUI();
  if (editorState.canvas) { editorState.canvas._fullRenderNeeded = true; editorState.canvas.render(); }
  _commitLayerMutation();
  if (editorState.onDeleteLayer) editorState.onDeleteLayer(deletedIndex, newActive);
  _emitDocumentStateChange('layer-delete');
}

function _moveLayerUp(index) {
  if (!editorState.layerStack) return;
  if (index <= 0) return;
  _beginDocumentTransaction();
  editorState.layerStack.moveLayer(index, index - 1);
  _updateLayersPanelUI();
  if (editorState.canvas) { editorState.canvas._fullRenderNeeded = true; editorState.canvas.render(); }
  _commitLayerMutation();
  if (editorState.onMoveLayer) editorState.onMoveLayer(index, index - 1);
  _emitDocumentStateChange('layer-move');
}

function _moveLayerDown(index) {
  if (!editorState.layerStack) return;
  if (index >= editorState.layerStack.layers.length - 1) return;
  _beginDocumentTransaction();
  editorState.layerStack.moveLayer(index, index + 1);
  _updateLayersPanelUI();
  if (editorState.canvas) { editorState.canvas._fullRenderNeeded = true; editorState.canvas.render(); }
  _commitLayerMutation();
  if (editorState.onMoveLayer) editorState.onMoveLayer(index, index + 1);
  _emitDocumentStateChange('layer-move');
}

function _mergeActiveLayerDown() {
  if (!editorState.layerStack || editorState.layerStack.layers.length <= 1) return false;
  const sourceIndex = editorState.layerStack.activeIndex;
  const targetIndex = sourceIndex + 1;
  if (targetIndex >= editorState.layerStack.layers.length) return false;
  const source = editorState.layerStack.layers[sourceIndex];
  const target = editorState.layerStack.layers[targetIndex];
  if (!source || !target || source.locked || target.locked) return false;

  if (!editorState._strokeDirty) _beginDocumentTransaction();
  for (let y = 0; y < editorState.gridRows; y++) {
    for (let x = 0; x < editorState.gridCols; x++) {
      const srcCell = source.getCell(x, y);
      if (!shouldCopyCellOnLayerMerge(srcCell)) continue;
      const nextCell = cloneEditorCell(srcCell);
      target.setCell(x, y, nextCell.glyph, nextCell.fg, nextCell.bg);
    }
  }
  editorState._strokeDirty = true;
  editorState.layerStack.removeLayer(sourceIndex);
  editorState.layerStack.selectLayer(Math.max(0, Math.min(editorState.layerStack.layers.length - 1, sourceIndex)));
  _updateLayersPanelUI();
  if (editorState.canvas) {
    editorState.canvas._fullRenderNeeded = true;
    editorState.canvas.render();
  }
  _commitLayerMutation();
  _emitDocumentStateChange('layer-merge');
  return true;
}

function _resizeLayerStack(nextCols, nextRows) {
  const layerStack = editorState.layerStack;
  if (!layerStack) return false;
  const oldCols = editorState.gridCols;
  const oldRows = editorState.gridRows;
  if (nextCols === oldCols && nextRows === oldRows) return false;
  for (const layer of layerStack.layers) {
    const nextData = Array.from({ length: nextRows }, (_, y) =>
      Array.from({ length: nextCols }, (_, x) => {
        if (x < oldCols && y < oldRows) return layer.getCell(x, y);
        return { glyph: 0, fg: [255, 255, 255], bg: [0, 0, 0] };
      })
    );
    layer.width = nextCols;
    layer.height = nextRows;
    layer.data = nextData;
  }
  editorState.gridCols = nextCols;
  editorState.gridRows = nextRows;
  if (editorState.canvas && typeof editorState.canvas.resizeGrid === 'function') {
    editorState.canvas.resizeGrid(nextCols, nextRows);
    editorState.canvas.setLayerStack(layerStack);
  }
  const dimsEl = document.getElementById('wsDims');
  if (dimsEl) dimsEl.textContent = `${nextCols}\u00d7${nextRows} · ${layerStack.layers.length}L`;
  const tool = editorState.selectTool;
  if (tool) {
    const bounds = tool.getSelectionBounds();
    if (bounds) {
      const maxX = nextCols - 1;
      const maxY = nextRows - 1;
      if (bounds.x > maxX || bounds.y > maxY) {
        tool.clearSelection();
      } else {
        const endX = Math.min(maxX, bounds.x + bounds.width - 1);
        const endY = Math.min(maxY, bounds.y + bounds.height - 1);
        tool.startSelection(bounds.x, bounds.y);
        tool.updateSelection(endX, endY);
        tool.endSelection();
      }
    }
  }
  return true;
}

async function _promptResizeDocument() {
  const raw = window.prompt('Resize image (cols x rows)', `${editorState.gridCols}x${editorState.gridRows}`);
  if (raw === null) return false;
  const match = String(raw).trim().match(/^(\d+)\s*[x, ]\s*(\d+)$/i);
  if (!match) return false;
  const nextCols = Math.max(1, Number(match[1]));
  const nextRows = Math.max(1, Number(match[2]));
  if (!editorState._strokeDirty) _beginDocumentTransaction();
  const changed = _resizeLayerStack(nextCols, nextRows);
  if (!changed) {
    _cancelDocumentTransaction();
    return false;
  }
  editorState._strokeDirty = true;
  _commitLayerMutation();
  _applyCanvasZoom({ preserveCenter: true });
  _emitDocumentStateChange('resize');
  if (typeof editorState.onResize === 'function') {
    await editorState.onResize(_buildDocumentSnapshot());
  }
  return true;
}

// ── Helpers ──

function _rgbToHex(rgb) {
  return '#' + rgb.map(c => c.toString(16).padStart(2, '0')).join('');
}

function _hexToRgb(hex) {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return [255, 255, 255];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function _colorsEqual(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function _setDrawColor(channel, rgb) {
  if (channel === 'fg') {
    editorState.drawFg = [...rgb];
    const el = document.getElementById('wsFgColor');
    if (el) el.value = _rgbToHex(rgb);
  } else {
    editorState.drawBg = [...rgb];
    const el = document.getElementById('wsBgColor');
    if (el) el.value = _rgbToHex(rgb);
  }
  _forEachTool((t) => _setToolColors(t, editorState.drawFg, editorState.drawBg));
  _renderGlyphPicker();
  _renderPaletteGrid();
  _updateInfoDrawState();
}

// ── Info region updaters ──

function _updateInfoDrawState() {
  const g = editorState.drawGlyph;
  const ch = (g > 31 && g < 127) ? String.fromCharCode(g) : '\u00b7';
  const el = document.getElementById('wsDrawGlyph');
  if (el) el.textContent = g + ' (' + ch + ')';
  const fgEl = document.getElementById('wsDrawFgSwatch');
  if (fgEl) fgEl.style.background = _rgbToHex(editorState.drawFg);
  const bgEl = document.getElementById('wsDrawBgSwatch');
  if (bgEl) bgEl.style.background = _rgbToHex(editorState.drawBg);
}

function _updateInfoApplyModes() {
  const gEl = document.getElementById('wsInfoApplyG');
  if (gEl) gEl.classList.toggle('ws-info-apply-on', editorState.applyGlyph);
  const fEl = document.getElementById('wsInfoApplyF');
  if (fEl) fEl.classList.toggle('ws-info-apply-on', editorState.applyFg);
  const bEl = document.getElementById('wsInfoApplyB');
  if (bEl) bEl.classList.toggle('ws-info-apply-on', editorState.applyBg);
}

function _onCanvasPointerLeave() {
  _cancelTapHold();
  _dismissTapHoldInspect();
  if (editorState.activeTool !== 'text') _onStrokeEnd();
  _hidePasteGhost();
  const posEl = document.getElementById('wsPos');
  if (posEl) posEl.textContent = '-,-';
  // U6: reset mobile cursor position
  const mobilePosEl = document.getElementById('mobileCursorPos');
  if (mobilePosEl) mobilePosEl.textContent = '--';
  const glyphEl = document.getElementById('wsHoverGlyph');
  if (glyphEl) glyphEl.textContent = '--';
  const fgEl = document.getElementById('wsHoverFg');
  if (fgEl) { fgEl.style.background = ''; fgEl.classList.add('ws-info-swatch-empty'); }
  const bgEl = document.getElementById('wsHoverBg');
  if (bgEl) { bgEl.style.background = ''; bgEl.classList.add('ws-info-swatch-empty'); }
}

function _renderPaletteGrid() {
  const canvas = document.getElementById('wsPaletteCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const cs = PALETTE_CELL;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < DEFAULT_PALETTE.length; i++) {
    const col = i % PALETTE_COLS;
    const row = Math.floor(i / PALETTE_COLS);
    const x = col * cs;
    const y = row * cs;
    const [r, g, b] = DEFAULT_PALETTE[i];

    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(x, y, cs, cs);

    // Thin grid lines
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(x, y, cs, cs);

    // Highlight if matches current fg or bg
    const matchFg = editorState.drawFg[0] === r && editorState.drawFg[1] === g && editorState.drawFg[2] === b;
    const matchBg = editorState.drawBg[0] === r && editorState.drawBg[1] === g && editorState.drawBg[2] === b;
    if (matchFg) {
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, cs - 2, cs - 2);
    }
    if (matchBg) {
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 1]);
      ctx.strokeRect(x + 0.5, y + 0.5, cs - 1, cs - 1);
      ctx.setLineDash([]);
    }
  }
}

function _onPaletteClick(e, channel) {
  const canvas = document.getElementById('wsPaletteCanvas');
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const px = (e.clientX - rect.left) * scaleX;
  const py = (e.clientY - rect.top) * scaleY;
  const col = Math.floor(px / PALETTE_CELL);
  const row = Math.floor(py / PALETTE_CELL);
  if (col < 0 || col >= PALETTE_COLS || row < 0 || row >= PALETTE_ROWS) return;
  const idx = row * PALETTE_COLS + col;
  if (idx >= 0 && idx < DEFAULT_PALETTE.length) {
    _setDrawColor(channel, DEFAULT_PALETTE[idx]);
  }
}

// ── U3: Tap-hold inspect for touch devices ──

const TAP_HOLD_DELAY_MS = 500;
const TAP_HOLD_MOVE_THRESHOLD = 5;

function _cancelTapHold() {
  if (editorState._tapHoldTimer) {
    clearTimeout(editorState._tapHoldTimer);
    editorState._tapHoldTimer = null;
  }
}

function _onTapHoldStart(e) {
  // Only start tap-hold on touch input
  if (e.pointerType !== 'touch') return;
  editorState._lastTouchPointerType = 'touch';
  editorState._tapHoldFired = false;
  _cancelTapHold();

  editorState._tapHoldStartX = e.clientX;
  editorState._tapHoldStartY = e.clientY;

  const canvasEl = e.currentTarget;
  editorState._tapHoldTimer = setTimeout(() => {
    editorState._tapHoldTimer = null;
    editorState._tapHoldFired = true;
    // pointerdown already painted the held cell; revert it before reading so
    // the inspector shows the original content, not the fresh paint.
    _revertActiveStroke();
    _showTapHoldInspect(canvasEl, e.clientX, e.clientY);
  }, TAP_HOLD_DELAY_MS);
}

function _onTapHoldEnd() {
  _cancelTapHold();
}

function _onTapHoldMove(e) {
  if (!editorState._tapHoldTimer) return;
  const dx = Math.abs(e.clientX - editorState._tapHoldStartX);
  const dy = Math.abs(e.clientY - editorState._tapHoldStartY);
  if (dx > TAP_HOLD_MOVE_THRESHOLD || dy > TAP_HOLD_MOVE_THRESHOLD) {
    _cancelTapHold();
  }
}

function _showTapHoldInspect(canvasEl, clientX, clientY) {
  const rect = canvasEl.getBoundingClientRect();
  const scaleX = canvasEl.width / rect.width;
  const scaleY = canvasEl.height / rect.height;
  const px = (clientX - rect.left) * scaleX;
  const py = (clientY - rect.top) * scaleY;
  const cx = Math.floor(px / CELL_SIZE);
  const cy = Math.floor(py / CELL_SIZE);

  const { canvas, layerStack, gridCols, gridRows } = editorState;
  if (!canvas || cx < 0 || cx >= gridCols || cy < 0 || cy >= gridRows) return;

  let cell = null;
  if (layerStack) {
    const activeLayer = layerStack.getActiveLayer();
    if (activeLayer) cell = activeLayer.getCell(cx, cy);
  }
  if (!cell) {
    try { cell = canvas.getCell(cx, cy); } catch (_) {}
  }
  if (!cell) return;

  const popup = document.getElementById('wsTouchInspectPopup');
  if (!popup) return;

  const ch = (cell.glyph > 31 && cell.glyph < 127) ? String.fromCharCode(cell.glyph) : '\u00b7';
  const glyphEl = document.getElementById('wsTouchInspectGlyph');
  if (glyphEl) glyphEl.textContent = cell.glyph + ' (' + ch + ')';

  const fg = cell.fg || [255, 255, 255];
  const bg = cell.bg || [0, 0, 0];
  const fgEl = document.getElementById('wsTouchInspectFg');
  if (fgEl) {
    fgEl.style.background = _rgbToHex(fg);
    fgEl.classList.remove('ws-info-swatch-empty');
  }
  const bgEl = document.getElementById('wsTouchInspectBg');
  if (bgEl) {
    bgEl.style.background = _rgbToHex(bg);
    bgEl.classList.remove('ws-info-swatch-empty');
  }
  const posEl = document.getElementById('wsTouchInspectPos');
  if (posEl) posEl.textContent = cx + ',' + cy;

  // Position popup above the tap point, flip if near top edge
  const popupW = 160;
  const popupH = 100;
  let left = clientX - popupW / 2;
  let top = clientY - popupH - 16;
  if (top < 8) top = clientY + 24;
  if (left < 8) left = 8;
  if (left + popupW > window.innerWidth - 8) left = window.innerWidth - popupW - 8;

  popup.style.left = left + 'px';
  popup.style.top = top + 'px';
  popup.classList.add('visible');

  // Auto-dismiss after 3 seconds
  if (editorState._tapHoldInspectDismiss) clearTimeout(editorState._tapHoldInspectDismiss);
  editorState._tapHoldInspectDismiss = setTimeout(() => {
    popup.classList.remove('visible');
    editorState._tapHoldInspectDismiss = null;
  }, 3000);
}

function _dismissTapHoldInspect() {
  const popup = document.getElementById('wsTouchInspectPopup');
  if (popup) popup.classList.remove('visible');
  if (editorState._tapHoldInspectDismiss) {
    clearTimeout(editorState._tapHoldInspectDismiss);
    editorState._tapHoldInspectDismiss = null;
  }
}

function _onCanvasPointerMove(e) {
  // U3: check tap-hold movement threshold
  _onTapHoldMove(e);
  // Suppress hover/pan tracking during two-pointer gesture
  if (editorState._gestureActive) return;
  const scrollWrap = document.getElementById('wholeSheetScroll');
  if (editorState.spacePan.armed && (e.buttons & 1) && scrollWrap) {
    if (!editorState.spacePan.dragging || editorState.spacePan.pointerId !== e.pointerId) {
      editorState.spacePan.dragging = true;
      editorState.spacePan.pointerId = e.pointerId;
      editorState.spacePan.startX = e.clientX;
      editorState.spacePan.startY = e.clientY;
      editorState.spacePan.scrollLeft = scrollWrap.scrollLeft;
      editorState.spacePan.scrollTop = scrollWrap.scrollTop;
    }
    scrollWrap.scrollLeft = editorState.spacePan.scrollLeft - (e.clientX - editorState.spacePan.startX);
    scrollWrap.scrollTop = editorState.spacePan.scrollTop - (e.clientY - editorState.spacePan.startY);
    return;
  }
  const canvasEl = e.currentTarget;
  const rect = canvasEl.getBoundingClientRect();
  const scaleX = canvasEl.width / rect.width;
  const scaleY = canvasEl.height / rect.height;
  const px = (e.clientX - rect.left) * scaleX;
  const py = (e.clientY - rect.top) * scaleY;
  const cx = Math.floor(px / CELL_SIZE);
  const cy = Math.floor(py / CELL_SIZE);

  const posEl = document.getElementById('wsPos');
  if (posEl) posEl.textContent = cx + ',' + cy;
  // U6: update mobile cursor position
  const mobilePosEl = document.getElementById('mobileCursorPos');
  if (mobilePosEl) mobilePosEl.textContent = cx + ',' + cy;
  // B6: paste ghost preview tracks cursor while paste mode is armed.
  if (editorState.pasteMode) _updatePasteGhost(cx, cy);

  const { canvas, layerStack, gridCols, gridRows } = editorState;
  if (canvas && cx >= 0 && cx < gridCols && cy >= 0 && cy < gridRows) {
    let cell = null;
    if (layerStack) {
      const activeLayer = layerStack.getActiveLayer();
      if (activeLayer) cell = activeLayer.getCell(cx, cy);
    }
    if (!cell) {
      try { cell = canvas.getCell(cx, cy); } catch (_) {}
    }
    if (cell) {
      const ch = (cell.glyph > 31 && cell.glyph < 127) ? String.fromCharCode(cell.glyph) : '\u00b7';
      const glyphEl = document.getElementById('wsHoverGlyph');
      if (glyphEl) glyphEl.textContent = cell.glyph + ' (' + ch + ')';
      const fg = cell.fg || [255, 255, 255];
      const bg = cell.bg || [0, 0, 0];
      const fgEl = document.getElementById('wsHoverFg');
      if (fgEl) { fgEl.style.background = _rgbToHex(fg); fgEl.classList.remove('ws-info-swatch-empty'); }
      const bgEl = document.getElementById('wsHoverBg');
      if (bgEl) { bgEl.style.background = _rgbToHex(bg); bgEl.classList.remove('ws-info-swatch-empty'); }
    }
  }
}

function _onCanvasWheel(e) {
  if (!editorState.mounted) return;
  // Modifier-gated by policy to avoid repeating the plain-scroll layer drift
  // regression logged in the failure log's 2026-04-26 headed UX findings.
  if (!shouldCycleActiveLayerOnWheel(e)) return;
  if (!editorState.layerStack || !editorState.layerStack.layers.length) return;
  e.preventDefault();
  const delta = e.deltaY > 0 ? 1 : -1;
  const nextIndex = Math.max(0, Math.min(editorState.layerStack.layers.length - 1, editorState.layerStack.activeIndex + delta));
  _switchActiveLayer(nextIndex);
}

// ── unmount ──

function unmount() {
  document.removeEventListener('keydown', _onKeyDown);
  document.removeEventListener('keyup', _onKeyUp);
  _disconnectViewportResizeObserver();

  _commitTextEdit();
  _cancelPasteMode();
  _cancelTapHold();
  _dismissTapHoldInspect();
  if (_draftSaveTimer !== null) { clearTimeout(_draftSaveTimer); _draftSaveTimer = null; }
  if (editorState.canvas) {
    const canvasEl = editorState.canvas.canvasElement;
    if (canvasEl) {
      detachGestures(canvasEl);
      canvasEl.removeEventListener('pointerdown', _onTapHoldStart);
      canvasEl.removeEventListener('pointerup', _onTapHoldEnd);
      canvasEl.removeEventListener('pointercancel', _onTapHoldEnd);
      canvasEl.removeEventListener('pointermove', _onCanvasPointerMove);
      canvasEl.removeEventListener('pointerleave', _onCanvasPointerLeave);
      canvasEl.removeEventListener('pointerup', _onStrokeEnd);
      canvasEl.removeEventListener('pointercancel', _onStrokeEnd);
      canvasEl.removeEventListener('wheel', _onCanvasWheel);
      if (editorState._pasteInterceptor) {
        canvasEl.removeEventListener('pointerdown', editorState._pasteInterceptor, true);
      }
    }
    if (typeof editorState.canvas.dispose === 'function') editorState.canvas.dispose();
  }
  if (editorState.containerEl) editorState.containerEl.innerHTML = '';

  editorState = {
    mounted: false,
    canvas: null,
    layerStack: null,
    cp437Font: null,
    cellTool: null,
    slopeStrokeTool: null,
    adaptiveStrokeTool: null,
    eyedropperTool: null,
    eraseTool: null,
    lineTool: null,
    ovalTool: null,
    rectTool: null,
    fillTool: null,
    textTool: null,
    selectTool: null,
    mode: 'browse',
    activeTool: 'cell',
    gridCols: 0,
    gridRows: 0,
    containerEl: null,
    currentSessionId: '',
    drawGlyph: editorState.drawGlyph,
    drawFg: editorState.drawFg,
    drawBg: editorState.drawBg,
    applyGlyph: editorState.applyGlyph,
    applyFg: editorState.applyFg,
    applyBg: editorState.applyBg,
    onCellEdited: null,
    onStrokeComplete: null,
    onActiveLayerChanged: null,
    onLayerVisibilityChanged: null,
    onAddLayer: null,
    onDeleteLayer: null,
    onMoveLayer: null,
    onSave: null,
    onExport: null,
    onResize: null,
    onBrowseList: null,
    onBrowseOpen: null,
    onBrowseRename: null,
    onBrowseDuplicate: null,
    onBrowseDelete: null,
    onBrowsePreview: null,
    onBrowseNewRaw: null,
    onDocumentStateChange: null,
    onHistoryStateChange: null,
    _strokeDirty: false,
    _pendingHistorySnapshot: null,
    history: [],
    future: [],
    clipboard: null,
    pasteMode: false,
    browseItems: [],
    browseSelectedId: '',
    browseLoading: false,
    browseError: '',
    canvasZoom: editorState.canvasZoom,
    appliedCanvasZoom: 1,
    gridVisible: false,
    gridStep: 'frame',
    viewportResizeObserver: null,
    layerNames: [],
    lastSampledCell: null,
    textEdit: null,
    spacePan: {
      armed: false,
      dragging: false,
      pointerId: null,
      startX: 0,
      startY: 0,
      scrollLeft: 0,
      scrollTop: 0,
    },
    _gestureActive: false,
    _pasteInterceptor: null,
  };
}

// ── Public API ──

function panToFrame(row, col, frameWChars, frameHChars) {
  if (!editorState.mounted) return;
  const scrollWrap = document.getElementById('wholeSheetScroll');
  if (!scrollWrap) return;
  const zoom = Math.max(0.05, Number(editorState.appliedCanvasZoom || _resolvedCanvasZoom() || 1));

  const targetX = col * frameWChars * CELL_SIZE * zoom;
  const targetY = row * frameHChars * CELL_SIZE * zoom;
  const framePixelW = frameWChars * CELL_SIZE * zoom;
  const framePixelH = frameHChars * CELL_SIZE * zoom;

  const viewW = scrollWrap.clientWidth;
  const viewH = scrollWrap.clientHeight;
  const scrollX = Math.max(0, targetX - (viewW - framePixelW) / 2);
  const scrollY = Math.max(0, targetY - (viewH - framePixelH) / 2);

  scrollWrap.scrollTo({ left: scrollX, top: scrollY, behavior: 'smooth' });
}

function syncFromState(layers) {
  if (!editorState.mounted || !editorState.layerStack || !editorState.canvas) return;
  if (!Array.isArray(layers)) return;

  const { gridCols, gridRows, layerStack } = editorState;
  const count = Math.min(layers.length, layerStack.layers.length);

  for (let li = 0; li < count; li++) {
    const flatCells = layers[li];
    const stackLayer = layerStack.layers[li];
    if (!Array.isArray(flatCells)) continue;
    for (let i = 0; i < flatCells.length; i++) {
      const cell = flatCells[i];
      if (!cell) continue;
      const x = i % gridCols;
      const y = Math.floor(i / gridCols);
      if (x >= gridCols || y >= gridRows) continue;
      const glyph = Number(cell.glyph || 0);
      const fg = Array.isArray(cell.fg) ? cell.fg.map(Number) : [255, 255, 255];
      const bg = Array.isArray(cell.bg) ? cell.bg.map(Number) : [0, 0, 0];
      stackLayer.setCell(x, y, glyph & 0xFF, fg, bg);
    }
  }

  editorState.canvas._fullRenderNeeded = true;
  editorState.canvas.render();
  _clearHistory();
}

function getState() {
  const hist = _historyState();
  const resolvedGrid = _resolveGridStepConfig();
  return {
    mounted: editorState.mounted,
    gridCols: editorState.gridCols,
    gridRows: editorState.gridRows,
    layerCount: editorState.layerStack ? editorState.layerStack.layers.length : 0,
    mode: editorState.mode,
    activeLayerIndex: editorState.layerStack ? editorState.layerStack.activeIndex : 0,
    hasFontLoaded: !!(editorState.cp437Font && editorState.cp437Font.spriteSheet),
    activeTool: editorState.activeTool,
    selectionBounds: editorState.selectTool ? editorState.selectTool.getSelectionBounds() : null,
    hasClipboard: countClipboardCells(editorState.clipboard) > 0,
    clipboardCellCount: countClipboardCells(editorState.clipboard),
    pasteMode: editorState.pasteMode,
    browseItemCount: editorState.browseItems.length,
    browseSelectedId: editorState.browseSelectedId,
    drawGlyph: editorState.drawGlyph,
    drawFg: editorState.drawFg,
    drawBg: editorState.drawBg,
    canvasZoom: editorState.canvasZoom,
    appliedCanvasZoom: editorState.appliedCanvasZoom,
    sessionKind: editorState.sessionKind,
    metadataStatus: editorState.metadataStatus,
    gridVisible: editorState.gridVisible,
    gridStep: editorState.gridStep,
    gridCustomW: editorState.gridCustomW,
    gridCustomH: editorState.gridCustomH,
    resolvedGridW: resolvedGrid.width,
    resolvedGridH: resolvedGrid.height,
    canUndo: hist.canUndo,
    canRedo: hist.canRedo,
    historyDepth: hist.historyDepth,
    futureDepth: hist.futureDepth,
  };
}

function setDrawState({ glyph, fg, bg, applyGlyph, applyFg, applyBg }) {
  if (typeof glyph === 'number') {
    editorState.drawGlyph = glyph & 0xFF;
    _forEachTool((t) => _setToolGlyph(t, editorState.drawGlyph));
    const el = document.getElementById('wsGlyphCode');
    if (el) el.value = String(editorState.drawGlyph);
    const ch = document.getElementById('wsGlyphChar');
    if (ch) ch.value = (glyph > 31 && glyph < 127) ? String.fromCharCode(glyph) : '';
  }
  if (Array.isArray(fg) && fg.length === 3) {
    editorState.drawFg = fg.map(Number);
    _forEachTool((t) => _setToolColors(t, editorState.drawFg, editorState.drawBg));
    const el = document.getElementById('wsFgColor');
    if (el) el.value = _rgbToHex(editorState.drawFg);
  }
  if (Array.isArray(bg) && bg.length === 3) {
    editorState.drawBg = bg.map(Number);
    _forEachTool((t) => _setToolColors(t, editorState.drawFg, editorState.drawBg));
    const el = document.getElementById('wsBgColor');
    if (el) el.value = _rgbToHex(editorState.drawBg);
  }
  if (typeof applyGlyph === 'boolean') {
    editorState.applyGlyph = applyGlyph;
    _forEachTool((t) => _setToolApplyModes(t, { glyph: applyGlyph }));
    const el = document.getElementById('wsApplyGlyph');
    if (el) el.classList.toggle('ws-toggle-on', applyGlyph);
  }
  if (typeof applyFg === 'boolean') {
    editorState.applyFg = applyFg;
    _forEachTool((t) => _setToolApplyModes(t, { foreground: applyFg }));
    const el = document.getElementById('wsApplyFg');
    if (el) el.classList.toggle('ws-toggle-on', applyFg);
  }
  if (typeof applyBg === 'boolean') {
    editorState.applyBg = applyBg;
    _forEachTool((t) => _setToolApplyModes(t, { background: applyBg }));
    const el = document.getElementById('wsApplyBg');
    if (el) el.classList.toggle('ws-toggle-on', applyBg);
  }
  _renderGlyphPicker();
  _renderPaletteGrid();
  _updateInfoDrawState();
  _updateInfoApplyModes();
}

function setActiveLayer(index) {
  _switchActiveLayer(index);
}

function setLayerVisibility(index, visible) {
  if (!editorState.layerStack) return;
  const layer = editorState.layerStack.layers[index];
  if (!layer) return;
  if (layer.visible === visible) return;
  _toggleLayerVisibility(index);
}

function getLayerInfo() {
  if (!editorState.layerStack) return [];
  return editorState.layerStack.layers.map((layer, i) => ({
    index: i,
    name: layer.name,
    active: i === editorState.layerStack.activeIndex,
    visible: layer.visible,
    locked: layer.locked,
  }));
}

function addLayer() {
  _addLayer();
}

function deleteLayer() {
  _deleteActiveLayer();
}

function moveLayer(fromIndex, toIndex) {
  if (!editorState.layerStack) return;
  if (toIndex === fromIndex - 1) { _moveLayerUp(fromIndex); return; }
  if (toIndex === fromIndex + 1) { _moveLayerDown(fromIndex); return; }
}

function getDocumentSnapshot() {
  return _buildDocumentSnapshot();
}

function replaceDocumentSnapshot(snapshot, reason = 'document-replace', opts = {}) {
  if (!editorState.mounted || !editorState.canvas || !snapshot) return false;
  if (editorState._strokeDirty) _commitLayerMutation();
  if (opts.recordHistory !== false) {
    editorState.history.push(_buildDocumentSnapshot());
    if (editorState.history.length > HISTORY_LIMIT) editorState.history.shift();
    editorState.future = [];
    editorState._pendingHistorySnapshot = null;
    _updateHistoryButtons();
  }
  const applied = _applyDocumentSnapshot(snapshot);
  if (applied) _emitDocumentStateChange(String(reason || 'document-replace'));
  return applied;
}

function undo() {
  if (!editorState.mounted || editorState.history.length === 0) return false;
  if (editorState._strokeDirty) _commitLayerMutation();
  const current = _buildDocumentSnapshot();
  const previous = editorState.history.pop();
  editorState.future.push(current);
  const applied = _applyDocumentSnapshot(previous);
  _updateHistoryButtons();
  if (applied) _emitDocumentStateChange('undo');
  return applied;
}

function redo() {
  if (!editorState.mounted || editorState.future.length === 0) return false;
  if (editorState._strokeDirty) _commitLayerMutation();
  const current = _buildDocumentSnapshot();
  const next = editorState.future.pop();
  editorState.history.push(current);
  if (editorState.history.length > HISTORY_LIMIT) editorState.history.shift();
  const applied = _applyDocumentSnapshot(next);
  _updateHistoryButtons();
  if (applied) _emitDocumentStateChange('redo');
  return applied;
}

// ── Window export ──

window.__wholeSheetEditor = {
  mount,
  mountBrowseApp,
  unmount,
  setMode: _setMode,
  panToFrame,
  syncFromState,
  getState,
  getDocumentSnapshot,
  replaceDocumentSnapshot,
  undo,
  redo,
  setDrawState,
  setActiveLayer,
  setLayerVisibility,
  getLayerInfo,
  addLayer,
  deleteLayer,
  moveLayer,
  copySelection: _copySelection,
  cutSelection: _cutSelection,
  pasteClipboard: _enterPasteMode,
  deleteSelection: _deleteSelection,
  setTool: _switchTool,
  openMobileKeyboard,
};
window.dispatchEvent(new Event('whole-sheet-editor-ready'));
