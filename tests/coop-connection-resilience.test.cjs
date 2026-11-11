const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

function harness() {
  let now = 10000, nextTimer = 1;
  const timers = new Map(), peers = [], requests = [];
  const clock = {
    now: () => now,
    async flush() { for(let i=0;i<100;i++)await Promise.resolve(); },
    async advance(ms) {
      const target=now+ms;await this.flush();
      while(true){const due=[...timers].filter(([,t])=>t.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;
        now=due[1].at;timers.delete(due[0]);due[1].fn();await this.flush();}
      now=target;await this.flush();
    }
  };
  class Peer extends EventTarget {
    constructor(config){super();this.config=config;this.connectionState='new';this.iceConnectionState='new';this.signalingState='stable';this.iceGatheringState='complete';this.channels=[];peers.push(this);}
    createDataChannel(label){const c=Object.assign(new EventTarget(),{label,readyState:'connecting',send(){},close(){this.readyState='closed';}});this.channels.push(c);return c;}
    async createOffer(){return {type:'offer',sdp:'v=0\r\no=offer\r\n'};}
    async createAnswer(){return {type:'answer',sdp:'v=0\r\no=answer\r\n'};}
    async setLocalDescription(value){this.localDescription=value;}
    async setRemoteDescription(value){this.currentRemoteDescription=value;this.remoteDescription=value;}
    close(){this.connectionState='closed';}
  }
  const response=(status=200,payload={},headers={})=>({ok:status>=200&&status<300,status,json:async()=>payload,headers:{get:name=>headers[name.toLowerCase()]||null}});
  const context=vm.createContext({window:{},EventTarget,CustomEvent,AbortController,DOMException,crypto:globalThis.crypto,TextEncoder,TextDecoder,atob,btoa,setInterval:()=>1,clearInterval(){},
    Date:class extends Date{static now(){return now;}},performance:{now:()=>now},
    setTimeout:(fn,ms)=>{const id=nextTimer++;timers.set(id,{fn,at:now+ms});return id;},clearTimeout:id=>timers.delete(id),
    RTCPeerConnection:Peer,sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},
    fetch:async(url,options={})=>{requests.push({url,options,at:now});return response();}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/network.js'),'utf8')+'\nglobalThis.CoopSession=CoopSession;',context);
  const session=new context.CoopSession();
  return {context,session,clock,timers,peers,requests,response};
}

test('peer gathers candidates from Cloudflare and the tested Google STUN endpoint',()=>{
  const h=harness();h.session._createPeerRecord('host',0,'guest');
  const urls=h.peers[0].config.iceServers.flatMap(server=>server.urls);
  assert.ok(urls.includes('stun:stun.cloudflare.com:3478'));assert.ok(urls.includes('stun:stun.l.google.com:19302'));
});

test('GET transient failures retry twice with bounded backoff',async()=>{
  const h=harness();let calls=0;const times=[];
  h.context.fetch=async()=>{times.push(h.clock.now());return ++calls<3?h.response(503):h.response(200,{code:'ABC234'});};
  const result=h.session._request('/api/rooms/ABC234',{},null,'room');
  await h.clock.advance(2000);assert.equal((await result).code,'ABC234');assert.deepEqual(times,[10000,10500,12000]);
});

test('unsafe POST is not retried and reports an unconfirmed outcome',async()=>{
  const h=harness();let calls=0;h.context.fetch=async()=>{calls++;throw new TypeError('Failed to fetch');};
  await assert.rejects(h.session._request('/api/rooms',{method:'POST',body:'{}'},null,'room'),error=>error.uncertain===true);
  await h.clock.advance(30000);assert.equal(calls,1);
});

test('non-retryable HTTP failures preserve the status instead of guessing a browser cause',async()=>{
  const h=harness();let calls=0;h.context.fetch=async()=>{calls++;return h.response(403,{error:'forbidden'});};
  await assert.rejects(h.session._request('/api/rooms/ABC234',{},null,'room'),error=>error.httpStatus===403&&!/Edge|Cloudflare|防火墙/.test(error.message));
  assert.equal(calls,1);
});

test('retryable PUT resends exactly the frozen SDP payload and honors Retry-After',async()=>{
  const h=harness(),bodies=[],times=[];h.context.fetch=async(_url,options)=>{
    bodies.push(options.body);times.push(h.clock.now());return bodies.length===1?h.response(429,{}, {'retry-after':'3'}):h.response(200,{ok:true});
  };
  const body=JSON.stringify({generation:2,answer:'frozen-sdp'});
  const result=h.session._request('/api/rooms/ABC234/members/id',{method:'PUT',body},null,'upload-answer');
  await h.clock.advance(3000);assert.equal((await result).ok,true);assert.deepEqual(bodies,[body,body]);assert.deepEqual(times,[10000,13000]);
});

test('a stalled fetch is aborted at eight seconds per attempt and cannot wait forever',async()=>{
  const h=harness();let calls=0,aborts=0;h.context.fetch=(_url,options)=>{calls++;options.signal.addEventListener('abort',()=>aborts++);return new Promise(()=>{});};
  const result=assert.rejects(h.session._request('/api/rooms/ABC234',{},null,'room'),error=>error.code==='request_timeout');
  await h.clock.advance(26000);await result;assert.equal(calls,3);assert.equal(aborts,3);assert.equal(h.timers.size,0);
});

test('cancelling a room aborts outstanding requests without retrying',async()=>{
  const h=harness();let calls=0;h.context.fetch=()=>{calls++;return new Promise(()=>{});};
  const result=assert.rejects(h.session._request('/api/rooms/ABC234',{},null,'room'),error=>error.name==='AbortError');
  await h.clock.flush();await h.session.close(false);await result;await h.clock.advance(60000);assert.equal(calls,1);assert.equal(h.timers.size,0);
});

function serveGuest(h) {
  let generation=0;
  h.context.fetch=async(url,options={})=>{
    h.requests.push({url,options,at:h.clock.now()});
    if(url==='/api/rooms/ABC234')return h.response(200,{protocol_version:20,expires_at:h.clock.now()+600000});
    if(url.endsWith('/ice'))return h.response(200,{iceServers:[{urls:'stun:stun.cloudflare.com:3478'}],turnConfigured:false});
    if(options.method==='POST'){
      if(JSON.parse(options.body).memberId)generation++;
      return h.response(200,{memberId:'guest-2',memberToken:'private-token',slot:2,generation});
    }
    if((options.method||'GET')==='GET')return h.response(200,{generation,status:'offered',offer_sdp:JSON.stringify({type:'offer',sdp:'v=0\r\no=offer\r\n'})});
    return h.response(200,{ok:true});
  };
}
function openChannels(h,count=2) {
  const record=h.session.peers.get('host');record.peer.connectionState='connected';record.peer.iceConnectionState='connected';
  for(const label of ['state:guest-2','events:guest-2'].slice(0,count)){
    const channel=record.peer.createDataChannel(label);h.session._bindChannel(channel,record);channel.readyState='open';channel.dispatchEvent(new Event('open'));
  }
  return record;
}

test('TURN configuration is loaded with member authorization before guest connection creation',async()=>{
  const h=harness();h.session.relayOnly=true;serveGuest(h);const prior=h.context.fetch;h.context.fetch=async(url,options)=>{
    if(url.endsWith('/ice')){assert.equal(options.headers['x-room-member-token'],'private-token');assert.equal(options.headers['x-room-member-id'],'guest-2');return h.response(200,{turnConfigured:true,iceServers:[{urls:'turns:global.relay.metered.ca:443?transport=tcp',username:'test-user',credential:'test-relay-password'}]});}
    return prior(url,options);
  };
  const joining=h.session.join('ABC234');await h.clock.flush();assert.equal(h.peers[0].config.iceServers[0].username,'test-user');assert.equal(h.peers[0].config.iceTransportPolicy,'relay');openChannels(h);await joining;
  assert.doesNotMatch(h.session.getConnectionDiagnostics(),/test-relay-password|private-token|test-user/);await h.session.close(false);
});

test('TURN relay-only mode refuses to silently fall back to direct-only servers',async()=>{
  const h=harness();assert.equal(typeof h.session._loadIceConfiguration,'function');serveGuest(h);h.session.relayOnly=true;
  const result=assert.rejects(h.session.join('ABC234'),e=>e.code==='turn_unavailable');await h.clock.flush();await result;assert.equal(h.peers.length,0);await h.session.close(false);
});

test('successful diagnostic polls cannot erase the actual failure or handshake history',()=>{
  const h=harness();const record=h.session._createPeerRecord('p',0,'host');h.session._recordDiagnostic('channels',{failure:'peer_failed'},record);
  for(let i=0;i<200;i++)h.session._recordDiagnostic('members',{httpStatus:200,retry:0,durationMs:80});
  const data=JSON.parse(h.session.getConnectionDiagnostics());assert.ok(data.records.some(r=>r.failure==='peer_failed'));assert.ok(data.records.length<=50);
});

test('transport event storms retain failure and handshake evidence within the same bounded log',()=>{
  const h=harness(),record=h.session._createPeerRecord('p',0,'host');h.session._recordDiagnostic('upload-answer',{},record);h.session._recordDiagnostic('channels',{failure:'peer_failed'},record);
  for(let i=0;i<100;i++)record.peer.dispatchEvent(new Event('iceconnectionstatechange'));
  assert.ok(h.session.connectionLog.some(r=>r.failure==='peer_failed'));assert.ok(h.session.connectionLog.some(r=>r.stage==='upload-answer'));assert.ok(h.session.connectionLog.length<=50);
});

test('a removed peers delayed stats result cannot append stale transport diagnostics',async()=>{
  const h=harness(),record=h.session._createPeerRecord('p',0,'host');let resolve;
  record.peer.getStats=()=>new Promise(done=>{resolve=done;});const pending=h.session._captureTransportStats(record);
  h.session._closePeer(record);const count=h.session.connectionLog.length;resolve(new Map());await pending;assert.equal(h.session.connectionLog.length,count);
});

test('selected relay and transport states are observable without candidate addresses or credentials',async()=>{
  const h=harness(),record=h.session._createPeerRecord('p',0,'host');record.peer.sctp={state:'connecting',transport:{state:'failed'}};
  record.peer.getStats=async()=>new Map([['t',{type:'transport',selectedCandidatePairId:'pair'}],['pair',{type:'candidate-pair',state:'succeeded',localCandidateId:'l',remoteCandidateId:'r'}],['l',{type:'local-candidate',candidateType:'relay',protocol:'udp',relayProtocol:'tls',address:'SECRET-IP',url:'turn:SECRET',username:'SECRET-USER'}],['r',{type:'remote-candidate',candidateType:'srflx',protocol:'udp',address:'SECRET-IP'}]]);
  assert.equal(typeof h.session._captureTransportStats,'function');await h.session._captureTransportStats(record);
  const data=h.session.getConnectionDiagnostics();assert.match(data,/"localType": "relay"/);assert.match(data,/"dtlsState": "failed"/);assert.doesNotMatch(data,/SECRET/);
});

test('host TURN configuration uses host authorization and retains automatic routing by default',async()=>{
  const h=harness();h.context.fetch=async(url,options={})=>{
    if(url==='/api/rooms')return h.response(201,{code:'ABC234',hostToken:'host-private',expiresAt:h.clock.now()+600000});
    if(url.endsWith('/ice')){assert.equal(options.headers['x-room-host-token'],'host-private');return h.response(200,{turnConfigured:true,iceServers:[{urls:'turn:global.relay.metered.ca:80',username:'test-user',credential:'test-relay-password'}]});}
    return h.response(200,{members:[]});
  };
  await h.session.host();h.session._createPeerRecord('g',0,'host');assert.equal(h.peers[0].config.iceServers[0].username,'test-user');assert.equal(h.peers[0].config.iceTransportPolicy,'all');
  await h.session.close(false);assert.equal(h.session.iceServers,null);
});

test('leaving during TURN configuration loading cannot leak old credentials into another session',async()=>{
  const h=harness();serveGuest(h);const previous=h.context.fetch;let resolveConfig;
  h.context.fetch=(url,options)=>url.endsWith('/ice')?new Promise(resolve=>{resolveConfig=resolve;}):previous(url,options);
  const joining=h.session.join('ABC234');await h.clock.flush();assert.equal(h.peers.length,0);await h.session.close(false);
  resolveConfig(h.response(200,{iceServers:[{urls:'turn:global.relay.metered.ca:80',username:'old-user',credential:'old-password'}]}));await joining;
  assert.equal(h.peers.length,0);assert.equal(h.session.iceServers,null);
});

test('TURN error diagnostics retain known endpoint and reason without raw private error text',()=>{
  const h=harness();h.session.iceServers=[{urls:'turns:global.relay.metered.ca:443?transport=tcp',username:'secret-user',credential:'secret-password'}];
  const record=h.session._createPeerRecord('g',0,'host');const event=new Event('icecandidateerror');
  Object.assign(event,{errorCode:701,url:h.session.iceServers[0].urls,errorText:'DNS lookup failed for PRIVATE-IP secret-password'});record.peer.dispatchEvent(event);
  const report=h.session.getConnectionDiagnostics();assert.match(report,/global\.relay\.metered\.ca/);assert.match(report,/"errorReason": "dns"/);assert.doesNotMatch(report,/PRIVATE-IP|secret-password|secret-user/);
});

test('initial join cannot finish until both data channels open',async()=>{
  const h=harness();serveGuest(h);let finished=false;
  const joining=h.session.join('ABC234').then(()=>{finished=true;});await h.clock.flush();
  assert.equal(finished,false);openChannels(h,1);await h.clock.flush();assert.equal(finished,false);
  const record=h.session.peers.get('host'),channel=record.peer.createDataChannel('events:guest-2');
  h.session._bindChannel(channel,record);channel.readyState='open';channel.dispatchEvent(new Event('open'));await joining;
  assert.equal(h.session.connected,true);assert.equal(h.session.connectionStatus.phase,'connected');await h.session.close(false);
});

test('initial join stops at sixty seconds, keeps confirmed credentials and never auto reoccupies',async()=>{
  const h=harness();serveGuest(h);
  const joining=assert.rejects(h.session.join('ABC234'),error=>error.code==='connect_timeout');
  await h.clock.advance(60000);await joining;
  assert.equal(h.session.connected,false);assert.equal(h.session.memberId,'guest-2');assert.equal(h.session.memberToken,'private-token');
  assert.equal(h.session.connectionStatus.phase,'failed');
  await h.clock.advance(120000);assert.equal(h.requests.filter(r=>r.options.method==='POST').length,1);
  const retry=h.session.retryJoin();await h.clock.flush();openChannels(h);await retry;
  const posts=h.requests.filter(r=>r.options.method==='POST');assert.equal(posts.length,2);assert.equal(JSON.parse(posts[1].options.body).memberId,'guest-2');
  assert.equal(h.session.peers.get('host').generation,1);await h.session.close(false);
});

test('an ICE cutoff records incompleteness but does not reject usable candidates',async()=>{
  const h=harness();serveGuest(h);const Peer=h.context.RTCPeerConnection;
  h.context.RTCPeerConnection=class extends Peer { constructor(config){super(config);this.iceGatheringState='gathering';} };
  const joining=h.session.join('ABC234');await h.clock.flush();
  const peer=h.peers[0],candidate=new Event('icecandidate');candidate.candidate={type:'srflx',candidate:'candidate secret-address 12345'};peer.dispatchEvent(candidate);
  const candidateError=new Event('icecandidateerror');candidateError.errorCode=701;peer.dispatchEvent(candidateError);
  await h.clock.advance(8000);openChannels(h);await joining;
  assert.ok(h.session.connectionLog.some(r=>r.stage==='ice'&&r.complete===false));assert.equal(h.session.connected,true);
  assert.doesNotMatch(h.session.getConnectionDiagnostics(),/secret-address|private-token/);await h.session.close(false);
});

test('ICE cutoff tolerates timer registration jitter and returns incomplete candidates instead of failing',async()=>{
  const h=harness(),record=h.session._createPeerRecord('p',0,'host'),schedule=h.context.setTimeout;
  record.peer.iceGatheringState='gathering';h.context.setTimeout=(fn,ms)=>schedule(fn,ms===8000?8005:ms);
  const waiting=h.session._waitForIce(record.peer);await h.clock.advance(8010);assert.equal(await waiting,false);
});

test('host prepares peers independently instead of awaiting a slow guest first',async()=>{
  const h=harness(),session=h.session;Object.assign(session,{role:'host',roomCode:'ABC234',hostToken:'secret',_roomExpiresAt:h.clock.now()+600000});
  const Peer=h.context.RTCPeerConnection;
  h.context.RTCPeerConnection=class extends Peer { constructor(config){super(config);if(h.peers.length===1)this.iceGatheringState='gathering';} };
  h.context.fetch=async(url,options={})=>{h.requests.push({url,options});return h.response(200,options.method==='PUT'?{ok:true}:{members:[{id:'slow',slot:2,generation:0,status:'waiting'},{id:'fast',slot:3,generation:0,status:'waiting'}]});};
  const poll=session._pollForMembers();await h.clock.flush();
  assert.equal(h.peers.length,2);assert.ok(h.requests.some(r=>r.url.endsWith('/fast')&&r.options.method==='PUT'));
  assert.ok(!h.requests.some(r=>r.url.endsWith('/slow')&&r.options.method==='PUT'));
  await session.close(false);await poll;
});

test('diagnostic history is bounded and excludes addresses, headers, bodies and raw errors',()=>{
  const h=harness(),record=h.session._createPeerRecord('host',0,'guest');
  for(let i=0;i<70;i++)h.session._recordDiagnostic('ice',{httpStatus:200,body:'private-token',error:new Error('192.168.1.1'),sdp:'secret-sdp'},record);
  const report=JSON.parse(h.session.getConnectionDiagnostics());assert.equal(report.records.length,50);
  assert.doesNotMatch(JSON.stringify(report),/private-token|192\.168|secret-sdp/);
});

test('a working RTC connection survives a lost answer upload response',async()=>{
  const h=harness();serveGuest(h);const fetch=h.context.fetch;
  h.context.fetch=(url,options={})=>options.method==='PUT'?new Promise(()=>{}):fetch(url,options);
  let failure;const joining=h.session.join('ABC234').catch(error=>{failure=error;});await h.clock.flush();openChannels(h);
  await h.clock.advance(26000);await joining;assert.equal(failure,undefined);assert.equal(h.session.connected,true);await h.session.close(false);
});

test('closing a confirmed guest sends its generation with the seat release',async()=>{
  const h=harness();Object.assign(h.session,{role:'guest',roomCode:'ABC234',memberId:'guest-2',memberToken:'private-token',_generation:7});
  await h.session.close();await h.clock.flush();
  assert.equal(JSON.parse(h.requests[0].options.body).generation,7);
});

test('a late room lease response cannot extend a replacement room',async()=>{
  const h=harness();let respond;Object.assign(h.session,{role:'host',roomCode:'ABC234',hostToken:'private-token'});
  h.context.fetch=()=>new Promise(resolve=>respond=resolve);h.session.setRoomStatus('active');await h.clock.flush();await h.session.close(false);
  Object.assign(h.session,{_closed:false,role:'host',roomCode:'DEF234',_roomExpiresAt:45678});
  respond(h.response(200,{expiresAt:999999}));await h.clock.flush();assert.equal(h.session._roomExpiresAt,45678);
});

test('one stalled remote description does not block applying another guest answer',async()=>{
  const h=harness();Object.assign(h.session,{role:'host',roomCode:'ABC234',hostToken:'private-token',_roomExpiresAt:999999});
  const slow=h.session._createPeerRecord('slow',0,'host'),fast=h.session._createPeerRecord('fast',0,'host');
  for(const r of [slow,fast])r.attempt=h.session._makeAttempt(r);
  slow.peer.setRemoteDescription=()=>new Promise(()=>{});
  const answer=JSON.stringify({type:'answer',sdp:'v=0\r\no=answer\r\n'});
  h.context.fetch=async()=>h.response(200,{members:[{id:'slow',slot:2,generation:0,status:'answered',answer_sdp:answer},{id:'fast',slot:3,generation:0,status:'answered',answer_sdp:answer}]});
  const polling=h.session._pollForMembers();await h.clock.flush();assert.ok(fast.peer.currentRemoteDescription);await h.session.close(false);await polling;
});

test('established disconnect recovery keeps the five-minute window and never adds another seat',async()=>{
  const h=harness();serveGuest(h);const joining=h.session.join('ABC234');await h.clock.flush();const record=openChannels(h);await joining;
  record.peer.connectionState='failed';record.peer.dispatchEvent(new Event('connectionstatechange'));await h.clock.advance(0);
  assert.ok(h.requests.filter(r=>r.options.method==='POST').length>=2);
  await h.clock.advance(305000);
  const count=h.requests.filter(r=>r.options.method==='POST').length;await h.clock.advance(60000);
  assert.equal(h.requests.filter(r=>r.options.method==='POST').length,count);
  assert.ok(h.requests.filter(r=>r.options.method==='POST').slice(1).every(r=>JSON.parse(r.options.body).memberId==='guest-2'));
  await h.session.close(false);
});

test('an uncertain reconnect allocation is not replayed and still expires after five minutes',async()=>{
  const h=harness();serveGuest(h);const joining=h.session.join('ABC234');await h.clock.flush();const record=openChannels(h);await joining;
  const fetch=h.context.fetch;let reconnectPosts=0,expired=0;
  h.context.fetch=(url,options={})=>{if(options.method==='POST'){reconnectPosts++;return new Promise(()=>{});}return fetch(url,options);};
  h.session.addEventListener('member-removed',()=>expired++);
  record.peer.connectionState='failed';record.peer.dispatchEvent(new Event('connectionstatechange'));
  await h.clock.advance(310000);assert.equal(reconnectPosts,1);assert.equal(expired,1);await h.session.close(false);
});

test('a recovered host roster poll clears its old failure message',async()=>{
  const h=harness();Object.assign(h.session,{role:'host',roomCode:'ABC234',hostToken:'secret',_roomExpiresAt:999999});let count=0;
  h.context.fetch=async()=>++count<=3?h.response(503):h.response(200,{members:[]});
  const polling=h.session._pollForMembers();await h.clock.advance(2000);await polling;
  assert.equal(h.session.connectionStatus.phase,'failed');await h.clock.advance(700);
  assert.notEqual(h.session.connectionStatus.phase,'failed');await h.session.close(false);
});
