const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const context = {};
for (const name of ['config', 'map', 'entities']) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js', `${name}.js`), 'utf8'), context);
const { MapManager, Heavy, getDoorExitPoint, getNavigationRoom } = vm.runInNewContext('({MapManager,Heavy,getDoorExitPoint,getNavigationRoom})', context);

function fixture() {
  const map = new MapManager('medium', 12345);
  const access = map.worldRooms.find(room => room.corridorRole === 'access' && Math.min(room.w, room.h) < 60);
  assert.ok(access, 'regression ship contains a short entrance link');
  const passage = access.doors.find(door => door.isPassage);
  const door = access.doors.find(door => !door.isPassage);
  const targetRoom = door.roomA === access ? door.roomB : door.roomA;
  const center = { x: (passage.p1.x + passage.p2.x) / 2, y: (passage.p1.y + passage.p2.y) / 2 };
  const sign = passage.roomB === access ? 1 : -1;
  const normal = { x: passage.normal.x * sign, y: passage.normal.y * sign };
  return { map, access, passage, door, targetRoom, center, normal };
}

test('a short open connector gets a body-clear exit point before the next closed door', () => {
  const { map, access, center, normal } = fixture();
  const point = getDoorExitPoint(map, center.x, center.y, access, 22, normal.x, normal.y);
  assert.equal(map.blocked(point.x, point.y, 22), false);
  assert.equal(getNavigationRoom(map, point.x, point.y), access);
});

test('Heavy crosses the short connector, opens the real door and attacks without teleporting', () => {
  const { map, center, normal, targetRoom, door } = fixture();
  const heavy = new Heavy(30);
  heavy.activate(center.x - normal.x * 6, center.y - normal.y * 6);
  const target = { ...targetRoom.center, radius: 10 };
  let hit = false;
  for (let tick = 0; tick < 200 && !hit; tick++) {
    const before = { x: heavy.x, y: heavy.y };
    map.advanceDoorAnimations(0.1, [target], [heavy]);
    hit = heavy.update(0.1, target, map, [target]).hits.includes(target);
    assert.equal(map.blocked(heavy.x, heavy.y, 22), false);
    assert.ok(Math.hypot(heavy.x - before.x, heavy.y - before.y) <= 30.001);
  }
  assert.equal(door.open, true);
  assert.equal(hit, true);
});
