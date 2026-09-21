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
  DOOR_SIZE: 64,

  // Facility Scale Presets: Small (12), Medium (18), Large (24)
  mapScales: {
    small: { id: 'small', label: '小型 (12 舱)', cols: 4, rows: 3, roomCount: 12, quota: 420, terminals: 3, hunters: 24, hunterSpawnInterval: 10, hunterRespawnCount: 1, hunterMaxHp: 2 },
    medium: { id: 'medium', label: '中型 (18 舱)', cols: 6, rows: 3, roomCount: 18, quota: 780, terminals: 3, hunters: 32, hunterSpawnInterval: 10, hunterRespawnCount: 2, hunterMaxHp: 2 },
    large: { id: 'large', label: '大型 (24 舱)', cols: 6, rows: 4, roomCount: 24, quota: 1200, terminals: 4, hunters: 50, hunterSpawnInterval: 10, hunterRespawnCount: 3, hunterMaxHp: 2 }
  },
  currentScale: 'small',

  difficultyPresets: {
    easy: { id: 'easy', label: '简单', hunterScale: 0.5, respawnScale: 0.5, intervalScale: 2, hunterMaxHp: 1 },
    medium: { id: 'medium', label: '中等', hunterScale: 1, respawnScale: 1, intervalScale: 1, hunterMaxHp: 2 },
    hard: { id: 'hard', label: '困难', hunterScale: 1, respawnScale: 1, intervalScale: 1, hunterMaxHp: 5 }
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

  player: {
    spawnX: 180,
    spawnY: 180,
    radius: 10,
    speed: 120,
    maxAmmo: 6,
    maxReserveAmmo: 9000,
    reloadDuration: 1.2,
    shootCooldownDuration: 0.38,
    ammoPrice: 50,
    noiseDecayStill: 12,
    noiseDecayMoving: 7
  },

  weapons: {
    pistol: {
      id: 'pistol',
      label: '手枪',
      maxAmmo: 6,
      shootCooldownDuration: 0.38,
      reloadDuration: 1.2,
      hipSpread: 0.38,
      aimSpread: 0.01,
      shotNoise: 24,
      recoilAim: 16,
      recoilHip: 28,
      automatic: false
    },
    smg: {
      id: 'smg',
      label: '冲锋枪',
      maxAmmo: 30,
      shootCooldownDuration: 0.1,
      reloadDuration: 1.8,
      hipSpread: 0.52,
      aimSpread: 0.04,
      shotNoise: 18,
      recoilAim: 2,
      recoilHip: 4,
      automatic: true
    }
  },

  monster: {
    spawnX: 1600,
    spawnY: 1100,
    radius: 15,
    speed: 96,
    slowSpeed: 32,
    wallChokeSpeed: 28,
    patrolSpeedScale: 20,
    alertDistance: 380,
    alertDeaggroTimeout: 4,
    triggerNoiseThreshold: 48,
    waypointRefresh: 0.5
  },

  hunter: {
    radius: 15,
    speed: 96,
    slowSpeed: 32,
    patrolSpeedScale: 20,
    alertDistance: 380,
    alertDeaggroTimeout: 4,
    triggerNoiseThreshold: 48,
    maxHp: 1,
    waypointRefresh: 0.5
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
        { name: '应急氧气罐', size: 1, baseValue: 60, rarity: 'common' },
        { name: 'EVA安全缆', size: 1, baseValue: 80, rarity: 'common' }
      ]
    },
    reactor: {
      type: 'reactor',
      label: 'REACTOR',
      title: '反应堆核心舱',
      accent: '#f5a623',
      lootPool: [
        { name: '聚变电容电池', size: 2, baseValue: 240, rarity: 'uncommon' },
        { name: '辐射冷却管', size: 1, baseValue: 180, rarity: 'uncommon' },
        { name: '浓缩核心碎块', size: 3, baseValue: 480, rarity: 'rare' }
      ]
    },
    biolab: {
      type: 'biolab',
      label: 'BIO LAB',
      title: '生化研究实验室',
      accent: '#50e3c2',
      lootPool: [
        { name: '变异组织切片', size: 1, baseValue: 140, rarity: 'common' },
        { name: '生物样本冷冻罐', size: 2, baseValue: 260, rarity: 'uncommon' },
        { name: '未定型拟态血清', size: 3, baseValue: 520, rarity: 'rare' }
      ]
    },
    server: {
      type: 'server',
      label: 'SERVER ARCHIVE',
      title: '中央数据机房',
      accent: '#4a90e2',
      lootPool: [
        { name: '光纤数据阵列', size: 1, baseValue: 130, rarity: 'common' },
        { name: '加密固态驱动器', size: 2, baseValue: 280, rarity: 'uncommon' },
        { name: 'AI黑盒存储核', size: 3, baseValue: 550, rarity: 'rare' }
      ]
    },
    greenhouse: {
      type: 'greenhouse',
      label: 'HYDROPONICS',
      title: '水培温室生态舱',
      accent: '#7ed321',
      lootPool: [
        { name: '水培滤芯', size: 1, baseValue: 90, rarity: 'common' },
        { name: '基因编辑种子荚', size: 1, baseValue: 160, rarity: 'uncommon' },
        { name: '发光真菌标本', size: 2, baseValue: 310, rarity: 'rare' }
      ]
    },
    medbay: {
      type: 'medbay',
      label: 'MED BAY',
      title: '医疗冷冻站',
      accent: '#e8754e',
      lootPool: [
        { name: '复合止血贴', size: 1, baseValue: 95, rarity: 'common' },
        { name: '便携神经除颤器', size: 2, baseValue: 220, rarity: 'uncommon' },
        { name: '军用休眠调节剂', size: 2, baseValue: 380, rarity: 'rare' }
      ]
    },
    cargo: {
      type: 'cargo',
      label: 'CARGO BAY',
      title: '重型仓储货运区',
      accent: '#d7a15c',
      lootPool: [
        { name: '高强度合金板', size: 2, baseValue: 120, rarity: 'common' },
        { name: '工业液压动力臂', size: 3, baseValue: 320, rarity: 'uncommon' },
        { name: '精炼钛金铸锭', size: 3, baseValue: 460, rarity: 'rare' }
      ]
    },
    armory: {
      type: 'armory',
      label: 'ARMORY',
      title: '军械安保岗哨',
      accent: '#d0021b',
      lootPool: [
        { name: '高密度弹药盒', size: 1, baseValue: 110, rarity: 'common' },
        { name: '红外战术瞄具', size: 2, baseValue: 290, rarity: 'uncommon' },
        { name: '防爆陶瓷插板', size: 2, baseValue: 410, rarity: 'rare' }
      ]
    },
    workshop: {
      type: 'workshop',
      label: 'WORKSHOP',
      title: '设备维修车间',
      accent: '#bd10e0',
      lootPool: [
        { name: '气动扳手组', size: 1, baseValue: 100, rarity: 'common' },
        { name: '等离子割炬喷嘴', size: 2, baseValue: 230, rarity: 'uncommon' },
        { name: '伺服电机控制器', size: 2, baseValue: 390, rarity: 'rare' }
      ]
    },
    quarters: {
      type: 'quarters',
      label: 'QUARTERS',
      title: '船员生活区',
      accent: '#9013fe',
      lootPool: [
        { name: '旧时代合成口粮', size: 1, baseValue: 70, rarity: 'common' },
        { name: '私人录音挂坠', size: 1, baseValue: 175, rarity: 'uncommon' },
        { name: '走私合成雪茄盒', size: 2, baseValue: 340, rarity: 'rare' }
      ]
    },
    waste: {
      type: 'waste',
      label: 'DECON / WASTE',
      title: '洗消废弃物处理',
      accent: '#9b9b9b',
      lootPool: [
        { name: '耐酸过滤栅板', size: 1, baseValue: 85, rarity: 'common' },
        { name: '重金属浓缩矿渣', size: 2, baseValue: 210, rarity: 'uncommon' },
        { name: '密封放射性废料罐', size: 3, baseValue: 450, rarity: 'rare' }
      ]
    },
    reactor_aux: {
      type: 'reactor_aux',
      label: 'AUX REACTOR',
      title: '辅助动力枢纽',
      accent: '#e67e22',
      lootPool: [
        { name: '超导磁流体管', size: 1, baseValue: 190, rarity: 'uncommon' },
        { name: '等离子分流线圈', size: 2, baseValue: 270, rarity: 'uncommon' },
        { name: '重核裂解催化剂', size: 2, baseValue: 460, rarity: 'rare' }
      ]
    },
    specimen_vault: {
      type: 'specimen_vault',
      label: 'SPECIMEN VAULT',
      title: '异星标本保全库',
      accent: '#1abc9c',
      lootPool: [
        { name: '冷凝神经突触液', size: 1, baseValue: 160, rarity: 'common' },
        { name: '基因嵌合胚胎胶囊', size: 2, baseValue: 310, rarity: 'uncommon' },
        { name: '深渊外壳晶体标本', size: 3, baseValue: 580, rarity: 'rare' }
      ]
    },
    quantum_core: {
      type: 'quantum_core',
      label: 'QUANTUM CORE',
      title: '量子超算中心',
      accent: '#3498db',
      lootPool: [
        { name: '光子量子芯片', size: 1, baseValue: 150, rarity: 'common' },
        { name: '相干态纠缠介质', size: 2, baseValue: 320, rarity: 'uncommon' },
        { name: '自意识架构硬盘', size: 3, baseValue: 620, rarity: 'rare' }
      ]
    },
    hydro_arboretum: {
      type: 'hydro_arboretum',
      label: 'ARBORETUM',
      title: '深空植物园林',
      accent: '#2ecc71',
      lootPool: [
        { name: '荧光植物提取液', size: 1, baseValue: 110, rarity: 'common' },
        { name: '合成土壤母质', size: 2, baseValue: 200, rarity: 'uncommon' },
        { name: '稀有药用孢子花粉', size: 1, baseValue: 360, rarity: 'rare' }
      ]
    },
    cryo_stasis: {
      type: 'cryo_stasis',
      label: 'CRYO STASIS',
      title: '休眠舱矩阵',
      accent: '#00cec9',
      lootPool: [
        { name: '生命体征记录仪', size: 1, baseValue: 125, rarity: 'common' },
        { name: '液氮加压循环泵', size: 2, baseValue: 250, rarity: 'uncommon' },
        { name: '特级冬眠保全血清', size: 2, baseValue: 430, rarity: 'rare' }
      ]
    },
    hangar_bay: {
      type: 'hangar_bay',
      label: 'HANGAR BAY',
      title: '穿梭机维修机库',
      accent: '#f39c12',
      lootPool: [
        { name: '矢量推力喷管', size: 2, baseValue: 180, rarity: 'common' },
        { name: '飞船航空导航仪', size: 2, baseValue: 330, rarity: 'uncommon' },
        { name: '反重力着陆缓冲板', size: 3, baseValue: 510, rarity: 'rare' }
      ]
    },
    security_command: {
      type: 'security_command',
      label: 'SECURITY CMD',
      title: '战术安保指挥所',
      accent: '#c0392b',
      lootPool: [
        { name: '加密保全密钥卡', size: 1, baseValue: 135, rarity: 'common' },
        { name: '高频战术防暴盾', size: 2, baseValue: 300, rarity: 'uncommon' },
        { name: '轨道炮瞄准主板', size: 2, baseValue: 490, rarity: 'rare' }
      ]
    },
    foundry: {
      type: 'foundry',
      label: 'NANO FOUNDRY',
      title: '纳米重力铸造车间',
      accent: '#9b59b6',
      lootPool: [
        { name: '耐热陶瓷坩埚', size: 1, baseValue: 115, rarity: 'common' },
        { name: '液态金属打印喷头', size: 2, baseValue: 260, rarity: 'uncommon' },
        { name: '重氢熔炼结晶体', size: 3, baseValue: 540, rarity: 'rare' }
      ]
    },
    officer_lounge: {
      type: 'officer_lounge',
      label: 'OFFICER LOUNGE',
      title: '军官全景生活舱',
      accent: '#8e44ad',
      lootPool: [
        { name: '复古黑胶唱片机', size: 2, baseValue: 150, rarity: 'common' },
        { name: '定制贵宾滤水壶', size: 1, baseValue: 220, rarity: 'uncommon' },
        { name: '纯金星际航行勋章', size: 1, baseValue: 470, rarity: 'rare' }
      ]
    },
    centrifuge: {
      type: 'centrifuge',
      label: 'CENTRIFUGE',
      title: '人工重力离心环',
      accent: '#16a085',
      lootPool: [
        { name: '动平衡陀螺仪', size: 1, baseValue: 140, rarity: 'common' },
        { name: '高阻尼离合轴承', size: 2, baseValue: 280, rarity: 'uncommon' },
        { name: '离心超导滑环', size: 2, baseValue: 450, rarity: 'rare' }
      ]
    },
    comm_array: {
      type: 'comm_array',
      label: 'COMM ARRAY',
      title: '深空通讯天线阵列',
      accent: '#2980b9',
      lootPool: [
        { name: '微波信号放大器', size: 1, baseValue: 130, rarity: 'common' },
        { name: '相控阵高频馈源', size: 2, baseValue: 290, rarity: 'uncommon' },
        { name: '量子跳跃信标机', size: 3, baseValue: 570, rarity: 'rare' }
      ]
    },
    observatory: {
      type: 'observatory',
      label: 'OBSERVATORY',
      title: '观星穹顶实验室',
      accent: '#f1c40f',
      lootPool: [
        { name: '消色差复眼透镜', size: 1, baseValue: 145, rarity: 'common' },
        { name: '光谱测绘分光棱镜', size: 2, baseValue: 310, rarity: 'uncommon' },
        { name: '暗物质探测晶核', size: 2, baseValue: 600, rarity: 'rare' }
      ]
    },
    evacpod: {
      type: 'evacpod',
      label: 'EVAC POD',
      title: '紧急逃生舱甲板',
      accent: '#ef4444',
      lootPool: [
        { name: '备用飞船黑匣子', size: 2, baseValue: 350, rarity: 'uncommon' },
        { name: '量子逃生坐标芯片', size: 1, baseValue: 500, rarity: 'rare' }
      ]
    }
  },

  // Fallback items catalog for generic trade / store
  items: {
    scrap: { name: '废铁', rarity: 'common', size: 1, baseValue: 50 },
    circuit: { name: '电路板', rarity: 'uncommon', size: 2, baseValue: 150 },
    rareData: { name: '加密数据', rarity: 'rare', size: 3, baseValue: 400 }
  }
};
