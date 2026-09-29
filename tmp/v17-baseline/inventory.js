/**
 * VOID SHIFT // RECOVERY OPERATIONS PROTOCOL
 * Backpack Grid Manager (Tetris-style footprint packing, rotation & placement rules)
 *
 * Items keep world coordinates (x/y) and store backpack placement in gx/gy/rot.
 */
class BackpackManager {
  constructor(colsOrDefinition, rows) {
    const fallback = (typeof Config !== 'undefined' && Config.backpack) || {};
    const definition = colsOrDefinition && typeof colsOrDefinition === 'object'
      ? colsOrDefinition
      : { cols: colsOrDefinition, rows };
    const pick = (value, fallbackValue, min) => {
      const parsed = Number(value);
      return Math.max(min, Math.round(Number.isFinite(parsed) ? parsed : fallbackValue));
    };

    this.id = definition.id || fallback.id || 'field';
    this.label = definition.label || fallback.label || '物资背包';
    this.cols = pick(definition.cols, fallback.cols || 8, 1);
    this.rows = pick(definition.rows, fallback.rows || 5, 1);
    this.cellSize = pick(definition.cellSize, fallback.cellSize || 34, 8);
    this.gap = pick(definition.gap != null ? definition.gap : fallback.gap, 4, 0);
    this.items = [];
    this.nextId = 1;
  }

  static fromType(typeId) {
    const types = (typeof Config !== 'undefined' && Config.backpackTypes) || {};
    return new BackpackManager(types[typeId] || (typeof Config !== 'undefined' && Config.backpack) || {});
  }

  static imageFor(item) {
    if (item.effect === 'health-40') return 'resources/images/medkit.png';
    if (item.effect === 'flashbang') return 'resources/images/flashbang.png';
    if (item.effect === 'oxygen-50' || /氧气/.test(item.name || '')) return 'resources/images/menu/oxygen-bottle.png';
    if (/样本|组织|血清|胚胎|孢子|真菌|神经|药/.test(item.name || '')) return 'resources/images/menu/item-specimen.png';
    if (/芯|卡|数据|驱动|硬盘|电池|密钥|录音|导航/.test(item.name || '')) return 'resources/images/menu/item-chip.png';
    if (/弹药/.test(item.name || '')) return 'resources/images/menu/ammo-crate.png';
    return item.image || 'resources/images/menu/item-alloy.png';
  }

  get capacity() { return this.cols * this.rows; }
  get pitch() { return this.cellSize + this.gap; }

  static normalizeShape(matrix) {
    if (!Array.isArray(matrix) || !matrix.length || !Array.isArray(matrix[0])) return [[1]];
    const width = Math.max(1, ...matrix.map(row => Array.isArray(row) ? row.length : 1));
    return matrix.map(row => Array.from({ length: width }, (_, x) => row && row[x] ? 1 : 0));
  }

  static rotateClockwise(matrix) {
    const rotated = [];
    for (let x = 0; x < matrix[0].length; x++) {
      const row = [];
      for (let y = matrix.length - 1; y >= 0; y--) row.push(matrix[y][x]);
      rotated.push(row);
    }
    return rotated;
  }

  static cellCount(matrix) {
    return matrix.reduce((sum, row) => sum + row.reduce((rowSum, cell) => rowSum + (cell ? 1 : 0), 0), 0);
  }

  static normalizeRotation(rotation) {
    const steps = Math.round(Number(rotation) || 0) % 4;
    return steps < 0 ? steps + 4 : steps;
  }

  static hash(text) {
    let hash = 2166136261;
    for (const char of String(text)) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  static shapes() { return (typeof Config !== 'undefined' && Config.itemShapes) || {}; }

  shapeIdFor(item) {
    const shapes = BackpackManager.shapes();
    const ids = Object.keys(shapes);
    if (item && item.shape && shapes[item.shape]) return item.shape;
    if (!ids.length) return null;
    const pools = (typeof Config !== 'undefined' && Config.shapePools) || {};
    const size = Math.max(1, Math.min(3, Math.round(Number(item && item.size) || 1)));
    const pool = (pools[size] || pools[1] || ids).filter(id => shapes[id]);
    const candidates = pool.length ? pool : ids;
    return candidates[BackpackManager.hash((item && (item.name || item.id)) || 'scrap') % candidates.length];
  }

  shapeFor(item) {
    const id = this.shapeIdFor(item);
    return BackpackManager.normalizeShape((id && BackpackManager.shapes()[id]) || [[1]]);
  }

  matrixFor(item, rotation = null) {
    let matrix = this.shapeFor(item);
    const steps = BackpackManager.normalizeRotation(rotation == null ? (item && item.rot) : rotation);
    for (let i = 0; i < steps; i++) matrix = BackpackManager.rotateClockwise(matrix);
    return matrix;
  }

  rotationFor(item) { return BackpackManager.normalizeRotation(item && item.rot); }

  cellsOf(matrix, gx, gy) {
    const cells = [];
    matrix.forEach((row, y) => row.forEach((occupied, x) => {
      if (occupied) cells.push({ x: gx + x, y: gy + y });
    }));
    return cells;
  }

  occupancy(ignoreId = null) {
    const taken = new Set();
    this.items.forEach(item => {
      if (ignoreId != null && item.id === ignoreId) return;
      this.cellsOf(this.matrixFor(item), item.gx, item.gy).forEach(cell => taken.add(`${cell.x},${cell.y}`));
    });
    return taken;
  }

  canPlace(matrix, gx, gy, ignoreId = null) {
    if (!Array.isArray(matrix) || !matrix.length) return false;
    const cells = this.cellsOf(matrix, gx, gy);
    if (!cells.length) return false;
    const taken = this.occupancy(ignoreId);
    return cells.every(cell => cell.x >= 0 && cell.y >= 0 && cell.x < this.cols && cell.y < this.rows && !taken.has(`${cell.x},${cell.y}`));
  }

  findSpotForRotation(matrix, rotation = 0, ignoreId = null) {
    let candidate = matrix;
    const steps = BackpackManager.normalizeRotation(rotation);
    for (let i = 0; i < steps; i++) candidate = BackpackManager.rotateClockwise(candidate);
    const width = candidate[0].length;
    const height = candidate.length;
    for (let gy = 0; gy <= this.rows - height; gy++) {
      for (let gx = 0; gx <= this.cols - width; gx++) {
        if (this.canPlace(candidate, gx, gy, ignoreId)) return { gx, gy, rot: steps };
      }
    }
    return null;
  }

  findSpot(matrix, preferRotation = 0, ignoreId = null) {
    for (let step = 0; step < 4; step++) {
      const spot = this.findSpotForRotation(matrix, BackpackManager.normalizeRotation(preferRotation + step), ignoreId);
      if (spot) return spot;
    }
    return null;
  }

  getItem(itemOrId) {
    if (itemOrId == null) return null;
    return typeof itemOrId === 'object'
      ? (this.items.includes(itemOrId) ? itemOrId : null)
      : this.items.find(item => String(item.id) === String(itemOrId)) || null;
  }

  sizeFor(item, rotation = null) {
    const matrix = this.matrixFor(item, rotation);
    return { w: matrix[0].length, h: matrix.length };
  }

  place(item, options = {}) {
    if (!item) return false;
    const wanted = BackpackManager.normalizeRotation(options.rot || 0);
    const hasTarget = options.gx != null && options.gy != null;
    const ignoreId = item.id == null ? null : item.id;
    let target = hasTarget && this.canPlace(this.matrixFor(item, wanted), options.gx, options.gy, ignoreId)
      ? { gx: options.gx, gy: options.gy, rot: wanted }
      : null;
    if (!target) target = this.findSpot(this.shapeFor(item), wanted, ignoreId);
    if (!target) return false;
    if (item.id == null) item.id = this.nextId++;
    this.nextId = Math.max(this.nextId, Number(item.id) + 1);
    Object.assign(item, target);
    if (!this.items.includes(item)) this.items.push(item);
    return true;
  }

  moveItem(itemOrId, gx, gy, rotation = null) {
    const item = this.getItem(itemOrId);
    if (!item) return false;
    const rot = BackpackManager.normalizeRotation(rotation == null ? item.rot : rotation);
    if (!this.canPlace(this.matrixFor(item, rot), gx, gy, item.id)) return false;
    Object.assign(item, { gx, gy, rot });
    return true;
  }

  rotateItem(itemOrId) {
    const item = this.getItem(itemOrId);
    if (!item) return false;
    const current = this.rotationFor(item);
    const outline = JSON.stringify(this.matrixFor(item, current));
    const alternatives = [1, 2, 3].map(step => BackpackManager.normalizeRotation(current + step))
      .filter(rot => JSON.stringify(this.matrixFor(item, rot)) !== outline);
    for (const rot of alternatives) {
      if (this.canPlace(this.matrixFor(item, rot), item.gx, item.gy, item.id)) {
        item.rot = rot;
        return true;
      }
    }
    for (const rot of alternatives) {
      const spot = this.findSpotForRotation(this.shapeFor(item), rot, item.id);
      if (spot) {
        Object.assign(item, spot);
        return true;
      }
    }
    return false;
  }

  isRotationInvariant(item) {
    const shape = JSON.stringify(this.shapeFor(item));
    return [1, 2, 3].every(step => JSON.stringify(this.matrixFor(item, step)) === shape);
  }

  removeItem(itemOrId) {
    const item = this.getItem(itemOrId);
    if (!item) return null;
    this.items.splice(this.items.indexOf(item), 1);
    return item;
  }

  clear() { this.items.length = 0; this.nextId = 1; }
  usedCells() { return this.items.reduce((sum, item) => sum + BackpackManager.cellCount(this.matrixFor(item)), 0); }
  totalValue() { return this.items.reduce((sum, item) => sum + (Number(item.value) || 0), 0); }

  autoPack(order = 'value') {
    const snapshot = this.items.map(item => ({ item, gx: item.gx, gy: item.gy, rot: item.rot }));
    const sequence = [...this.items];
    if (order === 'value') sequence.sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0));
    this.items.length = 0;
    const failed = sequence.filter(item => !this.place(item));
    if (failed.length) {
      this.items.length = 0;
      snapshot.forEach(({ item, gx, gy, rot }) => {
        Object.assign(item, { gx, gy, rot });
        this.items.push(item);
      });
      return { packed: 0, failed };
    }
    if (order === 'value') this.items.splice(0, this.items.length, ...sequence);
    return { packed: sequence.length, failed: [] };
  }
}

/** Shared crate mutations run only on the host; failed transfers are lossless. */
class ContainerTransactions {
  constructor(containers) {
    this.containers = containers;
    this.requests = new Map();
  }

  static inventory(container) {
    const grid = new BackpackManager({ id: container.id, label: container.fixed ? '箱子' : '物资包', cols: 6, rows: 6 });
    grid.items = container.items;
    return grid;
  }

  transact(playerId, request, actor, backpack, canReach = () => true) {
    if (!request || !Number.isSafeInteger(request.requestId) || request.requestId < 1) return { accepted: false, reason: 'invalid-request' };
    let history = this.requests.get(playerId);
    if (!history) this.requests.set(playerId, history = { latest: 0, results: new Map() });
    if (history.results.has(request.requestId)) return history.results.get(request.requestId);
    if (request.requestId <= history.latest) return { requestId: request.requestId, accepted: false, reason: 'stale-request' };
    history.latest = request.requestId;
    const container = this.containers.find(item => item.id === request.containerId);
    const result = { requestId: request.requestId, containerId: request.containerId, accepted: false, reason: 'missing-container' };
    if (container) {
      result.reason = 'out-of-range';
      if (actor && !actor.downed && !(actor.stunned > 0) && !(actor.flashStunTimer > 0) &&
          Math.hypot(actor.x - container.x, actor.y - container.y) <= 80 && canReach(actor, container)) {
        const grid = ContainerTransactions.inventory(container);
        const source = request.action === 'deposit' ? backpack : grid;
        const target = request.action === 'take' ? backpack : grid;
        const item = source?.getItem(request.itemId);
        result.reason = 'missing-item';
        if (item && ['take', 'deposit', 'move'].includes(request.action)) {
          result.reason = 'full';
          const old = { gx: item.gx, gy: item.gy, rot: item.rot };
          if (request.action === 'move') {
            if (Number.isInteger(request.gx) && Number.isInteger(request.gy) && grid.moveItem(item, request.gx, request.gy, request.rot)) result.accepted = true;
          } else if (target && !target.getItem(item.id)) {
            const positioned = request.gx != null || request.gy != null;
            const options = positioned ? { gx: request.gx, gy: request.gy, rot: request.rot } : { rot: item.rot };
            if ((!positioned || (Number.isInteger(request.gx) && Number.isInteger(request.gy) &&
                target.canPlace(target.matrixFor(item, request.rot), request.gx, request.gy))) && target.place(item, options)) {
              source.removeItem(item);
              if (request.action === 'take') item.foundThisRun = true;
              result.accepted = true;
            } else Object.assign(item, old);
          }
          if (result.accepted) {
            container.revision = (container.revision || 0) + 1;
            result.reason = null;
            result.revision = container.revision;
            result.itemId = item.id;
            if (!container.fixed && !container.items.length) {
              this.containers.splice(this.containers.indexOf(container), 1);
              result.removed = true;
            }
          }
        }
      }
    }
    history.results.set(request.requestId, result);
    while (history.results.size > 128) history.results.delete(history.results.keys().next().value);
    return result;
  }
}
