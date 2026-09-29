const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { stripTypeScriptTypes } = require('node:module');
const root = path.join(__dirname, '..');

function setup() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of fs.readdirSync(path.join(root, 'drizzle')).filter(f => f.endsWith('.sql')).sort()) {
    sqlite.exec(fs.readFileSync(path.join(root, 'drizzle', file), 'utf8'));
  }
  sqlite.prepare('INSERT INTO rooms(code,host_token,offer_sdp,protocol_version,status,created_at,expires_at) VALUES(?,?,?,?,?,?,?)')
    .run('ABC234','room-host','MULTI_PEER_V16',16,'lobby',Date.now(),Date.now()+60000);
  sqlite.prepare('INSERT INTO room_members(id,room_code,slot,token_hash,status,created_at) VALUES(?,?,?,?,?,?)')
    .run('guest-2','ABC234',2,'unused','connected',Date.now());
  const db = { prepare(sql) {
    const make = values => ({
      bind: (...args) => make(args),
      async first() { return sqlite.prepare(sql).get(...values) || null; },
      async all() { return { results: sqlite.prepare(sql).all(...values) }; },
      async run() { return { meta: { changes: sqlite.prepare(sql).run(...values).changes } }; }
    });
    return make([]);
  }, async batch(statements) {
    sqlite.exec('BEGIN');
    try { const results=[];for(const statement of statements)results.push(await statement.run());sqlite.exec('COMMIT');return results; }
    catch(error){sqlite.exec('ROLLBACK');throw error;}
  } };
  const context = vm.createContext({env:{DB:db},Request,Response,crypto:globalThis.crypto,TextEncoder,Uint8Array,Date,console});
  for (const file of ['db/rooms.ts','db/missions.ts']) {
    if (!fs.existsSync(path.join(root,file))) continue;
    const source=stripTypeScriptTypes(fs.readFileSync(path.join(root,file),'utf8')).replace(/^import[\s\S]*?from [^\n]+;\r?\n/gm,'').replace(/\bexport /g,'');
    vm.runInContext(source,context,{filename:file});
  }
  const api = vm.runInContext('typeof registerMission === "function" ? ({registerMission,reportMission,readReceipt}) : null',context);
  return {sqlite,api,context,close:()=>sqlite.close()};
}
const reportToken='a'.repeat(64), hostClaim='b'.repeat(64), guestClaim='c'.repeat(64);
const registration={missionId:'mission-test-1',roomCode:'ABC234',difficulty:'hard',reportToken,participants:[
  {playerId:'host',name:'房主',claimToken:hostClaim},{playerId:'guest-2',name:'队友',claimToken:guestClaim}
]};
test('mission receipts survive room deletion and calculate immutable personal rewards',async()=>{
  const f=setup();try{
    assert.ok(f.api,'durable mission receipt API must exist');
    const created=await f.api.registerMission(registration,'room-host');assert.equal(created.status,201);
    assert.equal((await f.api.registerMission(registration,'room-host')).status,200);
    f.sqlite.exec('DELETE FROM rooms');
    const report={players:[{playerId:'host',outcome:'success',counts:{hunter:2,monster:1,heavy:1}},
      {playerId:'guest-2',outcome:'kicked',counts:{hunter:1,monster:2,heavy:0}}]};
    assert.equal((await f.api.reportMission('mission-test-1',reportToken,report)).status,200);
    assert.equal((await f.api.reportMission('mission-test-1',reportToken,report)).status,200);
    const host=await (await f.api.readReceipt('mission-test-1','host',hostClaim)).json();
    const guest=await (await f.api.readReceipt('mission-test-1','guest-2',guestClaim)).json();
    assert.equal(host.receipt.amount,450);assert.equal(guest.receipt.amount,105);
    assert.equal(host.receipt.baseReward,150);assert.equal(host.receipt.difficultyMultiplier,3);
    assert.ok(host.receipt.expiresAt-host.receipt.completedAt===7*24*60*60*1000);
    report.players[0].counts.hunter=9;
    assert.equal((await f.api.reportMission('mission-test-1',reportToken,report)).status,409);
    assert.equal((await (await f.api.readReceipt('mission-test-1','host',hostClaim)).json()).receipt.amount,450);
    const stored=f.sqlite.prepare('SELECT * FROM missions').get();
    assert.ok(!JSON.stringify(stored).includes(reportToken));
    assert.ok(!JSON.stringify(f.sqlite.prepare('SELECT * FROM mission_receipts').all()).includes(hostClaim));
  } finally { f.close(); }
});
test('wrong credentials, forged money, counts, and participants cannot change receipts',async()=>{
  const f=setup();try{
    assert.ok(f.api,'durable mission receipt API must exist');
    assert.equal((await f.api.registerMission(registration,'wrong')).status,403);
    assert.equal((await f.api.registerMission({...registration,participants:[{playerId:'stranger',claimToken:guestClaim}]},'room-host')).status,400);
    await f.api.registerMission(registration,'room-host');
    assert.equal((await f.api.readReceipt('mission-test-1','host',guestClaim)).status,403);
    assert.equal((await f.api.reportMission('mission-test-1','wrong',{players:[]})).status,403);
    const pending=await (await f.api.readReceipt('mission-test-1','host',hostClaim)).json();assert.equal(pending.status,'pending');
    for(const counts of [{hunter:-1,monster:0,heavy:0},{hunter:1.5,monster:0,heavy:0},{hunter:1,monster:NaN,heavy:0}]) {
      assert.equal((await f.api.reportMission('mission-test-1',reportToken,{players:[{playerId:'host',outcome:'success',counts}]})).status,400);
    }
    assert.equal((await f.api.reportMission('mission-test-1',reportToken,{players:[{playerId:'host',outcome:'success',counts:{hunter:1,monster:0,heavy:0},amount:999999}]})).status,400);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM mission_receipts WHERE completed_at IS NOT NULL").get().n,0);
  } finally { f.close(); }
});
test('partial departure freezes once while remaining players settle later and expired receipts disappear',async()=>{
  const f=setup();try{
    assert.ok(f.api,'durable mission receipt API must exist');await f.api.registerMission(registration,'room-host');
    const departure={players:[{playerId:'guest-2',outcome:'quit',counts:{hunter:3,monster:0,heavy:0}}]};
    await f.api.reportMission('mission-test-1',reportToken,departure);
    assert.equal((await (await f.api.readReceipt('mission-test-1','guest-2',guestClaim)).json()).receipt.amount,45);
    await f.api.reportMission('mission-test-1',reportToken,{players:[{playerId:'host',outcome:'failure',counts:{hunter:0,monster:0,heavy:1}}]});
    assert.equal((await (await f.api.readReceipt('mission-test-1','host',hostClaim)).json()).receipt.amount,150);
    f.sqlite.prepare('UPDATE mission_receipts SET expires_at=? WHERE player_id=?').run(Date.now()-1,'guest-2');
    assert.equal((await f.api.readReceipt('mission-test-1','guest-2',guestClaim)).status,410);
  }finally{f.close();}
});

test('one creation intent returns the same room and credentials after response loss',async()=>{
  const f=setup();try{
    const source=stripTypeScriptTypes(fs.readFileSync(path.join(root,'app/api/rooms/route.ts'),'utf8')).replace(/^import .*\r?\n/gm,'').replace(/\bexport /g,'');
    vm.runInContext(source,f.context);
    const post=vm.runInContext('POST',f.context);
    const protocolVersion=vm.runInContext('COOP_PROTOCOL_VERSION',f.context);
    const request=()=>new Request('https://game.test/api/rooms',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({protocolVersion,createIntent:'d'.repeat(64)})});
    const first=await post(request());assert.equal(first.status,201);
    const room=await first.json();const replay=await post(request());assert.equal(replay.status,200);
    assert.equal((await replay.json()).hostToken,room.hostToken);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM rooms').get().n,2);
    assert.equal(f.sqlite.prepare('SELECT offer_sdp FROM rooms WHERE code=?').get(room.code).offer_sdp,`MULTI_PEER_V${protocolVersion}`);
    assert.ok(!JSON.stringify(f.sqlite.prepare('SELECT * FROM rooms').all()).includes('d'.repeat(64)));
  }finally{f.close();}
});
