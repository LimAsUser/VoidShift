/** Seeded, soft corpse pieces: never installed in movement, sight or bullet collision. */
class CorpseEffects {
  static random(seed) {
    let value=seed>>>0;
    return ()=>{value=(value+0x6d2b79f5)>>>0;let t=Math.imul(value^(value>>>15),1|value);t^=t+Math.imul(t^(t>>>7),61|t);return ((t^(t>>>14))>>>0)/4294967296;};
  }

  static geometry(seed, count) {
    const random=this.random(seed),tau=Math.PI*2,center={x:(random()-.5)*.18,y:(random()-.5)*.18};
    const base=random()*tau,step=tau/count;
    const angles=Array.from({length:count},(_,i)=>base+i*step+(i ? (random()-.5)*step*.3 : 0));angles.push(base+tau);
    const point=angle=>{const dx=Math.cos(angle),dy=Math.sin(angle);
      const tx=Math.abs(dx)<1e-12?Infinity:((dx>0?.5:-.5)-center.x)/dx;
      const ty=Math.abs(dy)<1e-12?Infinity:((dy>0?.5:-.5)-center.y)/dy;
      const d=Math.min(tx,ty);return{x:center.x+dx*d,y:center.y+dy*d};};
    const corners=[{x:-.5,y:-.5},{x:.5,y:-.5},{x:.5,y:.5},{x:-.5,y:.5}].map(p=>({...p,a:base+((Math.atan2(p.y-center.y,p.x-center.x)-base)%tau+tau)%tau})).sort((a,b)=>a.a-b.a);
    return Array.from({length:count},(_,i)=>{
      const polygon=[center,point(angles[i]),...corners.filter(p=>p.a>angles[i]+1e-9&&p.a<angles[i+1]-1e-9),point(angles[i+1])];
      return {polygon,cx:polygon.reduce((v,p)=>v+p.x,0)/polygon.length,cy:polygon.reduce((v,p)=>v+p.y,0)/polygon.length};
    });
  }

  static initialize(record, map) {
    const random=this.random(record.seed),count=(record.kind==='heavy'?6:4)+Math.floor(random()*3);
    record.aspect=record.kind==='heavy'?1122/1402:2/3;
    const geometry=this.geometry(record.seed,count),cos=Math.cos(record.angle),sin=Math.sin(record.angle);
    record.fragments=geometry.map(piece=>{
      const ox=piece.cx*record.width,oy=piece.cy*record.width*record.aspect;
      let x=record.x+ox*cos-oy*sin,y=record.y+ox*sin+oy*cos;
      const fullRadius=Math.max(...piece.polygon.map(p=>Math.hypot((p.x-piece.cx)*record.width,(p.y-piece.cy)*record.width*record.aspect)));
      let scale=1,radius=fullRadius;
      if(map?.blocked(x,y,radius)){
        const room=map.getRoomAt?.(record.x,record.y),candidates=[{x,y},{x:record.x,y:record.y}];
        for(const distance of [8,16,32,48])for(let angle=0;angle<Math.PI*2;angle+=Math.PI/8)candidates.push({x:record.x+Math.cos(angle)*distance,y:record.y+Math.sin(angle)*distance});
        candidates.sort((a,b)=>Math.hypot(a.x-x,a.y-y)-Math.hypot(b.x-x,b.y-y));
        // Tiny compartments may need a smaller chunk; never allow visible edges through a bulkhead.
        for(const candidateScale of [1,.85,.65,.45,.25,.1]){
          const candidateRadius=fullRadius*candidateScale;
          const point=candidates.find(p=>(!room||map.getRoomAt(p.x,p.y)===room)&&!map.blocked(p.x,p.y,candidateRadius));
          if(point){x=point.x;y=point.y;scale=candidateScale;radius=candidateRadius;break;}
        }
      }
      const direction=Math.atan2(y-record.y,x-record.x)+(random()-.5)*.6;
      const speed=(record.kind==='heavy'?65:45)+random()*65;
      return {x,y,radius,scale,angle:record.angle,vx:Math.cos(direction)*speed,vy:Math.sin(direction)*speed,spin:(random()-.5)*7,sleeping:false};
    });
    record.motionVersion=0;
  }

  static advance(record, dt, map, movers) {
    if(!record.fragments)return false;
    let changed=false;
    for(const piece of record.fragments){
      for(const mover of movers){
        if(Math.hypot(mover.dx,mover.dy)<.01 || Math.hypot(piece.x-mover.x,piece.y-mover.y)>(mover.radius||10)+(piece.radius||2))continue;
        const speed=Math.hypot(mover.dx,mover.dy),force=Math.min(60,speed/Math.max(.001,dt)*.55);
        piece.vx=mover.dx/speed*force;piece.vy=mover.dy/speed*force;piece.spin=(mover.dx-mover.dy)*.35;piece.sleeping=false;
      }
      if(piece.sleeping)continue;
      const steps=Math.max(1,Math.ceil(Math.hypot(piece.vx,piece.vy)*dt/4));
      for(let i=0;i<steps;i++){
        const x=piece.x+piece.vx*dt/steps,y=piece.y+piece.vy*dt/steps;
        if(!map.blocked(x,piece.y,piece.radius||2))piece.x=x;else piece.vx*=-.22;
        if(!map.blocked(piece.x,y,piece.radius||2))piece.y=y;else piece.vy*=-.22;
      }
      piece.angle+=piece.spin*dt;const damping=Math.exp(-5*dt);piece.vx*=damping;piece.vy*=damping;piece.spin*=damping;
      if(Math.hypot(piece.vx,piece.vy)<1&&Math.abs(piece.spin)<.04){piece.vx=piece.vy=piece.spin=0;piece.sleeping=true;}
      changed=true;
    }
    if(changed)record.motionVersion=(record.motionVersion||0)+1;
    return changed;
  }

  static pose(record) {
    return {id:record.id,version:record.motionVersion,parts:record.fragments.map(p=>[Math.round(p.x*100)/100,Math.round(p.y*100)/100,Math.round(p.angle*1000)/1000,p.sleeping?1:0])};
  }

  static applyPose(record, pose) {
    if(!record.fragments||!Number.isSafeInteger(pose.version)||pose.version<=(record.motionVersion||0)||
      !Array.isArray(pose.parts)||pose.parts.length!==record.fragments.length||pose.parts.some(p=>!Array.isArray(p)||p.length!==4||p.some(v=>!Number.isFinite(v))))return false;
    pose.parts.forEach((p,i)=>Object.assign(record.fragments[i],{x:p[0],y:p[1],angle:p[2],sleeping:p[3]===1}));
    record.motionVersion=pose.version;return true;
  }
}
