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
    this.hunters = this._createHunters();

    // Tetris-style backpack grid (see js/inventory.js).
    // Swap layouts by changing Config.activeBackpack / passing a definition:
    //   new BackpackManager({ cols: 6, rows: 4, cellSize: 40, gap: 5 })
    this.backpack = BackpackManager.fromType(Config.activeBackpack);
    this.selectedItemId = null;
    this._itemDrag = null;
    this._boundItemDragMove = (event) => this._handleItemDragMove(event);
    this._boundItemDragEnd = (event) => this._handleItemDragEnd(event);

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
      hunterSettings: this._sanitizeHunterSettings(),
      selectedDifficulty: 'medium',
      selectedWeapon: 'pistol',
      elapsed: 0,
      hunterSpawnTimer: this._getHunterSettings().hunterSpawnInterval,
      huntersInitialized: false,
      extractionCalled: false,
      extracted: false,
      activeQte: null,
      inventoryOpen: false,
      mouseX: 0,
      mouseY: 0,
      lastTime: 0,
      keys: {},
      muzzleFlashTimer: 0,
      bulletTraces: [],
      impactParticles: [],
      recoilX: 0,
      recoilY: 0,
      qteMonsterTpCooldown: 0,
      lastJumpscareTime: -1,
      fireHeld: false
    };

    this.init();
  }

  /**
   * Initializes game configurations and event listeners
   */
  init() {
    this.handleResize();
    this._loadSave();
    this.reset();
    this.attachEventListeners();
  }

  _sanitizeHunterSettings(savedSettings = null) {
    const limits = {
      hunters: [0, 100],
      hunterSpawnInterval: [1, 120],
      hunterRespawnCount: [0, 100],
      hunterMaxHp: [1, 100]
    };
    const settings = {};

    Object.entries(Config.mapScales).forEach(([scaleKey, defaults]) => {
      const saved = savedSettings && savedSettings[scaleKey] ? savedSettings[scaleKey] : {};
      settings[scaleKey] = {};
      Object.entries(limits).forEach(([key, [min, max]]) => {
        const parsed = saved[key] == null || saved[key] === '' ? NaN : Number(saved[key]);
        const fallback = defaults[key];
        settings[scaleKey][key] = Number.isFinite(parsed)
          ? Math.max(min, Math.min(max, Math.round(parsed)))
          : fallback;
      });
    });

    return settings;
  }

  _getHunterSettings(scaleKey = Config.currentScale) {
    const saved = this.state && this.state.hunterSettings && this.state.hunterSettings[scaleKey];
    return saved || this._sanitizeHunterSettings()[scaleKey];
  }

  _buildDifficultySettings(difficultyId) {
    const preset = Config.difficultyPresets[difficultyId];
    if (!preset) return null;
    const settings = {};
    Object.entries(Config.mapScales).forEach(([scaleKey, defaults]) => {
      settings[scaleKey] = {
        hunters: Math.ceil(defaults.hunters * preset.hunterScale),
        hunterSpawnInterval: Math.round(defaults.hunterSpawnInterval * preset.intervalScale),
        hunterRespawnCount: Math.ceil(defaults.hunterRespawnCount * preset.respawnScale),
        hunterMaxHp: preset.hunterMaxHp
      };
    });
    return this._sanitizeHunterSettings(settings);
  }

  _detectDifficultyPreset(settings) {
    for (const difficultyId of Object.keys(Config.difficultyPresets)) {
      const presetSettings = this._buildDifficultySettings(difficultyId);
      const matches = Object.keys(Config.mapScales).every(scaleKey => {
        return Object.keys(presetSettings[scaleKey]).every(key => settings[scaleKey][key] === presetSettings[scaleKey][key]);
      });
      if (matches) return difficultyId;
    }
    return 'custom';
  }

  updateHunterSettingsUI() {
    this.ui.updateHunterSettings(this._getHunterSettings(), this.state.running);
  }

  updateDifficultyUI() {
    this.ui.updateDifficultyPreset(this.state.selectedDifficulty, this.state.running);
  }

  applyDifficultyPreset(difficultyId) {
    if (this.state.running) return;
    const settings = this._buildDifficultySettings(difficultyId);
    if (!settings) return;
    this.state.hunterSettings = settings;
    this.state.selectedDifficulty = difficultyId;
    this.state.hunterSpawnTimer = this._getHunterSettings().hunterSpawnInterval;
    this.hunters = this._createHunters();
    this.hunters.forEach(h => h.reset(this.map));
    this._save();
    this.updateDifficultyUI();
    this.updateHunterSettingsUI();
  }

  updateLoadoutUI() {
    this.ui.updateLoadout(this.state.selectedWeapon, this.state.running);
  }

  selectWeapon(weaponId) {
    if (this.state.running || !Config.weapons[weaponId]) return;
    this.state.selectedWeapon = weaponId;
    this.player.setWeapon(weaponId);
    this._save();
    this.updateLoadoutUI();
    this.ui.updateWeaponReadout(this.player);
  }

  updateHunterSetting(key, value) {
    if (this.state.running) return;
    const current = this._getHunterSettings();
    const sanitized = this._sanitizeHunterSettings({
      [Config.currentScale]: { ...current, [key]: value }
    });
    this.state.hunterSettings[Config.currentScale] = sanitized[Config.currentScale];
    this.state.selectedDifficulty = 'custom';
    this.state.hunterSpawnTimer = this._getHunterSettings().hunterSpawnInterval;
    this.hunters = this._createHunters();
    this.hunters.forEach(h => h.reset(this.map));
    this._save();
    this.updateDifficultyUI();
    this.updateHunterSettingsUI();
  }

  resetHunterSettings() {
    if (this.state.running) return;
    const defaults = this._sanitizeHunterSettings()[Config.currentScale];
    this.state.hunterSettings[Config.currentScale] = defaults;
    this.state.selectedDifficulty = 'custom';
    this.state.hunterSpawnTimer = defaults.hunterSpawnInterval;
    this.hunters = this._createHunters();
    this.hunters.forEach(h => h.reset(this.map));
    this._save();
    this.updateDifficultyUI();
    this.updateHunterSettingsUI();
  }

  _loadSave() {
    try {
      const raw = localStorage.getItem('voidshift_save');
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.money != null) this.state.money = data.money;
      if (Array.isArray(data.storageItems)) this.state.storageItems = data.storageItems;
      if (Config.difficultyPresets[data.difficultyPreset]) {
        this.state.hunterSettings = this._buildDifficultySettings(data.difficultyPreset);
        this.state.selectedDifficulty = data.difficultyPreset;
      } else {
        this.state.hunterSettings = this._sanitizeHunterSettings(data.hunterSettings);
        this.state.selectedDifficulty = data.difficultyPreset === 'custom'
          ? 'custom'
          : this._detectDifficultyPreset(this.state.hunterSettings);
      }
      if (Config.weapons[data.selectedWeapon]) this.state.selectedWeapon = data.selectedWeapon;
    } catch (e) { /* ignore corrupt save */ }
  }

  _save() {
    try {
      localStorage.setItem('voidshift_save', JSON.stringify({
        money: this.state.money,
        storageItems: this.state.storageItems,
        hunterSettings: this.state.hunterSettings,
        difficultyPreset: this.state.selectedDifficulty,
        selectedWeapon: this.state.selectedWeapon
      }));
    } catch (e) { /* ignore quota errors */ }
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
      hunterSpawnTimer: this._getHunterSettings().hunterSpawnInterval,
      huntersInitialized: false,
      extractionCalled: false,
      extracted: false,
      activeQte: null,
      inventoryOpen: false,
      fullMapOpen: false,
      qteMonsterTpCooldown: 0,
      mouseX: 0,
      mouseY: 0,
      lastTime: 0,
      lastJumpscareTime: -1,
      fireHeld: false
    });
    this.state.keys = {};
    if (this.ui.setFullMapVisible) {
      this.ui.setFullMapVisible(false);
    }
    const inventoryOverlay = document.getElementById('inventoryOverlay');
    if (inventoryOverlay) inventoryOverlay.style.display = 'none';

    this.map.reset(Config.currentScale);
    this.player.reset(this.map, this.state.selectedWeapon);
    this.monster.reset(this.map);
    this.hunters = this._createHunters();
    this.hunters.forEach(h => h.reset(this.map));

    this._cancelItemDrag();
    this.selectedItemId = null;
    // Built from the active layout definition, so switching Config.activeBackpack (or
    // handing the operator a different backpack model) takes effect on the next dive
    this.backpack = BackpackManager.fromType(Config.activeBackpack);
    this.updateInventoryUI();

    this.ui.updateResetState();
    this.ui.updateScaleButtons(Config.currentScale);
    this.updateDifficultyUI();
    this.updateHunterSettingsUI();
    this.updateLoadoutUI();
    this.ui.updateTerminalsStatus(0, this.map.terminals.length);
    this.updateStorageUI();
    this.updateMoneyUI();
    
    // Initial UI state update
    this.ui.update(this._buildCompositeState(), this.player, this.monster);
    this.render();
  }

  /**
   * Sets facility map scale (small, medium, large) and regenerates procedural layout
   */
  setMapScale(scaleKey) {
    if (this.state.running) {
      this.ui.showToast('任务进行中无法更改设施规模');
      this.ui.log('警告：任务进行中锁定环境参数。');
      return;
    }
    if (!Config.mapScales || !Config.mapScales[scaleKey]) return;
    Config.currentScale = scaleKey;
    const scaleConfig = Config.mapScales[scaleKey];
    this.state.hunterSpawnTimer = this._getHunterSettings(scaleKey).hunterSpawnInterval;

    this.ui.updateScaleButtons(scaleKey);
    this.updateHunterSettingsUI();
    this.map.reset(scaleKey);
    this.player.reset(this.map, this.state.selectedWeapon);
    this.monster.reset(this.map);
    this.hunters = this._createHunters();
    this.hunters.forEach(h => h.reset(this.map));
    this.ui.updateTerminalsStatus(0, this.map.terminals.length);
    this.render();
    this.ui.log(`设施规模重构: ${scaleConfig.label} (共 ${scaleConfig.roomCount} 舱室)`);
    this.ui.showToast(`设施已重构: ${scaleConfig.label}`);
  }

  /**
   * Toggles debug reveal of all facility rooms (removes fog of war / shows entire map)
   */
  toggleRevealMap() {
    this.state.revealAllMap = !this.state.revealAllMap;
    if (this.state.revealAllMap) {
      this.map.worldRooms.forEach(r => r.discovered = true);
      this.ui.showToast('【测试模式】全图已完全揭示 (REVEAL ALL ON)');
      this.ui.log('【测试指令】已解除全图迷雾，所有舱室、通道与终端已完全显现。');
    } else {
      const currentRoom = this.map.getRoomAt(this.player.x, this.player.y);
      this.map.worldRooms.forEach(r => {
        r.discovered = (r === currentRoom || r.type === 'airlock');
      });
      this.ui.showToast('【测试模式】已恢复探索迷雾 (FOG OF WAR ACTIVE)');
      this.ui.log('【测试指令】雷达探索迷雾已恢复。');
    }
    if (this.ui.updateRevealBtnState) {
      this.ui.updateRevealBtnState(this.state.revealAllMap);
    }
    this.render();
  }

  /**
   * Toggles display of the Full Tactical Facility Map modal (activated by 'M' key)
   */
  toggleFullMap(forceState = null) {
    const newState = forceState !== null ? !!forceState : !this.state.fullMapOpen;
    this.state.fullMapOpen = newState;
    if (this.ui.setFullMapVisible) {
      this.ui.setFullMapVisible(newState);
    }
    if (newState) {
      if (this.ui.updateFullMapStats) {
        this.ui.updateFullMapStats(this.map, this.state);
      }
      this.renderer.drawFullMap(this.player, this.map, this.state);
      this.ui.log('打开全局战术地图 [按 M 或 ESC 关闭]');
    } else {
      this.ui.log('关闭全局战术地图，返回现场监视');
    }
  }

  /**
   * Commences exploration run under standard recovery protocols
   */
  start() {
    if (this.state.running) return;
    if (this.state.completed) this.reset();
    
    this.audio.ensureAudio();

    // Warm the recorded cue buffers so combat audio fires without load latency
    this.audio.preloadSounds([
      'resources/injured-140224.mp3',
      'resources/jumpscare-94984.mp3',
      'resources/gun-shot-359196.mp3',
      'resources/gun-reload-2-511308.mp3'
    ]);

    this.state.completed = false; 
    this.state.running = true; 
    this.state.fireHeld = false;
    document.body.classList.add("in-dive");
    this.handleResize();
    
    this.ui.updateStartState();
    this.updateDifficultyUI();
    this.updateHunterSettingsUI();
    this.updateLoadoutUI();

    this.state.lastTime = performance.now();
    requestAnimationFrame((now) => this.loop(now));
  }

  /**
   * Fires the extraction signal beacon (Requires all QTE security consoles overridden)
   */
  callExtraction() {
    if (!this.state.running || this.state.extractionCalled) return;

    // Check if all QTE security override consoles are solved
    const totalTerminals = this.map.terminals ? this.map.terminals.length : 3;
    const solvedCount = this.map.terminals ? this.map.terminals.filter(t => t.solved).length : totalTerminals;
    if (solvedCount < totalTerminals) {
      this.ui.showToast(`撤离舱锁定中！请先破解全部 ${totalTerminals} 处安全控制台 (当前: ${solvedCount}/${totalTerminals})`);
      this.ui.log(`撤离系统离线：需重写全部 ${totalTerminals} 处控制台才能启动撤离。`);
      this.audio.playTone(140, 0.12, 0.1, 'sawtooth');
      return;
    }

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
    const activation = this.monster.activate(this.player.x, this.player.y, reason, this.audio, this.map, this.player.angle);
    if (activation) {
      this.ui.threatStatusText.textContent = '已出现';
      this.ui.threatStatusText.className = 'warning';
      this.ui.missionTitle.textContent = '有什么东西醒了';
      this.ui.log(reason);
      this.ui.showToast('远处传来金属摩擦声');
      this.audio.playSound('resources/horror-cinematic-498207.mp3', 0.6);
    }
  }

  _createHunters() {
    const settings = this._getHunterSettings();
    return Array.from({ length: settings.hunters }, (_, i) => new Hunter(i, settings.hunterMaxHp));
  }

  activateHunter(hunter, reason) {
    const activation = hunter.activate(this.player.x, this.player.y, reason, this.audio, this.map, this.player.angle);
    if (activation) {
      this.ui.log(reason);
      this.ui.showToast('金属脚步声正在接近...');
    }
  }

  /**
   * Applies hostile contact damage: impact flash, HP/oxygen loss, noise spike,
   * field log entry and the "injured" pain cue
   */
  _applyContactDamage(logMessage) {
    this.ui.triggerDamageFlash(0.75, 130);
    this.player.health -= 18;
    this.player.oxygen -= 8;
    this.player.noise = 100;
    this.ui.log(logMessage);
    this.audio.playSound('resources/injured-140224.mp3', 0.8);
  }

  /**
   * Checks whether a light source currently illuminates the active hostile entity:
   * the helmet flashlight cone, the muzzle flash burst or the suit ambient glow
   */
  _isMonsterLitByLight(distance) {
    if (!this.monster.active) return false;

    // 1. Helmet flashlight cone (mirrors the rendered beam: 420px range, 0.5rad half angle)
    if (this.player.flashlight && distance <= 420) {
      const angleToMonster = Math.atan2(this.monster.y - this.player.y, this.monster.x - this.player.x);
      const angleDelta = Math.atan2(
        Math.sin(angleToMonster - this.player.angle),
        Math.cos(angleToMonster - this.player.angle)
      );
      const bodyAllowance = Math.asin(Math.min(1, this.monster.radius / Math.max(distance, 1)));
      if (Math.abs(angleDelta) <= 0.5 + bodyAllowance) return true;
    }

    // 2. Muzzle flash — omni-directional light burst while the timer decays
    if (this.state.muzzleFlashTimer > 0) {
      const flashAlpha = Math.min(1, this.state.muzzleFlashTimer / 0.45);
      const flashRange = 550 * (0.3 + 0.7 * flashAlpha);
      if (distance <= flashRange) return true;
    }

    // 3. Suit ambient glow (74px ambient radius in the vision mask)
    return distance <= 74 + this.monster.radius;
  }

  /**
   * Jumpscare cue: fires the scare stinger the moment light reveals the active
   * hostile entity in direct line of sight (15s cooldown between scares)
   */
  _updateMonsterJumpscare() {
    if (!this.monster.active || this.monster.recoverTimer > 0) return;

    const dx = this.monster.x - this.player.x;
    const dy = this.monster.y - this.player.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 520 || distance <= 0.001) return;

    // Occlusion check — only a lit AND visible entity triggers the scare
    const dirX = dx / distance;
    const dirY = dy / distance;
    const wallDistance = this.map.rayWallDistance(this.player.x, this.player.y, dirX, dirY, 520);
    if (distance >= wallDistance + 25) return;

    if (!this._isMonsterLitByLight(distance)) return;

    // Cooldown so the stinger only plays on fresh encounters (-1 = never scared yet)
    const lastScare = this.state.lastJumpscareTime;
    if (lastScare >= 0 && this.state.elapsed - lastScare <= 15.0) return;
    this.state.lastJumpscareTime = this.state.elapsed;

    this.audio.playSound('resources/jumpscare-94984.mp3', 0.85);
    this.ui.showToast('⚠️ 遭遇到未知生命体！');
    this.ui.log('警报：视野内突然出现敌对生命体！');
  }

  /**
   * Concludes the exploration run with a final report status
   */
  finish(success) {
    this.state.running = false; 
    this.state.completed = true; 
    this.state.fireHeld = false;
    this.state.inventoryOpen = false;
    const inventoryOverlay = document.getElementById('inventoryOverlay');
    if (inventoryOverlay) inventoryOverlay.style.display = 'none';
    document.body.classList.remove("in-dive");
    this.handleResize();
    
    this.state.extracted = success;
    this.state.activeQte = null;
    this.ui.hideQTE();

    if (success) {
      // Move every carried item into the safehouse storage (grid placement is dropped)
      this.state.storageItems.push(...this.backpack.items.map(item => ({
        name: item.name,
        value: item.value,
        size: item.size,
        rarity: item.rarity,
        shape: item.shape,
        roomType: item.roomType
      })));
      this.backpack.reset();
      this.selectedItemId = null;
      this.updateStorageUI();
      this._save();
    }

    this.ui.updateFinishState(success);
    this.updateDifficultyUI();
    this.updateHunterSettingsUI();
    this.updateLoadoutUI();
    
    this.ui.update(this._buildCompositeState(), this.player, this.monster);
  }

  /**
   * Performs an interact trace near the explorer
   */
  interact() {
    if (!this.state.running) return;
    if (this.player.stunned > 0) {
      this.ui.showToast('身体麻痹硬直中，无法交互！');
      return;
    }

    // Check doors with interaction radius from door center
    const door = this.map.doors.find(item => {
      const centerX = item.x + item.w / 2;
      const centerY = item.y + item.h / 2;
      return Math.hypot(centerX - this.player.x, centerY - this.player.y) < 58;
    });

    if (door) {
      const res = this.map.toggleDoor(door, this.player.x, this.player.y);
      this.player.noise = Math.min(100, this.player.noise + 8);
      this.audio.playTone(door.open ? 160 : 110, 0.08, 0.06, 'sine');
      
      const dirText = door.axis === 'v' 
        ? (res.dir === 1 ? '向右推开' : '向左推开') 
        : (res.dir === 1 ? '向下推开' : '向上推开');
      
      this.ui.log(door.open ? `防爆门已${dirText}。` : '防爆门已关闭锁定。');
      this.ui.showToast(door.open ? `门已开启 (${dirText})` : '门已关闭');
      return;
    }

    // Check QTE security override consoles
    if (this.map.terminals) {
      const term = this.map.terminals.find(t => Math.hypot(t.x - this.player.x, t.y - this.player.y) < 55);
      if (term) {
        if (term.solved) {
          this.ui.showToast('该安全控制台已重写 (OVERRIDDEN)');
          return;
        }
        this.startQTE(term);
        return;
      }
    }

    // Check extraction beacon interaction (in Start Airlock or Exit Evac Pod)
    const distAirlock = Math.hypot(this.map.extractionPoint.x - this.player.x, this.map.extractionPoint.y - this.player.y);
    const distEvac = this.map.exitExtractionPoint ? Math.hypot(this.map.exitExtractionPoint.x - this.player.x, this.map.exitExtractionPoint.y - this.player.y) : Infinity;
    if (distAirlock < 55 || distEvac < 55) {
      const totalTerminals = this.map.terminals ? this.map.terminals.length : 3;
      const solvedCount = this.map.terminals ? this.map.terminals.filter(t => t.solved).length : totalTerminals;
      if (distEvac < 55 && solvedCount < totalTerminals) {
        this.ui.showToast(`撤离舱锁定中！请先破解全部 ${totalTerminals} 处控制台 (${solvedCount}/${totalTerminals})`);
        this.audio.playTone(140, 0.12, 0.1, 'sawtooth');
        return;
      }
      if (!this.state.extractionCalled) {
        this.callExtraction();
        this.ui.showToast('撤离信标已激活！');
        return;
      }
    }

    // Check observation windows
    const windowNear = this.map.windows.some(item => Math.hypot(item.x - this.player.x, item.y - this.player.y) < 42);
    if (windowNear) {
      this.ui.log('窗外只有风与黑暗。');
      this.ui.showToast('观察窗');
      return;
    }

    // Attempt collection
    this.collect();
  }

  /**
   * Commences QTE sequence on the specified security console with 10s time limit
   */
  startQTE(terminal) {
    this.state.activeQte = {
      terminal: terminal,
      currentIndex: 0,
      sequence: [...terminal.sequence],
      failed: false,
      failCount: 0,
      maxFails: 3,
      timeLeft: 10.0,
      maxTime: 10.0
    };
    this.ui.showQTE(terminal, 0, false, 0, 3);
    this.ui.updateQTETimer(10.0, 10.0);
    this.ui.showToast('接入安全控制台 // 10秒内完成WASD重写 (错3次将遭高压电击)');
  }

  /**
   * Processes player WASD/ESC input during an active QTE sequence
   */
  handleQTEInput(key, event) {
    if (!this.state.activeQte) return;
    const qte = this.state.activeQte;

    if (key === 'escape') {
      this.state.activeQte = null;
      this.ui.hideQTE();
      this.ui.showToast('已退出控制台');
      return;
    }

    if (['w', 'a', 's', 'd'].includes(key)) {
      if (event) event.preventDefault();
      const target = qte.sequence[qte.currentIndex].toLowerCase();

      if (key === target) {
        // Correct key in sequence
        this.audio.playQTEKeyBeep(qte.currentIndex);
        qte.currentIndex++;
        this.ui.showQTE(qte.terminal, qte.currentIndex, false, qte.failCount, qte.maxFails);

        if (qte.currentIndex === qte.sequence.length) {
          // All 5 steps passed!
          qte.terminal.solved = true;
          this.audio.playQTESuccess();
          const totalCount = this.map.terminals.length;
          const solvedCount = this.map.terminals.filter(t => t.solved).length;
          this.ui.updateTerminalsStatus(solvedCount, totalCount);
          this.ui.showToast(`控制台重写成功！[${solvedCount}/${totalCount}]`);
          this.ui.log(`安全控制台 #${qte.terminal.id} 已完成重写。`);

          if (solvedCount >= totalCount) {
            this.ui.showToast('全舰安全协议已解除！EVAC POD 撤离舱已解锁！');
            this.ui.log(`警报：${totalCount}处终端全部覆盖，逃生舱主锁解除！可以撤离！`);
          }

          setTimeout(() => {
            if (this.state.activeQte && this.state.activeQte.terminal === qte.terminal) {
              this.state.activeQte = null;
              this.ui.hideQTE();
            }
          }, 450);
        }
      } else {
        // Wrong key entered!
        qte.failCount = (qte.failCount || 0) + 1;

        if (qte.failCount >= 3) {
          // 3rd mistake triggers the exact same failure penalty as 10s timeout (-10 HP, 2.5s stun, exit)
          this.triggerQTEShockFail('连续输入错误达到 3 次');
          return;
        }

        // Mistakes 1 and 2: error buzz, alert noise, attempt monster teleport (15s cooldown), regenerate sequence
        if (this.audio.playQTEErrorBeep) {
          this.audio.playQTEErrorBeep();
        } else {
          this.audio.playTone(135, 0.16, 0.12, 'sawtooth');
        }
        this.player.noise = Math.min(100, this.player.noise + 45);
        this.ui.triggerDamageFlash(0.4, 110);
        this.ui.showToast(`按键错误 (${qte.failCount}/3)！注意防篡改电击！`);
        this.ui.log(`错误：按键错误 (${qte.failCount}/3)！警报鸣响！`);

        // Monster teleports to a nearby room to try to get close to the player (respects 15s cooldown)
        this.teleportMonsterToNearbyRoom(true);

        // Regenerate sequence and display failure shake
        qte.terminal.sequence = this.map.generateQTESequence(5);
        qte.sequence = [...qte.terminal.sequence];
        qte.currentIndex = 0;
        this.ui.showQTE(qte.terminal, 0, true, qte.failCount, qte.maxFails);

        setTimeout(() => {
          if (this.state.activeQte && !this.state.activeQte.failed) {
            this.ui.showQTE(qte.terminal, 0, false, qte.failCount, qte.maxFails);
          }
        }, 600);
      }
    }
  }

  /**
   * Triggers terminal high-voltage shock penalty (-10 HP, 2.5s stun, loud alarm, monster teleport with 15s cd)
   */
  triggerQTEShockFail(reason = '控制台过载高压电击') {
    if (!this.state.activeQte) return;

    // 1. Inflict -10 HP damage and 2.5s stun
    this.player.health = Math.max(0, this.player.health - 10);
    this.player.stunned = 2.5;
    this.player.noise = 100;

    // 2. Play high-voltage shock sound & loud alarm
    if (this.audio.playElectricShock) {
      this.audio.playElectricShock();
    }
    this.audio.playLoudAlarmSound();
    this.audio.playSound('resources/injured-140224.mp3', 0.6);
    this.ui.triggerDamageFlash(0.85, 220);

    // 3. Status notification and log
    this.ui.showToast(`【高压电击】${reason}！受到 10 点电流伤害，身体麻痹 2.5 秒！`);
    this.ui.log(`电击警报：${reason}！生命值 -10，休克硬直 2.5s！`);

    // 4. Attempt monster teleport to nearby room (respects 15s cooldown)
    this.teleportMonsterToNearbyRoom(true);

    // 5. Exit / close QTE interface
    this.state.activeQte = null;
    this.ui.hideQTE();

    // 6. Death check
    if (this.player.health <= 0) {
      this.finish(false);
    }
  }

  /**
   * Handles 10-second QTE timeout expiration
   */
  handleQTETimeout() {
    if (!this.state.activeQte) return;
    this.triggerQTEShockFail('控制台重写超时 (10s)');
  }

  /**
   * Teleports the hostile entity to an adjacent/nearby room to approach the operator
   * Respects a 15-second cooldown when triggered by QTE failure
   */
  teleportMonsterToNearbyRoom(isQteFail = true) {
    if (isQteFail) {
      if (this.state.qteMonsterTpCooldown > 0) {
        // Monster teleport on 15s cooldown! Skip teleporting again.
        return false;
      }
      this.state.qteMonsterTpCooldown = 15.0;
    }

    const playerRoom = this.map.getRoomAt(this.player.x, this.player.y);
    let targetRoom = null;

    if (playerRoom) {
      // Find rooms directly connected to player's room via doors
      const connectedRooms = [];
      this.map.doors.forEach(d => {
        if (d.roomA === playerRoom && d.roomB && d.roomB !== playerRoom) {
          connectedRooms.push(d.roomB);
        } else if (d.roomB === playerRoom && d.roomA && d.roomA !== playerRoom) {
          connectedRooms.push(d.roomA);
        }
      });

      if (connectedRooms.length > 0) {
        targetRoom = connectedRooms[Math.floor(Math.random() * connectedRooms.length)];
      } else {
        // Fallback: closest non-player room
        const otherRooms = this.map.worldRooms.filter(r => r !== playerRoom);
        if (otherRooms.length > 0) {
          targetRoom = otherRooms.reduce((prev, curr) => 
            Math.hypot(this.player.x - curr.center.x, this.player.y - curr.center.y) <
            Math.hypot(this.player.x - prev.center.x, this.player.y - prev.center.y) ? curr : prev
          );
        }
      }
    }

    if (targetRoom) {
      this.monster.x = targetRoom.center.x;
      this.monster.y = targetRoom.center.y;
      this.monster.active = true;
      this.monster.alerted = true;
      this.monster.lostTime = 0;
      this.monster.waypoints = [];
      this.monster.waypointTimer = 0;
      this.monster._stuckTimer = 0;
      this.monster._lastX = null;
      this.monster._lastY = null;
      
      if (this.audio.calculateSpatial) {
        const spatial = this.audio.calculateSpatial(this.player.x, this.player.y, this.player.angle, this.monster.x, this.monster.y, 800);
        this.audio.playSpatialTone(75, 0.45, 0.28, 'sawtooth', spatial.pan, Math.max(0.6, spatial.distanceGain), spatial.isBehind);
      } else {
        this.audio.playTone(75, 0.45, 0.28, 'sawtooth');
      }
      this.ui.showToast(`【警报】未知生命体已被惊动！瞬移至邻近舱室 [${targetRoom.label}]！`);
      this.ui.log(`警报！生命体感应到警报，信号出现在隔壁舱室：${targetRoom.title} (${targetRoom.label})！`);
      return true;
    }
    return false;
  }

  /**
   * Scavenges a nearby recoverable scrap item into the backpack grid
   */
  collect() {
    if (!this.state.running) return;

    const item = this.map.scrap.find(s => !s.found && Math.hypot(s.x - this.player.x, s.y - this.player.y) < 30);
    if (!item) {
      this.ui.showToast('附近没有可回收物');
      return;
    }

    // Auto-placement tries the current rotation first, then every other rotation
    if (!this.backpack.place(item)) {
      this.ui.showToast('背包空间不足！无法容纳该物资');
      this.ui.log(`背包已满：${item.name || '废料'} 无法回收，请先整理或丢弃物资。`);
      return;
    }

    item.found = true;
    this.state.loot += 1;
    this.state.lootValue += item.value || 0;
    this.player.noise = Math.min(100, this.player.noise + 20);

    const size = this.backpack.sizeFor(item);
    this.ui.log(`拾取：${item.name || '废料'} (占地 ${size.w}×${size.h} 格)。`);
    this.ui.showToast(`拾取 ${item.name || '物品'} [${size.w}×${size.h}]`);

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
    if (!this.backpack.items.length) {
      this.ui.showToast('背包里没有可出售的物资！');
      return;
    }
    const total = this.backpack.totalValue();
    const count = this.backpack.items.length;
    this.backpack.clear();
    this.selectedItemId = null;
    this.state.money += total;
    this.state.loot = 0;
    this.state.lootValue = 0;
    this.ui.showToast(`背包物资已全部出售，获得 ¥ ${total}`);
    this.ui.log(`交易完成：出售 ${count} 件物资，进账 ¥ ${total}。`);
    this.updateInventoryUI();
    this.updateMoneyUI();
  }

  sellStorage() {
    if (this.state.storageItems.length === 0) {
      this.ui.showToast('仓库空空如也，没有可出售的物资！');
      return;
    }
    let totalValue = 0;
    this.state.storageItems.forEach(item => {
      totalValue += item.value || 50;
    });
    this.state.storageItems = [];
    this.state.money += totalValue;
    this.ui.showToast(`成功出售仓库所有物资，获得 ¥ ${totalValue}`);
    this.updateStorageUI();
    this.updateMoneyUI();
    this._save();
  }

  updateMoneyUI() {
    document.getElementById('moneyDisplay').textContent = `¥ ${this.state.money}`;
  }

  /**
   * Builds the composite telemetry payload consumed by UIManager.update()
   */
  _buildCompositeState() {
    return {
      oxygen: this.player.oxygen,
      health: this.player.health,
      stamina: this.player.stamina,
      noise: this.player.noise,
      loot: this.state.loot,
      lootValue: this.state.lootValue,
      lootCells: this.backpack.usedCells(),
      lootCellCapacity: this.backpack.capacity,
      elapsed: this.state.elapsed,
      reloading: this.player.reloading
    };
  }

  /**
   * Redraws the Tetris-style backpack grid: one background cell per slot plus a
   * spanned tile for every stored item.
   *
   * All geometry (columns, rows, cell size, gap) is written inline from the backpack
   * definition rather than read from CSS, so the cells can never be re-sized by content,
   * a stale stylesheet or a flex squeeze — and any other backpack layout renders correctly.
   */
  updateInventoryUI() {
    const grid = document.getElementById('inventoryGrid');
    if (!grid) return;

    const backpack = this.backpack;
    const cellSize = backpack.cellSize;
    const gap = backpack.gap;
    const pitch = backpack.pitch;

    // The whole layout box is written inline: cell size, tracks, gaps and every element's
    // explicit width/height. Content, a stale stylesheet or an implicit track can then never
    // stretch the grid or shift a tile out of alignment.
    grid.style.display = 'grid';
    grid.style.setProperty('--bp-cell', `${cellSize}px`);
    grid.style.setProperty('--bp-gap', `${gap}px`);
    grid.style.gap = `${gap}px`;
    grid.style.padding = `${gap}px`;
    grid.style.boxSizing = 'border-box';
    grid.style.flex = 'none';
    grid.style.width = 'max-content';
    grid.style.minWidth = '0';
    grid.style.minHeight = '0';
    grid.style.alignContent = 'start';
    grid.style.justifyContent = 'start';
    grid.style.gridTemplateColumns = `repeat(${backpack.cols}, ${cellSize}px)`;
    grid.style.gridTemplateRows = `repeat(${backpack.rows}, ${cellSize}px)`;
    // Hard guard: any implicit track is zero-sized, so a stray/overhanging item can never
    // add a cell and stretch the backpack (the explicit tracks alone define its size)
    grid.style.gridAutoColumns = '0px';
    grid.style.gridAutoRows = '0px';
    grid.innerHTML = '';

    const titleEl = document.getElementById('inventoryTitle');
    if (titleEl) titleEl.textContent = backpack.label || '物资背包';

    // The side column is locked to the exact grid height: adding or selecting items can
    // never make the backpack panel grow, the details simply scroll inside.
    const sideEl = document.querySelector('.inventory-side');
    if (sideEl) {
      sideEl.style.flex = '0 0 170px';
      sideEl.style.boxSizing = 'border-box';
      sideEl.style.height = this._spanPx(backpack.rows);
      sideEl.style.overflowY = 'auto';
    }

    // Background cells double as the drag & drop hit target.
    // They are placed EXPLICITLY (never auto-placed): auto-placed cells would be pushed into
    // an implicit track as soon as a tile covers a slot, which is what produced a stray row
    // of cells below the grid (and previously a visibly wider/taller backpack).
    for (let gy = 0; gy < backpack.rows; gy++) {
      for (let gx = 0; gx < backpack.cols; gx++) {
        const cell = document.createElement('div');
        cell.className = 'bp-cell';
        cell.dataset.gx = gx;
        cell.dataset.gy = gy;
        cell.style.gridColumn = `${gx + 1} / span 1`;
        cell.style.gridRow = `${gy + 1} / span 1`;
        cell.style.width = `${cellSize}px`;
        cell.style.height = `${cellSize}px`;
        cell.style.boxSizing = 'border-box';
        cell.style.minWidth = '0';
        cell.style.minHeight = '0';
        cell.style.padding = '0';
        grid.appendChild(cell);
      }
    }

    backpack.items.forEach(item => {
      const matrix = backpack.matrixFor(item);
      const tile = document.createElement('div');
      tile.className = `bp-item rarity-${item.rarity || 'common'}`;
      tile.dataset.itemId = item.id;
      tile.title = `${item.name || '物资'} · ¥${item.value || 0} · 占地 ${matrix[0].length}×${matrix.length} 格`;

      // Plain relative box, fully sized inline. Resetting margin/padding/border/background
      // here means an older cached stylesheet can neither shrink, expand nor shift the tile.
      tile.style.position = 'relative';
      tile.style.display = 'block';
      tile.style.margin = '0';
      tile.style.padding = '0';
      tile.style.border = 'none';
      tile.style.background = 'transparent';
      tile.style.boxSizing = 'border-box';
      tile.style.minWidth = '0';
      tile.style.minHeight = '0';
      tile.style.pointerEvents = 'none';
      this._placeItemElement(tile, item.gx, item.gy, matrix);
      if (item.id === this.selectedItemId) tile.classList.add('selected');
      // Keep an in-flight drag alive if the grid is rebuilt mid-drag
      if (this._itemDrag && this._itemDrag.item.id === item.id) {
        this._itemDrag.tile = tile;
        tile.classList.add('dragging');
      }

      // Only the occupied footprint cells are drawn/hit-tested, so an L really looks like an L.
      // Every block is placed at an exact multiple of the grid pitch, which is what keeps it
      // perfectly aligned with the background cell it represents.
      this._renderTileBlocks(tile, item, matrix);

      grid.appendChild(tile);
    });

    this._updateBackpackReadout();
  }

  /**
   * (Re)builds the footprint blocks of one tile. Called by the grid render and again whenever
   * a mid-drag rotation changes the silhouette, so what is drawn always matches what is judged.
   */
  _renderTileBlocks(tile, item, matrix) {
    if (!tile) return;
    tile.innerHTML = '';

    const cellSize = this.backpack.cellSize;
    const pitch = this.backpack.pitch;
    let labelled = false;

    matrix.forEach((row, rowIndex) => {
      row.forEach((cell, colIndex) => {
        if (!cell) return;
        const block = document.createElement('div');
        block.className = 'bp-block';
        block.style.position = 'absolute';
        block.style.left = `${colIndex * pitch}px`;
        block.style.top = `${rowIndex * pitch}px`;
        block.style.margin = '0';
        block.style.width = `${cellSize}px`;
        block.style.height = `${cellSize}px`;
        block.style.boxSizing = 'border-box';
        block.style.overflow = 'hidden';
        block.style.minWidth = '0';
        block.style.minHeight = '0';
        block.style.pointerEvents = 'auto';
        block.addEventListener('pointerdown', event => this._beginItemDrag(event, item));
        block.addEventListener('contextmenu', event => {
          event.preventDefault();
          this.rotateItem(item.id);
        });

        if (!labelled) {
          labelled = true;
          const label = document.createElement('span');
          label.className = 'bp-item-name';
          label.textContent = item.name || '物资';
          const value = document.createElement('span');
          value.className = 'bp-item-value';
          value.textContent = `¥${item.value || 0}`;
          block.appendChild(label);
          block.appendChild(value);
        }

        tile.appendChild(block);
      });
    });

    tile.dataset.blockSignature = this._matrixSignature(matrix);
  }

  /** Compact signature used to detect that a rotated footprint needs re-drawing */
  _matrixSignature(matrix) {
    return matrix.map(row => row.join('')).join('|');
  }

  /**
   * Anchors an item tile to the grid cells it covers.
   *
   * CSS grid line numbers start at 1: feeding an out-of-range line (0 or negative) makes
   * the browser drop the declaration and auto-place the tile somewhere else entirely, which
   * is what made the drag preview disagree with the drop result. The anchor is therefore
   * clamped, and since every catalogued footprint is a tight bounding box (filled first row
   * and first column) an out-of-range anchor is always an invalid placement anyway — the
   * tile is simply pinned to the nearest edge and flagged red.
   */
  /** Pixel size of a run of `count` cells including the gaps between them */
  _spanPx(count) {
    const { cellSize, gap } = this.backpack;
    return `${count * cellSize + Math.max(0, count - 1) * gap}px`;
  }

  /** Footprint span clamped to the current grid (defensive against absurd layouts) */
  _clampedSpan(matrix) {
    return {
      w: Math.max(1, Math.min(matrix[0].length, this.backpack.cols)),
      h: Math.max(1, Math.min(matrix.length, this.backpack.rows))
    };
  }

  /**
   * Anchors an item tile to the grid cells it covers and gives it the matching pixel box.
   *
   * The anchor is always clamped into the grid: CSS grid lines must be >= 1, and a line past
   * the last track would make an implicit track / auto-placement kick in and visibly stretch
   * the backpack. Non-finite values are sanitised as well so a bad model value can never
   * produce an invalid `grid-column` (which the browser would silently auto-place).
   */
  _placeItemElement(tile, gx, gy, matrix) {
    const { cols, rows } = this.backpack;
    const { w, h } = this._clampedSpan(matrix);

    const safeGx = Number.isFinite(gx) ? Math.trunc(gx) : 0;
    const safeGy = Number.isFinite(gy) ? Math.trunc(gy) : 0;
    const column = Math.max(0, Math.min(cols - w, safeGx)) + 1;
    const row = Math.max(0, Math.min(rows - h, safeGy)) + 1;

    const columnSpec = `${column} / span ${w}`;
    const rowSpec = `${row} / span ${h}`;
    const widthSpec = this._spanPx(w);
    const heightSpec = this._spanPx(h);

    // Guarded writes: during a drag this runs on every pointer move, so avoid touching
    // style properties that are already correct (each write invalidates layout).
    if (tile.style.gridColumn !== columnSpec) tile.style.gridColumn = columnSpec;
    if (tile.style.gridRow !== rowSpec) tile.style.gridRow = rowSpec;
    if (tile.style.width !== widthSpec) tile.style.width = widthSpec;
    if (tile.style.height !== heightSpec) tile.style.height = heightSpec;
  }

  /** Refreshes the backpack header, description panel and action buttons */
  _updateBackpackReadout() {
    const backpack = this.backpack;
    const selected = backpack.getItem(this.selectedItemId);
    const countEl = document.getElementById('inventoryCount');
    const capacityEl = document.getElementById('inventoryCapacity');
    const descEl = document.getElementById('itemDesc');
    const rotateBtn = document.getElementById('rotateItemBtn');
    const discardBtn = document.getElementById('discardItemBtn');

    if (countEl) countEl.textContent = `${backpack.items.length} 件物资`;
    if (capacityEl) {
      const used = backpack.usedCells();
      capacityEl.textContent = `${used} / ${backpack.capacity} 格`;
      capacityEl.className = used >= backpack.capacity ? 'warning' : '';
    }
    if (rotateBtn) rotateBtn.disabled = !selected;
    if (discardBtn) discardBtn.disabled = !selected;
    if (!descEl) return;

    if (!selected) {
      descEl.textContent = '点击物资查看详情 · 拖拽自由摆放 · 右键或 [R] 旋转 · 深色格为空格';
      return;
    }

    const size = backpack.sizeFor(selected);
    const rarityLabel = { common: '常见', uncommon: '稀有', rare: '珍贵' }[selected.rarity] || '常见';
    descEl.textContent = `${selected.name || '物资'} [${rarityLabel}] · 占地 ${size.w}×${size.h} 格 · 回收价 ¥${selected.value || 0} · 朝向 ${backpack.rotationFor(selected) * 90}°`;
  }

  /** Opens/closes the backpack overlay (B key) */
  toggleInventory(force = null) {
    const overlay = document.getElementById('inventoryOverlay');
    if (!overlay) return;

    const next = typeof force === 'boolean' ? force : !this.state.inventoryOpen;
    overlay.style.display = next ? 'block' : 'none';
    this.state.inventoryOpen = next;

    if (next) {
      this.state.fireHeld = false;
      this.updateInventoryUI();
      this.ui.log('打开背包网格 [拖拽摆放 / 右键或 R 旋转 / B 关闭]');
    } else {
      this._cancelItemDrag();
      this.selectedItemId = null;
    }
  }

  /** Selects an item (highlight + detail panel) without rebuilding the grid */
  selectInventoryItem(itemId) {
    this.selectedItemId = itemId;
    const grid = document.getElementById('inventoryGrid');
    if (grid) {
      grid.querySelectorAll('.bp-item').forEach(tile => {
        tile.classList.toggle('selected', Number(tile.dataset.itemId) === itemId);
      });
    }
    this._updateBackpackReadout();
  }

  /** Rotates the selected (or given) item 90° inside the grid */
  rotateItem(itemId = null) {
    const target = this.backpack.getItem(itemId == null ? this.selectedItemId : itemId);
    if (!target) {
      this.ui.showToast('请先选中一件物资');
      return false;
    }
    if (this.backpack.isRotationInvariant(target)) {
      this.ui.showToast(`${target.name || '物资'} 外形对称，旋转后没有变化`);
      return false;
    }
    if (!this.backpack.rotateItem(target)) {
      this.ui.showToast('周围空间不足，无法旋转该物资');
      return false;
    }
    this.updateInventoryUI();
    this.ui.showToast(`${target.name || '物资'} 已旋转至 ${this.backpack.rotationFor(target) * 90}°`);
    return true;
  }

  /** Drops the selected item back onto the facility floor at the operator's feet */
  discardItem(itemId = null) {
    const item = this.backpack.removeItem(itemId == null ? this.selectedItemId : itemId);
    if (!item) {
      this.ui.showToast('请先选中一件物资');
      return;
    }

    item.found = false;
    item.x = this.player.x + (Math.random() - 0.5) * 24;
    item.y = this.player.y + (Math.random() - 0.5) * 24;

    this.state.loot = Math.max(0, this.state.loot - 1);
    this.state.lootValue = Math.max(0, this.state.lootValue - (item.value || 0));
    this.selectedItemId = null;

    this.ui.log(`丢弃：${item.name || '物资'} 已放回地面。`);
    this.ui.showToast(`已丢弃 ${item.name || '物资'}`);
    this.updateInventoryUI();
  }

  /** Compacts every carried item into the smallest possible footprint (keeps pickup order) */
  packInventory() {
    if (!this.backpack.items.length) {
      this.ui.showToast('背包是空的');
      return;
    }
    const result = this.backpack.autoPack('insert');
    this.updateInventoryUI();
    this.ui.showToast(`背包已整理：${result.packed} 件物资重新排布`);
  }

  /** Re-packs everything ordered by recoverable value (highest first) */
  sortInventory() {
    if (!this.backpack.items.length) {
      this.ui.showToast('背包是空的');
      return;
    }
    const result = this.backpack.autoPack('value');
    this.updateInventoryUI();
    if (result.failed.length) {
      this.ui.showToast('空间不足，无法按价值重排');
      return;
    }
    this.ui.showToast('背包物资已按回收价值降序重排');
  }

  /* ------------------------------------------------------------------ *
   * Backpack drag & drop
   * ------------------------------------------------------------------ */

  /** Reads the rendered cell pitch so pointer coordinates map onto grid cells */
  _gridMetrics(grid) {
    const cells = grid.querySelectorAll('.bp-cell');
    if (!cells.length) return null;

    const first = cells[0].getBoundingClientRect();
    const nextX = cells[1] ? cells[1].getBoundingClientRect() : null;
    const nextY = cells[this.backpack.cols] ? cells[this.backpack.cols].getBoundingClientRect() : null;
    return {
      left: first.left,
      top: first.top,
      stepX: Math.max(1, nextX ? nextX.left - first.left : first.width),
      stepY: Math.max(1, nextY ? nextY.top - first.top : first.height)
    };
  }

  /** Converts viewport coordinates into grid cell coordinates */
  _cellFromPoint(clientX, clientY, grid) {
    const metrics = this._gridMetrics(grid);
    if (!metrics) return { gx: 0, gy: 0 };
    return {
      gx: Math.floor((clientX - metrics.left) / metrics.stepX),
      gy: Math.floor((clientY - metrics.top) / metrics.stepY)
    };
  }

  /** Finds the tile element of a stored item */
  _itemTileFor(itemId) {
    const grid = document.getElementById('inventoryGrid');
    return grid ? grid.querySelector(`.bp-item[data-item-id="${itemId}"]`) : null;
  }

  /**
   * Applies the pending pointer position to the dragged footprint.
   * Runs at most once per animation frame (see _handleItemDragMove) and never reads layout,
   * so a fast mouse can not cause a forced reflow per event.
   */
  _applyDragPreview(drag) {
    if (!drag || !drag.metrics) return;
    const hoveredGx = Math.floor((drag.pointerX - drag.metrics.left) / drag.metrics.stepX);
    const hoveredGy = Math.floor((drag.pointerY - drag.metrics.top) / drag.metrics.stepY);
    drag.gx = hoveredGx - drag.grabX;
    drag.gy = hoveredGy - drag.grabY;
    this._refreshDragPreview(drag);
  }

  /**
   * Re-renders the dragged footprint.
   * The tile itself is the only feedback: it follows the judged anchor and turns red when
   * the spot is refused (no cell highlighting — it was visual noise).
   */
  _refreshDragPreview(drag = this._itemDrag) {
    if (!drag) return;

    const matrix = this.backpack.matrixFor(drag.item, drag.rot);
    drag.valid = this.backpack.canPlace(matrix, drag.gx, drag.gy, drag.item.id);

    if (!drag.tile || drag.tile.isConnected === false) drag.tile = this._itemTileFor(drag.item.id);
    const tile = drag.tile;
    if (!tile) return;

    // Re-draw the silhouette when a mid-drag rotation changed it, then anchor it to the
    // very same position that is being judged
    if (tile.dataset.blockSignature !== this._matrixSignature(matrix)) {
      this._renderTileBlocks(tile, drag.item, matrix);
    }
    this._placeItemElement(tile, drag.gx, drag.gy, matrix);

    const invalid = !drag.valid;
    if (tile.classList.contains('invalid') !== invalid) tile.classList.toggle('invalid', invalid);
  }

  /** Starts dragging an item tile (a plain click still selects it) */
  _beginItemDrag(event, item) {
    if (event.button !== 0 || !item) return;
    const grid = document.getElementById('inventoryGrid');
    if (!grid) return;
    event.preventDefault();

    // The grid geometry is read ONCE per drag: reading it inside every pointer move would
    // force a synchronous layout on each event and make the tile feel laggy.
    const metrics = this._gridMetrics(grid);
    const anchor = this._cellFromPoint(event.clientX, event.clientY, grid);
    this._itemDrag = {
      item,
      rot: this.backpack.rotationFor(item),
      grabX: anchor.gx - item.gx,
      grabY: anchor.gy - item.gy,
      gx: item.gx,
      gy: item.gy,
      pointerX: event.clientX,
      pointerY: event.clientY,
      metrics,
      tile: this._itemTileFor(item.id),
      valid: true,
      moved: false,
      startX: event.clientX,
      startY: event.clientY
    };

    this.selectInventoryItem(item.id);
    const tile = this._itemTileFor(item.id);
    if (tile) tile.classList.add('dragging');

    window.addEventListener('pointermove', this._boundItemDragMove);
    window.addEventListener('pointerup', this._boundItemDragEnd);
    window.addEventListener('pointercancel', this._boundItemDragEnd);
  }

  /**
   * Live placement preview following the cursor.
   * Only records the pointer position here and lets the next animation frame apply it: mouse
   * events can fire far more often than the screen refreshes and each DOM write costs layout.
   */
  _handleItemDragMove(event) {
    const drag = this._itemDrag;
    if (!drag) return;

    drag.pointerX = event.clientX;
    drag.pointerY = event.clientY;
    if (Math.abs(event.clientX - drag.startX) > 3 || Math.abs(event.clientY - drag.startY) > 3) {
      drag.moved = true;
    }

    if (drag.framePending) return;
    drag.framePending = true;

    const flush = () => {
      drag.framePending = false;
      if (this._itemDrag === drag) this._applyDragPreview(drag);
    };
    if (typeof requestAnimationFrame === 'function' && drag.moved) {
      requestAnimationFrame(flush);
    } else {
      flush();
    }
  }

  /** Rotates the footprint currently being dragged (R key / right-click while dragging) */
  _rotateDraggedItem() {
    const drag = this._itemDrag;
    if (!drag) return false;
    drag.rot = BackpackManager.normalizeRotation(drag.rot + 1);
    this._refreshDragPreview(drag);
    return true;
  }

  /** Commits the drop, or snaps the item back when the target spot is invalid */
  _handleItemDragEnd() {
    const drag = this._itemDrag;
    this._itemDrag = null;
    window.removeEventListener('pointermove', this._boundItemDragMove);
    window.removeEventListener('pointerup', this._boundItemDragEnd);
    window.removeEventListener('pointercancel', this._boundItemDragEnd);
    if (!drag) return;

    // Apply a still-pending frame so the drop uses the very last pointer position
    if (drag.framePending) {
      drag.framePending = false;
      this._applyDragPreview(drag);
    }

    const tile = drag.tile || this._itemTileFor(drag.item.id);
    if (tile) tile.classList.remove('dragging', 'invalid');

    if (!drag.moved) {
      // plain click: keep the selection and snap the tile back onto its stored cells
      if (tile) this._placeItemElement(tile, drag.item.gx, drag.item.gy, this.backpack.matrixFor(drag.item));
      return;
    }

    const moved = drag.valid && this.backpack.moveItem(drag.item, drag.gx, drag.gy, drag.rot);
    if (!moved) this.ui.showToast('无法放置：越界或与其他物资重叠');
    this.updateInventoryUI();
  }

  /** Aborts any in-flight drag (overlay closed or run reset) */
  _cancelItemDrag() {
    this._itemDrag = null;
    window.removeEventListener('pointermove', this._boundItemDragMove);
    window.removeEventListener('pointerup', this._boundItemDragEnd);
    window.removeEventListener('pointercancel', this._boundItemDragEnd);
  }

  /**
   * Weapon discharge action and target intersection resolving
   */
  shoot() {
    if (!this.state.running) return;
    if (this.player.stunned > 0) {
      this.ui.showToast('休克硬直中，无法射击！');
      return;
    }

    const result = this.player.shoot(this.state.stabilized, this.map, this.audio, this.monster);
    
    if (result.fired) {
      // Trigger muzzle flash lighting effect (start at full 0.45 second decay clock)
      this.state.muzzleFlashTimer = 0.45; 
      
      const startX = this.player.x;
      const startY = this.player.y;
      const angle = result.shotAngle;
      const wallDist = this.map.rayWallDistance(startX, startY, Math.cos(angle), Math.sin(angle), 650);
      const rayCircleHitDistance = (entity) => {
        const dx = entity.x - startX;
        const dy = entity.y - startY;
        const projection = dx * Math.cos(angle) + dy * Math.sin(angle);
        if (projection < 0) return Infinity;

        const perpendicularSq = dx * dx + dy * dy - projection * projection;
        const hitRadius = entity.radius + 6;
        if (perpendicularSq > hitRadius * hitRadius) return Infinity;

        const hitDistance = Math.max(0, projection - Math.sqrt(hitRadius * hitRadius - perpendicularSq));
        return hitDistance <= wallDist ? hitDistance : Infinity;
      };

      const monsterHitDistance = this.monster.active ? rayCircleHitDistance(this.monster) : Infinity;
      let hunterTarget = null;
      let hunterHitDistance = Infinity;

      for (const hunter of this.hunters) {
        if (!hunter.active || hunter.dead) continue;
        const hitDistance = rayCircleHitDistance(hunter);
        if (hitDistance >= hunterHitDistance) continue;
        hunterTarget = hunter;
        hunterHitDistance = hitDistance;
      }

      if (hunterTarget && hunterHitDistance <= monsterHitDistance) {
        result.hit = false;
        result.traceLength = hunterHitDistance;
      } else {
        hunterTarget = null;
        result.hit = monsterHitDistance < Infinity;
        result.distance = result.hit ? monsterHitDistance : 0;
        if (result.hit) result.toMonster = Math.atan2(this.monster.y - startY, this.monster.x - startX);
        result.traceLength = result.hit ? monsterHitDistance : wallDist;
      }

      const endX = startX + Math.cos(angle) * result.traceLength;
      const endY = startY + Math.sin(angle) * result.traceLength;

      // Apply screen recoil in the EXACT opposite direction of the fired shot
      const recoilIntensity = this.state.stabilized ? this.player.weapon.recoilAim : this.player.weapon.recoilHip;
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
      const hitTarget = result.hit || !!hunterTarget;
      const sparkCount = hitTarget ? 22 : 8;
      const sparkColor = hitTarget ? '#e8754e' : '#75ddd0';
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
        const hitData = this.monster.registerHit();
        const push = hitData.triggeredRecovery ? 240 : 50;
        const nextX = this.monster.x + Math.cos(result.toMonster) * push;
        const nextY = this.monster.y + Math.sin(result.toMonster) * push;

        this.monster.x = Math.max(38, Math.min(Config.WORLD_W - 38, nextX));
        this.monster.y = Math.max(38, Math.min(Config.WORLD_H - 38, nextY));

        this.ui.triggerDamageFlash(0.18, 80);

        if (hitData.triggeredRecovery) {
          this.ui.log('致命硬直！10秒内连续命中3次！生命体进入10秒休眠恢复期！');
          this.ui.showToast('【重创】生命体休眠瘫痪 10秒！');
          const hitSpatial = this.audio.calculateSpatial(this.player.x, this.player.y, this.player.angle, this.monster.x, this.monster.y, 650);
          this.audio.playSpatialTone(60, 0.45, 0.35, 'sawtooth', hitSpatial.pan, Math.max(0.6, hitSpatial.distanceGain), hitSpatial.isBehind);
        } else if (hitData.recovering) {
          this.ui.log(`生命体处于休眠恢复中 (剩余 ${this.monster.recoverTimer.toFixed(1)}s)。`);
          this.ui.showToast(`目标瘫痪中 [${this.monster.recoverTimer.toFixed(1)}s]`);
        } else {
          this.ui.log(`命中。生命体被击退50px并硬直0.25s (连击: ${hitData.shotCount}/3，重置窗口: ${hitData.windowLeft.toFixed(1)}s)。`);
          this.ui.showToast(`命中 / 目标硬直0.25s [${hitData.shotCount}/3]`);
          const hitSpatial = this.audio.calculateSpatial(this.player.x, this.player.y, this.player.angle, this.monster.x, this.monster.y, 650);
          this.audio.playSpatialTone(88, 0.18, 0.22, 'sawtooth', hitSpatial.pan, Math.max(0.5, hitSpatial.distanceGain), hitSpatial.isBehind);
        }
      } else if (hunterTarget) {
        const hitResult = hunterTarget.registerHit();
        if (hitResult.hit) {
          const knockX = hunterTarget.x + Math.cos(angle) * 30;
          const knockY = hunterTarget.y + Math.sin(angle) * 30;
          if (!this.map.blocked(knockX, hunterTarget.y, hunterTarget.radius)) hunterTarget.x = knockX;
          if (!this.map.blocked(hunterTarget.x, knockY, hunterTarget.radius)) hunterTarget.y = knockY;
          hunterTarget.waypoints = [];
          hunterTarget.waypointTimer = 0;
          if (hitResult.dead) {
            this.ui.showToast('猎手已被击毙！');
            this.ui.log('威胁消除：猎手生命体已击毙。');
            this.audio.playSpatialTone(55, 0.3, 0.6, 'sawtooth', 0, 1, false);
          } else {
            this.audio.playSpatialTone(120, 0.15, 0.2, 'square', 0, 1, false);
          }
        }
      } else {
        this.ui.log('枪声在走廊里回响。');
        this.ui.showToast('未命中');
      }

      if (this.player.ammo === 0 && this.player.reserveAmmo > 0) this.player.reload(this.audio);
    } else if (result.reason === 'empty') {
      this.audio.playTone(180, 0.04, 0.08, 'square');
      this.ui.showToast('弹药耗尽 (按 R 换弹)');
    } else if (result.reason === 'reloading') {
      this.ui.showToast('正在换弹中...');
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

    // Decrement QTE monster teleport cooldown timer (15s cooldown)
    if (this.state.qteMonsterTpCooldown > 0) {
      this.state.qteMonsterTpCooldown = Math.max(0, this.state.qteMonsterTpCooldown - dt);
    }

    // 1. Update Player position & status timers (freeze input movement during active QTE, Full Map, or Stun)
    const inputKeys = (this.state.activeQte || this.state.fullMapOpen || this.player.stunned > 0) ? {} : this.state.keys;
    const playerResult = this.player.update(dt, inputKeys, this.state.stabilized, this.map, this.audio);
    if (playerResult && playerResult.reloaded) {
      this.ui.showToast('换弹完成');
    }
    if (playerResult && playerResult.stunRecovered) {
      this.ui.showToast('电击硬直解除，身体恢复行动');
      this.ui.log('恢复：高压电击麻痹硬直结束，行动能力恢复。');
    }

    if (this.state.activeQte || this.state.fullMapOpen || this.state.inventoryOpen || this.player.stunned > 0) {
      this.state.fireHeld = false;
    } else if (this.state.fireHeld && this.player.weapon.automatic && this.player.ammo > 0 && this.player.reloading <= 0) {
      this.shoot();
    }

    // 1a. Update active QTE security console countdown timer (10s time limit)
    if (this.state.activeQte) {
      this.state.activeQte.timeLeft = Math.max(0, this.state.activeQte.timeLeft - dt);
      this.ui.updateQTETimer(this.state.activeQte.timeLeft, this.state.activeQte.maxTime);
      if (this.state.activeQte.timeLeft <= 0) {
        this.handleQTETimeout();
      }
    }

    // 1b. Fog of War: discover room as soon as player steps inside
    const currentRoom = this.map.getRoomAt(this.player.x, this.player.y);
    if (currentRoom && !currentRoom.discovered) {
      currentRoom.discovered = true;
      this.ui.showToast(`探索新区域: ${currentRoom.title}`);
      this.ui.log(`雷达已探明新区域：${currentRoom.title} (${currentRoom.label})。`);
    }

    // 2. Decay movement acoustic noise
    if (this.player.moveSpeed === 0) {
      const stillDecay = (Config.player && Config.player.noiseDecayStill) || 12;
      this.player.noise = Math.max(0, this.player.noise - stillDecay * dt);
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
    // Activate ALL hunters immediately at game start (after 3s, not near player)
    if (this.state.elapsed > 3 && !this.state.huntersInitialized) {
      this.hunters.forEach(h => {
        if (!h.active && !h.dead) {
          const dist = Math.hypot(h.x - this.player.x, h.y - this.player.y);
          if (dist > 300 || this.map.monsterSpawns.length === 0) {
            this.activateHunter(h, '设施深处传来稳定的踏步声。');
          }
        }
      });
      this.state.huntersInitialized = true;
    }

    // Respawn timer: revive killed hunters every interval
    const hunterSettings = this._getHunterSettings();
    const respawnInterval = hunterSettings.hunterSpawnInterval;
    const respawnCount = hunterSettings.hunterRespawnCount;
    if (this.state.huntersInitialized) {
      this.state.hunterSpawnTimer -= dt;
      if (this.state.hunterSpawnTimer <= 0) {
        const dead = this.hunters.filter(h => h.dead);
        const toRevive = Math.min(respawnCount, dead.length);
        for (let i = 0; i < toRevive; i++) {
          const h = dead[Math.floor(Math.random() * dead.length)];
          dead.splice(dead.indexOf(h), 1);
          const sp = h.getFarSpawnPoint(this.player.x, this.player.y, this.map);
          if (sp) { h.x = sp.x; h.y = sp.y; }
          h.dead = false;
          h.maxHp = hunterSettings.hunterMaxHp;
          h.hp = h.maxHp;
          h.active = false;
          this.activateHunter(h, '设施深处传来稳定的踏步声。');
        }
        this.state.hunterSpawnTimer = respawnInterval;
      }
    }

    // 6. Drive monster pathfinding & AI updates
    const allEntities = [this.monster, ...this.hunters];
    const monsterResult = this.monster.update(dt, this.player, this.player.noise, this.map, this.audio, allEntities);
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
      }

      if (monsterResult.burstFinished) {
        this.ui.showToast('目标短暂失速');
        this.ui.log('目标爆冲结束，可以拉开距离。');
      }

      if (monsterResult.playerHit) {
        this._applyContactDamage('警告：未知生命体接触！');
      }

      if (monsterResult.recovering) {
        this.ui.threatStatusText.textContent = `休眠中 (${monsterResult.recoverTimeLeft.toFixed(1)}s)`;
        this.ui.threatStatusText.className = 'ok';
      }

      if (monsterResult.recovered) {
        this.ui.threatStatusText.textContent = '已苏醒';
        this.ui.threatStatusText.className = 'warning';
        this.ui.showToast('【警告】生命体休眠结束！已恢复行动！');
        this.ui.log('警报：生命体休眠恢复期结束，重新开始行动！');
      }
    }

    // 6b. Drive Hunter AI (all active hunters)
    this.hunters.forEach(h => {
      if (h.dead && h.deathFade > 0) {
        h.deathFade = Math.max(0, h.deathFade - dt / 1.2);
      }
      if (!h.active || h.dead) return;
      const hunterResult = h.update(dt, this.player, this.player.noise, this.map, this.audio, allEntities);
      if (!hunterResult) return;

      if (hunterResult.playerHit) {
        this._applyContactDamage('警告：猎手接触！');
      }

      if (hunterResult.deaggro) {
        this.ui.log('猎手失去了你的踪迹。');
      }
    });

    // 6c. Jumpscare stinger the moment light reveals the hostile entity in sight
    this._updateMonsterJumpscare();

    // 7. Update synthesized ambient acoustics (breathing audio removed per user specification)
    this.audio.update(this.player, this.monster, this.map, this.hunters);

    // 8. Resolve retrieval extraction boundaries (Requires all 3 security override consoles passed)
    if (this.state.extractionCalled) {
      const d1 = Math.hypot(this.player.x - this.map.extractionPoint.x, this.player.y - this.map.extractionPoint.y);
      const d2 = this.map.exitExtractionPoint ? Math.hypot(this.player.x - this.map.exitExtractionPoint.x, this.player.y - this.map.exitExtractionPoint.y) : Infinity;
      const totalCount = this.map.terminals ? this.map.terminals.length : 3;
      const solvedCount = this.map.terminals ? this.map.terminals.filter(t => t.solved).length : totalCount;
      if ((d1 < 48 || d2 < 48) && solvedCount >= totalCount) {
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
    this.ui.update(this._buildCompositeState(), this.player, this.monster);
  }

  /**
   * Updates storage visual grid
   */
  updateStorageUI() {
    const grid = document.getElementById('storageGrid');
    grid.innerHTML = '';
    this.state.storageItems.forEach(item => {
      const el = document.createElement('div');
      el.className = 'storage-item';
      el.textContent = item.name || '■';
      el.title = item.name || '';
      el.style.fontSize = '10px';
      el.style.overflow = 'hidden';
      el.style.textOverflow = 'ellipsis';
      el.style.whiteSpace = 'nowrap';
      el.style.cursor = 'default';
      grid.appendChild(el);
    });
    document.getElementById('storageStats').textContent = `${this.state.storageItems.length} / ${this.state.storageCapacity}`;
  }

  /**
   * Triggers visual draws across all screens
   */
  render() {
    this.renderer.prepareCamera(this.player, this.state);
    this.renderer.draw(this.player, this.monster, this.map, this.state, this.hunters);
    this.renderer.drawWorldOverlay(this.player, this.map, this.state);
    this.renderer.drawCenteredVision(this.player, this.map, this.state);
    this.renderer.drawMiniMap(this.player, this.map, this.state);
    if (this.state.fullMapOpen) {
      this.renderer.drawFullMap(this.player, this.map, this.state);
    }
  }

  /**
   * Binds interaction listeners to system triggers
   */
  attachEventListeners() {
    window.addEventListener('resize', () => this.handleResize());

    window.addEventListener('keydown', e => {
      const key = e.key.toLowerCase();
      this.state.keys[key] = true;
      
      // Close full map on ESC
      if (key === 'escape' && this.state.fullMapOpen) {
        this.toggleFullMap(false);
        return;
      }

      // Intercept inputs when player is actively operating a security QTE console
      if (this.state.activeQte) {
        if (key === 'escape' || ['w', 'a', 's', 'd'].includes(key)) {
          this.handleQTEInput(key, e);
          return;
        }
      }

      // Backpack grid: R rotates the dragged/selected item, ESC closes the panel
      if (this.state.inventoryOpen) {
        if (key === 'escape') {
          this.toggleInventory(false);
          return;
        }
        if (key === 'r') {
          e.preventDefault();
          if (!this._rotateDraggedItem()) this.rotateItem();
          return;
        }
      }

      if (key === 'f') this.player.flashlight = !this.player.flashlight;
      if (key === 'e') this.interact();
      if (key === 'r') this.player.reload(this.audio); // Only R for reload
      if (key === 'x') this.callExtraction(); // X for extraction
      if (key === 'b') this.toggleInventory();
      if (key === 'm') this.toggleFullMap();
      
      // Removed Space key firing: Fire is strictly restricted to M1 (Mouse left click)
      const editingControl = e.target && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(e.target.tagName);
      if ((e.key === 'Enter' || e.code === 'Space') && !this.state.running && !editingControl) {
        e.preventDefault();
        this.start();
      }
    });

    window.addEventListener('keyup', e => {
      this.state.keys[e.key.toLowerCase()] = false;
    });

    let lastM1FireTime = 0;
    let isLeftDown = false;
    let isRightDown = false;

    const gameCanvas = document.getElementById('gameCanvas');
    const visionCanvas = document.getElementById('visionCanvas');
    const isInteractiveControl = (target) => !!(target && target.closest && target.closest('button, input, select, textarea, label, #inventoryOverlay'));
    const isGameSurface = (target) => target === gameCanvas || target === visionCanvas;

    const fireIfAllowed = (target) => {
      const now = performance.now();
      if (now - lastM1FireTime < 60) return; // Debounce multi-event triggers
      lastM1FireTime = now;

      if (!this.state.running) {
        // Only start when clicking the actual game canvas, not UI panels
        if (target && target !== gameCanvas && target !== visionCanvas) return;
        this.start();
        return;
      }
      if (this.state.fullMapOpen) return; // Disallow firing while viewing full tactical map
      if (this.state.activeQte) return; // Disallow firing while operating security console
      if (this.state.inventoryOpen) return; // Disallow firing while viewing inventory
      if (this.player.stunned > 0) return; // Disallow firing while stunned
      this.shoot();
    };

    const updateMouseButtons = (e) => {
      if (typeof e.buttons === 'number') {
        const leftNow = (e.buttons & 1) !== 0;
        const rightNow = (e.buttons & 2) !== 0;
        this.state.fireHeld = leftNow && this.state.running && isGameSurface(e.target);

        // Detect Left Click button press edge (transition from false to true)
        if (leftNow && !isLeftDown) {
          fireIfAllowed(e.target);
        }
        isLeftDown = leftNow;

        // Synchronize aiming state with right button state
        if (rightNow !== isRightDown) {
          isRightDown = rightNow;
          this.setStableAim(rightNow);
        }
      }
    };

    window.addEventListener('pointermove', e => {
      this.handleAim(e);
      updateMouseButtons(e);
    });

    window.addEventListener('mousemove', e => {
      this.handleAim(e);
      updateMouseButtons(e);
    });

    window.addEventListener('mousedown', e => {
      if (isInteractiveControl(e.target)) return;
      if (e.button === 0) {
        e.preventDefault();
        isLeftDown = true;
        this.state.fireHeld = this.state.running && isGameSurface(e.target);
        fireIfAllowed(e.target);
      } else if (e.button === 2) {
        e.preventDefault();
        isRightDown = true;
        this.setStableAim(true);
      }
    });

    window.addEventListener('mouseup', e => {
      if (e.button === 0) {
        isLeftDown = false;
        this.state.fireHeld = false;
      } else if (e.button === 2) {
        isRightDown = false;
        this.setStableAim(false);
      }
      updateMouseButtons(e);
    });

    window.addEventListener('pointerdown', e => {
      if (isInteractiveControl(e.target)) return;
      if (e.button === 0) {
        isLeftDown = true;
        this.state.fireHeld = this.state.running && isGameSurface(e.target);
        fireIfAllowed(e.target);
      } else if (e.button === 2) {
        isRightDown = true;
        this.setStableAim(true);
      }
    });

    window.addEventListener('pointerup', e => {
      if (e.button === 0) {
        isLeftDown = false;
        this.state.fireHeld = false;
      } else if (e.button === 2) {
        isRightDown = false;
        this.setStableAim(false);
      }
      updateMouseButtons(e);
    });

    window.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('dragstart', e => e.preventDefault());
    window.addEventListener('blur', () => { this.state.fireHeld = false; });
    
    // Unlock AudioContext on first user gesture
    window.addEventListener('pointerdown', () => this.audio.ensureAudio(), { passive: true });
    window.addEventListener('keydown', () => this.audio.ensureAudio(), { passive: true });

    this.ui.startButton.addEventListener('click', () => {
      this.audio.ensureAudio();
      if (!this.state.running) {
        this.start();
      }
    });

    Object.entries(this.ui.hunterSettingInputs).forEach(([key, input]) => {
      if (!input) return;
      input.addEventListener('change', () => this.updateHunterSetting(key, input.value));
    });
    if (this.ui.resetHunterSettingsButton) {
      this.ui.resetHunterSettingsButton.addEventListener('click', () => this.resetHunterSettings());
    }

    this.ui.prompt.addEventListener('click', () => {
      this.audio.ensureAudio();
      if (!this.state.running) {
        this.start();
      }
    });

    // Full Map UI Click Listeners
    if (this.ui.miniMapContainer) {
      this.ui.miniMapContainer.addEventListener('click', () => {
        this.toggleFullMap();
      });
    }

    if (this.ui.miniMapExpandBtn) {
      this.ui.miniMapExpandBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleFullMap(true);
      });
    }

    if (this.ui.fullMapCloseBtn) {
      this.ui.fullMapCloseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleFullMap(false);
      });
    }

    if (this.ui.fullMapFogToggleBtn) {
      this.ui.fullMapFogToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleRevealMap();
      });
    }

    if (this.ui.fullMapModal) {
      this.ui.fullMapModal.addEventListener('click', (e) => {
        if (e.target === this.ui.fullMapModal) {
          this.toggleFullMap(false);
        }
      });
    }
  }
}

// Instantiate central game driver when document is loaded
window.addEventListener('DOMContentLoaded', () => {
  window.game = new Game();
  
  // Expose global tab switcher
  window.switchTab = (tab) => {
    const contentIds = {
      briefing: 'briefingContent',
      storage: 'storageContent',
      loadout: 'loadoutContent'
    };
    if (!contentIds[tab]) return;
    Object.entries(contentIds).forEach(([key, id]) => {
      document.getElementById(id).style.display = key === tab ? 'block' : 'none';
    });
    document.querySelectorAll('.safehouse-tabs .tab-btn').forEach(button => {
      button.classList.toggle('active', button.dataset.tab === tab);
    });
  };
});

