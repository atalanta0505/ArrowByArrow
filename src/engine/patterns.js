/**
 * 26 English Alphabet Levels (A - Z) for 《一箭又一箭》 (Arrow by Arrow)
 * Each level is sculpted in the shape of a bold capital letter A..Z on a 34x28 grid,
 * tuned for < 100 arrows per board with high length variance (short 2-4 cell lock arrows
 * + medium 8-15 cell winding arrows + long 18-38 cell tortuous multi-bend snakes).
 */

export function sanitizeMask(mask) {
  const R = mask.length;
  const C = mask[0].length;
  const out = mask.map(row => [...row]);

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

function buildLetterMask(rows, cols, shapeFn) {
  const mask = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) return 0;
      const ny = ((r - 1) / (rows - 3)) * 2 - 1; // -1 (top) .. +1 (bottom)
      const nx = ((c - 1) / (cols - 3)) * 2 - 1; // -1 (left) .. +1 (right)
      return shapeFn(nx, ny, r, c, rows, cols) ? 1 : 0;
    })
  );
  return sanitizeMask(mask);
}

/**
 * Signed distance from (px, py) to segment (ax, ay) -> (bx, by)
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
 * Axis-aligned box check: |x - cx| <= hx && |y - cy| <= hy
 */
function inBox(px, py, cx, cy, hx, hy) {
  return Math.abs(px - cx) <= hx && Math.abs(py - cy) <= hy;
}

/**
 * Elliptical ring check
 */
function inRing(px, py, cx, cy, rx, ry, innerRatio = 0.42) {
  const d = Math.hypot((px - cx) / rx, (py - cy) / ry);
  return d <= 1.0 && d >= innerRatio;
}

/**
 * 26 Bold Capital Letters A - Z
 * Stroke thickness is generous (~0.48 to 0.56 in normalized [-1,1] space, i.e. 6-8 grid cells wide)
 * so long snakes can coil and make multiple 90-degree switchbacks inside every stroke!
 */
const ALPHABET_SHAPES = [
  {
    letter: 'A',
    title: '字母 A · 巅峰金字塔',
    expectedSeconds: 240,
    fn: (x, y) => {
      const leftLeg = sdSegment(x, y, -0.06, -0.76, -0.68, 0.8) <= 0.27;
      const rightLeg = sdSegment(x, y, 0.06, -0.76, 0.68, 0.8) <= 0.27;
      const crossbar = inBox(x, y, 0, 0.22, 0.56, 0.21);
      const topCrown = inBox(x, y, 0, -0.72, 0.34, 0.2);
      const hole = Math.abs(x) <= (y + 0.38) * 0.36 && y > -0.35 && y < 0.02;
      return (leftLeg || rightLeg || crossbar || topCrown) && !hole;
    },
  },
  {
    letter: 'B',
    title: '字母 B · 经典双环迷阵',
    expectedSeconds: 300,
    fn: (x, y) => {
      const leftSpine = x >= -0.88 && x <= -0.22 && Math.abs(y) <= 0.92;
      const topLoop =
        Math.hypot((x + 0.06) * 0.9, (y + 0.45) * 1.1) <= 0.64 &&
        Math.hypot((x + 0.02) * 1.05, (y + 0.45) * 1.15) >= 0.22;
      const botLoop =
        Math.hypot((x + 0.03) * 0.86, (y - 0.45) * 1.1) <= 0.68 &&
        Math.hypot((x + 0.0) * 1.05, (y - 0.45) * 1.15) >= 0.24;
      const topBar = y >= -0.92 && y <= -0.62 && x >= -0.88 && x <= 0.36;
      const midBar = Math.abs(y) <= 0.18 && x >= -0.88 && x <= 0.42;
      const botBar = y >= 0.62 && y <= 0.92 && x >= -0.88 && x <= 0.45;
      return leftSpine || topLoop || botLoop || topBar || midBar || botBar;
    },
  },
  {
    letter: 'C',
    title: '字母 C · 新月弯弓',
    expectedSeconds: 260,
    fn: (x, y) => {
      const ring = inRing(x, y, 0.04, 0, 0.92, 0.94, 0.3);
      const opening = x > 0.28 && Math.abs(y) < 0.28;
      const topSerif = inBox(x, y, 0.56, -0.52, 0.32, 0.26);
      const botSerif = inBox(x, y, 0.56, 0.52, 0.32, 0.26);
      return (ring && !opening) || topSerif || botSerif;
    },
  },
  {
    letter: 'D',
    title: '字母 D · 圣殿巨盾',
    expectedSeconds: 270,
    fn: (x, y) => {
      const spine = inBox(x, y, -0.56, 0, 0.32, 0.92);
      const arc = inRing(x, y, -0.12, 0, 0.96, 0.92, 0.38) && x >= -0.35;
      const topBar = inBox(x, y, -0.25, -0.7, 0.52, 0.22);
      const botBar = inBox(x, y, -0.25, 0.7, 0.52, 0.22);
      const innerHole = x > -0.22 && Math.hypot((x + 0.15) / 0.42, y / 0.42) < 0.85;
      return (spine || arc || topBar || botBar) && !innerHole;
    },
  },
  {
    letter: 'E',
    title: '字母 E · 三重回廊',
    expectedSeconds: 270,
    fn: (x, y) => {
      const spine = inBox(x, y, -0.56, 0, 0.32, 0.92);
      const topBar = inBox(x, y, 0.02, -0.7, 0.86, 0.22);
      const midBar = inBox(x, y, -0.06, 0, 0.72, 0.21);
      const botBar = inBox(x, y, 0.02, 0.7, 0.86, 0.22);
      return spine || topBar || midBar || botBar;
    },
  },
  {
    letter: 'F',
    title: '字母 F · 双翼旌旗',
    expectedSeconds: 240,
    fn: (x, y) => {
      const spine = inBox(x, y, -0.52, 0, 0.34, 0.92);
      const topBar = inBox(x, y, 0.04, -0.68, 0.86, 0.24);
      const midBar = inBox(x, y, -0.04, -0.02, 0.72, 0.22);
      const foot = inBox(x, y, -0.42, 0.74, 0.44, 0.18);
      return spine || topBar || midBar || foot;
    },
  },
  {
    letter: 'G',
    title: '字母 G · 旋涡引力',
    expectedSeconds: 300,
    fn: (x, y) => {
      const ring = inRing(x, y, 0.02, 0, 0.9, 0.92, 0.36);
      const gap = x > 0.18 && y < -0.06 && y > -0.42;
      const shelf = inBox(x, y, 0.38, 0.12, 0.5, 0.21);
      const spur = inBox(x, y, 0.62, 0.42, 0.26, 0.38);
      return (ring && !gap) || shelf || spur;
    },
  },
  {
    letter: 'H',
    title: '字母 H · 双子天桥',
    expectedSeconds: 280,
    fn: (x, y) => {
      const leftPillar = inBox(x, y, -0.58, 0, 0.32, 0.92);
      const rightPillar = inBox(x, y, 0.58, 0, 0.32, 0.92);
      const bridge = inBox(x, y, 0, 0, 0.65, 0.25);
      return leftPillar || rightPillar || bridge;
    },
  },
  {
    letter: 'I',
    title: '字母 I · 擎天圣柱',
    expectedSeconds: 260,
    fn: (x, y) => {
      const topCap = inBox(x, y, 0, -0.66, 0.88, 0.28);
      const pillar = inBox(x, y, 0, 0, 0.46, 0.92);
      const botCap = inBox(x, y, 0, 0.66, 0.88, 0.28);
      return topCap || pillar || botCap;
    },
  },
  {
    letter: 'J',
    title: '字母 J · 沧海钩戟',
    expectedSeconds: 260,
    fn: (x, y) => {
      const topCap = inBox(x, y, 0.12, -0.66, 0.78, 0.28);
      const stem = inBox(x, y, 0.32, -0.04, 0.42, 0.72);
      const hook = inRing(x, y, -0.06, 0.36, 0.82, 0.58, 0.26) && y >= 0.06;
      const leftTip = inBox(x, y, -0.56, 0.2, 0.34, 0.3);
      return topCap || stem || hook || leftTip;
    },
  },
  {
    letter: 'K',
    title: '字母 K · 破晓战戟',
    expectedSeconds: 300,
    fn: (x, y) => {
      const spine = inBox(x, y, -0.56, 0, 0.32, 0.92);
      const upperArm = sdSegment(x, y, -0.25, 0.05, 0.64, -0.74) <= 0.28;
      const lowerArm = sdSegment(x, y, -0.2, -0.05, 0.64, 0.74) <= 0.28;
      const knot = inBox(x, y, -0.2, 0, 0.32, 0.24);
      return spine || upperArm || lowerArm || knot;
    },
  },
  {
    letter: 'L',
    title: '字母 L · 铁壁角楼',
    expectedSeconds: 260,
    fn: (x, y) => {
      const topSerif = inBox(x, y, -0.42, -0.7, 0.48, 0.22);
      const spine = inBox(x, y, -0.46, 0, 0.42, 0.92);
      const base = inBox(x, y, 0.04, 0.62, 0.88, 0.32);
      const cornerTip = inBox(x, y, 0.6, 0.36, 0.32, 0.38);
      return topSerif || spine || base || cornerTip;
    },
  },
  {
    letter: 'M',
    title: '字母 M · 群峰双峡',
    expectedSeconds: 330,
    fn: (x, y) => {
      const ax = Math.abs(x);
      const outerPillar = inBox(ax, y, 0.64, 0, 0.26, 0.92);
      const diag = sdSegment(ax, y, 0.64, -0.72, 0.0, 0.28) <= 0.25;
      const centerDrop = inBox(x, y, 0, 0.15, 0.24, 0.42);
      return outerPillar || diag || centerDrop;
    },
  },
  {
    letter: 'N',
    title: '字母 N · 斜阳回廊',
    expectedSeconds: 300,
    fn: (x, y) => {
      const leftPillar = inBox(x, y, -0.58, 0, 0.3, 0.92);
      const rightPillar = inBox(x, y, 0.58, 0, 0.3, 0.92);
      const diag = sdSegment(x, y, -0.48, -0.68, 0.48, 0.68) <= 0.27;
      return leftPillar || rightPillar || diag;
    },
  },
  {
    letter: 'O',
    title: '字母 O · 永恒星环',
    expectedSeconds: 280,
    fn: (x, y) => {
      return inRing(x, y, 0, 0, 0.88, 0.92, 0.38);
    },
  },
  {
    letter: 'P',
    title: '字母 P · 皇家权杖',
    expectedSeconds: 270,
    fn: (x, y) => {
      const spine = inBox(x, y, -0.56, 0, 0.32, 0.92);
      const topBowl =
        Math.hypot((x + 0.04) * 0.86, (y + 0.32) * 1.05) <= 0.72 &&
        Math.hypot((x + 0.02) * 1.05, (y + 0.32) * 1.1) >= 0.24;
      const foot = inBox(x, y, -0.38, 0.72, 0.48, 0.2);
      return spine || topBowl || foot;
    },
  },
  {
    letter: 'Q',
    title: '字母 Q · 深渊魔戒',
    expectedSeconds: 320,
    fn: (x, y) => {
      const ring = inRing(x, y, 0, -0.05, 0.86, 0.86, 0.36);
      const tail = sdSegment(x, y, 0.1, 0.2, 0.72, 0.82) <= 0.26;
      return ring || tail;
    },
  },
  {
    letter: 'R',
    title: '字母 R · 骑士纹章',
    expectedSeconds: 320,
    fn: (x, y) => {
      const spine = inBox(x, y, -0.56, 0, 0.32, 0.92);
      const topBowl =
        Math.hypot((x + 0.04) * 0.86, (y + 0.4) * 1.1) <= 0.68 &&
        Math.hypot((x + 0.0) * 1.05, (y + 0.4) * 1.15) >= 0.23;
      const leg = sdSegment(x, y, -0.15, 0.02, 0.64, 0.78) <= 0.27;
      const topBar = inBox(x, y, -0.25, -0.72, 0.55, 0.2);
      return spine || topBowl || leg || topBar;
    },
  },
  {
    letter: 'S',
    title: '字母 S · 灵蛇盘踞',
    expectedSeconds: 300,
    fn: (x, y) => {
      const topLoop =
        y <= 0.12 &&
        inRing(x, y, 0, -0.42, 0.82, 0.52, 0.28) &&
        !(x > 0.2 && y > -0.32);
      const botLoop =
        y >= -0.12 &&
        inRing(x, y, 0, 0.42, 0.82, 0.52, 0.28) &&
        !(x < -0.2 && y < 0.32);
      const diag = sdSegment(x, y, -0.46, -0.24, 0.46, 0.24) <= 0.27;
      return topLoop || botLoop || diag;
    },
  },
  {
    letter: 'T',
    title: '字母 T · 雷神战锤',
    expectedSeconds: 260,
    fn: (x, y) => {
      const topBar = inBox(x, y, 0, -0.62, 0.9, 0.32);
      const topEars = inBox(Math.abs(x), y, 0.68, -0.4, 0.24, 0.3);
      const stem = inBox(x, y, 0, 0.08, 0.44, 0.84);
      const base = inBox(x, y, 0, 0.72, 0.64, 0.22);
      return topBar || topEars || stem || base;
    },
  },
  {
    letter: 'U',
    title: '字母 U · 深谷马蹄',
    expectedSeconds: 270,
    fn: (x, y) => {
      const ax = Math.abs(x);
      const pillars = inBox(ax, y, 0.58, -0.22, 0.3, 0.7);
      const bottomArc = y >= 0.1 && inRing(x, y, 0, 0.28, 0.88, 0.64, 0.35);
      return pillars || bottomArc;
    },
  },
  {
    letter: 'V',
    title: '字母 V · 胜利双翼',
    expectedSeconds: 260,
    fn: (x, y) => {
      const ax = Math.abs(x);
      const wing = sdSegment(ax, y, 0.66, -0.74, 0.04, 0.74) <= 0.28;
      const topSerif = inBox(ax, y, 0.62, -0.72, 0.26, 0.2);
      const tip = inBox(x, y, 0, 0.68, 0.32, 0.24);
      return wing || topSerif || tip;
    },
  },
  {
    letter: 'W',
    title: '字母 W · 沧海龙吟',
    expectedSeconds: 340,
    fn: (x, y) => {
      const ax = Math.abs(x);
      const outerPillar = inBox(ax, y, 0.64, 0, 0.26, 0.92);
      const diag = sdSegment(ax, -y, 0.64, -0.72, 0.0, 0.28) <= 0.25;
      const centerPeak = inBox(x, y, 0, -0.15, 0.24, 0.42);
      return outerPillar || diag || centerPeak;
    },
  },
  {
    letter: 'X',
    title: '字母 X · 星十字刃',
    expectedSeconds: 280,
    fn: (x, y) => {
      const d1 = sdSegment(x, y, -0.64, -0.74, 0.64, 0.74) <= 0.27;
      const d2 = sdSegment(x, y, 0.64, -0.74, -0.64, 0.74) <= 0.27;
      const serifs = inBox(Math.abs(x), Math.abs(y), 0.56, 0.74, 0.3, 0.18);
      return d1 || d2 || serifs;
    },
  },
  {
    letter: 'Y',
    title: '字母 Y · 圣杯分岔',
    expectedSeconds: 260,
    fn: (x, y) => {
      const ax = Math.abs(x);
      const upperFork = sdSegment(ax, y, 0.64, -0.74, 0.0, 0.05) <= 0.28;
      const stem = inBox(x, y, 0, 0.42, 0.36, 0.5);
      const base = inBox(x, y, 0, 0.74, 0.54, 0.18);
      return upperFork || stem || base;
    },
  },
  {
    letter: 'Z',
    title: '字母 Z · 雷霆折光',
    expectedSeconds: 280,
    fn: (x, y) => {
      const topBar = inBox(x, y, 0, -0.68, 0.86, 0.24);
      const botBar = inBox(x, y, 0, 0.68, 0.86, 0.24);
      const diag = sdSegment(x, y, 0.62, -0.58, -0.62, 0.58) <= 0.27;
      const centerBelt = inBox(x, y, 0, 0, 0.48, 0.18);
      return topBar || botBar || diag || centerBelt;
    },
  },
];

export const LEVEL_DEFINITIONS = ALPHABET_SHAPES.map((item, idx) => {
  const id = idx + 1;
  const rows = 38;
  const cols = 32;
  return {
    id,
    letter: item.letter,
    name: item.title,
    difficulty: idx < 8 ? '字母初阶' : idx < 18 ? '曲折进阶' : '烧脑大师',
    expectedSeconds: item.expectedSeconds,
    seed: 20260 + id * 509,
    minSnakeLen: 2,
    maxSnakeLen: 40,
    mask: buildLetterMask(rows, cols, item.fn),
  };
});
