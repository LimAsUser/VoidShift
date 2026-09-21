/**
 * VOID SHIFT // RECOVERY OPERATIONS PROTOCOL
 * System Constants & Map Configuration
 */

const Config = {
  VIEW_W: 900,
  VIEW_H: 602,
  WORLD_W: 1800,
  WORLD_H: 1204,

  // Quadrant expansion offset configuration
  quadrantOffsets: [
    { x: 0, y: 0 },
    { x: 900, y: 0 },
    { x: 0, y: 602 },
    { x: 900, y: 602 }
  ],

  baseWindows: [
    { x: 82, y: 178, w: 34, h: 6 },
    { x: 335, y: 178, w: 28, h: 6 },
    { x: 510, y: 430, w: 32, h: 6 },
    { x: 760, y: 430, w: 34, h: 6 }
  ],

  baseDoors: [
    { x: 220, y: 195, w: 18, h: 42, open: false },
    { x: 410, y: 150, w: 18, h: 42, open: false },
    { x: 630, y: 205, w: 18, h: 42, open: false }
  ],

  expansionRooms: [
    { x: 38, y: 42, w: 150, h: 105, label: 'CONTROL' },
    { x: 690, y: 42, w: 150, h: 105, label: 'STORAGE' },
    { x: 38, y: 465, w: 150, h: 90, label: 'MED BAY' },
    { x: 690, y: 465, w: 150, h: 90, label: 'SERVICE' }
  ],

  roomWalls: [
    { x: 220, y: 22, w: 18, h: 155 },
    { x: 220, y: 250, w: 18, h: 180 },
    { x: 220, y: 500, w: 18, h: 80 },
    { x: 410, y: 22, w: 18, h: 115 },
    { x: 410, y: 210, w: 18, h: 205 },
    { x: 410, y: 490, w: 18, h: 90 },
    { x: 630, y: 22, w: 18, h: 165 },
    { x: 630, y: 270, w: 18, h: 160 },
    { x: 630, y: 515, w: 18, h: 65 },
    { x: 22, y: 178, w: 105, h: 18 },
    { x: 285, y: 178, w: 92, h: 18 },
    { x: 465, y: 178, w: 110, h: 18 },
    { x: 720, y: 178, w: 158, h: 18 },
    { x: 22, y: 430, w: 120, h: 18 },
    { x: 295, y: 430, w: 90, h: 18 },
    { x: 475, y: 430, w: 110, h: 18 },
    { x: 730, y: 430, w: 148, h: 18 }
  ],

  baseScrap: [
    { x: 335, y: 90, value: 90, found: false },
    { x: 545, y: 105, value: 120, found: false },
    { x: 790, y: 100, value: 70, found: false },
    { x: 95, y: 335, value: 65, found: false },
    { x: 330, y: 330, value: 105, found: false },
    { x: 550, y: 335, value: 160, found: false },
    { x: 770, y: 520, value: 85, found: false },
    { x: 745, y: 310, value: 130, found: false }
  ],

  irregularLayout: [
    { x: 300, y: 55, w: 110, h: 16 },
    { x: 505, y: 120, w: 16, h: 90 },
    { x: 700, y: 300, w: 120, h: 16 },
    { x: 70, y: 350, w: 16, h: 95 },
    { x: 350, y: 470, w: 130, h: 16 },
    { x: 540, y: 350, w: 16, h: 100 }
  ],

  // Outermost boundary walls + connect corridor segments
  connectorWalls: [
    { x: 878, y: 250, w: 44, h: 16 },
    { x: 878, y: 336, w: 44, h: 16 },
    { x: 878, y: 790, w: 44, h: 16 },
    { x: 878, y: 876, w: 44, h: 16 },
    { x: 878, y: 960, w: 44, h: 16 },
    { x: 878, y: 1046, w: 44, h: 16 }
  ],

  player: {
    spawnX: 140,
    spawnY: 290,
    radius: 10,
    speed: 120,
    maxAmmo: 6,
    maxReserveAmmo: 24,
    reloadDuration: 1.2,
    shootCooldownDuration: 1.15,
    ammoPrice: 50
  },

  items: {
    scrap: { name: '废铁', rarity: 'common', size: 1, baseValue: 50 },
    circuit: { name: '电路板', rarity: 'uncommon', size: 2, baseValue: 150 },
    rareData: { name: '加密数据', rarity: 'rare', size: 3, baseValue: 400 }
  },

  monster: {
    spawnX: 758,
    spawnY: 320,
    radius: 15,
    speed: 145,
    slowSpeed: 48,
    wallChokeSpeed: 42,
    patrolSpeedScale: 18,
    alertDistance: 360,
    alertDeaggroTimeout: 4,
    burstSpeed: 330,
    burstDuration: 0.72,
    burstCooldownDuration: 5.5,
    burstSlowDuration: 2.8,
    triggerNoiseThreshold: 48
  },

  extraction: {
    x: 100,
    y: 125,
    radius: 33
  }
};
