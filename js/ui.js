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
    this.fullMapTerminals = document.querySelector('#fullMapTerminals');
    this.fullMapEvacTag = document.querySelector('#fullMapEvacTag');
    this.fullMapZoomOutBtn = document.querySelector('#fullMapZoomOutBtn');
    this.fullMapZoomInBtn = document.querySelector('#fullMapZoomInBtn');
    this.fullMapFitBtn = document.querySelector('#fullMapFitBtn');

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
    this.hudAmmo = document.querySelector('#hudAmmo');
    this.hudNoise = document.querySelector('#hudNoise');
    this.hudWeaponStatus = document.querySelector('#hudWeaponStatus');
    this.hudExtractStatus = document.querySelector('#hudExtractStatus');

    // Telemetry Gauges
    this.oxygenBar = document.querySelector('#hudOxygenBar');
    this.oxygenMeter = document.querySelector('#hudOxygenMeter');
    this.oxygenText = document.querySelector('#oxygenText');
    this.healthBar = document.querySelector('#hudHealthBar');
    this.healthMeter = document.querySelector('#hudHealthMeter');
    this.healthText = document.querySelector('#healthText');
    this.staminaBar = document.querySelector('#hudStaminaBar');
    this.staminaMeter = document.querySelector('#hudStaminaMeter');
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
    this.settingsModal = document.querySelector('#hunterSettingsModal');
    this.settingsOpenButton = document.querySelector('#hunterSettingsOpen');
    this.settingsCloseButton = document.querySelector('#hunterSettingsClose');
    this.settingsSectionButtons = Array.from(document.querySelectorAll('[data-settings-section]'));
    this.fpsCapSelect = document.querySelector('#fpsCapSelect');
    this.hunterSettingInputs = Array.from(document.querySelectorAll('[data-hunter-setting]'));
    this.finalTerminalSettingInputs = {
      finalTerminalSpawnCount: document.querySelector('#finalTerminalSpawnCount'),
      finalTerminalSpawnInterval: document.querySelector('#finalTerminalSpawnInterval')
    };
    this.resetHunterSettingsButton = document.querySelector('#resetHunterSettings');
    this.difficultyButtons = {
      easy: document.querySelector('[data-difficulty="easy"]'),
      medium: document.querySelector('[data-difficulty="medium"]'),
      hard: document.querySelector('[data-difficulty="hard"]')
    };
    this.currentDifficultyText = document.querySelector('#currentDifficultyText');
    this.difficultyModified = document.querySelector('#difficultyModified');
    this.difficultyAmmoLossWarning = document.querySelector('#difficultyAmmoLossWarning');
    this.launchAmmoLossWarning = document.querySelector('#launchAmmoLossWarning');
    this.loadoutCards = Object.fromEntries(
      Object.keys(Config.weapons).map(weaponId => [weaponId, document.querySelector(`#loadout${weaponId[0].toUpperCase()}${weaponId.slice(1)}`)])
    );
    this.loadoutPurchaseButtons = Object.fromEntries(
      Object.keys(Config.weapons).map(weaponId => [weaponId, document.querySelector(`#purchase${weaponId[0].toUpperCase()}${weaponId.slice(1)}`)])
    );
    this.loadoutEquipButtons = Object.fromEntries(
      Object.keys(Config.weapons).map(weaponId => [weaponId, document.querySelector(`#equip${weaponId[0].toUpperCase()}${weaponId.slice(1)}`)])
    );
    this.standardAmmoBalance = document.querySelector('#standardAmmoBalance');
    this.ammoPurchaseAmount = document.querySelector('#ammoPurchaseAmount');
    this.ammoPurchaseButton = document.querySelector('#ammoPurchaseButton');
    this.ammoPurchaseCost = document.querySelector('#ammoPurchaseCost');
    this.ammoTransferSources = document.querySelector('#ammoTransferSources');
    this.ammoTransferTargets = document.querySelector('#ammoTransferTargets');
    this.ammoTransferAmountLabel = document.querySelector('#ammoTransferAmountLabel');
    this.ammoTransferAmount = document.querySelector('#ammoTransferAmount');
    this.ammoTransferButton = document.querySelector('#ammoTransferButton');
    this.ammoTransferPreview = document.querySelector('#ammoTransferPreview');
    this.ammoStockGrid = document.querySelector('#ammoStockGrid');
    this.coopStatus = document.querySelector('#coopStatus');
    this.coopRoomCode = document.querySelector('#coopRoomCode');
    this.coopJoinCode = document.querySelector('#coopJoinCode');
    this.coopLobby = document.querySelector('#coopLobby');
    this.coopHostReady = document.querySelector('#coopHostReady');
    this.coopGuestReady = document.querySelector('#coopGuestReady');
    this.coopReadyButton = document.querySelector('#coopReadyButton');
    this.coopStartButton = document.querySelector('#coopStartButton');
    this.coopLeaveButton = document.querySelector('#coopLeaveButton');
    this.coopHostButton = document.querySelector('#coopHostButton');
    this.coopJoinButton = document.querySelector('#coopJoinButton');
    this.tutorialOverlay = document.querySelector('#tutorialOverlay');
    this.tutorialCard = document.querySelector('#tutorialCard');
    this.tutorialPractice = document.querySelector('#tutorialPractice');
    this.tutorialStepLabel = document.querySelector('#tutorialStepLabel');
    this.tutorialTitle = document.querySelector('#tutorialTitle');
    this.tutorialBody = document.querySelector('#tutorialBody');
    this.tutorialPracticeTitle = document.querySelector('#tutorialPracticeTitle');
    this.tutorialObjective = document.querySelector('#tutorialObjective');

    this.toastTimeout = null;
  }

  showTutorialCard(step, index, total) {
    if (!this.tutorialOverlay) return;
    this.tutorialOverlay.classList.remove('practice-mode');
    this.tutorialOverlay.hidden = false;
    this.tutorialCard.hidden = false;
    this.tutorialPractice.hidden = true;
    this.tutorialStepLabel.textContent = `GUIDED DESCENT // ${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
    this.tutorialTitle.textContent = step.title;
    this.tutorialBody.textContent = step.body;
  }

  showTutorialPractice(step) {
    if (!this.tutorialOverlay) return;
    this.tutorialOverlay.classList.add('practice-mode');
    this.tutorialOverlay.hidden = false;
    this.tutorialCard.hidden = true;
    this.tutorialPractice.hidden = false;
    this.tutorialPracticeTitle.textContent = step.title;
    this.tutorialObjective.textContent = step.objective;
  }

  hideTutorial() {
    if (this.tutorialOverlay) this.tutorialOverlay.hidden = true;
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

  updateHunterSettings(profile, disabled = false, modified = false) {
    this.hunterSettingInputs.forEach(input => {
      const setting = input.dataset.hunterSetting;
      const scale = input.dataset.scale;
      input.value = profile.maps[scale][setting];
      input.disabled = disabled;
    });
    Object.entries(this.finalTerminalSettingInputs).forEach(([key, input]) => {
      if (!input) return;
      input.value = profile[key];
      input.disabled = disabled;
    });
    if (this.resetHunterSettingsButton) {
      this.resetHunterSettingsButton.disabled = disabled;
    }
    if (this.difficultyModified) this.difficultyModified.hidden = !modified;
    if (this.currentDifficultyText) {
      const preset = Config.difficultyPresets[this.currentDifficultyText.dataset.difficulty || 'medium'];
      this.currentDifficultyText.textContent = `${preset ? preset.label : '中等'}${modified ? ' · 已修改' : ''}`;
    }
  }

  updateDifficultyPreset(selectedDifficulty, disabled = false, ammoLossWarning = '') {
    Object.entries(this.difficultyButtons).forEach(([difficultyId, button]) => {
      if (!button) return;
      button.classList.toggle('active', difficultyId === selectedDifficulty);
      button.disabled = disabled;
    });
    if (this.currentDifficultyText) {
      const preset = Config.difficultyPresets[selectedDifficulty];
      this.currentDifficultyText.dataset.difficulty = selectedDifficulty;
      this.currentDifficultyText.textContent = preset ? preset.label : '中等';
    }
    if (this.difficultyAmmoLossWarning) this.difficultyAmmoLossWarning.textContent = ammoLossWarning;
    if (this.launchAmmoLossWarning) this.launchAmmoLossWarning.textContent = ammoLossWarning;
  }

  showSettingsSection(sectionId) {
    this.settingsSectionButtons.forEach(button => {
      const active = button.dataset.settingsSection === sectionId;
      button.classList.toggle('active', active);
      document.getElementById(button.dataset.settingsSection).hidden = !active;
    });
  }

  updateFpsCap(fpsCap) {
    if (this.fpsCapSelect) this.fpsCapSelect.value = fpsCap;
  }

  updateLoadout(armory, disabled = false) {
    if (!armory) return;
    Object.entries(this.loadoutCards).forEach(([weaponId, card]) => {
      if (!card) return;
      const weapon = Config.weapons[weaponId];
      const owned = !!armory.ownedWeapons[weaponId];
      const equipped = weapon.slot === 'primary'
        ? armory.loadout.primary === weaponId
        : armory.loadout.sidearm === weaponId;
      card.classList.toggle('active', equipped);
      card.classList.toggle('locked', !owned);
      const purchase = this.loadoutPurchaseButtons[weaponId];
      const equip = this.loadoutEquipButtons[weaponId];
      if (purchase) {
        purchase.hidden = owned;
        purchase.disabled = disabled;
      }
      if (equip) {
        equip.hidden = !owned;
        equip.disabled = disabled || equipped;
        equip.textContent = equipped ? '已装备' : '装备';
      }
    });
  }

  updateAmmoDepot(armory, disabled = false, selection = { source: 'standard', target: 'pistol' }, preview = null) {
    if (!armory) return;
    if (this.standardAmmoBalance) this.standardAmmoBalance.textContent = armory.standardAmmoUnits.toLocaleString('en-US');
    if (this.ammoPurchaseAmount) this.ammoPurchaseAmount.disabled = disabled;
    if (this.ammoPurchaseButton) this.ammoPurchaseButton.disabled = disabled;
    if (this.ammoTransferAmount) this.ammoTransferAmount.disabled = disabled;
    if (this.ammoTransferButton) this.ammoTransferButton.disabled = disabled || !preview?.valid;

    const amount = Math.max(Config.ammo.unitsPerPurchase, Math.floor(Number(this.ammoPurchaseAmount?.value) || Config.ammo.unitsPerPurchase));
    const pricePerUnit = Config.ammo.pricePerPurchase / Config.ammo.unitsPerPurchase;
    if (this.ammoPurchaseCost) this.ammoPurchaseCost.textContent = `¥ ${Math.ceil(amount * pricePerUnit).toLocaleString('en-US')}`;

    const options = [{ id: 'standard', label: '标准弹药库', stock: armory.standardAmmoUnits }];
    Object.entries(Config.weapons).forEach(([weaponId, weapon]) => {
      if (armory.ownedWeapons[weaponId]) options.push({
        id: weaponId,
        label: weapon.label,
        stock: armory.weaponAmmo[weaponId].reserve
      });
    });
    const drawChoices = (container, kind, selectedId) => {
      if (!container) return;
      container.replaceChildren(...options.map(option => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ammo-choice-card';
        button.setAttribute('aria-pressed', String(option.id === selectedId));
        button.disabled = disabled;
        button.onclick = () => window.game?.selectAmmoTransfer(kind, option.id);
        if (option.id === 'standard') {
          const symbol = document.createElement('span');
          symbol.className = 'ammo-standard-icon';
          symbol.setAttribute('aria-hidden', 'true');
          symbol.textContent = '◈';
          button.appendChild(symbol);
        } else {
          const icon = this.loadoutCards[option.id]?.querySelector('.weapon-icon')?.cloneNode(true);
          if (icon) button.appendChild(icon);
        }
        const label = document.createElement('span');
        const name = document.createElement('span');
        const stock = document.createElement('strong');
        name.textContent = option.label;
        stock.textContent = this.formatAmmoStock(option);
        label.append(name, stock);
        button.appendChild(label);
        return button;
      }));
    };
    drawChoices(this.ammoTransferSources, 'source', selection.source);
    drawChoices(this.ammoTransferTargets, 'target', selection.target);
    if (this.ammoTransferAmountLabel) {
      this.ammoTransferAmountLabel.textContent = selection.source === 'standard'
        ? '转换数量（标准弹药单位）'
        : '转换数量（来源备弹发数）';
    }
    if (this.ammoTransferPreview) {
      const target = options.find(option => option.id === selection.target);
      const source = options.find(option => option.id === selection.source);
      let message = '';
      let invalid = !preview?.valid;
      if (!preview) {
        message = '选择来源、目标和数量后查看转换结果。';
      } else if (Number(this.ammoTransferAmount?.value) > preview.sourceAvailable) {
        message = `来源库存不足；当前可用 ${preview.sourceAvailable}。`;
      } else if (!preview.valid && preview.rounds === 0 && target?.id !== 'standard') {
        message = '数量不足以组成一发目标弹药，库存不会扣除。';
      } else if (preview.valid && target?.id === 'standard') {
        message = `转换后增加 ${preview.rounds} 标准弹药单位。`;
      } else if (preview.valid) {
        message = `从 ${source?.label} 扣除所选数量后，${target?.label}备弹增加 ${preview.rounds} 发；${preview.remainder} 标准单位留在弹药库。`;
      } else {
        message = '请选择不同的来源与目标，并输入有效数量。';
      }
      this.ammoTransferPreview.textContent = message;
      this.ammoTransferPreview.classList.toggle('invalid', invalid);
    }

    if (this.ammoStockGrid) {
      this.ammoStockGrid.replaceChildren(...Object.entries(Config.weapons).map(([weaponId, weapon]) => {
        const stock = armory.weaponAmmo[weaponId];
        const tile = document.createElement('div');
        tile.className = `ammo-stock-tile${armory.ownedWeapons[weaponId] ? '' : ' locked'}`;
        const icon = this.loadoutCards[weaponId]?.querySelector('.weapon-icon')?.cloneNode(true);
        if (icon) tile.appendChild(icon);
        const label = document.createElement('span');
        const quantity = document.createElement('strong');
        label.textContent = weapon.label;
        quantity.textContent = armory.ownedWeapons[weaponId] ? `${stock.magazine} / ${stock.reserve}` : '尚未购买';
        tile.append(label, quantity);
        return tile;
      }));
    }
  }

  formatAmmoStock(option) {
    return option.id === 'standard'
      ? `${option.stock} 单位`
      : `${option.stock} 发 · ${Config.ammo.standardUnitsPerRound[option.id]} 单位/发`;
  }

  updateWeaponReadout(player) {
    if (!player || !player.weapon) return;
    const reloading = player.reloading > 0;
    const slotLabel = player.activeSlot === 'primary' ? '主武器 [1]' : '副武器 [2]';
    const reloadText = player.weapon.reloadMode === 'shell'
      ? `逐发装填 ${player.ammo}/${player.weapon.maxAmmo}`
      : '换弹中';
    const weaponStatus = reloading
      ? `${slotLabel} / ${player.weapon.label} · ${reloadText}`
      : player.shootCooldown > 0
        ? `${slotLabel} / ${player.weapon.label} · 冷却 ${player.shootCooldown.toFixed(1)}s`
        : `${slotLabel} / ${player.weapon.label} · 就绪`;
    const ammoText = `${player.ammo} / ${player.reserveAmmo}`;
    if (this.ammoStatusText) this.ammoStatusText.textContent = reloading ? reloadText : ammoText;
    if (this.hudAmmo) this.hudAmmo.textContent = reloading ? reloadText : ammoText;
    if (this.weaponStatusText) {
      this.weaponStatusText.textContent = weaponStatus;
      this.weaponStatusText.className = player.shootCooldown > 0 || reloading ? 'warning' : 'ok';
    }
    if (this.hudWeaponStatus) {
      this.hudWeaponStatus.textContent = weaponStatus;
      this.hudWeaponStatus.className = player.shootCooldown > 0 || reloading ? 'warning' : '';
    }
  }

  updateCoopLobby(coop) {
    if (!this.coopStatus) return;
    this.coopStatus.textContent = coop.status || 'OFFLINE';
    this.coopRoomCode.textContent = coop.code || '------';
    this.coopLobby.hidden = !coop.role;
    this.coopHostReady.textContent = coop.role === 'host'
      ? (coop.localReady ? '已准备' : '未准备')
      : (coop.remoteReady ? '已准备' : '未准备');
    this.coopGuestReady.textContent = coop.connected
      ? (coop.role === 'guest'
        ? (coop.localReady ? '已准备' : '未准备')
        : (coop.remoteReady ? '已准备' : '未准备'))
      : '未连接';
    this.coopReadyButton.textContent = coop.localReady ? '取消准备' : '准备';
    this.coopReadyButton.disabled = !coop.connected || coop.running;
    this.coopStartButton.hidden = coop.role !== 'host';
    this.coopStartButton.disabled = !coop.connected || !coop.localReady || !coop.remoteReady || coop.running;
    this.coopLeaveButton.disabled = coop.running;
    this.coopHostButton.disabled = !!coop.role;
    this.coopJoinButton.disabled = !!coop.role;
    this.coopJoinCode.disabled = !!coop.role;
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

    this.frame.style.minHeight = '0';
    this.frame.style.flex = '0 0 auto';
    const frameWidth = this.frame.getBoundingClientRect().width;
    this.frame.style.height = `${frameWidth * viewH / viewW}px`;
    const rect = this.frame.getBoundingClientRect();

    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.visionCanvas.width = rect.width * dpr;
    this.visionCanvas.height = rect.height * dpr;
    this.miniMap.width = 176 * dpr;
    this.miniMap.height = 176 * dpr;

    this.canvas.style.position = 'absolute';
    this.canvas.style.inset = '0';
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;

    this.visionCanvas.style.position = 'absolute';
    this.visionCanvas.style.inset = '0';
    this.visionCanvas.style.zIndex = '2';
    this.visionCanvas.style.pointerEvents = 'none';
    this.visionCanvas.style.width = `${rect.width}px`;
    this.visionCanvas.style.height = `${rect.height}px`;

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
    if (this.hudExtractStatus) this.hudExtractStatus.textContent = this.extractStatusText.textContent;
    this.threatStatusText.textContent = '未知';
    this.threatStatusText.className = 'warning';
    this.oxygenText.style.color = '';
    this.hideQTE();
    if (this.scaleButtons) {
      Object.values(this.scaleButtons).forEach(btn => { if (btn) btn.disabled = false; });
    }
  }

  /**
   * Updates terminal override completion counters
   */
  renderTerminalIcons(container, terminals, allLit = false) {
    if (!container) return;
    const terminalList = Array.isArray(terminals) ? terminals : [];
    const signature = `${allLit ? 'all' : 'mission'}:${terminalList.map(terminal => terminal.solved ? '1' : '0').join('')}`;
    if (container.dataset.terminalState === signature) return;
    container.dataset.terminalState = signature;
    const svg = '<svg viewBox="0 0 16 16" aria-hidden="true" shape-rendering="crispEdges"><path d="M3 1h10v2h2v11h-2v1H3v-1H1V3h2z"/><path class="terminal-pixel-screen" d="M4 4h8v5H4z"/><path class="terminal-pixel-keys" d="M4 11h2v1H4zm3 0h2v1H7zm3 0h2v1h-2z"/></svg>';
    container.replaceChildren(...terminalList.map((terminal, index) => {
      const lit = allLit || !!terminal.solved;
      const icon = document.createElement('span');
      icon.className = `terminal-pixel-icon${lit ? ' lit' : ''}`;
      icon.setAttribute('role', 'img');
      icon.setAttribute('aria-label', `终端 ${index + 1}${lit ? '已激活' : '未激活'}`);
      icon.innerHTML = svg;
      return icon;
    }));
  }

  updateTerminalsStatus(terminals = [], allLit = false) {
    this.renderTerminalIcons(this.terminalsStatusText, terminals, true);
    this.renderTerminalIcons(this.hudTerminals, terminals, allLit);
    this.renderTerminalIcons(this.fullMapTerminals, terminals, allLit || !document.body.classList.contains('in-dive'));
  }

  /**
   * Displays the interactive QTE sequence interface
   */
  showQTE(terminal, currentIndex = 0, failed = false, failCount = 0, maxFails = 3) {
    if (!this.qteOverlay) return;
    this.qteOverlay.style.display = 'flex';
    if (this.qteTitle) {
      this.qteTitle.textContent = `终端 #${terminal.id} // 紧急激活协议`;
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
    if (this.hudExtractStatus) {
      this.hudExtractStatus.textContent = this.extractStatusText.textContent;
      this.hudExtractStatus.className = 'warning';
    }
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
    const meterValue = value => Math.max(0, Math.min(100, Number.isFinite(Number(value)) ? Number(value) : 0));
    const setMeter = (fill, meter, value) => {
      const amount = meterValue(value);
      if (fill) fill.style.width = `${amount}%`;
      if (meter) meter.setAttribute('aria-valuenow', String(Math.round(amount)));
    };

    setMeter(this.oxygenBar, this.oxygenMeter, gameState.oxygen);
    this.oxygenText.textContent = `${Math.max(0, Math.ceil(gameState.oxygen))}%`;
    setMeter(this.healthBar, this.healthMeter, gameState.health);
    this.healthText.textContent = `${Math.max(0, Math.ceil(gameState.health))}%`;
    setMeter(this.staminaBar, this.staminaMeter, gameState.stamina);
    this.staminaText.textContent = `${Math.max(0, Math.ceil(gameState.stamina))}%`;

    const noise = meterValue(gameState.noise);
    this.noiseBar.style.width = `${Math.max(5, noise)}%`;
    this.noiseText.textContent = noise > 70 ? '危险' : noise > 30 ? '注意' : '安静';
    this.hudNoise.style.setProperty('--noise-color', `hsl(${180 - noise * 1.8} 82% 55%)`);
    this.hudNoise.setAttribute('aria-label', `噪音：${noise > 70 ? '高' : noise > 30 ? '中' : '低'}`);

    this.lootValueText.textContent = `¥ ${gameState.lootValue}`;
    this.lootCountText.textContent = `${gameState.loot} / 6`;
    this.predictedValue.textContent = `¥ ${gameState.lootValue}`;

    const totalSeconds = Math.max(0, Math.floor(gameState.elapsed || 0));
    const mins = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const secs = String(totalSeconds % 60).padStart(2, '0');
    this.clock.textContent = `${mins}:${secs}`;

    this.threatStatusText.textContent = monster.alerted ? '已锁定' : monster.active ? '脱战' : '未知';
    this.threatStatusText.className = monster.alerted ? 'warning' : 'ok';
    if (this.hudExtractStatus) {
      this.hudExtractStatus.textContent = this.extractStatusText.textContent;
      this.hudExtractStatus.className = this.extractStatusText.className;
    }

    this.updateWeaponReadout(player);
  }
}
