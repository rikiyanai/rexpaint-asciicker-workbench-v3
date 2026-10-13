/**
 * Canvas Module - Handles CP437 cell rendering on HTML5 Canvas
 */

const _colorCache = new Map();
const _fallbackBaseAtlasCache = new Map();
const _fallbackTintedAtlasCache = new Map();

function _rgb(r, g, b) {
  const key = (r << 16) | (g << 8) | b;
  if (!_colorCache.has(key)) {
    _colorCache.set(key, `rgb(${r},${g},${b})`);
  }
  return _colorCache.get(key);
}

function _createAtlasCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document !== 'undefined' && document.createElement) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  if (typeof HTMLCanvasElement !== 'undefined') {
    const canvas = new HTMLCanvasElement();
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new Error('No canvas implementation available to build fallback glyph atlas.');
}

function _getFallbackBaseAtlas(cellSizePixels) {
  if (_fallbackBaseAtlasCache.has(cellSizePixels)) {
    return _fallbackBaseAtlasCache.get(cellSizePixels);
  }

  const atlas = _createAtlasCanvas(cellSizePixels * 16, cellSizePixels * 16);
  const ctx = atlas.getContext('2d');
  if (!ctx || typeof ctx.fillText !== 'function') {
    return null;
  }

  ctx.fillStyle = 'rgb(255,255,255)';
  ctx.font = `${cellSizePixels}px monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  for (let code = 0; code < 256; code++) {
    const sx = (code % 16) * cellSizePixels;
    const sy = Math.floor(code / 16) * cellSizePixels;
    ctx.fillText(String.fromCharCode(code), sx, sy, cellSizePixels);
  }

  _fallbackBaseAtlasCache.set(cellSizePixels, atlas);
  return atlas;
}

function _getFallbackTintedAtlas(cellSizePixels, fg) {
  const fr = Math.max(0, Math.min(255, Math.round(fg[0]) || 0));
  const fGreen = Math.max(0, Math.min(255, Math.round(fg[1]) || 0));
  const fb = Math.max(0, Math.min(255, Math.round(fg[2]) || 0));
  const colorKey = (fr << 16) | (fGreen << 8) | fb;
  const cacheKey = `${cellSizePixels}:${colorKey}`;
  if (_fallbackTintedAtlasCache.has(cacheKey)) {
    return _fallbackTintedAtlasCache.get(cacheKey);
  }

  const baseAtlas = _getFallbackBaseAtlas(cellSizePixels);
  if (!baseAtlas) {
    return null;
  }

  const tintedAtlas = _createAtlasCanvas(baseAtlas.width, baseAtlas.height);
  const tintedCtx = tintedAtlas.getContext('2d');
  if (!tintedCtx) {
    return null;
  }

  tintedCtx.drawImage(baseAtlas, 0, 0);
  tintedCtx.globalCompositeOperation = 'source-in';
  tintedCtx.fillStyle = _rgb(fr, fGreen, fb);
  tintedCtx.fillRect(0, 0, tintedAtlas.width, tintedAtlas.height);
  tintedCtx.globalCompositeOperation = 'source-over';

  _fallbackTintedAtlasCache.set(cacheKey, tintedAtlas);
  return tintedAtlas;
}

export class Canvas {
  /**
   * Create a new Canvas instance
   * @param {HTMLCanvasElement} canvasElement - The canvas DOM element
   * @param {number} gridWidth - Width in cells (columns)
   * @param {number} gridHeight - Height in cells (rows)
   * @param {number} cellSizePixels - Size of each cell in pixels (default 12)
   */
  constructor(canvasElement, gridWidth, gridHeight, cellSizePixels = 12) {
    this.canvasElement = canvasElement;
    this.width = gridWidth;
    this.height = gridHeight;
    this.cellSizePixels = cellSizePixels;

    // Set canvas dimensions
    this.canvasElement.width = gridWidth * cellSizePixels;
    this.canvasElement.height = gridHeight * cellSizePixels;

    // Get 2D rendering context
    this.ctx = this.canvasElement.getContext('2d');
    if (!this.ctx) {
      throw new Error('Failed to get 2D canvas context');
    }

    // Cell data storage: key is "x,y", value is {glyph, fg, bg}
    this.cells = new Map();

    // CP437 font renderer (optional, fallback to monospace if not set)
    this.cp437Font = null;

    // Active tool reference
    this.activeTool = null;

    // EditorApp reference for pan mode delegation
    this.editorApp = null;

    // Store bound event handlers for cleanup
    this._boundHandlers = null;

    // Pan/offset state
    this.offsetX = 0;
    this.offsetY = 0;

    // Grid visibility state
    this.showGrid = false;
    this.gridStepX = 1;
    this.gridStepY = 1;

    // Selection visualization state
    this.selectionTool = null;
    this._animationFrame = 0; // For marching ants animation
    this._animationFrameId = null; // For requestAnimationFrame cancellation
    this._selectionDirty = false;
    this._lastSelectionBounds = null;

    // Dirty cell tracking for incremental rendering
    this._dirtyCells = new Set();
    this._fullRenderNeeded = true;
    this._activeOperation = null;
    this._applyingOperation = false;

    // Initialize with default cells (transparent, white on black)
    this._initializeCells();

    // Bind mouse event handlers
    this._bindMouseEventHandlers();

    // Layer composition support
    this.layerStack = null;
    this.useLayerStack = false;
  }

  /**
   * Set the active tool for this canvas
   * @param {Object} tool - The tool instance to activate
   */
  toolActivated(tool) {
    this.activeTool = tool;
    if (tool) {
      tool.setCanvas(this);
    }
  }

  /**
   * Backwards-compatible alias expected by EditorApp.
   * @param {Object} tool
   */
  setActiveTool(tool) {
    this.toolActivated(tool);
  }

  /**
   * Set the LayerStack for multi-layer composition rendering
   * @param {LayerStack} layerStack - The LayerStack instance to render from
   */
  setLayerStack(layerStack) {
    this.layerStack = layerStack;
    this.useLayerStack = true;
    if (this.layerStack && typeof this.layerStack.ensureOffscreenCanvases === 'function') {
      this.layerStack.ensureOffscreenCanvases(this.cellSizePixels);
    }
    this._fullRenderNeeded = true;
    this.render();
  }

  /**
   * Bind mouse event handlers to the canvas element
   * @private
   */
  _bindMouseEventHandlers() {
    if (!this.canvasElement.addEventListener) {
      // Skip event binding in test environments
      return;
    }

    const usePointerEvents = typeof PointerEvent !== 'undefined';

    // Store bound handlers for cleanup
    this._boundHandlers = usePointerEvents
      ? {
          pointerdown: (event) => this._onPointerDown(event),
          pointermove: (event) => this._onPointerMove(event),
          pointerup: (event) => this._onPointerUp(event),
          pointerleave: (event) => this._onPointerLeave(event),
          pointercancel: (event) => this._onPointerLeave(event),
        }
      : {
          mousedown: (event) => this._onMouseDown(event),
          mousemove: (event) => this._onMouseMove(event),
          mouseup: (event) => this._onMouseUp(event),
          mouseleave: (event) => this._onMouseLeave(event),
        };

    for (const [eventName, handler] of Object.entries(this._boundHandlers)) {
      this.canvasElement.addEventListener(eventName, handler);
    }
    if (this.canvasElement.style) this.canvasElement.style.touchAction = 'none';
  }

  /**
   * Convert a mouse event's CSS coordinates to canvas backing-store pixels.
   * Accounts for CSS scaling (display size != backing store size).
   * @private
   */
  _eventToBackingPixels(event) {
    const rect = this.canvasElement.getBoundingClientRect();
    const scaleX = this.canvasElement.width / rect.width;
    const scaleY = this.canvasElement.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  }

  /**
   * Handle mousedown event
   * Includes error handling to prevent unhandled exceptions from disrupting user interaction
   * @private
   */
  _onMouseDown(event) {
    try {
      // Check for pan mode
      if (this.editorApp && this.editorApp.panMode) {
        const bp = this._eventToBackingPixels(event);
        this.editorApp.startPan(bp.x, bp.y);
        return;
      }

      if (!this.activeTool) {
        return;
      }

      const bp = this._eventToBackingPixels(event);
      const coords = this.pixelToCellCoords(bp.x, bp.y);

      // Check bounds
      if (coords.x < 0 || coords.x >= this.width || coords.y < 0 || coords.y >= this.height) {
        return;
      }

      // Notify tool of drag start
      if (this.editorApp && typeof this.editorApp.startDrag === 'function') {
        this.editorApp.startDrag(coords.x, coords.y);
        this.render();
        return;
      }

      if (this.activeTool.startDrag) {
        this.activeTool.startDrag(coords.x, coords.y);
        this.render();
      }
    } catch (error) {
      console.error('Error in mousedown handler:', error);
      throw error; // Re-throw for test verification
    }
  }

  _onPointerDown(event) {
    // Suppress drawing while a two-pointer gesture (pinch/pan) is active
    if (this._gestureActive) return;
    return this._onMouseDown(event);
  }

  /**
   * Handle mousemove event
   * Includes error handling to prevent unhandled exceptions from disrupting user interaction
   * @private
   */
  _onMouseMove(event) {
    try {
      // Check for pan mode
      if (this.editorApp && this.editorApp.panMode) {
        if (event.buttons === 0) {
          return;
        }
        const bp = this._eventToBackingPixels(event);
        this.editorApp.pan(bp.x, bp.y);
        return;
      }

      if (!this.activeTool || !this.activeTool.drag) {
        return;
      }

      // Check if mouse button is pressed
      if (event.buttons === 0) {
        return;
      }

      const bp = this._eventToBackingPixels(event);
      const coords = this.pixelToCellCoords(bp.x, bp.y);

      // Check bounds
      if (coords.x < 0 || coords.x >= this.width || coords.y < 0 || coords.y >= this.height) {
        return;
      }

      // Notify tool of drag continuation
      if (this.editorApp && typeof this.editorApp.drag === 'function') {
        this.editorApp.drag(coords.x, coords.y);
      } else {
        this.activeTool.drag(coords.x, coords.y);
      }
      this.render();
    } catch (error) {
      console.error('Error in mousemove handler:', error);
      throw error; // Re-throw for test verification
    }
  }

  _onPointerMove(event) {
    if (this._gestureActive) return;
    return this._onMouseMove(event);
  }

  /**
   * Handle mouseup event
   * @private
   */
  _onMouseUp(event) {
    // End pan operation if active
    if (this.editorApp && this.editorApp.panMode) {
      this.editorApp.endPan();
      return;
    }

    if (!this.activeTool || !this.activeTool.endDrag) {
      return;
    }

    if (this.editorApp && typeof this.editorApp.endDrag === 'function') {
      this.editorApp.endDrag();
    } else {
      this.activeTool.endDrag();
    }
    this.render();
  }

  _onPointerUp(event) {
    if (this._gestureActive) return;
    return this._onMouseUp(event);
  }

  /**
   * Handle mouseleave event
   * @private
   */
  _onMouseLeave(event) {
    if (!this.activeTool || !this.activeTool.endDrag) {
      return;
    }

    // Cancel drag if mouse leaves canvas
    if (this.editorApp && typeof this.editorApp.endDrag === 'function') {
      this.editorApp.endDrag();
    } else {
      this.activeTool.endDrag();
    }
    this.render();
  }

  _onPointerLeave(event) {
    return this._onMouseLeave(event);
  }

  /**
   * Initialize all cells with default values
   * @private
   */
  _initializeCells() {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const key = `${x},${y}`;
        this.cells.set(key, {
          glyph: 0,
          fg: [255, 255, 255], // white
          bg: [0, 0, 0],       // black
        });
      }
    }
  }

  _cloneCellData(cell) {
    return {
      glyph: cell.glyph,
      fg: [...cell.fg],
      bg: [...cell.bg],
    };
  }

  _getLayerCellSnapshot(layerIndex, x, y) {
    if (layerIndex == null || !this.layerStack || !this.layerStack.layers[layerIndex]) {
      const key = `${x},${y}`;
      const stored = this.cells.get(key) || {
        glyph: 0,
        fg: [255, 255, 255],
        bg: [0, 0, 0],
      };
      return this._cloneCellData(stored);
    }
    const stored = this.layerStack.layers[layerIndex].data[y][x];
    return this._cloneCellData(stored);
  }

  _recordOperationCell(layerIndex, x, y, beforeCell, afterCell) {
    if (!this._activeOperation || this._applyingOperation) {
      return;
    }

    const key = `${layerIndex == null ? 'root' : layerIndex}:${x},${y}`;
    const existing = this._activeOperation.changes.get(key);
    if (existing) {
      existing.after = this._cloneCellData(afterCell);
      return;
    }

    this._activeOperation.changes.set(key, {
      layerIndex,
      x,
      y,
      before: this._cloneCellData(beforeCell),
      after: this._cloneCellData(afterCell),
    });
  }

  beginOperation(label = 'edit') {
    if (this._activeOperation) {
      return;
    }
    this._activeOperation = {
      label,
      changes: new Map(),
    };
  }

  endOperation() {
    if (!this._activeOperation) {
      return null;
    }

    const operation = this._activeOperation;
    this._activeOperation = null;
    const entries = Array.from(operation.changes.values());
    if (entries.length === 0) {
      return null;
    }

    return {
      label: operation.label,
      undo: () => this._applyOperationEntries(entries, 'before'),
      redo: () => this._applyOperationEntries(entries, 'after'),
    };
  }

  _applyOperationEntries(entries, stateKey) {
    this._applyingOperation = true;
    try {
      for (const entry of entries) {
        this._setCellState(entry.layerIndex, entry.x, entry.y, entry[stateKey]);
      }
    } finally {
      this._applyingOperation = false;
    }
  }

  _setCellState(layerIndex, x, y, cell) {
    const nextCell = this._cloneCellData(cell);
    if (layerIndex == null || !this.layerStack || !this.layerStack.layers[layerIndex]) {
      this.cells.set(`${x},${y}`, nextCell);
    } else {
      this.layerStack.layers[layerIndex].data[y][x] = nextCell;
    }
    this._dirtyCells.add(y * this.width + x);
  }

  /**
   * Set a single cell's glyph and colors
   * @param {number} x - Column coordinate
   * @param {number} y - Row coordinate
   * @param {number} glyph - CP437 glyph code (0-255)
   * @param {Array<number>} fg - Foreground color [R, G, B]
   * @param {Array<number>} bg - Background color [R, G, B]
   * @throws {Error} If coordinates, glyph, or colors are invalid
   */
  setCell(x, y, glyph, fg, bg) {
    this._validateCoordinates(x, y);
    this._validateGlyph(glyph);
    this._validateColor(fg, 'foreground');
    this._validateColor(bg, 'background');
    const layerIndex = this.useLayerStack && this.layerStack ? this.layerStack.activeIndex : null;
    const previousCell = this._getLayerCellSnapshot(layerIndex, x, y);
    const nextCell = {
      glyph: glyph & 0xFF,
      fg: [...fg],
      bg: [...bg],
    };

    // If using LayerStack, apply to active layer
    if (this.useLayerStack && this.layerStack) {
      const activeLayer = this.layerStack.getActiveLayer();
      activeLayer.setCell(x, y, nextCell.glyph, nextCell.fg, nextCell.bg);
      this._dirtyCells.add(y * this.width + x);
      this._recordOperationCell(layerIndex, x, y, previousCell, nextCell);
      return;
    }

    // Use original behavior when not using LayerStack
    const key = `${x},${y}`;
    this.cells.set(key, nextCell);
    this._dirtyCells.add(y * this.width + x);
    this._recordOperationCell(layerIndex, x, y, previousCell, nextCell);
  }

  /**
   * Get a single cell's data
   * @param {number} x - Column coordinate
   * @param {number} y - Row coordinate
   * @returns {Object} Cell data {glyph, fg, bg} - Returns defensive copy to prevent mutation
   */
  getCell(x, y) {
    this._validateCoordinates(x, y);

    // If using LayerStack, composite from visible layers
    if (this.useLayerStack && this.layerStack) {
      const layers = this.layerStack.getLayers();
      // Iterate from top to bottom (end to start)
      for (let i = layers.length - 1; i >= 0; i--) {
        const layer = layers[i];
        // Skip hidden layers
        if (!layer.visible) {
          continue;
        }
        // Get cell from this layer
        const cell = layer.getCell(x, y);
        if (!cell) continue;
        // A cell is "truly empty" only when glyph=0 AND bg is BLACK.
        // glyph=0 with bg=MAG = explicit transparent paint (af1e799 erase semantics) — must surface.
        // glyph=0 with any non-black bg = bg-only paint — must surface.
        const isTrulyEmpty = cell.glyph === 0
          && cell.bg[0] === 0 && cell.bg[1] === 0 && cell.bg[2] === 0;
        if (isTrulyEmpty) continue;
        return {
          glyph: cell.glyph,
          fg: [...cell.fg],
          bg: [...cell.bg],
        };
      }
      // No visible layer had content — canvas default is BLACK. Explicit
      // transparency (bg=MAG) is per-cell on the active layer, not a global
      // render fallback (codex review 2026-06-03).
      return {
        glyph: 0,
        fg: [255, 255, 255],
        bg: [0, 0, 0],
      };
    }

    // Use original behavior when not using LayerStack
    const key = `${x},${y}`;
    const stored = this.cells.get(key) || {
      glyph: 0,
      fg: [255, 255, 255],
      bg: [0, 0, 0],
    };

    // Return deep copy to prevent caller from mutating internal state
    return {
      glyph: stored.glyph,
      fg: [...stored.fg],  // Copy array to prevent mutation
      bg: [...stored.bg],  // Copy array to prevent mutation
    };
  }

  /**
   * Convert cell coordinates to pixel coordinates
   * @param {number} cellX - Cell column
   * @param {number} cellY - Cell row
   * @returns {Object} {x, y} pixel coordinates
   */
  cellToPixelCoords(cellX, cellY) {
    return {
      x: cellX * this.cellSizePixels,
      y: cellY * this.cellSizePixels,
    };
  }

  /**
   * Convert pixel coordinates to cell coordinates
   * @param {number} pixelX - Pixel X coordinate
   * @param {number} pixelY - Pixel Y coordinate
   * @returns {Object} {x, y} cell coordinates
   */
  pixelToCellCoords(pixelX, pixelY) {
    return {
      x: Math.floor(pixelX / this.cellSizePixels),
      y: Math.floor(pixelY / this.cellSizePixels),
    };
  }

  /**
   * Clear the entire canvas with black background
   */
  clear() {
    this.ctx.fillStyle = 'rgb(0, 0, 0)';
    this.ctx.fillRect(0, 0, this.canvasElement.width, this.canvasElement.height);
  }

  /**
   * Set the CP437 font renderer
   * @param {CP437Font} cp437Font - The CP437Font instance to use for rendering
   * @returns {Promise<void>}
   */
  async setFont(cp437Font) {
    this.cp437Font = cp437Font;
    if (cp437Font) {
      await cp437Font.load();
    }
    if (this.layerStack && typeof this.layerStack.ensureOffscreenCanvases === 'function') {
      this.layerStack.ensureOffscreenCanvases(this.cellSizePixels);
    }
  }

  /**
   * Draw a single cell with its glyph and colors
   * @param {number} x - Cell column
   * @param {number} y - Cell row
   * @private
   */
  drawCell(x, y) {
    const cell = this.getCell(x, y);
    this._drawCellToContext(this.ctx, cell, x, y);
  }

  _cloneBounds(bounds) {
    return bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null;
  }

  _mergeBounds(a, b) {
    if (!a) return this._cloneBounds(b);
    if (!b) return this._cloneBounds(a);
    const minX = Math.min(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxX = Math.max(a.x + a.width - 1, b.x + b.width - 1);
    const maxY = Math.max(a.y + a.height - 1, b.y + b.height - 1);
    return {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    };
  }

  _expandBounds(bounds, padding = 1) {
    if (!bounds) {
      return null;
    }
    const x = Math.max(0, bounds.x - padding);
    const y = Math.max(0, bounds.y - padding);
    const maxX = Math.min(this.width - 1, bounds.x + bounds.width - 1 + padding);
    const maxY = Math.min(this.height - 1, bounds.y + bounds.height - 1 + padding);
    return {
      x,
      y,
      width: maxX - x + 1,
      height: maxY - y + 1,
    };
  }

  _drawCellToContext(ctx, cell, x, y) {
    const pixelCoords = this.cellToPixelCoords(x, y);

    const bgColor = _rgb(cell.bg[0], cell.bg[1], cell.bg[2]);
    ctx.fillStyle = bgColor;
    ctx.fillRect(
      pixelCoords.x,
      pixelCoords.y,
      this.cellSizePixels,
      this.cellSizePixels
    );

    if (cell.glyph === 0) {
      return;
    }

    // Use CP437 font renderer if available and loaded
    if (this.cp437Font && this.cp437Font.spriteSheet) {
      try {
        this.cp437Font.drawGlyph(
          ctx,
          cell.glyph,
          pixelCoords.x,
          pixelCoords.y,
          cell.fg
        );
        return;
      } catch (e) {
        // Fallback to monospace text if glyph rendering fails
        console.warn(`Failed to render glyph ${cell.glyph}: ${e.message}`);
      }
    }

    // Fallback: render from a prebuilt monospace atlas when drawImage is available.
    if (typeof ctx.drawImage === 'function') {
      const tintedAtlas = _getFallbackTintedAtlas(this.cellSizePixels, cell.fg);
      if (tintedAtlas) {
        const srcX = (cell.glyph % 16) * this.cellSizePixels;
        const srcY = Math.floor(cell.glyph / 16) * this.cellSizePixels;
        ctx.drawImage(
          tintedAtlas,
          srcX,
          srcY,
          this.cellSizePixels,
          this.cellSizePixels,
          pixelCoords.x,
          pixelCoords.y,
          this.cellSizePixels,
          this.cellSizePixels
        );
        return;
      }
    }

    // Last resort: render with monospace text if no atlas path is available.
    ctx.fillStyle = _rgb(cell.fg[0], cell.fg[1], cell.fg[2]);
    ctx.font = `${this.cellSizePixels}px monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    try {
      const char = String.fromCharCode(cell.glyph);
      ctx.fillText(char, pixelCoords.x, pixelCoords.y, this.cellSizePixels);
    } catch (e) {
      // Silently skip glyphs that can't be rendered
    }
  }

  _syncLayerOffscreens() {
    if (!this.layerStack) {
      return false;
    }

    let changed = false;
    const layers = this.layerStack.getLayers();
    for (const layer of layers) {
      layer.ensureOffscreen(this.cellSizePixels);
      if (!layer.offscreenCtx) {
        continue;
      }

      if (layer.offscreenDirtyAll) {
        layer.offscreenCtx.clearRect(0, 0, layer.offscreenCanvas.width, layer.offscreenCanvas.height);
        for (let y = 0; y < layer.height; y++) {
          for (let x = 0; x < layer.width; x++) {
            this._drawCellToContext(layer.offscreenCtx, layer.data[y][x], x, y);
          }
        }
        layer.offscreenDirtyAll = false;
        layer.offscreenDirtyCells.clear();
        changed = true;
        continue;
      }

      if (layer.offscreenDirtyCells.size === 0) {
        continue;
      }

      for (const key of layer.offscreenDirtyCells) {
        const x = key % this.width;
        const y = (key / this.width) | 0;
        const pixelX = x * this.cellSizePixels;
        const pixelY = y * this.cellSizePixels;
        layer.offscreenCtx.clearRect(pixelX, pixelY, this.cellSizePixels, this.cellSizePixels);
        this._drawCellToContext(layer.offscreenCtx, layer.data[y][x], x, y);
      }
      layer.offscreenDirtyCells.clear();
      changed = true;
    }

    return changed;
  }

  _compositeLayerStack() {
    this.clear();
    const layers = this.layerStack.getLayers();
    for (const layer of layers) {
      if (!layer.visible || !layer.offscreenCanvas) {
        continue;
      }
      const priorAlpha = this.ctx.globalAlpha;
      this.ctx.globalAlpha = layer.opacity;
      this.ctx.drawImage(layer.offscreenCanvas, 0, 0);
      this.ctx.globalAlpha = priorAlpha;
    }
  }

  _redrawSelectionRegion(bounds = null) {
    const currentBounds = bounds || (this.selectionTool ? this.selectionTool.getSelectionBounds() : null);
    if (!currentBounds) {
      this._lastSelectionBounds = null;
      return;
    }

    const regionBounds = this._expandBounds(
      this._selectionDirty ? this._mergeBounds(currentBounds, this._lastSelectionBounds) : currentBounds,
      1
    );
    if (!regionBounds) {
      return;
    }

    const pixelX = regionBounds.x * this.cellSizePixels;
    const pixelY = regionBounds.y * this.cellSizePixels;
    const pixelWidth = regionBounds.width * this.cellSizePixels;
    const pixelHeight = regionBounds.height * this.cellSizePixels;

    if (this.useLayerStack && this.layerStack) {
      this.ctx.clearRect(pixelX, pixelY, pixelWidth, pixelHeight);
      const layers = this.layerStack.getLayers();
      for (const layer of layers) {
        if (!layer.visible || !layer.offscreenCanvas) {
          continue;
        }
        const priorAlpha = this.ctx.globalAlpha;
        this.ctx.globalAlpha = layer.opacity;
        this.ctx.drawImage(
          layer.offscreenCanvas,
          pixelX,
          pixelY,
          pixelWidth,
          pixelHeight,
          pixelX,
          pixelY,
          pixelWidth,
          pixelHeight
        );
        this.ctx.globalAlpha = priorAlpha;
      }
    } else {
      for (let y = regionBounds.y; y < regionBounds.y + regionBounds.height; y++) {
        for (let x = regionBounds.x; x < regionBounds.x + regionBounds.width; x++) {
          this.drawCell(x, y);
        }
      }
    }

    if (this.showGrid) {
      this._drawGrid(regionBounds);
    }
    this._drawSelectionOutline(currentBounds);
    this._lastSelectionBounds = this._cloneBounds(currentBounds);
  }

  _scheduleSelectionAnimation(selectionBounds) {
    if (selectionBounds) {
      if (!this._animationFrameId) {
        this._animationFrameId = requestAnimationFrame(() => this._runSelectionAnimationFrame());
      }
      return;
    }
    if (this._animationFrameId) {
      cancelAnimationFrame(this._animationFrameId);
      this._animationFrameId = null;
    }
  }

  _runSelectionAnimationFrame() {
    this._animationFrameId = null;
    const selectionBounds = this.selectionTool && this.selectionTool.getSelectionBounds();
    if (!selectionBounds) {
      this._lastSelectionBounds = null;
      return;
    }

    this._animationFrame++;
    this._redrawSelectionRegion(selectionBounds);
    this._selectionDirty = false;
    this._animationFrameId = requestAnimationFrame(() => this._runSelectionAnimationFrame());
  }

  /**
   * Fill a rectangular region with uniform cell data
   * @param {number} x - Starting column
   * @param {number} y - Starting row
   * @param {number} w - Width in cells
   * @param {number} h - Height in cells
   * @param {number} glyph - CP437 glyph code
   * @param {Array<number>} fg - Foreground color [R, G, B]
   * @param {Array<number>} bg - Background color [R, G, B]
   */
  fillRect(x, y, w, h, glyph, fg, bg) {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const cellX = x + dx;
        const cellY = y + dy;
        if (cellX >= 0 && cellX < this.width && cellY >= 0 && cellY < this.height) {
          this.setCell(cellX, cellY, glyph, fg, bg);
        }
      }
    }
  }

  /**
   * Set canvas offset for pan/drag operations
   * Clamps offset to prevent over-panning
   * @param {number} x - X offset in pixels
   * @param {number} y - Y offset in pixels
   */
  setOffset(x, y) {
    // Calculate maximum allowed offsets
    const maxOffsetX = this.width * this.cellSizePixels - this.canvasElement.width;
    const maxOffsetY = this.height * this.cellSizePixels - this.canvasElement.height;

    // Clamp offset to valid range [0, maxOffset]
    this.offsetX = Math.max(0, Math.min(x, maxOffsetX));
    this.offsetY = Math.max(0, Math.min(y, maxOffsetY));

    // Re-render with new offset
    this._fullRenderNeeded = true;
    this._selectionDirty = true;
    this.render();
  }

  /**
   * Render cells to the canvas.
   * Uses incremental rendering when only a few cells changed;
   * falls back to full render when needed (layer switch, visibility toggle, etc).
   */
  render() {
    const selectionBounds = this.selectionTool && this.selectionTool.getSelectionBounds();
    if (selectionBounds) {
      const last = this._lastSelectionBounds;
      if (
        !last ||
        last.x !== selectionBounds.x ||
        last.y !== selectionBounds.y ||
        last.width !== selectionBounds.width ||
        last.height !== selectionBounds.height
      ) {
        this._selectionDirty = true;
      }
    }
    const needsFull = this._fullRenderNeeded || this.showGrid;

    if (this.useLayerStack && this.layerStack) {
      const offscreenChanged = this._syncLayerOffscreens();
      const needsComposite = needsFull || offscreenChanged;
      if (!needsComposite) {
        if (selectionBounds) {
          this._redrawSelectionRegion(selectionBounds);
          this._selectionDirty = false;
          this._scheduleSelectionAnimation(selectionBounds);
        }
        return;
      }

      this._dirtyCells.clear();
      this._fullRenderNeeded = false;
      this._compositeLayerStack();
      if (this.showGrid) {
        this._drawGrid();
      }
      if (selectionBounds) {
        this._drawSelectionOutline(selectionBounds);
        this._lastSelectionBounds = this._cloneBounds(selectionBounds);
      }
      this._selectionDirty = false;
      this._scheduleSelectionAnimation(selectionBounds);
      return;
    }

    // Nothing to do: no dirty cells and no reason for a full pass.
    // Without this guard, mouseup triggers a gratuitous clear+redraw
    // that visually shifts painted content (Issue #8).
    if (!needsFull && this._dirtyCells.size === 0) {
      return;
    }

    if (!needsFull && this._dirtyCells.size > 0 && this._dirtyCells.size < 500) {
      // Incremental: only redraw changed cells
      for (const key of this._dirtyCells) {
        const x = key % this.width;
        const y = (key / this.width) | 0;
        this.drawCell(x, y);
      }
      this._dirtyCells.clear();
      if (selectionBounds) {
        this._selectionDirty = true;
        this._redrawSelectionRegion(selectionBounds);
        this._selectionDirty = false;
      }
      this._scheduleSelectionAnimation(selectionBounds);
      return;
    }

    // Full render
    this._dirtyCells.clear();
    this._fullRenderNeeded = false;
    this.clear();
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.drawCell(x, y);
      }
    }
    if (this.showGrid) {
      this._drawGrid();
    }

    // Draw selection outline last (on top of all cells)
    if (selectionBounds) {
      this._drawSelectionOutline(selectionBounds);
      this._lastSelectionBounds = this._cloneBounds(selectionBounds);
    }
    this._selectionDirty = false;
    this._scheduleSelectionAnimation(selectionBounds);
  }

  /**
   * Force a full render on the next render() call
   */
  invalidateAll() {
    this._fullRenderNeeded = true;
  }

  /**
   * Set grid visibility state and re-render
   * @param {boolean} visible - Whether to show the grid
   */
  setGridVisible(visible) {
    this.showGrid = visible;
    this._fullRenderNeeded = true;
    this.render();
  }

  /**
   * Set the SelectTool instance for selection visualization
   * @param {SelectTool} tool - The SelectTool instance
   */
  setSelectionTool(tool) {
    this.selectionTool = tool;
    this._selectionDirty = true;
    this.render();
  }

  /**
   * Draw selection outline (marching ants) if selection is active
   * @private
   */
  _drawSelectionOutline(bounds = null) {
    const selectionBounds = bounds || (this.selectionTool && this.selectionTool.getSelectionBounds());
    if (!selectionBounds) {
      return; // No active selection
    }

    // Convert cell bounds to pixel coordinates
    const pixelX = selectionBounds.x * this.cellSizePixels - this.offsetX;
    const pixelY = selectionBounds.y * this.cellSizePixels - this.offsetY;
    const pixelWidth = selectionBounds.width * this.cellSizePixels;
    const pixelHeight = selectionBounds.height * this.cellSizePixels;

    // Draw marching ants outline (dashed line with animation)
    this.ctx.strokeStyle = '#FFFF00'; // Bright yellow
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([4, 4]); // 4px dash, 4px gap

    // Animate dash offset for marching effect
    const dashOffset = (this._animationFrame % 8) * 0.5;
    this.ctx.lineDashOffset = -dashOffset;

    // Draw the rectangle outline
    this.ctx.strokeRect(pixelX, pixelY, pixelWidth, pixelHeight);

    // Reset line dash
    this.ctx.setLineDash([]);
    this.ctx.lineDashOffset = 0;
  }

  /**
   * Draw cross-mark grid overlay at cell intersections
   * @private
   */
  _drawGrid(regionBounds = null) {
    const sx = this.gridStepX || 1;
    const sy = this.gridStepY || 1;
    const cs = this.cellSizePixels;
    const armLen = Math.max(2, Math.floor(cs * 0.3));

    // Viewport culling: determine visible pixel region
    let vpX = this.offsetX;
    let vpY = this.offsetY;
    let vpW = this.canvasElement.width;
    let vpH = this.canvasElement.height;
    const par = this.canvasElement.parentElement;
    if (par && (par.scrollWidth > par.clientWidth || par.scrollHeight > par.clientHeight)) {
      const rect = this.canvasElement.getBoundingClientRect();
      const scaleX = rect.width > 0 ? (rect.width / this.canvasElement.width) : 1;
      const scaleY = rect.height > 0 ? (rect.height / this.canvasElement.height) : 1;
      vpX = par.scrollLeft / Math.max(scaleX, 0.0001);
      vpY = par.scrollTop / Math.max(scaleY, 0.0001);
      vpW = par.clientWidth / Math.max(scaleX, 0.0001);
      vpH = par.clientHeight / Math.max(scaleY, 0.0001);
    }

    // Visible cell range with 1-cell safety margin
    const margin = cs + armLen;
    let startX = Math.floor((vpX - margin) / cs);
    startX = Math.max(sx, Math.ceil(startX / sx) * sx);
    let endX = Math.ceil((vpX + vpW + margin) / cs);
    endX = Math.min(this.width, endX);
    let startY = Math.floor((vpY - margin) / cs);
    startY = Math.max(sy, Math.ceil(startY / sy) * sy);
    let endY = Math.ceil((vpY + vpH + margin) / cs);
    endY = Math.min(this.height, endY);

    if (regionBounds) {
      startX = Math.max(startX, regionBounds.x);
      endX = Math.min(endX, regionBounds.x + regionBounds.width);
      startY = Math.max(startY, regionBounds.y);
      endY = Math.min(endY, regionBounds.y + regionBounds.height);
    }

    this.ctx.strokeStyle = 'rgba(48,72,96,0.92)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    for (let x = startX; x < endX; x += sx) {
      for (let y = startY; y < endY; y += sy) {
        const px = x * cs - this.offsetX;
        const py = y * cs - this.offsetY;
        this.ctx.moveTo(px, py - armLen);
        this.ctx.lineTo(px, py + armLen);
        this.ctx.moveTo(px - armLen, py);
        this.ctx.lineTo(px + armLen, py);
      }
    }
    this.ctx.stroke();
  }

  /**
   * Set grid step (spacing in cells between cross marks)
   * @param {number} stepX - Horizontal step in cells
   * @param {number} [stepY] - Vertical step in cells (defaults to stepX)
   */
  setGridStep(stepX, stepY) {
    this.gridStepX = Math.max(1, Math.floor(stepX)) || 1;
    this.gridStepY = Math.max(1, Math.floor(stepY != null ? stepY : stepX)) || 1;
    this._fullRenderNeeded = true;
    this.render();
  }

  /**
   * Get the canvas element
   * @returns {HTMLCanvasElement} The canvas DOM element
   */
  getCanvasElement() {
    return this.canvasElement;
  }

  /**
   * Get image data from the canvas
   * @returns {ImageData} The canvas image data
   */
  getImageData() {
    return this.ctx.getImageData(
      0,
      0,
      this.canvasElement.width,
      this.canvasElement.height
    );
  }

  /**
   * Validate that coordinates are within bounds and are integers
   * @param {number} x - Column coordinate
   * @param {number} y - Row coordinate
   * @throws {Error} If coordinates are invalid (not integers or out of bounds)
   * @private
   */
  _validateCoordinates(x, y) {
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      throw new Error(
        `Invalid coordinates: x=${x}, y=${y} (must be integers)`
      );
    }
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      throw new Error(
        `Coordinates (${x}, ${y}) out of bounds (valid: 0-${this.width - 1}, 0-${this.height - 1})`
      );
    }
  }

  /**
   * Validate a glyph value
   * @param {number} glyph - Glyph code to validate
   * @throws {Error} If glyph is invalid
   * @private
   */
  _validateGlyph(glyph) {
    if (!Number.isInteger(glyph)) {
      throw new Error(`Invalid glyph: ${glyph} (must be an integer)`);
    }
    if (glyph < 0 || glyph > 255) {
      throw new Error(`Invalid glyph: ${glyph} (must be 0-255)`);
    }
  }

  /**
   * Validate a color value
   * @param {Array<number>} color - Color as [R, G, B]
   * @param {string} colorType - Name of color (for error messages)
   * @throws {Error} If color is invalid
   * @private
   */
  _validateColor(color, colorType = 'color') {
    if (!Array.isArray(color)) {
      throw new Error(`Invalid ${colorType}: ${JSON.stringify(color)} (must be an array)`);
    }
    if (color.length !== 3) {
      throw new Error(
        `Invalid ${colorType}: length=${color.length} (must have exactly 3 elements [R, G, B])`
      );
    }
    for (let i = 0; i < 3; i++) {
      const component = color[i];
      if (!Number.isInteger(component)) {
        throw new Error(
          `Invalid ${colorType}[${i}]: ${component} (must be an integer)`
        );
      }
      if (component < 0 || component > 255) {
        throw new Error(
          `Invalid ${colorType}[${i}]: ${component} (must be 0-255)`
        );
      }
    }
  }

  /**
   * Change font/cell size and re-render
   * Valid sizes: 8, 10, 12, 16 (matching CP437 bitmap fonts)
   * @param {number} pixelsPerCell - Size of each cell in pixels
   */
  setFontSize(pixelsPerCell) {
    if (![8, 10, 12, 16].includes(pixelsPerCell)) {
      throw new Error('Font size must be 8, 10, 12, or 16 pixels');
    }

    this.cellSizePixels = pixelsPerCell;

    // Update canvas physical size
    this.canvasElement.width = this.width * pixelsPerCell;
    this.canvasElement.height = this.height * pixelsPerCell;
    if (this.layerStack && typeof this.layerStack.ensureOffscreenCanvases === 'function') {
      this.layerStack.ensureOffscreenCanvases(pixelsPerCell);
    }

    // Re-render with new size
    this._fullRenderNeeded = true;
    this.render();
  }

  resizeGrid(gridWidth, gridHeight) {
    const nextWidth = Math.max(1, Number(gridWidth) || 1);
    const nextHeight = Math.max(1, Number(gridHeight) || 1);
    if (nextWidth === this.width && nextHeight === this.height) return;

    const oldCells = this.cells;
    this.width = nextWidth;
    this.height = nextHeight;
    this.canvasElement.width = this.width * this.cellSizePixels;
    this.canvasElement.height = this.height * this.cellSizePixels;
    this.cells = new Map();
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const key = `${x},${y}`;
        const prior = oldCells.get(key);
        this.cells.set(key, prior ? {
          glyph: prior.glyph,
          fg: [...prior.fg],
          bg: [...prior.bg],
        } : {
          glyph: 0,
          fg: [255, 255, 255],
          bg: [0, 0, 0],
        });
      }
    }
    this._dirtyCells.clear();
    this._fullRenderNeeded = true;
  }

  /**
   * Get current font size in pixels per cell
   * @returns {number} Current font size (8, 10, 12, or 16)
   */
  getFontSize() {
    return this.cellSizePixels;
  }

  /**
   * Dispose: removes all event listeners and cleans up resources
   * Call this when the canvas is no longer needed (e.g., modal closes)
   */
  dispose() {
    // Cancel any pending animation frame
    if (this._animationFrameId) {
      cancelAnimationFrame(this._animationFrameId);
      this._animationFrameId = null;
    }

    if (!this.canvasElement.removeEventListener || !this._boundHandlers) {
      return;
    }

    for (const [eventName, handler] of Object.entries(this._boundHandlers)) {
      this.canvasElement.removeEventListener(eventName, handler);
    }

    // Clear references
    this._boundHandlers = null;
    this.activeTool = null;
  }
}
