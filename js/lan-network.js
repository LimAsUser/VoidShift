/** Same-origin LAN relay. Online rooms keep their existing WebRTC transport. */
(() => {
  let info = null, failure = null, issuedHostToken = null;
  let hostLobby = null;
  try {
    const saved = JSON.parse(sessionStorage.getItem('voidshift_lan_host_v20') || 'null');
    if (saved?.memberId === 'host' && typeof saved.hostToken === 'string' && saved.hostToken.length <= 128 &&
        typeof saved.code === 'string' && Number.isInteger(saved.generation)) {
      hostLobby = { ...saved, restored: true }; issuedHostToken = saved.hostToken;
    }
  } catch (_) {}
  const query = new URLSearchParams(globalThis.location?.search || '');
  const mode = query.get('mode') === 'lan' || query.get('lan') === '1' ? 'lan' : 'online';
  const fragment = new URLSearchParams((globalThis.location?.hash || '').slice(1));
  const suppliedKey = fragment.get('lan-host') || fragment.get('lan-host-key');
  const hostKey = typeof suppliedKey === 'string' && /^[a-f0-9]{64}$/i.test(suppliedKey) ? suppliedKey : null;
  if (fragment.has('lan-host') || fragment.has('lan-host-key')) {
    fragment.delete('lan-host'); fragment.delete('lan-host-key');
    globalThis.history?.replaceState(null, '', `${globalThis.location.pathname}${globalThis.location.search}${fragment.size ? `#${fragment}` : ''}`);
  }

  function parseAddress(value) {
    const text = String(value || '').trim();
    if (!text || text.length > 260 || /[\s/@?#\\]/.test(text)) throw new Error('请输入房主 IP:端口，例如 192.168.1.20:8787');
    const match = text.match(/^(\[[a-f0-9:]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::(\d{1,5}))?$/i);
    if (!match || match[1].includes('..')) throw new Error('地址格式无效，请使用 IP:端口');
    const host = match[1], port = Number(match[2] || 8787);
    if (port < 1 || port > 65535) throw new Error('端口必须介于 1 和 65535');
    if (/^\d+(?:\.\d+){3}$/.test(host) && host.split('.').some(part => Number(part) > 255)) throw new Error('IP 地址无效');
    const url = new URL(`http://${host}:${port}/game/index.html?mode=lan`);
    return { address: `${url.hostname}:${port}`, url: url.href };
  }

  const runtime = {
    mode, protocolVersion: 20, transport: 'LAN_WS_V20', parseAddress,
    get maxPlayers() { return info?.maxPlayers; },
    get verified() { return !!info; }, get info() { return info; }, get error() { return failure; },
    get canHost() { return mode === 'lan' && !!info && (!!hostKey || !!issuedHostToken && hostLobby?.code === info.room?.code); },
    get hostRefreshInterrupted() { return !!hostLobby?.restored && hostLobby.code === info?.room?.code && info.room.status === 'active'; },
    async refresh() {
      if (mode !== 'lan') return runtime;
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch('/api/lan/info', { cache: 'no-store', signal: controller.signal });
        const result = response.ok ? await response.json() : null;
        if (!result?.enabled || result.protocolVersion !== 20 || result.transport !== 'LAN_WS_V20' || result.maxPlayers !== 4) {
          throw new Error('此地址未提供兼容的 V20 LAN 服务，请启动房主 LAN 程序后重试');
        }
        info = Object.freeze(result); failure = null;
      } catch (error) {
        info = null;
        failure = new Error(error.name === 'AbortError' ? 'LAN 服务检查超时，请检查 IP、VPN 和防火墙后重试'
          : error.name === 'TypeError' ? '无法连接 LAN 服务，请确认房主程序、IP、VPN 与端口后重试' : error.message || 'LAN 服务无法连接');
      } finally { clearTimeout(timer); }
      return runtime;
    }
  };
  runtime.ready = mode === 'lan' ? runtime.refresh() : Promise.resolve(runtime);
  globalThis.LANRuntime = Object.freeze(runtime);

  class LanCoopSession extends CoopSession {
    constructor() {
      super();
      this.transport = 'lan'; this._sockets = {}; this._socketRevision = 0;
      this._stateLatest = new Map(); this._receivedSeq = new Map();
    }

    _credentialsKey() { return 'voidshift_lan_member_v20'; }
    _readCredentials() {
      try { return JSON.parse(sessionStorage.getItem(this._credentialsKey()) || 'null'); } catch (_) { return null; }
    }
    _storeCredentials() {
      try { sessionStorage.setItem(this._credentialsKey(), JSON.stringify({ code: this.roomCode, memberId: this.memberId, memberToken: this.memberToken })); } catch (_) {}
    }
    async _runtime(attempt) {
      this._stage(attempt, 'lan-info');
      await runtime.ready;
      if (!runtime.verified) await runtime.refresh();
      if (!runtime.verified) throw Object.assign(runtime.error || new Error('请从 LAN 服务页面连接'), { code: 'lan_unavailable', stage: 'lan-info' });
    }
    _applyCredentials(room) {
      if (room?.protocolVersion !== 20 || typeof room.code !== 'string' || !room.memberId || !room.memberToken ||
          !Number.isInteger(room.generation) || !Number.isInteger(room.slot) || room.slot < 1 || room.slot > 4 ||
          this.role === 'host' && !room.hostToken) throw this._connectionError('invalid_response', 'seat');
      this.roomCode = room.code; this.memberId = room.memberId; this.memberToken = room.memberToken;
      this.hostToken = this.role === 'host' ? room.hostToken : null;
      if (this.role === 'host') {
        issuedHostToken = room.hostToken; hostLobby = { ...room, restored: false };
        try { sessionStorage.setItem('voidshift_lan_host_v20', JSON.stringify(room)); } catch (_) {}
      }
      this.localSlot = room.slot; this._generation = room.generation; this._roomExpiresAt = room.expiresAt;
      if (this.role === 'guest') this._storeCredentials();
    }
    async host() {
      this.close(false); this._closed = false; this.role = 'host'; this._everConnected = false; this.connectionLog = [];
      this._createIntent ||= Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
      const attempt = this._makeAttempt();
      try {
        await this._runtime(attempt);
        await runtime.refresh();
        if (!runtime.verified) throw runtime.error;
        if (!runtime.canHost) throw Object.assign(new Error('只有房主电脑启动的 LAN 页面可以创建房间；队友请点击加入'), { code: 'forbidden', stage: 'room' });
        if (runtime.hostRefreshInterrupted) {
          await this._request('/api/lan/leave', { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ memberId: 'host', memberToken: issuedHostToken }) }, attempt, 'status');
          await runtime.refresh();
        }
        this._stage(attempt, 'room');
        const room = hostLobby?.restored && hostLobby.code === runtime.info.room?.code && runtime.info.room.status === 'lobby'
          ? { ...hostLobby, expiresAt: runtime.info.room.expiresAt }
          : await this._request('/api/lan/create', { method: 'POST', headers: { 'content-type': 'application/json',
            ...(issuedHostToken ? { 'x-room-host-token': issuedHostToken } : {}) },
            body: JSON.stringify({ hostKey, createIntent: this._createIntent }) }, attempt, 'room');
        this._applyCredentials(room);
        this._emit('room', { code: this.roomCode, role: this.role, memberId: 'host', slot: 1, maxPlayers: 4 });
        await this._connectSockets(attempt);
        this._stage(attempt, 'lobby', 'waiting');
        return this.roomCode;
      } catch (error) { this._stage(attempt, error.stage || attempt.stage, 'failed', error); throw error; }
    }
    async join(_code, credentials) {
      this.close(false); this._closed = false; this.role = 'guest'; this._everConnected = false; this.connectionLog = [];
      const attempt = this._makeAttempt();
      try {
        await this._runtime(attempt);
        await runtime.refresh();
        if (!runtime.verified) throw runtime.error;
        if (!runtime.info.room) throw Object.assign(new Error('房主尚未创建 LAN 房间，请稍后重试'), { code: 'room_not_found', stage: 'room' });
        if (runtime.info.room.status === 'finished') throw Object.assign(new Error('LAN 房间已结束，请等待房主重新创建房间'), { code: 'room_not_found', stage: 'room' });
        this.roomCode = runtime.info.room.code;
        if (this._joinIntentRoom !== this.roomCode) {
          this._joinIntentRoom = this.roomCode;
          this._joinIntent = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
        }
        const saved = credentials === undefined ? this._readCredentials() : credentials;
        const identity = saved?.code === this.roomCode ? { memberId: saved.memberId, memberToken: saved.memberToken } : { joinIntent: this._joinIntent };
        if (identity.memberId && identity.memberToken) { this.memberId = identity.memberId; this.memberToken = identity.memberToken; }
        this._stage(attempt, 'seat');
        const room = await this._request('/api/lan/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(identity) }, attempt, 'seat');
        this._applyCredentials(room);
        this._emit('room', { code: this.roomCode, role: this.role, memberId: this.memberId, slot: this.localSlot });
        await this._connectSockets(attempt);
        return this.roomCode;
      } catch (error) {
        const messages = { room_full: 'LAN 房间已满（最多 4 人）', reconnect_expired: '5 分钟重连期限已过，请退出并重新加入',
          room_not_found: 'LAN 房间不存在，请等待房主创建房间', member_removed: '房主已将你移出 LAN 房间' };
        if (messages[error.apiCode]) error.message = messages[error.apiCode];
        if (['reconnect_expired', 'member_removed'].includes(error.apiCode)) {
          try { sessionStorage.removeItem(this._credentialsKey()); } catch (_) {}
          this.memberId = null; this.memberToken = null;
        }
        this._stage(attempt, error.stage || attempt.stage, 'failed', error); throw error;
      }
    }
    get canRetryJoin() { return this.role === 'guest' && this.connectionStatus?.phase === 'failed' && !!this.roomCode &&
      (!!this.memberId && !!this.memberToken || !!this._joinIntent); }
    async retryJoin() {
      if (!this.canRetryJoin) return false;
      return this.join(null, this.memberId && this.memberToken ? { code: this.roomCode, memberId: this.memberId, memberToken: this.memberToken } : undefined);
    }
    _socketURL(channel) {
      const url = new URL(`/api/lan/ws/${channel}`, globalThis.location.href);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.search = new URLSearchParams({ code: this.roomCode, memberId: this.memberId, token: this.memberToken, generation: this._generation });
      return url.href;
    }
    _channelsOpen() { return this._sockets.state?.readyState === 1 && this._sockets.events?.readyState === 1; }
    _dropSockets() {
      this._socketRevision++;
      for (const socket of Object.values(this._sockets)) { try { socket.close(); } catch (_) {} }
      this._sockets = {}; clearInterval(this._stateFlushTimer); this._stateFlushTimer = null;
      this._stateLatest.clear(); this._receivedSeq.clear();
    }
    async _connectSockets(attempt) {
      this._dropSockets(); const revision = this._socketRevision, sessionId = this._sessionId;
      this._stage(attempt, 'lan-sockets');
      try {
        await this._withTimeout(() => Promise.all(['state', 'events'].map(channel => new Promise((resolve, reject) => {
          const socket = this._sockets[channel] = new WebSocket(this._socketURL(channel));
          const current = () => revision === this._socketRevision && this._isCurrentSession(sessionId);
          socket.addEventListener('open', () => { if (current()) resolve(); });
          socket.addEventListener('error', () => { if (current()) reject(this._connectionError('network', 'lan-sockets')); });
          socket.addEventListener('message', event => { if (current()) this._receive(channel, socket, event.data); });
          socket.addEventListener('close', event => {
            if (!current()) return;
            reject(this._connectionError('peer_failed', 'lan-sockets'));
            this._lostConnection(event.code);
          });
        }))), Math.max(1, attempt.deadline - Date.now()), attempt, () => this._connectionError('connect_timeout', 'lan-sockets'));
        if (revision !== this._socketRevision || !this._isCurrentSession(sessionId)) throw new DOMException('Connection cancelled', 'AbortError');
      } catch (error) {
        if (revision === this._socketRevision && this._isCurrentSession(sessionId)) {
          this._dropSockets(); this.connected = false;
          for (const record of this.peers.values()) { record.connected = false; record.disconnectedNotified = true; }
        }
        throw error;
      }
      this._stateFlushTimer = setInterval(() => this._flushLatestState(), 50);
      this._transportConnected = true;
      if (this.role === 'host') {
        this._reconnectStartedAt = 0;
        clearTimeout(this._reconnectTimer); this._reconnectTimer = null;
        clearTimeout(this._reconnectExpiryTimer); this._reconnectExpiryTimer = null;
        this._stage(null, 'lobby', 'waiting');
      }
      if (this.role === 'host' && !this._latencyTimer) this._latencyTimer = setInterval(() => this._sampleLatency(), 2000);
      this._updateConnected();
    }
    _receive(channel, socket, data) {
      let frame;
      try { frame = JSON.parse(data); } catch (_) { return; }
      if (Number.isSafeInteger(frame.seq)) {
        try { socket.send(JSON.stringify({ kind: 'ack', seq: frame.seq })); } catch (_) {}
        const key = `${channel}:${frame.fromId || 'server'}`, previous = this._receivedSeq.get(key) || 0;
        if (frame.seq <= previous) return;
        this._receivedSeq.set(key, frame.seq);
      }
      if (frame.kind === 'members' && channel === 'events') { this._applyMembers(frame.members || [], frame.status); return; }
      if (frame.kind === 'member-offline') {
        const record = this.peers.get(frame.memberId);
        if (record) { record.connected = false; record.disconnectedNotified = true; this._emit('member-disconnect', { memberId: record.id, slot: record.slot }); }
        this._updateConnected(); return;
      }
      if (frame.kind === 'kicked') {
        this._emit('member-removed', { memberId: this.memberId, reason: 'kicked' });
        this.close(false); try { sessionStorage.removeItem(this._credentialsKey()); } catch (_) {} return;
      }
      if (frame.kind === 'closed') {
        if (this.role === 'host') this._emit('status', { state: 'expired', message: 'LAN 房间已关闭' });
        else this._emit('member-removed', { memberId: this.memberId, reason: 'closed' });
        this.close(false); return;
      }
      if (frame.kind !== 'data' || typeof frame.payload !== 'string' || typeof frame.fromId !== 'string') return;
      const record = this.peers.get(frame.fromId);
      if (!record || this.role === 'guest' && frame.fromId !== 'host') return;
      try {
        let message = JSON.parse(frame.payload);
        if (message?.type === 'reliable-chunk' && channel === 'events') {
          record.chunkAssembler ||= new ReliableChunks(); message = record.chunkAssembler.accept(message);
        }
        if (!message || message.version !== COOP_PROTOCOL_VERSION || typeof message.type !== 'string') return;
        if (channel === 'events' && this._handleLatency(record, message)) return;
        this._emit('message', { channel, peerId: frame.fromId, message });
      } catch (_) { /* Malformed relay payloads do not enter gameplay. */ }
    }
    _applyMembers(members, status) {
      if (status) this._roomStatus = status;
      const roster = members.filter(member => member && typeof member.id === 'string' && Number.isInteger(member.slot) && member.slot >= 1 && member.slot <= 4).slice(0, 4);
      const visible = this.role === 'guest' ? roster.filter(member => member.id === 'host') : roster.filter(member => member.id !== 'host');
      const present = new Set(visible.map(member => member.id));
      for (const [id, record] of this.peers) if (!present.has(id)) { this.peers.delete(id); this._emit('member-removed', { memberId: id, slot: record.slot }); }
      for (const member of visible) {
        const existing = this.peers.get(member.id), wasConnected = !!existing?.connected;
        const record = existing || { id: member.id, role: this.role, connected: false, everConnected: false };
        Object.assign(record, { slot: member.slot, generation: member.generation, status: member.status, connected: member.status === 'connected',
          stateChannel: this._sockets.state, eventChannel: this._sockets.events });
        this.peers.set(member.id, record);
        if (record.connected && !wasConnected) {
          record.disconnectedNotified = false;
          if (this.role === 'host') this._emit('member-connected', { memberId: member.id, slot: member.slot, generation: member.generation, reconnected: record.everConnected });
          record.everConnected = true;
        } else if (!record.connected && wasConnected) { record.disconnectedNotified = true; this._emit('member-disconnect', { memberId: member.id, slot: member.slot }); }
      }
      this._emit('members', { members: roster.filter(member => member.id !== 'host') });
      this._updateConnected();
    }
    _updateConnected() {
      const wasConnected = this.connected;
      this.connected = this._channelsOpen() && (this.role === 'guest' ? !!this.peers.get('host')?.connected : [...this.peers.values()].some(record => record.connected));
      if (this.connected && !wasConnected) {
        this._everConnected = true; this._reconnectStartedAt = 0; clearTimeout(this._reconnectExpiryTimer);
        this._stage(null, 'connected', 'connected'); this._emit('connected', { role: this.role, code: this.roomCode, memberId: this.memberId });
      } else if (!this.connected && wasConnected) this._emit('disconnect', { state: 'disconnected', memberId: this.memberId });
    }
    _lostConnection(code) {
      const hadConnected = this._everConnected || this._transportConnected;
      this._dropSockets();
      for (const record of this.peers.values()) {
        if (record.connected && this.role === 'host') this._emit('member-disconnect', { memberId: record.id, slot: record.slot });
        record.connected = false; record.disconnectedNotified = true;
      }
      this.connected = false;
      if (hadConnected) this._emit('disconnect', { state: 'disconnected', memberId: this.memberId });
      if (!hadConnected || this._closed) return;
      this._reconnectStartedAt ||= Date.now();
      this._stage(null, 'lan-sockets', 'connecting', new Error(`LAN 连接中断（${code}），5 分钟内自动重连`));
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = setTimeout(() => this._reconnectLAN(), 1500);
    }
    async _reconnectLAN() {
      if (this._closed || this._reconnectInProgress) return;
      if (Date.now() - this._reconnectStartedAt >= COOP_RECONNECT_WINDOW_MS) {
        this._stage(null, 'lan-sockets', 'failed', new Error('5 分钟重连期限已过，请退出并重新加入房间'));
        if (this.role === 'host') this._emit('status', { state: 'expired', message: 'LAN 重连期限已过，请重新创建房间' });
        else this._emit('member-removed', { memberId: this.memberId });
        this.close(false); return;
      }
      this._reconnectInProgress = true;
      const attempt = this._makeAttempt(null, Math.min(Date.now() + COOP_JOIN_TIMEOUT_MS, this._reconnectStartedAt + COOP_RECONNECT_WINDOW_MS));
      try {
        if (this.role === 'guest') {
          const room = await this._request('/api/lan/join', { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ memberId: this.memberId, memberToken: this.memberToken }) }, attempt, 'seat');
          this._applyCredentials(room);
        }
        await this._connectSockets(attempt);
      } catch (error) {
        this._stage(attempt, error.stage || 'lan-sockets', 'connecting', error);
        this._dropSockets();
        if (!this._closed) this._reconnectTimer = setTimeout(() => this._reconnectLAN(), 2500);
      } finally { this._reconnectInProgress = false; }
    }
    _send(channel, type, payload, targetId = null) {
      const socket = this._sockets[channel];
      if (socket?.readyState !== 1) return 0;
      const records = this.role === 'guest' ? [this.peers.get('host')].filter(Boolean) : targetId ? [this.peers.get(targetId)].filter(Boolean) : [...this.peers.values()];
      if (!records.some(record => record.connected)) return 0;
      const envelope = { version: COOP_PROTOCOL_VERSION, type, ...payload };
      const messages = channel === 'events' ? ReliableChunks.encode(envelope, `${this.memberId}:${this._sessionId}:${this._transferSequence = (this._transferSequence || 0) + 1}`) : [JSON.stringify(envelope)];
      const frames = messages.map(message => JSON.stringify({ kind: 'data', payload: message, ...(targetId ? { targetId } : {}) }));
      if (channel === 'events' && Number(socket.bufferedAmount) + frames.reduce((sum, frame) => sum + new TextEncoder().encode(frame).length, 0) > 8 * 1024 * 1024) return 0;
      if (channel === 'state') {
        const buffered = Number(socket.bufferedAmount) || 0;
        this.diagnostics.maxStateBufferedAmount = Math.max(this.diagnostics.maxStateBufferedAmount, buffered);
        this._stateLatest.delete(targetId || '*');
        if (buffered > MAX_STATE_BUFFERED_BYTES) { this._stateLatest.set(targetId || '*', frames[0]); this.diagnostics.stateDropped++; return 0; }
      }
      try { for (const frame of frames) socket.send(frame); if (channel === 'state') this.diagnostics.stateSent++; return records.filter(record => record.connected).length; }
      catch (_) { return 0; }
    }
    _flushLatestState() {
      const socket = this._sockets.state;
      if (socket?.readyState !== 1 || Number(socket.bufferedAmount) > MAX_STATE_BUFFERED_BYTES) return;
      for (const [key, frame] of this._stateLatest) {
        try { socket.send(frame); this._stateLatest.delete(key); this.diagnostics.stateSent++; } catch (_) { return; }
      }
    }
    peerConnectionState(memberId) { return this.peers.get(memberId)?.connected && this._channelsOpen() ? 'connected' : 'disconnected'; }
    isPeerReady(memberId) { return !!this.peers.get(memberId)?.connected && this._channelsOpen(); }
    peerBufferedAmount(_memberId, channel = 'state') { return Number(this._sockets[channel === 'state' ? 'state' : 'events']?.bufferedAmount) || 0; }
    getConnectionDiagnostics() {
      return JSON.stringify({ protocol: COOP_PROTOCOL_VERSION, transport: 'LAN_WS_V20', role: this.role,
        phase: this.connectionStatus?.phase || 'idle', records: this.connectionLog }, null, 2);
    }
    async kickMember(memberId) {
      if (this.role !== 'host' || memberId === 'host' || !this.peers.has(memberId)) return false;
      await this._request('/api/lan/kick', { method: 'POST', headers: { 'content-type': 'application/json', 'x-room-host-token': this.hostToken }, body: JSON.stringify({ memberId }) }, null, 'status');
      return true;
    }
    setRoomStatus(status) {
      if (this.role !== 'host' || !this.roomCode || !['lobby', 'active', 'finished'].includes(status)) return false;
      this._roomStatus = status;
      this._request('/api/lan/status', { method: 'POST', headers: { 'content-type': 'application/json', 'x-room-host-token': this.hostToken }, body: JSON.stringify({ status }) }, null, 'status').catch(() => {});
      return true;
    }
    close(removeRoom = true) {
      if (removeRoom && this.memberId && this.memberToken) {
        this._releaseRoom('/api/lan/leave', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ memberId: this.memberId, memberToken: this.memberToken }) });
        if (this.role === 'guest') { try { sessionStorage.removeItem(this._credentialsKey()); } catch (_) {} }
      }
      this._closed = true; this._sessionId++;
      for (const cancel of [...this._pendingWork]) cancel();
      this._dropSockets(); clearInterval(this._latencyTimer); this._latencyTimer = null;
      clearTimeout(this._reconnectTimer); clearTimeout(this._reconnectExpiryTimer);
      this._reconnectInProgress = false; this._reconnectStartedAt = 0; this._transportConnected = false;
      this.peers.clear(); this.connected = false; this.roomCode = null; this.hostToken = null; this.memberId = null; this.memberToken = null;
      if (removeRoom) { this._createIntent = null; this._joinIntent = null; this._joinIntentRoom = null; }
    }
  }
  globalThis.LanCoopSession = LanCoopSession;
})();
