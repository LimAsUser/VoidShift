/** Menu presentation only; prices, inventory and multiplayer remain Game-owned. */
class SafehouseMenu {
  constructor(game) {
    this.game = game;
    game.menu = this;
    this.tab = 'briefing';
    this.lastSelectedItem = null;
    this.refreshQueued = false;
    this.detailDialog = document.getElementById('menuDetailDialog');
    this.detailTitle = document.getElementById('menuDetailTitle');
    this.detailBody = document.getElementById('menuDetailBody');
    this.detailImage = document.getElementById('menuDetailImage');
    this.roomErrorDialog = document.getElementById('coopRoomErrorDialog');
    this.mapDialog = document.getElementById('menuMapDialog');
    this.installDetailCards();
    document.getElementById('menuDetailClose').addEventListener('click', () => this.closeDetail());
    this.detailDialog.addEventListener('cancel', event => {
      event.preventDefault();
      this.closeDetail();
    });
    this.detailDialog.addEventListener('click', event => {
      if (event.target === this.detailDialog) this.closeDetail();
    });
    document.getElementById('coopRoomErrorClose').addEventListener('click', () => this.roomErrorDialog.close());
    document.getElementById('coopRoomErrorRetry').addEventListener('click', () => {
      this.roomErrorDialog.close();
      game.hostCoopRoom();
    });
    document.getElementById('coopRoomErrorPreview').addEventListener('click', () => {
      this.roomErrorDialog.close();
      this.setOfflineCrewPreview(true);
    });
    document.getElementById('coopPreviewExitButton').addEventListener('click', () => this.setOfflineCrewPreview(false));
    document.getElementById('briefScaleButton').addEventListener('click', () => this.openMapDialog());
    document.getElementById('menuMapCancel').addEventListener('click', () => this.cancelMapDraft());
    document.getElementById('menuMapConfirm').addEventListener('click', () => this.commitMapDraft());
    this.mapDialog.addEventListener('cancel', event => { event.preventDefault(); this.cancelMapDraft(); });
    this.mapDialog.addEventListener('click', event => { if (event.target === this.mapDialog) this.cancelMapDraft(); });
    document.querySelectorAll('[data-draft-scale]').forEach(button => {
      button.addEventListener('click', () => this.selectDraftMapScale(button.dataset.draftScale));
    });
    document.querySelectorAll('[data-select-mission-difficulty]').forEach(button => {
      button.addEventListener('click', () => game.applyDifficultyPreset(button.dataset.selectMissionDifficulty));
    });
    document.getElementById('enterPreparationButton').addEventListener('click', () => this.enterPreparation());
    document.getElementById('menuHomeButton').addEventListener('click', () => this.returnToTitle());
    document.querySelectorAll('[data-open-settings]').forEach(button => {
      button.addEventListener('click', () => game.ui.settingsOpenButton.click());
    });
    document.querySelectorAll('[data-ammo-preset]').forEach(button => {
      button.addEventListener('click', () => {
        if (game.state.running || game.state.coop.running || game.state.transitioning) return;
        game.ui.ammoPurchaseAmount.value = button.dataset.ammoPreset;
        game.updateAmmoDepotUI();
      });
    });
    document.querySelectorAll('[data-ammo-section]').forEach(button => {
      button.addEventListener('click', () => this.selectAmmoSection(button.dataset.ammoSection));
    });
    document.querySelectorAll('[data-loadout-section]').forEach(button => {
      button.addEventListener('click', () => this.selectLoadoutSection(button.dataset.loadoutSection));
    });
    document.querySelectorAll('[data-unequip-ability]').forEach(button => {
      button.addEventListener('click', () => game.equipAbility(button.dataset.unequipAbility, null));
    });
    this.selectLoadoutSection('weapons');
    this.bindRewardsAndShop();
    this.selectAmmoSection('purchase');
    document.querySelectorAll('[data-refresh-map]').forEach(button => {
      button.addEventListener('click', () => this.refreshDraftMapPreview(button.dataset.refreshMap));
    });
    document.querySelectorAll('[data-lesson]').forEach(button => {
      button.addEventListener('click', () => this.previewLesson(Number(button.dataset.lesson)));
    });
    document.getElementById('copyRoomButton').addEventListener('click', async () => {
      if (!game.state.coop.code) return;
      try {
        await navigator.clipboard.writeText(game.state.coop.code);
        game.ui.showToast('房间码已复制');
      } catch {
        game.ui.showToast(`房间码：${game.state.coop.code}`);
      }
    });
    this.confirmLeave = () => new Promise(resolve => {
      const dialog = document.getElementById('leaveMenuDialog');
      dialog.returnValue = 'cancel';
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'leave'), { once: true });
      dialog.showModal();
    });
    const resize = new ResizeObserver(() => this.queueRefresh());
    resize.observe(document.getElementById('preparationScreen'));
    this.resizeObserver = resize;
    this.mapResizeObserver = new ResizeObserver(() => {
      if (this.mapDialog?.open) this.queueMapPreviewPaint();
      else if (this.tab === 'briefing') this.queueRefresh();
      else if (this.tab === 'tutorial') this.drawTrainingPreview();
    });
    document.querySelectorAll('[data-map-preview], #lobbyMapPreview, #trainingShipPreview').forEach(canvas => this.mapResizeObserver.observe(canvas));
    this.missionObserver = new MutationObserver(() => {
      const inDive = document.body.classList.contains('in-dive');
      if (inDive) document.getElementById('preparationScreen').inert = true;
      else if (this.screen !== 'title') this.setScreen('prep');
      this.syncBackgroundMotion();
    });
    this.missionObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    this.initBackgroundMotion();
    this.setScreen('title');
    this.previewLesson(0);
    this.refresh();
  }

  enterPreparation() {
    if (this.game.state.running || this.game.state.coop.running || this.game.state.transitioning) return;
    this.setScreen('prep');
  }

  showRoomError(error) {
    const message = document.getElementById('coopRoomErrorMessage');
    const local = /^(localhost|127\.0\.0\.1|::1)$/.test(window.location?.hostname || '');
    message.textContent = local && [404, 405, 501].includes(error?.status)
      ? '本地网页服务器未提供联机 API（/api/rooms）。请启动带房间 API 的服务后重试；也可只查看离线小队界面。'
      : error?.message || '无法创建联机房间，请检查连接后重试。';
    document.getElementById('coopRoomErrorPreview').hidden = !local;
    if (!this.roomErrorDialog.open) this.roomErrorDialog.showModal();
  }

  setOfflineCrewPreview(enabled) {
    if (enabled && (this.game.state.running || this.game.state.coop.role)) return false;
    this.offlineCrewPreview = !!enabled;
    this.updateLobby();
    return true;
  }

  openMapDialog() {
    if (this.game.state.running || this.mapDialog.open) return false;
    this.mapDraft = { scale: Config.currentScale, seeds: { ...this.game._ensureMenuMapSeeds() } };
    this.mapDraftMaps = {};
    this.mapDraftErrors = {};
    this.mapDialog.showModal();
    this._refreshMapDialog();
    return true;
  }

  selectDraftMapScale(scale) {
    if (!this.mapDraft || !Config.mapScales[scale] || this.game.state.coop.role === 'guest') return false;
    if (this.game.canSelectMission?.(scale) === false) return false;
    this.mapDraft.scale = scale;
    this._refreshMapDialog();
    return true;
  }

  refreshDraftMapPreview(scale) {
    if (!this.mapDraft || !Config.mapScales[scale] || this.game.state.coop.role === 'guest') return false;
    if (this.game.canSelectMission?.(scale) === false) return false;
    const previous = this.mapDraft.seeds[scale];
    const next = this.game._newMenuSeed();
    this.mapDraft.seeds[scale] = next === previous ? (next + 1) >>> 0 : next;
    delete this.mapDraftMaps?.[scale];
    delete this.mapDraftErrors?.[scale];
    this._refreshMapDialog();
    return true;
  }

  _refreshMapDialog() {
    if (!this.mapDraft || !this.mapDialog?.open) return;
    const guest = this.game.state.coop.role === 'guest';
    if (guest) {
      this.mapDraft.scale = Config.currentScale;
      this.mapDraft.seeds = { ...this.game._ensureMenuMapSeeds() };
    }
    document.querySelectorAll('[data-draft-scale]').forEach(card => {
      const selected = card.dataset.draftScale === this.mapDraft.scale;
      const locked = this.game.canSelectMission?.(card.dataset.draftScale, this.game._previewDifficulty(), true) === false;
      card.classList.toggle('active', selected);
      card.classList.toggle('progress-locked', locked);
      card.setAttribute('aria-pressed', String(selected));
      card.disabled = guest || locked;
      card.querySelector('.facility-select').textContent = locked ? '未解锁 · 单人中等通关中型地图' : selected ? '✓ 待选布局' : '选择设施';
    });
    document.querySelectorAll('[data-refresh-map]').forEach(button => { button.disabled = guest || this.game.canSelectMission?.(button.dataset.refreshMap) === false; });
    document.getElementById('menuMapConfirm').hidden = guest;
    document.getElementById('menuMapReadOnly').hidden = !guest;
    if (guest) document.getElementById('menuMapReadOnly').textContent = this.game.state.advancedUnlocked
      ? '当前布局由房主选择' : '随房主参与 · 大型地图和困难模式不会因此解锁到个人资料';
    document.querySelectorAll('[data-map-preview]').forEach(canvas => {
      const scale = canvas.dataset.mapPreview;
      if (this.game.canSelectMission?.(scale, this.game._previewDifficulty(), true) === false) {
        delete this.mapDraftMaps[scale];
        this.setMapPreviewStatus(scale, 'locked', '未解锁：单人标准中等难度通关中型地图');
        document.querySelector(`[data-map-enemies="${scale}"]`)?.replaceChildren();
        this.drawMapPreview(canvas, null); return;
      }
      const seed = this.mapDraft.seeds[scale];
      const difficulty = this.game._previewDifficulty();
      const cachedError = this.mapDraftErrors?.[scale];
      if (cachedError && cachedError.seed === seed && cachedError.difficulty === difficulty) return;
      delete this.mapDraftErrors?.[scale];
      try {
        if (guest) {
          this.mapDraftMaps[scale] = this.game.getMenuPreviewMap?.(scale) || null;
          if (!this.mapDraftMaps[scale] || this.game.state.coop.mapIncompatible) {
            delete this.mapDraftMaps[scale];
            const incompatible = !!this.game.state.coop.mapIncompatible;
            this.setMapPreviewStatus(scale, incompatible ? 'error' : 'loading', incompatible ? '地图版本不一致 · 请全员刷新' : '正在同步房主布局…');
            document.querySelector(`[data-map-enemies="${scale}"]`)?.replaceChildren(document.createTextNode(incompatible ? '地图资料不兼容' : '敌人资料同步中…'));
            this.drawMapPreview(canvas, null);
            return;
          }
        } else if (this.mapDraftMaps[scale]?.seed !== seed || this.mapDraftMaps[scale]?.difficulty !== difficulty) this.mapDraftMaps[scale] = new MapManager(scale, seed, difficulty);
        const facts = document.querySelector(`[data-draft-scale="${scale}"] .facility-facts`);
        if (facts?.children.length >= 2) {
          facts.children[0].textContent = `${this.mapDraftMaps[scale].functionalRooms.length} 舱`;
          facts.children[1].textContent = `${this.mapDraftMaps[scale].terminals.length} 个终端`;
        }
        this.renderEnemyTypes(document.querySelector(`[data-map-enemies="${scale}"]`), this.mapDraftMaps[scale]);
        this.setMapPreviewStatus(scale, 'loading', '正在绘制布局…');
      } catch (error) {
        this.failMapPreview(scale, error);
      }
    });
    this.updateMapPreviewControls();
    this.queueMapPreviewPaint();
  }

  setMapPreviewStatus(scale, state, text) {
    const node = document.querySelector(`[data-map-preview-status="${scale}"]`);
    if (node) { node.textContent = text; node.setAttribute('data-state', state); }
  }

  failMapPreview(scale, error) {
    this.mapDraftErrors ||= {};
    this.mapDraftErrors[scale] = { seed: this.mapDraft.seeds[scale], difficulty: this.game._previewDifficulty(), message: error.message || String(error) };
    delete this.mapDraftMaps[scale];
    this.setMapPreviewStatus(scale, 'error', '自动加载失败 · 请更换布局重试');
    const enemies = document.querySelector(`[data-map-enemies="${scale}"]`);
    if (enemies) enemies.replaceChildren(document.createTextNode('怪物资料暂不可用'));
  }

  updateMapPreviewControls() {
    const guest = this.game.state.coop.role === 'guest';
    document.querySelectorAll('[data-draft-scale]').forEach(card => {
      card.disabled = guest || this.game.canSelectMission?.(card.dataset.draftScale) === false || !!this.mapDraftErrors?.[card.dataset.draftScale];
    });
    document.getElementById('menuMapConfirm').disabled = guest || this.game.canSelectMission?.(this.mapDraft.scale) === false || !this.mapDraftMaps?.[this.mapDraft.scale] || !!this.mapDraftErrors?.[this.mapDraft.scale];
  }

  queueMapPreviewPaint() {
    if (!this.mapDraft || !this.mapDialog?.open || this.mapPreviewFrame) return;
    const draft = this.mapDraft;
    this.mapPreviewFrame = requestAnimationFrame(() => {
      if (this.mapDraft !== draft) return;
      this.mapPreviewFrame = null;
      if (!this.mapDialog?.open || this.mapDraft !== draft) return;
      document.querySelectorAll('[data-map-preview]').forEach(canvas => {
        const scale = canvas.dataset.mapPreview;
        const map = this.mapDraftMaps?.[scale];
        if (!map) return;
        try {
          if (this.drawMapPreview(canvas, map)) this.setMapPreviewStatus(scale, 'ready', '下一潜真实结构 · 出生点已标记');
        } catch (error) { this.failMapPreview(scale, error); }
      });
      this.updateMapPreviewControls();
    });
  }

  cancelMapDraft() {
    if (this.mapPreviewFrame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.mapPreviewFrame);
    this.mapPreviewFrame = null;
    this.mapDraft = null;
    this.mapDraftMaps = null;
    this.mapDraftErrors = null;
    if (this.mapDialog?.open) this.mapDialog.close();
  }

  commitMapDraft() {
    if (!this.mapDraft || this.game.state.coop.role === 'guest' || this.mapDraftErrors?.[this.mapDraft.scale]) return false;
    if (this.game.canSelectMission?.(this.mapDraft.scale) === false) return false;
    const { scale, seeds } = this.mapDraft;
    this.game.state.menuMapSeeds = { ...seeds };
    this.game._menuPreviewMaps = {};
    this.cancelMapDraft();
    this.game.setMapScale(scale);
    return true;
  }

  async returnToTitle() {
    if (this.game.state.running || this.game.state.coop.running || this.game.state.transitioning) return false;
    if (this.game.state.coop.role || this.game.state.coop.roomPending) {
      if (!(await this.confirmLeave())) return false;
      // A host may have started a mission while the confirmation was open.
      if (this.game.state.running || this.game.state.coop.running || this.game.state.transitioning) return false;
      this.game.leaveCoopRoom();
    }
    this.setScreen('title');
    return true;
  }

  setScreen(screen) {
    this.screen = screen;
    document.body.dataset.menuScreen = screen;
    document.getElementById('preparationScreen').inert = screen !== 'prep';
    document.getElementById('titleScreen').inert = screen !== 'title';
    this.syncBackgroundMotion();
    this.queueRefresh();
    const target = screen === 'title' ? document.getElementById('enterPreparationButton')
      : document.querySelector(`.tab-btn[data-tab="${this.tab}"]`);
    target?.focus({ preventScroll: true });
  }

  initBackgroundMotion() {
    if (this.backgroundMotion) return;
    this.backgroundMotion = [...document.querySelectorAll('[data-menu-motion]')].map(node => ({ node, status: 'idle' }));
    this.backgroundMotionPreference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const sync = () => this.syncBackgroundMotion();
    this.backgroundMotionPreference?.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('pointermove', event => {
      if (event.pointerType !== 'mouse' || event.buttons || !this.backgroundCanFollow()) return;
      this.backgroundPointer = { x: event.clientX, y: event.clientY };
      if (this.backgroundPointerFrame) return;
      this.backgroundPointerFrame = requestAnimationFrame(() => {
        this.backgroundPointerFrame = null;
        if (!this.backgroundCanFollow()) return;
        const scene = this.backgroundMotion.find(entry => entry.node.dataset.menuMotion === this.screen).node;
        const limit = this.screen === 'title' ? 12 : 6;
        const offset = (value, size) => Math.max(-1, Math.min(1, value / Math.max(1, size) * 2 - 1)) * limit;
        scene.style.setProperty('--look-x', `${offset(this.backgroundPointer.x, window.innerWidth)}px`);
        scene.style.setProperty('--look-y', `${offset(this.backgroundPointer.y, window.innerHeight)}px`);
      });
    }, { passive: true });
    this.syncBackgroundMotion();
  }

  backgroundCanFollow() {
    const state = this.game.state;
    return !document.hidden && !this.backgroundMotionPreference?.matches &&
      !state.running && !state.coop.running && !state.transitioning &&
      !document.body.classList.contains('in-dive') && !document.body.classList.contains('descent-active') &&
      !this.game._itemDrag && !document.querySelector('dialog[open]') &&
      this.backgroundMotion?.some(entry => entry.node.dataset.menuMotion === this.screen && !entry.node.hidden);
  }

  syncBackgroundMotion() {
    if (!this.backgroundMotion) return;
    const state = this.game.state;
    const enabled = !document.hidden && !this.backgroundMotionPreference?.matches &&
      !state.running && !state.coop.running && !state.transitioning &&
      !document.body.classList.contains('in-dive') && !document.body.classList.contains('descent-active');
    if (this.backgroundPointerFrame) cancelAnimationFrame(this.backgroundPointerFrame);
    this.backgroundPointerFrame = null;
    for (const entry of this.backgroundMotion) {
      const active = enabled && entry.node.dataset.menuMotion === this.screen;
      entry.node.hidden = !active || entry.status !== 'ready';
      entry.node.dataset.running = String(!entry.node.hidden);
      if (!active) {
        entry.node.style.setProperty('--look-x', '0px');
        entry.node.style.setProperty('--look-y', '0px');
      }
      if (!active || entry.status !== 'idle') continue;
      entry.status = 'loading';
      // Decode the whole scene before replacing the original static background.
      Promise.all([...entry.node.querySelectorAll('img[data-src]')].map(image => new Promise((resolve, reject) => {
        image.onload = () => {
          image.onload = image.onerror = null;
          if (!image.naturalWidth) { reject(); return; }
          if (image.decode) image.decode().then(resolve, reject);
          else resolve();
        };
        image.onerror = () => { image.onload = image.onerror = null; reject(); };
        image.src = image.dataset.src;
        if (image.complete && image.onload) image.onload();
      }))).then(() => {
        entry.status = 'ready';
        this.syncBackgroundMotion();
      }, () => {
        entry.status = 'failed';
        this.syncBackgroundMotion();
      });
    }
  }

  queueRefresh() {
    if (this.refreshQueued) return;
    this.refreshQueued = true;
    requestAnimationFrame(() => { this.refreshQueued = false; this.refresh(); });
  }

  static gridScale(storage, backpack, leftWidth, rightWidth, height) {
    const pitch = Math.max(storage.cellSize + storage.gap, backpack.cellSize + backpack.gap);
    const fit = Math.min(leftWidth / (storage.cols * pitch), rightWidth / (backpack.cols * pitch), height / (storage.rows * pitch));
    return Math.max(1, Math.min(2.2, fit));
  }

  selectAmmoSection(section) {
    if (!['purchase', 'transfer', 'oxygen'].includes(section)) return false;
    this.ammoSection = section;
    this.selectShopCategory(section === 'oxygen' ? 'supplies' : 'ammo', false);
    for (const name of ['purchase', 'transfer', 'oxygen']) {
      const panel = document.getElementById(`ammoSection${name[0].toUpperCase()}${name.slice(1)}`);
      if (panel) panel.hidden = name !== section;
    }
    document.querySelectorAll('[data-ammo-section]').forEach(button => {
      button.setAttribute('aria-selected', String(button.dataset.ammoSection === section));
    });
    return true;
  }

  bindRewardsAndShop() {
    this.rewardsDialog = document.getElementById('rewardsDialog');
    document.getElementById('openRewardsButton').addEventListener('click', () => {
      this.updateRewards();this.rewardsDialog.showModal();
      this.rewardClock = setInterval(() => this.updateRewards(), 1000);
    });
    document.getElementById('closeRewardsButton').addEventListener('click', () => this.rewardsDialog.close());
    this.rewardsDialog.addEventListener('close', () => clearInterval(this.rewardClock));
    document.getElementById('claimDailyRewardButton').addEventListener('click', async () => {
      this.claimingReward = true;this.updateRewards();
      await this.game.claimDailyReward();this.claimingReward = false;this.updateRewards();
    });
    window.addEventListener('storage', event => {
      if (![SaveRewards.key, SaveRewards.journalKey].includes(event.key) || this.game.trainingSession) return;
      try { SaveRewards.mergeForSave(this.game.state, SaveRewards.read());this.game.updateMoneyUI();this.updateRewards(); }
      catch (_) { this.game.ui.showToast('奖励存档暂时不可用，请稍后刷新'); }
    });
    document.querySelectorAll('[data-shop-category]').forEach(button => {
      button.addEventListener('click', () => this.selectShopCategory(button.dataset.shopCategory));
    });
  }

  updateRewards() {
    const now = new Date(), state = this.game.state;
    const claimed = state.dailyRewardDate >= SaveRewards.day(now);
    document.getElementById('dailyRewardStatus').textContent = claimed ? '今日已领取' : '今日奖励可以领取';
    const button = document.getElementById('claimDailyRewardButton');
    button.disabled = claimed || !!this.claimingReward || !!this.game.trainingSession;
    button.textContent = this.claimingReward ? '正在保存…' : claimed ? '已领取' : '领取 1,000 信用点';
    const remaining = Math.max(0, Math.ceil((SaveRewards.nextRefresh(now) - now) / 1000));
    const hours = Math.floor(remaining / 3600), minutes = Math.floor(remaining % 3600 / 60);
    document.getElementById('dailyRewardRefresh').textContent = `下次刷新：明日 00:00 · ${hours} 小时 ${minutes} 分后`;
  }

  openShop(category) { window.switchTab('ammo');this.selectShopCategory(category); }

  selectShopCategory(category, updateAmmo = true) {
    if (!['weapons', 'ammo', 'supplies', 'skills', 'passives'].includes(category)) return false;
    this.shopCategory = category;
    document.querySelectorAll('[data-shop-panel]').forEach(panel => { panel.hidden = panel.dataset.shopPanel !== category; });
    document.querySelectorAll('[data-shop-category]').forEach(button => {
      button.setAttribute('aria-selected', String(button.dataset.shopCategory === category));
    });
    const view = this.ammoSection === 'transfer' ? 'transfer' : 'purchase';
    for (const name of ['purchase', 'transfer', 'oxygen']) {
      document.getElementById(`ammoSection${name[0].toUpperCase()}${name.slice(1)}`).hidden =
        name === 'oxygen' ? category !== 'supplies' : category !== 'ammo' || name !== view;
    }
    if (category === 'ammo' && updateAmmo) this.ammoSection = view;
    this.renderShop();return true;
  }

  renderShop() {
    const game = this.game, armory = game.player.armory;
    this.shopCards ||= new Map();
    const locked = game.state.running || game.state.transitioning || game.state.coop.running;
    for (const [category, kind, catalog, owned] of [
      ['weapons', 'weapon', Config.weapons, armory.ownedWeapons],
      ['skills', 'skill', Config.skills, armory.ownedSkills],
      ['passives', 'passive', Config.passives, armory.ownedPassives]
    ]) {
      const container = document.getElementById(`shop${category[0].toUpperCase()}${category.slice(1)}Catalog`);
      for (const [id, item] of Object.entries(catalog)) {
        const key = `${kind}:${id}`, price = item.purchasePrice ?? item.price;
        let nodes = this.shopCards.get(key);
        if (!nodes) {
          const card = document.createElement('article');card.className = 'shop-product-card';
          const art = document.createElement('img');art.src = UIManager.equipmentImage(id, item.image);art.alt = item.label;art.draggable = false;
          const title = document.createElement('h3');title.textContent = item.label;
          const description = document.createElement('p');description.textContent = item.description || `弹匣 ${item.maxAmmo} 发 · 间隔 ${item.shootCooldownDuration} 秒`;
          const cost = document.createElement('strong');cost.textContent = `${Number(price).toLocaleString()} 信用点`;
          const button = document.createElement('button');button.type = 'button';button.className = 'action-button';
          button.addEventListener('click', () => {
            if (kind === 'weapon') game.purchaseWeapon(id);else game.purchaseAbility(kind, id);
            this.renderShop();
          });
          card.append(art, title, description, cost, button);container.append(card);
          this.shopCards.set(key, nodes = { card, button });
        }
        const unlocked = !!owned?.[id];
        nodes.button.disabled = locked || unlocked || game.state.money < price;
        nodes.button.textContent = unlocked ? '已拥有' : game.state.money < price ? '余额不足' : '购买解锁';
        nodes.card.classList.toggle('owned', unlocked);
      }
    }
    const medkit = document.getElementById('purchaseMedkitButton');
    medkit.disabled = locked || game.state.money < Config.consumables.medkit.purchasePrice;
    game.ui.updateWeaponAmmoShop(armory, game.state.money, locked);
  }

  selectLoadoutSection(section) {
    if (!['weapons', 'skills', 'passives'].includes(section)) return false;
    this.loadoutSection = section;
    for (const name of ['weapons', 'skills', 'passives']) {
      const panel = document.getElementById(`loadoutSection${name[0].toUpperCase()}${name.slice(1)}`);
      if (panel) panel.hidden = name !== section;
    }
    document.querySelectorAll('[data-loadout-section]').forEach(button => {
      button.setAttribute('aria-selected', String(button.dataset.loadoutSection === section));
    });
    return true;
  }

  resizeGrids() {
    if (this.tab !== 'storage' || this.screen !== 'prep' || this.game._itemDrag) return;
    const storage = this.game.storageBackpack;
    const pack = this.game.backpack;
    if (!storage || !pack) return;
    const left = document.querySelector('.storage-grid-viewport');
    const right = document.querySelector('.pack-grid-viewport');
    if (!left?.clientWidth || !right?.clientWidth) return;
    const pitch = Math.max(storage.pitch, pack.pitch);
    const scale = SafehouseMenu.gridScale(storage, pack, left.clientWidth - 22, right.clientWidth - 22, left.clientHeight - 24);
    document.getElementById('storageGrid').style.zoom = String(scale * pitch / storage.pitch);
    document.getElementById('prepBackpackGrid').style.zoom = String(scale * pitch / pack.pitch);
    for (const [id, manager] of [['storageGrid',storage],['prepBackpackGrid',pack]]) {
      const grid = document.getElementById(id);
      const zoom = scale * pitch / manager.pitch;
      let xAxis = grid.parentElement.querySelector('.grid-x-axis');
      let yAxis = grid.parentElement.querySelector('.grid-y-axis');
      if (!xAxis) {
        xAxis = document.createElement('div'); xAxis.className = 'grid-x-axis'; xAxis.setAttribute('aria-hidden','true');
        yAxis = document.createElement('div'); yAxis.className = 'grid-y-axis'; yAxis.setAttribute('aria-hidden','true');
        grid.parentElement.prepend(xAxis, yAxis);
      }
      xAxis.replaceChildren(...Array.from({length:manager.cols},(_,i)=>{const e=document.createElement('span');e.textContent=i+1;return e;}));
      yAxis.replaceChildren(...Array.from({length:manager.rows},(_,i)=>{const e=document.createElement('span');e.textContent=i+1;return e;}));
      const displayedPitch = manager.pitch * zoom;
      xAxis.style.gridTemplateColumns = `repeat(${manager.cols - 1},${displayedPitch}px) ${manager.cellSize * zoom}px`;
      yAxis.style.gridTemplateRows = `repeat(${manager.rows - 1},${displayedPitch}px) ${manager.cellSize * zoom}px`;
      grid.style.marginLeft = `${20 / zoom}px`;
    }
  }

  static itemImage(item) {
    return BackpackManager.imageFor(item);
  }

  static weaponDamageText(weapon) {
    const damage = Number(weapon.damage) || 0;
    if (weapon.pelletCount) return `每弹丸 ${damage} · ${weapon.pelletCount} 弹丸全中最多 ${damage * weapon.pelletCount}`;
    return `单发伤害 ${damage}${weapon.penetrationTargets > 1 ? ` · 最多命中 ${weapon.penetrationTargets} 个目标` : ''}`;
  }

  installDetailCards() {
    const groups = [
      ['.mission-steps article', 'p'],
      ['.brief-risk', 'ul'],
      ['.selected-item-detail', '#menuItemShape, #menuItemEffect, #menuItemValue, small'],
      ['.loadout-card', '.weapon-copy > p:not(.weapon-price)'],
      ['.ammo-depot-panel', 'small, .consumable-resale'],
      ['.coop-room-entry', 'p'],
      ['.coop-lobby-options', 'small:not(.coop-start-hint)'],
      ['.tutorial-preview', '#lessonDescription, .tutorial-rules']
    ];
    for (const [cardSelector, detailSelector] of groups) {
      document.querySelectorAll(cardSelector).forEach(card => {
        const details = [...card.querySelectorAll(detailSelector)];
        if (!details.length) return;
        card.dataset.detailCard = '';
        details.forEach(node => node.classList.add('menu-detail-copy'));
        card.tabIndex = 0;
        card.setAttribute('role', card.matches('.loadout-card, .ammo-depot-panel, .coop-room-entry, .coop-lobby-options, .tutorial-preview') ? 'group' : 'button');
        card.setAttribute('aria-haspopup', 'dialog');
        card.addEventListener('click', event => this.activateDetailCard(card, event));
        card.addEventListener('keydown', event => {
          if (event.target !== card || !['Enter', ' '].includes(event.key)) return;
          event.preventDefault();
          event.stopPropagation();
          this.openDetail(card, card);
        });
      });
    }
    Object.entries(Config.weapons).forEach(([id, weapon]) => {
      const heading = document.querySelector(`#loadout${id[0].toUpperCase()}${id.slice(1)} .weapon-copy h3`);
      if (!heading) return;
      const damage = document.createElement('p');
      damage.className = 'weapon-damage';
      damage.dataset.weaponDamage = id;
      damage.textContent = SafehouseMenu.weaponDamageText(weapon);
      heading.after(damage);
    });
  }

  activateDetailCard(card, event) {
    const control = event.target?.closest?.('button, input, select, textarea, a, label, [role="button"]');
    if (control && control !== card) return false;
    return this.openDetail(card, card);
  }

  openDetail(card, button) {
    if (!this.detailDialog || this.detailDialog.open) return false;
    const details = [...card.querySelectorAll('.menu-detail-copy')].filter(node => node.textContent.trim());
    if (!details.length) return false;
    const heading = card.querySelector('.weapon-copy h3, .selected-item-detail h2, .depot-heading h2, h2, h3');
    this.detailTitle.textContent = heading?.textContent.trim() || '布局与任务说明';
    const copies = details.map(node => {
      const copy = node.cloneNode(true);
      copy.removeAttribute('id');
      copy.classList?.remove('menu-detail-copy');
      copy.querySelectorAll?.('[id]').forEach(child => child.removeAttribute('id'));
      return copy;
    });
    this.detailBody.replaceChildren(...copies);
    const hasArt = !card.matches('.map-page, .brief-risk, .coop-lobby-options, .ammo-transfer-panel');
    const art = hasArt && card.querySelector('.weapon-icon, .menu-media-frame img, .room-entry-art, .tutorial-art img, img:not(.credit-token-image)');
    this.detailImage.hidden = !art;
    if (art) {
      this.detailImage.src = art.currentSrc || art.src;
      this.detailImage.alt = art.alt || '';
    }
    this.detailReturnFocus = button;
    this.detailDialog.showModal();
    if (typeof requestAnimationFrame === 'function' && !window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
      requestAnimationFrame(() => {
        if (this.detailDialog.open && !this.detailDialog.classList.contains('is-closing')) {
          this.detailDialog.classList.add('is-open');
        }
      });
    } else this.detailDialog.classList.add('is-open');
    return true;
  }

  closeDetail() {
    const dialog = this.detailDialog;
    if (!dialog?.open || dialog.classList.contains('is-closing')) return false;
    dialog.classList.remove('is-open');
    const finish = () => {
      this.detailCloseTimer = null;
      dialog.classList.remove('is-closing');
      dialog.close();
      this.detailReturnFocus?.focus({ preventScroll: true });
      this.detailReturnFocus = null;
    };
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) finish();
    else {
      dialog.classList.add('is-closing');
      this.detailCloseTimer = setTimeout(finish, 200);
    }
    return true;
  }

  drawMapPreview(canvas, map) {
    if (!canvas) return;
    if (!map) {
      canvas.getContext?.('2d')?.clearRect(0, 0, canvas.width || 0, canvas.height || 0);
      return;
    }
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height || !map?.worldRooms?.length) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#041b29';
    ctx.fillRect(0, 0, width, height);
    const vertices = map.worldRooms.flatMap(room => room.vertices || []);
    if (!vertices.length) return;
    const minX = Math.min(...vertices.map(point => point.x));
    const minY = Math.min(...vertices.map(point => point.y));
    const maxX = Math.max(...vertices.map(point => point.x));
    const maxY = Math.max(...vertices.map(point => point.y));
    const scale = Math.min((width - 24) / Math.max(1, maxX - minX), (height - 24) / Math.max(1, maxY - minY));
    const left = (width - (maxX - minX) * scale) / 2;
    const top = (height - (maxY - minY) * scale) / 2;
    const px = point => left + (point.x - minX) * scale;
    const py = point => top + (point.y - minY) * scale;
    map.worldRooms.forEach(room => {
      if (!room.vertices?.length) return;
      ctx.beginPath();
      ctx.moveTo(px(room.vertices[0]), py(room.vertices[0]));
      room.vertices.slice(1).forEach(point => ctx.lineTo(px(point), py(point)));
      ctx.closePath();
      ctx.fillStyle = '#0b3643';
      ctx.fill();
      ctx.strokeStyle = '#69dce9';
      ctx.lineWidth = 1.5;
      if (room.wallSegments) {
        ctx.beginPath();
        room.wallSegments.forEach(wall => {
          ctx.moveTo(px({ x: wall.x1 }), py({ y: wall.y1 }));
          ctx.lineTo(px({ x: wall.x2 }), py({ y: wall.y2 }));
        });
      }
      ctx.stroke();
      if (map.isTraining && room.trainingArea) {
        const center = room.center || { x: room.x + room.w / 2, y: room.y + room.h / 2 };
        ctx.fillStyle = '#dff6ff';
        ctx.font = `${Math.max(9, Math.min(13, width / 46))}px "Microsoft YaHei", sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(room.title, px(center), py(center));
      }
    });
    map.doors.forEach(door => {
      if (!door.p1 || !door.p2) return;
      ctx.beginPath();
      ctx.moveTo(px(door.p1), py(door.p1));
      ctx.lineTo(px(door.p2), py(door.p2));
      ctx.strokeStyle = '#91aabb';
      ctx.lineWidth = 2;
      ctx.stroke();
    });
    if (map.isTraining) {
      ctx.fillStyle = '#65ddeb';
      map.terminals.forEach(terminal => ctx.fillRect(px(terminal) - 3, py(terminal) - 3, 6, 6));
    }
    if (map.spawnPoint) {
      ctx.beginPath();
      ctx.arc(px(map.spawnPoint), py(map.spawnPoint), 5, 0, Math.PI * 2);
      ctx.fillStyle = '#dcfa65';
      ctx.fill();
      ctx.strokeStyle = '#092118';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    return true;
  }

  drawTrainingPreview() {
    const canvas = document.getElementById('trainingShipPreview');
    if (!canvas?.clientWidth || !canvas.clientHeight) return;
    this.trainingPreviewMap ||= MapManager.createTraining();
    return this.drawMapPreview(canvas, this.trainingPreviewMap);
  }

  renderEnemyTypes(container, map) {
    if (!container) return;
    if (!map) { container.replaceChildren(document.createTextNode('敌人资料同步中…')); return; }
    const types = map.enemyTypes || [];
    const label = document.createElement('strong');
    label.textContent = '每舱 1–3 个物资箱 · 本局敌人';
    const names = { monster: 'Nightmare', hunter: 'Hunter', heavy: 'Heavy' };
    const rows = types.map(type => {
      const row = document.createElement('span');
      row.className = 'map-enemy';
      const art = document.createElement('img');
      art.src = `resources/images/${type}-topdown.png`;
      art.alt = names[type] || type;
      art.title = names[type] || type;
      row.append(art);
      return row;
    });
    container.replaceChildren(label, ...rows);
  }

  refresh() {
    if (this.game.state.running) return;
    this.renderShop();
    const { game } = this;
    const state = game.state;
    const armory = game.player.armory;
    game.updateEquipmentUI?.();
    const scale = Config.mapScales[Config.currentScale];
    const selectedDifficulty = state.coop.role === 'guest' && state.coop.hostDifficulty || state.selectedDifficulty;
    const difficulty = Config.difficultyPresets[selectedDifficulty]?.label || '中等';
    const loss = { easy: '保留所有携带弹药', medium: '损失一半携带弹药', hard: '损失全部携带弹药' }[state.selectedDifficulty] || '损失一半携带弹药';
    const setText = (id, text) => { const node = document.getElementById(id); if (node) node.textContent = text; };
    game.ui.setCurrencyValue(document.getElementById('moneyDisplay'), state.money, { grouped: true });
    setText('briefScaleLabel', scale.label.replace(' (', ' · ').replace(')', ''));
    this.renderEnemyTypes(document.getElementById('briefEnemyTypes'), game.getMenuPreviewMap(Config.currentScale));
    setText('briefDifficultyLabel', difficulty);
    document.querySelectorAll('[data-select-mission-difficulty]').forEach(button => {
      const active = button.dataset.selectMissionDifficulty === selectedDifficulty;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
      const locked = game.canSelectMission?.('medium', button.dataset.selectMissionDifficulty) === false;
      button.disabled = state.running || state.coop.role === 'guest' || locked;
      button.textContent = `${Config.difficultyPresets[button.dataset.selectMissionDifficulty].label}${locked ? ' · 未解锁' : ''}`;
      button.title = locked ? game.advancedUnlockHint() : '';
    });
    setText('briefAmmoRisk', `已装备武器：${loss}`);
    setText('launchAmmoLossWarning', `⚠　${difficulty} · 失败${loss}`);
    document.getElementById('launchAmmoLossWarning').title = game.getAmmoLossWarning();
    const bag = game.backpack;
    const items = bag?.items || [];
    setText('briefPackCount', `背包 ${bag?.usedCells() || 0} / ${bag?.capacity || 40} 格`);
    setText('shopPackCount', `背包 ${bag?.usedCells() || 0} / ${bag?.capacity || 40} 格`);
    const gunId = armory.loadout.primary || armory.loadout.sidearm;
    setText('briefWeapon', `${armory.loadout.primary ? '主武器' : '副武器'}：${Config.weapons[gunId].label}`);
    setText('briefOxygenCount', `备用氧气瓶 ×${items.filter(item => item.effect === 'oxygen-50').length}`);
    setText('tutorialSetup', '训练借用：冲锋枪 / 手枪 · 闪光弹 · 翻滚');
    if (this.tab === 'tutorial') this.drawTrainingPreview();
    Object.entries(Config.weapons).forEach(([id, weapon]) => {
      const price = game.ui.loadoutCards[id]?.querySelector('.weapon-price');
      if (price) game.ui.setCurrencyValue(price, weapon.purchasePrice, { grouped: true });
      const node = document.querySelector(`[data-weapon-ammo="${id}"]`);
      const owned = armory.ownedWeapons[id];
      const stock = armory.weaponAmmo[id];
      if (node) node.textContent = owned ? `弹匣 ${stock.magazine} / 备弹 ${stock.reserve}` : `弹匣 ${weapon.maxAmmo} / 首购备弹 ${weapon.initialReserve}`;
      const purchase = game.ui.loadoutPurchaseButtons[id];
      if (purchase) {
        purchase.disabled = state.running || state.coop.running || state.transitioning;
        purchase.textContent = '前往商店';
      }
    });
    if (this.mapDialog?.open) this._refreshMapDialog();
    document.querySelectorAll('[data-ammo-preset]').forEach(button => button.classList.toggle('active', Number(button.dataset.ammoPreset) === Number(game.ui.ammoPurchaseAmount.value)));
    const unitPrice = Config.ammo.pricePerPurchase / Config.ammo.unitsPerPurchase;
    const buyAmount = Math.max(Config.ammo.unitsPerPurchase, Math.floor(Number(game.ui.ammoPurchaseAmount.value) || Config.ammo.unitsPerPurchase));
    game.ui.ammoPurchaseButton.disabled = state.running || state.coop.running || state.transitioning || state.money < buyAmount * unitPrice;
    game.ui.updateAbilities?.(game.player, state);
    const oxygen = Config.consumables.oxygenCanister;
    document.querySelector('.consumable-price strong').textContent = `${oxygen.purchasePrice.toLocaleString('en-US')} 信用点`;
    document.querySelector('.consumable-resale').textContent = `出售回收 ${oxygen.value.toLocaleString('en-US')} 信用点`;
    this.updateSelection();
    this.updateLobby();
    this.resizeGrids();
  }

  updateSelection() {
    const { game } = this;
    const storage = [...game.storageBackpack.items, ...game.state.storageOverflowItems]
      .filter(item => game.selectedStorageIds.has(String(item.id)));
    const bag = game.backpack.items.filter(item => game.selectedPackIds.has(String(item.id)));
    const selected = this.lastSelectedItem?.source === 'backpack' ? (bag.at(-1) || storage.at(-1)) : (storage.at(-1) || bag.at(-1));
    document.getElementById('menuItemDetail').classList.toggle('has-selection', !!selected);
    const image = document.getElementById('menuItemImage');
    image.hidden = !selected;
    document.getElementById('menuItemName').textContent = selected?.name || '选择一件物资';
    document.getElementById('menuItemEffect').textContent = selected?.effect === 'oxygen-50' ? '使用 2 秒后恢复 50 点氧气' : selected?.effect === 'health-40' ? '使用 2 秒后恢复 40 生命值' : '';
    document.getElementById('menuItemValue').textContent = selected ? `回收价 ${game.ui.formatCreditText(selected.value || 0)}` : '';
    const manager = bag.includes(selected) ? game.backpack : game.storageBackpack;
    const matrix = selected && manager.matrixFor(selected);
    document.getElementById('menuItemShape').textContent = selected ? `${matrix[0].length}×${matrix.length} 格` : '查看占格与物资详情';
    if (selected) { image.src = SafehouseMenu.itemImage(selected); image.alt = selected.name; }
    document.getElementById('storageOverflowCount').textContent = game.state.storageOverflowItems.length;
    document.querySelector('.storage-selection-summary h2').textContent = storage.length && !bag.length ? `仓库已选 · ${storage.length} 件`
      : bag.length && !storage.length ? `背包已选 · ${bag.length} 件`
        : storage.length + bag.length ? `已选物资 · ${storage.length + bag.length} 件` : '选择物资';
    document.getElementById('storageSelectionStats').textContent = storage.length ? `${bag.length ? '仓库 ' : '价值 '}${storage.reduce((sum,item)=>sum+(Number(item.value)||0),0)} 信用点` : !bag.length ? '点击物资查看详情' : '';
    document.getElementById('prepBackpackSelectionStats').textContent = bag.length ? `${storage.length ? '背包 ' : '价值 '}${bag.reduce((sum,item)=>sum+(Number(item.value)||0),0)} 信用点` : '';
  }

  updateLobby() {
    const coop = this.game.state.coop;
    const pending = !!coop.roomPending;
    if (coop.role !== 'guest') this.game.ui._renderCrewLoadout?.(
      document.getElementById('coopHostLoadout'), this.game.player.armory.loadout, coop.hostSummary);
    if (coop.role) this.offlineCrewPreview = false;
    const preview = !!this.offlineCrewPreview;
    const joined = !!coop.role || preview;
    document.getElementById('briefCrewPanel').classList.toggle('joined', joined);
    document.getElementById('briefCrewPanel').classList.toggle('preview', preview);
    document.getElementById('briefingContent').classList.toggle('crew-joined', joined);
    document.querySelector('.coop-room-entry').hidden = joined;
    document.getElementById('coopLobby').hidden = false;
    document.getElementById('coopOfflinePreviewBanner').hidden = !preview;
    document.getElementById('coopPreviewExitButton').hidden = !preview;
    document.getElementById('copyRoomButton').disabled = !coop.code;
    const members = (coop.members || []).filter(member => member.status !== 'removed');
    const connected = members.filter(member => member.connected || member.status === 'connected');
    const hostReady = coop.role === 'host' ? coop.localReady : coop.hostReady;
    document.getElementById('menuHostIdentity').textContent = coop.role === 'guest' ? '' : '· 你';
    document.getElementById('coopHostReady').dataset.ready = String(!!hostReady);
    document.getElementById('menuRoomSummary').textContent = pending && !coop.role ? '正在连接房间…' : preview ? '离线预览 · 本人 + 三空席'
      : joined ? `你是${coop.role === 'host' ? '房主' : '队友'} · ${connected.length + 1} / 4 人` : '尚未连接';
    if (preview) {
      document.getElementById('coopRoomCode').textContent = '离线预览';
      document.getElementById('coopStatus').textContent = '未连接真实房间；无法联机准备或开局';
      document.getElementById('coopHostReady').textContent = '仅预览';
    } else if (!coop.role) {
      document.getElementById('coopHostReady').textContent = '单人';
    }
    document.querySelector('.coop-host-seat > p').textContent = preview ? '本机玩家 · 未连接联机服务'
      : coop.role === 'guest' && !coop.connected ? '等待连接房主'
        : coop.role ? '已连接 · 房主' : '单人模式';
    document.getElementById('menuReadyCount').textContent = `${connected.filter(member=>member.ready).length + Number(!!hostReady)} / ${connected.length+1} 已准备`;
    const ready = this.game.ui.startButton;
    ready.hidden = coop.role === 'guest';
    document.getElementById('coopReadyButton').hidden = !coop.role;
    document.getElementById('coopLeaveButton').hidden = !coop.role && !pending;
    document.getElementById('coopLeaveButton').textContent = pending && !coop.connected ? '取消连接' : '离开房间';
    document.getElementById('lobbyScaleName').textContent = Config.mapScales[Config.currentScale].label;
    document.getElementById('coopHostRoleLabel').textContent = preview ? '预览房主' : coop.role ? '房主' : '玩家';
    document.querySelector('.coop-map-summary small').textContent = coop.role === 'guest'
      ? coop.mapIncompatible ? '地图版本不一致 · 请全员刷新后重新加入' : this.game.getMenuPreviewMap(Config.currentScale) ? '房主当前选择的设施结构 · 出生点已标记' : '正在同步房主布局…'
      : preview ? '本机预览结构 · 出生点已标记' : '下一潜设施结构 · 出生点已标记';
    if (this.tab === 'briefing') {
      this.drawMapPreview(document.getElementById('lobbyMapPreview'), this.game.getMenuPreviewMap(Config.currentScale));
    }
    ready.disabled = pending || preview || !!coop.mapIncompatible || joined && (coop.role !== 'host' || !!coop.startBlocker);
    ready.textContent = coop.mapIncompatible ? '地图版本不一致' : pending && !coop.role ? '正在连接房间…' : preview ? '退出预览后可单人下潜' : !joined ? (this.game.state.completed ? '重新下潜' : '开始下潜')
      : coop.role === 'guest' ? (coop.localReady ? '等待房主开始' : '请先准备')
        : coop.startBlocker ? '等待队员准备' : '开始任务';
    if (!ready.disabled) {
      const arrow = document.createElement('b'); arrow.textContent = '›'; arrow.setAttribute('aria-hidden','true'); ready.appendChild(arrow);
    }
    ready.title = preview ? '离线预览不是实际房间；退出预览后可开始单人任务'
      : joined ? coop.startBlocker || '由房主开始任务' : '';
    const toggle = document.querySelector('#coopFriendlyFireControl label span');
    if (toggle) toggle.textContent = coop.friendlyFire === false ? '友伤关闭' : '友伤开启';
  }

  previewLesson(index) {
    const lessons = [
      ['入口舱','从出生点学习移动、冲刺、手电与开门。跟随目标标记进入下一训练区域。','W A S D / Shift / F / E','先移动到标记，再开启通往补给舱的舱门'],
      ['补给舱','打开训练箱子，学习双栏取放、背包整理、C 补氧及 H 急救。所有物资仅供训练，不带回真实背包。','E / B / C / H / R','训练箱子在补给工作间，跟随当前目标练习'],
      ['Hunter 舱','单独面对 Hunter，熟悉它的追击方式，使用借用武器完成击杀。','鼠标右键 / 鼠标左键 / R','瞄准射击 · 保持距离 · 完成装填'],
      ['Nightmare 舱','训练目标受到一次有效命中后休眠 40 秒。正式简单／中等／困难生命为 1／3／5，休眠 40／30／20 秒；苏醒后转移至玩家视野外。','鼠标右键 / 鼠标左键 / R / T','命中使其休眠 · 保持距离 · 观察苏醒转移'],
      ['Heavy 舱','利用舱内障碍让 Heavy 冲锋撞墙，再趁眩晕击杀；随后练习地图缩放、平移和第一个终端。','Space / 鼠标左键 / M / E','诱导撞墙 · 完成击杀 · 破解终端 1'],
      ['撤离舱','破解第二个终端，呼叫救援并等待 8 秒后登舱，完成整个训练。','E','破解终端 2 · 呼叫救援 · 登舱返回安全屋']
    ];
    const lesson = lessons[index];
    if (!lesson) return;
    document.querySelectorAll('[data-lesson]').forEach(button => {
      const active = Number(button.dataset.lesson) === index;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    document.getElementById('lessonTitle').textContent = `${String(index+1).padStart(2,'0')}　${lesson[0]}`;
    document.getElementById('lessonDescription').textContent = lesson[1];
    const keys = document.getElementById('lessonKeys');
    keys.classList.toggle('movement-keys', index === 0);
    keys.replaceChildren(...(index === 0 ? ['W','A','S','D','Shift'] : lesson[2].split(' / ')).map(label => {
      const key = document.createElement('kbd'); key.textContent = label; return key;
    }));
    document.getElementById('lessonHint').textContent = lesson[3];
    this.drawTrainingPreview();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.menu = new SafehouseMenu(window.game);
});
