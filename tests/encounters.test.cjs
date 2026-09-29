const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const sandbox = {};
for (const [file, exports] of [
  ['config.js', 'globalThis.ConfigUnderTest = Config;'],
  ['map.js', 'globalThis.MapManagerUnderTest = MapManager;']
]) vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8')}\n${exports}`, sandbox);
const MapManager = sandbox.MapManagerUnderTest;

test('seeded enemy selection and loot counts are deterministic across map sizes', () => {
  for (const scale of ['small', 'medium', 'large']) {
    const map = new MapManager(scale, 12345);
    const copy = new MapManager(scale, 12345);
    assert.deepEqual(Array.from(map.enemyTypes), Array.from(copy.enemyTypes));
    assert.equal(map.layoutSignature(), copy.layoutSignature());
    assert.ok(map.enemyTypes.length >= 1 && map.enemyTypes.length <= 3);
    assert.equal(map.scrap.length, map.functionalRooms.length * map.enemyTypes.length);
    for (const room of map.worldRooms) {
      const roomLoot = map.scrap.filter(item => item.roomIndex === room.roomIndex);
      assert.equal(roomLoot.length, room.kind === 'room' ? map.enemyTypes.length : 0);
    }
  }
});

test('every generated doorway clears a heavy-width passage when open', () => {
  for (const scale of ['small', 'medium', 'large']) {
    for (const seed of [1, 2, 3, 4, 12345]) {
      const map = new MapManager(scale, seed);
      assert.equal(map.scrap.length, map.functionalRooms.length * map.enemyTypes.length, `${scale} ${seed} loot`);
      for (const door of map.doors) {
        door.open = true;
        const x = (door.p1.x + door.p2.x) / 2;
        const y = (door.p1.y + door.p2.y) / 2;
        assert.equal(map.blocked(x, y, 22), false, `${scale} ${seed} ${door.id}`);
      }
    }
  }
});

test('loot placement retries deterministically with the original seed', () => {
  const build = () => {
    const map = new MapManager('small', 98765);
    const populate = map.populateRoom;
    let failures = 0;
    map.populateRoom = function (room) {
      if (failures++ === 0) throw new Error('Cannot place 2 loot in test room');
      return populate.call(this, room);
    };
    map.reset('small', 98765);
    return map;
  };
  const first = build();
  const second = build();
  assert.equal(first.seed, 98765);
  assert.equal(first.layoutSignature(), second.layoutSignature());
  assert.deepEqual(Array.from(first.enemyTypes), Array.from(second.enemyTypes));
  assert.equal(first.scrap.length, first.functionalRooms.length * first.enemyTypes.length);
});

test('loot placement reports exhaustion after bounded deterministic retries', () => {
  const map = new MapManager('small', 98765);
  map.populateRoom = () => { throw new Error('Cannot place 3 loot in test room'); };
  assert.throws(() => map.reset('small', 98765), /after 5 deterministic layouts for seed 98765/);
});
