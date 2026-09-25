const COOP_PROTOCOL_VERSION = 3;
const COOP_MAX_GUESTS = 3;
const COOP_RECONNECT_WINDOW_MS = 5 * 60 * 1000;

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
    this._roomExpiresAt = 0;
    this._roomStatus = 'lobby';
    this._lastLeaseRenewAt = 0;
    this._memberPollTimer = null;
    this._reconnectTimer = null;
    this._reconnectStartedAt = 0;
    this._reconnectInProgress = false;
    this._removedMembers = new Set();
  }

  _emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  _createPeerRecord(id, generation, role) {
    const peer = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }]
    });
    const record = {
      id, generation, role, peer, stateChannel: null, eventChannel: null,
      connected: false, disconnectedNotified: false, closed: false,
      reconnected: generation > 0, reconnectTimer: null
    };
    this.peers.set(id, record);
    peer.addEventListener('connectionstatechange', () => this._handlePeerState(record));
    return record;
  }

  _bindChannel(channel, record) {
    if (channel.label.startsWith('state:')) record.stateChannel = channel;
    if (channel.label.startsWith('events:')) record.eventChannel = channel;
    channel.addEventListener('open', () => this._checkPeerConnected(record));
    channel.addEventListener('message', event => {
      try {
        const message = JSON.parse(event.data);
        if (message && message.version === COOP_PROTOCOL_VERSION && typeof message.type === 'string') {
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
    if (!record || record.closed || record.peer.connectionState !== 'connected' ||
        record.stateChannel?.readyState !== 'open' || record.eventChannel?.readyState !== 'open') return;
    if (record.connected) return;
    record.connected = true;
    record.disconnectedNotified = false;
    clearTimeout(record.reconnectTimer);
    this.connected = this.role === 'guest'
      ? !!this.peers.get('host')?.connected
      : [...this.peers.values()].some(peer => peer.connected);
    this._setMemberStatus(record, 'connected');
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
    if (!record || record.closed) return;
    const state = record.peer.connectionState;
    if (state === 'connected') {
      this._checkPeerConnected(record);
      return;
    }
    if (!['disconnected', 'failed', 'closed'].includes(state) || record.disconnectedNotified) return;
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
    clearTimeout(record.reconnectTimer);
    record.reconnectTimer = setTimeout(() => this._beginReconnect(), state === 'failed' || state === 'closed' ? 0 : 5000);
  }

  async _setMemberStatus(record, status) {
    if (!this.roomCode || !record || (this.role === 'host' && record.id === 'host')) return;
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
      await fetch(url, { method: 'PATCH', headers, body: JSON.stringify({ status }) });
    } catch (_) { /* room membership state is also tracked in memory */ }
  }

  async _waitForIce(peer) {
    if (peer.iceGatheringState === 'complete') return;
    await new Promise(resolve => {
      const finish = () => {
        clearTimeout(timeout);
        peer.removeEventListener('icegatheringstatechange', handler);
        resolve();
      };
      const timeout = setTimeout(finish, 8000);
      const handler = () => { if (peer.iceGatheringState === 'complete') finish(); };
      peer.addEventListener('icegatheringstatechange', handler);
    });
  }

  async host() {
    this.close(false);
    this._closed = false;
    this.role = 'host';
    const response = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ protocolVersion: COOP_PROTOCOL_VERSION })
    });
    if (!response.ok) throw new Error('无法创建联机房间');
    const room = await response.json();
    this.roomCode = room.code;
    this.hostToken = room.hostToken;
    this._roomExpiresAt = room.expiresAt || (Date.now() + 10 * 60 * 1000);
    this._roomStatus = 'lobby';
    this._emit('room', { code: this.roomCode, role: this.role, maxPlayers: COOP_MAX_GUESTS + 1 });
    this._pollForMembers();
    return this.roomCode;
  }

  async _createHostPeer(member) {
    const previous = this.peers.get(member.id);
    if (previous) this._closePeer(previous);
    const record = this._createPeerRecord(member.id, member.generation, 'host');
    record.slot = member.slot;
    this._bindChannel(record.peer.createDataChannel(`state:${member.id}`, { ordered: false, maxRetransmits: 0 }), record);
    this._bindChannel(record.peer.createDataChannel(`events:${member.id}`, { ordered: true }), record);
    try {
      await record.peer.setLocalDescription(await record.peer.createOffer());
      await this._waitForIce(record.peer);
      const response = await fetch(`/api/rooms/${this.roomCode}/members/${member.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-room-host-token': this.hostToken },
        body: JSON.stringify({ generation: record.generation, offer: JSON.stringify(record.peer.localDescription) })
      });
      if (!response.ok) throw new Error('无法建立队员连接');
    } catch (error) {
      this._closePeer(record);
      this._emit('member-error', { memberId: member.id, error });
    }
  }

  async _pollForMembers() {
    clearTimeout(this._memberPollTimer);
    if (this._closed || this.role !== 'host' || !this.roomCode) return;
    try {
      if (this._roomStatus === 'active' && Date.now() - this._lastLeaseRenewAt > 60_000) this.setRoomStatus('active');
      if (Date.now() >= this._roomExpiresAt) {
        this._emit('status', { state: 'expired' });
        this.close(false);
        return;
      }
      const response = await fetch(`/api/rooms/${this.roomCode}/members`, {
        cache: 'no-store', headers: { 'x-room-host-token': this.hostToken }
      });
      if (response.status === 404) {
        this._emit('status', { state: 'expired' });
        this.close(false);
        return;
      }
      if (response.ok) {
        const payload = await response.json();
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
            await this._createHostPeer(member);
            record = this.peers.get(member.id);
          }
          if (record && member.answer_sdp && !record.peer.currentRemoteDescription) {
            try {
              await record.peer.setRemoteDescription(JSON.parse(member.answer_sdp));
            } catch (error) {
              this._emit('member-error', { memberId: member.id, error });
            }
          }
          if (record) record.slot = member.slot;
        }
        for (const [id, record] of this.peers) {
          if (!listed.has(id)) this._closePeer(record);
        }
        this._emit('members', { members: payload.members || [] });
      }
    } catch (_) { /* retry while the lobby room remains alive */ }
    this._memberPollTimer = setTimeout(() => this._pollForMembers(), 700);
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

  async join(code) {
    this.close(false);
    this._closed = false;
    this.role = 'guest';
    this.roomCode = String(code || '').trim().toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(this.roomCode)) throw new Error('房间码无效');
    const roomResponse = await fetch(`/api/rooms/${this.roomCode}`, { cache: 'no-store' });
    if (!roomResponse.ok) throw new Error('房间不存在或已过期');
    const room = await roomResponse.json();
    if (room.protocol_version !== COOP_PROTOCOL_VERSION) throw new Error('房主游戏版本不兼容，请双方刷新页面');
    this._roomExpiresAt = room.expires_at || Date.now() + 10 * 60 * 1000;
    const stored = this._readMemberCredentials(this.roomCode);
    await this._requestMemberSlot(stored);
    this._emit('room', { code: this.roomCode, role: this.role, memberId: this.memberId, slot: this.localSlot });
    await this._connectGuestPeer();
    return this.roomCode;
  }

  async _requestMemberSlot(credentials = null) {
    const response = await fetch(`/api/rooms/${this.roomCode}/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(credentials || {})
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      if (credentials && body.error === 'reconnect_expired') {
        try { sessionStorage.removeItem(this._memberStorageKey(this.roomCode)); } catch (_) {}
      }
      throw new Error(body.error === 'room_full' ? '房间已满（最多4人）' :
        body.error === 'reconnect_expired' ? '重连时间已过，无法回到本局' : '无法加入或重连房间');
    }
    const member = await response.json();
    this.memberId = member.memberId;
    this.memberToken = member.memberToken;
    this.localSlot = member.slot;
    this._generation = member.generation;
    this._storeMemberCredentials();
  }

  async _connectGuestPeer() {
    const previous = this.peers.get('host');
    if (previous) this._closePeer(previous);
    const record = this._createPeerRecord('host', this._generation, 'guest');
    record.peer.addEventListener('datachannel', event => this._bindChannel(event.channel, record));
    const deadline = Date.now() + 60 * 1000;
    while (!this._closed && Date.now() < deadline) {
      const response = await fetch(`/api/rooms/${this.roomCode}/members/${this.memberId}`, {
        cache: 'no-store', headers: { 'x-room-member-token': this.memberToken }
      });
      if (!response.ok) throw new Error('房主连接不可用，请稍后重试');
      const member = await response.json();
      if (member.status === 'removed') throw new Error('该玩家席位已移除');
      if (member.generation > record.generation) {
        record.generation = member.generation;
        this._generation = member.generation;
      }
      if (member.offer_sdp) {
        await record.peer.setRemoteDescription(JSON.parse(member.offer_sdp));
        await record.peer.setLocalDescription(await record.peer.createAnswer());
        await this._waitForIce(record.peer);
        const answer = await fetch(`/api/rooms/${this.roomCode}/members/${this.memberId}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json', 'x-room-member-token': this.memberToken },
          body: JSON.stringify({ generation: record.generation, answer: JSON.stringify(record.peer.localDescription) })
        });
        if (!answer.ok) throw new Error('无法返回联机回应');
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    this._closePeer(record);
    throw new Error('等待房主连接超时');
  }

  async _beginReconnect() {
    if (this.role !== 'guest' || this._closed || this._reconnectInProgress || !this.memberId) return;
    this._reconnectInProgress = true;
    if (!this._reconnectStartedAt) this._reconnectStartedAt = Date.now();
    if (Date.now() - this._reconnectStartedAt >= COOP_RECONNECT_WINDOW_MS) {
      this._reconnectInProgress = false;
      this._emit('member-removed', { memberId: this.memberId, slot: this.localSlot });
      return;
    }
    try {
      await this._requestMemberSlot({ memberId: this.memberId, memberToken: this.memberToken });
      await this._connectGuestPeer();
      this._reconnectStartedAt = 0;
    } catch (_) {
      this._reconnectTimer = setTimeout(() => this._beginReconnect(), 2000);
    } finally {
      this._reconnectInProgress = false;
    }
  }

  _closePeer(record) {
    if (!record) return;
    record.closed = true;
    clearTimeout(record.reconnectTimer);
    try { record.stateChannel?.close(); } catch (_) {}
    try { record.eventChannel?.close(); } catch (_) {}
    try { record.peer?.close(); } catch (_) {}
    this.peers.delete(record.id);
  }

  _send(channelName, type, payload, targetId = null) {
    const message = JSON.stringify({ version: COOP_PROTOCOL_VERSION, type, ...payload });
    const records = this.role === 'guest'
      ? [this.peers.get('host')].filter(Boolean)
      : targetId ? [this.peers.get(targetId)].filter(Boolean) : [...this.peers.values()];
    let sent = 0;
    for (const record of records) {
      const channel = channelName === 'state' ? record.stateChannel : record.eventChannel;
      if (channel?.readyState !== 'open' ||
          (channelName === 'state' && channel.bufferedAmount > 256_000)) continue;
      try { channel.send(message); sent++; } catch (_) { /* stale peer; status event handles recovery */ }
    }
    return sent;
  }

  sendState(type, payload) { return this._send('state', type, payload); }
  sendEvent(type, payload = {}, targetId = null) { return this._send('events', type, payload, targetId) > 0; }

  setRoomStatus(status) {
    if (this.role !== 'host' || !this.roomCode || !['lobby', 'active', 'finished'].includes(status)) return false;
    this._roomStatus = status;
    this._lastLeaseRenewAt = Date.now();
    fetch(`/api/rooms/${this.roomCode}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-room-host-token': this.hostToken || '' },
      body: JSON.stringify({ status })
    }).then(response => response.ok ? response.json() : null)
      .then(payload => { if (payload?.expiresAt) this._roomExpiresAt = payload.expiresAt; })
      .catch(() => {});
    return true;
  }

  async close(removeRoom = true) {
    this._closed = true;
    clearTimeout(this._memberPollTimer);
    clearTimeout(this._reconnectTimer);
    if (removeRoom && this.role === 'host' && this.roomCode) {
      fetch(`/api/rooms/${this.roomCode}`, {
        method: 'DELETE', keepalive: true,
        headers: { 'x-room-host-token': this.hostToken || '' }
      }).catch(() => {});
    } else if (removeRoom && this.role === 'guest' && this.memberId && this.memberToken) {
      fetch(`/api/rooms/${this.roomCode}/members/${this.memberId}`, {
        method: 'PATCH', keepalive: true,
        headers: { 'content-type': 'application/json', 'x-room-member-token': this.memberToken },
        body: JSON.stringify({ status: 'removed' })
      }).catch(() => {});
      try { sessionStorage.removeItem(this._memberStorageKey(this.roomCode)); } catch (_) {}
    }
    for (const record of this.peers.values()) this._closePeer(record);
    this.peers.clear();
    this.connected = false;
    this.roomCode = null;
    this.hostToken = null;
    this.memberId = null;
    this.memberToken = null;
  }
}

window.CoopSession = CoopSession;
