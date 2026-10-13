const DEFAULT_FG = [255, 255, 255];
const DEFAULT_BG = [0, 0, 0];

function _normalizeColor(color, fallback) {
  if (!Array.isArray(color) || color.length < 3) return [...fallback];
  return [
    Math.max(0, Math.min(255, Number(color[0]) || 0)),
    Math.max(0, Math.min(255, Number(color[1]) || 0)),
    Math.max(0, Math.min(255, Number(color[2]) || 0)),
  ];
}

export function cloneCell(cell) {
  return {
    glyph: Math.max(0, Math.min(255, Number(cell?.glyph) || 0)),
    fg: _normalizeColor(cell?.fg, DEFAULT_FG),
    bg: _normalizeColor(cell?.bg, DEFAULT_BG),
  };
}

export function countClipboardCells(clipboard) {
  if (!clipboard || !Array.isArray(clipboard.layers)) return 0;
  return clipboard.layers.reduce((sum, entry) => {
    return sum + (Array.isArray(entry?.cells) ? entry.cells.length : 0);
  }, 0);
}

export function getVisibleLayerIndices(layerStack) {
  if (!layerStack || !Array.isArray(layerStack.layers)) return [];
  const out = [];
  for (let i = 0; i < layerStack.layers.length; i++) {
    const layer = layerStack.layers[i];
    if (layer && layer.visible) out.push(i);
  }
  return out;
}

export function getVisibleUnlockedLayerIndices(layerStack) {
  const visible = getVisibleLayerIndices(layerStack);
  if (visible.length === 0) return [];
  for (const index of visible) {
    const layer = layerStack?.layers?.[index];
    if (!layer || layer.locked) return null;
  }
  return visible;
}

export function getActiveWritableLayerIndex(layerStack) {
  const index = Number(layerStack?.activeIndex);
  if (!Number.isInteger(index) || index < 0) return null;
  const layer = layerStack?.layers?.[index];
  if (!layer || layer.locked) return null;
  if (layer.visible === false) return null;
  return index;
}

export function captureVisibleSelectionClipboard(layerStack, bounds) {
  if (!layerStack || !bounds) return null;
  const width = Math.max(0, Number(bounds.width) || 0);
  const height = Math.max(0, Number(bounds.height) || 0);
  if (!width || !height) return null;

  const visibleIndices = getVisibleLayerIndices(layerStack);
  if (visibleIndices.length === 0) return null;

  const layers = visibleIndices.map((layerIndex) => {
    const layer = layerStack.layers[layerIndex];
    const cells = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        cells.push(cloneCell(layer.getCell(bounds.x + x, bounds.y + y)));
      }
    }
    return { layerIndex, cells };
  });

  return {
    bounds: { x: bounds.x, y: bounds.y, w: width, h: height },
    layers,
  };
}

export function resolveWritableClipboardLayers(layerStack, clipboard) {
  if (!layerStack || !clipboard || !Array.isArray(clipboard.layers) || clipboard.layers.length === 0) {
    return null;
  }
  // Silently skip locked or out-of-range layers. Locked layers shouldn't block paste
  // on unlocked layers — that turned into a silent no-op for users in FL-2026-06-03.
  const out = [];
  for (const entry of clipboard.layers) {
    const layerIndex = Number(entry?.layerIndex);
    if (!Number.isInteger(layerIndex) || layerIndex < 0 || layerIndex >= layerStack.layers.length) continue;
    const layer = layerStack.layers[layerIndex];
    if (!layer || layer.locked) continue;
    out.push({ layerIndex, layer, cells: Array.isArray(entry.cells) ? entry.cells : [] });
  }
  return out.length > 0 ? out : null;
}
