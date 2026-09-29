const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function harness(){let decodes=0,fetches=0;const sources=[];
 const param=()=>({value:0,setValueAtTime(v){this.value=v;},setTargetAtTime(v){this.value=v;},cancelScheduledValues(){},linearRampToValueAtTime(v){this.value=v;}});
 class AudioContext{constructor(){this.currentTime=1;this.destination={};this.state='running';}createGain(){return {gain:param(),connect(){}};}createOscillator(){return {frequency:param(),connect(){},start(){},stop(){}};}createBufferSource(){const node={connect(){},start(){node.started=true;},stop(){node.stopped=true;},disconnect(){}};sources.push(node);return node;}async decodeAudioData(){decodes++;return {};}}
 const s={console,setTimeout,clearTimeout,window:{AudioContext},fetch:async()=>{fetches++;return{arrayBuffer:async()=>new ArrayBuffer(8)}}};vm.runInNewContext(fs.readFileSync('js/audio.js','utf8'),s);const A=vm.runInNewContext('AudioManager',s);return {a:new A(),sources,get decodes(){return decodes},get fetches(){return fetches}};
}
test('saved volume controls can be set before context and survive pause/resume',async()=>{
 const f=harness();assert.equal(typeof f.a.setVolumes,'function');f.a.setVolumes(25,40);f.a.ensureAudio();
 assert.equal(f.a.master.gain.value,.3);assert.ok(Math.abs(f.a.ambientGain.gain.value-.088)<1e-9);
 f.a.stopMissionAudio();assert.equal(f.a.master.gain.value,0);f.a.beginMissionAudio();assert.equal(f.a.master.gain.value,.3);
});
test('changing background level does not duplicate or decode the ambient loop again',async()=>{
 const f=harness();assert.equal(typeof f.a.setVolumes,'function');f.a.ensureAudio();await Promise.all([f.a.playAmbientNoiseLoop(),f.a.playAmbientNoiseLoop()]);
 assert.equal(f.sources.filter(s=>s.started&&s.loop).length,1);assert.equal(f.decodes,1);
 f.a.setVolumes(60,0);f.a.stopMissionAudio();f.a.missionAudioMuted=false;await f.a.playAmbientNoiseLoop();assert.equal(f.decodes,1);
});
test('monster hurt voices reuse one MP3 buffer and retain at most two voices per victim',async()=>{
 const f=harness();assert.equal(typeof f.a.playMonsterHit,'function');f.a.ensureAudio();const player={x:0,y:0,angle:0};
 for(let i=0;i<8;i++){f.a.context.currentTime+=.2;await f.a.playMonsterHit(player,player,null,'host',true);}
 assert.equal(f.decodes,1);assert.equal(f.sources.filter(s=>s.started&&!s.stopped).length,2);
 f.a.stopMissionAudio();assert.equal(f.sources.filter(s=>s.started&&!s.stopped).length,0);
});
