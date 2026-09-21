/**
 * VOID SHIFT // RECOVERY OPERATIONS PROTOCOL
 * Central Game Controller (State Orchestration & Core Game Loops)
 */

class Game {
  constructor() {
    this.ui = new UIManager();
    this.audio = new AudioManager();
    this.map = new MapManager();
    this.renderer = new Renderer(this.ui);
    this.player = new Player();
    this.monster = new Monster();

    this.state = {
      running: false,
      completed: false,
      stabilized: false,
      laserJitter: 0,
      cameraZoom: 1,
      cameraLookX: 0,
      cameraLookY: 0,
      money: 1000,
      loot: 0,
      lootValue: 0,
      storageItems: [],
      storageCapacity: 50,
      inventory: [],
      inventoryCapacity: 12,
      elapsed: 0,
      extractionCalled: false,
      extracted: false,
      mouseX: 0,
      mouseY: 0,
      lastTime: 0,
      keys: {},
      muzzleFlashTimer: 0,
      bulletTraces: [],
      impactParticles: [],
      recoilX: 0,
      recoilY: 0
    };

    this.init();
  }

  /**
   * Initializes game configurations and event listeners
   */
  init() {
    this.handleResize();
    this.reset();
    this.attachEventListeners();
  }

  /**
   * Resets all sub-modules and core telemetry state values
   */
  reset() {
    Object.assign(this.state, {
      running: false,
      completed: false,
      stabilized: false,
      laserJitter: 0,
      cameraZoom: 1,
      cameraLookX: 0,
      cameraLookY: 0,
      loot: 0,
      lootValue: 0,
      elapsed: 0,
      extractionCalled: false,
      extracted: false,
      mouseX: 0,
      mouseY: 0,
      lastTime: 0
    });
    this.state.keys = {};

    this.player.reset();
    this.monster.reset();
    this.map.reset();

    this.ui.updateResetState();
    
    // Initial UI state update
    const compositeState = {
      oxygen: this.player.oxygen,
      health: this.player.health,
      stamina: this.player.stamina,
      noise: this.player.noise,
      loot: this.state.loot,
      lootValue: this.state.lootValue,
      elapsed: this.state.elapsed,
      reloading: this.player.reloading
    };
    this.ui.update(compositeState, this.player, this.monster);
    this.render();
  }

  /**
   * Commences exploration run under standard recovery protocols
   */
  start() {
    if (this.state.running) return;
    if (this.state.completed) this.reset();
    
    this.audio.ensureAudio();

    this.state.completed = false;
    this.state.running = true;
    
    this.ui.updateStartState();

    this.state.lastTime = performance.now();
    requestAnimationFrame((now) => this.loop(now));
  }

  /**
   * Fires the extraction signal beacon
   */
  callExtraction() {
    if (!this.state.running || this.state.extractionCalled) return;
    this.state.extractionCalled = true;

    this.ui.updateExtractionCalledState();

    this.audio.playTone(720, 0.18, 0.11, 'square');
    setTimeout(() => this.audio.playTone(540, 0.25, 0.09, 'square'), 180);

    this.activateMonster('撤离信标吸引了附近的生命体。');
  }

  /**
   * Forces activation of the hostile unknown entity
   */
  activateMonster(reason) {
    const activation = this.monster.activate(this.player.x, this.player.y, reason, this.audio);
    if (activation) {
      this.ui.threatStatusText.textContent = '已出现';
      this.ui.threatStatusText.className = 'warning';
      this.ui.missionTitle.textContent = '有什么东西醒了';
      this.ui.log(reason);
      this.ui.showToast('远处传来金属摩擦声');
    }
  }

  /**
   * Concludes the exploration run with a final report status
   */
  finish(success) {
    this.state.running = false;
    this.state.completed = true;
    this.state.extracted = success;

    if (success) {
      // Add inventory to storage
      this.state.storageItems.push(...this.state.inventory);
      this.state.inventory = [];
      this.updateStorageUI();
    }

    this.ui.updateFinishState(success);
    
    const compositeState = {
      oxygen: this.player.oxygen,
      health: this.player.health,
      stamina: this.player.stamina,
      noise: this.player.noise,
      loot: this.state.loot,
      lootValue: this.state.lootValue,
      elapsed: this.state.elapsed,
      reloading: this.player.reloading
    };
    this.ui.update(compositeState, this.player, this.monster);
  }

  /**
   * Performs an interact trace near the explorer
   */
  interact() {
    if (!this.state.running) return;

    // Check doors
    const door = this.map.doors.find(item => Math.hypot(item.x - this.player.x, item.y - this.player.y) < 48);
    if (door) {
      door.open = !door.open;
      this.player.noise = Math.min(100, this.player.noise + 8);
      this.ui.log(door.open ? '门已打开。' : '门已关闭。');
      this.ui.showToast(door.open ? '门已打开' : '门已关闭');
      return;
    }

    // Check observation windows
    const windowNear = this.map.windows.some(item => Math.hypot(item.x - this.player.x, item.y - this.player.y) < 42);
    if (windowNear) {
      this.ui.log('窗外只有风 and 黑暗。');
      this.ui.showToast('观察窗');
      return;
    }

    // Attempt collection
    this.collect();
  }

  /**
   * Scavenges nearby valid waste scrap
   */
  collect() {
    if (!this.state.running) return;

    const item = this.map.scrap.find(s => !s.found && Math.hypot(s.x - this.player.x, s.y - this.player.y) < 30);
    if (!item) {
      this.ui.showToast('附近没有可回收物');
      return;
    }
    
    // Find free slots in 12-slot grid
    const occupiedSlots = new Set();
    this.state.inventory.forEach(i => {
      for(let s = i.slot; s < i.slot + i.size; s++) occupiedSlots.add(s);
    });

    let freeSlot = -1;
    for(let i = 0; i < 12; i++) {
      if(!occupiedSlots.has(i)) {
        let canFit = true;
        for(let j = 0; j < (item.size || 1); j++) {
          if(occupiedSlots.has(i + j) || i + j >= 12) canFit = false;
        }
        if(canFit) { freeSlot = i; break; }
      }
    }

    if (freeSlot === -1) {
      this.ui.showToast('背包空间不足！');
      return;
    }

    item.found = true;
    item.slot = freeSlot;
    item.id = Date.now();
    this.state.inventory.push(item);
    
    this.player.noise = Math.min(100, this.player.noise + 20);
    
    this.ui.log(`拾取：${item.name || '废料'}。`);
    this.ui.showToast(`拾取 ${item.name || '物品'}`);
    
    this.updateInventoryUI();
  }

  buyAmmo() {
    if (this.state.money >= Config.player.ammoPrice) {
      this.state.money -= Config.player.ammoPrice;
      this.player.reserveAmmo += 6;
      this.ui.showToast('购买弹药成功');
      this.updateMoneyUI();
    } else {
      this.ui.showToast('资金不足');
    }
  }

  sellInventory() {
    this.state.inventory.forEach(item => {
      this.state.money += item.value || 50;
    });
    this.state.inventory = [];
    this.ui.showToast('物资已出售');
    this.updateInventoryUI();
    this.updateMoneyUI();
  }

  updateMoneyUI() {
    document.getElementById('moneyDisplay').textContent = `¥ ${this.state.money}`;
  }

  updateInventoryUI() {
    const grid = document.getElementById('inventoryGrid');
    if (!grid) return;
    grid.innerHTML = '';
    
    // Create fixed 4x3 grid (12 slots)
    for (let i = 0; i < 12; i++) {
      const slot = document.createElement('div');
      slot.className = 'storage-item';
      slot.dataset.index = i;
      slot.style.borderColor = 'var(--line)';
      grid.appendChild(slot);
    }

    // Populate slots
    this.state.inventory.forEach(item => {
      const slots = grid.children;
      // Item data check
      console.log('Rendering item:', item); 
      if (item.slot !== undefined && item.slot < slots.length) {
        for (let i = item.slot; i < Math.min(item.slot + (item.size || 1), 12); i++) {
          if (slots[i]) {
            slots[i].textContent = (item.name ? item.name.charAt(0) : '?');
            slots[i].style.borderColor = 'var(--acid)';
            slots[i].style.backgroundColor = 'var(--panel-2)';
            slots[i].style.color = 'var(--acid)';
            slots[i].style.cursor = 'grab';
            slots[i].dataset.itemId = item.id;
            slots[i].onmousedown = (e) => this.dragItem(item, e);
          }
        }
      }
    });
  }

  dragItem(item, e) {
    this.ui.showToast(`拖拽 ${item.name}`);
    // Basic interaction: simple swap or reorder logic would go here
  }

  /**
   * Weapon discharge action and target intersection resolving
   */
  shoot() {
    if (!this.state.running) return;

    const result = this.player.shoot(this.state.stabilized, this.map, this.audio, this.monster);
    
    if (result.fired) {
      // Trigger muzzle flash lighting effect (start at full 0.45 second decay clock)
      this.state.muzzleFlashTimer = 0.45; 
      
      const startX = this.player.x;
      const startY = this.player.y;
      const angle = result.shotAngle;
      const endX = startX + Math.cos(angle) * result.traceLength;
      const endY = startY + Math.sin(angle) * result.traceLength;

      // Apply screen recoil in the EXACT opposite direction of the fired shot
      const recoilIntensity = this.state.stabilized ? 16 : 28; // Hip fire has stronger recoil kickback
      this.state.recoilX += -Math.cos(angle) * recoilIntensity;
      this.state.recoilY += -Math.sin(angle) * recoilIntensity;

      // Add a high speed kinetic bullet tracer
      this.state.bulletTraces.push({
        startX: startX,
        startY: startY,
        currentX: startX,
        currentY: startY,
        endX: endX,
        endY: endY,
        speed: 3500, // Speed up bullet trail to 3500px/s for instant hitscan velocity feel
        lifetime: 0.22, // Fades away faster so it looks like a high dynamic ray instead of a lazy laser line
        maxLifetime: 0.22,
        color: '#d7f36b'
      });

      // Spawn bright energetic impact sparks at target destination
      const sparkCount = result.hit ? 22 : 8;
      const sparkColor = result.hit ? '#e8754e' : '#75ddd0';
      for (let index = 0; index < sparkCount; index++) {
        const sparkAngle = angle + Math.PI + (Math.random() - 0.5) * 1.5; // Backwards reflection spread
        const sparkSpeed = 50 + Math.random() * 120;
        this.state.impactParticles.push({
          x: endX,
          y: endY,
          vx: Math.cos(sparkAngle) * sparkSpeed,
          vy: Math.sin(sparkAngle) * sparkSpeed,
          alpha: 1.0,
          decay: 2.2 + Math.random() * 2.8, // dissolves over 0.2-0.5s
          color: sparkColor,
          size: 1.5 + Math.random() * 2
        });
      }

      if (result.hit) {
        const push = 150;
        const nextX = this.monster.x + Math.cos(result.toMonster) * push;
        const nextY = this.monster.y + Math.sin(result.toMonster) * push;

        this.monster.x = Math.max(38, Math.min(1762, nextX));
        this.monster.y = Math.max(38, Math.min(1166, nextY));
        this.monster.stagger = 0.65;

        this.ui.triggerDamageFlash(0.18, 80);

        this.ui.log('命中。生命体被击退。');
        this.ui.showToast('命中 / 目标后退');
        this.audio.playTone(88, 0.18, 0.18, 'sawtooth');
      } else {
        this.ui.log('枪声在走廊里回响。');
        this.ui.showToast('未命中');
      }
    } else if (result.reason === 'empty') {
      this.ui.showToast('弹匣已空，按 Q 换弹');
    }
  }

  /**
   * Sets aiming stability states and camera adjustments
   */
  setStableAim(active) {
    this.state.stabilized = active;
    if (this.lastPointerEvent) {
      this.handleAim(this.lastPointerEvent);
    } else {
      this.renderer.prepareCamera(this.player, this.state);
    }
  }

  /**
   * Tracks cursor positions and computes vectors for looking & aiming directions
   */
  handleAim(event) {
    if (!event) return;
    this.lastPointerEvent = event;
    const rect = this.ui.frame.getBoundingClientRect();
    const scaleX = rect.width / Config.VIEW_W;
    const scaleY = rect.height / Config.VIEW_H;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const screenOffsetX = (event.clientX - centerX) / scaleX;
    const screenOffsetY = (event.clientY - centerY) / scaleY;

    const lookX = this.state.stabilized ? Math.max(-90, Math.min(90, screenOffsetX * 0.22)) : 0;
    const lookY = this.state.stabilized ? Math.max(-70, Math.min(70, screenOffsetY * 0.22)) : 0;
    const aimZoom = this.state.stabilized ? 1.1 : 1;

    this.state.cameraLookX = lookX;
    this.state.cameraLookY = lookY;
    this.state.cameraZoom = aimZoom;

    // Use uniform base coordinates center offsets to translate screen client mouse into world coordinates.
    // This perfectly matches the new 2D context-level applyCamera transforms (preventing offset drift).
    const lookOffsetPxX = lookX * scaleX;
    const lookOffsetPxY = lookY * scaleY;
    
    this.state.mouseX = this.player.x + (event.clientX - (centerX - lookOffsetPxX)) / (scaleX * aimZoom);
    this.state.mouseY = this.player.y + (event.clientY - (centerY - lookOffsetPxY)) / (scaleY * aimZoom);

    this.player.angle = Math.atan2(this.state.mouseY - this.player.y, this.state.mouseX - this.player.x);
    
    if (this.state.stabilized) {
      this.renderer.prepareCamera(this.player, this.state);
    }
  }

  /**
   * Synchronizes viewport resize parameters to sub-modules
   */
  handleResize() {
    const { dpr } = this.ui.resize(Config.VIEW_W, Config.VIEW_H);
    this.renderer.setDpr(dpr);
    this.renderer.prepareCamera(this.player, this.state);
    this.render();
  }

  /**
   * High performance continuous update and render sequence loop
   */
  loop(now) {
    if (!this.state.running) return;

    const dt = Math.min(0.05, (now - this.state.lastTime) / 1000);
    this.state.lastTime = now;

    this.update(dt);
    this.render();

    requestAnimationFrame((n) => this.loop(n));
  }

  /**
   * Evaluates world and entity actions over time increment
   */
  update(dt) {
    this.state.elapsed += dt;

    // 1. Update Player position & status timers
    const playerResult = this.player.update(dt, this.state.keys, this.state.stabilized, this.map, this.audio);
    if (playerResult && playerResult.reloaded) {
      this.ui.showToast('换弹完成');
    }

    // 2. Decay movement acoustic noise
    if (this.player.moveSpeed === 0) {
      this.player.noise = Math.max(0, this.player.noise - 24 * dt);
    }

    // 3. Subtract survival oxygen supplies
    this.player.oxygen -= dt * (this.state.extractionCalled ? 0.8 : 0.18);

    // 4. Update muzzle flash light timer
    if (this.state.muzzleFlashTimer > 0) {
      this.state.muzzleFlashTimer = Math.max(0, this.state.muzzleFlashTimer - dt);
    }

    // 4a. Decay Recoil camera displacement smoothly over time (Spring-back damper)
    this.state.recoilX -= this.state.recoilX * 10 * dt; // fast spring back
    this.state.recoilY -= this.state.recoilY * 10 * dt;
    if (Math.abs(this.state.recoilX) < 0.05) this.state.recoilX = 0;
    if (Math.abs(this.state.recoilY) < 0.05) this.state.recoilY = 0;

    // 4b. Update flying bullet tracer physics
    for (let i = this.state.bulletTraces.length - 1; i >= 0; i--) {
      const trace = this.state.bulletTraces[i];
      trace.lifetime -= dt;

      // Move current draw position of the tracer towards endpoint
      const dx = trace.endX - trace.startX;
      const dy = trace.endY - trace.startY;
      const totalLen = Math.hypot(dx, dy);

      if (totalLen > 0) {
        const moveRatio = Math.min(1, (trace.maxLifetime - trace.lifetime) * (trace.speed / totalLen));
        trace.currentX = trace.startX + dx * moveRatio;
        trace.currentY = trace.startY + dy * moveRatio;
      }

      if (trace.lifetime <= 0) {
        this.state.bulletTraces.splice(i, 1);
      }
    }

    // 4b. Update spark impact particles
    for (let i = this.state.impactParticles.length - 1; i >= 0; i--) {
      const p = this.state.impactParticles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.alpha = Math.max(0, p.alpha - p.decay * dt);

      if (p.alpha <= 0) {
        this.state.impactParticles.splice(i, 1);
      }
    }

    // 5. Calculate camera laser-sight aim fluctuations
    const speedRatio = Math.min(1, this.player.moveSpeed / (this.player.baseSpeed * 1.6));
    const jitterScale = this.state.stabilized ? 0.12 : 1;
    const jitterFrequency = 18 + speedRatio * 34;

    this.state.laserJitter = (
      Math.sin(this.state.elapsed * jitterFrequency) * 0.055 +
      Math.sin(this.state.elapsed * (jitterFrequency + 12)) * 0.028 +
      Math.sin(this.state.elapsed * (jitterFrequency + 28)) * 0.014
    ) * jitterScale;

    // 5. Check environmental conditions to awaken the monster
    if ((!this.monster.active && this.state.elapsed > 7) || 
        (!this.monster.alerted && (this.player.noise > Config.monster.triggerNoiseThreshold || this.state.loot >= 2))) {
      this.activateMonster(this.player.noise > Config.monster.triggerNoiseThreshold ? '脚步声在走廊里回响。' : '墙后传来沉重的呼吸声。');
    }

    // 6. Drive monster pathfinding & AI updates
    const monsterResult = this.monster.update(dt, this.player, this.player.noise, this.map, this.audio);
    if (monsterResult) {
      if (monsterResult.deaggro) {
        this.ui.threatStatusText.textContent = '脱战';
        this.ui.threatStatusText.className = 'ok';
        this.ui.missionTitle.textContent = '暂时安全';
        this.ui.log('目标已失去你的踪迹。');
        this.ui.showToast('已脱战');
      }

      if (monsterResult.burstTriggered) {
        this.ui.showToast('目标爆冲！');
        this.ui.log('警告：目标正在高速接近！');
        this.audio.playTone(180, 0.16, 0.14, 'sawtooth');
      }

      if (monsterResult.burstFinished) {
        this.ui.showToast('目标短暂失速');
        this.ui.log('目标爆冲结束，可以拉开距离。');
      }

      if (monsterResult.playerHit) {
        this.ui.triggerDamageFlash(0.75, 130);
        this.player.health -= 18;
        this.player.oxygen -= 8;
        this.player.noise = 100;
        this.ui.log('警告：未知生命体接触！');
      }
    }

    // 7. Update synthesized ambient acoustics
    this.audio.update(this.player, this.monster, this.map);

    // 8. Resolve retrieval extraction boundaries
    if (this.state.extractionCalled) {
      const distanceToExtract = Math.hypot(this.player.x - Config.extraction.x, this.player.y - Config.extraction.y);
      if (distanceToExtract < 44) {
        this.finish(true);
        return;
      }
    }

    // 9. Fail checks
    if (this.player.health <= 0 || this.player.oxygen <= 0) {
      this.finish(false);
      return;
    }

    // 10. Synchronize statistics interface gauges
    const compositeState = {
      oxygen: this.player.oxygen,
      health: this.player.health,
      stamina: this.player.stamina,
      noise: this.player.noise,
      loot: this.state.loot,
      lootValue: this.state.lootValue,
      elapsed: this.state.elapsed,
      reloading: this.player.reloading
    };
    this.ui.update(compositeState, this.player, this.monster);
  }

  /**
   * Updates storage visual grid
   */
  updateStorageUI() {
    const grid = document.getElementById('storageGrid');
    grid.innerHTML = '';
    this.state.storageItems.forEach(() => {
      const el = document.createElement('div');
      el.className = 'storage-item';
      el.textContent = '■';
      grid.appendChild(el);
    });
    document.getElementById('storageStats').textContent = `${this.state.storageItems.length} / ${this.state.storageCapacity}`;
  }

  /**
   * Triggers visual draws across all screens
   */
  render() {
    this.renderer.prepareCamera(this.player, this.state);
    this.renderer.draw(this.player, this.monster, this.map, this.state);
    this.renderer.drawWorldOverlay(this.player, this.map, this.state);
    this.renderer.drawCenteredVision(this.player, this.map, this.state);
    this.renderer.drawMiniMap(this.player, this.map);
  }

  /**
   * Binds interaction listeners to system triggers
   */
  attachEventListeners() {
    window.addEventListener('resize', () => this.handleResize());

    window.addEventListener('keydown', e => {
      const key = e.key.toLowerCase();
      this.state.keys[key] = true;
      
      if (key === 'f') this.player.flashlight = !this.player.flashlight;
      if (key === 'e') this.interact();
      if (key === 'q') this.player.reload(this.audio);
      if (key === 'r') this.callExtraction();
      if (key === 'b') {
        const inv = document.getElementById('inventoryOverlay');
        console.log('Toggling inventory', inv); // DEBUG
        inv.style.display = (inv.style.display === 'none' || inv.style.display === '') ? 'block' : 'none';
        if (inv.style.display === 'block') this.updateInventoryUI();
      }
      
      if (e.code === 'Space') {
        e.preventDefault();
        this.shoot();
      }
      if (e.key === 'Enter' && !this.state.running) {
        this.start();
      }
    });

    window.addEventListener('keyup', e => {
      this.state.keys[e.key.toLowerCase()] = false;
    });

    window.addEventListener('pointermove', e => this.handleAim(e));

    window.addEventListener('mousedown', e => {
      if (e.button === 0 && e.target.closest('#gameFrame')) {
        this.shoot();
      }
      if (e.button === 2 && e.target.closest('#gameFrame')) {
        e.preventDefault();
        this.setStableAim(true);
      }
    });

    window.addEventListener('mouseup', e => {
      if (e.button === 2) this.setStableAim(false);
    });

    window.addEventListener('pointerdown', e => {
      if (e.target.closest('#gameFrame')) {
        try {
          e.target.closest('#gameFrame').setPointerCapture(e.pointerId);
        } catch (err) {}
      }
      if (e.button === 2 && e.target.closest('#gameFrame')) {
        e.preventDefault();
        this.setStableAim(true);
      }
    });

    window.addEventListener('pointerup', e => {
      if (e.target.closest('#gameFrame')) {
        try {
          e.target.closest('#gameFrame').releasePointerCapture(e.pointerId);
        } catch (err) {}
      }
      if (e.button === 2) this.setStableAim(false);
    });

    window.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('dragstart', e => e.preventDefault());
    
    this.ui.startButton.addEventListener('click', () => {
      if (!this.state.running) {
        this.start();
      }
    });
  }
}

// Instantiate central game driver when document is loaded
window.addEventListener('DOMContentLoaded', () => {
  window.game = new Game();
  
  // Expose global tab switcher
  window.switchTab = (tab) => {
    document.getElementById('briefingContent').style.display = tab === 'briefing' ? 'block' : 'none';
    document.getElementById('storageContent').style.display = tab === 'storage' ? 'block' : 'none';
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.textContent === (tab === 'briefing' ? '简报' : '仓库')));
  };
});
