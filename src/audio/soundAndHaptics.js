/**
 * Web Audio Synthesizer & Mobile Haptics Controller
 * Zero external audio assets needed — crisp, responsive procedural sound effects + vibration.
 */

class FeedbackController {
  constructor() {
    this.ctx = null;
    this.noiseBuffer = null;
    this.soundEnabled = true;
    this.vibrateEnabled = true;
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
    if (this.ctx && !this.noiseBuffer) {
      // Pre-build a 0.25s white noise buffer for arrow fletching whoosh & target impact transients
      const sr = this.ctx.sampleRate;
      const len = Math.floor(sr * 0.25);
      const buf = this.ctx.createBuffer(1, len, sr);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      this.noiseBuffer = buf;
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
   * Realistic Archery Sound: Arrow Fletching Whoosh + Bullseye Target Impact Thwack ("嗖—笃！")
   */
  playArrowClear() {
    if (!this.soundEnabled) return;
    this.initContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;

    // 1. Phase 1 (0 ~ 50ms): Arrow Fletching Air Whoosh ("嗖")
    if (this.noiseBuffer) {
      const whooshSrc = this.ctx.createBufferSource();
      whooshSrc.buffer = this.noiseBuffer;

      const whooshFilter = this.ctx.createBiquadFilter();
      whooshFilter.type = 'bandpass';
      whooshFilter.Q.setValueAtTime(3.0, t);
      whooshFilter.frequency.setValueAtTime(2400, t);
      whooshFilter.frequency.exponentialRampToValueAtTime(650, t + 0.052);

      const whooshGain = this.ctx.createGain();
      whooshGain.gain.setValueAtTime(0.001, t);
      whooshGain.gain.linearRampToValueAtTime(0.18, t + 0.012);
      whooshGain.gain.exponentialRampToValueAtTime(0.001, t + 0.058);

      whooshSrc.connect(whooshFilter);
      whooshFilter.connect(whooshGain);
      whooshGain.connect(this.ctx.destination);
      whooshSrc.onended = () => {
        try {
          whooshSrc.disconnect();
          whooshFilter.disconnect();
          whooshGain.disconnect();
        } catch (_) {}
      };
      whooshSrc.start(t);
      whooshSrc.stop(t + 0.06);
    }

    // 2. Phase 2 (36 ~ 165ms): Arrowhead Hitting Target Bullseye ("笃！")
    const hitTime = t + 0.036;

    // 2a. Target surface leather/straw impact transient click
    if (this.noiseBuffer) {
      const hitNoise = this.ctx.createBufferSource();
      hitNoise.buffer = this.noiseBuffer;

      const hitFilter = this.ctx.createBiquadFilter();
      hitFilter.type = 'bandpass';
      hitFilter.Q.setValueAtTime(1.8, hitTime);
      hitFilter.frequency.setValueAtTime(980, hitTime);
      hitFilter.frequency.exponentialRampToValueAtTime(360, hitTime + 0.032);

      const hitNoiseGain = this.ctx.createGain();
      hitNoiseGain.gain.setValueAtTime(0.001, hitTime);
      hitNoiseGain.gain.linearRampToValueAtTime(0.32, hitTime + 0.003);
      hitNoiseGain.gain.exponentialRampToValueAtTime(0.001, hitTime + 0.035);

      hitNoise.connect(hitFilter);
      hitFilter.connect(hitNoiseGain);
      hitNoiseGain.connect(this.ctx.destination);
      hitNoise.onended = () => {
        try {
          hitNoise.disconnect();
          hitFilter.disconnect();
          hitNoiseGain.disconnect();
        } catch (_) {}
      };
      hitNoise.start(hitTime);
      hitNoise.stop(hitTime + 0.038);
    }

    // 2b. Solid target body low-mid punch thump (265 Hz -> 58 Hz)
    const punchOsc = this.ctx.createOscillator();
    const punchGain = this.ctx.createGain();
    punchOsc.type = 'triangle';
    punchOsc.frequency.setValueAtTime(265, hitTime);
    punchOsc.frequency.exponentialRampToValueAtTime(58, hitTime + 0.095);

    punchGain.gain.setValueAtTime(0.001, hitTime);
    punchGain.gain.linearRampToValueAtTime(0.36, hitTime + 0.005);
    punchGain.gain.exponentialRampToValueAtTime(0.001, hitTime + 0.135);

    punchOsc.connect(punchGain);
    punchGain.connect(this.ctx.destination);
    punchOsc.onended = () => {
      try {
        punchOsc.disconnect();
        punchGain.disconnect();
      } catch (_) {}
    };
    punchOsc.start(hitTime);
    punchOsc.stop(hitTime + 0.14);

    // 2c. Subtle wooden arrow-shaft vibration resonance (390 Hz -> 330 Hz)
    const shaftOsc = this.ctx.createOscillator();
    const shaftGain = this.ctx.createGain();
    shaftOsc.type = 'sine';
    shaftOsc.frequency.setValueAtTime(395, hitTime + 0.005);
    shaftOsc.frequency.exponentialRampToValueAtTime(330, hitTime + 0.09);

    shaftGain.gain.setValueAtTime(0.001, hitTime + 0.005);
    shaftGain.gain.linearRampToValueAtTime(0.09, hitTime + 0.012);
    shaftGain.gain.exponentialRampToValueAtTime(0.001, hitTime + 0.095);

    shaftOsc.connect(shaftGain);
    shaftGain.connect(this.ctx.destination);
    shaftOsc.onended = () => {
      try {
        shaftOsc.disconnect();
        shaftGain.disconnect();
      } catch (_) {}
    };
    shaftOsc.start(hitTime + 0.005);
    shaftOsc.stop(hitTime + 0.1);
  }

  /**
   * 7-Combo Rainbow Arrow Spawn Chime
   */
  playRainbowSpawn() {
    if (!this.soundEnabled) return;
    this.initContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t + i * 0.045);
      gain.gain.setValueAtTime(0.001, t + i * 0.045);
      gain.gain.linearRampToValueAtTime(0.15, t + i * 0.045 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.045 + 0.22);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t + i * 0.045);
      osc.stop(t + i * 0.045 + 0.23);
    });
  }

  /**
   * Rainbow Bonus Red Arrow Lock-on Sound
   */
  playBonusRedLock() {
    if (!this.soundEnabled) return;
    this.initContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    [783.99, 1046.5].forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t + i * 0.055);
      gain.gain.setValueAtTime(0.001, t + i * 0.055);
      gain.gain.linearRampToValueAtTime(0.16, t + i * 0.055 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.055 + 0.16);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t + i * 0.055);
      osc.stop(t + i * 0.055 + 0.17);
    });
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
