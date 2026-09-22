class CoopSession extends EventTarget {
  constructor() {
    super();
    this.role = null;
    this.roomCode = null;
    this.peer = null;
    this.stateChannel = null;
    this.eventChannel = null;
    this.connected = false;
    this._pollTimer = null;
    this._roomExpiresAt = 0;
    this._hostToken = null;
    this._closed = false;
  }

  _emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  _createPeer() {
    const peer = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }]
    });
    peer.addEventListener('connectionstatechange', () => {
      const state = peer.connectionState;
      this._emit('status', { state });
      if (state === 'connected') this._checkConnected();
      if (state === 'failed' || state === 'closed' || state === 'disconnected') {
        this.connected = false;
        this._emit('disconnect', { state });
      }
    });
    this.peer = peer;
    return peer;
  }

  _bindChannel(channel) {
    if (channel.label === 'state') this.stateChannel = channel;
    if (channel.label === 'events') this.eventChannel = channel;
    channel.addEventListener('open', () => this._checkConnected());
    channel.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message && message.version === 1 && typeof message.type === 'string') {
          this._emit('message', { channel: channel.label, message });
        }
      } catch (_) { /* ignore malformed peer data */ }
    });
  }

  _checkConnected() {
    if (this.stateChannel?.readyState !== 'open' || this.eventChannel?.readyState !== 'open') return;
    if (this.connected) return;
    this.connected = true;
    this._emit('connected', { role: this.role, code: this.roomCode });
  }

  async _waitForIce(peer) {
    if (peer.iceGatheringState === 'complete') return;
    await new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timeout);
        peer.removeEventListener('icegatheringstatechange', handler);
        resolve();
      };
      const timeout = setTimeout(finish, 8000);
      const handler = () => {
        if (peer.iceGatheringState !== 'complete') return;
        finish();
      };
      peer.addEventListener('icegatheringstatechange', handler);
    });
  }

  async host() {
    this.close(false);
    this._closed = false;
    this.role = 'host';
    const peer = this._createPeer();
    this._bindChannel(peer.createDataChannel('state', { ordered: false, maxRetransmits: 0 }));
    this._bindChannel(peer.createDataChannel('events', { ordered: true }));
    await peer.setLocalDescription(await peer.createOffer());
    await this._waitForIce(peer);
    const response = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ offer: JSON.stringify(peer.localDescription) })
    });
    if (!response.ok) throw new Error('Unable to create room');
    const payload = await response.json();
    this.roomCode = payload.code;
    this._hostToken = payload.hostToken;
    this._roomExpiresAt = payload.expiresAt || (Date.now() + 10 * 60 * 1000);
    this._emit('room', { code: this.roomCode, role: this.role });
    this._pollForAnswer();
    return this.roomCode;
  }

  async _pollForAnswer() {
    clearTimeout(this._pollTimer);
    if (this._closed || this.connected || !this.roomCode) return;
    if (this._roomExpiresAt && Date.now() >= this._roomExpiresAt) {
      this._emit('status', { state: 'expired' });
      this.close(false);
      return;
    }
    try {
      const response = await fetch(`/api/rooms/${this.roomCode}`, {
        cache: 'no-store',
        headers: { 'x-room-host-token': this._hostToken }
      });
      if (response.status === 404) {
        this._emit('status', { state: 'expired' });
        this.close(false);
        return;
      }
      if (response.ok) {
        const room = await response.json();
        if (room.answer_sdp && !this.peer.currentRemoteDescription) {
          await this.peer.setRemoteDescription(JSON.parse(room.answer_sdp));
          fetch(`/api/rooms/${this.roomCode}`, {
            method: 'DELETE', keepalive: true,
            headers: { 'x-room-host-token': this._hostToken }
          }).catch(() => {});
          return;
        }
      }
    } catch (_) { /* retry until room expiry */ }
    this._pollTimer = setTimeout(() => this._pollForAnswer(), 1000);
  }

  async join(code) {
    this.close(false);
    this._closed = false;
    this.role = 'guest';
    this.roomCode = String(code || '').trim().toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(this.roomCode)) throw new Error('Invalid room code');
    const response = await fetch(`/api/rooms/${this.roomCode}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Room not found or expired');
    const room = await response.json();
    const peer = this._createPeer();
    peer.addEventListener('datachannel', (event) => this._bindChannel(event.channel));
    await peer.setRemoteDescription(JSON.parse(room.offer_sdp));
    await peer.setLocalDescription(await peer.createAnswer());
    await this._waitForIce(peer);
    const answer = await fetch(`/api/rooms/${this.roomCode}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answer: JSON.stringify(peer.localDescription) })
    });
    if (!answer.ok) throw new Error('Room already claimed or expired');
    this._emit('room', { code: this.roomCode, role: this.role });
    return this.roomCode;
  }

  sendState(type, payload) {
    if (this.stateChannel?.readyState !== 'open') return false;
    if (this.stateChannel.bufferedAmount > 256_000) return false;
    this.stateChannel.send(JSON.stringify({ version: 1, type, ...payload }));
    return true;
  }

  sendEvent(type, payload = {}) {
    if (this.eventChannel?.readyState !== 'open') return false;
    this.eventChannel.send(JSON.stringify({ version: 1, type, ...payload }));
    return true;
  }

  close(removeRoom = true) {
    this._closed = true;
    clearTimeout(this._pollTimer);
    if (removeRoom && this.role === 'host' && this.roomCode) {
      fetch(`/api/rooms/${this.roomCode}`, {
        method: 'DELETE', keepalive: true,
        headers: { 'x-room-host-token': this._hostToken || '' }
      }).catch(() => {});
    }
    this.stateChannel?.close();
    this.eventChannel?.close();
    this.peer?.close();
    this.connected = false;
    this.peer = null;
    this.stateChannel = null;
    this.eventChannel = null;
  }
}

window.CoopSession = CoopSession;
