/**
 * VOID SHIFT // RECOVERY OPERATIONS PROTOCOL
 * Backpack Grid Manager (Tetris-style footprint packing, rotation & placement rules)
 *
 * Items keep their world coordinates (x/y) and store their backpack placement in
 * gx/gy/rot so a discarded item can be dropped back onto the facility floor.
 *
 * Layouts are data driven: `new BackpackManager()` uses the active Config.backpack,
 * `new BackpackManager({ cols, rows, cellSize, gap, id, label })` or
 * `BackpackManager.fromType('heavy')` builds any other backpack without touching this file.
 */

class BackpackManager {
  constructor(colsOrDefinition, rows) {
    const fallback = (typeof Config !== 'undefined' && Config.backpack) || {};
    const definition = (colsOrDefinition && typeof colsOrDefinition === 'object')
      ? colsOrDefinition
      : { cols: colsOrDefinition, rows };
    const pick = (value, fallbackValue, min) => {
      const parsed = Number(value);
      const chosen = Number.isFinite(parsed) ? parsed : fallbackValue;
      return Math.max(min, Math.round(chosen));
    };

    this.id = definition.id || fallback.id || 'field';
    this.label = definition.label || fallback.label || '物资背包';
    this.cols = pick(definition.cols, fallback.cols || 8, 1);
    this.rows = pick(definition.rows, fallback.rows || 5, 1);
    // Cell size / gap drive the rendered geometry (see Game.updateInventoryUI)
    this.cellSize = pick(definition.cellSize, fallback.cellSize || 34, 8);
    this.gap = pick(definition.gap != null ? definition.gap : fallback.gap, 4, 0);

    this.items = [];
    this.nextId = 1;
  }

  /** Builds a backpack from Config.backpackTypes, falling back to the active layout */
  static fromType(typeId) {
    const types = (typeof Config !== 'undefined' && Config.backpackTypes) || {};
    const definition = types[typeId] || (typeof Config !== 'undefined' && Config.backpack) || {};
    return new BackpackManager(definition);
  }

  /** Total number of cells inside the backpack */
  get capacity() {
    return this.cols * this.rows;
  }

  /** Pixel pitch of one cell including its gap */
  get pitch() {
    return this.cellSize + this.gap;
  }

  reset() {
    this.items = [];
    this.nextId = 1;
  }

  /* ------------------------------------------------------------------ *
   * Shape helpers (static, pure math — also used by the automated tests)
   * ------------------------------------------------------------------ */

  /** Pads a shape matrix into a clean rectangular 0/1 array */
  static normalizeShape(matrix) {
    if (!Array.isArray(matrix) || !matrix.length || !Array.isArray(matrix[0])) return [[1]];
    const width = Math.max(1, ...matrix.map(row => (Array.isArray(row) ? row.length : 1)));
    return matrix.map(row => {
      const normalized = [];
      for (let x = 0; x < width; x++) normalized.push(row && row[x] ? 1 : 0);
      return normalized;
    });
  }

  /** Rotates a shape matrix 90° clockwise */
  static rotateClockwise(matrix) {
    const rows = matrix.length;
    const cols = matrix[0].length;
    const rotated = [];
    for (let x = 0; x < cols; x++) {
      const row = [];
      for (let y = rows - 1; y >= 0; y--) row.push(matrix[y][x]);
      rotated.push(row);
    }
    return rotated;
  }

  /** Number of occupied cells in a footprint */
  static cellCount(matrix) {
    let count = 0;
    matrix.forEach(row => row.forEach(cell => { if (cell) count += 1; }));
    return count;
  }

  /** Keeps a rotation value inside 0..3 */
  static normalizeRotation(rotation) {
    const steps = Math.round(Number(rotation) || 0) % 4;
    return steps < 0 ? steps + 4 : steps;
  }

  /** Stable FNV-1a hash so an item always resolves to the same footprint */
  static hash(text) {
    const source = String(text);
    let hash = 2166136261;
    for (let i = 0; i < source.length; i++) {
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  static shapes() {
    return (typeof Config !== 'undefined' && Config.itemShapes) || {};
  }

  /* ------------------------------------------------------------------ *
   * Per-item footprint resolution
   * ------------------------------------------------------------------ */

  /** Resolves the footprint id: explicit `item.shape` first, otherwise a pool by `item.size` */
  shapeIdFor(item) {
    const shapes = BackpackManager.shapes();
    const ids = Object.keys(shapes);
    if (item && item.shape && shapes[item.shape]) return item.shape;
    if (!ids.length) return null;

    const pools = (typeof Config !== 'undefined' && Config.shapePools) || {};
    const size = Math.max(1, Math.min(3, Math.round(Number(item && item.size) || 1)));
    const pool = (pools[size] || pools[1] || ids).filter(id => shapes[id]);
    const candidates = pool.length ? pool : ids;
    const seedText = (item && (item.name || item.id)) || 'scrap';
    return candidates[BackpackManager.hash(seedText) % candidates.length];
  }

  /** Base (unrotated) footprint matrix of an item */
  shapeFor(item) {
    const shapes = BackpackManager.shapes();
    const id = this.shapeIdFor(item);
    return BackpackManager.normalizeShape((id && shapes[id]) || [[1]]);
  }

  /** Footprint matrix of an item at the given rotation (defaults to the item's stored rotation) */
  matrixFor(item, rotation = null) {
    const steps = BackpackManager.normalizeRotation(
      rotation == null ? ((item && item.rot) || 0) : rotation
    );
    let matrix = this.shapeFor(item);
    for (let i = 0; i < steps; i++) matrix = BackpackManager.rotateClockwise(matrix);
    return matrix;
  }

  rotationFor(item) {
    return BackpackManager.normalizeRotation((item && item.rot) || 0);
  }

  /* ------------------------------------------------------------------ *
   * Cell math & placement validation
   * ------------------------------------------------------------------ */

  /** Absolute grid cells covered by a footprint anchored at (gx, gy) */
  cellsOf(matrix, gx, gy) {
    const cells = [];
    for (let row = 0; row < matrix.length; row++) {
      for (let col = 0; col < matrix[row].length; col++) {
        if (matrix[row][col]) cells.push({ x: gx + col, y: gy + row });
      }
    }
    return cells;
  }

  /** Set of "x,y" keys currently occupied (optionally ignoring one item while moving it) */
  occupancy(ignoreId = null) {
    const taken = new Set();
    this.items.forEach(item => {
      if (ignoreId != null && item.id === ignoreId) return;
      this.cellsOf(this.matrixFor(item), item.gx, item.gy)
        .forEach(cell => taken.add(`${cell.x},${cell.y}`));
    });
    return taken;
  }

  /**
   * True when the footprint fits inside the grid without overlapping other items.
   * Every occupied cell is validated individually (not the bounding box) so shapes
   * whose anchor cell is empty behave exactly like they look.
   */
  canPlace(matrix, gx, gy, ignoreId = null) {
    if (!matrix || !matrix.length) return false;

    const cells = this.cellsOf(matrix, gx, gy);
    if (!cells.length) return false;

    const taken = this.occupancy(ignoreId);
    return cells.every(cell =>
      cell.x >= 0 && cell.y >= 0 && cell.x < this.cols && cell.y < this.rows &&
      !taken.has(`${cell.x},${cell.y}`)
    );
  }

  /** True when the footprint fits somewhere in the current grid */
  fitsAnywhere(matrix, ignoreId = null) {
    for (let gy = 0; gy < this.rows; gy++) {
      for (let gx = 0; gx < this.cols; gx++) {
        if (this.canPlace(matrix, gx, gy, ignoreId)) return true;
      }
    }
    return false;
  }

  /**
   * First-fit scan (row-major) for one exact orientation.
   * Returns { gx, gy, rot } or null when that orientation fits nowhere.
   */
  findSpotForRotation(matrix, rot = 0, ignoreId = null) {
    const steps = BackpackManager.normalizeRotation(rot);
    let candidate = matrix;
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

  /**
   * First-fit search (row-major) that also tries all four rotations, starting at
   * preferRotation. Returns { gx, gy, rot } or null when the item fits nowhere.
   */
  findSpot(matrix, preferRotation = 0, ignoreId = null) {
    const start = BackpackManager.normalizeRotation(preferRotation);
    for (let step = 0; step < 4; step++) {
      const spot = this.findSpotForRotation(matrix, BackpackManager.normalizeRotation(start + step), ignoreId);
      if (spot) return spot;
    }
    return null;
  }

  getItem(itemOrId) {
    if (itemOrId == null) return null;
    if (typeof itemOrId === 'object') return this.items.includes(itemOrId) ? itemOrId : null;
    return this.items.find(item => item.id === itemOrId) || null;
  }

  /* ------------------------------------------------------------------ *
   * Mutation API used by the game layer
   * ------------------------------------------------------------------ */

  /** Footprint size of an item at a given rotation, e.g. { w: 2, h: 2 } */
  sizeFor(item, rotation = null) {
    const matrix = this.matrixFor(item, rotation);
    return { w: matrix[0].length, h: matrix.length };
  }

  /**
   * Adds an item to the backpack.
   * options: { gx, gy, rot } for a manual placement, otherwise the first free spot is used.
   */
  place(item, options = {}) {
    if (!item) return false;

    const wanted = BackpackManager.normalizeRotation(options.rot || 0);
    const hasTarget = options.gx != null && options.gy != null;
    const ignoreId = item.id != null ? item.id : null;

    let target = null;
    if (hasTarget && this.canPlace(this.matrixFor(item, wanted), options.gx, options.gy, ignoreId)) {
      target = { gx: options.gx, gy: options.gy, rot: wanted };
    }
    if (!target) target = this.findSpot(this.shapeFor(item), wanted, ignoreId);
    if (!target) return false;

    if (item.id == null) item.id = this.nextId++;
    this.nextId = Math.max(this.nextId, item.id + 1);

    item.gx = target.gx;
    item.gy = target.gy;
    item.rot = target.rot;

    if (!this.items.includes(item)) this.items.push(item);
    return true;
  }

  /** Moves an already stored item to a new anchor/rotation (used by drag & drop) */
  moveItem(itemOrId, gx, gy, rot = null) {
    const item = this.getItem(itemOrId);
    if (!item) return false;

    const rotation = BackpackManager.normalizeRotation(rot == null ? item.rot : rot);
    if (!this.canPlace(this.matrixFor(item, rotation), gx, gy, item.id)) return false;

    item.gx = gx;
    item.gy = gy;
    item.rot = rotation;
    return true;
  }

  /**
   * Rotates an item 90° clockwise.
   * 1) the current anchor is used when it can hold the new orientation;
   * 2) otherwise the item slides to the nearest anchor that accepts a new silhouette.
   * Orientations that look identical (squares, bars, S/Z) are skipped so R never
   * reports a rotation that changes nothing. Returns false when space is too tight.
   */
  rotateItem(itemOrId) {
    const item = this.getItem(itemOrId);
    if (!item) return false;

    const current = this.rotationFor(item);
    const currentOutline = JSON.stringify(this.matrixFor(item, current));
    const alternatives = [];
    for (let step = 1; step <= 3; step++) {
      const rot = BackpackManager.normalizeRotation(current + step);
      if (JSON.stringify(this.matrixFor(item, rot)) === currentOutline) continue;
      alternatives.push(rot);
    }
    if (!alternatives.length) return false; // shape is rotation-invariant

    for (const rot of alternatives) {
      if (this.canPlace(this.matrixFor(item, rot), item.gx, item.gy, item.id)) {
        item.rot = rot;
        return true;
      }
    }

    for (const rot of alternatives) {
      const spot = this.findSpotForRotation(this.shapeFor(item), rot, item.id);
      if (spot) {
        item.gx = spot.gx;
        item.gy = spot.gy;
        item.rot = spot.rot;
        return true;
      }
    }
    return false;
  }

  /** True when all four orientations look identical (2x2, 3x3, straight bars) */
  isRotationInvariant(item) {
    const base = JSON.stringify(this.shapeFor(item));
    return [1, 2, 3].every(step => JSON.stringify(this.matrixFor(item, step)) === base);
  }

  /** Removes an item from the backpack and returns it */
  removeItem(itemOrId) {
    const item = this.getItem(itemOrId);
    if (!item) return null;
    this.items = this.items.filter(entry => entry !== item);
    return item;
  }

  clear() {
    this.items = [];
    this.nextId = 1;
  }

  /** Total number of occupied cells */
  usedCells() {
    return this.items.reduce((sum, item) => sum + BackpackManager.cellCount(this.matrixFor(item)), 0);
  }

  /** Total recoverable value of everything currently carried */
  totalValue() {
    return this.items.reduce((sum, item) => sum + (item.value || 0), 0);
  }

  /**
   * Re-packs every item from scratch (compaction).
   * order: 'value' sorts by recoverable value first, 'insert' keeps pickup order.
   * The previous layout is restored when the new one would leave an item unpacked.
   */
  autoPack(order = 'value') {
    const snapshot = this.items.map(item => ({ item, gx: item.gx, gy: item.gy, rot: item.rot }));
    const sequence = [...this.items];
    if (order === 'value') {
      sequence.sort((a, b) => (b.value || 0) - (a.value || 0));
    }

    this.items = [];
    const failed = [];
    sequence.forEach(item => {
      if (!this.place(item)) failed.push(item);
    });

    if (failed.length) {
      this.items = snapshot.map(entry => entry.item);
      snapshot.forEach(entry => {
        entry.item.gx = entry.gx;
        entry.item.gy = entry.gy;
        entry.item.rot = entry.rot;
      });
      return { packed: 0, failed };
    }

    if (order === 'value') this.items = sequence;
    return { packed: sequence.length, failed: [] };
  }
}
