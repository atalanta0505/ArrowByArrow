/**
 * 100 High-Density Levels for 《一箭又一箭》 (Arrow by Arrow)
 * Designed to match the exact grid density of the original WeChat mini-game (32x28 to 42x36 grids,
 * 90 to 200+ winding snake arrows per board, with 16:9 mobile portrait proportion).
 */

export function sanitizeMask(mask) {
  const R = mask.length;
  const C = mask[0].length;
  const out = mask.map(row => [...row]);

  // Remove or connect any degree-0 or degree-1 isolated 1-cell islands
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 8) {
    changed = false;
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        if (out[r][c] === 1) {
          let neighbors = 0;
          if (r > 0 && out[r - 1][c] === 1) neighbors++;
          if (r < R - 1 && out[r + 1][c] === 1) neighbors++;
          if (c > 0 && out[r][c - 1] === 1) neighbors++;
          if (c < C - 1 && out[r][c + 1] === 1) neighbors++;
          if (neighbors === 0) {
            out[r][c] = 0;
            changed = true;
          }
        }
      }
    }
  }
  return out;
}

/**
 * Create a high-density grid mask with 1-cell dot padding around the shape
 * so empty grid dots are visible around and inside the silhouette like Screenshot 1 & 2.
 */
function buildHighDensityMask(rows, cols, shapeFn) {
  const mask = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      // Leave 1 cell margin on outer border so external dots frame the shape nicely
      if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) return 0;
      const ny = ((r - 1) / (rows - 3)) * 2 - 1; // -1 .. +1
      const nx = ((c - 1) / (cols - 3)) * 2 - 1; // -1 .. +1
      return shapeFn(nx, ny, r, c, rows, cols) ? 1 : 0;
    })
  );
  return sanitizeMask(mask);
}

/**
 * Distance from point (px, py) to segment (ax, ay)-(bx, by)
 */
function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay || 1)));
  return Math.hypot(pax - bax * h, pay - bay * h);
}

/**
 * Distance to box centered at (cx, cy) with half-extents (hx, hy)
 */
function sdBox(px, py, cx, cy, hx, hy) {
  const dx = Math.abs(px - cx) - hx;
  const dy = Math.abs(py - cy) - hy;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
}

/**
 * Distance to circle/ellipse
 */
function sdRing(px, py, cx, cy, radius, thickness) {
  return Math.abs(Math.hypot(px - cx, py - cy) - radius) - thickness;
}

/**
 * High-resolution bold glyph & emblem primitives (thick strokes like Screenshot Level 17 "B")
 */
const SHAPE_BUILDERS = [
  // 1. Bold Capital 'B' (The exact iconic shape from the user's Level 17 screenshot!)
  {
    name: '经典重装 · B字迷宫',
    fn: (nx, ny) => {
      const leftSpine = nx >= -0.88 && nx <= -0.22 && Math.abs(ny) <= 0.92;
      const topLoop =
        Math.hypot((nx + 0.08) * 0.92, (ny + 0.46) * 1.12) <= 0.62 &&
        Math.hypot((nx + 0.05) * 1.0, (ny + 0.46) * 1.15) >= 0.22;
      const botLoop =
        Math.hypot((nx + 0.05) * 0.88, (ny - 0.46) * 1.12) <= 0.66 &&
        Math.hypot((nx + 0.02) * 1.0, (ny - 0.46) * 1.15) >= 0.23;
      const topBar = ny >= -0.92 && ny <= -0.64 && nx >= -0.88 && nx <= 0.35;
      const midBar = Math.abs(ny) <= 0.16 && nx >= -0.88 && nx <= 0.42;
      const botBar = ny >= 0.64 && ny <= 0.92 && nx >= -0.88 && nx <= 0.45;
      return leftSpine || topLoop || botLoop || topBar || midBar || botBar;
    },
  },
  // 2. Bold 'S' Serpent
  {
    name: '灵蛇盘踞 · S形迷阵',
    fn: (nx, ny) => {
      const topArc =
        ny <= 0.1 &&
        sdRing(nx, (ny + 0.44) * 1.1, 0, 0, 0.48, 0.28) <= 0 &&
        !(nx > 0.15 && ny > -0.35);
      const botArc =
        ny >= -0.1 &&
        sdRing(nx, (ny - 0.44) * 1.1, 0, 0, 0.48, 0.28) <= 0 &&
        !(nx < -0.15 && ny < 0.35);
      const diag = sdSegment(nx, ny, -0.45, -0.25, 0.45, 0.25) <= 0.27;
      return topArc || botArc || diag;
    },
  },
  // 3. Giant Full Heart
  {
    name: '炽热之心 · 满格巨心',
    fn: (nx, ny) => {
      const x = nx * 1.12;
      const y = -ny * 1.1 + 0.18;
      const a = x * x + y * y - 0.62;
      const inside = a * a * a - x * x * y * y * y <= 0;
      const centerHole = Math.hypot(nx, ny + 0.05) < 0.2;
      return inside && !centerHole;
    },
  },
  // 4. Royal Double-Ring Target
  {
    name: '星环同心 · 双子魔环',
    fn: (nx, ny) => {
      const d = Math.hypot(nx, ny);
      const outer = d <= 0.96 && d >= 0.56;
      const inner = d <= 0.38;
      const cross = (Math.abs(nx) <= 0.18 || Math.abs(ny) <= 0.18) && d <= 0.96;
      return outer || inner || cross;
    },
  },
  // 5. Bold Figure '8' Hourglass
  {
    name: '无限回廊 · 八字天枢',
    fn: (nx, ny) => {
      const top =
        Math.hypot(nx * 0.92, (ny + 0.45) * 1.15) <= 0.66 &&
        Math.hypot(nx, (ny + 0.46) * 1.15) >= 0.22;
      const bot =
        Math.hypot(nx * 0.88, (ny - 0.45) * 1.15) <= 0.7 &&
        Math.hypot(nx, (ny - 0.46) * 1.15) >= 0.24;
      const waist = Math.abs(ny) <= 0.18 && Math.abs(nx) <= 0.52;
      return top || bot || waist;
    },
  },
  // 6. Imperial Butterfly
  {
    name: '凤尾蝶翼 · 幻彩对称',
    fn: (nx, ny) => {
      const ax = Math.abs(nx);
      const upperWing = Math.hypot((ax - 0.45) * 0.95, (ny + 0.35) * 1.05) <= 0.52;
      const lowerWing = Math.hypot((ax - 0.38) * 1.05, (ny - 0.42) * 1.05) <= 0.46;
      const body = ax <= 0.18 && Math.abs(ny) <= 0.85;
      const eyeHole = Math.hypot(ax - 0.52, ny + 0.38) < 0.16;
      return (upperWing || lowerWing || body) && !eyeHole;
    },
  },
  // 7. Four-Window Fortress
  {
    name: '九宫重城 · 四象方阵',
    fn: (nx, ny) => {
      const inSquare = Math.abs(nx) <= 0.94 && Math.abs(ny) <= 0.94;
      const hole =
        Math.abs(nx) >= 0.22 &&
        Math.abs(nx) <= 0.56 &&
        Math.abs(ny) >= 0.22 &&
        Math.abs(ny) <= 0.56;
      return inSquare && !hole;
    },
  },
  // 8. Bold Letter 'A'
  {
    name: '巅峰王座 · A字高塔',
    fn: (nx, ny) => {
      const leftLeg = sdSegment(nx, ny, 0, -0.82, -0.68, 0.82) <= 0.26;
      const rightLeg = sdSegment(nx, ny, 0, -0.82, 0.68, 0.82) <= 0.26;
      const crossbar = Math.abs(ny - 0.18) <= 0.2 && Math.abs(nx) <= 0.55;
      const topCap = Math.abs(ny + 0.72) <= 0.18 && Math.abs(nx) <= 0.35;
      return leftLeg || rightLeg || crossbar || topCap;
    },
  },
  // 9. Bold Letter 'G'
  {
    name: '玄武盘旋 · G字引力',
    fn: (nx, ny) => {
      const ring = sdRing(nx, ny, 0, 0, 0.62, 0.28) <= 0 && !(nx > 0.2 && ny < -0.05 && ny > -0.45);
      const shelf = ny >= -0.08 && ny <= 0.28 && nx >= -0.05 && nx <= 0.88;
      const pillar = nx >= 0.42 && nx <= 0.88 && ny >= -0.08 && ny <= 0.75;
      return ring || shelf || pillar;
    },
  },
  // 10. Giant Five-Pointed Star Emblem
  {
    name: '耀世星芒 · 五角星阵',
    fn: (nx, ny) => {
      const angle = Math.atan2(ny, nx) + Math.PI / 2;
      const r = Math.hypot(nx, ny);
      const starBound = 0.68 + 0.26 * Math.cos(angle * 5);
      const centerHole = r < 0.2;
      return r <= starBound && !centerHole;
    },
  },
  // 11. Bold Letter 'M'
  {
    name: '群峰耸立 · M字双峡',
    fn: (nx, ny) => {
      const ax = Math.abs(nx);
      const outerPillar = ax >= 0.46 && ax <= 0.92 && Math.abs(ny) <= 0.9;
      const vDiagonal = sdSegment(ax, ny, 0.7, -0.78, 0.0, 0.35) <= 0.25;
      const centerSpike = ax <= 0.24 && ny >= -0.25 && ny <= 0.65;
      return outerPillar || vDiagonal || centerSpike;
    },
  },
  // 12. Bold Letter 'R'
  {
    name: '骑士战旗 · R字纹章',
    fn: (nx, ny) => {
      const spine = nx >= -0.88 && nx <= -0.22 && Math.abs(ny) <= 0.92;
      const topBowl =
        Math.hypot((nx + 0.05) * 0.88, (ny + 0.42) * 1.1) <= 0.66 &&
        Math.hypot((nx + 0.02) * 1.0, (ny + 0.42) * 1.15) >= 0.22;
      const leg = sdSegment(nx, ny, -0.15, 0.02, 0.65, 0.82) <= 0.26;
      const topBar = ny >= -0.92 && ny <= -0.62 && nx >= -0.88 && nx <= 0.35;
      return spine || topBowl || leg || topBar;
    },
  },
  // 13. Ornate Chinese Lantern
  {
    name: '盛世华灯 · 宫灯迷阵',
    fn: (nx, ny) => {
      const body = Math.hypot(nx * 0.92, ny * 1.08) <= 0.86;
      const topCap = Math.abs(ny + 0.82) <= 0.14 && Math.abs(nx) <= 0.52;
      const botCap = Math.abs(ny - 0.82) <= 0.14 && Math.abs(nx) <= 0.52;
      const slitL = Math.abs(nx + 0.35) <= 0.11 && Math.abs(ny) <= 0.42;
      const slitR = Math.abs(nx - 0.35) <= 0.11 && Math.abs(ny) <= 0.42;
      return (body || topCap || botCap) && !slitL && !slitR;
    },
  },
  // 14. Four-Leaf Clover
  {
    name: '四叶奇迹 · 幸运草堂',
    fn: (nx, ny) => {
      const ax = Math.abs(nx);
      const ay = Math.abs(ny);
      const leaf = Math.hypot(ax - 0.4, ay - 0.4) <= 0.48;
      const core = Math.hypot(nx, ny) <= 0.34;
      const hole = Math.hypot(ax - 0.48, ay - 0.48) < 0.14;
      return (leaf || core) && !hole;
    },
  },
  // 15. Bold Letter 'Q'
  {
    name: '深渊之眼 · Q字魔戒',
    fn: (nx, ny) => {
      const ring = sdRing(nx, ny, 0, -0.04, 0.62, 0.28) <= 0;
      const tail = sdSegment(nx, ny, 0.08, 0.15, 0.72, 0.82) <= 0.24;
      const innerBar = Math.abs(ny + 0.04) <= 0.14 && Math.abs(nx) <= 0.38;
      return ring || tail || innerBar;
    },
  },
  // 16. Royal Crown
  {
    name: '至尊王冠 · 黄金冕旒',
    fn: (nx, ny) => {
      const base = ny >= 0.28 && ny <= 0.88 && Math.abs(nx) <= 0.9;
      const midBand = ny >= -0.25 && ny <= 0.35 && Math.abs(nx) <= 0.86;
      const leftPeak = sdSegment(nx, ny, -0.75, 0.2, -0.82, -0.78) <= 0.22;
      const rightPeak = sdSegment(nx, ny, 0.75, 0.2, 0.82, -0.78) <= 0.22;
      const centerPeak = sdSegment(nx, ny, 0, 0.25, 0, -0.85) <= 0.24;
      const diagL = sdSegment(nx, ny, -0.78, -0.68, 0, 0.1) <= 0.2;
      const diagR = sdSegment(nx, ny, 0.78, -0.68, 0, 0.1) <= 0.2;
      const jewelHole = Math.abs(ny - 0.56) <= 0.12 && Math.abs( Math.abs(nx) - 0.42 ) <= 0.14;
      return (base || midBand || leftPeak || rightPeak || centerPeak || diagL || diagR) && !jewelHole;
    },
  },
  // 17. Bold Letter 'K'
  {
    name: '破晓之刃 · K字战戟',
    fn: (nx, ny) => {
      const spine = nx >= -0.88 && nx <= -0.22 && Math.abs(ny) <= 0.92;
      const upperArm = sdSegment(nx, ny, -0.3, 0.05, 0.68, -0.78) <= 0.27;
      const lowerArm = sdSegment(nx, ny, -0.2, -0.05, 0.68, 0.78) <= 0.27;
      const crossBlock = Math.abs(ny) <= 0.25 && nx >= -0.88 && nx <= 0.25;
      return spine || upperArm || lowerArm || crossBlock;
    },
  },
  // 18. Owl Guardian
  {
    name: '暗夜枭雄 · 守望图腾',
    fn: (nx, ny) => {
      const body = Math.hypot(nx * 0.95, (ny - 0.12) * 0.92) <= 0.86;
      const head = Math.hypot(nx * 1.0, (ny + 0.52) * 1.2) <= 0.78;
      const earL = sdSegment(nx, ny, -0.45, -0.5, -0.75, -0.88) <= 0.22;
      const earR = sdSegment(nx, ny, 0.45, -0.5, 0.75, -0.88) <= 0.22;
      const eyeL = Math.hypot(nx + 0.34, ny + 0.42) < 0.18;
      const eyeR = Math.hypot(nx - 0.34, ny + 0.42) < 0.18;
      const bellyHole = Math.hypot(nx, ny - 0.38) < 0.2;
      return (body || head || earL || earR) && !eyeL && !eyeR && !bellyHole;
    },
  },
  // 19. Bold Number '2' / Swan
  {
    name: '凌波天鹅 · 贰字迷局',
    fn: (nx, ny) => {
      const topArc =
        ny <= 0.05 &&
        sdRing(nx, (ny + 0.42) * 1.1, 0, 0, 0.5, 0.28) <= 0 &&
        !(nx < -0.25 && ny > -0.25);
      const diag = sdSegment(nx, ny, 0.52, -0.25, -0.62, 0.72) <= 0.27;
      const base = ny >= 0.48 && ny <= 0.92 && Math.abs(nx) <= 0.88;
      return topArc || diag || base;
    },
  },
  // 20. Bold Number '5'
  {
    name: '五岳独尊 · 伍字矩阵',
    fn: (nx, ny) => {
      const topBar = ny >= -0.92 && ny <= -0.52 && nx >= -0.86 && nx <= 0.82;
      const leftDrop = nx >= -0.86 && nx <= -0.24 && ny >= -0.92 && ny <= 0.08;
      const midBar = Math.abs(ny + 0.05) <= 0.22 && nx >= -0.86 && nx <= 0.45;
      const botLoop =
        ny >= -0.2 &&
        sdRing(nx, (ny - 0.38) * 1.08, 0.02, 0, 0.5, 0.28) <= 0 &&
        !(nx < -0.35 && ny < 0.42 && ny > 0.08);
      return topBar || leftDrop || midBar || botLoop;
    },
  },
  // 21. Bold Number '6'
  {
    name: '六合乾坤 · 陆字旋涡',
    fn: (nx, ny) => {
      const outerC = sdRing(nx, ny * 0.92, 0.05, 0, 0.62, 0.27) <= 0 && !(nx > 0.25 && ny < -0.15);
      const botLoop = sdRing(nx, (ny - 0.35) * 1.1, 0, 0, 0.48, 0.26) <= 0;
      const bridge = Math.abs(ny - 0.02) <= 0.2 && Math.abs(nx) <= 0.65;
      return outerC || botLoop || bridge;
    },
  },
  // 22. Bold Number '9'
  {
    name: '九霄云外 · 玖字神殿',
    fn: (nx, ny) => {
      const outerC = sdRing(nx, ny * 0.92, -0.05, 0, 0.62, 0.27) <= 0 && !(nx < -0.25 && ny > 0.15);
      const topLoop = sdRing(nx, (ny + 0.35) * 1.1, 0, 0, 0.48, 0.26) <= 0;
      const bridge = Math.abs(ny + 0.02) <= 0.2 && Math.abs(nx) <= 0.65;
      return outerC || topLoop || bridge;
    },
  },
  // 23. Bold Letter 'E' & Comb Maze
  {
    name: '千层书阁 · E字回廊',
    fn: (nx, ny) => {
      const spine = nx >= -0.88 && nx <= -0.25 && Math.abs(ny) <= 0.92;
      const topBar = ny >= -0.92 && ny <= -0.52 && nx >= -0.88 && nx <= 0.86;
      const midBar = Math.abs(ny) <= 0.22 && nx >= -0.88 && nx <= 0.72;
      const botBar = ny >= 0.52 && ny <= 0.92 && nx >= -0.88 && nx <= 0.86;
      const rightTipTop = nx >= 0.42 && nx <= 0.86 && ny >= -0.92 && ny <= -0.28;
      const rightTipBot = nx >= 0.42 && nx <= 0.86 && ny >= 0.28 && ny <= 0.92;
      return spine || topBar || midBar || botBar || rightTipTop || rightTipBot;
    },
  },
  // 24. Bold Letter 'H' Cathedral
  {
    name: '双子天桥 · H字连城',
    fn: (nx, ny) => {
      const ax = Math.abs(nx);
      const pillars = ax >= 0.34 && ax <= 0.9 && Math.abs(ny) <= 0.92;
      const bridge = Math.abs(ny) <= 0.28 && ax <= 0.9;
      const topArch = ny <= -0.58 && ny >= -0.92 && ax <= 0.65;
      const botArch = ny >= 0.58 && ny <= 0.92 && ax <= 0.65;
      return pillars || bridge || topArch || botArch;
    },
  },
  // 25. Bold Letter 'W'
  {
    name: '沧海龙吟 · W字深谷',
    fn: (nx, ny) => {
      const ax = Math.abs(nx);
      const outerPillar = ax >= 0.46 && ax <= 0.92 && Math.abs(ny) <= 0.9;
      const vDiagonal = sdSegment(ax, -ny, 0.7, -0.78, 0.0, 0.35) <= 0.25;
      const centerSpike = ax <= 0.24 && ny >= -0.65 && ny <= 0.25;
      return outerPillar || vDiagonal || centerSpike;
    },
  },
  // 26. Bold Letter 'Z'
  {
    name: '雷霆闪电 · Z字风暴',
    fn: (nx, ny) => {
      const topBar = ny >= -0.92 && ny <= -0.48 && Math.abs(nx) <= 0.88;
      const botBar = ny >= 0.48 && ny <= 0.92 && Math.abs(nx) <= 0.88;
      const diag = sdSegment(nx, ny, 0.65, -0.6, -0.65, 0.6) <= 0.28;
      const centerBelt = Math.abs(ny) <= 0.18 && Math.abs(nx) <= 0.55;
      return topBar || botBar || diag || centerBelt;
    },
  },
  // 27. Bold Letter 'P' & Loop
  {
    name: '战锤勋章 · P字圣殿',
    fn: (nx, ny) => {
      const spine = nx >= -0.88 && nx <= -0.22 && Math.abs(ny) <= 0.92;
      const topBowl =
        Math.hypot((nx + 0.05) * 0.85, (ny + 0.35) * 1.05) <= 0.72 &&
        Math.hypot((nx + 0.02) * 1.0, (ny + 0.35) * 1.1) >= 0.23;
      const foot = ny >= 0.52 && ny <= 0.92 && nx >= -0.88 && nx <= 0.45;
      return spine || topBowl || foot;
    },
  },
  // 28. Anchor of Poseidon
  {
    name: '海神巨锚 · 深渊铁壁',
    fn: (nx, ny) => {
      const ring = sdRing(nx, ny, 0, -0.58, 0.26, 0.14) <= 0;
      const shaft = Math.abs(nx) <= 0.22 && ny >= -0.42 && ny <= 0.88;
      const crossbar = Math.abs(ny + 0.16) <= 0.18 && Math.abs(nx) <= 0.72;
      const fluke =
        ny >= 0.05 &&
        sdRing(nx, (ny - 0.1) * 1.05, 0, 0, 0.68, 0.24) <= 0;
      return ring || shaft || crossbar || fluke;
    },
  },
  // 29. Celtic Shield Knot
  {
    name: '凯尔特盾 · 圣堂盘结',
    fn: (nx, ny) => {
      const oct = Math.abs(nx) + Math.abs(ny) <= 1.38 && Math.max(Math.abs(nx), Math.abs(ny)) <= 0.92;
      const ax = Math.abs(nx);
      const ay = Math.abs(ny);
      const windowHole = ax >= 0.24 && ax <= 0.52 && ay >= 0.24 && ay <= 0.52;
      return oct && !windowHole;
    },
  },
  // 30. Yin-Yang Dual Vortex
  {
    name: '太极两仪 · 阴阳双鱼',
    fn: (nx, ny) => {
      const d = Math.hypot(nx, ny);
      const eye1 = Math.hypot(nx, ny + 0.45) < 0.18;
      const eye2 = Math.hypot(nx, ny - 0.45) < 0.18;
      return d <= 0.94 && !eye1 && !eye2;
    },
  },
];

const DIFFICULTY_TIERS = [
  { maxId: 20, label: '高密初阶', baseRows: 36, baseCols: 30, expectedSec: 360, minLen: 3, maxLen: 8 },
  { maxId: 50, label: '高密进阶', baseRows: 38, baseCols: 32, expectedSec: 450, minLen: 3, maxLen: 9 },
  { maxId: 80, label: '烧脑大师', baseRows: 40, baseCols: 34, expectedSec: 540, minLen: 3, maxLen: 10 },
  { maxId: 100, label: '传奇宗师', baseRows: 42, baseCols: 36, expectedSec: 600, minLen: 3, maxLen: 10 },
];

/**
 * Apply subtle organic variations (rotations/mirrors/inner carve patterns) for levels 31..100
 * while keeping Level 17 strictly locked to the iconic Bold 'B' from the screenshot!
 */
function buildLevelDefinition(id) {
  const tier = DIFFICULTY_TIERS.find(t => id <= t.maxId) || DIFFICULTY_TIERS[DIFFICULTY_TIERS.length - 1];

  // Ensure Level 17 is specifically the Bold 'B' from the user's screenshot!
  let builderIdx;
  if (id === 17) {
    builderIdx = 0; // Bold 'B'
  } else if (id === 1) {
    builderIdx = 0; // Let Level 1 also start with the iconic high-density Bold 'B' style!
  } else if (id === 2) {
    builderIdx = 1; // Bold 'S' Serpent
  } else {
    builderIdx = (id * 7 + Math.floor(id / 3)) % SHAPE_BUILDERS.length;
  }

  const baseBuilder = SHAPE_BUILDERS[builderIdx];
  const variant = Math.floor((id - 1) / SHAPE_BUILDERS.length);

  const rows = id === 17 ? 38 : tier.baseRows;
  const cols = id === 17 ? 32 : tier.baseCols;

  const mask = buildHighDensityMask(rows, cols, (nx, ny, r, c) => {
    let x = nx;
    let y = ny;
    // Apply symmetry/orientation variations on higher cycles (except Level 17 which stays canonical)
    if (id !== 17) {
      if (variant === 1) {
        x = -nx;
      } else if (variant === 2) {
        y = -ny;
      } else if (variant >= 3) {
        x = -nx;
        y = -ny;
      }
    }
    return baseBuilder.fn(x, y, r, c, rows, cols);
  });

  const suffix = variant > 0 && id !== 17 ? ` · 贰式` : '';
  const name = id === 17 ? '经典17关 · B字迷宫' : `${baseBuilder.name}${suffix}`;

  return {
    id,
    name,
    difficulty: tier.label,
    expectedSeconds: tier.expectedSec,
    seed: 10000 + id * 313,
    minSnakeLen: tier.minLen,
    maxSnakeLen: tier.maxLen,
    mask,
  };
}

export const LEVEL_DEFINITIONS = Array.from({ length: 100 }, (_, i) =>
  buildLevelDefinition(i + 1)
);
