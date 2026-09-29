const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const context = vm.createContext({ performance: { now: () => 0 } });
for (const name of ['config', 'entities']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', `${name}.js`), 'utf8'), context);
}
const { Config, Player, Hunter, Monster, Heavy, recoverStuckPursuer } =
  vm.runInContext('({ Config, Player, Hunter, Monster, Heavy, recoverStuckPursuer })', context);
const clearMap = {
  spawnPoint: { x: 100, y: 100 }, blocked: () => false,
  rayWallDistance: (_x, _y, _dx, _dy, distance) => distance,
  getRoomAt: () => null, worldRooms: [], monsterSpawns: [{ x: 900, y: 900 }]
};
const audio = { context: null, lastStep: 0, playSound() {}, playTone() {}, playSpatialTone() {} };

function equippedPlayer(id) {
  const player = new Player();
  player.reset(clearMap);
  if (id !== 'pistol') assert.equal(player.unlockWeapon(id), true);
  assert.equal(player.setWeapon(id), true);
  if (Config.weapons[id].slot === 'primary') player.switchWeaponSlot('primary');
  return player;
}

for (const [id, interval, duration, capacity] of [
  ['pistol', 0.4, 2, 6], ['smg', 0.1, 4, 24],
  ['shotgun', 0.6, 1, 8], ['revolver', 0.5, 2, 4]
]) {
  test(`${id} enforces its fire interval and reloads the entire magazine at the new duration`, () => {
    const player = equippedPlayer(id);
    assert.equal(player.ammo, capacity);
    assert.equal(player.shoot(false, clearMap, audio).fired, true);
    player.update(interval - 0.01, {}, false, clearMap, audio);
    assert.equal(player.shoot(false, clearMap, audio).reason, 'cooldown');
    player.update(0.02, {}, false, clearMap, audio);
    assert.equal(player.shoot(false, clearMap, audio).fired, true);
    player.ammo = 0;
    player.reserveAmmo = capacity;
    assert.equal(player.reload(audio), true);
    player.update(duration - 0.01, {}, false, clearMap, audio);
    assert.equal(player.ammo, 0);
    player.update(0.02, {}, false, clearMap, audio);
    assert.equal(player.ammo, capacity);
    assert.equal(player.reserveAmmo, 0);
  });
}

test('machinegun and mini-shotgun unlock with a full magazine and no reserve, persist independently, and use separate ammo packs', () => {
  const player = new Player();
  for (const [id, capacity, packSize, packPrice] of [
    ['machinegun', 100, 100, 200], ['mini-shotgun', 2, 10, 50]
  ]) {
    assert.equal(player.armory.ownedWeapons[id], false);
    assert.equal(player.unlockWeapon(id), true);
    assert.equal(player.armory.weaponAmmo[id].magazine, capacity);
    assert.equal(player.armory.weaponAmmo[id].reserve, 0);
    assert.equal(player.unlockWeapon(id), false);
    assert.equal(Config.ammo.standardUnitsPerRound[id], undefined);
    assert.equal(Config.ammo.weaponPacks[id].unitsPerPurchase, packSize);
    assert.equal(Config.ammo.weaponPacks[id].pricePerPurchase, packPrice);
    player.armory.weaponAmmo[id].reserve = 13;
  }
  const saved = Player.normalizeArmory(player.exportArmory());
  assert.equal(saved.weaponAmmo.machinegun.reserve, 13);
  assert.equal(saved.weaponAmmo['mini-shotgun'].reserve, 13);
});

test('machinegun shoots for two damage and reloads all 100 rounds after ten seconds', () => {
  const player = equippedPlayer('machinegun');
  const shot = player.shoot(false, clearMap, audio);
  assert.equal(shot.fired, true);
  assert.equal(player.ammo, 99);
  assert.equal(player.shootCooldown, 0.3);
  assert.equal(player.weapon.purchasePrice, 15000);
  assert.equal(player.weapon.automatic, true);
  assert.equal(player.weapon.damage, 2);
  assert.equal(player.weapon.penetrationTargets, 1);
  assert.equal(player.weapon.hipSpread, 0.52);
  assert.equal(player.weapon.aimSpread, 0.26);
  assert.equal(player.weapon.shotNoise, Config.weapons.smg.shotNoise);
  assert.equal(player.weapon.recoilAim, Config.weapons.smg.recoilAim);
  assert.equal(player.weapon.recoilHip, Config.weapons.smg.recoilHip);
  player.ammo = 0;
  player.reserveAmmo = 100;
  assert.equal(player.reload(audio), true);
  player.update(9.99, {}, false, clearMap, audio);
  assert.equal(player.ammo, 0);
  player.update(0.02, {}, false, clearMap, audio);
  assert.equal(player.ammo, 100);
  assert.equal(player.reserveAmmo, 0);
});

test('mini-shotgun fires three pellets across the requested cones and loads one shell each second', () => {
  const player = equippedPlayer('mini-shotgun');
  assert.equal(player.weapon.purchasePrice, 3000);
  assert.equal(player.weapon.automatic, false);
  assert.equal(player.weapon.damage, 1);
  assert.equal(player.weapon.shotNoise, Config.weapons.shotgun.shotNoise);
  assert.equal(player.weapon.recoilAim, Config.weapons.shotgun.recoilAim);
  assert.equal(player.weapon.recoilHip, Config.weapons.shotgun.recoilHip);
  for (const [aimed, halfCone] of [[false, Math.PI / 9], [true, Math.PI / 18]]) {
    player.shootCooldown = 0;
    const shot = player.shoot(aimed, clearMap, audio);
    assert.equal(shot.shotAngles.length, 3);
    assert.ok(Math.abs(shot.shotAngles[0] + halfCone) < 1e-10);
    assert.equal(shot.shotAngles[1], 0);
    assert.ok(Math.abs(shot.shotAngles[2] - halfCone) < 1e-10);
    assert.equal(player.shootCooldown, 0.3);
  }
  player.reserveAmmo = 10;
  assert.equal(player.reload(audio), true);
  player.update(1, {}, false, clearMap, audio);
  assert.equal(player.ammo, 1);
  assert.equal(player.reserveAmmo, 9);
  assert.equal(player.reloading, 1);
  player.update(1, {}, false, clearMap, audio);
  assert.equal(player.ammo, 2);
  assert.equal(player.reserveAmmo, 8);
});

test('easy infinite reserves remain limited to the original pistol', () => {
  const player = equippedPlayer('mini-shotgun');
  player.setMissionAmmoRules('easy');
  assert.equal(player.infiniteReserve, false);
  assert.equal(player.reserveAmmo, 0);
  player.setWeapon('pistol');
  assert.equal(player.infiniteReserve, true);
  assert.equal(player.reserveAmmo, Infinity);
  player.unlockWeapon('machinegun');
  player.setWeapon('machinegun');
  player.switchWeaponSlot('primary');
  assert.equal(player.infiniteReserve, false);
});

test('new skill and passive remain unlocked independently from their equipped slot', () => {
  const armory = Player.normalizeArmory({ ownedSkills: { barrier: true }, ownedPassives: { shield: true } });
  assert.equal(armory.ownedSkills.barrier, true);
  assert.equal(armory.ownedPassives.shield, true);
  assert.equal(armory.equippedSkill, null);
  assert.equal(armory.equippedPassive, null);
  assert.equal(Config.skills.barrier.label, '磁锁隔离栅');
  assert.equal(Config.skills.barrier.price, 5000);
  assert.equal(Config.skills.barrier.cooldown, 30);
  assert.equal(Config.passives.shield.label, '应急护盾');
  assert.equal(Config.passives.shield.price, 6000);
  assert.equal(Config.passives.shield.cooldown, 50);
  assert.equal(Config.passives.shield.duration, 3);
  for (const [id, entry] of [['machinegun', Config.weapons.machinegun], ['mini-shotgun', Config.weapons['mini-shotgun']],
    ['barrier', Config.skills.barrier], ['shield', Config.passives.shield]]) {
    assert.equal(entry.image, `resources/images/equipment-v17/${id}.png`);
  }
  assert.equal(Config.heavy.chargeDamage, 5);
});

for (const [Actor, interval, expectedHits] of [[Hunter, 0.5, 3], [Monster, 0.2, 6]]) {
  function activeActor() {
    const actor = Actor === Hunter ? new Hunter(0, 3, () => 1) : new Monster();
    Object.assign(actor, { active: true, alerted: true, x: 100, y: 100 });
    return actor;
  }
  test(`${Actor.name} contact does not relocate the actor and consumes a per-actor cooldown`, () => {
    const actor = activeActor();
    const player = { x: 101, y: 100, radius: 10, noise: 0, flashlight: false };
    assert.equal(actor.update(0, player, 0, clearMap, audio, []).playerHit, true);
    assert.equal(actor.x, 100);
    assert.equal(actor.y, 100);
    assert.equal(actor.attackCooldown, interval);
    assert.notEqual(actor.update(0, player, 0, clearMap, audio, []).playerHit, true);
    const other = activeActor();
    assert.equal(other.update(0, player, 0, clearMap, audio, []).playerHit, true);
  });
  test(`${Actor.name} contact frequency remains stable at 30 and 120 FPS`, () => {
    for (const fps of [30, 120]) {
      const actor = activeActor();
      let hits = 0;
      for (let frame = 0; frame <= fps; frame++) {
        const player = { x: actor.x + 1, y: actor.y, radius: 10, noise: 0, flashlight: false };
        if (actor.update(frame ? 1 / fps : 0, player, 0, clearMap, audio, []).playerHit) hits++;
      }
      assert.equal(hits, expectedHits, `${fps} FPS`);
    }
  });
  test(`${Actor.name} walls and rolls block hits without consuming attack cooldown`, () => {
    const actor = activeActor();
    const player = { x: 101, y: 100, radius: 10, noise: 0, flashlight: false, invulnerable: true };
    assert.notEqual(actor.update(0, player, 0, clearMap, audio, []).playerHit, true);
    assert.equal(actor.attackCooldown, 0);
    player.invulnerable = false;
    const wallMap = { ...clearMap, rayWallDistance: () => 0 };
    assert.notEqual(actor.update(0, player, 0, wallMap, audio, []).playerHit, true);
    assert.equal(actor.attackCooldown, 0);
    assert.equal(actor.update(0, player, 0, clearMap, audio, []).playerHit, true);
  });
  test(`${Actor.name} shows discovery for quiet-target alert transitions only and expires while stunned`, () => {
    const actor = activeActor();
    actor.alerted = false;
    actor.stagger = 2;
    const quiet = { x: 200, y: 100, noise: 0, flashlight: false };
    actor.update(0, quiet, 100, clearMap, audio, []);
    assert.equal(actor.discoveryTimer, 1, 'actual target noise takes precedence over aggregate noise');
    actor.update(0.25, quiet, 100, clearMap, audio, []);
    assert.equal(actor.discoveryTimer, 0.75, 'ongoing alert does not renew the indicator');
    actor.applyFlashStun(2);
    actor.update(1, quiet, 100, clearMap, audio, []);
    assert.equal(actor.discoveryTimer, 0);
    actor.flashStunTimer = 0;
    actor.alerted = false;
    actor.update(0, { ...quiet, noise: 30 }, 0, clearMap, audio, []);
    assert.equal(actor.discoveryTimer, 0);
  });
  test(`${Actor.name} activation still relocates to its original remote spawn`, () => {
    const actor = activeActor();
    actor.active = false;
    actor.activate(100, 100, 'test', audio, clearMap, 0);
    assert.equal(actor.x, 900);
    assert.equal(actor.y, 900);
  });
}

test('Hunter damage amounts preserve death, one revival, and return contract', () => {
  const hunter = new Hunter(0, 3, () => 1);
  Object.assign(hunter, { active: true, trait: 'reviver' });
  const first = hunter.registerHit(2);
  assert.equal(first.hpLeft, 1);
  assert.equal(first.dead, false);
  assert.equal(hunter.registerHit().willRevive, true);
  assert.equal(hunter.updateDeath(7).revived, true);
  assert.equal(hunter.hp, 1.5);
  const final = hunter.registerHit(2);
  assert.equal(final.dead, true);
  assert.equal(final.willRevive, false);
  assert.equal(hunter.registerHit(2).hit, false);
});

test('Heavy quiet-target alert discovery expires without renewing', () => {
  const heavy = new Heavy();
  heavy.activate(100, 100);
  const player = { x: 200, y: 100, radius: 10, noise: 0 };
  heavy.update(0, player, clearMap);
  assert.equal(heavy.discoveryTimer, 1);
  heavy.update(0.25, player, clearMap);
  assert.equal(heavy.discoveryTimer, 0.75);
  heavy.applyFlashStun(2);
  heavy.update(1, player, clearMap);
  assert.equal(heavy.discoveryTimer, 0);
});

test('Nightmare segmented chase stops at movement barriers while preserving static-wall phasing', () => {
  const monster = new Monster();
  Object.assign(monster, { active: true, alerted: true, x: 100, y: 100 });
  const barrier = { id: 'barrier-1' };
  const map = { ...clearMap,
    movementBarrierAt: (x, _y, radius) => x + radius >= 150 ? barrier : null,
    blocked: (x, _y, radius) => x + radius >= 150
  };
  monster.update(0.5, { x: 400, y: 100, noise: 100 }, 100, map, audio, []);
  assert.ok(monster.x + monster.radius < 150, 'must stop before touching the barrier');
  const before = monster.x;
  monster.update(0.5, { x: 400, y: 100, noise: 100 }, 100,
    { ...map, movementBarrierAt: () => null }, audio, []);
  assert.ok(monster.x > before, 'ordinary walls retain their existing slow phasing');
});

test('stuck-pursuer recovery checks the complete nudge path across a thin obstacle', () => {
  const hunter = new Hunter(0, 3, () => 1);
  Object.assign(hunter, { x: 100, y: 100, _lastX: 100, _lastY: 100, _stuckTimer: 1 });
  const map = { ...clearMap, blocked: (x) => x >= 112 && x <= 118 };
  recoverStuckPursuer(hunter, 0, map);
  assert.ok(hunter.x < 112, `cannot hop through a thin obstacle to x=${hunter.x}`);
});

test('Heavy can aim a charge through only a movement barrier and reports the struck barrier', () => {
  const heavy = new Heavy();
  heavy.activate(100, 100);
  const barrier = { id: 'barrier-1' };
  const target = { x: 300, y: 100, radius: 10, noise: 100 };
  const movementBarrierAt = (x, _y, radius) => x + radius >= 200 && x - radius <= 208 ? barrier : null;
  const map = { ...clearMap, movementBarrierAt,
    blocked: (x, y, radius, _ignoreDoors, ignoreMovementBarriers) =>
      !ignoreMovementBarriers && !!movementBarrierAt(x, y, radius)
  };
  assert.equal(heavy.canChargeFrom(map, 100, 100, target), true);
  heavy.phase = 'charge';
  const result = heavy.update(1, target, map);
  assert.equal(result.wallImpact.barrierId, 'barrier-1');
  assert.equal(heavy.phase, 'stunned');
  assert.equal(heavy.stunTimer, 3);
  assert.equal(heavy.update(0.1, target, map).wallImpact, undefined);
  const wallMap = { ...map, rayWallDistance: () => 50,
    blocked: (x, y, radius, ignoreDoors, ignoreMovementBarriers) =>
      x + radius >= 160 && x - radius <= 168 || map.blocked(x, y, radius, ignoreDoors, ignoreMovementBarriers)
  };
  assert.equal(heavy.canChargeFrom(wallMap, 100, 100, target), false);
});

test('dead Hunter and Heavy discovery indicators expire on their corpse updates', () => {
  for (const actor of [new Hunter(0, 3, () => 1), new Heavy()]) {
    actor.dead = true;
    actor.discoveryTimer = 1;
    actor.updateDeath(0.4);
    assert.equal(actor.discoveryTimer, 0.6);
    actor.updateDeath(1);
    assert.equal(actor.discoveryTimer, 0);
  }
});

test('Heavy discovery continues expiring when its target is downed', () => {
  const heavy = new Heavy();
  heavy.activate(100, 100);
  heavy.discoveryTimer = 1;
  heavy.update(0.4, { x: 200, y: 100, downed: true }, clearMap);
  assert.equal(heavy.discoveryTimer, 0.6);
});

test('ambusher sight activation shows discovery for the actual quiet viewer', () => {
  const hunter = new Hunter(0, 3, () => 1);
  Object.assign(hunter, { active: true, trait: 'ambusher', x: 100, y: 100,
    ambushTarget: { x: 100, y: 100 } });
  const viewer = { x: 130, y: 100, angle: Math.PI, radius: 10, noise: 0, flashlight: true };
  hunter.update(0, viewer, 100, clearMap, audio, [], [viewer]);
  assert.equal(hunter.ambushTriggered, true);
  assert.equal(hunter.discoveryTimer, 1);
});

test('supply use sets walking to 40 with sprint unavailable and initializes shield runtime', () => {
  const player = equippedPlayer('pistol');
  assert.equal(player.supplyUse, null);
  assert.equal(player.shieldUntil, 0);
  assert.equal(player.shieldReadyAt, 0);
  player.supplyUse = { itemId: 'pack-1', effect: 'health-40', endsAt: 10 };
  player.stamina = 50;
  player.update(0.5, { d: true, shift: true }, true, clearMap, audio);
  assert.equal(player.moveSpeed, 40);
  assert.equal(player.x, 120);
  assert.equal(player.stamina, 58);
  assert.notEqual(player.supplyUse, null);
  player.health -= 10;
  player.update(0, {}, false, clearMap, audio);
  assert.notEqual(player.supplyUse, null, 'ordinary damage alone preserves the pending supply');
});

for (const action of ['shoot', 'melee', 'roll', 'down', 'stun', 'flash-stun']) {
  test(`accepted ${action} cancels supply use`, () => {
    const player = equippedPlayer('pistol');
    player.armory.ownedPassives.roll = true;
    player.armory.equippedPassive = 'roll';
    player.supplyUse = { itemId: 'pack-1', effect: 'health-40', endsAt: 10 };
    if (action === 'shoot') assert.equal(player.shoot(false, clearMap, audio).fired, true);
    else if (action === 'melee') assert.equal(player.startMelee(), true);
    else if (action === 'roll') assert.equal(player.startRoll(1, 0), true);
    else if (action === 'flash-stun') player.applyFlashStun(1);
    else {
      if (action === 'down') player.downed = true;
      else player.stunned = 0.5;
      player.update(1, {}, false, clearMap, audio);
    }
    assert.equal(player.supplyUse, null);
  });
}

test('rejected fire, melee, and roll attempts retain pending supply use', () => {
  const player = equippedPlayer('pistol');
  const supply = { itemId: 'pack-1', effect: 'health-40', endsAt: 10 };
  player.supplyUse = supply;
  player.shootCooldown = 1;
  assert.equal(player.shoot(false, clearMap, audio).fired, false);
  player.meleeCooldown = 1;
  assert.equal(player.startMelee(), false);
  assert.equal(player.startRoll(0, 0), false);
  assert.equal(player.supplyUse, supply);
});

test('reloadSerial increments for accepted whole-magazine starts only, including across player resets', () => {
  const player = equippedPlayer('pistol');
  assert.equal(player.reloadSerial, 0);
  assert.equal(player.reload(audio), false);
  player.ammo = 0;
  assert.equal(player.reload(audio), true);
  assert.equal(player.reloadSerial, 1);
  assert.equal(player.reload(audio), false);
  assert.equal(player.reloadSerial, 1);
  player.update(2, {}, false, clearMap, audio);
  assert.equal(player.reloadSerial, 1);
  player.reset(clearMap);
  assert.equal(player.reloadSerial, 1);
  player.ammo = 0;
  assert.equal(player.reload(audio), true);
  assert.equal(player.reloadSerial, 2);
  player.unlockWeapon('mini-shotgun');
  player.setWeapon('mini-shotgun');
  player.ammo = 0;
  player.reserveAmmo = 10;
  assert.equal(player.reload(audio), true);
  player.update(1, {}, false, clearMap, audio);
  assert.equal(player.reloadSerial, 2);
});
