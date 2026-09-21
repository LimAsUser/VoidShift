/**
 * VOID SHIFT // RECOVERY OPERATIONS PROTOCOL
 * Sound Engine (Web Audio API Manager)
 */

class AudioManager {
  constructor() {
    this.context = null;
    this.master = null;
    this.proximityGain = null;
    this.proximityOscillator = null;
    this.lastPulse = 0;
    this.lastStep = 0;
    this.lastVisiblePulse = 0;
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

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = 1.2;
    this.master.connect(this.context.destination);

    this.proximityGain = this.context.createGain();
    this.proximityGain.gain.value = 0;
    this.proximityGain.connect(this.master);

    this.proximityOscillator = this.context.createOscillator();
    this.proximityOscillator.type = 'sine';
    this.proximityOscillator.frequency.value = 48;
    this.proximityOscillator.connect(this.proximityGain);
    this.proximityOscillator.start();
  }

  /**
   * Plays a pre-recorded sound effect
   */
  async playSound(url, volume = 1.0) {
    if (!this.context) return;
    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.context.decodeAudioData(arrayBuffer);
      const source = this.context.createBufferSource();
      const gain = this.context.createGain();

      source.buffer = audioBuffer;
      gain.gain.value = volume;

      source.connect(gain);
      gain.connect(this.master);
      source.start(0);
    } catch (e) {
      console.error('Failed to play sound:', e);
    }
  }

  /**
   * Plays a single synthetic sound effect
   */
  playTone(frequency, duration, volume, type = 'sine') {
    if (!this.context) return;
    try {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      
      oscillator.type = type;
      oscillator.frequency.value = frequency;

      gain.gain.setValueAtTime(volume, this.context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.context.currentTime + duration);

      oscillator.connect(gain);
      gain.connect(this.master);

      oscillator.start();
      oscillator.stop(this.context.currentTime + duration);
    } catch (e) {
      console.warn('Failed to play tone:', e);
    }
  }

  /**
   * Updates proximity rumble and heartbeat audio cues
   */
  update(player, monster, mapManager) {
    if (!this.context || !monster.active) return;

    const distance = Math.hypot(monster.x - player.x, monster.y - player.y);
    const proximity = monster.alerted ? Math.max(0, 1 - distance / 650) : 0;
    const toMonster = Math.atan2(monster.y - player.y, monster.x - player.x);
    const wallDistance = mapManager.rayWallDistance(player.x, player.y, Math.cos(toMonster), Math.sin(toMonster), 650);
    const visible = monster.alerted && distance < wallDistance + monster.radius + 12;
    const now = performance.now();

    // Smooth gain & pitch transition based on monster proximity
    this.proximityGain.gain.setTargetAtTime(proximity * 0.42, this.context.currentTime, 0.05);
    this.proximityOscillator.frequency.setTargetAtTime(42 + proximity * 130, this.context.currentTime, 0.08);

    // Heartbeat pulse cadence
    const pulseGap = 720 - proximity * 650;
    if (monster.alerted && now - this.lastPulse > pulseGap) {
      this.lastPulse = now;
      this.playTone(58 + proximity * 65, 0.13, 0.12 + proximity * 0.2, 'sine');
      
      if (proximity > 0.72) {
        this.playTone(122 + proximity * 70, 0.07, 0.07 + proximity * 0.12, 'square');
      }
    }

    // High intensity click when within line-of-sight
    if (visible && now - this.lastVisiblePulse > (260 - proximity * 150)) {
      this.lastVisiblePulse = now;
      this.playTone(190 + proximity * 90, 0.08, 0.08 + proximity * 0.1, 'square');
    }
  }
}
