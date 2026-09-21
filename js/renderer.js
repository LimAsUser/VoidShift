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
    const worldW = mapManager.worldW || Config.WORLD_W;
    const worldH = mapManager.worldH || Config.WORLD_H;
    ctx.fillStyle = '#111714';
    ctx.fillRect(0, 0, worldW, worldH);
    ctx.fillStyle = '#151c18';
    ctx.fillRect(22, 22, worldW - 44, worldH - 44);

    // Sector gridlines
    ctx.strokeStyle = 'rgba(215,243,107,.05)';
    ctx.lineWidth = 1;
    for (let x = 40; x < worldW; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 22);
      ctx.lineTo(x, worldH - 22);
      ctx.stroke();
    }
    for (let y = 40; y < worldH; y += 40) {
      ctx.beginPath();
      ctx.moveTo(22, y);
      ctx.lineTo(worldW - 22, y);
      ctx.stroke();
    }

    // Draw polygon room floor slabs with sector tinting
    mapManager.worldRooms.forEach(room => {
      ctx.save();
      if (room.vertices && room.vertices.length) {
        ctx.beginPath();
        ctx.moveTo(room.vertices[0].x, room.vertices[0].y);
        for (let i = 1; i < room.vertices.length; i++) {
          ctx.lineTo(room.vertices[i].x, room.vertices[i].y);
        }
        ctx.closePath();
        ctx.fillStyle = '#141c18';
        ctx.fill();
        ctx.fillStyle = room.accent || '#75ddd0';
        ctx.globalAlpha = 0.04;
        ctx.fill();
        ctx.globalAlpha = 0.15;
        ctx.strokeStyle = room.accent || '#75ddd0';
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        ctx.fillStyle = '#141c18';
        ctx.fillRect(room.x, room.y, room.w, room.h);
      }
      ctx.restore();
    });

    // Draw solid walls and obstacles with metallic bulkhead detailing
    mapManager.walls.forEach(wall => {
      if (wall.x1 !== undefined) {
        // Line segment bulkhead wall
        ctx.save();
        // Heavy structural casing
        ctx.lineWidth = 14;
        ctx.lineCap = 'butt';
        ctx.strokeStyle = '#222b27';
        ctx.beginPath();
        ctx.moveTo(wall.x1, wall.y1);
        ctx.lineTo(wall.x2, wall.y2);
        ctx.stroke();

        // Inner metallic plate
        ctx.lineWidth = 8;
        ctx.strokeStyle = '#2a3530';
        ctx.beginPath();
        ctx.moveTo(wall.x1, wall.y1);
        ctx.lineTo(wall.x2, wall.y2);
        ctx.stroke();

        // Structural bevel highlight
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#526658';
        ctx.beginPath();
        ctx.moveTo(wall.x1, wall.y1);
        ctx.lineTo(wall.x2, wall.y2);
        ctx.stroke();
        ctx.restore();
      } else if (wall.x !== undefined) {
        ctx.save();
        if (wall.isBox) {
          // Cargo Crate: heavy reinforced container with industrial bevel, warning accents & latch
          ctx.fillStyle = '#1c2621';
          ctx.fillRect(wall.x, wall.y, wall.w, wall.h);

          // Inner plate
          ctx.fillStyle = '#26342c';
          ctx.fillRect(wall.x + 3, wall.y + 3, wall.w - 6, wall.h - 6);

          // Border
          ctx.strokeStyle = '#4b5f52';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(wall.x + 0.5, wall.y + 0.5, wall.w - 1, wall.h - 1);

          // Diagonal hazard accent corner
          ctx.fillStyle = '#e8754e';
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
          ctx.fillStyle = '#16201b';
          ctx.fillRect(wall.x, wall.y, wall.w, wall.h);

          ctx.fillStyle = '#202a24';
          ctx.fillRect(wall.x + 2, wall.y + 2, wall.w - 4, wall.h - 4);

          ctx.strokeStyle = '#3e5245';
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
          const ledColor = wall.subType === 'reactor_core' ? '#ff4d4d' :
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
          ctx.fillStyle = '#222b27';
          ctx.fillRect(wall.x, wall.y, wall.w, wall.h);

          if (wall.w > 8 && wall.h > 8) {
            ctx.fillStyle = '#2a3530';
            ctx.fillRect(wall.x + 2, wall.y + 2, wall.w - 4, wall.h - 4);
          }

          ctx.strokeStyle = '#3d4d42';
          ctx.lineWidth = 1;
          ctx.strokeRect(wall.x + 0.5, wall.y + 0.5, wall.w - 1, wall.h - 1);

          ctx.strokeStyle = '#526658';
          ctx.beginPath();
          ctx.moveTo(wall.x + wall.w - 1, wall.y + 1);
          ctx.lineTo(wall.x + 1, wall.y + 1);
          ctx.lineTo(wall.x + 1, wall.y + wall.h - 1);
          ctx.stroke();
        }
        ctx.restore();
      }
    });

    // Extraction visual markers (Primary Airlock & Emergency Evac Pod)
    const drawExtractionMarker = (pt, label) => {
      if (!pt) return;
      ctx.save();
      const ex = pt.x;
      const ey = pt.y;
      const r = 40;

      ctx.fillStyle = 'rgba(39,55,45,0.75)';
      ctx.fillRect(ex - r, ey - r, r * 2, r * 2);
      ctx.strokeStyle = gameState.extractionCalled ? '#d7f36b' : '#607157';
      ctx.lineWidth = 2;
      ctx.strokeRect(ex - r, ey - r, r * 2, r * 2);

      // Inner pad circle
      ctx.strokeStyle = gameState.extractionCalled ? '#d7f36b' : '#99b65c';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(ex, ey, 22, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = gameState.extractionCalled ? '#d7f36b' : '#78905d';
      ctx.font = '10px Space Mono';
      ctx.textAlign = 'center';
      ctx.fillText(label, ex, ey + 4);
      ctx.restore();
    };

    drawExtractionMarker(mapManager.extractionPoint, 'AIRLOCK');
    drawExtractionMarker(mapManager.exitExtractionPoint, 'EVAC POD');

    // 3 Security Override QTE Terminals
    if (mapManager.terminals) {
      mapManager.terminals.forEach(term => {
        ctx.save();
        ctx.translate(term.x, term.y);

        // Terminal pedestal base
        ctx.fillStyle = '#18221e';
        ctx.strokeStyle = term.solved ? '#50e3c2' : '#f5a623';
        ctx.lineWidth = 2;
        ctx.fillRect(-18, -18, 36, 36);
        ctx.strokeRect(-18, -18, 36, 36);

        // Inner glowing CRT terminal screen
        const screenGlow = term.solved ? '#50e3c2' : '#f5a623';
        ctx.shadowColor = screenGlow;
        ctx.shadowBlur = term.solved ? 8 : (10 + Math.sin(gameState.elapsed * 4) * 4);
        ctx.fillStyle = term.solved ? 'rgba(80, 227, 194, 0.4)' : 'rgba(245, 166, 35, 0.4)';
        ctx.fillRect(-12, -12, 24, 24);
        ctx.shadowBlur = 0;

        // Terminal symbol
        ctx.fillStyle = term.solved ? '#50e3c2' : '#f5a623';
        ctx.font = 'bold 12px Space Mono';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(term.solved ? '✓' : '!', 0, 0);

        // Proximity text prompt
        const dist = Math.hypot(term.x - player.x, term.y - player.y);
        if (dist < 55 && !term.solved) {
          ctx.fillStyle = '#f5a623';
          ctx.font = 'bold 10px Space Mono';
          ctx.fillText('[E] OVERRIDE', 0, -25);
        } else if (dist < 55 && term.solved) {
          ctx.fillStyle = '#50e3c2';
          ctx.font = '9px Space Mono';
          ctx.fillText('OVERRIDDEN', 0, -25);
        }

        ctx.restore();
      });
    }

    // Scrap collectibles
    mapManager.scrap.forEach(s => {
      if (s.found) return;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(Math.PI / 4);
      
      // Color code by rarity
      const glowColor = s.rarity === 'rare' ? '#f5a623' : s.rarity === 'uncommon' ? '#50e3c2' : '#d7f36b';
      ctx.fillStyle = glowColor;
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 12;
      ctx.fillRect(-8, -8, 16, 16);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#1c2420';
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
   * Renders directional doors (Closed: Opaque sealed panel; Open: Swung 90° against wall)
   */
  drawDoors(ctx, mapManager) {
    mapManager.doors.forEach(door => {
      ctx.save();
      const p1 = door.p1;
      const p2 = door.p2;

      if (!p1 || !p2) {
        // Fallback for AABB doors
        if (!door.open) {
          ctx.fillStyle = '#1e2621';
          ctx.fillRect(door.x, door.y, door.w, door.h);
          ctx.strokeStyle = '#e8754e';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(door.x + 0.5, door.y + 0.5, door.w - 1, door.h - 1);
        }
        ctx.restore();
        return;
      }

      const cx = (p1.x + p2.x) / 2;
      const cy = (p1.y + p2.y) / 2;
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy);

      if (!door.open) {
        // CLOSED: Reinforced blast panel sealed between p1 and p2
        ctx.lineWidth = 14;
        ctx.lineCap = 'butt';
        ctx.strokeStyle = '#1e2621';
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();

        // Warning amber hazard stripe
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = '#e8754e';
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();

        // Center lock LED (Red glow)
        ctx.shadowColor = '#ff4d4d';
        ctx.shadowBlur = 6;
        ctx.fillStyle = '#ff4d4d';
        ctx.beginPath();
        ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      } else {
        // OPEN: Swung 90° against the wall
        // Doorway jamb stops
        ctx.fillStyle = '#37453b';
        ctx.beginPath();
        ctx.arc(p1.x, p1.y, 5, 0, Math.PI * 2);
        ctx.arc(p2.x, p2.y, 5, 0, Math.PI * 2);
        ctx.fill();

        // Swung door slab
        const norm = door.normal || { x: 0, y: 1 };
        const slabLen = len * 0.9;
        const dir = door.openDir || 1;
        const slabEndX = p1.x + norm.x * dir * slabLen;
        const slabEndY = p1.y + norm.y * dir * slabLen;

        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#26382f';
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(slabEndX, slabEndY);
        ctx.stroke();

        ctx.lineWidth = 2;
        ctx.strokeStyle = '#75ddd0';
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(slabEndX, slabEndY);
        ctx.stroke();

        // Green status LED on tip of open slab
        ctx.shadowColor = '#75ddd0';
        ctx.shadowBlur = 5;
        ctx.fillStyle = '#75ddd0';
        ctx.beginPath();
        ctx.arc(slabEndX, slabEndY, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      ctx.restore();
    });
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
        const distance = mapManager.rayVisionDistance(player.x, player.y, Math.cos(angle), Math.sin(angle), flashRange, 12);
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

    // Soft ambient light circle around player - blocked by walls and closed doors like flashlight
    const ambientRange = 74;
    const ambientSteps = 64;
    visionCtx.beginPath();
    visionCtx.moveTo(player.x, player.y);
    for (let index = 0; index <= ambientSteps; index += 1) {
      const angle = (index / ambientSteps) * Math.PI * 2;
      const distance = mapManager.rayVisionDistance(player.x, player.y, Math.cos(angle), Math.sin(angle), ambientRange, 12);
      visionCtx.lineTo(player.x + Math.cos(angle) * distance, player.y + Math.sin(angle) * distance);
    }
    visionCtx.closePath();

    const near = visionCtx.createRadialGradient(player.x, player.y, 8, player.x, player.y, ambientRange);
    near.addColorStop(0, 'rgba(0,0,0,1)');
    near.addColorStop(0.85, 'rgba(0,0,0,.92)');
    near.addColorStop(1, 'rgba(0,0,0,0)');
    visionCtx.fillStyle = near;
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
        const distance = mapManager.rayVisionDistance(player.x, player.y, Math.cos(angle), Math.sin(angle), range, 13);
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
      const distance = mapManager.rayVisionDistance(player.x, player.y, Math.cos(angle), Math.sin(angle), range, 13);
      visionCtx.lineTo(player.x + Math.cos(angle) * distance, player.y + Math.sin(angle) * distance);
    }
    visionCtx.closePath();
    visionCtx.fill();
    visionCtx.restore();
  }

  /**
   * Renders the top-down radar scan display with Fog of War
   * Undiscovered rooms remain pitch black until the player explores into them!
   */
  drawMiniMap(player, mapManager, gameState = null) {
    const miniCtx = this.ui.miniCtx;
    const width = 168;
    const height = 112;

    miniCtx.clearRect(0, 0, width, height);
    miniCtx.fillStyle = '#060a08';
    miniCtx.fillRect(0, 0, width, height);

    miniCtx.save();
    const mapW = mapManager.worldW || Config.WORLD_W;
    const mapH = mapManager.worldH || Config.WORLD_H;
    miniCtx.scale(width / mapW, height / mapH);

    const isRevealed = gameState && gameState.revealAllMap;

    // 1. Draw only DISCOVERED rooms (or ALL rooms if debug revealAllMap is active)
    mapManager.worldRooms.forEach(room => {
      if (!room.discovered && !isRevealed) return;

      miniCtx.save();
      if (room.vertices && room.vertices.length) {
        miniCtx.beginPath();
        miniCtx.moveTo(room.vertices[0].x, room.vertices[0].y);
        for (let i = 1; i < room.vertices.length; i++) {
          miniCtx.lineTo(room.vertices[i].x, room.vertices[i].y);
        }
        miniCtx.closePath();
        miniCtx.fillStyle = 'rgba(215, 243, 107, 0.08)';
        miniCtx.fill();
        miniCtx.strokeStyle = room.accent || 'rgba(117, 221, 208, 0.45)';
        miniCtx.lineWidth = 2.5;
        miniCtx.stroke();
      } else {
        miniCtx.fillStyle = 'rgba(215, 243, 107, 0.06)';
        miniCtx.fillRect(room.x, room.y, room.w, room.h);
        miniCtx.strokeStyle = 'rgba(117, 221, 208, 0.35)';
        miniCtx.lineWidth = 2;
        miniCtx.strokeRect(room.x, room.y, room.w, room.h);
      }

      // Room label on radar
      const cx = room.center ? room.center.x : (room.x + room.w / 2);
      const cy = room.center ? room.center.y : (room.y + room.h / 2);
      miniCtx.fillStyle = 'rgba(215, 243, 107, 0.7)';
      miniCtx.font = 'bold 22px monospace';
      miniCtx.textAlign = 'center';
      miniCtx.textBaseline = 'middle';
      miniCtx.fillText(room.label, cx, cy);
      miniCtx.restore();
    });

    // 2. Solid walls and cargo props belonging to discovered rooms
    mapManager.walls.forEach(wall => {
      if (wall.x1 !== undefined) {
        const nearDiscovered = isRevealed || mapManager.worldRooms.some(r => r.discovered && distToSegment(r.center.x, r.center.y, wall.x1, wall.y1, wall.x2, wall.y2) < 420);
        if (nearDiscovered) {
          miniCtx.lineWidth = 3;
          miniCtx.strokeStyle = 'rgba(215, 243, 107, 0.45)';
          miniCtx.beginPath();
          miniCtx.moveTo(wall.x1, wall.y1);
          miniCtx.lineTo(wall.x2, wall.y2);
          miniCtx.stroke();
        }
      } else if (wall.x !== undefined) {
        const wallCenterX = wall.x + wall.w / 2;
        const wallCenterY = wall.y + wall.h / 2;
        const r = mapManager.getRoomAt(wallCenterX, wallCenterY);
        if (isRevealed || (r && r.discovered)) {
          if (wall.isBox) {
            miniCtx.fillStyle = 'rgba(232, 117, 78, 0.55)';
          } else if (wall.isProp) {
            miniCtx.fillStyle = 'rgba(80, 227, 194, 0.55)';
          } else {
            miniCtx.fillStyle = 'rgba(215, 243, 107, 0.3)';
          }
          miniCtx.fillRect(wall.x, wall.y, wall.w, wall.h);
        }
      }
    });

    // 3. Doors: visible if at least one bordering room is discovered or all revealed
    mapManager.doors.forEach(door => {
      const isVisible = isRevealed || (door.roomA && door.roomA.discovered) || (door.roomB && door.roomB.discovered);
      if (isVisible) {
        if (door.p1 && door.p2) {
          miniCtx.lineWidth = 4;
          miniCtx.strokeStyle = door.open ? '#75ddd0' : '#e8754e';
          miniCtx.beginPath();
          miniCtx.moveTo(door.p1.x, door.p1.y);
          miniCtx.lineTo(door.p2.x, door.p2.y);
          miniCtx.stroke();
        } else {
          miniCtx.fillStyle = door.open ? '#75ddd0' : '#e8754e';
          miniCtx.fillRect(door.x, door.y, Math.max(6, door.w), Math.max(6, door.h));
        }
      }
    });

    // 4. Extraction points: visible only when their room is discovered or all revealed
    if (mapManager.extractionPoint) {
      const room = mapManager.getRoomAt(mapManager.extractionPoint.x, mapManager.extractionPoint.y);
      if (isRevealed || (room && room.discovered)) {
        miniCtx.fillStyle = '#78905d';
        miniCtx.beginPath();
        miniCtx.arc(mapManager.extractionPoint.x, mapManager.extractionPoint.y, 16, 0, Math.PI * 2);
        miniCtx.fill();
      }
    }
    if (mapManager.exitExtractionPoint) {
      const room = mapManager.getRoomAt(mapManager.exitExtractionPoint.x, mapManager.exitExtractionPoint.y);
      if (isRevealed || (room && room.discovered)) {
        miniCtx.fillStyle = '#d7f36b';
        miniCtx.beginPath();
        miniCtx.arc(mapManager.exitExtractionPoint.x, mapManager.exitExtractionPoint.y, 16, 0, Math.PI * 2);
        miniCtx.fill();
      }
    }

    // 5. QTE Terminals: visible on minimap if their room is discovered
    if (mapManager.terminals) {
      mapManager.terminals.forEach(term => {
        if (term.room && term.room.discovered) {
          miniCtx.save();
          miniCtx.translate(term.x, term.y);
          miniCtx.fillStyle = term.solved ? '#50e3c2' : '#f5a623';
          miniCtx.beginPath();
          miniCtx.moveTo(0, -12);
          miniCtx.lineTo(12, 0);
          miniCtx.lineTo(0, 12);
          miniCtx.lineTo(-12, 0);
          miniCtx.closePath();
          miniCtx.fill();
          miniCtx.restore();
        }
      });
    }

    // 6. Player position and facing vector line
    miniCtx.fillStyle = '#d7f36b';
    miniCtx.beginPath();
    miniCtx.arc(player.x, player.y, 14, 0, Math.PI * 2);
    miniCtx.fill();

    miniCtx.strokeStyle = 'rgba(215,243,107,.85)';
    miniCtx.lineWidth = 3;
    miniCtx.beginPath();
    miniCtx.moveTo(player.x, player.y);
    miniCtx.lineTo(player.x + Math.cos(player.angle) * 45, player.y + Math.sin(player.angle) * 45);
    miniCtx.stroke();

    miniCtx.restore();
  }
}
