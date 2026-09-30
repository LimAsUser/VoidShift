const COOP_PROTOCOL_VERSION = 18;
const MAX_STATE_BUFFERED_BYTES = 64_000;
const COOP_MAX_GUESTS = 3;
const COOP_RECONNECT_WINDOW_MS = 5 * 60 * 1000;
const COOP_JOIN_TIMEOUT_MS = 60_000;
const COOP_REQUEST_TIMEOUT_MS = 8000;
const COOP_CONNECTION_STAGES = {
  room: '读取房间', seat: '申请席位', offer: '等待房主邀请',
  'create-offer': '生成连接邀请', 'upload-offer': '发送连接邀请',
  answer: '生成连接回应', 'upload-answer': '上传连接回应',
  ice: '收集网络地址', 'answer-wait': '等待队友回应', channels: '建立数据通道',
  connected: '已连接', lobby: '房间已创建，等待队友', status: '同步连接状态', members: '读取队员名单',
  'ice-config': '读取中继配置', transport: '检查传输连接'
};

class ReliableChunks {
  constructor() { this.pending = new Map(); this.completed = new Map(); }

  static encode(message, id) {
    const text = JSON.stringify(message), bytes = new TextEncoder().encode(text);
    if (bytes.length <= 32000) return [text];
    if (bytes.length > 4 * 1024 * 1024) throw new Error('Reliable state exceeds transfer budget');
    const size = 22000, count = Math.ceil(bytes.length / size), chunks = [];
    for (let index = 0; index < count; index++) {
      const part = bytes.subarray(index * size, (index + 1) * size);
      chunks.push(JSON.stringify({ type: 'reliable-chunk', version: COOP_PROTOCOL_VERSION, id, index, count,
        data: btoa(String.fromCharCode(...part)) }));
    }
    return chunks;
  }

  accept(message) {
    const now = Date.now();
    for (const [id, transfer] of this.pending) if (now - transfer.at > 15000) this.pending.delete(id);
    for (const [id, at] of this.completed) if (now - at > 30000) this.completed.delete(id);
    if (!message || typeof message.id !== 'string' || message.id.length > 120 || this.completed.has(message.id) ||
        !Number.isInteger(message.count) || message.count < 2 || message.count > 192 ||
        !Number.isInteger(message.index) || message.index < 0 || message.index >= message.count ||
        typeof message.data !== 'string' || message.data.length > 30000) return null;
    let bytes;
    try { bytes = Uint8Array.from(atob(message.data), character => character.charCodeAt(0)); }
    catch (_) { return null; }
    let transfer = this.pending.get(message.id);
    if (!transfer) {
      if (this.pending.size >= 4) this.pending.delete(this.pending.keys().next().value);
      this.pending.set(message.id, transfer = { count: message.count, parts: new Map(), size: 0, at: now });
    }
    if (transfer.count !== message.count) { this.pending.delete(message.id); return null; }
    if (!transfer.parts.has(message.index)) { transfer.parts.set(message.index, bytes); transfer.size += bytes.length; }
    if (transfer.size > 4 * 1024 * 1024) { this.pending.delete(message.id); return null; }
    if (transfer.parts.size !== transfer.count) return null;
    const merged = new Uint8Array(transfer.size);let offset = 0;
    for (let i = 0; i < transfer.count; i++) { const part = transfer.parts.get(i); merged.set(part, offset); offset += part.length; }
    this.pending.delete(message.id);
    this.completed.set(message.id, now);
    while (this.completed.size > 128) this.completed.delete(this.completed.keys().next().value);
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(merged)); }
    catch (_) { return null; }
  }
}

class CoopSession extends EventTarget {
  constructor() {
    super();
    this.role = null;
    this.roomCode = null;
    this.hostToken = null;
    this.memberId = null;
    this.memberToken = null;
    this.localSlot = 1;
    this.peers = new Map();
    this.connected = false;
    this._closed = false;
    this._sessionId = 0;
    this._roomExpiresAt = 0;
    this._roomStatus = 'lobby';
    this._lastLeaseRenewAt = 0;
    this._memberPollTimer = null;
    this._reconnectTimer = null;
    this._reconnectExpiryTimer = null;
    this._reconnectStartedAt = 0;
    this._reconnectInProgress = false;
    this._removedMembers = new Set();
    this._pendingWork = new Set();
    this.connectionLog = [];
    this.connectionStatus = null;
    this._everConnected = false;
    this.iceServers = null;
    this.turnConfigured = false;
    this.relayOnly = typeof URLSearchParams !== 'undefined' &&
      new URLSearchParams(globalThis.location?.search || '').get('relay') === '1';
    this.diagnostics = { stateSent: 0, stateDropped: 0, maxStateBufferedAmount: 0 };
  }

  _emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  _connectionError(code, stage, httpStatus = null) {
    const reasons = {
      network: '网络请求失败，未收到 HTTP 响应；请查看浏览器网络错误',
      request_timeout: '网络请求超时', connect_timeout: '连接超过 60 秒，请重试',
      invalid_response: '服务器回应无效', peer_failed: '玩家数据连接失败', turn_unavailable: 'TURN 尚未配置，无法进行仅中继测试',
      http: `服务器返回 HTTP ${httpStatus}`
    };
    return Object.assign(new Error(`${COOP_CONNECTION_STAGES[stage] || '联机'}：${reasons[code] || '连接失败'}`), {
      code, stage, httpStatus, uncertain: false
    });
  }

  _recordDiagnostic(stage, detail = {}, record = null) {
    // Healthy roster/offer polling must not evict the handshake and failure evidence.
    if (['members', 'offer'].includes(stage) && detail.httpStatus === 200 && !detail.retry && !detail.failure) return;
    const entry = { at: Date.now(), stage: COOP_CONNECTION_STAGES[stage] ? stage : 'status' };
    // Keep only bounded, non-secret fields. Never copy request bodies, errors or SDP.
    for (const key of ['httpStatus', 'retry', 'durationMs', 'complete', 'errorCode']) {
      if (typeof detail[key] === 'number' || typeof detail[key] === 'boolean') entry[key] = detail[key];
    }
    if (['network', 'request_timeout', 'connect_timeout', 'invalid_response', 'peer_failed', 'turn_unavailable', 'http'].includes(detail.failure)) entry.failure = detail.failure;
    if (['dns', 'timeout', 'authentication', 'unreachable', 'unspecified'].includes(detail.errorReason)) entry.errorReason = detail.errorReason;
    if (typeof detail.server === 'string' && /^(stun|turn|turns):[a-z0-9.-]+:\d+(\?transport=(udp|tcp))?$/i.test(detail.server)) entry.server = detail.server;
    if (record) {
      entry.slot = Number(record.slot) || (record.role === 'guest' ? this.localSlot : null);
      entry.generation = Number(record.generation) || 0;
      for (const key of ['connectionState', 'iceConnectionState', 'signalingState', 'iceGatheringState']) {
        entry[key] = String(record.peer[key] || '').replace(/[^a-z-]/g, '').slice(0, 32);
      }
      entry.stateChannel = record.stateChannel?.readyState || 'absent';
      entry.eventChannel = record.eventChannel?.readyState || 'absent';
      entry.dtlsState = String(record.peer.sctp?.transport?.state || 'unavailable').replace(/[^a-z-]/g, '').slice(0, 32);
      entry.sctpState = String(record.peer.sctp?.state || 'unavailable').replace(/[^a-z-]/g, '').slice(0, 32);
      if (record.selectedPath) entry.selectedPath = { ...record.selectedPath };
      entry.candidates = { host: record.candidates?.host || 0, srflx: record.candidates?.srflx || 0,
        prflx: record.candidates?.prflx || 0, relay: record.candidates?.relay || 0 };
    }
    this.connectionLog.push(entry);
    if (this.connectionLog.length > 50) {
      const priority = item => item.failure ? 2 : ['transport', 'members'].includes(item.stage) || item.stage === 'ice' && !item.complete ? 0 : 1;
      const lowest = Math.min(...this.connectionLog.map(priority));
      this.connectionLog.splice(this.connectionLog.findIndex(item => priority(item) === lowest), 1);
    }
  }

  getConnectionDiagnostics() {
    return JSON.stringify({ protocol: COOP_PROTOCOL_VERSION, role: this.role,
      connectionRevision: 1, iceTransportPolicy: this.relayOnly ? 'relay' : 'all', turnConfigured: this.turnConfigured,
      phase: this.connectionStatus?.phase || 'idle', records: this.connectionLog }, null, 2);
  }

  async _loadIceConfiguration(attempt) {
    this._stage(attempt, 'ice-config');
    const headers = this.role === 'host' ? { 'x-room-host-token': this.hostToken }
      : { 'x-room-member-id': this.memberId, 'x-room-member-token': this.memberToken };
    const result = await this._request(`/api/rooms/${this.roomCode}/ice`, { cache: 'no-store', headers }, attempt, 'ice-config');
    if (!this._isCurrentSession(attempt.sessionId) || attempt.cancelled) return;
    const validServer = server => server && typeof server.urls === 'string' &&
      /^(stun|turn|turns):[a-z0-9.-]+:\d+(\?transport=(udp|tcp))?$/i.test(server.urls) &&
      (!server.urls.startsWith('turn') || typeof server.username === 'string' && server.username.length > 0 && server.username.length <= 512 &&
        typeof server.credential === 'string' && server.credential.length > 0 && server.credential.length <= 512);
    if (!Array.isArray(result?.iceServers) || !result.iceServers.length || result.iceServers.length > 8 || !result.iceServers.every(validServer)) {
      throw this._connectionError('invalid_response', 'ice-config');
    }
    this.iceServers = result.iceServers.map(({ urls, username, credential }) => urls.startsWith('turn') ? { urls, username, credential } : { urls });
    this.turnConfigured = this.iceServers.some(server => server.urls.startsWith('turn'));
    if (this.relayOnly && !this.turnConfigured) throw this._connectionError('turn_unavailable', 'ice-config');
  }

  _watchTransports(record) {
    for (const transport of [record.peer.sctp, record.peer.sctp?.transport]) {
      if (!transport || record.observedTransports?.has(transport)) continue;
      (record.observedTransports ||= new WeakSet()).add(transport);
      transport.addEventListener?.('statechange', () => {
        if (!this._isCurrentPeer(record)) return;
        this._recordDiagnostic('transport', {}, record);
        this._captureTransportStats(record);
      });
    }
  }

  async _captureTransportStats(record) {
    if (record.statsPending || typeof record.peer.getStats !== 'function') return;
    record.statsPending = true;
    try {
      const stats = await record.peer.getStats();
      if (!this._isCurrentSession(record.sessionId) || this.peers.get(record.id) !== record) return;
      const values = [...stats.values()];
      const selected = values.find(stat => stat.type === 'transport' && stat.selectedCandidatePairId);
      const pair = selected ? stats.get(selected.selectedCandidatePairId) : values.find(stat => stat.type === 'candidate-pair' && stat.state === 'succeeded' && stat.nominated);
      if (pair) {
        const local = stats.get(pair.localCandidateId), remote = stats.get(pair.remoteCandidateId);
        const type = value => ['host', 'srflx', 'prflx', 'relay'].includes(value) ? value : 'unknown';
        const protocol = value => ['udp', 'tcp', 'tls'].includes(value) ? value : 'unknown';
        record.selectedPath = { localType: type(local?.candidateType), remoteType: type(remote?.candidateType),
          protocol: protocol(local?.protocol), relayProtocol: protocol(local?.relayProtocol) };
      }
      this._recordDiagnostic('transport', {}, record);
    } catch (_) { /* Diagnostics never block or change connectivity. */ }
    finally { record.statsPending = false; }
  }

  _withTimeout(work, ms, attempt = null, timeoutError = () => this._connectionError('request_timeout', attempt?.stage)) {
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      let settled = false, timer;
      const finish = (error, value) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        this._pendingWork.delete(cancel); attempt?.pending.delete(cancel);
        if (error) { controller.abort(); reject(error); } else resolve(value);
      };
      const cancel = error => finish(error || new DOMException('Connection cancelled', 'AbortError'));
      this._pendingWork.add(cancel); attempt?.pending.add(cancel);
      if (attempt?.cancelled || this._closed) { cancel(); return; }
      timer = setTimeout(() => finish(timeoutError()), Math.max(0, ms));
      Promise.resolve().then(() => settled ? undefined : work(controller.signal))
        .then(value => finish(null, value), error => finish(error));
    });
  }

  _delay(ms, attempt = null) {
    return this._withTimeout(signal => new Promise(resolve => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
    }), ms + 1, attempt);
  }

  async _request(url, options = {}, attempt = null, stage = 'room') {
    const method = options.method || 'GET';
    const retryable = method === 'GET' || method === 'PUT';
    const sessionId = this._sessionId;
    for (let retry = 0; ; retry++) {
      if (!this._isCurrentSession(sessionId) || attempt?.cancelled) throw new DOMException('Connection cancelled', 'AbortError');
      const remaining = (attempt?.deadline ?? Infinity) - Date.now();
      if (remaining <= 0) throw this._connectionError('connect_timeout', stage);
      const started = Date.now();
      let responseStatus = 200;
      try {
        const payload = await this._withTimeout(async signal => {
          const response = await fetch(url, { ...options, signal });
          responseStatus = response.status || 200;
          if (!response.ok) {
            const error = this._connectionError('http', stage, response.status);
            const body = typeof response.json === 'function' ? await response.json().catch(() => null) : null;
            const codes = ['room_full', 'reconnect_expired', 'room_not_found', 'member_not_found', 'member_removed', 'forbidden', 'stale_generation', 'stale_generation_or_sdp_conflict'];
            if (codes.includes(body?.error)) error.apiCode = body.error;
            const raw = response.headers?.get?.('retry-after');
            const seconds = raw == null ? NaN : Number(raw);
            error.retryAfter = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000
              : raw && Number.isFinite(Date.parse(raw)) ? Math.max(0, Date.parse(raw) - Date.now()) : 0;
            throw error;
          }
          try { return typeof response.json === 'function' ? await response.json() : {}; }
          catch (_) { throw this._connectionError('invalid_response', stage); }
        }, Math.min(COOP_REQUEST_TIMEOUT_MS, remaining), attempt,
        () => this._connectionError(remaining <= COOP_REQUEST_TIMEOUT_MS ? 'connect_timeout' : 'request_timeout', stage));
        if (!this._isCurrentSession(sessionId) || attempt?.cancelled) throw new DOMException('Connection cancelled', 'AbortError');
        this._recordDiagnostic(stage, { httpStatus: responseStatus, retry, durationMs: Date.now() - started }, attempt?.record);
        return payload;
      } catch (caught) {
        if (caught.name === 'AbortError' || !this._isCurrentSession(sessionId) || attempt?.cancelled) throw new DOMException('Connection cancelled', 'AbortError');
        const error = typeof caught.code === 'string' ? caught : this._connectionError('network', stage);
        error.uncertain = method === 'POST' && (!error.httpStatus || error.httpStatus >= 500);
        if (error.uncertain) error.message += '；操作结果未确认，不会自动重复提交';
        this._recordDiagnostic(stage, { httpStatus: error.httpStatus, retry, durationMs: Date.now() - started, failure: error.code }, attempt?.record);
        const transient = ['network', 'request_timeout'].includes(error.code) || [408, 429].includes(error.httpStatus) || error.httpStatus >= 500;
        if (!retryable || !transient || retry >= 2) throw error;
        const delay = Math.max(retry === 0 ? 500 : 1500, error.retryAfter || 0);
        if (Date.now() + delay >= (attempt?.deadline ?? Infinity)) throw error;
        await this._delay(delay, attempt);
      }
    }
  }

  _makeAttempt(record = null, deadline = Date.now() + COOP_JOIN_TIMEOUT_MS) {
    return { record, deadline, startedAt: Date.now(), sessionId: this._sessionId,
      pending: new Set(), cancelled: false, running: false, stage: 'room' };
  }

  _cancelAttempt(attempt, error) {
    if (!attempt) return;
    attempt.cancelled = true;
    for (const cancel of [...attempt.pending]) cancel(error);
  }

  async _runAttempt(attempt, work) {
    if (attempt.running) return work();
    attempt.running = true;
    try {
      return await this._withTimeout(work, attempt.deadline - Date.now(), attempt,
        () => this._connectionError('connect_timeout', attempt.stage));
    } catch (error) {
      this._cancelAttempt(attempt);
      throw error;
    } finally { attempt.running = false; }
  }

  _stage(attempt, stage, phase = 'connecting', error = null) {
    if (attempt && !this._isCurrentSession(attempt.sessionId)) return;
    const record = attempt?.record;
    if (record && !this._isCurrentPeer(record)) return;
    if (attempt) attempt.stage = stage;
    const detail = { peerId: record?.role === 'host' ? record.id : null,
      slot: record?.slot || this.localSlot, generation: record?.generation ?? this._generation ?? 0,
      stage, phase, message: error?.message || COOP_CONNECTION_STAGES[stage] || '正在连接',
      uncertain: !!error?.uncertain, elapsedMs: attempt ? Date.now() - attempt.startedAt : 0 };
    if (!detail.peerId) this.connectionStatus = detail;
    if (record) record.connectionStatus = detail;
    this._recordDiagnostic(stage, { failure: error?.code, httpStatus: error?.httpStatus, durationMs: detail.elapsedMs }, record);
    this._emit('connection-stage', detail);
  }

  _failAttempt(attempt, caught) {
    const record = attempt?.record;
    if (!this._isCurrentSession(attempt.sessionId) || record && !this._isCurrentPeer(record)) return;
    if (caught.name === 'AbortError') return;
    // Open data channels prove signaling reached the peer even if its HTTP reply was lost.
    if (record?.connected && record.peer.connectionState === 'connected' &&
        record.stateChannel?.readyState === 'open' && record.eventChannel?.readyState === 'open') {
      this._stage(attempt, 'connected', 'connected');
      return;
    }
    const error = typeof caught.code === 'string' ? caught : this._connectionError('peer_failed', attempt.stage);
    this._stage(attempt, attempt.stage, 'failed', error);
    if (record) this._closePeer(record, record.role === 'host');
    return error;
  }

  get canRetryJoin() {
    return this.role === 'guest' && !!this.roomCode && this.connectionStatus?.phase === 'failed' &&
      (!this.connectionStatus.uncertain || !!(this.memberId && this.memberToken));
  }

  retryJoin() {
    if (!this.canRetryJoin) return Promise.resolve(false);
    return this.join(this.roomCode, this.memberId && this.memberToken
      ? { memberId: this.memberId, memberToken: this.memberToken } : undefined);
  }

  _waitForConnection(record, attempt) {
    if (record.connected) return Promise.resolve();
    this._stage(attempt, record.role === 'host' && !record.peer.currentRemoteDescription ? 'answer-wait' : 'channels');
    return this._withTimeout(signal => new Promise((resolve, reject) => {
      const cleanup = () => { record.resolveConnection = null; record.rejectConnection = null; };
      record.resolveConnection = () => { cleanup(); resolve(); };
      record.rejectConnection = error => { cleanup(); reject(error); };
      signal.addEventListener('abort', cleanup, { once: true });
      if (record.connected) record.resolveConnection();
    }), attempt.deadline - Date.now(), attempt, () => this._connectionError('connect_timeout', attempt.stage));
  }

  _isCurrentSession(sessionId) {
    return !this._closed && sessionId === this._sessionId;
  }

  _isCurrentPeer(record) {
    return !!record && !record.closed && this._isCurrentSession(record.sessionId) && this.peers.get(record.id) === record;
  }

  _createPeerRecord(id, generation, role) {
    const peer = new RTCPeerConnection({
      iceServers: this.iceServers || [{ urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun.l.google.com:19302' }],
      iceTransportPolicy: this.relayOnly ? 'relay' : 'all'
    });
    const record = {
      id, generation, role, peer, sessionId: this._sessionId, stateChannel: null, eventChannel: null,
      connected: false, disconnectedNotified: false, closed: false,
      reconnected: generation > 0, reconnectTimer: null, candidates: { host: 0, srflx: 0, prflx: 0, relay: 0 }
    };
    this.peers.set(id, record);
    peer.addEventListener('connectionstatechange', () => this._handlePeerState(record));
    for (const event of ['iceconnectionstatechange', 'signalingstatechange']) peer.addEventListener(event, () => {
      if (!this._isCurrentPeer(record)) return;
      this._watchTransports(record);
      this._recordDiagnostic('transport', {}, record);
      if (event === 'iceconnectionstatechange') this._captureTransportStats(record);
    });
    peer.addEventListener('icecandidate', event => {
      if (!this._isCurrentPeer(record) || !event.candidate) return;
      const type = event.candidate.type || event.candidate.candidate?.match(/ typ (host|srflx|prflx|relay)(?: |$)/)?.[1];
      if (Object.hasOwn(record.candidates, type)) record.candidates[type]++;
    });
    peer.addEventListener('icecandidateerror', event => {
      if (!this._isCurrentPeer(record)) return;
      const server = this.iceServers?.find(item => item.urls === event.url)?.urls;
      const message = String(event.errorText || '');
      const errorReason = /resolve|dns/i.test(message) ? 'dns' : /timeout|timed out/i.test(message) ? 'timeout'
        : /unauthorized|authentication/i.test(message) ? 'authentication' : /unreach/i.test(message) ? 'unreachable' : 'unspecified';
      this._recordDiagnostic('ice', { errorCode: Number(event.errorCode), server, errorReason }, record);
    });
    return record;
  }

  _bindChannel(channel, record) {
    if (!this._isCurrentPeer(record)) { channel.close(); return; }
    if (channel.label.startsWith('state:')) record.stateChannel = channel;
    if (channel.label.startsWith('events:')) record.eventChannel = channel;
    channel.addEventListener('open', () => this._checkPeerConnected(record));
    channel.addEventListener('message', event => {
      if (!this._isCurrentPeer(record)) return;
      try {
        let message = JSON.parse(event.data);
        if (message?.type === 'reliable-chunk' && channel.label.startsWith('events:')) {
          record.chunkAssembler ||= new ReliableChunks();
          message = record.chunkAssembler.accept(message);
        }
        if (message && message.version === COOP_PROTOCOL_VERSION && typeof message.type === 'string') {
          if (channel.label.startsWith('events:') && this._handleLatency(record, message)) return;
          this._emit('message', {
            channel: channel.label.startsWith('state:') ? 'state' : 'events',
            peerId: record.role === 'host' ? record.id : 'host',
            message
          });
        }
      } catch (_) { /* ignore malformed peer data */ }
    });
  }

  _checkPeerConnected(record) {
    if (!this._isCurrentPeer(record) || record.peer.connectionState !== 'connected' ||
        record.stateChannel?.readyState !== 'open' || record.eventChannel?.readyState !== 'open') return;
    if (record.connected) return;
    record.connected = true;
    this._captureTransportStats(record);
    record.disconnectedNotified = false;
    clearTimeout(record.reconnectTimer);
    if (this.role === 'guest') {
      this._reconnectStartedAt = 0; this._everConnected = true;
      clearTimeout(this._reconnectExpiryTimer); this._reconnectExpiryTimer = null;
    }
    if (record.attempt) this._stage(record.attempt, 'connected', 'connected');
    record.resolveConnection?.();
    this.connected = this.role === 'guest'
      ? !!this.peers.get('host')?.connected
      : [...this.peers.values()].some(peer => peer.connected);
    this._setMemberStatus(record, 'connected');
    if (this.role === 'host' && !this._latencyTimer) {
      this._sampleLatency();
      this._latencyTimer = setInterval(() => this._sampleLatency(), 2000);
    }
    if (record.role === 'host') {
      this._emit('member-connected', {
        memberId: record.id, slot: record.slot, generation: record.generation,
        reconnected: record.reconnected
      });
    } else {
      this._emit('connected', { role: this.role, code: this.roomCode, memberId: this.memberId });
    }
  }

  _handlePeerState(record) {
    if (!this._isCurrentPeer(record)) return;
    this._watchTransports(record);
    this._recordDiagnostic('transport', {}, record);
    this._captureTransportStats(record);
    const state = record.peer.connectionState;
    if (state === 'connected') {
      this._checkPeerConnected(record);
      return;
    }
    if (!['disconnected', 'failed', 'closed'].includes(state) || record.disconnectedNotified) return;
    if (record.attempt?.running && !record.connected) {
      const error = this._connectionError('peer_failed', record.attempt.stage);
      this._cancelAttempt(record.attempt, error);
      return;
    }
    record.disconnectedNotified = true;
    record.connected = false;
    this.connected = this.role === 'guest'
      ? false
      : [...this.peers.values()].some(peer => peer.connected);
    this._setMemberStatus(record, 'offline');
    if (record.role === 'host') {
      this._emit('member-disconnect', { memberId: record.id, slot: record.slot, generation: record.generation, state });
      return;
    }
    this._emit('disconnect', { state, memberId: this.memberId });
    if (!this._everConnected) return;
    this._ensureReconnectWindow();
    clearTimeout(record.reconnectTimer);
    record.reconnectTimer = setTimeout(() => {
      if (this._isCurrentPeer(record)) this._beginReconnect();
    }, state === 'failed' || state === 'closed' ? 0 : 5000);
  }

  async _setMemberStatus(record, status) {
    if (!this.roomCode || !this._isCurrentPeer(record) || (this.role === 'host' && record.id === 'host')) return;
    const headers = { 'content-type': 'application/json' };
    let url;
    if (this.role === 'host') {
      headers['x-room-host-token'] = this.hostToken;
      url = `/api/rooms/${this.roomCode}/members/${record.id}`;
    } else {
      headers['x-room-member-token'] = this.memberToken;
      url = `/api/rooms/${this.roomCode}/members/${this.memberId}`;
    }
    try {
      this._cancelAttempt(record.statusAttempt);
      const attempt = record.statusAttempt = this._makeAttempt(record, Infinity);
      await this._request(url, { method: 'PATCH', headers, body: JSON.stringify({ status, generation: record.generation }) }, attempt, 'status');
    } catch (_) { /* room membership state is also tracked in memory */ }
  }

  async _waitForIce(peer, attempt = null) {
    let complete = peer.iceGatheringState === 'complete';
    if (!complete) complete = await this._withTimeout(signal => new Promise(resolve => {
      let timeout;
      const cleanup = () => { clearTimeout(timeout); peer.removeEventListener('icegatheringstatechange', handler); };
      const finish = value => { cleanup(); resolve(value); };
      const handler = () => { if (peer.iceGatheringState === 'complete') finish(true); };
      timeout = setTimeout(() => finish(false), 8000);
      peer.addEventListener('icegatheringstatechange', handler);
      signal.addEventListener('abort', cleanup, { once: true });
    // The inner eight-second cutoff yields partial candidates; only the attempt deadline is fatal.
    }), Math.max(0, (attempt?.deadline ?? Date.now() + COOP_JOIN_TIMEOUT_MS) - Date.now()), attempt,
    () => this._connectionError('connect_timeout', 'ice'));
    this._recordDiagnostic('ice', { complete }, attempt?.record);
    return complete;
  }

  async host() {
    this.close(false);
    this._closed = false;
    this.role = 'host';
    this._everConnected = false;
    this.connectionLog = [];
    this._createIntent ||= Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
    const attempt = this._makeAttempt();
    try {
      return await this._runAttempt(attempt, async () => {
        this._stage(attempt, 'room');
        const room = await this._request('/api/rooms', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ protocolVersion: COOP_PROTOCOL_VERSION, createIntent: this._createIntent })
        }, attempt, 'room');
        if (!room.code || !room.hostToken) throw Object.assign(this._connectionError('invalid_response', 'room'), { uncertain: true });
        this.roomCode = room.code;
        this.hostToken = room.hostToken;
        this._createIntent = null;
        this._roomExpiresAt = room.expiresAt || (Date.now() + 10 * 60 * 1000);
        this._roomStatus = 'lobby';
        this._emit('room', { code: this.roomCode, role: this.role, maxPlayers: COOP_MAX_GUESTS + 1 });
        await this._loadIceConfiguration(attempt);
        if (!this._isCurrentSession(attempt.sessionId) || attempt.cancelled) return;
        this._stage(attempt, 'lobby', 'waiting');
        this._pollForMembers();
        return this.roomCode;
      });
    } catch (caught) {
      const error = this._failAttempt(attempt, caught);
      if (error) throw error;
    }
  }

  async _createHostPeer(member) {
    const previous = this.peers.get(member.id);
    if (previous) this._closePeer(previous);
    const record = this._createPeerRecord(member.id, member.generation, 'host');
    record.slot = member.slot;
    const attempt = record.attempt = this._makeAttempt(record);
    try {
      await this._runAttempt(attempt, async () => {
        this._bindChannel(record.peer.createDataChannel(`state:${member.id}`, { ordered: false, maxRetransmits: 0 }), record);
        this._bindChannel(record.peer.createDataChannel(`events:${member.id}`, { ordered: true }), record);
        this._stage(attempt, 'create-offer');
        const offer = await record.peer.createOffer();
        if (!this._isCurrentPeer(record) || attempt.cancelled) return;
        await record.peer.setLocalDescription(offer);
        if (!this._isCurrentPeer(record) || attempt.cancelled) return;
        this._stage(attempt, 'ice');
        await this._waitForIce(record.peer, attempt);
        if (!this._isCurrentPeer(record) || attempt.cancelled) return;
        this._stage(attempt, 'upload-offer');
        await this._request(`/api/rooms/${this.roomCode}/members/${member.id}`, {
          method: 'PUT', headers: { 'content-type': 'application/json', 'x-room-host-token': this.hostToken },
          body: JSON.stringify({ generation: record.generation, offer: JSON.stringify(record.peer.localDescription) })
        }, attempt, 'upload-offer');
        await this._waitForConnection(record, attempt);
      });
    } catch (caught) {
      const error = this._failAttempt(attempt, caught);
      if (error) this._emit('member-error', { memberId: member.id, slot: member.slot, generation: record.generation, error });
    }
  }

  async _pollForMembers() {
    clearTimeout(this._memberPollTimer);
    if (this._closed || this.role !== 'host' || !this.roomCode) return;
    const sessionId = this._sessionId;
    try {
      if (this._roomStatus === 'active' && Date.now() - this._lastLeaseRenewAt > 60_000) this.setRoomStatus('active');
      if (Date.now() >= this._roomExpiresAt) {
        this._emit('status', { state: 'expired' });
        this.close(false);
        return;
      }
      const payload = await this._request(`/api/rooms/${this.roomCode}/members`, {
        cache: 'no-store', headers: { 'x-room-host-token': this.hostToken }
      }, null, 'members');
      if (!this._isCurrentSession(sessionId)) return;
      if (this.connectionStatus?.stage === 'members' && this.connectionStatus.phase === 'failed') {
        this._stage(null, 'lobby', 'waiting');
      }
      {
        const listed = new Set((payload.members || []).map(member => member.id));
        for (const member of payload.members || []) {
          let record = this.peers.get(member.id);
          if (member.status === 'removed') {
            if (record) this._closePeer(record);
            if (!this._removedMembers.has(member.id)) {
              this._removedMembers.add(member.id);
              this._emit('member-removed', { memberId: member.id, slot: member.slot });
            }
            continue;
          }
          if (!record || record.generation !== member.generation) {
            // Each peer has its own deadline; one slow ICE gather must not block the roster.
            this._createHostPeer(member).catch(error => {
              if (this._isCurrentSession(sessionId)) this._emit('member-error', { memberId: member.id, slot: member.slot, error });
            });
            record = this.peers.get(member.id);
          }
          if (record && !record.closed && member.answer_sdp && !record.peer.currentRemoteDescription && !record.applyingAnswer) {
            this._applyHostAnswer(record, member.answer_sdp);
          }
          if (record) record.slot = member.slot;
        }
        for (const [id, record] of this.peers) {
          if (!listed.has(id)) this._closePeer(record);
        }
        this._emit('members', { members: payload.members || [] });
      }
    } catch (error) {
      if (!this._isCurrentSession(sessionId) || error.name === 'AbortError') return;
      if (error.httpStatus === 404) {
        this._emit('status', { state: 'expired' }); this.close(false); return;
      }
      this._stage(null, 'members', 'failed', error);
      if ([401, 403, 410].includes(error.httpStatus)) return;
    }
    if (this._isCurrentSession(sessionId)) this._memberPollTimer = setTimeout(() => this._pollForMembers(), 700);
  }

  async _applyHostAnswer(record, sdp) {
    record.applyingAnswer = true;
    try {
      this._stage(record.attempt, 'channels');
      await this._withTimeout(() => record.peer.setRemoteDescription(JSON.parse(sdp)),
        record.attempt.deadline - Date.now(), record.attempt,
        () => this._connectionError('connect_timeout', 'channels'));
      if (this._isCurrentPeer(record)) this._watchTransports(record);
    } catch (_) {
      if (this._isCurrentPeer(record)) {
        const error = this._connectionError('peer_failed', 'channels');
        if (record.attempt.running) this._cancelAttempt(record.attempt, error);
        else this._failAttempt(record.attempt, error);
      }
    } finally { record.applyingAnswer = false; }
  }

  _memberStorageKey(code) { return `voidshift_coop_member_${code}`; }

  _readMemberCredentials(code) {
    try {
      return JSON.parse(sessionStorage.getItem(this._memberStorageKey(code)) || 'null');
    } catch (_) { return null; }
  }

  _storeMemberCredentials() {
    try {
      sessionStorage.setItem(this._memberStorageKey(this.roomCode), JSON.stringify({
        memberId: this.memberId, memberToken: this.memberToken
      }));
    } catch (_) { /* session reconnect remains available while this page stays open */ }
  }

  async join(code, credentials) {
    const normalizedCode = String(code || '').trim().toUpperCase();
    const previousCode = this.roomCode;
    this.close(false);
    this._closed = false;
    this.role = 'guest';
    this._everConnected = false;
    if (previousCode !== normalizedCode) this.connectionLog = [];
    this.roomCode = normalizedCode;
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(this.roomCode)) throw new Error('房间码无效');
    const attempt = this._makeAttempt();
    this.connectionStatus = null;
    try {
      return await this._runAttempt(attempt, async () => {
        this._stage(attempt, 'room');
        const room = await this._request(`/api/rooms/${this.roomCode}`, { cache: 'no-store' }, attempt, 'room');
        if (room.protocol_version !== COOP_PROTOCOL_VERSION) throw Object.assign(new Error('游戏版本不兼容，请双方刷新页面并重建房间'), { code: 'protocol_mismatch', stage: 'room' });
        this._roomExpiresAt = room.expires_at || Date.now() + 10 * 60 * 1000;
        await this._requestMemberSlot(credentials === undefined ? this._readMemberCredentials(this.roomCode) : credentials, attempt);
        if (!this._isCurrentSession(attempt.sessionId) || attempt.cancelled) return;
        this._emit('room', { code: this.roomCode, role: this.role, memberId: this.memberId, slot: this.localSlot });
        await this._connectGuestPeer(attempt);
        if (!this._isCurrentSession(attempt.sessionId) || attempt.cancelled) return;
        return this.roomCode;
      });
    } catch (caught) {
      const error = this._failAttempt(attempt, caught);
      if (error) throw error;
    }
  }

  async _requestMemberSlot(credentials = null, attempt = null) {
    const sessionId = attempt?.sessionId ?? this._sessionId;
    if (!this._isCurrentSession(sessionId)) return;
    if (credentials?.memberId && credentials?.memberToken) {
      this.memberId = credentials.memberId;
      this.memberToken = credentials.memberToken;
    }
    this._stage(attempt, 'seat');
    let member;
    try { member = await this._request(`/api/rooms/${this.roomCode}/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(credentials || {})
    }, attempt, 'seat'); } catch (error) {
      if (this._isCurrentSession(sessionId) && credentials && error.apiCode === 'reconnect_expired') {
        try { sessionStorage.removeItem(this._memberStorageKey(this.roomCode)); } catch (_) {}
      }
      if (error.apiCode === 'room_full') error.message = '房间已满（最多4人）';
      if (error.apiCode === 'reconnect_expired') error.message = '重连时间已过，无法回到本局';
      throw error;
    }
    if (!this._isCurrentSession(sessionId)) return;
    if (!member.memberId || !member.memberToken || !Number.isInteger(member.slot) || member.slot < 2 || member.slot > 4 || !Number.isInteger(member.generation)) {
      throw Object.assign(this._connectionError('invalid_response', 'seat'), { uncertain: true });
    }
    this.memberId = member.memberId;
    this.memberToken = member.memberToken;
    this.localSlot = member.slot;
    this._generation = member.generation;
    this._storeMemberCredentials();
  }

  async _connectGuestPeer(attempt = null) {
    const ownsAttempt = !attempt;
    attempt ||= this._makeAttempt();
    if (!this._isCurrentSession(attempt.sessionId)) return;
    await this._loadIceConfiguration(attempt);
    if (!this._isCurrentSession(attempt.sessionId) || attempt.cancelled) return;
    const previous = this.peers.get('host');
    if (previous) this._closePeer(previous);
    const record = this._createPeerRecord('host', this._generation, 'guest');
    record.attempt = attempt; attempt.record = record;
    record.peer.addEventListener('datachannel', event => this._bindChannel(event.channel, record));
    try {
      await this._runAttempt(attempt, async () => {
        this._stage(attempt, 'offer');
        while (this._isCurrentPeer(record) && !attempt.cancelled) {
          const member = await this._request(`/api/rooms/${this.roomCode}/members/${this.memberId}`, {
            cache: 'no-store', headers: { 'x-room-member-token': this.memberToken }
          }, attempt, 'offer');
          if (!this._isCurrentPeer(record) || attempt.cancelled) return;
          if (member.status === 'removed') throw Object.assign(this._connectionError('http', 'offer', 410), { apiCode: 'member_removed' });
          if (member.generation !== record.generation) throw this._connectionError('http', 'offer', 409);
          if (member.offer_sdp) {
            this._stage(attempt, 'answer');
            await record.peer.setRemoteDescription(JSON.parse(member.offer_sdp));
            if (!this._isCurrentPeer(record) || attempt.cancelled) return;
            const description = await record.peer.createAnswer();
            if (!this._isCurrentPeer(record) || attempt.cancelled) return;
            await record.peer.setLocalDescription(description);
            if (!this._isCurrentPeer(record) || attempt.cancelled) return;
            this._watchTransports(record);
            this._stage(attempt, 'ice');
            await this._waitForIce(record.peer, attempt);
            if (!this._isCurrentPeer(record) || attempt.cancelled) return;
            this._stage(attempt, 'upload-answer');
            await this._request(`/api/rooms/${this.roomCode}/members/${this.memberId}`, {
              method: 'PUT', headers: { 'content-type': 'application/json', 'x-room-member-token': this.memberToken },
              body: JSON.stringify({ generation: record.generation, answer: JSON.stringify(record.peer.localDescription) })
            }, attempt, 'upload-answer');
            await this._waitForConnection(record, attempt);
            return;
          }
          await this._delay(500, attempt);
        }
      });
    } catch (error) {
      // A failed await from an older generation must not tear down its replacement.
      if (!this._isCurrentPeer(record)) return;
      if (ownsAttempt) throw this._failAttempt(attempt, error) || error;
      else throw error;
    }
  }

  _ensureReconnectWindow() {
    if (!this._reconnectStartedAt) this._reconnectStartedAt = Date.now();
    if (this._reconnectExpiryTimer) return;
    const sessionId = this._sessionId;
    this._reconnectExpiryTimer = setTimeout(() => {
      if (this._isCurrentSession(sessionId)) this._expireReconnect();
    }, Math.max(0, this._reconnectStartedAt + COOP_RECONNECT_WINDOW_MS - Date.now()));
  }

  _expireReconnect() {
    if (!this._everConnected || this.connected) return;
    this._everConnected = false;
    clearTimeout(this._reconnectTimer); clearTimeout(this._reconnectExpiryTimer);
    this._reconnectExpiryTimer = null;
    this._cancelAttempt(this._reconnectAttempt);
    this._emit('member-removed', { memberId: this.memberId, slot: this.localSlot });
  }

  async _beginReconnect() {
    if (this.role !== 'guest' || this._closed || !this._everConnected || this._reconnectInProgress || !this.memberId) return;
    const sessionId = this._sessionId;
    this._reconnectInProgress = true;
    this._ensureReconnectWindow();
    if (Date.now() - this._reconnectStartedAt >= COOP_RECONNECT_WINDOW_MS) {
      this._reconnectInProgress = false;
      this._expireReconnect();
      return;
    }
    const attempt = this._reconnectAttempt = this._makeAttempt(null, Math.min(Date.now() + COOP_JOIN_TIMEOUT_MS, this._reconnectStartedAt + COOP_RECONNECT_WINDOW_MS));
    try {
      await this._runAttempt(attempt, async () => {
        await this._requestMemberSlot({ memberId: this.memberId, memberToken: this.memberToken }, attempt);
        if (!this._isCurrentSession(sessionId) || attempt.cancelled) return;
        await this._connectGuestPeer(attempt);
      });
    } catch (caught) {
      const error = this._failAttempt(attempt, caught);
      // A generation-changing POST may already have succeeded. Do not replay it blindly.
      if (!error || error.uncertain || [400, 401, 403, 404, 409, 410].includes(error.httpStatus)) return;
      if (this._isCurrentSession(sessionId)) this._reconnectTimer = setTimeout(() => {
        if (this._isCurrentSession(sessionId)) this._beginReconnect();
      }, 2000);
    } finally {
      if (this._isCurrentSession(sessionId)) this._reconnectInProgress = false;
      if (this._reconnectAttempt === attempt) this._reconnectAttempt = null;
    }
  }

  _closePeer(record, retain = false) {
    if (!record) return;
    record.closed = true;
    this._cancelAttempt(record.attempt);
    this._cancelAttempt(record.statusAttempt);
    clearTimeout(record.reconnectTimer);
    try { record.stateChannel?.close(); } catch (_) {}
    try { record.eventChannel?.close(); } catch (_) {}
    try { record.peer?.close(); } catch (_) {}
    if (!retain && this.peers.get(record.id) === record) this.peers.delete(record.id);
  }

  _send(channelName, type, payload, targetId = null) {
    const envelope = { version: COOP_PROTOCOL_VERSION, type, ...payload };
    const messages = channelName === 'events' ? ReliableChunks.encode(envelope,
      `${this._sessionId}:${this._transferSequence = (this._transferSequence || 0) + 1}`) : [JSON.stringify(envelope)];
    const records = this.role === 'guest'
      ? [this.peers.get('host')].filter(Boolean)
      : targetId ? [this.peers.get(targetId)].filter(Boolean) : [...this.peers.values()];
    let sent = 0;
    for (const record of records) {
      const channel = channelName === 'state' ? record.stateChannel : record.eventChannel;
      if (channel?.readyState !== 'open') continue;
      if (channelName === 'state') {
        const bufferedAmount = Number(channel.bufferedAmount) || 0;
        this.diagnostics.maxStateBufferedAmount = Math.max(this.diagnostics.maxStateBufferedAmount, bufferedAmount);
        if (bufferedAmount > MAX_STATE_BUFFERED_BYTES) {
          this.diagnostics.stateDropped++;
          continue;
        }
      }
      try {
        if (channelName === 'events' && Number(channel.bufferedAmount) > 4 * 1024 * 1024) continue;
        for (const message of messages) channel.send(message);
        sent++;
        if (channelName === 'state') this.diagnostics.stateSent++;
      } catch (_) { /* stale peer; status event handles recovery */ }
    }
    return sent;
  }

  latencies() {
    return Object.fromEntries([...this.peers.values()].map(record => [record.id,
      record.connected && Number.isFinite(record.rttMs) && Date.now() - record.rttAt < 6000 ? record.rttMs : null]));
  }

  _sampleLatency() {
    if (this.role !== 'host') return;
    for (const record of this.peers.values()) {
      if (!record.connected) continue;
      const seq = record.pingSeq = (record.pingSeq || 0) + 1;
      record.pingPending = { seq, at: Date.now() };
      this.sendEvent('net-ping', { seq }, record.id);
    }
    this._publishLatency();
  }

  _publishLatency() {
    const values = this.latencies();
    this._emit('latency', { values });
    this.sendEvent('net-latency', { values });
  }

  _handleLatency(record, message) {
    if (message.type === 'net-ping' && this.role === 'guest') {
      if (Number.isSafeInteger(message.seq)) this.sendEvent('net-pong', { seq: message.seq });
      return true;
    }
    if (message.type === 'net-pong' && this.role === 'host') {
      if (record.pingPending?.seq === message.seq) {
        record.rttMs = Math.max(0, Date.now() - record.pingPending.at);record.rttAt = Date.now();record.pingPending = null;
        this._publishLatency();
      }
      return true;
    }
    if (message.type === 'net-latency' && this.role === 'guest') { this._emit('latency', { values: message.values || {} });return true; }
    return false;
  }

  async kickMember(memberId) {
    if (this.role !== 'host' || !this.roomCode || memberId === 'host' || !this.peers.has(memberId)) return false;
    await this._request(`/api/rooms/${this.roomCode}/members/${encodeURIComponent(memberId)}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', 'x-room-host-token': this.hostToken },
      body: JSON.stringify({ status: 'removed' })
    }, null, 'status');
    return true;
  }

  sendState(type, payload) { return this._send('state', type, payload); }
  sendEvent(type, payload = {}, targetId = null) { return this._send('events', type, payload, targetId) > 0; }

  setRoomStatus(status) {
    if (this.role !== 'host' || !this.roomCode || !['lobby', 'active', 'finished'].includes(status)) return false;
    this._roomStatus = status;
    this._lastLeaseRenewAt = Date.now();
    const sessionId = this._sessionId;
    this._request(`/api/rooms/${this.roomCode}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-room-host-token': this.hostToken || '' },
      body: JSON.stringify({ status })
    }, null, 'status')
      .then(payload => { if (this._isCurrentSession(sessionId) && payload?.expiresAt) this._roomExpiresAt = payload.expiresAt; })
      .catch(() => {});
    return true;
  }

  _releaseRoom(url, options) {
    // Best-effort user-requested cleanup outlives cancellation, but is still bounded.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), COOP_REQUEST_TIMEOUT_MS);
    Promise.resolve().then(() => fetch(url, { ...options, keepalive: true, signal: controller.signal }))
      .catch(() => {}).finally(() => clearTimeout(timer));
  }

  async close(removeRoom = true) {
    clearInterval(this._latencyTimer);this._latencyTimer = null;
    if (removeRoom) this._createIntent = null;
    this._closed = true;
    this._sessionId++;
    for (const cancel of [...this._pendingWork]) cancel();
    this._reconnectInProgress = false;
    this._reconnectStartedAt = 0;
    clearTimeout(this._memberPollTimer);
    clearTimeout(this._reconnectTimer);
    clearTimeout(this._reconnectExpiryTimer); this._reconnectExpiryTimer = null;
    if (removeRoom && this.role === 'host' && this.roomCode) {
      this._releaseRoom(`/api/rooms/${this.roomCode}`, {
        method: 'DELETE',
        headers: { 'x-room-host-token': this.hostToken || '' }
      });
    } else if (removeRoom && this.role === 'guest' && this.memberId && this.memberToken) {
      this._releaseRoom(`/api/rooms/${this.roomCode}/members/${this.memberId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-room-member-token': this.memberToken },
        body: JSON.stringify({ status: 'removed', generation: this._generation })
      });
      try { sessionStorage.removeItem(this._memberStorageKey(this.roomCode)); } catch (_) {}
    }
    for (const record of this.peers.values()) this._closePeer(record);
    this.peers.clear();
    this.connected = false;
    this.roomCode = null;
    this.hostToken = null;
    this.memberId = null;
    this.memberToken = null;
    this.iceServers = null;
    this.turnConfigured = false;
  }
}

window.CoopSession = CoopSession;
