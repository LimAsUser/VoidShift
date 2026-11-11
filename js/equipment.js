/** Mission-owned deployables and cosmetic effects. No save data or hit testing lives in debris. */
class EquipmentController {
  constructor(game) { this.game = game; this.reset(); }

  reset() {
    const g = this.game;
    this.revision = 0; this.sequence = 0; this.grid = new Map(); this.reloadSeen = new WeakMap();
    for (const actor of g._onlineCoopPlayers?.() || []) this.reloadSeen.set(actor, actor.reloadSerial || 0);
    this.casingIds = new Set(); this.enemyBlocks = new WeakMap();
    this.transfers = new Map(); this.receiving = null; this.deferredEvents = [];
    g.state.equipmentSyncing = false;
    g.state.barriers = []; g.state.magazines = []; g.state.casings = []; g.state.damageNumbers = [];
    g.state.barrierBlueprint = null;
    g.map.movementBarrierAt = (x, y, radius = 0) => this.at(x, y, radius);
  }

  cells(rect, pad = 0) {
    const keys = [];
    for (let x = Math.floor((rect.x - pad) / 128); x <= Math.floor((rect.x + (rect.w || 0) + pad) / 128); x++) {
      for (let y = Math.floor((rect.y - pad) / 128); y <= Math.floor((rect.y + (rect.h || 0) + pad) / 128); y++) keys.push(`${x}:${y}`);
    }
    return keys;
  }

  reindex() {
    this.grid.clear();
    for (const barrier of this.game.state.barriers) for (const key of this.cells(barrier)) {
      if (!this.grid.has(key)) this.grid.set(key, []);
      this.grid.get(key).push(barrier);
    }
  }

  nearby(x, y, radius) {
    const found = new Set();
    for (const key of this.cells({ x, y }, radius)) for (const b of this.grid.get(key) || []) found.add(b);
    return [...found];
  }

  at(x, y, radius = 0) {
    return this.nearby(x, y, radius).find(b => Math.hypot(x - Math.max(b.x, Math.min(x, b.x + b.w)),
      y - Math.max(b.y, Math.min(y, b.y + b.h))) < radius + 0.001) || null;
  }

  event(kind, data) {
    const g = this.game;
    const seq = ++this.sequence;
    const message = { missionId: g.state.missionFxId, id: `${g.state.missionFxId}:${seq}`, seq, kind, data };
    this.apply(message, true);
    if (g.state.coop.running && g.state.coop.role === 'host') g.coopSession.sendEvent('equipment-event', message);
    return message;
  }

  apply(message, trusted = false) {
    const g = this.game, d = message?.data;
    if (!trusted && this.receiving && message.missionId === g.state.missionFxId) { this.deferredEvents.push(message); return true; }
    if ((!trusted && message.missionId !== g.state.missionFxId) || !Number.isSafeInteger(message.seq) ||
        message.seq <= this.revision || !d) return false;
    if (!trusted && message.seq !== this.revision + 1) {
      if (!g.state.equipmentSyncing) g.coopSession.sendEvent('equipment-state-request',{missionId:g.state.missionFxId});
      g.state.equipmentSyncing=true;
      return false;
    }
    this.revision = message.seq; this.sequence = Math.max(this.sequence, message.seq);
    if (message.kind === 'barrier-add') { g.state.barriers.push({ ...d }); this.reindex(); }
    else if (message.kind === 'barrier-remove') {
      g.state.barriers = g.state.barriers.filter(b => b.id !== d.id); this.reindex();
    } else if (message.kind === 'barrier-hp') {
      const b = g.state.barriers.find(b => b.id === d.id); if (b) b.hp = d.hp;
    } else if (message.kind === 'debris' && d.kind === 'magazine') g.state.magazines.push({ ...d });
    else if (message.kind === 'hit') this.showHit(d);
    return true;
  }

  export() {
    return { missionId: this.game.state.missionFxId, revision: this.revision,
      barriers: this.game.state.barriers.map(b => ({ ...b })), magazines: this.game.state.magazines.map(m => ({ ...m })) };
  }

  queueFull(peerId) {
    const g=this.game, full=this.export(), pages=[];
    let page={barriers:[],magazines:[]}, bytes=0;
    for(const kind of ['barriers','magazines']) for(const record of full[kind]) {
      const size=JSON.stringify(record).length*3;
      if(bytes+size>22000){pages.push(page);page={barriers:[],magazines:[]};bytes=0;}
      page[kind].push(record);bytes+=size;
    }
    pages.push(page);
    const transferId=`${g.state.missionFxId}:${this.transferSequence=(this.transferSequence||0)+1}`;
    this.transfers.set(peerId,{transferId,pages,index:0,revision:full.revision});
    const entry=g.remotePlayers?.get(peerId);
    if(entry){entry.equipmentTransferId=transferId;entry.equipmentSyncing=true;entry.input={...entry.input,keys:{},fire:false};}
  }

  pumpTransfers() {
    const g=this.game;
    for(const [peerId, transfer] of this.transfers) {
      if(g.remotePlayers?.get(peerId)?.online===false){this.transfers.delete(peerId);continue;}
      const accepted=g.coopSession.sendEvent('equipment-state-page',{missionId:g.state.missionFxId,transferId:transfer.transferId,
        revision:transfer.revision,index:transfer.index,count:transfer.pages.length,...transfer.pages[transfer.index]},peerId);
      if(accepted && ++transfer.index===transfer.pages.length)this.transfers.delete(peerId);
    }
  }

  receivePage(message) {
    const g=this.game;
    if(message.missionId!==g.state.missionFxId || !Number.isSafeInteger(message.index) || !Number.isSafeInteger(message.count) ||
      message.index<0 || message.index>=message.count || !Array.isArray(message.barriers) || !Array.isArray(message.magazines))return false;
    if(message.index===0 && this.receiving?.id!==message.transferId){
      this.receiving={id:message.transferId,revision:message.revision,count:message.count,pages:new Map()};this.deferredEvents=[];
      g.state.equipmentSyncing=true;
    }
    const transfer=this.receiving;
    if(!transfer || transfer.id!==message.transferId || transfer.count!==message.count)return false;
    transfer.pages.set(message.index,message);
    if(transfer.pages.size<transfer.count)return true;
    const data={missionId:g.state.missionFxId,revision:transfer.revision,barriers:[],magazines:[]};
    for(let i=0;i<transfer.count;i++){
      for(const b of transfer.pages.get(i).barriers)data.barriers.push(b);
      for(const m of transfer.pages.get(i).magazines)data.magazines.push(m);
    }
    // Full state and its post-snapshot deltas become visible in one synchronous turn.
    const events=this.deferredEvents;this.receiving=null;this.deferredEvents=[];
    const restored=this.restore(data);
    g.state.equipmentSyncing=false;
    for(const event of events)this.apply(event);
    if(!g.state.equipmentSyncing)g.coopSession.sendEvent('equipment-state-ready',{missionId:g.state.missionFxId,transferId:transfer.id});
    return restored;
  }

  restore(data) {
    if (!data || data.missionId !== this.game.state.missionFxId || data.revision < this.revision ||
        !Array.isArray(data.barriers) || !Array.isArray(data.magazines)) return false;
    this.revision = this.sequence = data.revision;
    this.game.state.barriers = data.barriers.map(b => ({ ...b }));
    this.game.state.magazines = data.magazines.map(m => ({ ...m }));
    this.reindex(); return true;
  }

  blueprint(actor, targetX, targetY, vertical = false) {
    const g = this.game, map = g.map;
    let cx = targetX, cy = targetY, w = vertical ? 32 : 64, h = vertical ? 64 : 32;
    const door = map.doors.find(d => Math.hypot(targetX - d.x - d.w / 2, targetY - d.y - d.h / 2) < 44);
    if (door) {
      const horizontal = door.w >= door.h;
      cx = door.x + door.w / 2; cy = door.y + door.h / 2;
      if (horizontal) cy += (actor.y < cy ? -1 : 1) * 28;
      else cx += (actor.x < cx ? -1 : 1) * 28;
    }
    const b = { x: cx - w / 2, y: cy - h / 2, w, h, hp: 20, vertical: h > w };
    const dist = Math.hypot(cx - actor.x, cy - actor.y);
    let valid = Number.isFinite(cx) && Number.isFinite(cy) && dist <= 120 &&
      (!dist || map.rayWallDistance(actor.x, actor.y, (cx - actor.x) / dist, (cy - actor.y) / dist, dist) >= dist - 1);
    for (let x = b.x; valid && x <= b.x + w; x += Math.min(8, w)) for (let y = b.y; valid && y <= b.y + h; y += Math.min(8, h)) {
      if (map.blocked(x, y, 1)) valid = false;
    }
    const actors = [...g._onlineCoopPlayers(), ...(g.hunters || []), ...(g.nightmares || []), ...(g.heavies || [])];
    if (actors.some(a => !a.dead && (a.active !== false || a === actor || g._isCoopPlayer?.(a)) &&
      Math.hypot(a.x - Math.max(b.x, Math.min(a.x, b.x + w)), a.y - Math.max(b.y, Math.min(a.y, b.y + h))) < (a.radius || 10) + 2)) valid = false;
    if ((map.terminals || []).some(t => t.x > b.x - 28 && t.x < b.x + w + 28 && t.y > b.y - 28 && t.y < b.y + h + 28)) valid = false;
    return { ...b, valid, targetX, targetY };
  }

  place(actor, x, y, vertical = false) {
    const b = this.blueprint(actor, x, y, vertical);
    if (!b.valid) return false;
    const id = `${this.game.state.missionFxId}:barrier:${this.sequence + 1}`;
    this.event('barrier-add', { id, x:b.x, y:b.y, w:b.w, h:b.h, hp:20 });
    this.invalidatePaths(); return true;
  }

  invalidatePaths() {
    for (const enemy of [...(this.game.hunters || []), ...(this.game.nightmares || []), ...(this.game.heavies || [])]) {
      enemy.waypoints = []; enemy.waypointTimer = 0;
      if (enemy.clearPursuit) enemy.clearPursuit();
    }
  }

  damage(id, amount) {
    const b = this.game.state.barriers.find(b => b.id === id); if (!b) return false;
    const hp = Math.max(0, b.hp - amount);
    this.event(hp ? 'barrier-hp' : 'barrier-remove', { id, hp });
    if (!hp) this.invalidatePaths(); return true;
  }

  facingBarrier(actor, range = 64) {
    const ux = Math.cos(actor.angle), uy = Math.sin(actor.angle);
    for (let distance = 8; distance <= range; distance += 4) {
      const b = this.at(actor.x + ux * distance, actor.y + uy * distance, 3);
      if (b && this.game.map.rayWallDistance(actor.x, actor.y, ux, uy, distance) >= distance - 2) return b;
    }
    return null;
  }

  beginRemoval(actor) {
    const b = this.facingBarrier(actor); if (!b) return false;
    actor.barrierRemoval = { id:b.id, x:actor.x, y:actor.y, endsAt:this.game.state.elapsed + 3 };
    return true;
  }

  updateActions() {
    const g = this.game;
    for (const actor of g._onlineCoopPlayers()) {
      const entry = g._remoteEntryForActor(actor), keys = entry ? entry.input?.keys : g.state.keys;
      const use = actor.barrierRemoval;
      if (use) {
        if ((!keys?.e && (!entry || g.state.elapsed >= use.endsAt-2.8)) || actor.downed || actor.stunned > 0 || actor.flashStunTimer > 0 || actor.dodgeTimer > 0 ||
          Math.hypot(actor.x-use.x,actor.y-use.y) > 0.1 || this.facingBarrier(actor)?.id !== use.id ||
          entry?.inputStale || entry?.qte || (!entry && (g.state.pauseMenuOpen || g.state.inventoryOpen || g.state.fullMapOpen || g.state.activeQte))) actor.barrierRemoval = null;
        else if (g.state.elapsed >= use.endsAt) {
          if (g.state.barriers.some(b=>b.id===use.id)) {this.event('barrier-remove',{id:use.id});this.invalidatePaths();}
          actor.barrierRemoval=null;
        }
      }
      const serial = actor.reloadSerial || 0;
      if (serial > (this.reloadSeen.get(actor) || 0)) {
        this.event('debris',{id:`mag:${g.state.missionFxId}:${this.sequence+1}`,kind:'magazine',weaponId:actor.weaponId,
          x:actor.x+Math.cos(actor.angle+1.6)*12,y:actor.y+Math.sin(actor.angle+1.6)*12,angle:actor.angle+0.7,born:g.state.elapsed});
      }
      this.reloadSeen.set(actor,serial);
    }
  }

  attackObstacle(enemy, target, dt, type) {
    if (!enemy.active || enemy.dead || enemy.recoverTimer > 0 || enemy.flashStunTimer > 0 ||
        enemy.phase === 'stunned' || enemy.phase === 'windup' || enemy.phase === 'charge') return;
    const last = this.enemyBlocks.get(enemy) || { x:enemy.x,y:enemy.y,remaining:0 };
    last.remaining = Math.max(0,last.remaining-dt);
    const moved = Math.hypot(enemy.x-last.x,enemy.y-last.y); last.x=enemy.x;last.y=enemy.y;this.enemyBlocks.set(enemy,last);
    if ((!target && !enemy.alerted) || moved > 3 || last.remaining > 0) return;
    if (target && Math.hypot(target.x-enemy.x,target.y-enemy.y)<enemy.radius+(target.radius||10)+5) return;
    const nearest = this.nearby(enemy.x, enemy.y, enemy.radius + 18)
      .map(b => ({ b, x:Math.max(b.x,Math.min(enemy.x,b.x+b.w)), y:Math.max(b.y,Math.min(enemy.y,b.y+b.h)) }))
      .sort((a,b) => Math.hypot(a.x-enemy.x,a.y-enemy.y)-Math.hypot(b.x-enemy.x,b.y-enemy.y));
    const block = nearest.find(point => Math.hypot(point.x-enemy.x,point.y-enemy.y) <= enemy.radius+12);
    if (!block) return;
    const {b}=block, d=Math.hypot(block.x-enemy.x,block.y-enemy.y);
    const angle=Math.atan2(block.y-enemy.y,block.x-enemy.x);
    if (d && this.game.map.rayWallDistance(enemy.x,enemy.y,Math.cos(angle),Math.sin(angle),d)<d-1) return;
    enemy.angle=angle;
    if (type==='heavy') {enemy.phase='windup';enemy.phaseTimer=2;enemy.chargeAngle=angle;enemy.angle=angle;return;}
    if ((enemy.attackCooldown||0)>0) return;
    const interval=type==='hunter'?0.5:0.2;
    enemy.attackCooldown=interval;last.remaining=interval;this.damage(b.id,1);
  }

  addCasing(actor, id) {
    if (this.casingIds.has(id)) return;
    this.casingIds.add(id);
    if(this.casingIds.size>1200)this.casingIds.delete(this.casingIds.values().next().value);
    const a=actor.angle+1.25;
    this.game.state.casings.push({id,kind:'casing',x:actor.x+Math.cos(a)*16,y:actor.y+Math.sin(a)*16,angle:a,born:this.game.state.elapsed});
    if(this.game.state.casings.length>600)this.game.state.casings.shift();
  }

  enemyKey(enemy) { return enemy.id || `hunter:${enemy.spawnIndex}`; }

  hit(enemy, amount, shotId) {
    if (!(amount>0)) return;
    this.event('hit',{key:this.enemyKey(enemy),x:enemy.x,y:enemy.y,radius:enemy.radius,amount,shotId,born:this.game.state.elapsed});
  }

  showHit(data) {
    const g=this.game;
    const enemy=[...(g.hunters||[]),...(g.nightmares||[]),...(g.heavies||[])].find(e=>this.enemyKey(e)===data.key);
    if(enemy)enemy.hitFlashUntil=g.state.elapsed+0.08;
    for(const corpse of [...(g.corpseRegistry||[]),...(g.state.corpses||[])]) {
      if(corpse.effectKey===data.key)corpse.hitFlashUntil=g.state.elapsed+0.08;
    }
    const existing=g.state.damageNumbers.find(n=>n.key===data.key && n.shotId===data.shotId && data.shotId);
    if(existing){existing.amount+=data.amount;return;}
    g.state.damageNumbers.push({...data,born:g.state.elapsed});
    if(g.state.damageNumbers.length>128)g.state.damageNumbers.shift();
  }

  updateVisuals() {
    const g=this.game,now=g.state.elapsed;
    g.state.casings=g.state.casings.filter(d=>now-d.born<10);
    g.state.damageNumbers=g.state.damageNumbers.filter(d=>now-d.born<0.9);
    if(g.state.barrierBlueprint){
      const {vertical}=g.state.barrierBlueprint;
      g.state.barrierBlueprint=this.blueprint(g.player,g.state.mouseX,g.state.mouseY,vertical);
      if(g.player.downed||g.player.stunned>0||g.player.flashStunTimer>0||g.state.inventoryOpen||g.state.fullMapOpen||g.state.pauseMenuOpen)g.state.barrierBlueprint=null;
    }
  }
}
