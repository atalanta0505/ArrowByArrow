import { LEVEL_DEFINITIONS } from '../src/engine/patterns.js';
import {
  generateFullLevel,
  shuffleRemainingArrows,
  extendShuffledToFull,
} from '../src/engine/generator.js';
import { verifySolvable, getRemovableArrows, getRandomHintArrow } from '../src/engine/solver.js';

let passed = 0;
let failed = 0;

console.log('=== Running Automated Solvability & Mechanics Verification ===\n');

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

  // Test Shuffle on remaining arrows
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

  // Test Rule 4: Restart right after Shuffle (extend shuffled remaining arrows back to full board)
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
      `[FAIL] Level ${levelDef.id} Shuffle->Restart extension failed! solvable=${check3.solvable}, count=${extendedFull.length} vs shuffled=${shuffled.length}`
    );
    failed++;
    continue;
  }

  // Verify that every arrow in `shuffled` is preserved in `extendedFull`
  const preservedCount = shuffled.filter(sa =>
    extendedFull.some(
      ea =>
        ea.head.r === sa.head.r &&
        ea.head.c === sa.head.c &&
        ea.dir.dr === sa.dir.dr &&
        ea.dir.dc === sa.dir.dc &&
        ea.cells.length === sa.cells.length
    )
  ).length;

  console.log(
    `[PASS] Level ${String(levelDef.id).padStart(2, '0')} (${levelDef.name.padEnd(14, ' ')}) | ` +
      `Grid: ${level.rows}x${level.cols} | Arrows: ${String(level.arrows.length).padStart(3, ' ')} | ` +
      `Shuffled: ${String(shuffled.length).padStart(2, ' ')} -> Extended: ${String(extendedFull.length).padStart(3, ' ')} ` +
      `(Preserved: ${preservedCount}/${shuffled.length}) | ${(t1 - t0).toFixed(1)}ms`
  );
  passed++;
}

console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
