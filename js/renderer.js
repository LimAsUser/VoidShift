/**
 * VOID SHIFT // RECOVERY OPERATIONS PROTOCOL
 * Renderer Stage (World Map, Occluding Flashlight Vision, and Radar Minimap)
 */

class Renderer {
  constructor(uiManager) {
    this.ui = uiManager;
    this.renderDpr = 1;
    this.cameraOffsetX = 0;
    this.cameraOffsetY = 0;
    this.sprites = {};
    this.hitMasks = {};
    this.roomCaches = new WeakMap();
    this.corpseTextures = new Map();
    this.corpseTextureBytes = 0;
    this.corpseTextureBudget = 64 * 1024 * 1024;
    this.motionQuery = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-reduced-motion: reduce)') : null;
  }

  sprite(name) {
    if (!this.sprites[name]) {
      const image = new Image();
      image.src = `resources/images/${name}${['monster', 'hunter', 'heavy'].includes(name) ? '-topdown' : ''}.png`;
      this.sprites[name] = image;
    }
    return this.sprites[name];
  }

  drawEnemyBody(ctx, name, width, hitFlash = false) {
    const image = this.sprite(name);
    if (!image.complete || !image.naturalWidth) return false;
    const height = width * image.naturalHeight / image.naturalWidth;
    ctx.drawImage(image, -width / 2, -height / 2, width, height);
    if (hitFlash) {
      if (!this.hitMasks[name]) {
        const mask = document.createElement('canvas');
        mask.width = Math.min(512, image.naturalWidth);
        mask.height = Math.max(1, Math.round(mask.width * image.naturalHeight / image.naturalWidth));
        const maskCtx = mask.getContext('2d');
        maskCtx.drawImage(image, 0, 0, mask.width, mask.height);
        maskCtx.globalCompositeOperation = 'source-in';
        maskCtx.fillStyle = '#fff';
        maskCtx.fillRect(0, 0, mask.width, mask.height);
        this.hitMasks[name] = mask;
      }
      ctx.drawImage(this.hitMasks[name], -width / 2, -height / 2, width, height);
    }
    return true;
  }

  visibleWorldPoint(point, player, mapManager, state) {
    const frame = this._visibilityFrame;
    const cache = frame?.player === player && frame.map === mapManager && frame.state === state ? frame.cache : null;
    const extent = Math.max(12, point.radius || point.r || 0);
    if (cache && frame.cameraX === this.cameraOffsetX && frame.cameraY === this.cameraOffsetY && frame.zoom === state.cameraZoom) {
      const view = frame.viewport;
      if (point.x + extent < view.left - 32 || point.x - extent > view.right + 32 || point.y + extent < view.top - 32 || point.y - extent > view.bottom + 32) return false;
    } else if (!this.inViewport({ x: point.x - extent, y: point.y - extent, w: extent * 2, h: extent * 2 }, state)) return false;
    const points = cache ? frame.pointCache : null;
    const memo = points?.get(point);
    if (memo && memo.x === point.x && memo.y === point.y) return memo.visible;
    const key = cache ? `${point.x},${point.y}` : null;
    const visible = cache?.has(key) ? cache.get(key)
      : isPointVisibleToPlayer(point.x, point.y, player, mapManager, frame?.state === state ? frame.lights : this.roomLightLevel(state) > 0);
    if (cache) { if (cache.size >= 16384) cache.clear();cache.set(key, visible); }
    if (points) points.set(point, { x: point.x, y: point.y, visible });
    return visible;
  }

  _beginRenderFrame(player, map, state) {
    this._renderFrame = (this._renderFrame || 0) + 1;
    this._textureDeadline = null;
    const previous = this._visibilityFrame;
    const lights = this.roomLightLevel(state) > 0;
    const sight = [player.x, player.y, player.angle, !!player.flashlight, !!player.downed, !!player.dead,
      lights, Config.player.flashlightRange, Config.player.flashlightSpread, Config.VIEW_W, Config.VIEW_H, Config.camera.baseZoom];
    const doors = (map.doors || []).map(door => door.open ? '1' : '0').join('');
    const unchanged = previous?.player === player && previous.map === map && previous.state === state &&
      previous.ray === map.rayWallDistance && previous.geometry === map._collisionIndex &&
      previous.walls === map.walls && previous.wallCount === map.walls?.length && previous.doors === map.doors &&
      previous.doorStates === doors && sight.every((value, i) => value === previous.sight[i]);
    // Exact inputs only: no angle/position quantization and no stale visibility across door changes.
    this._visibilityFrame = { player, map, state, lights, sight, doorStates: doors, doors: map.doors,
      walls: map.walls, wallCount: map.walls?.length, geometry: map._collisionIndex, ray: map.rayWallDistance,
      cache: unchanged ? previous.cache : new Map(), pointCache: unchanged ? previous.pointCache || new WeakMap() : null,
      cameraX: this.cameraOffsetX, cameraY: this.cameraOffsetY,
      zoom: state.cameraZoom, viewport: this._viewportBounds(state) };
    const scale = this.renderDpr * Math.max(this.ui.canvas.clientWidth / Config.VIEW_W, this.ui.canvas.clientHeight / Config.VIEW_H) * (state.cameraZoom || 1);
    this._corpseTextureScale = Math.max(1, Math.ceil(scale * 4) / 4);
  }

  _dropCorpseTexture(id) {
    const entry = this.corpseTextures.get(id);
    if (!entry) return;
    for (const part of entry.parts) if (part) { part.image.width = 0;if (part.white) part.white.width = 0; }
    this.corpseTextureBytes -= entry.bytes;
    this.corpseTextures.delete(id);
  }

  clearCorpseTextures() {
    for (const id of this.corpseTextures.keys()) this._dropCorpseTexture(id);
    this._visibilityFrame = null;
    this.corpseTextureBytes = 0;
  }

  _reserveCorpseTexture(bytes, id) {
    if (bytes > this.corpseTextureBudget) return false;
    while (this.corpseTextureBytes + bytes > this.corpseTextureBudget) {
      let oldest;
      for (const [key, entry] of this.corpseTextures) {
        if (key !== id && entry.lastFrame < this._renderFrame - 1 && (!oldest || entry.lastFrame < oldest[1].lastFrame)) oldest = [key, entry];
      }
      // Never thrash textures still being used by the visible scene.
      if (!oldest) return false;
      this._dropCorpseTexture(oldest[0]);
    }
    return true;
  }

  _corpseTextureEntry(corpse) {
    if (!this._renderFrame) return null;
    const image = this.sprite(corpse.kind);
    if (!image.complete || !image.naturalWidth) return null;
    const scale = this._corpseTextureScale, width = corpse.width, height = width * corpse.aspect;
    const key = `${corpse.kind}:${corpse.seed}:${width}:${corpse.aspect}:${scale}:${image.src}`;
    let entry = this.corpseTextures.get(corpse.id);
    if (entry && entry.key !== key) { this._dropCorpseTexture(corpse.id);entry = null; }
    if (!entry) { entry = { key, image, scale, parts: [], bytes: 0, lastFrame: this._renderFrame };this.corpseTextures.set(corpse.id, entry); }
    entry.lastFrame = this._renderFrame;
    return entry;
  }

  _corpseTexture(corpse, shape, partIndex, hitFlash, entry) {
    if (!entry) return null;
    const { image, scale } = entry, width = corpse.width, height = width * corpse.aspect;
    let part = entry.parts[partIndex];
    if (part && (!hitFlash || part.white)) return part;
    const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
    this._textureDeadline ??= now() + 2;
    if (now() >= this._textureDeadline) return null;
    if (!part) {
      const x = Math.min(...shape.polygon.map(p => (p.x - shape.cx) * width)) - 2 / scale;
      const y = Math.min(...shape.polygon.map(p => (p.y - shape.cy) * height)) - 2 / scale;
      const w = Math.ceil((Math.max(...shape.polygon.map(p => (p.x - shape.cx) * width)) - x) * scale) + 2;
      const h = Math.ceil((Math.max(...shape.polygon.map(p => (p.y - shape.cy) * height)) - y) * scale) + 2;
      const bytes = w * h * 4;
      if (!this._reserveCorpseTexture(bytes, corpse.id)) return null;
      const bitmap = document.createElement('canvas');bitmap.width = w;bitmap.height = h;
      const ctx = bitmap.getContext('2d');if (!ctx) return null;
      ctx.setTransform(scale, 0, 0, scale, -(x + shape.cx * width) * scale, -(y + shape.cy * height) * scale);
      ctx.beginPath();shape.polygon.forEach((p, i) => i ? ctx.lineTo(p.x * width, p.y * height) : ctx.moveTo(p.x * width, p.y * height));ctx.closePath();ctx.clip();
      const imageHeight = width * image.naturalHeight / image.naturalWidth;
      ctx.drawImage(image, -width / 2, -imageHeight / 2, width, imageHeight);
      part = { image: bitmap, x, y, w: w / scale, h: h / scale, bytes, white: null };entry.parts[partIndex] = part;
      entry.bytes += bytes;this.corpseTextureBytes += bytes;
    }
    if (hitFlash && !part.white) {
      if (now() >= this._textureDeadline || !this._reserveCorpseTexture(part.bytes, corpse.id)) return null;
      const mask = document.createElement('canvas');mask.width = part.image.width;mask.height = part.image.height;
      const ctx = mask.getContext('2d');if (!ctx) return null;
      ctx.drawImage(part.image, 0, 0);ctx.globalCompositeOperation = 'source-in';ctx.fillStyle = '#fff';ctx.fillRect(0, 0, mask.width, mask.height);
      part.white = mask;entry.bytes += part.bytes;this.corpseTextureBytes += part.bytes;
    }
    return part;
  }

  _corpseInViewport(corpse, state) {
    const extent = Math.max(64, corpse.width);
    let minX = corpse.x - extent, maxX = corpse.x + extent, minY = corpse.y - extent, maxY = corpse.y + extent;
    for (const part of corpse.fragments) {
      const radius = part.radius || corpse.width;
      minX = Math.min(minX, part.x - radius);maxX = Math.max(maxX, part.x + radius);
      minY = Math.min(minY, part.y - radius);maxY = Math.max(maxY, part.y + radius);
    }
    return this.inViewport({ x: minX, y: minY, w: maxX - minX, h: maxY - minY }, state);
  }

  _enemyInViewport(actor, width, state) {
    const extent = width + 80; // Rotation, rings and status text all fit inside this conservative box.
    return this.inViewport({ x: actor.x - extent, y: actor.y - extent, w: extent * 2, h: extent * 2 }, state);
  }

  drawDiscovery(ctx, actor, width, player, mapManager, state) {
    if (!(actor.discoveryTimer > 0) || actor.dead || !this.visibleWorldPoint(actor, player, mapManager, state)) return;
    ctx.save();
    ctx.fillStyle = '#ffe8ba';
    ctx.font = 'bold 21px monospace';
    ctx.textAlign = 'center';
    ctx.shadowBlur = 0;
    ctx.fillText('!', actor.x, actor.y - width / 2 - 12);
    ctx.restore();
  }

  drawDamageNumbers(ctx, player, mapManager, state) {
    for (const number of state.damageNumbers || []) {
      const age = Math.max(0, state.elapsed - number.born);
      if (age >= 0.9 || !this.visibleWorldPoint(number, player, mapManager, state)) continue;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - age / 0.9);
      ctx.fillStyle = '#fff1dc';
      ctx.font = 'bold 16px monospace';
      ctx.textAlign = 'center';
      ctx.shadowBlur = 0;
      const rise = this.motionQuery?.matches ? 0 : age / 0.9 * 24;
      ctx.fillText(String(Math.round(number.amount)), number.x, number.y - (number.radius || 20) - 14 - rise);
      ctx.restore();
    }
  }

  drawShield(ctx, actor, state) {
    if (!(actor.shieldUntil > state.elapsed)) return;
    ctx.save();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(101,221,235,.08)';
    ctx.strokeStyle = 'rgba(101,221,235,.38)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(actor.x, actor.y, (actor.radius || 10) + 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  drawGroundDebris(ctx, player, mapManager, state) {
    const draw = (debris, magazine) => {
      const age = Math.max(0, state.elapsed - debris.born);
      if ((!magazine && age >= 10) || !this.visibleWorldPoint(debris, player, mapManager, state)) return;
      ctx.save();
      ctx.globalAlpha = magazine || age <= 8 ? 1 : (10 - age) / 2;
      const bounce = !this.motionQuery?.matches && age < 0.3 ? Math.sin(age / 0.3 * Math.PI) * 3 : 0;
      ctx.translate(debris.x, debris.y - bounce);
      ctx.rotate(debris.angle || 0);
      ctx.fillStyle = magazine ? '#7c8d97' : '#bea271';
      ctx.fillRect(magazine ? -3 : -2, magazine ? -6 : -1, magazine ? 6 : 4, magazine ? 12 : 2);
      ctx.fillStyle = magazine ? '#394953' : '#e7c99c';
      ctx.fillRect(magazine ? -2 : -1.5, magazine ? -5 : -1, magazine ? 1 : 1, magazine ? 9 : 2);
      ctx.restore();
    };
    for (const casing of state.casings || []) draw(casing, false);
    for (const magazine of state.magazines || []) draw(magazine, true);
  }

  drawBarriers(ctx, player, mapManager, state) {
    const image = this.sprite('equipment-v17/barrier');
    const draw = (barrier, blueprint) => {
      if (!this.inViewport(barrier, state)) return;
      const center = { x: barrier.x + barrier.w / 2, y: barrier.y + barrier.h / 2 };
      if (!blueprint && !this.visibleWorldPoint(center, player, mapManager, state)) return;
      ctx.save();
      ctx.translate(center.x, center.y);
      const vertical = barrier.vertical ?? barrier.h > barrier.w;
      const width = vertical ? barrier.h : barrier.w, height = vertical ? barrier.w : barrier.h;
      if (vertical) ctx.rotate(Math.PI / 2);
      ctx.globalAlpha = blueprint ? 0.4 : 1;
      if (image.complete && image.naturalWidth) ctx.drawImage(image, -width / 2, -height / 2, width, height);
      ctx.strokeStyle = blueprint ? (barrier.valid ? '#65ddeb' : '#ff615f') : '#7b9eab';
      ctx.lineWidth = blueprint ? 2 : 1;
      ctx.strokeRect(-width / 2, -height / 2, width, height);
      if (blueprint) {
        ctx.fillStyle = barrier.valid ? 'rgba(101,221,235,.25)' : 'rgba(255,97,95,.25)';
        ctx.fillRect(-width / 2, -height / 2, width, height);
      }
      ctx.restore();
      if (!blueprint) {
        ctx.save();
        ctx.fillStyle = '#d9edf1';
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${Math.max(0, Math.round(barrier.hp))} / 20`, center.x, barrier.y - 8);
        ctx.restore();
      }
    };
    for (const barrier of state.barriers || []) draw(barrier, false);
    if (state.barrierBlueprint) draw(state.barrierBlueprint, true);
  }

  drawCorpseFragments(ctx, corpse, player, mapManager, state) {
    if (!this._corpseInViewport(corpse, state)) return;
    this.corpseLayouts ||= new Map();
    let layout=this.corpseLayouts.get(corpse.id);
    if(!layout){
      const random=CorpseEffects.random(corpse.seed^0x72be31);
      const stains=Array.from({length:11},(_,i)=>{
        const angle=random()*Math.PI*2,distance=i?random()*corpse.width*.48:0;
        const radius=i?2+random()*corpse.width*.075:corpse.width*.2;
        const reach=mapManager.rayWallDistance?.(corpse.x,corpse.y,Math.cos(angle),Math.sin(angle),distance)??distance;
        let d=Math.max(0,Math.min(distance,reach-radius-9));
        while(d>0&&mapManager.blocked?.(corpse.x+Math.cos(angle)*d,corpse.y+Math.sin(angle)*d,radius))d=Math.max(0,d-2);
        return {x:corpse.x+Math.cos(angle)*d,y:corpse.y+Math.sin(angle)*d,r:radius};
      });
      const spray=Array.from({length:corpse.kind==='heavy'?18:12},()=>({angle:random()*Math.PI*2,speed:40+random()*90,r:1+random()*2.4}));
      layout={parts:CorpseEffects.geometry(corpse.seed,corpse.fragments.length),stains,spray};this.corpseLayouts.set(corpse.id,layout);
    }
    const fade=corpse.fadeRemaining==null?1:Math.max(0,Math.min(1,corpse.fadeRemaining));
    ctx.save();ctx.globalAlpha=fade*.64;ctx.fillStyle='#701c2b';ctx.beginPath();
    for(const stain of layout.stains)if(this.visibleWorldPoint(stain,player,mapManager,state)){ctx.moveTo(stain.x+stain.r,stain.y);ctx.arc(stain.x,stain.y,stain.r,0,Math.PI*2);}
    ctx.fill();ctx.restore();
    const width=corpse.width,height=width*corpse.aspect;
    let textureEntry;
    corpse.fragments.forEach((part,i)=>{
      if(!this.visibleWorldPoint(part,player,mapManager,state))return;
      if(textureEntry===undefined)textureEntry=this._corpseTextureEntry(corpse);
      const shape=layout.parts[i];ctx.save();ctx.globalAlpha=fade;ctx.translate(part.x,part.y);
      ctx.rotate(this.motionQuery?.matches?corpse.angle:part.angle);
      ctx.scale(part.scale || 1,part.scale || 1);
      const flash = corpse.hitFlashUntil > state.elapsed;
      const texture = this._corpseTexture(corpse, shape, i, flash, textureEntry);
      if (texture) {
        ctx.drawImage(texture.image, texture.x, texture.y, texture.w, texture.h);
        if (flash) ctx.drawImage(texture.white, texture.x, texture.y, texture.w, texture.h);
        ctx.restore();return;
      }
      ctx.translate(-shape.cx*width,-shape.cy*height);ctx.beginPath();
      shape.polygon.forEach((p,j)=>{if(j)ctx.lineTo(p.x*width,p.y*height);else ctx.moveTo(p.x*width,p.y*height);});ctx.closePath();ctx.clip();
      this.drawEnemyBody(ctx,corpse.kind,width,corpse.hitFlashUntil>state.elapsed);ctx.restore();
    });
    const age=Math.max(0,state.elapsed-(corpse.burstAt??corpse.born));
    if(!this.motionQuery?.matches&&!corpse.suppressBurst&&age<.45){
      ctx.save();ctx.globalAlpha=fade*(1-age/.45);ctx.fillStyle='#b33447';ctx.beginPath();
      for(const particle of layout.spray){
        const distance=particle.speed*age;
        const reach=mapManager.rayWallDistance?.(corpse.x,corpse.y,Math.cos(particle.angle),Math.sin(particle.angle),distance)??distance;
        const d=Math.max(0,Math.min(distance,reach-particle.r-9));const x=corpse.x+Math.cos(particle.angle)*d,y=corpse.y+Math.sin(particle.angle)*d;
        if(!this.visibleWorldPoint({x,y},player,mapManager,state))continue;
        ctx.moveTo(x+particle.r,y);ctx.arc(x,y,particle.r,0,Math.PI*2);
      }
      ctx.fill();ctx.restore();
    }
  }

  drawEnemyRing(ctx, bodyWidth, originalWidth = bodyWidth) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, bodyWidth / 2 + 4 * bodyWidth / originalWidth, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(239,68,68,0.12)';
    ctx.fill();
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  drawEvacBeacon(ctx, point, state, worldScale) {
    ctx.save();
    ctx.translate(point.x, point.y);
    const inverse = 1 / Math.max(0.001, worldScale);
    ctx.scale(inverse, inverse);
    ctx.fillStyle = '#d7f36b';
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.fill();
    for (let index = 0; index < 2; index++) {
      const phase = this.motionQuery?.matches ? index * 0.5 : ((Number(state?.elapsed) || 0) / 2.4 + index * 0.5) % 1;
      ctx.globalAlpha = this.motionQuery?.matches ? 0.8 : 0.8 * (1 - phase);
      ctx.strokeStyle = '#d7f36b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 14 + phase * 34, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#041923ee';
    ctx.fillRect(-87, -70, 174, 26);
    ctx.fillStyle = '#eaff90';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(state?.rescueArrived ? '撤离点 · 救援已抵达' : state?.extractionCalled ? '撤离点 · 救援途中'
      : state?.hideInteractionHints && state?.missionMode !== 'training' ? '撤离点 · 已解锁' : '撤离点 · 按 E 呼叫', 0, -52);
    ctx.restore();
  }

  drawTerminalBeacon(ctx, terminal, index, state, worldScale) {
    ctx.save();
    ctx.translate(terminal.x, terminal.y);
    const inverse = 1 / Math.max(0.001, worldScale);
    ctx.scale(inverse, inverse);
    if (!terminal.solved) {
      for (let ring = 0; ring < 2; ring++) {
        const phase = this.motionQuery?.matches ? ring * 0.5 : ((Number(state?.elapsed) || 0) / 2.4 + ring * 0.5) % 1;
        ctx.globalAlpha = this.motionQuery?.matches ? 0.65 : 0.7 * (1 - phase);
        ctx.strokeStyle = '#65ddeb';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, 12 + phase * 25, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    const image = this.sprite('equipment-v17/terminal');
    if (image.complete && image.naturalWidth) ctx.drawImage(image, -10, -10, 20, 20);
    ctx.fillStyle = terminal.solved ? '#50e3c2' : '#65ddeb';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`T-${index + 1} · ${terminal.solved ? 'OK' : '待破解'}`, 0, -15);
    ctx.restore();
  }

  roomLightLevel(state) {
    if (state?.powerLossStartedAt == null) return 1;
    const elapsed = Math.max(0, (Number(state.elapsed) || 0) - state.powerLossStartedAt);
    if (elapsed >= 2) return 0;
    if (this.motionQuery?.matches) return 1 - elapsed / 2;
    return elapsed % 0.5 < 0.12 ? 1 : 0.08;
  }

  stripLightLevel(strip, state) {
    if (strip.state === 'off') return 0;
    if (strip.state !== 'flicker') return 1;
    if (this.motionQuery?.matches) return 0.5;
    const time = (Number(state?.elapsed) || 0) + (strip.phase || 0) * 31;
    return 0.5 + 0.28 * Math.sin(time * 1.13) + 0.17 * Math.sin(time * 0.47 + 2.4);
  }

  traceRoom(ctx, room) {
    const points = room.vertices?.length ? room.vertices : [
      { x: room.x, y: room.y }, { x: room.x + room.w, y: room.y },
      { x: room.x + room.w, y: room.y + room.h }, { x: room.x, y: room.y + room.h }
    ];
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index++) ctx.lineTo(points[index].x, points[index].y);
    ctx.closePath();
  }

  traceMapRoomWalls(ctx, room) {
    if (!room.wallSegments) return this.traceRoom(ctx, room);
    ctx.beginPath();
    for (const wall of room.wallSegments) {
      ctx.moveTo(wall.x1, wall.y1);
      ctx.lineTo(wall.x2, wall.y2);
    }
  }

  roomCache(room) {
    let cached = this.roomCaches.get(room);
    if (!cached) {
      const points = room.vertices?.length ? room.vertices : [{ x: room.x, y: room.y }, { x: room.x + room.w, y: room.y + room.h }];
      const x = Math.min(...points.map(point => point.x)), y = Math.min(...points.map(point => point.y));
      cached = { x, y, w: Math.max(1, Math.max(...points.map(point => point.x)) - x),
        h: Math.max(1, Math.max(...points.map(point => point.y)) - y) };
      this.roomCaches.set(room, cached);
    }
    return cached;
  }

  _viewportBounds(state) {
    const zoom = Math.max(0.1, state?.cameraZoom || 1);
    const centerX = Config.VIEW_W / 2 - this.cameraOffsetX;
    const centerY = Config.VIEW_H / 2 - this.cameraOffsetY;
    return { left: centerX - Config.VIEW_W / zoom / 2, right: centerX + Config.VIEW_W / zoom / 2,
      top: centerY - Config.VIEW_H / zoom / 2, bottom: centerY + Config.VIEW_H / zoom / 2 };
  }

  inViewport(bounds, state, margin = 32) {
    const frame = this._visibilityFrame;
    const view = frame?.state === state && frame.cameraX === this.cameraOffsetX && frame.cameraY === this.cameraOffsetY && frame.zoom === state?.cameraZoom
      ? frame.viewport : this._viewportBounds(state);
    return bounds.x + bounds.w >= view.left - margin && bounds.x <= view.right + margin &&
      bounds.y + bounds.h >= view.top - margin && bounds.y <= view.bottom + margin;
  }

  stripLightStrength(strip, x, y) {
    const dx = strip.x2 - strip.x1, dy = strip.y2 - strip.y1;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? Math.max(0, Math.min(1, ((x - strip.x1) * dx + (y - strip.y1) * dy) / lengthSquared)) : 0;
    const distance = Math.hypot(x - strip.x1 - dx * t, y - strip.y1 - dy * t);
    return 0.72 * Math.pow(Math.max(0, 1 - distance / Math.max(1, strip.range || 500)), 6);
  }

  roomLightField(room, state) {
    const cached = this.roomCache(room);
    if (!cached.lightField) {
      const scale = Math.min(1 / 8, 128 / Math.max(cached.w, cached.h));
      const width = Math.max(1, Math.ceil(cached.w * scale)), height = Math.max(1, Math.ceil(cached.h * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      const normal = new Float32Array(width * height);
      const faults = (room.lights || []).filter(strip => strip.state === 'flicker').map(strip => ({ strip, values: new Float32Array(width * height) }));
      const active = (room.lights || []).filter(strip => !['flicker', 'off'].includes(strip.state));
      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          const x = cached.x + (col + 0.5) / width * cached.w, y = cached.y + (row + 0.5) / height * cached.h;
          if (room.vertices?.length && !pointInPolygon(x, y, room.vertices)) continue;
          const index = row * width + col;
          for (const strip of active) normal[index] = Math.max(normal[index], this.stripLightStrength(strip, x, y));
          for (const fault of faults) fault.values[index] = this.stripLightStrength(fault.strip, x, y);
        }
      }
      cached.lightField = { canvas, ctx, width, height, normal, faults, values: new Float32Array(normal.length),
        pixels: ctx.createImageData?.(width, height), levels: null };
    }
    const field = cached.lightField;
    const levels = field.faults.map(fault => this.stripLightLevel(fault.strip, state));
    if (field.levels && levels.every((level, index) => level === field.levels[index])) return field;
    field.levels = levels;
    for (let index = 0; index < field.values.length; index++) {
      let strength = field.normal[index];
      for (let fault = 0; fault < field.faults.length; fault++) strength = Math.max(strength, field.faults[fault].values[index] * levels[fault]);
      field.values[index] = strength;
      if (field.pixels) field.pixels.data[index * 4 + 3] = Math.round(strength * 255);
    }
    if (field.pixels && field.ctx.putImageData) field.ctx.putImageData(field.pixels, 0, 0);
    else {
      field.ctx.clearRect(0, 0, field.width, field.height);
      for (let index = 0; index < field.values.length; index++) {
        field.ctx.fillStyle = `rgba(0,0,0,${field.values[index]})`;
        field.ctx.fillRect(index % field.width, Math.floor(index / field.width), 1, 1);
      }
    }
    return field;
  }

  roomBuffer(room, kind) {
    const cached = this.roomCache(room);
    const deck = kind === 'floor' ? this.sprite('starship/floor-deck') : null;
    const ready = !!(deck?.complete && deck.naturalWidth);
    if (cached[kind] && (kind !== 'floor' || cached.floorReady === ready)) return cached;
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, (kind === 'floor' ? 640 : 320) / Math.max(cached.w, cached.h));
    canvas.width = Math.max(1, Math.ceil(cached.w * scale));
    canvas.height = Math.max(1, Math.ceil(cached.h * scale));
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.translate(-cached.x, -cached.y);
    this.traceRoom(ctx, room);
    ctx.clip();
    if (kind === 'floor') {
      ctx.fillStyle = '#17232d';
      ctx.fillRect(cached.x, cached.y, cached.w, cached.h);
      if (ready) {
        for (let y = cached.y; y < cached.y + cached.h; y += 192) {
          for (let x = cached.x; x < cached.x + cached.w; x += 192) ctx.drawImage(deck, x, y, 192, 192);
        }
      }
      ctx.globalAlpha = room.kind === 'corridor' ? 0.08 : 0.12;
      ctx.fillStyle = room.accent || '#65ddeb';
      ctx.fillRect(cached.x, cached.y, cached.w, cached.h);
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = '#506c79';
      ctx.lineWidth = 14;
      this.traceRoom(ctx, room);
      ctx.stroke();
      cached.floorReady = ready;
    }
    cached[kind] = canvas;
    return cached;
  }

  forwardVisibilityPolygon(player, mapManager, range, steps = 80) {
    const points = [{ x: player.x, y: player.y }];
    const spread = Config.player.flashlightSpread;
    for (let index = 0; index <= steps; index++) {
      const angle = player.angle - spread + index / steps * spread * 2;
      const distance = mapManager.rayVisionDistance(player.x, player.y, Math.cos(angle), Math.sin(angle), range, 0);
      points.push({ x: player.x + Math.cos(angle) * distance, y: player.y + Math.sin(angle) * distance });
    }
    return points;
  }

  heavyChargeDistance(heavy, mapManager) {
    const angle = heavy.chargeAngle ?? heavy.angle ?? 0;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const radius = heavy.radius || Config.heavy?.radius || 44;
    const worldDiagonal = Math.hypot(mapManager.worldW || Config.WORLD_W || 1000,
      mapManager.worldH || Config.WORLD_H || 1000) + radius;
    const limit = Math.max(0, mapManager.rayWallDistance(heavy.x, heavy.y, dx, dy, worldDiagonal) - radius);
    let safe = 0;
    for (let distance = 8; distance <= limit; distance += 8) {
      if (mapManager.blocked(heavy.x + dx * distance, heavy.y + dy * distance, radius)) return safe;
      safe = distance;
    }
    return limit > safe && mapManager.blocked(heavy.x + dx * limit, heavy.y + dy * limit, radius) ? safe : limit;
  }

  flashBurstDistance(origin, mapManager, angle) {
    const radius = Config.flashbang.blastRadius;
    return Math.max(0, Math.min(radius, mapManager.rayWallDistance(origin.x, origin.y, Math.cos(angle), Math.sin(angle), radius)));
  }

  traceFlashRadius(ctx, origin, mapManager) {
    ctx.beginPath();
    for (let i = 0; i <= 32; i++) {
      const angle = i * Math.PI / 16;
      const distance = this.flashBurstDistance(origin, mapManager, angle);
      const x = origin.x + Math.cos(angle) * distance;
      const y = origin.y + Math.sin(angle) * distance;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
  }

  /**
   * Updates DPR configuration and internal transform coefficients
   */
  setDpr(dpr) {
    this.renderDpr = dpr;
  }

  /**
   * Prepares and resolves active camera translations and zooms
   */
  prepareCamera(player, gameState) {
    const canvas = this.ui.canvas;
    const visionCanvas = this.ui.visionCanvas;
    const ctx = this.ui.ctx;

    const baseScaleX = canvas.clientWidth / Config.VIEW_W;
    const baseScaleY = canvas.clientHeight / Config.VIEW_H;
    
    const lookX = gameState.cameraLookX || 0;
    const lookY = gameState.cameraLookY || 0;

    gameState.cameraZoom ??= Config.camera.baseZoom * (gameState.stabilized ? Config.camera.aimMultiplier : 1);
    
    // Total virtual offsets (in logical game design pixels)
    const totalOffsetX = lookX + (gameState.recoilX || 0) + (gameState.shakeX || 0);
    const totalOffsetY = lookY + (gameState.recoilY || 0) + (gameState.shakeY || 0);

    // Set the cameraOffset fields strictly in game logical units.
    // Notice how lookX and lookY are already in logical design pixels, no scaling must occur here.
    this.cameraOffsetX = -player.x + Config.VIEW_W / 2 - totalOffsetX;
    this.cameraOffsetY = -player.y + Config.VIEW_H / 2 - totalOffsetY;

    // Reset CSS transforms entirely to avoid double-zooming and alignment bugs
    canvas.style.transform = 'none';
    visionCanvas.style.transform = 'none';

    ctx.setTransform(this.renderDpr, 0, 0, this.renderDpr, 0, 0);
  }

  /**
   * Helper to apply scale, zoom and camera offset uniformly to any 2D context
   */
  applyCamera(ctx, scaleX, scaleY, gameState) {
    ctx.scale(scaleX, scaleY);
    
    // Zoom around the screen center
    if (gameState.cameraZoom !== 1) {
      ctx.translate(Config.VIEW_W / 2, Config.VIEW_H / 2);
      ctx.scale(gameState.cameraZoom, gameState.cameraZoom);
      ctx.translate(-Config.VIEW_W / 2, -Config.VIEW_H / 2);
    }
    
    ctx.translate(this.cameraOffsetX, this.cameraOffsetY);
  }

  /**
   * Projects coordinates from world-space to viewport-space (centered around player)
   */
  worldToScreen(x, y, player) {
    return {
      x: Config.VIEW_W / 2 + (x - player.x),
      y: Config.VIEW_H / 2 + (y - player.y)
    };
  }

  /**
   * Draws base game world (walls, player, items, monster, hunter)
   */
  draw(player, monster, mapManager, gameState, hunters, remotePlayers = []) {
    const ctx = this.ui.ctx;
    const w = this.ui.canvas.clientWidth;
    const h = this.ui.canvas.clientHeight;
    if (!(w > 0 && h > 0)) return;
    this._beginRenderFrame(player, mapManager, gameState);
    const scaleX = w / Config.VIEW_W;
    const scaleY = h / Config.VIEW_H;

    ctx.save();
    this.applyCamera(ctx, scaleX, scaleY, gameState);

    // Background
    const worldW = mapManager.worldW || Config.WORLD_W;
    const worldH = mapManager.worldH || Config.WORLD_H;
    ctx.fillStyle = '#03070d';
    ctx.fillRect(0, 0, worldW, worldH);
    if (mapManager.shipHull?.length) {
      this.traceRoom(ctx, { vertices: mapManager.shipHull });
      ctx.fillStyle = '#15212b';
      ctx.fill();
      ctx.lineWidth = 22;
      ctx.strokeStyle = '#31424f';
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#69808b';
      ctx.stroke();
    }

    // Raster floor panels are composed once per compartment, then drawn only near the camera.
    const visibleRooms = mapManager.worldRooms.filter(room => this.inViewport(this.roomCache(room), gameState));
    for (const room of visibleRooms) {
      const cached = this.roomBuffer(room, 'floor');
      ctx.drawImage(cached.floor, cached.x, cached.y, cached.w, cached.h);
    }
    const deck = this.sprite('starship/floor-deck');
    if (!this.bulkheadPattern && deck.complete && deck.naturalWidth && ctx.createPattern) {
      this.bulkheadPattern = ctx.createPattern(deck, 'repeat');
    }

    // Draw solid walls and obstacles with metallic bulkhead detailing
    mapManager.walls.forEach(wall => {
      const bounds = wall.x1 !== undefined ? { x: Math.min(wall.x1, wall.x2), y: Math.min(wall.y1, wall.y2),
        w: Math.abs(wall.x2 - wall.x1), h: Math.abs(wall.y2 - wall.y1) } : wall;
      if (!this.inViewport(bounds, gameState)) return;
      if (wall.x1 !== undefined) {
        // Line segment bulkhead wall
        ctx.save();
        // Heavy structural casing
        ctx.lineWidth = 14;
        ctx.lineCap = 'butt';
        ctx.strokeStyle = '#172633';
        ctx.beginPath();
        ctx.moveTo(wall.x1, wall.y1);
        ctx.lineTo(wall.x2, wall.y2);
        ctx.stroke();

        // Inner metallic plate
        ctx.lineWidth = 8;
        ctx.strokeStyle = this.bulkheadPattern || '#203545';
        ctx.beginPath();
        ctx.moveTo(wall.x1, wall.y1);
        ctx.lineTo(wall.x2, wall.y2);
        ctx.stroke();

        // Structural bevel highlight
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#477184';
        ctx.beginPath();
        ctx.moveTo(wall.x1, wall.y1);
        ctx.lineTo(wall.x2, wall.y2);
        ctx.stroke();
        ctx.restore();
      } else if (wall.x !== undefined) {
        ctx.save();
        if (wall.isBox) {
          // Cargo Crate: heavy reinforced container with industrial bevel, warning accents & latch
          ctx.fillStyle = '#142432';
          ctx.fillRect(wall.x, wall.y, wall.w, wall.h);

          // Inner plate
          ctx.fillStyle = '#203748';
          ctx.fillRect(wall.x + 3, wall.y + 3, wall.w - 6, wall.h - 6);

          // Border
          ctx.strokeStyle = '#4c7182';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(wall.x + 0.5, wall.y + 0.5, wall.w - 1, wall.h - 1);

          // Diagonal hazard accent corner
          ctx.fillStyle = '#e9a950';
          ctx.beginPath();
          ctx.moveTo(wall.x + 3, wall.y + 3);
          ctx.lineTo(wall.x + 12, wall.y + 3);
          ctx.lineTo(wall.x + 3, wall.y + 12);
          ctx.closePath();
          ctx.fill();

          // Center locking latch
          ctx.fillStyle = '#d7f36b';
          ctx.fillRect(wall.x + wall.w / 2 - 3, wall.y + wall.h / 2 - 3, 6, 6);
        } else if (wall.isProp) {
          // Thematic machinery unit (servers, reactors, lab stations, planters)
          ctx.fillStyle = '#101f2b';
          ctx.fillRect(wall.x, wall.y, wall.w, wall.h);

          ctx.fillStyle = '#1a2f3d';
          ctx.fillRect(wall.x + 2, wall.y + 2, wall.w - 4, wall.h - 4);

          ctx.strokeStyle = '#416578';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(wall.x + 0.5, wall.y + 0.5, wall.w - 1, wall.h - 1);

          // Horizontal cooling slats/ribs
          ctx.strokeStyle = '#121a16';
          ctx.lineWidth = 1;
          for (let vy = wall.y + 8; vy < wall.y + wall.h - 6; vy += 5) {
            ctx.beginPath();
            ctx.moveTo(wall.x + 6, vy);
            ctx.lineTo(wall.x + wall.w - 6, vy);
            ctx.stroke();
          }

          // Indicator LED
          const ledColor = wall.subType === 'reactor_core' ? '#e9a950' :
                           wall.subType === 'server_rack' ? '#50e3c2' : '#d7f36b';
          ctx.shadowColor = ledColor;
          ctx.shadowBlur = 6;
          ctx.fillStyle = ledColor;
          ctx.beginPath();
          ctx.arc(wall.x + 7, wall.y + 7, 2.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        } else {
          // Standard AABB architectural barrier
          ctx.fillStyle = '#172633';
          ctx.fillRect(wall.x, wall.y, wall.w, wall.h);

          if (wall.w > 8 && wall.h > 8) {
            ctx.fillStyle = '#203545';
            ctx.fillRect(wall.x + 2, wall.y + 2, wall.w - 4, wall.h - 4);
          }

          ctx.strokeStyle = '#355366';
          ctx.lineWidth = 1;
          ctx.strokeRect(wall.x + 0.5, wall.y + 0.5, wall.w - 1, wall.h - 1);

          ctx.strokeStyle = '#477184';
          ctx.beginPath();
          ctx.moveTo(wall.x + wall.w - 1, wall.y + 1);
          ctx.lineTo(wall.x + 1, wall.y + 1);
          ctx.lineTo(wall.x + 1, wall.y + wall.h - 1);
          ctx.stroke();
        }
        if (wall.isProp || wall.isBox) {
          const module = this.sprite('starship/room-module');
          if (module.complete && module.naturalWidth) {
            // Crop actual machinery from the room artwork onto its collision footprint.
            const crop = wall.isBox ? [0.72, 0.05, 0.08, 0.09] :
              wall.subType === 'reactor_core' ? [0.25, 0.025, 0.10, 0.11] :
              wall.subType === 'server_rack' ? [0.09, 0.05, 0.055, 0.09] : [0.60, 0.05, 0.08, 0.09];
            ctx.drawImage(module, crop[0] * module.naturalWidth, crop[1] * module.naturalHeight,
              crop[2] * module.naturalWidth, crop[3] * module.naturalHeight,
              wall.x + 2, wall.y + 2, Math.max(1, wall.w - 4), Math.max(1, wall.h - 4));
          }
        }
        ctx.restore();
      }
    });

    const lampPower = this.roomLightLevel(gameState);
    for (const room of visibleRooms) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#8fdae5';
      for (const strip of room.lights || []) {
        const intensity = lampPower * this.stripLightLevel(strip, gameState);
        ctx.strokeStyle = intensity ? '#c5eff4' : '#253540';
        ctx.globalAlpha = intensity || 0.5;
        ctx.shadowBlur = intensity * 9;
        ctx.beginPath();
        ctx.moveTo(strip.x1, strip.y1);
        ctx.lineTo(strip.x2, strip.y2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Airlock is the spawn; only the far evac pod becomes the rescue beacon.
    const evacUnlocked = !!mapManager.terminals?.length && mapManager.terminals.every(term => term.solved);
    const drawExtractionMarker = (pt, label, spawn = false) => {
      if (!pt) return;
      ctx.save();
      const ex = pt.x;
      const ey = pt.y;
      const r = 40;

      ctx.fillStyle = 'rgba(14,31,43,0.82)';
      ctx.fillRect(ex - r, ey - r, r * 2, r * 2);
      ctx.strokeStyle = spawn ? '#3b82f6' : evacUnlocked ? '#d7f36b' : '#477184';
      ctx.lineWidth = 2;
      ctx.strokeRect(ex - r, ey - r, r * 2, r * 2);

      // Inner pad circle
      ctx.strokeStyle = spawn ? '#60a5fa' : evacUnlocked ? '#d7f36b' : '#65ddeb';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(ex, ey, 22, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = spawn ? '#60a5fa' : evacUnlocked ? '#d7f36b' : '#78905d';
      ctx.font = '10px Space Mono';
      ctx.textAlign = 'center';
      ctx.fillText(label, ex, ey + 4);
      ctx.restore();
    };

    drawExtractionMarker(mapManager.extractionPoint, 'SPAWN', true);
    drawExtractionMarker(mapManager.exitExtractionPoint, 'EVAC POD');

    // 3 Security Override QTE Terminals
    if (mapManager.terminals) {
      mapManager.terminals.forEach(term => {
        ctx.save();
        ctx.translate(term.x, term.y);

        const terminalImage = this.sprite('equipment-v17/terminal');
        if (terminalImage.complete && terminalImage.naturalWidth) ctx.drawImage(terminalImage, -22, -22, 44, 44);
        ctx.fillStyle = term.solved ? '#50e3c2' : '#f5a623';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Proximity text prompt
        const dist = Math.hypot(term.x - player.x, term.y - player.y);
        if (dist < 55 && !term.solved) {
          ctx.fillStyle = '#f5a623';
          ctx.font = 'bold 10px Space Mono';
          if (!gameState.hideInteractionHints || gameState.missionMode === 'training') ctx.fillText('[E] OVERRIDE', 0, -25);
        } else if (dist < 55 && term.solved) {
          ctx.fillStyle = '#50e3c2';
          ctx.font = '9px Space Mono';
          ctx.fillText('OVERRIDDEN', 0, -25);
        }

        ctx.restore();
      });
    }

    // Searchable salvage uses a dedicated sprite; fog is applied later as usual.
    const crateImage = this.sprite('equipment-v17/crate');
    if (crateImage.complete && crateImage.naturalWidth) {
      for (const box of mapManager.containers || []) {
        const width = box.w || 44, height = box.h || 32;
        ctx.drawImage(crateImage, box.x - width / 2, box.y - height / 2, width, height);
      }
    }

    // Training/legacy collectibles (formal maps now use containers).
    mapManager.scrap.forEach(s => {
      if (s.found) return;
        ctx.save();
        ctx.translate(s.x, s.y);
        const legendary = s.rarity === 'legendary';
        const glowColor = legendary ? '#fff0a6' : s.rarity === 'rare' ? '#f5a623' : s.rarity === 'uncommon' ? '#50e3c2' : '#d7f36b';
        const size = legendary ? 28 : 24;
        const path = BackpackManager.imageFor(s).replace(/^resources\/images\//, '').replace(/\.png$/, '');
        const image = this.sprite(path);
        if (image.complete && image.naturalWidth) ctx.drawImage(image, -size / 2, -size / 2, size, size);
        ctx.strokeStyle = glowColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(-size / 2, -size / 2, size, size);
        if (legendary) {
          ctx.strokeStyle = '#fff8dc';
          ctx.lineWidth = 2;
          ctx.strokeRect(-12, -12, 24, 24);
        }
        ctx.restore();
    });

    for (const flash of gameState.flashbangs || []) {
      ctx.save();
      const grenade = flash.skillId === 'grenade';
      if (flash.landed && flash.fuse > 0) {
        this.traceFlashRadius(ctx, flash, mapManager);
        ctx.strokeStyle = grenade ? 'rgba(255,136,65,.6)' : 'rgba(255,227,150,.34)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      const image = this.sprite(grenade ? 'equipment-v17/grenade' : 'flashbang');
      const lift = flash.landed ? 0 : Math.min(12, Math.max(0, flash.remainingDistance || 0) * .08);
      if (image.complete && image.naturalWidth) ctx.drawImage(image, flash.x - 9, flash.y - 9 - lift, 18, 18);
      else { ctx.fillStyle = grenade ? '#ff8841' : '#ffe1a1'; ctx.fillRect(flash.x - 3, flash.y - 3 - lift, 6, 6); }
      ctx.restore();
    }
    for (const burst of gameState.flashBursts || []) {
      ctx.save();
      this.traceFlashRadius(ctx, burst, mapManager);
      const strength = Math.max(0, Math.min(.55, (burst.lifetime || 0) / .35 * .55));
      ctx.fillStyle = burst.skillId === 'grenade' ? `rgba(255,112,40,${strength})` : `rgba(255,247,211,${strength})`;
      ctx.fill();
      if (burst.skillId === 'grenade') {
        ctx.strokeStyle = `rgba(255,184,73,${strength})`;
        ctx.lineWidth = 4;
        ctx.stroke();
      }
      ctx.restore();
    }

    this.drawGroundDebris(ctx, player, mapManager, gameState);
    this.drawBarriers(ctx, player, mapManager, gameState);

    const hasCorpseRegistry = Array.isArray(gameState.corpses);
    if (this.corpseLayouts) {
      const retained=new Set((gameState.corpses||[]).map(corpse=>corpse.id));
      for(const id of this.corpseLayouts.keys())if(!retained.has(id))this.corpseLayouts.delete(id);
      for(const id of this.corpseTextures.keys())if(!retained.has(id))this._dropCorpseTexture(id);
    }
    for (const corpse of gameState.corpses || []) {
      if(corpse.fragments?.length){this.drawCorpseFragments(ctx,corpse,player,mapManager,gameState);continue;}
      const width = corpse.width;
      const image = this.sprite(`${corpse.kind}-down`);
      const height = image.naturalWidth ? width * image.naturalHeight / image.naturalWidth : width;
      const extent = Math.hypot(width, height) / 2;
      if (!this.inViewport({ x: corpse.x - extent, y: corpse.y - extent, w: extent * 2, h: extent * 2 }, gameState)) continue;
      ctx.save();
      ctx.globalAlpha = corpse.fadeRemaining == null ? 1 : Math.max(0, Math.min(1, corpse.fadeRemaining));
      ctx.translate(corpse.x, corpse.y);
      ctx.rotate(corpse.angle || 0);
      this.drawEnemyBody(ctx, `${corpse.kind}-down`, width,
        corpse.hitFlashUntil > gameState.elapsed && this.visibleWorldPoint(corpse, player, mapManager, gameState));
      ctx.restore();
    }

    const heavies = Array.isArray(gameState.heavies) ? gameState.heavies : [gameState.heavy];
    const heavyWidth = Config.heavy?.spriteWidth || 112;
    for (const heavy of heavies) {
      if (!heavy || (heavy.dead ? hasCorpseRegistry || !(heavy.corpseTime > 0) : !heavy.active)) continue;
      if (!heavy.dead && gameState.selectedDifficulty !== 'hard' && (heavy.phase === 'windup' || heavy.phase === 'charge')) {
        const angle = heavy.chargeAngle ?? heavy.angle;
        const dx = Math.cos(angle), dy = Math.sin(angle);
        const distance = this.heavyChargeDistance(heavy, mapManager);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(heavy.x, heavy.y);
        ctx.lineTo(heavy.x + dx * distance, heavy.y + dy * distance);
        ctx.lineWidth = (heavy.radius || Config.heavy?.radius || 44) * 2;
        ctx.lineCap = 'round';
        ctx.strokeStyle = heavy.phase === 'windup' ? 'rgba(255,102,58,.25)' : 'rgba(255,102,58,.42)';
        ctx.stroke();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ff9b58';
        ctx.stroke();
        ctx.restore();
      }
      if (!this._enemyInViewport(heavy, heavyWidth, gameState)) continue;
      ctx.save();
      if (heavy.dead) ctx.globalAlpha = Math.min(1, heavy.corpseTime);
      ctx.translate(heavy.x, heavy.y);
      ctx.rotate(heavy.angle || 0);
      if (!heavy.dead && gameState.selectedDifficulty === 'easy') this.drawEnemyRing(ctx, heavyWidth, 56);
      this.drawEnemyBody(ctx, heavy.dead ? 'heavy-down' : 'heavy', heavyWidth,
        heavy.hitFlashUntil > gameState.elapsed && this.visibleWorldPoint(heavy, player, mapManager, gameState));
      ctx.restore();
      this.drawDiscovery(ctx, heavy, heavyWidth, player, mapManager, gameState);
      if (!heavy.dead && (heavy.phase === 'stunned' || heavy.stunTimer > 0)) {
        ctx.save();
        ctx.fillStyle = '#b5f6ff';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('装甲失效', heavy.x, heavy.y - 35 * heavyWidth / 56);
        ctx.restore();
      }
    }

    // Nightmare entities share sprites, but each has independent sleep state.
    const nightmares = gameState.nightmares || [monster];
    for (const monster of nightmares) {
      if (!monster?.active) continue;
      const monsterWidth = Config.monster?.spriteWidth || 72;
      if (!this._enemyInViewport(monster, monsterWidth, gameState)) continue;
      ctx.save();
      ctx.translate(monster.x, monster.y);
      ctx.rotate(monster.angle);
      if (!(monster.recoverTimer > 0) && gameState.selectedDifficulty === 'easy') this.drawEnemyRing(ctx, monsterWidth, 48);
      if (!this.drawEnemyBody(ctx, monster.recoverTimer > 0 ? 'monster-down' : 'monster', monsterWidth,
        monster.hitFlashUntil > gameState.elapsed && this.visibleWorldPoint(monster, player, mapManager, gameState))) {
        ctx.scale(monsterWidth / 48, monsterWidth / 48);
        ctx.fillStyle = '#c6563e';
        ctx.beginPath();
        ctx.moveTo(17, 0);
        ctx.lineTo(-12, -11);
        ctx.lineTo(-8, 0);
        ctx.lineTo(-12, 11);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#f3b29a';
        ctx.fillRect(7, -3, 4, 3);
      }
      ctx.restore();
      this.drawDiscovery(ctx, monster, monsterWidth, player, mapManager, gameState);

      // Stunned / 10s recovery visual indicator
      if (monster.recoverTimer > 0) {
        ctx.save();
        ctx.translate(monster.x, monster.y);
        ctx.fillStyle = '#f5a623';
        ctx.shadowColor = '#f5a623';
        ctx.shadowBlur = 6;
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`⚡休眠瘫痪 ${monster.recoverTimer.toFixed(1)}s⚡`, 0, -42 * monsterWidth / 48);
        ctx.restore();
      }
    }

    // Hunter entities (teal, wall-following pathfinders)
    if (hunters && Array.isArray(hunters)) {
      hunters.forEach(hunter => {
        if (!hunter) return;
        if (hunter.dead ? hasCorpseRegistry || !(hunter.corpseTime > 0) : !hunter.active) return;
        const hunterWidth = Config.hunter?.spriteWidth || 63;
        if (!this._enemyInViewport(hunter, hunterWidth, gameState)) return;
        ctx.save();
        if (hunter.dead) ctx.globalAlpha = Math.min(1, hunter.corpseTime);
        ctx.translate(hunter.x, hunter.y);
        ctx.rotate(hunter.angle);
        if (!hunter.dead && gameState.selectedDifficulty === 'easy') this.drawEnemyRing(ctx, hunterWidth, 42);
        // Arrow body (teal)
        if (!this.drawEnemyBody(ctx, hunter.dead ? 'hunter-down' : 'hunter', hunterWidth,
          hunter.hitFlashUntil > gameState.elapsed && this.visibleWorldPoint(hunter, player, mapManager, gameState))) {
          ctx.scale(hunterWidth / 42, hunterWidth / 42);
          ctx.fillStyle = '#2db8b0';
          ctx.beginPath();
          ctx.moveTo(17, 0);
          ctx.lineTo(-12, -11);
          ctx.lineTo(-8, 0);
          ctx.lineTo(-12, 11);
          ctx.closePath();
          ctx.fill();
          // Eye
          ctx.fillStyle = '#a0f0eb';
          ctx.fillRect(7, -3, 4, 3);
        }
        ctx.restore();
        this.drawDiscovery(ctx, hunter, hunterWidth, player, mapManager, gameState);

      });
    }

    this.drawDamageNumbers(ctx, player, mapManager, gameState);

    // Remote co-op players
    const remoteEntries = Array.isArray(remotePlayers)
      ? remotePlayers
      : remotePlayers ? [{ player: remotePlayers, slot: 2, online: true }] : [];
    const playerColors = ['#75ddd0', '#75ddd0', '#75ddd0', '#75ddd0'];
    remoteEntries.forEach(entry => {
      const remotePlayer = entry.player || entry;
      const color = playerColors[(Math.max(1, entry.slot || 2) - 1) % playerColors.length];
      ctx.save();
      ctx.globalAlpha = (remotePlayer.downed ? 0.42 : 1) * (entry.online === false ? 0.3 : 1);
      ctx.translate(remotePlayer.x, remotePlayer.y);
      ctx.rotate(remotePlayer.angle);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(14, 0);
      ctx.lineTo(-9, -9);
      ctx.lineTo(-6, 0);
      ctx.lineTo(-9, 9);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#f5a623';
      ctx.fillRect(2, -2, 8, 4);
      ctx.restore();
      this.drawShield(ctx, remotePlayer, gameState);
      if (remotePlayer.invulnerable) {
        ctx.save();
        ctx.strokeStyle = 'rgba(117,221,208,.85)';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#75ddd0';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(remotePlayer.x, remotePlayer.y, 17, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      if (entry.online === false) {
        ctx.save();
        ctx.globalAlpha = 0.4;
        ctx.strokeStyle = color;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(remotePlayer.x, remotePlayer.y, 20, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    });

    // Player entity
    const localColor = playerColors[(Math.max(1, gameState.coop?.localSlot || 1) - 1) % playerColors.length];
    ctx.save();
    if (player.downed) ctx.globalAlpha = 0.42;
    ctx.translate(player.x, player.y);
    ctx.rotate(player.angle);
    ctx.fillStyle = localColor;
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-9, -9);
    ctx.lineTo(-6, 0);
    ctx.lineTo(-9, 9);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#d7f36b';
    ctx.fillRect(2, -2, 8, 4);
    ctx.restore();
    this.drawShield(ctx, player, gameState);

    if (player.invulnerable) {
      ctx.save();
      ctx.strokeStyle = 'rgba(117,221,208,.92)';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#75ddd0';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(player.x, player.y, 17, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    if (player.meleeVisualTimer > 0) {
      const progress = 1 - player.meleeVisualTimer / 0.22;
      ctx.save();
      ctx.strokeStyle = `rgba(215,243,107,${1 - progress * 0.6})`;
      ctx.lineWidth = 3;
      ctx.shadowColor = '#d7f36b';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(player.x, player.y, 18 + 32 * progress, player.angle - 1.25, player.angle + 1.25);
      ctx.stroke();
      ctx.restore();
    }

    if (player.downed) {
      ctx.save();
      ctx.fillStyle = '#e8754e';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('等待救援', player.x, player.y - 28);
      ctx.restore();
    }

    // High-voltage electrical stun visual effect on player
    if (player.stunned > 0) {
      ctx.save();
      ctx.translate(player.x, player.y);

      // Electrical discharge arcs
      const sparkColors = ['#38bdf8', '#60a5fa', '#f87171', '#fbbf24'];
      ctx.lineWidth = 1.8;
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = 10;

      for (let arc = 0; arc < 4; arc++) {
        ctx.strokeStyle = sparkColors[Math.floor(Math.random() * sparkColors.length)];
        const arcAngle = (arc * Math.PI * 0.5) + (Math.random() - 0.5) * 0.75;
        const arcDist = 13 + Math.random() * 10;
        ctx.beginPath();
        ctx.moveTo((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4);
        ctx.lineTo(Math.cos(arcAngle) * (arcDist * 0.5) + (Math.random() - 0.5) * 6, Math.sin(arcAngle) * (arcDist * 0.5) + (Math.random() - 0.5) * 6);
        ctx.lineTo(Math.cos(arcAngle) * arcDist, Math.sin(arcAngle) * arcDist);
        ctx.stroke();
      }

      // Floating status indicator badge
      ctx.shadowBlur = 0;
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ef4444';
      ctx.fillText(`⚡休克硬直 ${player.stunned.toFixed(1)}s⚡`, 0, -20);
      ctx.restore();
    }

    // Draw flashlight cone on map
    if (player.flashlight) {
      ctx.save();
      ctx.translate(player.x, player.y);
      ctx.rotate(player.angle);
      const cone = ctx.createRadialGradient(0, 0, 5, 0, 0, Config.player.flashlightRange);
      cone.addColorStop(0, 'rgba(215,243,107,.13)');
      cone.addColorStop(1, 'rgba(215,243,107,0)');
      ctx.fillStyle = cone;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, Config.player.flashlightRange, -Config.player.flashlightSpread, Config.player.flashlightSpread);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // --- DRAW FLYING BULLET TRACERS AND IMPACT SHADOW SPLASHES INSIDE THE MAP COORDINATE SPACE ---
    gameState.bulletTraces.forEach(trace => {
      ctx.save();
      ctx.strokeStyle = trace.color;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.shadowColor = trace.color;
      ctx.shadowBlur = 6;

      ctx.beginPath();
      const angle = Math.atan2(trace.endY - trace.startY, trace.endX - trace.startX);
      const tailLength = 24;
      const travelDistance = Math.hypot(trace.currentX - trace.startX, trace.currentY - trace.startY);
      
      let tailX = trace.startX;
      let tailY = trace.startY;
      
      if (travelDistance > tailLength) {
        tailX = trace.currentX - Math.cos(angle) * tailLength;
        tailY = trace.currentY - Math.sin(angle) * tailLength;
      }

      ctx.moveTo(tailX, tailY);
      ctx.lineTo(trace.currentX, trace.currentY);
      ctx.stroke();
      ctx.restore();
    });

    // --- DRAW EXPLODING IMPACT SPARK PARTICLES INSIDE THE MAP COORDINATE SPACE ---
    gameState.impactParticles.forEach(p => {
      ctx.save();
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.alpha;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 4;
      
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    ctx.restore();
  }

  /**
   * Draws world room labels, directional doors, and indicators (always aligned with camera)
   */
  drawWorldOverlay(player, mapManager, gameState) {
    const ctx = this.ui.ctx;
    const scaleX = this.ui.canvas.clientWidth / Config.VIEW_W;
    const scaleY = this.ui.canvas.clientHeight / Config.VIEW_H;

    ctx.setTransform(this.renderDpr, 0, 0, this.renderDpr, 0, 0);
    ctx.save();
    this.applyCamera(ctx, scaleX, scaleY, gameState);

    // Themed sector overlays
    mapManager.worldRooms.forEach(room => {
      if (room.kind === 'corridor' || !this.inViewport(this.roomCache(room), gameState)) return;
      ctx.save();
      const cx = room.center ? room.center.x : (room.x + room.w / 2);
      const cy = room.center ? room.center.y : (room.y + 20);

      // Room Header Badge
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = room.accent || '#75ddd0';
      ctx.font = '11px Space Mono';
      ctx.textAlign = 'center';
      ctx.fillText(`[${room.label}] ${room.title}`, cx, cy - 32);
      ctx.restore();
    });

    // Directional Opaque Doors
    this.drawDoors(ctx, mapManager);

    // Windows
    mapManager.windows.forEach(item => {
      ctx.fillStyle = 'rgba(117,221,208,.18)';
      ctx.strokeStyle = '#75ddd0';
      ctx.lineWidth = 2;
      ctx.fillRect(item.x, item.y, item.w, item.h);
      ctx.strokeRect(item.x, item.y, item.w, item.h);
    });

    // Laser aiming overlay - ONLY drawn when aiming/stabilized
    if (gameState.stabilized) {
      const jitter = gameState.laserJitter;
      const laserAngle = player.angle + jitter;
      const laserDistance = mapManager.rayWallDistance(player.x, player.y, Math.cos(laserAngle), Math.sin(laserAngle), 650);

      ctx.strokeStyle = 'rgba(255,65,65,.35)';
      ctx.lineWidth = 1 / Math.max(0.001, gameState.cameraZoom * (scaleX + scaleY) / 2);
      ctx.shadowBlur = 0;

      ctx.beginPath();
      ctx.moveTo(player.x, player.y);
      ctx.lineTo(player.x + Math.cos(laserAngle) * laserDistance, player.y + Math.sin(laserAngle) * laserDistance);
      ctx.stroke();

      ctx.shadowBlur = 0;
    }

    ctx.restore();
  }

  drawTrainingGoal(player, gameState, ctx = this.ui.ctx) {
    const goal = gameState.trainingGoal;
    this.ui.updateTrainingGoal?.(player, goal);
    if (!goal || !Number.isFinite(goal.x) || !Number.isFinite(goal.y)) return;
    const canvas = this.ui.canvas;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!(width > 0 && height > 0)) return;
    const zoom = gameState.cameraZoom || 1;
    const x = (Config.VIEW_W / 2 + (goal.x + this.cameraOffsetX - Config.VIEW_W / 2) * zoom) * width / Config.VIEW_W;
    const y = (Config.VIEW_H / 2 + (goal.y + this.cameraOffsetY - Config.VIEW_H / 2) * zoom) * height / Config.VIEW_H;
    ctx.save();
    ctx.setTransform(this.renderDpr, 0, 0, this.renderDpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#dcfa65';
    ctx.fillStyle = '#dcfa65';
    ctx.lineWidth = 2;
    if (x >= 18 && x <= width - 18 && y >= 18 && y <= height - 18) {
      const pulse = this.motionQuery?.matches ? 0 : Math.sin((gameState.elapsed || 0) * 3) * 3;
      ctx.beginPath();
      ctx.arc(x, y, 16 + pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const dx = x - width / 2, dy = y - height / 2;
      const insetX = Math.max(1, width / 2 - 24), insetY = Math.max(1, height / 2 - 24);
      const ratio = Math.min(insetX / Math.max(1, Math.abs(dx)), insetY / Math.max(1, Math.abs(dy)));
      ctx.translate(width / 2 + dx * ratio, height / 2 + dy * ratio);
      ctx.rotate(Math.atan2(dy, dx));
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(-7, -7);
      ctx.lineTo(-3, 0);
      ctx.lineTo(-7, 7);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * Renders two door leaves sliding out of the doorway.
   */
  drawDoors(ctx, mapManager) {
    mapManager.doors.forEach(door => {
      ctx.save();
      const p1 = door.p1;
      const p2 = door.p2;
      const progress = Math.max(0, Math.min(1, Number.isFinite(door.animationProgress)
        ? door.animationProgress
        : (door.open ? 1 : 0)));
      const eased = progress * progress * (3 - 2 * progress);

      if (!p1 || !p2) {
        ctx.globalAlpha = 1 - eased;
        ctx.fillStyle = '#172b3a';
        ctx.fillRect(door.x, door.y, door.w, door.h);
        ctx.strokeStyle = '#e9a950';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(door.x + 0.5, door.y + 0.5, door.w - 1, door.h - 1);
        ctx.restore();
        return;
      }

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy);
      if (!len) { ctx.restore(); return; }
      ctx.translate(p1.x, p1.y);
      ctx.rotate(Math.atan2(dy, dx));
      ctx.beginPath();
      ctx.rect(0, -9, len, 18);
      ctx.clip();
      ctx.fillStyle = '#284454';
      ctx.fillRect(0, -9, 5, 18);
      ctx.fillRect(len - 5, -9, 5, 18);
      const leaf = len / 2 * (1 - eased);
      if (leaf > 0) {
        ctx.lineCap = 'butt';
        for (const [from, to] of [[0, leaf], [len, len - leaf]]) {
          ctx.lineWidth = 14;
          ctx.strokeStyle = '#243d49';
          ctx.beginPath();
          ctx.moveTo(from, 0);
          ctx.lineTo(to, 0);
          ctx.stroke();
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#e9a950';
          ctx.beginPath();
          ctx.moveTo(from, 0);
          ctx.lineTo(to, 0);
          ctx.stroke();
        }
      }
      ctx.restore();
    });
  }

  drawMapDoorLeaves(ctx, door, width) {
    const progress = Math.max(0, Math.min(1, Number.isFinite(door.animationProgress)
      ? door.animationProgress : (door.open ? 1 : 0)));
    const midpoint = { x: (door.p1.x + door.p2.x) / 2, y: (door.p1.y + door.p2.y) / 2 };
    const leaves = [door.p1, door.p2];
    ctx.lineWidth = width;
    ctx.strokeStyle = door.open ? '#75ddd0' : '#e8754e';
    for (const end of leaves) {
      const tip = { x: midpoint.x + (end.x - midpoint.x) * progress,
        y: midpoint.y + (end.y - midpoint.y) * progress };
      ctx.beginPath();
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(end.x, end.y, width / 2, 0, Math.PI * 2);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();
    }
  }

  /**
   * Controls raycasting shadows and lighting visibility mask
   */
  drawCenteredVision(player, mapManager, gameState) {
    this.drawOccludedVision(player, mapManager, gameState);
    this.drawTrainingGoal(player, gameState, this.ui.visionCtx);
  }

  visibilityPolygon(origin, mapManager, range = 1800, steps = 96) {
    const points = [];
    for (let index = 0; index < steps; index++) {
      const angle = (index / steps) * Math.PI * 2;
      const directionX = Math.cos(angle);
      const directionY = Math.sin(angle);
      const distance = mapManager.rayVisionDistance(origin.x, origin.y, directionX, directionY, range, 0);
      points.push({ x: origin.x + directionX * distance, y: origin.y + directionY * distance });
    }
    return points;
  }

  /**
   * Draws occluding fog of war with near ambient light
   */
  drawOccludedVision(player, mapManager, gameState) {
    const visionCtx = this.ui.visionCtx;
    const w = this.ui.visionCanvas.clientWidth;
    const h = this.ui.visionCanvas.clientHeight;
    // The game frame is hidden during startup and safehouse transitions.
    if (!(w > 0 && h > 0 && this.ui.visionCanvas.width > 0 && this.ui.visionCanvas.height > 0)) return;
    const scaleX = w / Config.VIEW_W;
    const scaleY = h / Config.VIEW_H;

    visionCtx.clearRect(0, 0, w, h);
    visionCtx.save();
    
    // Apply camera transformation uniformly to the vision canvas
    visionCtx.setTransform(this.renderDpr, 0, 0, this.renderDpr, 0, 0);
    this.applyCamera(visionCtx, scaleX, scaleY, gameState);

    // Black out everything by default (extend beyond viewport boundaries)
    visionCtx.fillStyle = '#000';
    visionCtx.fillRect(player.x - 2000, player.y - 2000, 4000, 4000);
    visionCtx.globalCompositeOperation = 'destination-out';

    const observerVisibility = gameState.muzzleFlashes?.length ? this.visibilityPolygon(
      player, mapManager, Math.hypot(Config.VIEW_W, Config.VIEW_H) * 2, 96
    ) : [];
    for (const flash of gameState.muzzleFlashes || []) {
      const room = mapManager.worldRooms[flash.roomIndex] || mapManager.getRoomAt(flash.x, flash.y);
      if (!room) continue;
      const alpha = Math.max(0, Math.min(1, flash.timer / (flash.duration || 0.18)));
      const flashRange = flash.range || 420;
      const flashSteps = 96;
      visionCtx.save();
      visionCtx.beginPath();
      visionCtx.moveTo(player.x, player.y);
      observerVisibility.forEach(point => visionCtx.lineTo(point.x, point.y));
      visionCtx.closePath();
      visionCtx.clip();
      visionCtx.beginPath();
      visionCtx.moveTo(flash.x, flash.y);
      for (let index = 0; index <= flashSteps; index += 1) {
        const angle = (index / flashSteps) * Math.PI * 2;
        const directionX = Math.cos(angle);
        const directionY = Math.sin(angle);
        const roomRange = mapManager.roomBoundaryDistance(room, flash.x, flash.y, directionX, directionY);
        const maxDistance = Math.min(flashRange, roomRange);
        const distance = mapManager.rayVisionDistance(flash.x, flash.y, directionX, directionY, maxDistance, 12);
        visionCtx.lineTo(flash.x + directionX * distance, flash.y + directionY * distance);
      }
      visionCtx.closePath();
      const flashGrad = visionCtx.createRadialGradient(flash.x, flash.y, 8, flash.x, flash.y, flashRange);
      flashGrad.addColorStop(0, `rgba(255, 255, 230, ${alpha})`);
      flashGrad.addColorStop(0.15, `rgba(255, 220, 130, ${alpha * 0.9})`);
      flashGrad.addColorStop(0.6, `rgba(215, 243, 107, ${alpha * 0.4})`);
      flashGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      visionCtx.fillStyle = flashGrad;
      visionCtx.fill();
      visionCtx.restore();
    }

    // Compose perception once so ambient/cone overlap cannot exceed half strength when off.
    this.perceptionCanvas ||= document.createElement('canvas');
    const perception = this.perceptionCanvas;
    if (perception.width !== this.ui.visionCanvas.width || perception.height !== this.ui.visionCanvas.height) {
      perception.width = this.ui.visionCanvas.width;
      perception.height = this.ui.visionCanvas.height;
    }
    const lightCtx = perception.getContext('2d');
    lightCtx.setTransform(1, 0, 0, 1, 0, 0);
    lightCtx.clearRect(0, 0, perception.width, perception.height);
    lightCtx.save();
    lightCtx.setTransform(this.renderDpr, 0, 0, this.renderDpr, 0, 0);
    this.applyCamera(lightCtx, scaleX, scaleY, gameState);

    const range = Config.player.flashlightRange * (player.flashlight ? 1 : 0.3);
    const spread = Config.player.flashlightSpread;
    const steps = 80;
    lightCtx.save();
    lightCtx.beginPath();
    lightCtx.moveTo(player.x, player.y);
    for (let index = 0; index <= steps; index += 1) {
      const angle = player.angle - spread + (index / steps) * spread * 2;
      const distance = mapManager.rayVisionDistance(player.x, player.y, Math.cos(angle), Math.sin(angle), range, 13);
      lightCtx.lineTo(player.x + Math.cos(angle) * distance, player.y + Math.sin(angle) * distance);
    }
    lightCtx.closePath();
    lightCtx.clip();
    const light = lightCtx.createRadialGradient(player.x, player.y, 0, player.x, player.y, range);
    light.addColorStop(0, 'rgba(0,0,0,1)');
    light.addColorStop(0.7, 'rgba(0,0,0,1)');
    light.addColorStop(1, 'rgba(0,0,0,0)');
    lightCtx.fillStyle = light;
    lightCtx.fill();

    // Multiply the radial light by a soft angular edge inside the occluded cone.
    const edge = lightCtx.createConicGradient(player.angle - spread, player.x, player.y);
    edge.addColorStop(0, 'rgba(0,0,0,0)');
    edge.addColorStop(spread * 0.2 / (Math.PI * 2), 'rgba(0,0,0,1)');
    edge.addColorStop(spread * 1.8 / (Math.PI * 2), 'rgba(0,0,0,1)');
    edge.addColorStop(spread * 2 / (Math.PI * 2), 'rgba(0,0,0,0)');
    edge.addColorStop(1, 'rgba(0,0,0,0)');
    lightCtx.globalCompositeOperation = 'destination-in';
    lightCtx.fillStyle = edge;
    lightCtx.fillRect(player.x - range, player.y - range, range * 2, range * 2);
    lightCtx.restore();

    const ambientRange = 74;
    const ambientSteps = 64;
    lightCtx.beginPath();
    lightCtx.moveTo(player.x, player.y);
    for (let index = 0; index <= ambientSteps; index += 1) {
      const angle = (index / ambientSteps) * Math.PI * 2;
      const distance = mapManager.rayVisionDistance(player.x, player.y, Math.cos(angle), Math.sin(angle), ambientRange, 12);
      lightCtx.lineTo(player.x + Math.cos(angle) * distance, player.y + Math.sin(angle) * distance);
    }
    lightCtx.closePath();
    const near = lightCtx.createRadialGradient(player.x, player.y, 0, player.x, player.y, ambientRange);
    near.addColorStop(0, 'rgba(0,0,0,1)');
    near.addColorStop(0.7, 'rgba(0,0,0,1)');
    near.addColorStop(1, 'rgba(0,0,0,0)');
    lightCtx.fillStyle = near;
    lightCtx.fill();
    lightCtx.restore();

    visionCtx.setTransform(1, 0, 0, 1, 0, 0);
    visionCtx.globalAlpha = player.flashlight ? 1 : 0.5;
    visionCtx.drawImage(perception, 0, 0);

    // Powered room light is independent of the torch and never changes enemy photophobia.
    const lampPower = this.roomLightLevel(gameState);
    const litRooms = lampPower > 0 ? mapManager.worldRooms.filter(room =>
      room.lights?.length && this.inViewport(this.roomCache(room), gameState)) : [];
    if (litRooms.length) {
      visionCtx.setTransform(this.renderDpr, 0, 0, this.renderDpr, 0, 0);
      this.applyCamera(visionCtx, scaleX, scaleY, gameState);
      const range = Math.hypot(Config.VIEW_W, Config.VIEW_H) / (Config.camera?.baseZoom || 1);
      const visible = this.forwardVisibilityPolygon(player, mapManager, range);
      visionCtx.beginPath();
      visionCtx.moveTo(visible[0].x, visible[0].y);
      for (let index = 1; index < visible.length; index++) visionCtx.lineTo(visible[index].x, visible[index].y);
      visionCtx.closePath();
      visionCtx.clip();
      for (const room of litRooms) {
        const cached = this.roomCache(room);
        const field = this.roomLightField(room, gameState);
        visionCtx.globalAlpha = lampPower;
        visionCtx.drawImage(field.canvas, cached.x, cached.y, cached.w, cached.h);
      }
    }
    visionCtx.restore();
  }

  /**
   * Renders the top-down radar scan display with Fog of War
   * Undiscovered rooms remain pitch black until the player explores into them!
   */
  /**
   * Renders the 4x4 Local Tactical Radar on HUD (centered on operator)
   * Viewport covers roughly 4x4 rooms (~2200px) with 4x4 sector grid
   */
  drawMiniMap(player, mapManager, gameState = null) {
    const miniCtx = this.ui.miniCtx;
    if (!miniCtx) return;
    const size = 176;

    miniCtx.clearRect(0, 0, size, size);
    miniCtx.fillStyle = '#04101b';
    miniCtx.fillRect(0, 0, size, size);

    const isRevealed = gameState && gameState.revealAllMap;
    const scopeSize = 2200; // ~4x4 rooms span
    const scale = size / scopeSize; // ~0.08 scale

    miniCtx.save();
    // Center radar viewport on player
    miniCtx.translate(size / 2, size / 2);
    miniCtx.scale(scale, scale);
    miniCtx.translate(-player.x, -player.y);

    // 1. Draw rooms within 4x4 local sector
    mapManager.worldRooms.forEach(room => {
      const rx = room.center ? room.center.x : (room.x + room.w / 2);
      const ry = room.center ? room.center.y : (room.y + room.h / 2);
      if (Math.hypot(rx - player.x, ry - player.y) > 1650) return;
      if (!room.discovered && !isRevealed) return;

      let roomFill = 'rgba(101, 221, 235, 0.09)';
      let roomStroke = room.accent || 'rgba(101, 221, 235, 0.65)';
      let labelFill = 'rgba(190, 239, 242, 0.9)';

      if (room.isStart || room.type === 'airlock') {
        roomFill = 'rgba(215, 243, 107, 0.12)';
        roomStroke = '#d7f36b';
        labelFill = '#d7f36b';
      } else if (room.isExit || room.type === 'evacpod') {
        roomFill = 'rgba(233, 169, 80, 0.18)';
        roomStroke = '#e9a950';
        labelFill = '#ffd18a';
      }

      miniCtx.save();
      if (room.vertices && room.vertices.length) {
        miniCtx.beginPath();
        miniCtx.moveTo(room.vertices[0].x, room.vertices[0].y);
        for (let i = 1; i < room.vertices.length; i++) {
          miniCtx.lineTo(room.vertices[i].x, room.vertices[i].y);
        }
        miniCtx.closePath();
        miniCtx.fillStyle = roomFill;
        miniCtx.fill();
        miniCtx.strokeStyle = roomStroke;
        miniCtx.lineWidth = 2.2 / scale;
        this.traceMapRoomWalls(miniCtx, room);
        miniCtx.stroke();
      } else {
        miniCtx.fillStyle = roomFill;
        miniCtx.fillRect(room.x, room.y, room.w, room.h);
        miniCtx.strokeStyle = roomStroke;
        miniCtx.lineWidth = 2.0 / scale;
        this.traceMapRoomWalls(miniCtx, room);
        miniCtx.stroke();
      }

      // Room label in local radar (scaled down to unobtrusive 8px)
      miniCtx.fillStyle = labelFill;
      miniCtx.font = `bold ${Math.round(8 / scale)}px monospace`;
      miniCtx.textAlign = 'center';
      miniCtx.textBaseline = 'middle';
      miniCtx.fillText(room.label, rx, ry);
      miniCtx.restore();
    });

    // 2. Solid walls and cargo props in local sector
    mapManager.walls.forEach(wall => {
      if (wall.x1 !== undefined) {
        const midX = (wall.x1 + wall.x2) / 2;
        const midY = (wall.y1 + wall.y2) / 2;
        if (Math.hypot(midX - player.x, midY - player.y) > 1500) return;
        const nearDiscovered = isRevealed || mapManager.worldRooms.some(r => r.discovered && distToSegment(r.center.x, r.center.y, wall.x1, wall.y1, wall.x2, wall.y2) < 450);
        if (nearDiscovered) {
          miniCtx.lineWidth = 3 / scale;
          miniCtx.strokeStyle = 'rgba(215, 243, 107, 0.55)';
          miniCtx.beginPath();
          miniCtx.moveTo(wall.x1, wall.y1);
          miniCtx.lineTo(wall.x2, wall.y2);
          miniCtx.stroke();
        }
      } else if (wall.x !== undefined) {
        const wallCenterX = wall.x + wall.w / 2;
        const wallCenterY = wall.y + wall.h / 2;
        if (Math.hypot(wallCenterX - player.x, wallCenterY - player.y) > 1500) return;
        const r = mapManager.getRoomAt(wallCenterX, wallCenterY);
        if (isRevealed || (r && r.discovered)) {
          if (wall.isBox) {
            miniCtx.fillStyle = '#e8754e';
          } else if (wall.isProp) {
            miniCtx.fillStyle = '#50e3c2';
          } else {
            miniCtx.fillStyle = 'rgba(215, 243, 107, 0.35)';
          }
          miniCtx.fillRect(wall.x, wall.y, wall.w, wall.h);
        }
      }
    });

    // 3. Doors in local sector
    mapManager.doors.forEach(door => {
      const dx = door.p1 ? (door.p1.x + door.p2.x) / 2 : (door.x + door.w / 2);
      const dy = door.p1 ? (door.p1.y + door.p2.y) / 2 : (door.y + door.h / 2);
      if (Math.hypot(dx - player.x, dy - player.y) > 1500) return;

      const isVisible = isRevealed || (door.roomA && door.roomA.discovered) || (door.roomB && door.roomB.discovered);
      if (isVisible) {
        if (door.p1 && door.p2) {
          this.drawMapDoorLeaves(miniCtx, door, 4.5 / scale);
        } else {
          miniCtx.fillStyle = door.open ? '#75ddd0' : '#e8754e';
          miniCtx.fillRect(door.x, door.y, Math.max(10, door.w), Math.max(10, door.h));
        }
      }
    });

    // 4. Terminals in local sector (reduced diamond dot size: 5px)
    if (mapManager.terminals) {
      mapManager.terminals.forEach(term => {
        if (Math.hypot(term.x - player.x, term.y - player.y) > 1500) return;
        if (term.room && (term.room.discovered || isRevealed)) {
          miniCtx.save();
          miniCtx.translate(term.x, term.y);
          miniCtx.fillStyle = term.solved ? '#50e3c2' : '#f5a623';
          miniCtx.beginPath();
          const tr = 5 / scale;
          miniCtx.moveTo(0, -tr);
          miniCtx.lineTo(tr, 0);
          miniCtx.lineTo(0, tr);
          miniCtx.lineTo(-tr, 0);
          miniCtx.closePath();
          miniCtx.fill();
          miniCtx.restore();
        }
      });
    }

    // 5. Extraction Points in local sector (Start blue, Exit red; Exit only shown when found)
    if (mapManager.extractionPoint) {
      const ep = mapManager.extractionPoint;
      if (Math.hypot(ep.x - player.x, ep.y - player.y) < 1500) {
        miniCtx.fillStyle = '#3b82f6';
        miniCtx.beginPath();
        miniCtx.arc(ep.x, ep.y, 5.5 / scale, 0, Math.PI * 2);
        miniCtx.fill();
      }
    }
    if (mapManager.exitExtractionPoint) {
      const ep = mapManager.exitExtractionPoint;
      const evacRoom = mapManager.worldRooms.find(r => r.type === 'evacpod' || r.isExit);
      const evacUnlocked = !!mapManager.terminals?.length && mapManager.terminals.every(term => term.solved);
      const isExitDiscovered = isRevealed || (evacRoom && evacRoom.discovered) || evacUnlocked;
      if (isExitDiscovered && Math.hypot(ep.x - player.x, ep.y - player.y) < 1500) {
        miniCtx.fillStyle = '#ef4444';
        miniCtx.beginPath();
        miniCtx.arc(ep.x, ep.y, 6 / scale, 0, Math.PI * 2);
        miniCtx.fill();
        if (evacUnlocked) {
          miniCtx.strokeStyle = '#d7f36b';
          miniCtx.lineWidth = 2 / scale;
          miniCtx.stroke();
        }
      }
    }

    miniCtx.restore();

    // 6. Draw 4x4 Tactical Grid Overlay & Radar Rings in Screen Space
    miniCtx.save();
    miniCtx.strokeStyle = 'rgba(215, 243, 107, 0.13)';
    miniCtx.lineWidth = 1;

    // 4x4 Sectors: 4 columns x 4 rows (each cell 44px)
    const cell = size / 4;
    for (let i = 1; i < 4; i++) {
      // vertical grid lines
      miniCtx.beginPath();
      miniCtx.moveTo(i * cell, 0);
      miniCtx.lineTo(i * cell, size);
      miniCtx.stroke();
      // horizontal grid lines
      miniCtx.beginPath();
      miniCtx.moveTo(0, i * cell);
      miniCtx.lineTo(size, i * cell);
      miniCtx.stroke();
    }

    // Radar Range Circles (inner and outer)
    miniCtx.strokeStyle = 'rgba(117, 221, 208, 0.16)';
    miniCtx.beginPath();
    miniCtx.arc(size / 2, size / 2, 40, 0, Math.PI * 2);
    miniCtx.stroke();
    miniCtx.beginPath();
    miniCtx.arc(size / 2, size / 2, 75, 0, Math.PI * 2);
    miniCtx.stroke();

    // Radar sweep line animation
    const sweepAngle = (Date.now() / 1200) % (Math.PI * 2);
    miniCtx.strokeStyle = 'rgba(215, 243, 107, 0.28)';
    miniCtx.beginPath();
    miniCtx.moveTo(size / 2, size / 2);
    miniCtx.lineTo(size / 2 + Math.cos(sweepAngle) * 80, size / 2 + Math.sin(sweepAngle) * 80);
    miniCtx.stroke();

    // 7. Centered Player Arrow & Vision Indicator
    const cx = size / 2;
    const cy = size / 2;
    miniCtx.save();
    miniCtx.translate(cx, cy);
    miniCtx.rotate(player.angle);

    // Vision cone wedge
    miniCtx.fillStyle = 'rgba(215, 243, 107, 0.18)';
    miniCtx.beginPath();
    miniCtx.moveTo(0, 0);
    miniCtx.arc(0, 0, 24, -Math.PI / 5, Math.PI / 5);
    miniCtx.closePath();
    miniCtx.fill();

    // Player sharp triangle
    miniCtx.fillStyle = '#75ddd0';
    miniCtx.shadowColor = '#75ddd0';
    miniCtx.shadowBlur = 6;
    miniCtx.beginPath();
    miniCtx.moveTo(9, 0);
    miniCtx.lineTo(-6, -5);
    miniCtx.lineTo(-3, 0);
    miniCtx.lineTo(-6, 5);
    miniCtx.closePath();
    miniCtx.fill();
    miniCtx.restore();

    // Subtle compass / crosshair tick marks at center
    miniCtx.strokeStyle = 'rgba(215, 243, 107, 0.4)';
    miniCtx.beginPath();
    miniCtx.moveTo(cx - 3, cy); miniCtx.lineTo(cx + 3, cy);
    miniCtx.moveTo(cx, cy - 3); miniCtx.lineTo(cx, cy + 3);
    miniCtx.stroke();

    miniCtx.restore();

    // Update sector HUD text
    if (this.ui.miniMapSectorText) {
      const curRoom = mapManager.getRoomAt(player.x, player.y);
      this.ui.miniMapSectorText.textContent = curRoom ? `SECTOR: ${curRoom.label}` : 'SECTOR: CORRIDOR';
    }
  }

  /**
   * Renders the Full Tactical Facility Map on #fullMapCanvas (opened with M key)
   * Scaled to show all rooms across the entire facility with telemetry and markers
   */
  getFullMapFit(mapManager, width, height) {
    let minRX = Infinity, minRY = Infinity, maxRX = -Infinity, maxRY = -Infinity;
    mapManager.worldRooms.forEach(r => {
      if (r.vertices && r.vertices.length) {
        r.vertices.forEach(v => {
          if (v.x < minRX) minRX = v.x;
          if (v.x > maxRX) maxRX = v.x;
          if (v.y < minRY) minRY = v.y;
          if (v.y > maxRY) maxRY = v.y;
        });
      } else {
        if (r.x < minRX) minRX = r.x;
        if (r.x + r.w > maxRX) maxRX = r.x + r.w;
        if (r.y < minRY) minRY = r.y;
        if (r.y + r.h > maxRY) maxRY = r.y + r.h;
      }
    });

    const roomSpanW = Math.max(200, maxRX - minRX);
    const roomSpanH = Math.max(200, maxRY - minRY);
    const pad = 20;
    const availW = Math.max(50, width - pad * 2);
    const availH = Math.max(50, height - pad * 2);
    const scale = Math.min(availW / roomSpanW, availH / roomSpanH);
    const offsetX = pad + (availW - roomSpanW * scale) / 2 - minRX * scale;
    const offsetY = pad + (availH - roomSpanH * scale) / 2 - minRY * scale;
    return { scale, offsetX, offsetY };
  }


  drawFullMap(player, mapManager, gameState = null, remotePlayers = []) {
    const canvas = this.ui.fullMapCanvas;
    const ctx = this.ui.fullMapCtx;
    if (!canvas || !ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    if (!(width > 0 && height > 0) || !mapManager.worldRooms.length) return;
    const isRevealed = gameState && gameState.revealAllMap;

    ctx.clearRect(0, 0, width, height);

    // Deep high-tech tactical background
    ctx.fillStyle = '#070c0a';
    ctx.fillRect(0, 0, width, height);

    // Subtle background grid
    ctx.strokeStyle = 'rgba(117, 221, 208, 0.05)';
    ctx.lineWidth = 1;
    const gridStep = 45;
    for (let x = 0; x < width; x += gridStep) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += gridStep) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    const { scale, offsetX, offsetY } = this.getFullMapFit(mapManager, width, height);
    const zoom = Math.max(0.5, Math.min(4, Number(gameState && gameState.fullMapZoom) || 1));
    const panX = Number(gameState && gameState.fullMapPanX) || 0;
    const panY = Number(gameState && gameState.fullMapPanY) || 0;

    ctx.save();
    ctx.translate(panX + offsetX * zoom, panY + offsetY * zoom);
    ctx.scale(scale * zoom, scale * zoom);

    // 1. Draw Rooms
    mapManager.worldRooms.forEach(room => {
      if (!room.discovered && !isRevealed) {
        // Draw undiscovered room as faint classified wireframe
        if (room.vertices && room.vertices.length) {
          ctx.beginPath();
          ctx.moveTo(room.vertices[0].x, room.vertices[0].y);
          for (let i = 1; i < room.vertices.length; i++) {
            ctx.lineTo(room.vertices[i].x, room.vertices[i].y);
          }
          ctx.closePath();
          ctx.fillStyle = 'rgba(8, 19, 31, 0.48)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(101, 221, 235, 0.28)';
          ctx.lineWidth = 1.5;
          this.traceMapRoomWalls(ctx, room);
          ctx.stroke();
        }
        return;
      }

      ctx.save();
      if (room.vertices && room.vertices.length) {
        ctx.beginPath();
        ctx.moveTo(room.vertices[0].x, room.vertices[0].y);
        for (let i = 1; i < room.vertices.length; i++) {
          ctx.lineTo(room.vertices[i].x, room.vertices[i].y);
        }
        ctx.closePath();
        const isStart = room.isStart || room.type === 'airlock';
        const isExit = room.isExit || room.type === 'evacpod';
        ctx.fillStyle = isExit ? 'rgba(233, 169, 80, 0.22)' : (isStart ? 'rgba(215, 243, 107, 0.14)' : 'rgba(101, 221, 235, 0.08)');
        ctx.fill();
        ctx.strokeStyle = isExit ? '#e9a950' : (isStart ? '#d7f36b' : (room.accent || '#65ddeb'));
        ctx.lineWidth = 3;
        this.traceMapRoomWalls(ctx, room);
        ctx.stroke();
      } else {
        const isStart = room.isStart || room.type === 'airlock';
        const isExit = room.isExit || room.type === 'evacpod';
        ctx.fillStyle = isExit ? 'rgba(233, 169, 80, 0.22)' : (isStart ? 'rgba(215, 243, 107, 0.14)' : 'rgba(101, 221, 235, 0.08)');
        ctx.fillRect(room.x, room.y, room.w, room.h);
        ctx.strokeStyle = isExit ? '#e9a950' : (isStart ? '#d7f36b' : '#65ddeb');
        ctx.lineWidth = 2.5;
        this.traceMapRoomWalls(ctx, room);
        ctx.stroke();
      }

      // Room Center Label
      const rx = room.center ? room.center.x : (room.x + room.w / 2);
      const ry = room.center ? room.center.y : (room.y + room.h / 2);
      ctx.fillStyle = '#d7f36b';
      ctx.font = 'bold 18px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(room.label, rx, ry - 8);

      // Sub-label for special rooms
      if (room.isStart || room.type === 'airlock') {
        ctx.fillStyle = '#d7f36b';
        ctx.font = '12px monospace';
        ctx.fillText('[ 起降气闸 ]', rx, ry + 14);
      } else if (room.isExit || room.type === 'evacpod') {
        ctx.fillStyle = '#e9a950';
        ctx.font = '12px monospace';
        ctx.fillText('[ 逃生撤离舱 ]', rx, ry + 14);
      } else if (room.type === 'reactor' || room.type === 'quantum_core') {
        ctx.fillStyle = '#e9a950';
        ctx.font = '12px monospace';
        ctx.fillText('[ 高压核心 ]', rx, ry + 14);
      }
      ctx.restore();
    });

    // 2. Solid Walls, Cargo Boxes & Machinery Props
    mapManager.walls.forEach(wall => {
      if (wall.x1 !== undefined) {
        const nearDiscovered = isRevealed || mapManager.worldRooms.some(r => r.discovered && distToSegment(r.center.x, r.center.y, wall.x1, wall.y1, wall.x2, wall.y2) < 450);
        if (nearDiscovered) {
          ctx.lineWidth = 3.5;
          ctx.strokeStyle = 'rgba(101, 221, 235, 0.6)';
          ctx.beginPath();
          ctx.moveTo(wall.x1, wall.y1);
          ctx.lineTo(wall.x2, wall.y2);
          ctx.stroke();
        }
      } else if (wall.x !== undefined) {
        const wallCenterX = wall.x + wall.w / 2;
        const wallCenterY = wall.y + wall.h / 2;
        const r = mapManager.getRoomAt(wallCenterX, wallCenterY);
        if (isRevealed || (r && r.discovered)) {
          if (wall.isBox) {
            ctx.fillStyle = '#e9a950';
          } else if (wall.isProp) {
            ctx.fillStyle = '#65ddeb';
          } else {
            ctx.fillStyle = 'rgba(215, 243, 107, 0.35)';
          }
          ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
        }
      }
    });

    // 3. Doors
    mapManager.doors.forEach(door => {
      const isVisible = isRevealed || (door.roomA && door.roomA.discovered) || (door.roomB && door.roomB.discovered);
      if (isVisible) {
        if (door.p1 && door.p2) {
          this.drawMapDoorLeaves(ctx, door, 5);
        } else {
          ctx.fillStyle = door.open ? '#75ddd0' : '#e8754e';
          ctx.fillRect(door.x, door.y, Math.max(8, door.w), Math.max(8, door.h));
        }
      }
    });

    // 4. Extraction Points (the far pod is pinned even through fog once unlocked)
    if (mapManager.extractionPoint) {
      const ep = mapManager.extractionPoint;
      const room = mapManager.getRoomAt(ep.x, ep.y);
      if (isRevealed || (room && room.discovered)) {
        ctx.fillStyle = '#3b82f6';
        ctx.beginPath();
        ctx.arc(ep.x, ep.y, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#60a5fa';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
    }
    if (mapManager.exitExtractionPoint) {
      const ep = mapManager.exitExtractionPoint;
      const room = mapManager.getRoomAt(ep.x, ep.y);
      const evacUnlocked = !!mapManager.terminals?.length && mapManager.terminals.every(term => term.solved);
      if (isRevealed || (room && room.discovered) || evacUnlocked) {
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(ep.x, ep.y, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = evacUnlocked ? '#d7f36b' : '#f87171';
        ctx.lineWidth = evacUnlocked ? 4 : 2.5;
        ctx.stroke();
        if (evacUnlocked) {
          this.drawEvacBeacon(ctx, ep, gameState, scale * zoom);
        }
      }
    }

    // 5. Terminal markers follow their roomIndex, including seeded and networked maps.
    if (mapManager.terminals) {
      mapManager.terminals.forEach((term, idx) => {
        const room = mapManager.worldRooms[term.roomIndex] || term.room;
        if (isRevealed || room?.discovered) {
          this.drawTerminalBeacon(ctx, term, idx, gameState, scale * zoom);
        }
      });
    }

    // Life scan belongs only to this operator's equipped passive; it does not discover terrain.
    if (player.armory?.equippedPassive === 'life-scan') {
      for (const enemy of gameState?.mapEnemies || []) {
        if (!enemy || enemy.dead || !(enemy.active || enemy.recoverTimer > 0) ||
            !Number.isFinite(enemy.x) || !Number.isFinite(enemy.y)) continue;
        ctx.save();
        ctx.translate(enemy.x, enemy.y);
        const inverse = 1 / Math.max(0.001, scale * zoom);
        ctx.scale(inverse, inverse);
        ctx.fillStyle = '#ff615f';
        ctx.shadowColor = '#ff615f';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(0, 0, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#ff9f97';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Crew markers share the host-authoritative map coordinates and fog state.
    remotePlayers.filter(member => member?.online !== false && member?.player).forEach(member => {
      const teammate = member.player;
      const room = mapManager.getRoomAt(teammate.x, teammate.y);
      if (!room?.discovered && !isRevealed) return;
      ctx.save();
      ctx.translate(teammate.x, teammate.y);
      ctx.rotate(teammate.angle || 0);
      ctx.fillStyle = '#75ddd0';
      ctx.strokeStyle = '#06121a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(13, 0);
      ctx.lineTo(-9, -8);
      ctx.lineTo(-6, 0);
      ctx.lineTo(-9, 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#75ddd0';
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`CREW ${member.slot || '?'}`, 0, -14);
      ctx.restore();
    });

    // 6. Operator Beacon (Pulsating Sonar Wave & Direction Cone)
    ctx.save();
    const pulseTime = this.motionQuery?.matches ? 0.3 : (Number(gameState?.elapsed) || 0) / 2.4;
    const pulseR = 18 + (pulseTime % 1) * 35;
    const pulseAlpha = Math.max(0, 1 - (pulseTime % 1));

    // Outer ripple ring
    ctx.strokeStyle = `rgba(0, 255, 255, ${pulseAlpha * 0.7})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(player.x, player.y, pulseR, 0, Math.PI * 2);
    ctx.stroke();

    // Vision heading cone
    ctx.fillStyle = 'rgba(0, 255, 255, 0.2)';
    ctx.beginPath();
    ctx.moveTo(player.x, player.y);
    ctx.arc(player.x, player.y, 65, player.angle - Math.PI / 6, player.angle + Math.PI / 6);
    ctx.closePath();
    ctx.fill();

    // Solid player dot & ring
    ctx.fillStyle = '#75ddd0';
    ctx.shadowColor = '#75ddd0';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(player.x, player.y, 10, 0, Math.PI * 2);
    ctx.fill();

    // Operator label
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#75ddd0';
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('YOU [OPERATOR]', player.x, player.y - 18);

    ctx.restore();

    ctx.restore();

    // Update full map modal status tags
    this.ui.updateFullMapStats(mapManager, gameState);
  }
}
