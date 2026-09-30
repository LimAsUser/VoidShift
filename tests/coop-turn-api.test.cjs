const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {DatabaseSync}=require('node:sqlite'),{stripTypeScriptTypes}=require('node:module');
async function setup(){
  const sqlite=new DatabaseSync(':memory:');
  for(const f of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync('drizzle/'+f,'utf8'));
  const now=Date.now();sqlite.prepare('INSERT INTO rooms(code,host_token,offer_sdp,protocol_version,status,created_at,expires_at) VALUES(?,?,?,?,?,?,?)').run('ABC234','host-secret','MULTI_PEER_V18',18,'lobby',now,now+600000);
  const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('member-secret'))).toString('hex');
  sqlite.prepare('INSERT INTO room_members(id,room_code,slot,token_hash,status,created_at) VALUES(?,?,?,?,?,?)').run('p','ABC234',2,hash,'waiting',now);
  const env={DB:{prepare:sql=>({bind:(...args)=>({first:async()=>sqlite.prepare(sql).get(...args)||null})})}};
  const context=vm.createContext({env,Request,Response,Date,crypto,TextEncoder,Uint8Array});
  env.VOIDSHIFT_TURN_USERNAME='test-user';env.VOIDSHIFT_TURN_PASSWORD='test-relay-password';
  for(const f of ['db/rooms.ts','app/api/rooms/[code]/ice/route.ts'])if(fs.existsSync(f))vm.runInContext(stripTypeScriptTypes(fs.readFileSync(f,'utf8')).replace(/^import .*\r?\n/gm,'').replace(/\bexport /g,''),context);
  const get=vm.runInContext('typeof GET === "function" ? GET : null',context);
  return{sqlite,env,call:async(headers={},code='ABC234')=>{assert.equal(typeof get,'function','authenticated ICE endpoint exists');return get(new Request('https://game.test/api/rooms/'+code+'/ice',{headers}),{params:Promise.resolve({code})});}};
}
test('TURN credentials require actual room credentials, never just the room code',async()=>{
  const h=await setup();try{for(const headers of [{},{'x-room-host-token':'wrong'},{'x-room-member-id':'p','x-room-member-token':'wrong'}]){
    const response=await h.call(headers);assert.equal(response.status,403);assert.doesNotMatch(await response.text(),/test-user|test-relay-password/);
  }}finally{h.sqlite.close();}
});
test('authorized host and guest receive UDP TCP TLS routes with noncacheable responses',async()=>{
  const h=await setup();try{for(const headers of [{'x-room-host-token':'host-secret'},{'x-room-member-id':'p','x-room-member-token':'member-secret'}]){
    const response=await h.call(headers);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
    const body=await response.json();assert.equal(body.turnConfigured,true);const routes=body.iceServers.flatMap(s=>s.urls);
    assert.ok(routes.includes('turn:global.relay.metered.ca:80'));assert.ok(routes.includes('turn:global.relay.metered.ca:80?transport=tcp'));assert.ok(routes.includes('turns:global.relay.metered.ca:443?transport=tcp'));
    assert.ok(body.iceServers.filter(s=>String(s.urls).startsWith('turn')).every(s=>s.username==='test-user'&&s.credential==='test-relay-password'));
  }}finally{h.sqlite.close();}
});
test('expired rooms, removed members and expired offline members cannot retrieve TURN secrets',async()=>{
  const h=await setup();try{
    h.sqlite.exec("UPDATE room_members SET status='removed'");assert.equal((await h.call({'x-room-member-id':'p','x-room-member-token':'member-secret'})).status,403);
    h.sqlite.prepare("UPDATE room_members SET status='offline',offline_at=?").run(Date.now()-301000);assert.equal((await h.call({'x-room-member-id':'p','x-room-member-token':'member-secret'})).status,403);
    h.sqlite.exec('UPDATE rooms SET expires_at=1');assert.equal((await h.call({'x-room-host-token':'host-secret'})).status,404);
  }finally{h.sqlite.close();}
});
test('missing TURN configuration is explicit and cannot expose an undefined credential',async()=>{
  const h=await setup();try{delete h.env.VOIDSHIFT_TURN_PASSWORD;const r=await h.call({'x-room-host-token':'host-secret'});assert.equal(r.status,200);const b=await r.json();assert.equal(b.turnConfigured,false);assert.ok(b.iceServers.every(s=>s.urls.startsWith('stun:')));}finally{h.sqlite.close();}
});
