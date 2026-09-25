const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const sandbox = { window: { addEventListener() {} }, performance: { now: () => 1000 }, structuredClone };
vm.runInNewContext(`${fs.readFileSync(path.join(root, 'js/config.js'), 'utf8')}\nglobalThis.ConfigUnderTest = Config;`, sandbox);
vm.runInNewContext(`${fs.readFileSync(path.join(root, 'js/map.js'), 'utf8')}\nglobalThis.MapManagerUnderTest = MapManager;`, sandbox);
vm.runInNewContext(`${fs.readFileSync(path.join(root, 'js/inventory.js'), 'utf8')}\nglobalThis.BackpackManagerUnderTest = BackpackManager;`, sandbox);
vm.runInNewContext(`${fs.readFileSync(path.join(root, 'js/game.js'), 'utf8')}\nglobalThis.GameUnderTest = Game;`, sandbox);

const Config = sandbox.ConfigUnderTest;
const MapManager = sandbox.MapManagerUnderTest;
const BackpackManager = sandbox.BackpackManagerUnderTest;
const Game = sandbox.GameUnderTest;

const expectedItems = [
  ['应急氧气罐', 30, 1, 'common'], ['EVA安全缆', 35, 1, 'common'],
  ['气闸门联锁密钥', 380, 1, 'uncommon'], ['紧急航向校准器', 4200, 2, 'rare'],
  ['聚变电容电池', 350, 2, 'uncommon'], ['辐射冷却管', 230, 1, 'uncommon'], ['浓缩核心碎块', 9000, 3, 'rare'], ['隔热检修夹具', 120, 1, 'common'],
  ['变异组织切片', 50, 1, 'common'], ['生物样本冷冻罐', 1300, 2, 'uncommon'], ['未定型拟态血清', 8200, 3, 'rare'],
  ['光纤数据阵列', 120, 1, 'common'], ['加密固态驱动器', 1050, 2, 'uncommon'], ['AI黑盒存储核', 10000, 3, 'rare'],
  ['水培滤芯', 50, 1, 'common'], ['基因编辑种子荚', 500, 1, 'uncommon'], ['发光真菌标本', 6500, 2, 'rare'],
  ['复合止血贴', 110, 1, 'common'], ['便携神经除颤器', 800, 2, 'uncommon'], ['军用休眠调节剂', 6300, 2, 'rare'],
  ['高强度合金板', 160, 2, 'common'], ['工业液压动力臂', 2100, 3, 'uncommon'], ['精炼钛金铸锭', 15200, 3, 'rare'],
  ['高密度弹药盒', 20, 1, 'common'], ['红外战术瞄具', 620, 2, 'uncommon'], ['防爆陶瓷插板', 7500, 2, 'rare'],
  ['气动扳手组', 130, 1, 'common'], ['等离子割炬喷嘴', 530, 2, 'uncommon'], ['伺服电机控制器', 6200, 2, 'rare'],
  ['旧时代合成口粮', 30, 1, 'common'], ['私人录音挂坠', 220, 1, 'uncommon'], ['走私合成雪茄盒', 6400, 2, 'rare'],
  ['耐酸过滤栅板', 90, 1, 'common'], ['重金属浓缩矿渣', 540, 2, 'uncommon'], ['密封放射性废料罐', 8000, 3, 'rare'],
  ['超导磁流体管', 130, 1, 'uncommon'], ['等离子分流线圈', 800, 2, 'uncommon'], ['重核裂解催化剂', 4500, 2, 'rare'], ['辅助电容保险芯', 100, 1, 'common'],
  ['冷凝神经突触液', 110, 1, 'common'], ['基因嵌合胚胎胶囊', 1200, 2, 'uncommon'], ['深渊外壳晶体标本', 13200, 3, 'rare'],
  ['光子量子芯片', 10, 1, 'common'], ['相干态纠缠介质', 730, 2, 'uncommon'], ['自意识架构硬盘', 24000, 3, 'rare'],
  ['荧光植物提取液', 180, 1, 'common'], ['合成土壤母质', 1400, 2, 'uncommon'], ['稀有药用孢子花粉', 4500, 1, 'rare'],
  ['生命体征记录仪', 35, 1, 'common'], ['液氮加压循环泵', 850, 2, 'uncommon'], ['特级冬眠保全血清', 9400, 2, 'rare'],
  ['矢量推力喷管', 180, 2, 'common'], ['飞船航空导航仪', 800, 2, 'uncommon'], ['反重力着陆缓冲板', 23000, 3, 'rare'],
  ['加密保全密钥卡', 25, 1, 'common'], ['高频战术防暴盾', 1600, 2, 'uncommon'], ['轨道炮瞄准主板', 8500, 2, 'rare'],
  ['耐热陶瓷坩埚', 115, 1, 'common'], ['液态金属打印喷头', 800, 2, 'uncommon'], ['重氢熔炼结晶体', 13200, 3, 'rare'],
  ['复古黑胶唱片机', 300, 2, 'common'], ['定制贵宾滤水壶', 860, 1, 'uncommon'], ['纯金星际航行勋章', 6500, 1, 'rare'],
  ['动平衡陀螺仪', 80, 1, 'common'], ['高阻尼离合轴承', 1200, 2, 'uncommon'], ['离心超导滑环', 9700, 2, 'rare'],
  ['微波信号放大器', 50, 1, 'common'], ['相控阵高频馈源', 1100, 2, 'uncommon'], ['量子跳跃信标机', 14500, 3, 'rare'],
  ['消色差复眼透镜', 70, 1, 'common'], ['光谱测绘分光棱镜', 1110, 2, 'uncommon'], ['暗物质探测晶核', 11000, 2, 'rare'],
  ['备用飞船黑匣子', 900, 2, 'uncommon'], ['量子逃生坐标芯片', 7000, 1, 'rare'], ['应急维生补给包', 250, 1, 'common'], ['钻石', 55000, 1, 'legendary']
];

test('every room uses its available rarity tiers and legendary items exist only in the evac pod', () => {
  const requiredBaseTiers = ['common', 'uncommon', 'rare'];
  for (const [roomId, room] of Object.entries(Config.roomTypes)) {
    const tiers = new Set(room.lootPool.map(item => item.rarity));
    requiredBaseTiers.forEach(tier => assert.ok(tiers.has(tier), `${roomId} lacks ${tier}`));
    assert.equal(tiers.has('legendary'), roomId === 'evacpod', `${roomId} legendary eligibility`);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(Config.lootRarityWeights)), {
    common: 80,
    uncommon: 15,
    rare: 4.8,
    legendary: 0.2
  });
});

test('all provided and approved supplemental loot values, sizes, and rarity labels are applied', () => {
  const actual = Object.values(Config.roomTypes).flatMap(room => room.lootPool);
  assert.equal(actual.length, expectedItems.length);
  const byName = new Map(actual.map(item => [item.name, item]));
  for (const [name, value, size, rarity] of expectedItems) {
    const item = byName.get(name);
    assert.ok(item, `missing loot item ${name}`);
    assert.deepEqual([item.baseValue, item.size, item.rarity], [value, size, rarity], name);
  }
  assert.equal(byName.get('钻石').shape, '1x1');
});

test('room generation preserves explicit item shapes on spawned floor loot', () => {
  const map = Object.create(MapManager.prototype);
  map.tryPlaceProp = () => null;
  map.blocked = () => false;
  map.scrap = [];
  map.random = () => 0.5;
  const diamond = Config.roomTypes.evacpod.lootPool.find(item => item.name === '钻石');
  const room = {
    type: 'evacpod',
    center: { x: 500, y: 500 },
    vertices: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }],
    doors: [],
    lootPool: [diamond]
  };

  map.populateRoom(room);

  assert.equal(map.scrap.length, 3);
  assert.ok(map.scrap.every(item => item.shape === '1x1'));
});

test('rarity rolls follow configured weights and renormalize over available room tiers', () => {
  const picker = Object.create(MapManager.prototype);
  const pool = [
    { name: 'common', rarity: 'common' },
    { name: 'uncommon', rarity: 'uncommon' },
    { name: 'rare', rarity: 'rare' },
    { name: 'legendary', rarity: 'legendary' }
  ];
  for (const [roll, expected] of [[0, 'common'], [0.7999, 'common'], [0.8, 'uncommon'], [0.9499, 'uncommon'], [0.95, 'rare'], [0.9979, 'rare'], [0.998, 'legendary']]) {
    picker.random = () => roll;
    assert.equal(picker._chooseLootTemplateByRarity(pool).name, expected, `roll ${roll}`);
  }

  const commonUncommonRare = pool.slice(0, 3);
  for (const [roll, expected] of [[0.801, 'common'], [0.81, 'uncommon'], [0.96, 'rare'], [0.9999, 'rare']]) {
    picker.random = () => roll;
    assert.equal(picker._chooseLootTemplateByRarity(commonUncommonRare).name, expected, `normalized roll ${roll}`);
  }
});

test('items sharing one rarity split that rarity chance uniformly and seeded maps reproduce loot', () => {
  const picker = Object.create(MapManager.prototype);
  const pool = [
    { name: 'common', rarity: 'common' },
    { name: 'uncommon A', rarity: 'uncommon' },
    { name: 'uncommon B', rarity: 'uncommon' },
    { name: 'rare', rarity: 'rare' }
  ];
  const draws = [0.81, 0, 0.81, 0.99];
  picker.random = () => draws.shift();
  assert.deepEqual([
    picker._chooseLootTemplateByRarity(pool).name,
    picker._chooseLootTemplateByRarity(pool).name
  ], ['uncommon A', 'uncommon B']);

  const first = new MapManager();
  const second = new MapManager();
  first.reset('small', 6142026);
  second.reset('small', 6142026);
  const snapshot = map => map.scrap.map(item => [item.id, item.name, item.value, item.rarity, item.x, item.y]);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot(first))), JSON.parse(JSON.stringify(snapshot(second))));
});

test('legendary loot displays its label in the backpack details', () => {
  const fields = new Map([['itemDesc', { textContent: '' }], ['rotateItemBtn', {}], ['discardItemBtn', {}]]);
  const previousDocument = sandbox.document;
  sandbox.document = { getElementById: id => fields.get(id) };
  try {
    const game = Object.create(Game.prototype);
    game.backpack = BackpackManager.fromType('field');
    game.ui = { formatCreditText: amount => `${amount} 信用点` };
    game.backpack.place({ id: 100, name: '钻石', size: 1, shape: '1x1', value: 55000, rarity: 'legendary' });
    game.selectedItemId = 100;
    game._updateBackpackReadout();
    assert.match(fields.get('itemDesc').textContent, /传说/);
  } finally {
    if (previousDocument === undefined) delete sandbox.document;
    else sandbox.document = previousDocument;
  }
});
