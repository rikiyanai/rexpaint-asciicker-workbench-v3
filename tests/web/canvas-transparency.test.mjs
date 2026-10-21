import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const module = new vm.SourceTextModule(fs.readFileSync(new URL('../../web/rexpaint-editor/canvas.js', import.meta.url), 'utf8'));
await module.link(() => { throw new Error('Canvas should be standalone'); });
await module.evaluate();
const {Canvas} = module.namespace;

for (const key of [[255, 0, 255], [255, 255, 0]]) {
  test(`transparent background ${key} does not obscure lower-layer paint`, () => {
    const canvas = Object.create(Canvas.prototype);
    canvas.cellSizePixels = 12;
    const calls = [];
    const context = {fillRect: (...args) => calls.push(args)};
    canvas._drawCellToContext(context, {glyph: 0, fg: [255,255,255], bg: key}, 0, 0);
    assert.equal(calls.length, 0);
    canvas.width = canvas.height = 1;
    canvas.useLayerStack = true;
    canvas.layerStack = {getLayers: () => [
      {visible: true, getCell: () => ({glyph: 64, fg: [255,255,255], bg: [0,0,0]})},
      {visible: true, getCell: () => ({glyph: 0, fg: [0,0,0], bg: key})},
    ]};
    assert.equal(canvas.getCell(0, 0).glyph, 64);
  });
}

test('glyphs still render on keyed backgrounds without an opaque fill', () => {
  const canvas = Object.create(Canvas.prototype);
  canvas.cellSizePixels = 12;
  let glyphCalls = 0;
  canvas.cp437Font = {spriteSheet: {}, drawGlyph: () => glyphCalls++};
  canvas._drawCellToContext({fillRect: () => assert.fail('keyed background filled')},
    {glyph: 64, fg: [255,255,255], bg: [255,0,255]}, 0, 0);
  assert.equal(glyphCalls, 1);
});
