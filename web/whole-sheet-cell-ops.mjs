const DEFAULT_CELL = Object.freeze({
  glyph: 0,
  fg: Object.freeze([255, 255, 255]),
  bg: Object.freeze([0, 0, 0]),
});

function normalizeColor(color, fallback) {
  if (!Array.isArray(color) || color.length < 3) return [...fallback];
  return [
    Number(color[0]) || 0,
    Number(color[1]) || 0,
    Number(color[2]) || 0,
  ];
}

export function cloneEditorCell(cell) {
  return {
    glyph: Number(cell?.glyph || 0),
    fg: normalizeColor(cell?.fg, DEFAULT_CELL.fg),
    bg: normalizeColor(cell?.bg, DEFAULT_CELL.bg),
  };
}

const MAGENTA = Object.freeze([255, 0, 255]);

export function buildClearedEditorCell(_cell) {
  return {
    glyph: 0,
    fg: [...DEFAULT_CELL.fg],
    bg: [...MAGENTA],
  };
}

export function shouldCopyCellOnLayerMerge(cell) {
  const current = cloneEditorCell(cell);
  if (current.glyph !== 0) return true;
  // glyph=0 with MAG bg is a transparent/cleared cell — no content to merge
  if (current.bg[0] === 255 && current.bg[1] === 0 && current.bg[2] === 255) return false;
  if (current.fg.some((value, index) => value !== DEFAULT_CELL.fg[index])) return true;
  if (current.bg.some((value, index) => value !== DEFAULT_CELL.bg[index])) return true;
  return false;
}
