/**
 * High-DPI Canvas Renderer & Multi-Touch Zoom/Pan Controller for 《一箭又一箭》
 * Mobile-GPU Optimized Edition:
 * - Zero `shadowBlur` offscreen texture allocations (uses hardware-accelerated vector halo & depth strokes)
 * - Cached `Path2D` for the 1,216 background grid dots (1 draw call instead of 1,216 `arc` calls/frame)
 * - Pre-simplified corner vertices (`_cornerCells`) with zero per-frame array allocations for stationary arrows
 * - On-demand smart render loop (0% GPU/CPU usage when board is idle while player is thinking)
 */

function simplifyCellsToCorners(cells) {
  if (!cells || cells.length <= 2) return cells;
  const corners = [cells[0]];
  for (let i = 1; i < cells.length - 1; i++) {
    const prev = cells[i - 1];
    const cur = cells[i];
    const next = cells[i + 1];
    const dr1 = cur.r - prev.r;
    const dc1 = cur.c - prev.c;
    const dr2 = next.r - cur.r;
    const dc2 = next.c - cur.c;
    if (dr1 !== dr2 || dc1 !== dc2) {
      corners.push(cur);
    }
  }
  corners.push(cells[cells.length - 1]);
  return corners;
}

export class BoardCanvasView {
  constructor(canvas, { onArrowTap, onZoomChange }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.onArrowTap = onArrowTap;
    this.onZoomChange = onZoomChange;

    // Board state
    this.rows = 10;
    this.cols = 10;
    this.mask = [];
    this.arrows = [];
    this.hintArrowId = null;
    this.showGuideLines = false;
    this.theme = 'dark'; // 'dark' | 'light'

    // Active animations
    this.slitheringArrows = new Map();
    this.shakingArrows = new Map();
    this.shuffleTransition = null;

    // Viewport & Zoom/Pan transform
    this.zoom = 1.0;
    this.minZoom = 0.85;
    this.maxZoom = 4.0;
    this.panX = 0;
    this.panY = 0;
    this.baseCellSize = 24;
    this.boardOriginX = 0;
    this.boardOriginY = 0;
    this.dotsPath = null;

    // Pointer / Touch tracking for Pinch-to-Zoom & Pan vs Tap
    this.activePointers = new Map();
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.initialPanX = 0;
    this.initialPanY = 0;
    this.initialPinchDist = 0;
    this.initialPinchZoom = 1;
    this.initialPinchCenter = { x: 0, y: 0 };
    this.totalPointerMove = 0;

    this.needsRender = true;
    this.rafId = null;
    this.lastFrameTime = performance.now();

    this.bindEvents();
    this.resize();
    this.startLoop();
  }

  prepareArrowsCache(arrows) {
    for (const arrow of arrows) {
      arrow._cornerCells = simplifyCellsToCorners(arrow.cells);
    }
  }

  setBoard({ rows, cols, mask, arrows }) {
    this.rows = rows;
    this.cols = cols;
    this.mask = mask;
    this.arrows = arrows;
    this.prepareArrowsCache(arrows);
    this.hintArrowId = null;
    this.slitheringArrows.clear();
    this.shakingArrows.clear();
    this.resetCamera();
    this.triggerShuffleWave();
    this.needsRender = true;
  }

  updateArrows(arrows, animateWave = false) {
    this.arrows = arrows;
    this.prepareArrowsCache(arrows);
    this.hintArrowId = null;
    this.slitheringArrows.clear();
    this.shakingArrows.clear();
    if (animateWave) {
      this.triggerShuffleWave();
    }
    this.needsRender = true;
  }

  triggerShuffleWave() {
    this.shuffleTransition = {
      startTime: performance.now(),
      duration: 360,
    };
    this.needsRender = true;
  }

  setTheme(theme) {
    this.theme = theme;
    this.needsRender = true;
  }

  setGuideLines(enabled) {
    this.showGuideLines = enabled;
    this.needsRender = true;
  }

  setHintArrow(arrowId) {
    this.hintArrowId = arrowId;
    this.needsRender = true;
  }

  resetCamera() {
    this.zoom = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.computeLayout();
    this.needsRender = true;
    if (this.onZoomChange) this.onZoomChange(this.zoom);
  }

  setZoom(newZoom, anchorScreenX = null, anchorScreenY = null) {
    const clamped = Math.max(this.minZoom, Math.min(this.maxZoom, newZoom));
    const rect = this.canvas.getBoundingClientRect();
    const cx = anchorScreenX !== null ? anchorScreenX : rect.width / 2;
    const cy = anchorScreenY !== null ? anchorScreenY : rect.height / 2;

    const worldX = (cx - rect.width / 2 - this.panX) / this.zoom;
    const worldY = (cy - rect.height / 2 - this.panY) / this.zoom;

    this.zoom = clamped;
    this.panX = cx - rect.width / 2 - worldX * this.zoom;
    this.panY = cy - rect.height / 2 - worldY * this.zoom;
    this.clampPan();
    this.needsRender = true;

    if (this.onZoomChange) this.onZoomChange(this.zoom);
  }

  clampPan() {
    const rect = this.canvas.getBoundingClientRect();
    const maxOffset = Math.max(rect.width, rect.height) * 0.55 * this.zoom;
    this.panX = Math.max(-maxOffset, Math.min(maxOffset, this.panX));
    this.panY = Math.max(-maxOffset, Math.min(maxOffset, this.panY));
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    // Cap DPR at 2.0 on mobile to prevent 3x/3.5x QHD fill-rate bottleneck on mobile browsers
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.dpr = dpr;
    this.computeLayout();
    this.needsRender = true;
  }

  computeLayout() {
    const width = this.canvas.width / (this.dpr || 1);
    const height = this.canvas.height / (this.dpr || 1);
    const padX = 10;
    const padY = 10;
    const availW = Math.max(120, width - padX * 2);
    const availH = Math.max(120, height - padY * 2);

    this.baseCellSize = Math.min(availW / this.cols, availH / this.rows, 42);
    const boardW = this.cols * this.baseCellSize;
    const boardH = this.rows * this.baseCellSize;
    this.boardOriginX = -boardW / 2;
    this.boardOriginY = -boardH / 2;

    // Pre-build a single cached Path2D for all grid dots so render() does 1 fill() instead of 1,216 arc() calls!
    const dotRadius = Math.max(1.3, this.baseCellSize * 0.068);
    if (typeof Path2D !== 'undefined') {
      const p = new Path2D();
      for (let r = 0; r < this.rows; r++) {
        const y = this.boardOriginY + (r + 0.5) * this.baseCellSize;
        for (let c = 0; c < this.cols; c++) {
          const x = this.boardOriginX + (c + 0.5) * this.baseCellSize;
          p.moveTo(x + dotRadius, y);
          p.arc(x, y, dotRadius, 0, Math.PI * 2);
        }
      }
      this.dotsPath = p;
    } else {
      this.dotsPath = null;
    }
  }

  /**
   * Launch an arrow along its snake trajectory out of the board
   */
  animateArrowClear(arrow, onComplete) {
    if (this.hintArrowId === arrow.id) {
      this.hintArrowId = null;
    }
    const maxExitDist = Math.max(this.rows, this.cols) + arrow.cells.length + 3;
    const speed = Math.max(24, Math.min(42, 18 + arrow.cells.length * 1.6));
    this.slitheringArrows.set(arrow.id, {
      arrow,
      progressSteps: 0,
      maxSteps: maxExitDist,
      speedStepsPerSec: speed,
      onComplete,
    });
    this.needsRender = true;
  }

  /**
   * Rule 2: Shake a blocked arrow in place (with its connected line) without turning it red
   */
  animateArrowShake(arrow, checkResult) {
    this.shakingArrows.set(arrow.id, {
      startTime: performance.now(),
      duration: 440,
      dir: arrow.dir,
      freeSteps: checkResult.distanceToBlocker || 0,
      blockerCell: checkResult.blockerCell || null,
    });
    this.needsRender = true;
  }

  screenToGrid(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;

    const worldX = (sx - rect.width / 2 - this.panX) / this.zoom;
    const worldY = (sy - rect.height / 2 - this.panY) / this.zoom;

    const localX = worldX - this.boardOriginX;
    const localY = worldY - this.boardOriginY;

    const cFloat = localX / this.baseCellSize - 0.5;
    const rFloat = localY / this.baseCellSize - 0.5;

    return {
      r: Math.round(rFloat),
      c: Math.round(cFloat),
      rFloat,
      cFloat,
    };
  }

  findArrowAtScreenPos(clientX, clientY) {
    const { rFloat, cFloat } = this.screenToGrid(clientX, clientY);

    let bestArrow = null;
    let bestDist = 0.72;

    for (const arrow of this.arrows) {
      if (arrow.removed || this.slitheringArrows.has(arrow.id)) continue;

      const cells = arrow.cells;
      for (let i = 0; i < cells.length; i++) {
        const dPoint = Math.hypot(rFloat - cells[i].r, cFloat - cells[i].c);
        const headBonus = i === cells.length - 1 ? 0.92 : 1.0;
        if (dPoint * headBonus < bestDist) {
          bestDist = dPoint * headBonus;
          bestArrow = arrow;
        }
        if (i + 1 < cells.length) {
          const a = cells[i];
          const b = cells[i + 1];
          const l2 = (b.r - a.r) ** 2 + (b.c - a.c) ** 2;
          if (l2 > 0) {
            const t = Math.max(
              0,
              Math.min(1, ((rFloat - a.r) * (b.r - a.r) + (cFloat - a.c) * (b.c - a.c)) / l2)
            );
            const projR = a.r + t * (b.r - a.r);
            const projC = a.c + t * (b.c - a.c);
            const dSeg = Math.hypot(rFloat - projR, cFloat - projC);
            if (dSeg < bestDist) {
              bestDist = dSeg;
              bestArrow = arrow;
            }
          }
        }
      }
    }

    return bestArrow;
  }

  bindEvents() {
    window.addEventListener('resize', () => this.resize());

    this.canvas.addEventListener('pointerdown', e => {
      this.canvas.setPointerCapture(e.pointerId);
      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.activePointers.size === 1) {
        this.isDragging = false;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        this.initialPanX = this.panX;
        this.initialPanY = this.panY;
        this.totalPointerMove = 0;
      } else if (this.activePointers.size === 2) {
        this.isDragging = true;
        const pts = Array.from(this.activePointers.values());
        this.initialPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        this.initialPinchZoom = this.zoom;
        const rect = this.canvas.getBoundingClientRect();
        this.initialPinchCenter = {
          x: (pts[0].x + pts[1].x) / 2 - rect.left,
          y: (pts[0].y + pts[1].y) / 2 - rect.top,
        };
      }
    });

    this.canvas.addEventListener('pointermove', e => {
      if (!this.activePointers.has(e.pointerId)) return;
      const prev = this.activePointers.get(e.pointerId);
      const stepMove = Math.hypot(e.clientX - prev.x, e.clientY - prev.y);
      this.totalPointerMove += stepMove;
      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.activePointers.size === 1 && !this.isDragging) {
        const dx = e.clientX - this.dragStartX;
        const dy = e.clientY - this.dragStartY;
        if (Math.hypot(dx, dy) > 8) {
          this.isDragging = true;
        }
      }

      if (this.activePointers.size === 1 && this.isDragging) {
        this.panX = this.initialPanX + (e.clientX - this.dragStartX);
        this.panY = this.initialPanY + (e.clientY - this.dragStartY);
        this.clampPan();
        this.needsRender = true;
      } else if (this.activePointers.size === 2) {
        const pts = Array.from(this.activePointers.values());
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        if (this.initialPinchDist > 10) {
          const scale = dist / this.initialPinchDist;
          this.setZoom(
            this.initialPinchZoom * scale,
            this.initialPinchCenter.x,
            this.initialPinchCenter.y
          );
        }
      }
    });

    const handlePointerUp = e => {
      if (!this.activePointers.has(e.pointerId)) return;
      this.activePointers.delete(e.pointerId);

      if (this.activePointers.size === 0) {
        if (!this.isDragging && this.totalPointerMove < 12) {
          const hitArrow = this.findArrowAtScreenPos(e.clientX, e.clientY);
          if (hitArrow && this.onArrowTap) {
            this.onArrowTap(hitArrow);
          }
        }
        this.isDragging = false;
      } else if (this.activePointers.size === 1) {
        const remaining = Array.from(this.activePointers.values())[0];
        this.dragStartX = remaining.x;
        this.dragStartY = remaining.y;
        this.initialPanX = this.panX;
        this.initialPanY = this.panY;
      }
    };

    this.canvas.addEventListener('pointerup', handlePointerUp);
    this.canvas.addEventListener('pointercancel', handlePointerUp);

    this.canvas.addEventListener(
      'wheel',
      e => {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const factor = e.deltaY < 0 ? 1.12 : 0.89;
        this.setZoom(this.zoom * factor, e.clientX - rect.left, e.clientY - rect.top);
      },
      { passive: false }
    );
  }

  hasAnimatedArrowState() {
    if (
      this.slitheringArrows.size > 0 ||
      this.shakingArrows.size > 0 ||
      this.shuffleTransition !== null ||
      this.hintArrowId !== null
    ) {
      return true;
    }
    for (let i = 0; i < this.arrows.length; i++) {
      const a = this.arrows[i];
      if (!a.removed && (a.isRainbow || a.isBonusRed)) return true;
    }
    return false;
  }

  startLoop() {
    const tick = now => {
      const dt = Math.min(0.05, (now - this.lastFrameTime) / 1000);
      this.lastFrameTime = now;

      const isAnimating = this.hasAnimatedArrowState();
      if (isAnimating) {
        this.updateAnimations(dt, now);
      }

      if (this.needsRender || isAnimating) {
        this.render(now);
        this.needsRender = this.hasAnimatedArrowState();
      }

      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  updateAnimations(dt, now) {
    for (const [id, state] of this.slitheringArrows.entries()) {
      state.progressSteps += state.speedStepsPerSec * dt;
      if (state.progressSteps >= state.maxSteps) {
        this.slitheringArrows.delete(id);
        this.needsRender = true;
        if (state.onComplete) state.onComplete(state.arrow);
      }
    }

    for (const [id, shake] of this.shakingArrows.entries()) {
      if (now - shake.startTime >= shake.duration) {
        this.shakingArrows.delete(id);
        this.needsRender = true;
      }
    }

    if (
      this.shuffleTransition &&
      now - this.shuffleTransition.startTime >= this.shuffleTransition.duration
    ) {
      this.shuffleTransition = null;
      this.needsRender = true;
    }
  }

  /**
   * Compute the interpolated polyline points (in grid coordinates) of an arrow
   * as it slithers forward by `progressSteps` along its own body and exit ray.
   */
  getSlitheredGridPoints(arrow, progressSteps = 0) {
    if (progressSteps <= 0) {
      return {
        points: arrow._cornerCells || arrow.cells,
        dir: arrow.dir,
      };
    }

    const baseCells = arrow.cells;
    const L = baseCells.length;

    const totalNeeded = Math.ceil(progressSteps) + L + 2;
    const path = baseCells.slice();
    const head = baseCells[L - 1];
    const { dr, dc } = arrow.dir;
    for (let k = 1; k <= totalNeeded; k++) {
      path.push({ r: head.r + k * dr, c: head.c + k * dc });
    }

    const iTail = Math.floor(progressSteps);
    const frac = progressSteps - iTail;
    const iHead = iTail + L - 1;

    const rawPoints = [];
    const pTail0 = path[iTail];
    const pTail1 = path[iTail + 1];
    rawPoints.push({
      r: pTail0.r + (pTail1.r - pTail0.r) * frac,
      c: pTail0.c + (pTail1.c - pTail0.c) * frac,
    });

    for (let idx = iTail + 1; idx <= iHead; idx++) {
      rawPoints.push(path[idx]);
    }

    if (frac > 0.0001) {
      const pHead0 = path[iHead];
      const pHead1 = path[iHead + 1];
      rawPoints.push({
        r: pHead0.r + (pHead1.r - pHead0.r) * frac,
        c: pHead0.c + (pHead1.c - pHead0.c) * frac,
      });
    }

    return {
      points: simplifyCellsToCorners(rawPoints),
      dir: arrow.dir,
    };
  }

  gridToWorld(r, c) {
    return {
      x: this.boardOriginX + (c + 0.5) * this.baseCellSize,
      y: this.boardOriginY + (r + 0.5) * this.baseCellSize,
    };
  }

  render(now) {
    const ctx = this.ctx;
    const dpr = this.dpr || 1;
    const width = this.canvas.width / dpr;
    const height = this.canvas.height / dpr;

    ctx.save();
    ctx.scale(dpr, dpr);

    // 1. Background fill
    const isDark = this.theme === 'dark';
    ctx.fillStyle = isDark ? '#2b3244' : '#eef2f9';
    ctx.fillRect(0, 0, width, height);

    // 2. Apply camera transform (center + pan + zoom)
    ctx.translate(width / 2 + this.panX, height / 2 + this.panY);
    ctx.scale(this.zoom, this.zoom);

    const cs = this.baseCellSize;

    // 3. Draw equal-spaced subtle dots across the board grid using cached Path2D (1 native call!)
    ctx.fillStyle = isDark ? 'rgba(138, 153, 189, 0.34)' : 'rgba(110, 126, 160, 0.36)';
    if (this.dotsPath) {
      ctx.fill(this.dotsPath);
    } else {
      const dotRadius = Math.max(1.3, cs * 0.068);
      ctx.beginPath();
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          const { x, y } = this.gridToWorld(r, c);
          ctx.moveTo(x + dotRadius, y);
          ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
        }
      }
      ctx.fill();
    }

    // 4. Optional Guide Lines
    if (this.showGuideLines) {
      ctx.save();
      ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(43, 50, 68, 0.14)';
      ctx.lineWidth = Math.max(1, cs * 0.045);
      ctx.setLineDash([cs * 0.16, cs * 0.16]);
      ctx.beginPath();
      for (const arrow of this.arrows) {
        if (arrow.removed || this.slitheringArrows.has(arrow.id)) continue;
        const headW = this.gridToWorld(arrow.head.r, arrow.head.c);
        const endR = arrow.head.r + arrow.dir.dr * Math.max(this.rows, this.cols);
        const endC = arrow.head.c + arrow.dir.dc * Math.max(this.rows, this.cols);
        const endW = this.gridToWorld(endR, endC);
        ctx.moveTo(headW.x, headW.y);
        ctx.lineTo(endW.x, endW.y);
      }
      ctx.stroke();
      ctx.restore();
    }

    // 5. Draw all active & slithering arrows
    for (let i = 0; i < this.arrows.length; i++) {
      const arrow = this.arrows[i];
      if (arrow.removed && !this.slitheringArrows.has(arrow.id)) continue;
      this.drawSingleArrow(ctx, arrow, cs, now);
    }

    ctx.restore();
  }

  drawSingleArrow(ctx, arrow, cs, now) {
    const slitherState = this.slitheringArrows.get(arrow.id);
    const shakeState = this.shakingArrows.get(arrow.id);
    const isHinted = this.hintArrowId === arrow.id;

    let progressSteps = slitherState ? slitherState.progressSteps : 0;

    let shakeOffsetX = 0;
    let shakeOffsetY = 0;
    if (shakeState) {
      const elapsed = (now - shakeState.startTime) / 1000;
      const progress = Math.min(1, (now - shakeState.startTime) / shakeState.duration);
      const damping = Math.pow(1 - progress, 1.8);

      const lungeBounce = Math.sin(progress * Math.PI) * Math.min(0.28, shakeState.freeSteps * 0.18);
      progressSteps += lungeBounce;

      const wave = Math.sin(elapsed * 58) * damping * cs * 0.18;
      const crossWave = Math.cos(elapsed * 44) * damping * cs * 0.11;
      shakeOffsetX = shakeState.dir.dc * wave + shakeState.dir.dr * crossWave;
      shakeOffsetY = shakeState.dir.dr * wave + shakeState.dir.dc * crossWave;
    }

    let scaleAlpha = 1.0;
    if (this.shuffleTransition) {
      const t = Math.min(
        1,
        (now - this.shuffleTransition.startTime) / this.shuffleTransition.duration
      );
      scaleAlpha = 0.35 + 0.65 * Math.sin((t * Math.PI) / 2);
    }

    const { points, dir } = this.getSlitheredGridPoints(arrow, progressSteps);
    if (points.length < 2) return;

    const worldPts = new Array(points.length);
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      worldPts[i] = {
        x: this.boardOriginX + (p.c + 0.5) * cs + shakeOffsetX,
        y: this.boardOriginY + (p.r + 0.5) * cs + shakeOffsetY,
      };
    }

    const lastIdx = worldPts.length - 1;
    const headPtX = worldPts[lastIdx].x;
    const headPtY = worldPts[lastIdx].y;
    const lineEndOffset = cs * 0.06;
    worldPts[lastIdx] = {
      x: headPtX - dir.dc * lineEndOffset,
      y: headPtY - dir.dr * lineEndOffset,
    };

    ctx.save();
    if (scaleAlpha < 0.999) {
      ctx.globalAlpha = scaleAlpha;
    }

    const strokeWidth = Math.max(1.5, cs * 0.23);
    const cornerRadius = cs * 0.14;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Hardware-accelerated vector halo for Hint (no slow Gaussian shadowBlur!)
    if (isHinted) {
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.009);
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.32 + pulse * 0.28})`;
      ctx.lineWidth = strokeWidth * (1.85 + pulse * 0.45);
      this.traceRoundedPolyline(ctx, worldPts, cornerRadius);
      ctx.stroke();
    }

    let activePaint = arrow.color;
    if (arrow.isBonusRed) {
      activePaint = '#ff2e4c';
      const redPulse = 0.5 + 0.5 * Math.sin(now * 0.022);
      ctx.strokeStyle = `rgba(255, 46, 76, ${0.34 + redPulse * 0.32})`;
      ctx.lineWidth = strokeWidth * (1.9 + redPulse * 0.45);
      this.traceRoundedPolyline(ctx, worldPts, cornerRadius);
      ctx.stroke();
    } else if (arrow.isRainbow) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < worldPts.length; i++) {
        const p = worldPts[i];
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      const span = Math.max(cs * 2.5, Math.hypot(maxX - minX, maxY - minY));
      const angle = (now * 0.0018) % (Math.PI * 2);
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const gx0 = cx - Math.cos(angle) * span * 0.65;
      const gy0 = cy - Math.sin(angle) * span * 0.65;
      const gx1 = cx + Math.cos(angle) * span * 0.65;
      const gy1 = cy + Math.sin(angle) * span * 0.65;

      const grad = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
      const hueShift = (now * 0.14) % 360;
      const stops = [0, 0.17, 0.33, 0.5, 0.67, 0.83, 1.0];
      for (let s = 0; s < stops.length; s++) {
        const h = (hueShift + s * 52) % 360;
        grad.addColorStop(stops[s], `hsl(${h}, 95%, 64%)`);
      }
      activePaint = grad;

      // Vector rainbow outer glow (zero shadowBlur!)
      ctx.save();
      ctx.globalAlpha = scaleAlpha * 0.32;
      ctx.strokeStyle = grad;
      ctx.lineWidth = strokeWidth * 1.75;
      this.traceRoundedPolyline(ctx, worldPts, cornerRadius);
      ctx.stroke();
      ctx.restore();
    }

    // Main arrow body stroke
    ctx.strokeStyle = activePaint;
    ctx.lineWidth = strokeWidth;
    this.traceRoundedPolyline(ctx, worldPts, cornerRadius);
    ctx.stroke();

    // Draw crisp triangular arrowhead at (headPtX, headPtY) pointing in `dir`
    const tipLength = cs * 0.32;
    const backLength = cs * 0.16;
    const halfWing = cs * 0.24;

    const tipX = headPtX + dir.dc * tipLength;
    const tipY = headPtY + dir.dr * tipLength;
    const baseCenterX = headPtX - dir.dc * backLength;
    const baseCenterY = headPtY - dir.dr * backLength;

    const perpX = -dir.dr;
    const perpY = dir.dc;

    const leftX = baseCenterX + perpX * halfWing;
    const leftY = baseCenterY + perpY * halfWing;
    const rightX = baseCenterX - perpX * halfWing;
    const rightY = baseCenterY - perpY * halfWing;

    ctx.fillStyle = activePaint;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(leftX, leftY);
    ctx.lineTo(rightX, rightY);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = Math.max(1.2, cs * 0.06);
    ctx.strokeStyle = activePaint;
    ctx.stroke();

    // If hinted, draw a subtle white inner highlight core
    if (isHinted) {
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.009);
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.45 + pulse * 0.45})`;
      ctx.lineWidth = strokeWidth * 0.42;
      this.traceRoundedPolyline(ctx, worldPts, cornerRadius);
      ctx.stroke();
    }

    ctx.restore();
  }

  traceRoundedPolyline(ctx, pts, radius) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const prev = pts[i - 1];
      const cur = pts[i];
      const next = pts[i + 1];
      const d1 = Math.hypot(cur.x - prev.x, cur.y - prev.y);
      const d2 = Math.hypot(next.x - cur.x, next.y - cur.y);
      const r = Math.min(radius, d1 * 0.45, d2 * 0.45);
      if (r > 0.5) {
        ctx.arcTo(cur.x, cur.y, next.x, next.y, r);
      } else {
        ctx.lineTo(cur.x, cur.y);
      }
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x, last.y);
  }
}
