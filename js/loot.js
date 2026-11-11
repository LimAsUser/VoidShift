/** Shared crate contents travel on reliable mutations, never on 20 Hz snapshots. */
class LootController {
  constructor(game) { this.game = game; this.reset(); }

  reset() {
    this.game.map.containers ||= [];
    this.transactions = new ContainerTransactions(this.game.map.containers);
    this.revision = 0;
    this.requestSequence = 0;
    this.bagSequence = 0;
    this.selected = null;
    this.lastTap = null;
    this.game.state.lootContainerId = null;
    this.close();
  }

  canReach(actor, box) {
    const dx = box.x - actor.x, dy = box.y - actor.y, distance = Math.hypot(dx, dy);
    const edge = distance ? Math.min((box.w || 48) / 2 / Math.abs(dx / distance), (box.h || 36) / 2 / Math.abs(dy / distance)) : 0;
    // Fixed boxes are physical obstacles: the ray only needs to reach their near face.
    return distance <= 80 && (!distance || this.game.map.rayWallDistance(actor.x, actor.y, dx / distance, dy / distance, distance) >=
      Math.max(0, distance - edge - 2));
  }

  nearest(actor = this.game.player) {
    const map = this.game.map, exit = map.exitExtractionPoint;
    const extraction = exit && Math.hypot(actor.x - exit.x, actor.y - exit.y) < 55 && map.terminals?.length && map.terminals.every(terminal => terminal.solved);
    return map.containers.filter(box => this.canReach(actor, box) && !(extraction && box.fixed && !box.items.length))
      .sort((a, b) => Math.hypot(a.x - actor.x, a.y - actor.y) - Math.hypot(b.x - actor.x, b.y - actor.y))[0] || null;
  }

  open(box) {
    const g = this.game;
    if (!box || !g.state.running || !this.canReach(g.player, box)) return false;
    g.state.lootContainerId = box.id;
    g.toggleInventory(true);
    if (g.state.coop.running && g.state.coop.role === 'guest') g.coopSession.sendEvent('loot-open', { missionId: g.state.missionFxId, containerId: box.id });
    this.render();
    return true;
  }

  close() {
    this.game.state.lootContainerId = null;
    this.selected = null;
    this.lastTap = null;
    this.cancelDrag();
    if (this.panel) this.panel.hidden = true;
    this.overlay?.classList.remove('has-container');
  }

  refreshReachability() {
    const id = this.game.state.lootContainerId;
    if (!id) return;
    const box = this.game.map.containers.find(box => box.id === id);
    if (!box || this.game.player.downed || !this.canReach(this.game.player, box)) {
      this.close();this.game.toggleInventory(false);
    }
  }

  request(action, itemId, placement = {}) {
    const g = this.game;
    const request = { missionId: g.state.missionFxId, requestId: ++this.requestSequence,
      containerId: g.state.lootContainerId, action, itemId, ...placement };
    if (g.state.coop.running && g.state.coop.role === 'guest') {
      if (!g.coopSession.sendEvent('loot-request', request)) { g.ui.showToast('连接尚未恢复，物资未转移');return false; }
      return true;
    }
    return this.handleRequest(request, 'host').accepted;
  }

  handleRequest(request, playerId) {
    const g = this.game, local = playerId === 'host';
    const entry = local ? null : g.remotePlayers.get(playerId);
    const actor = local ? g.player : entry?.player;
    const backpack = local ? g.backpack : entry?.backpack;
    if (!g.state.running || g.state.coop.role === 'guest' || g.state.coop.hostPaused || g.state.tutorial?.paused ||
        request.missionId !== g.state.missionFxId || !actor || !backpack || (!local && entry.online === false) ||
        entry?.qte || (local && g.state.activeQte) || actor.dodgeTimer > 0) return { accepted: false, reason: 'unavailable' };
    if (actor.supplyUse && String(actor.supplyUse.itemId) === String(request.itemId) &&
        ['drop', 'deposit'].includes(request.action)) return { accepted: false, reason: 'item-in-use' };
    const history = this.transactions.requests.get(playerId);
    const replay = history?.results.has(request.requestId);
    let input = request;
    if (request.action === 'drop') {
      const id = `bag_${g.state.missionFxId}_${playerId}_${request.requestId}`;
      if (!replay && Number.isSafeInteger(request.requestId) && request.requestId > (history?.latest || 0)) {
        g.map.containers.push({ id, x: actor.x, y: actor.y, fixed: false, revision: 0, items: [] });
      }
      input = { ...request, containerId: id, action: 'deposit' };
    }
    const result = this.transactions.transact(playerId, input, actor, backpack, (a, box) => this.canReach(a, box));
    if (!replay && result.accepted) {
      this.revision++;
      if (request.action === 'take') actor.noise = Math.min(100, (Number(actor.noise) || 0) + 5);
      if (local) g.state.inventoryRevision = (g.state.inventoryRevision || 0) + 1;
      else { entry.inventoryRevision = (entry.inventoryRevision || 0) + 1;entry.inventory = backpack.items; }
      if (local) {
        g.state.loot = backpack.items.length;
        g.state.lootValue = backpack.totalValue();
      }
      this.broadcastBox(result.containerId);
      if (request.action === 'take' && local) g._tutorialAction('pickup', { id: request.itemId });
      g._syncLegacyRemoteAliases();
    }
    if (request.action === 'drop' && !result.accepted) {
      const empty = g.map.containers.findIndex(box => box.id === input.containerId && !box.items.length);
      if (empty >= 0) g.map.containers.splice(empty, 1);
    }
    const reply = { ...result, missionId: g.state.missionFxId, inventory: backpack.items.map(item => ({ ...item })),
      inventoryRevision: local ? g.state.inventoryRevision || 0 : entry.inventoryRevision || 0 };
    if (!local) g.coopSession.sendEvent('loot-result', reply, playerId);
    else this.showResult(reply);
    g.updateInventoryUI();this.render();
    return reply;
  }

  broadcastBox(id, targetId = null) {
    const g = this.game, box = g.map.containers.find(box => box.id === id);
    const data = { missionId: g.state.missionFxId, revision: this.revision, containerId: id, container: box || null };
    if (g.state.coop.running && g.state.coop.role === 'host') g.coopSession.sendEvent('loot-update', data, targetId);
  }

  applyUpdate(message) {
    if (message.missionId !== this.game.state.missionFxId || message.revision < this.revision) return false;
    this.revision = message.revision;
    const boxes = this.game.map.containers, index = boxes.findIndex(box => box.id === message.containerId);
    if (message.container) {
      if (index < 0) boxes.push(message.container);else boxes[index] = message.container;
    } else if (index >= 0) boxes.splice(index, 1);
    this.render();return true;
  }

  showResult(message) {
    const reasons = { full: '空间不足，物品留在原处', 'missing-item': '物品已被其他队员取走',
      'out-of-range': '距离箱子太远', 'stale-request': '操作已过期，请重新选择' };
    if (!message.accepted) this.game.ui.showToast(reasons[message.reason] || '无法完成取放，物品未转移');
    this.selected = null;
  }

  applyResult(message) {
    const g = this.game;
    if (message.missionId !== g.state.missionFxId || message.inventoryRevision < (g.state.inventoryRevision || 0)) return false;
    g.state.inventoryRevision = message.inventoryRevision;
    g.state.inventory = message.inventory;
    g.state.loot = message.inventory.length;
    g.state.lootValue = message.inventory.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
    g._bindBackpackInventories();g.updateInventoryUI();
    this.showResult(message);this.render();return true;
  }

  export() { return { revision: this.revision, containers: structuredClone(this.game.map.containers) }; }
  restore(data) {
    if (!data || !Array.isArray(data.containers) || data.revision < this.revision) return false;
    this.revision = data.revision;
    this.game.map.containers.splice(0, this.game.map.containers.length, ...data.containers);
    this.render();return true;
  }

  dropItems(items, actor) {
    const g = this.game, boxes = [];
    let box, grid;
    for (const source of items) {
      const item = { ...source };delete item.quickUse;
      if (!grid || !grid.place(item)) {
        box = { id: `drop_${g.state.missionFxId}_${++this.bagSequence}`, x: actor.x, y: actor.y,
          fixed: false, revision: 1, items: [] };
        grid = ContainerTransactions.inventory(box);
        if (!grid.place(item)) throw new Error('物资无法放入回收包');
        g.map.containers.push(box);boxes.push(box);
      }
    }
    if (boxes.length) this.revision++;
    for (const created of boxes) this.broadcastBox(created.id);
    return boxes;
  }

  bindUI() {
    this.panel = document.getElementById('lootContainerPanel');
    this.overlay = document.getElementById('inventoryOverlay');
    this.grid = document.getElementById('lootContainerGrid');
    this.packGrid = document.getElementById('inventoryGrid');
    document.getElementById('lootTransferButton')?.addEventListener('click', () => this.transferSelected());
    document.getElementById('lootRotateButton')?.addEventListener('click', () => this.rotateSelected());
    for (const [kind, grid] of [['bag', this.packGrid], ['crate', this.grid]]) {
      grid?.addEventListener('pointerdown', event => this.startDrag(event, kind), true);
      grid?.addEventListener('contextmenu', event => {
        if (!this.game.state.lootContainerId) return;
        event.preventDefault();event.stopImmediatePropagation();this.rotateSelected();
      }, true);
    }
    document.addEventListener('pointermove', event => this.moveDrag(event));
    document.addEventListener('pointerup', event => this.endDrag(event));
    document.addEventListener('keydown', event => {
      if (this.game.state.lootContainerId && event.key.toLowerCase() === 'r') {
        event.preventDefault();event.stopImmediatePropagation();if (!event.repeat) this.rotateSelected();
      }
    }, true);
  }

  currentBox() { return this.game.map.containers.find(box => box.id === this.game.state.lootContainerId); }
  manager(kind) { const box = this.currentBox();return kind === 'bag' ? this.game.backpack : box && ContainerTransactions.inventory(box); }

  render() {
    if (!this.panel) return;
    const box = this.currentBox();
    this.panel.hidden = !box;this.overlay.classList.toggle('has-container', !!box);
    if (!box || this.drag) return;
    const grid = this.grid, manager = this.manager('crate'), size = manager.cellSize, gap = manager.gap;
    document.getElementById('lootContainerTitle').textContent = box.fixed ? '物资箱' : '物资包';
    document.getElementById('lootContainerCount').textContent = `${manager.items.length} 件 · ${manager.usedCells()} / 36 格`;
    grid.style.setProperty('--bp-cell', `${size}px`);grid.style.setProperty('--bp-gap', `${gap}px`);
    Object.assign(grid.style, { gap: `${gap}px`, padding: `${gap}px`, gridTemplateColumns: `repeat(6, ${size}px)`, gridTemplateRows: `repeat(6, ${size}px)` });
    grid.replaceChildren();
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) {
      const cell = document.createElement('div');cell.className = 'bp-cell';
      Object.assign(cell.style, { gridColumn: `${x + 1}`, gridRow: `${y + 1}`, width: `${size}px`, height: `${size}px` });grid.appendChild(cell);
    }
    for (const item of manager.items) {
      const tile = document.createElement('div');tile.className = `bp-item rarity-${item.rarity || 'common'}${this.selected?.kind === 'crate' && this.selected.id === item.id ? ' selected' : ''}`;tile.dataset.itemId = item.id;
      tile.title = item.name || '物资';const matrix = manager.matrixFor(item);
      this.game._placeItemElement(tile, item.gx, item.gy, matrix, manager);
      this.game._renderTileBlocks(tile, item, matrix, manager, 'lootContainerGrid');grid.appendChild(tile);
    }
    const transfer = document.getElementById('lootTransferButton');transfer.disabled = !this.selected;
    transfer.textContent = this.selected?.kind === 'bag' ? '存入箱子' : '取出到背包';
    document.getElementById('lootRotateButton').disabled = !this.selected;
    if (!box.items.length) document.getElementById('lootContainerCount').textContent = '空箱 · 可以存入物资';
  }

  transferSelected() {
    if (this.selected) this.request(this.selected.kind === 'bag' ? 'deposit' : 'take', this.selected.id);
  }

  rotateSelected() {
    if (this.drag) {
      const height = this.manager(this.drag.kind).matrixFor(this.drag.item, this.drag.rot).length;
      [this.drag.grabX, this.drag.grabY] = [height - 1 - this.drag.grabY, this.drag.grabX];
      this.drag.rot = (this.drag.rot + 1) % 4;this.drag.moved = true;
      this.updateDragPreview();return;
    }
    const selected = this.selected;if (!selected) return;
    const manager = this.manager(selected.kind), item = manager?.getItem(selected.id);if (!item) return;
    if (selected.kind === 'crate') this.request('move', item.id, { gx: item.gx, gy: item.gy, rot: (item.rot + 1) % 4 });
    else { this.game.selectedItemId = item.id;this.game.rotateItem(item.id); }
    this.render();
  }

  _isDoubleTap(kind, id, event) {
    const now = Number.isFinite(event.timeStamp) ? event.timeStamp : Date.now();
    const last = this.lastTap;
    this.lastTap = { kind, id, x: event.clientX, y: event.clientY, at: now };
    if (!last || last.kind !== kind || String(last.id) !== String(id) || now - last.at > 350 ||
        Math.hypot(last.x - event.clientX, last.y - event.clientY) > 10) return false;
    this.lastTap = null;
    return true;
  }

  startDrag(event, kind) {
    if (!this.game.state.lootContainerId || event.button !== 0) return;
    const tile = event.target.closest('.bp-item');if (!tile) return;
    const item = this.manager(kind)?.getItem(tile.dataset.itemId);if (!item) return;
    event.preventDefault();event.stopImmediatePropagation();
    if (this._isDoubleTap(kind, item.id, event)) {
      this.cancelDrag();
      this.selected = { kind, id: item.id };
      this.request(kind === 'bag' ? 'deposit' : 'take', item.id);
      return;
    }
    this.selected = { kind, id: item.id };
    this.game.selectedItemId = kind === 'bag' ? item.id : null;
    for (const [side, grid] of [['bag', this.packGrid], ['crate', this.grid]]) {
      grid?.querySelectorAll('.bp-item').forEach(tile => tile.classList.toggle('selected', side === kind && tile.dataset.itemId === String(item.id)));
    }
    if (this.panel) this.game._updateBackpackReadout();
    const manager = this.manager(kind), rect = tile.getBoundingClientRect();
    const cellRatio = rect.width / (manager.sizeFor(item).w * manager.pitch - manager.gap);
    this.drag = { kind, item, rot: item.rot || 0, startX: event.clientX, startY: event.clientY,
      x: event.clientX, y: event.clientY, moved: false,
      grabX: Math.floor((event.clientX - rect.left) / (manager.pitch * cellRatio)),
      grabY: Math.floor((event.clientY - rect.top) / (manager.pitch * cellRatio)) };
    const transfer = document.getElementById('lootTransferButton');transfer.disabled = false;
    transfer.textContent = kind === 'bag' ? '存入箱子' : '取出到背包';document.getElementById('lootRotateButton').disabled = false;
  }

  moveDrag(event) {
    if (!this.drag) return;
    this.drag.x = event.clientX;this.drag.y = event.clientY;
    if (Math.hypot(event.clientX - this.drag.startX, event.clientY - this.drag.startY) > 5) this.drag.moved = true;
    if (this.drag.moved) { this.lastTap = null;this.overlay.classList.add('is-loot-dragging');this.updateDragPreview(); }
  }

  updateDragPreview() {
    const drag = this.drag;if (!drag) return;
    const manager = this.manager(drag.kind), matrix = manager.matrixFor(drag.item, drag.rot);
    if (!this.dragPreview) {
      this.dragPreview = document.createElement('div');this.dragPreview.className = `bp-item loot-drag-preview rarity-${drag.item.rarity || 'common'}`;
      this.dragPreview.setAttribute('aria-hidden', 'true');document.body.append(this.dragPreview);
    }
    Object.assign(this.dragPreview.style, { width: this.game._spanPx(matrix[0].length, manager), height: this.game._spanPx(matrix.length, manager),
      left: `${drag.x - (drag.grabX + 0.5) * manager.pitch}px`, top: `${drag.y - (drag.grabY + 0.5) * manager.pitch}px` });
    if (this._previewRotation !== drag.rot) {
      this.game._renderTileBlocks(this.dragPreview, { ...drag.item, rot: drag.rot }, matrix, manager, 'lootDragPreview');
      this._previewRotation = drag.rot;
    }
  }

  endDrag(event) {
    const drag = this.drag;if (!drag) return;
    this.drag = null;this.overlay.classList.remove('is-loot-dragging');
    this.dragPreview?.remove();this.dragPreview = null;this._previewRotation = null;
    if (!drag.moved) return;
    for (const [kind, grid] of [['bag', this.packGrid], ['crate', this.grid]]) {
      const rect = grid.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) continue;
      const manager = this.manager(kind), ratio = rect.width / (manager.cols * manager.pitch + manager.gap);
      const gx = Math.floor(((event.clientX - rect.left) / ratio - manager.gap) / manager.pitch) - drag.grabX;
      const gy = Math.floor(((event.clientY - rect.top) / ratio - manager.gap) / manager.pitch) - drag.grabY;
      if (kind === 'bag' && drag.kind === 'bag') {
        if (manager.moveItem(drag.item, gx, gy, drag.rot)) {
          this.game._tutorialAction('rearrange', { changed: true });this.game._syncGuestInventoryLayout();
        }
      } else this.request(kind === drag.kind ? 'move' : kind === 'bag' ? 'take' : 'deposit', drag.item.id, { gx, gy, rot: drag.rot });
      this.game.updateInventoryUI();this.render();break;
    }
  }

  cancelDrag() { this.drag = null;this.dragPreview?.remove();this.dragPreview = null;this._previewRotation = null;this.overlay?.classList.remove('is-loot-dragging'); }
}
