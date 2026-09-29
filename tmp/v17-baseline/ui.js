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
    this.transactionNoticeStack = document.querySelector('#transactionNotices');
    this.damageFlash = document.querySelector('#damageFlash');
    this.hudOverlay = document.querySelector('#hudOverlay');
    this.hudAmmo = document.querySelector('#hudAmmo');
    this.hudSkillImage = document.querySelector('#hudSkillImage');
    this.hudSkillName = document.querySelector('#hudSkillName');
    this.hudSkillStatus = document.querySelector('#hudSkillStatus');
    this.hudOxygenCount = document.querySelector('#hudOxygenCount');
    this.hudMedkitCount = document.querySelector('#hudMedkitCount');
    this.coopHostLatency = document.querySelector('#coopHostLatency');
    this.hudFlashStun = document.querySelector('#hudFlashStun');
    this.hudNoise = document.querySelector('#hudNoise');
    this.hudWeaponStatus = document.querySelector('#hudWeaponStatus');
    this.hudExtractStatus = document.querySelector('#hudExtractStatus');
    this.hudNetworkStatus = document.querySelector('#hudNetworkStatus');

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
    this.descentTransition = document.querySelector('#descentTransition');
    this.descentTip = document.querySelector('#descentTip');
    this.settlementDialog = document.querySelector('#settlementDialog');
    this.settlementEyebrow = document.querySelector('#settlementEyebrow');
    this.settlementTitle = document.querySelector('#settlementTitle');
    this.settlementSubtitle = document.querySelector('#settlementSubtitle');
    this.settlementDifficulty = document.querySelector('#settlementDifficulty');
    this.settlementLootLabel = document.querySelector('#settlementLootLabel');
    this.settlementLootCount = document.querySelector('#settlementLootCount');
    this.settlementValueLabel = document.querySelector('#settlementValueLabel');
    this.settlementLootValue = document.querySelector('#settlementLootValue');
    this.settlementDuration = document.querySelector('#settlementDuration');
    this.settlementAmmoOutcome = document.querySelector('#settlementAmmoOutcome');
    this.settlementReturnButton = document.querySelector('#settlementReturnButton');
    this.pauseMenuDialog = document.querySelector('#pauseMenuDialog');
    this.pauseMenuNote = document.querySelector('#pauseMenuNote');
    this.pauseMenuStatus = document.querySelector('#pauseMenuStatus');
    this.pauseResumeButton = document.querySelector('#pauseResumeButton');
    this.pauseSettingsButton = document.querySelector('#pauseSettingsButton');
    this.pauseAbandonButton = document.querySelector('#pauseAbandonButton');
    this.abandonConfirmDialog = document.querySelector('#abandonConfirmDialog');
    this.abandonConfirmTitle = document.querySelector('#abandonConfirmTitle');
    this.abandonConfirmNote = document.querySelector('#abandonConfirmNote');
    this.abandonCancelButton = document.querySelector('#abandonCancelButton');
    this.abandonConfirmButton = document.querySelector('#abandonConfirmButton');
    this.settingsSectionButtons = Array.from(document.querySelectorAll('[data-settings-section]'));
    this.fpsCapSelect = document.querySelector('#fpsCapSelect');
    this.corpseLimitSelect = document.querySelector('#corpseLimitSelect');
    this.hunterSettingInputs = Array.from(document.querySelectorAll('[data-hunter-setting]'));
    this.finalTerminalSettingInputs = {
      finalTerminalSpawnCount: document.querySelector('#finalTerminalSpawnCount'),
      finalTerminalSpawnInterval: document.querySelector('#finalTerminalSpawnInterval')
    };
    this.hunterAdjustPopover = document.querySelector('#hunterAdjustPopover');
    this.hunterAdjustTarget = null;
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
    this.abilityCards = { skill: {}, passive: {} };
    this.abilityCatalogs = {
      skill: document.querySelector('#skillCatalog'),
      passive: document.querySelector('#passiveCatalog')
    };
    this.loadoutLockNote = document.querySelector('#loadoutLockNote');
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
    this.coopMembersList = document.querySelector('#coopMembersList');
    this.coopHostLoadout = document.querySelector('#coopHostLoadout');
    this.coopReadyButton = document.querySelector('#coopReadyButton');
    this.coopStartButton = document.querySelector('#coopStartButton');
    this.coopStartHint = document.querySelector('#coopStartHint');
    this.coopLeaveButton = document.querySelector('#coopLeaveButton');
    this.coopHostButton = document.querySelector('#coopHostButton');
    this.coopJoinButton = document.querySelector('#coopJoinButton');
    this.coopConnectionFeedback = document.querySelector('#coopConnectionFeedback');
    this.coopConnectionMessage = document.querySelector('#coopConnectionMessage');
    this.coopRetryButton = document.querySelector('#coopRetryButton');
    this.coopCancelConnectionButton = document.querySelector('#coopCancelConnectionButton');
    this.coopCopyDiagnosticsButton = document.querySelector('#coopCopyDiagnosticsButton');
    this.coopDiagnosticsText = document.querySelector('#coopDiagnosticsText');
    this.coopFriendlyFireControl = document.querySelector('#coopFriendlyFireControl');
    this.coopFriendlyFireToggle = document.querySelector('#coopFriendlyFireToggle');
    this.coopFriendlyFireStatus = document.querySelector('#coopFriendlyFireStatus');
    this.coopPauseOverlay = document.querySelector('#coopPauseOverlay');
    this.coopPauseTitle = document.querySelector('#coopPauseTitle');
    this.coopPauseHint = document.querySelector('#coopPauseHint');
    this.coopRevivePrompt = document.querySelector('#coopRevivePrompt');
    this.tutorialOverlay = document.querySelector('#tutorialOverlay');
    this.tutorialCard = document.querySelector('#tutorialCard');
    this.tutorialPractice = document.querySelector('#tutorialPractice');
    this.tutorialStepLabel = document.querySelector('#tutorialStepLabel');
    this.tutorialTitle = document.querySelector('#tutorialTitle');
    this.tutorialBody = document.querySelector('#tutorialBody');
    this.tutorialPracticeTitle = document.querySelector('#tutorialPracticeTitle');
    this.tutorialObjective = document.querySelector('#tutorialObjective');
    this.trainingGoal = document.querySelector('#trainingGoal');
    this.trainingCompleteDialog = document.querySelector('#trainingCompleteDialog');
    this.trainingCompleteProgress = document.querySelector('#trainingCompleteProgress');
    this.trainingCompleteDuration = document.querySelector('#trainingCompleteDuration');

    this.toastTimeout = null;
  }

  showTutorialCard(step, index, total) {
    if (!this.tutorialOverlay) return;
    this.tutorialOverlay.classList.remove('practice-mode');
    this.tutorialOverlay.hidden = false;
    this.tutorialCard.hidden = false;
    this.tutorialPractice.hidden = true;
    this.tutorialStepLabel.textContent = `TRAINING SHIP // ${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
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
    if (this.trainingGoal) this.trainingGoal.textContent = '';
  }

  updateTrainingGoal(player, goal) {
    if (!this.trainingGoal) return;
    if (!goal || !Number.isFinite(goal.x) || !Number.isFinite(goal.y)) {
      this.trainingGoal.textContent = '';
      return;
    }
    const distance = Math.round(Math.hypot(goal.x - player.x, goal.y - player.y));
    const key = goal.key || (['door', 'terminal', 'pickup', 'evac'].includes(goal.kind) ? 'E' : '');
    this.trainingGoal.textContent = `${goal.label || '当前目标'} · 距离 ${distance}${key ? ` · ${key}` : ''}`;
  }

  showTrainingComplete({ completed, total, elapsedSeconds }) {
    if (!this.trainingCompleteDialog) return;
    const seconds = Math.max(0, Math.floor(Number(elapsedSeconds) || 0));
    this.trainingCompleteProgress.textContent = `${Math.max(0, Math.floor(Number(completed) || 0))} / ${Math.max(0, Math.floor(Number(total) || 0))}`;
    this.trainingCompleteDuration.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    if (!this.trainingCompleteDialog.open) this.trainingCompleteDialog.showModal();
  }

  /**
   * Updates facility scale selector button active states and display text
   */
  setCurrencyValue(element, value, { grouped = false } = {}) {
    if (!element) return;
    const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
    const label = grouped ? amount.toLocaleString('en-US') : String(amount);
    const icon = document.createElement('img');
    icon.setAttribute('class', 'credit-token-image');
    icon.setAttribute('src', 'resources/images/voidshift-credit-coin.png');
    icon.setAttribute('alt', '');
    icon.setAttribute('aria-hidden', 'true');
    const amountNode = document.createElement('span');
    amountNode.textContent = label;
    element.replaceChildren(icon, amountNode);
    element.setAttribute('aria-label', `${label} 信用点`);
    if (element.classList) element.classList.add('credit-value');
  }

  formatCreditText(value, { grouped = false } = {}) {
    const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
    return `${grouped ? amount.toLocaleString('en-US') : amount} 信用点`;
  }

  updateScaleButtons(scaleKey) {
    const scaleConfig = (Config.mapScales && Config.mapScales[scaleKey]) || { label: '小型 (16 舱)', quota: 420 };
    if (this.currentScaleText) {
      this.currentScaleText.textContent = scaleConfig.label;
    }
    if (this.quotaDisplay) {
      this.setCurrencyValue(this.quotaDisplay, scaleConfig.quota);
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

  updateDifficultyPreset(selectedDifficulty, editingDifficulty = selectedDifficulty, disabled = false, ammoLossWarning = '') {
    Object.entries(this.difficultyButtons).forEach(([difficultyId, button]) => {
      if (!button) return;
      button.classList.toggle('active', difficultyId === editingDifficulty);
      button.setAttribute('aria-pressed', String(difficultyId === editingDifficulty));
      button.disabled = false;
    });
    if (this.currentDifficultyText) {
      const preset = Config.difficultyPresets[editingDifficulty];
      this.currentDifficultyText.dataset.difficulty = editingDifficulty;
      this.currentDifficultyText.textContent = preset ? preset.label : '中等';
    }
    if (this.difficultyAmmoLossWarning) this.difficultyAmmoLossWarning.textContent =
      `本局难度（${Config.difficultyPresets[selectedDifficulty]?.label || '中等'}）：${ammoLossWarning}`;
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

  updateCorpseLimit(value) {
    if (this.corpseLimitSelect) this.corpseLimitSelect.value = String(value);
  }

  showHunterAdjustment(input) {
    if (!this.hunterAdjustPopover || !input || input.disabled) return false;
    this.closeHunterAdjustment();
    this.hunterAdjustTarget = input;
    input.setAttribute('aria-expanded', 'true');
    this.hunterAdjustPopover.hidden = false;
    const rect = input.getBoundingClientRect();
    const menu = this.hunterAdjustPopover.getBoundingClientRect();
    const margin = 8;
    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - menu.width - margin));
    const below = rect.bottom + 6;
    const top = below + menu.height <= window.innerHeight - margin
      ? below
      : Math.max(margin, rect.top - menu.height - 6);
    this.hunterAdjustPopover.style.left = `${left}px`;
    this.hunterAdjustPopover.style.top = `${top}px`;
    return true;
  }

  closeHunterAdjustment() {
    if (this.hunterAdjustTarget) this.hunterAdjustTarget.setAttribute('aria-expanded', 'false');
    this.hunterAdjustTarget = null;
    if (this.hunterAdjustPopover) this.hunterAdjustPopover.hidden = true;
  }

  isHunterAdjustmentOpen() {
    return !!this.hunterAdjustPopover && !this.hunterAdjustPopover.hidden;
  }

  applyHunterAdjustment(delta) {
    const input = this.hunterAdjustTarget;
    if (!input || input.disabled || ![-10, -5, -1, 1, 5, 10].includes(delta)) return false;
    const min = input.min === '' ? -Infinity : Number(input.min);
    const max = input.max === '' ? Infinity : Number(input.max);
    const step = Number(input.step) > 0 ? Number(input.step) : 1;
    const current = input.value === ''
      ? (Number.isFinite(min) ? min : 0)
      : Number(input.value);
    let value = Math.max(min, Math.min(max, current + delta));
    value = Number.isFinite(min)
      ? min + Math.round((value - min) / step) * step
      : Math.round(value / step) * step;
    input.value = String(Math.max(min, Math.min(max, value)));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    this.closeHunterAdjustment();
    return true;
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

  updateFlashbangs() {}

  updateAbilities(player, state) {
    const armory = player?.armory;
    if (!armory) return;
    const locked = !!(state.running || state.transitioning || state.coop?.running);
    if (this.loadoutLockNote) this.loadoutLockNote.textContent = locked
      ? '任务进行中 · 装备已锁定'
      : '每次下潜可装备 1 个主动技能和 1 个被动 · 购买后请手动装备';
    for (const kind of ['skill', 'passive']) {
      const catalog = (kind === 'skill' ? Config.skills : Config.passives) || {};
      const owned = (kind === 'skill' ? armory.ownedSkills : armory.ownedPassives) || {};
      const selected = kind === 'skill' ? armory.equippedSkill : armory.equippedPassive;
      const container = this.abilityCatalogs[kind];
      for (const [id, ability] of Object.entries(catalog)) {
        let nodes = this.abilityCards[kind][id];
        if (!nodes && container) {
          const card = document.createElement('article');
          card.className = 'ability-card';
          card.dataset.ability = id;
          const art = document.createElement('img');
          art.className = 'ability-art';
          art.src = ability.image;
          art.alt = ability.label;
          art.draggable = false;
          const copy = document.createElement('div');
          copy.className = 'ability-copy';
          const title = document.createElement('h3');
          title.textContent = ability.label;
          const status = document.createElement('p');
          status.className = 'ability-status';
          const description = document.createElement('p');
          description.textContent = ability.description;
          const usage = document.createElement('p');
          usage.className = 'ability-usage';
          usage.textContent = kind === 'skill' ? `T 使用 · 冷却 ${ability.cooldown} 秒` : '装备后生效';
          const actions = document.createElement('div');
          actions.className = 'ability-actions';
          const price = document.createElement('p');
          this.setCurrencyValue(price, ability.price, { grouped: true });
          const purchase = document.createElement('button');
          purchase.type = 'button';
          purchase.addEventListener('click', () => window.menu.openShop(kind === 'skill' ? 'skills' : 'passives'));
          const equip = document.createElement('button');
          equip.type = 'button';
          equip.addEventListener('click', () => window.game.equipAbility(kind, id));
          actions.append(price, purchase, equip);
          copy.append(title, status, description, usage, actions);
          card.append(art, copy);
          container.appendChild(card);
          nodes = this.abilityCards[kind][id] = { card, status, purchase, equip };
        }
        if (!nodes) continue;
        const equipped = selected === id;
        nodes.card.classList.toggle('active', equipped);
        nodes.card.classList.toggle('locked', !owned[id]);
        nodes.status.textContent = equipped ? '已装备' : owned[id] ? '已拥有' : '未解锁';
        nodes.purchase.hidden = !!owned[id];
        nodes.purchase.disabled = locked;
        nodes.purchase.textContent = '前往商店';
        nodes.purchase.setAttribute('aria-label', `${nodes.purchase.textContent}：${ability.label}`);
        nodes.equip.hidden = !owned[id];
        nodes.equip.disabled = locked || equipped;
        nodes.equip.textContent = equipped ? '已装备' : '装备';
        nodes.equip.setAttribute('aria-label', `${nodes.equip.textContent}：${ability.label}`);
      }
      const ability = catalog[selected];
      const name = document.querySelector(`[data-equipped-name="${kind}"]`);
      const image = document.querySelector(`[data-equipped-image="${kind}"]`);
      const clear = document.querySelector(`[data-unequip-ability="${kind}"]`);
      if (name) name.textContent = ability?.label || '未装备';
      if (image) {
        image.hidden = !ability;
        if (ability) { image.src = ability.image; image.alt = ability.label; }
      }
      if (clear) clear.disabled = locked || !ability;
    }
    for (const slot of ['primary', 'sidearm']) {
      const name = document.querySelector(`[data-equipped-name="${slot}"]`);
      if (name) name.textContent = Config.weapons[armory.loadout?.[slot]]?.label || '未装备';
    }
  }

  updateSkillReadout(player, state) {
    const ability = Config.skills?.[player?.armory?.equippedSkill];
    const remaining = Math.max(0, Math.ceil((Number(player?.skillReadyAt) || 0) - (Number(state.elapsed) || 0)));
    if (this.hudSkillName) this.hudSkillName.textContent = ability?.label || '主动技能未装备';
    if (this.hudSkillImage) {
      this.hudSkillImage.hidden = !ability;
      if (ability && this.hudSkillImage.getAttribute('src') !== ability.image) this.hudSkillImage.src = ability.image;
    }
    if (this.hudSkillStatus) {
      this.hudSkillStatus.textContent = !ability ? '' : remaining ? `${remaining}s` : '就绪';
      this.hudSkillStatus.classList.toggle('cooling-down', !!ability && remaining > 0);
    }
  }

  static nightmareThreat(monsters) {
    const active = (Array.isArray(monsters) ? monsters : [monsters]).filter(monster => monster?.active);
    const chasing = active.some(monster => monster.alerted && !(monster.recoverTimer > 0));
    return { text: chasing ? '已锁定' : !active.length ? '未知' : active.every(monster => monster.recoverTimer > 0) ? '休眠中' : '脱战', warning: chasing };
  }

  updateOxygenStock(count, medkits = 0) {
    const text = String(count);
    if (this.hudOxygenCount && this.hudOxygenCount.textContent !== text) this.hudOxygenCount.textContent = text;
    if (this.hudMedkitCount && this.hudMedkitCount.textContent !== String(medkits)) this.hudMedkitCount.textContent = String(medkits);
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
    if (this.ammoPurchaseCost) this.setCurrencyValue(this.ammoPurchaseCost, Math.ceil(amount * pricePerUnit), { grouped: true });

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
          const symbol = document.createElement('img');
          symbol.className = 'ammo-standard-art';
          symbol.src = 'resources/images/menu/ammo-crate.png';
          symbol.alt = '';
          symbol.setAttribute('aria-hidden', 'true');
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
        const quantity = Math.floor(Number(this.ammoTransferAmount?.value));
        const sourceUnit = source?.id === 'standard' ? '标准单位' : `${source?.label}备弹`;
        message = `${quantity} ${sourceUnit} → ${preview.rounds} 发${target?.label}备弹\n备弹 ${target?.stock} → ${(target?.stock || 0) + preview.rounds}${preview.remainder ? `\n余量 ${preview.remainder} 标准单位留在弹药库` : ''}`;
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
      : `${option.stock} 发`;
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
    const ammoText = `${player.ammo} / ${player.infiniteReserve ? '∞' : player.reserveAmmo}`;
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

  crewLoadoutRows(loadout) {
    return [['1', 'primary'], ['2', 'sidearm']].map(([key, slot]) => {
      const id = loadout?.[slot];
      const weapon = Config.weapons[id];
      return { key, id: weapon?.slot === slot ? id : null, label: weapon?.slot === slot ? weapon.label : '未装备' };
    });
  }

  _renderCrewLoadout(container, loadout) {
    if (!container) return;
    if (!loadout) {
      container.textContent = '装备同步中';
      return;
    }
    container.replaceChildren(...UIManager.prototype.crewLoadoutRows.call(this, loadout).map(weapon => {
      const line = document.createElement('span');
      const key = document.createElement('b');
      key.textContent = weapon.key;
      line.appendChild(key);
      if (weapon.id) {
        const image = document.createElement('img');
        image.src = `resources/images/menu/weapon-${weapon.id}.png`;
        image.alt = '';
        line.appendChild(image);
      }
      const name = document.createElement('span');
      name.textContent = weapon.label;
      line.appendChild(name);
      return line;
    }));
  }

  showCoopDiagnostics(text) {
    if (!this.coopDiagnosticsText) return;
    this.coopConnectionFeedback.hidden = false;
    this.coopDiagnosticsText.value = text;
    this.coopDiagnosticsText.hidden = false;
    this.coopDiagnosticsText.focus();
    this.coopDiagnosticsText.select();
  }

  updateCoopLobby(coop) {
    if (!this.coopStatus) return;
    if (this.coopHostLatency) this.coopHostLatency.textContent = `延迟：${UIManager.formatLatency(coop, 'host')}`;
    const members = Array.isArray(coop.members) ? coop.members.filter(member => member.status !== 'removed') : [];
    const connectedCount = members.filter(member => member.connected || member.status === 'connected').length;
    const guestsReady = members.length > 0 && members.every(member =>
      (member.connected || member.status === 'connected') && member.ready);
    this.coopStatus.textContent = coop.status || 'OFFLINE';
    this.coopRoomCode.textContent = coop.code || '------';
    if (this.coopConnectionFeedback) {
      this.coopConnectionFeedback.hidden = !coop.connectionPhase && !coop.diagnosticsAvailable;
      this.coopConnectionMessage.textContent = coop.connectionMessage || coop.status || '可复制连接诊断';
      this.coopRetryButton.hidden = !coop.canRetryConnection;
      this.coopRetryButton.disabled = !!coop.roomPending || !!coop.running;
      this.coopCancelConnectionButton.hidden = !['connecting', 'failed'].includes(coop.connectionPhase) || !!coop.running;
      this.coopCopyDiagnosticsButton.disabled = !coop.diagnosticsAvailable;
    }
    this.coopLobby.hidden = !coop.role && !coop.preview;
    this.coopLobby.classList?.toggle?.('guest-lobby', coop.role === 'guest');
    this.coopLobby.classList?.toggle?.('host-lobby', coop.role === 'host');
    this.coopHostReady.textContent = coop.role === 'host'
      ? (coop.localReady ? '已准备' : '未准备')
      : (coop.hostReady ? '已准备' : '房主等待');
    UIManager.prototype._renderCrewLoadout.call(this, this.coopHostLoadout, coop.hostLoadout);
    this.coopGuestReady.textContent = `${connectedCount} / 3 位队友已连接`;
    if (this.coopMembersList) {
      const unassigned = members.filter(member => !Number.isInteger(Number(member.slot)) || Number(member.slot) < 2 || Number(member.slot) > 4);
      const slots = Array.from({ length: 3 }, (_, index) => {
        const member = members.find(item => Number(item.slot) === index + 2);
        return member || unassigned.shift() || null;
      });
      this.coopMembersList.replaceChildren(...slots.map((member, index) => {
        const row = document.createElement('div');
        row.className = `coop-member${!member ? ' empty' : ''}${member?.ready ? ' ready' : ''}${member?.status === 'offline' ? ' offline' : ''}`;
        row.setAttribute?.('role', 'listitem');
        const label = document.createElement('h3');
        const status = document.createElement('strong');
        status.className = 'coop-seat-state';
        const portrait = document.createElement('img');
        portrait.className = 'crew-portrait';
        portrait.src = `resources/images/menu/crew-${!member ? 'empty' : index === 0 ? 'two' : index === 1 ? 'three' : 'host'}.png`;
        portrait.alt = '';
        const connection = document.createElement('p');
        connection.textContent = !member ? '等待队友加入' : member.connected ? '已连接 · 队友'
          : member.connectionMessage || (member.status === 'offline' ? '已离线' : '连接中');
        label.textContent = `队员 ${index + 2}${coop.role === 'guest' && member?.id === coop.playerId ? ' · 你' : ''}`;
        status.textContent = !member ? '空席' : !Number.isInteger(Number(member.slot)) || Number(member.slot) < 2 || Number(member.slot) > 4
          ? '座位同步中…' : member.connectionPhase === 'failed' ? '连接失败' : member.status === 'offline'
          ? '离线 / 5分钟内可重连'
          : member.ready ? '已准备' : member.connected ? '未准备' : '连接中';
        const equipment = document.createElement('div');
        equipment.className = 'crew-loadout';
        if (member) UIManager.prototype._renderCrewLoadout.call(this, equipment, member.armory?.loadout || member.loadout);
        row.append(label, portrait, connection, equipment, status);
        if (member) {
          const ping = document.createElement('small');ping.className = 'crew-latency';
          ping.textContent = `到房主：${UIManager.formatLatency(coop, member.id)}`;
          row.appendChild(ping);
          if (coop.role === 'host') {
            const kick = document.createElement('button');kick.type = 'button';kick.className = 'crew-kick';kick.textContent = '移出队员';
            kick.addEventListener('click', () => window.game.kickPlayer(member.id));row.appendChild(kick);
          }
        }
        return row;
      }));
    }
    this.coopReadyButton.textContent = coop.readyPending ? '等待确认…' : coop.localReady ? '取消准备' : '准备';
    this.coopReadyButton.disabled = !coop.connected || coop.running || !!coop.readyPending;
    if (this.coopStartButton) this.coopStartButton.hidden = coop.role !== 'host';
    const startHint = this.coopStartHint;
    if (startHint) {
      startHint.textContent = coop.role === 'host'
        ? (coop.startBlocker || '全员已准备，可以开始任务。')
        : coop.readyPending ? '准备请求已发送，等待房主确认…'
          : coop.localReady ? '房主已确认你准备就绪。' : '请准备并等待房主开始。';
    }
    if (this.coopStartButton) this.coopStartButton.disabled = coop.role === 'host'
      ? !!coop.startBlocker
      : !coop.connected || !coop.localReady || !guestsReady || coop.running;
    this.coopLeaveButton.disabled = coop.running;
    this.coopHostButton.disabled = !!coop.role || !!coop.roomPending;
    this.coopJoinButton.disabled = !!coop.role || !!coop.roomPending;
    this.coopJoinCode.disabled = !!coop.role || !!coop.roomPending;
    this.coopHostButton.textContent = coop.roomPending === 'host' ? '正在创建…' : '创建四人房间';
    this.coopJoinButton.textContent = coop.roomPending === 'guest' ? '正在连接…' : '加入房间';
    if (this.coopFriendlyFireControl) this.coopFriendlyFireControl.hidden = coop.role !== 'host';
    if (this.coopFriendlyFireToggle) {
      this.coopFriendlyFireToggle.checked = coop.friendlyFire !== false;
      this.coopFriendlyFireToggle.disabled = coop.role !== 'host' || coop.running;
    }
    if (this.coopFriendlyFireStatus) {
      this.coopFriendlyFireStatus.hidden = coop.role !== 'guest';
      this.coopFriendlyFireStatus.textContent = `友伤：${coop.friendlyFire === false ? '关闭' : '开启'}`;
    }
  }

  static formatLatency(coop, id) {
    if (id === 'host') return coop.role === 'guest' ? '房主端' : '本机';
    const member = coop.members?.find(member => member.id === id);
    const value = coop.latencies?.[id];
    if (!member?.connected || !Number.isFinite(value)) return '—';
    return value < 1 ? '<1 ms' : `${Math.round(value)} ms`;
  }

  updateCrewManagement(coop) {
    const container = document.getElementById('pauseCrewList');
    if (!container) return;
    container.hidden = !coop.role;
    container.replaceChildren();
    if (!coop.role) return;
    for (const member of [{ id: 'host', slot: 1 }, ...(coop.members || []).filter(member => member.status !== 'removed')]) {
      const row = document.createElement('div');row.className = 'pause-crew-row';
      const label = document.createElement('span');label.textContent = member.id === 'host' ? '房主' : `队员 ${member.slot}`;
      const latency = document.createElement('span');latency.textContent = UIManager.formatLatency(coop, member.id);row.append(label, latency);
      if (coop.role === 'host' && member.id !== 'host') {
        const kick = document.createElement('button');kick.type = 'button';kick.textContent = '移出';
        kick.addEventListener('click', () => window.game.kickPlayer(member.id));row.append(kick);
      }
      container.append(row);
    }
  }

  updateCoopRevivePrompt(text = '') {
    if (!this.coopRevivePrompt) return;
    this.coopRevivePrompt.textContent = text;
    this.coopRevivePrompt.hidden = !text;
  }

  setCoopPaused(paused, reason = 'host') {
    if (this.coopPauseOverlay) this.coopPauseOverlay.hidden = !paused;
    if (this.coopPauseTitle) this.coopPauseTitle.textContent = reason === 'reconnect' ? '联机连接中断' : reason === 'menu' ? '房主已暂停' : '房主已切出游戏画面';
    if (this.coopPauseHint) this.coopPauseHint.textContent = reason === 'reconnect'
      ? '正在尝试重连；请在5分钟内恢复连接'
      : reason === 'menu' ? '房主关闭菜单后继续' : '任务已暂停；房主返回后自动继续';
  }

  setPauseMenuVisible(open, role = null) {
    if (!this.pauseMenuDialog) return;
    if (open) {
      if (this.pauseMenuNote) this.pauseMenuNote.textContent = role === 'guest'
        ? '联机任务不会因你的菜单暂停；移动与射击已锁定。'
        : role === 'host' ? '房主已暂停全队任务。' : '任务、敌人与氧气已暂停。';
      if (this.pauseMenuStatus) this.pauseMenuStatus.textContent = '';
      if (!this.pauseMenuDialog.open) this.pauseMenuDialog.showModal();
    } else if (this.pauseMenuDialog.open) this.pauseMenuDialog.close();
  }

  setPauseMenuStatus(message) {
    if (this.pauseMenuStatus) this.pauseMenuStatus.textContent = message;
  }

  showAbandonConfirm(training = false, note = '') {
    if (!this.abandonConfirmDialog) return;
    if (this.abandonConfirmTitle) this.abandonConfirmTitle.textContent = training ? '退出训练？' : '确认放弃下潜？';
    if (this.abandonConfirmNote) this.abandonConfirmNote.textContent = training
      ? '退出后返回安全屋。真实装备、背包、仓库与信用点会恢复，训练物资不会带回。'
      : note || '本次任务会按失败结算，携带物资将失去。';
    if (this.abandonConfirmButton) this.abandonConfirmButton.textContent = training ? '退出训练' : '确认放弃';
    if (!this.abandonConfirmDialog.open) this.abandonConfirmDialog.showModal();
  }

  /**
   * Displays or hides the full-screen tactical facility map modal
   */
  setFullMapVisible(visible, onHidden = null) {
    if (!this.fullMapModal) return;
    if (this._fullMapHideTimer) clearTimeout(this._fullMapHideTimer);
    this._fullMapHideTimer = null;
    if (visible) {
      this.fullMapModal.style.display = 'flex';
      this.fullMapModal.classList.remove('hidden');
      this.fullMapModal.classList.remove('closing');
      // Resize fullMapCanvas to wrapper dimensions
      this.resizeFullMapCanvas();
    } else {
      const hide = () => {
        this.fullMapModal.style.display = 'none';
        this.fullMapModal.classList.add('hidden');
        this.fullMapModal.classList.remove('closing');
        this._fullMapHideTimer = null;
        onHidden?.();
      };
      if (this.fullMapModal.classList.contains('hidden') || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
        hide();
      } else {
        this.fullMapModal.classList.add('closing');
        this._fullMapHideTimer = setTimeout(hide, 180);
      }
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
    const rooms = mapManager.functionalRooms || mapManager.worldRooms;
    const totalRooms = rooms.length;
    const discovered = rooms.filter(r => r.discovered).length;
    const percent = totalRooms ? Math.round((discovered / totalRooms) * 100) : 0;

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

  showTransactionNotice(message, tone = 'success') {
    if (!this.transactionNoticeStack) return this.showToast(message);
    const notice = document.createElement('div');
    notice.className = `transaction-notice ${tone}`;
    const copy = document.createElement('span');
    copy.textContent = message;
    const close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', '关闭通知');
    close.textContent = '×';
    close.addEventListener('click', () => notice.remove());
    notice.append(copy, close);
    this.transactionNoticeStack.appendChild(notice);
    while (this.transactionNoticeStack.children.length > 3) this.transactionNoticeStack.firstElementChild.remove();
    setTimeout(() => {
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) notice.remove();
      else {
        notice.classList.add('leaving');
        setTimeout(() => notice.remove(), 600);
      }
    }, 10000);
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
    this.hideDescentTransition();
    if (this.settlementDialog?.open) this.settlementDialog.close();
    this.startButton.disabled = false;
    this.startButton.innerHTML = '开始下潜 <b>↘</b>';
    this.hudOverlay.style.display = 'none';
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

  showDescentTransition(tip = '') {
    if (!this.descentTransition) return;
    if (this.descentTip) this.descentTip.textContent = tip;
    this.descentTransition.hidden = false;
    document.body.classList.add('descent-active');
  }

  hideDescentTransition() {
    if (this.descentTransition) this.descentTransition.hidden = true;
    document.body.classList.remove('descent-active');
  }

  showSettlement(summary) {
    if (!this.settlementDialog || !summary) return;
    const success = !!summary.success;
    const difficulty = Config.difficultyPresets[summary.difficulty]?.label || '中等';
    const seconds = Math.max(0, Math.floor(Number(summary.elapsedSeconds) || 0));
    const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
    const remainder = (seconds % 60).toString().padStart(2, '0');
    this.settlementDialog.classList.toggle('failure', !success);
    this.settlementEyebrow.textContent = success ? 'EXTRACTION COMPLETE' : 'SIGNAL LOST';
    this.settlementTitle.textContent = success ? '任务完成' : '任务失败';
    this.settlementSubtitle.textContent = summary.coop
      ? success ? '小队已返回安全区。' : '小队通讯中断，本次下潜已结束。'
      : success ? '人员已返回安全区。' : '未能撤出，本次下潜已结束。';
    this.settlementDifficulty.textContent = `${difficulty}难度`;
    this.settlementLootLabel.textContent = success ? '已带回物资' : '未能带回物资';
    this.settlementLootCount.textContent = `${Math.max(0, Math.floor(Number(summary.lootCount) || 0))} 件`;
    this.settlementValueLabel.textContent = success ? '回收估值' : '物资估值';
    this.setCurrencyValue(this.settlementLootValue, Math.max(0, Math.floor(Number(summary.lootValue) || 0)), { grouped: true });
    this.settlementDuration.textContent = `${minutes}:${remainder}`;
    this.settlementAmmoOutcome.textContent = summary.ammoOutcome;
    this.updateRewardSettlement(summary);
    if (!this.settlementDialog.open) this.settlementDialog.showModal();
  }

  updateRewardSettlement(summary) {
    const body = document.getElementById('rewardSettlementRows');
    if (!body) return;
    body.replaceChildren();
    for (const result of summary.rewards || []) {
      const row = document.createElement('tr');
      for (const value of [result.name || result.playerId, result.counts.hunter, result.counts.monster, result.counts.heavy,
        result.baseReward, result.resultMultiplier == null ? `×${result.difficultyMultiplier} · 任务中` : `×${result.difficultyMultiplier} ×${result.resultMultiplier}`,
        result.amount == null ? '待结算' : result.amount]) {
        const cell = document.createElement('td');cell.textContent = typeof value === 'number' ? value.toLocaleString() : value;row.append(cell);
      }
      body.append(row);
    }
    document.getElementById('rewardSettlementStatus').textContent = summary.personalReward
      ? `你的战绩奖励：${summary.personalReward.amount.toLocaleString()} 信用点 · 已到账` : summary.rewardStatus || '待结算';
  }

  /**
   * Configures UI states when calling the extraction beacon
   */
  updateExtractionCalledState(waitSeconds = 30) {
    const seconds = Math.max(0, Math.ceil(Number(waitSeconds) || 0));
    this.updateExtractionProgress({ extractionCalled: true, rescueRemaining: seconds, rescueArrived: false });
    this.contractState.textContent = '撤离信标已激活';
    this.missionTitle.textContent = '救援正在前往远端逃生舱';
    this.log(`远端逃生舱已发出信号。救援约 ${seconds} 秒后抵达。`);
    this.showToast(`救援已呼叫 · ${seconds}秒后抵达`);
  }

  updateExtractionProgress(state) {
    const text = state.extractionCalled
      ? state.rescueArrived
        ? `救援已抵达 · ${state.rescuePresent || 0}/${state.rescueRequired || 1} 到场`
        : `救援到达 ${Math.ceil(Math.max(0, Number(state.rescueRemaining) || 0))}秒`
      : state.finalTerminalPressure ? '撤离点已标记 · 前往远端逃生舱' : '等待呼叫';
    this.extractStatusText.textContent = text;
    this.extractStatusText.className = state.extractionCalled ? 'warning' : '';
    if (this.hudExtractStatus) {
      this.hudExtractStatus.textContent = text;
      this.hudExtractStatus.className = this.extractStatusText.className;
    }
  }

  /**
   * Configures UI states on mission complete/fail
   */
  updateFinishState(success, summary) {
    this.startButton.disabled = false;
    this.startButton.innerHTML = '重新下潜 <b>↘</b>';
    this.hudOverlay.style.display = 'none';
    this.updateCoopRevivePrompt?.('');
    if (this.scaleButtons) {
      Object.values(this.scaleButtons).forEach(btn => { if (btn) btn.disabled = false; });
    }
    this.missionState.textContent = success ? '已撤离' : '任务失败';
    this.missionTitle.textContent = success ? '安全返回' : '信号中断';
    this.contractState.textContent = success ? '回收完成' : '通讯丢失';
    this.resultTitle.textContent = success ? '带着战利品回家' : '这趟没有人来接你';

    this.prompt.style.display = 'none';
    this.showSettlement(summary);

    this.log(success ? '舱门已锁定。结算数据上传中。' : '生命体征丢失。');
  }

  /**
   * Redraws gauge statistics based on updated game states
   */
  setCoopNetworkStatus(delayed) {
    if (this.hudNetworkStatus) this.hudNetworkStatus.hidden = !delayed;
  }

  update(gameState, player, monster) {
    if (this.hudFlashStun) {
      this.hudFlashStun.hidden = !(player.flashStunTimer > 0);
      if (player.flashStunTimer > 0) this.hudFlashStun.textContent = `晕眩中 ${player.flashStunTimer.toFixed(1)}s`;
    }
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

    this.setCurrencyValue(this.lootValueText, gameState.lootValue);
    this.lootCountText.textContent = `${gameState.loot} / 6`;
    this.setCurrencyValue(this.predictedValue, gameState.lootValue);

    const totalSeconds = Math.max(0, Math.floor(gameState.elapsed || 0));
    const mins = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const secs = String(totalSeconds % 60).padStart(2, '0');
    this.clock.textContent = `${mins}:${secs}`;

    const threat = UIManager.nightmareThreat(monster);
    this.threatStatusText.textContent = threat.text;
    this.threatStatusText.className = threat.warning ? 'warning' : 'ok';
    if (this.hudExtractStatus) {
      this.hudExtractStatus.textContent = this.extractStatusText.textContent;
      this.hudExtractStatus.className = this.extractStatusText.className;
    }

    this.updateWeaponReadout(player);
  }
}
