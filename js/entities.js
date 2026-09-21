/**
 * VOID SHIFT // RECOVERY OPERATIONS PROTOCOL
 * Entities Module (Player & Monster State Management)
 */

class Player {
  constructor() {
    this.reset();
  }

  /**
   * Resets player telemetry and position
   */
  reset(mapManager, weaponId = this.weaponId || 'pistol') {
    this.x = (mapManager && mapManager.spawnPoint) ? mapManager.spawnPoint.x : Config.player.spawnX;
    this.y = (mapManager && mapManager.spawnPoint) ? mapManager.spawnPoint.y : Config.player.spawnY;
    this.radius = Config.player.radius;
    this.baseSpeed = Config.player.speed;
    this.angle = 0;
    
    // Telemetry stats
    this.oxygen = 100;
    this.health = 100;
    this.stamina = 100;
    this.noise = 0;
    
    // Weapon stats
    this.flashlight = true;
    this.reserveAmmo = Config.player.maxReserveAmmo;
    this.setWeapon(weaponId);
    this.moveSpeed = 0;
    this.stunned = 0; // Stun duration timer in seconds
  }

  setWeapon(weaponId) {
    const weapon = Config.weapons[weaponId] || Config.weapons.pistol;
    this.weaponId = weapon.id;
    this.weapon = weapon;
    this.ammo = weapon.maxAmmo;
    this.shootCooldown = 0;
    this.reloading = 0;
  }

  /**
   * Updates player cooldowns, reloading state and movement
   */
  update(dt, keys, stabilized, mapManager, audioManager) {
    this.shootCooldown = Math.max(0, this.shootCooldown - dt);

    const prevStunned = this.stunned;
    if (this.stunned > 0) {
      this.stunned = Math.max(0, this.stunned - dt);
    }

    const updateResult = {
      reloaded: false,
      stunned: this.stunned > 0,
      stunTimeLeft: this.stunned,
      stunRecovered: (prevStunned > 0 && this.stunned === 0)
    };

    // If stunned, immobilize movement and block actions
    if (this.stunned > 0) {
      this.moveSpeed = 0;
      return updateResult;
    }

    if (this.reloading > 0) {
      this.reloading = Math.max(0, this.reloading - dt);
      if (this.reloading === 0) {
        const needed = this.weapon.maxAmmo - this.ammo;
        const loaded = Math.min(needed, this.reserveAmmo);
        this.ammo += loaded;
        this.reserveAmmo -= loaded;
        updateResult.reloaded = true;
      }
    }

    this.move(dt, keys, stabilized, mapManager, audioManager);

    return updateResult;
  }

  /**
   * Handles user-driven translation movement and physics collisions
   */
  move(dt, keys, stabilized, mapManager, audioManager) {
    let dx = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
    let dy = (keys.s ? 1 : 0) - (keys.w ? 1 : 0);
    const moving = Boolean(dx || dy);
    const running = moving && keys.shift && !stabilized && this.stamina > 1;
    const speed = stabilized ? this.baseSpeed * 0.55 : running ? this.baseSpeed * 1.6 : this.baseSpeed;

    this.moveSpeed = moving ? speed : 0;

    if (moving) {
      const len = Math.hypot(dx, dy);
      dx /= len;
      dy /= len;

      const nx = this.x + dx * speed * dt;
      const ny = this.y + dy * speed * dt;

      // Axis-aligned independent sliding collision response
      if (!mapManager.blocked(nx, this.y, this.radius)) this.x = nx;
      if (!mapManager.blocked(this.x, ny, this.radius)) this.y = ny;

      // Update current target noise level (has a maximum threshold ceiling depending on moving speed)
      const targetMaxNoise = running ? 75 : stabilized ? 8 : 28;
      if (this.noise < targetMaxNoise) {
        this.noise = Math.min(targetMaxNoise, this.noise + (running ? 65 : 35) * dt);
      } else {
        // Slowly decay towards the movement's noise cap if above it (e.g. after a gunshot)
        const decayRate = (Config.player && Config.player.noiseDecayMoving) || 7;
        this.noise = Math.max(targetMaxNoise, this.noise - decayRate * dt);
      }

      if (running) {
        this.stamina = Math.max(0, this.stamina - 30 * dt);
      } else {
        this.stamina = Math.min(100, this.stamina + 16 * dt);
      }

      // Play moving footsteps sound effects
      const stepInterval = running ? 260 : 440;
      if (audioManager.context && performance.now() - audioManager.lastStep > stepInterval) {
        audioManager.lastStep = performance.now();
        audioManager.playTone(running ? 78 : 62, 0.055, running ? 0.045 : 0.025, 'triangle');
      }
    } else {
      this.stamina = Math.min(100, this.stamina + 22 * dt);
    }
  }

  /**
   * Triggers a weapon reload sequence
   */
  reload(audioManager) {
    if (this.stunned > 0 || this.reloading > 0 || this.ammo === this.weapon.maxAmmo || this.reserveAmmo <= 0) {
      return false;
    }
    this.reloading = this.weapon.reloadDuration;
    audioManager.playSound('resources/gun-reload-2-511308.mp3', 0.5);
    return true;
  }

  /**
   * Fires the hand weapon and resolves line of sight targeting
   */
  shoot(stabilized, mapManager, audioManager, monster) {
    if (this.stunned > 0) {
      return { fired: false, reason: 'stunned' };
    }
    if (this.reloading > 0) {
      return { fired: false, reason: 'reloading' };
    }
    if (this.shootCooldown > 0) {
      return { fired: false, reason: 'cooldown' };
    }
    if (this.ammo <= 0) {
      return { fired: false, reason: 'empty' };
    }

    this.ammo -= 1;
    this.shootCooldown = this.weapon.shootCooldownDuration;
    this.noise = Math.min(100, this.noise + this.weapon.shotNoise);
    audioManager.playSound('resources/gun-shot-359196.mp3', 0.3);

    // Calculate spread. Aiming has no spread. Not aiming has a massive random spread.
    const maxSpread = stabilized ? this.weapon.aimSpread : this.weapon.hipSpread;
    const spread = (Math.random() - 0.5) * 2 * maxSpread;
    const shotAngle = this.angle + spread;
    
    // Calculate final line-of-sight and length of trace
    const wallDistance = mapManager.rayWallDistance(this.x, this.y, Math.cos(shotAngle), Math.sin(shotAngle), 650);

    const result = {
      fired: true,
      hit: false,
      ammo: this.ammo,
      distance: 0,
      toMonster: 0,
      shotAngle: shotAngle,
      traceLength: wallDistance
    };

    if (monster.active) {
      const distance = Math.hypot(monster.x - this.x, monster.y - this.y);
      const toMonster = Math.atan2(monster.y - this.y, monster.x - this.x);

      const angleDifference = Math.atan2(Math.sin(toMonster - shotAngle), Math.cos(toMonster - shotAngle));

      // Hit tolerance based on the monster's angular size from player's view
      const hitTolerance = Math.max(0.12, 15 / distance);

      // Broaden emergency self-defense tolerance angle if sticking extremely close (point blank)
      const emergencyTolerance = distance < 90 ? 0.7 : hitTolerance;

      if (distance < 650 && Math.abs(angleDifference) < emergencyTolerance && distance < wallDistance + 24) {
        result.hit = true;
        result.distance = distance;
        result.toMonster = toMonster;
        // Clip the trace length exactly to the monster position on impact
        result.traceLength = distance;
      }
    }

    return result;
  }
}

const PURSUIT_PROBE_OFFSETS = [0, Math.PI / 6, -Math.PI / 6, Math.PI / 3, -Math.PI / 3, Math.PI / 2, -Math.PI / 2, 2 * Math.PI / 3, -2 * Math.PI / 3];

function buildPursuitWaypoints(mapManager, fromX, fromY, targetX, targetY) {
  const fromRoom = mapManager.getRoomAt(fromX, fromY);
  const targetRoom = mapManager.getRoomAt(targetX, targetY);
  const waypoints = [];

  if (fromRoom && targetRoom) {
    for (const step of bfsRoomPath(fromRoom, targetRoom)) {
      const door = step.door;
      waypoints.push({
        x: door.p1 ? (door.p1.x + door.p2.x) / 2 : door.x + door.w / 2,
        y: door.p1 ? (door.p1.y + door.p2.y) / 2 : door.y + door.h / 2,
        isDoor: true,
        door
      });
    }
  }

  waypoints.push({ x: targetX, y: targetY, isDoor: false, door: null });
  return waypoints;
}

function isDirectPathClear(mapManager, fromX, fromY, targetX, targetY, radius) {
  const distance = Math.hypot(targetX - fromX, targetY - fromY);
  const steps = Math.max(1, Math.ceil(distance / Math.max(8, radius * 0.75)));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = fromX + (targetX - fromX) * t;
    const y = fromY + (targetY - fromY) * t;
    if (mapManager.blocked(x, y, radius)) return false;
  }
  return true;
}

function buildLocalGridPath(mapManager, fromX, fromY, targetX, targetY, radius, maxDistance) {
  if (isDirectPathClear(mapManager, fromX, fromY, targetX, targetY, radius)) return [];

  const cellSize = 28;
  const maxCells = Math.ceil((maxDistance + 140) / cellSize);
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const queue = [{ gx: 0, gy: 0 }];
  const parents = new Map([['0,0', null]]);
  let head = 0;
  let destinationKey = null;

  while (head < queue.length && queue.length <= 1600) {
    const current = queue[head++];
    const currentKey = `${current.gx},${current.gy}`;
    const currentX = fromX + current.gx * cellSize;
    const currentY = fromY + current.gy * cellSize;

    if (Math.hypot(targetX - currentX, targetY - currentY) <= cellSize * 1.5 &&
        isDirectPathClear(mapManager, currentX, currentY, targetX, targetY, radius)) {
      destinationKey = currentKey;
      break;
    }

    for (const [dx, dy] of directions) {
      const gx = current.gx + dx;
      const gy = current.gy + dy;
      if (Math.abs(gx) > maxCells || Math.abs(gy) > maxCells) continue;
      const key = `${gx},${gy}`;
      if (parents.has(key)) continue;

      const nextX = fromX + gx * cellSize;
      const nextY = fromY + gy * cellSize;
      if (!isDirectPathClear(mapManager, currentX, currentY, nextX, nextY, radius)) continue;
      parents.set(key, currentKey);
      queue.push({ gx, gy });
    }
  }

  if (!destinationKey) return [];
  const path = [];
  let key = destinationKey;
  while (key && parents.get(key) !== null) {
    const [gx, gy] = key.split(',').map(Number);
    path.push({ x: fromX + gx * cellSize, y: fromY + gy * cellSize });
    key = parents.get(key);
  }
  path.reverse();
  path.push({ x: targetX, y: targetY });
  return path;
}

function getPursuitTarget(entity, dt, mapManager, targetX, targetY, refreshInterval) {
  entity.waypointTimer -= dt;
  if (entity.waypointTimer <= 0 || entity.waypoints.length === 0) {
    entity.waypointTimer = refreshInterval;
    entity.waypoints = buildPursuitWaypoints(mapManager, entity.x, entity.y, targetX, targetY);
  }

  const first = entity.waypoints[0];
  if (first && first.isDoor && first.door && !first.door.open) {
    if (Math.hypot(first.x - entity.x, first.y - entity.y) < 50) {
      mapManager.toggleDoor(first.door, entity.x, entity.y);
    }
  }

  while (entity.waypoints.length > 0) {
    const waypoint = entity.waypoints[0];
    if (Math.hypot(waypoint.x - entity.x, waypoint.y - entity.y) >= 30) break;
    entity.waypoints.shift();
  }

  return entity.waypoints[0] || { x: targetX, y: targetY };
}

function moveWithAvoidance(entity, mapManager, targetX, targetY, speed, dt) {
  const moveAngle = Math.atan2(targetY - entity.y, targetX - entity.x);
  const step = speed * dt;
  let bestScore = -Infinity;
  let bestX = entity.x;
  let bestY = entity.y;
  let bestAngle = moveAngle;

  for (const offset of PURSUIT_PROBE_OFFSETS) {
    const angle = moveAngle + offset;
    const stepX = Math.cos(angle) * step;
    const stepY = Math.sin(angle) * step;
    const candidates = [];
    const fullX = entity.x + stepX;
    const fullY = entity.y + stepY;

    if (!mapManager.blocked(fullX, fullY, entity.radius)) {
      candidates.push({ x: fullX, y: fullY });
    } else {
      if (!mapManager.blocked(fullX, entity.y, entity.radius)) candidates.push({ x: fullX, y: entity.y });
      if (!mapManager.blocked(entity.x, fullY, entity.radius)) candidates.push({ x: entity.x, y: fullY });
    }

    for (const candidate of candidates) {
      const score = -Math.hypot(targetX - candidate.x, targetY - candidate.y) - Math.abs(offset) * 10;
      if (score > bestScore) {
        bestScore = score;
        bestX = candidate.x;
        bestY = candidate.y;
        bestAngle = angle;
      }
    }
  }

  entity.x = bestX;
  entity.y = bestY;
  entity.angle = bestAngle;
}

function recoverStuckPursuer(entity, dt, mapManager) {
  if (entity._lastX === null) {
    entity._lastX = entity.x;
    entity._lastY = entity.y;
  }

  if (Math.hypot(entity.x - entity._lastX, entity.y - entity._lastY) > 8) {
    entity._lastX = entity.x;
    entity._lastY = entity.y;
    entity._stuckTimer = 0;
    return;
  }

  entity._stuckTimer += dt;
  if (entity._stuckTimer <= 0.8) return;

  entity.waypoints = [];
  entity.waypointTimer = 0;
  if (Array.isArray(entity.localPath)) {
    entity.localPath = [];
    entity.localRepathTimer = 0;
  }
  entity._stuckTimer = 0;
  entity._lastX = null;
  entity._lastY = null;
  const nudgeDistance = entity.radius + 10;
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
    const nextX = entity.x + Math.cos(angle) * nudgeDistance;
    const nextY = entity.y + Math.sin(angle) * nudgeDistance;
    if (!mapManager.blocked(nextX, nextY, entity.radius)) {
      entity.x = nextX;
      entity.y = nextY;
      break;
    }
  }
}

class Monster {
  constructor() {
    this.reset();
  }

  /**
   * Resets monster states and coordinates
   */
  reset(mapManager) {
    if (mapManager && mapManager.monsterSpawns && mapManager.monsterSpawns.length) {
      const sp = mapManager.monsterSpawns[0];
      this.x = sp.x;
      this.y = sp.y;
    } else {
      this.x = Config.monster.spawnX;
      this.y = Config.monster.spawnY;
    }
    this.radius = Config.monster.radius;
    this.active = false;
    this.alerted = false;
    this.angle = 0;
    this.lostTime = 0;
    this.patrolAngle = 0;
    this.burstTimer = 0;
    this.burstCooldown = 0;
    this.slowTimer = 0;
    this.stagger = 0;
    this.shotCount = 0;
    this.shotWindowTimer = 0;
    this.recoverTimer = 0;
    this.waypoints = [];
    this.waypointTimer = 0;
    this._stuckTimer = 0;
    this._lastX = null;
    this._lastY = null;
  }

  /**
   * Registers bullet hit from player.
   * If hit 3 times within 10 seconds, triggers 10-second stunned recovery.
   * If 10 seconds elapse without reaching 3 hits, hit counter resets.
   */
  registerHit() {
    if (this.recoverTimer > 0) {
      return { hit: true, triggeredRecovery: false, recovering: true };
    }

    if (this.shotWindowTimer <= 0) {
      this.shotCount = 1;
      this.shotWindowTimer = 10.0;
    } else {
      this.shotCount++;
    }

    if (this.shotCount >= 3) {
      this.recoverTimer = 10.0;
      this.stagger = 10.0;
      this.shotCount = 0;
      this.shotWindowTimer = 0;
      return { hit: true, triggeredRecovery: true, recovering: true, shotCount: 3 };
    }

    // Normal hit: stun monster for 0.25s and cancel any active burst charge
    this.stagger = 0.25;
    this.burstTimer = 0;

    return { hit: true, triggeredRecovery: false, recovering: false, shotCount: this.shotCount, windowLeft: this.shotWindowTimer, stunDuration: 0.25 };
  }

  /**
   * Computes a safe spawn location far from the explorer
   * GUARANTEED: Monster will NEVER spawn or teleport into the room the player is currently in!
   */
  getFarSpawnPoint(playerX, playerY, mapManager) {
    const playerRoom = (mapManager && mapManager.getRoomAt) ? mapManager.getRoomAt(playerX, playerY) : null;
    if (mapManager && mapManager.monsterSpawns && mapManager.monsterSpawns.length) {
      // Strictly exclude any candidate spawn point in the player's current room
      const outsidePlayerRoom = mapManager.monsterSpawns.filter(pt => {
        if (!playerRoom) return true;
        const ptRoom = mapManager.getRoomAt(pt.x, pt.y);
        return ptRoom !== playerRoom;
      });

      // Filter by minimum Euclidean distance
      const farCandidates = outsidePlayerRoom.filter(pt => Math.hypot(pt.x - playerX, pt.y - playerY) > 380);
      const pool = farCandidates.length ? farCandidates : (outsidePlayerRoom.length ? outsidePlayerRoom : mapManager.monsterSpawns);
      return pool[Math.floor(Math.random() * pool.length)];
    }
    const points = [
      { x: 760, y: 320 }, { x: 760, y: 510 },
      { x: 1460, y: 320 }, { x: 1460, y: 510 },
      { x: 1800, y: 1200 }, { x: 1600, y: 1000 }
    ];
    const farPoints = points.filter(pt => {
      if (playerRoom && mapManager && mapManager.getRoomAt(pt.x, pt.y) === playerRoom) return false;
      return Math.hypot(pt.x - playerX, pt.y - playerY) > 360;
    });
    const pool = farPoints.length ? farPoints : points;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /**
   * Activates the monster and teleports it to a distant position
   */
  activate(playerX, playerY, reason, audioManager, mapManager, playerAngle = 0) {
    if (this.active && this.alerted) return null;
    
    this.active = true;
    this.alerted = true;
    this.lostTime = 0;
    this.burstTimer = 0;
    this.burstCooldown = 1.8;
    this.slowTimer = 0;
    this.waypoints = [];
    this.waypointTimer = 0;
    this._stuckTimer = 0;
    this._lastX = null;
    this._lastY = null;

    const spawn = this.getFarSpawnPoint(playerX, playerY, mapManager);
    this.x = spawn.x;
    this.y = spawn.y;

    if (audioManager.calculateSpatial) {
      const spatial = audioManager.calculateSpatial(playerX, playerY, playerAngle, this.x, this.y, 800);
      audioManager.playSpatialTone(92, 0.45, 0.18, 'sawtooth', spatial.pan, Math.max(0.4, spatial.distanceGain), spatial.isBehind);
    } else {
      audioManager.playTone(92, 0.35, 0.12, 'sawtooth');
    }
    
    return {
      success: true,
      reason: reason
    };
  }

  /**
   * Process monster intelligence and path tracing
   */
  update(dt, player, noiseLevel, mapManager, audioManager, others) {
    if (!this.active) return null;

    const distance = Math.hypot(this.x - player.x, this.y - player.y);

    this.stagger = Math.max(0, this.stagger - dt);
    this.burstCooldown = Math.max(0, this.burstCooldown - dt);
    this.slowTimer = Math.max(0, this.slowTimer - dt);

    // 10s window timer for 3-shot combo
    if (this.shotWindowTimer > 0) {
      this.shotWindowTimer -= dt;
      if (this.shotWindowTimer <= 0) {
        this.shotCount = 0;
      }
    }

    const result = {
      playerHit: false,
      burstTriggered: false,
      burstFinished: false,
      deaggro: false,
      recovering: false
    };

    // Stunned 10s Recovery State (immobilized, cannot attack or chase)
    if (this.recoverTimer > 0) {
      const prevTimer = this.recoverTimer;
      this.recoverTimer = Math.max(0, this.recoverTimer - dt);
      this.stagger = Math.max(this.stagger, this.recoverTimer);
      result.recovering = true;
      result.recoverTimeLeft = this.recoverTimer;
      if (prevTimer > 0 && this.recoverTimer === 0) {
        result.recovered = true;
      }
      return result;
    }

    const canSense = distance < Config.monster.alertDistance || noiseLevel > Config.monster.triggerNoiseThreshold;

    // De-aggro tracking states
    if (this.alerted && !canSense) {
      this.lostTime += dt;
      if (this.lostTime > Config.monster.alertDeaggroTimeout) {
        this.alerted = false;
        this.lostTime = 0;
        this.waypoints = [];
        this.waypointTimer = 0;
        this._stuckTimer = 0;
        this._lastX = null;
        this._lastY = null;
        result.deaggro = true;
      }
    } else if (this.alerted) {
      this.lostTime = 0;
    }

    // Chasing state machine
    if (this.alerted) {
      const angle = Math.atan2(player.y - this.y, player.x - this.x);
      const nextX = this.x + Math.cos(angle) * Config.monster.speed * dt;
      const nextY = this.y + Math.sin(angle) * Config.monster.speed * dt;
      const crossingWall = mapManager.blocked(nextX, this.y, this.radius) || mapManager.blocked(this.x, nextY, this.radius);

      const monsterSpeed = this.stagger > 0
        ? 0
        : crossingWall
          ? Config.monster.wallChokeSpeed
          : Config.monster.speed;

      this.x += Math.cos(angle) * monsterSpeed * dt;
      this.y += Math.sin(angle) * monsterSpeed * dt;
      this.angle = angle;
    }

    // Patrol roaming when de-aggroed
    if (!this.alerted && this.stagger <= 0) {
      this.patrolAngle += dt * 0.35;
      const patrolX = this.x + Math.cos(this.patrolAngle) * Config.monster.patrolSpeedScale * dt;
      const patrolY = this.y + Math.sin(this.patrolAngle) * Config.monster.patrolSpeedScale * dt;
      if (!mapManager.blocked(patrolX, this.y, this.radius)) this.x = patrolX;
      if (!mapManager.blocked(this.x, patrolY, this.radius)) this.y = patrolY;
    }

    // Separation from hunters — sideways-only so narrow corridors stay passable
    if (others) {
      for (const other of others) {
        if (other === this || !other.active) continue;
        const sdx = this.x - other.x;
        const sdy = this.y - other.y;
        const sd = Math.hypot(sdx, sdy);
        const minSep = this.radius + (other.radius || this.radius) + 2;
        if (sd < minSep && sd > 0.01) {
          const dot = (sdx / sd) * Math.cos(this.angle) + (sdy / sd) * Math.sin(this.angle);
          if (Math.abs(dot) > 0.7) continue;
          const push = (minSep - sd) / sd * 0.3;
          const px = this.x + sdx * push;
          const py = this.y + sdy * push;
          if (!mapManager.blocked(px, this.y, this.radius)) this.x = px;
          if (!mapManager.blocked(this.x, py, this.radius)) this.y = py;
        }
      }
    }

    // Contact / Damage trigger
    if (distance < 28) {
      result.playerHit = true;
      this.alerted = true;
      this.lostTime = 0;

      // Respawn far away
      const spawn = this.getFarSpawnPoint(player.x, player.y, mapManager);
      this.x = spawn.x;
      this.y = spawn.y;
      this.waypoints = [];
      this.waypointTimer = 0;
      this._stuckTimer = 0;
      this._lastX = null;
      this._lastY = null;
    }

    return result;
  }
}

class Hunter {
  constructor(spawnIndex = 0, maxHp = Config.hunter.maxHp) {
    this.spawnIndex = spawnIndex;
    this.maxHp = maxHp;
    this.reset(null, maxHp);
  }

  reset(mapManager, maxHp = this.maxHp || Config.hunter.maxHp) {
    if (mapManager && mapManager.monsterSpawns && mapManager.monsterSpawns.length > this.spawnIndex) {
      const sp = mapManager.monsterSpawns[this.spawnIndex];
      this.x = sp.x; this.y = sp.y;
    } else if (mapManager && mapManager.monsterSpawns && mapManager.monsterSpawns.length > 0) {
      const sp = mapManager.monsterSpawns[Math.floor(Math.random() * mapManager.monsterSpawns.length)];
      this.x = sp.x; this.y = sp.y;
    } else {
      this.x = 800; this.y = 800;
    }
    this.radius = Config.hunter.radius;
    this.active = false;
    this.alerted = false;
    this.dead = false;
    this.deathFade = 0;
    this.maxHp = maxHp;
    this.hp = maxHp;
    this.angle = 0;
    this.lostTime = 0;
    this.patrolAngle = 0;
    this.burstTimer = 0;
    this.burstCooldown = 0;
    this.slowTimer = 0;
    this.stagger = 0;
    // Pathfinding state
    this.waypoints = [];
    this.waypointTimer = 0;
    this.localPath = [];
    this.localRepathTimer = (this.spawnIndex % 10) * 0.1;
    // Stuck detection
    this._stuckTimer = 0;
    this._lastX = null;
    this._lastY = null;
  }

  getFarSpawnPoint(playerX, playerY, mapManager) {
    if (!mapManager.monsterSpawns || !mapManager.monsterSpawns.length) return null;
    const playerRoom = mapManager.getRoomAt(playerX, playerY);
    let candidates = mapManager.monsterSpawns.filter(sp => {
      const spRoom = mapManager.getRoomAt(sp.x, sp.y);
      return spRoom !== playerRoom;
    });
    if (!candidates.length) candidates = mapManager.monsterSpawns;
    const dx = (sp) => sp.x - playerX;
    const dy = (sp) => sp.y - playerY;
    const far = candidates.filter(sp => Math.sqrt(dx(sp)**2 + dy(sp)**2) > 380);
    const pool = far.length ? far : candidates;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  activate(playerX, playerY, reason, audioManager, mapManager, playerAngle) {
    if (this.active || this.dead) return null;
    const sp = this.getFarSpawnPoint(playerX, playerY, mapManager);
    if (sp) { this.x = sp.x; this.y = sp.y; }
    this.active = true;
    this.alerted = true;
    this.deathFade = 0;
    this.burstCooldown = 1.8;
    this.waypoints = [];
    this.waypointTimer = 0;
    this.localPath = [];
    this.localRepathTimer = (this.spawnIndex % 10) * 0.1;
    this._stuckTimer = 0;
    this._lastX = null;
    this._lastY = null;
    if (audioManager) {
      const toHunterAngle = Math.atan2(this.y - playerY, this.x - playerX);
      const pan = Math.sin(toHunterAngle - playerAngle);
      audioManager.playSpatialTone(78, 0.18, 0.9, 'sawtooth', pan, 0.8, false);
    }
    return { activated: true };
  }

  registerHit() {
    if (this.dead || !this.active) return { hit: false };
    this.hp--;
    this.stagger = 0.25;
    this.burstTimer = 0;
    this.localPath = [];
    this.localRepathTimer = 0;
    if (this.hp <= 0) {
      this.dead = true;
      this.active = false;
      this.deathFade = 1;
      return { hit: true, dead: true };
    }
    return { hit: true, dead: false, hpLeft: this.hp };
  }

  update(dt, player, noiseLevel, mapManager, audioManager, others) {
    if (!this.active || this.dead) return null;

    const result = {};
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Timers
    if (this.stagger > 0) this.stagger -= dt;
    if (this.burstTimer > 0) this.burstTimer -= dt;
    if (this.burstCooldown > 0) this.burstCooldown -= dt;
    if (this.slowTimer > 0) this.slowTimer -= dt;

    // Nearby players can be tracked around corners; loud noise still carries beyond visual range
    const canSense = distance < Config.hunter.alertDistance || noiseLevel > Config.hunter.triggerNoiseThreshold;

    if (!this.alerted && canSense) {
      this.alerted = true;
      this.lostTime = 0;
    }

    if (this.alerted) {
      if (canSense) {
        this.lostTime = 0;
      } else {
        this.lostTime += dt;
        if (this.lostTime > Config.hunter.alertDeaggroTimeout) {
          this.alerted = false;
          this.lostTime = 0;
          this.waypoints = [];
          this.waypointTimer = 0;
          this.localPath = [];
          this.localRepathTimer = 0;
          this._stuckTimer = 0;
          this._lastX = null;
          this._lastY = null;
          result.deaggro = true;
        }
      }
    }

    if (this.alerted && this.stagger <= 0) {
      this.localRepathTimer -= dt;
      if (distance <= Config.hunter.alertDistance && this.localRepathTimer <= 0) {
        this.localRepathTimer = 1;
        const hunterRoom = mapManager.getRoomAt(this.x, this.y);
        const playerRoom = mapManager.getRoomAt(player.x, player.y);
        if (hunterRoom && hunterRoom === playerRoom) {
          this.localPath = buildLocalGridPath(
            mapManager,
            this.x,
            this.y,
            player.x,
            player.y,
            this.radius,
            Config.hunter.alertDistance
          );
          this.waypoints = [];
          this.waypointTimer = 0;
        } else {
          this.localPath = [];
        }
      } else if (distance > Config.hunter.alertDistance) {
        this.localPath = [];
        this.localRepathTimer = (this.spawnIndex % 10) * 0.1;
      }

      while (this.localPath.length > 0 &&
             Math.hypot(this.localPath[0].x - this.x, this.localPath[0].y - this.y) < 18) {
        this.localPath.shift();
      }

      const target = this.localPath[0] ||
        getPursuitTarget(this, dt, mapManager, player.x, player.y, Config.hunter.waypointRefresh);

      // Speed
      const speed = this.slowTimer > 0 ? Config.hunter.slowSpeed : Config.hunter.speed;

      moveWithAvoidance(this, mapManager, target.x, target.y, speed, dt);

      // Hard clamp to world bounds (prevents spawning outside map)
      const bpad = this.radius + 12;
      this.x = Math.max(bpad, Math.min(Config.WORLD_W - bpad, this.x));
      this.y = Math.max(bpad, Math.min(Config.WORLD_H - bpad, this.y));

      recoverStuckPursuer(this, dt, mapManager);

      // Contact damage
      if (distance < 28) {
        result.playerHit = true;
        const sp = this.getFarSpawnPoint(player.x, player.y, mapManager);
        if (sp) { this.x = sp.x; this.y = sp.y; }
        this.waypoints = [];
        this.waypointTimer = 0;
        this.localPath = [];
        this.localRepathTimer = 0;
        this._stuckTimer = 0;
        this._lastX = null;
        this._lastY = null;
      }

    } else if (!this.alerted && this.stagger <= 0) {
      // Patrol: spiral pattern with wall sliding
      this.patrolAngle += dt * 0.35;
      const patrolX = this.x + Math.cos(this.patrolAngle) * Config.hunter.patrolSpeedScale * dt;
      const patrolY = this.y + Math.sin(this.patrolAngle) * Config.hunter.patrolSpeedScale * dt;
      if (!mapManager.blocked(patrolX, this.y, this.radius)) this.x = patrolX;
      if (!mapManager.blocked(this.x, patrolY, this.radius)) this.y = patrolY;
    }

    // Separation: only push sideways relative to travel direction so corridor queues flow through
    if (others) {
      for (const other of others) {
        if (other === this || !other.active) continue;
        const sdx = this.x - other.x;
        const sdy = this.y - other.y;
        const sd = Math.hypot(sdx, sdy);
        const minSep = this.radius + (other.radius || this.radius) + 2;
        if (sd < minSep && sd > 0.01) {
          // Dot product along my travel direction — skip if mostly ahead/behind (corridor case)
          const dot = (sdx / sd) * Math.cos(this.angle) + (sdy / sd) * Math.sin(this.angle);
          if (Math.abs(dot) > 0.7) continue;
          const push = (minSep - sd) / sd * 0.3;
          const px = this.x + sdx * push;
          const py = this.y + sdy * push;
          if (!mapManager.blocked(px, this.y, this.radius)) this.x = px;
          if (!mapManager.blocked(this.x, py, this.radius)) this.y = py;
        }
      }
    }

    return result;
  }
}
