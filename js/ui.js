/**
 * VOID SHIFT // RECOVERY OPERATIONS PROTOCOL
 * UI Manager (DOM Reference & Interface Controller)
 */

class UIManager {
  constructor() {
    // Canvas elements & context
    this.canvas = document.querySelector('#gameCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.visionCanvas = document.querySelector('#visionCanvas');
    this.visionCtx = this.visionCanvas.getContext('2d');
    this.miniMap = document.querySelector('#miniMap');
    this.miniCtx = this.miniMap.getContext('2d');
    this.miniMapContainer = document.querySelector('#miniMapContainer');
    this.miniMapExpandBtn = document.querySelector('#miniMapExpandBtn');
    this.miniMapSectorText = document.querySelector('#miniMapSectorText');

    // Full Tactical Map Modal Elements
    this.fullMapModal = document.querySelector('#fullMapModal');
    this.fullMapCanvas = document.querySelector('#fullMapCanvas');
    this.fullMapCtx = this.fullMapCanvas ? this.fullMapCanvas.getContext('2d') : null;
    this.fullMapCloseBtn = document.querySelector('#fullMapCloseBtn');
    this.fullMapFogToggleBtn = document.querySelector('#fullMapFogToggleBtn');
    this.fullMapScaleTag = document.querySelector('#fullMapScaleTag');
    this.fullMapExploreTag = document.querySelector('#fullMapExploreTag');
    this.fullMapTerminalsTag = document.querySelector('#fullMapTerminalsTag');
    this.fullMapEvacTag = document.querySelector('#fullMapEvacTag');

    // Containers and frames
    this.frame = document.querySelector('#gameFrame');
    this.startButton = document.querySelector('#startButton');
    this.prompt = document.querySelector('#centerPrompt');
    this.missionTitle = document.querySelector('#missionTitle');
    this.contractState = document.querySelector('#contractState');
    this.logText = document.querySelector('#logText');
    this.clock = document.querySelector('#clock');
    this.predictedValue = document.querySelector('#predictedValue');
    this.missionState = document.querySelector('#missionState');
    this.resultTitle = document.querySelector('#resultTitle');
    this.toast = document.querySelector('#gameToast');
    this.damageFlash = document.querySelector('#damageFlash');
    this.hudOverlay = document.querySelector('#hudOverlay');
    this.hudOxygen = document.querySelector('#hudOxygen');
    this.hudHealth = document.querySelector('#hudHealth');
    this.hudAmmo = document.querySelector('#hudAmmo');
    this.hudNoise = document.querySelector('#hudNoise');

    // Telemetry Gauges
    this.oxygenBar = document.querySelector('#oxygenBar');
    this.oxygenText = document.querySelector('#oxygenText');
    this.healthBar = document.querySelector('#healthBar');
    this.healthText = document.querySelector('#healthText');
    this.staminaBar = document.querySelector('#staminaBar');
    this.staminaText = document.querySelector('#staminaText');
    this.noiseBar = document.querySelector('#noiseBar');
    this.noiseText = document.querySelector('#noiseText');

    // Stat readings
    this.lootValueText = document.querySelector('#lootValue');
    this.lootCountText = document.querySelector('#lootCount');
    this.extractStatusText = document.querySelector('#extractStatus');
    this.threatStatusText = document.querySelector('#threatStatus');
    this.weaponStatusText = document.querySelector('#weaponStatus');
    this.ammoStatusText = document.querySelector('#ammoStatus');
    this.terminalsStatusText = document.querySelector('#terminalsStatus');
    this.hudTerminals = document.querySelector('#hudTerminals');

    // QTE Terminal UI Elements
    this.qteOverlay = document.querySelector('#qteOverlay');
    this.qteTitle = document.querySelector('#qteTitle');
    this.qteSequence = document.querySelector('#qteSequence');
    this.qteStatus = document.querySelector('#qteStatus');
    this.qteTimerBar = document.querySelector('#qteTimerBar');
    this.qteTimerText = document.querySelector('#qteTimerText');

    // Facility Scale Selector Elements
    this.scaleButtons = {
      small: document.querySelector('#scaleBtnSmall'),
      medium: document.querySelector('#scaleBtnMedium'),
      large: document.querySelector('#scaleBtnLarge')
    };
    this.currentScaleText = document.querySelector('#currentScaleText');
    this.quotaDisplay = document.querySelector('#quotaValue');
    this.hunterSettingInputs = {
      hunters: document.querySelector('#hunterInitialCount'),
      hunterSpawnInterval: document.querySelector('#hunterRespawnInterval'),
      hunterRespawnCount: document.querySelector('#hunterRespawnCount'),
      hunterMaxHp: document.querySelector('#hunterMaxHp')
    };
    this.resetHunterSettingsButton = document.querySelector('#resetHunterSettings');
    this.difficultyButtons = {
      easy: document.querySelector('#difficultyEasy'),
      medium: document.querySelector('#difficultyMedium'),
      hard: document.querySelector('#difficultyHard')
    };
    this.currentDifficultyText = document.querySelector('#currentDifficultyText');
    this.loadoutButtons = {
      pistol: document.querySelector('#loadoutPistol'),
      smg: document.querySelector('#loadoutSmg')
    };

    this.toastTimeout = null;
  }

  /**
   * Updates facility scale selector button active states and display text
   */
  updateScaleButtons(scaleKey) {
    const scaleConfig = (Config.mapScales && Config.mapScales[scaleKey]) || { label: '小型 (12 舱)', quota: 420 };
    if (this.currentScaleText) {
      this.currentScaleText.textContent = scaleConfig.label;
    }
    if (this.quotaDisplay) {
      this.quotaDisplay.textContent = `¥ ${scaleConfig.quota}`;
    }
    if (this.scaleButtons) {
      Object.keys(this.scaleButtons).forEach(key => {
        const btn = this.scaleButtons[key];
        if (btn) {
          btn.classList.toggle('active', key === scaleKey);
        }
      });
    }
  }

  updateHunterSettings(settings, disabled = false) {
    Object.entries(this.hunterSettingInputs).forEach(([key, input]) => {
      if (!input) return;
      input.value = settings[key];
      input.disabled = disabled;
    });
    if (this.resetHunterSettingsButton) {
      this.resetHunterSettingsButton.disabled = disabled;
    }
  }

  updateDifficultyPreset(selectedDifficulty, disabled = false) {
    Object.entries(this.difficultyButtons).forEach(([difficultyId, button]) => {
      if (!button) return;
      button.classList.toggle('active', difficultyId === selectedDifficulty);
      button.disabled = disabled;
    });
    if (this.currentDifficultyText) {
      const preset = Config.difficultyPresets[selectedDifficulty];
      this.currentDifficultyText.textContent = preset ? preset.label : '自定义';
    }
  }

  updateLoadout(selectedWeapon, disabled = false) {
    Object.entries(this.loadoutButtons).forEach(([weaponId, button]) => {
      if (!button) return;
      button.classList.toggle('active', weaponId === selectedWeapon);
      button.disabled = disabled;
    });
  }

  updateWeaponReadout(player) {
    const reloading = player.reloading > 0;
    this.ammoStatusText.textContent = reloading ? '换弹中' : `${player.ammo} / ${player.reserveAmmo}`;
    this.hudAmmo.textContent = `AMMO: ${reloading ? 'RELOADING' : `${player.ammo} / ${player.reserveAmmo}`}`;
    this.weaponStatusText.textContent = reloading
      ? `${player.weapon.label} / 换弹中`
      : player.shootCooldown > 0
        ? `${player.weapon.label} / 冷却 ${player.shootCooldown.toFixed(1)}s`
        : `${player.weapon.label} / 就绪`;
    this.weaponStatusText.className = player.shootCooldown > 0 || reloading ? 'warning' : 'ok';
  }

  /**
   * Updates test reveal map buttons in sidebar, HUD and Full Map modal
   */
  updateRevealBtnState(active) {
    const b1 = document.getElementById('testRevealBtn');
    const b2 = document.getElementById('hudRevealBtn');
    const b3 = document.getElementById('fullMapFogToggleBtn');
    const t1 = document.getElementById('testRevealText');
    if (b1) b1.classList.toggle('active', !!active);
    if (b2) {
      b2.classList.toggle('active', !!active);
      b2.textContent = active ? '👁 迷雾已关' : '👁 迷雾开关';
    }
    if (b3) {
      b3.classList.toggle('active', !!active);
      b3.textContent = active ? '👁 迷雾已关' : '👁 迷雾开关';
    }
    if (t1) {
      t1.textContent = active ? '调试：迷雾已关 (点击恢复)' : '调试：全图揭示 / 迷雾切换';
    }
  }

  /**
   * Displays or hides the full-screen tactical facility map modal
   */
  setFullMapVisible(visible) {
    if (!this.fullMapModal) return;
    if (visible) {
      this.fullMapModal.style.display = 'flex';
      this.fullMapModal.classList.remove('hidden');
      // Resize fullMapCanvas to wrapper dimensions
      this.resizeFullMapCanvas();
    } else {
      this.fullMapModal.style.display = 'none';
      this.fullMapModal.classList.add('hidden');
    }
  }

  /**
   * Adjusts fullMapCanvas internal resolution to match container bounding box
   */
  resizeFullMapCanvas() {
    if (!this.fullMapCanvas) return;
    const wrap = this.fullMapCanvas.parentElement;
    if (!wrap) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = wrap.getBoundingClientRect();
    const w = rect.width || 800;
    const h = rect.height || 500;
    this.fullMapCanvas.width = w * dpr;
    this.fullMapCanvas.height = h * dpr;
    if (this.fullMapCtx) {
      this.fullMapCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  /**
   * Updates tactical readout header on the full map modal
   */
  updateFullMapStats(mapManager, gameState) {
    if (!this.fullMapModal || this.fullMapModal.classList.contains('hidden')) return;
    const totalRooms = mapManager.worldRooms.length;
    const discovered = mapManager.worldRooms.filter(r => r.discovered).length;
    const percent = Math.round((discovered / totalRooms) * 100);

    if (this.fullMapScaleTag) {
      const scaleKey = Config.currentScale || 'small';
      const label = Config.mapScales && Config.mapScales[scaleKey] ? Config.mapScales[scaleKey].label : `${totalRooms} 舱`;
      this.fullMapScaleTag.textContent = `规模: ${label}`;
    }
    if (this.fullMapExploreTag) {
      this.fullMapExploreTag.textContent = `探索度: ${discovered}/${totalRooms} (${percent}%)`;
    }
    if (this.fullMapTerminalsTag) {
      const solved = gameState.solvedTerminals || 0;
      const total = mapManager.terminals ? mapManager.terminals.length : 3;
      this.fullMapTerminalsTag.textContent = `安全终端: ${solved}/${total}`;
      this.fullMapTerminalsTag.style.color = (solved >= total) ? '#d7f36b' : '#f5a623';
      this.fullMapTerminalsTag.style.borderColor = (solved >= total) ? '#d7f36b' : '#f5a623';
    }
    if (this.fullMapEvacTag) {
      const isReady = (gameState.solvedTerminals || 0) >= (mapManager.terminals ? mapManager.terminals.length : 3);
      this.fullMapEvacTag.textContent = isReady ? '撤离舱: 舱门就绪 (可撤离)' : '撤离舱: 锁定中 (需破译全部终端)';
      this.fullMapEvacTag.style.color = isReady ? '#d7f36b' : '#e8754e';
    }
  }

  /**
   * Appends a log line to the diagnostic field log
   */
  log(message) {
    this.logText.textContent = `> ${message}`;
  }

  /**
   * Displays a temporary middle-screen alert overlay
   */
  showToast(message) {
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
    }
    this.toast.textContent = message;
    this.toast.classList.add('show');
    this.toastTimeout = setTimeout(() => {
      this.toast.classList.remove('show');
    }, 1500);
  }

  /**
   * Trigger a damage/impact screen flash effect
   */
  triggerDamageFlash(opacity = 0.75, duration = 130) {
    this.damageFlash.style.transition = 'none';
    this.damageFlash.style.opacity = opacity;
    
    // Force a reflow
    this.damageFlash.offsetHeight;

    this.damageFlash.style.transition = `opacity ${duration}ms ease-out`;
    this.damageFlash.style.opacity = '0';
  }

  /**
   * Configures canvas sizes and calculates scaling factor on window resize
   */
  resize(viewW, viewH) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const rect = this.frame.getBoundingClientRect();
    const w = rect.width || viewW;
    const h = rect.height || viewH;

    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.visionCanvas.width = w * dpr;
    this.visionCanvas.height = h * dpr;
    this.miniMap.width = 176 * dpr;
    this.miniMap.height = 176 * dpr;

    this.canvas.style.position = 'absolute';
    this.canvas.style.inset = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';

    this.visionCanvas.style.position = 'absolute';
    this.visionCanvas.style.inset = '0';
    this.visionCanvas.style.zIndex = '2';
    this.visionCanvas.style.pointerEvents = 'none';
    this.visionCanvas.style.width = '100%';
    this.visionCanvas.style.height = '100%';

    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.visionCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.miniCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.resizeFullMapCanvas();

    return { rect, dpr };
  }

  /**
   * Resets all UI states and buttons to wait for diving
   */
  updateResetState() {
    this.startButton.disabled = false;
    this.startButton.innerHTML = '开始下潜 <b>↘</b>';
    this.prompt.style.display = 'grid';
    this.missionTitle.textContent = '等待下潜';
    this.contractState.textContent = '通讯稳定';
    this.missionState.textContent = '未开始';
    this.resultTitle.textContent = '今晚的账单还没写完';
    this.extractStatusText.textContent = '等待呼叫';
    this.extractStatusText.className = '';
    this.threatStatusText.textContent = '未知';
    this.threatStatusText.className = 'warning';
    this.oxygenText.style.color = '';
    this.updateTerminalsStatus(0, 3);
    this.hideQTE();
    if (this.scaleButtons) {
      Object.values(this.scaleButtons).forEach(btn => { if (btn) btn.disabled = false; });
    }
  }

  /**
   * Updates terminal override completion counters
   */
  updateTerminalsStatus(solved, total = 3) {
    const text = `${solved} / ${total}`;
    if (this.terminalsStatusText) {
      this.terminalsStatusText.textContent = text;
      this.terminalsStatusText.style.color = solved >= total ? 'var(--acid)' : '#f5a623';
    }
    if (this.hudTerminals) {
      this.hudTerminals.textContent = `CONSOLES: ${solved} / ${total}`;
      this.hudTerminals.style.color = solved >= total ? 'var(--acid)' : '#f5a623';
    }
  }

  /**
   * Displays the interactive QTE sequence interface
   */
  showQTE(terminal, currentIndex = 0, failed = false, failCount = 0, maxFails = 3) {
    if (!this.qteOverlay) return;
    this.qteOverlay.style.display = 'flex';
    if (this.qteTitle) {
      this.qteTitle.textContent = `安全控制台 #${terminal.id} // 紧急重写协议`;
    }
    if (this.qteSequence) {
      this.qteSequence.innerHTML = '';
      terminal.sequence.forEach((key, idx) => {
        const step = document.createElement('div');
        step.className = 'qte-step';
        step.textContent = key;
        if (idx < currentIndex) {
          step.classList.add('passed');
        } else if (idx === currentIndex) {
          step.classList.add(failed ? 'failed' : 'active');
        }
        this.qteSequence.appendChild(step);
      });
    }
    if (this.qteStatus) {
      if (failed) {
        this.qteStatus.textContent = `>> 错误 (${failCount}/${maxFails})！全舰警报已被触发！重新同步中...`;
        this.qteStatus.style.color = 'var(--rust)';
      } else if (currentIndex >= terminal.sequence.length) {
        this.qteStatus.textContent = '>> 认证通过！控制权限已重写！';
        this.qteStatus.style.color = 'var(--acid)';
      } else {
        const failNotice = failCount > 0 ? ` [累计失误: ${failCount}/${maxFails}]` : '';
        this.qteStatus.textContent = `>> 请输入序列第 ${currentIndex + 1} 位: [ ${terminal.sequence[currentIndex]} ]${failNotice}`;
        this.qteStatus.style.color = failCount > 1 ? '#f5a623' : 'var(--cyan)';
      }
    }
  }

  /**
   * Updates QTE countdown timer visual bar and clock text
   */
  updateQTETimer(timeLeft, maxTime = 10.0) {
    if (!this.qteTimerBar || !this.qteTimerText) return;
    const ratio = Math.max(0, Math.min(1, timeLeft / maxTime));
    this.qteTimerBar.style.width = `${ratio * 100}%`;
    this.qteTimerBar.classList.toggle('critical', timeLeft < 3.0);
    this.qteTimerText.textContent = `${Math.max(0, timeLeft).toFixed(1)}s`;
    this.qteTimerText.style.color = timeLeft < 3.0 ? '#ef4444' : '#f5a623';
  }

  /**
   * Hides the QTE sequence interface
   */
  hideQTE() {
    if (this.qteOverlay) {
      this.qteOverlay.style.display = 'none';
    }
  }

  /**
   * Configures UI states when starting a mission run
   */
  updateStartState() {
    this.prompt.style.display = 'none';
    this.hudOverlay.style.display = 'flex';
    this.startButton.disabled = true;
    this.startButton.textContent = '任务进行中';
    this.missionTitle.textContent = '探索中';
    this.missionState.textContent = '进行中';
    this.contractState.textContent = '正在下潜';
    if (this.scaleButtons) {
      Object.values(this.scaleButtons).forEach(btn => { if (btn) btn.disabled = true; });
    }
    this.log('舱门关闭。祝你带够氧气。');
  }

  /**
   * Configures UI states when calling the extraction beacon
   */
  updateExtractionCalledState() {
    this.extractStatusText.textContent = '已呼叫 / 30秒';
    this.extractStatusText.className = 'warning';
    this.contractState.textContent = '撤离信标已激活';
    this.missionTitle.textContent = '撤离舱已呼叫';
    this.log('撤离舱收到信号。回到入口。');
    this.showToast('撤离信标已激活');
  }

  /**
   * Configures UI states on mission complete/fail
   */
  updateFinishState(success) {
    this.startButton.disabled = false;
    this.startButton.innerHTML = '重新下潜 <b>↘</b>';
    this.hudOverlay.style.display = 'none';
    if (this.scaleButtons) {
      Object.values(this.scaleButtons).forEach(btn => { if (btn) btn.disabled = false; });
    }
    this.missionState.textContent = success ? '已撤离' : '任务失败';
    this.missionTitle.textContent = success ? '安全返回' : '信号中断';
    this.contractState.textContent = success ? '回收完成' : '通讯丢失';
    this.resultTitle.textContent = success ? '带着战利品回家' : '这趟没有人来接你';

    this.prompt.style.display = 'grid';
    this.prompt.querySelector('strong').textContent = success ? '任务完成' : '任务失败';
    this.prompt.querySelector('small').textContent = success ? '点击左侧按钮开始下一轮' : '重新下潜，再试一次';

    this.log(success ? '舱门已锁定。结算数据上传中。' : '生命体征丢失。');
  }

  /**
   * Redraws gauge statistics based on updated game states
   */
  update(gameState, player, monster) {
    this.oxygenBar.style.width = `${Math.max(0, gameState.oxygen)}%`;
    this.oxygenText.textContent = `${Math.max(0, Math.ceil(gameState.oxygen))}%`;
    this.hudOxygen.textContent = `O2: ${Math.ceil(gameState.oxygen)}%`;

    if (gameState.oxygen < 25) {
      this.oxygenText.style.color = 'var(--rust)';
      this.hudOxygen.style.color = 'var(--rust)';
    } else {
      this.oxygenText.style.color = '';
      this.hudOxygen.style.color = '';
    }

    this.healthBar.style.width = `${Math.max(0, gameState.health)}%`;
    this.healthText.textContent = `${Math.max(0, Math.ceil(gameState.health))}%`;
    this.hudHealth.textContent = `HP: ${Math.ceil(gameState.health)}%`;

    this.staminaBar.style.width = `${Math.max(0, gameState.stamina)}%`;
    this.staminaText.textContent = `${Math.max(0, Math.ceil(gameState.stamina))}%`;

    this.noiseBar.style.width = `${Math.max(5, gameState.noise)}%`;
    this.noiseText.textContent = gameState.noise > 70 ? '危险' : gameState.noise > 30 ? '注意' : '安静';
    if (this.hudNoise) this.hudNoise.textContent = `NOISE: ${gameState.noise > 70 ? '高' : gameState.noise > 30 ? '注意' : '静'}`;

    if (this.lootValueText) this.lootValueText.textContent = `¥ ${gameState.lootValue}`;
    if (this.lootCountText) this.lootCountText.textContent = `${gameState.loot} / 6`;
    if (this.predictedValue) this.predictedValue.textContent = `¥ ${gameState.lootValue}`;

    const totalSeconds = Math.max(0, Math.floor(gameState.elapsed || 0));
    const mins = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const secs = String(totalSeconds % 60).padStart(2, '0');
    this.clock.textContent = `${mins}:${secs}`;

    this.threatStatusText.textContent = monster.alerted ? '已锁定' : monster.active ? '脱战' : '未知';
    this.threatStatusText.className = monster.alerted ? 'warning' : 'ok';

    this.updateWeaponReadout(player);
  }
}
