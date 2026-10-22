import { useEffect, useState } from 'react';

/** A call tile is never narrower than this; whoever doesn't fit folds into a "+N" tile. */
export const MIN_TILE = 168;
/** And never more tiles than this: past it, the ninth becomes "+N". */
export const MAX_TILES = 9;

/**
 * The tiles for n people in this area. A tile may be anything from 16:9 to square, so it fills its cell (no bands above
 * and below, on a wide window or a tall one) without turning into a strip; the column count is the one that gives the
 * largest tile. `fits`: how many tiles fit at MIN_TILE wide or more, at most MAX_TILES.
 */
export function useTileGrid(area: HTMLElement | null, n: number) {
  const [size, setSize] = useState({ w: 800, h: 500 });
  useEffect(() => {
    if (!area) return;
    const watch = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    watch.observe(area);
    return () => watch.disconnect();
  }, [area]);
  const best = (k: number) => {
    const gap = 8;
    let tile = { w: 0, h: 0 };
    for (let cols = 1; cols <= k; cols++) {
      const rows = Math.ceil(k / cols);
      const cellW = (size.w - gap * (cols - 1)) / cols;
      const cellH = (size.h - gap * (rows - 1)) / rows;
      const w = Math.min(cellW, (cellH * 16) / 9);
      const h = Math.min(cellH, w);
      if (w * h > tile.w * tile.h) tile = { w: Math.floor(w), h: Math.floor(h) };
    }
    return tile;
  };
  let fits = Math.min(n, MAX_TILES);
  while (fits > 1 && best(fits).w < MIN_TILE) fits--;
  const tile = best(fits);
  return { fits, tileW: tile.w, tileH: tile.h };
}
