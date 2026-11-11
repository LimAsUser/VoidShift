const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const context = vm.createContext({ require, __dirname, structuredClone });
const fixtureSource = fs.readFileSync(path.join(__dirname, 'coop-polish.test.cjs'), 'utf8').split('\ntest(')[0];
vm.runInContext(`${fixtureSource}\nglobalThis.makeFixture = game; globalThis.PlayerUnderTest = Player;`, context);
const PlayerArt = vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, '../js/player-art.js'), 'utf8')}\nPlayerArt;`);

function game() {
  const g = context.makeFixture('guest', 4);
  g.state.missionFxId = 'same-mission';
  g.state.coop.members = [...g.remotePlayers.values()].map(entry => ({ id: entry.id, status: 'connected', connected: true }));
  g.renderer = { playerArt: new PlayerArt(() => null) };
  g.pendingCoopFinishes = new Map();
  g._broadcastCoopRoster = () => false;
  g.updateCoopUI = () => {};
  for (const [id, player] of [['local', g.player], ...[...g.remotePlayers.values()].map(entry => [entry.id, entry.player])]) {
    g.renderer.playerArt.pose(player, g.state, id, 0);
    player.x += 17.5;
    assert.equal(g.renderer.playerArt.pose(player, g.state, id, 100), 3);
  }
  return g;
}

function snapshot(g) {
  return { tick: 1, mapSignature: 'layout', players: [
    { id: g.state.coop.playerId, player: g.player, online: true }, ...g.remotePlayers.values()
  ].map(entry => ({ id: entry.id, online: entry.online,
    state: { x: entry.player.x, y: entry.player.y, angle: entry.player.angle }, inventory: [] })) };
}

function assertOnlyReset(g, id, before) {
  assert.equal(g.renderer.playerArt.poses.has(id), false, `${id} history should be invalidated`);
  for (const [otherId, pose] of before) {
    if (otherId !== id) assert.equal(g.renderer.playerArt.poses.get(otherId), pose, `${otherId} history should survive`);
  }
}

test('a valid same-mission rejoin snapshot clears every actor pose history', () => {
  const g = game();
  assert.equal(g._applyCoopSnapshot(snapshot(g), true), true);
  assert.equal(g.state.missionFxId, 'same-mission');
  assert.equal(g.renderer.playerArt.poses.size, 0);
  assert.equal(g.renderer.playerArt.pose(g.player, g.state, 'local', 200), 0);
});

test('ordinary and rejected rejoin snapshots preserve pose histories', () => {
  const g = game(), before = new Map(g.renderer.playerArt.poses);
  assert.equal(g._applyCoopSnapshot(snapshot(g)), true);
  assert.equal(g._applyCoopSnapshot({ ...snapshot(g), tick: -1 }, true), false);
  assert.equal(g._applyCoopSnapshot({ ...snapshot(g), mapSignature: 'another-map' }, true), false);
  for (const [id, pose] of before) assert.equal(g.renderer.playerArt.poses.get(id), pose);
});

test('authority corrections beyond 48 world units reset only the corrected actor', () => {
  for (const id of ['local', 'host']) {
    const g = game(), before = new Map(g.renderer.playerArt.poses);
    const actor = id === 'local' ? g.player : g.remotePlayers.get(id).player;
    const target = { x: actor.x + 49, y: actor.y, angle: 0.3 };
    g._applyPlayerSnapshot(actor, target, 0.35);
    assert.equal(actor.x, target.x);
    assert.equal(actor.angle, 0.3);
    assertOnlyReset(g, id, before);
  }
});

test('48-unit corrections retain animation history and the existing blend behavior', () => {
  for (const blend of [0.35, 1]) {
    const g = game(), before = g.renderer.playerArt.poses.get('local'), x = g.player.x;
    g._applyPlayerSnapshot(g.player, { x: x + 48, y: g.player.y, angle: 0 }, blend);
    assert.equal(g.player.x, x + 48 * blend);
    assert.equal(g.renderer.playerArt.poses.get('local'), before);
  }
});

test('a correction for an unknown actor never clears everybody through an undefined identity', () => {
  const g = game(), before = new Map(g.renderer.playerArt.poses), actor = new context.PlayerUnderTest();
  g._applyPlayerSnapshot(actor, { x: actor.x + 49, y: actor.y, angle: 0 });
  for (const [id, pose] of before) assert.equal(g.renderer.playerArt.poses.get(id), pose);
});

test('offline, reconnect and forced rejoin status invalidate only that peer history', () => {
  for (const [wasOffline, status, forceRejoin] of [[false, 'offline', false], [true, 'connected', false], [false, 'connected', true]]) {
    const g = game(), before = new Map(g.renderer.playerArt.poses);
    if (wasOffline) g.state.coop.members.find(member => member.id === 'host').status = 'offline';
    g._setCoopMemberStatus('host', status, forceRejoin);
    assert.equal(g.remotePlayers.get('host').online, status === 'connected');
    assertOnlyReset(g, 'host', before);
  }
});

test('repeated connected status preserves an active peer animation', () => {
  const g = game(), before = g.renderer.playerArt.poses.get('host');
  g._setCoopMemberStatus('host', 'connected');
  assert.equal(g.renderer.playerArt.poses.get('host'), before);
});

test('snapshot online transitions invalidate only the changed peer history', () => {
  for (const online of [false, true]) {
    const g = game(), before = new Map(g.renderer.playerArt.poses);
    g.remotePlayers.get('host').online = !online;
    const next = snapshot(g); next.players.find(entry => entry.id === 'host').online = online;
    assert.equal(g._applyCoopSnapshot(next), true);
    assertOnlyReset(g, 'host', before);
  }
});

test('explicit peer removal clears its animation and retains the remaining actors', () => {
  const g = game(), before = new Map(g.renderer.playerArt.poses);
  g._removeCoopMember('host');
  assert.equal(g.remotePlayers.has('host'), false);
  assertOnlyReset(g, 'host', before);
});

test('snapshot roster removal clears only the removed peer animation', () => {
  const g = game(), before = new Map(g.renderer.playerArt.poses), next = snapshot(g);
  next.players = next.players.filter(entry => entry.id !== 'host');
  assert.equal(g._applyCoopSnapshot(next), true);
  assert.equal(g.remotePlayers.has('host'), false);
  assertOnlyReset(g, 'host', before);
});
