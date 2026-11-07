/**
 * High-DPI Canvas Renderer & Multi-Touch Zoom/Pan Controller for 《一箭又一箭》
 * Features:
 * - Deep slate night mode (#2b3244) & crisp day mode with equal-spaced grid dots
 * - True snake-slithering trajectory interpolation along all body bends
 * - Blocked arrow damped harmonic shake animation (keeps original color, never turns red)
 * - Hint glowing pulse animation
 * - Pinch-to-zoom, pan, and bottom zoom slider synchronization
 */

export class BoardCanvasView {
  constructor(canvas, { onArrowTap, onZoomChange }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
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
    // slitheringArrows: Map<arrowId, { arrow, progressSteps, speedStepsPerSec }>
    this.slitheringArrows = new Map();
    // shakingArrows: Map<arrowId, { startTime, duration, dir, freeSteps, blockerCell }>
    this.shakingArrows = new Map();
    // shuffleTransition: { startTime, duration }
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

    this.rafId = null;
    this.lastFrameTime = performance.now();

    this.bindEvents();
    this.resize();
    this.startLoop();
  }

  setBoard({ rows, cols, mask, arrows }) {
    this.rows = rows;
    this.cols = cols;
    this.mask = mask;
    this.arrows = arrows;
    this.hintArrowId = null;
    this.slitheringArrows.clear();
    this.shakingArrows.clear();
    this.resetCamera();
    this.triggerShuffleWave();
  }

  updateArrows(arrows, animateWave = false) {
    this.arrows = arrows;
    this.hintArrowId = null;
    this.slitheringArrows.clear();
    this.shakingArrows.clear();
    if (animateWave) {
      this.triggerShuffleWave();
    }
  }

  triggerShuffleWave() {
    this.shuffleTransition = {
      startTime: performance.now(),
      duration: 360,
    };
  }

  setTheme(theme) {
    this.theme = theme;
  }

  setGuideLines(enabled) {
    this.showGuideLines = enabled;
  }

  setHintArrow(arrowId) {
    this.hintArrowId = arrowId;
  }

  resetCamera() {
    this.zoom = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.computeLayout();
    if (this.onZoomChange) this.onZoomChange(this.zoom);
  }

  setZoom(newZoom, anchorScreenX = null, anchorScreenY = null) {
    const clamped = Math.max(this.minZoom, Math.min(this.maxZoom, newZoom));
    const rect = this.canvas.getBoundingClientRect();
    const cx = anchorScreenX !== null ? anchorScreenX : rect.width / 2;
    const cy = anchorScreenY !== null ? anchorScreenY : rect.height / 2;

    // Keep the point under (cx, cy) stationary during zoom
    const worldX = (cx - rect.width / 2 - this.panX) / this.zoom;
    const worldY = (cy - rect.height / 2 - this.panY) / this.zoom;

    this.zoom = clamped;
    this.panX = cx - rect.width / 2 - worldX * this.zoom;
    this.panY = cy - rect.height / 2 - worldY * this.zoom;
    this.clampPan();

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
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.dpr = dpr;
    this.computeLayout();
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
  }

  /**
   * Convert screen (clientX, clientY) to board grid coordinates { r, c, distFromCenter }
   */
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

  /**
   * Find the arrow closest to the tapped grid position
   */
  findArrowAtScreenPos(clientX, clientY) {
    const { rFloat, cFloat } = this.screenToGrid(clientX, clientY);

    let bestArrow = null;
    let bestDist = 0.72; // Generous touch radius in grid units

    for (const arrow of this.arrows) {
      if (arrow.removed || this.slitheringArrows.has(arrow.id)) continue;

      // Check distance to every segment of the arrow polyline
      const cells = arrow.cells;
      for (let i = 0; i < cells.length; i++) {
        const dPoint = Math.hypot(rFloat - cells[i].r, cFloat - cells[i].c);
        // Slightly prioritize arrowhead taps when fingers are close
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
        // Transition smoothly from 2-finger pinch back to 1-finger pan
        const remaining = Array.from(this.activePointers.values())[0];
        this.dragStartX = remaining.x;
        this.dragStartY = remaining.y;
        this.initialPanX = this.panX;
        this.initialPanY = this.panY;
      }
    };

    this.canvas.addEventListener('pointerup', handlePointerUp);
    this.canvas.addEventListener('pointercancel', handlePointerUp);

    // Desktop mouse wheel zoom support
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

  startLoop() {
    const tick = now => {
      const dt = Math.min(0.05, (now - this.lastFrameTime) / 1000);
      this.lastFrameTime = now;
      this.updateAnimations(dt, now);
      this.render(now);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  updateAnimations(dt, now) {
    // Update slithering arrows
    for (const [id, state] of this.slitheringArrows.entries()) {
      state.progressSteps += state.speedStepsPerSec * dt;
      if (state.progressSteps >= state.maxSteps) {
        this.slitheringArrows.delete(id);
        if (state.onComplete) state.onComplete(state.arrow);
      }
    }

    // Expire finished shake animations
    for (const [id, shake] of this.shakingArrows.entries()) {
      if (now - shake.startTime >= shake.duration) {
        this.shakingArrows.delete(id);
      }
    }

    if (
      this.shuffleTransition &&
      now - this.shuffleTransition.startTime >= this.shuffleTransition.duration
    ) {
      this.shuffleTransition = null;
    }
  }

  /**
   * Compute the interpolated polyline points (in grid coordinates) of an arrow
   * as it slithers forward by `progressSteps` along its own body and exit ray.
   */
  getSlitheredGridPoints(arrow, progressSteps = 0) {
    const baseCells = arrow.cells;
    const L = baseCells.length;
    if (progressSteps <= 0) {
      return {
        points: baseCells.map(c => ({ r: c.r, c: c.c })),
        dir: arrow.dir,
      };
    }

    // Build extended trajectory: tail -> ... -> head -> ray steps
    const totalNeeded = Math.ceil(progressSteps) + L + 2;
    const path = baseCells.map(c => ({ r: c.r, c: c.c }));
    const head = baseCells[L - 1];
    const { dr, dc } = arrow.dir;
    for (let k = 1; k <= totalNeeded; k++) {
      path.push({ r: head.r + k * dr, c: head.c + k * dc });
    }

    const iTail = Math.floor(progressSteps);
    const frac = progressSteps - iTail;
    const iHead = iTail + L - 1;

    const points = [];
    // Interpolated tail position
    const pTail0 = path[iTail];
    const pTail1 = path[iTail + 1];
    points.push({
      r: pTail0.r + (pTail1.r - pTail0.r) * frac,
      c: pTail0.c + (pTail1.c - pTail0.c) * frac,
    });

    // Intermediate corners along the snake body
    for (let idx = iTail + 1; idx <= iHead; idx++) {
      points.push(path[idx]);
    }

    // Interpolated head position
    if (frac > 0.0001) {
      const pHead0 = path[iHead];
      const pHead1 = path[iHead + 1];
      points.push({
        r: pHead0.r + (pHead1.r - pHead0.r) * frac,
        c: pHead0.c + (pHead1.c - pHead0.c) * frac,
      });
    }

    return {
      points,
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

    // 3. Draw equal-spaced subtle dots across the board grid (Screenshot 1 & 2 style)
    const dotRadius = Math.max(1.3, cs * 0.068);
    ctx.fillStyle = isDark ? 'rgba(138, 153, 189, 0.34)' : 'rgba(110, 126, 160, 0.36)';
    ctx.beginPath();
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        // Draw dots across the entire puzzle grid bounding area so cleared spaces & margins show the dot matrix
        const { x, y } = this.gridToWorld(r, c);
        ctx.moveTo(x + dotRadius, y);
        ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
      }
    }
    ctx.fill();

    // 4. Optional Guide Lines (辅助线 button at bottom right of Screenshot 1 & 2)
    if (this.showGuideLines) {
      ctx.save();
      ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(43, 50, 68, 0.14)';
      ctx.lineWidth = Math.max(1, cs * 0.045);
      ctx.setLineDash([cs * 0.16, cs * 0.16]);
      for (const arrow of this.arrows) {
        if (arrow.removed || this.slitheringArrows.has(arrow.id)) continue;
        const headW = this.gridToWorld(arrow.head.r, arrow.head.c);
        const endR = arrow.head.r + arrow.dir.dr * Math.max(this.rows, this.cols);
        const endC = arrow.head.c + arrow.dir.dc * Math.max(this.rows, this.cols);
        const endW = this.gridToWorld(endR, endC);
        ctx.beginPath();
        ctx.moveTo(headW.x, headW.y);
        ctx.lineTo(endW.x, endW.y);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 5. Draw all active & slithering arrows
    for (const arrow of this.arrows) {
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

    // Shake displacement (Rule 2: never turns red, vibrates & shakes visually in original color!)
    let shakeOffsetX = 0;
    let shakeOffsetY = 0;
    if (shakeState) {
      const elapsed = (now - shakeState.startTime) / 1000;
      const progress = Math.min(1, (now - shakeState.startTime) / shakeState.duration);
      const damping = Math.pow(1 - progress, 1.8);

      // Lunge slightly toward the obstacle if there is free space, plus rapid orthogonal + axial jitter
      const lungeBounce = Math.sin(progress * Math.PI) * Math.min(0.28, shakeState.freeSteps * 0.18);
      progressSteps += lungeBounce;

      const wave = Math.sin(elapsed * 58) * damping * cs * 0.18;
      const crossWave = Math.cos(elapsed * 44) * damping * cs * 0.11;
      shakeOffsetX = shakeState.dir.dc * wave + shakeState.dir.dr * crossWave;
      shakeOffsetY = shakeState.dir.dr * wave + shakeState.dir.dc * crossWave;
    }

    // Shuffle wave scale-in animation
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

    const worldPts = points.map(p => {
      const w = this.gridToWorld(p.r, p.c);
      return { x: w.x + shakeOffsetX, y: w.y + shakeOffsetY };
    });

    // Shorten the very last segment slightly so the line tucks cleanly into the arrowhead base
    const headPt = { ...worldPts[worldPts.length - 1] };
    const lineEndOffset = cs * 0.06;
    worldPts[worldPts.length - 1] = {
      x: headPt.x - dir.dc * lineEndOffset,
      y: headPt.y - dir.dr * lineEndOffset,
    };

    ctx.save();
    ctx.globalAlpha = scaleAlpha;

    const strokeWidth = Math.max(1.5, cs * 0.23);
    const cornerRadius = cs * 0.14;

    // Hint glow aura
    if (isHinted) {
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.009);
      ctx.save();
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = cs * (0.55 + pulse * 0.45);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = strokeWidth * (1.45 + pulse * 0.35);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      this.traceRoundedPolyline(ctx, worldPts, cornerRadius);
      ctx.stroke();
      ctx.restore();
    }

    // Subtle drop shadow for crisp depth on dark slate background
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.28)';
    ctx.shadowBlur = cs * 0.12;
    ctx.shadowOffsetY = cs * 0.05;

    // Main arrow body stroke (always keeps arrow.color, never turns red on error!)
    ctx.strokeStyle = arrow.color;
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    this.traceRoundedPolyline(ctx, worldPts, cornerRadius);
    ctx.stroke();

    // Draw crisp triangular arrowhead at `headPt` pointing in `dir`
    const tipLength = cs * 0.32;
    const backLength = cs * 0.16;
    const halfWing = cs * 0.24;

    const tipX = headPt.x + dir.dc * tipLength;
    const tipY = headPt.y + dir.dr * tipLength;
    const baseCenterX = headPt.x - dir.dc * backLength;
    const baseCenterY = headPt.y - dir.dr * backLength;

    // Perpendicular vector (-dir.dr, dir.dc)
    const perpX = -dir.dr;
    const perpY = dir.dc;

    const leftX = baseCenterX + perpX * halfWing;
    const leftY = baseCenterY + perpY * halfWing;
    const rightX = baseCenterX - perpX * halfWing;
    const rightY = baseCenterY - perpY * halfWing;

    ctx.fillStyle = arrow.color;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(leftX, leftY);
    ctx.lineTo(rightX, rightY);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = Math.max(1.2, cs * 0.06);
    ctx.strokeStyle = arrow.color;
    ctx.stroke();
    ctx.restore();

    // If hinted, draw a subtle white inner highlight core
    if (isHinted) {
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.009);
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.45 + pulse * 0.45})`;
      ctx.lineWidth = strokeWidth * 0.42;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      this.traceRoundedPolyline(ctx, worldPts, cornerRadius);
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Trace a polyline with smooth rounded 90-degree corners matching Screenshot 2
   */
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
