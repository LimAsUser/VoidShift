const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test');
const ctx=vm.createContext({window:{addEventListener(){}},structuredClone});for(const file of ['config','inventory','entities','game'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file+'.js'),'utf8'),ctx);
const {Game,Monster,Hunter,Heavy}=vm.runInContext('({Game,Monster,Hunter,Heavy})',ctx);
test('Nightmare wake rejects all occupied rooms and unsafe distance, otherwise waits and retries',()=>{
 const g=Object.create(Game.prototype);g.state={selectedDifficulty:'hard',coop:{},elapsed:41,powerLossStartedAt:null};
 const players=[{x:0,y:0,angle:0,flashlight:true,radius:10},{x:700,y:0,angle:0,flashlight:true,radius:10}];
 g._onlineCoopPlayers=()=>players;
 const rooms=[{id:1},{id:2},{id:3}];g.map={monsterSpawns:[{x:800,y:0}],functionalRooms:[],getRoomAt:x=>x<300?rooms[0]:x<1000?rooms[1]:rooms[2],blocked:()=>false,rayWallDistance:(_x,_y,_dx,_dy,max)=>max};
 const n=new Monster();n.active=true;n.recoverTimer=0;g.nightmares=[n];g.hunters=[];g.heavies=[];
 assert.equal(typeof g._tryWakeNightmare,'function');assert.equal(g._tryWakeNightmare(n),false);assert.equal(n.recoverTimer,1);
 g.map.monsterSpawns.push({x:1500,y:0});assert.equal(g._tryWakeNightmare(n),true);assert.equal(n.x,1500);assert.equal(n.alerted,false);
});
test('low-noise acquisition checks each player rather than choosing a hidden nearest player',()=>{
 const g=Object.create(Game.prototype);g.player={x:0,y:0,noise:0};g._onlineCoopPlayers=()=>[g.player,{x:400,y:0,noise:40}];
 const hunter={x:200,y:0,alerted:false};assert.equal(g._getThreatTarget(hunter).noise,40);
});
test('multiple Nightmares use stable separate identities and accumulate damage independently',()=>{
 const g=Object.create(Game.prototype);g.state={selectedDifficulty:'hard',missionFxId:'m',coop:{running:true,difficultyMultiplier:2}};
 g.map={enemyTypes:['monster'],monsterSpawns:[{x:1000,y:1000}],getRoomAt:()=>null};
 assert.equal(typeof g._resetNightmares,'function');g._resetNightmares('large');assert.equal(g.nightmares.length,8);
 assert.equal(new Set(g.nightmares.map(n=>n.id)).size,8);g.nightmares[0].registerHit(1);
 assert.equal(g.nightmares[0].recoverTimer,30);assert.equal(g.nightmares[1].recoverTimer,0);assert.equal(g.nightmares[1].hp,1);
});
