/** Explicit origin-to-origin profile replacement; network credentials never travel. */
class SaveProfile {
  static backupKey = 'voidshift_profile_backup_v1';
  static maxBytes = 2 * 1024 * 1024;
  static markers = ['flashbangInventoryVersion', 'skillInventoryMigrationVersion', 'starterGrantVersion',
    'balanceVersion', 'enemyCountMigrationVersion', 'playerFeedbackMigrationVersion'];

  static canTransfer(game) {
    const state = game?.state, coop = state?.coop;
    if (!state || state.running || state.transitioning || state.descentTimer != null || state.activeQte ||
        game.trainingSession || game._pendingRewardStart || game._rewardAccessConfirmation ||
        coop?.role || coop?.roomPending || coop?.running || coop?.code ||
        game.coopSession?.connected || game.coopSession?.roomCode || game.coopSession?.memberId ||
        game.rewards?.flushing || game.rewards?.unsavedLocalReceipts?.size) return false;
    try {
      const pending = JSON.parse(localStorage.getItem('voidshift_reward_pending') || '{}');
      this.object(pending);
      for (const key of ['reports', 'claims', 'localReceipts']) {
        if (pending[key] != null && Object.keys(this.object(pending[key])).length) return false;
      }
      return Object.values(this.object(pending.missions || {})).every(mission => mission?.registered === true);
    } catch (_) { return false; }
  }

  static requireIdle(game) {
    if (!this.canTransfer(game)) throw new Error('请先结束任务、退出联机房间并等待奖励结算完成，再转移个人档案');
  }

  static export(game) {
    return SaveRewards.locked(() => {
      this.requireIdle(game);
      const profile = this.profile(SaveRewards.read(), false);
      const serialized = JSON.stringify({ format: 'voidshift-profile', version: 1, exportedAt: Date.now(), profile }, null, 2);
      this.bounded(serialized);
      return serialized;
    });
  }

  static import(serialized, game) {
    let data;
    try {
      this.bounded(serialized);
      const file = this.object(JSON.parse(serialized));
      if (file.format !== 'voidshift-profile' || file.version !== 1) throw new Error('档案格式或版本不支持');
      this.integer(file.exportedAt);
      data = this.profile(file.profile, true);
    } catch (error) { return Promise.reject(error); }
    return SaveRewards.locked(() => {
      this.requireIdle(game);
      const journal = { money: data.money, rewardCreditsTotal: data.rewardCreditsTotal, dailyRewardDate: data.dailyRewardDate,
        appliedRewardReceipts: data.appliedRewardReceipts, profileMissions: data.profileMissions,
        profileDefeats: data.profileDefeats, advancedUnlocked: data.advancedUnlocked };
      return this.replace({ save: JSON.stringify(data), journal: JSON.stringify(journal) });
    });
  }

  static restoreBackup(game) {
    return SaveRewards.locked(() => {
      this.requireIdle(game);
      const raw = localStorage.getItem(this.backupKey);
      if (!raw) throw new Error('当前网址没有可恢复的个人档案备份');
      const backup = this.object(JSON.parse(raw));
      if (backup.version !== 1) throw new Error('个人档案备份版本不支持');
      const target = backup.restoreTarget ? this.object(backup.restoreTarget) : backup;
      for (const key of ['save', 'journal']) if (target[key] !== null) this.bounded(target[key]);
      return this.replace(target, true);
    });
  }

  static replace(next, restoring = false) {
    const previous = { version: 1, createdAt: Date.now(), save: localStorage.getItem(SaveRewards.key),
      journal: localStorage.getItem(SaveRewards.journalKey) };
    for (const key of ['save', 'journal']) if (previous[key] !== null) this.bounded(previous[key]);
    const backup = JSON.stringify({ ...previous, ...(restoring ? { restoreTarget: { save: next.save, journal: next.journal } } : {}) });
    // Both profile keys are recoverable before the first replacement write.
    localStorage.setItem(this.backupKey, backup);
    if (localStorage.getItem(this.backupKey) !== backup) throw new Error('备份未能保存，个人档案未被替换');
    try {
      this.writePair(next);
      // Keep the original restore target until both writes have succeeded.
      if (restoring) localStorage.setItem(this.backupKey, JSON.stringify(previous));
    }
    catch (error) {
      try { this.writePair(previous); }
      catch (_) { throw new Error('档案替换失败，自动恢复未完成；已保留备份，请恢复浏览器存储权限后使用恢复备份'); }
      throw new Error('档案替换失败，已恢复原个人档案；请检查浏览器存储空间');
    }
    return { reloadRequired: true };
  }

  static writePair(data) {
    for (const [field, key] of [['journal', SaveRewards.journalKey], ['save', SaveRewards.key]]) {
      if (data[field] === null) localStorage.removeItem(key);
      else localStorage.setItem(key, data[field]);
    }
    if (localStorage.getItem(SaveRewards.key) !== data.save || localStorage.getItem(SaveRewards.journalKey) !== data.journal) {
      throw new Error('个人档案写入校验失败');
    }
  }

  static bounded(value) {
    if (typeof value !== 'string' || value.length > this.maxBytes || new TextEncoder().encode(value).length > this.maxBytes) {
      throw new Error('个人档案必须是 2 MiB 以内的 JSON 文件');
    }
    return value;
  }
  static object(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('个人档案对象格式无效');
    return value;
  }
  static integer(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error('个人档案数值无效');
    return value;
  }
  static boolean(value) {
    if (typeof value !== 'boolean') throw new Error('个人档案状态无效');
    return value;
  }
  static choice(value, choices) {
    if (!choices.includes(value)) throw new Error('个人档案选项无效');
    return value;
  }
  static text(value, max = 512) {
    if (typeof value !== 'string' || !value || value.length > max || /[\u0000-\u001f]/.test(value) ||
        ['__proto__', 'constructor', 'prototype'].includes(value)) throw new Error('个人档案标识无效');
    return value;
  }
  static record(source, validate) {
    const entries = Object.entries(this.object(source));
    if (entries.length > 20000) throw new Error('个人档案记录过多');
    return Object.fromEntries(entries.map(([id, value]) => [this.text(id), validate(value)]));
  }

  static profile(source, strict) {
    const data = this.object(source);
    if (strict) for (const key of ['money', 'rewardCreditsTotal', 'dailyRewardDate', 'appliedRewardReceipts',
      'profileMissions', 'profileDefeats', 'advancedUnlocked', 'armoryVersion', 'armory', 'backpackItems',
      'storageItems', 'storageOverflowItems', 'storageCapacityCells', ...this.markers]) {
      if (!Object.hasOwn(data, key)) throw new Error(`个人档案缺少必要字段：${key}`);
    }
    const value = (key, fallback) => strict ? data[key] : data[key] ?? fallback;
    const profile = {
      money: this.integer(value('money', 1000)), rewardCreditsTotal: this.integer(value('rewardCreditsTotal', 0)),
      dailyRewardDate: value('dailyRewardDate', null),
      appliedRewardReceipts: this.record(value('appliedRewardReceipts', {}), expiry => this.integer(expiry)),
      profileMissions: this.record(value('profileMissions', {}), entry => {
        this.object(entry);
        const mission = { difficulty: this.choice(entry.difficulty, ['easy', 'medium', 'hard']),
          outcome: this.choice(entry.outcome, [null, 'success', 'failure']) };
        if (entry.context != null) {
          const context = this.object(entry.context);
          mission.context = { solo: this.boolean(context.solo), standard: this.boolean(context.standard) };
          if (context.scale != null) mission.context.scale = this.choice(context.scale, Object.keys(Config.mapScales));
          if (context.version != null) mission.context.version = this.integer(context.version, 0, 1000000);
        }
        return mission;
      }),
      profileDefeats: this.record(value('profileDefeats', {}), counts => {
        this.object(counts);
        return Object.fromEntries(['hunter', 'monster', 'heavy'].map(key => [key, this.integer(counts[key], 0, 1000000)]));
      }),
      advancedUnlocked: this.boolean(value('advancedUnlocked', false)), armoryVersion: 1,
      armory: this.armory(value('armory', Player.createDefaultArmory())),
      storageCapacityCells: this.integer(value('storageCapacityCells', Config.storage.capacityCells), Config.storage.capacityCells, 100000)
    };
    if ((strict || data.armoryVersion != null) && data.armoryVersion !== 1) throw new Error('个人档案武器库版本不支持');
    if (profile.storageCapacityCells % Config.storage.cols) throw new Error('个人档案仓库容量无效');
    if (profile.dailyRewardDate !== null && (typeof profile.dailyRewardDate !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(profile.dailyRewardDate) ||
        new Date(`${profile.dailyRewardDate}T00:00:00Z`).toISOString().slice(0, 10) !== profile.dailyRewardDate)) {
      throw new Error('个人档案每日奖励日期无效');
    }
    for (const key of this.markers) profile[key] = this.integer(value(key, 0), 0, 1000000);
    profile.backpackItems = this.items(value('backpackItems', []), BackpackManager.fromType(Config.activeBackpack), strict);
    profile.storageItems = this.items(value('storageItems', []), new BackpackManager({ ...Config.storage,
      rows: profile.storageCapacityCells / Config.storage.cols }), strict);
    profile.storageOverflowItems = this.items(value('storageOverflowItems', []), null, strict);
    const storageIds = [...profile.storageItems, ...profile.storageOverflowItems].map(item => String(item.id));
    if (new Set(storageIds).size !== storageIds.length) throw new Error('个人档案仓库物资标识重复');
    for (const [key, choices] of Object.entries({ difficultyPreset: ['easy', 'medium', 'hard'], personalScale: Object.keys(Config.mapScales),
      fpsCap: ['30', '60', '90', '120', 'unlimited'], textureQuality: ['low', 'high'], corpseLimit: [40, 100, 200] })) {
      if (Object.hasOwn(data, key)) profile[key] = this.choice(data[key], choices);
    }
    for (const key of ['masterVolume', 'ambientVolume']) if (Object.hasOwn(data, key)) profile[key] = this.integer(data[key], 0, 100);
    if (Object.hasOwn(data, 'hideInteractionHints')) profile.hideInteractionHints = this.boolean(data.hideInteractionHints);
    if (data.difficultyProfiles != null) profile.difficultyProfiles = this.difficulties(data.difficultyProfiles);
    return profile;
  }

  static armory(source) {
    const data = this.object(source), owned = (field, catalog) => {
      const values = this.object(data[field]);
      return Object.fromEntries(Object.keys(catalog).map(id => [id, this.boolean(values[id])]));
    };
    const armory = { ownedWeapons: owned('ownedWeapons', Config.weapons), ownedSkills: owned('ownedSkills', Config.skills),
      ownedPassives: owned('ownedPassives', Config.passives), loadout: {}, weaponAmmo: {},
      activeSlot: this.choice(data.activeSlot, ['primary', 'sidearm']), standardAmmoUnits: this.integer(data.standardAmmoUnits) };
    if (!armory.ownedWeapons.pistol) throw new Error('个人档案必须保留基础手枪');
    this.object(data.loadout); this.object(data.weaponAmmo);
    for (const slot of ['primary', 'sidearm']) {
      const id = data.loadout[slot];
      if (id !== null && (!Object.hasOwn(Config.weapons, id) || Config.weapons[id].slot !== slot || !armory.ownedWeapons[id])) {
        throw new Error('个人档案武器槽无效');
      }
      armory.loadout[slot] = id;
    }
    if (!armory.loadout.sidearm || !armory.loadout[armory.activeSlot]) throw new Error('个人档案当前武器槽无效');
    for (const id of Object.keys(Config.weapons)) {
      const ammo = this.object(data.weaponAmmo[id]);
      armory.weaponAmmo[id] = { magazine: this.integer(ammo.magazine, 0, armory.ownedWeapons[id] ? Config.weapons[id].maxAmmo : 0),
        reserve: this.integer(ammo.reserve, 0, armory.ownedWeapons[id] ? Number.MAX_SAFE_INTEGER : 0) };
    }
    for (const [field, ownedField] of [['equippedSkill', 'ownedSkills'], ['equippedPassive', 'ownedPassives']]) {
      const id = data[field];
      if (id !== null && (!Object.hasOwn(armory[ownedField], id) || !armory[ownedField][id])) throw new Error('个人档案技能装备无效');
      armory[field] = id;
    }
    return armory;
  }

  static items(source, grid, strict) {
    if (!Array.isArray(source) || source.length > 10000) throw new Error('个人档案物资格式无效');
    const ids = new Set(), shapeGrid = grid || BackpackManager.fromType(Config.activeBackpack);
    return source.map(data => {
      this.object(data);
      const id = typeof data.id === 'number' ? this.integer(data.id, 1) : this.text(data.id);
      if (ids.has(String(id))) throw new Error('个人档案物资标识重复');
      ids.add(String(id));
      const item = { id, name: this.text(data.name, 128), value: this.integer(data.value),
        shape: this.choice(strict ? data.shape : data.shape || shapeGrid.shapeIdFor(data), Object.keys(Config.itemShapes)),
        rot: this.integer(data.rot ?? 0, 0, 3) };
      if (data.size != null) item.size = this.integer(data.size, 1, 3);
      if (data.rarity != null) item.rarity = this.choice(data.rarity, ['common', 'uncommon', 'rare', 'legendary']);
      if (data.purchasePrice != null) item.purchasePrice = this.integer(data.purchasePrice);
      if (data.type != null) item.type = this.choice(data.type, ['consumable', 'loot']);
      if (data.itemId != null) item.itemId = this.choice(data.itemId, Object.values(Config.consumables).map(value => value.id));
      if (data.effect != null) item.effect = this.choice(data.effect, Object.values(Config.consumables).map(value => value.effect));
      if (item.itemId && Object.values(Config.consumables).find(value => value.id === item.itemId).effect !== item.effect) {
        throw new Error('个人档案消耗品效果无效');
      }
      if (data.image != null) {
        const image = this.text(data.image);
        if (!/^resources\/images\/[a-zA-Z0-9_\-/]+\.(png|jpe?g|webp)$/.test(image) || image.includes('..')) throw new Error('个人档案物资图片无效');
        item.image = image;
      }
      if (data.quickUse != null) item.quickUse = this.boolean(data.quickUse);
      for (const key of ['gx', 'gy']) if (grid || data[key] != null) item[key] = this.integer(data[key], 0, 100000);
      if (grid) {
        if (!grid.canPlace(grid.matrixFor(item), item.gx, item.gy)) throw new Error('个人档案物资超出容量或位置重叠');
        grid.items.push(item);
      }
      return item;
    });
  }

  static difficulties(source) {
    this.object(source);
    const profiles = {};
    for (const difficulty of Object.keys(Config.difficultyPresets)) {
      const data = this.object(source[difficulty]); this.object(data.maps);
      const profile = { maps: {}, finalTerminalSpawnCount: this.integer(data.finalTerminalSpawnCount, 0, 200),
        finalTerminalSpawnInterval: this.integer(data.finalTerminalSpawnInterval, 1, 120) };
      for (const scale of Object.keys(Config.mapScales)) {
        const settings = this.object(data.maps[scale]);
        profile.maps[scale] = { hunters: this.integer(settings.hunters, 0, 200), hunterMaxHp: this.integer(settings.hunterMaxHp, 1, 100),
          hunterRespawnCount: this.integer(settings.hunterRespawnCount, 0, 200), hunterSpawnInterval: this.integer(settings.hunterSpawnInterval, 1, 120) };
      }
      profiles[difficulty] = profile;
    }
    return profiles;
  }
}
globalThis.SaveProfile = SaveProfile;
