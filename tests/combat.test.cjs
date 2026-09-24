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
vm.runInNewContext(`${fs.readFileSync(path.join(root, 'js/entities.js'), 'utf8')}\nglobalThis.PlayerUnderTest = Player; globalThis.MonsterUnderTest = Monster;`, sandbox);
vm.runInNewContext(`${fs.readFileSync(path.join(root, 'js/game.js'), 'utf8')}\nglobalThis.GameUnderTest = Game;`, sandbox);
vm.runInNewContext(`${fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8')}\nglobalThis.UIManagerUnderTest = UIManager;`, sandbox);

const Config = sandbox.ConfigUnderTest;
const Player = sandbox.PlayerUnderTest;
const Monster = sandbox.MonsterUnderTest;
const Game = sandbox.GameUnderTest;
const UIManager = sandbox.UIManagerUnderTest;
const clearMap = { spawnPoint: { x: 100, y: 100 }, blocked: () => false, rayWallDistance: () => 650 };
const quietAudio = { context: null, lastStep: 0, playTone() {}, playSound() {} };
const testArmory = {
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
    [[6, 120, 0.38, 2], [24, 240, 0.1, 2], [8, 80, 0.8, 4], [4, 24, 1.2, 2]]
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

test('first weapon purchase charges 2000, grants its reserve package once, and does not equip it implicitly', () => {
  const game = makeGame(Player.createDefaultArmory(), 2500);

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

test('ammo selection card captions show the exact conversion ratio for each weapon', () => {
  assert.equal(UIManager.prototype.formatAmmoStock({ id: 'standard', stock: 102 }), '102 单位');
  assert.equal(UIManager.prototype.formatAmmoStock({ id: 'pistol', stock: 20 }), '20 发 · 1 单位/发');
  assert.equal(UIManager.prototype.formatAmmoStock({ id: 'revolver', stock: 24 }), '24 发 · 2 单位/发');
  assert.equal(UIManager.prototype.formatAmmoStock({ id: 'shotgun', stock: 85 }), '85 发 · 4 单位/发');
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

test('V melee hits every active target in the 50-unit radius, even through walls, and stays silent', () => {
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
  assert.deepEqual(hits, [1, 1, 0]);
  assert.equal(game.player.stamina, 10);
  assert.equal(game.player.meleeCooldown, 1);
  assert.equal(game.player.noise, 17);
});

test('ammo shop sells at least 100 base units for 1000 credits', () => {
  const game = makeGame(Player.createDefaultArmory(), 1000);

  assert.equal(game.purchaseAmmo(100), true);
  assert.equal(game.state.money, 0);
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
