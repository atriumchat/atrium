import assert from 'node:assert/strict';
import { test } from 'node:test';
import { concentricEdge, cornerRadius, edgeTicks, filled, flowFrame, rulerTicks, scale, space, tickState } from '../src/index';

test('corner radius: known phones, the nearest for others, square with a home button', () => {
  assert.equal(cornerRadius(390, 844), 47.3);
  assert.equal(cornerRadius(844, 390), 47.3);
  assert.equal(cornerRadius(402, 874), 62);
  assert.equal(cornerRadius(391, 846), 47.3);
  assert.equal(cornerRadius(375, 667), 0);
});

test('edge ticks stay on the screen and start right of the top middle', () => {
  const [w, h] = [402, 874];
  const ticks = edgeTicks(w, h, cornerRadius(w, h));
  assert.ok(ticks.length > 250);
  for (const t of ticks) {
    for (const [x, y] of [[t.x1, t.y1], [t.x2, t.y2]] as const) {
      assert.ok(x >= 0 && x <= w && y >= 0 && y <= h, `${x},${y}`);
    }
  }
  assert.ok(ticks[0]!.x1 >= w / 2 && ticks[0]!.y1 === scale.inset);
});

test('the island leaves a gap at the top, and nothing else', () => {
  const [w, h] = [402, 874];
  const all = edgeTicks(w, h, 62);
  const cut = edgeTicks(w, h, 62, scale.island);
  const gone = all.filter((t) => !cut.some((c) => c.x1 === t.x1 && c.y1 === t.y1));
  assert.ok(gone.length > 0);
  for (const t of gone) assert.ok(t.y1 < scale.inset + 1 && Math.abs(t.x1 - w / 2) <= scale.island / 2 + scale.gap);
  assert.ok(cut[0]!.x1 > w / 2 + scale.island / 2 - scale.gap);
});

test('every fifth tick is long, on the edge and on the ruler', () => {
  const ticks = edgeTicks(402, 874, 62);
  const length = (t: (typeof ticks)[number]) => Math.hypot(t.x2 - t.x1, t.y2 - t.y1);
  assert.equal(Math.round(length(ticks[0]!)), scale.long);
  assert.equal(Math.round(length(ticks[1]!)), scale.short);
  const ruler = rulerTicks(480);
  assert.equal(ruler.length, Math.floor(480 / scale.gap) + 1);
  assert.equal(ruler[5]!.y1, 0);
  assert.equal(ruler[6]!.y1, scale.rulerShortFrom);
  assert.equal(rulerTicks(0).length, 1);
});

test('margins are concentric with the corners, never under the minimum', () => {
  assert.equal(concentricEdge(62), 38);
  assert.equal(concentricEdge(0), space.edgeMin);
  const frame = flowFrame(402, 874, { top: 62, bottom: 34 });
  assert.deepEqual(frame, { radius: 62, edge: 38, top: 70, bottom: 42, island: true });
  assert.equal(flowFrame(375, 667, { top: 20, bottom: 0 }).island, false);
});

test('fill lights ticks, the next one breathes', () => {
  assert.equal(filled(0.5, 10), 5);
  assert.equal(filled(-1, 10), 0);
  assert.equal(filled(2, 10), 10);
  assert.deepEqual([3, 4, 5].map((i) => tickState(i, 4, 10)), ['on', 'next', 'off']);
  assert.equal(tickState(9, 10, 10), 'on');
});
