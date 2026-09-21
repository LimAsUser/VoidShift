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
  reset(mapManager) {
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
    this.ammo = Config.player.maxAmmo;
    this.reserveAmmo = Config.player.maxReserveAmmo;
    this.shootCooldown = 0;
    this.reloading = 0;
    this.moveSpeed = 0;
    this.stunned = 0; // Stun duration timer in seconds
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
        const needed = Config.player.maxAmmo - this.ammo;
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
    if (this.stunned > 0 || this.reloading > 0 || this.ammo === Config.player.maxAmmo || this.reserveAmmo <= 0) {
      return false;
    }
    this.reloading = Config.player.reloadDuration;
    audioManager.playSound('resources/dragon-studio-gun-reload-2-511308.mp3', 0.5);
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
    this.shootCooldown = Config.player.shootCooldownDuration;
    this.noise = Math.min(100, this.noise + 24);
    audioManager.playSound('resources/u_62htdrvg4y-gun-shot-359196.mp3', 0.3);

    // Calculate spread. Aiming has no spread. Not aiming has a massive random spread.
    const maxSpread = stabilized ? 0.01 : 0.38; // 0.38 radians is ~22 degrees of spread!
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
  update(dt, player, noiseLevel, mapManager, audioManager) {
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
        result.deaggro = true;
      }
    } else if (this.alerted) {
      this.lostTime = 0;
    }

    // Chasing state machine
    if (this.alerted && (distance < 300 || noiseLevel > Config.monster.triggerNoiseThreshold)) {
      // Triggers transient speed burst acceleration at intermediate bounds
      if (this.burstTimer <= 0 && this.burstCooldown <= 0 && this.slowTimer <= 0 && distance > 105 && distance < 430) {
        this.burstTimer = Config.monster.burstDuration;
        this.burstCooldown = Config.monster.burstCooldownDuration;
        result.burstTriggered = true;
        if (audioManager.calculateSpatial) {
          const spatial = audioManager.calculateSpatial(player.x, player.y, player.angle, this.x, this.y, 650);
          audioManager.playSpatialTone(180, 0.22, 0.22, 'sawtooth', spatial.pan, Math.max(0.4, spatial.distanceGain), spatial.isBehind);
        } else {
          audioManager.playTone(180, 0.16, 0.14, 'sawtooth');
        }
      }

      const angle = Math.atan2(player.y - this.y, player.x - this.x);
      const nextX = this.x + Math.cos(angle) * Config.monster.speed * dt;
      const nextY = this.y + Math.sin(angle) * Config.monster.speed * dt;
      const crossingWall = mapManager.blocked(nextX, this.y, this.radius) || mapManager.blocked(this.x, nextY, this.radius);

      const monsterSpeed = this.stagger > 0 
        ? 0 
        : this.burstTimer > 0 
          ? Config.monster.burstSpeed 
          : this.slowTimer > 0 
            ? Config.monster.slowSpeed 
            : crossingWall 
              ? Config.monster.wallChokeSpeed 
              : Config.monster.speed;

      this.x += Math.cos(angle) * monsterSpeed * dt;
      this.y += Math.sin(angle) * monsterSpeed * dt;
      this.angle = angle;

      if (this.burstTimer > 0) {
        this.burstTimer = Math.max(0, this.burstTimer - dt);
        if (this.burstTimer === 0) {
          this.slowTimer = Config.monster.burstSlowDuration;
          result.burstFinished = true;
        }
      }
    }

    // Patrol roaming when de-aggroed
    if (!this.alerted && this.stagger <= 0) {
      this.patrolAngle += dt * 0.35;
      const patrolX = this.x + Math.cos(this.patrolAngle) * Config.monster.patrolSpeedScale * dt;
      const patrolY = this.y + Math.sin(this.patrolAngle) * Config.monster.patrolSpeedScale * dt;
      if (!mapManager.blocked(patrolX, this.y, this.radius)) this.x = patrolX;
      if (!mapManager.blocked(this.x, patrolY, this.radius)) this.y = patrolY;
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
    }

    return result;
  }
}

class Hunter {
  constructor(spawnIndex = 0) {
    this.spawnIndex = spawnIndex;
    this.reset();
  }

  reset(mapManager) {
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
    this.hp = Config.hunter.maxHp;
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
    this.alerted = false;
    this.burstCooldown = 1.8;
    this.waypoints = [];
    this.waypointTimer = 0;
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
    if (this.hp <= 0) {
      this.dead = true;
      this.active = false;
      return { hit: true, dead: true };
    }
    return { hit: true, dead: false, hpLeft: this.hp };
  }

  _buildWaypoints(mapManager, playerX, playerY) {
    const hunterRoom = mapManager.getRoomAt(this.x, this.y);
    const playerRoom = mapManager.getRoomAt(playerX, playerY);
    if (!hunterRoom || !playerRoom) {
      this.waypoints = [{ x: playerX, y: playerY, isDoor: false, door: null }];
      return;
    }
    const path = bfsRoomPath(hunterRoom, playerRoom);
    this.waypoints = [];
    for (const step of path) {
      const door = step.door;
      const mx = door.p1 ? (door.p1.x + door.p2.x) / 2 : (door.x + door.w / 2);
      const my = door.p1 ? (door.p1.y + door.p2.y) / 2 : (door.y + door.h / 2);
      // Only door midpoints — skip room centers (l_shape/triangle centers can be inside walls)
      this.waypoints.push({ x: mx, y: my, isDoor: true, door });
    }
    // Final target: player position
    this.waypoints.push({ x: playerX, y: playerY, isDoor: false, door: null });
  }

  update(dt, player, noiseLevel, mapManager, audioManager) {
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

    // Detection
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
          result.deaggro = true;
        }
      }
    }

    if (this.alerted && this.stagger <= 0) {
      // Repath timer
      this.waypointTimer -= dt;
      if (this.waypointTimer <= 0 || this.waypoints.length === 0) {
        this.waypointTimer = Config.hunter.waypointRefresh;
        this._buildWaypoints(mapManager, player.x, player.y);
      }

      // Pre-open closed doors before physically reaching them
      // blocked() stops movement at ~23px from a closed door segment, so open at 50px
      if (this.waypoints.length > 0) {
        const wp0 = this.waypoints[0];
        if (wp0.isDoor && wp0.door && !wp0.door.open) {
          const d0 = Math.sqrt((wp0.x - this.x) ** 2 + (wp0.y - this.y) ** 2);
          if (d0 < 50) mapManager.toggleDoor(wp0.door, this.x, this.y);
        }
      }

      // Advance past waypoints we've reached (30px threshold)
      while (this.waypoints.length > 0) {
        const wp = this.waypoints[0];
        const wpDist = Math.sqrt((wp.x - this.x) ** 2 + (wp.y - this.y) ** 2);
        if (wpDist < 30) {
          this.waypoints.shift();
        } else {
          break;
        }
      }

      // Get move target
      let targetX = player.x;
      let targetY = player.y;
      if (this.waypoints.length > 0) {
        targetX = this.waypoints[0].x;
        targetY = this.waypoints[0].y;
      }

      // Burst trigger
      if (this.burstTimer <= 0 && this.burstCooldown <= 0 && distance > 105 && distance < 430) {
        this.burstTimer = Config.hunter.burstDuration;
        this.burstCooldown = Config.hunter.burstCooldownDuration;
        this.slowTimer = 0;
        result.burstTriggered = true;
      }

      // Speed
      let speed = Config.hunter.speed;
      if (this.burstTimer > 0) speed = Config.hunter.burstSpeed;
      else if (this.slowTimer > 0) speed = Config.hunter.slowSpeed;

      // Move toward target using axis-separated sliding (NO wall phasing)
      const moveAngle = Math.atan2(targetY - this.y, targetX - this.x);
      this.angle = moveAngle;
      const nx = this.x + Math.cos(moveAngle) * speed * dt;
      const ny = this.y + Math.sin(moveAngle) * speed * dt;
      if (!mapManager.blocked(nx, this.y, this.radius)) this.x = nx;
      if (!mapManager.blocked(this.x, ny, this.radius)) this.y = ny;

      // Hard clamp to world bounds (prevents spawning outside map)
      const bpad = this.radius + 12;
      this.x = Math.max(bpad, Math.min(Config.WORLD_W - bpad, this.x));
      this.y = Math.max(bpad, Math.min(Config.WORLD_H - bpad, this.y));

      // Stuck detection: if barely moved in 2s, force repath
      if (this._lastX === null) { this._lastX = this.x; this._lastY = this.y; }
      const moved = Math.hypot(this.x - this._lastX, this.y - this._lastY);
      if (moved > 8) {
        this._lastX = this.x; this._lastY = this.y; this._stuckTimer = 0;
      } else {
        this._stuckTimer += dt;
        if (this._stuckTimer > 2.0) {
          this.waypoints = [];
          this.waypointTimer = 0;
          this._stuckTimer = 0;
          this._lastX = null;
        }
      }

      // Contact damage
      if (distance < 28) {
        result.playerHit = true;
        const sp = this.getFarSpawnPoint(player.x, player.y, mapManager);
        if (sp) { this.x = sp.x; this.y = sp.y; }
        this.waypoints = [];
        this.waypointTimer = 0;
        this._lastX = null;
      }

    } else if (!this.alerted && this.stagger <= 0) {
      // Patrol: spiral pattern with wall sliding
      this.patrolAngle += dt * 0.35;
      const patrolX = this.x + Math.cos(this.patrolAngle) * Config.hunter.patrolSpeedScale * dt;
      const patrolY = this.y + Math.sin(this.patrolAngle) * Config.hunter.patrolSpeedScale * dt;
      if (!mapManager.blocked(patrolX, this.y, this.radius)) this.x = patrolX;
      if (!mapManager.blocked(this.x, patrolY, this.radius)) this.y = patrolY;
    }

    return result;
  }
}
