const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { stripTypeScriptTypes } = require('node:module');
const { createHash } = require('node:crypto');

const offer = JSON.stringify({ type: 'offer', sdp: 'v=0\r\no=original-offer\r\n' });
const answer = JSON.stringify({ type: 'answer', sdp: 'v=0\r\no=original-answer\r\n' });
function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE rooms(code TEXT PRIMARY KEY, host_token TEXT, protocol_version INTEGER, status TEXT, expires_at INTEGER);
    CREATE TABLE room_members(id TEXT PRIMARY KEY, room_code TEXT, slot INTEGER, generation INTEGER, status TEXT, token_hash TEXT, offer_sdp TEXT, answer_sdp TEXT, offline_at INTEGER);`);
  sqlite.prepare('INSERT INTO rooms VALUES(?,?,?,?,?)').run('ABC234','host-token',16,'lobby',Date.now()+60000);
  sqlite.prepare('INSERT INTO room_members VALUES(?,?,?,?,?,?,?,?,?)').run('member-2','ABC234',2,0,'waiting',createHash('sha256').update('member-token').digest('hex'),null,null,null);
  let beforeWrite;
  const db = { prepare(sql) { return { bind(...values) { return {
    async first() { return sqlite.prepare(sql).get(...values) || null; },
    async run() { if(beforeWrite){const hook=beforeWrite;beforeWrite=null;hook();} return { meta: { changes: sqlite.prepare(sql).run(...values).changes } }; }
  }; } }; } };
  const context = vm.createContext({ env:{ DB:db }, Request, Response, crypto:globalThis.crypto, TextEncoder, Uint8Array, Date });
  for(const file of ['db/rooms.ts','app/api/rooms/[code]/members/[memberId]/route.ts']){
    const source=stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'..',file),'utf8')).replace(/^import .*\r?\n/gm,'').replace(/\bexport /g,'');
    vm.runInContext(source,context,{filename:file});
  }
  const call=(method,role,body)=>vm.runInContext(method,context)(new Request('https://game.test/api/rooms/ABC234/members/member-2',{
    method,headers:{[role==='host'?'x-room-host-token':'x-room-member-token']:role==='host'?'host-token':'member-token','content-type':'application/json'},body:JSON.stringify(body)
  }),{params:Promise.resolve({code:'ABC234',memberId:'member-2'})});
  return {sqlite,call,row:()=>sqlite.prepare('SELECT * FROM room_members').get(),race:fn=>beforeWrite=fn};
}

test('replayed offer and answer preserve the answer and connected state',async()=>{
  const f=setup();try{
    assert.equal((await f.call('PUT','host',{generation:0,offer})).status,200);
    assert.equal((await f.call('PUT','member',{generation:0,answer})).status,200);
    assert.equal((await f.call('PATCH','member',{generation:0,status:'connected'})).status,200);
    assert.equal((await f.call('PUT','host',{generation:0,offer})).status,200);
    assert.equal(f.row().answer_sdp,answer);assert.equal(f.row().status,'connected');
    assert.equal((await f.call('PUT','member',{generation:0,answer})).status,200);assert.equal(f.row().status,'connected');
  }finally{f.sqlite.close();}
});

test('different SDP in the same generation conflicts without overwriting the accepted value',async()=>{
  const f=setup();try{
    await f.call('PUT','host',{generation:0,offer});await f.call('PUT','member',{generation:0,answer});
    assert.equal((await f.call('PUT','host',{generation:0,offer:offer.replace('original','other')})).status,409);
    assert.equal((await f.call('PUT','member',{generation:0,answer:answer.replace('original','other')})).status,409);
    assert.equal(f.row().offer_sdp,offer);assert.equal(f.row().answer_sdp,answer);
  }finally{f.sqlite.close();}
});

test('an answer without an offer and stale or removed writes never report success',async()=>{
  const f=setup();try{
    assert.equal((await f.call('PUT','member',{generation:0,answer})).status,409);
    assert.equal((await f.call('PUT','host',{generation:1,offer})).status,409);
    await f.call('PATCH','member',{generation:0,status:'removed'});
    assert.equal((await f.call('PUT','host',{generation:0,offer})).status,410);
    assert.equal((await f.call('PATCH','member',{generation:0,status:'connected'})).status,410);
    assert.equal(f.row().status,'removed');
  }finally{f.sqlite.close();}
});

test('generation changes between authorization and SQL write cannot return false success',async()=>{
  for(const method of ['PUT','PATCH']){
    const f=setup();try{
      f.race(()=>f.sqlite.exec("UPDATE room_members SET generation=1,status='waiting'"));
      const result=await f.call(method,'host',method==='PUT'?{generation:0,offer}:{generation:0,status:'offline'});
      assert.equal(result.status,409);assert.equal(f.row().generation,1);assert.equal(f.row().status,'waiting');
      assert.equal(f.row().offer_sdp,null);
    }finally{f.sqlite.close();}
  }
});

test('generation-aware status rejects old peers and still accepts legacy status calls',async()=>{
  const f=setup();try{
    f.sqlite.exec("UPDATE room_members SET generation=1,status='connected'");
    assert.equal((await f.call('PATCH','member',{generation:0,status:'offline'})).status,409);
    assert.equal(f.row().status,'connected');
    assert.equal((await f.call('PATCH','member',{status:'offline'})).status,200);
  }finally{f.sqlite.close();}
});
