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
  { title: '翻滚闪避', body: '按住一个移动方向并按 Space，向该方向翻滚。翻滚时可短暂免疫攻击伤害。', objective: '沿任意方向完成一次翻滚。', actions: ['roll'] },
  { title: '刀刃近战', body: '按 V 挥刀，击退 50 单位内所有敌人。近战不增加噪音，但消耗体力。', objective: '挥出一次近战攻击。', actions: ['melee'] },
  { title: '战术地图', body: '按 M 查看完整设施地图；可用滚轮缩放、拖动查看，按 M 或 Esc 关闭。', objective: '打开并关闭一次地图。', actions: ['map-open', 'map-close'] },
  { title: '启动全部终端', body: '找到设施里的每个终端并完成屏幕上的按键序列。全部启动后，撤离舱才会解锁。', objective: '启动本设施的全部终端。', actions: ['terminals'] },
  { title: '呼叫撤离', body: '所有终端启动后，在入口气闸附近按 E，或按 X 呼叫撤离信标。信号会引来附近的威胁。', objective: '成功呼叫撤离信标。', actions: ['extraction'] },
  { title: '返回气闸', body: '沿路线返回入口气闸并进入撤离范围。带上回收物，完成这次下潜。', objective: '安全返回入口气闸。', actions: ['returned'] }
];

class Game {
  constructor() {
    this.ui = new UIManager();
    this.audio = new AudioManager();
    this.map = new MapManager();
    this.renderer = new Renderer(this.ui);
    this.player = new Player();
    this.ammoTransferSelection = { source: 'standard', target: 'pistol' };
    this.monster = new Monster();
    this.hunters = [];
    const difficultyProfiles = this._sanitizeDifficultyProfiles();

    this.state = {
      running: false,
      completed: false,
      transitioning: false,
      descentTimer: null,
      pendingTutorialMode: false,
      settlement: null,
      stabilized: false,
      laserJitter: 0,
      cameraZoom: 1,
      cameraLookX: 0,
      cameraLookY: 0,
      money: 1000,
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
      inventory: [],
      remoteInventory: [],
      elapsed: 0,
      hunterSpawnTimer: this._getHunterSettings().hunterSpawnInterval,
      huntersInitialized: false,
      finalTerminalPressure: false,
      tutorial: null,
      extractionCalled: false,
      extracted: false,
      activeQte: null,
      inventoryOpen: false,
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
    this.storageNextId = 1;
    this._initializeStorage();
    this.selectedItemId = null;
    this._itemDrag = null;
    this._boundItemDragMove = event => this._handleItemDragMove(event);
    this._boundItemDragEnd = () => this._handleItemDragEnd();
    this._bindBackpackInventories();

    this.hunters = this._createHunters();
    this.nextHunterSpawnIndex = this.hunters.length;
    this.coopSession = new CoopSession();
    this.remotePlayers = new Map();
    this.remoteQtes = new Map();
    this.pendingCoopFinishes = new Map();
    this.remotePlayer = null;
    this.remoteInput = { keys: {}, aim: 0, fire: false, seq: 0 };
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

    this.init();
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
    this.ui.updateFpsCap(this.state.fpsCap);
    this.reset();
    this.attachEventListeners();
  }

  _attachCoopSession() {
    this.coopSession.addEventListener('room', (event) => {
      if (event.detail.role === 'host') this._coopRosterSignature = '';
      this.state.coop.role = event.detail.role;
      this.state.coop.code = event.detail.code;
      this.state.coop.playerId = event.detail.memberId || 'host';
      this.state.coop.localSlot = event.detail.slot || 1;
      this.state.coop.localReady = false;
      this.state.coop.hostReady = false;
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
          armory: this.player.exportArmory()
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
        remote.input = {
          keys: {}, aim: remote.player.angle, activeSlot: remote.player.activeSlot,
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
        startPayload: this.coopStartPayload,
        snapshot: this._createCoopSnapshot()
      }, memberId);
    }
    this._broadcastCoopRoster(null, status === 'connected');
    this.updateCoopUI();
  }

  _removeCoopMember(memberId) {
    if (this.state.coop.role === 'guest' && memberId === this.state.coop.playerId) {
      this._clearReadyPending();
      this.state.coop.status = 'RECONNECT EXPIRED // 已离开本局';
      this.state.coop.running = false;
      this.state.coop.connected = false;
      this.coopSession.close(false);
      this.finish(false);
      return;
    }
    const member = (this.state.coop.members || []).find(item => item.id === memberId);
    if (member) member.status = 'removed';
    const remote = this.remotePlayers.get(memberId);
    if (remote) {
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
    for (const item of items) {
      const floorItem = this.map.scrap.find(scrap => scrap.id === item.id);
      if (floorItem) Object.assign(floorItem, {
        found: false,
        x: entry.player.x + (Math.random() - 0.5) * 24,
        y: entry.player.y + (Math.random() - 0.5) * 24
      });
      this.state.loot = Math.max(0, this.state.loot - 1);
      this.state.lootValue = Math.max(0, this.state.lootValue - (Number(item.value) || 0));
    }
    entry.backpack.clear();
    entry.inventory = entry.backpack.items;
    return items.length;
  }

  _broadcastCoopRoster(targetId = null, force = false) {
    const targetConnected = targetId && this.coopSession?.peers?.get(targetId)?.connected;
    if (this.state.coop.role !== 'host' || (!this.state.coop.connected && !targetConnected)) return false;
    const roster = {
      hostReady: !!this.state.coop.localReady,
      members: (this.state.coop.members || []).filter(member => member.status !== 'removed').map(({ id, slot, status, connected, ready, readyRequestId }) => ({
        id, slot, status, connected: !!connected, ready: !!ready, readyRequestId: readyRequestId ?? null
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

  getCoopStartBlocker() {
    const coop = this.state.coop;
    if (coop.role !== 'host') return '只有房主可以开始任务。';
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
    this.remoteInput = first?.input || { keys: {}, aim: 0, fire: false, seq: 0 };
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
    this.state.coop.startBlocker = this.state.coop.role === 'host' ? this.getCoopStartBlocker() : '';
    this.ui.updateCoopLobby(this.state.coop);
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
    const coopLocked = !!this.state.coop.role || this.state.coop.running;
    if (button) button.disabled = this.state.running || coopLocked;
    if (note) note.textContent = coopLocked
      ? '教程仅限单人任务；请离开 CO-OP 房间后启动。'
      : '仅限单人任务；教程可随时跳过，仍按正常规则结算。';
  }

  startTutorial() {
    if (this.state.running) return;
    if (this.state.coop.role || this.state.coop.running) {
      this.ui.showToast('教程仅支持单人任务，请先离开 CO-OP 房间');
      return;
    }
    this.start(true);
  }

  _tutorialStepsForPlayer(player = this.player) {
    const hasPrimaryAndSidearm = !!player.armory.loadout.primary && !!player.armory.loadout.sidearm;
    return TUTORIAL_STEPS.filter(step => !step.requiresWeaponPair || hasPrimaryAndSidearm);
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
    if (!this.state.tutorial) return;
    this.state.tutorial = null;
    this.state.keys = {};
    this.state.fireHeld = false;
    this.state.lastTime = performance.now();
    this.state.nextFrameAt = 0;
    this.ui.hideTutorial();
    this.ui.showToast('指导已跳过，任务继续');
  }

  _tutorialAction(action) {
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
    if (this.state.running || this.state.coop.role) return;
    this.state.coop.status = 'CREATING ROOM...';
    this.updateCoopUI();
    try {
      await this.coopSession.host();
    } catch (error) {
      this.state.coop.status = `ERROR // ${error.message}`;
      this.coopSession.close();
      this.state.coop.role = null;
      this.updateCoopUI();
    }
  }

  async joinCoopRoom() {
    if (this.state.running || this.state.coop.role) return;
    const code = this.ui.coopJoinCode.value;
    this.state.coop.status = 'JOINING ROOM...';
    this.updateCoopUI();
    try {
      await this.coopSession.join(code);
    } catch (error) {
      this.state.coop.status = `ERROR // ${error.message}`;
      this.coopSession.close(false);
      this.state.coop.role = null;
      this.updateCoopUI();
    }
  }

  leaveCoopRoom() {
    if (this.state.coop.running) return;
    this._clearReadyPending();
    this.coopSession.close();
    Object.assign(this.state.coop, {
      role: null, code: null, connected: false, localReady: false,
      readyPending: false, readyPendingValue: false, readyRequestSeq: 0, readyPendingRequestId: null,
      readyTimeout: null, rosterRevision: 0, startBlocker: '',
      remoteReady: false, running: false, status: 'OFFLINE // 选择创建或加入房间',
      mapSeed: null, disconnectAt: 0, remoteArmory: null,
      hostPaused: false, friendlyFire: true, playerId: 'host', localSlot: 1,
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

  _setCoopPauseState(paused) {
    const coop = this.state.coop;
    if (!coop.running || coop.hostPaused === !!paused) return false;
    coop.hostPaused = !!paused;
    if (coop.hostPaused) {
      this.state.keys = {};
      this.state.fireHeld = false;
      if (coop.role === 'host') {
        for (const entry of this.remotePlayers?.values?.() || []) {
          entry.input = {
            ...entry.input, keys: {}, fire: false, seq: entry.input?.seq || 0
          };
        }
        this._syncLegacyRemoteAliases();
      }
    }
    this.state.lastTime = performance.now();
    this.state.nextFrameAt = 0;
    this.ui.setCoopPaused?.(coop.hostPaused);
    return true;
  }

  _handleCoopFocusChange() {
    const coop = this.state.coop;
    if (coop.role !== 'host' || !coop.running) return false;
    const focused = document.visibilityState !== 'hidden' &&
      (typeof document.hasFocus !== 'function' || document.hasFocus());
    const paused = !focused;
    if (!this._setCoopPauseState(paused)) return false;
    this.coopSession.sendEvent('coop-pause', { paused });
    return true;
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
        ready, requestId, slot: coop.localSlot, armory: this.player.exportArmory()
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

  startCoopMission() {
    const coop = this.state.coop;
    const members = (coop.members || []).filter(member => member.status !== 'removed');
    const blocker = this.getCoopStartBlocker();
    if (blocker) {
      this.ui.showToast(blocker);
      this.updateCoopUI();
      return false;
    }
    const mapSeed = crypto.getRandomValues(new Uint32Array(1))[0];
    const payload = {
      mapSeed,
      scale: Config.currentScale,
      friendlyFire: coop.friendlyFire !== false,
      hunterSettings: this.state.hunterSettings,
      difficulty: this.state.selectedDifficulty,
      finalTerminalSettings: this.state.finalTerminalSettings,
      players: [
        { id: 'host', slot: 1, armory: this.player.exportArmory() },
        ...members.map(member => ({
          id: member.id,
          slot: member.slot,
          armory: member.armory || Player.createDefaultArmory()
        }))
      ]
    };
    this._beginCoopMission(payload);
    this.coopSession.sendEvent('start', payload);
    return true;
  }

  _beginCoopMission(payload) {
    Config.currentScale = payload.scale;
    this.state.selectedDifficulty = Config.difficultyPresets[payload.difficulty] ? payload.difficulty : 'medium';
    const profile = this._getDifficultyProfile(this.state.selectedDifficulty);
    this.state.hunterSettings = this._sanitizeHunterSettings(payload.hunterSettings, profile.maps);
    const defaultFinalSettings = this._finalTerminalSettings(profile);
    this.state.finalTerminalSettings = this._sanitizeFinalTerminalSettings(
      payload.finalTerminalSettings,
      defaultFinalSettings
    );
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
    this.state.coop.running = true;
    this.state.coop.hostPaused = false;
    this.state.coop.friendlyFire = payload.friendlyFire !== false;
    this.ui.setCoopPaused?.(false);
    const localProfile = players.find(member => member.id === localId);
    const localArmory = localProfile?.armory || Player.createDefaultArmory();
    this.state.armory = Player.normalizeArmory(localArmory);
    this.state.inventory = [];
    this.state.remoteInventory = [];
    this._bindBackpackInventories();
    this.remotePlayers = new Map();
    this.remotePlayer = null;
    this.remoteBackpack = BackpackManager.fromType(Config.activeBackpack);
    this._lastRemoteInputSeq = -1;
    this._lastSnapshotTick = -1;
    this.reset();
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
      const spawn = member.spawn || this._findCoopSpawnPoint(member.slot, occupied.map(item => item.player));
      player.x = spawn.x;
      player.y = spawn.y;
      const entry = {
        id: member.id, slot: member.slot, player, online: true, status: 'connected', ready: true,
        input: { keys: {}, aim: 0, activeSlot: player.activeSlot, flashlight: player.flashlight, fire: false, seq: 0 },
        inventory: [], backpack: BackpackManager.fromType(Config.activeBackpack),
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
  }

  _handleCoopMessage(channel, message, peerId = null) {
    if (message.type === 'hello') {
      const member = this._upsertCoopMember({ id: peerId || message.playerId, slot: message.slot, status: 'connected', connected: true });
      if (member && !this.state.coop.running) member.armory = Player.normalizeArmory(message.armory);
      this._broadcastCoopRoster();
      this.updateCoopUI();
    } else if (message.type === 'friendly-fire' && this.state.coop.role === 'guest' && !this.state.coop.running) {
      this.state.coop.friendlyFire = message.enabled !== false;
      this.updateCoopUI();
    } else if (message.type === 'coop-pause' && this.state.coop.role === 'guest') {
      this._setCoopPauseState(!!message.paused);
    } else if (message.type === 'request-roster' && this.state.coop.role === 'host') {
      this._broadcastCoopRoster(peerId, true);
    } else if (message.type === 'room-roster' && this.state.coop.role === 'guest') {
      const coop = this.state.coop;
      const revision = Number(message.revision) || 0;
      if (revision && revision < (coop.rosterRevision || 0)) return;
      coop.rosterRevision = revision;
      coop.hostReady = !!message.hostReady;
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
      this._beginCoopMission(message);
    } else if (message.type === 'rejoin-state' && this.state.coop.role === 'guest') {
      if (!this.state.coop.running && message.startPayload) this._beginCoopMission(message.startPayload);
      if (this.state.coop.running && message.snapshot) this._applyCoopSnapshot(message.snapshot);
    } else if (message.type === 'input' && this.state.coop.role === 'host') {
      const remote = this.remotePlayers.get(peerId);
      if (remote && Number.isFinite(message.seq) && message.seq > (remote.input.seq || -1)) {
        remote.input = message;
        this._syncLegacyRemoteAliases();
      }
    } else if (message.type === 'inventory-layout' && this.state.coop.role === 'host') {
      this._applyGuestInventoryLayout(message.items, peerId);
    } else if (message.type === 'inventory-discard' && this.state.coop.role === 'host') {
      this._discardGuestInventoryItem(message, peerId);
    } else if (message.type === 'inventory-sell' && this.state.coop.role === 'host') {
      this._sellGuestInventoryItems(message.items, peerId);
    } else if (message.type === 'inventory-sale-result' && this.state.coop.role === 'guest') {
      if (message.accepted && Number.isFinite(Number(message.amount)) && Number(message.amount) > 0) {
        this.state.money += Number(message.amount);
        this.updateMoneyUI();
        this._save();
        this.ui.showToast(`出售已确认，获得 ${this.ui.formatCreditText(Number(message.amount))}`);
      } else {
        this._guestInventoryLayoutPending = false;
        this._guestInventoryLayoutPendingAt = 0;
        this.ui.showToast('出售未获确认，正在同步背包物资');
      }
    } else if (message.type === 'snapshot' && this.state.coop.role === 'guest') {
      if (!this.state.coop.hostPaused && Number.isFinite(message.tick) && message.tick > this._lastSnapshotTick) {
        this._lastSnapshotTick = message.tick;
        this._applyCoopSnapshot(message);
      }
    } else if (message.type === 'action' && this.state.coop.role === 'host') {
      this._handleRemoteAction(message, peerId);
    } else if (message.type === 'finish' && this.state.coop.role === 'guest') {
      this._finishGuestCoop(message);
    } else if (message.type === 'qte-start' && this.state.coop.role === 'guest') {
      const terminal = this.map.terminals.find((item) => item.id === message.terminalId);
      if (terminal) {
        this.state.activeQte = { terminal, sequence: message.sequence, currentIndex: 0, failCount: 0, maxFails: 3, timeLeft: 10, maxTime: 10, remoteOwned: true };
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

  _playerSnapshot(player) {
    if (!player) return null;
    return {
      x: player.x, y: player.y, angle: player.angle,
      health: player.health, oxygen: player.oxygen, stamina: player.stamina, staminaLocked: player.staminaLocked,
      staminaRegenDelay: player.staminaRegenDelay,
      noise: player.noise, ammo: player.ammo, reserveAmmo: player.reserveAmmo,
      reloading: player.reloading, weaponId: player.weaponId, flashlight: player.flashlight,
      armory: player.exportArmory(), weaponTimers: structuredClone(player.weaponTimers),
      activeSlot: player.activeSlot, dodgeTimer: player.dodgeTimer,
      dodgeDirectionX: player.dodgeDirectionX, dodgeDirectionY: player.dodgeDirectionY,
      meleeCooldown: player.meleeCooldown, meleeVisualTimer: player.meleeVisualTimer,
      downed: !!player.downed, bleedout: player.bleedout || 0,
      reviveProgress: player.reviveProgress || 0
    };
  }

  _applyPlayerSnapshot(player, snapshot, blend = 1) {
    if (!player || !snapshot) return;
    if (snapshot.armory) player.configureArmory(snapshot.armory, snapshot.activeSlot);
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
    for (const key of ['health', 'oxygen', 'stamina', 'staminaLocked', 'staminaRegenDelay', 'noise', 'flashlight', 'bleedout', 'reviveProgress', 'dodgeTimer', 'dodgeDirectionX', 'dodgeDirectionY', 'meleeCooldown', 'meleeVisualTimer']) {
      if (snapshot[key] != null) player[key] = snapshot[key];
    }
    player.invulnerableThisFrame = player.dodgeTimer > 0;
    player.downed = !!snapshot.downed;
  }

  _createCoopSnapshot() {
    const players = this._coopRosterEntries();
    const hostEntry = players.find(entry => entry.id === 'host') || players[0];
    const guestEntry = players.find(entry => entry.id !== hostEntry?.id);
    return {
      tick: Math.round(this.state.elapsed * 1000),
      players: players.map(entry => ({
        id: entry.id,
        state: this._playerSnapshot(entry.player),
        online: entry.online !== false,
        slot: entry.slot || 1,
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
      inventories: Object.fromEntries(players.map(entry => [entry.id, (entry.inventory || []).map(item => ({ ...item }))])),
      host: this._playerSnapshot(hostEntry?.player),
      guest: guestEntry ? this._playerSnapshot(guestEntry.player) : null,
      monster: {
        x: this.monster.x, y: this.monster.y, angle: this.monster.angle,
        active: this.monster.active, alerted: this.monster.alerted,
        recoverTimer: this.monster.recoverTimer
      },
      hunters: this.hunters.map((hunter) => ({
        spawnIndex: hunter.spawnIndex, maxHp: hunter.maxHp,
        x: hunter.x, y: hunter.y, angle: hunter.angle, active: hunter.active,
        dead: hunter.dead, hp: hunter.hp, deathFade: hunter.deathFade,
        trait: hunter.trait, reviveUsed: hunter.reviveUsed,
        revivePending: hunter.revivePending, reviveTimer: hunter.reviveTimer
      })),
      doors: this.map.doors.map((door) => ({
        open: door.open,
        targetOpen: door.targetOpen ?? door.open,
        animationProgress: door.animationProgress ?? (door.open ? 1 : 0),
        openDir: door.openDir
      })),
      scrap: this.map.scrap.map((item) => ({ id: item.id, found: item.found, x: item.x, y: item.y })),
      terminals: this.map.terminals.map((terminal) => ({ solved: terminal.solved })),
      mission: {
        elapsed: this.state.elapsed, extractionCalled: this.state.extractionCalled,
        loot: this.state.loot, lootValue: this.state.lootValue,
        finalTerminalPressure: this.state.finalTerminalPressure
      },
      hostInventory: (hostEntry?.inventory || this.state.inventory).map(item => ({ ...item })),
      guestInventory: (guestEntry?.inventory || this.state.remoteInventory).map(item => ({ ...item })),
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

  _applyCoopSnapshot(snapshot) {
    if (!this.state.coop.running || this.state.coop.role !== 'guest') return;
    const localId = this.state.coop.playerId || this.coopSession?.memberId || 'guest';
    let inventoryInputs = null;
    if (Array.isArray(snapshot.players)) {
      const localState = snapshot.players.find(entry => entry.id === localId);
      if (localState) this._applyPlayerSnapshot(this.player, localState.state, 0.35);
      const remoteIds = new Set(snapshot.players.filter(entry => entry.id !== localId).map(entry => entry.id));
      for (const state of snapshot.players) {
        if (state.id === localId) continue;
        let remote = this.remotePlayers.get(state.id);
        if (!remote) {
          const player = new Player();
          player.reset(this.map, state.state?.armory || Player.createDefaultArmory());
          remote = {
            id: state.id, slot: state.slot, player, online: state.online !== false,
            status: state.online === false ? 'offline' : 'connected', input: { keys: {}, seq: 0 },
            inventory: [], backpack: BackpackManager.fromType(Config.activeBackpack), qte: null
          };
          remote.backpack.items = remote.inventory;
          this.remotePlayers.set(state.id, remote);
        }
        remote.online = state.online !== false;
        remote.status = remote.online ? 'connected' : 'offline';
        this._applyPlayerSnapshot(remote.player, state.state, 1);
      }
      for (const id of this.remotePlayers.keys()) {
        if (!remoteIds.has(id)) this.remotePlayers.delete(id);
      }
      this._syncLegacyRemoteAliases();
      inventoryInputs = snapshot.inventories || {};
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
    } else {
      this._applyPlayerSnapshot(this.player, snapshot.guest, 0.35);
      this._applyPlayerSnapshot(this.remotePlayer, snapshot.host, 1);
    }
    this.state.armory = this.player.armory;
    Object.assign(this.monster, snapshot.monster || {});
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
      if (!pressureWasActive && this.state.finalTerminalPressure) {
        const settings = this._getFinalTerminalSettings();
        this.ui.showToast('撤离舱已解锁：噪音锁定 100 / 无限猎手增援');
        this.ui.log(`警报：全员噪音锁定 100；每 ${settings.spawnInterval} 秒持续增援 ${settings.spawnCount} 只猎手。`);
      }
    }
    const localItems = Array.isArray(inventoryInputs?.[localId])
      ? inventoryInputs[localId]
      : Array.isArray(snapshot.guestInventory) ? snapshot.guestInventory : [];
    const hostItems = Array.isArray(snapshot.hostInventory) ? snapshot.hostInventory : [];
    const renderInventory = this._applyCoopInventorySnapshot(localItems, hostItems, inventoryInputs);
    this.state.bulletTraces = Array.isArray(snapshot.bulletTraces) ? snapshot.bulletTraces : [];
    this.state.impactParticles = Array.isArray(snapshot.impactParticles) ? snapshot.impactParticles : [];
    if (renderInventory) this.updateInventoryUI();
  }

  _applyCoopInventorySnapshot(guestItems, hostItems, inventoriesById = null) {
    const dragging = !!this._itemDrag;
    if (this._guestInventoryLayoutPending && !dragging && this._guestInventoryLayoutsMatch(guestItems)) {
      this._guestInventoryLayoutPending = false;
      this._guestInventoryLayoutPendingAt = 0;
    }
    const pendingExpired = this._guestInventoryLayoutPending &&
      performance.now() - this._guestInventoryLayoutPendingAt > 1500;
    if (!dragging && (!this._guestInventoryLayoutPending || pendingExpired)) {
      this._guestInventoryLayoutPending = false;
      this._guestInventoryLayoutPendingAt = 0;
      this._reconcileBackpackSnapshot('inventory', guestItems);
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
    return !dragging;
  }

  _reconcileRemoteBackpackSnapshot(entry, incoming) {
    if (!entry?.backpack || !Array.isArray(incoming)) return false;
    const existing = new Map(entry.backpack.items.map(item => [String(item.id), item]));
    const items = incoming.map(item => Object.assign(existing.get(String(item.id)) || {}, item));
    entry.backpack.items.splice(0, entry.backpack.items.length, ...items);
    entry.backpack.nextId = Math.max(1, ...items.map(item => Number(item.id) + 1 || 1));
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
    if (!Array.isArray(incoming)) return false;
    const manager = key === 'inventory' ? this.backpack : this.remoteBackpack;
    if (!manager) return false;
    const existing = new Map(manager.items.map(item => [String(item.id), item]));
    const reconciled = incoming.map(snapshotItem => {
      const item = existing.get(String(snapshotItem.id));
      return item ? Object.assign(item, snapshotItem) : { ...snapshotItem };
    });
    manager.items.splice(0, manager.items.length, ...reconciled);
    manager.nextId = Math.max(1, ...manager.items.map(item => Number(item.id) + 1 || 1));
    this.state[key] = manager.items;
    return true;
  }

  _updateGuestCoop(dt) {
    this.state.elapsed += dt;
    const keys = this.player.downed || this.state.activeQte || this.state.fullMapOpen || this.state.inventoryOpen ? {} : this.state.keys;
    const otherPlayers = this._onlineCoopPlayers(this.state.coop.playerId);
    this.player.update(dt, keys, this.state.stabilized, this.map, this.audio, otherPlayers);
    if (this.state.fireHeld && this.player.weapon?.automatic && !this.state.activeQte && !this.state.fullMapOpen &&
        !this.state.inventoryOpen && this.player.stunned <= 0 && this.player.dodgeTimer <= 0 && this.player.ammo > 0 &&
        this.player.reloading <= 0) {
      const prediction = this.player.shoot(this.state.stabilized, this.map, this.audio, this.monster);
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
    this._coopSendTimer -= dt;
    if (this._coopSendTimer <= 0) {
      this._coopSendTimer = 0.05;
      this.state.coop.inputSeq = (this.state.coop.inputSeq || 0) + 1;
      this.coopSession.sendState('input', {
        seq: this.state.coop.inputSeq,
        keys: { w: !!keys.w, a: !!keys.a, s: !!keys.s, d: !!keys.d, shift: !!keys.shift, e: !!keys.e },
        aim: this.player.angle,
        activeSlot: this.player.activeSlot,
        flashlight: this.player.flashlight,
        fire: !!this.state.fireHeld
      });
    }
    this._checkCoopDisconnect();
    this.audio.update(this.player, this.monster, this.map, this.hunters);
    this.ui.update({
      oxygen: this.player.oxygen, health: this.player.health, stamina: this.player.stamina,
      noise: this.player.noise, loot: this.state.loot, lootValue: this.state.lootValue,
      elapsed: this.state.elapsed, reloading: this.player.reloading
    }, this.player, this.monster);
  }

  _updateRemotePlayers(dt) {
    if (!this.remotePlayers?.size || !this.state.coop.running || this.state.coop.role !== 'host') return;
    const online = [...this.remotePlayers.values()].filter(entry => entry.online !== false);
    for (const entry of online) {
      const input = entry.input || {};
      const player = entry.player;
      if (['primary', 'sidearm'].includes(input.activeSlot) && input.activeSlot !== player.activeSlot) {
        player.switchWeaponSlot(input.activeSlot);
      }
      player.angle = Number.isFinite(input.aim) ? input.aim : player.angle;
      if (typeof input.flashlight === 'boolean') player.flashlight = input.flashlight;
      const keys = player.downed ? {} : (input.keys || {});
      const collisionPlayers = this._onlineCoopPlayers(entry.id);
      player.update(dt, keys, false, this.map, this.audio, collisionPlayers);
      if (input.fire && player.weapon.automatic && player.ammo > 0 && player.reloading <= 0) this.shoot(player);
      if (entry.qte) {
        entry.qte.timeLeft = Math.max(0, entry.qte.timeLeft - dt);
        if (entry.qte.timeLeft <= 0) this._failRemoteQte(entry.id);
      }
    }
    this._syncLegacyRemoteAliases();
  }

  _handleRemoteAction(message, peerId) {
    const entry = this.remotePlayers.get(peerId);
    if (!entry || !entry.online || this.state.coop.role !== 'host' || this.state.coop.hostPaused) return;
    const player = entry.player;
    if (Number.isFinite(message.aim)) player.angle = message.aim;
    if (message.action === 'shoot') this.shoot(player, message.shotId);
    if (message.action === 'reload') player.reload(this.audio);
    if (message.action === 'switch-slot') player.switchWeaponSlot(message.slot);
    if (message.action === 'roll') this.roll(player, message.dx, message.dy);
    if (message.action === 'melee') this.melee(player);
    if (message.action === 'interact') this.interact(player);
    if (message.action === 'extract') this.callExtraction();
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
    player.bleedout = 30;
    player.reviveProgress = 0;
    player.health = Math.max(0, player.health);
    player.oxygen = Math.max(0, player.oxygen);
  }

  _updateCoopRevive(dt) {
    if (this.state.coop.role !== 'host') return false;
    const players = this._coopRosterEntries().filter(entry => entry.online !== false);
    if (!players.length) return false;
    players.forEach(entry => this._markDowned(entry.player));
    for (const downed of players.filter(entry => entry.player.downed)) {
      const player = downed.player;
      player.bleedout = Math.max(0, player.bleedout - dt);
      const rescuer = players.find(entry => {
        if (entry.id === downed.id || entry.player.downed) return false;
        const input = entry.local ? this.state.keys : entry.input?.keys;
        return !!input?.e && Math.hypot(player.x - entry.player.x, player.y - entry.player.y) < 48;
      });
      player.reviveProgress = rescuer ? player.reviveProgress + dt : 0;
      if (player.reviveProgress >= 3) {
        player.downed = false;
        player.health = 40;
        player.oxygen = 30;
        player.bleedout = 0;
        player.reviveProgress = 0;
      }
      if (player.bleedout <= 0) return true;
    }
    return players.length > 0 && players.every(entry => entry.player.downed);
  }

  _finishGuestCoop(message) {
    if (message.success) {
      this.state.money += Number(message.moneyShare) || 0;
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
  }

  _getThreatTarget(entity) {
    const candidates = this._onlineCoopPlayers();
    return candidates
      .filter((player) => !player.downed)
      .sort((a, b) => Math.hypot(entity.x - a.x, entity.y - a.y) - Math.hypot(entity.x - b.x, entity.y - b.y))[0]
      || this.player;
  }

  _sanitizeHunterSettings(savedSettings = null, fallbackSettings = Config.mapScales) {
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
        const fallback = fallbackSettings[scaleKey]?.[key] ?? defaults[key];
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
          ? Math.max(0, Math.min(100, Math.round(count)))
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
      spawnCount: Number.isFinite(count) ? Math.max(0, Math.min(100, Math.round(count))) : fallbackSettings.spawnCount,
      spawnInterval: Number.isFinite(interval) ? Math.max(1, Math.min(120, Math.round(interval))) : fallbackSettings.spawnInterval
    };
  }

  _getFinalTerminalSettings() {
    return this.state.finalTerminalSettings || this._finalTerminalSettings();
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
    const difficultyId = this.state.selectedDifficulty;
    this.ui.updateHunterSettings(
      this._getDifficultyProfile(difficultyId),
      this.state.running || this.state.coop.role === 'guest',
      this._difficultyProfileIsModified(difficultyId)
    );
  }

  updateDifficultyUI() {
    this.ui.updateDifficultyPreset(
      this.state.selectedDifficulty,
      this.state.running || this.state.coop.role === 'guest',
      this.getAmmoLossWarning(this.state.selectedDifficulty)
    );
  }

  getAmmoLossWarning(difficulty = this.state.selectedDifficulty) {
    if (difficulty === 'easy') return '失败时保留所有携带弹药；未装备武器与弹药库库存也不受影响。';
    if (difficulty === 'hard') return '失败时已装备武器的弹匣与备弹全部损失；未装备武器与弹药库不受影响。';
    return '失败时已装备武器的弹匣与备弹损失一半（向下取整）；未装备武器与弹药库不受影响。';
  }

  applyDifficultyPreset(difficultyId) {
    if (this.state.running || this.state.coop.role === 'guest') return;
    this._applyDifficultyProfile(difficultyId);
  }

  updateLoadoutUI() {
    this.ui.updateLoadout(this.player.armory, this.state.running || this.state.coop.running);
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

  purchaseWeapon(weaponId) {
    const weapon = Config.weapons[weaponId];
    if (!weapon || weaponId === 'pistol' || this.state.running || this.state.coop.running ||
        this.player.armory.ownedWeapons[weaponId]) return false;
    if (this.state.money < weapon.purchasePrice) {
      this.ui.showToast('资金不足，无法购买该武器');
      return false;
    }
    if (!this.player.unlockWeapon(weaponId)) return false;
    this.state.money -= weapon.purchasePrice;
    this.state.armory = this.player.armory;
    this._save();
    this.updateMoneyUI();
    this.updateLoadoutUI();
    this.updateAmmoDepotUI();
    this.ui.showToast(`${weapon.label} 已购入；请在装备栏选择要使用的槽位`);
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
    return true;
  }

  switchWeaponSlot(slot) {
    if (!this.state.running || this.state.tutorial?.paused || this.state.fullMapOpen || this.state.inventoryOpen ||
        this.state.coop.hostPaused || this.player.dodgeTimer > 0) return false;
    if (this.state.activeQte) return false;
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
    if (!this.state.running || this.state.tutorial?.paused || this.state.coop.hostPaused ||
        (actor === this.player && (this.state.fullMapOpen || this.state.inventoryOpen))) return false;
    if (actor.stunned > 0 || actor.downed || actor.dodgeTimer > 0) return false;
    const dx = directionX == null ? Number(!!this.state.keys.d) - Number(!!this.state.keys.a) : Number(directionX);
    const dy = directionY == null ? Number(!!this.state.keys.s) - Number(!!this.state.keys.w) : Number(directionY);
    if (!actor.startRoll(dx, dy)) return false;
    if (actor === this.player) {
      this.state.fireHeld = false;
      if (this.state.coop.running && this.state.coop.role === 'guest') {
        this.coopSession.sendEvent('action', { action: 'roll', dx, dy });
      }
    }
    return true;
  }

  melee(actor = this.player) {
    const localInteractionBlocked = actor === this.player &&
      (this.state.fullMapOpen || this.state.inventoryOpen || this.state.activeQte);
    const remoteEntry = this._remoteEntryForActor(actor);
    const remoteInteractionBlocked = !!remoteEntry?.qte;
    if (!this.state.running || this.state.tutorial?.paused || this.state.coop.hostPaused || localInteractionBlocked ||
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
    if (this.monster.active && Math.hypot(this.monster.x - actor.x, this.monster.y - actor.y) <= range) {
      const angle = Math.atan2(this.monster.y - actor.y, this.monster.x - actor.x);
      const hit = this.monster.registerHit();
      const distance = Config.player.meleeKnockback;
      this.monster.x = Math.max(38, Math.min(Config.WORLD_W - 38, this.monster.x + Math.cos(angle) * distance));
      this.monster.y = Math.max(38, Math.min(Config.WORLD_H - 38, this.monster.y + Math.sin(angle) * distance));
      this.monster.waypoints = [];
      this.monster.waypointTimer = 0;
      if (hit.triggeredRecovery) this.ui.showToast(`生命体被击倒 ${Config.monster.recoveryDuration}秒`);
      hitCount++;
    }

    this.hunters.forEach(hunter => {
      if (!hunter.active || hunter.dead || Math.hypot(hunter.x - actor.x, hunter.y - actor.y) > range) return;
      const angle = Math.atan2(hunter.y - actor.y, hunter.x - actor.x);
      const hit = hunter.registerHit();
      if (hit.hit) {
        if (!hit.dead) {
          const distance = Config.player.meleeKnockback;
          const nextX = hunter.x + Math.cos(angle) * distance;
          const nextY = hunter.y + Math.sin(angle) * distance;
          if (!this.map.blocked(nextX, hunter.y, hunter.radius)) hunter.x = nextX;
          if (!this.map.blocked(hunter.x, nextY, hunter.radius)) hunter.y = nextY;
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
      armory: this.player.exportArmory()
    });
  }

  purchaseAmmo(units = Config.ammo.unitsPerPurchase) {
    const amount = Math.floor(Number(units));
    const unitPrice = Config.ammo.pricePerPurchase / Config.ammo.unitsPerPurchase;
    if (!Number.isFinite(amount) || amount < Config.ammo.unitsPerPurchase) {
      this.ui.showToast(`弹药商店每次至少购买 ${Config.ammo.unitsPerPurchase} 单位`);
      return false;
    }
    if (this.state.running || this.state.coop.running) return false;
    if (this.state.money < amount * unitPrice) {
      this.ui.showToast('资金不足，无法购买弹药');
      return false;
    }
    this.state.money -= amount * unitPrice;
    this.player.armory.standardAmmoUnits += amount;
    this.state.armory = this.player.armory;
    this._save();
    this.updateMoneyUI();
    this.updateAmmoDepotUI();
    this.ui.showToast(`弹药库已补充 ${amount} 标准弹药单位`);
    return true;
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
    this.ui.showToast(transferred ? '弹药转换完成' : '库存不足，或转换数量无法组成完整弹药');
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
    const profile = this._getDifficultyProfile();
    if (!profile.maps[scaleKey] || !Object.hasOwn(profile.maps[scaleKey], key)) return;
    profile.maps[scaleKey][key] = value;
    this.state.difficultyProfiles[this.state.selectedDifficulty] =
      this._sanitizeDifficultyProfiles(this.state.difficultyProfiles)[this.state.selectedDifficulty];
    this._applyDifficultyProfile(this.state.selectedDifficulty);
  }

  updateFinalTerminalSetting(key, value) {
    if (this.state.running || this.state.coop.role === 'guest') return;
    if (!['finalTerminalSpawnCount', 'finalTerminalSpawnInterval'].includes(key)) return;
    const profile = this._getDifficultyProfile();
    profile[key] = value;
    this.state.difficultyProfiles[this.state.selectedDifficulty] =
      this._sanitizeDifficultyProfiles(this.state.difficultyProfiles)[this.state.selectedDifficulty];
    this._applyDifficultyProfile(this.state.selectedDifficulty, false);
  }

  resetHunterSettings() {
    if (this.state.running || this.state.coop.role === 'guest') return;
    const difficultyId = this.state.selectedDifficulty;
    this.state.difficultyProfiles[difficultyId] = this._sanitizeDifficultyProfiles()[difficultyId];
    this._applyDifficultyProfile(difficultyId);
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
    this.ui.showToast(`已出售选中物资，获得 ${this.ui.formatCreditText(total)}`);
    this.updateStorageUI();
    this.updateMoneyUI();
    this._save();
    return total;
  }

  _loadSave() {
    try {
      const raw = localStorage.getItem('voidshift_save');
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.money != null) this.state.money = data.money;
      if (Array.isArray(data.storageItems)) this.state.storageItems = data.storageItems;
      if (Array.isArray(data.storageOverflowItems)) this.state.storageOverflowItems = data.storageOverflowItems;
      this.state.storageCapacity = Math.max(Config.storage.capacityCells, Number(data.storageCapacityCells) || Config.storage.capacityCells);
      this._initializeStorage();
      this.state.difficultyProfiles = this._sanitizeDifficultyProfiles(data.difficultyProfiles);
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
    } catch (e) { /* ignore corrupt save */ }
  }

  _save() {
    try {
      localStorage.setItem('voidshift_save', JSON.stringify({
        armoryVersion: 1,
        armory: this.player.exportArmory(),
        money: this.state.money,
        storageItems: this.state.storageItems,
        storageOverflowItems: this.state.storageOverflowItems,
        storageCapacityCells: this.state.storageCapacity,
        difficultyProfiles: this.state.difficultyProfiles,
        difficultyPreset: this.state.selectedDifficulty,
        fpsCap: this.state.fpsCap
      }));
    } catch (e) { /* ignore quota errors */ }
  }

  /**
   * Resets all sub-modules and core telemetry state values
   */
  reset() {
    if (this.state.descentTimer) clearTimeout(this.state.descentTimer);
    Object.assign(this.state, {
      running: false,
      transitioning: false,
      descentTimer: null,
      pendingTutorialMode: false,
      settlement: null,
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
      finalTerminalPressure: false,
      tutorial: null,
      extractionCalled: false,
      extracted: false,
      activeQte: null,
      inventoryOpen: false,
      fullMapOpen: false,
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
    this.seenWeaponEffects?.clear?.();
    this.shotSequence = 0;
    this.state.keys = {};
    this.ui.hideDescentTransition();
    this.ui.hideTutorial();
    if (this.ui.setFullMapVisible) {
      this.ui.setFullMapVisible(false);
    }
    this.resetFullMapView();
    this._cancelItemDrag();
    this.state.inventory = [];
    this.state.remoteInventory = [];
    this._guestInventoryLayoutPending = false;
    this._guestInventoryLayoutPendingAt = 0;
    this._bindBackpackInventories();
    const inventoryOverlay = document.getElementById('inventoryOverlay');
    if (inventoryOverlay) inventoryOverlay.style.display = 'none';

    this.map.reset(Config.currentScale, this.state.coop.running ? this.state.coop.mapSeed : null);
    this.player.reset(this.map, this.state.armory,
      this.state.armory.loadout.primary ? 'primary' : 'sidearm');
    this.state.armory = this.player.armory;
    this.monster.reset(this.map);
    this.hunters = this._createHunters();
    this.hunters.forEach(h => h.reset(this.map));
    this.nextHunterSpawnIndex = this.hunters.length;

    this.ui.updateResetState();
    this.ui.updateScaleButtons(Config.currentScale);
    this.updateDifficultyUI();
    this.updateHunterSettingsUI();
    this.updateLoadoutUI();
    this.ui.updateFpsCap(this.state.fpsCap);
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
    this.ui.update(compositeState, this.player, this.monster);
    this.render();
  }

  /**
   * Sets facility map scale (small, medium, large) and regenerates procedural layout
   */
  setMapScale(scaleKey) {
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
    this.map.reset(scaleKey);
    this.resetFullMapView();
    this.player.reset(this.map, this.state.armory,
      this.state.armory.loadout.primary ? 'primary' : 'sidearm');
    this.state.armory = this.player.armory;
    this.monster.reset(this.map);
    this.hunters = this._createHunters();
    this.hunters.forEach(h => h.reset(this.map));
    this.nextHunterSpawnIndex = this.hunters.length;
    this.ui.updateTerminalsStatus(this.map.terminals, true);
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
    const wasOpen = this.state.fullMapOpen;
    const newState = forceState !== null ? !!forceState : !this.state.fullMapOpen;
    this.state.fullMapOpen = newState;
    if (newState !== wasOpen) this._tutorialAction(newState ? 'map-open' : 'map-close');
    if (!newState) {
      this.state.fullMapDragging = false;
      if (this.ui.fullMapCanvas) this.ui.fullMapCanvas.classList.remove('dragging');
    }
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
    if (this.state.fullMapOpen) this.renderer.drawFullMap(this.player, this.map, this.state);
  }

  resetFullMapView() {
    this.state.fullMapZoom = 1;
    this.state.fullMapPanX = 0;
    this.state.fullMapPanY = 0;
    this.state.fullMapDragging = false;
    if (this.ui.fullMapCanvas) this.ui.fullMapCanvas.classList.remove('dragging');
    if (this.state.fullMapOpen) this.renderer.drawFullMap(this.player, this.map, this.state);
  }

  /**
   * Commences exploration run under standard recovery protocols
   */
  start(tutorialMode = false) {
    if (this.state.running || this.state.transitioning) return;
    if (this.state.coop.role && !this.state.coop.running) {
      this.ui.showToast('请在 CO-OP 大厅准备后由房主开始任务');
      return;
    }
    if (this.state.completed) this.reset();

    this.state.pendingTutorialMode = !!tutorialMode;
    this.state.transitioning = true;
    this.state.keys = {};
    this.state.fireHeld = false;
    this.audio.ensureAudio();
    this.audio.preloadSound?.('resources/gun-shot-359196.mp3');
    this.ui.showDescentTransition();
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
      this.skipDescentTransition();
    } else {
      this.state.descentTimer = setTimeout(() => this.skipDescentTransition(), 1200);
    }
  }

  skipDescentTransition() {
    if (!this.state.transitioning) return false;
    if (this.state.descentTimer) clearTimeout(this.state.descentTimer);
    this.state.descentTimer = null;
    this.state.transitioning = false;
    this.state.keys = {};
    this.ui.hideDescentTransition();
    const tutorialMode = this.state.pendingTutorialMode;
    this.state.pendingTutorialMode = false;
    this._beginDive(tutorialMode);
    return true;
  }

  _beginDive(tutorialMode = false) {
    this.state.tutorial = tutorialMode
      ? { active: true, paused: true, step: 0, progress: {}, steps: this._tutorialStepsForPlayer() }
      : null;
    if (this.audio.beginMissionAudio) this.audio.beginMissionAudio();
    else this.audio.ensureAudio();

    this.state.completed = false; 
    this.state.running = true; 
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
    if (this.state.tutorial && !this.state.armory.loadout.primary) {
      const firstStep = { ...this.state.tutorial.steps[0] };
      firstStep.body += ' 当前只有手枪：按 2 使用副武器；购买并装备主武器后，按 1/2 切换，本次会跳过切枪实练。';
      this.ui.showTutorialCard(firstStep, 0, this.state.tutorial.steps.length);
    }
    requestAnimationFrame((now) => this.loop(now));
  }

  /**
   * Fires the extraction signal beacon (Requires all QTE security consoles overridden)
   */
  callExtraction() {
    if (!this.state.running || this.state.extractionCalled || this.state.tutorial?.paused || this.state.coop.hostPaused || this.player.dodgeTimer > 0) return;

    // Check if all QTE security override consoles are solved
    const totalTerminals = this.map.terminals ? this.map.terminals.length : 3;
    const solvedCount = this.map.terminals ? this.map.terminals.filter(t => t.solved).length : totalTerminals;
    if (solvedCount < totalTerminals) {
      this.ui.showToast('撤离舱锁定中！请先激活全部终端。');
      this.ui.log('撤离系统离线：需激活全部终端才能启动撤离。');
      this.audio.playTone(140, 0.12, 0.1, 'sawtooth');
      return;
    }

    this.state.extractionCalled = true;
    this._tutorialAction('extraction');
    this.ui.updateExtractionCalledState();

    this.audio.playTone(720, 0.18, 0.11, 'square');
    if (this.audio.playToneAfterDelay) this.audio.playToneAfterDelay(540, 180, 0.25, 0.09, 'square');

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

  _spawnNewHunters(count) {
    const spawnCount = Math.max(0, Math.floor(count));
    const settings = this._getHunterSettings();
    for (let i = 0; i < spawnCount; i++) {
      const hunter = new Hunter(this.nextHunterSpawnIndex++, settings.hunterMaxHp);
      hunter.reset(this.map, settings.hunterMaxHp);
      this.hunters.push(hunter);
      this.activateHunter(hunter, '最终协议增援已抵达。');
    }
    return spawnCount;
  }

  activateHunter(hunter, reason) {
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
    const reviveLimit = Math.max(0, Math.floor(count));
    if (reviveLimit === 0) return 0;

    const settings = this._getHunterSettings();
    const deadIndices = this.hunters
      .map((hunter, index) => ({ hunter, index }))
      .filter(({ hunter }) => hunter.dead && !hunter.revivePending)
      .map(({ index }) => index);
    const toRevive = Math.min(reviveLimit, deadIndices.length);
    for (let i = 0; i < toRevive; i++) {
      const pick = Math.floor(Math.random() * deadIndices.length);
      const index = deadIndices.splice(pick, 1)[0];
      const previousHunter = this.hunters[index];
      const hunter = new Hunter(previousHunter.spawnIndex, settings.hunterMaxHp);
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
    this._lockFinalTerminalNoise();

    const settings = this._getFinalTerminalSettings();
    const authoritative = this.state.coop.role !== 'guest';
    if (authoritative) this._spawnNewHunters(settings.spawnCount);
    this.state.hunterSpawnTimer = settings.spawnInterval;

    this.ui.showToast('撤离舱已解锁：噪音锁定 100 / 无限猎手增援');
    this.ui.log(`警报：全员噪音锁定 100，立即增援 ${settings.spawnCount} 只猎手；之后每 ${settings.spawnInterval} 秒持续增援。`);
    return true;
  }

  /**
   * Concludes the exploration run with a final report status
   */
  buildSettlementSummary(success) {
    return {
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

  finish(success) {
    if (this.state.completed && !this.state.running) return;
    const settlement = this.buildSettlementSummary(success);
    const coopHostFinishing = this.state.coop.running && this.state.coop.role === 'host';
    const roster = this._coopRosterEntries();
    if (!this.state.armorySettledByHost) {
      roster.forEach(entry => this._settlePlayerAmmo(entry.player, success));
    }
    this.state.armorySettledByHost = false;
    this.state.armory = this.player.armory;
    const recoveredValue = roster.flatMap(entry => entry.inventory || [])
      .reduce((total, item) => total + (Number(item.value) || 0), 0);
    const moneyShare = success ? Math.floor(recoveredValue / Math.max(1, roster.length)) : 0;
    if (coopHostFinishing) {
      for (const entry of roster.filter(item => !item.local)) {
        const member = this.state.coop.members.find(item => item.id === entry.id);
        if (member) member.armory = entry.player.exportArmory();
        const finishMessage = {
          success,
          moneyShare,
          items: success ? entry.inventory : [],
          playerArmory: entry.player.exportArmory()
        };
        if (entry.online !== false) this.coopSession.sendEvent('finish', finishMessage, entry.id);
        else this.pendingCoopFinishes.set(entry.id, finishMessage);
      }
      this.coopSession.setRoomStatus('lobby');
      this.state.coop.running = false;
      if (success) this.state.money += moneyShare;
    }
    this.state.coop.hostPaused = false;
    this.ui.setCoopPaused?.(false);
    if (this.state.coop.role) {
      this.state.coop.status = success ? 'MISSION COMPLETE // 全员撤离成功' : 'MISSION FAILED // 任务中止';
    }
    this.state.running = false; 
    this.state.tutorial = null;
    this.state.completed = true; 
    this.state.fireHeld = false;
    this.state.keys = {};
    this.state.inventoryOpen = false;
    this.state.fullMapOpen = false;
    const inventoryOverlay = document.getElementById('inventoryOverlay');
    if (inventoryOverlay) inventoryOverlay.style.display = 'none';
    document.body.classList.remove("in-dive");
    this.handleResize();
    
    this.state.extracted = success;
    this.state.activeQte = null;
    this.ui.hideTutorial();
    this.ui.hideQTE();
    if (this.ui.setFullMapVisible) this.ui.setFullMapVisible(false);
    this.state.bulletTraces.length = 0;
    this.state.impactParticles.length = 0;
    this.state.muzzleFlashTimer = 0;
    this.state.muzzleFlashes.length = 0;
    this.monster.active = false;
    this.monster.alerted = false;
    this.hunters.forEach(hunter => {
      Object.assign(hunter, {
        active: false,
        dead: false,
        deathFade: 0,
        revivePending: false,
        reviveTimer: 0,
        waypoints: []
      });
    });
    this.remotePlayers?.clear?.();
    this.remoteQtes?.clear?.();
    this._syncLegacyRemoteAliases();
    if (this.audio.stopMissionAudio) this.audio.stopMissionAudio();

    if (success) {
      // Add inventory to storage
      this._storeRecoveredItems(this.state.inventory);
      this.state.inventory = [];
    }
    this.state.remoteInventory = [];
    if (!success) this.state.inventory = [];
    this._bindBackpackInventories();
    this.updateStorageUI();
    this._save();

    this.state.settlement = settlement;
    this.ui.updateFinishState(success, settlement);
    this.ui.updateTerminalsStatus(this.map.terminals, true);
    this.updateDifficultyUI();
    this.updateHunterSettingsUI();
    this.updateLoadoutUI();
    this.updateCoopUI();
    this.updateTutorialAvailability();
    
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
    player.health = Math.max(0, player.health - healthLoss);
    player.oxygen = Math.max(0, player.oxygen - oxygenLoss);
    if (stunDuration > 0) player.stunned = Math.max(player.stunned, stunDuration);
    return { blocked: false };
  }

  /**
   * Performs an interact trace near the explorer
   */
  interact(actor = this.player) {
    if (!this.state.running || this.state.tutorial?.paused || this.state.coop.hostPaused || actor.dodgeTimer > 0) return;
    const remoteEntry = this._remoteEntryForActor(actor);
    if ((actor === this.player && this.state.activeQte) || remoteEntry?.qte) return;
    if (actor.stunned > 0 || actor.downed) {
      this.ui.showToast('身体麻痹硬直中，无法交互！');
      return;
    }
    if (this.state.coop.running && this._coopRosterEntries().some(entry =>
      entry.player !== actor && entry.online !== false && entry.player.downed &&
      Math.hypot(entry.player.x - actor.x, entry.player.y - actor.y) < 48)) return;

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
      if (actor === this.player && !wasTargetOpen && res.open) this._tutorialAction('door');
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
        if (actor === this.player) this.startQTE(term);
        else this._startRemoteQte(term, remoteEntry?.id);
        return;
      }
    }

    // Check extraction beacon interaction (in Start Airlock or Exit Evac Pod)
    const distAirlock = Math.hypot(this.map.extractionPoint.x - actor.x, this.map.extractionPoint.y - actor.y);
    const distEvac = this.map.exitExtractionPoint ? Math.hypot(this.map.exitExtractionPoint.x - actor.x, this.map.exitExtractionPoint.y - actor.y) : Infinity;
    if (distAirlock < 55 || distEvac < 55) {
      const totalTerminals = this.map.terminals ? this.map.terminals.length : 3;
      const solvedCount = this.map.terminals ? this.map.terminals.filter(t => t.solved).length : totalTerminals;
      if (distEvac < 55 && solvedCount < totalTerminals) {
        this.ui.showToast('撤离舱锁定中！请先激活全部终端。');
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
   * Scavenges nearby valid waste scrap
   */
  collect(actor = this.player) {
    if (!this.state.running || this.state.tutorial?.paused) return;

    const item = this.map.scrap.find(s => !s.found && Math.hypot(s.x - actor.x, s.y - actor.y) < 30);
    if (!item) {
      this.ui.showToast('附近没有可回收物');
      return;
    }

    const backpack = this._backpackFor(actor);
    if (!backpack.place(item)) {
      this.ui.showToast('背包空间不足！物资仍留在地面');
      return;
    }

    item.found = true;
    this.state.loot += 1;
    this.state.lootValue += Number(item.value) || 0;
    actor.noise = Math.min(100, actor.noise + 20);

    const size = backpack.sizeFor(item);
    this.ui.log(`拾取：${item.name || '废料'} (占地 ${size.w}×${size.h} 格)。`);
    this.ui.showToast(`拾取 ${item.name || '物品'} [${size.w}×${size.h}]`);
    if (actor === this.player) this._tutorialAction('pickup');
    if (actor === this.player) this.updateInventoryUI();
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
    const entry = this.remotePlayers?.get(memberId) || [...(this.remotePlayers?.values?.() || [])][0];
    const backpack = entry?.backpack || this.remoteBackpack;
    const item = backpack.getItem(message.id);
    if (!item) return false;
    backpack.removeItem(item);
    const floorItem = this.map.scrap.find(scrap => scrap.id === item.id);
    if (floorItem) {
      floorItem.found = false;
      const player = entry?.player || this.remotePlayer;
      floorItem.x = Number.isFinite(player?.x) ? player.x : floorItem.x;
      floorItem.y = Number.isFinite(player?.y) ? player.y : floorItem.y;
    }
    this.state.loot = Math.max(0, this.state.loot - 1);
    this.state.lootValue = Math.max(0, this.state.lootValue - (Number(item.value) || 0));
    this._syncLegacyRemoteAliases();
    return true;
  }

  _sellGuestInventoryItems(ids, memberId = null) {
    const entry = this.remotePlayers?.get(memberId) || [...(this.remotePlayers?.values?.() || [])][0];
    const backpack = entry?.backpack || this.remoteBackpack;
    const sendResult = (accepted, amount = 0) => {
      if (memberId == null) this.coopSession.sendEvent('inventory-sale-result', { accepted, amount });
      else this.coopSession.sendEvent('inventory-sale-result', { accepted, amount }, memberId);
      return accepted ? amount : false;
    };
    if (!Array.isArray(ids) || !ids.length) return sendResult(false);
    const items = ids.map(id => backpack.getItem(id));
    if (items.some(item => !item) || new Set(ids.map(String)).size !== ids.length) return sendResult(false);
    const total = items.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
    items.forEach(item => backpack.removeItem(item));
    this._syncLegacyRemoteAliases();
    this.state.loot = Math.max(0, this.state.loot - items.length);
    this.state.lootValue = Math.max(0, this.state.lootValue - total);
    return sendResult(true, total);
  }

  sellInventory() {
    const backpack = this._backpackFor(this.player);
    if (!backpack.items.length) {
      this.ui.showToast('背包里没有可出售的物资');
      return;
    }
    const total = backpack.totalValue();
    const count = backpack.items.length;
    const soldIds = backpack.items.map(item => item.id);
    const guestSale = this.state.coop.running && this.state.coop.role === 'guest';
    backpack.clear();
    this.state.loot = Math.max(0, this.state.loot - count);
    this.state.lootValue = Math.max(0, this.state.lootValue - total);
    this.selectedItemId = null;
    if (guestSale) {
      this.ui.showToast('出售请求已发送，等待房主确认');
    } else {
      this.state.money += total;
      this.ui.showToast(`已出售 ${count} 件物资，获得 ${this.ui.formatCreditText(total)}`);
    }
    this.ui.log(guestSale
      ? `交易申请：已提交出售 ${count} 件物资，等待房主确认。`
      : `交易完成：出售 ${count} 件物资，进账 ${this.ui.formatCreditText(total)}。`);
    this.updateInventoryUI();
    if (guestSale) {
      this._syncGuestInventoryLayout('inventory-sell', { items: soldIds });
    } else {
      this.updateMoneyUI();
      this._save();
    }
  }

  sellStorage() {
    const items = [...this.state.storageItems, ...this.state.storageOverflowItems];
    if (items.length === 0) {
      this.ui.showToast('仓库空空如也，没有可出售的物资！');
      return;
    }
    const totalValue = items.reduce((total, item) => total + (Number(item.value) || 50), 0);
    this.storageBackpack.clear();
    this.state.storageItems = this.storageBackpack.items;
    this.state.storageOverflowItems = [];
    this.selectedStorageIds.clear();
    this.state.money += totalValue;
    this.ui.showToast(`成功出售仓库所有物资，获得 ${this.ui.formatCreditText(totalValue)}`);
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
  }

  updateInventoryUI() {
    const grid = document.getElementById('inventoryGrid');
    if (!grid) return;
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
    this._updateBackpackReadout();
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
      block.addEventListener('pointerdown', event => gridId === 'storageGrid'
        ? this._beginStorageItemDrag(event, item, tile)
        : this._beginItemDrag(event, item));
      block.addEventListener('contextmenu', event => {
        event.preventDefault();
        if (gridId === 'storageGrid') this.rotateStorageItem(item.id);
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
        block.append(name, value);
      }
      tile.appendChild(block);
    }));
  }

  _updateBackpackReadout() {
    const selected = this.backpack.getItem(this.selectedItemId);
    const description = document.getElementById('itemDesc');
    const rotate = document.getElementById('rotateItemBtn');
    const discard = document.getElementById('discardItemBtn');
    if (rotate) rotate.disabled = !selected;
    if (discard) discard.disabled = !selected;
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
    overlay.style.display = open ? 'block' : 'none';
    this.state.inventoryOpen = open;
    if (open) {
      this.state.fireHeld = false;
      this.state.keys = {};
      this.updateInventoryUI();
      this.ui.log('打开背包网格 [拖拽摆放 / 右键或 R 旋转 / B 关闭]');
    } else {
      this._cancelItemDrag();
      this.selectedItemId = null;
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
    this.updateInventoryUI();
    this._syncGuestInventoryLayout();
    return true;
  }

  discardItem(itemId = null) {
    const item = this.backpack.removeItem(itemId == null ? this.selectedItemId : itemId);
    if (!item) return false;
    item.found = false;
    item.x = this.player.x + (Math.random() - 0.5) * 24;
    item.y = this.player.y + (Math.random() - 0.5) * 24;
    const floorItem = this.map.scrap.find(scrap => scrap.id === item.id);
    if (floorItem) Object.assign(floorItem, { found: false, x: item.x, y: item.y });
    this.state.loot = Math.max(0, this.state.loot - 1);
    this.state.lootValue = Math.max(0, this.state.lootValue - (Number(item.value) || 0));
    this.selectedItemId = null;
    this.ui.log(`丢弃：${item.name || '物资'} 已放回地面。`);
    this.ui.showToast(`已丢弃 ${item.name || '物资'}`);
    this.updateInventoryUI();
    if (this.state.coop.running && this.state.coop.role === 'guest') {
      this._syncGuestInventoryLayout('inventory-discard', { id: item.id });
    }
    return true;
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
    const matrix = drag.manager.matrixFor(drag.item, drag.rot);
    drag.valid = drag.manager.canPlace(matrix, drag.gx, drag.gy, drag.item.id);
    this._renderTileBlocks(drag.tile, drag.item, matrix, drag.manager, drag.gridId);
    this._placeItemElement(drag.tile, drag.gx, drag.gy, matrix, drag.manager);
    drag.tile.classList.toggle('invalid', !drag.valid);
    return true;
  }

  _handleItemDragEnd() {
    const drag = this._itemDrag;
    if (drag && drag.moved) {
      drag.gx = Math.floor((drag.pointerX - drag.metrics.left) / drag.metrics.stepX) - drag.grabX;
      drag.gy = Math.floor((drag.pointerY - drag.metrics.top) / drag.metrics.stepY) - drag.grabY;
      drag.valid = drag.manager.canPlace(drag.manager.matrixFor(drag.item, drag.rot), drag.gx, drag.gy, drag.item.id);
    }
    this._itemDrag = null;
    window.removeEventListener('pointermove', this._boundItemDragMove);
    window.removeEventListener('pointerup', this._boundItemDragEnd);
    window.removeEventListener('pointercancel', this._boundItemDragEnd);
    if (!drag || !drag.moved) {
      if (drag?.kind === 'storage') this.toggleStorageItemSelection(drag.item.id);
      else if (drag) this.updateInventoryUI();
      return;
    }
    if (!drag.valid || !drag.manager.moveItem(drag.item, drag.gx, drag.gy, drag.rot)) {
      this.ui.showToast('无法放置：越界或与其他物资重叠');
    }
    if (drag.kind === 'storage') {
      this._fillStorageOverflow();
      this.updateStorageUI();
      this._save();
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
        ...(this.monster.active ? [this.monster] : []),
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
          : entity === this.monster ? !entity.active : (!entity.active || entity.dead)) continue;
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

  _applyProjectileHit(target, shooter, angle) {
    if (this._isCoopPlayer(target)) {
      if (!this.state?.coop?.running || !this.state.coop.friendlyFire || target === shooter || target.downed) {
        return { hit: false, blocked: true };
      }
      const damage = this._applyDamage(target, shooter.weapon?.damage || 1);
      if (!damage.blocked && target === this.player) this.ui.triggerDamageFlash(0.35, 100);
      return { hit: !damage.blocked, ...damage };
    }

    if (target === this.monster) {
      const hit = target.registerHit();
      const pushDistance = hit.triggeredRecovery ? 240 : 50;
      const angleAway = Math.atan2(target.y - shooter.y, target.x - shooter.x);
      target.x = Math.max(38, Math.min(Config.WORLD_W - 38, target.x + Math.cos(angleAway) * pushDistance));
      target.y = Math.max(38, Math.min(Config.WORLD_H - 38, target.y + Math.sin(angleAway) * pushDistance));
      target.waypoints = [];
      target.waypointTimer = 0;
      this.ui.triggerDamageFlash(0.18, 80);
      if (hit.triggeredRecovery) {
        this.ui.showToast(`【重创】生命体休眠瘫痪 ${Config.monster.recoveryDuration}秒！`);
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

    const hit = target.registerHit();
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
  shoot(shooter = this.player, confirmedShotId = null) {
    if (!this.state.running || this.state.tutorial?.paused || this.state.coop.hostPaused || shooter.dodgeTimer > 0) return;
    if (shooter.stunned > 0 || shooter.downed) {
      this.ui.showToast('休克硬直中，无法射击！');
      return;
    }
    if (this.state.coop.running && this.state.coop.role === 'guest' && shooter === this.player) {
      const result = shooter.shoot(this.state.stabilized, this.map, this.audio, this.monster);
      if (result.fired) {
        const shotId = this._createWeaponShotId(shooter);
        this._addMuzzleFlash(shooter, shotId);
        this._tutorialAction('fire');
        this.coopSession.sendEvent('action', { action: 'shoot', aim: shooter.angle, shotId });
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
    const result = shooter.shoot(shooter === this.player && this.state.stabilized, this.map, shooterAudio, this.monster);
    if (result.fired) {
      const shotId = confirmedShotId || this._createWeaponShotId(shooter);
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
        this._applyProjectileHit(target, shooter, angle);
      });
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
  update(dt) {
    if (!this.state.running) return;
    if (this.state.coop.running && this.state.coop.role === 'guest' && !this.state.coop.connected) {
      this._checkCoopDisconnect();
      return;
    }
    if (this.state.coop.running && this.state.coop.hostPaused) {
      this._checkCoopDisconnect();
      return;
    }
    const isGuest = this.state.coop.running && this.state.coop.role === 'guest';
    const activePlayers = isGuest ? [] : this._onlineCoopPlayers();
    const blockingActors = isGuest ? [] : [
      ...(this.monster && this.monster.active ? [this.monster] : []),
      ...this.hunters.filter(hunter => hunter.active && !hunter.dead)
    ];
    const doorEvents = this.map.advanceDoorAnimations
      ? this.map.advanceDoorAnimations(dt, activePlayers, blockingActors, !isGuest)
      : [];
    if (!isGuest && doorEvents.some(event => event.blocked)) this.ui.showToast('门口有人，关门已取消');
    if (this.state.tutorial?.paused) return;
    this._advanceMuzzleFlashes(dt);
    if (this.state.coop.running && this.state.coop.role === 'guest') {
      this._updateGuestCoop(dt);
      return;
    }
    this.state.elapsed += dt;

    // Decrement QTE monster teleport cooldown timer (15s cooldown)
    if (this.state.qteMonsterTpCooldown > 0) {
      this.state.qteMonsterTpCooldown = Math.max(0, this.state.qteMonsterTpCooldown - dt);
    }

    // 1. Update Player position & status timers (freeze input movement during active QTE, Full Map, or Stun)
    const inputKeys = (this.state.activeQte || this.state.fullMapOpen || this.player.stunned > 0) ? {} : this.state.keys;
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
    if (this.state.tutorial?.paused) return;
    this._updateRemotePlayers(dt);
    this._lockFinalTerminalNoise();
    this._checkCoopDisconnect();
    if (!this.state.running) return;
    if (playerResult && playerResult.stunRecovered) {
      this.ui.showToast('电击硬直解除，身体恢复行动');
      this.ui.log('恢复：高压电击麻痹硬直结束，行动能力恢复。');
    }

    if (this.state.activeQte || this.state.fullMapOpen || this.state.inventoryOpen || this.player.stunned > 0 || this.player.dodgeTimer > 0) {
      this.state.fireHeld = false;
    } else if (this.state.fireHeld && this.player.weapon.automatic && this.player.ammo > 0 && this.player.reloading <= 0) {
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
      this.ui.showToast(`探索新区域: ${currentRoom.title}`);
      this.ui.log(`雷达已探明新区域：${currentRoom.title} (${currentRoom.label})。`);
    }

    // 2. Subtract survival oxygen supplies
    this.player.oxygen -= dt * (this.state.extractionCalled ? 0.8 : 0.18);
    for (const entry of this._coopRosterEntries()) {
      if (entry.id !== this.state.coop.playerId && entry.online === false) continue;
      if (entry.player !== this.player && entry.player.downed) continue;
      entry.player.oxygen -= dt * (this.state.extractionCalled ? 0.8 : 0.18);
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
    const loudestNoise = Math.max(...this._onlineCoopPlayers().map(player => player.noise), 0);
    if ((!this.monster.active && this.state.elapsed > 7) ||
        (!this.monster.alerted && (loudestNoise > Config.monster.triggerNoiseThreshold || this.state.loot >= 2))) {
      this.activateMonster(loudestNoise > Config.monster.triggerNoiseThreshold ? '脚步声在走廊里回响。' : '墙后传来沉重的呼吸声。');
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
    if (this.state.huntersInitialized) {
      this.state.hunterSpawnTimer -= dt;
      if (this.state.hunterSpawnTimer <= 0) {
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

    // 6. Drive monster pathfinding & AI updates
    const allEntities = new EntitySpatialGrid(64);
    const activeRemotePlayers = [...this.remotePlayers.values()].filter(entry => entry.online !== false).map(entry => entry.player);
    allEntities.rebuild([this.monster, ...this.hunters, ...activeRemotePlayers]);
    const monsterTarget = this._getThreatTarget(this.monster);
    const monsterResult = this.monster.update(dt, monsterTarget, monsterTarget.noise, this.map, this.audio, allEntities);
    allEntities.reindex(this.monster);
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

      if (monsterResult.recovered) {
        this.ui.threatStatusText.textContent = '已苏醒';
        this.ui.threatStatusText.className = 'warning';
        this.ui.showToast('【警告】生命体休眠结束！已恢复行动！');
        this.ui.log('警报：生命体休眠恢复期结束，重新开始行动！');
      }
    }

    // 6b. Drive Hunter AI (all active hunters)
    const lightSources = this._onlineCoopPlayers().filter(player => !player.downed);
    this.hunters.forEach(h => {
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
        lightSources
      );
      allEntities.reindex(h);
      if (!hunterResult) return;

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

    // 7. Update synthesized ambient acoustics (breathing audio removed per user specification)
    this.audio.update(this.player, this.monster, this.map, this.hunters);

    // 8. Resolve retrieval extraction boundaries (Requires all 3 security override consoles passed)
    if (this.state.extractionCalled) {
      const d1 = Math.hypot(this.player.x - this.map.extractionPoint.x, this.player.y - this.map.extractionPoint.y);
      const d2 = this.map.exitExtractionPoint ? Math.hypot(this.player.x - this.map.exitExtractionPoint.x, this.player.y - this.map.exitExtractionPoint.y) : Infinity;
      const totalCount = this.map.terminals ? this.map.terminals.length : 3;
      const solvedCount = this.map.terminals ? this.map.terminals.filter(t => t.solved).length : totalCount;
      const allPlayersAtExtraction = this._coopRosterEntries().every(entry => {
        if (entry.online === false) return false;
        const player = entry.player;
        if (player.downed) return false;
        return Math.min(
          Math.hypot(player.x - this.map.extractionPoint.x, player.y - this.map.extractionPoint.y),
          this.map.exitExtractionPoint ? Math.hypot(player.x - this.map.exitExtractionPoint.x, player.y - this.map.exitExtractionPoint.y) : Infinity
        ) < 48;
      });
      if ((d1 < 48 || d2 < 48) && allPlayersAtExtraction && solvedCount >= totalCount) {
        this._tutorialAction('returned');
        this.finish(true);
        return;
      }
    }

    // 9. Fail checks
    if (this.state.coop.running && this.state.coop.role === 'host') {
      if (this._updateCoopRevive(dt)) {
        this.finish(false);
        return;
      }
    } else if (this.player.health <= 0 || this.player.oxygen <= 0) {
      this.finish(false);
      return;
    }

    if (this.state.coop.running && this.state.coop.role === 'host') {
      this._coopSendTimer -= dt;
      if (this._coopSendTimer <= 0) {
        this._coopSendTimer = 0.05;
        this.coopSession.sendState('snapshot', this._createCoopSnapshot());
      }
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
        grid.appendChild(cell);
      }
    }
    storage.items.forEach(item => {
      const matrix = storage.matrixFor(item);
      const tile = document.createElement('div');
      tile.className = `bp-item storage-item rarity-${item.rarity || 'common'}${this.selectedStorageIds.has(String(item.id)) ? ' selected' : ''}`;
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
  }

  /**
   * Triggers visual draws across all screens
   */
  render() {
    this.renderer.prepareCamera(this.player, this.state);
    const remotePlayers = [...this.remotePlayers.values()].map(entry => ({
      id: entry.id, slot: entry.slot, player: entry.player, online: entry.online !== false
    }));
    this.renderer.draw(this.player, this.monster, this.map, this.state, this.hunters, remotePlayers);
    this.renderer.drawWorldOverlay(this.player, this.map, this.state);
    this.renderer.drawCenteredVision(this.player, this.map, this.state);
    if (this.state.fullMapOpen) {
      this.renderer.drawFullMap(this.player, this.map, this.state);
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
      if (this.state.transitioning) {
        if (e.code === 'Space') {
          e.preventDefault();
          this.skipDescentTransition();
        }
        return;
      }
      if (key === 'escape' && this.ui.isHunterAdjustmentOpen()) {
        this.ui.closeHunterAdjustment();
        e.preventDefault();
        return;
      }
      if (this.state.tutorial?.paused) {
        if (e.target && e.target.closest && e.target.closest('#tutorialOverlay button')) return;
        e.preventDefault();
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
      if (key === 'r' && !this.state.running && this.selectedStorageIds.size === 1 &&
          document.getElementById('storageContent')?.style.display !== 'none') {
        e.preventDefault();
        this._rotateSelectedStorageItem();
        return;
      }

      if (key === 'f') {
        this.player.flashlight = !this.player.flashlight;
        this._tutorialAction('flashlight');
      }
      if (key === 'e') {
        if (this.state.coop.running && this.state.coop.role === 'guest') this.coopSession.sendEvent('action', { action: 'interact' });
        else this.interact();
      }
      if (key === 'r') {
        if (this.player.dodgeTimer > 0) return;
        if (this.state.coop.running && this.state.coop.role === 'guest') this.coopSession.sendEvent('action', { action: 'reload' });
        else this.player.reload(this.audio);
      }
      if (key === 'x') {
        if (this.state.coop.running && this.state.coop.role === 'guest') this.coopSession.sendEvent('action', { action: 'extract' });
        else this.callExtraction();
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
    window.addEventListener('blur', () => {
      this.state.fireHeld = false;
      this.state.keys = {};
      this._handleCoopFocusChange();
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
        this.start();
      }
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
    Object.entries(this.ui.difficultyButtons).forEach(([difficultyId, button]) => {
      if (button) button.addEventListener('click', () => this.applyDifficultyPreset(difficultyId));
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
    if (this.ui.descentTransition) {
      this.ui.descentTransition.addEventListener('click', () => this.skipDescentTransition());
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
        this.state.fullMapPanX += e.clientX - this.state.fullMapDragX;
        this.state.fullMapPanY += e.clientY - this.state.fullMapDragY;
        this.state.fullMapDragX = e.clientX;
        this.state.fullMapDragY = e.clientY;
        this.renderer.drawFullMap(this.player, this.map, this.state);
      });
      const endMapDrag = () => {
        this.state.fullMapDragging = false;
        mapCanvas.classList.remove('dragging');
      };
      mapCanvas.addEventListener('pointerup', endMapDrag);
      mapCanvas.addEventListener('pointercancel', endMapDrag);
      mapCanvas.addEventListener('lostpointercapture', endMapDrag);
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
      map: 'mapContent',
      storage: 'storageContent',
      loadout: 'loadoutContent',
      ammo: 'ammoContent',
      coop: 'coopContent',
      tutorial: 'tutorialContent'
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

