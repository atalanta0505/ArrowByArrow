/**
 * Classic Maze + Cut-and-Orient Arrow Generator for 《一箭又一箭》 (26 Alphabet Edition)
 *
 * Two-Stage Architecture:
 * Stage 1 (`buildClassicMazeGraph`):
 *   Generates an authentic Classic Maze on the letter grid using Hunt-and-Kill +
 *   Wall-Follower Spiral Coiling, naturally producing:
 *   - Paperclip Spirals (回形针弯: 3-6 consecutive same-chirality 90° turns coiling into rooms)
 *   - U-Hairpins & C-Channels (U型折返弯: 2 same-chirality 90° turns with parallel legs)
 *   - Architectural L-Corridors (L型弯: 1 crisp 90° turn joining long straight corridors)
 *   - Long Straight Runs & Short Pins (纯直线长矛与短插销: 0 turns)
 *   - Classic Maze Chicanes (蛇形弯: alternating turns, strictly controlled at ~12-18%)
 *
 * Stage 2 (`partitionCellsIntoArrows` via Maze Cut-and-Orient):
 *   Finds maze corridor segments `(p -> h)` with a clear line-of-sight exit ray,
 *   "cuts an opening" (开一个口) right in front of `h`, attaches an arrowhead at `h`,
 *   and traces backwards along the Classic Maze corridor to slice out 100% solvable arrows!
 */

import { verifySolvable } from './solver.js';

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
 * 2D cross product of two orthogonal unit step vectors:
 * +1 = 90° clockwise turn (Right turn)
 * -1 = 90° counter-clockwise turn (Left turn)
 *  0 = straight or 180°
 */
function turnCross(d1, d2) {
  return d1.dc * d2.dr - d1.dr * d2.dc;
}

/**
 * Count 90-degree bends in a path of cells
 */
export function countPathTurns(cells) {
  let turns = 0;
  for (let i = 1; i < cells.length - 1; i++) {
    const dr1 = cells[i].r - cells[i - 1].r;
    const dc1 = cells[i].c - cells[i - 1].c;
    const dr2 = cells[i + 1].r - cells[i].r;
    const dc2 = cells[i + 1].c - cells[i].c;
    if (dr1 !== dr2 || dc1 !== dc2) turns++;
  }
  return turns;
}

/**
 * Classify an arrow's geometric bend family for verification & analysis:
 * - 'STRAIGHT': 0 turns (pure straight pin or long spear)
 * - 'L_BEND': 1 turn (L-shaped corridor)
 * - 'PAPERCLIP': >= 3 turns where consecutive same-chirality turns form a spiral / paperclip coil
 * - 'U_BEND': >= 2 turns dominated by same-chirality U-channel / hairpin foldback
 * - 'SERPENT': alternating left-right S-turns
 */
export function classifyArrowShape(cells) {
  const turnSigns = [];
  let prevDir = null;
  for (let i = 1; i < cells.length; i++) {
    const curDir = {
      dr: cells[i].r - cells[i - 1].r,
      dc: cells[i].c - cells[i - 1].c,
    };
    if (prevDir && (curDir.dr !== prevDir.dr || curDir.dc !== prevDir.dc)) {
      turnSigns.push(turnCross(prevDir, curDir));
    }
    prevDir = curDir;
  }

  const t = turnSigns.length;
  if (t === 0) return 'STRAIGHT';
  if (t === 1) return 'L_BEND';

  // Count consecutive same-sign turn pairs (e.g. R->R or L->L) vs alternating pairs (R->L or L->R)
  let sameSignPairs = 0;
  let maxSameRun = 1;
  let curRun = 1;
  for (let i = 1; i < t; i++) {
    if (turnSigns[i] === turnSigns[i - 1]) {
      sameSignPairs++;
      curRun++;
      if (curRun > maxSameRun) maxSameRun = curRun;
    } else {
      curRun = 1;
    }
  }

  if (maxSameRun >= 3 || (t >= 3 && sameSignPairs >= t - 2)) {
    return 'PAPERCLIP';
  }
  if (maxSameRun >= 2 || sameSignPairs * 2 >= t - 1) {
    return 'U_BEND';
  }
  return 'SERPENT';
}

function dirToIdx(dr, dc) {
  if (dr === -1) return 0; // UP
  if (dr === 1) return 1;  // DOWN
  if (dc === -1) return 2; // LEFT
  return 3;                // RIGHT
}

function checkRayOnGrid(
  hr,
  hc,
  dr,
  dc,
  rows,
  cols,
  occupiedGrid,
  peeledGrid = null,
  peeledStepGrid = null,
  peeledDirGrid = null
) {
  let r = hr + dr;
  let c = hc + dc;
  let passedPeeled = 0;
  let latestBlockerStep = 0;
  let latestBlockerDir = -1;
  let orthoBlockers = 0;
  let sameDirBlockers = 0;
  let oppDirBlockers = 0;
  let lastSeenStep = -1;
  let distinctBlockers = 0;
  const candDirIdx = dirToIdx(dr, dc);

  while (r >= 0 && r < rows && c >= 0 && c < cols) {
    const idx = r * cols + c;
    if (occupiedGrid[idx] === 1) {
      return {
        clear: false,
        passedPeeled: 0,
        latestBlockerStep: 0,
        latestBlockerDir: -1,
        orthoBlockers: 0,
        sameDirBlockers: 0,
        oppDirBlockers: 0,
        distinctBlockers: 0,
      };
    }
    if (peeledGrid && peeledGrid[idx] === 1) {
      passedPeeled++;
      if (peeledStepGrid && peeledDirGrid) {
        const bStep = peeledStepGrid[idx];
        const bDir = peeledDirGrid[idx];
        if (bStep !== lastSeenStep) {
          distinctBlockers++;
          lastSeenStep = bStep;
        }
        if (bStep > latestBlockerStep) {
          latestBlockerStep = bStep;
          latestBlockerDir = bDir;
        }
        if (bDir === candDirIdx) {
          sameDirBlockers++;
        } else if ((bDir < 2) !== (candDirIdx < 2)) {
          orthoBlockers++;
        } else {
          oppDirBlockers++;
        }
      }
    }
    r += dr;
    c += dc;
  }
  return {
    clear: true,
    passedPeeled,
    latestBlockerStep,
    latestBlockerDir,
    orthoBlockers,
    sameDirBlockers,
    oppDirBlockers,
    distinctBlockers,
  };
}

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

function createsIsolatedNeighbor(r, c, rows, cols, grid, allowSingleIdx = -1) {
  for (const { dr, dc } of DIRS) {
    const nr = r + dr;
    const nc = c + dc;
    if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
      const nIdx = nr * cols + nc;
      if (grid[nIdx] === 1 && nIdx !== allowSingleIdx) {
        if (countNeighbors(nr, nc, rows, cols, grid) === 0) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * ============================================================================
 * STAGE 1: BUILD CLASSIC MAZE GRAPH (`buildClassicMazeGraph`)
 * Uses Hunt-and-Kill + Wall-Follower Spiral Coiling to carve authentic maze
 * corridors across the letter grid.
 * Returns `mazeAdj`: Array<Set<number>> where `mazeAdj[u]` contains the cell
 * indices connected to `u` in the Classic Maze.
 * ============================================================================
 */
export function buildClassicMazeGraph(rows, cols, activeGrid, rng) {
  const N = rows * cols;
  const unvisited = new Uint8Array(activeGrid);
  const mazeAdj = Array.from({ length: N }, () => new Set());

  const addMazeEdge = (u, v) => {
    mazeAdj[u].add(v);
    mazeAdj[v].add(u);
  };

  let remainingCount = 0;
  for (let i = 0; i < N; i++) {
    if (unvisited[i] === 1) remainingCount++;
  }

  let passIndex = 0;
  while (remainingCount > 0) {
    // HUNT PHASE: Find an unvisited cell on the outer perimeter of the unvisited set
    let startR = -1;
    let startC = -1;
    let bestBoundaryScore = -1e9;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (unvisited[idx] !== 1) continue;
        const deg = countNeighbors(r, c, rows, cols, unvisited);
        if (deg === 0) {
          // Single leftover cell: attach it to an already-carved adjacent maze corridor endpoint if possible
          unvisited[idx] = 0;
          remainingCount--;
          for (const { dr, dc } of DIRS) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
              const nIdx = nr * cols + nc;
              if (activeGrid[nIdx] === 1 && mazeAdj[nIdx].size <= 1) {
                addMazeEdge(idx, nIdx);
                break;
              }
            }
          }
          continue;
        }
        // Prefer degree-1 or degree-2 boundary cells to start carving a clean wall-following corridor
        const score = (4 - deg) * 10 + rng() * 6;
        if (score > bestBoundaryScore) {
          bestBoundaryScore = score;
          startR = r;
          startC = c;
        }
      }
    }

    if (startR === -1 || remainingCount <= 0) break;

    // Choose a Classic Maze carving personality for this corridor:
    // 0: Wall-Hugging Paperclip Spiral (locks chirality = +1 or -1, coils inward!)
    // 1: Long Perimeter L/U Corridor (long straight runs of 6-14 cells + same-chirality corners)
    // 2: Classic Stepped Maze Chicane (occasional alternating turn)
    const modeRoll = (passIndex * 0.37 + rng() * 0.63) % 1.0;
    const carverMode =
      modeRoll < 0.52 ? 'SPIRAL_ROOM' : modeRoll < 0.88 ? 'PERIMETER_LU' : 'CHICANE';
    const lockedSpin = rng() < 0.5 ? 1 : -1;
    passIndex++;

    let curR = startR;
    let curC = startC;
    let curIdx = curR * cols + curC;
    unvisited[curIdx] = 0;
    remainingCount--;

    let prevDir = null;
    let straightSteps = 0;
    let legTarget =
      carverMode === 'PERIMETER_LU'
        ? 6 + Math.floor(rng() * 8)
        : carverMode === 'SPIRAL_ROOM'
          ? 4 + Math.floor(rng() * 5)
          : 2 + Math.floor(rng() * 3);

    // KILL / WALK PHASE: Carve a long non-branching maze corridor
    while (remainingCount > 0) {
      const options = [];
      for (const { dr, dc } of DIRS) {
        const nr = curR + dr;
        const nc = curC + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        const nIdx = nr * cols + nc;
        if (unvisited[nIdx] !== 1) continue;

        // Check if stepping to nIdx isolates any OTHER neighbor of cur
        unvisited[nIdx] = 0;
        let isolatesOther = false;
        for (const d2 of DIRS) {
          const cr = curR + d2.dr;
          const cc = curC + d2.dc;
          if (cr >= 0 && cr < rows && cc >= 0 && cc < cols) {
            const cIdx = cr * cols + cc;
            if (unvisited[cIdx] === 1 && countNeighbors(cr, cc, rows, cols, unvisited) === 0) {
              isolatesOther = true;
              break;
            }
          }
        }
        const nextDeg = countNeighbors(nr, nc, rows, cols, unvisited);
        unvisited[nIdx] = 1;

        if (isolatesOther) continue;

        const isStraight = prevDir && dr === prevDir.dr && dc === prevDir.dc;
        const cross = prevDir ? turnCross(prevDir, { dr, dc }) : 0;

        let score = rng() * 1.5;
        // Wall-hugging bonus: classic mazes love hugging boundaries (nextDeg == 1 or 2)
        if (nextDeg === 1 || nextDeg === 2) score += 6.0;

        if (!prevDir) {
          score += 5.0;
        } else if (carverMode === 'SPIRAL_ROOM') {
          if (isStraight && straightSteps < legTarget) {
            score += 18.0;
          } else if (cross === lockedSpin) {
            // Turn in the locked spiral direction (Paperclip / U-bend)!
            score += straightSteps >= 2 ? 22.0 : 8.0;
          } else if (cross === -lockedSpin) {
            // Strongly penalize opposite turn so it coils into a paperclip instead of an S-wave!
            score -= 18.0;
          }
        } else if (carverMode === 'PERIMETER_LU') {
          if (isStraight && straightSteps < legTarget) {
            score += 24.0;
          } else if (cross === lockedSpin) {
            score += 16.0;
          } else {
            score -= 14.0;
          }
        } else {
          // CHICANE mode
          if (isStraight && straightSteps < legTarget) {
            score += 12.0;
          } else if (!isStraight) {
            score += 14.0;
          }
        }

        options.push({ nr, nc, nIdx, dr, dc, isStraight, score });
      }

      if (options.length === 0) break;
      options.sort((a, b) => b.score - a.score);
      const pick = options[0];

      addMazeEdge(curIdx, pick.nIdx);
      unvisited[pick.nIdx] = 0;
      remainingCount--;

      if (pick.isStraight) {
        straightSteps++;
      } else {
        straightSteps = 1;
        if (carverMode === 'SPIRAL_ROOM') {
          // Gradually tighten or vary the spiral leg length as it coils inward
          legTarget = Math.max(2, legTarget - (rng() < 0.6 ? 1 : 0));
        }
      }
      prevDir = { dr: pick.dr, dc: pick.dc };
      curR = pick.nr;
      curC = pick.nc;
      curIdx = pick.nIdx;
    }
  }

  return mazeAdj;
}

/**
 * Sample a target cut length along the maze corridor:
 * Designed to match Image 3 (Letter B) with ~65 - 88 arrows per board:
 * - ~25% Short Cuts (2 - 4 cells: straight pins & tight L/U hooks)
 * - ~42% Medium Cuts (5 - 12 cells: L-bends, U-channels, compact paperclips)
 * - ~33% Long Cuts (13 - 28 cells: large paperclip spirals, deep U-loops, long L-corridors)
 */
function sampleMazeCutLength(rng, stepIndex, minLen = 2, maxLen = 28) {
  const roll = (stepIndex * 0.381966 + rng() * 0.32) % 1.0;
  if (roll < 0.25) {
    const lo = Math.max(2, minLen);
    const hi = Math.min(4, maxLen);
    return lo + Math.floor(rng() * (hi - lo + 1));
  } else if (roll < 0.67) {
    const lo = Math.max(minLen, Math.min(5, maxLen));
    const hi = Math.max(lo, Math.min(12, maxLen));
    return lo + Math.floor(rng() * (hi - lo + 1));
  } else {
    const lo = Math.max(minLen, Math.min(13, maxLen));
    const hi = Math.max(lo, Math.min(28, maxLen));
    return lo + Math.floor(rng() * (hi - lo + 1));
  }
}

/**
 * Sample a Geometric Motif for cutting/extending along the maze:
 * - 'STRAIGHT' (16%): 0 turns (pure straight arrow)
 * - 'L_BEND' (24%): 1 turn (clean L-shaped arrow)
 * - 'U_BEND' (24%): 2 same-chirality turns (U-channel / hairpin foldback)
 * - 'PAPERCLIP' (24%): 3-6 same-chirality turns (inward-coiling paperclip spiral!)
 * - 'SERPENT' (12%): alternating turns (S-bend, kept low!)
 */
function sampleCutMotif(rng, stepIndex) {
  const roll = (stepIndex * 0.29 + rng() * 0.71) % 1.0;
  if (roll < 0.16) return 'STRAIGHT';
  if (roll < 0.40) return 'L_BEND';
  if (roll < 0.64) return 'U_BEND';
  if (roll < 0.88) return 'PAPERCLIP';
  return 'SERPENT';
}

/**
 * ============================================================================
 * STAGE 2: TRACE & CUT ALONG THE CLASSIC MAZE (`sliceMazeCorridor`)
 * Starting from the cut opening `chosen = (hr, hc) <- (pr, pc)`, follows the
 * Classic Maze edges `mazeAdj` backwards (and extends with the chosen motif
 * when a maze edge was already cut) to slice out a clean arrow!
 * ============================================================================
 */
function sliceMazeCorridor({
  chosen,
  targetLen,
  motif,
  rows,
  cols,
  remaining,
  mazeAdj,
  shadowedByFixed,
  rng,
}) {
  const path = [
    { r: chosen.hr, c: chosen.hc, idx: chosen.hIdx },
    { r: chosen.pr, c: chosen.pc, idx: chosen.pIdx },
  ];

  remaining[chosen.hIdx] = 0;
  remaining[chosen.pIdx] = 0;

  let bestPath = path.map(p => ({ ...p }));
  let bestScore = -1e9;

  // Determine the max allowed turns for this motif
  const maxMotifTurns =
    motif === 'STRAIGHT'
      ? 0
      : motif === 'L_BEND'
        ? 1
        : motif === 'U_BEND'
          ? 2
          : 6;

  // Lock a rotational chirality (+1 clockwise or -1 counter-clockwise) for U_BEND & PAPERCLIP!
  const lockedSpin = rng() < 0.5 ? 1 : -1;

  const evaluateCutPath = (curPath, turns, sameSpinTurns, oppSpinTurns, mazeEdgesUsed) => {
    for (let k = 1; k < curPath.length; k++) {
      const pt = curPath[k];
      if (createsIsolatedNeighbor(pt.r, pt.c, rows, cols, remaining, -1)) {
        return -1e9;
      }
    }
    const len = curPath.length;
    const lenDiff = Math.abs(targetLen - len);
    let score = -lenDiff * 5.5 + mazeEdgesUsed * 8.0;

    if (motif === 'STRAIGHT') {
      if (turns === 0) score += 40.0 + len * 3.0;
      else score -= turns * 35.0;
    } else if (motif === 'L_BEND') {
      if (turns === 1) score += 38.0;
      else if (turns === 0) score += 10.0;
      else score -= (turns - 1) * 28.0;
    } else if (motif === 'U_BEND') {
      if (turns === 2 && oppSpinTurns === 0) score += 45.0;
      else if (oppSpinTurns > 0) score -= oppSpinTurns * 30.0;
    } else if (motif === 'PAPERCLIP') {
      // Reward 3..6 same-chirality turns (true paperclip coil!) and heavily penalize opposite turns
      score += sameSpinTurns * 18.0 - oppSpinTurns * 32.0;
      if (sameSpinTurns >= 3 && oppSpinTurns === 0) score += 45.0;
    } else {
      // SERPENT
      score += oppSpinTurns * 12.0;
    }
    return score;
  };

  const initScore = evaluateCutPath(path, 0, 0, 0, chosen.isMazeEdge ? 1 : 0);
  if (initScore > bestScore) {
    bestScore = initScore;
    bestPath = path.map(p => ({ ...p }));
  }

  if (targetLen <= 2 && initScore > -1e8 && !chosen.forcedNext) {
    remaining[chosen.hIdx] = 1;
    remaining[chosen.pIdx] = 1;
    return bestPath;
  }

  const maxNodes = targetLen >= 12 ? 180 : 80;
  let nodesVisited = 0;
  let foundIdeal = false;

  function dfs(
    cur,
    prevDir,
    firstTurnSpin,
    straightRun,
    turns,
    sameSpinTurns,
    oppSpinTurns,
    mazeEdgesUsed,
    forcedCell
  ) {
    if (foundIdeal || nodesVisited >= maxNodes) return;
    nodesVisited++;

    const curLen = path.length;
    const sc = evaluateCutPath(path, turns, sameSpinTurns, oppSpinTurns, mazeEdgesUsed);
    if (sc > bestScore) {
      bestScore = sc;
      bestPath = path.map(p => ({ ...p }));
      if (
        curLen >= targetLen &&
        ((motif === 'STRAIGHT' && turns === 0) ||
          (motif === 'L_BEND' && turns === 1) ||
          (motif === 'U_BEND' && turns === 2 && oppSpinTurns === 0) ||
          (motif === 'PAPERCLIP' && sameSpinTurns >= 3 && oppSpinTurns === 0) ||
          motif === 'SERPENT')
      ) {
        foundIdeal = true;
        return;
      }
    }

    const effectiveCap =
      shadowedByFixed && shadowedByFixed[cur.idx] === 1 ? targetLen + 8 : targetLen;
    if (curLen >= effectiveCap) return;

    const options = [];
    for (const { dr, dc } of DIRS) {
      const nr = cur.r + dr;
      const nc = cur.c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const nIdx = nr * cols + nc;
      if (remaining[nIdx] !== 1) continue;
      if (forcedCell && forcedCell.idx !== nIdx) continue;

      const isTurn = dr !== prevDir.dr || dc !== prevDir.dc;
      if (isTurn && turns + 1 > maxMotifTurns && !(shadowedByFixed && shadowedByFixed[nIdx] === 1)) {
        continue;
      }

      remaining[nIdx] = 0;

      // Check if cur's other neighbors became degree-0 isolated cells
      let leftBehindIsolated = false;
      for (const dCheck of DIRS) {
        const cr = cur.r + dCheck.dr;
        const cc = cur.c + dCheck.dc;
        if (cr >= 0 && cr < rows && cc >= 0 && cc < cols) {
          const cIdx = cr * cols + cc;
          if (remaining[cIdx] === 1 && countNeighbors(cr, cc, rows, cols, remaining) === 0) {
            leftBehindIsolated = true;
            break;
          }
        }
      }
      if (leftBehindIsolated) {
        remaining[nIdx] = 1;
        continue;
      }

      let nextForced = null;
      let nextIsoCount = 0;
      for (const d2 of DIRS) {
        const nnr = nr + d2.dr;
        const nnc = nc + d2.dc;
        if (nnr >= 0 && nnr < rows && nnc >= 0 && nnc < cols) {
          const nnIdx = nnr * cols + nnc;
          if (remaining[nnIdx] === 1 && countNeighbors(nnr, nnc, rows, cols, remaining) === 0) {
            nextIsoCount++;
            nextForced = { r: nnr, c: nnc, idx: nnIdx };
          }
        }
      }
      const degAfter = countNeighbors(nr, nc, rows, cols, remaining);
      remaining[nIdx] = 1;

      if (nextIsoCount > 1) continue;

      const isMazeEdge = mazeAdj[cur.idx] && mazeAdj[cur.idx].has(nIdx);
      const isShadowed = shadowedByFixed && shadowedByFixed[nIdx] === 1;
      const cross = isTurn ? turnCross(prevDir, { dr, dc }) : 0;
      const desiredSpin = firstTurnSpin !== 0 ? firstTurnSpin : lockedSpin;

      let stepScore = rng() * 1.6;
      if (isShadowed) stepScore += 22.0;

      // Strongly prefer walking along the Classic Maze edges from Stage 1!
      if (isMazeEdge) stepScore += 14.0;
      if (degAfter === 1 || degAfter === 2) stepScore += 4.0;

      if (motif === 'STRAIGHT') {
        if (!isTurn) stepScore += 30.0;
        else stepScore -= 40.0;
      } else if (motif === 'L_BEND') {
        if (turns === 0) {
          // Walk straight for 3..8 cells, then make 1 clean 90° turn
          if (!isTurn && straightRun < Math.max(3, Math.floor(targetLen * 0.55))) {
            stepScore += 18.0;
          } else if (isTurn && straightRun >= 2) {
            stepScore += 22.0;
          }
        } else {
          // After the 1st turn, stay straight for the rest of the L!
          if (!isTurn) stepScore += 28.0;
          else stepScore -= 35.0;
        }
      } else if (motif === 'U_BEND') {
        if (!isTurn) {
          // Long first leg (3..8), short middle base (1..3), long parallel return leg (3..8)
          const idealLeg = turns === 1 ? 2 : Math.max(3, Math.floor(targetLen * 0.4));
          if (straightRun < idealLeg) stepScore += 16.0;
          else stepScore -= 6.0;
        } else {
          if (cross === desiredSpin && straightRun >= (turns === 1 ? 1 : 2)) {
            stepScore += 26.0;
          } else {
            stepScore -= 30.0; // Never turn the wrong way in a U-bend!
          }
        }
      } else if (motif === 'PAPERCLIP') {
        if (!isTurn) {
          // Paperclip spiral legs: outer legs 3..6 cells, inner legs 2..4 cells
          const idealLeg = Math.max(2, 5 - Math.floor(turns / 2));
          if (straightRun < idealLeg) stepScore += 15.0;
          else stepScore -= 8.0;
        } else {
          // MUST turn in the SAME chirality `desiredSpin` to form a Paperclip Spiral (回形针弯)!
          if (cross === desiredSpin && straightRun >= 2) {
            stepScore += 28.0;
          } else if (cross === desiredSpin && straightRun === 1 && turns >= 1) {
            stepScore += 12.0; // Allow tight inner paperclip core!
          } else {
            stepScore -= 35.0; // Block S-turns inside a Paperclip!
          }
        }
      } else {
        // SERPENT: alternating turns
        if (!isTurn && straightRun < 3) stepScore += 10.0;
        else if (isTurn && cross === -desiredSpin && straightRun >= 2) stepScore += 18.0;
      }

      options.push({
        r: nr,
        c: nc,
        idx: nIdx,
        dr,
        dc,
        isTurn,
        cross,
        isMazeEdge,
        nextForced,
        stepScore,
      });
    }

    options.sort((a, b) => b.stepScore - a.stepScore);

    for (const opt of options) {
      remaining[opt.idx] = 0;
      path.push({ r: opt.r, c: opt.c, idx: opt.idx });

      const nextSpin = opt.isTurn
        ? firstTurnSpin === 0
          ? opt.cross
          : firstTurnSpin
        : firstTurnSpin;
      const isSameSpin = opt.isTurn && (firstTurnSpin === 0 || opt.cross === firstTurnSpin);
      const isOppSpin = opt.isTurn && firstTurnSpin !== 0 && opt.cross !== firstTurnSpin;

      dfs(
        { r: opt.r, c: opt.c, idx: opt.idx },
        { dr: opt.dr, dc: opt.dc },
        motif === 'SERPENT' && opt.isTurn ? opt.cross : nextSpin,
        opt.isTurn ? 1 : straightRun + 1,
        turns + (opt.isTurn ? 1 : 0),
        sameSpinTurns + (isSameSpin ? 1 : 0),
        oppSpinTurns + (isOppSpin ? 1 : 0),
        mazeEdgesUsed + (opt.isMazeEdge ? 1 : 0),
        opt.nextForced
      );

      path.pop();
      remaining[opt.idx] = 1;
      if (foundIdeal || nodesVisited >= maxNodes) break;
    }
  }

  dfs(
    { r: chosen.pr, c: chosen.pc, idx: chosen.pIdx },
    { dr: -chosen.dr, dc: -chosen.dc },
    0,
    1,
    0,
    0,
    0,
    chosen.isMazeEdge ? 1 : 0,
    chosen.forcedNext || null
  );

  remaining[chosen.hIdx] = 1;
  remaining[chosen.pIdx] = 1;

  return bestPath;
}

/**
 * Main Two-Stage Generator:
 * 1. Builds a Classic Maze on `targetGrid` (`buildClassicMazeGraph`)
 * 2. Cuts openings and attaches arrowheads along the maze corridors (`sliceMazeCorridor`)
 */
export function partitionCellsIntoArrows({
  rows,
  cols,
  targetGrid,
  fixedObstacleGrid = null,
  minLen = 2,
  maxLen = 28,
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
  const peeledStepGrid = new Uint16Array(rows * cols);
  const peeledDirGrid = new Uint8Array(rows * cols);

  // Interlocking & Multi-Line Dispersion trackers
  const globalDirCount = [0, 0, 0, 0];
  const rowHorizDirCount = Array.from({ length: rows }, () => [0, 0, 0, 0]);
  const colVertDirCount = Array.from({ length: cols }, () => [0, 0, 0, 0]);
  const placedHeads = []; // { r, c, dirIdx }
  const dependentsCount = new Uint16Array(512); // How many arrows are directly unlocked by step `s`
  let unblockedFrontierCount = 0;
  let prevChosenDirIdx = -1;

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

  // STAGE 1: Generate the Classic Maze corridor graph on `remaining`!
  const mazeAdj = buildClassicMazeGraph(rows, cols, remaining, rng);

  let totalRemaining = 0;
  for (let i = 0; i < rows * cols; i++) {
    if (remaining[i] === 1) totalRemaining++;
  }

  const arrows = [];
  let nextId = startId;
  let stepIndex = 0;

  // STAGE 2: Cut openings along the Classic Maze corridors and attach arrowheads
  while (totalRemaining > 0) {
    const candidates = [];
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

          const rayCheck = checkRayOnGrid(
            r,
            c,
            dr,
            dc,
            rows,
            cols,
            obstacles,
            peeledGrid,
            peeledStepGrid,
            peeledDirGrid
          );
          if (rayCheck.clear) {
            const isMazeEdge = mazeAdj[hIdx] && mazeAdj[hIdx].has(pIdx);
            candidates.push({
              hr: r,
              hc: c,
              hIdx,
              pr,
              pc,
              pIdx,
              dr,
              dc,
              dirIdx: dirToIdx(dr, dc),
              isMazeEdge,
              passedPeeled: rayCheck.passedPeeled,
              latestBlockerStep: rayCheck.latestBlockerStep,
              latestBlockerDir: rayCheck.latestBlockerDir,
              orthoBlockers: rayCheck.orthoBlockers,
              sameDirBlockers: rayCheck.sameDirBlockers,
              oppDirBlockers: rayCheck.oppDirBlockers,
              distinctBlockers: rayCheck.distinctBlockers,
            });
          }
        }
      }
    }

    if (candidates.length === 0) {
      let absorbedIntoExisting = false;
      for (let i = arrows.length - 1; i >= 0; i--) {
        const existingArrow = arrows[i];
        const existDirIdx = dirToIdx(existingArrow.dir.dr, existingArrow.dir.dc);
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
              peeledStepGrid[nIdx] = i + 1;
              peeledDirGrid[nIdx] = existDirIdx;
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
            const rayCheck = checkRayOnGrid(
              r,
              c,
              dr,
              dc,
              rows,
              cols,
              remaining,
              peeledGrid,
              peeledStepGrid,
              peeledDirGrid
            );
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
                dirIdx: dirToIdx(dr, dc),
                isMazeEdge: mazeAdj[hIdx] && mazeAdj[hIdx].has(pIdx),
                passedPeeled: rayCheck.passedPeeled,
                latestBlockerStep: rayCheck.latestBlockerStep,
                latestBlockerDir: rayCheck.latestBlockerDir,
                orthoBlockers: rayCheck.orthoBlockers,
                sameDirBlockers: rayCheck.sameDirBlockers,
                oppDirBlockers: rayCheck.oppDirBlockers,
                distinctBlockers: rayCheck.distinctBlockers,
              });
            }
          }
        }
      }
      if (candidates.length === 0) break;
    }

    const motif = sampleCutMotif(rng, stepIndex);
    const targetLen =
      motif === 'STRAIGHT'
        ? rng() < 0.55
          ? 2 + Math.floor(rng() * 3) // 2..4 short straight pin
          : 6 + Math.floor(rng() * 9) // 6..14 long straight spear
        : sampleMazeCutLength(rng, stepIndex, minLen, maxLen);
    stepIndex++;

    const avgGlobalDir = arrows.length / 4;

    const scoreCandidate = cand => {
      const dIdx = cand.dirIdx;
      const degH = countNeighbors(cand.hr, cand.hc, rows, cols, remaining);

      let w = 10.0 + (cand.isMazeEdge ? 14.0 : 0) + (degH === 1 ? 3.5 : 0) + rng() * 2.2;

      // 1. TIGHT INITIAL FRONTIER (4 QUADRANT SEEDS) & DEEP DEPENDENCY CHAIN:
      // Allow 4 initial unblocked entry arrows (1 in each direction & spread across the 4 quadrants),
      // then force all remaining ~95% of arrows to be deeply interlocked (`passedPeeled > 0`)!
      if (cand.passedPeeled === 0) {
        if (unblockedFrontierCount >= 4) {
          w -= 85.0;
        } else {
          // Force the 4 initial unblocked arrows to have 4 distinct directions and be far apart!
          if (globalDirCount[dIdx] > 0) {
            w -= 60.0;
          } else {
            w += 30.0;
          }
          if (placedHeads.length > 0) {
            let minDist = 999;
            for (const ph of placedHeads) {
              const d = Math.abs(ph.r - cand.hr) + Math.abs(ph.c - cand.hc);
              if (d < minDist) minDist = d;
            }
            w += Math.min(35.0, minDist * 1.6);
          }
        }
      } else {
        // Must cross peeled cells!
        w += 18.0 + Math.min(3, cand.distinctBlockers) * 7.5;

        // Prevent a single obstacle arrow from unlocking 5..8 arrows at once!
        const depCount = dependentsCount[cand.latestBlockerStep] || 0;
        if (depCount === 0) {
          // Chaining off a blocker that hasn't unlocked any arrow yet builds a deep puzzle tree!
          w += 28.0;
          if (cand.latestBlockerStep === arrows.length) {
            w += 14.0; // Direct causal chain from the arrow just peeled
          }
        } else {
          w -= Math.min(depCount, 3) * 18.0;
        }

        // 2. ORTHOGONAL CROSS-LOCKING vs SAME-DIRECTION CASCADE PENALTY:
        const bDir = cand.latestBlockerDir;
        if (bDir >= 0) {
          if (bDir === dIdx) {
            // Same direction as its blocker -> clearing blocker creates a trivial same-direction cascade!
            w -= 48.0;
          } else if ((bDir < 2) !== (dIdx < 2)) {
            // Orthogonal 90-degree cross-lock (Horizontal blocks Vertical, Vertical blocks Horizontal)!
            w += 32.0;
          } else {
            // Opposite 180-degree antiparallel lock
            w += 18.0;
          }
        }
        w += cand.orthoBlockers * 4.0 - cand.sameDirBlockers * 8.0;
      }

      // 3. LOCAL 9x9 NEIGHBORHOOD DIRECTION DIVERSITY:
      // Never allow a local cluster of arrows to point in the same direction!
      let localSameDir = 0;
      let localSameAxis = 0;
      for (const ph of placedHeads) {
        const drAbs = Math.abs(ph.r - cand.hr);
        const dcAbs = Math.abs(ph.c - cand.hc);
        if (drAbs <= 4 && dcAbs <= 4) {
          if (ph.dirIdx === dIdx) {
            localSameDir += drAbs <= 2 && dcAbs <= 2 ? 2 : 1;
          } else if ((ph.dirIdx < 2) === (dIdx < 2)) {
            localSameAxis++;
          }
        }
      }
      w -= localSameDir * 24.0 + localSameAxis * 6.0;

      // 4. MULTI-LINE DISPERSION FOR HORIZONTAL & VERTICAL ARROWS:
      // Spread horizontal arrows across many different rows, and vertical arrows across many different columns!
      if (dIdx >= 2) {
        // Horizontal arrow (LEFT=2, RIGHT=3) on row `cand.hr`
        const r = cand.hr;
        const sameDirOnRow = rowHorizDirCount[r][dIdx];
        const totalHorizOnRow = rowHorizDirCount[r][2] + rowHorizDirCount[r][3];
        let adjSameDir = 0;
        if (r > 0) adjSameDir += rowHorizDirCount[r - 1][dIdx];
        if (r + 1 < rows) adjSameDir += rowHorizDirCount[r + 1][dIdx];
        w -= sameDirOnRow * 28.0 + totalHorizOnRow * 12.0 + adjSameDir * 14.0;
      } else {
        // Vertical arrow (UP=0, DOWN=1) on col `cand.hc`
        const c = cand.hc;
        const sameDirOnCol = colVertDirCount[c][dIdx];
        const totalVertOnCol = colVertDirCount[c][0] + colVertDirCount[c][1];
        let adjSameDir = 0;
        if (c > 0) adjSameDir += colVertDirCount[c - 1][dIdx];
        if (c + 1 < cols) adjSameDir += colVertDirCount[c + 1][dIdx];
        w -= sameDirOnCol * 28.0 + totalVertOnCol * 12.0 + adjSameDir * 14.0;
      }

      // 5. GLOBAL 4-DIRECTION BALANCE & STEP-TO-STEP DIRECTION SWITCHING:
      w += (avgGlobalDir - globalDirCount[dIdx]) * 26.0;
      if (dIdx === prevChosenDirIdx) {
        w -= 38.0;
      } else if (prevChosenDirIdx >= 0 && (dIdx < 2) !== (prevChosenDirIdx < 2)) {
        w += 18.0;
      }

      return w;
    };

    const cleanCandidates = [];
    for (const cand of candidates) {
      remaining[cand.hIdx] = 0;
      remaining[cand.pIdx] = 0;
      const headIsolates = createsIsolatedNeighbor(cand.hr, cand.hc, rows, cols, remaining, -1);
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
        const weight = scoreCandidate(cand);
        cleanCandidates.push({ ...cand, forcedNext, weight });
      }
    }

    let pool =
      cleanCandidates.length > 0
        ? cleanCandidates
        : candidates.map(c => ({ ...c, weight: scoreCandidate(c) }));

    // Strictly enforce deep interlocking: once 4 quadrant-distributed entry arrows are placed,
    // prefer blocked candidates (`passedPeeled > 0`), unless a direction is underrepresented
    // and needs a fresh border breach (`unblockedFrontierCount < 8`).
    if (unblockedFrontierCount >= 4) {
      const interlockedPool = pool.filter(
        c =>
          c.passedPeeled > 0 ||
          (unblockedFrontierCount < 8 && globalDirCount[c.dirIdx] + 2 < avgGlobalDir)
      );
      if (interlockedPool.length > 0) {
        pool = interlockedPool;
      }
    }

    pool.sort((a, b) => (b.weight || 0) - (a.weight || 0));
    const topK = Math.min(pool.length, 3);
    const chosen = pool[Math.floor(rng() * topK)];

    // Slice along the Classic Maze corridor!
    const reversedCells = sliceMazeCorridor({
      chosen,
      targetLen,
      motif,
      rows,
      cols,
      remaining,
      mazeAdj,
      shadowedByFixed,
      rng,
    });

    const curArrowStep = arrows.length + 1;
    const chosenDirIdx = chosen.dirIdx;

    for (const cell of reversedCells) {
      remaining[cell.idx] = 0;
      obstacles[cell.idx] = 0;
      peeledGrid[cell.idx] = 1;
      peeledStepGrid[cell.idx] = curArrowStep;
      peeledDirGrid[cell.idx] = chosenDirIdx;
      totalRemaining--;
    }

    // Absorb any single degree-0 cell adjacent to the tail
    let curTail = reversedCells[reversedCells.length - 1];
    let absorbed = true;
    while (absorbed && totalRemaining > 0) {
      absorbed = false;
      for (const { dr, dc } of DIRS) {
        const nr = curTail.r + dr;
        const nc = curTail.c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
          const nIdx = nr * cols + nc;
          if (remaining[nIdx] === 1 && countNeighbors(nr, nc, rows, cols, remaining) === 0) {
            const tailCell = { r: nr, c: nc, idx: nIdx };
            reversedCells.push(tailCell);
            remaining[nIdx] = 0;
            obstacles[nIdx] = 0;
            peeledGrid[nIdx] = 1;
            peeledStepGrid[nIdx] = curArrowStep;
            peeledDirGrid[nIdx] = chosenDirIdx;
            totalRemaining--;
            curTail = tailCell;
            absorbed = true;
            break;
          }
        }
      }
    }

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

    // Update Interlocking & Multi-Line Dispersion trackers
    globalDirCount[chosenDirIdx]++;
    if (chosenDirIdx >= 2) {
      rowHorizDirCount[chosen.hr][chosenDirIdx]++;
    } else {
      colVertDirCount[chosen.hc][chosenDirIdx]++;
    }
    placedHeads.push({ r: chosen.hr, c: chosen.hc, dirIdx: chosenDirIdx });
    if (chosen.passedPeeled === 0) {
      unblockedFrontierCount++;
    } else if (chosen.latestBlockerStep > 0 && chosen.latestBlockerStep < dependentsCount.length) {
      dependentsCount[chosen.latestBlockerStep]++;
    }
    prevChosenDirIdx = chosenDirIdx;

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

  for (const orphan of orphanCells) {
    for (const arrow of arrows) {
      const tail = arrow.cells[0];
      if (Math.abs(tail.r - orphan.r) + Math.abs(tail.c - orphan.c) === 1) {
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

  // Maze Corridor Re-Stitching Pass (Only stitches fragments if the combined path
  // forms a clean Straight, L-Bend, U-Bend, or Paperclip — NEVER stitches into an S-bend!)
  const maxDesiredArrows = 86;
  let stitched = true;
  while (stitched) {
    stitched = false;
    for (let j = arrows.length - 1; j >= 1; j--) {
      const frag = arrows[j];
      if (!frag || frag.cells.length > 4) continue;
      // Keep ~16-22 intentional short 2-3 cell arrows unless total arrow count exceeds 86
      const shortCount = arrows.filter(a => a.cells.length <= 3).length;
      if (shortCount <= 18 && arrows.length <= maxDesiredArrows) break;

      const fragStart = frag.cells[0];
      const fragEnd = frag.cells[frag.cells.length - 1];

      for (let i = j - 1; i >= 0; i--) {
        const host = arrows[i];
        if (!host || host.cells.length + frag.cells.length > 30) continue;

        const hostTail = host.cells[0];
        const adjToEnd =
          Math.abs(hostTail.r - fragEnd.r) + Math.abs(hostTail.c - fragEnd.c) === 1;
        const adjToStart =
          Math.abs(hostTail.r - fragStart.r) + Math.abs(hostTail.c - fragStart.c) === 1;

        if (adjToEnd || adjToStart) {
          // Ensure none of frag's cells lie on host's own forward exit ray
          const hdr = host.dir.dr;
          const hdc = host.dir.dc;
          let blocksHostOwnRay = false;
          for (const fc of frag.cells) {
            if (
              (hdr !== 0 && fc.c === host.head.c && (fc.r - host.head.r) * hdr > 0) ||
              (hdc !== 0 && fc.r === host.head.r && (fc.c - host.head.c) * hdc > 0)
            ) {
              blocksHostOwnRay = true;
              break;
            }
          }
          if (blocksHostOwnRay) continue;

          const candidateCells = adjToEnd
            ? [...frag.cells, ...host.cells]
            : [...frag.cells.slice().reverse(), ...host.cells];
          const newShape = classifyArrowShape(candidateCells);
          // Only stitch if the resulting shape is NOT a Serpent S-wave (unless total > maxDesiredArrows)
          if (newShape !== 'SERPENT' || arrows.length > maxDesiredArrows) {
            host.cells = candidateCells;
            arrows.splice(j, 1);
            stitched = true;
            break;
          }
        }
      }
      if (stitched) break;
    }
  }

  for (let i = 0; i < arrows.length; i++) {
    arrows[i].id = startId + i;
    arrows[i].color = ARROW_PALETTE[(i * 3 + (seed % 7)) % ARROW_PALETTE.length];
  }

  return arrows;
}

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
      minLen: levelDef.minSnakeLen || 2,
      maxLen: levelDef.maxSnakeLen || 28,
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

export function shuffleRemainingArrows(currentArrows, rows, cols, seed, levelDef = {}) {
  const remainingArrows = currentArrows.filter(a => !a.removed);
  if (remainingArrows.length === 0) return [];

  const targetGrid = new Uint8Array(rows * cols);
  for (const arrow of remainingArrows) {
    for (const cell of arrow.cells) {
      targetGrid[cell.r * cols + cell.c] = 1;
    }
  }

  for (let attempt = 0; attempt < 12; attempt++) {
    const newArrows = partitionCellsIntoArrows({
      rows,
      cols,
      targetGrid,
      minLen: levelDef.minSnakeLen || 2,
      maxLen: levelDef.maxSnakeLen || 28,
      seed: seed + attempt * 131,
      startId: 1,
    });
    if (verifySolvable(newArrows, rows, cols).solvable) {
      return newArrows;
    }
  }
  return remainingArrows;
}

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
      minLen: levelDef.minSnakeLen || 2,
      maxLen: levelDef.maxSnakeLen || 28,
      seed: seed + attempt * 193,
      startId: maxExistingId + 1,
    });

    const combined = [...outerArrows, ...activeShuffled];
    if (verifySolvable(combined, rows, cols).solvable) {
      return combined;
    }
  }

  return generateFullLevel(
    {
      id: levelDef.id || 0,
      mask: fullMask,
      minSnakeLen: levelDef.minSnakeLen || 2,
      maxSnakeLen: levelDef.maxSnakeLen || 28,
      expectedSeconds: levelDef.expectedSeconds || 240,
      seed,
    },
    seed
  ).arrows;
}
