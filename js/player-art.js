/** Local-only player art. Pose frames and muzzle offsets never enter hit testing. */
class PlayerArt {
  static weapons = {
    pistol: { stance: 'short', width: 14, grip: 0.24, crop: [280 / 1774, 300 / 887, 1216 / 1774, 303 / 887] },
    smg: { stance: 'long', width: 22, grip: 0.32, crop: [93 / 1774, 308 / 887, 1589 / 1774, 270 / 887] },
    shotgun: { stance: 'long', width: 28, grip: 0.32, crop: [63 / 1774, 323 / 887, 1659 / 1774, 241 / 887] },
    revolver: { stance: 'short', width: 16, grip: 0.26, crop: [202 / 1983, 174 / 793, 1627 / 1983, 467 / 793] },
    machinegun: { stance: 'long', width: 32, grip: 0.34, crop: [33 / 1881, 239 / 836, 1815 / 1881, 465 / 836] },
    'mini-shotgun': { stance: 'short', width: 18, grip: 0.26, crop: [428 / 1983, 209 / 793, 1129 / 1983, 371 / 793] }
  };
  static pivots = {
    short: [[265.5, 278], [272, 278], [262, 278], [269.5, 245.5], [278, 245], [247.5, 260]],
    long: [[264.5, 328], [267, 330.5], [248.5, 328], [268, 220.5], [267.5, 223.5], [242, 252]]
  };
  // Generated walk cells have a different crop; align their measured waist with the idle layer.
  static walkCalibration = Object.freeze({
    width: 20,
    pivots: Object.freeze([
      [275, 178], [266, 177.5], [271, 177.5], [266, 177.5],
      [279, 178.5], [273, 178.5], [269, 178], [266, 178.5],
      [275, 177.5], [273, 177.5], [271, 177.5], [269, 177],
      [276, 149.5], [273, 150.5], [270, 149.5], [266, 150]
    ].map(([x, y]) => Object.freeze([
      x / 313.5 - (538 / 1254 * 2 - 1), y / 313.5 - (625.5 / 1254 * 2 - 1)
    ])))
  });

  constructor(loadSprite, reducedMotion = () => false) {
    this.loadSprite = loadSprite;
    this.reducedMotion = reducedMotion;
    this.poses = new Map();
  }

  reset(identity) {
    if (identity === undefined) this.poses.clear();
    else this.poses.delete(identity);
  }

  pose(player, state, identity, now = performance.now()) {
    if (this.missionId !== state.missionFxId) {
      this.reset();
      this.missionId = state.missionFxId;
    }
    let previous = this.poses.get(identity);
    if (!previous) {
      previous = { x: player.x, y: player.y, phase: 0, frame: 0, mode: 'idle' };
      this.poses.set(identity, previous);
    }
    const dx = player.x - previous.x, dy = player.y - previous.y;
    const distance = Math.hypot(dx, dy);
    Object.assign(previous, { x: player.x, y: player.y });
    if (distance > 48) Object.assign(previous, { phase: 0, frame: 0, mode: 'idle' });
    if (player.downed) return previous.frame = 5;
    if (previous.frame === 5) Object.assign(previous, { phase: 0, frame: 0, mode: 'idle' });
    if (this.reducedMotion() || distance > 48) {
      previous.mode = 'idle';
      return previous.frame = 0;
    }
    const frozen = !state.running || state.pauseMenuOpen || state.tutorial?.paused || state.coop?.hostPaused ||
      player.stunned > 0 || player.flashStunTimer > 0;
    if (frozen) return previous.frame;
    if (distance === 0) {
      previous.mode = 'idle';
      return previous.frame = 0;
    }
    const relative = Math.atan2(dy, dx) - (player.angle || 0);
    const angle = Math.atan2(Math.sin(relative), Math.cos(relative));
    previous.mode = Math.abs(angle) <= Math.PI / 4 ? 'forward' : Math.abs(angle) >= Math.PI * 3 / 4 ?
      'backward' : angle < 0 ? 'left' : 'right';
    previous.phase += distance / (player.moveSpeed >= 145 ? 12.5 : 8.75);
    return previous.frame = 1 + Math.floor(previous.phase) % 4;
  }

  assets(weaponId, downed = false) {
    const spec = PlayerArt.weapons[weaponId];
    const stance = downed ? 'short' : spec?.stance || 'short';
    const body = downed ? this.loadSprite(`player-v20/${stance}-poses`) : null;
    const upper = downed ? null : this.loadSprite(`player-tactical-v1/upper-${stance}`);
    const idle = downed ? null : this.loadSprite('player-tactical-v1/legs-idle');
    const walk = downed ? null : this.loadSprite('player-tactical-v1/legs-walk');
    const gun = spec ? this.loadSprite(`player-v20/${weaponId}`) : null;
    const ready = image => image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
    return (downed ? ready(body) : ready(upper) && ready(idle) && ready(walk)) && (!spec || ready(gun)) ?
      { body, upper, idle, walk, gun, spec, stance } : null;
  }

  draw(ctx, player, state, identity, now = performance.now()) {
    if (state.textureQuality === 'low') return false;
    const assets = this.assets(player.weaponId, player.downed);
    if (!assets) return false;
    const frame = this.pose(player, state, identity, now);
    if (player.downed) {
      const cellW = assets.body.naturalWidth / 3, cellH = assets.body.naturalHeight / 2;
      const pivot = PlayerArt.pivots[assets.stance][frame];
      ctx.drawImage(assets.body, frame % 3 * cellW, Math.floor(frame / 3) * cellH,
        cellW, cellH, -pivot[0] / 512 * 40, -pivot[1] / 512 * 40, 40, 40);
    } else {
      const mode = this.poses.get(identity).mode;
      if (mode === 'idle') {
        ctx.drawImage(assets.idle, 0, 0, assets.idle.naturalWidth, assets.idle.naturalHeight, -20, -20, 40, 40);
      } else {
        const cellW = assets.walk.naturalWidth / 4, cellH = assets.walk.naturalHeight / 4;
        const row = ['forward', 'backward', 'left', 'right'].indexOf(mode);
        const { width, pivots } = PlayerArt.walkCalibration, pivot = pivots[row * 4 + frame - 1];
        ctx.drawImage(assets.walk, (frame - 1) * cellW, row * cellH, cellW, cellH,
          -pivot[0] * width, -pivot[1] * width, width, width);
      }
      ctx.drawImage(assets.upper, 0, 0, assets.upper.naturalWidth, assets.upper.naturalHeight, -20, -20, 40, 40);
    }
    if (assets.gun) {
      const { gun, spec } = assets;
      const [x, y, w, h] = spec.crop;
      const height = spec.width * (h * gun.naturalHeight) / (w * gun.naturalWidth);
      const anchor = player.downed ? 11 : 14;
      ctx.drawImage(gun, x * gun.naturalWidth, y * gun.naturalHeight, w * gun.naturalWidth, h * gun.naturalHeight,
        anchor - spec.width * spec.grip, -height / 2, spec.width, height);
    }
    return true;
  }

  static muzzleDistance(weaponId, downed = false) {
    const spec = this.weapons[weaponId];
    return spec ? (downed ? 11 : 14) + spec.width * (1 - spec.grip) : 8;
  }

  static muzzlePoint(actor, weaponId, downed = false) {
    const distance = this.muzzleDistance(weaponId, downed);
    return { x: actor.x + Math.cos(actor.angle || 0) * distance,
      y: actor.y + Math.sin(actor.angle || 0) * distance };
  }

  static tracerSegment(trace, muzzle) {
    const total = Math.hypot(trace.endX - trace.startX, trace.endY - trace.startY);
    const progress = total ? Math.min(1, Math.hypot(trace.currentX - trace.startX, trace.currentY - trace.startY) / total) : 1;
    const dx = trace.endX - muzzle.x, dy = trace.endY - muzzle.y;
    const length = Math.hypot(dx, dy), distance = length * progress;
    const tail = Math.max(0, distance - 24);
    return { startX: muzzle.x, startY: muzzle.y,
      headX: muzzle.x + dx * progress, headY: muzzle.y + dy * progress,
      tailX: muzzle.x + (length ? dx / length * tail : 0),
      tailY: muzzle.y + (length ? dy / length * tail : 0) };
  }
}
