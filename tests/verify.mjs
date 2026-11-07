import { LEVEL_DEFINITIONS } from '../src/engine/patterns.js';
import {
  generateFullLevel,
  shuffleRemainingArrows,
  extendShuffledToFull,
  classifyArrowShape,
} from '../src/engine/generator.js';
import {
  verifySolvable,
  getRandomHintArrow,
  getRemovableArrows,
} from '../src/engine/solver.js';

let passed = 0;
let failed = 0;

console.log('=== Running Classic-Maze Cut-and-Orient 26-Alphabet Verification ===\n');

for (const levelDef of LEVEL_DEFINITIONS) {
  const t0 = performance.now();
  const level = generateFullLevel(levelDef);
  const t1 = performance.now();

  const check1 = verifySolvable(level.arrows, level.rows, level.cols);
  if (!check1.solvable) {
    console.error(`[FAIL] Level ${levelDef.id} (${levelDef.name}) initial generation not solvable!`);
    failed++;
    continue;
  }

  const lengths = level.arrows.map(a => a.cells.length);
  const minL = Math.min(...lengths);
  const maxL = Math.max(...lengths);
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const stdDev = Math.sqrt(
    lengths.reduce((acc, l) => acc + (l - mean) ** 2, 0) / lengths.length
  );

  const shapeCounts = {
    STRAIGHT: 0,
    L_BEND: 0,
    U_BEND: 0,
    PAPERCLIP: 0,
    SERPENT: 0,
  };
  const dirCounts = { UP: 0, DOWN: 0, LEFT: 0, RIGHT: 0 };
  const horizRows = new Set();
  const vertCols = new Set();

  for (const arrow of level.arrows) {
    const type = classifyArrowShape(arrow.cells);
    shapeCounts[type] = (shapeCounts[type] || 0) + 1;
    if (arrow.dir.dr === -1) {
      dirCounts.UP++;
      vertCols.add(arrow.head.c);
    } else if (arrow.dir.dr === 1) {
      dirCounts.DOWN++;
      vertCols.add(arrow.head.c);
    } else if (arrow.dir.dc === -1) {
      dirCounts.LEFT++;
      horizRows.add(arrow.head.r);
    } else {
      dirCounts.RIGHT++;
      horizRows.add(arrow.head.r);
    }
  }

  const initRemovable = getRemovableArrows(level.arrows, level.rows, level.cols).length;

  // Measure direction-switch rate along the canonical solution order
  let dirSwitches = 0;
  for (let i = 1; i < level.arrows.length; i++) {
    const prev = level.arrows[i - 1].dir;
    const cur = level.arrows[i].dir;
    if (prev.dr !== cur.dr || prev.dc !== cur.dc) {
      dirSwitches++;
    }
  }
  const switchPct = Math.round((dirSwitches / Math.max(1, level.arrows.length - 1)) * 100);

  if (level.arrows.length >= 100) {
    console.error(`[FAIL] Level ${levelDef.id} arrow count ${level.arrows.length} >= 100!`);
    failed++;
    continue;
  }

  // Simulate clearing ~35% of the arrows legitimately
  const simArrows = level.arrows.map(a => ({
    ...a,
    cells: a.cells.map(c => ({ ...c })),
    removed: false,
  }));
  const targetClear = Math.max(1, Math.floor(simArrows.length * 0.35));
  for (let k = 0; k < targetClear; k++) {
    const hint = getRandomHintArrow(simArrows, level.rows, level.cols);
    if (!hint) break;
    hint.removed = true;
  }

  const shuffled = shuffleRemainingArrows(
    simArrows,
    level.rows,
    level.cols,
    levelDef.seed + 555,
    levelDef
  );
  const check2 = verifySolvable(shuffled, level.rows, level.cols);
  if (!check2.solvable) {
    console.error(`[FAIL] Level ${levelDef.id} Shuffle not solvable!`);
    failed++;
    continue;
  }

  const extendedFull = extendShuffledToFull(
    shuffled,
    level.mask,
    level.rows,
    level.cols,
    levelDef.seed + 777,
    levelDef
  );
  const check3 = verifySolvable(extendedFull, level.rows, level.cols);
  if (!check3.solvable || extendedFull.length <= shuffled.length) {
    console.error(
      `[FAIL] Level ${levelDef.id} Shuffle->Restart extension failed! solvable=${check3.solvable}`
    );
    failed++;
    continue;
  }

  console.log(
    `[PASS] #${String(levelDef.id).padStart(2, '0')} [${levelDef.letter}] | ` +
      `Arrows:${String(level.arrows.length).padStart(2, ' ')} | ` +
      `Dirs(↑${String(dirCounts.UP).padStart(2, ' ')}/↓${String(dirCounts.DOWN).padStart(2, ' ')}/←${String(dirCounts.LEFT).padStart(2, ' ')}/→${String(dirCounts.RIGHT).padStart(2, ' ')}) | ` +
      `Lines(H:${horizRows.size}行/V:${vertCols.size}列) | ` +
      `开局可消:${initRemovable} | 转向率:${switchPct}% | ` +
      `直:${shapeCounts.STRAIGHT} L:${shapeCounts.L_BEND} U:${shapeCounts.U_BEND} 回形针:${shapeCounts.PAPERCLIP} 蛇:${shapeCounts.SERPENT}`
  );
  passed++;
}

console.log(`\n=== Summary: ${passed}/26 Classic-Maze Alphabet levels passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
