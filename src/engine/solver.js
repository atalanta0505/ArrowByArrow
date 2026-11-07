/**
 * Solver & Collision Detection Engine for 《一箭又一箭》
 */

/**
 * Build a fast lookup map from "r,c" (or r * cols + c) to arrow.id
 */
export function buildOccupancyGrid(arrows, rows, cols) {
  const grid = new Int32Array(rows * cols).fill(-1);
  for (let i = 0; i < arrows.length; i++) {
    const arrow = arrows[i];
    if (arrow.removed) continue;
    for (const cell of arrow.cells) {
      if (cell.r >= 0 && cell.r < rows && cell.c >= 0 && cell.c < cols) {
        grid[cell.r * cols + cell.c] = arrow.id;
      }
    }
  }
  return grid;
}

/**
 * Check if a specific arrow can exit the board without hitting any other active arrow.
 * Returns { canExit: boolean, blockerId: number|null, blockerCell: {r,c}|null, distanceToBlocker: number }
 */
export function checkArrowExit(arrow, activeArrows, rows, cols, prebuiltGrid = null) {
  const grid = prebuiltGrid || buildOccupancyGrid(activeArrows, rows, cols);
  const { r: hr, c: hc } = arrow.head;
  const { dr, dc } = arrow.dir;

  let step = 1;
  while (true) {
    const nr = hr + step * dr;
    const nc = hc + step * dc;
    if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) {
      return {
        canExit: true,
        blockerId: null,
        blockerCell: null,
        distanceToBlocker: step,
      };
    }
    const occupantId = grid[nr * cols + nc];
    if (occupantId !== -1) {
      return {
        canExit: false,
        blockerId: occupantId,
        blockerCell: { r: nr, c: nc },
        distanceToBlocker: step - 1,
      };
    }
    step++;
  }
}

/**
 * Return all currently removable (unblocked) arrows.
 */
export function getRemovableArrows(activeArrows, rows, cols) {
  const remaining = activeArrows.filter(a => !a.removed);
  const grid = buildOccupancyGrid(remaining, rows, cols);
  return remaining.filter(arrow => checkArrowExit(arrow, remaining, rows, cols, grid).canExit);
}

/**
 * Pick one random removable arrow for the Hint feature.
 */
export function getRandomHintArrow(activeArrows, rows, cols, rng = Math.random) {
  const removable = getRemovableArrows(activeArrows, rows, cols);
  if (removable.length === 0) return null;
  const idx = Math.floor(rng() * removable.length);
  return removable[idx];
}

/**
 * Verify that a set of arrows is 100% solvable from start to finish (zero deadlock).
 * Also returns a valid solution sequence of arrow IDs and complexity metrics.
 */
export function verifySolvable(arrows, rows, cols) {
  const pool = arrows.filter(a => !a.removed).map(a => ({ ...a, removed: false }));
  const total = pool.length;
  const sequence = [];
  let layers = 0;

  while (sequence.length < total) {
    const grid = buildOccupancyGrid(pool, rows, cols);
    const removableNow = [];
    for (const arrow of pool) {
      if (arrow.removed) continue;
      if (checkArrowExit(arrow, pool, rows, cols, grid).canExit) {
        removableNow.push(arrow);
      }
    }
    if (removableNow.length === 0) {
      return {
        solvable: false,
        clearedCount: sequence.length,
        totalCount: total,
        sequence,
        layers,
      };
    }
    layers++;
    for (const arrow of removableNow) {
      arrow.removed = true;
      sequence.push(arrow.id);
    }
  }

  return {
    solvable: true,
    clearedCount: sequence.length,
    totalCount: total,
    sequence,
    layers,
  };
}
