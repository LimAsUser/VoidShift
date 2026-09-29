const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test');
const ctx=vm.createContext({});for(const f of ['config','inventory','entities','map'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',f+'.js'),'utf8'),ctx);
const {MapManager,Heavy,Config,bfsRoomPath}=vm.runInContext('({MapManager,Heavy,Config,bfsRoomPath})',ctx);
for(const scale of ['small','medium','large'])test(`${scale}: actual radius-44 Heavy traverses shared rooms and a bent corridor route`,()=>{
 const map=new MapManager(scale,12345,'hard'),group=map.network.roomGroups[0].roomIds.map(id=>map.worldRooms.find(room=>room.id===id));
 const start=group[0],direct=group.at(-1);
 const turning=map.functionalRooms.filter(room=>!group.includes(room)).map(room=>({room,path:bfsRoomPath(start,room)}))
  .filter(({room,path})=>path.length>=3&&Math.abs(room.center.x-start.center.x)>150&&Math.abs(room.center.y-start.center.y)>150)
  .sort((a,b)=>a.path.length-b.path.length)[0];assert.ok(turning);
 for(const targetRoom of [direct,turning.room]){
  map.doors.forEach(d=>{d.open=false;d.targetOpen=false;d.animationProgress=0;});
  const heavy=new Heavy(10);heavy.activate(start.center.x,start.center.y);heavy.alerted=true;
  const player={...targetRoom.center,radius:10,noise:40};let reached=false,opened=false;
  for(let frame=0;frame<2600&&!reached;frame++){
   const result=heavy.update(.05,player,map,[player]);map.advanceDoorAnimations(.05,[player],[heavy]);
   opened ||= map.doors.some(d=>d.open);
   assert.equal(map.blocked(heavy.x,heavy.y,Config.heavy.radius),false,'movement never embeds body into a wall or closed door');
   reached=result.hits.includes(player)||Math.hypot(heavy.x-player.x,heavy.y-player.y)<70;
  }
  assert.ok(opened);assert.ok(reached,`${scale} failed complete route to ${targetRoom.id} (${heavy.x},${heavy.y})`);
 }
});
