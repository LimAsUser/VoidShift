const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const root = path.join(__dirname, '..');

// Connections share a transaction queue. Request events run synchronously while
// their readwrite transaction owns the store; completion releases the next tab.
function queuedIDB(options = {}) {
  const queue = []; let busy = false, upgraded = false, active = null;
  const factory = { get active() { return active; }, open() {
    if (options.throwOpen) throw new Error('storage denied');
    const request = {};
    setImmediate(() => {
      if (options.openError) { request.error = new Error('storage denied'); request.onerror?.(); return; }
      if (options.blocked) { request.onblocked?.(); return; }
      request.result = {
        objectStoreNames: { contains: () => upgraded },
        createObjectStore() { upgraded = true; }, close() {},
        transaction(store, mode) {
          assert.equal(store, 'mutex'); assert.equal(mode, 'readwrite');
          const tx = { error: null, aborted: false,
            abort() { this.aborted = true; },
            objectStore(name) { assert.equal(name, 'mutex'); return { get() {
              const read = {}; queue.push({ tx, read }); pump(); return read;
            } }; }
          };
          return tx;
        }
      };
      if (!upgraded) request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  } };
  function pump() {
    if (busy || !queue.length) return;
    busy = true;
    const { tx, read } = queue.shift();
    setImmediate(() => {
      active = tx;
      if (options.requestError) { tx.error = new Error('read failed'); tx.aborted = true; read.onerror?.(); }
      else read.onsuccess?.();
      active = null;
      setImmediate(() => {
        if (tx.aborted) tx.onabort?.(); else tx.oncomplete?.();
        busy = false; pump();
      });
    });
  }
  return factory;
}

function setup(options = {}) {
  const values = options.values || new Map([['voidshift_save', JSON.stringify({ money: 100 })]]);
  const idb = options.idb || queuedIDB();
  let fail = options.fail || (() => false), webQueue = Promise.resolve();
  const context = vm.createContext({ Date, console, TextEncoder, setImmediate,
    LANRuntime: options.runtime === null ? undefined : options.runtime || {
      mode: 'lan', verified: true, protocolVersion: 20, transport: 'LAN_WS_V20', maxPlayers: 4, ready: Promise.resolve()
    },
    indexedDB: idb,
    navigator: options.webLocks ? { locks: { request(_name, action) {
      const result = webQueue.then(action); webQueue = result.catch(() => {}); return result;
    } } } : {},
    localStorage: {
      getItem: key => values.get(key) ?? null,
      setItem(key, value) {
        if (options.requireTransaction) assert.ok(idb.active, 'save mutation must happen inside the IDB request event');
        if (fail(key, value)) throw new Error('quota'); values.set(key, String(value));
      },
      removeItem(key) { if (fail(key, null)) throw new Error('quota'); values.delete(key); }
    }
  });
  for (const file of ['js/config.js', 'js/entities.js', 'js/inventory.js', 'js/rewards.js', 'js/profile-transfer.js']) {
    const location = path.join(root, file);
    if (fs.existsSync(location)) vm.runInContext(fs.readFileSync(location, 'utf8'), context, { filename: file });
  }
  const api = vm.runInContext('({ R:SaveRewards, P:globalThis.SaveProfile || null, Player, Config })', context);
  return { ...api, context, values, idb, setFailure: fn => { fail = fn; },
    data: () => JSON.parse(values.get('voidshift_save') || '{}') };
}

function profileFixture(f, money = 1100) {
  return {
    money, rewardCreditsTotal: 1000, dailyRewardDate: '2026-10-09', appliedRewardReceipts: { 'old.host': Date.now() + 86400000 },
    profileMissions: { 'completed-mission': { difficulty: 'medium', outcome: 'success', context: { scale: 'medium', solo: true, standard: true, version: 18 } } },
    profileDefeats: { 'completed-mission': { hunter: 2, monster: 1, heavy: 0 } }, advancedUnlocked: true,
    armoryVersion: 1, armory: JSON.parse(JSON.stringify(f.Player.createDefaultArmory())),
    backpackItems: [{ id: 'starter-oxygen-1', itemId: 'oxygen-canister', name: '备用氧气瓶', shape: '1x2', rarity: 'uncommon',
      type: 'consumable', effect: 'oxygen-50', value: 150, purchasePrice: 300, gx: 0, gy: 0, rot: 0, quickUse: true }],
    storageItems: [{ id: 1, name: '废铁', shape: '1x1', rarity: 'common', size: 1, value: 50, gx: 0, gy: 0, rot: 0 }],
    storageOverflowItems: [{ id: 2, name: '待入库', shape: '3x3', rarity: 'rare', size: 3, value: 500, rot: 0 }],
    storageCapacityCells: 100, flashbangInventoryVersion: 1, skillInventoryMigrationVersion: 1, starterGrantVersion: 1,
    balanceVersion: 19, enemyCountMigrationVersion: 1, playerFeedbackMigrationVersion: 1,
    difficultyPreset: 'medium', personalScale: 'small', fpsCap: '60', textureQuality: 'high', corpseLimit: 100,
    masterVolume: 75, ambientVolume: 50, hideInteractionHints: false
  };
}
function inactiveGame() { return { state: { running: false, transitioning: false, coop: { role: null, roomPending: null, running: false } },
  rewards: { flushing: null, unsavedLocalReceipts: new Map() } }; }

test('verified HTTP LAN serializes daily claims across distinct tab connections', async () => {
  const values = new Map([['voidshift_save', '{"money":100}']]), idb = queuedIDB();
  const tabs = [setup({ values, idb, requireTransaction: true }), setup({ values, idb, requireTransaction: true })];
  const claims = await Promise.all(Array.from({ length: 12 }, (_, i) => tabs[i % 2].R.claimDaily(new Date(2026, 9, 9, 12))));
  assert.equal(claims.filter(row => row.claimed).length, 1);
  assert.equal(tabs[0].data().money, 1100);
  assert.equal(tabs[0].data().dailyRewardDate, '2026-10-09');
});

test('LAN repeated receipts credit once across tabs and preserve profile counts', async () => {
  const values = new Map([['voidshift_save', '{"money":100}']]), idb = queuedIDB();
  const tabs = [setup({ values, idb, requireTransaction: true }), setup({ values, idb, requireTransaction: true })];
  await tabs[0].R.startProfileMission('lan-mission', 'hard');
  const receipt = { id: 'lan-mission.host', missionId: 'lan-mission', outcome: 'success', counts: { hunter: 1, monster: 0, heavy: 0 },
    amount: 30, baseReward: 10, difficultyMultiplier: 3, resultMultiplier: 1, expiresAt: Date.now() + 86400000 };
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => tabs[i % 2].R.applyReceipt(receipt)));
  assert.equal(results.filter(row => row.applied).length, 1);
  assert.equal(tabs[1].data().money, 130);
  assert.equal(tabs[1].R.profileCounts().hard.success, 1);
  assert.equal(tabs[1].R.defeatTotals().hunter, 1);
});

test('IDB fallback waits for verified LAN bootstrap and rejects unverified origins', async () => {
  let finish;
  const runtime = { mode: 'online', verified: false, ready: new Promise(resolve => { finish = resolve; }) };
  const f = setup({ runtime }); let ran = false;
  const pending = f.R.locked(() => { ran = true; return 'ok'; });
  pending.catch(() => {});
  await new Promise(setImmediate); assert.equal(ran, false);
  Object.assign(runtime, { mode: 'lan', verified: true, protocolVersion: 20, transport: 'LAN_WS_V20', maxPlayers: 4 }); finish();
  assert.equal(await pending, 'ok');
  for (const invalid of [null, { mode: 'lan', verified: false }, { mode: 'online', verified: true },
    { ...runtime, protocolVersion: 19 }, { ...runtime, transport: 'WebRTC' }]) {
    const tab = setup({ runtime: invalid });
    await assert.rejects(tab.R.claimDaily()); assert.equal(tab.data().money, 100);
  }
});

test('storage denial and failed IDB requests fail closed before granting currency', async () => {
  for (const options of [{ throwOpen: true }, { openError: true }, { blocked: true }, { requestError: true }]) {
    const f = setup({ idb: queuedIDB(options) });
    await assert.rejects(f.R.claimDaily()); assert.equal(f.data().money, 100);
  }
});

test('save mutex rejects asynchronous actions and retains Web Locks priority', async () => {
  for (const webLocks of [false, true]) {
    const f = setup({ webLocks, idb: webLocks ? queuedIDB({ throwOpen: true }) : undefined });
    let mutated = false;
    await assert.rejects(f.R.locked(async () => { mutated = true; })); assert.equal(mutated, false);
    await assert.rejects(f.R.locked(() => Promise.resolve('late')));
    assert.equal(await f.R.locked(() => 7), 7);
    if (webLocks) assert.equal((await f.R.claimDaily()).claimed, true);
  }
});

test('profile export transfers only persistent fields and merged reward journal', async () => {
  const f = setup({ webLocks: true }); assert.ok(f.P, 'profile transfer API exists');
  const data = profileFixture(f, 600); data.rewardCreditsTotal = 500;
  Object.assign(data, { roomCode: 'ABC234', hostToken: 'secret-host', memberToken: 'secret-member', pendingRewards: { claimToken: 'secret-claim' } });
  data.backpackItems[0].claimToken = 'secret-item'; data.armory.hostToken = 'secret-armory';
  f.values.set('voidshift_save', JSON.stringify(data));
  f.values.set('voidshift_reward_ledger', JSON.stringify({ rewardCreditsTotal: 1000, dailyRewardDate: '2026-10-09' }));
  f.values.set('voidshift_reward_pending', JSON.stringify({ missions: { completed: { registered: true, hostToken: 'secret-outbox' } } }));
  const serialized = await f.P.export(inactiveGame()), exported = JSON.parse(serialized);
  assert.equal(exported.format, 'voidshift-profile'); assert.equal(exported.version, 1);
  assert.equal(exported.profile.money, 1100); assert.equal(exported.profile.rewardCreditsTotal, 1000);
  assert.equal(exported.profile.starterGrantVersion, 1); assert.equal(exported.profile.backpackItems[0].quickUse, true);
  assert.equal(serialized.includes('secret-'), false);
});

test('import replaces assets and reward journal without merging or regranting daily gifts', async () => {
  const f = setup({ webLocks: true }); assert.ok(f.P, 'profile transfer API exists');
  f.R.commit(profileFixture(f, 9100));
  const source = setup({ webLocks: true }); source.R.commit(profileFixture(source, 1100));
  const file = JSON.parse(await source.P.export(inactiveGame()));
  file.profile.hostToken = 'private-host'; file.profile.armory.claimToken = 'private-claim';
  file.profile.backpackItems[0].memberToken = 'private-member';
  const serialized = JSON.stringify(file);
  const result = await f.P.import(serialized, inactiveGame());
  assert.equal(result.reloadRequired, true); assert.equal(f.R.read().money, 1100);
  assert.equal(f.R.read().rewardCreditsTotal, 1000);
  assert.equal((await f.R.claimDaily(new Date(2026, 9, 9, 12))).claimed, false);
  assert.equal(f.data().starterGrantVersion, 1); assert.equal(f.data().skillInventoryMigrationVersion, 1);
  assert.equal(f.values.get('voidshift_save').includes('private-'), false);
  assert.equal(JSON.parse(f.values.get('voidshift_reward_ledger')).money, 1100);
  await f.P.restoreBackup(inactiveGame()); assert.equal(f.R.read().money, 9100);
  await f.P.restoreBackup(inactiveGame()); assert.equal(f.R.read().money, 1100);
});

test('profile transfer refuses live tasks, coop rooms and pending reward work', async () => {
  const f = setup({ webLocks: true }); assert.ok(f.P, 'profile transfer API exists');
  f.R.commit(profileFixture(f)); const serialized = await f.P.export(inactiveGame());
  for (const patch of [{ running: true }, { transitioning: true }, { descentTimer: 2 }, { coop: { role: 'host' } }, { coop: { roomPending: 'guest' } }]) {
    const game = inactiveGame(); Object.assign(game.state, patch);
    assert.equal(f.P.canTransfer(game), false); await assert.rejects(f.P.import(serialized, game));
  }
  for (const pending of [{ claims: { receipt: { claimToken: 'private' } } }, { reports: { report: {} } },
    { localReceipts: { receipt: {} } }, { missions: { mission: { registered: false } } }]) {
    f.values.set('voidshift_reward_pending', JSON.stringify(pending));
    assert.equal(f.P.canTransfer(inactiveGame()), false); await assert.rejects(f.P.import(serialized, inactiveGame()));
  }
  assert.equal(f.R.read().money, 1100);
});

test('leaving a room permits profile transfer despite the closed session retaining its role', async () => {
  const f = setup({ webLocks: true }); f.R.commit(profileFixture(f));
  for (const role of ['host', 'guest']) {
    const game = inactiveGame();
    game.coopSession = { role, roomCode: null, memberId: null, connected: false, _closed: true };
    assert.equal(f.P.canTransfer(game), true);
    const serialized = await f.P.export(game);
    assert.equal((await f.P.import(serialized, game)).reloadRequired, true);
    assert.equal((await f.P.restoreBackup(game)).reloadRequired, true);
  }
  for (const session of [
    { role: 'host', roomCode: 'ABC234', memberId: 'host', connected: true, _closed: false },
    { role: 'guest', roomCode: 'ABC234', memberId: 'guest-2', connected: false, _closed: false },
    { role: 'host', roomCode: null, memberId: null, connected: true, _closed: false }
  ]) {
    const game = inactiveGame(); game.coopSession = session;
    assert.equal(f.P.canTransfer(game), false);
    await assert.rejects(f.P.export(game));
  }
});

test('profile validation rejects invalid assets and missing once-only markers before any mutation', async () => {
  const f = setup({ webLocks: true }); assert.ok(f.P, 'profile transfer API exists');
  f.R.commit(profileFixture(f)); const serialized = await f.P.export(inactiveGame()); const before = new Map(f.values);
  const corruptions = [p => { p.money = -1; }, p => { p.money = 1.5; }, p => { p.backpackItems[0].shape = 'unknown'; },
    p => { p.backpackItems[0].value = -10; }, p => { p.backpackItems[0].gx = 999; },
    p => { p.armory.loadout.primary = 'unknown'; }, p => { p.armory.weaponAmmo.pistol.magazine = 999; },
    p => { delete p.starterGrantVersion; }, p => { p.appliedRewardReceipts.receipt = 'not-an-expiry'; },
    p => { p.profileDefeats['completed-mission'].hunter = -1; }, p => { p.money = null; },
    p => { p.starterGrantVersion = null; }, p => { p.armory = null; }, p => { p.backpackItems = null; },
    p => { p.appliedRewardReceipts = null; }, p => { p.advancedUnlocked = null; }, p => { p.armoryVersion = null; },
    p => { delete p.backpackItems[0].shape; }, p => { p.backpackItems[0].image = 'javascript:alert(1)'; },
    p => { p.backpackItems[0].effect = 'health-40'; }, p => { p.storageItems.push({ ...p.storageItems[0], id: 3 }); }];
  for (const corrupt of corruptions) {
    const input = JSON.parse(serialized); corrupt(input.profile);
    await assert.rejects(f.P.import(JSON.stringify(input), inactiveGame()));
    assert.deepEqual(f.values, before);
  }
  await assert.rejects(f.P.import('x'.repeat(2 * 1024 * 1024 + 1), inactiveGame()));
  const wrong = JSON.parse(serialized); wrong.version = 2;
  await assert.rejects(f.P.import(JSON.stringify(wrong), inactiveGame()));
});

test('failed import restores both snapshots and keeps a usable backup', async () => {
  const f = setup({ webLocks: true }); assert.ok(f.P, 'profile transfer API exists');
  f.R.commit(profileFixture(f, 9100)); const save = f.values.get('voidshift_save'), journal = f.values.get('voidshift_reward_ledger');
  const source = setup({ webLocks: true }); source.R.commit(profileFixture(source));
  const serialized = await source.P.export(inactiveGame()); let failed = false;
  f.setFailure((key, value) => key === 'voidshift_save' && !failed && value !== save && (failed = true));
  await assert.rejects(f.P.import(serialized, inactiveGame()));
  assert.equal(f.values.get('voidshift_save'), save); assert.equal(f.values.get('voidshift_reward_ledger'), journal);
  f.setFailure(() => false);
  await f.P.restoreBackup(inactiveGame()); assert.equal(f.R.read().money, 9100);
});

test('backup write failure leaves the destination entirely unchanged', async () => {
  const f = setup({ webLocks: true }); assert.ok(f.P, 'profile transfer API exists');
  f.R.commit(profileFixture(f, 9100)); const source = setup({ webLocks: true }); source.R.commit(profileFixture(source));
  const serialized = await source.P.export(inactiveGame()), before = new Map(f.values);
  f.setFailure(key => key === 'voidshift_profile_backup_v1');
  await assert.rejects(f.P.import(serialized, inactiveGame())); assert.deepEqual(f.values, before);
});

test('a failed backup restoration preserves its target for a later retry', async () => {
  const f = setup({ webLocks: true }); assert.ok(f.P, 'profile transfer API exists');
  f.R.commit(profileFixture(f, 9100)); const original = f.values.get('voidshift_save');
  const source = setup({ webLocks: true }); source.R.commit(profileFixture(source));
  await f.P.import(await source.P.export(inactiveGame()), inactiveGame());
  let failed = false;
  f.setFailure((key, value) => key === 'voidshift_save' && !failed && value === original && (failed = true));
  await assert.rejects(f.P.restoreBackup(inactiveGame())); assert.equal(f.R.read().money, 1100);
  f.setFailure(() => false);
  await f.P.restoreBackup(inactiveGame()); assert.equal(f.R.read().money, 9100);
});
