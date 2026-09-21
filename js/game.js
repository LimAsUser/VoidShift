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
      hunterSpawnTimer: (Config.mapScales[Config.currentScale] && Config.mapScales[Config.currentScale].hunterSpawnInterval) || 20,
      hunterSpawnIndex: 0,
      extractionCalled: false,
      extracted: false,
      activeQte: null,
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
      lastJumpscareTime: 0
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
      hunterSpawnTimer: (Config.mapScales[Config.currentScale] && Config.mapScales[Config.currentScale].hunterSpawnInterval) || 20,
      hunterSpawnIndex: 0,
      extractionCalled: false,
      extracted: false,
      activeQte: null,
      fullMapOpen: false,
      qteMonsterTpCooldown: 0,
      mouseX: 0,
      mouseY: 0,
      lastTime: 0,
      lastJumpscareTime: 0
    });
    this.state.keys = {};
    if (this.ui.setFullMapVisible) {
      this.ui.setFullMapVisible(false);
    }

    this.map.reset(Config.currentScale);
    this.player.reset(this.map);
    this.monster.reset(this.map);
    this.hunters = this._createHunters();
    this.hunters.forEach(h => h.reset(this.map));

    this.ui.updateResetState();
    this.ui.updateScaleButtons(Config.currentScale);
    this.ui.updateTerminalsStatus(0, this.map.terminals.length);
    
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

    this.ui.updateScaleButtons(scaleKey);
    this.map.reset(scaleKey);
    this.player.reset(this.map);
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

    this.state.completed = false; 
    this.state.running = true; 
    document.body.classList.add("in-dive");
    this.handleResize();
    
    this.ui.updateStartState();

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
    const count = (Config.mapScales[Config.currentScale] && Config.mapScales[Config.currentScale].hunters) || 3;
    return Array.from({ length: count }, (_, i) => new Hunter(i));
  }

  activateHunter(hunter, reason) {
    const activation = hunter.activate(this.player.x, this.player.y, reason, this.audio, this.map, this.player.angle);
    if (activation) {
      this.ui.log(reason);
      this.ui.showToast('金属脚步声正在接近...');
    }
  }

  /**
   * Concludes the exploration run with a final report status
   */
  finish(success) {
    this.state.running = false; 
    this.state.completed = true; 
    document.body.classList.remove("in-dive");
    this.handleResize();
    
    this.state.extracted = success;
    this.state.activeQte = null;
    this.ui.hideQTE();

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
  }

  updateMoneyUI() {
    document.getElementById('moneyDisplay').textContent = `¥ ${this.state.money}`;
  }

  updateInventoryUI() {
    const grid = document.getElementById('inventoryGrid');
    const descBox = document.getElementById('itemDesc');
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
      if (item.slot !== undefined && item.slot < slots.length) {
        const slot = slots[item.slot];
        if (slot) {
          slot.textContent = (item.name ? item.name.charAt(0) : '?');
          slot.style.borderColor = 'var(--acid)';
          slot.style.backgroundColor = 'var(--panel-2)';
          slot.style.color = 'var(--acid)';
          slot.style.cursor = 'pointer';
          slot.onclick = () => {
            if (descBox) {
              descBox.textContent = `${item.name}: ${item.desc || '一件在旧星舰废墟中发现的珍贵物资，回收价值很高。'}`;
            }
          };
        }
      }
    });
  }

  sortInventory() {
    this.state.inventory.sort((a, b) => (b.value || 0) - (a.value || 0));
    // Re-assign slots sequentially
    this.state.inventory.forEach((item, index) => {
      item.slot = index;
    });
    this.updateInventoryUI();
    this.ui.showToast('背包道具已按回收价值降序重排');
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
      } else {
        this.ui.log('枪声在走廊里回响。');
        this.ui.showToast('未命中');
      }

    // Hunter hit detection (check all hunters, nearest hit wins)
    if (result.fired) {
      const startX = this.player.x;
      const startY = this.player.y;
      const angle = result.shotAngle;
      const wallDist = this.map.rayWallDistance(startX, startY, Math.cos(angle), Math.sin(angle), 650);
      this.hunters.forEach(h => {
        if (!h.active || h.dead) return;
        const toHA = Math.atan2(h.y - startY, h.x - startX);
        const hDist = Math.hypot(h.x - startX, h.y - startY);
        const angleDiff = Math.abs(((toHA - angle) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
        if (angleDiff < 0.18 && hDist < wallDist + h.radius + 12 && hDist < result.traceLength) {
          const hitResult = h.registerHit();
          if (hitResult.hit) {
            result.traceLength = hDist;
            if (hitResult.dead) {
              this.ui.showToast('猎手已被击毙！');
              this.ui.log('威胁消除：猎手生命体已击毙。');
              this.audio.playSpatialTone(55, 0.3, 0.6, 'sawtooth', 0, 1, false);
            } else {
              this.ui.showToast(`猎手受创 (${hitResult.hpLeft}/3)`);
              this.audio.playSpatialTone(120, 0.15, 0.2, 'square', 0, 1, false);
            }
          }
        }
      });
    }
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
    // Timer-based hunter spawning: one at a time, not near player
    if (this.state.hunterSpawnIndex < this.hunters.length) {
      this.state.hunterSpawnTimer -= dt;
      if (this.state.hunterSpawnTimer <= 0) {
        // Find next un-activated hunter that is far from the player
        let spawned = false;
        const scaleConf = Config.mapScales[Config.currentScale];
        const interval = (scaleConf && scaleConf.hunterSpawnInterval) || 30;
        for (let i = this.state.hunterSpawnIndex; i < this.hunters.length; i++) {
          const h = this.hunters[i];
          if (!h.active && !h.dead) {
            const spawnDist = Math.hypot(h.x - this.player.x, h.y - this.player.y);
            if (spawnDist > 350 || this.map.monsterSpawns.length === 0) {
              this.activateHunter(h, `设施深处传来稳定的踏步声。`);
              this.state.hunterSpawnIndex = i + 1;
              this.state.hunterSpawnTimer = interval;
              spawned = true;
              break;
            }
          }
        }
        if (!spawned) {
          this.state.hunterSpawnTimer = 5;
        }
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
        this.ui.triggerDamageFlash(0.75, 130);
        this.player.health -= 18;
        this.player.oxygen -= 8;
        this.player.noise = 100;
        this.ui.log('警告：未知生命体接触！');
        this.audio.playSound('resources/injured-140224.mp3', 0.8);
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

      if (key === 'f') this.player.flashlight = !this.player.flashlight;
      if (key === 'e') this.interact();
      if (key === 'r') this.player.reload(this.audio); // Only R for reload
      if (key === 'x') this.callExtraction(); // X for extraction
      if (key === 'b') {
        const inv = document.getElementById('inventoryOverlay');
        inv.style.display = (inv.style.display === 'none' || inv.style.display === '') ? 'block' : 'none';
        if (inv.style.display === 'block') this.updateInventoryUI();
      }
      if (key === 'm') this.toggleFullMap();
      
      // Removed Space key firing: Fire is strictly restricted to M1 (Mouse left click)
      if ((e.key === 'Enter' || e.code === 'Space') && !this.state.running) {
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

    const fireIfAllowed = () => {
      const now = performance.now();
      if (now - lastM1FireTime < 60) return; // Debounce multi-event triggers
      lastM1FireTime = now;

      if (!this.state.running) {
        this.start();
        return;
      }
      if (this.state.fullMapOpen) return; // Disallow firing while viewing full tactical map
      if (this.state.activeQte) return; // Disallow firing while operating security console
      if (this.player.stunned > 0) return; // Disallow firing while stunned
      this.shoot();
    };

    const updateMouseButtons = (e) => {
      if (typeof e.buttons === 'number') {
        const leftNow = (e.buttons & 1) !== 0;
        const rightNow = (e.buttons & 2) !== 0;

        // Detect Left Click button press edge (transition from false to true)
        if (leftNow && !isLeftDown) {
          fireIfAllowed();
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
      if (e.target && (e.target.tagName === 'BUTTON' || e.target.closest('button'))) {
        return;
      }
      if (e.button === 0) {
        e.preventDefault();
        isLeftDown = true;
        fireIfAllowed();
      } else if (e.button === 2) {
        e.preventDefault();
        isRightDown = true;
        this.setStableAim(true);
      }
    });

    window.addEventListener('mouseup', e => {
      if (e.button === 0) {
        isLeftDown = false;
      } else if (e.button === 2) {
        isRightDown = false;
        this.setStableAim(false);
      }
      updateMouseButtons(e);
    });

    window.addEventListener('pointerdown', e => {
      if (e.target && (e.target.tagName === 'BUTTON' || e.target.closest('button'))) {
        return;
      }
      if (e.button === 0) {
        isLeftDown = true;
        fireIfAllowed();
      } else if (e.button === 2) {
        isRightDown = true;
        this.setStableAim(true);
      }
    });

    window.addEventListener('pointerup', e => {
      if (e.button === 0) {
        isLeftDown = false;
      } else if (e.button === 2) {
        isRightDown = false;
        this.setStableAim(false);
      }
      updateMouseButtons(e);
    });

    window.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('dragstart', e => e.preventDefault());
    
    // Unlock AudioContext on first user gesture
    window.addEventListener('pointerdown', () => this.audio.ensureAudio(), { passive: true });
    window.addEventListener('keydown', () => this.audio.ensureAudio(), { passive: true });

    this.ui.startButton.addEventListener('click', () => {
      this.audio.ensureAudio();
      if (!this.state.running) {
        this.start();
      }
    });

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
    document.getElementById('briefingContent').style.display = tab === 'briefing' ? 'block' : 'none';
    document.getElementById('storageContent').style.display = tab === 'storage' ? 'block' : 'none';
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.textContent === (tab === 'briefing' ? '简报' : '仓库')));
  };
});

