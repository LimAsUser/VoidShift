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
    
    const aimZoom = gameState.stabilized ? 1.1 : 1;
    const lookX = gameState.stabilized ? gameState.cameraLookX : 0;
    const lookY = gameState.stabilized ? gameState.cameraLookY : 0;

    gameState.cameraZoom = aimZoom;
    
    // Total virtual offsets (in logical game design pixels)
    const totalOffsetX = lookX + (gameState.recoilX || 0);
    const totalOffsetY = lookY + (gameState.recoilY || 0);

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
   * Draws base game world (walls, player, items, monster)
   */
  draw(player, monster, mapManager, gameState) {
    const ctx = this.ui.ctx;
    const w = this.ui.canvas.clientWidth;
    const h = this.ui.canvas.clientHeight;
    const scaleX = w / Config.VIEW_W;
    const scaleY = h / Config.VIEW_H;

    ctx.save();
    this.applyCamera(ctx, scaleX, scaleY, gameState);

    // Background
    ctx.fillStyle = '#111714';
    ctx.fillRect(0, 0, Config.WORLD_W, Config.WORLD_H);
    ctx.fillStyle = '#151c18';
    ctx.fillRect(22, 22, Config.WORLD_W - 44, Config.WORLD_H - 44);

    // Sector gridlines
    ctx.strokeStyle = 'rgba(215,243,107,.05)';
    ctx.lineWidth = 1;
    for (let x = 40; x < Config.WORLD_W; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 22);
      ctx.lineTo(x, Config.WORLD_H - 22);
      ctx.stroke();
    }
    for (let y = 40; y < Config.WORLD_H; y += 40) {
      ctx.beginPath();
      ctx.moveTo(22, y);
      ctx.lineTo(Config.WORLD_W - 22, y);
      ctx.stroke();
    }

    // Draw solid walls
    ctx.fillStyle = '#26302b';
    mapManager.walls.forEach(wall => ctx.fillRect(wall.x, wall.y, wall.w, wall.h));
    ctx.strokeStyle = '#37453b';
    mapManager.walls.forEach(wall => {
      ctx.strokeRect(wall.x + 0.5, wall.y + 0.5, wall.w - 1, wall.h - 1);
    });

    // Extraction chamber visual marker
    ctx.fillStyle = '#27372d';
    ctx.fillRect(54, 84, 82, 82);
    ctx.strokeStyle = '#607157';
    ctx.strokeRect(54, 84, 82, 82);
    ctx.fillStyle = '#1d2a23';
    ctx.fillRect(69, 99, 52, 52);
    ctx.strokeStyle = '#99b65c';
    ctx.strokeRect(69, 99, 52, 52);
    ctx.fillStyle = gameState.extractionCalled ? '#d7f36b' : '#78905d';
    ctx.font = '11px Space Mono';
    ctx.fillText('EXTRACT', 61, 180);

    // Scrap collectibles
    mapManager.scrap.forEach(s => {
      if (s.found) return;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#d7f36b';
      ctx.shadowColor = '#d7f36b';
      ctx.shadowBlur = 13;
      ctx.fillRect(-8, -8, 16, 16);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#354133';
      ctx.fillRect(-4, -4, 8, 8);
      ctx.restore();
    });

    // Monster entity
    if (monster.active) {
      ctx.save();
      ctx.translate(monster.x, monster.y);
      ctx.rotate(monster.angle);
      ctx.fillStyle = 'rgba(232,117,78,.18)';
      ctx.beginPath();
      ctx.arc(0, 0, 31, 0, Math.PI * 2);
      ctx.fill();
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
      ctx.restore();
    }

    // Player entity
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(player.angle);
    ctx.fillStyle = '#75ddd0';
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

    // Draw flashlight cone on map
    if (player.flashlight) {
      ctx.save();
      ctx.translate(player.x, player.y);
      ctx.rotate(player.angle);
      const cone = ctx.createRadialGradient(0, 0, 5, 0, 0, 260);
      cone.addColorStop(0, 'rgba(215,243,107,.13)');
      cone.addColorStop(1, 'rgba(215,243,107,0)');
      ctx.fillStyle = cone;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 260, -0.38, 0.38);
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
      // Line segments from current trailing head back to start to form a laser-dash bullet
      const angle = Math.atan2(trace.endY - trace.startY, trace.endX - trace.startX);
      const tailLength = 24; // Length of the kinetic tracer line
      
      // Calculate how far the tracer bullet has traveled from the weapon barrel
      const travelDistance = Math.hypot(trace.currentX - trace.startX, trace.currentY - trace.startY);
      
      let tailX = trace.startX;
      let tailY = trace.startY;
      
      // If the bullet has traveled further than the tail length, let the tail follow the bullet,
      // otherwise keep the tail anchored at the starting point (barrel exit)
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
   * Draws world room labels and indicators (always aligned with camera)
   */
  drawWorldOverlay(player, mapManager, gameState) {
    const ctx = this.ui.ctx;
    const scaleX = this.ui.canvas.clientWidth / Config.VIEW_W;
    const scaleY = this.ui.canvas.clientHeight / Config.VIEW_H;

    ctx.setTransform(this.renderDpr, 0, 0, this.renderDpr, 0, 0);
    ctx.save();
    this.applyCamera(ctx, scaleX, scaleY, gameState);

    // Sector overlays
    mapManager.worldRooms.forEach(room => {
      ctx.fillStyle = 'rgba(117,221,208,.035)';
      ctx.strokeStyle = 'rgba(117,221,208,.25)';
      ctx.lineWidth = 1;
      ctx.fillRect(room.x, room.y, room.w, room.h);
      ctx.strokeRect(room.x, room.y, room.w, room.h);

      ctx.fillStyle = 'rgba(117,221,208,.55)';
      ctx.font = '9px Space Mono';
      ctx.fillText(room.label, room.x + 10, room.y + 18);
    });

    // Doors
    mapManager.doors.forEach(door => {
      ctx.fillStyle = door.open ? 'rgba(117,221,208,.22)' : '#a45d45';
      ctx.strokeStyle = door.open ? '#75ddd0' : '#e8754e';
      ctx.lineWidth = 2;
      ctx.fillRect(door.x, door.y, door.w, door.h);
      ctx.strokeRect(door.x, door.y, door.w, door.h);
    });

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

      ctx.strokeStyle = 'rgba(215,243,107,.95)';
      ctx.lineWidth = 1.5;
      ctx.shadowColor = '#d7f36b';
      ctx.shadowBlur = 8;

      ctx.beginPath();
      ctx.moveTo(player.x, player.y);
      ctx.lineTo(player.x + Math.cos(laserAngle) * laserDistance, player.y + Math.sin(laserAngle) * laserDistance);
      ctx.stroke();

      ctx.shadowBlur = 0;
    }

    ctx.restore();
  }

  /**
   * Controls raycasting shadows and lighting visibility mask
   */
  drawCenteredVision(player, mapManager, gameState) {
    this.drawOccludedVision(player, mapManager, gameState);
    this.clearFlashlightBeam(player, mapManager, gameState);
  }

  /**
   * Draws occluding fog of war with near ambient light
   */
  drawOccludedVision(player, mapManager, gameState) {
    const visionCtx = this.ui.visionCtx;
    const w = this.ui.visionCanvas.clientWidth;
    const h = this.ui.visionCanvas.clientHeight;
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

    // Muzzle Flash Effect - Omni-directional bright explosion of light but BLOCKED by walls (raycasting)
    if (gameState.muzzleFlashTimer > 0) {
      // Calculate flash alpha linearly decaying over the timer duration
      const flashAlpha = Math.min(1.0, gameState.muzzleFlashTimer / 0.45);
      const flashRange = 550 * (0.3 + 0.7 * flashAlpha); // Light radius shrinks slightly as it decays
      const flashSteps = 180; // Dense rays to make wall blocking look smooth and solid
      
      visionCtx.beginPath();
      visionCtx.moveTo(player.x, player.y);
      for (let index = 0; index <= flashSteps; index += 1) {
        const angle = (index / flashSteps) * Math.PI * 2;
        const distance = mapManager.rayWallDistance(player.x, player.y, Math.cos(angle), Math.sin(angle), flashRange);
        visionCtx.lineTo(player.x + Math.cos(angle) * distance, player.y + Math.sin(angle) * distance);
      }
      visionCtx.closePath();
      
      // Flash gradient (bright white-yellow center decaying to absolute dark) with dynamic opacity
      const flashGrad = visionCtx.createRadialGradient(player.x, player.y, 10, player.x, player.y, flashRange);
      flashGrad.addColorStop(0, `rgba(255, 255, 230, ${flashAlpha})`);
      flashGrad.addColorStop(0.15, `rgba(255, 220, 130, ${flashAlpha * 0.95})`);
      flashGrad.addColorStop(0.6, `rgba(215, 243, 107, ${flashAlpha * 0.45})`);
      flashGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      visionCtx.fillStyle = flashGrad;
      visionCtx.fill();
    }

    // Soft light circle near player in world coordinates
    const near = visionCtx.createRadialGradient(player.x, player.y, 8, player.x, player.y, 70);
    near.addColorStop(0, 'rgba(0,0,0,1)');
    near.addColorStop(1, 'rgba(0,0,0,.88)');
    visionCtx.fillStyle = near;
    visionCtx.beginPath();
    visionCtx.arc(player.x, player.y, 74, 0, Math.PI * 2);
    visionCtx.fill();

    // Flashlight cone casting
    if (player.flashlight) {
      const range = 420;
      const spread = 0.5;
      const steps = 80;

      visionCtx.beginPath();
      visionCtx.moveTo(player.x, player.y);
      for (let index = 0; index <= steps; index += 1) {
        const angle = player.angle - spread + (index / steps) * spread * 2;
        const distance = mapManager.rayWallDistance(player.x, player.y, Math.cos(angle), Math.sin(angle), range);
        visionCtx.lineTo(player.x + Math.cos(angle) * distance, player.y + Math.sin(angle) * distance);
      }
      visionCtx.closePath();

      const light = visionCtx.createRadialGradient(player.x, player.y, 12, player.x, player.y, range);
      light.addColorStop(0, 'rgba(0,0,0,1)');
      light.addColorStop(0.76, 'rgba(0,0,0,.98)');
      light.addColorStop(1, 'rgba(0,0,0,0)');
      visionCtx.fillStyle = light;
      visionCtx.fill();
    }
    visionCtx.restore();
  }

  /**
   * Cuts out flashlight geometry in mask
   */
  clearFlashlightBeam(player, mapManager, gameState) {
    if (!player.flashlight) return;
    
    const visionCtx = this.ui.visionCtx;
    const scaleX = this.ui.visionCanvas.clientWidth / Config.VIEW_W;
    const scaleY = this.ui.visionCanvas.clientHeight / Config.VIEW_H;
    const range = 420;
    const spread = 0.5;
    const steps = 80;

    visionCtx.save();
    visionCtx.setTransform(this.renderDpr, 0, 0, this.renderDpr, 0, 0);
    this.applyCamera(visionCtx, scaleX, scaleY, gameState);

    visionCtx.globalCompositeOperation = 'destination-out';
    visionCtx.fillStyle = '#000';

    visionCtx.beginPath();
    visionCtx.moveTo(player.x, player.y);
    for (let index = 0; index <= steps; index += 1) {
      const angle = player.angle - spread + (index / steps) * spread * 2;
      const distance = mapManager.rayWallDistance(player.x, player.y, Math.cos(angle), Math.sin(angle), range);
      visionCtx.lineTo(player.x + Math.cos(angle) * distance, player.y + Math.sin(angle) * distance);
    }
    visionCtx.closePath();
    visionCtx.fill();
    visionCtx.restore();
  }

  /**
   * Renders the top-down radar scan display
   */
  drawMiniMap(player, mapManager) {
    const miniCtx = this.ui.miniCtx;
    const width = 168;
    const height = 112;

    miniCtx.clearRect(0, 0, width, height);
    miniCtx.fillStyle = '#07100d';
    miniCtx.fillRect(0, 0, width, height);

    miniCtx.save();
    miniCtx.scale(width / Config.WORLD_W, height / Config.WORLD_H);

    // Walls & sector bounds
    miniCtx.fillStyle = 'rgba(215,243,107,.16)';
    mapManager.walls.forEach(wall => miniCtx.fillRect(wall.x, wall.y, wall.w, wall.h));
    miniCtx.strokeStyle = 'rgba(117,221,208,.24)';
    mapManager.worldRooms.forEach(room => miniCtx.strokeRect(room.x, room.y, room.w, room.h));

    // Extraction location
    miniCtx.fillStyle = '#78905d';
    miniCtx.beginPath();
    miniCtx.arc(Config.extraction.x, Config.extraction.y, 18, 0, Math.PI * 2);
    miniCtx.fill();

    // Player position
    miniCtx.fillStyle = '#d7f36b';
    miniCtx.beginPath();
    miniCtx.arc(player.x, player.y, 15, 0, Math.PI * 2);
    miniCtx.fill();

    // Player vector facing line
    miniCtx.strokeStyle = 'rgba(215,243,107,.7)';
    miniCtx.beginPath();
    miniCtx.moveTo(player.x, player.y);
    miniCtx.lineTo(player.x + Math.cos(player.angle) * 55, player.y + Math.sin(player.angle) * 55);
    miniCtx.stroke();

    miniCtx.restore();
  }
}
