/** Persist before sending: room cleanup and page reload cannot erase reported rewards. */
class MissionRewardsClient {
  static key = 'voidshift_reward_pending';
  constructor(onReceipt = () => {}) { this.onReceipt = onReceipt;this.flushing = null;this.unsavedLocalReceipts = new Map(); }
  static token() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, '0')).join(''); }
  read() {
    const data = JSON.parse(localStorage.getItem(MissionRewardsClient.key) || '{}');
    return { missions: data.missions || {}, reports: data.reports || {}, claims: data.claims || {}, localReceipts: data.localReceipts || {} };
  }
  async edit(change) {
    return SaveRewards.locked(() => {
      const data = this.read();const result = change(data);
      localStorage.setItem(MissionRewardsClient.key, JSON.stringify(data));return result;
    });
  }
  async request(url, method, header, token, body) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, { method, signal: controller.signal, cache: 'no-store',
        headers: { 'content-type': 'application/json', [header]: token },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      const data = await response.json();
      if (!response.ok) throw Object.assign(new Error(data.error || '结算服务暂不可用'), { status: response.status });
      return data;
    } finally { clearTimeout(timer); }
  }
  async register({ missionId, roomCode, difficulty, playerIds }, hostToken) {
    const mission = await this.edit(data => {
      if (data.missions[missionId]) return data.missions[missionId];
      const registration = { missionId, roomCode, difficulty, reportToken: MissionRewardsClient.token(),
        participants: playerIds.map((playerId, index) => ({ playerId, name: index === 0 ? '房主' : `队员 ${index + 1}`, claimToken: MissionRewardsClient.token() })) };
      return data.missions[missionId] = { registration, hostToken, registered: false, createdAt: Date.now() };
    });
    await this.request('/api/missions', 'POST', 'x-room-host-token', mission.hostToken, mission.registration);
    await this.edit(data => { if (data.missions[missionId]) data.missions[missionId].registered = true; });
    const access = Object.fromEntries(mission.registration.participants.map(player => [player.playerId,
      { missionId, playerId: player.playerId, claimToken: player.claimToken }]));
    await this.rememberAccess(access.host);
    return { missionId, access };
  }
  async rememberAccess(access) {
    if (!access?.missionId || !access.playerId || !/^[a-f0-9]{64}$/.test(access.claimToken || '')) throw new Error('个人结算凭据缺失');
    return this.edit(data => { data.claims[`${access.missionId}.${access.playerId}`] = { ...access, createdAt: Date.now() }; });
  }
  async queueReport(missionId, players) {
    return this.edit(data => {
      if (!data.missions[missionId]) throw new Error('任务尚未登记，结算无法上报');
      for (const player of players) {
        const key = `${missionId}.${player.playerId}`;
        // Freeze the first report; replaying finish must not replace a departure.
        data.reports[key] ||= { missionId, playerId: player.playerId, outcome: player.outcome, counts: { ...player.counts } };
      }
    });
  }
  async queueLocalReceipt(receipt) {
    this.unsavedLocalReceipts.set(receipt.id, receipt);
    await this.edit(data => { data.localReceipts[receipt.id] ||= receipt; });
    this.unsavedLocalReceipts.delete(receipt.id);
  }

  flush() {
    if (this.flushing) return this.flushing;
    return this.flushing = this._flush().finally(() => { this.flushing = null; });
  }
  async _flush() {
    for (const receipt of this.unsavedLocalReceipts.values()) await this.queueLocalReceipt(receipt);
    for (const [id, receipt] of Object.entries(this.read().localReceipts)) {
      try {
        if (receipt.expiresAt <= Date.now()) { await this.edit(data => { delete data.localReceipts[id]; });continue; }
        const result = await SaveRewards.applyReceipt(receipt);
        await this.edit(data => { delete data.localReceipts[id]; });
        this.onReceipt(receipt, result);
      } catch (_) { /* Keep the saved receipt and retry after storage recovers. */ }
    }
    const initial = this.read();
    for (const [id, mission] of Object.entries(initial.missions)) {
      if (!mission.registered) {
        try {
          await this.request('/api/missions', 'POST', 'x-room-host-token', mission.hostToken, mission.registration);
          await this.edit(data => { if (data.missions[id]) data.missions[id].registered = true; });
        } catch (_) { continue; }
      }
      const reports = Object.entries(this.read().reports).filter(([, report]) => report.missionId === id);
      if (!reports.length) continue;
      try {
        await this.request(`/api/missions/${encodeURIComponent(id)}/reports`, 'PUT', 'x-mission-report-token',
          mission.registration.reportToken, { players: reports.map(([, report]) => ({ playerId: report.playerId, outcome: report.outcome, counts: report.counts })) });
        await this.edit(data => { for (const [key] of reports) delete data.reports[key]; });
      } catch (_) { /* Durable outbox remains pending; a later flush retries. */ }
    }
    for (const [key, access] of Object.entries(this.read().claims)) {
      try {
        const response = await this.request(`/api/missions/${encodeURIComponent(access.missionId)}/receipts/${encodeURIComponent(access.playerId)}`,
          'GET', 'x-mission-claim-token', access.claimToken);
        if (response.status !== 'complete') continue;
        const receipt = response.receipt;
        if (receipt.missionId !== access.missionId || receipt.playerId !== access.playerId) throw new Error('结算回执身份不符');
        const result = await SaveRewards.applyReceipt(receipt);
        await this.edit(data => { delete data.claims[key]; });
        this.onReceipt(receipt, result);
      } catch (error) {
        if (error.status === 410) await this.edit(data => { delete data.claims[key]; });
      }
    }
    // Completed server receipts expire after seven days; local tokens/outboxes
    // need not accumulate forever either. Leave a full extra day for long runs.
    const cutoff = Date.now() - 8 * 24 * 60 * 60 * 1000;
    await this.edit(data => {
      for (const [id, mission] of Object.entries(data.missions)) if (mission.createdAt < cutoff) {
        delete data.missions[id];
        for (const [key, report] of Object.entries(data.reports)) if (report.missionId === id) delete data.reports[key];
      }
      for (const [key, access] of Object.entries(data.claims)) if (access.createdAt < cutoff) delete data.claims[key];
    });
  }
}
