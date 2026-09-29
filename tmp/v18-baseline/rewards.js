/** Device-local reward transactions and host-owned per-life defeat accounting. */
class SaveRewards {
  static key = 'voidshift_save';
  static journalKey = 'voidshift_reward_ledger';

  static read() {
    const raw = localStorage.getItem(this.key);
    const data = raw ? JSON.parse(raw) : {};
    const journal = JSON.parse(localStorage.getItem(this.journalKey) || '{}');
    const total = Math.max(Number(data.rewardCreditsTotal) || 0, Number(journal.rewardCreditsTotal) || 0);
    if (data.money != null || total > 0) data.money = (Number(data.money) || 0) + total - (Number(data.rewardCreditsTotal) || 0);
    data.rewardCreditsTotal = total;
    data.dailyRewardDate = [data.dailyRewardDate, journal.dailyRewardDate].filter(Boolean).sort().pop() || null;
    data.appliedRewardReceipts = { ...data.appliedRewardReceipts, ...journal.appliedRewardReceipts };
    data.profileMissions = { ...data.profileMissions, ...journal.profileMissions };
    return data;
  }

  static commit(data) {
    // Ordinary game saves never overwrite this journal. A stale tab can replace
    // the asset snapshot, but read() reapplies the missing credit delta and IDs.
    localStorage.setItem(this.journalKey, JSON.stringify({ money: data.money,
      rewardCreditsTotal: data.rewardCreditsTotal, dailyRewardDate: data.dailyRewardDate,
      appliedRewardReceipts: data.appliedRewardReceipts, profileMissions: data.profileMissions }));
    localStorage.setItem(this.key, JSON.stringify(data));
  }

  static day(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  static nextRefresh(date = new Date()) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  }

  static async locked(action) {
    // Web Locks is shared across same-origin tabs. Never use a racy localStorage
    // read/write "lock" when the browser cannot provide this guarantee.
    if (!globalThis.navigator?.locks) throw new Error('当前浏览器无法安全领取，请使用新版 Edge 或 Chrome');
    return navigator.locks.request('voidshift-reward-save', action);
  }

  static async claimDaily(date = new Date()) {
    return this.locked(() => {
      const data = this.read();
      const day = this.day(date);
      if (data.dailyRewardDate >= day) return { claimed: false, data };
      data.money = (Number(data.money) || 0) + 1000;
      data.rewardCreditsTotal = (Number(data.rewardCreditsTotal) || 0) + 1000;
      data.dailyRewardDate = day;
      this.commit(data);
      return { claimed: true, data };
    });
  }

  static async applyReceipt(receipt) {
    if (!receipt || typeof receipt.id !== 'string' || !receipt.id || !Number.isSafeInteger(receipt.amount) || receipt.amount < 0 ||
        receipt.amount !== receipt.baseReward * receipt.difficultyMultiplier * receipt.resultMultiplier || receipt.expiresAt <= Date.now()) {
      throw new Error('结算回执无效或已过期');
    }
    return this.locked(() => {
      const data = this.read();
      this.setProfileOutcome(data, receipt.missionId, receipt.outcome);
      data.appliedRewardReceipts ||= {};
      if (Object.hasOwn(data.appliedRewardReceipts, receipt.id)) { this.commit(data); return { applied: false, data }; }
      for (const [id, expiry] of Object.entries(data.appliedRewardReceipts)) {
        if (expiry < Date.now()) delete data.appliedRewardReceipts[id];
      }
      data.money = (Number(data.money) || 0) + receipt.amount;
      data.rewardCreditsTotal = (Number(data.rewardCreditsTotal) || 0) + receipt.amount;
      data.appliedRewardReceipts[receipt.id] = receipt.expiresAt;
      this.commit(data);
      return { applied: true, data };
    });
  }

  static restore(state, data) {
    state.rewardCreditsTotal = Number(data.rewardCreditsTotal) || 0;
    state.dailyRewardDate = typeof data.dailyRewardDate === 'string' ? data.dailyRewardDate : null;
    state.appliedRewardReceipts = { ...(data.appliedRewardReceipts || {}) };
    state.profileMissions = { ...(data.profileMissions || {}) };
  }

  static startProfileMission(id, difficulty) {
    if (typeof id !== 'string' || !id || !['easy','medium','hard'].includes(difficulty)) return Promise.resolve(false);
    return this.locked(() => {
      const data = this.read(); data.profileMissions ||= {};
      if (!Object.hasOwn(data.profileMissions,id)) data.profileMissions[id] = { difficulty, outcome:null };
      this.commit(data); return true;
    });
  }

  static setProfileOutcome(data, id, outcome) {
    const entry = data.profileMissions?.[id];
    if (!entry || entry.outcome || !['success','failure','quit','kicked','timeout'].includes(outcome)) return false;
    entry.outcome = outcome === 'success' ? 'success' : 'failure'; return true;
  }

  static settleProfileMission(id, outcome) {
    return this.locked(() => {
      const data = this.read(), changed = this.setProfileOutcome(data,id,outcome);
      if (changed) this.commit(data); return changed;
    });
  }

  static profileCounts() {
    const counts = {easy:{success:0,failure:0},medium:{success:0,failure:0},hard:{success:0,failure:0}};
    for (const entry of Object.values(this.read().profileMissions || {})) {
      if (counts[entry?.difficulty] && ['success','failure'].includes(entry.outcome)) counts[entry.difficulty][entry.outcome]++;
    }
    return counts;
  }

  static mergeForSave(state, stored) {
    const total = Math.max(Number(state.rewardCreditsTotal) || 0, Number(stored.rewardCreditsTotal) || 0);
    state.money += total - (Number(state.rewardCreditsTotal) || 0);
    state.rewardCreditsTotal = total;
    state.dailyRewardDate = [state.dailyRewardDate, stored.dailyRewardDate].filter(Boolean).sort().pop() || null;
    state.appliedRewardReceipts = { ...state.appliedRewardReceipts, ...stored.appliedRewardReceipts };
    state.profileMissions = { ...state.profileMissions, ...stored.profileMissions };
    return { rewardCreditsTotal: total, dailyRewardDate: state.dailyRewardDate, appliedRewardReceipts: state.appliedRewardReceipts, profileMissions: state.profileMissions };
  }
}

class DefeatLedger {
  constructor(missionId, playerIds) {
    this.missionId = missionId;
    this.players = new Map(playerIds.map(id => [id, { counts: { hunter: 0, monster: 0, heavy: 0 }, frozen: null }]));
    this.counted = new Set();
  }

  record(type, lifeOrCycleId, playerId, options = {}) {
    const player = this.players.get(playerId);
    const key = `${type}:${lifeOrCycleId}`;
    if (!player || player.frozen || options.temporary || !lifeOrCycleId || !Object.hasOwn(player.counts, type) || this.counted.has(key)) return false;
    this.counted.add(key);
    player.counts[type]++;
    return true;
  }

  freeze(playerId, outcome, difficulty) {
    const player = this.players.get(playerId);
    if (!player) return null;
    if (player.frozen) return player.frozen;
    const counts = { ...player.counts };
    const baseReward = counts.hunter * 10 + counts.monster * 30 + counts.heavy * 100;
    const difficultyMultiplier = difficulty === 'hard' ? 3 : difficulty === 'medium' ? 2 : 1;
    const resultMultiplier = outcome === 'success' ? 1 : 0.5;
    return player.frozen = { playerId, outcome, counts, baseReward, difficultyMultiplier, resultMultiplier,
      amount: baseReward * difficultyMultiplier * resultMultiplier };
  }
}
