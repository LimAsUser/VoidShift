const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test');
let now=1000;const ctx=vm.createContext({window:{},EventTarget,CustomEvent,Map,Date:class extends Date{static now(){return now;}},TextEncoder,TextDecoder,Uint8Array,atob,btoa,setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){}});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/network.js'),'utf8'),ctx);const Session=vm.runInContext('CoopSession',ctx);
test('RTT measures one host round trip, ignores stale replies and expires missing samples',()=>{
 const session=new Session();session.role='host';session.peers.set('p2',{id:'p2',connected:true});const messages=[];session.sendEvent=(...args)=>{messages.push(args);return true;};
 assert.equal(typeof session._sampleLatency,'function');session._sampleLatency();const ping=messages.find(m=>m[0]==='net-ping')[1];
 now+=87;session._handleLatency(session.peers.get('p2'),{type:'net-pong',seq:ping.seq});assert.equal(session.peers.get('p2').rttMs,87);
 now+=200;session._handleLatency(session.peers.get('p2'),{type:'net-pong',seq:ping.seq});assert.equal(session.peers.get('p2').rttMs,87);
 now+=8000;session._sampleLatency();assert.equal(session.latencies().p2,null);
});
test('only hosts can remove another current member',async()=>{
 const session=new Session();session.role='guest';session.roomCode='ABC234';session.peers.set('p2',{id:'p2'});
 assert.equal(typeof session.kickMember,'function');assert.equal(await session.kickMember('p2'),false);
 session.role='host';session.hostToken='token';const requests=[];session._request=async(...args)=>{requests.push(args);return{ok:true};};
 assert.equal(await session.kickMember('host'),false);assert.equal(await session.kickMember('missing'),false);assert.equal(await session.kickMember('p2'),true);
 assert.equal(requests[0][1].headers['x-room-host-token'],'token');assert.equal(JSON.parse(requests[0][1].body).status,'removed');
});
