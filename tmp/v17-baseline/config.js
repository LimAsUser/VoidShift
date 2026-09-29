/**
 * VOID SHIFT // RECOVERY OPERATIONS PROTOCOL
 * System Constants & Map Configuration
 */

const Config = {
  VIEW_W: 900,
  VIEW_H: 602,
  
  // Grid-based procedural world size defaults
  GRID_COLS: 4,
  GRID_ROWS: 3,
  ROOM_W: 520,
  ROOM_H: 420,
  WALL_THICK: 18,
  DOOR_SIZE: 128,

  // Functional compartments only; transit corridors are generated separately.
  mapScales: {
    small: { id: 'small', label: '小型 (16 舱)', cols: 4, rows: 4, roomCount: 16, quota: 420, terminals: 3, hunters: 8, hunterSpawnInterval: 30, hunterRespawnCount: 2, hunterMaxHp: 2 },
    medium: { id: 'medium', label: '中型 (26 舱)', cols: 7, rows: 4, roomCount: 26, quota: 780, terminals: 4, hunters: 12, hunterSpawnInterval: 30, hunterRespawnCount: 4, hunterMaxHp: 2 },
    large: { id: 'large', label: '大型 (36 舱)', cols: 9, rows: 4, roomCount: 36, quota: 1200, terminals: 5, hunters: 16, hunterSpawnInterval: 30, hunterRespawnCount: 6, hunterMaxHp: 2 }
  },
  currentScale: 'small',

  activeBackpack: 'field',
  backpackTypes: {
    field: { id: 'field', label: '物资背包', cols: 8, rows: 5, cellSize: 34, gap: 4 },
    light: { id: 'light', label: '轻型携行包', cols: 6, rows: 4, cellSize: 34, gap: 4 },
    heavy: { id: 'heavy', label: '重型货运包', cols: 9, rows: 6, cellSize: 30, gap: 3 }
  },
  storage: { id: 'storage', label: '船舱仓库', cols: 10, rows: 10, capacityCells: 100, cellSize: 26, gap: 2 },
  get backpack() {
    return this.backpackTypes[this.activeBackpack] || this.backpackTypes.field;
  },
  itemShapes: {
    '1x1': [[1]],
    '2x1': [[1, 1]],
    '1x2': [[1], [1]],
    '3x1': [[1, 1, 1]],
    '1x3': [[1], [1], [1]],
    '2x2': [[1, 1], [1, 1]],
    S2: [[0, 1, 1], [1, 1, 0]],
    Z2: [[1, 1, 0], [0, 1, 1]],
    T3: [[1, 1, 1], [0, 1, 0]],
    L2: [[1, 0], [1, 1]],
    J2: [[0, 1], [1, 1]],
    L3: [[1, 0, 0], [1, 0, 0], [1, 1, 1]],
    J3: [[0, 0, 1], [0, 0, 1], [1, 1, 1]],
    '3x2': [[1, 1, 1], [1, 1, 1]],
    '2x3': [[1, 1], [1, 1], [1, 1]],
    '3x3': [[1, 1, 1], [1, 1, 1], [1, 1, 1]]
  },
  shapePools: {
    1: ['1x1', '2x1', '1x2'],
    2: ['2x2', '3x1', '1x3', 'L2', 'J2', 'S2'],
    3: ['3x3', '3x2', '2x3', 'L3', 'J3', 'T3']
  },
  lootRarityWeights: { common: 80, uncommon: 15, rare: 4.8, legendary: 0.2 },

  difficultyPresets: {
    easy: {
      id: 'easy', label: '简单', finalTerminalSpawnCount: 6, finalTerminalSpawnInterval: 30,
      maps: {
        small: { hunters: 10, hunterMaxHp: 2, hunterRespawnCount: 2, hunterSpawnInterval: 30 },
        medium: { hunters: 16, hunterMaxHp: 2, hunterRespawnCount: 2, hunterSpawnInterval: 30 },
        large: { hunters: 24, hunterMaxHp: 2, hunterRespawnCount: 2, hunterSpawnInterval: 30 }
      }
    },
    medium: {
      id: 'medium', label: '中等', finalTerminalSpawnCount: 10, finalTerminalSpawnInterval: 30,
      maps: {
        small: { hunters: 10, hunterMaxHp: 2, hunterRespawnCount: 2, hunterSpawnInterval: 30 },
        medium: { hunters: 16, hunterMaxHp: 2, hunterRespawnCount: 4, hunterSpawnInterval: 30 },
        large: { hunters: 24, hunterMaxHp: 2, hunterRespawnCount: 6, hunterSpawnInterval: 30 }
      }
    },
    hard: {
      id: 'hard', label: '困难', finalTerminalSpawnCount: 16, finalTerminalSpawnInterval: 30,
      maps: {
        small: { hunters: 20, hunterMaxHp: 3, hunterRespawnCount: 4, hunterSpawnInterval: 30 },
        medium: { hunters: 32, hunterMaxHp: 3, hunterRespawnCount: 6, hunterSpawnInterval: 30 },
        large: { hunters: 46, hunterMaxHp: 3, hunterRespawnCount: 8, hunterSpawnInterval: 30 }
      }
    }
  },

  encounterRules: {
    easy: { nightmareCounts: [1, 1, 1], nightmareSleep: 40, heavyCounts: [0, 0, 0], heavyHp: 0 },
    medium: { nightmareCounts: [1, 2, 3], nightmareSleep: 40, heavyCounts: [2, 3, 4], heavyHp: 5 },
    hard: { nightmareCounts: [2, 3, 4], nightmareSleep: 30, heavyCounts: [3, 4, 5], heavyHp: 10 }
  },

  // Calculated dynamic world dimensions
  get WORLD_W() {
    if (typeof window !== 'undefined' && window.game && window.game.map && window.game.map.worldW) {
      return window.game.map.worldW;
    }
    return this._worldW || (this.GRID_COLS * this.ROOM_W);
  },
  set WORLD_W(val) {
    this._worldW = val;
  },
  get WORLD_H() {
    if (typeof window !== 'undefined' && window.game && window.game.map && window.game.map.worldH) {
      return window.game.map.worldH;
    }
    return this._worldH || (this.GRID_ROWS * this.ROOM_H);
  },
  set WORLD_H(val) {
    this._worldH = val;
  },

  camera: { baseZoom: 1.56, aimMultiplier: 1.1, maxLookFraction: 0.25, smoothingSeconds: 0.12 },

  player: {
    spawnX: 180,
    spawnY: 180,
    radius: 10,
    speed: 70,
    sprintSpeed: 150,
    downedSpeed: 20,
    dodgeDistance: 100,
    dodgeDuration: 0.35,
    dodgeStaminaCost: 20,
    staminaRegenDelay: 1,
    meleeRange: 55,
    meleeStaminaCost: 10,
    meleeCooldown: 1,
    meleeDamage: 1,
    meleeKnockback: 50,
    noiseDecayStill: 4,
    noiseDecayMoving: 2,
    walkNoiseCap: 10,
    stabilizedNoiseCap: 8,
    sprintNoiseGain: 4,
    sprintNoiseCap: 75,
    flashlightRange: 420,
    flashlightSpread: 0.5
  },

  weapons: {
    pistol: {
      id: 'pistol',
      label: '手枪',
      slot: 'sidearm',
      maxAmmo: 6,
      initialReserve: 120,
      purchasePrice: 0,
      shootCooldownDuration: 0.4,
      reloadDuration: 1.2,
      reloadMode: 'magazine',
      hipSpread: 0.38,
      aimSpread: 0.01,
      shotNoise: 2,
      recoilAim: 16,
      recoilHip: 28,
      automatic: false,
      damage: 1,
      penetrationTargets: 1
    },
    smg: {
      id: 'smg',
      label: '冲锋枪',
      slot: 'primary',
      maxAmmo: 24,
      initialReserve: 240,
      purchasePrice: 4250,
      shootCooldownDuration: 0.1,
      reloadDuration: 1.8,
      reloadMode: 'magazine',
      hipSpread: 0.52,
      aimSpread: 0.04,
      shotNoise: 2,
      recoilAim: 2,
      recoilHip: 4,
      automatic: true,
      damage: 1,
      penetrationTargets: 1
    },
    shotgun: {
      id: 'shotgun',
      label: '散弹枪',
      slot: 'primary',
      maxAmmo: 8,
      initialReserve: 80,
      purchasePrice: 15250,
      shootCooldownDuration: 0.8,
      reloadDuration: 0.5,
      reloadMode: 'shell',
      pelletCount: 4,
      hipSpreadDegrees: 40,
      aimSpreadDegrees: 8,
      shotNoise: 4,
      recoilAim: 8,
      recoilHip: 22,
      automatic: false,
      damage: 1,
      penetrationTargets: 1
    },
    revolver: {
      id: 'revolver',
      label: '左轮',
      slot: 'sidearm',
      maxAmmo: 4,
      initialReserve: 24,
      purchasePrice: 5500,
      shootCooldownDuration: 1.2,
      reloadDuration: 1,
      reloadMode: 'shell',
      hipSpread: 0.38,
      aimSpread: 0.01,
      shotNoise: 2,
      recoilAim: 18,
      recoilHip: 32,
      automatic: false,
      damage: 1,
      penetrationTargets: 3
    }
  },

  ammo: {
    standardUnitsPerRound: { pistol: 1, smg: 1, revolver: 2, shotgun: 4 },
    unitsPerPurchase: 100,
    pricePerPurchase: 200
  },

  monster: {
    spawnX: 1600,
    spawnY: 1100,
    radius: 22.5,
    spriteWidth: 72,
    speed: 385,
    slowSpeed: 32,
    wallChokeSpeed: 22.4,
    patrolSpeedScale: 60,
    alertDistance: 380,
    alertDeaggroTimeout: 6,
    triggerNoiseThreshold: 40,
    attackDistance: 20,
    contactDamage: 10,
    contactOxygenDamage: 4,
    hitStagger: 1,
    recoveryHits: 1,
    recoveryDuration: 40,
    waypointRefresh: 0.5
  },

  hunter: {
    radius: 22.5,
    spriteWidth: 63,
    speed: 80,
    slowSpeed: 32,
    patrolSpeedScale: 60,
    alertDistance: 380,
    alertDeaggroTimeout: 6,
    triggerNoiseThreshold: 60,
    attackDistance: 20,
    contactDamage: 5,
    contactOxygenDamage: 1,
    hitStagger: 0.5,
    knockback: 10,
    deathFadeDuration: 0.6,
    traitChance: 0.3,
    traitTypes: ['photophobic', 'slim', 'reviver', 'ambusher'],
    lightIgnoreDistance: 50,
    lightAvoidRefresh: 0.35,
    lightAvoidRadii: [90, 160],
    traitReviveDuration: 7,
    maxHp: 1,
    waypointRefresh: 0.5
  },

  heavy: {
    hp: { easy: 5, medium: 5, hard: 10 },
    radius: 44,
    spriteWidth: 112,
    speed: 50,
    chargeSpeed: 300,
    windupDuration: 2,
    stunDuration: 3,
    chargeDamage: 10,
    knockback: 50,
    waypointRefresh: 0.5
  },

  skills: {
    flashbang: { id: 'flashbang', label: '闪光弹', price: 1000, cooldown: 15, image: 'resources/images/flashbang.png', description: '投掷后落地 1 秒引爆，晕眩 80 范围内无遮挡的所有活体 5 秒，包括自己与队友。' },
    grenade: { id: 'grenade', label: '手榴弹', price: 5000, cooldown: 20, image: 'resources/images/abilities/grenade.png', description: '80 范围爆炸造成 5 点伤害，可击穿 Heavy 护甲；会伤到自己，队友遵循友伤设置。' }
  },
  passives: {
    roll: { id: 'roll', label: '翻滚', price: 7000, image: 'resources/images/abilities/roll.png', description: '装备后按 Space 向移动方向翻滚 100 单位，最多消耗 20 体力，翻滚期间免疫伤害。' },
    'life-scan': { id: 'life-scan', label: '生命侦测', price: 4000, image: 'resources/images/abilities/life-scan.png', description: '仅自己在 M 地图看到全图活体敌人，不揭示地形、物资或终端。' }
  },

  flashbang: {
    purchasePrice: 500,
    speed: 450,
    radius: 3,
    minDistance: 50,
    maxDistance: 300,
    fuse: 1,
    blastRadius: 80,
    stunDuration: 5
  },

  extraction: {
    x: 140,
    y: 140,
    radius: 40
  },

  // 10 Distinct Room Types + Start Airlock + Emergency Evac Pod (Total 12 types)
  roomTypes: {
    airlock: {
      type: 'airlock',
      label: 'AIRLOCK',
      title: '起始气闸舱',
      accent: '#3b82f6',
      lootPool: [
        { name: '应急氧气罐', size: 1, baseValue: 30, rarity: 'common' },
        { name: 'EVA安全缆', size: 1, baseValue: 35, rarity: 'common' },
        { name: '气闸门联锁密钥', size: 1, baseValue: 380, rarity: 'uncommon', shape: '1x1' },
        { name: '紧急航向校准器', size: 2, baseValue: 4200, rarity: 'rare', shape: 'L2' }
      ]
    },
    reactor: {
      type: 'reactor',
      label: 'REACTOR',
      title: '反应堆核心舱',
      accent: '#f5a623',
      lootPool: [
        { name: '聚变电容电池', size: 2, baseValue: 350, rarity: 'uncommon' },
        { name: '辐射冷却管', size: 1, baseValue: 230, rarity: 'uncommon' },
        { name: '浓缩核心碎块', size: 3, baseValue: 9000, rarity: 'rare' },
        { name: '隔热检修夹具', size: 1, baseValue: 120, rarity: 'common', shape: '2x1' }
      ]
    },
    biolab: {
      type: 'biolab',
      label: 'BIO LAB',
      title: '生化研究实验室',
      accent: '#50e3c2',
      lootPool: [
        { name: '变异组织切片', size: 1, baseValue: 50, rarity: 'common' },
        { name: '生物样本冷冻罐', size: 2, baseValue: 1300, rarity: 'uncommon' },
        { name: '未定型拟态血清', size: 3, baseValue: 8200, rarity: 'rare' }
      ]
    },
    server: {
      type: 'server',
      label: 'SERVER ARCHIVE',
      title: '中央数据机房',
      accent: '#4a90e2',
      lootPool: [
        { name: '光纤数据阵列', size: 1, baseValue: 120, rarity: 'common' },
        { name: '加密固态驱动器', size: 2, baseValue: 1050, rarity: 'uncommon' },
        { name: 'AI黑盒存储核', size: 3, baseValue: 10000, rarity: 'rare' }
      ]
    },
    greenhouse: {
      type: 'greenhouse',
      label: 'HYDROPONICS',
      title: '水培温室生态舱',
      accent: '#7ed321',
      lootPool: [
        { name: '水培滤芯', size: 1, baseValue: 50, rarity: 'common' },
        { name: '基因编辑种子荚', size: 1, baseValue: 500, rarity: 'uncommon' },
        { name: '发光真菌标本', size: 2, baseValue: 6500, rarity: 'rare' }
      ]
    },
    medbay: {
      type: 'medbay',
      label: 'MED BAY',
      title: '医疗冷冻站',
      accent: '#e8754e',
      lootPool: [
        { name: '复合止血贴', size: 1, baseValue: 110, rarity: 'common' },
        { name: '便携神经除颤器', size: 2, baseValue: 800, rarity: 'uncommon' },
        { name: '军用休眠调节剂', size: 2, baseValue: 6300, rarity: 'rare' }
      ]
    },
    cargo: {
      type: 'cargo',
      label: 'CARGO BAY',
      title: '重型仓储货运区',
      accent: '#d7a15c',
      lootPool: [
        { name: '高强度合金板', size: 2, baseValue: 160, rarity: 'common' },
        { name: '工业液压动力臂', size: 3, baseValue: 2100, rarity: 'uncommon' },
        { name: '精炼钛金铸锭', size: 3, baseValue: 15200, rarity: 'rare' }
      ]
    },
    armory: {
      type: 'armory',
      label: 'ARMORY',
      title: '军械安保岗哨',
      accent: '#d0021b',
      lootPool: [
        { name: '高密度弹药盒', size: 1, baseValue: 20, rarity: 'common' },
        { name: '红外战术瞄具', size: 2, baseValue: 620, rarity: 'uncommon' },
        { name: '防爆陶瓷插板', size: 2, baseValue: 7500, rarity: 'rare' }
      ]
    },
    workshop: {
      type: 'workshop',
      label: 'WORKSHOP',
      title: '设备维修车间',
      accent: '#bd10e0',
      lootPool: [
        { name: '气动扳手组', size: 1, baseValue: 130, rarity: 'common' },
        { name: '等离子割炬喷嘴', size: 2, baseValue: 530, rarity: 'uncommon' },
        { name: '伺服电机控制器', size: 2, baseValue: 6200, rarity: 'rare' }
      ]
    },
    quarters: {
      type: 'quarters',
      label: 'QUARTERS',
      title: '船员生活区',
      accent: '#9013fe',
      lootPool: [
        { name: '旧时代合成口粮', size: 1, baseValue: 30, rarity: 'common' },
        { name: '私人录音挂坠', size: 1, baseValue: 220, rarity: 'uncommon' },
        { name: '走私合成雪茄盒', size: 2, baseValue: 6400, rarity: 'rare' }
      ]
    },
    waste: {
      type: 'waste',
      label: 'DECON / WASTE',
      title: '洗消废弃物处理',
      accent: '#9b9b9b',
      lootPool: [
        { name: '耐酸过滤栅板', size: 1, baseValue: 90, rarity: 'common' },
        { name: '重金属浓缩矿渣', size: 2, baseValue: 540, rarity: 'uncommon' },
        { name: '密封放射性废料罐', size: 3, baseValue: 8000, rarity: 'rare' }
      ]
    },
    reactor_aux: {
      type: 'reactor_aux',
      label: 'AUX REACTOR',
      title: '辅助动力枢纽',
      accent: '#e67e22',
      lootPool: [
        { name: '超导磁流体管', size: 1, baseValue: 130, rarity: 'uncommon' },
        { name: '等离子分流线圈', size: 2, baseValue: 800, rarity: 'uncommon' },
        { name: '重核裂解催化剂', size: 2, baseValue: 4500, rarity: 'rare' },
        { name: '辅助电容保险芯', size: 1, baseValue: 100, rarity: 'common', shape: '2x1' }
      ]
    },
    specimen_vault: {
      type: 'specimen_vault',
      label: 'SPECIMEN VAULT',
      title: '异星标本保全库',
      accent: '#1abc9c',
      lootPool: [
        { name: '冷凝神经突触液', size: 1, baseValue: 110, rarity: 'common' },
        { name: '基因嵌合胚胎胶囊', size: 2, baseValue: 1200, rarity: 'uncommon' },
        { name: '深渊外壳晶体标本', size: 3, baseValue: 13200, rarity: 'rare' }
      ]
    },
    quantum_core: {
      type: 'quantum_core',
      label: 'QUANTUM CORE',
      title: '量子超算中心',
      accent: '#3498db',
      lootPool: [
        { name: '光子量子芯片', size: 1, baseValue: 10, rarity: 'common' },
        { name: '相干态纠缠介质', size: 2, baseValue: 730, rarity: 'uncommon' },
        { name: '自意识架构硬盘', size: 3, baseValue: 24000, rarity: 'rare' }
      ]
    },
    hydro_arboretum: {
      type: 'hydro_arboretum',
      label: 'ARBORETUM',
      title: '深空植物园林',
      accent: '#2ecc71',
      lootPool: [
        { name: '荧光植物提取液', size: 1, baseValue: 180, rarity: 'common' },
        { name: '合成土壤母质', size: 2, baseValue: 1400, rarity: 'uncommon' },
        { name: '稀有药用孢子花粉', size: 1, baseValue: 4500, rarity: 'rare' }
      ]
    },
    cryo_stasis: {
      type: 'cryo_stasis',
      label: 'CRYO STASIS',
      title: '休眠舱矩阵',
      accent: '#00cec9',
      lootPool: [
        { name: '生命体征记录仪', size: 1, baseValue: 35, rarity: 'common' },
        { name: '液氮加压循环泵', size: 2, baseValue: 850, rarity: 'uncommon' },
        { name: '特级冬眠保全血清', size: 2, baseValue: 9400, rarity: 'rare' }
      ]
    },
    hangar_bay: {
      type: 'hangar_bay',
      label: 'HANGAR BAY',
      title: '穿梭机维修机库',
      accent: '#f39c12',
      lootPool: [
        { name: '矢量推力喷管', size: 2, baseValue: 180, rarity: 'common' },
        { name: '飞船航空导航仪', size: 2, baseValue: 800, rarity: 'uncommon' },
        { name: '反重力着陆缓冲板', size: 3, baseValue: 23000, rarity: 'rare' }
      ]
    },
    security_command: {
      type: 'security_command',
      label: 'SECURITY CMD',
      title: '战术安保指挥所',
      accent: '#c0392b',
      lootPool: [
        { name: '加密保全密钥卡', size: 1, baseValue: 25, rarity: 'common' },
        { name: '高频战术防暴盾', size: 2, baseValue: 1600, rarity: 'uncommon' },
        { name: '轨道炮瞄准主板', size: 2, baseValue: 8500, rarity: 'rare' }
      ]
    },
    foundry: {
      type: 'foundry',
      label: 'NANO FOUNDRY',
      title: '纳米重力铸造车间',
      accent: '#9b59b6',
      lootPool: [
        { name: '耐热陶瓷坩埚', size: 1, baseValue: 115, rarity: 'common' },
        { name: '液态金属打印喷头', size: 2, baseValue: 800, rarity: 'uncommon' },
        { name: '重氢熔炼结晶体', size: 3, baseValue: 13200, rarity: 'rare' }
      ]
    },
    officer_lounge: {
      type: 'officer_lounge',
      label: 'OFFICER LOUNGE',
      title: '军官全景生活舱',
      accent: '#8e44ad',
      lootPool: [
        { name: '复古黑胶唱片机', size: 2, baseValue: 300, rarity: 'common' },
        { name: '定制贵宾滤水壶', size: 1, baseValue: 860, rarity: 'uncommon' },
        { name: '纯金星际航行勋章', size: 1, baseValue: 6500, rarity: 'rare' }
      ]
    },
    centrifuge: {
      type: 'centrifuge',
      label: 'CENTRIFUGE',
      title: '人工重力离心环',
      accent: '#16a085',
      lootPool: [
        { name: '动平衡陀螺仪', size: 1, baseValue: 80, rarity: 'common' },
        { name: '高阻尼离合轴承', size: 2, baseValue: 1200, rarity: 'uncommon' },
        { name: '离心超导滑环', size: 2, baseValue: 9700, rarity: 'rare' }
      ]
    },
    comm_array: {
      type: 'comm_array',
      label: 'COMM ARRAY',
      title: '深空通讯天线阵列',
      accent: '#2980b9',
      lootPool: [
        { name: '微波信号放大器', size: 1, baseValue: 50, rarity: 'common' },
        { name: '相控阵高频馈源', size: 2, baseValue: 1100, rarity: 'uncommon' },
        { name: '量子跳跃信标机', size: 3, baseValue: 14500, rarity: 'rare' }
      ]
    },
    observatory: {
      type: 'observatory',
      label: 'OBSERVATORY',
      title: '观星穹顶实验室',
      accent: '#f1c40f',
      lootPool: [
        { name: '消色差复眼透镜', size: 1, baseValue: 70, rarity: 'common' },
        { name: '光谱测绘分光棱镜', size: 2, baseValue: 1110, rarity: 'uncommon' },
        { name: '暗物质探测晶核', size: 2, baseValue: 11000, rarity: 'rare' }
      ]
    },
    evacpod: {
      type: 'evacpod',
      label: 'EVAC POD',
      title: '紧急逃生舱甲板',
      accent: '#ef4444',
      lootPool: [
        { name: '备用飞船黑匣子', size: 2, baseValue: 900, rarity: 'uncommon' },
        { name: '量子逃生坐标芯片', size: 1, baseValue: 7000, rarity: 'rare' },
        { name: '应急维生补给包', size: 1, baseValue: 250, rarity: 'common', shape: '1x2' },
        { name: '钻石', size: 1, baseValue: 55000, rarity: 'legendary', shape: '1x1' }
      ]
    }
  },

  consumables: {
    flashbang: {
      id: 'flashbang', name: '闪光弹', shape: '1x1', purchasePrice: 500,
      value: 250, effect: 'flashbang', image: 'resources/images/flashbang.png'
    },
    oxygenCanister: {
      id: 'oxygen-canister', name: '备用氧气瓶', shape: '1x2', purchasePrice: 300,
      value: 150, effect: 'oxygen-50', image: 'resources/images/oxygen-canister.png'
    },
    medkit: {
      id: 'medkit', name: '急救包', shape: '1x2', purchasePrice: 300,
      value: 150, effect: 'health-40', image: 'resources/images/medkit.png'
    }
  },

  // Fallback items catalog for generic trade / store
  items: {
    scrap: { name: '废铁', rarity: 'common', size: 1, baseValue: 50 },
    circuit: { name: '电路板', rarity: 'uncommon', size: 2, baseValue: 150 },
    rareData: { name: '加密数据', rarity: 'rare', size: 3, baseValue: 400 }
  }
};
