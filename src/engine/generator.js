/**
 * 100% Solvable Procedural Arrow Generator, Shuffler, and Restart-Extender
 * for 《一箭又一箭》 (Arrow by Arrow)
 */

import { verifySolvable } from './solver.js';

// Exact 8-color pastel neon palette extracted from the user's 《一箭又一箭》 screenshots
export const ARROW_PALETTE = [
  '#f08cae', // Coral Pink
  '#b689e8', // Lavender Purple
  '#7c8ce8', // Periwinkle Blue
  '#6eb5eb', // Sky Cyan
  '#5ec7b8', // Mint Teal
  '#78d168', // Fresh Lime Green
  '#f2c94c', // Warm Amber Yellow
  '#eb9d75', // Soft Peach Orange
];

const DIRS = [
  { dr: -1, dc: 0 }, // UP
  { dr: 1, dc: 0 },  // DOWN
  { dr: 0, dc: -1 }, // LEFT
  { dr: 0, dc: 1 },  // RIGHT
];

/**
 * Deterministic seeded PRNG (Mulberry32)
 */
export function createRNG(seed = 12345) {
  let s = seed >>> 0;
  return function rng() {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Check if ray from (hr, hc) in direction (dr, dc) is completely clear of any cell in `occupiedGrid`
 * Returns { clear: boolean, passedRemovedCount: number }
 */
function checkRayOnGrid(hr, hc, dr, dc, rows, cols, occupiedGrid, peeledGrid = null) {
  let r = hr + dr;
  let c = hc + dc;
  let passedPeeled = 0;
  while (r >= 0 && r < rows && c >= 0 && c < cols) {
    const idx = r * cols + c;
    if (occupiedGrid[idx] === 1) {
      return { clear: false, passedPeeled: 0 };
    }
    if (peeledGrid && peeledGrid[idx] === 1) {
      passedPeeled++;
    }
    r += dr;
    c += dc;
  }
  return { clear: true, passedPeeled };
}

/**
 * Count orthogonal neighbors of (r, c) that have `grid[idx] === 1`
 */
function countNeighbors(r, c, rows, cols, grid) {
  let count = 0;
  for (const { dr, dc } of DIRS) {
    const nr = r + dr;
    const nc = c + dc;
    if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && grid[nr * cols + nc] === 1) {
      count++;
    }
  }
  return count;
}

/**
 * Check if setting `grid[cellIdx] = 0` would create any degree-0 (isolated single cell) neighbor in `grid`,
 * EXCEPT possibly `allowSingleIdx` (when we are about to step into `allowSingleIdx` next).
 */
function createsIsolatedNeighbor(r, c, rows, cols, grid, allowSingleIdx = -1) {
  for (const { dr, dc } of DIRS) {
    const nr = r + dr;
    const nc = c + dc;
    if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
      const nIdx = nr * cols + nc;
      if (grid[nIdx] === 1 && nIdx !== allowSingleIdx) {
        // Since (r, c) is currently 0 (already temporarily removed), if neighbor has 0 neighbors now, it's isolated!
        if (countNeighbors(nr, nc, rows, cols, grid) === 0) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Partition the target cells (`targetMask` = Uint8Array(rows*cols)) into 100% solvable winding arrows,
 * while treating `fixedObstacleGrid` (Uint8Array(rows*cols)) as permanent obstacles that rays cannot cross.
 */
export function partitionCellsIntoArrows({
  rows,
  cols,
  targetGrid,
  fixedObstacleGrid = null,
  minLen = 3,
  maxLen = 12,
  seed = 1001,
  startId = 1,
}) {
  const rng = createRNG(seed);
  const remaining = new Uint8Array(targetGrid);
  const obstacles = new Uint8Array(rows * cols);
  const shadowedByFixed = new Uint8Array(rows * cols);
  for (let i = 0; i < rows * cols; i++) {
    if (remaining[i] === 1 || (fixedObstacleGrid && fixedObstacleGrid[i] === 1)) {
      obstacles[i] = 1;
    }
  }
  if (fixedObstacleGrid) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (remaining[idx] === 1) {
          let hasClearDir = false;
          for (const { dr, dc } of DIRS) {
            if (checkRayOnGrid(r, c, dr, dc, rows, cols, fixedObstacleGrid, null).clear) {
              hasClearDir = true;
              break;
            }
          }
          if (!hasClearDir) shadowedByFixed[idx] = 1;
        }
      }
    }
  }
  const peeledGrid = new Uint8Array(rows * cols);

  // First ensure no isolated single cells exist in `remaining`
  const orphanCells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (remaining[idx] === 1 && countNeighbors(r, c, rows, cols, remaining) === 0) {
        orphanCells.push({ r, c, idx });
        remaining[idx] = 0;
        obstacles[idx] = 0;
      }
    }
  }

  let totalRemaining = 0;
  for (let i = 0; i < rows * cols; i++) {
    if (remaining[i] === 1) totalRemaining++;
  }

  const arrows = [];
  let nextId = startId;

  while (totalRemaining > 0) {
    // Find all valid (head, neck) pairs on the current boundary of `remaining`
    const candidates = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const hIdx = r * cols + c;
        if (remaining[hIdx] !== 1) continue;

        for (const { dr, dc } of DIRS) {
          // Neck is at (r - dr, c - dc)
          const pr = r - dr;
          const pc = c - dc;
          if (pr < 0 || pr >= rows || pc < 0 || pc >= cols) continue;
          const pIdx = pr * cols + pc;
          if (remaining[pIdx] !== 1) continue;

          const rayCheck = checkRayOnGrid(r, c, dr, dc, rows, cols, obstacles, peeledGrid);
          if (rayCheck.clear) {
            candidates.push({
              hr: r,
              hc: c,
              hIdx,
              pr,
              pc,
              pIdx,
              dr,
              dc,
              passedPeeled: rayCheck.passedPeeled,
            });
          }
        }
      }
    }

    if (candidates.length === 0) {
      // Try absorbing remaining shadowed pocket cells into the tail of an adjacent already-peeled arrow
      let absorbedIntoExisting = false;
      for (let i = arrows.length - 1; i >= 0; i--) {
        const existingArrow = arrows[i];
        let grew = true;
        while (grew) {
          grew = false;
          const tail = existingArrow.cells[0];
          for (const { dr, dc } of DIRS) {
            const nr = tail.r + dr;
            const nc = tail.c + dc;
            if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
            const nIdx = nr * cols + nc;
            if (remaining[nIdx] !== 1) continue;

            // Ensure (nr, nc) does not lie on the exit ray of existingArrow or any arrow peeled BEFORE existingArrow (0..i)
            let blocksEarlierRay = false;
            for (let j = 0; j <= i; j++) {
              const a = arrows[j];
              const adr = a.dir.dr;
              const adc = a.dir.dc;
              if (
                (adr !== 0 && nc === a.head.c && (nr - a.head.r) * adr > 0) ||
                (adc !== 0 && nr === a.head.r && (nc - a.head.c) * adc > 0)
              ) {
                blocksEarlierRay = true;
                break;
              }
            }
            if (!blocksEarlierRay) {
              existingArrow.cells.unshift({ r: nr, c: nc });
              remaining[nIdx] = 0;
              obstacles[nIdx] = 0;
              peeledGrid[nIdx] = 1;
              totalRemaining--;
              grew = true;
              absorbedIntoExisting = true;
              break;
            }
          }
        }
      }
      if (absorbedIntoExisting) {
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const idx = r * cols + c;
            if (remaining[idx] === 1 && countNeighbors(r, c, rows, cols, remaining) === 0) {
              orphanCells.push({ r, c, idx });
              remaining[idx] = 0;
              obstacles[idx] = 0;
              totalRemaining--;
            }
          }
        }
        if (totalRemaining <= 0) break;
        continue;
      }

      // Fallback if fixedObstacleGrid blocked a deep pocket: relax fixedObstacleGrid for this pocket
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const hIdx = r * cols + c;
          if (remaining[hIdx] !== 1) continue;
          for (const { dr, dc } of DIRS) {
            const pr = r - dr;
            const pc = c - dc;
            if (pr < 0 || pr >= rows || pc < 0 || pc >= cols) continue;
            const pIdx = pr * cols + pc;
            if (remaining[pIdx] !== 1) continue;
            const rayCheck = checkRayOnGrid(r, c, dr, dc, rows, cols, remaining, peeledGrid);
            if (rayCheck.clear) {
              candidates.push({
                hr: r,
                hc: c,
                hIdx,
                pr,
                pc,
                pIdx,
                dr,
                dc,
                passedPeeled: rayCheck.passedPeeled,
              });
            }
          }
        }
      }
      if (candidates.length === 0) break;
    }

    // Score candidates:
    // Prefer candidates that:
    // 1. Do not isolate neighbors when removing head + neck
    // 2. Pass through previously peeled cells (creates rich interlocking dependencies!)
    // 3. Have low degree (cleans up corners and peninsulas smoothly)
    const cleanCandidates = [];
    for (const cand of candidates) {
      remaining[cand.hIdx] = 0;
      remaining[cand.pIdx] = 0;
      const headIsolates = createsIsolatedNeighbor(cand.hr, cand.hc, rows, cols, remaining, -1);
      // For neck, if it creates a single isolated neighbor, we can step into that neighbor as the 3rd cell!
      let neckIsolatedCount = 0;
      let forcedNext = null;
      for (const { dr, dc } of DIRS) {
        const nr = cand.pr + dr;
        const nc = cand.pc + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
          const nIdx = nr * cols + nc;
          if (remaining[nIdx] === 1 && countNeighbors(nr, nc, rows, cols, remaining) === 0) {
            neckIsolatedCount++;
            forcedNext = { r: nr, c: nc, idx: nIdx };
          }
        }
      }
      remaining[cand.hIdx] = 1;
      remaining[cand.pIdx] = 1;

      if (!headIsolates && neckIsolatedCount <= 1) {
        const degH = countNeighbors(cand.hr, cand.hc, rows, cols, remaining);
        const weight =
          1 +
          (cand.passedPeeled > 0 ? 3.5 : 0) +
          (degH === 1 ? 2.5 : 0) +
          rng() * 2.0;
        cleanCandidates.push({ ...cand, forcedNext, weight });
      }
    }

    const pool = cleanCandidates.length > 0 ? cleanCandidates : candidates;
    // Weighted random selection from top candidates
    pool.sort((a, b) => (b.weight || 0) - (a.weight || 0));
    const topK = Math.min(pool.length, Math.max(4, Math.ceil(pool.length * 0.35)));
    const chosen = pool[Math.floor(rng() * topK)];

    // Start building snake from head -> neck -> tail
    const reversedCells = [
      { r: chosen.hr, c: chosen.hc, idx: chosen.hIdx },
      { r: chosen.pr, c: chosen.pc, idx: chosen.pIdx },
    ];
    remaining[chosen.hIdx] = 0;
    remaining[chosen.pIdx] = 0;
    obstacles[chosen.hIdx] = 0;
    obstacles[chosen.pIdx] = 0;
    peeledGrid[chosen.hIdx] = 1;
    peeledGrid[chosen.pIdx] = 1;
    totalRemaining -= 2;

    // Determine target length for this snake (allow longer tail if walking into shadowed pocket)
    let targetLen =
      minLen + Math.floor(rng() * (maxLen - minLen + 1));

    // Walk backwards from neck to grow the winding snake body
    let cur = { r: chosen.pr, c: chosen.pc, idx: chosen.pIdx };
    let prevDir = { dr: -chosen.dr, dc: -chosen.dc };
    let forcedStep = chosen.forcedNext || null;

    while (reversedCells.length < targetLen && totalRemaining > 0) {
      if (forcedStep && remaining[forcedStep.idx] === 1) {
        const stepCell = forcedStep;
        forcedStep = null;
        reversedCells.push(stepCell);
        remaining[stepCell.idx] = 0;
        obstacles[stepCell.idx] = 0;
        peeledGrid[stepCell.idx] = 1;
        totalRemaining--;
        prevDir = { dr: stepCell.r - cur.r, dc: stepCell.c - cur.c };
        cur = stepCell;
        continue;
      }

      // Gather valid next tail steps from `cur`
      const stepOptions = [];
      for (const { dr, dc } of DIRS) {
        const nr = cur.r + dr;
        const nc = cur.c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        const nIdx = nr * cols + nc;
        if (remaining[nIdx] !== 1) continue;

        // Tentatively remove nIdx and check how many isolated neighbors it creates
        remaining[nIdx] = 0;
        let isolatedNeighbors = [];
        for (const d2 of DIRS) {
          const nnr = nr + d2.dr;
          const nnc = nc + d2.dc;
          if (nnr >= 0 && nnr < rows && nnc >= 0 && nnc < cols) {
            const nnIdx = nnr * cols + nnc;
            if (remaining[nnIdx] === 1 && countNeighbors(nnr, nnc, rows, cols, remaining) === 0) {
              isolatedNeighbors.push({ r: nnr, c: nnc, idx: nnIdx });
            }
          }
        }
        remaining[nIdx] = 1;

        // If stepping into (nr, nc) leaves 0 isolated neighbors, or leaves 1 isolated neighbor and we still have length budget to absorb it
        if (
          isolatedNeighbors.length === 0 ||
          (isolatedNeighbors.length === 1 && reversedCells.length + 1 < maxLen + 2)
        ) {
          const isTurn = dr !== prevDir.dr || dc !== prevDir.dc;
          const deg = countNeighbors(nr, nc, rows, cols, remaining);
          const isShadowed = shadowedByFixed[nIdx] === 1;
          // Favor 90-degree turns and strongly pull tail into pockets shadowed by fixedObstacleGrid
          const score =
            (isShadowed ? 12.0 : 0) +
            (isTurn ? 2.6 : 1.0) +
            (deg <= 2 ? 2.0 : 0) +
            (isolatedNeighbors.length === 0 ? 2.0 : 0) +
            rng() * 1.5;
          stepOptions.push({
            r: nr,
            c: nc,
            idx: nIdx,
            dr,
            dc,
            forcedAfter: isolatedNeighbors[0] || null,
            score,
          });
        }
      }

      if (stepOptions.length === 0) break;
      stepOptions.sort((a, b) => b.score - a.score);
      const pick = stepOptions[0];

      const nextCell = { r: pick.r, c: pick.c, idx: pick.idx };
      if (shadowedByFixed[nextCell.idx] === 1 && targetLen < maxLen + 8) {
        targetLen++;
      }
      reversedCells.push(nextCell);
      remaining[nextCell.idx] = 0;
      obstacles[nextCell.idx] = 0;
      peeledGrid[nextCell.idx] = 1;
      totalRemaining--;
      prevDir = { dr: pick.dr, dc: pick.dc };
      cur = nextCell;
      forcedStep = pick.forcedAfter;
    }

    // If any single isolated neighbor was left adjacent to tail or body, absorb it if adjacent to tail
    let absorbed = true;
    while (absorbed && totalRemaining > 0) {
      absorbed = false;
      for (const { dr, dc } of DIRS) {
        const nr = cur.r + dr;
        const nc = cur.c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
          const nIdx = nr * cols + nc;
          if (remaining[nIdx] === 1 && countNeighbors(nr, nc, rows, cols, remaining) === 0) {
            const tailCell = { r: nr, c: nc, idx: nIdx };
            reversedCells.push(tailCell);
            remaining[nIdx] = 0;
            obstacles[nIdx] = 0;
            peeledGrid[nIdx] = 1;
            totalRemaining--;
            cur = tailCell;
            absorbed = true;
            break;
          }
        }
      }
    }

    // Sweep for any accidental degree-0 single cell in `remaining` and attach it to an adjacent existing snake tail
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (remaining[idx] === 1 && countNeighbors(r, c, rows, cols, remaining) === 0) {
          orphanCells.push({ r, c, idx });
          remaining[idx] = 0;
          obstacles[idx] = 0;
          totalRemaining--;
        }
      }
    }

    // `reversedCells` is ordered [head, neck, ..., tail]. Reverse it so `cells` is [tail, ..., neck, head]
    const cells = reversedCells.reverse().map(({ r, c }) => ({ r, c }));
    const color = ARROW_PALETTE[(nextId - 1 + Math.floor(rng() * 3)) % ARROW_PALETTE.length];

    arrows.push({
      id: nextId++,
      cells,
      head: { r: chosen.hr, c: chosen.hc },
      dir: { dr: chosen.dr, dc: chosen.dc },
      color,
      removed: false,
    });
  }

  // Try to attach any orphan single cells to the tail of an orthogonally adjacent arrow
  for (const orphan of orphanCells) {
    for (const arrow of arrows) {
      const tail = arrow.cells[0];
      if (Math.abs(tail.r - orphan.r) + Math.abs(tail.c - orphan.c) === 1) {
        // Check that adding orphan to tail does not block arrow's own head ray
        const dr = arrow.dir.dr;
        const dc = arrow.dir.dc;
        const onOwnRay =
          (dr !== 0 && orphan.c === arrow.head.c && (orphan.r - arrow.head.r) * dr > 0) ||
          (dc !== 0 && orphan.r === arrow.head.r && (orphan.c - arrow.head.c) * dc > 0);
        if (!onOwnRay) {
          arrow.cells.unshift({ r: orphan.r, c: orphan.c });
          break;
        }
      }
    }
  }

  // Assign well-distributed colors so adjacent arrows contrast nicely
  for (let i = 0; i < arrows.length; i++) {
    arrows[i].color = ARROW_PALETTE[(i * 3 + (seed % 7)) % ARROW_PALETTE.length];
  }

  return arrows;
}

/**
 * 1. Generate a full level from its level definition
 */
export function generateFullLevel(levelDef, seedOverride = null) {
  const mask = levelDef.mask;
  const rows = mask.length;
  const cols = mask[0].length;
  const targetGrid = new Uint8Array(rows * cols);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      targetGrid[r * cols + c] = mask[r][c] ? 1 : 0;
    }
  }

  const baseSeed = seedOverride !== null ? seedOverride : levelDef.seed;
  for (let attempt = 0; attempt < 10; attempt++) {
    const arrows = partitionCellsIntoArrows({
      rows,
      cols,
      targetGrid,
      minLen: levelDef.minSnakeLen || 3,
      maxLen: levelDef.maxSnakeLen || 12,
      seed: baseSeed + attempt * 97,
      startId: 1,
    });
    const check = verifySolvable(arrows, rows, cols);
    if (check.solvable) {
      return {
        rows,
        cols,
        mask,
        arrows,
        expectedSeconds: levelDef.expectedSeconds,
      };
    }
  }

  throw new Error(`Failed to generate solvable level for level ${levelDef.id}`);
}

/**
 * 2. Shuffle only the currently remaining (unremoved) arrows on the board.
 */
export function shuffleRemainingArrows(currentArrows, rows, cols, seed, levelDef = {}) {
  const remainingArrows = currentArrows.filter(a => !a.removed);
  if (remainingArrows.length === 0) return [];

  const targetGrid = new Uint8Array(rows * cols);
  let cellCount = 0;
  for (const arrow of remainingArrows) {
    for (const cell of arrow.cells) {
      targetGrid[cell.r * cols + cell.c] = 1;
      cellCount++;
    }
  }

  const avgLen = cellCount / remainingArrows.length;
  const minLen = Math.max(2, Math.floor(avgLen - 1.5));
  const maxLen = Math.max(minLen + 1, Math.ceil(avgLen + 1.5));

  for (let attempt = 0; attempt < 12; attempt++) {
    const newArrows = partitionCellsIntoArrows({
      rows,
      cols,
      targetGrid,
      minLen,
      maxLen,
      seed: seed + attempt * 131,
      startId: 1,
    });
    if (verifySolvable(newArrows, rows, cols).solvable) {
      return newArrows;
    }
  }
  return remainingArrows;
}

/**
 * 3. Rule 4 Special Feature:
 * When the player clicks Shuffle (producing `shuffledArrows` on the remaining cells)
 * and then immediately clicks Restart, keep `shuffledArrows` intact as the core layout
 * and generate the missing cleared arrows around them on `fullMask` so the entire board
 * is complete and 100% solvable!
 */
export function extendShuffledToFull(shuffledArrows, fullMask, rows, cols, seed, levelDef = {}) {
  const activeShuffled = shuffledArrows.filter(a => !a.removed).map(a => ({
    ...a,
    cells: a.cells.map(c => ({ ...c })),
    head: { ...a.head },
    dir: { ...a.dir },
    removed: false,
  }));

  const remGrid = new Uint8Array(rows * cols);
  let maxExistingId = 0;
  for (const arrow of activeShuffled) {
    if (arrow.id > maxExistingId) maxExistingId = arrow.id;
    for (const cell of arrow.cells) {
      remGrid[cell.r * cols + cell.c] = 1;
    }
  }

  // Missing cells = cells in fullMask (or original full board) that are not in remGrid
  const missingGrid = new Uint8Array(rows * cols);
  let missingCount = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (fullMask[r][c] === 1 && remGrid[idx] === 0) {
        missingGrid[idx] = 1;
        missingCount++;
      }
    }
  }

  if (missingCount === 0) {
    return activeShuffled;
  }

  for (let attempt = 0; attempt < 15; attempt++) {
    const outerArrows = partitionCellsIntoArrows({
      rows,
      cols,
      targetGrid: missingGrid,
      fixedObstacleGrid: remGrid,
      minLen: levelDef.minSnakeLen || 3,
      maxLen: levelDef.maxSnakeLen || 12,
      seed: seed + attempt * 193,
      startId: maxExistingId + 1,
    });

    const combined = [...outerArrows, ...activeShuffled];
    if (verifySolvable(combined, rows, cols).solvable) {
      return combined;
    }
  }

  // Ultimate fallback: if an inner pocket had a mutual ray dependency, regenerate full board with seed
  return generateFullLevel(
    {
      id: levelDef.id || 0,
      mask: fullMask,
      minSnakeLen: levelDef.minSnakeLen || 3,
      maxSnakeLen: levelDef.maxSnakeLen || 12,
      expectedSeconds: levelDef.expectedSeconds || 180,
      seed,
    },
    seed
  ).arrows;
}
