/**
 * VOID SHIFT // RECOVERY OPERATIONS PROTOCOL
 * Entities Module (Player & Monster State Management)
 */

class Player {
  constructor() {
    this.reset();
  }

  static createDefaultArmory() {
    const weaponAmmo = {};
    Object.keys(Config.weapons).forEach(weaponId => {
      weaponAmmo[weaponId] = { magazine: 0, reserve: 0 };
    });
    weaponAmmo.pistol = { magazine: Config.weapons.pistol.maxAmmo, reserve: 120 };
    return {
      ownedWeapons: { pistol: true, smg: false, shotgun: false, revolver: false },
      loadout: { primary: null, sidearm: 'pistol' },
      activeSlot: 'sidearm',
      weaponAmmo,
      standardAmmoUnits: 0
    };
  }

  static normalizeArmory(data = null) {
    const defaults = Player.createDefaultArmory();
    if (!data || typeof data !== 'object') return defaults;
    const ownedWeapons = { ...defaults.ownedWeapons };
    for (const weaponId of Object.keys(Config.weapons)) {
      if (typeof data.ownedWeapons?.[weaponId] === 'boolean') {
        ownedWeapons[weaponId] = data.ownedWeapons[weaponId];
      }
    }
    ownedWeapons.pistol = true;

    const loadout = { primary: null, sidearm: 'pistol' };
    const primary = Config.weapons[data.loadout?.primary];
    const sidearm = Config.weapons[data.loadout?.sidearm];
    if (primary && primary.slot === 'primary' && ownedWeapons[primary.id]) loadout.primary = primary.id;
    if (sidearm && sidearm.slot === 'sidearm' && ownedWeapons[sidearm.id]) loadout.sidearm = sidearm.id;

    const weaponAmmo = {};
    for (const weaponId of Object.keys(Config.weapons)) {
      const saved = data.weaponAmmo?.[weaponId] || {};
      const defaultState = defaults.weaponAmmo[weaponId];
      const magazine = Number(saved.magazine);
      const reserve = Number(saved.reserve);
      weaponAmmo[weaponId] = ownedWeapons[weaponId]
        ? {
            magazine: Number.isFinite(magazine) ? Math.max(0, Math.min(Config.weapons[weaponId].maxAmmo, Math.floor(magazine))) : defaultState.magazine,
            reserve: Number.isFinite(reserve) ? Math.max(0, Math.floor(reserve)) : defaultState.reserve
          }
        : { magazine: 0, reserve: 0 };
    }

    const standardAmmoUnits = Number(data.standardAmmoUnits);
    const activeSlot = data.activeSlot === 'primary' && loadout.primary
      ? 'primary'
      : data.activeSlot === 'sidearm' ? 'sidearm' : loadout.primary ? 'primary' : 'sidearm';
    return {
      ownedWeapons,
      loadout,
      activeSlot,
      weaponAmmo,
      standardAmmoUnits: Number.isFinite(standardAmmoUnits) ? Math.max(0, Math.floor(standardAmmoUnits)) : 0
    };
  }

  /**
   * Resets player telemetry and position
   */
  reset(mapManager, armory = null, activeSlot = null) {
    this.x = (mapManager && mapManager.spawnPoint) ? mapManager.spawnPoint.x : Config.player.spawnX;
    this.y = (mapManager && mapManager.spawnPoint) ? mapManager.spawnPoint.y : Config.player.spawnY;
    this.radius = Config.player.radius;
    this.baseSpeed = Config.player.speed;
    this.angle = 0;
    
    // Telemetry stats
    this.oxygen = 100;
    this.health = 100;
    this.stamina = 100;
    this.staminaLocked = false;
    this.staminaRegenDelay = 0;
    this.noise = 0;

    this.flashlight = true;
    this.configureArmory(armory || this.armory || Player.createDefaultArmory(), activeSlot);
    this.weaponTimers = Object.fromEntries(Object.keys(Config.weapons).map(weaponId => [weaponId, {
      shootCooldown: 0, reloadTimer: 0, reloadMode: null
    }]));
    this.moveSpeed = 0;
    this.dodgeTimer = 0;
    this.dodgeDirectionX = 0;
    this.dodgeDirectionY = 0;
    this.invulnerableThisFrame = false;
    this.meleeCooldown = 0;
    this.meleeVisualTimer = 0;
    this.stunned = 0; // Stun duration timer in seconds
    this.downed = false;
    this.bleedout = 0;
    this.reviveProgress = 0;
  }

  configureArmory(armory, activeSlot = null) {
    this.armory = Player.normalizeArmory(armory);
    const selectedSlot = activeSlot || this.armory.activeSlot || (this.armory.loadout.primary ? 'primary' : 'sidearm');
    this.activeSlot = selectedSlot === 'primary' && this.armory.loadout.primary ? 'primary' : 'sidearm';
    this.armory.activeSlot = this.activeSlot;
  }

  exportArmory() {
    return {
      ownedWeapons: { ...this.armory.ownedWeapons },
      loadout: { ...this.armory.loadout },
      activeSlot: this.activeSlot,
      weaponAmmo: Object.fromEntries(Object.entries(this.armory.weaponAmmo).map(([weaponId, stock]) => [weaponId, { ...stock }])),
      standardAmmoUnits: this.armory.standardAmmoUnits
    };
  }

  get weaponId() {
    return this.armory.loadout[this.activeSlot] || this.armory.loadout.sidearm || 'pistol';
  }

  get weapon() {
    return Config.weapons[this.weaponId] || Config.weapons.pistol;
  }

  get weaponState() {
    return this.armory.weaponAmmo[this.weaponId];
  }

  get weaponTimer() {
    return this.weaponTimers[this.weaponId];
  }

  get ammo() { return this.weaponState.magazine; }
  set ammo(value) { this.weaponState.magazine = Math.max(0, Math.min(this.weapon.maxAmmo, Math.floor(Number(value) || 0))); }
  get reserveAmmo() { return this.weaponState.reserve; }
  set reserveAmmo(value) { this.weaponState.reserve = Math.max(0, Math.floor(Number(value) || 0)); }
  get shootCooldown() { return this.weaponTimer.shootCooldown; }
  set shootCooldown(value) { this.weaponTimer.shootCooldown = Math.max(0, Number(value) || 0); }
  get reloading() { return this.weaponTimer.reloadTimer; }
  set reloading(value) {
    this.weaponTimer.reloadTimer = Math.max(0, Number(value) || 0);
    if (this.weaponTimer.reloadTimer === 0) this.weaponTimer.reloadMode = null;
  }
  get invulnerable() { return this.dodgeTimer > 0 || this.invulnerableThisFrame; }

  switchWeaponSlot(slot) {
    if (!['primary', 'sidearm'].includes(slot) || !this.armory.loadout[slot] || this.activeSlot === slot) return false;
    this.cancelReload(this.weaponId);
    this.activeSlot = slot;
    this.armory.activeSlot = slot;
    return true;
  }

  setWeapon(weaponId) {
    const weapon = Config.weapons[weaponId];
    if (!weapon || !this.armory.ownedWeapons[weaponId]) return false;
    return this.equipWeapon(weapon.slot, weaponId);
  }

  equipWeapon(slot, weaponId) {
    const weapon = Config.weapons[weaponId];
    if (!weapon || weapon.slot !== slot || !this.armory.ownedWeapons[weaponId]) return false;
    if (this.armory.loadout[slot] === weaponId) return true;
    if (this.activeSlot === slot) this.cancelReload(this.weaponId);
    this.armory.loadout[slot] = weaponId;
    return true;
  }

  unlockWeapon(weaponId) {
    const weapon = Config.weapons[weaponId];
    if (!weapon || weaponId === 'pistol' || this.armory.ownedWeapons[weaponId]) return false;
    this.armory.ownedWeapons[weaponId] = true;
    this.armory.weaponAmmo[weaponId] = {
      magazine: weapon.maxAmmo,
      reserve: weapon.initialReserve
    };
    this.weaponTimers[weaponId] = { shootCooldown: 0, reloadTimer: 0, reloadMode: null };
    return true;
  }

  cancelReload(weaponId = this.weaponId) {
    const timer = this.weaponTimers[weaponId];
    if (!timer || timer.reloadTimer <= 0) return false;
    timer.reloadTimer = 0;
    timer.reloadMode = null;
    return true;
  }

  consumeStamina(amount) {
    if (this.staminaLocked || this.downed || this.stunned > 0 || this.stamina < amount) return false;
    this.stamina = Math.max(0, this.stamina - amount);
    this.staminaRegenDelay = Config.player.staminaRegenDelay;
    if (this.stamina === 0) this.staminaLocked = true;
    return true;
  }

  startRoll(dx, dy) {
    const length = Math.hypot(dx, dy);
    if (this.dodgeTimer > 0 || this.downed || this.stunned > 0 || length === 0 ||
        this.stamina <= 0 || !this.consumeStamina(Math.min(Config.player.dodgeStaminaCost, this.stamina))) return false;
    this.dodgeDirectionX = dx / length;
    this.dodgeDirectionY = dy / length;
    this.dodgeTimer = Config.player.dodgeDuration;
    this.invulnerableThisFrame = true;
    return true;
  }

  startMelee() {
    if (this.meleeCooldown > 0 || this.dodgeTimer > 0 ||
        !this.consumeStamina(Config.player.meleeStaminaCost)) return false;
    this.meleeCooldown = Config.player.meleeCooldown;
    this.meleeVisualTimer = 0.22;
    return true;
  }

  /**
   * Updates player cooldowns, reloading state and movement
   */
  update(dt, keys, stabilized, mapManager, audioManager) {
    if (this.stamina <= 0) this.staminaLocked = true;
    else if (this.stamina >= 100) this.staminaLocked = false;
    this.staminaRegenDelay = Math.max(0, this.staminaRegenDelay - dt);
    this.shootCooldown = Math.max(0, this.shootCooldown - dt);
    this.meleeCooldown = Math.max(0, this.meleeCooldown - dt);
    this.meleeVisualTimer = Math.max(0, this.meleeVisualTimer - dt);
    this.invulnerableThisFrame = false;

    const prevStunned = this.stunned;
    if (this.stunned > 0) {
      this.stunned = Math.max(0, this.stunned - dt);
    }

    const updateResult = {
      reloaded: false,
      shellLoaded: false,
      rollFinished: false,
      stunned: this.stunned > 0,
      stunTimeLeft: this.stunned,
      stunRecovered: (prevStunned > 0 && this.stunned === 0)
    };

    if (this.downed || this.stunned > 0) {
      this.moveSpeed = 0;
      this.noise = Math.max(0, this.noise - Config.player.noiseDecayStill * dt);
      return updateResult;
    }

    if (this.dodgeTimer > 0) {
      const rollDt = Math.min(dt, this.dodgeTimer);
      this.invulnerableThisFrame = rollDt > 0;
      const distance = Config.player.dodgeDistance * rollDt / Config.player.dodgeDuration;
      const nextX = this.x + this.dodgeDirectionX * distance;
      const nextY = this.y + this.dodgeDirectionY * distance;
      if (!mapManager.blocked(nextX, this.y, this.radius)) this.x = nextX;
      if (!mapManager.blocked(this.x, nextY, this.radius)) this.y = nextY;
      this.moveSpeed = Config.player.dodgeDistance / Config.player.dodgeDuration;
      this.dodgeTimer = Math.max(0, this.dodgeTimer - dt);
      if (this.dodgeTimer === 0) {
        this.moveSpeed = 0;
        updateResult.rollFinished = true;
      }
      return updateResult;
    }

    this._updateReload(dt, updateResult);
    this.move(dt, keys, stabilized, mapManager, audioManager);

    return updateResult;
  }

  _updateReload(dt, updateResult) {
    const timer = this.weaponTimer;
    if (timer.reloadTimer <= 0) return;
    timer.reloadTimer = Math.max(0, timer.reloadTimer - dt);
    if (timer.reloadTimer > 0) return;

    if (timer.reloadMode === 'shell') {
      if (this.ammo < this.weapon.maxAmmo && this.reserveAmmo > 0) {
        this.ammo += 1;
        this.reserveAmmo -= 1;
        updateResult.shellLoaded = true;
      }
      if (this.ammo < this.weapon.maxAmmo && this.reserveAmmo > 0) {
        timer.reloadTimer = this.weapon.reloadDuration;
      } else {
        timer.reloadTimer = 0;
        timer.reloadMode = null;
        updateResult.reloaded = true;
      }
      return;
    }

    const loaded = Math.min(this.weapon.maxAmmo - this.ammo, this.reserveAmmo);
    this.ammo += loaded;
    this.reserveAmmo -= loaded;
    timer.reloadTimer = 0;
    timer.reloadMode = null;
    updateResult.reloaded = true;
  }

  /**
   * Handles user-driven translation movement and physics collisions
   */
  move(dt, keys, stabilized, mapManager, audioManager) {
    let dx = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
    let dy = (keys.s ? 1 : 0) - (keys.w ? 1 : 0);
    const moving = Boolean(dx || dy);
    const running = moving && keys.shift && !stabilized && !this.staminaLocked && this.stamina > 1;
    const speed = stabilized ? this.baseSpeed * 0.55 : running ? Config.player.sprintSpeed : this.baseSpeed;

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

      const targetMaxNoise = running
        ? Config.player.sprintNoiseCap
        : stabilized ? Config.player.stabilizedNoiseCap : Config.player.walkNoiseCap;
      if (this.noise < targetMaxNoise) {
        const noiseGain = running ? Config.player.sprintNoiseGain : 35;
        this.noise = Math.min(targetMaxNoise, this.noise + noiseGain * dt);
      } else {
        this.noise = Math.max(targetMaxNoise, this.noise - Config.player.noiseDecayMoving * dt);
      }

      if (running) {
        this.stamina = Math.max(0, this.stamina - 30 * dt);
        this.staminaRegenDelay = Config.player.staminaRegenDelay;
        if (this.stamina === 0) this.staminaLocked = true;
      } else if (this.staminaRegenDelay <= 0) {
        this.stamina = Math.min(100, this.stamina + 16 * dt);
        if (this.staminaLocked && this.stamina >= 100) this.staminaLocked = false;
      }

      // Play moving footsteps sound effects
      const stepInterval = running ? 260 : 440;
      if (audioManager.context && performance.now() - audioManager.lastStep > stepInterval) {
        audioManager.lastStep = performance.now();
        audioManager.playTone(running ? 78 : 62, 0.055, running ? 0.045 : 0.025, 'triangle');
      }
    } else {
      this.noise = Math.max(0, this.noise - Config.player.noiseDecayStill * dt);
      if (this.staminaRegenDelay <= 0) {
        this.stamina = Math.min(100, this.stamina + 22 * dt);
        if (this.staminaLocked && this.stamina >= 100) this.staminaLocked = false;
      }
    }
  }

  /**
   * Triggers a weapon reload sequence
   */
  reload(audioManager) {
    if (!this.weaponId || this.stunned > 0 || this.dodgeTimer > 0 || this.reloading > 0 || this.ammo >= this.weapon.maxAmmo || this.reserveAmmo <= 0) {
      return false;
    }
    this.weaponTimer.reloadTimer = this.weapon.reloadDuration;
    this.weaponTimer.reloadMode = this.weapon.reloadMode;
    if (audioManager?.playSound) audioManager.playSound('resources/gun-reload-2-511308.mp3', 0.5);
    return true;
  }

  /**
   * Fires the hand weapon and resolves line of sight targeting
   */
  shoot(stabilized, mapManager, audioManager, monster) {
    if (!this.weaponId) return { fired: false, reason: 'unarmed' };
    if (this.stunned > 0) {
      return { fired: false, reason: 'stunned' };
    }
    let reloadInterrupted = false;
    if (this.reloading > 0) {
      if (this.weapon.reloadMode !== 'shell' || this.ammo <= 0) return { fired: false, reason: 'reloading' };
      this.cancelReload();
      reloadInterrupted = true;
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
    if (audioManager?.playSound) audioManager.playSound('resources/gun-shot-359196.mp3', 0.3);

    let shotAngles;
    if (this.weapon.pelletCount > 1) {
      const coneDegrees = stabilized ? this.weapon.aimSpreadDegrees : this.weapon.hipSpreadDegrees;
      const halfCone = coneDegrees * Math.PI / 360;
      shotAngles = Array.from({ length: this.weapon.pelletCount }, (_, index) =>
        this.angle - halfCone + (2 * halfCone * index) / (this.weapon.pelletCount - 1)
      );
    } else {
      const maxSpread = stabilized ? this.weapon.aimSpread : this.weapon.hipSpread;
      shotAngles = [this.angle + (Math.random() - 0.5) * 2 * maxSpread];
    }
    const shotAngle = shotAngles.length === 1 ? shotAngles[0] : this.angle;

    const result = {
      fired: true,
      ammo: this.ammo,
      weaponId: this.weaponId,
      shotAngle,
      shotAngles,
      reloadInterrupted
    };
    return result;
  }
}

const PURSUIT_PROBE_OFFSETS = [0, Math.PI / 6, -Math.PI / 6, Math.PI / 3, -Math.PI / 3, Math.PI / 2, -Math.PI / 2, 2 * Math.PI / 3, -2 * Math.PI / 3];

function isPointLitByPlayer(x, y, player, mapManager) {
  if (!player || player.downed || !player.flashlight) return false;
  const dx = x - player.x;
  const dy = y - player.y;
  const distance = Math.hypot(dx, dy);
  if (distance > Config.player.flashlightRange) return false;

  const angle = Math.atan2(dy, dx);
  const angleDifference = Math.abs(Math.atan2(
    Math.sin(angle - player.angle),
    Math.cos(angle - player.angle)
  ));
  if (angleDifference > Config.player.flashlightSpread) return false;

  const visibleDistance = mapManager.rayVisionDistance
    ? mapManager.rayVisionDistance(
      player.x,
      player.y,
      Math.cos(angle),
      Math.sin(angle),
      Config.player.flashlightRange,
      13
    )
    : mapManager.rayWallDistance(
      player.x,
      player.y,
      Math.cos(angle),
      Math.sin(angle),
      Config.player.flashlightRange
    );
  return distance <= visibleDistance;
}

function isPointLitByAnyPlayer(x, y, players, mapManager) {
  return (players || []).some(player => isPointLitByPlayer(x, y, player, mapManager));
}

function getNavigationRoom(mapManager, x, y) {
  const rooms = mapManager.worldRooms || [];
  const containingRooms = rooms.filter(room => {
    if (room.vertices && room.vertices.length) return pointInPolygon(x, y, room.vertices);
    return x >= room.x && x < room.x + room.w && y >= room.y && y < room.y + room.h;
  });
  const candidates = containingRooms.length ? containingRooms : rooms;
  let closest = null;
  let closestDistance = Infinity;
  for (const room of candidates) {
    const distance = Math.hypot(room.center.x - x, room.center.y - y);
    if (distance < closestDistance) {
      closest = room;
      closestDistance = distance;
    }
  }
  return closest || mapManager.getRoomAt(x, y);
}

function getDoorExitPoint(mapManager, centerX, centerY, room, radius, directionX, directionY) {
  const directionLength = Math.max(1, Math.hypot(directionX, directionY));
  const maxDistance = 220;

  for (let distance = radius + 18; distance <= maxDistance; distance += 12) {
    const x = centerX + directionX / directionLength * distance;
    const y = centerY + directionY / directionLength * distance;
    if (!mapManager.blocked(x, y, radius) && getNavigationRoom(mapManager, x, y) === room) {
      return { x, y };
    }
  }

  return mapManager._findSafeRoomPoint ? mapManager._findSafeRoomPoint(room) : room.center;
}

function buildPursuitWaypoints(mapManager, fromX, fromY, targetX, targetY, radius = 15) {
  const fromRoom = getNavigationRoom(mapManager, fromX, fromY);
  const targetRoom = getNavigationRoom(mapManager, targetX, targetY);
  const waypoints = [];

  if (fromRoom && targetRoom) {
    let routeRoom = fromRoom;
    let routeX = fromX;
    let routeY = fromY;
    for (const step of bfsRoomPath(fromRoom, targetRoom)) {
      const door = step.door;
      const centerX = door.p1 ? (door.p1.x + door.p2.x) / 2 : door.x + door.w / 2;
      const centerY = door.p1 ? (door.p1.y + door.p2.y) / 2 : door.y + door.h / 2;
      const normal = door.normal || (door.axis === 'v' ? { x: 1, y: 0 } : { x: 0, y: 1 });
      const direction = step.room === door.roomB ? normal : { x: -normal.x, y: -normal.y };
      const entryPoint = getDoorExitPoint(
        mapManager,
        centerX,
        centerY,
        routeRoom,
        radius,
        -direction.x,
        -direction.y
      );
      const exitPoint = getDoorExitPoint(
        mapManager,
        centerX,
        centerY,
        step.room,
        radius,
        direction.x,
        direction.y
      );
      const approachDistance = Math.hypot(entryPoint.x - routeX, entryPoint.y - routeY);
      const approachPath = buildLocalGridPath(
        mapManager,
        routeX,
        routeY,
        entryPoint.x,
        entryPoint.y,
        radius,
        approachDistance + 140
      );
      for (const point of approachPath.slice(0, -1)) {
        waypoints.push({
          x: point.x,
          y: point.y,
          isDoorApproach: true,
          door,
          room: routeRoom
        });
      }
      waypoints.push({
        x: entryPoint.x,
        y: entryPoint.y,
        isDoorEntry: true,
        door,
        room: routeRoom
      });
      waypoints.push({
        x: centerX,
        y: centerY,
        isDoor: true,
        door,
        room: step.room
      });
      waypoints.push({
        x: exitPoint.x,
        y: exitPoint.y,
        isDoorExit: true,
        door,
        room: step.room
      });
      routeRoom = step.room;
      routeX = exitPoint.x;
      routeY = exitPoint.y;
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
  const currentWaypoint = entity.waypoints[0];
  const traversingDoor = currentWaypoint &&
    (currentWaypoint.isDoorApproach || currentWaypoint.isDoorEntry ||
      currentWaypoint.isDoor || currentWaypoint.isDoorExit);
  if (entity.waypoints.length === 0 || (entity.waypointTimer <= 0 && !traversingDoor)) {
    entity.waypointTimer = refreshInterval;
    entity.waypoints = buildPursuitWaypoints(mapManager, entity.x, entity.y, targetX, targetY, entity.radius);
  }

  const first = entity.waypoints[0];
  if (first && (first.isDoorEntry || first.isDoor || first.isDoorExit) && first.door && !first.door.open) {
    if (Math.hypot(first.x - entity.x, first.y - entity.y) < 60) {
      mapManager.toggleDoor(first.door, entity.x, entity.y);
    }
  }

  while (entity.waypoints.length > 0) {
    const waypoint = entity.waypoints[0];
    const completionDistance = waypoint.isDoor ? 10 :
      waypoint.isDoorApproach ? 18 :
        (waypoint.isDoorEntry || waypoint.isDoorExit) ? 16 : 30;
    const distance = Math.hypot(waypoint.x - entity.x, waypoint.y - entity.y);
    const enteredTargetRoom = !waypoint.isDoorExit ||
      getNavigationRoom(mapManager, entity.x, entity.y) === waypoint.room;
    if (distance >= completionDistance || !enteredTargetRoom) break;
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
    return;
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

function updatePatrol(entity, dt, mapManager, speed, refreshInterval) {
  const reachedTarget = entity.patrolTarget &&
    Math.hypot(entity.patrolTarget.x - entity.x, entity.patrolTarget.y - entity.y) < 30;

  if (!entity.patrolTarget || reachedTarget) {
    const currentRoom = getNavigationRoom(mapManager, entity.x, entity.y);
    const allPoints = mapManager.monsterSpawns || [];
    let candidates = allPoints.filter(point => {
      const pointRoom = getNavigationRoom(mapManager, point.x, point.y);
      return pointRoom !== currentRoom && Math.hypot(point.x - entity.x, point.y - entity.y) > 80;
    });
    if (!candidates.length) {
      candidates = allPoints.filter(point => Math.hypot(point.x - entity.x, point.y - entity.y) > 80);
    }
    if (!candidates.length) return;

    const random = mapManager.random ? mapManager.random() : Math.random();
    const target = candidates[Math.floor(random * candidates.length)];
    entity.patrolTarget = { x: target.x, y: target.y };
    entity.waypoints = [];
    entity.waypointTimer = 0;
  }

  const target = getPursuitTarget(
    entity,
    dt,
    mapManager,
    entity.patrolTarget.x,
    entity.patrolTarget.y,
    refreshInterval
  );
  moveWithAvoidance(entity, mapManager, target.x, target.y, speed, dt);
  recoverStuckPursuer(entity, dt, mapManager);
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
    this.recoverTimer = 0;
    this.waypoints = [];
    this.waypointTimer = 0;
    this.patrolTarget = null;
    this._stuckTimer = 0;
    this._lastX = null;
    this._lastY = null;
  }

  /**
   * Registers bullet hit from player.
   * Every fifth accumulated hit triggers a 10-second stunned recovery.
   */
  registerHit() {
    if (this.recoverTimer > 0) {
      return { hit: true, triggeredRecovery: false, recovering: true };
    }

    this.shotCount++;

    if (this.shotCount >= Config.monster.recoveryHits) {
      this.recoverTimer = Config.monster.recoveryDuration;
      this.stagger = Config.monster.recoveryDuration;
      this.shotCount = 0;
      return { hit: true, triggeredRecovery: true, recovering: true, shotCount: Config.monster.recoveryHits };
    }

    this.stagger = Config.monster.hitStagger;
    this.burstTimer = 0;

    return { hit: true, triggeredRecovery: false, recovering: false, shotCount: this.shotCount, stunDuration: Config.monster.hitStagger };
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
    if (this.active) return null;
    
    this.active = true;
    this.alerted = false;
    this.lostTime = 0;
    this.burstTimer = 0;
    this.burstCooldown = 1.8;
    this.slowTimer = 0;
    this.waypoints = [];
    this.waypointTimer = 0;
    this.patrolTarget = null;
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

    if (!this.alerted && canSense) {
      this.alerted = true;
      this.lostTime = 0;
      this.patrolTarget = null;
      this.waypoints = [];
      this.waypointTimer = 0;
    }

    // De-aggro tracking states
    if (this.alerted && !canSense) {
      this.lostTime += dt;
      if (this.lostTime >= Config.monster.alertDeaggroTimeout) {
        this.alerted = false;
        this.lostTime = 0;
        this.waypoints = [];
        this.waypointTimer = 0;
        this.patrolTarget = null;
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

    // Patrol between rooms when de-aggroed
    if (!this.alerted && this.stagger <= 0) {
      updatePatrol(this, dt, mapManager, Config.monster.patrolSpeedScale, Config.monster.waypointRefresh);
    }

    // Separation from hunters — sideways-only so narrow corridors stay passable
    if (others) {
      const candidates = typeof others.nearby === 'function'
        ? others.nearby(this.x, this.y, this.radius + Math.max(Config.monster.radius, Config.hunter.radius) + 2)
        : others;
      for (const other of candidates) {
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

    // Contact / Damage trigger; do not consume the hit or blink away during a roll.
    if (distance < Config.monster.attackDistance) {
      this.alerted = true;
      this.lostTime = 0;

      if (!player.invulnerable) {
        result.playerHit = true;

        // Respawn far away after a real contact hit.
        const spawn = this.getFarSpawnPoint(player.x, player.y, mapManager);
        this.x = spawn.x;
        this.y = spawn.y;
        this.waypoints = [];
        this.waypointTimer = 0;
        this.patrolTarget = null;
        this._stuckTimer = 0;
        this._lastX = null;
        this._lastY = null;
      }
    }

    return result;
  }
}

class Hunter {
  constructor(spawnIndex = 0, maxHp = Config.hunter.maxHp, random = Math.random) {
    this.spawnIndex = spawnIndex;
    this.maxHp = maxHp;
    this.trait = Hunter.rollTrait(random);
    this.reset(null, maxHp);
  }

  static rollTrait(random = Math.random) {
    const roll = random();
    if (roll >= Config.hunter.traitChance) return null;
    const index = Math.min(
      Config.hunter.traitTypes.length - 1,
      Math.floor(roll / Config.hunter.traitChance * Config.hunter.traitTypes.length)
    );
    return Config.hunter.traitTypes[index];
  }

  _findDarkTarget(players, mapManager, targetPlayer) {
    let bestTarget = null;
    let bestScore = -Infinity;
    const angleOffset = (this.spawnIndex % 8) * Math.PI / 4;

    for (const radius of Config.hunter.lightAvoidRadii) {
      for (let index = 0; index < 8; index++) {
        const angle = angleOffset + index * Math.PI / 4;
        const x = this.x + Math.cos(angle) * radius;
        const y = this.y + Math.sin(angle) * radius;
        if (mapManager.blocked(x, y, this.radius) ||
            !isDirectPathClear(mapManager, this.x, this.y, x, y, this.radius) ||
            isPointLitByAnyPlayer(x, y, players, mapManager)) continue;

        const score = -Math.hypot(targetPlayer.x - x, targetPlayer.y - y);
        if (score > bestScore) {
          bestScore = score;
          bestTarget = { x, y };
        }
      }
    }
    return bestTarget;
  }

  _getLightAvoidTarget(dt, players, mapManager, targetPlayer) {
    this.lightAvoidTimer -= dt;
    const targetInvalid = !this.lightAvoidTarget ||
      Math.hypot(this.lightAvoidTarget.x - this.x, this.lightAvoidTarget.y - this.y) < 18 ||
      isPointLitByAnyPlayer(this.lightAvoidTarget.x, this.lightAvoidTarget.y, players, mapManager);
    if (this.lightAvoidTimer <= 0 || targetInvalid) {
      this.lightAvoidTimer = Config.hunter.lightAvoidRefresh;
      this.lightAvoidTarget = this._findDarkTarget(players, mapManager, targetPlayer);
    }
    if (this.lightAvoidTarget) return this.lightAvoidTarget;

    const nearestLight = [...players].sort((a, b) =>
      Math.hypot(this.x - a.x, this.y - a.y) - Math.hypot(this.x - b.x, this.y - b.y)
    )[0];
    if (!nearestLight) return { x: this.x, y: this.y };
    const awayAngle = Math.atan2(this.y - nearestLight.y, this.x - nearestLight.x);
    return {
      x: this.x + Math.cos(awayAngle) * Config.hunter.lightAvoidRadii[1],
      y: this.y + Math.sin(awayAngle) * Config.hunter.lightAvoidRadii[1]
    };
  }

  updateDeath(dt) {
    if (!this.dead) return null;
    if (!this.revivePending) {
      this.deathFade = Math.max(0, this.deathFade - dt / Config.hunter.deathFadeDuration);
      return { revived: false };
    }

    this.reviveTimer = Math.max(0, this.reviveTimer - dt);
    const elapsed = Config.hunter.traitReviveDuration - this.reviveTimer;
    this.deathFade = elapsed <= 1 ? Math.max(0, 1 - elapsed) : Math.min(1, elapsed - 1);
    if (this.reviveTimer > 0) return { revived: false, pending: true };

    this.revivePending = false;
    this.dead = false;
    this.active = true;
    this.alerted = true;
    this.hp = this.maxHp * 0.5;
    this.deathFade = 1;
    this.lostTime = 0;
    this.waypoints = [];
    this.waypointTimer = 0;
    this.localPath = [];
    this.localRepathTimer = 0;
    this.patrolTarget = null;
    this._stuckTimer = 0;
    this._lastX = null;
    this._lastY = null;
    return { revived: true };
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
    this.reviveUsed = false;
    this.revivePending = false;
    this.reviveTimer = 0;
    this.lightAvoidTarget = null;
    this.lightAvoidTimer = 0;
    this.avoidingLight = false;
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
    this.patrolTarget = null;
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
    this.alerted = false;
    this.deathFade = 0;
    this.burstCooldown = 1.8;
    this.waypoints = [];
    this.waypointTimer = 0;
    this.patrolTarget = null;
    this.localPath = [];
    this.localRepathTimer = (this.spawnIndex % 10) * 0.1;
    this.lightAvoidTarget = null;
    this.lightAvoidTimer = 0;
    this.avoidingLight = false;
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
    this.stagger = Config.hunter.hitStagger;
    this.burstTimer = 0;
    this.localPath = [];
    this.localRepathTimer = 0;
    if (this.hp <= 0) {
      this.dead = true;
      this.active = false;
      this.deathFade = 1;
      if (this.trait === 'reviver' && !this.reviveUsed) {
        this.reviveUsed = true;
        this.revivePending = true;
        this.reviveTimer = Config.hunter.traitReviveDuration;
      }
      this.patrolTarget = null;
      this.waypoints = [];
      this.localPath = [];
      return { hit: true, dead: true, willRevive: this.revivePending };
    }
    return { hit: true, dead: false, hpLeft: this.hp };
  }

  update(dt, player, noiseLevel, mapManager, audioManager, others, lightSources = [player]) {
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

    const activeLights = (lightSources || []).filter(source => source && !source.downed);
    const illuminated = this.trait === 'photophobic' &&
      distance > Config.hunter.lightIgnoreDistance &&
      isPointLitByAnyPlayer(this.x, this.y, activeLights, mapManager);

    // Nearby players can be tracked around corners; loud noise and direct flashlight exposure carry farther
    const canSense = distance < Config.hunter.alertDistance ||
      noiseLevel > Config.hunter.triggerNoiseThreshold || illuminated;

    if (!this.alerted && canSense) {
      this.alerted = true;
      this.lostTime = 0;
      this.patrolTarget = null;
      this.waypoints = [];
      this.waypointTimer = 0;
    }

    if (this.alerted) {
      if (canSense) {
        this.lostTime = 0;
      } else {
        this.lostTime += dt;
        if (this.lostTime >= Config.hunter.alertDeaggroTimeout) {
          this.alerted = false;
          this.lostTime = 0;
          this.waypoints = [];
          this.waypointTimer = 0;
          this.localPath = [];
          this.localRepathTimer = 0;
          this.patrolTarget = null;
          this._stuckTimer = 0;
          this._lastX = null;
          this._lastY = null;
          result.deaggro = true;
        }
      }
    }

    if (this.alerted && this.stagger <= 0) {
      let target;

      if (illuminated) {
        if (!this.avoidingLight) {
          this.waypoints = [];
          this.waypointTimer = 0;
          this.localPath = [];
          this.localRepathTimer = 0;
        }
        this.avoidingLight = true;
        target = this._getLightAvoidTarget(dt, activeLights, mapManager, player);
        result.avoidingLight = true;
      } else {
        this.avoidingLight = false;
        this.lightAvoidTarget = null;
        this.localRepathTimer -= dt;
        if (distance <= Config.hunter.alertDistance && this.localRepathTimer <= 0) {
          this.localRepathTimer = 1;
          const hunterRoom = getNavigationRoom(mapManager, this.x, this.y);
          const playerRoom = getNavigationRoom(mapManager, player.x, player.y);
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

        target = this.localPath[0] ||
          getPursuitTarget(this, dt, mapManager, player.x, player.y, Config.hunter.waypointRefresh);
      }

      // Speed
      const speed = this.slowTimer > 0 ? Config.hunter.slowSpeed : Config.hunter.speed;

      moveWithAvoidance(this, mapManager, target.x, target.y, speed, dt);

      // Hard clamp to world bounds (prevents spawning outside map)
      const bpad = this.radius + 12;
      this.x = Math.max(bpad, Math.min(Config.WORLD_W - bpad, this.x));
      this.y = Math.max(bpad, Math.min(Config.WORLD_H - bpad, this.y));

      recoverStuckPursuer(this, dt, mapManager);

      // Contact damage
      if (!illuminated && distance < Config.hunter.attackDistance) {
        result.playerHit = true;
        const sp = this.getFarSpawnPoint(player.x, player.y, mapManager);
        if (sp) { this.x = sp.x; this.y = sp.y; }
        this.waypoints = [];
        this.waypointTimer = 0;
        this.localPath = [];
        this.localRepathTimer = 0;
        this.patrolTarget = null;
        this._stuckTimer = 0;
        this._lastX = null;
        this._lastY = null;
      }

    } else if (!this.alerted && this.stagger <= 0) {
      updatePatrol(this, dt, mapManager, Config.hunter.patrolSpeedScale, Config.hunter.waypointRefresh);
    }

    // Separation: only push sideways relative to travel direction so corridor queues flow through
    if (others) {
      const candidates = typeof others.nearby === 'function'
        ? others.nearby(this.x, this.y, this.radius + Math.max(Config.monster.radius, Config.hunter.radius) + 2)
        : others;
      for (const other of candidates) {
        if (other === this || !other.active) continue;
        if (other instanceof Hunter && (this.trait === 'slim' || other.trait === 'slim')) continue;
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

class EntitySpatialGrid {
  constructor(cellSize = 64) {
    this.cellSize = cellSize;
    this.buckets = new Map();
    this.entries = new Map();
  }

  _key(x, y) {
    return `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)}`;
  }

  _remove(entity) {
    const entry = this.entries.get(entity);
    if (!entry) return null;
    const bucket = this.buckets.get(entry.key);
    const index = bucket.indexOf(entry);
    if (index !== -1) bucket.splice(index, 1);
    if (!bucket.length) this.buckets.delete(entry.key);
    this.entries.delete(entity);
    return entry.order;
  }

  _insert(entity, order) {
    const key = this._key(entity.x, entity.y);
    const entry = { entity, order, key };
    if (!this.buckets.has(key)) this.buckets.set(key, []);
    this.buckets.get(key).push(entry);
    this.entries.set(entity, entry);
  }

  rebuild(entities) {
    this.buckets.clear();
    this.entries.clear();
    entities.forEach((entity, order) => this._insert(entity, order));
  }

  reindex(entity) {
    const order = this._remove(entity);
    if (order != null) this._insert(entity, order);
  }

  nearby(x, y, range) {
    const minX = Math.floor((x - range) / this.cellSize);
    const maxX = Math.floor((x + range) / this.cellSize);
    const minY = Math.floor((y - range) / this.cellSize);
    const maxY = Math.floor((y + range) / this.cellSize);
    const matches = [];
    for (let cellY = minY; cellY <= maxY; cellY++) {
      for (let cellX = minX; cellX <= maxX; cellX++) {
        const bucket = this.buckets.get(`${cellX},${cellY}`);
        if (bucket) matches.push(...bucket);
      }
    }
    matches.sort((a, b) => a.order - b.order);
    return matches.map(entry => entry.entity);
  }
}
