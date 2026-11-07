/**
 * Web Audio Synthesizer & Mobile Haptics Controller
 * Zero external audio assets needed — crisp, responsive procedural sound effects + vibration.
 */

class FeedbackController {
  constructor() {
    this.ctx = null;
    this.soundEnabled = true;
    this.vibrateEnabled = true;
    this.comboCount = 0;
    this.lastClearTime = 0;
  }

  initContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  /**
   * Trigger phone vibration (Rule 2: vibrate on blocked arrow tap)
   */
  vibrate(pattern = [45, 30, 55]) {
    if (!this.vibrateEnabled) return;
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(pattern);
      }
    } catch (_) {
      // Ignore if unsupported by browser
    }
  }

  /**
   * Crisp, satisfying arrow launch / slither-out sound
   */
  playArrowClear() {
    if (!this.soundEnabled) return;
    this.initContext();
    if (!this.ctx) return;

    const now = performance.now();
    if (now - this.lastClearTime < 2200) {
      this.comboCount = Math.min(this.comboCount + 1, 10);
    } else {
      this.comboCount = 0;
    }
    this.lastClearTime = now;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    // Pentatonic scale progression for combo satisfaction
    const baseFreqs = [392.0, 440.0, 493.88, 587.33, 659.25, 783.99, 880.0, 987.77, 1174.66];
    const startFreq = baseFreqs[this.comboCount % baseFreqs.length];

    osc.type = 'sine';
    osc.frequency.setValueAtTime(startFreq, t);
    osc.frequency.exponentialRampToValueAtTime(startFreq * 1.45, t + 0.14);

    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(0.18, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.17);
  }

  /**
   * Rule 2: Blocked arrow tactile vibration + soft wooden thud (never punishing, just clear feedback)
   */
  triggerBlockedFeedback() {
    this.vibrate([45, 30, 55]);
    if (!this.soundEnabled) return;
    this.initContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(145, t);
    osc.frequency.exponentialRampToValueAtTime(72, t + 0.09);

    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(0.22, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.11);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.12);
  }

  /**
   * Hint button sparkle sound
   */
  playHint() {
    if (!this.soundEnabled) return;
    this.initContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    [587.33, 880.0].forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t + i * 0.06);
      gain.gain.setValueAtTime(0.001, t + i * 0.06);
      gain.gain.linearRampToValueAtTime(0.14, t + i * 0.06 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.06 + 0.22);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t + i * 0.06);
      osc.stop(t + i * 0.06 + 0.23);
    });
  }

  /**
   * Shuffle button ripple sound
   */
  playShuffle() {
    if (!this.soundEnabled) return;
    this.initContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const notes = [330, 392, 493.88, 587.33];
    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t + idx * 0.04);
      gain.gain.setValueAtTime(0.001, t + idx * 0.04);
      gain.gain.linearRampToValueAtTime(0.12, t + idx * 0.04 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.04 + 0.14);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t + idx * 0.04);
      osc.stop(t + idx * 0.04 + 0.15);
    });
  }

  /**
   * Star lighting pop sound (for Victory Modal star animation 1, 2, 3)
   */
  playStarPop(starIndex = 0) {
    this.vibrate(25);
    if (!this.soundEnabled) return;
    this.initContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const freqs = [523.25, 659.25, 783.99, 1046.5];
    const freq = freqs[Math.min(starIndex, freqs.length - 1)];

    const osc = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc2.type = 'triangle';
    osc.frequency.setValueAtTime(freq, t);
    osc2.frequency.setValueAtTime(freq * 1.5, t);

    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(0.2, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.38);

    osc.connect(gain);
    osc2.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(t);
    osc2.start(t);
    osc.stop(t + 0.4);
    osc2.stop(t + 0.4);
  }
}

export const feedback = new FeedbackController();
