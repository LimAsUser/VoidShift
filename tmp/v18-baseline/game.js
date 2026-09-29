/**
 * VOID SHIFT // RECOVERY OPERATIONS PROTOCOL
 * Central Game Controller (State Orchestration & Core Game Loops)
 */

const TUTORIAL_STEPS = [
  { title: '移动与冲刺', body: '使用 WASD 在舱室内移动，再按住 Shift 冲刺。冲刺会消耗体力，也会产生更多噪音。', objective: '行走并冲刺一段距离。', actions: ['move', 'sprint'] },
  { title: '手电筒与噪音', body: '按 F 切换手电筒。光线能帮助观察，也可能暴露你的位置；刚才的移动和冲刺会留下不同程度的噪音。', objective: '切换一次手电筒。', actions: ['flashlight'] },
  { title: '舱门与回收物', body: '靠近舱门按 E 开门，再靠近废料按 E 回收。背包容量有限，优先寻找有价值的物资。', objective: '打开一扇门并回收一件物资。', actions: ['door', 'pickup'] },
  { title: '射击与换弹', body: '用鼠标左键射击，按 R 手动换弹。弹匣打空时也会自动换弹。', objective: '射出一发子弹并完成一次换弹。', actions: ['fire', 'reload'] },
  { title: '切换武器槽', body: '按 1 切换主武器，按 2 切换副武器。切换会中断当前逐发装填，但已装入的子弹保留。', objective: '分别切换到副武器和主武器。', actions: ['switch-sidearm', 'switch-primary'], requiresWeaponPair: true },
  { title: '翻滚闪避', body: '装备翻滚被动后，按住移动方向并按 Space 翻滚。翻滚时可短暂免疫攻击伤害。', objective: '沿任意方向完成一次翻滚。', actions: ['roll'], requiresRoll: true },
  { title: '刀刃近战', body: '按 V 挥刀，击退 55 单位内所有敌人。近战不增加噪音，但消耗体力。', objective: '挥出一次近战攻击。', actions: ['melee'] },
  { title: '主动技能', body: '鼠标指向落点，按 T 使用已装备的主动技能。成功释放后开始冷却，不消耗背包物品。留意爆炸范围，及时躲到墙后。', objective: '成功使用一次主动技能。', actions: ['skill'], requiresSkill: true },
  { title: '战术地图', body: '按 M 查看完整设施地图；可用滚轮缩放、拖动查看，按 M 或 Esc 关闭。', objective: '打开并关闭一次地图。', actions: ['map-open', 'map-close'] },
  { title: '启动全部终端', body: '找到设施里的每个终端并完成屏幕上的按键序列。全部启动后，撤离舱才会解锁。', objective: '启动本设施的全部终端。', actions: ['terminals'] },
  { title: '呼叫救援', body: '启动全部终端后，地图会标出远端逃生舱。到那里按 E 呼叫救援。', objective: '在远端逃生舱呼叫救援。', actions: ['extraction'] },
  { title: '等待救援', body: '救援需要 30 秒抵达。抵达后让所有队员进入逃生舱范围；倒地队友也可爬进范围。', objective: '全员在远端逃生舱完成撤离。', actions: ['returned'] }
];

const DESCENT_TIPS = [
  '灯光与噪音会吸引敌人。保持安静，避免不必要的战斗。',
  '氧气瓶可在背包中使用。氧气耗尽将导致生命危险。'
];

class Game {
  get monster() { return this.nightmares?.[0] || (this._inactiveMonster ||= new Monster()); }
  set monster(value) { this.nightmares = value ? [value] : []; if (this.state) this.state.nightmares = this.nightmares; }
  // Keep direct callers compatible; simulation and V16 snapshots use collections.
  get heavy() { return this.heavies?.[0] || null; }
  set heavy(value) { this.heavies = value ? [value] : []; if (this.state) this.state.heavies = this.heavies; }

  constructor() {
    this.ui = new UIManager();
    this.audio = new AudioManager();
    this.map = new MapManager();
    this.renderer = new Renderer(this.ui);
    this.player = new Player();
    this.ammoTransferSelection = { source: 'standard', target: 'pistol' };
    this.monster = new Monster();
    this.hunters = [];
    this.heavies = [];
    const difficultyProfiles = this._sanitizeDifficultyProfiles();

    this.state = {
      running: false,
      completed: false,
      revealAllMap: false,
      transitioning: false,
      descentTimer: null,
      pendingTutorialMode: false,
      pauseMenuOpen: false,
      abandonPending: false,
      settlement: null,
      stabilized: false,
      laserJitter: 0,
      cameraZoom: Config.camera.baseZoom,
      cameraLookX: 0,
      cameraLookY: 0,
      money: 1000,
      flashbangCount: 0,
      flashbangs: [],
      flashBursts: [],
      loot: 0,
      lootValue: 0,
      storageItems: [],
      storageOverflowItems: [],
      storageCapacity: Config.storage.capacityCells,
      difficultyProfiles,
      selectedDifficulty: 'medium',
      hunterSettings: this._cloneDifficultyProfile(difficultyProfiles.medium).maps,
      finalTerminalSettings: this._finalTerminalSettings(difficultyProfiles.medium),
      armory: Player.createDefaultArmory(),
      fpsCap: '60',
      corpseLimit: 100,
      enemyCountMigrationVersion: 1,
      corpses: [],
      heavies: this.heavies,
      shakeX: 0,
      shakeY: 0,
      inventory: [],
      remoteInventory: [],
      menuMapSeeds: { [Config.currentScale]: this.map.seed },
      elapsed: 0,
      hunterSpawnTimer: this._getHunterSettings().hunterSpawnInterval,
      huntersInitialized: false,
      finalTerminalPressure: false,
      tutorial: null,
      extractionCalled: false,
      rescueRemaining: 0,
      rescueArrived: false,
      rescuePresent: 0,
      rescueRequired: 0,
      extracted: false,
      activeQte: null,
      inventoryOpen: false,
      inventoryClosing: false,
      fullMapOpen: false,
      fullMapClosing: false,
      mouseX: 0,
      mouseY: 0,
      lastTime: 0,
      nextFrameAt: 0,
      keys: {},
      muzzleFlashTimer: 0,
      muzzleFlashes: [],
      bulletTraces: [],
      impactParticles: [],
      recoilX: 0,
      recoilY: 0,
      qteMonsterTpCooldown: 0,
      lastJumpscareTime: 0,
      fireHeld: false,
      coop: {
        role: null,
        code: null,
        connected: false,
        localReady: false,
        readyPending: false,
        readyPendingValue: false,
        readyRequestSeq: 0,
        readyPendingRequestId: null,
        readyTimeout: null,
        rosterRevision: 0,
        remoteReady: false,
        running: false,
        playerId: 'host',
        localSlot: 1,
        members: [],
        hostReady: false,
        hostPaused: false,
        focusPaused: false,
        menuPaused: false,
        friendlyFire: true,
        status: 'OFFLINE // 选择创建或加入房间',
        mapSeed: null,
        remoteArmory: null,
        disconnectAt: 0
      }
    };

    this.backpack = BackpackManager.fromType(Config.activeBackpack);
    this.remoteBackpack = BackpackManager.fromType(Config.activeBackpack);
    this.selectedStorageIds = new Set();
    this.selectedPackIds = new Set();
    this.storageNextId = 1;
    this._initializeStorage();
    this.selectedItemId = null;
    this._itemDrag = null;
    this._boundItemDragMove = event => this._handleItemDragMove(event);
    this._boundItemDragEnd = event => this._handleItemDragEnd(event);
    this._bindBackpackInventories();

    this.hunters = this._createHunters();
    this.nextHunterSpawnIndex = this.hunters.length;
    this.coopSession = new CoopSession();
    this.remotePlayers = new Map();
    this.coopReviveAssignments = new Map();
    this.remoteQtes = new Map();
    this.pendingCoopFinishes = new Map();
    this.remotePlayer = null;
    this.remoteInput = { keys: {}, aim: 0, aiming: false, fire: false, seq: 0 };
    this.remoteQte = null;
    this._coopSendTimer = 0;
    this._lastRemoteInputSeq = -1;
    this._lastSnapshotTick = -1;
    this._guestInventoryLayoutPending = false;
    this._guestInventoryLayoutPendingAt = 0;
    this.coopStartPayload = null;
    this._coopRosterSignature = '';
    this.seenWeaponEffects = new Set();
    this.shotSequence = 0;
    this.weaponEffectSequence = 0;
    this._attachCoopSession();
    this.loot = new LootController(this);
    this.equipment = new EquipmentController(this);

    this.init();
    this.loot.bindUI();
    this.rewards = new MissionRewardsClient((receipt, result) => this._onRewardReceipt(receipt, result));
    const resumeRewards = () => this.rewards.flush().catch(() => {});
    resumeRewards();
    this.rewardPollTimer = setInterval(resumeRewards, 30000);
  }

  _bindBackpackInventories() {
    if (!this.backpack || !this.remoteBackpack || !this.state) return;
    const bind = (manager, key) => {
      const items = Array.isArray(this.state[key]) ? this.state[key] : [];
      if (manager.items !== items) {
        manager.items = items;
        manager.nextId = Math.max(1, ...items.map(item => Number(item.id) + 1 || 1));
      }
      this.state[key] = manager.items;
    };
    bind(this.backpack, 'inventory');
    bind(this.remoteBackpack, 'remoteInventory');
    for (const entry of this.remotePlayers?.values?.() || []) {
      if (!entry.backpack) entry.backpack = BackpackManager.fromType(Config.activeBackpack);
      entry.backpack.items = Array.isArray(entry.inventory) ? entry.inventory : [];
      entry.inventory = entry.backpack.items;
    }
  }

  _namespacePersistentBackpackItems(items, ownerId = this.state?.coop?.playerId || 'host', missionId = this.state?.missionFxId) {
    const used = new Set();
    return (Array.isArray(items) ? items : []).map((source, index) => {
      const rawId = String(source.id ?? `item-${index + 1}`);
      const prefix = missionId ? `carry:${missionId}:${ownerId}:` : 'carry:';
      const baseId = rawId.startsWith(prefix) ? rawId : missionId
        ? `${prefix}${index + 1}-${BackpackManager.hash(rawId).toString(16)}` : `${prefix}${rawId}`;
      let id = baseId;
      let suffix = 2;
      while (used.has(id)) id = `${baseId}:${suffix++}`;
      used.add(id);
      return { ...source, id, carriedAcrossDive: true, foundThisRun: false };
    });
  }

  _newMenuSeed() {
    return globalThis.crypto?.getRandomValues
      ? globalThis.crypto.getRandomValues(new Uint32Array(1))[0]
      : (Math.random() * 0x100000000) >>> 0;
  }

  _ensureMenuMapSeeds() {
    this.state.menuMapSeeds ||= {};
    for (const scale of Object.keys(Config.mapScales)) {
      if (Number.isFinite(this.state.menuMapSeeds[scale])) continue;
      this.state.menuMapSeeds[scale] = scale === Config.currentScale && this.map?.seed != null
        ? this.map.seed : this._newMenuSeed();
    }
    return this.state.menuMapSeeds;
  }

  getMenuPreviewMap(scale) {
    if (!Config.mapScales[scale]) return null;
    if (this.state.coop?.role === 'guest' && !this.state.coop.previewReady) return null;
    const seed = this._ensureMenuMapSeeds()[scale];
    const difficulty = this._previewDifficulty();
    this._menuPreviewMaps ||= {};
    if (this._menuPreviewMaps[scale]?.seed !== seed || this._menuPreviewMaps[scale]?.difficulty !== difficulty) {
      const preview = new MapManager(scale, seed, difficulty);
      this._menuPreviewMaps[scale] = preview;
    }
    return this._menuPreviewMaps[scale];
  }

  _newMissionId(prefix = 'mission') {
    return `${prefix}-${Array.from({ length: 4 }, () => this._newMenuSeed().toString(16).padStart(8, '0')).join('')}`;
  }

  _previewDifficulty() {
    return (this.state.coop?.role === 'guest' && this.state.coop.hostDifficulty) || this.state.selectedDifficulty || 'medium';
  }

  refreshMapPreview(scale = Config.currentScale) {
    if (!Config.mapScales[scale] || this.state.running || this.state.transitioning || this.state.coop.role === 'guest') return false;
    const seeds = this._ensureMenuMapSeeds();
    const previous = seeds[scale];
    const random = this._newMenuSeed();
    seeds[scale] = random === previous ? (random + 1) >>> 0 : random;
    delete this._menuPreviewMaps?.[scale];
    this.menu?.queueRefresh();
    if (this.state.coop.role === 'host') this._broadcastCoopRoster();
    return true;
  }

  _rollNextMenuMaps() {
    if (this.state.coop.role === 'guest') return false;
    const seeds = this._ensureMenuMapSeeds();
    for (const scale of Object.keys(Config.mapScales)) {
      const random = this._newMenuSeed();
      seeds[scale] = random === seeds[scale] ? (random + 1) >>> 0 : random;
    }
    this._menuPreviewMaps = {};
    this.menu?.queueRefresh();
    if (this.state.coop.role === 'host') this._broadcastCoopRoster();
    return true;
  }

  _backpackFor(actor = this.player) {
    this._bindBackpackInventories();
    return this._remoteEntryForActor(actor)?.backpack || (actor === this.remotePlayer ? this.remoteBackpack : this.backpack);
  }

  /**
   * Initializes game configurations and event listeners
   */
  init() {
    this.handleResize();
    this._loadSave();
    this.difficultyEditor = this.state.selectedDifficulty;
    this.ui.updateFpsCap(this.state.fpsCap);
    this.ui.updateCorpseLimit?.(this.state.corpseLimit);
    this.reset();
    this.attachEventListeners();
  }

  _attachCoopSession() {
    this.coopSession.addEventListener('latency', event => {
      this.state.coop.latencies = event.detail.values;
      this.updateCoopUI();
      this.ui.updateCrewManagement?.(this.state.coop);
    });
    this.coopSession.addEventListener('connection-stage', event => this._handleCoopConnectionStage(event.detail));
    this.coopSession.addEventListener('member-error', event => {
      const detail = event.detail;
      this._handleCoopConnectionStage({ peerId: detail.memberId, slot: detail.slot,
        generation: detail.generation, stage: 'channels', phase: 'failed',
        message: detail.error?.message || '队友连接失败' });
    });
    this.coopSession.addEventListener('room', (event) => {
      if (event.detail.role === 'host') this._coopRosterSignature = '';
      this.state.coop.role = event.detail.role;
      this.state.coop.code = event.detail.code;
      this.state.coop.playerId = event.detail.memberId || 'host';
      this.state.coop.localSlot = event.detail.slot || 1;
      this.state.coop.localReady = false;
      this.state.coop.hostReady = false;
      this.state.coop.mapIncompatible = false;
      this.state.coop.mapMismatchReported = false;
      this.state.coop.previewReady = event.detail.role === 'host';
      this.state.coop.hostMapSignature = null;
      this.state.coop.hostSummary = null;
      this.state.coop.members = [];
      this.state.coop.rosterRevision = 0;
      this.state.coop.readyRequestSeq = 0;
      this.state.coop.startBlocker = '';
      this._clearReadyPending();
      this.state.coop.status = event.detail.role === 'host'
        ? `ROOM ${event.detail.code} // 等待队友`
        : `ROOM ${event.detail.code} // 正在连接`;
      this.updateCoopUI();
    });
    this.coopSession.addEventListener('connected', () => {
      this.state.coop.connected = true;
      this.state.coop.disconnectAt = 0;
      this.state.coop.hostPaused = false;
      this.state.coop.status = 'LINK STABLE // 联机已建立';
      if (this.state.coop.role === 'guest') {
        this.coopSession.sendEvent('hello', {
          playerId: this.state.coop.playerId,
          slot: this.state.coop.localSlot,
          armory: this.player.exportArmory(),
          backpackItems: (this.state.inventory || []).map(item => ({ ...item }))
        });
        this.coopSession.sendEvent('request-roster', { slot: this.state.coop.localSlot });
      }
      this.ui.setCoopPaused?.(false);
      this.updateCoopUI();
    });
    this.coopSession.addEventListener('members', (event) => this._applyCoopMemberList(event.detail.members || []));
    this.coopSession.addEventListener('member-connected', (event) =>
      this._setCoopMemberStatus(event.detail.memberId, 'connected', !!event.detail.reconnected, event.detail.slot));
    this.coopSession.addEventListener('member-disconnect', (event) => this._setCoopMemberStatus(event.detail.memberId, 'offline', false, event.detail.slot));
    this.coopSession.addEventListener('member-removed', (event) => this._removeCoopMember(event.detail.memberId));
    this.coopSession.addEventListener('status', (event) => {
      if (event.detail.state === 'expired') {
        this._clearReadyPending();
        Object.assign(this.state.coop, {
          status: 'ROOM EXPIRED // 房间已过期', role: null, code: null,
          connected: false, localReady: false, remoteReady: false, members: [], hostReady: false,
          playerId: 'host', localSlot: 1
        });
        this.remotePlayers.clear();
        this._syncLegacyRemoteAliases();
        this.updateCoopUI();
      }
    });
    this.coopSession.addEventListener('disconnect', () => {
      this._clearReadyPending();
      if (!this.state.coop.disconnectAt) this.state.coop.disconnectAt = Date.now();
      this.state.coop.connected = false;
      this.state.keys = {};
      this.state.fireHeld = false;
      this.state.coop.status = 'LINK LOST // 5分钟内自动重连';
      this.ui.setCoopPaused?.(true, 'reconnect');
      this.updateCoopUI();
    });
    this.coopSession.addEventListener('message', (event) => {
      this._handleCoopMessage(event.detail.channel, event.detail.message, event.detail.peerId);
    });
  }

  _handleCoopConnectionStage(detail) {
    const coop = this.state.coop;
    if (detail.peerId && coop.role === 'host') {
      const peer = this.coopSession.peers?.get(detail.peerId);
      if (peer && detail.generation != null && peer.generation !== detail.generation) return;
      const member = this._upsertCoopMember({ id: detail.peerId, slot: detail.slot ?? peer?.slot });
      if (member) {
        member.connectionPhase = detail.phase;
        member.connectionMessage = detail.message;
        if (detail.phase === 'failed') member.ready = false;
      }
    } else if (!detail.peerId) {
      coop.connectionPhase = detail.phase;
      coop.connectionStage = detail.stage;
      coop.connectionMessage = detail.message;
      coop.status = detail.message;
      if (detail.phase === 'failed' && coop.role === 'guest') {
        coop.connected = false;
        coop.localReady = false;
        this._clearReadyPending();
      }
    }
    this.updateCoopUI();
  }

  _applyCoopMemberList(members) {
    const current = new Map((this.state.coop.members || []).map(member => [member.id, member]));
    const incoming = new Set((members || []).map(member => member.id));
    this.state.coop.members = (members || []).filter(member => member.status !== 'removed').map(member => {
      const previous = current.get(member.id);
      const peer = this.coopSession?.peers?.get(member.id);
      const peerState = peer?.peer?.connectionState;
      const peerOffline = !!peer && !peer.connected && (
        peer.disconnectedNotified || peer.closed || ['disconnected', 'failed', 'closed'].includes(peerState)
      );
      const status = peer?.connected ? 'connected' : peerOffline ? 'offline' : member.status;
      return {
        ...previous,
        ...member,
        slot: member.slot ?? previous?.slot ?? peer?.slot,
        status,
        connected: peer ? !!peer.connected : member.status === 'connected',
        offlineAt: Number(member.offline_at ?? previous?.offlineAt) || 0,
        ready: previous?.ready || false,
        readyRequestId: previous?.readyRequestId ?? null,
        armory: previous?.armory || null
      };
    });
    for (const [id, peer] of this.coopSession?.peers || []) {
      if (!peer.connected || incoming.has(id)) continue;
      const previous = current.get(id);
      this.state.coop.members.push({
        ...previous,
        id,
        slot: peer.slot ?? previous?.slot,
        status: 'connected',
        connected: true,
        ready: previous?.ready || false,
        readyRequestId: previous?.readyRequestId ?? null
      });
    }
    this.state.coop.members.forEach(member => {
      const remote = this.remotePlayers.get(member.id);
      if (!remote) return;
      remote.online = member.connected;
      remote.status = member.status;
      remote.offlineAt = member.offlineAt;
      if (status !== 'connected') { remote.player.supplyUse = null; remote.player.barrierRemoval = null; }
    });
    this.state.coop.connected = this.state.coop.members.some(member => member.connected);
    this._broadcastCoopRoster();
    this.updateCoopUI();
  }

  _upsertCoopMember(memberData) {
    if (!memberData?.id) return null;
    let member = (this.state.coop.members || []).find(item => item.id === memberData.id);
    if (!member) {
      member = { id: memberData.id, slot: memberData.slot, status: 'waiting', connected: false, ready: false, armory: null };
      this.state.coop.members = [...(this.state.coop.members || []), member];
    }
    const updates = { ...memberData };
    if (updates.slot == null) delete updates.slot;
    Object.assign(member, updates);
    return member;
  }

  _setCoopMemberStatus(memberId, status, forceRejoin = false, slot = null) {
    const peer = this.coopSession?.peers?.get(memberId);
    const assignedSlot = peer?.slot ?? slot;
    const member = this._upsertCoopMember({ id: memberId, ...(assignedSlot != null ? { slot: assignedSlot } : {}) });
    if (!member) return;
    const wasOffline = member.status === 'offline';
    member.status = status;
    member.connected = status === 'connected';
    member.offlineAt = status === 'offline' ? (member.offlineAt || Date.now()) : 0;
    const remote = this.remotePlayers.get(memberId);
    if (remote) {
      remote.online = member.connected;
      remote.status = status;
      remote.offlineAt = member.offlineAt;
      if (status === 'connected' && (wasOffline || forceRejoin)) {
        remote.lastInputAt = null;
        remote.inputStale = true;
        remote.input = {
          keys: {}, aim: remote.player.angle, aiming: false, activeSlot: remote.player.activeSlot,
          flashlight: remote.player.flashlight, fire: false, seq: -1
        };
      }
    }
    const pendingFinish = status === 'connected' && this.pendingCoopFinishes.get(memberId);
    if (pendingFinish) {
      this.coopSession.sendEvent('finish', pendingFinish, memberId);
      this.pendingCoopFinishes.delete(memberId);
    }
    this.state.coop.connected = this.state.coop.members.some(item => item.connected);
    if (status === 'connected' && (wasOffline || forceRejoin) && this.state.coop.role === 'host' && this.state.coop.running && this.coopStartPayload) {
      this.coopSession.sendEvent('rejoin-state', {
        startPayload: { ...this.coopStartPayload, rewardAccess: this.rewardMission?.access?.[memberId] },
        snapshot: this._createCoopSnapshot(),
        equipmentPending: true,
        containers: this.loot.export(),
        containerRequestSeq: this.loot.transactions.requests.get(memberId)?.latest || 0,
        corpses: { missionId: this.state.missionFxId, revision: this.corpseRevision || 0,
          add: (this.corpseRegistry || []).map(record => ({ ...record })), remove: [] }
      }, memberId);
      if (remote) remote.equipmentSyncing = true;
    }
    this._broadcastCoopRoster(null, status === 'connected');
    this.updateCoopUI();
  }

  _removeCoopMember(memberId) {
    if (this.state.coop.role === 'guest' && memberId === this.state.coop.playerId) {
      const missionActive = this.state.running || this.state.transitioning || this.state.coop.running;
      this._clearReadyPending();
      this.state.coop.status = 'RECONNECT EXPIRED // 已离开本局';
      this.state.coop.running = false;
      this.state.coop.connected = false;
      this.coopSession.close(false);
      if (missionActive) this.finish(false);
      else {
        Object.assign(this.state.coop, { role: null, code: null, members: [], localReady: false,
          connectionPhase: 'failed', connectionMessage: '联机连接已过期，请重新加入房间' });
        this.ui.setCoopPaused?.(false);
        this.updateCoopUI();
      }
      return;
    }
    const member = (this.state.coop.members || []).find(item => item.id === memberId);
    if (member) member.status = 'removed';
    const remote = this.remotePlayers.get(memberId);
    if (remote) {
      this._freezePlayerReward(memberId, 'timeout');
      this._dropRemoteInventory(remote);
      this.remotePlayers.delete(memberId);
    }
    this._syncLegacyRemoteAliases();
    this.state.coop.members = (this.state.coop.members || []).filter(item => item.id !== memberId);
    this.state.coop.connected = this.state.coop.members.some(item => item.connected);
    this._broadcastCoopRoster();
    this.updateCoopUI();
  }

  _dropRemoteInventory(entry) {
    if (!entry?.inventory?.length) return 0;
    const items = [...entry.inventory];
    this.loot.dropItems(items, entry.player);
    entry.backpack.clear();
    entry.inventory = entry.backpack.items;
    entry.inventoryRevision = (entry.inventoryRevision || 0) + 1;
    return items.length;
  }

  _broadcastCoopRoster(targetId = null, force = false) {
    const targetConnected = targetId && this.coopSession?.peers?.get(targetId)?.connected;
    if (this.state.coop.role !== 'host' || (!this.state.coop.connected && !targetConnected)) return false;
    const roster = {
      hostReady: !!this.state.coop.localReady,
      difficulty: this.state.selectedDifficulty,
      hostLoadout: { ...(this.player?.armory?.loadout || this.state.armory?.loadout || { primary: null, sidearm: 'pistol' }) },
      hostSummary: this._preparedSummary(this.player.armory, this.backpack?.items),
      mapSignature: this.getMenuPreviewMap(Config.currentScale)?.layoutSignature?.() || '',
      scale: Config.currentScale,
      mapSeeds: { ...this._ensureMenuMapSeeds() },
      members: (this.state.coop.members || []).filter(member => member.status !== 'removed').map(({ id, slot, status, connected, ready, readyRequestId, armory, backpackItems }) => ({
        id, slot, status, connected: !!connected, ready: !!ready, readyRequestId: readyRequestId ?? null,
        loadout: armory?.loadout ? { ...armory.loadout } : null,
        summary: armory ? this._preparedSummary(armory, backpackItems) : null
      }))
    };
    const signature = JSON.stringify(roster);
    if (!targetId && !force && signature === this._coopRosterSignature) return false;
    roster.revision = (this.state.coop.rosterRevision || 0) + 1;
    const sent = this.coopSession.sendEvent('room-roster', roster, targetId);
    if (sent) {
      this.state.coop.rosterRevision = roster.revision;
      if (!targetId) this._coopRosterSignature = signature;
    }
    return sent;
  }

  getCoopStartBlocker(ignoreRegistration = false) {
    const coop = this.state.coop;
    if (coop.role !== 'host') return '只有房主可以开始任务。';
    if (coop.starting && !ignoreRegistration) return '正在登记任务，请稍候…';
    if (coop.mapIncompatible) return '地图结构不一致，请房主重建房间后再开始。';
    if (coop.running) return '任务已经开始。';
    if (!coop.localReady) return '房主需要先准备。';
    const members = (coop.members || []).filter(member => member.status !== 'removed');
    if (!members.length) return '至少需要一位队友加入。';
    if (members.some(member => !Number.isInteger(Number(member.slot)) || Number(member.slot) < 2 || Number(member.slot) > 4)) {
      return '队员座位仍在同步，请稍候。';
    }
    if (members.some(member => !(member.connected || member.status === 'connected'))) return '等待所有队友连接完成。';
    const peers = this.coopSession?.peers;
    if (typeof peers?.get === 'function' && members.some(member => {
      const peer = peers.get(member.id);
      return !peer?.connected || peer.eventChannel?.readyState !== 'open';
    })) return '队友连接已失效，等待重新连接。';
    if (members.some(member => !member.ready)) return '等待所有已连接队友准备。';
    return '';
  }

  _syncLegacyRemoteAliases() {
    const first = this.remotePlayers?.values().next().value;
    this.remotePlayer = first?.player || null;
    this.remoteInput = first?.input || { keys: {}, aim: 0, aiming: false, fire: false, seq: 0 };
    this.remoteBackpack = first?.backpack || this.remoteBackpack;
    this.state.remoteInventory = first?.inventory || [];
  }

  _findCoopSpawnPoint(slot, occupants = []) {
    const base = this.map.spawnPoint || { x: this.player.x, y: this.player.y };
    const directions = [
      [1, 0], [0, 1], [-1, 0], [0, -1],
      [1, 1], [-1, 1], [-1, -1], [1, -1]
    ];
    const separation = this.player.radius * 2 + 6;
    for (let ring = 1; ring <= 24; ring++) {
      for (let step = 0; step < directions.length; step++) {
        const [dx, dy] = directions[(slot + step - 2 + directions.length) % directions.length];
        const length = Math.hypot(dx, dy);
        const candidate = { x: base.x + dx / length * separation * ring, y: base.y + dy / length * separation * ring };
        if (this.map.blocked(candidate.x, candidate.y, this.player.radius)) continue;
        if (occupants.some(other => Math.hypot(candidate.x - other.x, candidate.y - other.y) <
            this.player.radius + (other.radius || this.player.radius) + 4)) continue;
        return candidate;
      }
    }
    return { x: base.x + separation * Math.max(1, slot), y: base.y };
  }

  updateCoopUI() {
    if (this.state.coop.role !== 'guest') {
      this.state.coop.hostSummary = this._preparedSummary(this.player?.armory, this.backpack?.items);
      for (const member of this.state.coop.members || []) if (member.armory) member.summary = this._preparedSummary(member.armory, member.backpackItems);
    }
    this.state.coop.startBlocker = this.state.coop.role === 'host' ? this.getCoopStartBlocker() : '';
    if (this.state.coop.role !== 'guest') this.state.coop.hostLoadout = { ...(this.player?.armory?.loadout || this.state.armory?.loadout || { primary: null, sidearm: 'pistol' }) };
    this.ui.updateCoopLobby({ ...this.state.coop, preview: !!this.menu?.offlineCrewPreview,
      canRetryConnection: !!this.coopSession?.canRetryJoin,
      diagnosticsAvailable: !!this.coopSession?.connectionLog?.length });
    this.ui.updateCrewManagement?.(this.state.coop);
    const lockMission = this.state.running || this.state.coop.role === 'guest';
    Object.values(this.ui.scaleButtons || {}).forEach((button) => {
      if (button) button.disabled = lockMission;
    });
    this.updateDifficultyUI();
    this.updateHunterSettingsUI();
    this.updateTutorialAvailability();
    this.updateLoadoutUI();
    this.updateAmmoDepotUI();
  }

  updateTutorialAvailability() {
    const button = document.getElementById('startTutorialButton');
    const note = document.getElementById('tutorialAvailabilityNote');
    const coopLocked = !!this.state.coop.role || !!this.state.coop.roomPending || this.state.coop.running;
    if (button) button.disabled = this.state.running || coopLocked;
    if (note) note.textContent = coopLocked
      ? '教程仅限单人任务；请离开 CO-OP 房间后启动。'
      : '独立模拟训练 · 借用装备 · 不消耗真实资产 · 可随时退出。';
  }

  startTutorial() {
    if (this.state.running || this.state.transitioning || this.trainingSession) return;
    if (this.state.coop.role || this.state.coop.roomPending || this.state.coop.running) {
      this.ui.showToast('教程仅支持单人任务，请先离开 CO-OP 房间');
      return;
    }
    this.trainingSession = new TrainingSession(this);
    this.trainingSession.open();
  }

  retryTrainingLesson() { this.trainingSession?.retry(); }
  exitTraining() { this.trainingSession?.exit(); }

  _tutorialStepsForPlayer(player = this.player) {
    if (this.trainingSession) return this.trainingSession.steps;
    const hasPrimaryAndSidearm = !!player.armory.loadout.primary && !!player.armory.loadout.sidearm;
    const steps = TUTORIAL_STEPS.filter(step => (!step.requiresWeaponPair || hasPrimaryAndSidearm) &&
      (!step.requiresRoll || player.armory.equippedPassive === 'roll') &&
      (!step.requiresSkill || !!player.armory.equippedSkill));
    const notes = [];
    if (!hasPrimaryAndSidearm) notes.push('当前未装备主武器，本次跳过切枪实练；按 2 使用副武器。');
    if (player.armory.equippedPassive !== 'roll') notes.push('未装备翻滚被动，Space 暂不可用，本次跳过翻滚练习。');
    if (!player.armory.equippedSkill) notes.push('未装备主动技能，T 暂不可用，本次跳过技能练习；可在 Loadout 购买并装备。');
    steps[0] = { ...steps[0], body: `${steps[0].body} ${notes.join(' ')}` };
    const skill = Config.skills[player.armory.equippedSkill];
    return steps.map(step => step.requiresSkill && skill
      ? { ...step, title: `主动技能 · ${skill.label}`, body: `按 T 使用${skill.label}，冷却 ${skill.cooldown} 秒。${skill.description}` }
      : step);
  }

  beginTutorialPractice() {
    const tutorial = this.state.tutorial;
    if (!tutorial || !tutorial.paused) return;
    tutorial.paused = false;
    this.state.keys = {};
    this.state.fireHeld = false;
    this.state.lastTime = performance.now();
    this.state.nextFrameAt = 0;
    this.ui.showTutorialPractice((tutorial.steps || TUTORIAL_STEPS)[tutorial.step]);
  }

  pauseTutorial() {
    const tutorial = this.state.tutorial;
    if (!tutorial || tutorial.paused) return;
    tutorial.paused = true;
    this.state.keys = {};
    this.state.fireHeld = false;
    const steps = tutorial.steps || TUTORIAL_STEPS;
    this.ui.showTutorialCard(steps[tutorial.step], tutorial.step, steps.length);
  }

  skipTutorial() {
    if (this.trainingSession) { this.exitTraining(); return; }
    if (!this.state.tutorial) return;
    this.state.tutorial = null;
    this.state.keys = {};
    this.state.fireHeld = false;
    this.state.lastTime = performance.now();
    this.state.nextFrameAt = 0;
    this.ui.hideTutorial();
    this.ui.showToast('指导已跳过，任务继续');
  }

  _tutorialAction(action, detail = {}) {
    if (this.trainingSession) { this.trainingSession.action(action, detail); return; }
    const tutorial = this.state.tutorial;
    if (!tutorial || tutorial.paused) return;
    const step = (tutorial.steps || TUTORIAL_STEPS)[tutorial.step];
    if (!step || !step.actions.includes(action)) return;
    tutorial.progress[action] = true;
    if (step.actions.every(required => tutorial.progress[required])) this._advanceTutorial();
  }

  _advanceTutorial() {
    const tutorial = this.state.tutorial;
    if (!tutorial) return;
    tutorial.step++;
    const steps = tutorial.steps || TUTORIAL_STEPS;
    if (tutorial.step >= steps.length) {
      this.state.tutorial = null;
      this.ui.hideTutorial();
      this.ui.showToast('教程完成，祝你顺利撤离');
      return;
    }
    tutorial.progress = {};
    tutorial.paused = true;
    this.state.keys = {};
    this.state.fireHeld = false;
    this.ui.showTutorialCard(steps[tutorial.step], tutorial.step, steps.length);
  }

  async hostCoopRoom() {
    return this._openCoopRoom('host');
  }

  async joinCoopRoom() {
    return this._openCoopRoom('guest');
  }

  retryCoopConnection() {
    if (!this.coopSession?.canRetryJoin) return;
    return this._openCoopRoom('guest', true);
  }

  async copyCoopDiagnostics() {
    const text = this.coopSession?.getConnectionDiagnostics?.();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      this.ui.showToast('连接诊断已复制（不含令牌或 IP 地址）');
    } catch (_) {
      this.ui.showCoopDiagnostics(text);
      this.ui.showToast('无法自动复制，请选择下方诊断文字复制');
    }
  }

  async _openCoopRoom(role, retry = false) {
    if (this.trainingSession || this.state.running || this.state.transitioning || this.state.coop.role && !retry || this._coopRoomOperation) return;
    if (retry && !this.coopSession.canRetryJoin) return;
    const code = role === 'guest' ? this.ui.coopJoinCode.value : null;
    const operation = {};
    this._coopRoomOperation = operation;
    this.state.coop.roomPending = role;
    this.state.coop.connectionPhase = 'connecting';
    this.state.coop.status = role === 'host' ? 'CREATING ROOM...' : 'JOINING ROOM...';
    this.updateCoopUI();
    try {
      if (retry) await this.coopSession.retryJoin();
      else if (role === 'host') await this.coopSession.host();
      else await this.coopSession.join(code);
    } catch (error) {
      if (this._coopRoomOperation !== operation) return;
      if (this.coopSession.connectionStatus?.phase === 'failed') {
        const session = this.coopSession;
        Object.assign(this.state.coop, {
          status: error.message, connectionPhase: 'failed', connectionMessage: error.message,
          role: role === 'guest' && session.memberId ? 'guest' : null,
          code: session.roomCode, connected: false, localReady: false,
          playerId: session.memberId || 'host', localSlot: session.localSlot || 1
        });
      } else {
        this.coopSession.close();
        Object.assign(this.state.coop, {
          status: `ERROR // ${error.message}`, role: null, code: null, connected: false,
          localReady: false, members: [], playerId: 'host', localSlot: 1
        });
        if (role === 'host') this.menu?.showRoomError?.(error);
      }
      this.ui.showToast(error.message);
    } finally {
      if (this._coopRoomOperation === operation) {
        this._coopRoomOperation = null;
        this.state.coop.roomPending = null;
        this.updateCoopUI();
      }
    }
  }

  leaveCoopRoom() {
    if (this.state.coop.running) return;
    this._coopRoomOperation = null;
    this._clearReadyPending();
    this.coopSession.close();
    Object.assign(this.state.coop, {
      role: null, code: null, connected: false, localReady: false, roomPending: null,
      connectionPhase: null, connectionStage: null, connectionMessage: '',
      readyPending: false, readyPendingValue: false, readyRequestSeq: 0, readyPendingRequestId: null,
      readyTimeout: null, rosterRevision: 0, startBlocker: '',
      remoteReady: false, running: false, status: 'OFFLINE // 选择创建或加入房间',
      mapSeed: null, disconnectAt: 0, remoteArmory: null,
      hostPaused: false, focusPaused: false, menuPaused: false, friendlyFire: true, playerId: 'host', localSlot: 1,
      members: [], hostReady: false, inputSeq: 0
    });
    this.remotePlayers?.clear?.();
    this.remoteQtes?.clear?.();
    this.pendingCoopFinishes.clear();
    this._syncLegacyRemoteAliases();
    this.ui.setCoopPaused?.(false);
    this.updateCoopUI();
  }

  setFriendlyFire(enabled) {
    const coop = this.state.coop;
    if (coop.role !== 'host' || coop.running) return false;
    coop.friendlyFire = !!enabled;
    if (coop.connected) this.coopSession.sendEvent('friendly-fire', { enabled: coop.friendlyFire });
    this.updateCoopUI();
    return true;
  }

  _setCoopPauseState(paused, reason = 'focus') {
    const coop = this.state.coop;
    if (!coop.running || coop.hostPaused === !!paused) return false;
    coop.hostPaused = !!paused;
    coop.lastSnapshotAt = performance.now();
    this._coopSendTimer = 0;
    this.ui.setCoopNetworkStatus?.(false);
    for (const entry of this.remotePlayers?.values?.() || []) {
      this._recordRemotePose(entry, entry.player, true);
      entry.lastInputAt = null;
      entry.inputStale = true;
    }
    if (coop.hostPaused) {
      this.state.keys = {};
      this.state.fireHeld = false;
      if (coop.role === 'host') {
        for (const entry of this.remotePlayers?.values?.() || []) {
          entry.input = {
            ...entry.input, keys: {}, aiming: false, fire: false, seq: entry.input?.seq || 0
          };
        }
        this._syncLegacyRemoteAliases();
      }
    }
    this.state.lastTime = performance.now();
    this.state.nextFrameAt = 0;
    this.ui.setCoopPaused?.(coop.hostPaused, reason);
    if (coop.hostPaused) this.audio?.stopMissionAudio?.();
    else this.audio?.beginMissionAudio?.();
    return true;
  }

  _syncHostPauseState() {
    const coop = this.state.coop;
    if (coop.role !== 'host' || !coop.running) return false;
    const paused = !!(coop.focusPaused || coop.menuPaused);
    const reason = coop.menuPaused ? 'menu' : 'focus';
    if (!this._setCoopPauseState(paused, reason)) return false;
    this.coopSession.sendEvent('coop-pause', { paused, reason });
    return true;
  }

  _handleCoopFocusChange() {
    const coop = this.state.coop;
    if (coop.role === 'guest' && coop.running) {
      this._guestInputSuspended = document.visibilityState === 'hidden' ||
        (typeof document.hasFocus === 'function' && !document.hasFocus());
      if (this._guestInputSuspended) {
        this.state.keys = {};
        this.state.fireHeld = false;
        this.state.stabilized = false;
        this._sendGuestInput(true);
      }
      return false;
    }
    if (coop.role !== 'host' || !coop.running) return false;
    const focused = document.visibilityState !== 'hidden' &&
      (typeof document.hasFocus !== 'function' || document.hasFocus());
    coop.focusPaused = !focused;
    return this._syncHostPauseState();
  }

  togglePauseMenu(force = null) {
    if (!this.state.running) return false;
    const open = force == null ? !this.state.pauseMenuOpen : !!force;
    if (open === !!this.state.pauseMenuOpen) return false;
    this.state.pauseMenuOpen = open;
    this.state.keys = {};
    this.state.fireHeld = false;
    this.state.stabilized = false;
    this.state.lastTime = performance.now();
    this.state.nextFrameAt = 0;
    const coop = this.state.coop;
    if (coop.running && coop.role === 'host') {
      coop.menuPaused = open;
      this._syncHostPauseState();
    } else if (!coop.running) {
      if (open) this.audio?.stopMissionAudio?.();
      else this.audio?.beginMissionAudio?.();
    } else if (open) {
      this._sendGuestInput(true);
    }
    this.ui.setPauseMenuVisible?.(open, coop.running ? coop.role : null);
    if (open) this.ui.updateCrewManagement?.(coop);
    return true;
  }

  abandonMission() {
    if (this.trainingSession) { this.exitTraining(); return true; }
    if (!this.state.running || this.state.abandonPending) return false;
    const coop = this.state.coop;
    if (coop.running && coop.role === 'guest') {
      this.state.abandonPending = true;
      this.state.keys = {};
      this.state.fireHeld = false;
      this.ui.setPauseMenuStatus?.('等待房主确认退出…');
      if (this.coopSession.sendEvent('abandon-request', { memberId: coop.playerId })) {
        if (typeof setTimeout === 'function') this._abandonTimer = setTimeout(() => {
          if (!this.state.abandonPending) return;
          this.state.abandonPending = false;
          this.state.coop.running = false;
          this.finish(false);
          this.leaveCoopRoom();
        }, 3000);
        return true;
      }
      this.state.abandonPending = false;
      coop.running = false;
      this.finish(false);
      this.leaveCoopRoom();
      return true;
    }
    this.finish(false);
    return true;
  }

  _handleCoopAbandonRequest(message, peerId) {
    if (this.state.coop.role !== 'host' || !this.state.coop.running) return false;
    const entry = this.remotePlayers?.get(peerId);
    if (!entry || entry.online === false || entry.abandonHandled) return false;
    entry.abandonHandled = true;
    this._freezePlayerReward(peerId, 'quit');
    this._settlePlayerAmmo(entry.player, false);
    this.coopSession.sendEvent('finish', {
      success: false, abandoned: true, items: [], playerArmory: entry.player.exportArmory(),
      missionId: this.state.missionFxId, resultId: `${this.state.missionFxId}:${peerId}`,
      rewards: this._freezeRewardRowsForDisplay()
    }, peerId);
    this._removeCoopMember(peerId);
    if (this.state.running && this._shouldFailMission()) this.finish(false);
    return true;
  }

  async kickPlayer(memberId) {
    const coop = this.state.coop;
    const member = coop.members.find(member => member.id === memberId);
    if (coop.role !== 'host' || !member || memberId === 'host' || this._kickPending?.has(memberId)) return false;
    if (!window.confirm(`将队员 ${member.slot} 移出当前房间？${coop.running ? '该玩家按提前离局结算半额战绩奖励，携带物资会掉落。' : '这不会封禁账号。'}`)) return false;
    this._kickPending ||= new Set();this._kickPending.add(memberId);
    try {
      if (!await this.coopSession.kickMember(memberId)) return false;
      const entry = this.remotePlayers.get(memberId);
      if (coop.running && entry) {
        this._freezePlayerReward(memberId, 'kicked');
        this._settlePlayerAmmo(entry.player, false);
        this.coopSession.sendEvent('finish', { success: false, abandoned: true, kicked: true,
          reason: '房主已将你移出本局', missionId: this.state.missionFxId,
          resultId: `${this.state.missionFxId}:${memberId}`, items: [], playerArmory: entry.player.exportArmory(),
          rewards: this._freezeRewardRowsForDisplay() }, memberId);
      } else this.coopSession.sendEvent('member-kicked', { reason: '房主已将你移出当前房间' }, memberId);
      this._removeCoopMember(memberId);
      this.ui.showToast(`队员 ${member.slot} 已移出房间`);
      if (this.state.running && this._shouldFailMission()) this.finish(false);
      return true;
    } catch (error) {
      this.ui.showToast(`未能移出队员：${error.message || '请稍后重试'}`);return false;
    } finally { this._kickPending.delete(memberId); }
  }

  toggleCoopReady() {
    const coop = this.state.coop;
    if (!coop.connected || coop.running || coop.readyPending) return false;
    const ready = !coop.localReady;
    if (coop.role === 'guest') {
      const requestId = (coop.readyRequestSeq || 0) + 1;
      coop.readyRequestSeq = requestId;
      coop.readyPendingRequestId = requestId;
      coop.readyPendingValue = ready;
      coop.readyPending = true;
      const sent = this.coopSession.sendEvent('ready', {
        ready, requestId, slot: coop.localSlot, armory: this.player.exportArmory(),
        backpackItems: (this.state.inventory || []).map(item => ({ ...item }))
      });
      if (!sent) {
        this._clearReadyPending();
        this.ui.showToast('准备请求未发送，请检查联机后重试');
        this.updateCoopUI();
        return false;
      }
      const pendingId = requestId;
      coop.readyTimeout = setTimeout(() => {
        if (!coop.readyPending || coop.readyPendingRequestId !== pendingId) return;
        this._clearReadyPending();
        this.ui.showToast('房主尚未确认准备状态，请重试');
        this.updateCoopUI();
      }, 4000);
    } else {
      coop.localReady = ready;
      this._broadcastCoopRoster();
    }
    this.updateCoopUI();
    return true;
  }

  _clearReadyPending() {
    const coop = this.state.coop;
    if (coop.readyTimeout) clearTimeout(coop.readyTimeout);
    coop.readyTimeout = null;
    coop.readyPending = false;
    coop.readyPendingRequestId = null;
    coop.readyPendingValue = false;
  }

  _applyReadyAcknowledgment(message) {
    const coop = this.state.coop;
    if (coop.role !== 'guest' || !coop.readyPending || message.requestId !== coop.readyPendingRequestId) return false;
    if (message.accepted) coop.localReady = !!message.ready;
    this._clearReadyPending();
    if (!message.accepted) this.ui.showToast(message.reason || '房主未确认准备状态，请重试');
    this.updateCoopUI();
    return !!message.accepted;
  }

  async startCoopMission() {
    const coop = this.state.coop;
    this.state.rewardDepartureOutcome = 'quit';
    if (coop.starting) return false;
    const members = (coop.members || []).filter(member => member.status !== 'removed');
    const blocker = this.getCoopStartBlocker();
    if (blocker) {
      this.ui.showToast(blocker);
      this.updateCoopUI();
      return false;
    }
    const mapSeed = this._ensureMenuMapSeeds()[Config.currentScale];
    const playerProfiles = [
      { id: 'host', slot: 1, armory: this.player.exportArmory(), backpackItems: (this.state.inventory || []).map(item => ({ ...item })) },
      ...members.map(member => ({
        id: member.id,
        slot: member.slot,
        armory: member.armory || Player.createDefaultArmory(),
        backpackItems: (member.backpackItems || []).map(item => ({ ...item }))
      }))
    ];
    const difficultyProfile = this.state.difficultyProfiles?.[this.state.selectedDifficulty] ||
      this._sanitizeDifficultyProfiles()[this.state.selectedDifficulty];
    const scaled = this._scaleCoopMissionSettings(
      difficultyProfile.maps,
      this._finalTerminalSettings(difficultyProfile),
      playerProfiles.length,
      Config.currentScale
    );
    const payload = {
      mapSeed,
      missionFxId: this._newMissionId(),
      scale: Config.currentScale,
      friendlyFire: coop.friendlyFire !== false,
      difficultyMultiplier: scaled.multiplier,
      hunterSettings: scaled.hunterSettings,
      difficulty: this.state.selectedDifficulty,
      finalTerminalSettings: scaled.finalTerminalSettings,
      players: playerProfiles
    };
    const preparedSignature = this._preparedStartSignature();
    let registeredMission = null;
    coop.starting = true;
    this.updateCoopUI();
    try {
      const intentKey = JSON.stringify([coop.code, payload.difficulty, payload.mapSeed, playerProfiles.map(player => player.id)]);
      if (this._pendingRewardStart?.key === intentKey) payload.missionFxId = this._pendingRewardStart.id;
      else this._pendingRewardStart = { key: intentKey, id: payload.missionFxId };
      registeredMission = await this.rewards.register({ missionId: payload.missionFxId, roomCode: coop.code,
        difficulty: payload.difficulty, playerIds: playerProfiles.map(player => player.id) }, this.coopSession.hostToken);
      await this._confirmRewardAccess(members, registeredMission);
      const blocker = this.getCoopStartBlocker(true);
      if (coop !== this.state.coop || coop.code !== this.coopSession.roomCode || blocker || preparedSignature !== this._preparedStartSignature()) {
        throw new Error(blocker || '队伍装备或任务配置已改变，请重新确认准备');
      }
      this.rewardMission = registeredMission;
      if (this._beginCoopMission(payload) === false) throw new Error('任务校验未通过');
      for (const member of members) this.coopSession.sendEvent('start', { ...payload, rewardAccess: this.rewardMission.access[member.id] }, member.id);
      this._pendingRewardStart = null;
      return true;
    } catch (error) {
      if (registeredMission) {
        // No gameplay started: close the registration with zero defeats so peers
        // do not poll an abandoned pending receipt for seven days.
        const cancelled = playerProfiles.map(player => ({ playerId: player.id, outcome: 'failure', counts: { hunter: 0, monster: 0, heavy: 0 } }));
        this.rewards.queueReport(registeredMission.missionId, cancelled).then(() => this.rewards.flush()).catch(() => {});
        if (this._pendingRewardStart?.id === payload.missionFxId) this._pendingRewardStart = null;
      }
      this.ui.showToast(`任务登记失败，尚未下潜：${error.message || '请稍后重试'}`);
      return false;
    } finally { coop.starting = false;this.updateCoopUI(); }
  }

  _confirmRewardAccess(members, mission) {
    return new Promise((resolve, reject) => {
      const pending = new Set(members.map(member => member.id));
      const timer = setTimeout(() => { this._rewardAccessConfirmation = null;reject(new Error('等待队友保存结算凭据超时，请重试')); }, 10000);
      this._rewardAccessConfirmation = { missionId: mission.missionId, accept: (id, accepted) => {
        if (!pending.has(id)) return;
        if (!accepted) { clearTimeout(timer);this._rewardAccessConfirmation = null;reject(new Error('队友无法保存结算凭据，请检查浏览器存储'));return; }
        pending.delete(id);
        if (!pending.size) { clearTimeout(timer);this._rewardAccessConfirmation = null;resolve(); }
      } };
      for (const member of members) {
        if (!this.coopSession.sendEvent('reward-access', { missionId: mission.missionId, access: mission.access[member.id] }, member.id)) {
          this._rewardAccessConfirmation?.accept(member.id, false);
        }
      }
    });
  }

  _preparedStartSignature() {
    const coop = this.state.coop;
    return JSON.stringify({ code: coop.code, ready: coop.localReady, difficulty: this.state.selectedDifficulty,
      scale: Config.currentScale, seed: this._ensureMenuMapSeeds()[Config.currentScale], friendlyFire: coop.friendlyFire !== false,
      settings: this._getDifficultyProfile(), armory: this.player.exportArmory(), inventory: this.state.inventory,
      members: (coop.members || []).filter(member => member.status !== 'removed').sort((a, b) => a.slot - b.slot).map(member => ({
        id: member.id, slot: member.slot, connected: !!(member.connected || member.status === 'connected'), ready: member.ready,
        armory: Player.normalizeArmory(member.armory || Player.createDefaultArmory()), items: member.backpackItems || []
      })) });
  }

  _scaleCoopMissionSettings(hunterSettings, finalTerminalSettings, playerCount, scaleKey = Config.currentScale) {
    const multipliers = { 1: 1, 2: 1, 3: 1.5, 4: 2 };
    const count = Math.max(1, Math.min(4, Math.floor(Number(playerCount) || 1)));
    const multiplier = multipliers[count];
    const scaledHunters = Object.fromEntries(Object.entries(hunterSettings || {}).map(([key, value]) => [key, { ...value }]));
    const selected = scaledHunters[scaleKey];
    if (selected) {
      selected.hunters = Math.ceil(Math.max(0, Number(selected.hunters) || 0) * multiplier);
      selected.hunterRespawnCount = Math.ceil(Math.max(0, Number(selected.hunterRespawnCount) || 0) * multiplier);
    }
    const finalSettings = {
      ...(finalTerminalSettings || {}),
      spawnCount: Math.ceil(Math.max(0, Number(finalTerminalSettings?.spawnCount) || 0) * multiplier),
      spawnInterval: Math.max(1, Number(finalTerminalSettings?.spawnInterval) || 1)
    };
    return { multiplier, hunterSettings: scaledHunters, finalTerminalSettings: finalSettings };
  }

  _beginCoopMission(payload) {
    Config.currentScale = payload.scale;
    this.state.selectedDifficulty = Config.difficultyPresets[payload.difficulty] ? payload.difficulty : 'medium';
    const profile = this._getDifficultyProfile(this.state.selectedDifficulty);
    this.state.hunterSettings = this._buildDifficultySettings(this.state.selectedDifficulty);
    this.state.finalTerminalSettings = this._finalTerminalSettings(profile);
    const missionSettings = this._sanitizeHunterSettings(payload.hunterSettings, profile.maps);
    const missionMapSettings = payload.hunterSettings?.[Config.currentScale];
    if (missionMapSettings) {
      const integer = (value, min, max) => Math.max(min, Math.min(max, Math.round(Number(value) || 0)));
      missionSettings[Config.currentScale] = {
        hunters: integer(missionMapSettings.hunters, 0, 600),
        hunterRespawnCount: integer(missionMapSettings.hunterRespawnCount, 0, 600),
        hunterMaxHp: integer(missionMapSettings.hunterMaxHp, 1, 300),
        hunterSpawnInterval: Math.max(1, Math.min(360, Number(missionMapSettings.hunterSpawnInterval) || 1))
      };
    }
    this.state.missionHunterSettings = missionSettings;
    const final = payload.finalTerminalSettings || this._finalTerminalSettings(profile);
    this.state.missionFinalTerminalSettings = {
      spawnCount: Math.max(0, Math.min(600, Math.round(Number(final.spawnCount) || 0))),
      spawnInterval: Math.max(1, Math.min(360, Number(final.spawnInterval) || 1))
    };
    const players = Array.isArray(payload.players) && payload.players.length
      ? payload.players.map(member => ({ ...member }))
      : [
          { id: 'host', slot: 1, armory: payload.hostArmory || Player.createDefaultArmory() },
          { id: payload.guestId || 'guest', slot: 2, armory: payload.guestArmory || Player.createDefaultArmory() }
        ];
    if (!players.some(member => member.id === 'host')) {
      players.unshift({ id: 'host', slot: 1, armory: Player.createDefaultArmory() });
    }
    const localId = this.state.coop.role === 'guest' ? (this.coopSession.memberId || this.state.coop.playerId) : 'host';
    if (!players.some(member => member.id === localId)) {
      players.push({ id: localId, slot: this.state.coop.localSlot || 2, armory: this.player.exportArmory() });
    }
    players.forEach(member => {
      member.backpackItems = this._namespacePersistentBackpackItems(member.backpackItems, member.id, payload.missionFxId);
    });
    this.state.coop.playerId = localId;
    this.state.coop.members = players.filter(member => member.id !== 'host').map(member => ({
      ...this.state.coop.members?.find(existing => existing.id === member.id),
      ...member,
      connected: true,
      status: 'connected',
      ready: true
    }));
    this.coopStartPayload = this.state.coop.role === 'host' ? payload : null;
    this.state.coop.mapSeed = payload.mapSeed;
    this.state.coop.missionFxId = payload.missionFxId;
    this.state.coop.running = true;
    this.state.coop.hostPaused = false;
    this.state.coop.focusPaused = false;
    this.state.coop.menuPaused = false;
    this.state.coop.friendlyFire = payload.friendlyFire !== false;
    this.ui.setCoopPaused?.(false);
    const localProfile = players.find(member => member.id === localId);
    const localArmory = localProfile?.armory || Player.createDefaultArmory();
    this.state.armory = Player.normalizeArmory(localArmory);
    this.state.remoteInventory = [];
    this._bindBackpackInventories();
    this.remotePlayers = new Map();
    this.remotePlayer = null;
    this.remoteBackpack = BackpackManager.fromType(Config.activeBackpack);
    this._lastRemoteInputSeq = -1;
    this._lastSnapshotTick = -1;
    this.state.coop.lastSnapshotAt = performance.now();
    this._guestInputSuspended = false;
    this._inventoryUiDirty = true;
    this._coopSendTimer = 0;
    this.ui.setCoopNetworkStatus?.(false);
    this.state.coop.snapshotIntervalMs = 0;
    this.state.coop.snapshotTickGapMs = 0;
    this.state.coop.mapMismatchReported = false;
    this.state.coop.difficultyMultiplier = Number(payload.difficultyMultiplier) || 1;
    if (this.coopSession?.diagnostics) {
      Object.assign(this.coopSession.diagnostics, { stateSent: 0, stateDropped: 0, maxStateBufferedAmount: 0 });
    }
    this.reset();
    const actualMapSignature = this.map.layoutSignature?.();
    if (this.state.coop.role === 'guest' && !payload.mapSignature) {
      this.state.coop.running = false;
      this.state.coop.status = '房主未提供地图校验信息 // 请刷新并重建房间';
      this.state.coop.mapIncompatible = true;
      this.state.running = false;
      this.state.transitioning = false;
      this.ui.hideDescentTransition?.();
      this.coopSession.sendEvent('map-mismatch', { expected: 'signature-required', actual: actualMapSignature || '' });
      this.updateCoopUI();
      this.ui.showToast('地图校验信息缺失，未开始任务');
      return false;
    }
    if ((payload.mapSignature && actualMapSignature && payload.mapSignature !== actualMapSignature) ||
        (Array.isArray(payload.enemyTypes) && JSON.stringify(payload.enemyTypes) !== JSON.stringify(this.map.enemyTypes))) {
      this.state.coop.running = false;
      this.state.coop.status = '地图结构签名不一致 // 请刷新并重新加入房间';
      this.state.coop.mapIncompatible = true;
      this.state.missionHunterSettings = null;
      this.state.missionFinalTerminalSettings = null;
      this.state.running = false;
      this.state.transitioning = false;
      this.ui.hideDescentTransition?.();
      if (this.state.coop.role === 'guest') {
        this.coopSession.sendEvent('map-mismatch', { expected: payload.mapSignature, actual: actualMapSignature });
      }
      this.updateCoopUI();
      this.ui.showToast('地图版本或生成结构不一致，未开始任务');
      return false;
    }
    payload.mapSignature = actualMapSignature || payload.mapSignature || '';
    payload.enemyTypes = [...(this.map.enemyTypes || [])];
    this.state.coop.mapSignature = payload.mapSignature;
    this.state.armory = this.player.armory;
    if (localProfile?.spawn) {
      this.player.x = localProfile.spawn.x;
      this.player.y = localProfile.spawn.y;
    }
    const occupied = [{ id: localId, player: this.player }];
    if (this.state.coop.role === 'host' && !players.find(member => member.id === 'host').spawn) {
      players.find(member => member.id === 'host').spawn = { x: this.player.x, y: this.player.y };
      for (const member of players.filter(item => item.id !== 'host').sort((a, b) => a.slot - b.slot)) {
        const spawn = this._findCoopSpawnPoint(member.slot, occupied.map(item => item.player));
        member.spawn = spawn;
        occupied.push({ id: member.id, player: spawn });
      }
    }
    for (const member of players.filter(item => item.id !== localId)) {
      const player = new Player();
      player.reset(this.map, Player.normalizeArmory(member.armory), member.armory?.loadout?.primary ? 'primary' : 'sidearm');
      player.setMissionAmmoRules(this.state.selectedDifficulty);
      const spawn = member.spawn || this._findCoopSpawnPoint(member.slot, occupied.map(item => item.player));
      player.x = spawn.x;
      player.y = spawn.y;
      const entry = {
        id: member.id, slot: member.slot, player, online: true, status: 'connected', ready: true,
        input: { keys: {}, aim: 0, aiming: false, activeSlot: player.activeSlot, flashlight: player.flashlight, fire: false, seq: 0 },
        inventory: Array.isArray(member.backpackItems) ? member.backpackItems.map(item => ({ ...item })) : [],
        backpack: BackpackManager.fromType(Config.activeBackpack),
        qte: null, offlineAt: 0
      };
      entry.backpack.items = entry.inventory;
      this.remotePlayers.set(member.id, entry);
      occupied.push({ id: member.id, player });
    }
    this._syncLegacyRemoteAliases();
    if (this.state.coop.role === 'host') payload.players = players;
    this.start();
    this.state.coop.running = true;
    this.state.coop.status = `CO-OP ACTIVE // ${players.length} 名队员任务进行中`;
    if (this.state.coop.role === 'host') {
      this.coopSession.setRoomStatus('active');
      this._handleCoopFocusChange();
    }
    this.updateCoopUI();
    return true;
  }

  async _handleCoopMessage(channel, message, peerId = null) {
    if (channel === 'events' && message.type === 'equipment-state-page' && this.state.coop.role === 'guest') {
      this.equipment?.receivePage(message); return;
    }
    if (channel === 'events' && message.type === 'equipment-state-request' && this.state.coop.role === 'host' &&
        message.missionId === this.state.missionFxId && this.remotePlayers?.get(peerId)?.online) {
      this.equipment?.queueFull(peerId); return;
    }
    if (channel === 'events' && message.type === 'equipment-state-ready' && this.state.coop.role === 'host' && message.missionId === this.state.missionFxId) {
      const entry = this.remotePlayers?.get(peerId);
      if (entry?.equipmentTransferId === message.transferId) entry.equipmentSyncing = false;
      return;
    }
    if (channel === 'events' && message.type === 'equipment-event' && this.state.coop.role === 'guest' && this.state.running) {
      this.equipment?.apply(message); return;
    }
    if (channel === 'events' && message.type === 'reward-access' && this.state.coop.role === 'guest') {
      let accepted = false;
      try {
        if (message.access?.missionId === message.missionId && message.access.playerId === this.state.coop.playerId) {
          await this.rewards.rememberAccess(message.access);accepted = true;
        }
      } catch (_) { this.ui.showToast('无法保存本局结算凭据，请检查浏览器存储空间'); }
      this.coopSession.sendEvent('reward-access-ready', { missionId: message.missionId, accepted });
    } else if (channel === 'events' && message.type === 'reward-access-ready' && this.state.coop.role === 'host') {
      if (this._rewardAccessConfirmation?.missionId === message.missionId) this._rewardAccessConfirmation.accept(peerId, message.accepted === true);
    } else if (channel === 'events' && message.type === 'loot-request' && this.state.coop.role === 'host') {
      this.loot.handleRequest(message, peerId);
    } else if (channel === 'events' && message.type === 'loot-open' && this.state.coop.role === 'host') {
      const entry = this.remotePlayers.get(peerId), box = this.map.containers.find(box => box.id === message.containerId);
      if (message.missionId === this.state.missionFxId && entry?.online && box && this.loot.canReach(entry.player, box)) this.loot.broadcastBox(box.id, peerId);
    } else if (channel === 'events' && message.type === 'loot-opened' && this.state.coop.role === 'guest') {
      if (message.missionId === this.state.missionFxId) this.loot.open(this.map.containers.find(box => box.id === message.containerId));
    } else if (channel === 'events' && message.type === 'loot-update' && this.state.coop.role === 'guest') {
      this.loot.applyUpdate(message);
    } else if (channel === 'events' && message.type === 'loot-result' && this.state.coop.role === 'guest') {
      this.loot.applyResult(message);
    } else if (message.type === 'member-kicked' && this.state.coop.role === 'guest') {
      this.ui.showToast(message.reason || '房主已将你移出当前房间');
      this.leaveCoopRoom();
    } else if (message.type === 'reward-refresh' && this.state.coop.role === 'guest') {
      this.rewards.flush().catch(() => {});
    } else if (message.type === 'hello') {
      const member = this._upsertCoopMember({ id: peerId || message.playerId, slot: message.slot, status: 'connected', connected: true });
      if (member && !this.state.coop.running) {
        member.armory = Player.normalizeArmory(message.armory);
        if (Array.isArray(message.backpackItems)) member.backpackItems = message.backpackItems.slice(0, 100).map(item => ({ ...item }));
      }
      this._broadcastCoopRoster();
      this.updateCoopUI();
    } else if (message.type === 'friendly-fire' && this.state.coop.role === 'guest' && !this.state.coop.running) {
      this.state.coop.friendlyFire = message.enabled !== false;
      this.updateCoopUI();
    } else if (message.type === 'coop-pause' && this.state.coop.role === 'guest') {
      this._setCoopPauseState(!!message.paused, message.reason === 'menu' ? 'menu' : 'focus');
    } else if (message.type === 'abandon-request' && this.state.coop.role === 'host') {
      this._handleCoopAbandonRequest(message, peerId);
    } else if (message.type === 'request-roster' && this.state.coop.role === 'host') {
      this._broadcastCoopRoster(peerId, true);
    } else if (message.type === 'room-roster' && this.state.coop.role === 'guest') {
      const coop = this.state.coop;
      const revision = Number(message.revision) || 0;
      if (revision && revision < (coop.rosterRevision || 0)) return;
      coop.rosterRevision = revision;
      coop.hostReady = !!message.hostReady;
      coop.hostDifficulty = Config.difficultyPresets[message.difficulty] ? message.difficulty : null;
      coop.hostLoadout = message.hostLoadout || null;
      coop.hostSummary = message.hostSummary || null;
      coop.previewReady = false;
      if (message.mapSeeds && Object.keys(Config.mapScales).every(scale => Number.isFinite(message.mapSeeds[scale]))) {
        this.state.menuMapSeeds = { ...message.mapSeeds };
        if (Config.mapScales[message.scale]) Config.currentScale = message.scale;
        coop.previewReady = !!coop.hostDifficulty && !!Config.mapScales[message.scale] && typeof message.mapSignature === 'string' && !!message.mapSignature;
        coop.hostMapSignature = message.mapSignature || null;
        if (coop.previewReady) {
          try { coop.mapIncompatible = this.getMenuPreviewMap(message.scale)?.layoutSignature?.() !== message.mapSignature; }
          catch (_) { coop.mapIncompatible = true; }
          if (coop.mapIncompatible) { coop.previewReady = false; this.ui.showToast('房主地图资料不一致，请刷新并重新加入房间'); }
        }
        this.ui?.updateScaleButtons?.(Config.currentScale);
        this.menu?.queueRefresh();
      }
      coop.members = Array.isArray(message.members) ? message.members.map(member => ({
        ...member,
        connected: member.connected === true || member.status === 'connected'
      })) : [];
      const localMember = coop.members.find(member => member.id === coop.playerId);
      if (localMember) {
        coop.localReady = !!localMember.ready;
        if (coop.readyPending && localMember.readyRequestId === coop.readyPendingRequestId) this._clearReadyPending();
      }
      this.updateCoopUI();
    } else if (message.type === 'ready-ack' && this.state.coop.role === 'guest') {
      this._applyReadyAcknowledgment(message);
    } else if (message.type === 'weapon-fired' && this.state.coop.role === 'guest') {
      this._receiveWeaponFired(message);
    } else if (message.type === 'corpse-delta' && channel === 'events' && this.state.coop.role === 'guest') {
      this._applyCorpseDelta(message);
    } else if (message.type === 'heavy-impact' && channel === 'events' && this.state.coop.role === 'guest') {
      this._acceptWallImpact(message);
    } else if (message.type === 'skill-result' && this.state.coop.role === 'guest') {
      if (this._pendingSkillRequest?.requestId === message.requestId) {
        this._pendingSkillRequest = null;
        if (Number.isSafeInteger(message.lastRequestId)) this._skillRequestSequence = Math.max(this._skillRequestSequence || 0, message.lastRequestId);
        if (Number.isFinite(message.readyAt)) this.player.skillReadyAt = message.readyAt;
        if (message.accepted) this._tutorialAction('skill');
        else this.ui.showToast('技能尚未就绪或当前无法使用');
      }
    } else if (message.type === 'flash-exploded' && this.state.coop.role === 'guest' && this.state.running) {
      if (typeof message.id === 'string' && Number.isFinite(message.x) && Number.isFinite(message.y)) this._showFlashBurst(message);
    } else if (message.type === 'ready') {
      if (this.state.coop.role === 'host') {
        const peer = this.coopSession.peers.get(peerId);
        const member = peer?.connected && Number.isInteger(peer.slot) && peer.slot >= 2 && peer.slot <= 4
          ? this._upsertCoopMember({ id: peerId, slot: peer.slot, status: 'connected', connected: true })
          : null;
        if (member) {
          member.ready = !!message.ready;
          member.readyRequestId = Number(message.requestId) || null;
          member.armory = Player.normalizeArmory(message.armory);
          if (Array.isArray(message.backpackItems)) member.backpackItems = message.backpackItems.map(item => ({ ...item }));
        }
        if (peerId) this.coopSession.sendEvent('ready-ack', {
          requestId: message.requestId,
          accepted: !!member,
          ready: !!member && member.ready,
          memberId: peerId,
          slot: member?.slot,
          reason: member ? '' : '房主尚未同步你的队员席位，请稍候再试'
        }, peerId);
        this._broadcastCoopRoster();
      } else {
        this.state.coop.hostReady = !!message.ready;
      }
      this.updateCoopUI();
    } else if (message.type === 'start' && this.state.coop.role === 'guest') {
      if (message.rewardAccess && !await this._rememberRewardAccess(message.rewardAccess)) return;
      this._beginCoopMission(message);
    } else if (message.type === 'map-mismatch' && this.state.coop.role === 'host') {
      this._abortCoopMissionForMapMismatch();
    } else if (message.type === 'map-mismatch-abort' && this.state.coop.role === 'guest') {
      this._abortCoopMissionForMapMismatch();
    } else if (message.type === 'rejoin-state' && this.state.coop.role === 'guest') {
      if (message.startPayload?.rewardAccess && !await this._rememberRewardAccess(message.startPayload.rewardAccess)) return;
      if (!this.state.coop.running && message.startPayload) this._beginCoopMission(message.startPayload);
      if (message.equipmentPending) {
        this.state.equipmentSyncing = true;
        this.coopSession.sendEvent('equipment-state-request', { missionId: this.state.missionFxId });
        this._equipmentRequestAt = performance.now();
      }
      if (this.state.coop.running && Number.isFinite(message.snapshot?.tick) &&
          message.snapshot.tick >= (this._lastSnapshotTick ?? -1) && this._applyCoopSnapshot(message.snapshot, true)) {
        this._lastSnapshotTick = message.snapshot.tick;
        this.state.coop.lastSnapshotAt = performance.now();
        this.state.keys = {};
        this.state.fireHeld = false;
        this._updateCoopNetworkStatus();
        this._sendGuestInput(true);
      }
      // Reliable corpse history has its own revision; a newer movement tick must not discard it.
      if (channel === 'events' && this.state.coop.running && message.corpses) this._applyCorpseDelta(message.corpses, true);
      if (channel === 'events' && this.state.coop.running && message.containers) this.loot.restore(message.containers);
      if (channel === 'events' && this.state.coop.running && message.equipment) this.equipment?.restore(message.equipment);
      if (channel === 'events' && this.state.coop.running && Number.isSafeInteger(message.containerRequestSeq)) {
        this.loot.requestSequence = Math.max(this.loot.requestSequence, message.containerRequestSeq);
      }
    } else if (message.type === 'input' && this.state.coop.role === 'host') {
      const remote = this.remotePlayers.get(peerId);
      if (remote && remote.online !== false && !this.state.coop.hostPaused &&
          Number.isSafeInteger(message.seq) && message.seq >= 0 && message.seq > (remote.input?.seq ?? -1)) {
        remote.input = message;
        remote.lastInputAt = performance.now();
        remote.inputStale = false;
        this._syncLegacyRemoteAliases();
      }
    } else if (message.type === 'inventory-layout' && this.state.coop.role === 'host') {
      this._applyGuestInventoryLayout(message.items, peerId);
    } else if (message.type === 'inventory-discard' && this.state.coop.role === 'host') {
      this._discardGuestInventoryItem(message, peerId);
    } else if (message.type === 'snapshot' && this.state.coop.role === 'guest') {
      if (!this.state.coop.hostPaused && Number.isFinite(message.tick) && message.tick > (this._lastSnapshotTick ?? -1) &&
          this._applyCoopSnapshot(message)) {
        this.state.coop.snapshotTickGapMs = this._lastSnapshotTick >= 0 ? message.tick - this._lastSnapshotTick : 0;
        this._lastSnapshotTick = message.tick;
        const now = performance.now();
        if (this.state.coop.lastSnapshotAt) this.state.coop.snapshotIntervalMs = now - this.state.coop.lastSnapshotAt;
        this.state.coop.lastSnapshotAt = now;
        this.state.coop.stateBufferDrops = this.coopSession?.diagnostics?.stateDropped || 0;
        this._updateCoopNetworkStatus();
      }
    } else if (message.type === 'action' && this.state.coop.role === 'host') {
      this._handleRemoteAction(message, peerId);
    } else if (message.type === 'finish' && this.state.coop.role === 'guest') {
      this._finishGuestCoop(message);
    } else if (message.type === 'qte-start' && this.state.coop.role === 'guest') {
      const terminal = this.map.terminals.find((item) => item.id === message.terminalId);
      if (terminal) {
        this.state.activeQte = { terminal, sequence: message.sequence, currentIndex: 0, failCount: 0, maxFails: 3, timeLeft: 10, maxTime: 10, remoteOwned: true };
        this._sendGuestInput(true);
        this.ui.showQTE(terminal, 0, false, 0, 3);
      }
    } else if (message.type === 'qte-progress' && this.state.coop.role === 'guest' && this.state.activeQte) {
      this.state.activeQte.currentIndex = message.currentIndex;
      this.state.activeQte.failCount = message.failCount;
      this.ui.showQTE(this.state.activeQte.terminal, message.currentIndex, !!message.failed, message.failCount, 3);
    } else if ((message.type === 'qte-complete' || message.type === 'qte-fail') && this.state.coop.role === 'guest') {
      if (message.type === 'qte-complete') {
        const terminal = this.map.terminals.find((item) => item.id === message.terminalId);
        let pressureActivated = false;
        if (terminal) {
          terminal.solved = true;
          pressureActivated = this._activateFinalTerminalPressure();
        }
        if (!pressureActivated) this.ui.showToast('终端已激活！');
      } else {
        this.ui.showToast('终端过载，受到电击！');
      }
      this.state.activeQte = null;
      this.ui.hideQTE();
    }
  }

  _abortCoopMissionForMapMismatch() {
    const isHost = this.state.coop.role === 'host';
    if (!isHost && this.state.coop.role !== 'guest') return false;
    if (isHost && this.state.coop.running) this.coopSession.sendEvent('map-mismatch-abort', {});
    if (this.state.descentTimer) clearTimeout(this.state.descentTimer);
    this.state.descentTimer = null;
    this.state.transitioning = false;
    this.state.running = false;
    this.state.coop.running = false;
    this.state.coop.hostPaused = false;
    this.state.missionHunterSettings = null;
    this.state.missionFinalTerminalSettings = null;
    this.state.coop.status = '地图结构不一致 // 已取消下潜，请全员刷新并重建房间';
    this.state.coop.mapIncompatible = true;
    this.state.keys = {};
    this.state.fireHeld = false;
    this.ui.hideDescentTransition?.();
    this.ui.setCoopPaused?.(false);
    if (isHost) this.coopSession.setRoomStatus('lobby');
    this.state.loot = 0;
    this.state.lootValue = 0;
    this.state.elapsed = 0;
    this.state.remoteInventory = [];
    this.remotePlayers?.clear?.();
    this._syncLegacyRemoteAliases();
    this.state.activeQte = null;
    this.state.inventoryOpen = false;
    this.state.inventoryClosing = false;
    this.state.fullMapOpen = false;
    this.state.fullMapClosing = false;
    this.state.muzzleFlashes.length = 0;
    this.state.bulletTraces.length = 0;
    this.state.impactParticles.length = 0;
    for (const monster of this.nightmares || []) monster.active = false;
    for (const heavy of this.heavies || []) Object.assign(heavy, { active: false, dead: false, corpseTime: 0 });
    this._clearEnemyEffects();
    this.state.flashbangs = [];
    this.state.flashBursts = [];
    this.hunters?.forEach(hunter => { hunter.active = false; });
    this.ui.hideQTE?.();
    this.ui.hideTutorial?.();
    this.ui.setFullMapVisible?.(false);
    document.body.classList.remove('in-dive');
    this.audio.stopMissionAudio?.();
    this._save();
    this.ui.showToast('队友地图结构不同，任务已取消；物资仍保留在背包');
    this.updateCoopUI();
    return true;
  }

  _playerSnapshot(player) {
    if (!player) return null;
    return {
      x: player.x, y: player.y, angle: player.angle,
      health: player.health, oxygen: player.oxygen, stamina: player.stamina, staminaLocked: player.staminaLocked,
      staminaRegenDelay: player.staminaRegenDelay,
      noise: player.noise, ammo: player.ammo, reserveAmmo: player.infiniteReserve ? 0 : player.reserveAmmo,
      infinitePistol: !!player.missionPistolAmmo,
      reloading: player.reloading, weaponId: player.weaponId, flashlight: player.flashlight,
      armory: player.exportArmory(), weaponTimers: structuredClone(player.weaponTimers),
      activeSlot: player.activeSlot, dodgeTimer: player.dodgeTimer,
      dodgeDirectionX: player.dodgeDirectionX, dodgeDirectionY: player.dodgeDirectionY,
      meleeCooldown: player.meleeCooldown, meleeVisualTimer: player.meleeVisualTimer,
      downed: !!player.downed, bleedout: player.bleedout || 0,
      reviveProgress: player.reviveProgress || 0,
      flashStunTimer: player.flashStunTimer || 0,
      supplyUse: player.supplyUse ? { ...player.supplyUse } : null,
      lastSupplyRequestId: this._remoteEntryForActor(player)?.lastSupplyRequestId || 0,
      shieldUntil: player.shieldUntil || 0, shieldReadyAt: player.shieldReadyAt || 0,
      barrierRemoval: player.barrierRemoval ? { ...player.barrierRemoval } : null,
      skillReadyAt: player.skillReadyAt || 0,
      lastSkillRequestId: this._remoteEntryForActor(player)?.lastSkillRequestId || 0
    };
  }

  _applyPlayerSnapshot(player, snapshot, blend = 1) {
    if (!player || !snapshot) return;
    if (snapshot.armory) player.configureArmory(snapshot.armory, snapshot.activeSlot);
    if (!!player.missionPistolAmmo !== !!snapshot.infinitePistol) player.setMissionAmmoRules(snapshot.infinitePistol ? 'easy' : null);
    if (player.infiniteReserve && Number.isFinite(snapshot.ammo)) player.ammo = snapshot.ammo;
    if (snapshot.weaponTimers) player.weaponTimers = structuredClone(snapshot.weaponTimers);
    const errorX = snapshot.x - player.x;
    const errorY = snapshot.y - player.y;
    if (Math.hypot(errorX, errorY) > 48 || blend >= 1) {
      player.x = snapshot.x;
      player.y = snapshot.y;
    } else {
      player.x += errorX * blend;
      player.y += errorY * blend;
    }
    player.angle = snapshot.angle;
    player.supplyUse = snapshot.supplyUse ? { ...snapshot.supplyUse } : null;
    player.barrierRemoval = snapshot.barrierRemoval ? { ...snapshot.barrierRemoval } : null;
    player.shieldUntil = Number(snapshot.shieldUntil) || 0;
    player.shieldReadyAt = Number(snapshot.shieldReadyAt) || 0;
    if (player === this.player && Number.isSafeInteger(snapshot.lastSupplyRequestId)) {
      this._supplyRequestSequence = Math.max(this._supplyRequestSequence || 0, snapshot.lastSupplyRequestId);
      if (this._pendingSupplyRequest?.requestId <= snapshot.lastSupplyRequestId) this._pendingSupplyRequest = null;
    }
    if (Number.isFinite(snapshot.skillReadyAt)) player.skillReadyAt = snapshot.skillReadyAt;
    if (player === this.player && Number.isSafeInteger(snapshot.lastSkillRequestId) && snapshot.lastSkillRequestId >= 0) {
      this._skillRequestSequence = Math.max(this._skillRequestSequence || 0, snapshot.lastSkillRequestId);
      if (this._pendingSkillRequest && snapshot.lastSkillRequestId >= this._pendingSkillRequest.requestId) {
        if (snapshot.skillReadyAt > this._pendingSkillRequest.beforeReadyAt) this._tutorialAction('skill');
        this._pendingSkillRequest = null;
      }
    }
    for (const key of ['health', 'oxygen', 'stamina', 'staminaLocked', 'staminaRegenDelay', 'noise', 'flashlight', 'bleedout', 'reviveProgress', 'dodgeTimer', 'dodgeDirectionX', 'dodgeDirectionY', 'meleeCooldown', 'meleeVisualTimer', 'flashStunTimer']) {
      if (snapshot[key] != null) player[key] = snapshot[key];
    }
    player.invulnerableThisFrame = player.dodgeTimer > 0;
    player.downed = !!snapshot.downed;
    if (player === this.player && (player.downed || player.flashStunTimer > 0)) this.state.stabilized = false;
  }

  _createCoopSnapshot() {
    const players = this._coopRosterEntries();
    players.filter(entry => entry.online !== false).forEach(entry => {
      const room = this.map.getRoomAt?.(entry.player.x, entry.player.y);
      if (room) room.discovered = true;
    });
    return {
      tick: Math.round(this.state.elapsed * 1000),
      equipmentRevision: this.equipment?.revision || 0,
      mapSignature: this.map.layoutSignature?.() || this.state.coop?.mapSignature || '',
      networkDiagnostics: {
        stateDropped: this.coopSession?.diagnostics?.stateDropped || 0,
        maxStateBufferedAmount: this.coopSession?.diagnostics?.maxStateBufferedAmount || 0
      },
      discoveredRooms: (this.map.worldRooms || [])
        .map((room, index) => room.discovered ? index : null)
        .filter(index => index != null),
      players: players.map(entry => ({
        id: entry.id,
        state: this._playerSnapshot(entry.player),
        online: entry.online !== false,
        slot: entry.slot || 1,
        inventoryRevision: entry.local ? this.state.inventoryRevision || 0 : this.remotePlayers.get(entry.id)?.inventoryRevision || 0,
        inventory: (entry.inventory || []).map(item => ({ ...item }))
      })),
      qtes: [...(this.remotePlayers?.values?.() || [])].filter(entry => entry.qte).map(entry => ({
        playerId: entry.id,
        terminalId: entry.qte.terminal.id,
        sequence: entry.qte.sequence,
        currentIndex: entry.qte.currentIndex,
        failCount: entry.qte.failCount,
        timeLeft: entry.qte.timeLeft
      })),
      nightmares: (this.nightmares || []).map(monster => ({ id: monster.id,
        x: monster.x, y: monster.y, angle: monster.angle,
        active: monster.active, alerted: monster.alerted,
        recoverTimer: monster.recoverTimer, flashStunTimer: monster.flashStunTimer || 0,
        sleepCycle: monster.sleepCycle || 0, recoveryDuration: monster.recoveryDuration, discoveryTimer: monster.discoveryTimer || 0
      })),
      hunters: this.hunters.map((hunter) => ({
        spawnIndex: hunter.spawnIndex, maxHp: hunter.maxHp,
        x: hunter.x, y: hunter.y, angle: hunter.angle, active: hunter.active,
        dead: hunter.dead, hp: hunter.hp, deathFade: hunter.deathFade, corpseTime: hunter.corpseTime || 0,
        trait: hunter.trait, reviveUsed: hunter.reviveUsed, discoveryTimer: hunter.discoveryTimer || 0,
        revivePending: hunter.revivePending, reviveTimer: hunter.reviveTimer, flashStunTimer: hunter.flashStunTimer || 0,
        ambushTriggered: hunter.ambushTriggered, ambushTarget: hunter.ambushTarget
      })),
      heavies: (this.heavies || []).map(heavy => Object.fromEntries(['id', 'x', 'y', 'angle', 'active', 'dead', 'hp', 'maxHp', 'radius', 'phase', 'phaseTimer', 'stunTimer', 'chargeAngle', 'discoveryTimer']
        .map(key => [key, heavy[key]]))),
      flashbangs: (this.state.flashbangs || []).map(grenade => ({
        id: grenade.id, ownerId: grenade.ownerId, skillId: grenade.skillId, x: grenade.x, y: grenade.y,
        remainingDistance: grenade.remainingDistance, landed: grenade.landed, fuse: grenade.fuse, angle: grenade.angle
      })),
      doors: this.map.doors.map((door) => ({
        open: door.open,
        targetOpen: door.targetOpen ?? door.open,
        animationProgress: door.animationProgress ?? (door.open ? 1 : 0),
        openDir: door.openDir, autoCloseTimer: door.autoCloseTimer || 0, autoClosing: !!door.autoClosing
      })),
      scrap: this.map.scrap.map((item) => ({ id: item.id, found: item.found, x: item.x, y: item.y })),
      terminals: this.map.terminals.map((terminal) => ({ solved: terminal.solved })),
      mission: {
        elapsed: this.state.elapsed, extractionCalled: this.state.extractionCalled,
        rescueRemaining: this.state.rescueRemaining, rescueArrived: this.state.rescueArrived,
        rescuePresent: this.state.rescuePresent, rescueRequired: this.state.rescueRequired,
        loot: this.state.loot, lootValue: this.state.lootValue,
        finalTerminalPressure: this.state.finalTerminalPressure,
        powerLossStartedAt: this.state.powerLossStartedAt ?? null
      },
      bulletTraces: this.state.bulletTraces.slice(-20),
      impactParticles: this.state.impactParticles.slice(-80)
    };
  }

  _coopRosterEntries() {
    const localId = this.state.coop?.playerId || 'host';
    const remotes = this.remotePlayers && typeof this.remotePlayers.values === 'function'
      ? [...this.remotePlayers.values()]
      : Array.isArray(this.remotePlayers) ? this.remotePlayers : [];
    const remoteEntries = remotes.map(entry => ({
      ...entry,
      player: entry.player || entry,
      inventory: entry.inventory || []
    }));
    if (!remoteEntries.length && this.remotePlayer) {
      remoteEntries.push({ id: localId === 'host' ? 'guest' : 'host', player: this.remotePlayer, online: true, inventory: this.state.remoteInventory || [] });
    }
    return [
      { id: localId, player: this.player, local: true, online: this.state.coop?.role !== 'guest' || this.state.coop.connected, inventory: this.state.inventory || [] },
      ...remoteEntries
    ];
  }

  _onlineCoopPlayers(exceptId = null) {
    return this._coopRosterEntries()
      .filter(entry => entry.online !== false && entry.id !== exceptId)
      .map(entry => entry.player);
  }

  _isCoopPlayer(player) {
    return player === this.player || [...(this.remotePlayers?.values?.() || [])].some(entry => entry.player === player) ||
      (!this.remotePlayers?.size && player === this.remotePlayer);
  }

  _remoteEntryForActor(actor) {
    for (const entry of this.remotePlayers?.values?.() || []) {
      if (entry.player === actor) return entry;
    }
    return null;
  }

  _recordRemotePose(entry, pose, reset = false) {
    const samples = entry.renderSamples || [];
    const previous = samples[samples.length - 1];
    const now = performance.now();
    if (reset || !previous || Math.hypot(pose.x - previous.x, pose.y - previous.y) > 48) {
      entry.renderSamples = [];
    }
    const history = entry.renderSamples || (entry.renderSamples = []);
    if (history.length && history[history.length - 1].at === now) history.pop();
    history.push({ at: now, x: pose.x, y: pose.y, angle: pose.angle });
    while (history.length > 8) history.shift();
  }

  _coopRenderPlayers() {
    this.state.mapEnemies = [...(this.nightmares || []), ...(this.hunters || []), ...(this.heavies || [])];
    const time = performance.now() - 100;
    return [...(this.remotePlayers?.values?.() || [])].map(entry => {
      let player = entry.player;
      const samples = entry.renderSamples;
      if (this.state.coop?.role === 'guest' && samples?.length) {
        while (samples.length > 2 && samples[1].at <= time) samples.shift();
        const a = samples[0];
        const b = samples.find(sample => sample.at > time) || samples[samples.length - 1];
        const fraction = b.at > a.at ? Math.max(0, Math.min(1, (time - a.at) / (b.at - a.at))) : 1;
        player = entry.renderPlayer || (entry.renderPlayer = Object.create(entry.player));
        player.x = a.x + (b.x - a.x) * fraction;
        player.y = a.y + (b.y - a.y) * fraction;
        const turn = Math.atan2(Math.sin(b.angle - a.angle), Math.cos(b.angle - a.angle));
        player.angle = a.angle + turn * fraction;
      }
      return { id: entry.id, slot: entry.slot, player, online: entry.online !== false };
    });
  }

  _updateCoopNetworkStatus() {
    const coop = this.state.coop;
    const delayed = !!(this.state.running && coop?.running && coop.role === 'guest' && !coop.hostPaused &&
      Number.isFinite(coop.lastSnapshotAt) && performance.now() - coop.lastSnapshotAt > 500);
    this.ui?.setCoopNetworkStatus?.(delayed);
  }

  _applyCoopSnapshot(snapshot, resetDisplay = false) {
    if (this.equipment && snapshot.equipmentRevision > this.equipment.revision && !this.equipment.receiving &&
        performance.now() - (this._equipmentRequestAt || -Infinity) > 1500) {
      this._equipmentRequestAt = performance.now();
      this.coopSession.sendEvent('equipment-state-request', { missionId: this.state.missionFxId });
    }
    if (!this.state.coop.running || this.state.coop.role !== 'guest') return false;
    const localId = this.state.coop.playerId || this.coopSession?.memberId || 'guest';
    if (!Number.isFinite(snapshot.tick) || snapshot.tick < 0 || !Array.isArray(snapshot.players) ||
        snapshot.players.length > 4 || !snapshot.players.some(entry => entry?.id === localId) ||
        snapshot.players.some(entry => !entry || typeof entry.id !== 'string' || !Array.isArray(entry.inventory) ||
          !['x', 'y', 'angle'].every(key => Number.isFinite(entry.state?.[key]))) ||
        new Set(snapshot.players.map(entry => entry.id)).size !== snapshot.players.length) return false;
    const localSignature = this.map.layoutSignature?.();
    if (snapshot.mapSignature && localSignature && snapshot.mapSignature !== localSignature) {
      if (!this.state.coop.mapMismatchReported) {
        this.state.coop.mapMismatchReported = true;
        this.coopSession.sendEvent('map-mismatch', { expected: snapshot.mapSignature, actual: localSignature });
        this.ui.showToast('房间地图结构与主机不同，正在取消任务');
      }
      return false;
    }
    if (Array.isArray(snapshot.discoveredRooms)) {
      const discovered = new Set(snapshot.discoveredRooms);
      this.map.worldRooms.forEach((room, index) => { room.discovered = discovered.has(index); });
    }
    if (snapshot.networkDiagnostics) {
      this.state.coop.hostStateDrops = Number(snapshot.networkDiagnostics.stateDropped) || 0;
      this.state.coop.hostMaxStateBufferedAmount = Number(snapshot.networkDiagnostics.maxStateBufferedAmount) || 0;
    }
    let inventoryInputs = null;
    if (Array.isArray(snapshot.players)) {
      const localState = snapshot.players.find(entry => entry.id === localId);
      if (localState) this._applyPlayerSnapshot(this.player, localState.state, resetDisplay ? 1 : 0.35);
      const remoteIds = new Set(snapshot.players.filter(entry => entry.id !== localId).map(entry => entry.id));
      for (const state of snapshot.players) {
        if (state.id === localId) continue;
        let remote = this.remotePlayers.get(state.id);
        if (!remote) {
          const player = new Player();
          player.reset(this.map, state.state?.armory || Player.createDefaultArmory());
          remote = {
            id: state.id, slot: state.slot, player, online: state.online !== false,
            status: state.online === false ? 'offline' : 'connected', input: { keys: {}, aiming: false, seq: 0 },
            inventory: [], backpack: BackpackManager.fromType(Config.activeBackpack), qte: null
          };
          remote.backpack.items = remote.inventory;
          this.remotePlayers.set(state.id, remote);
        }
        remote.online = state.online !== false;
        remote.status = remote.online ? 'connected' : 'offline';
        this._recordRemotePose(remote, state.state, resetDisplay);
        this._applyPlayerSnapshot(remote.player, state.state, 1);
      }
      for (const id of this.remotePlayers.keys()) {
        if (!remoteIds.has(id)) this.remotePlayers.delete(id);
      }
      this._syncLegacyRemoteAliases();
      inventoryInputs = Object.fromEntries(snapshot.players.map(entry => [entry.id, entry.inventory || []]));
      const qtes = Array.isArray(snapshot.qtes) ? snapshot.qtes : [];
      for (const entry of this.remotePlayers.values()) entry.qte = qtes.find(qte => qte.playerId === entry.id) || null;
      const localQte = qtes.find(qte => qte.playerId === localId);
      if (localQte) {
        const terminal = this.map.terminals.find(item => item.id === localQte.terminalId);
        if (terminal) {
          this.state.activeQte = {
            terminal, sequence: localQte.sequence, currentIndex: localQte.currentIndex,
            failCount: localQte.failCount, maxFails: 3, timeLeft: localQte.timeLeft, maxTime: 10, remoteOwned: true
          };
          this.ui.showQTE(terminal, localQte.currentIndex, false, localQte.failCount, 3);
        }
      } else if (this.state.activeQte?.remoteOwned) {
        this.state.activeQte = null;
        this.ui.hideQTE();
      }
    }
    this.state.armory = this.player.armory;
    if (Array.isArray(snapshot.nightmares) && snapshot.nightmares.length <= 8 &&
        new Set(snapshot.nightmares.map(monster => monster?.id)).size === snapshot.nightmares.length &&
        snapshot.nightmares.every(monster => typeof monster?.id === 'string' && ['x', 'y', 'angle'].every(key => Number.isFinite(monster[key])))) {
      const existing = new Map((this.nightmares || []).map(monster => [monster.id, monster]));
      this.nightmares = snapshot.nightmares.map(data => Object.assign(existing.get(data.id) || new Monster(), data));
      this.state.nightmares = this.nightmares;
    }
    if (Array.isArray(snapshot.heavies) && snapshot.heavies.length <= 10 &&
        new Set(snapshot.heavies.map(heavy => heavy?.id)).size === snapshot.heavies.length &&
        snapshot.heavies.every(heavy => typeof heavy?.id === 'string' && ['x', 'y', 'angle', 'radius'].every(key => Number.isFinite(heavy[key])))) {
      const existing = new Map((this.heavies || []).map(heavy => [heavy.id, heavy]));
      this.heavies = snapshot.heavies.map(state => Object.assign(existing.get(state.id) || new Heavy(state.maxHp), state));
      this.state.heavies = this.heavies;
    }
    this.state.flashbangs = Array.isArray(snapshot.flashbangs) ? snapshot.flashbangs.map(item => ({ ...item })) : [];
    (snapshot.hunters || []).forEach((state, index) => {
      if (!this.hunters[index]) {
        const hunter = new Hunter(state.spawnIndex ?? index, state.maxHp ?? Config.hunter.maxHp, () => 1);
        hunter.reset(this.map, state.maxHp ?? Config.hunter.maxHp);
        this.hunters[index] = hunter;
      }
      Object.assign(this.hunters[index], state);
    });
    this.nextHunterSpawnIndex = Math.max(
      this.nextHunterSpawnIndex || 0,
      ...this.hunters.map(hunter => (hunter.spawnIndex || 0) + 1)
    );
    (snapshot.doors || []).forEach((state, index) => {
      const door = this.map.doors[index];
      if (!door) return;
      Object.assign(door, state, {
        targetOpen: typeof state.targetOpen === 'boolean' ? state.targetOpen : !!state.open,
        animationProgress: Number.isFinite(state.animationProgress) ? state.animationProgress : (state.open ? 1 : 0)
      });
    });
    (snapshot.scrap || []).forEach((state, index) => {
      if (this.map.scrap[index]) Object.assign(this.map.scrap[index], {
        found: !!state.found,
        ...(Number.isFinite(state.id) ? { id: state.id } : {}),
        ...(Number.isFinite(state.x) ? { x: state.x } : {}),
        ...(Number.isFinite(state.y) ? { y: state.y } : {})
      });
    });
    (snapshot.terminals || []).forEach((state, index) => {
      if (this.map.terminals[index]) this.map.terminals[index].solved = !!state.solved;
    });
    this.ui.updateTerminalsStatus(this.map.terminals);
    if (snapshot.mission) {
      const pressureWasActive = this.state.finalTerminalPressure;
      Object.assign(this.state, snapshot.mission, {
        finalTerminalPressure: !!snapshot.mission.finalTerminalPressure
      });
      this._lockFinalTerminalNoise();
      this.ui.updateExtractionProgress?.(this.state);
      if (!pressureWasActive && this.state.finalTerminalPressure) {
        const settings = this._getFinalTerminalSettings();
        this.ui.showToast(this._hasEnemyType('hunter') ? '舱室供电中断 · 撤离点已标记：噪音锁定 100 / 无限猎手增援' : '舱室供电中断 · 撤离点已标记：全员噪音锁定 100');
        this.ui.log(`警报：噪音锁定 100；本局敌人按 ${settings.spawnInterval} 秒轮次增援。`);
      }
    }
    const localRevision = snapshot.players?.find(entry => entry.id === localId)?.inventoryRevision || 0;
    const localItems = localRevision < (this.state.inventoryRevision || 0) ? this.backpack.items : inventoryInputs?.[localId] || [];
    this.state.inventoryRevision = Math.max(this.state.inventoryRevision || 0, localRevision);
    if (inventoryInputs) inventoryInputs[localId] = localItems;
    const hostItems = inventoryInputs?.host || [];
    const renderInventory = this._applyCoopInventorySnapshot(localItems, hostItems, inventoryInputs);
    if (renderInventory) {
      this._refreshFlashbangStock();
      this._save();
    }
    this.state.bulletTraces = Array.isArray(snapshot.bulletTraces) ? snapshot.bulletTraces : [];
    this.state.impactParticles = Array.isArray(snapshot.impactParticles) ? snapshot.impactParticles : [];
    if (renderInventory) this.updateInventoryUI();
    return true;
  }

  _applyCoopInventorySnapshot(guestItems, hostItems, inventoriesById = null) {
    const dragging = !!this._itemDrag;
    let changed = false;
    if (this._guestInventoryLayoutPending && !dragging && this._guestInventoryLayoutsMatch(guestItems)) {
      this._guestInventoryLayoutPending = false;
      this._guestInventoryLayoutPendingAt = 0;
    }
    const pendingExpired = this._guestInventoryLayoutPending &&
      performance.now() - this._guestInventoryLayoutPendingAt > 1500;
    if (!dragging && (!this._guestInventoryLayoutPending || pendingExpired)) {
      this._guestInventoryLayoutPending = false;
      this._guestInventoryLayoutPendingAt = 0;
      changed = this._reconcileBackpackSnapshot('inventory', guestItems);
    }
    if (inventoriesById) {
      for (const [id, items] of Object.entries(inventoriesById)) {
        if (id === (this.state.coop.playerId || this.coopSession?.memberId)) continue;
        const entry = this.remotePlayers.get(id);
        if (entry && Array.isArray(items)) this._reconcileRemoteBackpackSnapshot(entry, items);
      }
      this._syncLegacyRemoteAliases();
    } else {
      this._reconcileBackpackSnapshot('remoteInventory', hostItems);
    }
    return changed;
  }

  _reconcileRemoteBackpackSnapshot(entry, incoming) {
    if (!this._reconcileBackpackItems(entry?.backpack, incoming)) return false;
    entry.inventory = entry.backpack.items;
    return true;
  }

  _guestInventoryLayoutsMatch(incoming) {
    if (!Array.isArray(incoming) || incoming.length !== this.backpack.items.length) return false;
    const current = new Map(this.backpack.items.map(item => [String(item.id), item]));
    return incoming.every(item => {
      const existing = current.get(String(item.id));
      return existing && existing.gx === item.gx && existing.gy === item.gy &&
        BackpackManager.normalizeRotation(existing.rot) === BackpackManager.normalizeRotation(item.rot);
    });
  }

  _reconcileBackpackSnapshot(key, incoming) {
    const manager = key === 'inventory' ? this.backpack : this.remoteBackpack;
    const changed = this._reconcileBackpackItems(manager, incoming);
    if (manager) this.state[key] = manager.items;
    return changed;
  }

  _reconcileBackpackItems(manager, incoming) {
    if (!manager || !Array.isArray(incoming)) return false;
    const key = items => JSON.stringify(items.map(item => Object.keys(item).sort().map(name => [name, item[name]])));
    if (key(manager.items) === key(incoming)) return false;
    const existing = new Map(manager.items.map(item => [String(item.id), item]));
    const reconciled = incoming.map(snapshotItem => {
      const item = existing.get(String(snapshotItem.id));
      if (!item) return { ...snapshotItem };
      for (const name of Object.keys(item)) if (!Object.hasOwn(snapshotItem, name)) delete item[name];
      return Object.assign(item, snapshotItem);
    });
    manager.items.splice(0, manager.items.length, ...reconciled);
    manager.nextId = Math.max(1, ...manager.items.map(item => Number(item.id) + 1 || 1));
    return true;
  }

  _coopSendDue(dt) {
    this._coopSendTimer = (this._coopSendTimer || 0) - dt;
    if (this._coopSendTimer > 1e-9) return false;
    this._coopSendTimer = this._coopSendTimer <= -0.05 ? 0.05 : this._coopSendTimer + 0.05;
    return true;
  }

  _sendGuestInput(neutral = false) {
    const coop = this.state.coop;
    if (!this.state.running || !coop?.running || coop.role !== 'guest' || coop.connected === false || coop.hostPaused) return false;
    const blocked = neutral || this.state.equipmentSyncing || this._guestInputSuspended || this.state.pauseMenuOpen || this.state.activeQte ||
      this.state.fullMapOpen || this.state.fullMapClosing || this.state.inventoryOpen || this.state.inventoryClosing;
    const keys = blocked ? {} : this.state.keys;
    coop.inputSeq = (coop.inputSeq || 0) + 1;
    return this.coopSession.sendState('input', {
      seq: coop.inputSeq,
      keys: { w: !!keys.w, a: !!keys.a, s: !!keys.s, d: !!keys.d, shift: !this.player.downed && !!keys.shift, e: !this.player.downed && !!keys.e },
      aim: this.player.angle,
      aiming: !blocked && !this.player.downed && !!this.state.stabilized,
      activeSlot: this.player.activeSlot,
      flashlight: this.player.flashlight,
      fire: !blocked && !!this.state.fireHeld
    });
  }

  _isRemoteInputStale(entry) {
    return !Number.isFinite(entry.lastInputAt) || performance.now() - entry.lastInputAt > 300;
  }

  _updateGuestCoop(dt) {
    this.state.elapsed += dt;
    for (const enemy of [...(this.nightmares || []), ...this.hunters, ...(this.heavies || [])]) {
      enemy.discoveryTimer = Math.max(0, (enemy.discoveryTimer || 0) - dt);
    }
    const inputBlocked = this.state.equipmentSyncing || this._guestInputSuspended || this.state.pauseMenuOpen || this.state.activeQte || this.state.fullMapOpen || this.state.fullMapClosing || this.state.inventoryOpen || this.state.inventoryClosing;
    const keys = inputBlocked ? {} : this.player.downed
      ? { w: !!this.state.keys.w, a: !!this.state.keys.a, s: !!this.state.keys.s, d: !!this.state.keys.d }
      : this.state.keys;
    const otherPlayers = this._onlineCoopPlayers(this.state.coop.playerId);
    this.player.update(dt, keys, this.player.downed ? false : this.state.stabilized, this.map, this.audio, otherPlayers);
    this.advanceCamera(dt);
    if (!inputBlocked && this.state.fireHeld && this.player.weapon?.automatic && !this.state.activeQte && !this.state.fullMapOpen && !this.state.fullMapClosing &&
        !this.state.inventoryOpen && !this.state.inventoryClosing && this.player.stunned <= 0 && this.player.dodgeTimer <= 0 && this.player.ammo > 0 &&
        (!this.player.downed || this.player.activeSlot === 'sidearm') &&
        this.player.reloading <= 0) {
      const prediction = this.player.shoot(this._isPlayerAiming(this.player), this.map, this.audio, this.monster);
      if (prediction.fired) {
        this._addMuzzleFlash(this.player, this._createWeaponShotId(this.player));
        if (this.player.ammo === 0 && this.player.reserveAmmo > 0 && this.player.reload(this.audio)) {
          this.coopSession.sendEvent('action', { action: 'reload' });
        }
      }
    }
    this._lockFinalTerminalNoise();
    if (this.state.activeQte?.remoteOwned) {
      this.state.activeQte.timeLeft = Math.max(0, this.state.activeQte.timeLeft - dt);
      this.ui.updateQTETimer(this.state.activeQte.timeLeft, 10);
    }
    if (this._coopSendDue(dt)) this._sendGuestInput();
    this._checkCoopDisconnect();
    this.audio.update(this.player, this.monster, this.map, this.hunters, this.heavies,
      { nightmares: this.nightmares, dangerCues: this.state.selectedDifficulty === 'easy' });
    this._updateInventoryUseButton();
    this.ui.update({
      oxygen: this.player.oxygen, health: this.player.health, stamina: this.player.stamina,
      noise: this.player.noise, loot: this.state.loot, lootValue: this.state.lootValue,
      elapsed: this.state.elapsed, reloading: this.player.reloading
    }, this.player, this.nightmares);
  }

  _updateRemotePlayers(dt) {
    if (!this.remotePlayers?.size || !this.state.coop.running || this.state.coop.role !== 'host') return;
    const online = [...this.remotePlayers.values()].filter(entry => entry.online !== false);
    for (const entry of online) {
      if (this._isRemoteInputStale(entry) && !entry.inputStale) {
        entry.inputStale = true;
        entry.input = { ...entry.input, keys: {}, fire: false, aiming: false };
      }
      const input = entry.input || {};
      const player = entry.player;
      if (!(player.flashStunTimer > 0) && (!player.downed || input.activeSlot === 'sidearm') &&
          ['primary', 'sidearm'].includes(input.activeSlot) && input.activeSlot !== player.activeSlot) {
        player.switchWeaponSlot(input.activeSlot);
      }
      player.angle = Number.isFinite(input.aim) ? input.aim : player.angle;
      if (!(player.flashStunTimer > 0) && typeof input.flashlight === 'boolean') player.flashlight = input.flashlight;
      const keys = entry.qte || entry.equipmentSyncing ? {} : player.downed
        ? { w: !!input.keys?.w, a: !!input.keys?.a, s: !!input.keys?.s, d: !!input.keys?.d }
        : (input.keys || {});
      const collisionPlayers = this._onlineCoopPlayers(entry.id);
      player.update(dt, keys, !player.downed && input.aiming === true, this.map, this.audio, collisionPlayers);
      if (!entry.qte && !entry.equipmentSyncing && input.fire && (!player.downed || player.activeSlot === 'sidearm') && player.weapon.automatic && player.ammo > 0 && player.reloading <= 0) this.shoot(player);
      if (entry.qte) {
        entry.qte.timeLeft = Math.max(0, entry.qte.timeLeft - dt);
        if (entry.qte.timeLeft <= 0) this._failRemoteQte(entry.id);
      }
    }
    this._syncLegacyRemoteAliases();
  }

  _handleRemoteAction(message, peerId) {
    const entry = this.remotePlayers.get(peerId);
    if (!entry || !entry.online || entry.equipmentSyncing || this.state.coop.role !== 'host' || this.state.coop.hostPaused) return;
    const player = entry.player;
    if (message.action === 'use-skill') {
      if (!Number.isSafeInteger(message.requestId) || message.requestId < 1) return;
      if (message.requestId === entry.lastSkillRequestId) {
        if (entry.lastSkillResult) this.coopSession.sendEvent('skill-result', entry.lastSkillResult, peerId);
        return;
      }
      if (message.requestId < (entry.lastSkillRequestId || 0)) {
        this.coopSession.sendEvent('skill-result', { requestId: message.requestId, accepted: false,
          readyAt: player.skillReadyAt || 0, lastRequestId: entry.lastSkillRequestId }, peerId);
        return;
      }
      entry.lastSkillRequestId = message.requestId;
      const accepted = this.useSkill(player, message.targetX, message.targetY, message.placement === true ? { vertical: message.vertical === true } : null);
      entry.lastSkillResult = { requestId: message.requestId, accepted, readyAt: player.skillReadyAt || 0, lastRequestId: message.requestId };
      this.coopSession.sendEvent('skill-result', entry.lastSkillResult, peerId);
      return;
    }
    if (player.flashStunTimer > 0) return;
    if (Number.isFinite(message.aim)) player.angle = message.aim;
    if (message.action === 'shoot') {
      if (typeof message.shotId !== 'string' || message.shotId.length > 160) return;
      entry.seenShotIds ||= new Set();
      if (entry.seenShotIds.has(message.shotId)) return;
      entry.seenShotIds.add(message.shotId);
      if (entry.seenShotIds.size > 256) entry.seenShotIds.delete(entry.seenShotIds.values().next().value);
      entry.input = { ...entry.input, aim: player.angle, aiming: !player.downed && message.aiming === true };
      this.shoot(player, message.shotId);
    }
    if (message.action === 'reload') player.reload(this.audio);
    if (message.action === 'use-supply' && !entry.qte && message.missionId === this.state.missionFxId &&
        Number.isSafeInteger(message.requestId) && message.requestId > (entry.lastSupplyRequestId || 0)) {
      entry.lastSupplyRequestId = message.requestId;
      this._useCarriedSupply(player, message.itemId);
    }
    if (message.action === 'cancel-supply') player.supplyUse = null;
    if (message.action === 'switch-slot' && (!player.downed || message.slot === 'sidearm')) player.switchWeaponSlot(message.slot);
    if (message.action === 'roll') { player.supplyUse = null; player.barrierRemoval = null; this.roll(player, message.dx, message.dy); }
    if (message.action === 'melee') { player.supplyUse = null; player.barrierRemoval = null; this.melee(player); }
    if (message.action === 'interact') this.interact(player);
    if (message.action === 'qte-key') this._handleRemoteQteKey(message.key, peerId);
    if (message.action === 'qte-cancel') this._cancelRemoteQte(peerId);
  }

  _startRemoteQte(terminal, peerId) {
    const entry = this.remotePlayers.get(peerId);
    if (!entry || entry.qte) return false;
    entry.qte = {
      terminal,
      sequence: [...terminal.sequence],
      currentIndex: 0,
      failCount: 0,
      timeLeft: 10
    };
    this.remoteQte = entry.qte;
    this.coopSession.sendEvent('qte-start', { playerId: peerId, terminalId: terminal.id, sequence: entry.qte.sequence }, peerId);
    return true;
  }

  _handleRemoteQteKey(key, peerId) {
    const entry = this.remotePlayers.get(peerId);
    if (entry?.player.flashStunTimer > 0) return;
    const qte = entry?.qte;
    if (!qte || !['w', 'a', 's', 'd'].includes(key)) return;
    if (key === qte.sequence[qte.currentIndex].toLowerCase()) {
      qte.currentIndex++;
      if (qte.currentIndex >= qte.sequence.length) {
        qte.terminal.solved = true;
        this.ui.updateTerminalsStatus(this.map.terminals);
        this._activateFinalTerminalPressure();
        this.coopSession.sendEvent('qte-complete', { playerId: peerId, terminalId: qte.terminal.id }, peerId);
        entry.qte = null;
        this.remoteQte = [...this.remotePlayers.values()].find(remote => remote.qte)?.qte || null;
      } else {
        this.coopSession.sendEvent('qte-progress', { currentIndex: qte.currentIndex, failCount: qte.failCount }, peerId);
      }
      return;
    }
    qte.failCount++;
    if (qte.failCount >= 3) {
      this._failRemoteQte(peerId);
      return;
    }
    qte.sequence = this.map.generateQTESequence(5);
    qte.currentIndex = 0;
    qte.terminal.sequence = [...qte.sequence];
    this.coopSession.sendEvent('qte-start', { playerId: peerId, terminalId: qte.terminal.id, sequence: qte.sequence }, peerId);
  }

  _failRemoteQte(peerId) {
    const entry = this.remotePlayers.get(peerId);
    if (!entry?.qte || !entry.player) return;
    const damage = this._applyDamage(entry.player, 10, 0, 2.5);
    entry.player.noise = 100;
    if (damage.blocked) this.ui.showToast('翻滚抵消了终端电击伤害');
    this.coopSession.sendEvent('qte-fail', { playerId: peerId }, peerId);
    entry.qte = null;
    this.remoteQte = [...this.remotePlayers.values()].find(remote => remote.qte)?.qte || null;
    this.teleportMonsterToNearbyRoom(true);
  }

  _cancelRemoteQte(peerId) {
    const entry = this.remotePlayers.get(peerId);
    if (!entry?.qte) return false;
    entry.qte = null;
    this.remoteQte = [...this.remotePlayers.values()].find(remote => remote.qte)?.qte || null;
    return true;
  }

  _checkCoopDisconnect() {
    const coop = this.state.coop;
    if (!coop.running) return false;
    if (coop.role === 'guest' && !coop.connected && coop.disconnectAt && Date.now() - coop.disconnectAt >= 5 * 60 * 1000) {
      coop.running = false;
      coop.status = 'RECONNECT EXPIRED // 已离开本局';
      this.finish(false);
      return true;
    }
    if (coop.role === 'host') {
      for (const entry of [...this.remotePlayers.values()]) {
        if (entry.status === 'offline' && entry.offlineAt && Date.now() - entry.offlineAt >= 5 * 60 * 1000) {
          this._removeCoopMember(entry.id);
        }
      }
    }
    return false;
  }

  _markDowned(player) {
    if (!player || player.downed || (player.health > 0 && player.oxygen > 0)) return;
    player.downed = true;
    player.bleedout = 0;
    player.reviveProgress = 0;
    player.health = Math.max(0, player.health);
    player.oxygen = Math.max(0, player.oxygen);
    player.switchWeaponSlot?.('sidearm');
    if (player === this.player) this.state.stabilized = false;
  }

  _beginCoopRevive(actor, downedEntry) {
    if (this.state.coop.role !== 'host') return false;
    const players = this._coopRosterEntries().filter(entry => entry.online !== false);
    const rescuer = players.find(entry => entry.player === actor);
    if (!rescuer || rescuer.player.downed) return false;
    const target = downedEntry || players
      .filter(entry => entry.player !== actor && entry.player.downed)
      .map(entry => ({ ...entry, distance: Math.hypot(entry.player.x - actor.x, entry.player.y - actor.y) }))
      .filter(entry => entry.distance < 48)
      .sort((a, b) => a.distance - b.distance)[0];
    if (!target) return false;

    const assignments = this.coopReviveAssignments || (this.coopReviveAssignments = new Map());
    if (assignments.get(target.id) === rescuer.id) return true;
    if (assignments.has(target.id)) {
      this.ui.showToast('队友正在救援这名玩家');
      return true;
    }
    for (const [targetId, rescuerId] of assignments) {
      if (rescuerId !== rescuer.id) continue;
      assignments.delete(targetId);
      const previousTarget = players.find(entry => entry.id === targetId);
      if (previousTarget) previousTarget.player.reviveProgress = 0;
    }
    assignments.set(target.id, rescuer.id);
    target.player.reviveProgress = 0;
    this.ui.showToast('救援开始，移动会中断进度');
    return true;
  }

  _updateCoopRevive(dt) {
    if (this.state.coop.role !== 'host') return false;
    const players = this._coopRosterEntries().filter(entry => entry.online !== false);
    const assignments = this.coopReviveAssignments || (this.coopReviveAssignments = new Map());
    if (!players.length) return false;
    players.forEach(entry => this._markDowned(entry.player));
    for (const downed of players.filter(entry => entry.player.downed)) {
      const player = downed.player;
      const rescuerId = assignments.get(downed.id);
      const rescuer = players.find(entry => entry.id === rescuerId && !entry.player.downed);
      const keys = rescuer ? (rescuer.local ? this.state.keys : rescuer.input?.keys) : null;
      const moving = !!(keys?.w || keys?.a || keys?.s || keys?.d);
      const inRange = rescuer && Math.hypot(player.x - rescuer.player.x, player.y - rescuer.player.y) < 48;
      if (!rescuer || !inRange || moving || (!rescuer.local && this._isRemoteInputStale(rescuer))) {
        assignments.delete(downed.id);
        player.reviveProgress = 0;
        continue;
      }
      if (rescuer.player.flashStunTimer > 0) continue;
      player.reviveProgress = (player.reviveProgress || 0) + dt;
      if (player.reviveProgress >= 3) {
        assignments.delete(downed.id);
        player.downed = false;
        player.health = 40;
        player.oxygen = 30;
        player.bleedout = 0;
        player.reviveProgress = 0;
      }
    }
    return players.length > 0 && players.every(entry => entry.player.downed);
  }

  _shouldFailMission() {
    if (this.state.coop?.running) {
      if (this.state.coop.role !== 'host') return false;
      const players = this._coopRosterEntries().filter(entry => entry.online !== false);
      return players.length > 0 && players.every(entry => entry.player.downed);
    }
    return this.player.health <= 0 || this.player.oxygen <= 0;
  }

  _updateCoopRevivePrompt() {
    const coop = this.state.coop;
    const updatePrompt = text => this.ui?.updateCoopRevivePrompt?.(text);
    const lootBox = !this.player.downed && !(this.player.stunned > 0) && !this.state.activeQte && !this.state.inventoryOpen &&
      !this.state.fullMapOpen && this.state.running ? this.loot?.nearest() : null;
    const lootPrompt = lootBox ? `按 E 搜刮${lootBox.fixed ? '物资箱' : '物资包'} · 世界不会暂停` : '';
    if (!coop?.running || this.player.downed || this.player.stunned > 0 || this.state.activeQte) {
      updatePrompt(lootPrompt);
      return;
    }
    const target = this._coopRosterEntries()
      .filter(entry => entry.player !== this.player && entry.online !== false && entry.player.downed)
      .map(entry => ({ ...entry, distance: Math.hypot(entry.player.x - this.player.x, entry.player.y - this.player.y) }))
      .filter(entry => entry.distance < 48)
      .sort((a, b) => a.distance - b.distance)[0];
    if (!target) {
      updatePrompt(lootPrompt);
      return;
    }
    const slot = target.slot || (target.local ? coop.localSlot : null) || '?';
    const assignedBy = this.coopReviveAssignments?.get(target.id);
    const assignedToMe = assignedBy === coop.playerId;
    const inProgress = target.player.reviveProgress > 0 || !!assignedBy;
    const progress = Math.min(100, Math.round(((target.player.reviveProgress || 0) / 3) * 100));
    updatePrompt(assignedBy && !assignedToMe
      ? `队员 ${slot} · 队友正在救援`
      : inProgress
        ? `队员 ${slot} · 救援中 ${progress}% · 移动会中断`
        : `队员 ${slot} 倒地 · 按 E 开始救援 · 移动会中断`);
  }

  _finishGuestCoop(message) {
    const resultId = message.resultId || `${this.state.missionFxId}:${this.state.coop.playerId}`;
    this._appliedFinishIds ||= new Set();
    if (this._appliedFinishIds.has(resultId) || (message.missionId && message.missionId !== this.state.missionFxId)) return;
    this._appliedFinishIds.add(resultId);
    while (this._appliedFinishIds.size > 128) this._appliedFinishIds.delete(this._appliedFinishIds.values().next().value);
    this.state.authoritativeRewardRows = message.rewards || [];
    if (message.kicked) this.ui.showToast(message.reason || '房主已将你移出本局');
    if (this._abandonTimer) clearTimeout(this._abandonTimer);
    this._abandonTimer = null;
    this.state.abandonPending = false;
    if (message.success) {
      this.state.inventory = Array.isArray(message.items) ? message.items : [];
      this._bindBackpackInventories();
      this.updateMoneyUI();
      this.updateStorageUI();
    }
    const playerArmory = message.playerArmory || message.guestArmory;
    if (playerArmory) {
      this.player.configureArmory(playerArmory);
      this.state.armory = this.player.armory;
      this.state.armorySettledByHost = true;
    }
    this.state.coop.running = false;
    this.finish(!!message.success);
    if (message.abandoned) this.leaveCoopRoom();
  }

  _getThreatTarget(entity) {
    const candidates = this._onlineCoopPlayers().filter(player => !player.downed);
    const canAcquire = player => entity.alerted || player.noise >= 30 || Math.hypot(entity.x - player.x, entity.y - player.y) <= 150;
    const sensed = candidates.filter(canAcquire);
    return (sensed.length ? sensed : candidates)
      .sort((a, b) => Math.hypot(entity.x - a.x, entity.y - a.y) - Math.hypot(entity.x - b.x, entity.y - b.y))[0]
      || this.player;
  }

  _resetNightmares(scale = Config.currentScale) {
    const settings = this._getEncounterSettings(scale);
    const count = this.trainingSession ? 1 : this._hasEnemyType('monster') ? settings.nightmareCount : 0;
    this.nightmares = Array.from({ length: count }, (_, index) => {
      const monster = new Monster();
      monster.reset(this.map);
      monster.id = `nightmare-${index + 1}`;
      monster.recoveryDuration = this.trainingSession ? 40 : settings.nightmareSleep;
      monster.sleepCycle = 0;
      return monster;
    });
    this.state.nightmares = this.nightmares;
  }

  _tryWakeNightmare(monster) {
    const players = this._onlineCoopPlayers();
    const occupiedRooms = new Set(players.map(player => this.map.getRoomAt(player.x, player.y)));
    const safe = point => !this.map.blocked(point.x, point.y, monster.radius) &&
      !occupiedRooms.has(this.map.getRoomAt(point.x, point.y)) && players.every(player =>
        Math.hypot(point.x - player.x, point.y - player.y) >= 500 &&
        !isPointVisibleToPlayer(point.x, point.y, player, this.map, this.state.powerLossStartedAt == null)) &&
      [...(this.nightmares || []), ...(this.hunters || []), ...(this.heavies || [])].every(other => other === monster ||
        !other.active || other.dead || Math.hypot(point.x - other.x, point.y - other.y) > monster.radius + other.radius + 8);
    const candidates = (this.map.monsterSpawns || []).filter(safe);
    if (!candidates.length) {
      for (const room of this.map.functionalRooms || []) {
        if (occupiedRooms.has(room)) continue;
        for (let y = room.y + 64; y < room.y + room.h - 32; y += 64) {
          for (let x = room.x + 64; x < room.x + room.w - 32; x += 64) {
            const point = { x, y };
            if (this.map.getRoomAt(x, y) === room && safe(point)) candidates.push(point);
          }
        }
        if (candidates.length) break;
      }
    }
    if (!candidates.length) { monster.recoverTimer = 1; monster.stagger = 1; return false; }
    const point = candidates[Math.floor(Math.random() * candidates.length)];
    Object.assign(monster, point, { recoverTimer: 0, stagger: 0, alerted: false, lostTime: 0,
      waypoints: [], waypointTimer: 0, _stuckTimer: 0, _lastX: null, _lastY: null });
    return true;
  }

  _sanitizeHunterSettings(savedSettings = null, fallbackSettings = Config.mapScales) {
    const limits = {
      hunters: [0, 200],
      hunterSpawnInterval: [1, 120],
      hunterRespawnCount: [0, 200],
      hunterMaxHp: [1, 100]
    };
    const settings = {};

    Object.entries(Config.mapScales).forEach(([scaleKey, defaults]) => {
      const saved = savedSettings && savedSettings[scaleKey] ? savedSettings[scaleKey] : {};
      settings[scaleKey] = {};
      Object.entries(limits).forEach(([key, [min, max]]) => {
        const parsed = saved[key] == null || saved[key] === '' ? NaN : Number(saved[key]);
        const fallback = fallbackSettings[scaleKey]?.[key] ?? defaults[key];
        settings[scaleKey][key] = Number.isFinite(parsed)
          ? Math.max(min, Math.min(max, Math.round(parsed)))
          : fallback;
      });
    });

    return settings;
  }

  _getHunterSettings(scaleKey = Config.currentScale) {
    const mission = this.state?.missionHunterSettings?.[scaleKey];
    if (mission) return mission;
    const saved = this.state && this.state.hunterSettings && this.state.hunterSettings[scaleKey];
    return saved || this._sanitizeHunterSettings()[scaleKey];
  }

  _hasEnemyType(type) {
    return !Array.isArray(this.map?.enemyTypes) || this.map.enemyTypes.includes(type);
  }

  _getHeavyMaxHp() {
    return this._getEncounterSettings().heavyHp;
  }

  _getEncounterSettings(scale = Config.currentScale) {
    const rules = Config.encounterRules[this.state.selectedDifficulty] || Config.encounterRules.medium;
    const index = Math.max(0, ['small', 'medium', 'large'].indexOf(scale));
    const multiplier = this.state.coop?.running ? this.state.coop.difficultyMultiplier || 1 : 1;
    return { heavyHp: rules.heavyHp, heavyCount: Math.ceil(rules.heavyCounts[index] * multiplier),
      nightmareCount: Math.ceil(rules.nightmareCounts[index] * multiplier), nightmareSleep: rules.nightmareSleep };
  }

  _spawnHeavy() {
    if (this.trainingSession) return false;
    if (!this._hasEnemyType('heavy') || this.state.coop?.role === 'guest') return false;
    this.heavies ||= [];
    const limit = this._getEncounterSettings().heavyCount;
    const alive = this.heavies.filter(heavy => heavy.active && !heavy.dead);
    if (alive.length >= limit) return false;
    this._syncEnemyCorpses();
    const players = this._onlineCoopPlayers();
    const occupants = [...players, ...alive, ...(this.hunters || []).filter(actor => actor.active && !actor.dead),
      ...(this.nightmares || []).filter(monster => monster.active)];
    const candidates = (this.map.monsterSpawns || []).filter(point => !this.map.blocked(point.x, point.y, Config.heavy.radius) &&
      occupants.every(actor => Math.hypot(point.x - actor.x, point.y - actor.y) > Config.heavy.radius + (actor.radius || 0) + 8));
    const distance = point => Math.min(...players.map(player => Math.hypot(point.x - player.x, point.y - player.y)));
    candidates.sort((a, b) => distance(b) - distance(a));
    const spawn = candidates[0];
    if (!spawn) return false;
    let index = this.heavies.findIndex(heavy => !heavy.active || heavy.dead);
    if (index < 0) index = this.heavies.length;
    const heavy = new Heavy(this._getHeavyMaxHp());
    heavy.reset(this.map, this._getHeavyMaxHp());
    heavy.id = `heavy-${index + 1}`;
    heavy.lifeId = `${this.state.missionFxId}:heavy:${this.enemyLifeSequence = (this.enemyLifeSequence || 0) + 1}`;
    heavy.activate(spawn.x, spawn.y);
    this.heavies[index] = heavy;
    this.state.heavies = this.heavies;
    return true;
  }

  _clearEnemyEffects() {
    this.corpseRegistry = [];
    this.corpseRevision = 0;
    this.corpseSequence = 0;
    this.impactSequence = 0;
    this.seenWallImpacts = new Set();
    this.wallShake = null;
    this.state.corpses = [];
    this.state.shakeX = 0;
    this.state.shakeY = 0;
  }

  _refreshCorpses(revivedIds = []) {
    const limit = [40, 100, 200].includes(Number(this.state.corpseLimit)) ? Number(this.state.corpseLimit) : 100;
    const visible = (this.corpseRegistry || []).slice(-limit);
    const visibleIds = new Set(visible.map(record => record.id));
    const removed = new Set(revivedIds);
    const retiring = (this.state.corpses || []).filter(record => !visibleIds.has(record.id) && !removed.has(record.id))
      .map(record => ({ ...record, fadeRemaining: record.fadeRemaining ?? 1 }));
    // The visual budget has at most twenty short-lived overflow fades, even on a mass kill.
    this.state.corpses = [...retiring.slice(-20), ...visible.map(record => ({ ...record, fadeRemaining: null }))];
  }

  _syncEnemyCorpses() {
    if (this.state.coop?.role === 'guest' && this.state.coop.running) return;
    this.corpseRegistry ||= [];
    const previousIds = new Set(this.corpseRegistry.map(record => record.id));
    const added = [], revived = [];
    for (const [kind, actors] of [['hunter', this.hunters || []], ['heavy', this.heavies || []]]) {
      for (const actor of actors) {
        if (actor.dead && !actor.corpseId) {
          actor.corpseId = `${this.state.missionFxId || 'solo'}:corpse:${this.corpseSequence = (this.corpseSequence || 0) + 1}`;
          const record = { id: actor.corpseId, kind, x: actor.x, y: actor.y, angle: actor.angle || 0,
            effectKey: this.equipment?.enemyKey(actor), hitFlashUntil: actor.hitFlashUntil || 0,
            width: Config[kind].spriteWidth || (kind === 'heavy' ? 112 : 63) };
          added.push(record);
          this.corpseRegistry.push(record);
        } else if (!actor.dead && actor.corpseId) {
          revived.push(actor.corpseId);
          delete actor.corpseId;
        }
      }
    }
    if (!added.length && !revived.length) return;
    this.corpseRegistry = this.corpseRegistry.filter(record => !revived.includes(record.id));
    const evicted = this.corpseRegistry.splice(0, Math.max(0, this.corpseRegistry.length - 200)).map(record => record.id);
    const retained = new Set(this.corpseRegistry.map(record => record.id));
    this.corpseRevision = (this.corpseRevision || 0) + 1;
    this._refreshCorpses(revived);
    if (this.state.coop?.running && this.state.coop.role === 'host') this.coopSession.sendEvent('corpse-delta', {
      missionId: this.state.missionFxId, revision: this.corpseRevision,
      add: added.filter(record => retained.has(record.id)), remove: [...revived, ...evicted.filter(id => previousIds.has(id))], revived
    });
  }

  _applyCorpseDelta(message, replacement = false) {
    if (this.state.coop?.role !== 'guest' || !this.state.coop.running || message.missionId !== this.state.missionFxId ||
        !Number.isSafeInteger(message.revision) || message.revision < 0 ||
        (replacement ? message.revision < (this.corpseRevision || 0) : message.revision <= (this.corpseRevision || 0)) ||
        !Array.isArray(message.add) || message.add.length > 200 || !Array.isArray(message.remove)) return false;
    if (message.add.some(record => !record || typeof record.id !== 'string' || !['hunter', 'heavy'].includes(record.kind) ||
        !['x', 'y', 'angle', 'width'].every(key => Number.isFinite(record[key])) || record.width <= 0 || record.width > 200)) return false;
    const removed = new Set(message.remove);
    const records = new Map((replacement ? [] : this.corpseRegistry || []).filter(record => !removed.has(record.id)).map(record => [record.id, record]));
    message.add.forEach(record => {
      const actor = [...(this.hunters || []), ...(this.heavies || [])].find(enemy => this.equipment?.enemyKey(enemy) === record.effectKey);
      records.set(record.id, { ...record, hitFlashUntil: replacement ? 0 : Math.max(record.hitFlashUntil || 0, actor?.hitFlashUntil || 0) });
    });
    this.corpseRegistry = [...records.values()].slice(-200);
    this.corpseRevision = message.revision;
    if (replacement) this.state.corpses = [];
    this._refreshCorpses(Array.isArray(message.revived) ? message.revived : []);
    return true;
  }

  _acceptWallImpact(message) {
    if (!this.state.running || message.missionId !== this.state.missionFxId || typeof message.id !== 'string' ||
        !Number.isFinite(message.x) || !Number.isFinite(message.y)) return;
    this.seenWallImpacts ||= new Set();
    if (this.seenWallImpacts.has(message.id)) return;
    this.seenWallImpacts.add(message.id);
    if (this.seenWallImpacts.size > 128) this.seenWallImpacts.delete(this.seenWallImpacts.values().next().value);
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;
    const strength = 3 * Math.max(0, 1 - Math.hypot(message.x - this.player.x, message.y - this.player.y) / 500);
    if (strength > 0) this.wallShake = { remaining: .18, strength: Math.min(3, Math.max(strength, this.wallShake?.strength || 0)) };
  }

  _emitWallImpact(point) {
    const message = { ...point, missionId: this.state.missionFxId,
      id: `${this.state.missionFxId}:impact:${this.impactSequence = (this.impactSequence || 0) + 1}` };
    this._acceptWallImpact(message);
    if (this.state.coop?.running && this.state.coop.role === 'host') this.coopSession.sendEvent('heavy-impact', message);
  }

  _updateEnemyEffects(dt) {
    this.state.corpses = (this.state.corpses || []).filter(record => record.fadeRemaining == null || (record.fadeRemaining -= dt) > 0);
    this.state.shakeX = 0;
    this.state.shakeY = 0;
    if (!this.wallShake) return;
    this.wallShake.remaining = Math.max(0, this.wallShake.remaining - dt);
    if (!this.wallShake.remaining || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) { this.wallShake = null; return; }
    const time = .18 - this.wallShake.remaining;
    const amplitude = this.wallShake.strength * this.wallShake.remaining / .18;
    const zoom = this.state.cameraZoom || Config.camera.baseZoom;
    const rect = this.ui?.frame?.getBoundingClientRect?.();
    const scaleX = rect?.width > 0 ? rect.width / Config.VIEW_W : 1;
    const scaleY = rect?.height > 0 ? rect.height / Config.VIEW_H : 1;
    this.state.shakeX = Math.sin(time * 110) * amplitude / (zoom * scaleX);
    this.state.shakeY = Math.sin(time * 137) * amplitude / (zoom * scaleY);
  }

  setCorpseLimit(value) {
    this.state.corpseLimit = [40, 100, 200].includes(Number(value)) ? Number(value) : 100;
    this._refreshCorpses();
    this.ui.updateCorpseLimit?.(this.state.corpseLimit);
    this._save();
  }

  _normalizeFlashbangCount(value) {
    return Number.isFinite(Number(value)) ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Number(value)))) : 0;
  }

  _flashbangCountFor(actor) {
    return (this._backpackFor(actor)?.items || []).filter(item => item.effect === 'flashbang').length;
  }

  _refreshFlashbangStock() {
    this.state.flashbangCount = this._flashbangCountFor(this.player);
    this.ui.updateFlashbangs?.(this.state.flashbangCount, this.state);
  }

  _newFlashbangItem() {
    const items = [...(this.backpack?.items || []), ...(this.storageBackpack?.items || []), ...(this.state.storageOverflowItems || [])];
    let id;
    do { id = `supply-flash-${this._flashItemSequence = (this._flashItemSequence || 0) + 1}`; }
    while (items.some(item => String(item.id).replace(/^carry:/, '') === id));
    return { ...Config.consumables.flashbang, id, itemId: 'flashbang', type: 'consumable', rarity: 'uncommon', rot: 0 };
  }

  _migrateFlashbangInventory(count) {
    for (let i = 0; i < count; i++) {
      const item = this._newFlashbangItem();
      if (this.backpack.place(item) || this.storageBackpack.place(item)) continue;
      this.state.storageOverflowItems.push(item);
    }
    this.state.inventory = this.backpack.items;
    this.state.storageItems = this.storageBackpack.items;
  }

  buyFlashbang() {
    return this.purchaseAbility('skill', 'flashbang');
  }

  throwFlashbang(actor = this.player, targetX = null, targetY = null) {
    return this.useSkill(actor, targetX, targetY);
  }

  purchaseAbility(kind, id) {
    const catalog = kind === 'skill' ? Config.skills : kind === 'passive' ? Config.passives : null;
    const ability = catalog?.[id];
    const owned = this.player.armory[kind === 'skill' ? 'ownedSkills' : 'ownedPassives'];
    if (!ability || this.state.running || this.state.transitioning || this.state.coop.running || owned[id]) return false;
    if (this.state.money < ability.price) { this.ui.showToast('信用点不足'); return false; }
    owned[id] = true;
    this.state.money -= ability.price;
    this.state.armory = this.player.armory;
    this._save(); this.updateMoneyUI(); this.updateLoadoutUI();
    this.ui.updateAbilities?.(this.player, this.state);
    this._syncPreparedBackpack?.();
    this.ui.showToast(`${ability.label} 已永久解锁，请选择装备`);
    return true;
  }

  equipAbility(kind, id) {
    const catalog = kind === 'skill' ? Config.skills : kind === 'passive' ? Config.passives : null;
    if (!catalog || this.state.running || this.state.transitioning || this.state.coop.running) return false;
    const owned = this.player.armory[kind === 'skill' ? 'ownedSkills' : 'ownedPassives'];
    if (id !== null && (!catalog[id] || !owned[id])) return false;
    this.player.armory[kind === 'skill' ? 'equippedSkill' : 'equippedPassive'] = id;
    this.state.armory = this.player.armory;
    this._save(); this.updateLoadoutUI();
    this.ui.updateAbilities?.(this.player, this.state);
    this._syncPreparedBackpack?.();
    if (this.state.coop.role === 'host') this._broadcastCoopRoster();
    return true;
  }

  useSkill(actor = this.player, targetX = null, targetY = null, placement = null) {
    if (actor === this.player && this.state.equipmentSyncing) return false;
    if (actor === this.player && targetX == null && targetY == null) {
      if (this.state.running) this.handleAim(this.lastPointerEvent);
      targetX = this.state.mouseX;
      targetY = this.state.mouseY;
    }
    const remote = this._remoteEntryForActor(actor);
    const skillId = actor.armory?.equippedSkill;
    const skill = Config.skills[skillId];
    if (!this.state.running || this.state.transitioning || this.state.tutorial?.paused || this.state.coop?.hostPaused ||
        actor.downed || actor.stunned > 0 || actor.flashStunTimer > 0 || actor.dodgeTimer > 0 || remote?.qte ||
        (actor === this.player && (this.state.pauseMenuOpen || this.state.activeQte || this.state.inventoryOpen ||
          this.state.inventoryClosing || this.state.fullMapOpen || this.state.fullMapClosing)) ||
        !Number.isFinite(targetX) || !Number.isFinite(targetY)) return false;
    if (!skill || !actor.armory.ownedSkills?.[skillId]) {
      if (!remote) this.ui.showToast('未装备主动技能，请在 Loadout 解锁并装备');
      return false;
    }
    if ((actor.skillReadyAt || 0) > this.state.elapsed) return false;
    this._cancelSupplyUse(actor);
    actor.barrierRemoval = null;
    if (skillId === 'barrier') {
      if (actor === this.player && !placement) {
        if (!this.state.barrierBlueprint) {
          this.state.barrierBlueprint = this.equipment.blueprint(actor, targetX, targetY, false);
          this.ui.showToast('磁锁隔离栅：R 旋转 · T 放置 · Esc 取消');
          return false;
        }
        placement = { vertical: this.state.barrierBlueprint.vertical };
      }
      if (!placement || !this.equipment.blueprint(actor, targetX, targetY, placement.vertical).valid) {
        if (!remote) this.ui.showToast('此处无法放置，未进入冷却');
        return false;
      }
    }
    if (this.state.coop?.running && this.state.coop.role === 'guest') {
      if (this._pendingSkillRequest) {
        if (performance.now() - this._pendingSkillRequest.sentAt > 1500) {
          this._pendingSkillRequest.sentAt = performance.now();
          this.coopSession.sendEvent('action', this._pendingSkillRequest.payload);
        }
        return false;
      }
      const requestId = this._skillRequestSequence = (this._skillRequestSequence || 0) + 1;
      const payload = { action: 'use-skill', requestId, targetX, targetY,
        placement: skillId === 'barrier', vertical: placement?.vertical === true };
      const sent = !!this.coopSession.sendEvent('action', payload);
      if (sent) this._pendingSkillRequest = { requestId, payload, sentAt: performance.now(), beforeReadyAt: actor.skillReadyAt || 0 };
      return sent;
    }
    if (skillId === 'barrier') {
      if (!this.equipment.place(actor, targetX, targetY, placement.vertical)) return false;
      actor.skillReadyAt = this.state.elapsed + skill.cooldown;
      if (!remote) this.state.barrierBlueprint = null;
      return true;
    }
    const ownerId = remote?.id || this.state.coop?.playerId || 'host';
    const id = `${this.map.seed}:${ownerId}:${this._flashSequence = (this._flashSequence || 0) + 1}`;
    this.state.flashbangs ||= [];
    this.state.flashbangs.push(new Flashbang(id, ownerId, actor.x, actor.y, targetX, targetY, skillId));
    actor.skillReadyAt = this.state.elapsed + skill.cooldown;
    if (!remote) {
      this._tutorialAction('skill');
      this.ui.updateSkillReadout?.(this.player, this.state);
    }
    return true;
  }

  _showFlashBurst(effect) {
    this.seenFlashEffects ||= new Set();
    if (this.seenFlashEffects.has(effect.id)) return;
    this.seenFlashEffects.add(effect.id);
    if (this.seenFlashEffects.size > 256) this.seenFlashEffects.delete(this.seenFlashEffects.values().next().value);
    this.state.flashBursts ||= [];
    this.state.flashBursts.push({ id: effect.id, skillId: effect.skillId || 'flashbang', x: effect.x, y: effect.y, lifetime: 0.35 });
    const spatial = this.audio.calculateSpatial?.(this.player.x, this.player.y, this.player.angle, effect.x, effect.y, 500);
    if (spatial) this.audio.playSpatialTone?.(800, 0.15, 0.12, 'triangle', spatial.pan, spatial.distanceGain, spatial.isBehind);
  }

  _explodeFlashbang(projectile) {
    if (projectile.skillId === 'grenade') return this._explodeGrenade(projectile);
    const targets = [...this._onlineCoopPlayers(), ...(this.nightmares || []), ...this.hunters, ...(this.heavies || [])];
    for (const target of targets) {
      if (!target || target.dead || (target !== this.player && !this._isCoopPlayer(target) && !target.active)) continue;
      const dx = target.x - projectile.x, dy = target.y - projectile.y;
      const distance = Math.hypot(dx, dy);
      if (distance > Config.flashbang.blastRadius || (distance > 0 &&
          this.map.rayWallDistance(projectile.x, projectile.y, dx / distance, dy / distance, distance) < distance - 0.01)) continue;
      if ((this.heavies || []).includes(target)) target.stun(Config.flashbang.stunDuration);
      else target.applyFlashStun(Config.flashbang.stunDuration);
      this._tutorialAction('target-stunned', { target });
      if (target === this.player) {
        this.state.stabilized = false;
        this.state.fireHeld = false;
      }
    }
    this._showFlashBurst(projectile);
    if (this.state.coop?.running && this.state.coop.role === 'host') {
      this.coopSession.sendEvent('flash-exploded', { id: projectile.id, x: projectile.x, y: projectile.y, skillId: 'flashbang' });
    }
  }

  _explodeGrenade(projectile) {
    this._resolvedGrenades ||= new Set();
    if (this._resolvedGrenades.has(projectile.id)) return false;
    this._resolvedGrenades.add(projectile.id);
    if (this._resolvedGrenades.size > 256) this._resolvedGrenades.delete(this._resolvedGrenades.values().next().value);
    const targets = [...this._onlineCoopPlayers(), ...(this.nightmares || []), ...this.hunters, ...(this.heavies || [])];
    for (const target of new Set(targets)) {
      const isPlayer = this._isCoopPlayer(target);
      if (!target || target.dead || (isPlayer ? target.downed : !target.active)) continue;
      const dx = target.x - projectile.x, dy = target.y - projectile.y, distance = Math.hypot(dx, dy);
      if (distance > Config.flashbang.blastRadius || (distance > 0 &&
          this.map.rayWallDistance(projectile.x, projectile.y, dx / distance, dy / distance, distance) < distance - 0.01)) continue;
      if (isPlayer) {
        const id = this._remoteEntryForActor(target)?.id || this.state.coop?.playerId || 'host';
        if (id !== projectile.ownerId && this.state.coop?.friendlyFire === false) continue;
        this._applyDamage(target, 5);
      } else if ((this.heavies || []).includes(target)) this._recordDefeat(target, projectile.ownerId, this._hitEnemy(target, 5, true));
      else for (let hit = 0; hit < 5 && !target.dead; hit++) this._recordDefeat(target, projectile.ownerId, this._hitEnemy(target));
    }
    this._showFlashBurst(projectile);
    if (this.state.coop?.running && this.state.coop.role === 'host') {
      this.coopSession.sendEvent('flash-exploded', { id: projectile.id, x: projectile.x, y: projectile.y, skillId: 'grenade' });
    }
    return true;
  }

  _updateFlashbangs(dt) {
    for (const projectile of this.state.flashbangs || []) {
      if (projectile.update(dt, this.map)) this._explodeFlashbang(projectile);
    }
    this.state.flashbangs = (this.state.flashbangs || []).filter(projectile => !projectile.exploded);
  }

  _knockbackPlayer(player, angle, distance) {
    const others = this._onlineCoopPlayers().filter(other => other !== player);
    for (let moved = 0; moved < distance; moved += 2) {
      const step = Math.min(2, distance - moved);
      const x = player.x + Math.cos(angle) * step, y = player.y + Math.sin(angle) * step;
      if (this.map.blocked(x, y, player.radius) || others.some(other => Math.hypot(x - other.x, y - other.y) < player.radius + other.radius)) break;
      player.x = x; player.y = y;
    }
  }

  _sanitizeDifficultyProfiles(savedProfiles = null) {
    const profiles = {};
    for (const [difficultyId, defaults] of Object.entries(Config.difficultyPresets)) {
      const saved = savedProfiles && savedProfiles[difficultyId] ? savedProfiles[difficultyId] : {};
      const maps = this._sanitizeHunterSettings(saved.maps, defaults.maps);
      const count = Number(saved.finalTerminalSpawnCount);
      const interval = Number(saved.finalTerminalSpawnInterval);
      profiles[difficultyId] = {
        maps,
        finalTerminalSpawnCount: Number.isFinite(count)
          ? Math.max(0, Math.min(200, Math.round(count)))
          : defaults.finalTerminalSpawnCount,
        finalTerminalSpawnInterval: Number.isFinite(interval)
          ? Math.max(1, Math.min(120, Math.round(interval)))
          : defaults.finalTerminalSpawnInterval
      };
    }
    return profiles;
  }

  _cloneDifficultyProfile(profile) {
    return {
      maps: Object.fromEntries(Object.entries(profile.maps).map(([scale, settings]) => [scale, { ...settings }])),
      finalTerminalSpawnCount: profile.finalTerminalSpawnCount,
      finalTerminalSpawnInterval: profile.finalTerminalSpawnInterval
    };
  }

  _getDifficultyProfile(difficultyId = this.state.selectedDifficulty) {
    return this.state.difficultyProfiles[difficultyId] || this.state.difficultyProfiles.medium;
  }

  _finalTerminalSettings(profile = this._getDifficultyProfile()) {
    return {
      spawnCount: profile.finalTerminalSpawnCount,
      spawnInterval: profile.finalTerminalSpawnInterval
    };
  }

  _sanitizeFinalTerminalSettings(savedSettings, fallbackSettings) {
    const count = Number(savedSettings?.spawnCount);
    const interval = Number(savedSettings?.spawnInterval);
    return {
      spawnCount: Number.isFinite(count) ? Math.max(0, Math.min(200, Math.round(count))) : fallbackSettings.spawnCount,
      spawnInterval: Number.isFinite(interval) ? Math.max(1, Math.min(120, Math.round(interval))) : fallbackSettings.spawnInterval
    };
  }

  _getFinalTerminalSettings() {
    return this.state.missionFinalTerminalSettings || this.state.finalTerminalSettings || this._finalTerminalSettings();
  }

  _buildDifficultySettings(difficultyId) {
    const profile = this.state?.difficultyProfiles?.[difficultyId] ||
      this._sanitizeDifficultyProfiles()[difficultyId];
    return Object.fromEntries(Object.entries(profile.maps).map(([scale, settings]) => [scale, { ...settings }]));
  }

  _difficultyProfileIsModified(difficultyId) {
    const current = this._getDifficultyProfile(difficultyId);
    const defaults = Config.difficultyPresets[difficultyId];
    return current.finalTerminalSpawnCount !== defaults.finalTerminalSpawnCount ||
      current.finalTerminalSpawnInterval !== defaults.finalTerminalSpawnInterval ||
      Object.keys(defaults.maps).some(scale =>
        Object.keys(defaults.maps[scale]).some(key => current.maps[scale][key] !== defaults.maps[scale][key])
      );
  }

  _applyDifficultyProfile(difficultyId, refreshHunterArray = true) {
    if (!Config.difficultyPresets[difficultyId]) return false;
    this.state.selectedDifficulty = difficultyId;
    this.state.hunterSettings = this._buildDifficultySettings(difficultyId);
    this.state.finalTerminalSettings = this._finalTerminalSettings(this._getDifficultyProfile(difficultyId));
    this.state.hunterSpawnTimer = this._getHunterSettings().hunterSpawnInterval;
    if (refreshHunterArray) {
      this.hunters = this._createHunters();
      this.hunters.forEach(hunter => hunter.reset(this.map));
      this.nextHunterSpawnIndex = this.hunters.length;
    }
    this._save();
    this.updateDifficultyUI();
    this.updateHunterSettingsUI();
    return true;
  }

  updateHunterSettingsUI() {
    const difficultyId = this.difficultyEditor || this.state.selectedDifficulty;
    this.ui.updateHunterSettings(
      this._getDifficultyProfile(difficultyId),
      this.state.running || this.state.coop.role === 'guest',
      this._difficultyProfileIsModified(difficultyId)
    );
  }

  updateDifficultyUI() {
    this.ui.updateDifficultyPreset(
      this.state.selectedDifficulty,
      this.difficultyEditor || this.state.selectedDifficulty,
      this.state.running || this.state.coop.role === 'guest',
      this.getAmmoLossWarning(this.state.selectedDifficulty)
    );
    this.menu?.queueRefresh();
  }

  getAmmoLossWarning(difficulty = this.state.selectedDifficulty) {
    if (difficulty === 'easy') return '失败时保留所有携带弹药；未装备武器与弹药库库存也不受影响。';
    if (difficulty === 'hard') return '失败时已装备武器的弹匣与备弹全部损失；未装备武器与弹药库不受影响。';
    return '失败时已装备武器的弹匣与备弹损失一半（向下取整）；未装备武器与弹药库不受影响。';
  }

  applyDifficultyPreset(difficultyId) {
    if (this.state.running || this.state.coop.role === 'guest') return;
    if (this._applyDifficultyProfile(difficultyId) && this.state.coop.role === 'host') this._broadcastCoopRoster();
  }

  setDifficultyEditor(difficultyId) {
    if (!Config.difficultyPresets[difficultyId]) return false;
    this.difficultyEditor = difficultyId;
    this.updateDifficultyUI();
    this.updateHunterSettingsUI();
    return true;
  }

  updateLoadoutUI() {
    this._refreshFlashbangStock();
    this.ui.updateLoadout(this.player.armory, this.state.running || this.state.coop.running);
    this.ui.updateAbilities?.(this.player, this.state);
    this.menu?.queueRefresh();
  }

  updateAmmoDepotUI() {
    if (this.ui.updateAmmoDepot) {
      const selection = this.ammoTransferSelection;
      const amount = Number(this.ui.ammoTransferAmount?.value);
      const preview = this.getAmmoTransferPreview(selection.source, selection.target, amount);
      this.ui.updateAmmoDepot(
        this.player.armory,
        this.state.running || this.state.coop.running,
        selection,
        preview
      );
    }
    this.menu?.queueRefresh();
  }

  getAmmoTransferPreview(sourceId, targetId, amount) {
    const armory = this.player.armory;
    const rates = Config.ammo.standardUnitsPerRound;
    const quantity = Math.floor(Number(amount));
    const sourceAvailable = sourceId === 'standard'
      ? armory.standardAmmoUnits
      : armory.ownedWeapons[sourceId] ? armory.weaponAmmo[sourceId].reserve : 0;
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > sourceAvailable || sourceId === targetId ||
        (sourceId !== 'standard' && !rates[sourceId]) ||
        (targetId !== 'standard' && (!rates[targetId] || !armory.ownedWeapons[targetId]))) {
      return { valid: false, rounds: 0, remainder: 0, sourceAvailable };
    }
    const standardUnits = sourceId === 'standard' ? quantity : quantity * rates[sourceId];
    if (targetId === 'standard') {
      return { valid: true, rounds: standardUnits, remainder: 0, sourceAvailable };
    }
    const rounds = Math.floor(standardUnits / rates[targetId]);
    const remainder = standardUnits - rounds * rates[targetId];
    return { valid: rounds > 0, rounds, remainder, sourceAvailable };
  }

  selectAmmoTransfer(kind, weaponId) {
    if (this.state.running || this.state.coop.running || !['source', 'target'].includes(kind)) return false;
    const valid = weaponId === 'standard' || !!this.player.armory.ownedWeapons[weaponId];
    if (!valid) return false;
    const otherKind = kind === 'source' ? 'target' : 'source';
    if (this.ammoTransferSelection[otherKind] === weaponId) {
      this.ammoTransferSelection[otherKind] = this.ammoTransferSelection[kind];
    }
    this.ammoTransferSelection[kind] = weaponId;
    this.updateAmmoDepotUI();
    return true;
  }

  _notifyTransaction(message, tone = 'success') {
    if (this.ui.showTransactionNotice) this.ui.showTransactionNotice(message, tone);
    else this.ui.showToast(message);
  }

  purchaseWeapon(weaponId) {
    const weapon = Config.weapons[weaponId];
    if (!weapon || weaponId === 'pistol' || this.state.running || this.state.coop.running ||
        this.player.armory.ownedWeapons[weaponId]) return false;
    if (this.state.money < weapon.purchasePrice) {
      this._notifyTransaction('资金不足，无法购买该武器', 'error');
      return false;
    }
    if (!this.player.unlockWeapon(weaponId)) return false;
    this.state.money -= weapon.purchasePrice;
    this.state.armory = this.player.armory;
    this._save();
    this.updateMoneyUI();
    this.updateLoadoutUI();
    this.updateAmmoDepotUI();
    this._notifyTransaction(`${weapon.label} 已购入；请在装备栏选择要使用的槽位`);
    if (this.state.coop.connected) {
      this._sendCoopReady();
    }
    return true;
  }

  equipWeapon(slot, weaponId) {
    if (this.state.running || this.state.coop.running) return false;
    if (!this.player.equipWeapon(slot, weaponId)) return false;
    this.state.armory = this.player.armory;
    this._save();
    this.updateLoadoutUI();
    this.ui.updateWeaponReadout(this.player);
    if (this.state.coop.connected) this._sendCoopReady();
    if (this.state.coop.role === 'host') this._broadcastCoopRoster();
    return true;
  }

  switchWeaponSlot(slot) {
    if (this.player.flashStunTimer > 0) return false;
    if (!this.state.running || this.state.tutorial?.paused || this.state.fullMapOpen || this.state.fullMapClosing || this.state.inventoryOpen || this.state.inventoryClosing ||
        this.state.coop.hostPaused || this.player.dodgeTimer > 0) return false;
    if (this.state.activeQte) return false;
    if (this.player.downed && slot !== 'sidearm') return false;
    if (!this.player.armory.loadout[slot]) {
      if (slot === 'primary') this.ui.showToast('主武器槽未装备武器');
      return false;
    }
    if (!this.player.switchWeaponSlot(slot)) return false;
    this.state.armory = this.player.armory;
    this.state.fireHeld = false;
    this.ui.updateWeaponReadout(this.player);
    this._tutorialAction(slot === 'primary' ? 'switch-primary' : 'switch-sidearm');
    if (this.state.coop.running && this.state.coop.role === 'guest') {
      this.coopSession.sendEvent('action', { action: 'switch-slot', slot });
    }
    return true;
  }

  roll(actor = this.player, directionX = null, directionY = null) {
    if (actor === this.player && this.state.equipmentSyncing) return false;
    this._cancelSupplyUse(actor); actor.barrierRemoval = null;
    if (actor === this.player) this.state.barrierBlueprint = null;
    if (!this.state.running || this.state.tutorial?.paused || this.state.coop.hostPaused ||
        (actor === this.player && (this.state.fullMapOpen || this.state.fullMapClosing || this.state.inventoryOpen || this.state.inventoryClosing))) return false;
    if (actor.stunned > 0 || actor.downed || actor.dodgeTimer > 0) return false;
    const dx = directionX == null ? Number(!!this.state.keys.d) - Number(!!this.state.keys.a) : Number(directionX);
    const dy = directionY == null ? Number(!!this.state.keys.s) - Number(!!this.state.keys.w) : Number(directionY);
    if (!actor.startRoll(dx, dy)) return false;
    if (actor === this.player) this._tutorialAction('roll-start');
    if (actor === this.player) {
      this.state.fireHeld = false;
      if (this.state.coop.running && this.state.coop.role === 'guest') {
        this.coopSession.sendEvent('action', { action: 'roll', dx, dy });
      }
    }
    return true;
  }

  melee(actor = this.player) {
    if (actor === this.player && this.state.equipmentSyncing) return false;
    this._cancelSupplyUse(actor); actor.barrierRemoval = null;
    if (actor === this.player) this.state.barrierBlueprint = null;
    const localInteractionBlocked = actor === this.player &&
      (this.state.fullMapOpen || this.state.fullMapClosing || this.state.inventoryOpen || this.state.inventoryClosing || this.state.activeQte);
    const remoteEntry = this._remoteEntryForActor(actor);
    const remoteInteractionBlocked = !!remoteEntry?.qte;
    if (!this.state.running || this.state.tutorial?.paused || this.state.coop.hostPaused || actor.downed || localInteractionBlocked ||
        remoteInteractionBlocked || actor.dodgeTimer > 0) return false;
    if (!actor.startMelee()) return false;
    if (actor === this.player) {
      this._tutorialAction('melee');
      if (this.state.coop.running && this.state.coop.role === 'guest') {
        this.coopSession.sendEvent('action', { action: 'melee' });
        return true;
      }
    }

    const range = Config.player.meleeRange;
    let hitCount = 0;
    for (const heavy of this.heavies || []) {
      if (!heavy.active || heavy.dead || Math.hypot(heavy.x - actor.x, heavy.y - actor.y) > range + heavy.radius) continue;
      const hit = this._hitEnemy(heavy, Config.player.meleeDamage);
      this._recordDefeat(heavy, actor, hit);
      this._tutorialAction('melee-hit', { target: heavy, hit });
      if (hit.hit) {
        if (!hit.dead) this._knockbackPlayer(heavy, Math.atan2(heavy.y - actor.y, heavy.x - actor.x), Config.player.meleeKnockback);
        hitCount++;
      }
    }
    for (const monster of this.nightmares || []) {
      if (!monster.active || Math.hypot(monster.x - actor.x, monster.y - actor.y) > range + monster.radius) continue;
      const angle = Math.atan2(monster.y - actor.y, monster.x - actor.x);
      const hit = this._hitEnemy(monster);
      this._recordDefeat(monster, actor, hit);
      this._tutorialAction('melee-hit', { target: monster, hit });
      const distance = Config.player.meleeKnockback;
      this._knockbackPlayer(monster, angle, distance);
      monster.waypoints = [];
      monster.waypointTimer = 0;
      if (hit.triggeredRecovery) this.ui.showToast(`Nightmare 进入休眠 ${monster.recoverTimer}秒`);
      hitCount++;
    }

    this.hunters.forEach(hunter => {
      if (!hunter.active || hunter.dead || Math.hypot(hunter.x - actor.x, hunter.y - actor.y) > range + hunter.radius) return;
      const angle = Math.atan2(hunter.y - actor.y, hunter.x - actor.x);
      const hit = this._hitEnemy(hunter);
      this._recordDefeat(hunter, actor, hit);
      this._tutorialAction('melee-hit', { target: hunter, hit });
      if (hit.hit) {
        if (!hit.dead) {
          const distance = Config.player.meleeKnockback;
          this._knockbackPlayer(hunter, angle, distance);
        }
        hitCount++;
      }
    });
    if (hitCount > 0 && this.audio.playTone) this.audio.playTone(95, 0.08, 0.08, 'square');
    else this.ui.showToast('近战挥空');
    return true;
  }

  _sendCoopReady() {
    this.coopSession.sendEvent('ready', {
      ready: this.state.coop.localReady,
      armory: this.player.exportArmory(),
      backpackItems: (this.state.inventory || []).map(item => ({ ...item }))
    });
  }

  _syncPreparedBackpack() {
    if (this.state.coop?.role === 'host' && !this.state.coop.running) {
      this._broadcastCoopRoster(); this.updateCoopUI(); return true;
    }
    if (this.state.coop?.role !== 'guest' || this.state.coop.running || !this.state.coop.connected) return false;
    return this.coopSession.sendEvent('ready', {
      ready: this.state.coop.localReady,
      armory: this.player.exportArmory(),
      backpackItems: (this.state.inventory || []).map(item => ({ ...item }))
    });
  }

  _preparedSummary(armory, items = []) {
    return { weapons: [armory?.loadout?.primary, armory?.loadout?.sidearm].filter(id => Config.weapons[id]).map(id => {
      const stock = armory.weaponAmmo?.[id] || {};
      const magazine = Math.max(0, Number(stock.magazine) || 0), reserve = Math.max(0, Number(stock.reserve) || 0);
      return { id, magazine, reserve, total: magazine + reserve };
    }), oxygen: (items || []).filter(i => i.effect === 'oxygen-50').length,
      medkits: (items || []).filter(i => i.effect === 'health-40').length,
      skill: armory?.equippedSkill || null, passive: armory?.equippedPassive || null };
  }

  purchaseWeaponAmmo(id) {
    const pack = Config.ammo.weaponPacks?.[id];
    if (!pack || this.state.running || this.state.transitioning || this.state.coop.running || !this.player.armory.ownedWeapons[id]) return false;
    if (this.state.money < pack.pricePerPurchase) { this._notifyTransaction('信用点不足', 'error'); return false; }
    this.player.armory.weaponAmmo[id].reserve += pack.unitsPerPurchase;
    this.state.money -= pack.pricePerPurchase;
    this.state.armory = this.player.armory;
    this._save(); this.updateMoneyUI(); this.updateAmmoDepotUI(); this._syncPreparedBackpack();
    this._notifyTransaction(`已购买 ${pack.unitsPerPurchase} 发${Config.weapons[id].label}弹药`);
    return true;
  }

  purchaseAmmo(units = Config.ammo.unitsPerPurchase) {
    const amount = Math.floor(Number(units));
    const unitPrice = Config.ammo.pricePerPurchase / Config.ammo.unitsPerPurchase;
    if (!Number.isFinite(amount) || amount < Config.ammo.unitsPerPurchase) {
      this._notifyTransaction(`弹药商店每次至少购买 ${Config.ammo.unitsPerPurchase} 单位`, 'error');
      return false;
    }
    if (this.state.running || this.state.coop.running) return false;
    if (this.state.money < amount * unitPrice) {
      this._notifyTransaction('资金不足，无法购买弹药', 'error');
      return false;
    }
    this.state.money -= amount * unitPrice;
    this.player.armory.standardAmmoUnits += amount;
    this.state.armory = this.player.armory;
    this._save();
    this.updateMoneyUI();
    this.updateAmmoDepotUI();
    this._notifyTransaction(`弹药库已补充 ${amount} 标准弹药单位`);
    this._syncPreparedBackpack();
    return true;
  }

  purchaseOxygenCanister() {
    return this.purchaseSupply('oxygenCanister');
  }

  purchaseMedkit() { return this.purchaseSupply('medkit'); }

  purchaseSupply(kind) {
    const definition = Config.consumables[kind];
    if (!definition || this.state.running || this.state.coop.running) return false;
    if (this.state.money < definition.purchasePrice) {
      this._notifyTransaction(`信用点不足，无法购买${definition.name}`, 'error');
      return false;
    }
    const itemId = `supply-${definition.id}-${Date.now()}-${this.supplySequence = (this.supplySequence || 0) + 1}`;
    const item = {
      ...definition, itemId: definition.id, id: itemId, type: 'consumable',
      rot: 0, rarity: 'uncommon'
    };
    const destination = this.backpack.place(item) ? '下一潜背包' : this.storageBackpack?.place(item) ? '仓库' : null;
    if (!destination) {
      this._notifyTransaction('背包及仓库空间不足，未购买也未扣款', 'error');
      return false;
    }
    this.state.inventory = this.backpack.items;
    this.state.storageItems = this.storageBackpack.items;
    this.state.money -= definition.purchasePrice;
    this._save();
    this.updateMoneyUI();
    this.updateAmmoDepotUI();
    this.updateStorageUI();
    this._syncPreparedBackpack();
    this._notifyTransaction(`${definition.name}已放入${destination}`);
    return true;
  }

  _useOxygenBottle(actor, itemId, backpack = this._backpackFor(actor)) {
    if (backpack?.getItem(itemId)?.effect !== 'oxygen-50') return false;
    return this._useCarriedSupply(actor, itemId, backpack);
  }

  _canUseSupply(actor, item) {
    const field = item?.effect === 'oxygen-50' ? 'oxygen' : item?.effect === 'health-40' ? 'health' : null;
    return !!field && this.state.running && !(actor === this.player && this.state.equipmentSyncing) && !this.state.tutorial?.paused && !this.state.coop?.hostPaused &&
      !actor?.downed && !(actor?.stunned > 0) && !(actor?.flashStunTimer > 0) && !(actor?.dodgeTimer > 0) &&
      !(actor === this.player && (this.state.pauseMenuOpen || this.state.activeQte || this.state.inventoryClosing || this.state.fullMapOpen || this.state.fullMapClosing)) && actor[field] < 100;
  }

  _cancelSupplyUse(actor) {
    if (actor === this.player && this.state.coop?.role === 'guest' && (actor.supplyUse || this._pendingSupplyRequest)) {
      this.coopSession.sendEvent('action', { action:'cancel-supply' });
      this._pendingSupplyRequest = null;
    }
    actor.supplyUse = null;
  }

  _useCarriedSupply(actor, itemId, backpack = this._backpackFor(actor)) {
    const item = backpack?.getItem(itemId);
    if (actor.supplyUse || !this._canUseSupply(actor, item)) return false;
    actor.supplyUse = { itemId: item.id, effect: item.effect, endsAt: (this.state.elapsed || 0) + 2 };
    return true;
  }

  _updateSupplyUses() {
    if (this.state.coop?.running && this.state.coop.role === 'guest') return;
    for (const actor of this._onlineCoopPlayers()) {
      const use = actor.supplyUse;
      if (!use) continue;
      const backpack = this._backpackFor(actor), item = backpack?.getItem(use.itemId);
      if (!this._canUseSupply(actor, item) || this._remoteEntryForActor(actor)?.qte) {
        actor.supplyUse = null;
        continue;
      }
      if (this.state.elapsed < use.endsAt) continue;
      actor.supplyUse = null;
      this._completeSupplyUse(actor, item, backpack);
    }
  }

  _completeSupplyUse(actor, item, backpack) {
    const oxygen = item.effect === 'oxygen-50';
    const field = oxygen ? 'oxygen' : 'health';
    const before = actor[field];
    backpack.removeItem(item);
    actor[field] = Math.min(100, before + (oxygen ? 50 : 40));
    const entry = this._remoteEntryForActor(actor);
    if (entry) { entry.inventory = backpack.items; entry.inventoryRevision = (entry.inventoryRevision || 0) + 1; }
    else this.state.inventoryRevision = (this.state.inventoryRevision || 0) + 1;
    if (actor === this.player) this._tutorialAction(oxygen ? 'oxygen' : 'medkit', { before, after: actor[field], consumed: true });
    if (actor === this.player) {
      this.selectedItemId = null;
      this.updateInventoryUI();
      this._save();
    }
    if (actor === this.player) this.ui.showToast(oxygen ? '氧气瓶已使用，氧气恢复 50%' : '急救包已使用，生命恢复 40');
    return true;
  }

  useSelectedInventoryItem(itemId = this.selectedItemId) {
    const item = this.backpack.getItem(itemId);
    if (!this._canUseSupply(this.player, item)) return false;
    if (this.state.coop.running && this.state.coop.role === 'guest') {
      if (this.player.supplyUse || this._pendingSupplyRequest) return false;
      const requestId = this._supplyRequestSequence = (this._supplyRequestSequence || 0) + 1;
      const payload = { action: 'use-supply', itemId: item.id, requestId, missionId: this.state.missionFxId };
      const sent = this.coopSession.sendEvent('action', payload);
      if (sent) this._pendingSupplyRequest = { requestId, payload, sentAt: performance.now() };
      if (sent) this.ui.showToast('已请求使用补给，等待房主确认');
      return sent;
    }
    return this._useCarriedSupply(this.player, item.id, this.backpack);
  }

  purchaseAmmoFromUI() {
    return this.purchaseAmmo(Number(this.ui.ammoPurchaseAmount?.value));
  }

  transferAmmoFromUI() {
    const transferred = this.transferAmmo(
      this.ammoTransferSelection.source,
      this.ammoTransferSelection.target,
      Number(this.ui.ammoTransferAmount?.value)
    );
    this._notifyTransaction(transferred ? '弹药转换完成' : '库存不足，或转换数量无法组成完整弹药', transferred ? 'success' : 'error');
    return transferred;
  }

  transferAmmo(sourceId, targetId, amount) {
    if (this.state.running || this.state.coop.running || sourceId === targetId) return false;
    const unitsPerRound = Config.ammo.standardUnitsPerRound;
    const armory = this.player.armory;
    const quantity = Math.floor(Number(amount));
    if (!Number.isFinite(quantity) || quantity <= 0) return false;

    let standardUnits;
    if (sourceId === 'standard') {
      if (armory.standardAmmoUnits < quantity || !unitsPerRound[targetId] || !armory.ownedWeapons[targetId]) return false;
      standardUnits = quantity;
      const targetRounds = Math.floor(standardUnits / unitsPerRound[targetId]);
      if (targetRounds <= 0) return false;
      const usedUnits = targetRounds * unitsPerRound[targetId];
      armory.standardAmmoUnits -= usedUnits;
      armory.weaponAmmo[targetId].reserve += targetRounds;
    } else {
      if (!unitsPerRound[sourceId] || !armory.ownedWeapons[sourceId] || armory.weaponAmmo[sourceId].reserve < quantity ||
          (targetId !== 'standard' && (!unitsPerRound[targetId] || !armory.ownedWeapons[targetId]))) return false;
      standardUnits = quantity * unitsPerRound[sourceId];
      armory.weaponAmmo[sourceId].reserve -= quantity;
      if (targetId === 'standard') {
        armory.standardAmmoUnits += standardUnits;
      } else {
        const targetRounds = Math.floor(standardUnits / unitsPerRound[targetId]);
        if (targetRounds <= 0) {
          armory.weaponAmmo[sourceId].reserve += quantity;
          return false;
        }
        const usedUnits = targetRounds * unitsPerRound[targetId];
        armory.weaponAmmo[targetId].reserve += targetRounds;
        armory.standardAmmoUnits += standardUnits - usedUnits;
      }
    }

    this.state.armory = armory;
    this._save();
    this.updateAmmoDepotUI();
    return true;
  }

  setFpsCap(value) {
    const fpsCap = ['30', '60', '90', '120', 'unlimited'].includes(String(value))
      ? String(value)
      : '60';
    this.state.fpsCap = fpsCap;
    this.state.nextFrameAt = 0;
    this.ui.updateFpsCap(fpsCap);
    this._save();
  }

  updateHunterSetting(scaleKey, key, value) {
    if (this.state.running || this.state.coop.role === 'guest') return;
    const difficultyId = this.difficultyEditor || this.state.selectedDifficulty;
    const profile = this._getDifficultyProfile(difficultyId);
    if (!profile.maps[scaleKey] || !Object.hasOwn(profile.maps[scaleKey], key)) return;
    profile.maps[scaleKey][key] = value;
    this.state.difficultyProfiles[difficultyId] =
      this._sanitizeDifficultyProfiles(this.state.difficultyProfiles)[difficultyId];
    if (difficultyId === this.state.selectedDifficulty) this._applyDifficultyProfile(difficultyId);
    else { this._save(); this.updateHunterSettingsUI(); }
  }

  updateFinalTerminalSetting(key, value) {
    if (this.state.running || this.state.coop.role === 'guest') return;
    if (!['finalTerminalSpawnCount', 'finalTerminalSpawnInterval'].includes(key)) return;
    const difficultyId = this.difficultyEditor || this.state.selectedDifficulty;
    const profile = this._getDifficultyProfile(difficultyId);
    profile[key] = value;
    this.state.difficultyProfiles[difficultyId] =
      this._sanitizeDifficultyProfiles(this.state.difficultyProfiles)[difficultyId];
    if (difficultyId === this.state.selectedDifficulty) this._applyDifficultyProfile(difficultyId, false);
    else { this._save(); this.updateHunterSettingsUI(); }
  }

  resetHunterSettings() {
    if (this.state.running || this.state.coop.role === 'guest') return;
    const difficultyId = this.difficultyEditor || this.state.selectedDifficulty;
    this.state.difficultyProfiles[difficultyId] = this._sanitizeDifficultyProfiles()[difficultyId];
    if (difficultyId === this.state.selectedDifficulty) this._applyDifficultyProfile(difficultyId);
    else { this._save(); this.updateHunterSettingsUI(); }
  }

  _createStorageBackpack() {
    const cols = Config.storage.cols;
    const capacity = Math.max(Config.storage.capacityCells, Math.round(Number(this.state.storageCapacity) || Config.storage.capacityCells));
    return new BackpackManager({ ...Config.storage, rows: Math.ceil(capacity / cols) });
  }

  _initializeStorage() {
    const stored = Array.isArray(this.state.storageItems) ? this.state.storageItems : [];
    const overflow = Array.isArray(this.state.storageOverflowItems) ? this.state.storageOverflowItems : [];
    this.state.storageCapacity = Math.ceil(Math.max(
      Config.storage.capacityCells,
      Number(this.state.storageCapacity) || Config.storage.capacityCells
    ) / Config.storage.cols) * Config.storage.cols;
    this.state.storageItems = [];
    this.state.storageOverflowItems = [];
    this.storageBackpack = this._createStorageBackpack();
    this.storageNextId = 1;
    for (const source of [...stored, ...overflow]) {
      const item = {
        ...source,
        id: this.storageNextId++,
        rot: BackpackManager.normalizeRotation(source.rot)
      };
      item.shape = this.storageBackpack.shapeIdFor(item);
      if (!this.storageBackpack.place(item, { gx: source.gx, gy: source.gy, rot: item.rot })) {
        this.state.storageOverflowItems.push(item);
      }
    }
    this.state.storageItems = this.storageBackpack.items;
  }

  _storeRecoveredItems(items) {
    for (const source of items || []) {
      const item = {
        ...source,
        id: this.storageNextId++,
        rot: BackpackManager.normalizeRotation(source.rot)
      };
      item.shape = this.storageBackpack.shapeIdFor(item);
      if (!this.storageBackpack.place(item, { rot: item.rot })) this.state.storageOverflowItems.push(item);
    }
    this._fillStorageOverflow();
  }

  _fillStorageOverflow() {
    const pending = this.state.storageOverflowItems || [];
    for (let index = 0; index < pending.length;) {
      if (this.storageBackpack.place(pending[index], { rot: pending[index].rot })) pending.splice(index, 1);
      else index++;
    }
    this.state.storageItems = this.storageBackpack.items;
    return pending.length;
  }

  toggleStorageItemSelection(itemId) {
    const key = String(itemId);
    if (this.selectedStorageIds.has(key)) this.selectedStorageIds.delete(key);
    else this.selectedStorageIds.add(key);
    this.updateStorageUI();
    return this.selectedStorageIds.has(key);
  }

  togglePreparedPackItemSelection(itemId) {
    const selected = this.selectedPackIds || (this.selectedPackIds = new Set());
    const key = String(itemId);
    if (selected.has(key)) selected.delete(key);
    else selected.add(key);
    this.updateStorageUI();
    return selected.has(key);
  }

  _moveGridItem(item, source, target, sourceList, sourceOverflow = false) {
    const originalId = item.id;
    if (target.items.some(existing => String(existing.id) === String(item.id))) {
      let suffix = 1;
      while (target.items.some(existing => String(existing.id) === `${item.id}-m${suffix}`)) suffix++;
      item.id = `${item.id}-m${suffix}`;
    }
    if (!target.place(item, { rot: item.rot })) {
      item.id = originalId;
      return false;
    }
    if (sourceOverflow) {
      const index = sourceList.indexOf(item);
      if (index >= 0) sourceList.splice(index, 1);
    } else {
      source.removeItem(item);
    }
    if (source === this.backpack && target !== this.backpack) delete item.quickUse;
    return true;
  }

  _moveGridItemAt(item, source, target, gx, gy, rot) {
    if (!source.getItem(item)) return false;
    const rotation = BackpackManager.normalizeRotation(rot);
    if (!target.canPlace(target.matrixFor(item, rotation), gx, gy)) return false;
    const original = { id: item.id, gx: item.gx, gy: item.gy, rot: item.rot };
    if (target.items.some(existing => String(existing.id) === String(item.id))) {
      let suffix = 1;
      while (target.items.some(existing => String(existing.id) === `${original.id}-m${suffix}`)) suffix++;
      item.id = `${original.id}-m${suffix}`;
    }
    if (!target.place(item, { gx, gy, rot: rotation })) {
      Object.assign(item, original);
      return false;
    }
    source.removeItem(item);
    if (source === this.backpack) delete item.quickUse;
    return true;
  }

  getQuickItem() {
    return this.backpack.items.find(item => item.quickUse === true && item.effect === 'oxygen-50') || null;
  }

  assignQuickItem(itemId, source = 'backpack') {
    if (this.state.running || this.state.coop.running) return false;
    let item = source === 'storage' ? this.storageBackpack.getItem(itemId) : this.backpack.getItem(itemId);
    if (!item || item.effect !== 'oxygen-50') return false;
    if (source === 'storage' && !this._moveGridItem(item, this.storageBackpack, this.backpack, this.storageBackpack.items)) {
      this.ui.showToast('背包空间不足，无法装备氧气瓶');
      return false;
    }
    for (const other of this.backpack.items) delete other.quickUse;
    item.quickUse = true;
    this.state.inventory = this.backpack.items;
    this._fillStorageOverflow?.();
    this.updateStorageUI();
    this._save();
    this._syncPreparedBackpack?.();
    return true;
  }

  clearQuickItem() {
    const item = this.getQuickItem();
    if (!item) return false;
    delete item.quickUse;
    this.updateStorageUI();
    this._save();
    this._syncPreparedBackpack?.();
    return true;
  }

  toggleQuickItemFromSelection() {
    if (this.getQuickItem()) return this.clearQuickItem();
    const fromBag = this.selectedPackIds.size === 1 && this.selectedStorageIds.size === 0;
    const fromStorage = this.selectedStorageIds.size === 1 && this.selectedPackIds.size === 0;
    const itemId = fromBag ? [...this.selectedPackIds][0] : fromStorage ? [...this.selectedStorageIds][0] : null;
    if (!itemId) return false;
    return this.assignQuickItem(itemId, fromStorage ? 'storage' : 'backpack');
  }

  handleQuickSlotClick() {
    if (this._ignoreQuickSlotClick) {
      this._ignoreQuickSlotClick = false;
      return false;
    }
    return this.toggleQuickItemFromSelection();
  }

  useQuickItem(effect = 'oxygen-50') {
    if (!this.state.running || this.state.pauseMenuOpen || this.state.coop?.hostPaused || this.state.tutorial?.paused ||
        this.state.fullMapOpen || this.state.fullMapClosing || this.state.inventoryOpen || this.state.inventoryClosing ||
        this.state.activeQte || this.player.dodgeTimer > 0 || this.player.downed || this.player.stunned > 0 ||
        this.player.flashStunTimer > 0) return false;
    const item = this.backpack.items.find(item => item.effect === effect);
    if (!item) { this.ui.showToast(effect === 'health-40' ? '背包中没有可用急救包' : '背包中没有可用氧气瓶'); return false; }
    return this.useSelectedInventoryItem(item.id);
  }

  carriedOxygenCount() {
    return (this.backpack?.items || []).filter(item => item.effect === 'oxygen-50').length;
  }

  updateEquipmentUI() {
    this._refreshFlashbangStock();
    const loadout = this.player?.armory?.loadout || {};
    for (const [slot, capitalized, label] of [['primary', 'Primary', '主武器'], ['sidearm', 'Sidearm', '副武器']]) {
      const weapon = Config.weapons[loadout[slot]];
      for (const prefix of ['prep', 'inventory']) {
        const image = document.getElementById(`${prefix}${capitalized}Image`);
        const name = document.getElementById(`${prefix}${capitalized}Name`);
        if (image) {
          image.hidden = !weapon;
          if (weapon) image.src = `resources/images/equipment-v17/${weapon.id}.png`;
        }
        if (name) name.textContent = prefix === 'prep'
          ? `${label}：${weapon?.label || '未装备'}` : weapon?.label || '未装备';
      }
    }
    const oxygenCount = this.carriedOxygenCount();
    const quickImage = document.getElementById('inventoryQuickImage');
    const quickName = document.getElementById('inventoryQuickName');
    if (quickImage) quickImage.classList.toggle('empty', !oxygenCount);
    if (quickName) quickName.textContent = `氧气瓶 ×${oxygenCount} [C]`;
    this.ui.updateOxygenStock?.(oxygenCount, this.carriedMedkitCount());
  }

  transferSelectedStorageToBackpack() {
    if (this.state.running || this.state.coop.running) return 0;
    const selected = this.selectedStorageIds || new Set();
    if (!selected.size) return 0;
    let moved = 0;
    for (const item of [...this.storageBackpack.items, ...(this.state.storageOverflowItems || [])]) {
      if (!selected.has(String(item.id))) continue;
      const originalId = String(item.id);
      const overflow = !(this.storageBackpack.items.includes(item));
      if (!this._moveGridItem(item, this.storageBackpack, this.backpack,
        overflow ? this.state.storageOverflowItems : this.storageBackpack.items, overflow)) continue;
      selected.delete(originalId);
      moved++;
    }
    this._fillStorageOverflow();
    this.state.inventory = this.backpack.items;
    this.updateStorageUI();
    this._save();
    this._syncPreparedBackpack();
    if (moved) this.ui.showToast(`已将 ${moved} 件物资放入下一潜背包`);
    return moved;
  }

  transferSelectedBackpackToStorage() {
    if (this.state.running || this.state.coop.running) return 0;
    const selected = this.selectedPackIds || new Set();
    if (!selected.size) return 0;
    let moved = 0;
    for (const item of [...this.backpack.items]) {
      if (!selected.has(String(item.id))) continue;
      const originalId = String(item.id);
      if (!this._moveGridItem(item, this.backpack, this.storageBackpack, this.backpack.items)) continue;
      selected.delete(originalId);
      moved++;
    }
    this._fillStorageOverflow();
    this.state.inventory = this.backpack.items;
    this.updateStorageUI();
    this._save();
    this._syncPreparedBackpack();
    if (moved) this.ui.showToast(`已将 ${moved} 件物资存入仓库`);
    return moved;
  }

  storeAllBackpackItems() {
    this.selectedPackIds = new Set(this.backpack.items.map(item => String(item.id)));
    const moved = this.transferSelectedBackpackToStorage();
    if (this.backpack.items.length) this.ui.showToast(`${this.backpack.items.length} 件物资因仓库空间不足仍留在背包`);
    return moved;
  }

  sellSelectedPreparedBackpack() {
    if (this.state.running || this.state.coop.running) return 0;
    const selected = this.selectedPackIds || new Set();
    if (!selected.size) return 0;
    let total = 0;
    for (const item of [...this.backpack.items]) {
      if (!selected.has(String(item.id))) continue;
      total += Number(item.value) || 0;
      this.backpack.removeItem(item);
      selected.delete(String(item.id));
    }
    if (!total) return 0;
    this.state.money += total;
    this.state.inventory = this.backpack.items;
    this.updateMoneyUI();
    this.updateStorageUI();
    this._save();
    this._syncPreparedBackpack();
    this._notifyTransaction(`出售背包选中物资，获得 ${this.ui.formatCreditText(total)}`);
    return total;
  }

  sellAllPreparedBackpack() {
    if (this.state.running || this.state.coop.running) return 0;
    this.selectedPackIds = new Set(this.backpack.items.map(item => String(item.id)));
    return this.sellSelectedPreparedBackpack();
  }

  moveStorageItem(itemId, gx, gy, rotation = null) {
    const item = this.storageBackpack.items.find(entry => String(entry.id) === String(itemId));
    if (!item || !this.storageBackpack.moveItem(item, gx, gy, rotation)) return false;
    this._fillStorageOverflow();
    this.updateStorageUI();
    this._save();
    return true;
  }

  rotateStorageItem(itemId) {
    const item = this.storageBackpack.items.find(entry => String(entry.id) === String(itemId));
    if (!item || !this.storageBackpack.rotateItem(item)) return false;
    this._fillStorageOverflow();
    this.updateStorageUI();
    this._save();
    return true;
  }

  _rotateSelectedStorageItem() {
    if (this.selectedStorageIds.size !== 1) return false;
    const [itemId] = this.selectedStorageIds;
    if (!this.storageBackpack.items.some(item => String(item.id) === String(itemId))) {
      this.ui.showToast('待入库物资收进主仓后才能旋转');
      return false;
    }
    if (!this.rotateStorageItem(itemId)) {
      this.ui.showToast('当前位置没有足够空间旋转物资');
      return false;
    }
    return true;
  }

  rotatePreparedPackItem(itemId) {
    const item = this.backpack.getItem(itemId);
    if (!item || !this.backpack.rotateItem(item)) return false;
    this.updateStorageUI();
    this._save();
    this._syncPreparedBackpack();
    return true;
  }

  _rotateSelectedPreparedPackItem() {
    if (this.selectedPackIds?.size !== 1) return false;
    const [itemId] = this.selectedPackIds;
    if (!this.rotatePreparedPackItem(itemId)) {
      this.ui.showToast('当前位置没有足够空间旋转物资');
      return false;
    }
    return true;
  }

  sellSelectedStorage() {
    const selected = this.selectedStorageIds;
    if (!selected?.size) return 0;
    const ids = new Set([...selected].map(String));
    let total = 0;
    for (const item of [...this.storageBackpack.items]) {
      if (!ids.has(String(item.id))) continue;
      total += Number(item.value) || 50;
      this.storageBackpack.removeItem(item);
    }
    this.state.storageOverflowItems = this.state.storageOverflowItems.filter(item => {
      if (!ids.has(String(item.id))) return true;
      total += Number(item.value) || 50;
      return false;
    });
    selected.clear();
    if (!total) return 0;
    this.state.money += total;
    this._fillStorageOverflow();
    this._notifyTransaction(`已出售选中物资，获得 ${this.ui.formatCreditText(total)}`);
    this.updateStorageUI();
    this.updateMoneyUI();
    this._save();
    return total;
  }

  _migrateStarshipSupplies(data) {
    this.state.skillInventoryMigrationVersion = Number(data.skillInventoryMigrationVersion) || 0;
    this.state.starterGrantVersion = Number(data.starterGrantVersion) || 0;
    let changed = false;
    if (this.state.skillInventoryMigrationVersion < 1) {
      let refunded = data.flashbangInventoryVersion === 1 ? 0 : this._normalizeFlashbangCount(data.flashbangCount);
      for (const items of [this.backpack.items, this.storageBackpack.items, this.state.storageOverflowItems]) {
        for (let index = items.length - 1; index >= 0; index--) {
          if (items[index].effect !== 'flashbang' && items[index].itemId !== 'flashbang') continue;
          items.splice(index, 1); refunded++;
        }
      }
      this.state.money += refunded * 500;
      this.state.skillInventoryMigrationVersion = 1;
      changed = true;
    }
    if (this.state.starterGrantVersion < 1) {
      this.player.armory.standardAmmoUnits += 1000;
      const existing = new Set([...this.backpack.items, ...this.storageBackpack.items, ...this.state.storageOverflowItems]
        .map(item => String(item.id).replace(/^carry:/, '')));
      let sequence = 1;
      for (let count = 0; count < 5; count++) {
        let id;
        do { id = `starter-oxygen-${sequence++}`; } while (existing.has(id));
        existing.add(id);
        const item = { ...Config.consumables.oxygenCanister, id, itemId: 'oxygen-canister', type: 'consumable', rarity: 'uncommon', rot: 0 };
        if (!this.backpack.place(item) && !this.storageBackpack.place(item)) this.state.storageOverflowItems.push(item);
      }
      this.state.starterGrantVersion = 1;
      changed = true;
    }
    this.state.inventory = this.backpack.items;
    this.state.storageItems = this.storageBackpack.items;
    this.state.armory = this.player.armory;
    if (changed) this._save();
  }

  _migrateEnemyCounts(data = {}) {
    const saved = JSON.parse(JSON.stringify(data.difficultyProfiles || {}));
    if (Number(data.enemyCountMigrationVersion) !== 1) {
      for (const profile of Object.values(saved)) {
        if (!profile || typeof profile !== 'object') continue;
        for (const settings of Object.values(profile.maps || {})) {
          if (!settings || typeof settings !== 'object') continue;
          for (const key of ['hunters', 'hunterRespawnCount']) {
            if (settings[key] != null && settings[key] !== '' && Number.isFinite(Number(settings[key]))) {
              settings[key] = Math.max(0, Math.min(200, Math.round(Number(settings[key])) * 2));
            }
          }
        }
        if (profile.finalTerminalSpawnCount != null && profile.finalTerminalSpawnCount !== '' && Number.isFinite(Number(profile.finalTerminalSpawnCount))) {
          profile.finalTerminalSpawnCount = Math.max(0, Math.min(200, Math.round(Number(profile.finalTerminalSpawnCount)) * 2));
        }
      }
    }
    this.state.enemyCountMigrationVersion = 1;
    return this._sanitizeDifficultyProfiles(saved);
  }

  carriedMedkitCount() { return (this.backpack?.items || []).filter(item => item.effect === 'health-40').length; }

  _migratePlayerFeedbackProfiles(data = {}) {
    const profiles = this._sanitizeDifficultyProfiles(data.difficultyProfiles);
    if (Number(data.playerFeedbackMigrationVersion) !== 1) {
      for (const [difficulty, defaults] of Object.entries(Config.difficultyPresets)) {
        for (const [scale, settings] of Object.entries(defaults.maps)) {
          profiles[difficulty].maps[scale].hunters = settings.hunters;
          profiles[difficulty].maps[scale].hunterMaxHp = settings.hunterMaxHp;
        }
      }
    }
    this.state.enemyCountMigrationVersion = 1;
    this.state.playerFeedbackMigrationVersion = 1;
    return profiles;
  }

  _loadSave() {
    try {
      const data = SaveRewards.read();
      SaveRewards.restore(this.state, data);
      if (data.money != null) this.state.money = data.money;
      if (Array.isArray(data.backpackItems)) this.state.inventory = data.backpackItems;
      if (Array.isArray(data.storageItems)) this.state.storageItems = data.storageItems;
      if (Array.isArray(data.storageOverflowItems)) this.state.storageOverflowItems = data.storageOverflowItems;
      for (const items of [this.state.inventory, this.state.storageItems, this.state.storageOverflowItems]) {
        for (const item of items || []) {
          if (item.effect === 'oxygen-50' || item.itemId === 'oxygen-canister') Object.assign(item, { value: 150, purchasePrice: 300 });
        }
      }
      this.state.storageCapacity = Math.max(Config.storage.capacityCells, Number(data.storageCapacityCells) || Config.storage.capacityCells);
      this._initializeStorage();
      this.state.difficultyProfiles = this._migratePlayerFeedbackProfiles(data);
      this.state.selectedDifficulty = Config.difficultyPresets[data.difficultyPreset]
        ? data.difficultyPreset
        : 'medium';
      this.state.hunterSettings = this._buildDifficultySettings(this.state.selectedDifficulty);
      this.state.finalTerminalSettings = this._finalTerminalSettings(this._getDifficultyProfile());
      this.state.armory = data.armoryVersion === 1 && data.armory
        ? Player.normalizeArmory(data.armory)
        : Player.createDefaultArmory();
      this.player.configureArmory(this.state.armory);
      this.state.fpsCap = ['30', '60', '90', '120', 'unlimited'].includes(String(data.fpsCap))
        ? String(data.fpsCap)
        : '60';
      this.state.corpseLimit = [40, 100, 200].includes(Number(data.corpseLimit)) ? Number(data.corpseLimit) : 100;
      this._bindBackpackInventories();
      this._migrateStarshipSupplies(data);
      this._refreshFlashbangStock();
      if (Number(data.enemyCountMigrationVersion) !== 1 || Number(data.playerFeedbackMigrationVersion) !== 1) this._save();
    } catch (e) { /* ignore corrupt save */ }
  }

  _save() {
    if (this.trainingSession) return;
    try {
      const rewardFields = SaveRewards.mergeForSave(this.state, SaveRewards.read());
      localStorage.setItem('voidshift_save', JSON.stringify({
        ...rewardFields,
        armoryVersion: 1,
        armory: this.player.exportArmory(),
        money: this.state.money,
        flashbangInventoryVersion: 1,
        skillInventoryMigrationVersion: this.state.skillInventoryMigrationVersion || 0,
        starterGrantVersion: this.state.starterGrantVersion || 0,
        backpackItems: this.state.running
          ? (this.state.inventory || []).filter(item => !item.foundThisRun)
          : this.state.inventory,
        storageItems: this.state.storageItems,
        storageOverflowItems: this.state.storageOverflowItems,
        storageCapacityCells: this.state.storageCapacity,
        difficultyProfiles: this.state.difficultyProfiles,
        difficultyPreset: this.state.selectedDifficulty,
        fpsCap: this.state.fpsCap,
        corpseLimit: this.state.corpseLimit || 100,
        enemyCountMigrationVersion: this.state.enemyCountMigrationVersion || 1,
        playerFeedbackMigrationVersion: this.state.playerFeedbackMigrationVersion || 1
      }));
      return true;
    } catch (e) {
      if (!this._saveWarningShown) this.ui?.showToast?.('存档未能写入，请检查浏览器存储空间；奖励暂不显示为到账');
      this._saveWarningShown = true;
      return false;
    }
  }

  async claimDailyReward() {
    if (this.trainingSession || this.state.running || this.state.transitioning) return false;
    try {
      if (!this._save()) return false;
      const result = await SaveRewards.claimDaily();
      SaveRewards.mergeForSave(this.state, result.data);
      this.updateMoneyUI();
      this.ui.showToast(result.claimed ? '已领取每日奖励：1,000 信用点' : '今天的奖励已领取');
      this.menu?.updateRewards?.();
      return result.claimed;
    } catch (error) {
      this.ui.showToast(error.message || '奖励未能保存，请稍后重试');
      return false;
    }
  }

  /**
   * Resets all sub-modules and core telemetry state values
   */
  reset(trainingBoot = false) {
    if (this.trainingSession && !trainingBoot) { this.trainingSession.retry(); return; }
    this._clearEnemyEffects();
    this.state.missionFxId = this.state.coop?.running && this.state.coop.missionFxId
      ? this.state.coop.missionFxId : this._newMissionId('solo');
    if (this.state.descentTimer) clearTimeout(this.state.descentTimer);
    if (!this.state.coop?.running) {
      this.state.missionHunterSettings = null;
      this.state.missionFinalTerminalSettings = null;
    }
    Object.assign(this.state, {
      running: false,
      transitioning: false,
      descentTimer: null,
      pendingTutorialMode: false,
      pauseMenuOpen: false,
      abandonPending: false,
      settlement: null,
      completed: false,
      revealAllMap: false,
      stabilized: false,
      laserJitter: 0,
      cameraZoom: Config.camera.baseZoom,
      cameraLookX: 0,
      cameraLookY: 0,
      loot: 0,
      lootValue: 0,
      elapsed: 0,
      hunterSpawnTimer: this._getHunterSettings().hunterSpawnInterval,
      huntersInitialized: false,
      finalTerminalPressure: false,
      powerLossStartedAt: null,
      tutorial: null,
      extractionCalled: false,
      rescueRemaining: 0,
      rescueArrived: false,
      rescuePresent: 0,
      rescueRequired: 0,
      extracted: false,
      activeQte: null,
      inventoryOpen: false,
      inventoryClosing: false,
      fullMapOpen: false,
      fullMapClosing: false,
      fullMapZoom: 1,
      fullMapPanX: 0,
      fullMapPanY: 0,
      fullMapDragging: false,
      fullMapDragX: 0,
      fullMapDragY: 0,
      qteMonsterTpCooldown: 0,
      mouseX: 0,
      mouseY: 0,
      lastTime: 0,
      nextFrameAt: 0,
      lastJumpscareTime: 0,
      fireHeld: false
    });
    this.state.muzzleFlashTimer = 0;
    this.state.muzzleFlashes = [];
    this.state.flashbangs = [];
    this.state.flashBursts = [];
    this.equipment?.reset();
    this._pendingSupplyRequest = null;
    this.seenFlashEffects = new Set();
    this._resolvedGrenades = new Set();
    this._pendingSkillRequest = null;
    this.seenWeaponEffects?.clear?.();
    this.shotSequence = 0;
    this.state.keys = {};
    this.coopReviveAssignments?.clear?.();
    this.ui.hideDescentTransition();
    this.ui.setPauseMenuVisible?.(false);
    this.ui.updateCoopRevivePrompt?.('');
    this.ui.hideTutorial();
    if (this.ui.setFullMapVisible) {
      this.ui.setFullMapVisible(false);
    }
    this.resetFullMapView();
    this._cancelItemDrag();
    if (this._inventoryCloseTimer) clearTimeout(this._inventoryCloseTimer);
    this._inventoryCloseTimer = null;
    this.state.remoteInventory = [];
    this._guestInventoryLayoutPending = false;
    this._guestInventoryLayoutPendingAt = 0;
    this._bindBackpackInventories();
    const inventoryOverlay = document.getElementById('inventoryOverlay');
    if (inventoryOverlay) {
      inventoryOverlay.style.display = 'none';
      inventoryOverlay.classList.remove('is-open', 'is-closing');
    }

    if (this.trainingSession) {
      this.map = MapManager.createTraining();
      Config.WORLD_W = this.map.worldW; Config.WORLD_H = this.map.worldH;
    } else this.map.reset(Config.currentScale, this.state.coop.running
      ? this.state.coop.mapSeed : this._ensureMenuMapSeeds()[Config.currentScale], 0, this.state.selectedDifficulty);
    this.player.reset(this.map, this.state.armory,
      this.state.armory.loadout.primary ? 'primary' : 'sidearm');
    this.player.setMissionAmmoRules(this.trainingSession ? null : this.state.selectedDifficulty);
    this.state.armory = this.player.armory;
    this._resetNightmares();
    this.loot?.reset();
    this.state.inventoryRevision = 0;
    this.heavies = [];
    this.state.heavies = this.heavies;
    this.hunters = this._createHunters();
    this.hunters.forEach(h => h.reset(this.map));
    this.nextHunterSpawnIndex = this.hunters.length;

    this.ui.updateResetState();
    this.ui.updateScaleButtons(Config.currentScale);
    this.updateDifficultyUI();
    this.updateHunterSettingsUI();
    this.updateLoadoutUI();
    this.ui.updateFpsCap(this.state.fpsCap);
    this.ui.updateCorpseLimit?.(this.state.corpseLimit);
    this.updateCoopUI();
    this.ui.updateTerminalsStatus(this.map.terminals, true);
    this.updateStorageUI();
    this.updateMoneyUI();
    
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
    this.ui.update(compositeState, this.player, this.nightmares);
    this.render();
  }

  /**
   * Sets facility map scale (small, medium, large) and regenerates procedural layout
   */
  setMapScale(scaleKey) {
    if (this.trainingSession) return;
    if (this.state.running || this.state.coop.role === 'guest') {
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
    this.map.reset(scaleKey, this._ensureMenuMapSeeds()[scaleKey], 0, this.state.selectedDifficulty);
    this.loot?.reset();
    this.resetFullMapView();
    this.player.reset(this.map, this.state.armory,
      this.state.armory.loadout.primary ? 'primary' : 'sidearm');
    this.state.armory = this.player.armory;
    this._resetNightmares();
    this.hunters = this._createHunters();
    this.hunters.forEach(h => h.reset(this.map));
    this.nextHunterSpawnIndex = this.hunters.length;
    this.ui.updateTerminalsStatus(this.map.terminals, true);
    this.render();
    this.ui.log(`设施规模重构: ${scaleConfig.label} (共 ${scaleConfig.roomCount} 舱室)`);
    this.ui.showToast(`设施已重构: ${scaleConfig.label}`);
    this.menu?.queueRefresh();
    if (this.state.coop.role === 'host') this._broadcastCoopRoster();
  }

  /**
   * Toggles display of the Full Tactical Facility Map modal (activated by 'M' key)
   */
  toggleFullMap(forceState = null) {
    const wasOpen = this.state.fullMapOpen;
    const newState = forceState !== null ? !!forceState : !this.state.fullMapOpen;
    if (newState && (this.state.inventoryOpen || this.state.inventoryClosing)) return false;
    this.state.fullMapOpen = newState;
    if (newState) {
      this.state.keys = {};
      this.state.fireHeld = false;
      this._sendGuestInput(true);
    }
    this.state.fullMapClosing = !newState && wasOpen && !window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (newState !== wasOpen) this._tutorialAction(newState ? 'map-open' : 'map-close');
    if (!newState) {
      this.state.fullMapDragging = false;
      if (this.ui.fullMapCanvas) this.ui.fullMapCanvas.classList.remove('dragging');
    }
    if (this.ui.setFullMapVisible) {
      this.ui.setFullMapVisible(newState, () => {
        this.state.fullMapClosing = false;
        this.state.keys = {};
      });
    }
    if (newState) {
      this.centerFullMapOnPlayer();
      if (this.ui.updateFullMapStats) {
        this.ui.updateFullMapStats(this.map, this.state);
      }
      this.renderer.drawFullMap(this.player, this.map, this.state, this._coopRenderPlayers());
      this.ui.log('打开全局战术地图 [按 M 或 ESC 关闭]');
    } else {
      this.ui.log('关闭全局战术地图，返回现场监视');
    }
  }

  centerFullMapOnPlayer() {
    const canvas = this.ui.fullMapCanvas;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.width / dpr, height = canvas.height / dpr;
    if (!(width > 0 && height > 0)) return;
    const fit = this.renderer.getFullMapFit(this.map, width, height);
    this.state.fullMapZoom = 1.5;
    this.state.fullMapPanX = width / 2 - (this.player.x * fit.scale + fit.offsetX) * 1.5;
    this.state.fullMapPanY = height / 2 - (this.player.y * fit.scale + fit.offsetY) * 1.5;
  }

  setFullMapZoomAt(factor, clientX = null, clientY = null) {
    const canvas = this.ui.fullMapCanvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const anchorX = clientX == null ? rect.width / 2 : clientX - rect.left;
    const anchorY = clientY == null ? rect.height / 2 : clientY - rect.top;
    const oldZoom = this.state.fullMapZoom || 1;
    const zoom = Math.max(0.5, Math.min(4, oldZoom * factor));
    const ratio = zoom / oldZoom;
    this.state.fullMapPanX = anchorX - (anchorX - this.state.fullMapPanX) * ratio;
    this.state.fullMapPanY = anchorY - (anchorY - this.state.fullMapPanY) * ratio;
    this.state.fullMapZoom = zoom;
    if (this.state.fullMapOpen && zoom !== oldZoom) this._tutorialAction('map-manipulated');
    if (this.state.fullMapOpen) this.renderer.drawFullMap(this.player, this.map, this.state, this._coopRenderPlayers());
  }

  resetFullMapView() {
    this.state.fullMapZoom = 1;
    this.state.fullMapPanX = 0;
    this.state.fullMapPanY = 0;
    this.state.fullMapDragging = false;
    if (this.ui.fullMapCanvas) this.ui.fullMapCanvas.classList.remove('dragging');
    if (this.state.fullMapOpen) this.renderer.drawFullMap(this.player, this.map, this.state, this._coopRenderPlayers());
  }

  /**
   * Commences exploration run under standard recovery protocols
   */
  start(tutorialMode = false) {
    if (tutorialMode && !this.trainingSession) { this.startTutorial(); return; }
    if (this.trainingSession && !tutorialMode) return;
    if (this.state.running || this.state.transitioning) return;
    if ((this.state.coop.role || this.state.coop.roomPending) && !this.state.coop.running) {
      this.ui.showToast('请在 CO-OP 大厅准备后由房主开始任务');
      return;
    }
    if (!this.trainingSession && (this.state.completed || (Number.isFinite(this.map?.seed) &&
        (this.map.seed !== this._ensureMenuMapSeeds()[Config.currentScale] || this.map.difficulty !== this.state.selectedDifficulty)))) this.reset();

    this.state.pendingTutorialMode = !!tutorialMode;
    this.state.transitioning = true;
    this.state.keys = {};
    this.state.fireHeld = false;
    this.audio.ensureAudio();
    this.audio.preloadSound?.('resources/gun-shot-359196.mp3');
    this.ui.showDescentTransition(DESCENT_TIPS[Math.floor(Math.random() * DESCENT_TIPS.length)]);
    this.state.descentTimer = setTimeout(() => this._completeDescentTransition(), 3000);
  }

  _completeDescentTransition() {
    if (!this.state.transitioning) return false;
    if (this.state.descentTimer) clearTimeout(this.state.descentTimer);
    this.state.descentTimer = null;
    this.state.transitioning = false;
    this.state.keys = {};
    this.ui.hideDescentTransition();
    this.selectedStorageIds?.clear?.();
    this.selectedPackIds?.clear?.();
    this.selectedItemId = null;
    this.state.inventory = this._namespacePersistentBackpackItems(this.state.inventory);
    this._bindBackpackInventories();
    this._save();
    const tutorialMode = this.state.pendingTutorialMode;
    this.state.pendingTutorialMode = false;
    this._beginDive(tutorialMode);
    return true;
  }

  _beginDive(tutorialMode = false) {
    if (!this.trainingSession && typeof SaveRewards !== 'undefined') SaveRewards.startProfileMission(this.state.missionFxId, this.state.selectedDifficulty)
      .catch(() => this.ui.showToast('个人战绩暂无法保存，请检查浏览器存储权限'));
    this.state.rewardDepartureOutcome = null;
    if (!this.trainingSession && this.state.coop.role !== 'guest') {
      const roster = this.state.coop.running ? this._coopRosterEntries() : [{ id: 'host', slot: 1 }];
      this.defeatLedger = new DefeatLedger(this.state.missionFxId, roster.map(entry => entry.id));
      this.defeatNames = Object.fromEntries(roster.map(entry => [entry.id, entry.local || entry.id === 'host' ? '房主 / 本机' : `队员 ${entry.slot}`]));
      if (!this.state.coop.running) this.rewardMission = null;
    }
    this.state.authoritativeRewardRows = null;
    this.state.tutorial = tutorialMode
      ? { active: true, paused: true, step: 0, progress: {}, steps: this._tutorialStepsForPlayer() }
      : null;
    if (this.trainingSession) this.trainingSession.prepare(0);
    if (this.audio.beginMissionAudio) this.audio.beginMissionAudio();
    else this.audio.ensureAudio();

    this.state.completed = false; 
    this.state.running = true; 
    this.ui.updateFlashbangs?.(this.state.flashbangCount, this.state);
    this.state.fireHeld = false;
    document.body.classList.add("in-dive");
    this.handleResize();
    
    this.ui.updateStartState();
    this.ui.updateTerminalsStatus(this.map.terminals);
    this.updateDifficultyUI();
    this.updateHunterSettingsUI();
    this.updateLoadoutUI();
    this.updateTutorialAvailability();
    if (this.state.tutorial) {
      this.ui.showTutorialCard(this.state.tutorial.steps[0], 0, this.state.tutorial.steps.length);
    } else {
      this.ui.hideTutorial();
    }

    this.state.lastTime = performance.now();
    requestAnimationFrame((now) => this.loop(now));
  }

  /**
   * Fires the extraction signal beacon (Requires all QTE security consoles overridden)
   */
  callExtraction(actor = this.player) {
    if (this.trainingSession && this.trainingSession.lesson.id !== 'rescue') return false;
    const evac = this.map.exitExtractionPoint;
    if (!this.state.running || this.state.extractionCalled || this.state.tutorial?.paused ||
        this.state.coop.hostPaused || this.state.coop.role === 'guest' || !actor || actor.downed ||
        actor.dodgeTimer > 0 || !evac || Math.hypot(actor.x - evac.x, actor.y - evac.y) >= 55) return false;

    // Check if all QTE security override consoles are solved
    const totalTerminals = this.map.terminals ? this.map.terminals.length : 3;
    const solvedCount = this.map.terminals ? this.map.terminals.filter(t => t.solved).length : totalTerminals;
    if (solvedCount < totalTerminals) {
      this.ui.showToast('撤离舱锁定中！请先激活全部终端。');
      this.ui.log('撤离系统离线：需激活全部终端才能启动撤离。');
      this.audio.playTone(140, 0.12, 0.1, 'sawtooth');
      return false;
    }

    this.state.extractionCalled = true;
    this.state.rescueRemaining = this.trainingSession ? 8 : 30;
    this.state.rescueArrived = false;
    this.state.rescuePresent = 0;
    this.state.rescueRequired = this.state.coop.running ? this._coopRosterEntries().length : 1;
    this._tutorialAction('extraction');
    this.ui.updateExtractionCalledState(this.trainingSession ? 8 : 30);

    this.audio.playTone(720, 0.18, 0.11, 'square');
    if (this.audio.playToneAfterDelay) this.audio.playToneAfterDelay(540, 180, 0.25, 0.09, 'square');

    this.activateMonster('撤离信标吸引了附近的生命体。');
    return true;
  }

  _advanceExtraction(dt) {
    if (!this.state.running || !this.state.extractionCalled || this.state.coop.role === 'guest') return false;
    this.state.rescueRemaining = Math.max(0, this.state.rescueRemaining - Math.max(0, dt));
    this.state.rescueArrived = this.state.rescueRemaining === 0;
    const evac = this.map.exitExtractionPoint;
    const entries = this.state.coop.running ? this._coopRosterEntries()
      : [{ online: true, player: this.player }];
    this.state.rescueRequired = entries.length;
    this.state.rescuePresent = evac ? entries.filter(entry => entry.online !== false &&
      Math.hypot(entry.player.x - evac.x, entry.player.y - evac.y) < 48).length : 0;
    this.ui.updateExtractionProgress?.(this.state);
    if (!this.state.rescueArrived || !evac || !entries.length ||
        this.state.rescuePresent !== entries.length || this._shouldFailMission() ||
        this.map.terminals.some(term => !term.solved)) return false;
    this._tutorialAction('returned');
    this.finish(true);
    return true;
  }

  /**
   * Forces activation of the hostile unknown entity
   */
  activateMonster(reason) {
    if (this.trainingSession) return false;
    if (!this._hasEnemyType('monster')) return false;
    let activation = false;
    for (const monster of this.nightmares || []) {
      if (monster.active) continue;
      activation = monster.activate(this.player.x, this.player.y, reason, this.audio, this.map, this.player.angle) || activation;
      if (monster.active && !this._tryWakeNightmare(monster)) monster.recoverTimer = 1;
    }
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
    if (this.trainingSession) return [];
    if (!this._hasEnemyType('hunter')) return [];
    const settings = this._getHunterSettings();
    return Array.from({ length: settings.hunters }, (_, i) => this._newHunter(i, settings.hunterMaxHp));
  }

  _newHunter(index, hp) {
    const hunter = new Hunter(index, hp, this.state.selectedDifficulty === 'easy' ? () => 1 : Math.random);
    hunter.lifeId = `${this.state.missionFxId || 'pending'}:hunter:${this.enemyLifeSequence = (this.enemyLifeSequence || 0) + 1}`;
    return hunter;
  }

  _spawnNewHunters(count) {
    if (this.trainingSession) return 0;
    if (!this._hasEnemyType('hunter')) return 0;
    const settings = this._getHunterSettings();
    const reserved = this.hunters.filter(hunter => !hunter.dead || hunter.revivePending).length;
    const spawnCount = Math.min(Math.max(0, Math.floor(count)), Math.max(0, settings.hunters - reserved));
    for (let i = 0; i < spawnCount; i++) {
      const hunter = this._newHunter(this.nextHunterSpawnIndex++, settings.hunterMaxHp);
      hunter.reset(this.map, settings.hunterMaxHp);
      const freeIndex = this.hunters.findIndex(item => item.dead && !item.revivePending);
      if (freeIndex < 0) this.hunters.push(hunter);
      else this.hunters[freeIndex] = hunter;
      this.activateHunter(hunter, '最终协议增援已抵达。');
    }
    return spawnCount;
  }

  activateHunter(hunter, reason) {
    if (this.trainingSession) return false;
    if (!this._hasEnemyType('hunter')) return false;
    const activation = hunter.activate(this.player.x, this.player.y, reason, this.audio, this.map, this.player.angle);
    if (activation) {
      this.ui.log(reason);
      this.ui.showToast('设施内出现巡逻脚步声...');
    }
  }

  _lockFinalTerminalNoise() {
    if (!this.state.finalTerminalPressure) return;
    this._coopRosterEntries().forEach(entry => { entry.player.noise = 100; });
  }

  _respawnDeadHunters(count) {
    if (this.trainingSession) return 0;
    if (!this._hasEnemyType('hunter')) return 0;
    this._syncEnemyCorpses();
    const reviveLimit = Math.max(0, Math.floor(count));
    if (reviveLimit === 0) return 0;

    const settings = this._getHunterSettings();
    const deadIndices = this.hunters
      .map((hunter, index) => ({ hunter, index }))
      .filter(({ hunter }) => hunter.dead && !hunter.revivePending)
      .map(({ index }) => index);
    const reserved = this.hunters.filter(hunter => !hunter.dead || hunter.revivePending).length;
    const toRevive = Math.min(reviveLimit, deadIndices.length, Math.max(0, settings.hunters - reserved));
    for (let i = 0; i < toRevive; i++) {
      const pick = Math.floor(Math.random() * deadIndices.length);
      const index = deadIndices.splice(pick, 1)[0];
      const previousHunter = this.hunters[index];
      const hunter = this._newHunter(previousHunter.spawnIndex, settings.hunterMaxHp);
      hunter.reset(this.map, settings.hunterMaxHp);
      this.hunters[index] = hunter;
      const spawn = hunter.getFarSpawnPoint(this.player.x, this.player.y, this.map);
      if (spawn) { hunter.x = spawn.x; hunter.y = spawn.y; }
      this.activateHunter(hunter, '设施深处传来稳定的踏步声。');
    }
    return toRevive;
  }

  _activateFinalTerminalPressure() {
    if (this.state.finalTerminalPressure || !this.map.terminals.length ||
        this.map.terminals.some(terminal => !terminal.solved)) return false;

    this.state.finalTerminalPressure = true;
    this.state.powerLossStartedAt = this.state.elapsed;
    this._lockFinalTerminalNoise();
    this.ui.updateExtractionProgress?.(this.state);

    const settings = this._getFinalTerminalSettings();
    const authoritative = this.state.coop.role !== 'guest';
    if (authoritative) this._spawnNewHunters(settings.spawnCount);
    if (authoritative) this._spawnHeavy();
    this.state.hunterSpawnTimer = settings.spawnInterval;

    this.ui.showToast(this._hasEnemyType('hunter') ? '舱室供电中断 · 撤离点已标记：噪音锁定 100 / 无限猎手增援' : '舱室供电中断 · 撤离点已标记：全员噪音锁定 100');
    this.ui.log(`警报：噪音锁定 100；本局敌人按 ${settings.spawnInterval} 秒轮次增援，Heavy 上限为 ${this._getEncounterSettings().heavyCount} 只。`);
    return true;
  }

  /**
   * Concludes the exploration run with a final report status
   */
  getPersonalRecords() {
    try { return SaveRewards.profileCounts(); }
    catch (_) { return {easy:{success:0,failure:0},medium:{success:0,failure:0},hard:{success:0,failure:0}}; }
  }

  buildSettlementSummary(success) {
    return {
      missionId: this.state.missionFxId,
      success: !!success,
      coop: !!this.state.coop.role,
      difficulty: this.state.selectedDifficulty,
      lootCount: Math.max(0, Math.floor(Number(this.state.loot) || 0)),
      lootValue: Math.max(0, Math.floor(Number(this.state.lootValue) || 0)),
      elapsedSeconds: Math.max(0, Number(this.state.elapsed) || 0),
      ammoOutcome: success
        ? '成功撤离：携带弹药全部保留。'
        : this.getAmmoLossWarning(this.state.selectedDifficulty)
    };
  }

  async _rememberRewardAccess(access) {
    try { await this.rewards.rememberAccess(access);return true; }
    catch (_) { this.ui.showToast('结算凭据无法保存，任务暂未进入；请检查浏览器存储后重新连接');return false; }
  }

  _freezeRewardRows(outcome, playerId = null) {
    if (this.trainingSession || !this.defeatLedger) return [];
    const ids = playerId ? [playerId] : [...this.defeatLedger.players.keys()];
    return ids.map(id => this.defeatLedger.freeze(id, outcome, this.state.selectedDifficulty)).filter(Boolean)
      .map(row => ({ ...row, name: this.defeatNames?.[row.playerId] || row.playerId }));
  }

  _freezeRewardRowsForDisplay() {
    return [...(this.defeatLedger?.players || new Map())].map(([id, player]) => ({
      ...(player.frozen || { playerId: id, counts: { ...player.counts }, outcome: 'active',
        baseReward: player.counts.hunter * 10 + player.counts.monster * 30 + player.counts.heavy * 100,
        difficultyMultiplier: this.state.selectedDifficulty === 'hard' ? 3 : this.state.selectedDifficulty === 'medium' ? 2 : 1,
        resultMultiplier: null, amount: null }), name: this.defeatNames?.[id] || id
    }));
  }

  _freezePlayerReward(playerId, outcome) {
    const rows = this._freezeRewardRows(outcome, playerId);
    if (rows.length && this.rewardMission) this._reportRewards(this.state.missionFxId, rows);
    return rows[0] || null;
  }

  _reportRewards(missionId, rows) {
    if (!this.rewards) return;
    this.rewards.queueReport(missionId, rows).then(() => this.rewards.flush()).then(() => {
      this.coopSession.sendEvent('reward-refresh', { missionId });
    }).catch(() => {
      this.ui.showToast('战绩尚未保存为结算回执，请保留此页面并稍后重试');
    });
  }

  _queueMissionRewards(summary) {
    if (!this.rewards || this.trainingSession) return;
    if (this.state.coop.role === 'guest') { this.rewards.flush().catch(() => {});return; }
    if (this.rewardMission?.missionId === summary.missionId) {
      this._reportRewards(summary.missionId, summary.rewards);
      return;
    }
    const own = summary.rewards.find(row => row.playerId === 'host');
    if (!own) { summary.rewardStatus = '无战绩奖励';return; }
    const receipt = { ...own, missionId: summary.missionId, id: `local:${summary.missionId}`,
      completedAt: Date.now(), expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 };
    this.rewards.queueLocalReceipt(receipt).then(() => this.rewards.flush()).catch(() => {
      this.ui.showToast('奖励待保存，正在等待浏览器存储恢复；请暂时保留此页面');
    });
  }

  _onRewardReceipt(receipt, result) {
    const state = this.trainingSession ? this.trainingSession.backup.state : this.state;
    SaveRewards.mergeForSave(state, result.data);
    if (this.trainingSession) return;
    this.updateMoneyUI();
    this.ui.updatePersonalRecords?.(this.getPersonalRecords());
    if (state.settlement?.missionId === receipt.missionId) {
      state.settlement.rewardStatus = '已到账';
      state.settlement.personalReward = receipt;
      this.ui.updateRewardSettlement?.(state.settlement);
    }
    if (result.applied && receipt.amount > 0) this.ui.showToast(`战绩奖励已到账：${receipt.amount.toLocaleString()} 信用点`);
  }

  finish(success) {
    if (this.trainingSession) { this.trainingSession.finish(success); return; }
    if (this.state.completed && !this.state.running) return;
    if (this.state.running && typeof SaveRewards !== 'undefined') SaveRewards.settleProfileMission(this.state.missionFxId,
      success ? 'success' : this.state.rewardDepartureOutcome || 'failure')
      .then(() => this.ui.updatePersonalRecords?.(this.getPersonalRecords()))
      .catch(() => this.ui.showToast('个人战绩待保存，结算回执到达后会重试'));
    this.loot?.close();
    const settlement = this.buildSettlementSummary(success);
    this.equipment?.reset();
    for (const player of this._onlineCoopPlayers()) { player.supplyUse = null; player.barrierRemoval = null; }
    settlement.rewards = this.state.coop.role === 'guest' ? this.state.authoritativeRewardRows || [] :
      this._freezeRewardRows(success ? 'success' : this.state.rewardDepartureOutcome || 'failure');
    settlement.rewardStatus = '待结算';
    const coopHostFinishing = this.state.coop.running && this.state.coop.role === 'host';
    const roster = this._coopRosterEntries();
    if (!this.state.armorySettledByHost) {
      roster.forEach(entry => this._settlePlayerAmmo(entry.player, success));
    }
    roster.forEach(entry => entry.player.setMissionAmmoRules(null));
    this.state.armorySettledByHost = false;
    this.state.armory = this.player.armory;
    if (coopHostFinishing) {
      for (const entry of roster.filter(item => !item.local)) {
        const member = this.state.coop.members.find(item => item.id === entry.id);
        if (member) member.armory = entry.player.exportArmory();
        const finishMessage = {
          success,
          missionId: this.state.missionFxId,
          resultId: `${this.state.missionFxId}:${entry.id}`,
          rewards: settlement.rewards,
          items: success ? entry.inventory : [],
          playerArmory: entry.player.exportArmory()
        };
        if (entry.online !== false) this.coopSession.sendEvent('finish', finishMessage, entry.id);
        else this.pendingCoopFinishes.set(entry.id, finishMessage);
      }
      this.coopSession.setRoomStatus('lobby');
      this.state.coop.running = false;
    }
    this.state.coop.hostPaused = false;
    this.state.coop.focusPaused = false;
    this.state.coop.menuPaused = false;
    this.ui.setCoopPaused?.(false);
    if (this.state.coop.role) {
      this.state.coop.status = success ? 'MISSION COMPLETE // 全员撤离成功' : 'MISSION FAILED // 任务中止';
    }
    this.state.running = false; 
    this.state.pauseMenuOpen = false;
    this.state.abandonPending = false;
    if (this._abandonTimer) clearTimeout(this._abandonTimer);
    this._abandonTimer = null;
    this.ui.setPauseMenuVisible?.(false);
    if (this.ui.abandonConfirmDialog?.open) this.ui.abandonConfirmDialog.close();
    if (this.ui.settingsModal?.open) this.ui.settingsModal.close();
    this.state.tutorial = null;
    this.state.completed = true; 
    this.state.fireHeld = false;
    this.state.keys = {};
    this.state.inventoryOpen = false;
    this.state.inventoryClosing = false;
    this.state.fullMapOpen = false;
    this.state.fullMapClosing = false;
    if (this._inventoryCloseTimer) clearTimeout(this._inventoryCloseTimer);
    this._inventoryCloseTimer = null;
    const inventoryOverlay = document.getElementById('inventoryOverlay');
    if (inventoryOverlay) {
      inventoryOverlay.style.display = 'none';
      inventoryOverlay.classList.remove('is-open', 'is-closing');
    }
    document.body.classList.remove("in-dive");
    this.handleResize();
    
    this.state.extracted = success;
    this.state.missionHunterSettings = null;
    this.state.missionFinalTerminalSettings = null;
    this.state.hunterSettings = this._buildDifficultySettings(this.state.selectedDifficulty);
    const selectedProfile = this.state.difficultyProfiles?.[this.state.selectedDifficulty] ||
      this._sanitizeDifficultyProfiles()[this.state.selectedDifficulty];
    this.state.finalTerminalSettings = this._finalTerminalSettings(selectedProfile);
    this.state.activeQte = null;
    this.ui.hideTutorial();
    this.ui.hideQTE();
    if (this.ui.setFullMapVisible) this.ui.setFullMapVisible(false);
    this.state.bulletTraces.length = 0;
    this.state.impactParticles.length = 0;
    this.state.muzzleFlashTimer = 0;
    this.state.muzzleFlashes.length = 0;
    for (const monster of this.nightmares || []) { monster.active = false; monster.alerted = false; }
    for (const heavy of this.heavies || []) Object.assign(heavy, { active: false, dead: false, corpseTime: 0 });
    this._clearEnemyEffects();
    this.state.flashbangs = [];
    this.state.flashBursts = [];
    this.hunters.forEach(hunter => {
      Object.assign(hunter, {
        active: false,
        dead: false,
        deathFade: 0,
        corpseTime: 0,
        revivePending: false,
        reviveTimer: 0,
        waypoints: []
      });
    });
    this.remotePlayers?.clear?.();
    this.remoteQtes?.clear?.();
    this._syncLegacyRemoteAliases();
    if (this.audio.stopMissionAudio) this.audio.stopMissionAudio();

    this.state.remoteInventory = [];
    if (!success) this.state.inventory = [];
    this._bindBackpackInventories();
    this.updateStorageUI();
    this._save();
    this._rollNextMenuMaps();
    this._refreshFlashbangStock();

    this.state.settlement = settlement;
    this._queueMissionRewards(settlement);
    this.ui.updateFinishState(success, settlement);
    this.ui.updateTerminalsStatus(this.map.terminals, true);
    this.updateDifficultyUI();
    this.updateHunterSettingsUI();
    this.updateLoadoutUI();
    this.updateCoopUI();
    this.updateTutorialAvailability();
    window.switchTab?.('briefing');
    
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
    this.ui.update(compositeState, this.player, this.nightmares);
  }

  _settlePlayerAmmo(player, success) {
    if (!player || success) return;
    const lossFraction = this.state.selectedDifficulty === 'hard' ? 1 : this.state.selectedDifficulty === 'medium' ? 0.5 : 0;
    if (!lossFraction) return;
    const equipped = new Set([player.armory.loadout.primary, player.armory.loadout.sidearm].filter(Boolean));
    equipped.forEach(weaponId => {
      const stock = player.armory.weaponAmmo[weaponId];
      const total = stock.magazine + stock.reserve;
      const lost = this.state.selectedDifficulty === 'hard' ? total : Math.floor(total * lossFraction);
      const remaining = total - lost;
      stock.magazine = Math.min(stock.magazine, remaining);
      stock.reserve = remaining - stock.magazine;
    });
  }

  _applyDamage(player, healthLoss, oxygenLoss = 0, stunDuration = 0) {
    if (!player || player.invulnerable) return { blocked: true };
    const now = this.state.elapsed || 0;
    const shield = player.armory?.equippedPassive === 'shield' && player.armory.ownedPassives?.shield;
    if (shield && !player.downed && (healthLoss > 0 || oxygenLoss > 0) && now >= (player.shieldReadyAt || 0)) {
      player.shieldUntil = now + 3;
      player.shieldReadyAt = now + 50;
    }
    const shielded = shield && (player.shieldUntil || 0) > now;
    if (!shielded) {
      player.health = Math.max(0, player.health - healthLoss);
      player.oxygen = Math.max(0, player.oxygen - oxygenLoss);
    }
    if (stunDuration > 0) player.stunned = Math.max(player.stunned, stunDuration);
    return { blocked: false, shielded: !!shielded };
  }

  /**
   * Performs an interact trace near the explorer
   */
  interact(actor = this.player) {
    if (actor === this.player && this.state.equipmentSyncing) return;
    if (!this.state.running || this.state.tutorial?.paused || this.state.coop.hostPaused ||
        (actor === this.player && (this.state.fullMapOpen || this.state.fullMapClosing || this.state.inventoryOpen || this.state.inventoryClosing)) || actor.dodgeTimer > 0) return;
    const remoteEntry = this._remoteEntryForActor(actor);
    if ((actor === this.player && this.state.activeQte) || remoteEntry?.qte) return;
    if (actor.stunned > 0 || actor.flashStunTimer > 0 || actor.downed) {
      this.ui.showToast('身体麻痹硬直中，无法交互！');
      return;
    }
    if (this.equipment?.beginRemoval(actor)) return;
    if (this.state.coop.running) {
      const downedMate = this._coopRosterEntries()
        .filter(entry => entry.player !== actor && entry.online !== false && entry.player.downed)
        .map(entry => ({ ...entry, distance: Math.hypot(entry.player.x - actor.x, entry.player.y - actor.y) }))
        .filter(entry => entry.distance < 48)
        .sort((a, b) => a.distance - b.distance)[0];
      if (downedMate) {
        this._beginCoopRevive(actor, downedMate);
        return;
      }
    }

    const nearbyScrap = this.map.scrap.some(item => !item.found && Math.hypot(item.x - actor.x, item.y - actor.y) < 30);
    const nearbyBox = this.loot?.nearest(actor);
    if (nearbyBox) {
      if (actor === this.player) this.loot.open(nearbyBox);
      else this.coopSession.sendEvent('loot-opened', { missionId: this.state.missionFxId, containerId: nearbyBox.id }, remoteEntry.id);
      return;
    }
    if (nearbyScrap) {
      this.collect(actor);
      return;
    }

    const evac = this.map.exitExtractionPoint;
    const atEvac = evac && Math.hypot(evac.x - actor.x, evac.y - actor.y) < 55;
    const terminalsReady = !!this.map.terminals?.length && this.map.terminals.every(term => term.solved);
    if (atEvac && terminalsReady) {
      if (!this.state.extractionCalled) this.callExtraction(actor);
      else this.ui.showToast(this.state.rescueArrived ? '救援已抵达，等待全员进入撤离范围' : '救援正在赶来');
      return;
    }

    // Check doors with interaction radius from door center
    const door = this.map.doors.find(item => {
      const centerX = item.x + item.w / 2;
      const centerY = item.y + item.h / 2;
      return Math.hypot(centerX - actor.x, centerY - actor.y) < 58;
    });

    if (door) {
      const wasTargetOpen = door.targetOpen ?? door.open;
      if (wasTargetOpen) {
        const players = this.state.coop.running ? this._onlineCoopPlayers() : [this.player];
        if (!players.includes(actor)) players.push(actor);
        const clearancePlan = this.map.planDoorwayClearance(door, players);
        if (clearancePlan === null) {
          this.ui.showToast('门口受阻，无法安全关闭');
          this.audio.playTone(110, 0.08, 0.06, 'sine');
          return;
        }
        clearancePlan.forEach(move => {
          move.player.x = move.x;
          move.player.y = move.y;
        });
      }

      const res = this.map.toggleDoor(door, actor.x, actor.y);
      if (actor === this.player && !wasTargetOpen && res.open) this._tutorialAction('door', { id: door.id });
      actor.noise = Math.min(100, actor.noise + 8);
      this.audio.playTone(res.open ? 160 : 110, 0.08, 0.06, 'sine');
      
      const dirText = door.axis === 'v' 
        ? (res.dir === 1 ? '向右推开' : '向左推开') 
        : (res.dir === 1 ? '向下推开' : '向上推开');
      
      this.ui.log(res.open ? `防爆门正在${dirText}。` : '防爆门正在关闭。');
      this.ui.showToast(res.open ? `正在开门 (${dirText})` : '正在关门');
      return;
    }

    // Check QTE security override consoles
    if (this.map.terminals) {
      const term = this.map.terminals.find(t => Math.hypot(t.x - actor.x, t.y - actor.y) < 55);
      if (term) {
        if (term.solved) {
        this.ui.showToast('该终端已激活 (OVERRIDDEN)');
          return;
        }
        const busy = this.state.activeQte?.terminal === term ||
          [...this.remotePlayers.values()].some(entry => entry.qte?.terminal === term);
        if (busy) {
          this.ui.showToast('该终端正在由队友操作');
          return;
        }
        if (this.trainingSession && !this.trainingSession.canUseTerminal(term)) {
          this.ui.showToast('请先完成当前课程；终端练习稍后开放。');
          return;
        }
        if (actor === this.player) this.startQTE(term);
        else this._startRemoteQte(term, remoteEntry?.id);
        return;
      }
    }

    if (atEvac && !terminalsReady) {
      this.ui.showToast('撤离舱锁定中！请先激活全部终端。');
      this.audio.playTone(140, 0.12, 0.1, 'sawtooth');
      return;
    }

    // Check observation windows
    const windowNear = this.map.windows.some(item => Math.hypot(item.x - actor.x, item.y - actor.y) < 42);
    if (windowNear) {
      this.ui.log('窗外只有风与黑暗。');
      this.ui.showToast('观察窗');
      return;
    }

    // Attempt collection
    this.collect(actor);
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
    this.ui.showToast('接入终端 // 10秒内完成WASD输入 (错3次将遭高压电击)');
  }

  /**
   * Processes player WASD/ESC input during an active QTE sequence
   */
  handleQTEInput(key, event) {
    if (this.player.flashStunTimer > 0) return;
    if (!this.state.activeQte) return;
    if (this.state.coop.running && this.state.coop.role === 'guest' && this.state.activeQte.remoteOwned) {
      if (event) event.preventDefault();
      this.coopSession.sendEvent('action', { action: key === 'escape' ? 'qte-cancel' : 'qte-key', key });
      if (key === 'escape') {
        this.state.activeQte = null;
        this.ui.hideQTE();
      }
      return;
    }
    const qte = this.state.activeQte;

    if (key === 'escape') {
      this.state.activeQte = null;
      this.ui.hideQTE();
      this.ui.showToast('已退出终端');
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
          this._tutorialAction('terminal', { id: qte.terminal.id });
          this.audio.playQTESuccess();
          const totalCount = this.map.terminals.length;
          const solvedCount = this.map.terminals.filter(t => t.solved).length;
          this.ui.updateTerminalsStatus(this.map.terminals);
          this.ui.showToast('终端已激活。');
          this.ui.log(`终端 #${qte.terminal.id} 已激活。`);

          if (solvedCount >= totalCount) {
            this._activateFinalTerminalPressure();
            this._tutorialAction('terminals');
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
          if (this.state.activeQte === qte && !qte.failed) {
            this.ui.showQTE(qte.terminal, 0, false, qte.failCount, qte.maxFails);
          }
        }, 600);
      }
    }
  }

  /**
   * Triggers terminal high-voltage shock penalty (-10 HP, 2.5s stun, loud alarm, monster teleport with 15s cd)
   */
  triggerQTEShockFail(reason = '终端过载高压电击') {
    if (!this.state.activeQte) return;

    // 1. Inflict -10 HP damage and 2.5s stun
    const damage = this._applyDamage(this.player, 10, 0, 2.5);
    this.player.noise = 100;

    // 2. Play high-voltage shock sound & loud alarm
    if (this.audio.playElectricShock) {
      this.audio.playElectricShock();
    }
    this.audio.playLoudAlarmSound();
    if (!damage.blocked) this.ui.triggerDamageFlash(0.85, 220);

    // 3. Status notification and log
    this.ui.showToast(damage.blocked
      ? `翻滚抵消了 ${reason} 的伤害与硬直`
      : `【高压电击】${reason}！受到 10 点电流伤害，身体麻痹 2.5 秒！`);
    this.ui.log(damage.blocked
      ? `电击警报：${reason}触发，但翻滚抵消了伤害与硬直。`
      : `电击警报：${reason}！生命值 -10，休克硬直 2.5s！`);

    // 4. Attempt monster teleport to nearby room (respects 15s cooldown)
    this.teleportMonsterToNearbyRoom(true);

    // 5. Exit / close QTE interface
    this.state.activeQte = null;
    this.ui.hideQTE();

    // 6. Death check
    if (this.player.health <= 0 && !this.state.coop.running) {
      this.finish(false);
    }
  }

  /**
   * Handles 10-second QTE timeout expiration
   */
  handleQTETimeout() {
    if (!this.state.activeQte) return;
    this.triggerQTEShockFail('终端激活超时 (10s)');
  }

  /**
   * Teleports the hostile entity to an adjacent/nearby room to approach the operator
   * Respects a 15-second cooldown when triggered by QTE failure
   */
  teleportMonsterToNearbyRoom(isQteFail = true) {
    if (this.trainingSession) return false;
    if (!this._hasEnemyType('monster')) return false;
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
      // Room portals include permanently open corridor junctions as well as doors.
      const connectedRooms = [];
      (playerRoom.doors || this.map.doors).forEach(d => {
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
   * Scavenges nearby valid waste scrap
   */
  collect(actor = this.player) {
    if (!this.state.running || this.state.tutorial?.paused) return false;

    const item = this.map.scrap
      .filter(scrap => !scrap.found && Math.hypot(scrap.x - actor.x, scrap.y - actor.y) < 30)
      .sort((a, b) => Math.hypot(a.x - actor.x, a.y - actor.y) - Math.hypot(b.x - actor.x, b.y - actor.y))[0];
    if (!item) {
      this.ui.showToast('附近没有可回收物');
      return false;
    }

    const backpack = this._backpackFor(actor);
    if (!backpack.place(item)) {
      this.ui.showToast('背包空间不足！物资仍留在地面');
      return false;
    }

    item.found = true;
    item.foundThisRun = true;
    this.state.loot += 1;
    this.state.lootValue += Number(item.value) || 0;
    actor.noise = Math.min(100, actor.noise + 5);

    const size = backpack.sizeFor(item);
    this.ui.log(`拾取：${item.name || '废料'} (占地 ${size.w}×${size.h} 格)。`);
    this.ui.showToast(`拾取 ${item.name || '物品'} [${size.w}×${size.h}]`);
    if (actor === this.player) this._tutorialAction('pickup', { id: item.id });
    if (actor === this.player) this.updateInventoryUI();
    return true;
  }

  _applyGuestInventoryLayout(layout, memberId = null) {
    const entry = this.remotePlayers?.get(memberId) || [...(this.remotePlayers?.values?.() || [])][0];
    const backpack = entry?.backpack || this.remoteBackpack;
    if (!Array.isArray(layout) || layout.length !== backpack.items.length) return false;
    const existing = new Map(backpack.items.map(item => [String(item.id), item]));
    const candidate = BackpackManager.fromType(Config.activeBackpack);
    const placedIds = new Set();
    for (const position of layout) {
      if (!position || !Number.isInteger(position.gx) || !Number.isInteger(position.gy) ||
          !Number.isInteger(position.rot) || !existing.has(String(position.id)) || placedIds.has(String(position.id))) return false;
      placedIds.add(String(position.id));
      const item = { ...existing.get(String(position.id)) };
      if (!candidate.place(item, position) || item.gx !== position.gx || item.gy !== position.gy || item.rot !== BackpackManager.normalizeRotation(position.rot)) return false;
    }
    if (candidate.items.length !== existing.size) return false;
    backpack.items = candidate.items;
    backpack.nextId = candidate.nextId;
    if (entry) entry.inventory = candidate.items;
    else this.state.remoteInventory = candidate.items;
    if (entry) this._syncLegacyRemoteAliases();
    return true;
  }

  _discardGuestInventoryItem(message, memberId = null) {
    if (!Number.isSafeInteger(message.requestId)) return false;
    return this.loot.handleRequest({ ...message, itemId: message.id, action: 'drop', missionId: this.state.missionFxId }, memberId).accepted;
  }


  sellStorage() {
    const items = [...this.state.storageItems, ...this.state.storageOverflowItems];
    if (items.length === 0) {
      this._notifyTransaction('仓库空空如也，没有可出售的物资！', 'error');
      return;
    }
    const totalValue = items.reduce((total, item) => total + (Number(item.value) || 50), 0);
    this.storageBackpack.clear();
    this.state.storageItems = this.storageBackpack.items;
    this.state.storageOverflowItems = [];
    this.selectedStorageIds.clear();
    this.state.money += totalValue;
    this._notifyTransaction(`成功出售仓库所有物资，获得 ${this.ui.formatCreditText(totalValue)}`);
    this.updateStorageUI();
    this.updateMoneyUI();
    this._save();
    return totalValue;
  }

  packStorage() {
    const result = this.storageBackpack.autoPack('insert');
    this._fillStorageOverflow();
    this.updateStorageUI();
    this._save();
    return result;
  }

  updateMoneyUI() {
    this.ui.setCurrencyValue(document.getElementById('moneyDisplay'), this.state.money);
    this.menu?.queueRefresh();
  }

  updateInventoryUI() {
    this._refreshFlashbangStock();
    this.ui.updateOxygenStock?.(this.carriedOxygenCount(), this.carriedMedkitCount());
    this._inventoryUiDirty = true;
    if (!this.state.inventoryOpen || this._itemDrag) return;
    const grid = document.getElementById('inventoryGrid');
    if (!grid) return;
    this._inventoryUiDirty = false;
    const backpack = this._backpackFor(this.player);
    const size = backpack.cellSize;
    const gap = backpack.gap;
    grid.style.setProperty('--bp-cell', `${size}px`);
    grid.style.setProperty('--bp-gap', `${gap}px`);
    grid.style.gap = `${gap}px`;
    grid.style.padding = `${gap}px`;
    grid.style.gridTemplateColumns = `repeat(${backpack.cols}, ${size}px)`;
    grid.style.gridTemplateRows = `repeat(${backpack.rows}, ${size}px)`;
    grid.innerHTML = '';
    for (const [axisId, total] of [['inventoryXAxis', backpack.cols], ['inventoryYAxis', backpack.rows]]) {
      const axis = document.getElementById(axisId);
      if (axis) {
        axis.style[axisId === 'inventoryXAxis' ? 'gridTemplateColumns' : 'gridTemplateRows'] =
          `repeat(${total}, ${backpack.pitch}px)`;
        axis.replaceChildren(...Array.from({ length: total }, (_, index) => {
          const mark = document.createElement('span');
          mark.textContent = index + 1;
          return mark;
        }));
      }
    }

    const title = document.getElementById('inventoryTitle');
    const count = document.getElementById('inventoryCount');
    const capacity = document.getElementById('inventoryCapacity');
    if (title) title.textContent = backpack.label;
    if (count) count.textContent = `${backpack.items.length} 件物资`;
    if (capacity) {
      const used = backpack.usedCells();
      capacity.textContent = `${used} / ${backpack.capacity} 格`;
      capacity.className = used >= backpack.capacity ? 'warning' : '';
    }

    for (let gy = 0; gy < backpack.rows; gy++) {
      for (let gx = 0; gx < backpack.cols; gx++) {
        const cell = document.createElement('div');
        cell.className = 'bp-cell';
        cell.style.gridColumn = `${gx + 1}`;
        cell.style.gridRow = `${gy + 1}`;
        cell.style.width = `${size}px`;
        cell.style.height = `${size}px`;
        grid.appendChild(cell);
      }
    }

    backpack.items.forEach(item => {
      const matrix = backpack.matrixFor(item);
      const tile = document.createElement('div');
      tile.className = `bp-item rarity-${item.rarity || 'common'}${item.id === this.selectedItemId ? ' selected' : ''}`;
      tile.dataset.itemId = item.id;
      tile.title = `${item.name || '物资'} · ${this.ui.formatCreditText(item.value || 0)} · 占地 ${matrix[0].length}×${matrix.length} 格`;
      this._placeItemElement(tile, item.gx, item.gy, matrix);
      this._renderTileBlocks(tile, item, matrix);
      grid.appendChild(tile);
    });
    this._updateInventoryUseButton();
    this._updateBackpackReadout();
    this.updateEquipmentUI();
    this.loot?.render();
  }

  _updateInventoryUseButton() {
    this.loot?.refreshReachability();
    this.ui.updateOxygenStock?.(this.carriedOxygenCount(), this.carriedMedkitCount());
    if (!this.state.inventoryOpen && !this.state.inventoryClosing) return;
    const button = document.getElementById('useItemBtn');
    if (!button) return;
    const selected = this.backpack.getItem(this.selectedItemId);
    button.disabled = !this._canUseSupply(this.player, selected);
  }

  _spanPx(count, manager = this.backpack) {
    return `${count * manager.cellSize + Math.max(0, count - 1) * manager.gap}px`;
  }

  _placeItemElement(tile, gx, gy, matrix, manager = this.backpack) {
    const width = Math.min(matrix[0].length, manager.cols);
    const height = Math.min(matrix.length, manager.rows);
    const x = Math.max(0, Math.min(manager.cols - width, Math.trunc(Number(gx) || 0)));
    const y = Math.max(0, Math.min(manager.rows - height, Math.trunc(Number(gy) || 0)));
    tile.style.position = 'relative';
    tile.style.display = 'block';
    tile.style.gridColumn = `${x + 1} / span ${width}`;
    tile.style.gridRow = `${y + 1} / span ${height}`;
    tile.style.width = this._spanPx(width, manager);
    tile.style.height = this._spanPx(height, manager);
    tile.style.minWidth = '0';
    tile.style.minHeight = '0';
    tile.style.margin = '0';
    tile.style.padding = '0';
    tile.style.border = '0';
    tile.style.background = 'transparent';
    tile.style.pointerEvents = 'none';
  }

  _renderTileBlocks(tile, item, matrix, manager = this.backpack, gridId = 'inventoryGrid') {
    tile.innerHTML = '';
    const menuArt = true;
    const imagePath = BackpackManager.imageFor(item);
    if (imagePath) {
      const art = document.createElement('img');
      art.className = 'bp-item-art';
      art.src = imagePath;
      art.alt = '';
      art.draggable = false;
      if (menuArt) {
        const frame = document.createElement('div');
        frame.className = 'bp-art-mask';
        const width = matrix[0].length * manager.pitch - manager.gap;
        const height = matrix.length * manager.pitch - manager.gap;
        const rects = matrix.flatMap((row, y) => row.map((occupied, x) => occupied
          ? `<rect x="${x * manager.pitch}" y="${y * manager.pitch}" width="${manager.pitch}" height="${manager.pitch}" fill="white"/>` : '')).join('');
        frame.style.maskImage = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${rects}</svg>`)}")`;
        const turns = this._itemDrag?.item === item ? this._itemDrag.rot : manager.rotationFor(item);
        art.style.width = `${turns % 2 ? height : width}px`;
        art.style.height = `${turns % 2 ? width : height}px`;
        art.style.transform = `translate(-50%, -50%) rotate(${turns * 90}deg)`;
        frame.appendChild(art);
        tile.appendChild(frame);
      } else tile.appendChild(art);
    }
    const { cellSize, pitch } = manager;
    let labelled = false;
    matrix.forEach((row, gy) => row.forEach((occupied, gx) => {
      if (!occupied) return;
      const block = document.createElement('div');
      block.className = 'bp-block';
      block.style.position = 'absolute';
      block.style.left = `${gx * pitch}px`;
      block.style.top = `${gy * pitch}px`;
      block.style.width = `${cellSize}px`;
      block.style.height = `${cellSize}px`;
      block.style.pointerEvents = 'auto';
      if (menuArt) {
        if (matrix[gy - 1]?.[gx]) block.style.borderTopWidth = '0';
        if (matrix[gy + 1]?.[gx]) block.style.borderBottomWidth = '0';
        if (matrix[gy][gx - 1]) block.style.borderLeftWidth = '0';
        if (matrix[gy][gx + 1]) block.style.borderRightWidth = '0';
      }
      block.addEventListener('pointerdown', event => gridId === 'storageGrid'
        ? this._beginStorageItemDrag(event, item, tile)
        : gridId === 'prepBackpackGrid'
          ? this._beginPreparedPackItemDrag(event, item, tile)
          : this._beginItemDrag(event, item));
      block.addEventListener('contextmenu', event => {
        event.preventDefault();
        if (gridId === 'storageGrid') this.rotateStorageItem(item.id);
        else if (gridId === 'prepBackpackGrid') this.rotatePreparedPackItem(item.id);
        else this.rotateItem(item.id);
      });
      if (!labelled) {
        labelled = true;
        const name = document.createElement('span');
        name.className = 'bp-item-name';
        name.textContent = item.name || '物资';
        const value = document.createElement('span');
        value.className = 'bp-item-value';
        this.ui.setCurrencyValue(value, item.value || 0);
        if (menuArt) {
          value.className = 'menu-item-price';
          tile.appendChild(value);
        } else block.append(name, value);
      }
      tile.appendChild(block);
    }));
  }

  _updateBackpackReadout() {
    const selected = this.backpack.getItem(this.selectedItemId);
    const description = document.getElementById('itemDesc');
    const rotate = document.getElementById('rotateItemBtn');
    const discard = document.getElementById('discardItemBtn');
    const use = document.getElementById('useItemBtn');
    if (rotate) rotate.disabled = !selected;
    if (discard) discard.disabled = !selected;
    if (use) use.disabled = !this._canUseSupply(this.player, selected);
    if (!description) return;
    if (!selected) {
      description.textContent = '点击物资查看详情 · 拖拽自由摆放 · 右键或 [R] 旋转 · 深色格为空格';
      return;
    }
    const footprint = this.backpack.sizeFor(selected);
    const rarity = { common: '常见', uncommon: '稀有', rare: '珍贵', legendary: '传说' }[selected.rarity] || '常见';
    description.textContent = `${selected.name || '物资'} [${rarity}] · 占地 ${footprint.w}×${footprint.h} 格 · 回收价 ${this.ui.formatCreditText(selected.value || 0)} · 朝向 ${this.backpack.rotationFor(selected) * 90}°`;
  }

  toggleInventory(force = null) {
    const overlay = document.getElementById('inventoryOverlay');
    if (!overlay) return;
    const open = typeof force === 'boolean' ? force : !this.state.inventoryOpen;
    if (!open) this.loot?.close();
    if (open && (this.state.fullMapOpen || this.state.fullMapClosing)) return;
    if (open) {
      if (this._inventoryCloseTimer) clearTimeout(this._inventoryCloseTimer);
      this._inventoryCloseTimer = null;
      this.state.inventoryClosing = false;
      this.state.inventoryOpen = true;
      this._tutorialAction('bag-open');
      overlay.style.display = 'block';
      overlay.classList.remove('is-closing');
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => overlay.classList.add('is-open'));
      else overlay.classList.add('is-open');
      this.state.fireHeld = false;
      this.state.keys = {};
      this._sendGuestInput(true);
      this.updateInventoryUI();
      this.ui.log('打开背包网格 [拖拽摆放 / 右键或 R 旋转 / B 关闭]');
    } else {
      if (!this.state.inventoryOpen && !this.state.inventoryClosing) return;
      this._cancelItemDrag();
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
      const close = () => {
        overlay.style.display = 'none';
        overlay.classList.remove('is-open', 'is-closing');
        this.state.inventoryClosing = false;
        this.state.inventoryOpen = false;
        this._tutorialAction('bag-close');
        this.state.keys = {};
        this.selectedItemId = null;
        this._inventoryCloseTimer = null;
      };
      if (reducedMotion) {
        close();
      } else {
        this.state.inventoryClosing = true;
        overlay.classList.remove('is-open');
        overlay.classList.add('is-closing');
        this._inventoryCloseTimer = setTimeout(close, 180);
      }
    }
  }

  selectInventoryItem(itemId) {
    this.selectedItemId = itemId;
    document.querySelectorAll('#inventoryGrid .bp-item').forEach(tile => {
      tile.classList.toggle('selected', String(tile.dataset.itemId) === String(itemId));
    });
    this._updateBackpackReadout();
  }

  rotateItem(itemId = null) {
    const item = this.backpack.getItem(itemId == null ? this.selectedItemId : itemId);
    if (!item) return false;
    if (this.backpack.isRotationInvariant(item) || !this.backpack.rotateItem(item)) {
      this.ui.showToast('物资无法旋转：外形对称或周围空间不足');
      return false;
    }
    this._tutorialAction('rearrange', { changed: true });
    this.updateInventoryUI();
    this._syncGuestInventoryLayout();
    return true;
  }

  discardItem(itemId = null) {
    const item = this.backpack.getItem(itemId == null ? this.selectedItemId : itemId);
    if (!item || !this.state.running) return false;
    const accepted = this.loot.request('drop', item.id);
    if (accepted) {
      this.selectedItemId = null;
      this.ui.showToast(this.state.coop.running && this.state.coop.role === 'guest'
        ? '已请求放下物资，等待房主确认' : '物资已放入可搜刮的物资包');
      this.updateInventoryUI();
    }
    return accepted;
  }

  packInventory() {
    if (!this.backpack.items.length) return;
    const result = this.backpack.autoPack('insert');
    this.updateInventoryUI();
    this._syncGuestInventoryLayout();
    this.ui.showToast(`背包已整理：${result.packed} 件物资重新排布`);
  }

  sortInventory() {
    if (!this.backpack.items.length) return;
    const result = this.backpack.autoPack('value');
    this.updateInventoryUI();
    this._syncGuestInventoryLayout();
    if (result.failed.length) {
      this.ui.showToast('空间不足，无法按价值重排');
      return;
    }
    this.ui.showToast('背包物资已按回收价值降序重排');
  }

  _gridMetrics(grid, manager = this.backpack) {
    const cells = grid.querySelectorAll('.bp-cell');
    if (!cells.length) return null;
    const first = cells[0].getBoundingClientRect();
    const nextX = cells[1] && cells[1].getBoundingClientRect();
    const nextY = cells[manager.cols] && cells[manager.cols].getBoundingClientRect();
    return {
      left: first.left,
      top: first.top,
      stepX: Math.max(1, nextX ? nextX.left - first.left : first.width),
      stepY: Math.max(1, nextY ? nextY.top - first.top : first.height)
    };
  }

  _itemTileFor(itemId, gridId = 'inventoryGrid') {
    return document.querySelector(`#${gridId} .bp-item[data-item-id="${itemId}"]`);
  }

  _beginItemDrag(event, item) {
    if (event.button !== 0) return;
    event.preventDefault();
    const grid = document.getElementById('inventoryGrid');
    const metrics = grid && this._gridMetrics(grid);
    if (!metrics) return;
    const stepX = metrics.stepX || this.backpack.pitch;
    const stepY = metrics.stepY || this.backpack.pitch;
    const tile = this._itemTileFor(item.id);
    const rect = tile.getBoundingClientRect();
    this._itemDrag = {
      item, tile, metrics, manager: this.backpack, gridId: 'inventoryGrid', kind: 'inventory', rot: this.backpack.rotationFor(item),
      grabX: Math.max(0, Math.floor((event.clientX - rect.left) / stepX)),
      grabY: Math.max(0, Math.floor((event.clientY - rect.top) / stepY)),
      gx: item.gx, gy: item.gy, pointerX: event.clientX, pointerY: event.clientY,
      startX: event.clientX, startY: event.clientY, moved: false, valid: true
    };
    this.selectInventoryItem(item.id);
    window.addEventListener('pointermove', this._boundItemDragMove);
    window.addEventListener('pointerup', this._boundItemDragEnd);
    window.addEventListener('pointercancel', this._boundItemDragEnd);
  }

  _beginStorageItemDrag(event, item, tile) {
    if (event.button !== 0) return;
    if (this.menu) this.menu.lastSelectedItem = { source: 'storage', id: item.id };
    event.preventDefault();
    const grid = document.getElementById('storageGrid');
    const manager = this.storageBackpack;
    const metrics = grid && this._gridMetrics(grid, manager);
    if (!metrics) return;
    const stepX = metrics.stepX || manager.pitch;
    const stepY = metrics.stepY || manager.pitch;
    const rect = tile.getBoundingClientRect();
    this._itemDrag = {
      item, tile, metrics, manager, gridId: 'storageGrid', kind: 'storage', rot: manager.rotationFor(item),
      grabX: Math.max(0, Math.floor((event.clientX - rect.left) / stepX)),
      grabY: Math.max(0, Math.floor((event.clientY - rect.top) / stepY)),
      gx: item.gx, gy: item.gy, pointerX: event.clientX, pointerY: event.clientY,
      startX: event.clientX, startY: event.clientY, moved: false, valid: true
    };
    window.addEventListener('pointermove', this._boundItemDragMove);
    window.addEventListener('pointerup', this._boundItemDragEnd);
    window.addEventListener('pointercancel', this._boundItemDragEnd);
  }

  _beginPreparedPackItemDrag(event, item, tile) {
    if (event.button !== 0) return;
    if (this.menu) this.menu.lastSelectedItem = { source: 'backpack', id: item.id };
    event.preventDefault();
    const grid = document.getElementById('prepBackpackGrid');
    const manager = this.backpack;
    const metrics = grid && this._gridMetrics(grid, manager);
    if (!metrics) return;
    const stepX = metrics.stepX || manager.pitch;
    const stepY = metrics.stepY || manager.pitch;
    const rect = tile.getBoundingClientRect();
    this._itemDrag = {
      item, tile, metrics, manager, gridId: 'prepBackpackGrid', kind: 'prepared', rot: manager.rotationFor(item),
      grabX: Math.max(0, Math.floor((event.clientX - rect.left) / stepX)),
      grabY: Math.max(0, Math.floor((event.clientY - rect.top) / stepY)),
      gx: item.gx, gy: item.gy, pointerX: event.clientX, pointerY: event.clientY,
      startX: event.clientX, startY: event.clientY, moved: false, valid: true
    };
    window.addEventListener('pointermove', this._boundItemDragMove);
    window.addEventListener('pointerup', this._boundItemDragEnd);
    window.addEventListener('pointercancel', this._boundItemDragEnd);
  }

  _preparedDropTarget(drag, x, y) {
    const quick = document.getElementById('quickUseSlot');
    const quickBounds = quick?.dataset?.autoSupply === 'true' ? null : quick?.getBoundingClientRect();
    if (quickBounds && x >= quickBounds.left && x < quickBounds.right && y >= quickBounds.top && y < quickBounds.bottom) {
      return { kind: 'quick', element: quick };
    }
    for (const [id, manager] of [['storageGrid', this.storageBackpack], ['prepBackpackGrid', this.backpack]]) {
      const grid = document.getElementById(id);
      const metrics = grid && this._gridMetrics(grid, manager);
      if (!metrics || x < metrics.left || y < metrics.top ||
          x >= metrics.left + manager.cols * metrics.stepX || y >= metrics.top + manager.rows * metrics.stepY) continue;
      return {
        kind: 'grid', id, grid, manager, metrics,
        gx: Math.floor((x - metrics.left) / metrics.stepX) - drag.grabX,
        gy: Math.floor((y - metrics.top) / metrics.stepY) - drag.grabY
      };
    }
    return null;
  }

  _handleItemDragMove(event) {
    const drag = this._itemDrag;
    if (!drag) return;
    drag.pointerX = event.clientX;
    drag.pointerY = event.clientY;
    drag.moved ||= Math.abs(event.clientX - drag.startX) > 3 || Math.abs(event.clientY - drag.startY) > 3;
    if (drag.framePending) return;
    drag.framePending = true;
    const update = () => {
      drag.framePending = false;
      if (this._itemDrag !== drag) return;
      if (drag.kind !== 'inventory') {
        const destination = this._preparedDropTarget(drag, drag.pointerX, drag.pointerY);
        const quick = document.getElementById('quickUseSlot');
        const quickValid = destination?.kind === 'quick' && drag.item.effect === 'oxygen-50' &&
          (drag.manager === this.backpack || !!this.backpack.findSpot(this.backpack.shapeFor(drag.item), drag.rot));
        quick?.classList?.toggle('drop-valid', !!quickValid);
        quick?.classList?.toggle('drop-invalid', destination?.kind === 'quick' && !quickValid);
        if (destination?.kind === 'grid') {
          drag.gx = destination.gx;
          drag.gy = destination.gy;
          drag.valid = destination.manager.canPlace(destination.manager.matrixFor(drag.item, drag.rot),
            drag.gx, drag.gy, destination.manager === drag.manager ? drag.item.id : null);
          if (drag.tile.parentElement !== destination.grid) destination.grid.appendChild(drag.tile);
          if (drag.previewGridId !== destination.id || drag.previewRot !== drag.rot) {
            this._renderTileBlocks(drag.tile, drag.item, destination.manager.matrixFor(drag.item, drag.rot), destination.manager, destination.id);
            drag.previewGridId = destination.id;
            drag.previewRot = drag.rot;
          }
          this._placeItemElement(drag.tile, drag.gx, drag.gy, destination.manager.matrixFor(drag.item, drag.rot), destination.manager);
        } else drag.valid = !!quickValid;
        drag.tile.classList.toggle('invalid', !drag.valid);
        return;
      }
      drag.gx = Math.floor((drag.pointerX - drag.metrics.left) / drag.metrics.stepX) - drag.grabX;
      drag.gy = Math.floor((drag.pointerY - drag.metrics.top) / drag.metrics.stepY) - drag.grabY;
      drag.valid = drag.manager.canPlace(drag.manager.matrixFor(drag.item, drag.rot), drag.gx, drag.gy, drag.item.id);
      const matrix = drag.manager.matrixFor(drag.item, drag.rot);
      this._placeItemElement(drag.tile, drag.gx, drag.gy, matrix, drag.manager);
      drag.tile.classList.toggle('invalid', !drag.valid);
    };
    if (typeof requestAnimationFrame === 'function' && drag.moved) requestAnimationFrame(update);
    else update();
  }

  _rotateDraggedItem() {
    if (!this._itemDrag) return false;
    this._itemDrag.rot = BackpackManager.normalizeRotation(this._itemDrag.rot + 1);
    const drag = this._itemDrag;
    if (drag.kind !== 'inventory') {
      this._handleItemDragMove({ clientX: drag.pointerX, clientY: drag.pointerY });
      return true;
    }
    const matrix = drag.manager.matrixFor(drag.item, drag.rot);
    drag.valid = drag.manager.canPlace(matrix, drag.gx, drag.gy, drag.item.id);
    this._renderTileBlocks(drag.tile, drag.item, matrix, drag.manager, drag.gridId);
    this._placeItemElement(drag.tile, drag.gx, drag.gy, matrix, drag.manager);
    drag.tile.classList.toggle('invalid', !drag.valid);
    return true;
  }

  _handleItemDragEnd(event) {
    const drag = this._itemDrag;
    const destination = drag && drag.kind !== 'inventory' && drag.moved
      ? this._preparedDropTarget(drag, drag.pointerX, drag.pointerY) : null;
    if (drag && drag.moved && drag.kind === 'inventory') {
      drag.gx = Math.floor((drag.pointerX - drag.metrics.left) / drag.metrics.stepX) - drag.grabX;
      drag.gy = Math.floor((drag.pointerY - drag.metrics.top) / drag.metrics.stepY) - drag.grabY;
      drag.valid = drag.manager.canPlace(drag.manager.matrixFor(drag.item, drag.rot), drag.gx, drag.gy, drag.item.id);
    }
    this._itemDrag = null;
    window.removeEventListener('pointermove', this._boundItemDragMove);
    window.removeEventListener('pointerup', this._boundItemDragEnd);
    window.removeEventListener('pointercancel', this._boundItemDragEnd);
    const quick = document.getElementById('quickUseSlot');
    quick?.classList?.remove('drop-valid', 'drop-invalid');
    if (event?.type === 'pointercancel') {
      if (drag?.kind === 'inventory') this.updateInventoryUI();
      else if (drag) this.updateStorageUI();
      return;
    }
    if (!drag || !drag.moved) {
      if (drag?.kind === 'storage') this.toggleStorageItemSelection(drag.item.id);
      else if (drag?.kind === 'prepared') this.togglePreparedPackItemSelection(drag.item.id);
      else if (drag) this.updateInventoryUI();
      return;
    }
    if (drag.kind !== 'inventory') {
      let placed = false;
      if (destination?.kind === 'quick') {
        placed = this.assignQuickItem(drag.item.id, drag.kind === 'storage' ? 'storage' : 'backpack');
        if (placed) {
          this._ignoreQuickSlotClick = true;
          if (typeof setTimeout === 'function') setTimeout(() => { this._ignoreQuickSlotClick = false; }, 0);
        }
        if (!placed) {
          if (drag.item.effect !== 'oxygen-50') this.ui.showToast('快捷栏只能放可使用物品');
          this.updateStorageUI();
        }
        return;
      } else if (destination?.kind === 'grid') {
        const sourceId = String(drag.item.id);
        placed = destination.manager === drag.manager
          ? drag.manager.moveItem(drag.item, destination.gx, destination.gy, drag.rot)
          : this._moveGridItemAt(drag.item, drag.manager, destination.manager, destination.gx, destination.gy, drag.rot);
        if (placed && destination.manager !== drag.manager) {
          this.selectedStorageIds.delete(sourceId);
          this.selectedPackIds.delete(sourceId);
          (destination.manager === this.backpack ? this.selectedPackIds : this.selectedStorageIds).add(String(drag.item.id));
          if (this.menu) this.menu.lastSelectedItem = { source: destination.manager === this.backpack ? 'backpack' : 'storage', id: drag.item.id };
        }
      }
      if (!placed) this.ui.showToast('无法放置：目标格被占用、越界或背包空间不足');
      this._fillStorageOverflow();
      this.state.inventory = this.backpack.items;
      this.updateStorageUI();
      this._save();
      this._syncPreparedBackpack();
      return;
    }
    const previousLayout = { gx: drag.item.gx, gy: drag.item.gy, rot: drag.item.rot };
    const moved = drag.valid && drag.manager.moveItem(drag.item, drag.gx, drag.gy, drag.rot);
    if (!moved) {
      this.ui.showToast('无法放置：越界或与其他物资重叠');
    } else if (drag.manager === this.backpack && (drag.item.gx !== previousLayout.gx ||
        drag.item.gy !== previousLayout.gy || drag.item.rot !== previousLayout.rot)) {
      this._tutorialAction('rearrange', { changed: true });
    }
    if (drag.kind === 'storage') {
      this._fillStorageOverflow();
      this.updateStorageUI();
      this._save();
    } else if (drag.kind === 'prepared') {
      this.state.inventory = this.backpack.items;
      this.updateStorageUI();
      this._save();
      this._syncPreparedBackpack();
    } else {
      this.updateInventoryUI();
      this._syncGuestInventoryLayout();
    }
  }

  _cancelItemDrag() {
    this._itemDrag = null;
    if (typeof window === 'undefined') return;
    window.removeEventListener('pointermove', this._boundItemDragMove);
    window.removeEventListener('pointerup', this._boundItemDragEnd);
    window.removeEventListener('pointercancel', this._boundItemDragEnd);
  }

  _syncGuestInventoryLayout(type = 'inventory-layout', payload = null) {
    if (this.state.coop.running && this.state.coop.role === 'guest') {
      this._guestInventoryLayoutPending = true;
      this._guestInventoryLayoutPendingAt = performance.now();
      this.coopSession.sendEvent(type, payload || {
        items: this.state.inventory.map(({ id, gx, gy, rot }) => ({ id, gx, gy, rot }))
      });
    }
  }

  _resolveWeaponAttack(shooter, weapon, angles, onHit = null) {
    const rays = [];
    const maxDistance = 650;
    const targetsPerRay = Math.max(1, weapon.penetrationTargets || 1);
    const friendlyFire = !!(this.state?.coop?.running && this.state.coop.friendlyFire);
    for (const angle of angles) {
      const directionX = Math.cos(angle);
      const directionY = Math.sin(angle);
      const wallDistance = this.map.rayWallDistance(shooter.x, shooter.y, directionX, directionY, maxDistance);
      const targets = [];
      const entities = [
        ...(this.nightmares || []).filter(monster => monster.active),
        ...(this.heavies || []).filter(heavy => heavy.active && !heavy.dead),
        ...this.hunters.filter(hunter => hunter.active && !hunter.dead),
        ...(friendlyFire ? this._onlineCoopPlayers().filter(player => player !== shooter && !player.downed) : [])
      ];
      entities.forEach((entity, order) => {
        const dx = entity.x - shooter.x;
        const dy = entity.y - shooter.y;
        const projection = dx * directionX + dy * directionY;
        if (projection < 0 || projection > maxDistance) return;
        const perpendicularSquared = Math.max(0, dx * dx + dy * dy - projection * projection);
        const radius = entity.radius + 6;
        if (perpendicularSquared > radius * radius) return;
        const distance = Math.max(0, projection - Math.sqrt(radius * radius - perpendicularSquared));
        if (distance <= wallDistance) targets.push({ entity, distance, order });
      });
      targets.sort((a, b) => a.distance - b.distance || a.order - b.order);

      const hitTargets = [];
      let traceLength = wallDistance;
      for (const candidate of targets) {
        if (hitTargets.length >= targetsPerRay) break;
        const entity = candidate.entity;
        const playerTarget = this._isCoopPlayer(entity);
        if (playerTarget
          ? (!friendlyFire || entity === shooter || entity.downed)
          : (this.nightmares || []).includes(entity) ? !entity.active : (!entity.active || entity.dead)) continue;
        hitTargets.push(entity);
        traceLength = candidate.distance;
        if (onHit) onHit(entity, angle, weapon.damage || 1);
      }
      const startX = shooter.x;
      const startY = shooter.y;
      rays.push({
        angle,
        startX,
        startY,
        traceLength,
        endX: startX + directionX * traceLength,
        endY: startY + directionY * traceLength,
        hitTargets
      });
    }
    return rays;
  }

  _recordDefeat(target, attacker, hit) {
    if (hit?.hit && !target.recoverTimer) target.alerted = true;
    if (!this.defeatLedger || this.trainingSession || !hit?.hit) return false;
    const ownerId = typeof attacker === 'string' ? attacker : attacker === this.player ?
      (this.state.coop?.playerId || 'host') : this._remoteEntryForActor(attacker)?.id;
    if ((this.nightmares || []).includes(target)) {
      return !!hit.triggeredRecovery && this.defeatLedger.record('monster', `${target.id}:sleep:${target.sleepCycle}`, ownerId);
    }
    if (!hit.dead) return false;
    const type = (this.heavies || []).includes(target) ? 'heavy' : 'hunter';
    return this.defeatLedger.record(type, target.lifeId, ownerId, { temporary: !!target.revivePending });
  }

  _hitEnemy(target, amount = 1, bypassArmor = false) {
    const before = target.hp;
    const hit = target.registerHit(amount, bypassArmor);
    const damage = Number.isFinite(before) ? Math.max(0, before - target.hp) : hit.triggeredRecovery ? 1 : 0;
    this._hitEffectSequence = (this._hitEffectSequence || 0) + 1;
    if (damage > 0) this.equipment?.hit(target, damage, this._feedbackShotId || `hit:${this._hitEffectSequence}`);
    return hit;
  }

  _applyProjectileHit(target, shooter, angle) {
    if ((this.heavies || []).includes(target)) {
      const hit = this._hitEnemy(target, shooter.weapon?.damage || 1);
      this._recordDefeat(target, shooter, hit);
      return hit;
    }
    if (this._isCoopPlayer(target)) {
      if (!this.state?.coop?.running || !this.state.coop.friendlyFire || target === shooter || target.downed) {
        return { hit: false, blocked: true };
      }
      const damage = this._applyDamage(target, shooter.weapon?.damage || 1);
      if (!damage.blocked && target === this.player) this.ui.triggerDamageFlash(0.35, 100);
      return { hit: !damage.blocked, ...damage };
    }

    if ((this.nightmares || []).includes(target)) {
      const hit = this._hitEnemy(target, shooter.weapon?.damage || 1);
      this._recordDefeat(target, shooter, hit);
      const pushDistance = hit.triggeredRecovery ? 240 : 50;
      const angleAway = Math.atan2(target.y - shooter.y, target.x - shooter.x);
      this._knockbackPlayer(target, angleAway, pushDistance);
      target.waypoints = [];
      target.waypointTimer = 0;
      if (hit.triggeredRecovery) {
        this.ui.showToast(`Nightmare 进入休眠 ${target.recoverTimer} 秒`);
      } else if (!hit.recovering) {
        this.ui.showToast(`命中 / 目标硬直${Config.monster.hitStagger}s [${hit.shotCount}/${Config.monster.recoveryHits}]`);
      } else {
        this.ui.showToast(`目标瘫痪中 [${target.recoverTimer.toFixed(1)}s]`);
      }
      if (this.audio.calculateSpatial && !hit.recovering) {
        const spatial = this.audio.calculateSpatial(shooter.x, shooter.y, shooter.angle, target.x, target.y, 650);
        const recovered = !!hit.triggeredRecovery;
        this.audio.playSpatialTone(
          recovered ? 60 : 88,
          recovered ? 0.45 : 0.18,
          recovered ? 0.35 : 0.22,
          'sawtooth', spatial.pan, Math.max(recovered ? 0.6 : 0.5, spatial.distanceGain), spatial.isBehind
        );
      }
      return hit;
    }

    const hit = this._hitEnemy(target, shooter.weapon?.damage || 1);
    this._recordDefeat(target, shooter, hit);
    if (!hit.hit) return hit;
    if (!hit.dead) {
      const nextX = target.x + Math.cos(angle) * Config.hunter.knockback;
      const nextY = target.y + Math.sin(angle) * Config.hunter.knockback;
      if (!this.map.blocked(nextX, target.y, target.radius)) target.x = nextX;
      if (!this.map.blocked(target.x, nextY, target.radius)) target.y = nextY;
      target.waypoints = [];
      target.waypointTimer = 0;
    }
    if (hit.dead) {
      this.ui.showToast('猎手已被击毙！');
      this.ui.log('威胁消除：猎手生命体已击毙。');
      if (this.audio.playSpatialTone) this.audio.playSpatialTone(55, 0.3, 0.6, 'sawtooth', 0, 1, false);
    } else if (this.audio.playSpatialTone) {
      this.audio.playSpatialTone(120, 0.15, 0.2, 'square', 0, 1, false);
    }
    return hit;
  }

  _createWeaponShotId(shooter = this.player) {
    this.shotSequence = (this.shotSequence || 0) + 1;
    const entry = this._remoteEntryForActor(shooter);
    const shooterId = shooter === this.player ? (this.state.coop.playerId || 'host') : (entry?.id || 'host');
    return `${shooterId}:${this.shotSequence}`;
  }

  _addMuzzleFlash(shooter, shotId) {
    this.equipment?.addCasing(shooter, String(shotId));
    const room = this.map.getRoomAt(shooter.x, shooter.y);
    this.state.muzzleFlashes ||= [];
    this.state.muzzleFlashes.push({
      id: String(shotId), x: shooter.x, y: shooter.y, angle: shooter.angle,
      roomIndex: room ? this.map.worldRooms?.indexOf(room) ?? -1 : -1,
      timer: 0.18, duration: 0.18, range: 550
    });
    if (this.state.muzzleFlashes.length > 12) this.state.muzzleFlashes.shift();
  }

  _advanceMuzzleFlashes(dt) {
    for (let index = (this.state.muzzleFlashes?.length || 0) - 1; index >= 0; index--) {
      this.state.muzzleFlashes[index].timer -= dt;
      if (this.state.muzzleFlashes[index].timer <= 0) this.state.muzzleFlashes.splice(index, 1);
    }
  }

  _broadcastWeaponFired(shooter, shotId) {
    if (this.state.coop.role !== 'host' || !this.state.coop.running) return false;
    const shooterEntry = this._remoteEntryForActor(shooter);
    const shooterId = shooter === this.player ? 'host' : shooterEntry?.id;
    if (!shooterId) return false;
    this.weaponEffectSequence = (this.weaponEffectSequence || 0) + 1;
    const effectId = `host:${this.state.coop.mapSeed || 'mission'}:${this.weaponEffectSequence}`;
    const room = this.map.getRoomAt(shooter.x, shooter.y);
    const payload = {
      shotId: effectId, requestShotId: String(shotId), shooterId, x: shooter.x, y: shooter.y,
      angle: shooter.angle, weaponId: shooter.weaponId,
      roomIndex: room ? this.map.worldRooms?.indexOf(room) ?? -1 : -1
    };
    let sent = false;
    for (const entry of this.remotePlayers.values()) {
      if (entry.online === false || entry.id === shooterId) continue;
      sent = this.coopSession.sendEvent('weapon-fired', payload, entry.id) || sent;
    }
    return effectId;
  }

  _receiveWeaponFired(message) {
    if (this.state.coop.role !== 'guest' || !this.state.coop.running || !message?.shotId ||
        !Number.isFinite(message.x) || !Number.isFinite(message.y)) return false;
    const localId = this.state.coop.playerId || this.coopSession?.memberId;
    if (message.shooterId === localId) return false;
    this.seenWeaponEffects ||= new Set();
    if (this.seenWeaponEffects.has(String(message.shotId))) return false;
    this.seenWeaponEffects.add(String(message.shotId));
    this.equipment?.addCasing(message, String(message.shotId));
    if (this.seenWeaponEffects.size > 128) this.seenWeaponEffects.delete(this.seenWeaponEffects.values().next().value);
    this.state.muzzleFlashes ||= [];
    const room = this.map.getRoomAt(message.x, message.y);
    this.state.muzzleFlashes.push({
      id: String(message.shotId), x: message.x, y: message.y, angle: Number(message.angle) || 0,
      roomIndex: room ? this.map.worldRooms?.indexOf(room) ?? -1 : -1,
      timer: 0.18, duration: 0.18, range: 550
    });
    if (this.state.muzzleFlashes.length > 12) this.state.muzzleFlashes.shift();
    this.audio.playSpatialSound?.(
      'resources/gun-shot-359196.mp3', 0.3, this.player, { x: message.x, y: message.y }, this.map
    );
    return true;
  }

  /**
   * Weapon discharge action and target intersection resolving
   */
  _isPlayerAiming(shooter) {
    if (shooter?.downed || shooter?.flashStunTimer > 0) return false;
    if (shooter === this.player) return !!this.state.stabilized;
    return this._remoteEntryForActor(shooter)?.input?.aiming === true;
  }

  shoot(shooter = this.player, confirmedShotId = null) {
    if (shooter === this.player && this.state.equipmentSyncing) return;
    this._cancelSupplyUse(shooter);
    shooter.barrierRemoval = null;
    if (shooter === this.player) this.state.barrierBlueprint = null;
    if (shooter === this.player) this.advanceCamera(0);
    if (!this.state.running || this.state.tutorial?.paused || this.state.coop.hostPaused || shooter.dodgeTimer > 0 ||
        (shooter === this.player && (this.state.fullMapOpen || this.state.fullMapClosing || this.state.inventoryOpen || this.state.inventoryClosing))) return;
    if (shooter.stunned > 0 || shooter.flashStunTimer > 0 || (shooter.downed && shooter.activeSlot !== 'sidearm')) {
      this.ui.showToast('休克硬直中，无法射击！');
      return;
    }
    if (this.state.coop.running && this.state.coop.role === 'guest' && shooter === this.player) {
      const aiming = this._isPlayerAiming(shooter);
      const result = shooter.shoot(aiming, this.map, this.audio, this.monster);
      if (result.fired) {
        const shotId = this._createWeaponShotId(shooter);
        this._addMuzzleFlash(shooter, shotId);
        this._tutorialAction('fire');
        this.coopSession.sendEvent('action', {
          action: 'shoot', aim: shooter.angle, aiming, shotId
        });
        if (shooter.ammo === 0 && shooter.reserveAmmo > 0 && shooter.reload(this.audio)) {
          this.coopSession.sendEvent('action', { action: 'reload' });
          this.ui.showToast('弹匣打空，自动换弹中');
        }
        this.ui.updateWeaponReadout(this.player);
      } else if (result.reason === 'empty') {
        this.ui.showToast('弹药耗尽 (按 R 换弹)');
      } else if (result.reason === 'reloading') {
        this.ui.showToast('正在换弹中...');
      }
      return;
    }

    const shooterAudio = shooter === this.player ? this.audio : {
      playSound: (url, volume) => this.audio.playSpatialSound
        ? this.audio.playSpatialSound(url, volume, this.player, shooter, this.map)
        : this.audio.playSound(url, volume)
    };
    const result = shooter.shoot(this._isPlayerAiming(shooter), this.map, shooterAudio, this.monster);
    if (result.fired) {
      const shotId = confirmedShotId || this._createWeaponShotId(shooter);
      this._feedbackShotId = shotId;
      if (shooter === this.player) this._tutorialAction('fire');
      const effectId = this._broadcastWeaponFired(shooter, shotId);
      this._addMuzzleFlash(shooter, effectId || shotId);
      if (shooter === this.player) {
        const angle = result.shotAngle;
        const recoilIntensity = this.state.stabilized ? shooter.weapon.recoilAim : shooter.weapon.recoilHip;
        this.state.recoilX += -Math.cos(angle) * recoilIntensity;
        this.state.recoilY += -Math.sin(angle) * recoilIntensity;
      }

      const rays = this._resolveWeaponAttack(shooter, shooter.weapon, result.shotAngles, (target, angle) => {
        const hit = this._applyProjectileHit(target, shooter, angle);
        if (shooter === this.player) this._tutorialAction('aimed-hit', { target, hit, aiming: this._isPlayerAiming(shooter) });
      });
      this._feedbackShotId = null;
      if (!rays.some(ray => ray.hitTargets.length)) {
        this.ui.log('枪声在走廊里回响。');
        this.ui.showToast('未命中');
      }

      rays.forEach(ray => {
        this.state.bulletTraces.push({
          startX: ray.startX, startY: ray.startY,
          currentX: ray.startX, currentY: ray.startY,
          endX: ray.endX, endY: ray.endY,
          speed: 3500, lifetime: 0.22, maxLifetime: 0.22, color: '#d7f36b'
        });
        const sparkCount = ray.hitTargets.length
          ? (result.shotAngles.length > 1 ? 8 : 22)
          : (result.shotAngles.length > 1 ? 3 : 8);
        for (let index = 0; index < sparkCount; index++) {
          const sparkAngle = ray.angle + Math.PI + (Math.random() - 0.5) * 1.5;
          const sparkSpeed = 50 + Math.random() * 120;
          this.state.impactParticles.push({
            x: ray.endX, y: ray.endY,
            vx: Math.cos(sparkAngle) * sparkSpeed,
            vy: Math.sin(sparkAngle) * sparkSpeed,
            alpha: 1, decay: 2.2 + Math.random() * 2.8,
            color: ray.hitTargets.length ? '#e8754e' : '#75ddd0',
            size: 1.5 + Math.random() * 2
          });
        }
      });

      if (shooter.ammo === 0 && shooter.reserveAmmo > 0 && shooter.reload(this.audio) && shooter === this.player) {
        this.ui.showToast('弹匣打空，自动换弹中');
      }
      if (shooter === this.player) this.ui.updateWeaponReadout(this.player);
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
    this.state.stabilized = !!active && !this.player.downed && !(this.player.flashStunTimer > 0) && !this.state.inventoryOpen && !this.state.fullMapOpen;
    this.advanceCamera(0);
    this.renderer.prepareCamera(this.player, this.state);
  }

  /**
   * Tracks cursor positions and computes vectors for looking & aiming directions
   */
  handleAim(event) {
    if (!event) return;
    this.lastPointerEvent = event;
    this.advanceCamera(0);
  }

  advanceCamera(dt) {
    const state = this.state;
    if (state.running === false || state.transitioning || state.pauseMenuOpen || state.coop?.hostPaused ||
        state.tutorial?.paused || state.activeQte || state.fullMapOpen || state.fullMapClosing ||
        state.inventoryOpen || state.inventoryClosing) return;
    const zoom = Config.camera.baseZoom * (this._isPlayerAiming(this.player) ? Config.camera.aimMultiplier : 1);
    const previousZoom = Number(state.cameraZoom) || zoom;
    state.cameraLookX = (Number(state.cameraLookX) || 0) * previousZoom / zoom;
    state.cameraLookY = (Number(state.cameraLookY) || 0) * previousZoom / zoom;
    state.cameraZoom = zoom;
    const decay = Math.exp(-10 * Math.max(0, dt));
    state.recoilX = (Number(state.recoilX) || 0) * decay;
    state.recoilY = (Number(state.recoilY) || 0) * decay;
    if (Math.abs(state.recoilX) < 0.05) state.recoilX = 0;
    if (Math.abs(state.recoilY) < 0.05) state.recoilY = 0;
    const event = this.lastPointerEvent;
    if (!event || !this.ui.frame) return;
    const rect = this.ui.frame.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const scaleX = rect.width / Config.VIEW_W;
    const scaleY = rect.height / Config.VIEW_H;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const screenOffsetX = (event.clientX - centerX) / scaleX;
    const screenOffsetY = (event.clientY - centerY) / scaleY;

    const maxX = Config.VIEW_W * Config.camera.maxLookFraction / zoom;
    const maxY = Config.VIEW_H * Config.camera.maxLookFraction / zoom;
    const targetX = Math.max(-1, Math.min(1, screenOffsetX / (Config.VIEW_W / 2))) * maxX;
    const targetY = Math.max(-1, Math.min(1, screenOffsetY / (Config.VIEW_H / 2))) * maxY;
    const blend = 1 - Math.exp(-Math.max(0, dt) / Config.camera.smoothingSeconds);
    state.cameraLookX = Math.max(-maxX, Math.min(maxX, state.cameraLookX + (targetX - state.cameraLookX) * blend));
    state.cameraLookY = Math.max(-maxY, Math.min(maxY, state.cameraLookY + (targetY - state.cameraLookY) * blend));
    state.mouseX = this.player.x + state.cameraLookX + state.recoilX + (state.shakeX || 0) + screenOffsetX / zoom;
    state.mouseY = this.player.y + state.cameraLookY + state.recoilY + (state.shakeY || 0) + screenOffsetY / zoom;
    this.player.angle = Math.atan2(state.mouseY - this.player.y, state.mouseX - this.player.x);
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

    const fpsCap = this.state.fpsCap === 'unlimited' ? 0 : Number(this.state.fpsCap);
    const frameInterval = fpsCap > 0 ? 1000 / fpsCap : 0;
    if (frameInterval && !this.state.nextFrameAt) this.state.nextFrameAt = now;
    if (frameInterval && now < this.state.nextFrameAt) {
      requestAnimationFrame((n) => this.loop(n));
      return;
    }
    if (frameInterval && now - this.state.nextFrameAt > frameInterval) this.state.nextFrameAt = now;

    const dt = Math.min(0.05, Math.max(0, (now - this.state.lastTime) / 1000));
    this.state.lastTime = now;

    this.update(dt);
    this.render();

    this.state.nextFrameAt = frameInterval ? this.state.nextFrameAt + frameInterval : 0;

    requestAnimationFrame((n) => this.loop(n));
  }

  /**
   * Evaluates world and entity actions over time increment
   */
  _drainOxygen(dt) {
    const rate = this.state.finalTerminalPressure ? 0.30 : 0.10;
    const players = this.state.coop.running ? this._onlineCoopPlayers() : [this.player];
    for (const player of new Set(players)) {
      if (!player.downed) player.oxygen = Math.max(0, player.oxygen - dt * rate);
    }
  }

  update(dt) {
    this._updateCoopNetworkStatus();
    this.equipment?.pumpTransfers();
    if (!this.state.running) return;
    if (this.state.pauseMenuOpen && !this.state.coop.running) return;
    if (this.state.tutorial?.paused) return;
    if (this.state.coop.running && this.state.coop.role === 'guest' && !this.state.coop.connected) {
      this._checkCoopDisconnect();
      return;
    }
    if (this.state.coop.running && this.state.coop.hostPaused) {
      this._checkCoopDisconnect();
      return;
    }
    const isGuest = this.state.coop.running && this.state.coop.role === 'guest';
    if (isGuest && this.state.equipmentSyncing && !this.equipment?.receiving && performance.now() - (this._equipmentRequestAt || 0) > 1500) {
      this._equipmentRequestAt = performance.now();
      this.coopSession.sendEvent('equipment-state-request', { missionId: this.state.missionFxId });
    }
    if (isGuest && this._pendingSupplyRequest && performance.now() - this._pendingSupplyRequest.sentAt > 1500) {
      this._pendingSupplyRequest.sentAt = performance.now();
      this.coopSession.sendEvent('action', this._pendingSupplyRequest.payload);
    }
    const activePlayers = isGuest ? [] : this._onlineCoopPlayers();
    const blockingActors = isGuest ? [] : [
      ...(this.nightmares || []).filter(monster => monster.active),
      ...(this.heavies || []).filter(heavy => heavy.active && !heavy.dead),
      ...this.hunters.filter(hunter => hunter.active && !hunter.dead)
    ];
    const doorEvents = this.map.advanceDoorAnimations
      ? this.map.advanceDoorAnimations(dt, activePlayers, blockingActors, !isGuest)
      : [];
    if (!isGuest && doorEvents.some(event => event.blocked)) this.ui.showToast('门口有人，关门已取消');
    if (this.state.tutorial?.paused) return;
    this._updateEnemyEffects(dt);
    this.equipment?.updateVisuals();
    this._advanceMuzzleFlashes(dt);
    this.state.flashBursts = (this.state.flashBursts || []).filter(effect => (effect.lifetime -= dt) > 0);
    this.ui.updateFlashbangs?.(this.state.flashbangCount, this.state);
    if (this.state.coop.running && this.state.coop.role === 'guest') {
      this._updateGuestCoop(dt);
      this._updateCoopRevivePrompt();
      return;
    }
    this.state.elapsed += dt;
    this._updateFlashbangs(dt);

    // Decrement QTE monster teleport cooldown timer (15s cooldown)
    if (this.state.qteMonsterTpCooldown > 0) {
      this.state.qteMonsterTpCooldown = Math.max(0, this.state.qteMonsterTpCooldown - dt);
    }

    // 1. Update Player position & status timers (freeze input movement during active QTE, Full Map, or Stun)
    const inputKeys = (this.state.pauseMenuOpen || this.state.activeQte || this.state.fullMapOpen || this.state.fullMapClosing || this.state.inventoryOpen || this.state.inventoryClosing || this.player.stunned > 0) ? {} : this.state.keys;
    const previousX = this.player.x;
    const previousY = this.player.y;
    const collisionPlayers = this.state.coop.running ? this._onlineCoopPlayers(this.state.coop.playerId) : [];
    const playerResult = this.player.update(dt, inputKeys, this.state.stabilized, this.map, this.audio, collisionPlayers);
    if (Math.hypot(this.player.x - previousX, this.player.y - previousY) > 0.01) {
      this._tutorialAction('move');
      if (inputKeys.shift && !this.state.stabilized && !this.player.invulnerable &&
          this.player.moveSpeed >= Config.player.sprintSpeed) {
        this._tutorialAction('sprint');
      }
    }
    if (playerResult && playerResult.reloaded) {
      this.ui.showToast('换弹完成');
      this._tutorialAction('reload');
    }
    if (playerResult && playerResult.rollFinished) this._tutorialAction('roll');
    this.trainingSession?.tick();
    if (this.state.tutorial?.paused) return;
    this.advanceCamera(dt);
    this._updateRemotePlayers(dt);
    this._updateSupplyUses();
    this.equipment?.updateActions();
    this._lockFinalTerminalNoise();
    this._checkCoopDisconnect();
    if (!this.state.running) return;
    if (playerResult && playerResult.stunRecovered) {
      this.ui.showToast('电击硬直解除，身体恢复行动');
      this.ui.log('恢复：高压电击麻痹硬直结束，行动能力恢复。');
    }

    if (this.state.activeQte || this.state.fullMapOpen || this.state.inventoryOpen || this.player.stunned > 0 || this.player.dodgeTimer > 0) {
      this.state.fireHeld = false;
    } else if (this.state.fireHeld && !this.state.fullMapOpen && !this.state.fullMapClosing && !this.state.inventoryOpen && !this.state.inventoryClosing &&
        (!this.player.downed || this.player.activeSlot === 'sidearm') && this.player.weapon.automatic && this.player.ammo > 0 && this.player.reloading <= 0) {
      this.shoot();
    }
    if (this.state.tutorial?.paused) return;

    // 1a. Update active QTE security console countdown timer (10s time limit)
    if (this.state.activeQte) {
      this.state.activeQte.timeLeft = Math.max(0, this.state.activeQte.timeLeft - dt);
      this.ui.updateQTETimer(this.state.activeQte.timeLeft, this.state.activeQte.maxTime);
      if (this.state.activeQte.timeLeft <= 0) {
        this.handleQTETimeout();
        if (!this.state.running) return;
      }
    }

    // 1b. Fog of War: discover room as soon as player steps inside
    const currentRoom = this.map.getRoomAt(this.player.x, this.player.y);
    if (currentRoom && !currentRoom.discovered) {
      currentRoom.discovered = true;
      if (currentRoom.kind !== 'corridor') {
        this.ui.showToast(`探索新区域: ${currentRoom.title}`);
        this.ui.log(`雷达已探明新区域：${currentRoom.title} (${currentRoom.label})。`);
      }
    }

    // 2. Subtract survival oxygen supplies
    this._drainOxygen(dt);

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
    if (!this.trainingSession) {
    const loudestNoise = Math.max(...this._onlineCoopPlayers().map(player => player.noise), 0);
    if ((this.nightmares || []).some(monster => (!monster.active && this.state.elapsed > 7) ||
        (!monster.alerted && (loudestNoise > Config.monster.triggerNoiseThreshold || this.state.loot >= 2)))) {
      this.activateMonster(loudestNoise > Config.monster.triggerNoiseThreshold ? '脚步声在走廊里回响。' : '墙后传来沉重的呼吸声。');
    }
    // Activate ALL hunters immediately at game start (after 3s, not near player)
    if (this.state.elapsed > 3 && !this.state.huntersInitialized) {
      const count = this._getEncounterSettings().heavyCount;
      for (let index = 0; index < count; index++) this._spawnHeavy();
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
    if (this.state.huntersInitialized) {
      this.state.hunterSpawnTimer -= dt;
      if (this.state.hunterSpawnTimer <= 0) {
        this._spawnHeavy();
        if (this.state.finalTerminalPressure) {
          const settings = this._getFinalTerminalSettings();
          if (this.state.coop.role !== 'guest') this._spawnNewHunters(settings.spawnCount);
          this.state.hunterSpawnTimer = settings.spawnInterval;
        } else {
          this._respawnDeadHunters(hunterSettings.hunterRespawnCount);
          this.state.hunterSpawnTimer = hunterSettings.hunterSpawnInterval;
        }
      }
    }

    }

    // 6. Drive monster pathfinding & AI updates
    const allEntities = new EntitySpatialGrid(64);
    const activeRemotePlayers = [...this.remotePlayers.values()].filter(entry => entry.online !== false).map(entry => entry.player);
    allEntities.rebuild([...(this.nightmares || []).filter(monster => monster.active), ...this.hunters, ...(this.heavies || []).filter(heavy => heavy.active && !heavy.dead), ...activeRemotePlayers]);
    for (const monster of this.nightmares || []) {
    const monsterTarget = this._getThreatTarget(monster);
    const monsterResult = monster.update(dt, monsterTarget, monsterTarget.noise, this.map, this.audio, allEntities);
    this.equipment?.attackObstacle(monster, monsterTarget, dt, 'monster');
    allEntities.reindex(monster);
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
        const damage = this._applyDamage(
          monsterTarget,
          Config.monster.contactDamage,
          Config.monster.contactOxygenDamage
        );
        if (!damage.blocked) {
          if (monsterTarget === this.player) this.ui.triggerDamageFlash(0.75, 130);
          monsterTarget.noise = 100;
          this.ui.log('警告：未知生命体接触！');
          this.audio.playSound('resources/injured-140224.mp3', 0.8);
        }
      }

      if (monsterResult.recovering) {
        this.ui.threatStatusText.textContent = `休眠中 (${monsterResult.recoverTimeLeft.toFixed(1)}s)`;
        this.ui.threatStatusText.className = 'ok';
      }

      if (monsterResult.recovered && this._tryWakeNightmare(monster)) {
        this._tutorialAction('monster-awake', { target: monster });
        this.ui.threatStatusText.textContent = '已苏醒';
        this.ui.threatStatusText.className = 'warning';
        this.ui.showToast('【警告】生命体休眠结束！已恢复行动！');
        this.ui.log('警报：生命体休眠恢复期结束，重新开始行动！');
      }
    }
    }

    // 6b. Drive Hunter AI (all active hunters)
    const lightSources = this._onlineCoopPlayers().filter(player => !player.downed);
    this.hunters.forEach(h => {
      if (h.trainingDummy) return;
      if (h.dead) {
        const deathResult = h.updateDeath(dt);
        if (deathResult && deathResult.revived) {
          this.ui.showToast('猎手从暗处重新站了起来！');
          this.ui.log('警报：一只猎手以半血状态完成自我复活。');
        }
        allEntities.reindex(h);
      }
      if (!h.active || h.dead) return;
      const hunterTarget = this._getThreatTarget(h);
      const hunterResult = h.update(
        dt,
        hunterTarget,
        hunterTarget.noise,
        this.map,
        this.audio,
        allEntities,
        lightSources,
        this.state.powerLossStartedAt == null || this.state.elapsed - this.state.powerLossStartedAt < 2
      );
      allEntities.reindex(h);
      if (!hunterResult) return;
      this.equipment?.attackObstacle(h, hunterTarget, dt, 'hunter');

      if (hunterResult.playerHit) {
        const damage = this._applyDamage(
          hunterTarget,
          Config.hunter.contactDamage,
          Config.hunter.contactOxygenDamage
        );
        if (!damage.blocked) {
          if (hunterTarget === this.player) this.ui.triggerDamageFlash(0.75, 130);
          hunterTarget.noise = 100;
          this.ui.log('警告：猎手接触！');
        }
      }

      if (hunterResult.deaggro) {
        this.ui.log('猎手失去了你的踪迹。');
      }
    });

    for (const heavy of this.heavies || []) {
      if (!heavy.active || heavy.dead) continue;
      const heavyResult = heavy.update(dt, this._getThreatTarget(heavy), this.map, this._onlineCoopPlayers());
      allEntities.reindex(heavy);
      if (heavyResult.wallImpact) {
        if (heavyResult.wallImpact.barrierId) this.equipment?.damage(heavyResult.wallImpact.barrierId, 5);
        this._emitWallImpact(heavyResult.wallImpact);
        this._tutorialAction('heavy-wall', { target: heavy });
      }
      for (const player of heavyResult.hits) {
        const hit = this._applyDamage(player, Config.heavy.chargeDamage);
        if (hit.blocked) continue;
        this._knockbackPlayer(player, heavy.chargeAngle, Config.heavy.knockback);
        if (player === this.player) this.ui.triggerDamageFlash(0.6, 130);
      }
      this.equipment?.attackObstacle(heavy, this._getThreatTarget(heavy), dt, 'heavy');
    }
    this._syncEnemyCorpses();

    this.trainingSession?.tick();
    if (this.state.tutorial?.paused) return;

    // 7. Update synthesized ambient acoustics (breathing audio removed per user specification)
    this.audio.update(this.player, this.monster, this.map, this.hunters, this.heavies,
      { nightmares: this.nightmares, dangerCues: this.state.selectedDifficulty === 'easy' });

    // 8. The far evac pod remains the only boarding location after rescue arrives.
    if (this._advanceExtraction(dt)) return;

    // 9. Fail checks
    if (this.state.coop.running && this.state.coop.role === 'host') {
      this._updateCoopRevive(dt);
      if (this._shouldFailMission()) {
        this.finish(false);
        return;
      }
    } else if (!this.state.coop.running && this._shouldFailMission()) {
      this.finish(false);
      return;
    }
    this._updateCoopRevivePrompt();

    if (this.state.coop.running && this.state.coop.role === 'host') {
      if (this._coopSendDue(dt)) {
        this.coopSession.sendState('snapshot', this._createCoopSnapshot());
      }
    }

    this._updateInventoryUseButton();

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
    this.ui.update(compositeState, this.player, this.nightmares);
  }

  /**
   * Updates storage visual grid
   */
  _bindPreparedTileKeyboard(tile, item, source) {
    tile.tabIndex = 0;
    tile.setAttribute('role', 'button');
    tile.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Enter' && event.shiftKey) {
        this._transferFocusedPreparedItem(item, source);
        return;
      }
      if (source === 'storage') this.toggleStorageItemSelection(item.id);
      else this.togglePreparedPackItemSelection(item.id);
    });
  }

  _transferFocusedPreparedItem(item, source) {
    if (this.state.running || this.state.coop.running) return false;
    const from = source === 'storage' ? this.storageBackpack : this.backpack;
    const to = source === 'storage' ? this.backpack : this.storageBackpack;
    if (!from.getItem(item)) return false;
    const originalId = String(item.id);
    if (!this._moveGridItem(item, from, to, from.items)) {
      this.ui.showToast('目标空间不足，物资仍留在原处');
      return false;
    }
    this.selectedStorageIds.delete(originalId);
    this.selectedPackIds.delete(originalId);
    if (source === 'storage') this._fillStorageOverflow();
    this.state.inventory = this.backpack.items;
    this.updateStorageUI();
    this._save();
    this._syncPreparedBackpack();
    if (typeof document !== 'undefined' && typeof document.querySelector === 'function') {
      this._itemTileFor(item.id, source === 'storage' ? 'prepBackpackGrid' : 'storageGrid')?.focus({ preventScroll: true });
    }
    return true;
  }

  updateStorageUI() {
    const grid = document.getElementById('storageGrid');
    if (!grid || !this.storageBackpack) return;
    grid.innerHTML = '';
    const storage = this.storageBackpack;
    grid.style.gap = `${storage.gap}px`;
    grid.style.gridTemplateColumns = `repeat(${storage.cols}, ${storage.cellSize}px)`;
    grid.style.gridTemplateRows = `repeat(${storage.rows}, ${storage.cellSize}px)`;
    for (let gy = 0; gy < storage.rows; gy++) {
      for (let gx = 0; gx < storage.cols; gx++) {
        const cell = document.createElement('div');
        cell.className = 'bp-cell';
        cell.setAttribute('aria-hidden', 'true');
        cell.style.gridColumn = String(gx + 1);
        cell.style.gridRow = String(gy + 1);
        cell.style.width = `${storage.cellSize}px`;
        cell.style.height = `${storage.cellSize}px`;
        grid.appendChild(cell);
      }
    }
    storage.items.forEach(item => {
      const matrix = storage.matrixFor(item);
      const tile = document.createElement('div');
      tile.className = `bp-item storage-item rarity-${item.rarity || 'common'}${this.selectedStorageIds.has(String(item.id)) ? ' selected' : ''}`;
      tile.setAttribute('aria-selected', String(this.selectedStorageIds.has(String(item.id))));
      this._bindPreparedTileKeyboard(tile, item, 'storage');
      tile.dataset.itemId = item.id;
      tile.title = `${item.name || '物资'} · ${this.ui.formatCreditText(item.value || 0)} · 占地 ${matrix[0].length}×${matrix.length} 格`;
      this._placeItemElement(tile, item.gx, item.gy, matrix, storage);
      this._renderTileBlocks(tile, item, matrix, storage, 'storageGrid');
      grid.appendChild(tile);
    });

    const used = storage.usedCells();
    const stats = document.getElementById('storageStats');
    if (stats) stats.textContent = `${used} / ${storage.capacity} 格 · ${storage.items.length} 件`;
    const selectedItems = [...storage.items, ...this.state.storageOverflowItems]
      .filter(item => this.selectedStorageIds.has(String(item.id)));
    const selectedValue = selectedItems.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
    const selectionStats = document.getElementById('storageSelectionStats');
    if (selectionStats) selectionStats.textContent = selectedItems.length
      ? `已选 ${selectedItems.length} 件 · ${this.ui.formatCreditText(selectedValue)}`
      : '点击物资选择出售 · 拖拽整理 · 右键 / R 旋转';
    const sellSelected = document.getElementById('sellSelectedStorageButton');
    if (sellSelected) sellSelected.disabled = selectedItems.length === 0;

    const overflowPanel = document.getElementById('storageOverflowPanel');
    const overflowGrid = document.getElementById('storageOverflowGrid');
    if (overflowPanel) overflowPanel.hidden = this.state.storageOverflowItems.length === 0;
    if (overflowGrid) {
      overflowGrid.replaceChildren(...this.state.storageOverflowItems.map(item => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `storage-overflow-item${this.selectedStorageIds.has(String(item.id)) ? ' selected' : ''}`;
        button.setAttribute('aria-pressed', String(this.selectedStorageIds.has(String(item.id))));
        button.textContent = `${item.name || '物资'} · ${this.ui.formatCreditText(item.value || 0)}`;
        button.addEventListener('click', () => this.toggleStorageItemSelection(item.id));
        return button;
      }));
    }
    this.updatePreparedPackUI();
  }

  updatePreparedPackUI() {
    const grid = document.getElementById('prepBackpackGrid');
    if (!grid || !this.backpack) return;
    const manager = this.backpack;
    grid.innerHTML = '';
    grid.style.gap = `${manager.gap}px`;
    grid.style.gridTemplateColumns = `repeat(${manager.cols}, ${manager.cellSize}px)`;
    grid.style.gridTemplateRows = `repeat(${manager.rows}, ${manager.cellSize}px)`;
    for (let gy = 0; gy < manager.rows; gy++) {
      for (let gx = 0; gx < manager.cols; gx++) {
        const cell = document.createElement('div');
        cell.className = 'bp-cell';
        cell.setAttribute('aria-hidden', 'true');
        cell.style.gridColumn = String(gx + 1);
        cell.style.gridRow = String(gy + 1);
        cell.style.width = `${manager.cellSize}px`;
        cell.style.height = `${manager.cellSize}px`;
        grid.appendChild(cell);
      }
    }
    manager.items.forEach(item => {
      const matrix = manager.matrixFor(item);
      const tile = document.createElement('div');
      tile.className = `bp-item prep-pack-item rarity-${item.rarity || 'common'}${this.selectedPackIds?.has(String(item.id)) ? ' selected' : ''}`;
      tile.setAttribute('aria-selected', String(this.selectedPackIds?.has(String(item.id))));
      this._bindPreparedTileKeyboard(tile, item, 'backpack');
      tile.dataset.itemId = item.id;
      tile.title = `${item.name || '物资'} · ${this.ui.formatCreditText(item.value || 0)} · 占地 ${matrix[0].length}×${matrix.length} 格`;
      this._placeItemElement(tile, item.gx, item.gy, matrix, manager);
      this._renderTileBlocks(tile, item, matrix, manager, 'prepBackpackGrid');
      grid.appendChild(tile);
    });
    const used = manager.usedCells();
    const stats = document.getElementById('prepBackpackStats');
    if (stats) stats.textContent = `${used} / ${manager.capacity} 格 · ${manager.items.length} 件`;
    const selected = manager.items.filter(item => this.selectedPackIds?.has(String(item.id)));
    const selectedValue = selected.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
    const selection = document.getElementById('prepBackpackSelectionStats');
    if (selection) selection.textContent = selected.length
      ? `已选 ${selected.length} 件 · ${this.ui.formatCreditText(selectedValue)}`
      : '拖拽转移 · Shift+Enter 转移焦点物资 · 右键 / R 旋转';
    const sell = document.getElementById('sellSelectedPackButton');
    if (sell) sell.disabled = selected.length === 0;
    const oxygenCount = this.carriedOxygenCount();
    const slot = document.getElementById('quickUseSlot');
    const image = document.getElementById('quickUseImage');
    const label = document.getElementById('quickUseLabel');
    if (slot) {
      slot.classList.toggle('equipped', oxygenCount > 0);
      slot.setAttribute('aria-label', `背包氧气瓶 ${oxygenCount} 瓶，任务中按 C 自动使用`);
    }
    if (image) image.hidden = false;
    if (label) {
      label.hidden = false;
      label.textContent = `×${oxygenCount} · 按 C 自动使用`;
    }
    this.updateEquipmentUI();
    this.menu?.queueRefresh();
  }

  /**
   * Triggers visual draws across all screens
   */
  render() {
    this.advanceCamera(0);
    this.renderer.prepareCamera(this.player, this.state);
    const remotePlayers = this._coopRenderPlayers();
    this.ui.updateSkillReadout?.(this.player, this.state);
    this.ui.updateEquipmentStatus?.(this.player, this.state, this._coopRosterEntries());
    this.renderer.draw(this.player, this.monster, this.map, this.state, this.hunters, remotePlayers);
    this.renderer.drawWorldOverlay(this.player, this.map, this.state);
    this.renderer.drawCenteredVision(this.player, this.map, this.state);
    if (this.state.fullMapOpen) {
      this.renderer.drawFullMap(this.player, this.map, this.state, remotePlayers);
    }
  }

  /**
   * Binds interaction listeners to system triggers
   */
  attachEventListeners() {
    window.addEventListener('resize', () => this.handleResize());
    window.addEventListener('focus', () => this._handleCoopFocusChange());
    document.addEventListener('visibilitychange', () => this._handleCoopFocusChange());

    window.addEventListener('keydown', e => {
      const key = e.key.toLowerCase();
      if (e.repeat && ['e', 'b', 'm'].includes(key)) return;
      if (this.state.transitioning) {
        e.preventDefault();
        return;
      }
      if (this.state.running && this.state.barrierBlueprint && ['r','escape'].includes(key)) {
        e.preventDefault();
        if (!e.repeat && key === 'r') this.state.barrierBlueprint.vertical = !this.state.barrierBlueprint.vertical;
        if (key === 'escape') this.state.barrierBlueprint = null;
        return;
      }
      if (key === 'escape' && this.ui.isHunterAdjustmentOpen()) {
        this.ui.closeHunterAdjustment();
        e.preventDefault();
        return;
      }
      if (key === 'escape' && (this.ui.settingsModal?.open || this.ui.abandonConfirmDialog?.open)) return;
      if (this.state.tutorial?.paused) {
        if (e.target && e.target.closest && e.target.closest('#tutorialOverlay button')) return;
        e.preventDefault();
        return;
      }
      if (this.state.pauseMenuOpen) {
        if (key === 'escape') {
          e.preventDefault();
          this.togglePauseMenu(false);
        } else if (!e.target?.closest?.('#pauseMenuDialog button, #abandonConfirmDialog button, #hunterSettingsModal button')) {
          e.preventDefault();
        }
        return;
      }
      if (this.state.coop.running && this.state.coop.hostPaused) {
        e.preventDefault();
        return;
      }
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

      if (this.state.inventoryOpen) {
        if (key === 'escape' || key === 'b') this.toggleInventory(false);
        else if (key === 'r') {
          e.preventDefault();
          if (!this._rotateDraggedItem()) this.rotateItem();
        }
        return;
      }

      if (key === 'escape' && this.state.running) {
        e.preventDefault();
        this.togglePauseMenu(true);
        return;
      }

      if (e.code === 'Space' && this.state.running) {
        e.preventDefault();
        this.roll();
        return;
      }
      if (this.state.running && (key === '1' || key === '2')) {
        this.switchWeaponSlot(key === '1' ? 'primary' : 'sidearm');
        return;
      }
      if (this.state.running && key === 'v') {
        this.melee();
        return;
      }
      if (this.state.running && key === 'c') {
        e.preventDefault();
        if (!e.repeat) this.useQuickItem();
        return;
      }
      if (this.state.running && key === 'h') {
        e.preventDefault();
        if (!e.repeat) this.useQuickItem('health-40');
        return;
      }
      if (key === 'r' && !this.state.running &&
          document.getElementById('storageContent')?.style.display !== 'none') {
        e.preventDefault();
        if (this.selectedStorageIds.size === 1) this._rotateSelectedStorageItem();
        else if (this.selectedPackIds?.size === 1) this._rotateSelectedPreparedPackItem();
        return;
      }

      if (this.state.running && key === 't') {
        e.preventDefault();
        if (!e.repeat) this.useSkill();
        return;
      }
      if (this.state.running && key === 'f') {
        e.preventDefault();
        if (!e.repeat && this.player.flashStunTimer <= 0) {
          this.player.flashlight = !this.player.flashlight;
          this._tutorialAction('flashlight');
        }
        return;
      }
      if (key === 'e') {
        if (this.state.coop.running && this.state.coop.role === 'guest') {
          this._sendGuestInput();
          this.coopSession.sendEvent('action', { action: 'interact' });
        }
        else this.interact();
      }
      if (key === 'r') {
        if (this.player.dodgeTimer > 0) return;
        if (this.state.coop.running && this.state.coop.role === 'guest') this.coopSession.sendEvent('action', { action: 'reload' });
        else this.player.reload(this.audio);
      }
      if (key === 'b') {
        this.toggleInventory();
      }
      if (key === 'm') this.toggleFullMap();
      
      // Removed Space key firing: Fire is strictly restricted to M1 (Mouse left click)
      const editingControl = e.target && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(e.target.tagName);
      if ((e.key === 'Enter' || e.code === 'Space') && !this.state.running && !editingControl) {
        e.preventDefault();
        this.start();
      }
    });

    window.addEventListener('keyup', e => {
      const key = e.key.toLowerCase();
      const wasPressed = this.state.keys[key];
      this.state.keys[key] = false;
      if (wasPressed && ['w', 'a', 's', 'd', 'shift', 'e'].includes(key)) this._sendGuestInput();
    });

    let lastM1FireTime = 0;
    let isLeftDown = false;
    let isRightDown = false;

    const gameCanvas = document.getElementById('gameCanvas');
    const visionCanvas = document.getElementById('visionCanvas');
    const isInteractiveControl = (target) => !!(target && target.closest && target.closest('button, input, select, textarea, label, #inventoryOverlay'));
    const isGameSurface = (target) => target === gameCanvas || target === visionCanvas;

    const fireIfAllowed = (target) => {
      if (this.state.tutorial?.paused) return;
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
      if (this.player.stunned > 0 || this.player.dodgeTimer > 0) return; // Disallow firing while stunned or dodging
      this.shoot();
    };

    const updateMouseButtons = (e) => {
      if (typeof e.buttons === 'number') {
        const leftNow = (e.buttons & 1) !== 0;
        const rightNow = (e.buttons & 2) !== 0;
        const wasFiring = this.state.fireHeld;
        this.state.fireHeld = leftNow && this.state.running && isGameSurface(e.target);
        if (wasFiring && !this.state.fireHeld) this._sendGuestInput();

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
      if (!this.state.fullMapOpen) this.handleAim(e);
      updateMouseButtons(e);
    });

    window.addEventListener('mousemove', e => {
      if (!this.state.fullMapOpen) this.handleAim(e);
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
        const wasFiring = this.state.fireHeld;
        this.state.fireHeld = false;
        if (wasFiring) this._sendGuestInput();
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
        const wasFiring = this.state.fireHeld;
        this.state.fireHeld = false;
        if (wasFiring) this._sendGuestInput();
      } else if (e.button === 2) {
        isRightDown = false;
        this.setStableAim(false);
      }
      updateMouseButtons(e);
    });

    window.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('dragstart', e => e.preventDefault());
    window.addEventListener('blur', () => {
      this.state.fireHeld = false;
      this.state.keys = {};
      this._handleCoopFocusChange();
      if (!this._guestInputSuspended) this._sendGuestInput(true);
    });

    if (this.ui.coopFriendlyFireToggle) {
      this.ui.coopFriendlyFireToggle.addEventListener('change', () =>
        this.setFriendlyFire(this.ui.coopFriendlyFireToggle.checked));
    }
    
    // Unlock AudioContext on first user gesture
    window.addEventListener('pointerdown', () => this.audio.ensureAudio(), { passive: true });
    window.addEventListener('keydown', () => this.audio.ensureAudio(), { passive: true });

    this.ui.startButton.addEventListener('click', () => {
      this.audio.ensureAudio();
      if (!this.state.running) {
        if (this.state.coop.role === 'host') this.startCoopMission();
        else if (!this.state.coop.role) this.start();
      }
    });
    this.ui.pauseResumeButton?.addEventListener('click', () => this.togglePauseMenu(false));
    this.ui.pauseSettingsButton?.addEventListener('click', () => {
      this.updateHunterSettingsUI();
      this.updateDifficultyUI();
      if (!this.ui.settingsModal.open) this.ui.settingsModal.showModal();
    });
    this.ui.pauseAbandonButton?.addEventListener('click', () => {
      const note = this.state.coop.running && this.state.coop.role === 'guest'
        ? '只有你会按失败结算并退出小队；其他队员继续任务。'
        : this.state.coop.running ? '全队任务会按失败结算，携带物资将失去。'
          : '本次任务会按失败结算，携带物资将失去。';
      this.ui.showAbandonConfirm?.(!!this.trainingSession, note);
    });
    this.ui.abandonCancelButton?.addEventListener('click', () => this.ui.abandonConfirmDialog?.close());
    this.ui.abandonConfirmButton?.addEventListener('click', () => {
      this.ui.abandonConfirmDialog?.close();
      this.abandonMission();
    });
    this.ui.pauseMenuDialog?.addEventListener('cancel', event => {
      event.preventDefault();
      this.togglePauseMenu(false);
    });

    if (this.ui.settingsOpenButton && this.ui.settingsModal) {
      this.ui.settingsOpenButton.addEventListener('click', () => {
        this.updateHunterSettingsUI();
        this.updateDifficultyUI();
        this.ui.settingsModal.showModal();
      });
    }
    if (this.ui.settingsCloseButton) {
      this.ui.settingsCloseButton.addEventListener('click', () => {
        this.ui.closeHunterAdjustment();
        this.ui.settingsModal.close();
      });
    }
    if (this.ui.settingsModal) {
      this.ui.settingsModal.addEventListener('click', (event) => {
        if (event.target === this.ui.settingsModal) {
          this.ui.closeHunterAdjustment();
          this.ui.settingsModal.close();
        }
      });
      this.ui.settingsModal.addEventListener('close', () => this.ui.closeHunterAdjustment());
      this.ui.settingsModal.addEventListener('cancel', () => this.ui.closeHunterAdjustment());
    }
    this.ui.settingsSectionButtons.forEach(button => {
      button.addEventListener('click', () => this.ui.showSettingsSection(button.dataset.settingsSection));
    });
    if (this.ui.fpsCapSelect) {
      this.ui.fpsCapSelect.addEventListener('change', () => this.setFpsCap(this.ui.fpsCapSelect.value));
    }
    if (this.ui.corpseLimitSelect) {
      this.ui.corpseLimitSelect.addEventListener('change', () => this.setCorpseLimit(this.ui.corpseLimitSelect.value));
    }
    Object.entries(this.ui.difficultyButtons).forEach(([difficultyId, button]) => {
      if (button) button.addEventListener('click', () => this.setDifficultyEditor(difficultyId));
    });
    this.ui.hunterSettingInputs.forEach(input => {
      input.addEventListener('change', () => this.updateHunterSetting(
        input.dataset.scale,
        input.dataset.hunterSetting,
        input.value
      ));
    });
    Object.entries(this.ui.finalTerminalSettingInputs).forEach(([key, input]) => {
      if (input) input.addEventListener('change', () => this.updateFinalTerminalSetting(key, input.value));
    });
    if (this.ui.resetHunterSettingsButton) {
      this.ui.resetHunterSettingsButton.addEventListener('click', () => this.resetHunterSettings());
    }
    const hunterNumberInputs = [
      ...this.ui.hunterSettingInputs,
      ...Object.values(this.ui.finalTerminalSettingInputs).filter(Boolean)
    ];
    hunterNumberInputs.forEach(input => {
      const openAdjuster = () => this.ui.showHunterAdjustment(input);
      input.addEventListener('focus', openAdjuster);
      input.addEventListener('click', openAdjuster);
    });
    if (this.ui.hunterAdjustPopover) {
      this.ui.hunterAdjustPopover.addEventListener('click', event => {
        const button = event.target.closest('[data-hunter-adjust]');
        if (!button) return;
        event.preventDefault();
        this.ui.applyHunterAdjustment(Number(button.dataset.hunterAdjust));
      });
      document.addEventListener('pointerdown', event => {
        if (!this.ui.isHunterAdjustmentOpen()) return;
        if (this.ui.hunterAdjustPopover.contains(event.target) || event.target === this.ui.hunterAdjustTarget) return;
        this.ui.closeHunterAdjustment();
      });
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

    if (this.ui.fullMapZoomOutBtn) {
      this.ui.fullMapZoomOutBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setFullMapZoomAt(0.8);
      });
    }
    if (this.ui.fullMapZoomInBtn) {
      this.ui.fullMapZoomInBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setFullMapZoomAt(1.25);
      });
    }
    if (this.ui.fullMapFitBtn) {
      this.ui.fullMapFitBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.resetFullMapView();
      });
    }

    if (this.ui.fullMapCanvas) {
      const mapCanvas = this.ui.fullMapCanvas;
      mapCanvas.addEventListener('wheel', (e) => {
        if (!this.state.fullMapOpen) return;
        e.preventDefault();
        this.setFullMapZoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
      }, { passive: false });
      mapCanvas.addEventListener('pointerdown', (e) => {
        if (!this.state.fullMapOpen || e.button !== 0) return;
        e.preventDefault();
        this.state.fullMapDragging = true;
        this.state.fullMapDragX = e.clientX;
        this.state.fullMapDragY = e.clientY;
        mapCanvas.classList.add('dragging');
        if (mapCanvas.setPointerCapture) mapCanvas.setPointerCapture(e.pointerId);
      });
      mapCanvas.addEventListener('pointermove', (e) => {
        if (!this.state.fullMapDragging) return;
        if (e.clientX !== this.state.fullMapDragX || e.clientY !== this.state.fullMapDragY) this._tutorialAction('map-manipulated');
        this.state.fullMapPanX += e.clientX - this.state.fullMapDragX;
        this.state.fullMapPanY += e.clientY - this.state.fullMapDragY;
        this.state.fullMapDragX = e.clientX;
        this.state.fullMapDragY = e.clientY;
        this.renderer.drawFullMap(this.player, this.map, this.state, this._coopRenderPlayers());
      });
      const endMapDrag = () => {
        this.state.fullMapDragging = false;
        mapCanvas.classList.remove('dragging');
      };
      mapCanvas.addEventListener('pointerup', endMapDrag);
      mapCanvas.addEventListener('pointercancel', endMapDrag);
      mapCanvas.addEventListener('lostpointercapture', endMapDrag);
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
    if (tab === 'coop') tab = 'briefing';
    const contentIds = {
      briefing: 'briefingContent',
      storage: 'storageContent',
      loadout: 'loadoutContent',
      ammo: 'ammoContent',
      tutorial: 'tutorialContent'
    };
    if (!contentIds[tab]) return;
    Object.entries(contentIds).forEach(([key, id]) => {
      document.getElementById(id).style.display = key === tab ? 'block' : 'none';
    });
    document.querySelectorAll('.safehouse-tabs .tab-btn').forEach(button => {
      button.classList.toggle('active', button.dataset.tab === tab);
    });
    if (window.menu) {
      window.menu.tab = tab;
      window.menu.queueRefresh();
    }
  };
});

