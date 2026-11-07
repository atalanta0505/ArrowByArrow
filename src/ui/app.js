/**
 * Main Application Controller for 《一箭又一箭》 纯净定制版
 */

import { LEVEL_DEFINITIONS } from '../engine/patterns.js?v=8';
import {
  generateFullLevel,
  shuffleRemainingArrows,
  extendShuffledToFull,
} from '../engine/generator.js?v=8';
import {
  checkArrowExit,
  getRandomHintArrow,
  getRemovableArrows,
} from '../engine/solver.js?v=8';
import { BoardCanvasView } from '../renderer/canvasView.js?v=8';
import { feedback } from '../audio/soundAndHaptics.js?v=8';

const STORAGE_KEY = 'arrow_by_arrow_alphabet26_classic_maze_v6';
const LEGACY_STORAGE_KEYS = [
  'arrow_by_arrow_custom_save_v1',
  'arrow_by_arrow_custom_save_v2',
  'arrow_by_arrow_custom_save_v3',
  'arrow_by_arrow_custom_save_v4',
  'arrow_by_arrow_custom_save_v5',
];

function cloneArrows(arrows) {
  return arrows.map(a => ({
    ...a,
    cells: a.cells.map(c => ({ r: c.r, c: c.c })),
    head: { r: a.head.r, c: a.head.c },
    dir: { dr: a.dir.dr, dc: a.dir.dc },
    removed: Boolean(a.removed),
    isRainbow: Boolean(a.isRainbow),
    isBonusRed: false,
  }));
}

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

/**
 * Generate SVG markup for a 3D faceted Gold or Grey Star (Mahjong Titan Screenshot 3 & 4 style)
 */
export function createStarSVG(isGold = false, extraClass = '') {
  const uid = Math.random().toString(36).slice(2, 8);
  const cTop = isGold ? '#fff380' : '#9ca3af';
  const cMid = isGold ? '#f7b500' : '#6b7280';
  const cBot = isGold ? '#c97a00' : '#4b5563';
  const stroke = isGold ? '#b46900' : '#374151';

  return `
    <svg viewBox="0 0 100 100" class="${extraClass}">
      <defs>
        <linearGradient id="sg_${uid}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="${cTop}" />
          <stop offset="55%" stop-color="${cMid}" />
          <stop offset="100%" stop-color="${cBot}" />
        </linearGradient>
      </defs>
      <polygon
        points="50,5 63,35 95,38 70,59 78,91 50,73 22,91 30,59 5,38 37,35"
        fill="url(#sg_${uid})"
        stroke="${stroke}"
        stroke-width="3"
        stroke-linejoin="round"
      />
      <polygon
        points="50,5 63,35 50,52 37,35"
        fill="rgba(255,255,255,0.28)"
      />
      <polygon
        points="50,52 95,38 70,59"
        fill="rgba(255,255,255,0.16)"
      />
      <polygon
        points="50,52 22,91 30,59"
        fill="rgba(0,0,0,0.14)"
      />
    </svg>
  `;
}

class ArrowGameApp {
  constructor() {
    this.saveData = this.loadSaveData();
    this.currentLevelIdx = this.saveData.lastLevelIdx || 0;
    this.boardFilter = 'all'; // 'all' | 'finished' | 'unfinished'
    this.activeMenuTab = 'boards'; // 'boards' | 'goals' | 'options'

    // Active game session state
    this.levelDef = LEVEL_DEFINITIONS[this.currentLevelIdx];
    this.rows = 10;
    this.cols = 10;
    this.mask = [];
    this.arrows = [];
    // `restartBaseArrows` stores the full-board layout to use when clicking Restart.
    // Whenever Shuffle is clicked, `restartBaseArrows` is updated via `extendShuffledToFull`
    // so that clicking Restart rebuilds the full board based on the shuffled layout!
    this.restartBaseArrows = [];
    this.shuffleCount = 0;
    this.comboCount = 0;
    this.bonusTimeouts = [];

    // 3-Star tracking for current round
    this.usedShuffle = false;
    this.usedHint = false;
    this.elapsedSeconds = 0;
    this.expectedSeconds = 120;
    this.isPaused = false;
    this.isCompleted = false;
    this.timerInterval = null;
    this.toastTimeout = null;

    this.initDOM();
    this.initCanvas();
    this.applyTheme(this.saveData.theme || 'dark');
    this.startLevel(this.currentLevelIdx, true);
    this.startTimerLoop();
  }

  loadSaveData() {
    try {
      // Purge all legacy save data & records from previous versions
      for (const oldKey of LEGACY_STORAGE_KEYS) {
        localStorage.removeItem(oldKey);
      }
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const safeIdx = Math.max(
          0,
          Math.min(parsed.lastLevelIdx || 0, LEVEL_DEFINITIONS.length - 1)
        );
        return {
          lastLevelIdx: safeIdx,
          theme: parsed.theme || 'dark',
          sound: parsed.sound !== false,
          vibrate: parsed.vibrate !== false,
          // levelRecords: { [levelId]: { finished: boolean, stars: 0..3, bestTime: number } }
          levelRecords: parsed.levelRecords || {},
        };
      }
    } catch (_) {}
    return {
      lastLevelIdx: 0,
      theme: 'dark',
      sound: true,
      vibrate: true,
      levelRecords: {},
    };
  }

  persistSaveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.saveData));
    } catch (_) {}
  }

  getTotalStars() {
    let sum = 0;
    for (const lvl of LEVEL_DEFINITIONS) {
      const rec = this.saveData.levelRecords[lvl.id];
      if (rec && typeof rec.stars === 'number') {
        sum += rec.stars;
      }
    }
    return sum;
  }

  initDOM() {
    this.appEl = document.getElementById('app');
    this.canvasEl = document.getElementById('boardCanvas');

    // In-game top action buttons (Hint, Shuffle, Restart, Boards)
    document.getElementById('btnHint').addEventListener('click', () => this.handleHint());
    document.getElementById('btnShuffle').addEventListener('click', () => this.handleShuffle());
    document.getElementById('btnRestart').addEventListener('click', () => this.handleRestart());
    document.getElementById('btnOpenBoards').addEventListener('click', () => this.openOverlay('boards'));

    // Subheader controls
    document.getElementById('btnSettingsQuick').addEventListener('click', () => this.openOverlay('options'));
    document.getElementById('btnThemeToggle').addEventListener('click', () => {
      const next = this.saveData.theme === 'dark' ? 'light' : 'dark';
      this.applyTheme(next);
    });
    document.getElementById('btnFullscreen').addEventListener('click', () => this.toggleFullscreen());

    this.elLevelTitle = document.getElementById('levelTitleText');
    this.elTimerText = document.getElementById('timerText');
    this.elExpectedText = document.getElementById('expectedTimeText');
    this.elComboBadge = document.getElementById('comboBadge');
    this.elRemainBadge = document.getElementById('remainBadge');
    this.elLiveStarShuffle = document.getElementById('liveStarShuffle');
    this.elLiveStarHint = document.getElementById('liveStarHint');
    this.elLiveStarTime = document.getElementById('liveStarTime');
    this.elToast = document.getElementById('statusToast');

    // Bottom bar controls (Reset View / Hint, Zoom Slider, Guide Lines)
    this.elZoomSlider = document.getElementById('zoomSlider');
    document.getElementById('btnZoomOut').addEventListener('click', () => {
      this.boardView.setZoom(this.boardView.zoom - 0.25);
    });
    document.getElementById('btnZoomIn').addEventListener('click', () => {
      this.boardView.setZoom(this.boardView.zoom + 0.25);
    });
    this.elZoomSlider.addEventListener('input', e => {
      const val = parseFloat(e.target.value);
      this.boardView.setZoom(val);
    });

    document.getElementById('btnBottomHint').addEventListener('click', () => this.handleHint());
    this.btnGuideLines = document.getElementById('btnGuideLines');
    this.btnGuideLines.addEventListener('click', () => {
      const next = !this.boardView.showGuideLines;
      this.boardView.setGuideLines(next);
      this.btnGuideLines.classList.toggle('active', next);
      this.showToast(next ? '已开启方向辅助线' : '已关闭方向辅助线');
    });

    // Overlay Navigation Bar (Close, Boards, Goals, Options)
    this.elOverlayPanel = document.getElementById('overlayPanel');
    document.getElementById('btnOverlayClose').addEventListener('click', () => this.closeOverlay());
    document.getElementById('btnOverlayBoards').addEventListener('click', () => this.switchOverlayTab('boards'));
    document.getElementById('btnOverlayGoals').addEventListener('click', () => this.switchOverlayTab('goals'));
    document.getElementById('btnOverlayOptions').addEventListener('click', () => this.switchOverlayTab('options'));

    // Filter tabs in Boards view (All, Finished, Unfinished)
    document.querySelectorAll('.filter-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.boardFilter = btn.dataset.filter;
        document.querySelectorAll('.filter-tab-btn').forEach(b => b.classList.toggle('active', b === btn));
        this.renderBoardsList();
      });
    });

    // Victory Modal buttons (Boards, Restart, Next)
    this.elVictoryModal = document.getElementById('victoryModal');
    document.getElementById('btnVicBoards').addEventListener('click', () => {
      this.hideVictoryModal();
      this.openOverlay('boards');
    });
    document.getElementById('btnVicRestart').addEventListener('click', () => {
      this.hideVictoryModal();
      this.startLevel(this.currentLevelIdx, true);
    });
    document.getElementById('btnVicNext').addEventListener('click', () => {
      this.hideVictoryModal();
      const nextIdx = (this.currentLevelIdx + 1) % LEVEL_DEFINITIONS.length;
      this.startLevel(nextIdx, true);
    });
  }

  initCanvas() {
    this.boardView = new BoardCanvasView(this.canvasEl, {
      onArrowTap: arrow => this.handleArrowTap(arrow),
      onZoomChange: z => {
        if (this.elZoomSlider) {
          this.elZoomSlider.value = z.toFixed(2);
        }
      },
    });
    feedback.soundEnabled = this.saveData.sound;
    feedback.vibrateEnabled = this.saveData.vibrate;
  }

  applyTheme(theme) {
    this.saveData.theme = theme;
    this.persistSaveData();
    this.appEl.classList.toggle('theme-light', theme === 'light');
    const knob = document.getElementById('themeKnobIcon');
    if (knob) {
      knob.textContent = theme === 'dark' ? '🌙' : '☀️';
    }
    if (this.boardView) {
      this.boardView.setTheme(theme);
    }
  }

  showToast(msg, duration = 1800) {
    if (!this.elToast) return;
    this.elToast.textContent = msg;
    this.elToast.classList.add('visible');
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.elToast.classList.remove('visible');
    }, duration);
  }

  /**
   * Start or load a level
   */
  startLevel(levelIdx, freshGenerate = true) {
    this.currentLevelIdx = levelIdx;
    this.saveData.lastLevelIdx = levelIdx;
    this.persistSaveData();

    this.levelDef = LEVEL_DEFINITIONS[levelIdx];
    this.expectedSeconds = this.levelDef.expectedSeconds;
    this.elapsedSeconds = 0;
    this.usedShuffle = false;
    this.usedHint = false;
    this.isCompleted = false;
    this.isPaused = false;
    this.comboCount = 0;
    this.clearBonusTimeouts();

    if (freshGenerate) {
      const generated = generateFullLevel(this.levelDef);
      this.rows = generated.rows;
      this.cols = generated.cols;
      this.mask = generated.mask;
      this.arrows = cloneArrows(generated.arrows);
      this.restartBaseArrows = cloneArrows(generated.arrows);
    } else {
      this.arrows = cloneArrows(this.restartBaseArrows);
    }

    this.boardView.setBoard({
      rows: this.rows,
      cols: this.cols,
      mask: this.mask,
      arrows: this.arrows,
    });
    setTimeout(() => this.boardView.resize(), 30);

    this.updateHUD();
  }

  clearBonusTimeouts() {
    if (this.bonusTimeouts && this.bonusTimeouts.length > 0) {
      for (const tid of this.bonusTimeouts) clearTimeout(tid);
      this.bonusTimeouts = [];
    }
  }

  /**
   * 7-Combo Reward: Randomly turn one unremoved normal arrow into a Rainbow Arrow (彩虹箭头)
   */
  spawnRainbowArrow() {
    const candidates = this.arrows.filter(
      a =>
        !a.removed &&
        !a.isRainbow &&
        !a.isBonusRed &&
        !this.boardView.slitheringArrows.has(a.id)
    );
    if (candidates.length === 0) return;

    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    chosen.isRainbow = true;
    this.boardView.needsRender = true;
    feedback.playRainbowSpawn();
    this.showToast(`🌈 ${this.comboCount}连击达成！已生成一条彩虹箭头`, 2200);
  }

  /**
   * When a Rainbow Arrow is cleared: randomly select one currently removable arrow,
   * turn it RED first (`isBonusRed = true` for 420ms), and then automatically clear it!
   */
  triggerRainbowBonusClear() {
    const removableNow = getRemovableArrows(this.arrows, this.rows, this.cols).filter(
      a => !a.removed && !a.isBonusRed && !this.boardView.slitheringArrows.has(a.id)
    );
    if (removableNow.length === 0) return;

    const bonusArrow = removableNow[Math.floor(Math.random() * removableNow.length)];
    bonusArrow.isBonusRed = true;
    this.boardView.needsRender = true;
    feedback.playBonusRedLock();
    this.showToast('🎯 彩虹箭触发！附带箭头已变红锁定，即将自动清除', 2000);

    const tid = setTimeout(() => {
      if (this.isCompleted || bonusArrow.removed) return;
      const wasAlsoRainbow = Boolean(bonusArrow.isRainbow);
      feedback.playArrowClear();
      bonusArrow.removed = true;
      this.updateHUD();

      this.boardView.animateArrowClear(bonusArrow, () => {
        this.checkLevelComplete();
      });

      if (wasAlsoRainbow) {
        this.triggerRainbowBonusClear();
      }

      const remaining = this.arrows.filter(a => !a.removed).length;
      if (remaining === 0) {
        setTimeout(() => this.checkLevelComplete(), 280);
      }
    }, 420);

    this.bonusTimeouts.push(tid);
  }

  /**
   * Handle player tapping an arrow on the canvas
   */
  handleArrowTap(arrow) {
    if (this.isCompleted || arrow.removed || arrow.isBonusRed) return;
    if (this.boardView.slitheringArrows.has(arrow.id)) return;

    const check = checkArrowExit(arrow, this.arrows, this.rows, this.cols);
    if (check.canExit) {
      const wasRainbow = Boolean(arrow.isRainbow);

      // Clear path! Play target-hit sound & launch snake slithering animation out of the board
      feedback.playArrowClear();
      arrow.removed = true;
      this.comboCount++;

      // Every 7*combo, turn a random remaining arrow into a Rainbow Arrow!
      if (this.comboCount > 0 && this.comboCount % 7 === 0) {
        this.spawnRainbowArrow();
      }

      // If the cleared arrow itself is a Rainbow Arrow, lock onto a currently removable arrow (turns red -> clears)!
      if (wasRainbow) {
        this.triggerRainbowBonusClear();
      }

      this.updateHUD();

      this.boardView.animateArrowClear(arrow, () => {
        this.checkLevelComplete();
      });
      // Also check immediately if all arrows have been launched
      const remaining = this.arrows.filter(a => !a.removed).length;
      if (remaining === 0) {
        setTimeout(() => this.checkLevelComplete(), 280);
      }
    } else {
      // Rule 2: Blocked! Reset combo, vibrate phone + shake the arrow & its connected line in place (never turns red, never fails!)
      this.comboCount = 0;
      this.updateHUD();
      feedback.triggerBlockedFeedback();
      this.boardView.animateArrowShake(arrow, check);
    }
  }

  /**
   * Rule 3: Hint Feature — randomly pick one removable arrow and highlight it
   */
  handleHint() {
    if (this.isCompleted) return;
    const hintArrow = getRandomHintArrow(this.arrows, this.rows, this.cols);
    if (!hintArrow) {
      this.showToast('当前没有可移动的箭头，请尝试重排');
      return;
    }

    this.usedHint = true;
    feedback.playHint();
    this.boardView.setHintArrow(hintArrow.id);
    this.updateHUD();
    this.showToast('💡 已高亮提示一条可移除的箭头');
  }

  /**
   * Rule 4: Shuffle Feature — redraw remaining unremoved arrows on the board.
   * Also immediately prepares `restartBaseArrows` based on the newly shuffled remaining arrows
   * so that if the user clicks Restart next, the full board is reconstructed around this shuffled layout!
   */
  handleShuffle() {
    if (this.isCompleted) return;
    const remainingCount = this.arrows.filter(a => !a.removed).length;
    if (remainingCount === 0) return;

    this.usedShuffle = true;
    this.shuffleCount++;
    this.comboCount = 0;
    this.clearBonusTimeouts();
    const shuffleSeed = this.levelDef.seed + this.shuffleCount * 1009 + Math.floor( performance.now() );

    feedback.playShuffle();
    const newRemainingArrows = shuffleRemainingArrows(
      this.arrows,
      this.rows,
      this.cols,
      shuffleSeed,
      this.levelDef
    );

    // Pre-build the full board extension based on `newRemainingArrows` for Rule 4 (Shuffle -> Restart)
    this.restartBaseArrows = extendShuffledToFull(
      newRemainingArrows,
      this.mask,
      this.rows,
      this.cols,
      shuffleSeed + 313,
      this.levelDef
    );

    this.arrows = cloneArrows(newRemainingArrows);
    this.boardView.updateArrows(this.arrows, true);
    this.updateHUD();
    this.showToast('🔀 已重排剩余箭头（若点重开将基于此布局补全整局）');
  }

  /**
   * Rule 4: Restart Feature — restarts the current board from 00:00.
   * If Shuffle was clicked previously, `this.restartBaseArrows` contains the full board
   * extended directly from the shuffled layout!
   */
  handleRestart() {
    const wasShuffled = this.usedShuffle;
    this.elapsedSeconds = 0;
    this.usedShuffle = false;
    this.usedHint = false;
    this.isCompleted = false;
    this.isPaused = false;
    this.comboCount = 0;
    this.clearBonusTimeouts();

    this.arrows = cloneArrows(this.restartBaseArrows);
    this.boardView.updateArrows(this.arrows, true);
    this.updateHUD();

    if (wasShuffled) {
      this.showToast('🔄 已基于重排后的布局补全并重新开始本局');
    } else {
      this.showToast('🔄 已重新开始本局');
    }
  }

  checkLevelComplete() {
    if (this.isCompleted) return;
    const remaining = this.arrows.filter(a => !a.removed).length;
    if (remaining > 0) return;

    this.isCompleted = true;

    // Rule 5: Compute earned stars (3 independent criteria)
    const starNoShuffle = !this.usedShuffle;
    const starNoHint = !this.usedHint;
    const starInTime = this.elapsedSeconds <= this.expectedSeconds;

    const earnedStarsCount =
      (starNoShuffle ? 1 : 0) + (starNoHint ? 1 : 0) + (starInTime ? 1 : 0);

    // Save record (preserve highest stars & best time)
    const prevRec = this.saveData.levelRecords[this.levelDef.id] || {
      finished: false,
      stars: 0,
      bestTime: Infinity,
    };
    this.saveData.levelRecords[this.levelDef.id] = {
      finished: true,
      stars: Math.max(prevRec.stars || 0, earnedStarsCount),
      bestTime: Math.min(prevRec.bestTime || Infinity, this.elapsedSeconds),
    };
    this.persistSaveData();

    this.showVictoryModal({
      starNoShuffle,
      starNoHint,
      starInTime,
      earnedStarsCount,
    });
  }

  showVictoryModal({ starNoShuffle, starNoHint, starInTime, earnedStarsCount }) {
    document.getElementById('vicTimeText').textContent = formatTime(this.elapsedSeconds);
    document.getElementById('vicTotalStarsText').textContent = `${this.getTotalStars()}`;
    document.getElementById('vicExpectedLabel').textContent = `⏱ ${formatTime(this.expectedSeconds)}`;

    const starConditions = [starNoShuffle, starNoHint, starInTime];
    const slotIds = ['vicStarSlot0', 'vicStarSlot1', 'vicStarSlot2'];

    // First render all 3 slots as grey unlit stars
    slotIds.forEach(id => {
      const slot = document.getElementById(id);
      slot.innerHTML =
        createStarSVG(false, 'star-svg-base') +
        createStarSVG(true, 'star-svg-lit');
    });

    const bannerText = document.getElementById('vicBannerText');
    if (earnedStarsCount === 3) {
      bannerText.textContent = `完美通关！你在 ${formatTime(this.elapsedSeconds)} 内零提示、零重排拿下满星！`;
    } else if (earnedStarsCount > 0) {
      bannerText.textContent = `恭喜通关第 ${this.levelDef.id} 关！本次点亮 ${earnedStarsCount} 颗星。`;
    } else {
      bannerText.textContent = `第 ${this.levelDef.id} 关已完成！随时可重玩挑战点亮 3 颗星。`;
    }

    this.elVictoryModal.classList.remove('hidden');

    // Animate lighting up earned stars sequentially with Mahjong Titan zoom-slam effect
    let delayIndex = 0;
    starConditions.forEach((earned, idx) => {
      if (earned) {
        const currentOrder = delayIndex++;
        setTimeout(() => {
          const slot = document.getElementById(slotIds[idx]);
          if (!slot) return;
          const litSvg = slot.querySelector('.star-svg-lit');
          if (litSvg) {
            litSvg.classList.add('animate-in');
            feedback.playStarPop(currentOrder);
          }
        }, 280 + currentOrder * 420);
      }
    });
  }

  hideVictoryModal() {
    this.elVictoryModal.classList.add('hidden');
  }

  startTimerLoop() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      if (!this.isPaused && !this.isCompleted) {
        this.elapsedSeconds++;
        this.updateTimerDOM();
      }
    }, 1000);
  }

  updateTimerDOM() {
    if (!this.elTimerText) return;
    this.elTimerText.textContent = formatTime(this.elapsedSeconds);
    this.elExpectedText.textContent = `/ 预计 ${formatTime(this.expectedSeconds)}`;
    const isWithinTime = this.elapsedSeconds <= this.expectedSeconds;
    this.elTimerText.classList.toggle('timer-overtime', !isWithinTime);
    if (this.elLiveStarTime) {
      this.elLiveStarTime.classList.toggle('eligible', isWithinTime);
    }
  }

  updateHUD() {
    if (this.elLevelTitle) {
      const letterBadge = this.levelDef.letter ? ` · ${this.levelDef.letter}` : '';
      this.elLevelTitle.textContent = `关卡 ${this.levelDef.id}${letterBadge}`;
    }
    this.updateTimerDOM();

    const total = this.arrows.length;
    const rem = this.arrows.filter(a => !a.removed).length;
    if (this.elRemainBadge) {
      this.elRemainBadge.textContent = `${rem} / ${total}`;
    }
    if (this.elComboBadge) {
      const mod7 = this.comboCount % 7;
      const prog = this.comboCount > 0 && mod7 === 0 ? 7 : mod7;
      this.elComboBadge.textContent = `🌈 ${prog}/7`;
      this.elComboBadge.title = `当前连击: ${this.comboCount}（每满 7 连击生成一条彩虹箭头）`;
      this.elComboBadge.classList.toggle('combo-active', this.comboCount > 0);
      this.elComboBadge.classList.toggle('combo-rainbow', this.comboCount > 0 && mod7 === 0);
    }

    if (this.elLiveStarShuffle) {
      this.elLiveStarShuffle.classList.toggle('eligible', !this.usedShuffle);
    }
    if (this.elLiveStarHint) {
      this.elLiveStarHint.classList.toggle('eligible', !this.usedHint);
    }
    if (this.elLiveStarTime) {
      this.elLiveStarTime.classList.toggle(
        'eligible',
        this.elapsedSeconds <= this.expectedSeconds
      );
    }
  }

  /**
   * Open Mahjong Titan style Overlay (Boards / Goals / Options)
   */
  openOverlay(tab = 'boards') {
    this.isPaused = true;
    this.elOverlayPanel.classList.remove('hidden');
    this.switchOverlayTab(tab);
  }

  closeOverlay() {
    this.elOverlayPanel.classList.add('hidden');
    this.isPaused = false;
  }

  switchOverlayTab(tab) {
    this.activeMenuTab = tab;
    document
      .getElementById('btnOverlayBoards')
      .classList.toggle('active-tab', tab === 'boards');
    document
      .getElementById('btnOverlayGoals')
      .classList.toggle('active-tab', tab === 'goals');
    document
      .getElementById('btnOverlayOptions')
      .classList.toggle('active-tab', tab === 'options');

    document.getElementById('tabViewBoards').style.display =
      tab === 'boards' ? 'flex' : 'none';
    document.getElementById('tabViewGoals').style.display =
      tab === 'goals' ? 'flex' : 'none';
    document.getElementById('tabViewOptions').style.display =
      tab === 'options' ? 'flex' : 'none';

    if (tab === 'boards') {
      this.renderBoardsList();
    } else if (tab === 'goals') {
      this.renderGoalsView();
    } else if (tab === 'options') {
      this.renderOptionsView();
    }
  }

  /**
   * Render the Mahjong Titan Screenshot 3 style Boards List
   * Each row shows: mini pattern thumbnail + level number & expected time + 3 stars (grey before play, gold when lit)
   */
  renderBoardsList() {
    const listContainer = document.getElementById('boardsListContainer');
    const summaryText = document.getElementById('boardsSummaryText');
    const totalStarsEl = document.getElementById('boardsTotalStars');

    const totalLevels = LEVEL_DEFINITIONS.length;
    const finishedCount = LEVEL_DEFINITIONS.filter(
      l => this.saveData.levelRecords[l.id]?.finished
    ).length;

    summaryText.textContent = `已完成 ${finishedCount} / ${totalLevels} 关`;
    totalStarsEl.innerHTML = `${this.getTotalStars()} <span>★</span>`;

    const filtered = LEVEL_DEFINITIONS.filter(lvl => {
      const isFin = Boolean(this.saveData.levelRecords[lvl.id]?.finished);
      if (this.boardFilter === 'finished') return isFin;
      if (this.boardFilter === 'unfinished') return !isFin;
      return true;
    });

    listContainer.innerHTML = '';

    filtered.forEach(lvl => {
      const rec = this.saveData.levelRecords[lvl.id];
      const earnedStars = rec && rec.finished ? rec.stars : 0;
      const isCurrent = lvl.id === this.levelDef.id;

      const row = document.createElement('div');
      row.className = `board-row-item ${isCurrent ? 'current-level' : ''}`;

      const left = document.createElement('div');
      left.className = 'board-row-left';

      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.width = 50;
      thumbCanvas.height = 50;
      thumbCanvas.className = 'board-thumb-canvas';
      this.drawLevelThumbnail(thumbCanvas, lvl.mask);

      const info = document.createElement('div');
      info.className = 'board-row-info';
      info.innerHTML = `
        <div class="board-row-number">
          <span>${lvl.id}</span>
          <span style="font-size:13px;font-weight:500;color:#cbd5e1;">${lvl.name}</span>
        </div>
        <div class="board-row-subtitle">
          难度: ${lvl.difficulty} · 预计时间 ${formatTime(lvl.expectedSeconds)}
          ${rec?.finished && isFinite(rec.bestTime) ? ` · 最佳 ${formatTime(rec.bestTime)}` : ''}
        </div>
      `;

      left.appendChild(thumbCanvas);
      left.appendChild(info);

      const starsWrap = document.createElement('div');
      starsWrap.className = 'board-row-stars';
      for (let s = 1; s <= 3; s++) {
        const starSpan = document.createElement('span');
        starSpan.className = 'row-star-icon';
        starSpan.innerHTML = createStarSVG(s <= earnedStars);
        starsWrap.appendChild(starSpan);
      }

      row.appendChild(left);
      row.appendChild(starsWrap);

      row.addEventListener('click', () => {
        const idx = LEVEL_DEFINITIONS.findIndex(item => item.id === lvl.id);
        this.closeOverlay();
        this.startLevel(idx, true);
      });

      listContainer.appendChild(row);
    });
  }

  /**
   * Draw mini golden-tile silhouette of the level's shape mask (Mahjong Titan Screenshot 3 style)
   */
  drawLevelThumbnail(canvas, mask) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    ctx.fillStyle = '#3d4047';
    ctx.fillRect(0, 0, W, H);

    const rows = mask.length;
    const cols = mask[0].length;
    const pad = 6;
    const cell = Math.min((W - pad * 2) / cols, (H - pad * 2) / rows);
    const ox = (W - cols * cell) / 2;
    const oy = (H - rows * cell) / 2;

    ctx.fillStyle = '#e9dca3';
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (mask[r][c] === 1) {
          ctx.fillRect(
            ox + c * cell + 0.35,
            oy + r * cell + 0.35,
            Math.max(1, cell - 0.7),
            Math.max(1, cell - 0.7)
          );
        }
      }
    }
  }

  renderGoalsView() {
    const container = document.getElementById('goalsContentContainer');
    const totalLevels = LEVEL_DEFINITIONS.length;
    const maxStars = totalLevels * 3;
    const curStars = this.getTotalStars();
    const finishedLevels = LEVEL_DEFINITIONS.filter(
      l => this.saveData.levelRecords[l.id]?.finished
    ).length;
    const threeStarLevels = LEVEL_DEFINITIONS.filter(
      l => this.saveData.levelRecords[l.id]?.stars === 3
    ).length;

    const goals = [
      {
        title: '初露锋芒',
        desc: '完成任意 1 个英文字母关卡',
        done: finishedLevels >= 1,
      },
      {
        title: '完美主义',
        desc: '在任意关卡中不重排、不用提示且在预计时间内完成（获得 3 颗星）',
        done: threeStarLevels >= 1,
      },
      {
        title: '经典 B 字降服者',
        desc: '通关第 2 关（字母 B · 经典双环迷阵）',
        done: Boolean(this.saveData.levelRecords[2]?.finished),
      },
      {
        title: '渐入佳境',
        desc: '累计点亮 30 颗星星',
        done: curStars >= 30,
      },
      {
        title: '全字母制霸 (A-Z)',
        desc: `通关全部 ${totalLevels} 个英文字母关卡 (${finishedLevels}/${totalLevels})`,
        done: finishedLevels >= totalLevels,
      },
      {
        title: '满星传奇',
        desc: `收集全部 ${maxStars} 颗星星 (${curStars}/${maxStars})`,
        done: curStars >= maxStars,
      },
    ];

    container.innerHTML = goals
      .map(
        g => `
        <div class="setting-card">
          <div>
            <div class="setting-card-title">${g.title}</div>
            <div class="setting-card-desc">${g.desc}</div>
          </div>
          <div style="width:32px;height:32px;flex-shrink:0;">
            ${createStarSVG(g.done)}
          </div>
        </div>
      `
      )
      .join('');
  }

  renderOptionsView() {
    const container = document.getElementById('optionsContentContainer');
    container.innerHTML = `
      <div class="setting-card">
        <div>
          <div class="setting-card-title">游戏音效 (Sound)</div>
          <div class="setting-card-desc">箭头滑出、碰错闷响与点亮星星音效</div>
        </div>
        <button id="optSoundBtn" class="toggle-btn ${this.saveData.sound ? 'on' : ''}">
          ${this.saveData.sound ? '开启' : '关闭'}
        </button>
      </div>

      <div class="setting-card">
        <div>
          <div class="setting-card-title">手机振动提醒 (Vibration)</div>
          <div class="setting-card-desc">碰错被阻挡的箭头时通过振动反馈（不计失败）</div>
        </div>
        <button id="optVibrateBtn" class="toggle-btn ${this.saveData.vibrate ? 'on' : ''}">
          ${this.saveData.vibrate ? '开启' : '关闭'}
        </button>
      </div>

      <div class="setting-card">
        <div>
          <div class="setting-card-title">画面主题配色 (Theme)</div>
          <div class="setting-card-desc">切换《一箭又一箭》经典深邃夜色或明亮日间模式</div>
        </div>
        <button id="optThemeBtn" class="toggle-btn on">
          ${this.saveData.theme === 'dark' ? '🌙 夜间深蓝' : '☀️ 日间明亮'}
        </button>
      </div>

      <div class="setting-card">
        <div>
          <div class="setting-card-title">全屏沉浸模式 (Fullscreen)</div>
          <div class="setting-card-desc">隐藏浏览器工具栏，享受 16:9 全屏游戏体验</div>
        </div>
        <button id="optFsBtn" class="toggle-btn on">切换全屏</button>
      </div>

      <div class="setting-card">
        <div>
          <div class="setting-card-title">手机无网本地畅玩包 (Offline HTML)</div>
          <div class="setting-card-desc">下载独立单文件版到手机本地，断网/飞行模式也能直接点开玩</div>
        </div>
        <a
          href="./一箭又一箭_手机离线单文件版.html"
          download="一箭又一箭_手机离线单文件版.html"
          class="toggle-btn on"
          style="text-decoration:none;display:inline-block;text-align:center;"
        >下载离线版</a>
      </div>
    `;

    document.getElementById('optSoundBtn').addEventListener('click', () => {
      this.saveData.sound = !this.saveData.sound;
      feedback.soundEnabled = this.saveData.sound;
      this.persistSaveData();
      this.renderOptionsView();
    });

    document.getElementById('optVibrateBtn').addEventListener('click', () => {
      this.saveData.vibrate = !this.saveData.vibrate;
      feedback.vibrateEnabled = this.saveData.vibrate;
      if (this.saveData.vibrate) feedback.vibrate(40);
      this.persistSaveData();
      this.renderOptionsView();
    });

    document.getElementById('optThemeBtn').addEventListener('click', () => {
      const next = this.saveData.theme === 'dark' ? 'light' : 'dark';
      this.applyTheme(next);
      this.renderOptionsView();
    });

    document.getElementById('optFsBtn').addEventListener('click', () => {
      this.toggleFullscreen();
    });
  }

  toggleFullscreen() {
    const doc = document;
    const el = doc.documentElement;
    if (!doc.fullscreenElement && !doc.webkitFullscreenElement) {
      if (el.requestFullscreen) {
        el.requestFullscreen().catch(() => {});
      } else if (el.webkitRequestFullscreen) {
        el.webkitRequestFullscreen();
      }
    } else {
      if (doc.exitFullscreen) {
        doc.exitFullscreen().catch(() => {});
      } else if (doc.webkitExitFullscreen) {
        doc.webkitExitFullscreen();
      }
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.arrowGame = new ArrowGameApp();
});
