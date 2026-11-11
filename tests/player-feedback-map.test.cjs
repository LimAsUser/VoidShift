const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test');
const ctx=vm.createContext({window:{},Math});for(const file of ['config','inventory','entities','map'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file+'.js'),'utf8'),ctx);
const {MapManager,BackpackManager,Config,pointInPolygon}=vm.runInContext('({MapManager,BackpackManager,Config,pointInPolygon})',ctx);
test('90 seeded formal maps have real shaped rooms, shared crates, reachable heavy-width lanes and deterministic contents',()=>{
  let checked=0;
  for(const [scale,count] of [['small',16],['medium',26],['large',36]])for(let seed=1;seed<=30;seed++){
    const difficulty=['easy','medium','hard'][(seed-1)%3];const m=new MapManager(scale,seed,difficulty);
    const shapes=new Set(m.functionalRooms.map(r=>r.shape));for(const shape of ['triangle','pentagon','l_shape'])assert.ok(shapes.has(shape),`${scale}/${seed} missing ${shape}`);
    assert.equal(m.functionalRooms.length,count);assert.equal(m.terminals.length,{small:3,medium:4,large:5}[scale]);
    assert.equal(m.scrap.length,0);assert.ok(Array.isArray(m.containers));
    for(const room of m.functionalRooms){
      const boxes=m.containers.filter(c=>c.roomIndex===room.roomIndex);assert.ok(boxes.length>=1&&boxes.length<=3);
      for(const box of boxes){
        assert.ok(pointInPolygon(box.x,box.y,room.vertices));assert.ok(box.items.length>=1);
        const grid=new BackpackManager(6,6);grid.items=box.items;
        for(const item of box.items)assert.ok(grid.canPlace(grid.matrixFor(item),item.gx,item.gy,item.id),`${scale}/${seed}/${box.id} overlapping loot`);
      }
      const supplies=boxes.flatMap(c=>c.items);
      if(room.type==='medbay'||room.type==='oxygen'){const n=supplies.filter(i=>i.effect===(room.type==='medbay'?'health-40':'oxygen-50')).length;assert.ok(n>=2&&n<=4);}
    }
    const other=new MapManager(scale,seed,difficulty);assert.equal(m.layoutSignature(),other.layoutSignature());
    assert.equal(JSON.stringify(m.containers),JSON.stringify(other.containers));
    m.doors.forEach(d=>{d.open=true;d.targetOpen=true;d.animationProgress=1;});
    for(const room of m.functionalRooms){
      assert.equal(m.blocked(room.center.x,room.center.y,Config.heavy.radius),false);
      for(const door of room.doors){const x=(door.p1.x+door.p2.x)/2,y=(door.p1.y+door.p2.y)/2;
        const sign=room===door.roomB?1:-1,approach={x:x+door.normal.x*sign*62,y:y+door.normal.y*sign*62};
        for(const [from,to] of [[room.center,approach],[approach,{x,y}]])assert.equal(m.isPathClear(from,to,44),true,`${scale}/${seed}/${room.id}/${room.shape} blocked Heavy lane`);
      }
    }
    checked++;
  }
  assert.equal(checked,90);
});
test('encounter generation follows difficulty, is stable on redraw and changes with seed',()=>{
  const easy=new Set(),medium=new Set();
  for(let seed=1;seed<=12;seed++){
    const e=new MapManager('small',seed,'easy');assert.equal(e.enemyTypes.length,2);assert.ok(e.enemyTypes.includes('heavy'));assert.ok(e.enemyTypes.includes('hunter'));assert.ok(!e.enemyTypes.includes('monster'));easy.add([...e.enemyTypes].sort().join(','));
    const m=new MapManager('small',seed,'medium');assert.ok(m.enemyTypes.length===2||m.enemyTypes.length===3);medium.add(m.enemyTypes.length);
    const h=new MapManager('small',seed,'hard');assert.equal(h.enemyTypes.length,3);
  }
  assert.equal(easy.size,1);assert.equal(medium.size,2);
});
