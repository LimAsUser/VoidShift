/**
 * VOID SHIFT // RECOVERY OPERATIONS PROTOCOL
 * Sound Engine (Web Audio API Manager with Directional Spatial Audio & Adaptive Helmet Breathing)
 */

class AudioManager {
  constructor() {
    this.context = null;
    this.master = null;
    this.hasStereoPanner = false;

    // Proximity rumble and heartbeat
    this.proximityGain = null;
    this.proximityOscillator = null;
    this.proximityPanner = null;
    this.lastPulse = 0;
    this.lastStep = 0;
    this.lastVisiblePulse = 0;
    this.lastClawSound = 0;

    // Ambient loop nodes
    this.ambientSource = null;
    this.activeSources = new Set();
    this.scheduledAudioTimers = new Set();
    this.audioGeneration = 0;
    this.missionAudioMuted = false;
  }

  /**
   * Initializes or resumes the AudioContext on user interaction
   */
  ensureAudio() {
    if (this.context) {
      if (this.context.state === 'suspended') {
        this.context.resume();
      }
      return;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    this.context = new AudioContextClass();
    this.hasStereoPanner = typeof this.context.createStereoPanner === 'function';

    this.master = this.context.createGain();
    this.master.gain.value = 1.2;
    this.master.connect(this.context.destination);

    // Setup Monster Proximity Rumble with Directional Panner
    this.proximityGain = this.context.createGain();
    this.proximityGain.gain.value = 0;

    if (this.hasStereoPanner) {
      this.proximityPanner = this.context.createStereoPanner();
      this.proximityGain.connect(this.proximityPanner);
      this.proximityPanner.connect(this.master);
    } else {
      this.proximityGain.connect(this.master);
    }

    this.proximityOscillator = this.context.createOscillator();
    this.proximityOscillator.type = 'sine';
    this.proximityOscillator.frequency.value = 48;
    this.proximityOscillator.connect(this.proximityGain);
    this.proximityOscillator.start();

  }

  /**
   * Loads and plays the casual horror background noise in an infinite loop
   */
  async playAmbientNoiseLoop() {
    if (!this.context || this.missionAudioMuted || this.ambientSource) return;
    const generation = this.audioGeneration;
    try {
      const response = await fetch('resources/casual horror background white noise-253834.mp3');
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.context.decodeAudioData(arrayBuffer);
      if (this.missionAudioMuted || generation !== this.audioGeneration) return;

      this.ambientSource = this.context.createBufferSource();
      this.ambientSource.buffer = audioBuffer;
      this.ambientSource.loop = true;

      const ambientGain = this.context.createGain();
      ambientGain.gain.value = 0.22; // Low background white noise volume

      this.ambientSource.connect(ambientGain);
      ambientGain.connect(this.master);
      this._trackSource(this.ambientSource);
      this.ambientSource.start(0);
    } catch (e) {
      console.warn('Failed to load background white noise:', e);
    }
  }

  /**
   * Cleans audio nodes on teardown
   */
  destroy() {
    this.stopMissionAudio();
    if (this.context && this.context.state !== 'closed') {
      this.context.close();
    }
  }

  _trackSource(source) {
    if (!source) return source;
    this.activeSources.add(source);
    source.onended = () => this.activeSources.delete(source);
    return source;
  }

  _scheduleAudio(callback, delay) {
    if (this.missionAudioMuted) return null;
    const generation = this.audioGeneration;
    let timer = null;
    timer = setTimeout(() => {
      this.scheduledAudioTimers.delete(timer);
      if (!this.missionAudioMuted && generation === this.audioGeneration) callback();
    }, delay);
    this.scheduledAudioTimers.add(timer);
    return timer;
  }

  playToneAfterDelay(frequency, delay, duration, volume, type = 'sine') {
    return this._scheduleAudio(() => this.playTone(frequency, duration, volume, type), delay);
  }

  stopMissionAudio() {
    this.missionAudioMuted = true;
    this.audioGeneration++;
    this.scheduledAudioTimers.forEach(timer => clearTimeout(timer));
    this.scheduledAudioTimers.clear();
    this.activeSources.forEach(source => {
      try { source.stop(); } catch (_) { /* already ended */ }
    });
    this.activeSources.clear();
    this.ambientSource = null;
    const now = this.context ? this.context.currentTime : 0;
    [this.master?.gain, this.proximityGain?.gain].forEach(param => {
      if (!param) return;
      try {
        param.cancelScheduledValues(now);
        param.setValueAtTime(0, now);
      } catch (_) {
        param.value = 0;
      }
    });
  }

  beginMissionAudio() {
    this.ensureAudio();
    if (!this.context) return;
    this.audioGeneration++;
    this.missionAudioMuted = false;
    const now = this.context.currentTime;
    if (this.master) this.master.gain.setValueAtTime(1.2, now);
    if (this.proximityGain) this.proximityGain.gain.setValueAtTime(0, now);
    this.playAmbientNoiseLoop();
  }

  /**
   * Sound effect when player inputs a correct QTE key in sequence
   */
  playQTEKeyBeep(index = 0) {
    if (!this.context) return;
    const baseFreq = 520 + (index % 5) * 110;
    this.playTone(baseFreq, 0.07, 0.12, 'sine');
  }

  /**
   * Sound effect when a QTE terminal is successfully fully overridden
   */
  playQTESuccess() {
    if (!this.context || this.missionAudioMuted) return;
    this.playTone(659, 0.12, 0.14, 'triangle');
    this._scheduleAudio(() => {
      this.playTone(880, 0.15, 0.15, 'triangle');
      this._scheduleAudio(() => {
        this.playTone(1174, 0.22, 0.16, 'triangle');
      }, 120);
    }, 100);
  }

  /**
   * LOUD alarm siren emitted when player fails a QTE sequence
   */
  playLoudAlarmSound() {
    if (!this.context || this.missionAudioMuted) return;
    try {
      const now = this.context.currentTime;
      const osc1 = this.context.createOscillator();
      const osc2 = this.context.createOscillator();
      const alarmGain = this.context.createGain();

      osc1.type = 'sawtooth';
      osc2.type = 'sawtooth';

      osc1.frequency.setValueAtTime(880, now);
      osc1.frequency.linearRampToValueAtTime(620, now + 0.2);
      osc1.frequency.linearRampToValueAtTime(940, now + 0.4);
      osc1.frequency.linearRampToValueAtTime(580, now + 0.6);

      osc2.frequency.setValueAtTime(920, now);
      osc2.frequency.linearRampToValueAtTime(660, now + 0.2);
      osc2.frequency.linearRampToValueAtTime(980, now + 0.4);
      osc2.frequency.linearRampToValueAtTime(620, now + 0.6);

      alarmGain.gain.setValueAtTime(0.42, now);
      alarmGain.gain.setValueAtTime(0.48, now + 0.3);
      alarmGain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);

      osc1.connect(alarmGain);
      osc2.connect(alarmGain);
      this._trackSource(osc1);
      this._trackSource(osc2);
      alarmGain.connect(this.master);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.68);
      osc2.stop(now + 0.68);
    } catch (e) {
      console.warn('Failed to play loud alarm sound:', e);
    }
  }

  /**
   * High-voltage electrical shock / zap sound effect when QTE fails or times out
   */
  playElectricShock() {
    if (!this.context || this.missionAudioMuted) return;
    try {
      const now = this.context.currentTime;
      const osc = this.context.createOscillator();
      const crackle = this.context.createOscillator();
      const shockGain = this.context.createGain();

      osc.type = 'sawtooth';
      crackle.type = 'square';

      // Harsh pitch dive from 2400Hz to 80Hz
      osc.frequency.setValueAtTime(2400, now);
      osc.frequency.exponentialRampToValueAtTime(80, now + 0.35);

      // Jitter crackle frequency
      crackle.frequency.setValueAtTime(140, now);
      crackle.frequency.setValueAtTime(280, now + 0.05);
      crackle.frequency.setValueAtTime(95, now + 0.12);
      crackle.frequency.setValueAtTime(320, now + 0.2);
      crackle.frequency.setValueAtTime(60, now + 0.3);

      shockGain.gain.setValueAtTime(0.5, now);
      shockGain.gain.linearRampToValueAtTime(0.65, now + 0.06);
      shockGain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);

      osc.connect(shockGain);
      crackle.connect(shockGain);
      shockGain.connect(this.master);

      this._trackSource(osc);
      this._trackSource(crackle);

      osc.start(now);
      crackle.start(now);
      osc.stop(now + 0.45);
      crackle.stop(now + 0.45);
    } catch (e) {
      console.warn('Failed to play electric shock sound:', e);
    }
  }

  /**
   * Short error buzz when an incorrect QTE key is entered
   */
  playQTEErrorBeep() {
    if (!this.context) return;
    try {
      this.playTone(135, 0.16, 0.12, 'sawtooth');
    } catch (e) {
      console.warn('Failed to play QTE error beep:', e);
    }
  }

  /**
   * Calculates directional stereo panning (-1.0 left to +1.0 right)
   * and distance attenuation relative to listener position and facing angle
   */
  calculateSpatial(listenerX, listenerY, listenerAngle, sourceX, sourceY, maxDist = 650) {
    const dx = sourceX - listenerX;
    const dy = sourceY - listenerY;
    const distance = Math.hypot(dx, dy);

    if (distance <= 0.001) {
      return { pan: 0, distanceGain: 1, distance: 0, isBehind: false };
    }

    const worldAngle = Math.atan2(dy, dx);
    const relAngle = Math.atan2(Math.sin(worldAngle - listenerAngle), Math.cos(worldAngle - listenerAngle));

    // sin(relAngle): -1 on direct left (-PI/2), +1 on direct right (+PI/2), 0 straight ahead or behind
    const pan = Math.max(-1, Math.min(1, Math.sin(relAngle)));

    // Smooth quadratic distance attenuation
    const distRatio = Math.min(1, distance / maxDist);
    const distanceGain = Math.max(0, 1 - distRatio) * (1 - distRatio * 0.35);

    // Behind check for subtle high frequency muffling
    const isBehind = Math.cos(relAngle) < 0;

    return { pan, distanceGain, distance, isBehind, relAngle };
  }

  /**
   * Plays a pre-recorded sound effect
   */
  async playSound(url, volume = 1.0) {
    if (!this.context || this.missionAudioMuted) return;
    const generation = this.audioGeneration;
    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.context.decodeAudioData(arrayBuffer);
      if (this.missionAudioMuted || generation !== this.audioGeneration) return;
      const source = this.context.createBufferSource();
      const gain = this.context.createGain();

      source.buffer = audioBuffer;
      gain.gain.value = volume;

      source.connect(gain);
      gain.connect(this.master);
      this._trackSource(source);
      source.start(0);
    } catch (e) {
      console.error('Failed to play sound:', e);
    }
  }

  /**
   * Plays a single synthetic sound effect (center mono)
   */
  playTone(frequency, duration, volume, type = 'sine') {
    if (!this.context || this.missionAudioMuted) return;
    try {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      const ct = this.context.currentTime;

      oscillator.type = type;
      oscillator.frequency.value = frequency;

      gain.gain.setValueAtTime(volume, ct);
      gain.gain.exponentialRampToValueAtTime(0.001, ct + duration);

      oscillator.connect(gain);
      gain.connect(this.master);

      this._trackSource(oscillator);
      oscillator.start();
      oscillator.stop(ct + duration);
    } catch (e) {
      console.warn('Failed to play tone:', e);
    }
  }

  /**
   * Plays a synthetic sound effect with 3D stereo panning and distance attenuation
   */
  playSpatialTone(frequency, duration, volume, type = 'sine', pan = 0, distanceGain = 1, isBehind = false) {
    if (!this.context || this.missionAudioMuted) return;
    try {
      const effectiveVolume = volume * distanceGain;
      if (effectiveVolume <= 0.001) return;

      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      const ct = this.context.currentTime;

      oscillator.type = type;
      oscillator.frequency.value = frequency;

      gain.gain.setValueAtTime(effectiveVolume, ct);
      gain.gain.exponentialRampToValueAtTime(0.001, ct + duration);

      let lastNode = gain;
      oscillator.connect(gain);

      // Behind listener muffling (head-shadow lowpass simulation)
      if (isBehind) {
        const muff = this.context.createBiquadFilter();
        muff.type = 'lowpass';
        muff.frequency.value = Math.max(320, frequency * 1.6);
        lastNode.connect(muff);
        lastNode = muff;
      }

      if (this.hasStereoPanner) {
        const panner = this.context.createStereoPanner();
        panner.pan.value = pan;
        lastNode.connect(panner);
        panner.connect(this.master);
      } else {
        lastNode.connect(this.master);
      }

      this._trackSource(oscillator);
      oscillator.start(ct);
      oscillator.stop(ct + duration);
    } catch (e) {
      console.warn('Failed to play spatial tone:', e);
    }
  }

  /**
   * Updates proximity rumble, heartbeat audio cues, and directional panning
   */
  update(player, monster, mapManager, hunters) {
    if (this.missionAudioMuted) return;
    // Pick the nearest active threat (ghost or any hunter) to drive proximity audio
    const activeHunters = (hunters && Array.isArray(hunters))
      ? hunters.filter(h => h.active && !h.dead)
      : [];
    let activeThreat = null;
    const candidates = monster.active ? [monster, ...activeHunters] : activeHunters;
    candidates.forEach(c => {
      const d = Math.hypot(c.x - player.x, c.y - player.y);
      if (!activeThreat || d < Math.hypot(activeThreat.x - player.x, activeThreat.y - player.y)) {
        activeThreat = c;
      }
    });

    if (!this.context || !activeThreat) {
      if (this.proximityGain) {
        this.proximityGain.gain.setTargetAtTime(0, this.context.currentTime, 0.05);
      }
      return;
    }

    const spatial = this.calculateSpatial(player.x, player.y, player.angle, activeThreat.x, activeThreat.y, 650);
    const distance = spatial.distance;
    const proximity = activeThreat.alerted ? Math.max(0, 1 - distance / 650) : 0;
    const toMonster = Math.atan2(activeThreat.y - player.y, activeThreat.x - player.x);
    const wallDistance = mapManager.rayWallDistance(player.x, player.y, Math.cos(toMonster), Math.sin(toMonster), 650);
    const visible = activeThreat.alerted && distance < wallDistance + activeThreat.radius + 12;
    const now = performance.now();

    // Update continuous directional stereo panning for the monster
    if (this.proximityPanner) {
      this.proximityPanner.pan.setTargetAtTime(spatial.pan, this.context.currentTime, 0.05);
    }

    // Smooth gain & pitch transition based on monster proximity
    this.proximityGain.gain.setTargetAtTime(proximity * 0.42, this.context.currentTime, 0.05);
    this.proximityOscillator.frequency.setTargetAtTime(42 + proximity * 130, this.context.currentTime, 0.08);

    // Heartbeat pulse cadence with directional stereo position
    const pulseGap = 720 - proximity * 650;
    if (activeThreat.alerted && now - this.lastPulse > pulseGap) {
      this.lastPulse = now;
      this.playSpatialTone(58 + proximity * 65, 0.13, 0.12 + proximity * 0.2, 'sine', spatial.pan, 1, spatial.isBehind);

      if (proximity > 0.72) {
        this.playSpatialTone(122 + proximity * 70, 0.07, 0.07 + proximity * 0.12, 'square', spatial.pan, 1, spatial.isBehind);
      }
    }

    // High intensity line-of-sight click with directional positioning
    if (visible && now - this.lastVisiblePulse > (260 - proximity * 150)) {
      this.lastVisiblePulse = now;
      this.playSpatialTone(190 + proximity * 90, 0.08, 0.08 + proximity * 0.1, 'square', spatial.pan, 1, spatial.isBehind);
    }

    // Subtle distant skittering / claw scraping when monster moves within 450px
    if (distance < 450 && now - this.lastClawSound > 600 + Math.random() * 800) {
      this.lastClawSound = now;
      this.playSpatialTone(140 + Math.random() * 80, 0.06, 0.05 + proximity * 0.08, 'sawtooth', spatial.pan, spatial.distanceGain, spatial.isBehind);
    }
  }
}
