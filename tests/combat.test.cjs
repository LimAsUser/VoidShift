const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const sandbox = {
  window: { addEventListener() {} },
  performance: { now: () => 1000 },
  structuredClone
};
vm.runInNewContext(`${fs.readFileSync(path.join(root, 'js/config.js'), 'utf8')}\nglobalThis.ConfigUnderTest = Config;`, sandbox);
vm.runInNewContext(`${fs.readFileSync(path.join(root, 'js/inventory.js'), 'utf8')}\nglobalThis.BackpackManagerUnderTest = BackpackManager;`, sandbox);
vm.runInNewContext(`${fs.readFileSync(path.join(root, 'js/entities.js'), 'utf8')}\nglobalThis.PlayerUnderTest = Player; globalThis.MonsterUnderTest = Monster;`, sandbox);
vm.runInNewContext(`${fs.readFileSync(path.join(root, 'js/game.js'), 'utf8')}\nglobalThis.GameUnderTest = Game;`, sandbox);
vm.runInNewContext(`${fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8')}\nglobalThis.UIManagerUnderTest = UIManager;`, sandbox);

const Config = sandbox.ConfigUnderTest;
const BackpackManager = sandbox.BackpackManagerUnderTest;
const Player = sandbox.PlayerUnderTest;
const Monster = sandbox.MonsterUnderTest;
const Game = sandbox.GameUnderTest;
const UIManager = sandbox.UIManagerUnderTest;
const clearMap = { spawnPoint: { x: 100, y: 100 }, blocked: () => false, rayWallDistance: () => 650 };
const quietAudio = { context: null, lastStep: 0, playTone() {}, playSound() {} };
const testArmory = {
  ownedPassives: { roll: true }, equippedPassive: 'roll',
  ownedWeapons: { pistol: true, smg: true, shotgun: false, revolver: false },
  loadout: { primary: 'smg', sidearm: 'pistol' },
  weaponAmmo: {
    pistol: { magazine: 6, reserve: 120 },
    smg: { magazine: 24, reserve: 240 },
    shotgun: { magazine: 0, reserve: 0 },
    revolver: { magazine: 0, reserve: 0 }
  }
};
let savedRecord = null;
sandbox.localStorage = {
  getItem: () => savedRecord,
  setItem: (_key, value) => { savedRecord = value; }
};

function makeGame(armory = testArmory, money = 5000) {
  const game = Object.create(Game.prototype);
  game.state = { running: false, money, coop: { role: null } };
  game.player = new Player();
  game.player.reset(clearMap, armory);
  game.ui = { showToast() {}, updateAmmoDepot() {}, updateLoadout() {} };
  game.ammoTransferSelection = { source: 'standard', target: 'pistol' };
  game.audio = { playTone() {}, playSpatialTone() {} };
  game._save = () => {};
  game.updateMoneyUI = () => {};
  game.updateLoadoutUI = () => {};
  return game;
}

test('equipped primary and sidearm retain separate magazine and reserve counts when switching', () => {
  const player = new Player();
  player.reset(clearMap, testArmory);

  assert.equal(player.weaponId, 'smg');
  player.ammo = 11;
  assert.equal(player.switchWeaponSlot('sidearm'), true);
  assert.equal(player.weaponId, 'pistol');
  player.ammo = 3;
  assert.equal(player.switchWeaponSlot('primary'), true);

  assert.equal(player.weaponId, 'smg');
  assert.equal(player.ammo, 11);
  assert.equal(player.switchWeaponSlot('sidearm'), true);
  assert.equal(player.ammo, 3);
});

test('stamina depletion locks sprint until full recovery but still allows walking', () => {
  const player = new Player();
  player.reset(clearMap, testArmory);
  player.stamina = 2;

  player.update(0.1, { d: true, shift: true }, false, clearMap, quietAudio);
  assert.equal(player.stamina, 0);
  assert.equal(player.staminaLocked, true);

  player.update(0.1, { d: true, shift: true }, false, clearMap, quietAudio);
  assert.equal(player.moveSpeed, Config.player.speed);
  assert.equal(player.staminaLocked, true);
  player.update(6, {}, false, clearMap, quietAudio);
  assert.equal(player.staminaLocked, false);
  assert.equal(player.stamina, 100);
  player.stamina = 100;
  player.update(0.1, { d: true, shift: true }, false, clearMap, quietAudio);
  assert.equal(player.moveSpeed, Config.player.sprintSpeed);
});

test('sprint spends the final fractional stamina instead of stopping above zero', () => {
  const player = new Player();
  player.reset(clearMap, testArmory);
  player.stamina = 0.5;
  player.update(0.05, { d: true, shift: true }, false, clearMap, quietAudio);
  assert.equal(player.stamina, 0);
  assert.equal(player.staminaLocked, true);
  assert.equal(player.moveSpeed, 150);
});

test('sprint moves 150 units per second without changing walking or stamina cost', () => {
  const player = new Player();
  player.reset(clearMap, testArmory);
  player.update(0.2, { d: true, shift: true }, false, clearMap, quietAudio);
  assert.equal(player.x, 130);
  assert.equal(player.stamina, 94);
  player.update(0.2, { d: true }, false, clearMap, quietAudio);
  assert.equal(player.x, 144);
  assert.equal(player.stamina, 94);
});

test('normal Monster pursuit is 385 while crossing-wall movement stays 28', () => {
  const target = { x: 1000, y: 100, noise: 100, invulnerable: false };
  const makeMonster = () => {
    const monster = new Monster();
    Object.assign(monster, { active: true, alerted: true, x: 100, y: 100, stagger: 0, recoverTimer: 0 });
    return monster;
  };
  const clear = makeMonster();
  clear.update(0.1, target, 100, { blocked: () => false, getRoomAt: () => null }, quietAudio);
  assert.ok(Math.abs(clear.x - 138.5) < 0.001);
  const blocked = makeMonster();
  blocked.update(0.1, target, 100, { blocked: () => true, getRoomAt: () => null }, quietAudio);
  assert.equal(Math.round((blocked.x - 100) * 10), 28);
});

test('Monster stays incapacitated for twenty seconds after its fifth hit', () => {
  const monster = new Monster();
  for (let i = 0; i < 4; i++) assert.equal(monster.registerHit().triggeredRecovery, false);
  assert.equal(monster.registerHit().triggeredRecovery, true);
  assert.equal(monster.recoverTimer, 20);
  assert.equal(monster.stagger, 20);
  monster.active = true;
  const map = { blocked: () => false, getRoomAt: () => null };
  assert.equal(monster.update(19.9, { x: 1000, y: 1000, noise: 0 }, 0, map, quietAudio).recovering, true);
  assert.ok(monster.recoverTimer > 0);
  assert.equal(monster.update(0.2, { x: 1000, y: 1000, noise: 0 }, 0, map, quietAudio).recovered, true);
});

test('a successful pickup adds exactly five noise', () => {
  const game = makeGame(testArmory, 0);
  const item = { id: 'scrap', name: '物资', shape: '1x1', value: 80, x: 100, y: 100, found: false };
  game.state.running = true;
  game.state.loot = 0;
  game.state.lootValue = 0;
  game.player.x = 100;
  game.player.y = 100;
  game.player.noise = 10;
  game.map = { scrap: [item] };
  game.backpack = BackpackManager.fromType('field');
  game._backpackFor = () => game.backpack;
  game._tutorialAction = () => {};
  game.updateInventoryUI = () => {};
  game.ui.log = () => {};
  assert.equal(game.collect(), true);
  assert.equal(game.player.noise, 15);
});

test('transaction notices retain only three recent results and begin fading after ten seconds', () => {
  const timers = [];
  sandbox.setTimeout = (callback, delay) => { timers.push({ callback, delay }); return timers.length; };
  sandbox.document = { createElement: () => ({ children: [], classList: { add(value) { this.value = value; } },
    append(...children) { this.children.push(...children); }, addEventListener() {}, setAttribute() {}, remove() { this.removed = true; } }) };
  sandbox.window.matchMedia = () => ({ matches: false });
  const stack = { children: [], appendChild(node) { node.remove = () => { this.children.splice(this.children.indexOf(node), 1); }; this.children.push(node); }, get firstElementChild() { return this.children[0]; } };
  const ui = { transactionNoticeStack: stack };
  for (const message of ['A','B','C','D']) UIManager.prototype.showTransactionNotice.call(ui, message);
  assert.equal(stack.children.length, 3);
  assert.equal(stack.children[0].children[0].textContent, 'B');
  assert.equal(timers[0].delay, 10000);
  timers[1].callback();
  assert.equal(stack.children[0].classList.value, 'leaving');
  assert.equal(timers.at(-1).delay, 600);
});

test('successful ammo purchase reports a persistent transaction notice with the bought amount', () => {
  const game = makeGame(testArmory, 5000);
  const notices = [];
  game.ui.showTransactionNotice = message => notices.push(message);
  game.updateAmmoDepotUI = () => {};
  assert.equal(game.purchaseAmmo(100), true);
  assert.match(notices[0], /100/);
});

test('monster contact during a roll neither damages nor teleports the monster', () => {
  const monster = new Monster();
  monster.active = true;
  monster.alerted = true;
  monster.x = 101;
  monster.y = 100;
  monster.stagger = 0.1;
  const player = { x: 100, y: 100, noise: 0, invulnerable: true };
  const map = { blocked: () => false, getRoomAt: () => null, monsterSpawns: [{ x: 700, y: 700 }] };

  const result = monster.update(0.05, player, 0, map, quietAudio);

  assert.equal(result.playerHit, false);
  assert.deepEqual([monster.x, monster.y], [101, 100]);
});

test('vulnerable monster contact still registers and teleports after a hit', () => {
  const monster = new Monster();
  monster.active = true;
  monster.alerted = true;
  monster.x = 101;
  monster.y = 100;
  monster.stagger = 0.1;
  const player = { x: 100, y: 100, noise: 0, invulnerable: false };
  const map = { blocked: () => false, getRoomAt: () => null, monsterSpawns: [{ x: 700, y: 700 }] };

  const result = monster.update(0.05, player, 0, map, quietAudio);

  assert.equal(result.playerHit, true);
  assert.deepEqual([monster.x, monster.y], [700, 700]);
});

test('rolling can spend any positive stamina up to 20, including a fractional remainder', () => {
  const player = new Player();
  player.reset(clearMap, testArmory);
  player.stamina = 0.5;

  assert.equal(player.startRoll(1, 0), true);
  assert.equal(player.stamina, 0);
  assert.equal(player.staminaLocked, true);
});

test('stamina regeneration waits one full second after spending', () => {
  const player = new Player();
  player.reset(clearMap, testArmory);
  player.stamina = 50;
  assert.equal(player.startMelee(), true);

  player.update(0.75, {}, false, clearMap, quietAudio);
  assert.equal(player.stamina, 40);
  player.update(0.24, {}, false, clearMap, quietAudio);
  assert.equal(player.stamina, 40);
  player.update(0.02, {}, false, clearMap, quietAudio);
  assert.ok(player.stamina > 40);

  const sprinter = new Player();
  sprinter.reset(clearMap, testArmory);
  sprinter.stamina = 50;
  sprinter.update(0.5, { d: true, shift: true }, false, clearMap, quietAudio);
  assert.equal(sprinter.stamina, 35);
  sprinter.update(0.99, {}, false, clearMap, quietAudio);
  assert.equal(sprinter.stamina, 35);
  sprinter.update(0.02, {}, false, clearMap, quietAudio);
  assert.ok(sprinter.stamina > 35);
});

test('a downed player can crawl at 20 units per second without sprinting', () => {
  const player = new Player();
  player.reset(clearMap, testArmory);
  player.downed = true;
  player.x = 100;
  player.y = 100;

  player.update(1, { d: true, shift: true }, false, clearMap, quietAudio, []);

  assert.equal(player.x, 120);
  assert.equal(player.moveSpeed, 20);
  assert.equal(player.stamina, 100);
});

test('a downed player can only fire the sidearm and always fires without aiming', () => {
  const game = makeGame();
  const calls = [];
  game.state.running = true;
  game.state.stabilized = true;
  game.state.coop = { role: null, running: false, hostPaused: false };
  game.player.downed = true;
  game.player.activeSlot = 'sidearm';
  game.player.shoot = aiming => { calls.push(aiming); return { fired: false, reason: 'cooldown' }; };

  game.shoot(game.player);
  game.player.activeSlot = 'primary';
  game.shoot(game.player);

  assert.deepEqual(calls, [false]);
  assert.equal(game._isPlayerAiming(game.player), false);
});

test('a downed player cannot roll or melee while waiting for rescue', () => {
  const game = makeGame();
  game.state.running = true;
  game.state.coop = { role: null, running: false, hostPaused: false };
  game.player.downed = true;

  assert.equal(game.roll(), false);
  assert.equal(game.melee(), false);
});

test('a roll consumes 20 stamina, travels 100 units over 0.35 seconds and grants only timed invulnerability', () => {
  const player = new Player();
  player.reset(clearMap, testArmory);
  player.stamina = 50;

  assert.equal(player.startRoll(1, 0), true);
  assert.equal(player.stamina, 30);
  const halfRoll = player.update(0.175, {}, false, clearMap, quietAudio);
  assert.equal(player.x, 150);
  assert.equal(halfRoll.rollFinished, false);
  assert.equal(player.invulnerable, true);
  const endRoll = player.update(0.175, {}, false, clearMap, quietAudio);
  assert.equal(player.x, 200);
  assert.equal(endRoll.rollFinished, true);
  assert.equal(player.invulnerable, true);
  player.update(0.001, {}, false, clearMap, quietAudio);
  assert.equal(player.invulnerable, false);
});

test('weapon catalog carries the agreed magazine, reserve, cadence, reload and noise values', () => {
  assert.deepEqual(
    ['pistol', 'smg', 'shotgun', 'revolver'].map(id => {
      const weapon = Config.weapons[id];
      return [weapon.maxAmmo, weapon.initialReserve, weapon.shootCooldownDuration, weapon.shotNoise];
    }),
    [[6, 120, 0.4, 2], [24, 240, 0.1, 2], [8, 80, 0.8, 4], [4, 24, 1.2, 2]]
  );
});

test('shell loading inserts one round at a time and switching cancels only the pending round', () => {
  const player = new Player();
  const armory = Player.normalizeArmory({
    ...testArmory,
    ownedWeapons: { ...testArmory.ownedWeapons, shotgun: true },
    loadout: { primary: 'shotgun', sidearm: 'pistol' },
    weaponAmmo: {
      ...testArmory.weaponAmmo,
      shotgun: { magazine: 6, reserve: 5 }
    }
  });
  player.reset(clearMap, armory);

  assert.equal(player.reload(quietAudio), true);
  player.update(0.5, {}, false, clearMap, quietAudio);
  assert.equal(player.ammo, 7);
  assert.equal(player.reserveAmmo, 4);
  assert.equal(player.reloading, 0.5);

  assert.equal(player.switchWeaponSlot('sidearm'), true);
  assert.equal(player.reloading, 0);
  assert.equal(player.switchWeaponSlot('primary'), true);
  assert.equal(player.ammo, 7);
  assert.equal(player.reserveAmmo, 4);

  const shot = player.shoot(false, clearMap, quietAudio, { active: false });
  assert.equal(shot.fired, true);
  assert.equal(shot.reloadInterrupted, false);
  assert.equal(player.ammo, 6);
  assert.equal(player.reloading, 0);
});

test('shell reload reports completion only after reaching the magazine limit', () => {
  const player = new Player();
  player.reset(clearMap, Player.normalizeArmory({
    ...testArmory,
    ownedWeapons: { ...testArmory.ownedWeapons, shotgun: true },
    loadout: { primary: 'shotgun', sidearm: 'pistol' },
    weaponAmmo: { ...testArmory.weaponAmmo, shotgun: { magazine: 6, reserve: 5 } }
  }));
  player.reload(quietAudio);

  const firstShell = player.update(0.5, {}, false, clearMap, quietAudio);
  assert.equal(firstShell.shellLoaded, true);
  assert.equal(firstShell.reloaded, false);
  const finish = player.update(0.5, {}, false, clearMap, quietAudio);
  assert.equal(finish.shellLoaded, true);
  assert.equal(finish.reloaded, true);
  assert.equal(player.ammo, 8);
});

test('starting a melee swing consumes 10 stamina and applies its one-second cooldown', () => {
  const player = new Player();
  player.reset(clearMap, testArmory);
  player.stamina = 20;

  assert.equal(player.startMelee(), true);
  assert.equal(player.stamina, 10);
  assert.equal(player.meleeCooldown, 1);
  assert.equal(player.startMelee(), false);
});

test('firing during shell reload preserves loaded rounds and interrupts the incomplete shell', () => {
  const player = new Player();
  player.reset(clearMap, Player.normalizeArmory({
    ...testArmory,
    ownedWeapons: { ...testArmory.ownedWeapons, shotgun: true },
    loadout: { primary: 'shotgun', sidearm: 'pistol' },
    weaponAmmo: { ...testArmory.weaponAmmo, shotgun: { magazine: 6, reserve: 5 } }
  }));

  player.reload(quietAudio);
  const shot = player.shoot(false, clearMap, quietAudio, { active: false });

  assert.equal(shot.fired, true);
  assert.equal(shot.reloadInterrupted, true);
  assert.equal(player.ammo, 5);
  assert.equal(player.reserveAmmo, 5);
  assert.equal(player.reloading, 0);
});

test('first SMG purchase charges 4250, grants its reserve package once, and does not equip it implicitly', () => {
  const game = makeGame(Player.createDefaultArmory(), 4750);

  assert.equal(game.purchaseWeapon('smg'), true);
  assert.equal(game.state.money, 500);
  assert.equal(game.player.armory.ownedWeapons.smg, true);
  assert.deepEqual(
    [game.player.armory.weaponAmmo.smg.magazine, game.player.armory.weaponAmmo.smg.reserve],
    [24, 240]
  );
  assert.equal(game.player.armory.loadout.primary, null);
  assert.equal(game.purchaseWeapon('smg'), false);
  assert.equal(game.state.money, 500);
});

test('weapon purchases deduct the listed price for every paid weapon', () => {
  for (const [weaponId, price] of [['smg', 4250], ['shotgun', 15250], ['revolver', 5500]]) {
    const game = makeGame(Player.createDefaultArmory(), price + 300);
    assert.equal(game.purchaseWeapon(weaponId), true, weaponId);
    assert.equal(game.state.money, 300, weaponId);
  }
});

test('ammo depot converts reserves by weapon ratio and keeps unconvertible standard units', () => {
  const armory = Player.normalizeArmory({
    ...testArmory,
    ownedWeapons: { ...testArmory.ownedWeapons, shotgun: true },
    weaponAmmo: { ...testArmory.weaponAmmo, smg: { magazine: 24, reserve: 7 } }
  });
  const game = makeGame(armory, 0);

  assert.equal(game.transferAmmo('smg', 'shotgun', 7), true);
  assert.equal(game.player.armory.weaponAmmo.smg.reserve, 0);
  assert.equal(game.player.armory.weaponAmmo.shotgun.reserve, 1);
  assert.equal(game.player.armory.standardAmmoUnits, 3);
  assert.equal(game.transferAmmo('smg', 'shotgun', 1), false);
});

test('ammo transfer preview reports converted rounds and remainder for bank and weapon sources', () => {
  const armory = Player.normalizeArmory({
    ...testArmory,
    ownedWeapons: { ...testArmory.ownedWeapons, shotgun: true },
    standardAmmoUnits: 102,
    weaponAmmo: { ...testArmory.weaponAmmo, smg: { magazine: 24, reserve: 7 } }
  });
  const game = makeGame(armory, 0);

  const bankPreview = game.getAmmoTransferPreview('standard', 'shotgun', 30);
  assert.deepEqual([bankPreview.valid, bankPreview.rounds, bankPreview.remainder, bankPreview.sourceAvailable], [true, 7, 2, 102]);
  const smgPreview = game.getAmmoTransferPreview('smg', 'shotgun', 7);
  assert.deepEqual([smgPreview.valid, smgPreview.rounds, smgPreview.remainder, smgPreview.sourceAvailable], [true, 1, 3, 7]);
});

test('ammo selection card captions show only rounds for each weapon', () => {
  assert.equal(UIManager.prototype.formatAmmoStock({ id: 'standard', stock: 102 }), '102 单位');
  assert.equal(UIManager.prototype.formatAmmoStock({ id: 'pistol', stock: 20 }), '20 发');
  assert.equal(UIManager.prototype.formatAmmoStock({ id: 'revolver', stock: 24 }), '24 发');
  assert.equal(UIManager.prototype.formatAmmoStock({ id: 'shotgun', stock: 85 }), '85 发');
});

test('crew loadout captions use equipped slot IDs without exposing ammo stocks', () => {
  const rows = UIManager.prototype.crewLoadoutRows({ primary: 'shotgun', sidearm: 'revolver' });
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [
    { key: '1', id: 'shotgun', label: '散弹枪' },
    { key: '2', id: 'revolver', label: '左轮' }
  ]);
});

test('ammo transfer selection swaps the opposing side when the same stock is clicked', () => {
  const game = makeGame();

  assert.equal(game.selectAmmoTransfer('source', 'pistol'), true);
  assert.deepEqual(game.ammoTransferSelection, { source: 'pistol', target: 'standard' });
});

test('failure ammo disclosure matches each difficulty penalty', () => {
  const game = makeGame();

  assert.match(game.getAmmoLossWarning('easy'), /保留所有携带弹药/);
  assert.match(game.getAmmoLossWarning('medium'), /损失一半（向下取整）/);
  assert.match(game.getAmmoLossWarning('hard'), /全部损失/);
  for (const difficulty of ['easy', 'medium', 'hard']) {
    assert.match(game.getAmmoLossWarning(difficulty), /未装备武器与弹药库.*不受影响/);
  }
});

test('revolver piercing resolves the first three enemies before the wall and never hits beyond it', () => {
  const game = Object.create(Game.prototype);
  const hits = [];
  const monster = { x: 100, y: 0, radius: 10, active: true };
  const hunters = [200, 300, 400].map(x => ({ x, y: 0, radius: 10, active: true, dead: false }));
  game.map = { rayWallDistance: () => 650 };
  game.monster = monster;
  game.hunters = hunters;
  const shooter = { x: 0, y: 0, radius: 10 };

  game._resolveWeaponAttack(shooter, Config.weapons.revolver, [0], (target) => hits.push(target));

  assert.deepEqual(hits, [monster, hunters[0], hunters[1]]);
});

test('weapon rays stop at walls even when their target lies within weapon range', () => {
  const game = Object.create(Game.prototype);
  const hits = [];
  const hunter = { x: 200, y: 0, radius: 10, active: true, dead: false };
  game.map = { rayWallDistance: () => 150 };
  game.monster = { active: false };
  game.hunters = [hunter];

  const result = game._resolveWeaponAttack({ x: 0, y: 0 }, Config.weapons.pistol, [0], target => hits.push(target));

  assert.equal(hits.length, 0);
  assert.equal(result[0].endX, 150);
});

test('co-op players block each other during normal movement and rolls', () => {
  const player = new Player();
  player.reset(clearMap, testArmory);
  player.x = 100;
  player.y = 100;
  const teammate = { x: 125, y: 100, radius: player.radius };

  player.move(0.1, { d: true }, false, clearMap, quietAudio, [teammate]);
  assert.equal(player.x, 100);

  player.startRoll(1, 0);
  player.update(0.05, {}, false, clearMap, quietAudio, [teammate]);
  assert.equal(player.x, 100);
});

test('friendly-fire setting controls whether teammates are targets in weapon rays', () => {
  const game = Object.create(Game.prototype);
  const shooter = { x: 0, y: 0, radius: 12 };
  const teammate = { x: 100, y: 0, radius: 12, downed: false };
  game.state = { coop: { running: true, friendlyFire: true } };
  game.player = shooter;
  game.remotePlayer = teammate;
  game.monster = { active: false };
  game.hunters = [];
  game.map = { rayWallDistance: () => 650 };

  const enabledHits = game._resolveWeaponAttack(shooter, Config.weapons.pistol, [0])[0].hitTargets;
  assert.equal(enabledHits.length, 1);
  assert.equal(enabledHits[0], teammate);

  game.state.coop.friendlyFire = false;
  assert.equal(game._resolveWeaponAttack(shooter, Config.weapons.pistol, [0])[0].hitTargets.length, 0);
});

test('friendly-fire projectile damage uses weapon damage and respects roll invulnerability', () => {
  const game = Object.create(Game.prototype);
  const shooter = new Player();
  const teammate = new Player();
  shooter.reset(clearMap, testArmory);
  teammate.reset(clearMap, testArmory);
  game.player = shooter;
  game.remotePlayer = teammate;
  game.state = { coop: { running: true, friendlyFire: true } };
  game.ui = {};

  game._applyProjectileHit(teammate, shooter, 0);
  assert.equal(teammate.health, 99);
  teammate.startRoll(1, 0);
  game._applyProjectileHit(teammate, shooter, 0);
  assert.equal(teammate.health, 99);
});

test('roll immunity blocks attack HP, oxygen and stun damage but not ordinary oxygen drain', () => {
  const game = Object.create(Game.prototype);
  const player = new Player();
  player.reset(clearMap, testArmory);
  player.health = 100;
  player.oxygen = 80;
  player.startRoll(1, 0);

  assert.equal(game._applyDamage(player, 10, 8, 2.5).blocked, true);
  assert.deepEqual([player.health, player.oxygen, player.stunned], [100, 80, 0]);
  player.oxygen -= 1;
  assert.equal(player.oxygen, 79);
});

test('a shotgun trigger emits four pellet angles across the configured hip or aimed cone but adds noise once', () => {
  const hip = new Player();
  hip.reset(clearMap, Player.normalizeArmory({
    ...testArmory,
    ownedWeapons: { ...testArmory.ownedWeapons, shotgun: true },
    loadout: { primary: 'shotgun', sidearm: 'pistol' },
    weaponAmmo: { ...testArmory.weaponAmmo, shotgun: { magazine: 8, reserve: 80 } }
  }));
  const hipShot = hip.shoot(false, clearMap, quietAudio, { active: false });
  assert.equal(hipShot.shotAngles.length, 4);
  assert.ok(Math.abs((hipShot.shotAngles[3] - hipShot.shotAngles[0]) * 180 / Math.PI - 40) < 0.001);
  assert.equal(hip.noise, 4);

  const aimed = new Player();
  aimed.reset(clearMap, hip.armory);
  const aimedShot = aimed.shoot(true, clearMap, quietAudio, { active: false });
  assert.ok(Math.abs((aimedShot.shotAngles[3] - aimedShot.shotAngles[0]) * 180 / Math.PI - 8) < 0.001);
});

test('V melee hits every active target in the 55-unit radius, even through walls, and stays silent', () => {
  const game = makeGame(testArmory, 0);
  game.state.running = true;
  game.state.tutorial = null;
  game.player.x = 100;
  game.player.y = 100;
  game.player.stamina = 20;
  game.player.noise = 17;
  game.map = { blocked: () => true };
  game.monster = { active: false };
  const hits = [0, 0, 0];
  game.hunters = [
    { x: 120, y: 100, radius: 10, active: true, dead: false, registerHit() { hits[0]++; return { hit: true, dead: false }; }, waypoints: [], waypointTimer: 0 },
    { x: 100, y: 145, radius: 10, active: true, dead: false, registerHit() { hits[1]++; return { hit: true, dead: false }; }, waypoints: [], waypointTimer: 0 },
    { x: 151, y: 100, radius: 10, active: true, dead: false, registerHit() { hits[2]++; return { hit: true, dead: false }; }, waypoints: [], waypointTimer: 0 }
  ];

  assert.equal(game.melee(), true);
  assert.deepEqual(hits, [1, 1, 1]);
  assert.equal(game.player.stamina, 10);
  assert.equal(game.player.meleeCooldown, 1);
  assert.equal(game.player.noise, 17);
});

test('ammo shop sells at least 100 base units for 200 credits', () => {
  const game = makeGame(Player.createDefaultArmory(), 1000);

  assert.equal(game.purchaseAmmo(100), true);
  assert.equal(game.state.money, 800);
  assert.equal(game.player.armory.standardAmmoUnits, 100);
  assert.equal(game.purchaseAmmo(99), false);
});

test('medium failure loses half of carried ammo rounded down per equipped weapon only', () => {
  const armory = Player.normalizeArmory({
    ...testArmory,
    ownedWeapons: { ...testArmory.ownedWeapons, shotgun: true },
    loadout: { primary: 'smg', sidearm: 'pistol' },
    weaponAmmo: {
      ...testArmory.weaponAmmo,
      pistol: { magazine: 6, reserve: 120 },
      smg: { magazine: 24, reserve: 240 },
      shotgun: { magazine: 8, reserve: 80 }
    }
  });
  const game = makeGame(armory, 0);
  game.state.selectedDifficulty = 'medium';

  game._settlePlayerAmmo(game.player, false);

  assert.deepEqual(
    [game.player.armory.weaponAmmo.smg.magazine, game.player.armory.weaponAmmo.smg.reserve],
    [24, 108]
  );
  assert.deepEqual(
    [game.player.armory.weaponAmmo.pistol.magazine, game.player.armory.weaponAmmo.pistol.reserve],
    [6, 57]
  );
  assert.deepEqual(
    [game.player.armory.weaponAmmo.shotgun.magazine, game.player.armory.weaponAmmo.shotgun.reserve],
    [8, 80]
  );
});

test('easy preserves carried rounds and hard loses them without touching the ammo bank', () => {
  const armory = Player.normalizeArmory({
    ...testArmory,
    standardAmmoUnits: 55,
    loadout: { primary: 'smg', sidearm: 'pistol' },
    weaponAmmo: {
      ...testArmory.weaponAmmo,
      smg: { magazine: 12, reserve: 10 },
      pistol: { magazine: 3, reserve: 4 }
    }
  });
  const game = makeGame(armory, 0);
  game.state.selectedDifficulty = 'easy';
  game._settlePlayerAmmo(game.player, false);
  assert.deepEqual([game.player.armory.weaponAmmo.smg.magazine, game.player.armory.weaponAmmo.smg.reserve], [12, 10]);

  game.state.selectedDifficulty = 'hard';
  game._settlePlayerAmmo(game.player, false);
  assert.deepEqual([game.player.armory.weaponAmmo.smg.magazine, game.player.armory.weaponAmmo.smg.reserve], [0, 0]);
  assert.deepEqual([game.player.armory.weaponAmmo.pistol.magazine, game.player.armory.weaponAmmo.pistol.reserve], [0, 0]);
  assert.equal(game.player.armory.standardAmmoUnits, 55);
});

test('tutorial filters weapon-switch practice until both equipped slots are owned', () => {
  const game = Object.create(Game.prototype);
  game.player = { armory: { loadout: { primary: null, sidearm: 'pistol' } } };
  assert.equal(game._tutorialStepsForPlayer().some(step => step.requiresWeaponPair), false);

  game.player.armory.loadout.primary = 'smg';
  assert.equal(game._tutorialStepsForPlayer().some(step => step.actions.includes('roll')), false);
  game.player.armory.equippedPassive = 'roll';
  assert.equal(game._tutorialStepsForPlayer().some(step => step.requiresWeaponPair), true);
  assert.equal(game._tutorialStepsForPlayer().some(step => step.actions.includes('roll')), true);
  assert.equal(game._tutorialStepsForPlayer().some(step => step.actions.includes('melee')), true);
});

test('legacy saves preserve credits and cargo but migrate weapon ownership to pistol only', () => {
  savedRecord = JSON.stringify({
    money: 2875,
    storageItems: [{ name: '旧存档物资', value: 50 }],
    selectedWeapon: 'smg',
    fpsCap: '60'
  });
  const game = Object.create(Game.prototype);
  game.state = { money: 1000, storageItems: [], selectedDifficulty: 'medium', fpsCap: '60' };
  game.player = new Player();

  game._loadSave();

  assert.equal(game.state.money, 2875);
  assert.equal(game.state.storageItems.length, 1);
  assert.equal(game.player.armory.ownedWeapons.pistol, true);
  assert.equal(game.player.armory.ownedWeapons.smg, false);
  assert.equal(game.player.armory.weaponAmmo.pistol.reserve, 120);
});

test('co-op player snapshots preserve active slot, weapon stocks, stamina lockout and roll immunity', () => {
  const game = Object.create(Game.prototype);
  const owner = new Player();
  owner.reset(clearMap, testArmory);
  owner.weaponTimers.smg.reloadTimer = 0.25;
  owner.weaponTimers.smg.reloadMode = 'shell';
  owner.staminaLocked = true;
  owner.staminaRegenDelay = 0.75;
  owner.dodgeTimer = 0.2;
  owner.invulnerableThisFrame = true;
  const snapshot = game._playerSnapshot(owner);

  const replica = new Player();
  replica.reset(clearMap, Player.createDefaultArmory());
  game._applyPlayerSnapshot(replica, snapshot);

  assert.equal(replica.weaponId, 'smg');
  assert.deepEqual([replica.ammo, replica.reserveAmmo], [24, 240]);
  assert.equal(replica.weaponTimers.smg.reloadTimer, 0.25);
  assert.equal(replica.staminaLocked, true);
  assert.equal(replica.staminaRegenDelay, 0.75);
  assert.equal(replica.invulnerable, true);
});
