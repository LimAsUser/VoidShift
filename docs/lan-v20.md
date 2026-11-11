# Local LAN / VPN server (V20)

Run the launcher from the project directory using Node 22.13 or newer:

```powershell
node scripts/start-lan.mjs --list
node scripts/start-lan.mjs --ip 192.168.1.5
# Or: .\scripts\start-lan.ps1 -Interface 'Your VPN' -Port 8787
```

Without `--ip` or `--interface`, an interactive terminal asks you to explicitly select a listed IPv4 interface. The server binds only that address; port 8787 is the default. An occupied port fails without stopping its owner. The launcher builds outdated game/Worker files, applies only migrations 0000–0004 to local D1, and starts local Wrangler. Migrations and serving share dedicated persistence at `.wrangler/lan/state`; the existing developer database at `.wrangler/state` is not changed. Install the repository's existing dependencies first if they are missing.

```powershell
pnpm install --frozen-lockfile
```

The host browser opens `/game/index.html?mode=lan#lan-host=<one-time credential>`. Send guests only the printed URL without a fragment. The browser removes the credential from its URL. Guests use the same HTTP origin and never receive the startup credential. `--no-open` prints the private host URL for manual use; keep that console private. Stop the launcher to stop the server. A fresh launcher run provides a new host credential and lobby.

The launcher does not change firewall rules, routers, port forwarding, or an online database. Peers must already be able to reach the chosen IPv4 address and port over the same LAN or VPN. The game has one lobby per server process and up to four players. The host browser owns game simulation; one local Durable Object owns the authenticated member lobby and two native WebSocket channels per member. The actor is required because ordinary Worker request contexts cannot send through sockets created by different requests. Only the generated local launcher configuration includes its binding and local class migration; normal build/deployment configuration includes neither. LAN is enabled only by the local `VOIDSHIFT_LAN_ENABLED="1"` binding. Normal deployments reject `/api/lan/*` with 404.

## Browser contract

All mutations are same-origin JSON POST requests. Errors return `{error:<code>}`. Host status/kick requests use `x-room-host-token`.

| Endpoint | Request | Result |
| --- | --- | --- |
| `GET /api/lan/info` | — | `enabled`, `protocolVersion:20`, `transport:"LAN_WS_V20"`, `maxPlayers:4`, `reconnectMs`, `room` |
| `POST /api/lan/create` | `hostKey`, optional 64-hex `createIntent` | host credentials; a matching intent may replay the one-time create; a prior host token permits a new lobby after closing |
| `POST /api/lan/join` | optional private 64-hex `joinIntent`, or `memberId,memberToken` | stable member credentials; intent replay does not consume another slot; reconnect increments generation |
| `POST /api/lan/status` | `status:"lobby"|"active"|"finished"` | host-only room status and expiry |
| `POST /api/lan/kick` | `memberId` | host-only permanent removal |
| `POST /api/lan/leave` | `memberId,memberToken` | permanent member removal; host leave closes lobby |

Credentials contain `code,memberId,memberToken,slot,generation,protocolVersion,expiresAt`; host credentials additionally contain `hostToken`. Host ID is `host`, slot 1. Guest slots are 2–4. Members are connected only when both sockets are open, so existing local mission registration and reward receipts use the same D1 identities. Offline members have a five-minute reconnect window. Removed members cannot reconnect; a fresh guest receives a new identity when reusing the slot.

Open `/api/lan/ws/state` and `/api/lan/ws/events` with query parameters `code,memberId,token,generation`. WebSocket upgrades require a matching browser Origin and valid member credentials. Outgoing messages are `{kind:"data",payload:<serialized V20 game envelope>,targetId?:<guest ID>}`. Guests may target only `host`; host messages broadcast to guests when targetId is absent. Incoming data adds `fromId` and `seq`. ACK every sequenced incoming frame with `{kind:"ack",seq}` before game handling. Event control frames are `members`, `member-offline`, `kicked`, and `closed`.

State delivery has one unacknowledged frame per recipient and retains only the latest pending value per source. Reliable events retain existing `ReliableChunks` encoding/reassembly and its 4 MiB source-message limit. Each payload frame is at most 32,000 bytes; each recipient retains at most 256 pending frames and 8 MiB of encoded wire data, including base64 and outer JSON overhead. This wire bound admits a legal 4 MiB source transfer without increasing its allowed gameplay size. A recipient that exceeds the event bound or fails to ACK within 15 seconds closes with code 1013. State payloads are bounded at 1 MiB; outer JSON frame limits account for escaped payload strings. Existing `net-ping/net-pong/net-latency` events measure round-trip time through the relay. LAN room records use `LAN_WS_V20`; online WebRTC room records use `MULTI_PEER_V20`.

Local room/mission rows persist across server restarts, but socket credentials and active lobbies are process-local. Restarting ends the running session; it does not perform host migration. Existing completed local reward receipts remain available through the local mission APIs.
