import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitPanel, rememberPanel, restorePanel } from '../src/overlayPosition.ts';
const normal = { width: 340, height: 500, viewportWidth: 1280, viewportHeight: 720 };
test('Dragged panels remain reachable at every edge, including a smaller video', () => {
  assert.deepEqual(fitPanel({ x: -100, y: 900 }, normal), { x: 0, y: 220 });
  assert.deepEqual(
    fitPanel({ x: 1200, y: 30 }, { ...normal, viewportWidth: 300, viewportHeight: 400 }),
    { x: 0, y: 0 },
  );
});
test('Personal panel positions survive fullscreen changes proportionally and default to top right', () => {
  const saved = rememberPanel({ x: 470, y: 110 }, normal);
  assert.deepEqual(saved, { x: 0.5, y: 0.5 });
  assert.deepEqual(restorePanel(saved, { ...normal, viewportWidth: 1920, viewportHeight: 1080 }), {
    x: 790,
    y: 290,
  });
  assert.deepEqual(restorePanel(null, normal), { x: 940, y: 0 });
  assert.deepEqual(restorePanel(saved, normal), { x: 470, y: 110 });
});
test('Malformed saved positions cannot hide the drag handle', () => {
  assert.deepEqual(restorePanel({ x: Infinity, y: NaN }, normal), { x: 940, y: 0 });
  assert.deepEqual(restorePanel({ x: -2, y: 100 }, normal), { x: 0, y: 220 });
});
