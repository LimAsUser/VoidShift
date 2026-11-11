# V20 delivery record

Implementation is on MiniBranch over the existing uncommitted V19 changes. No reset, stash, commit, push, Site publication, firewall change or online database migration.

## Implemented

- Original built-in imagegen PNGs: one retained astronaut reference, two six-cell body atlases, six independent overhead firearms. Nine PNGs total8,517,125 bytes. Runtime art is eight PNGs; the reference is not loaded by gameplay. Individual sprites are RGBA; source crop rectangles/pivots retain their alpha and avoid runtime image analysis.
- Shared local/remote PlayerArt: true overhead right-facing body/gun composition, idle/four walk phases/downed,8/12fps movement-driven phases, pause/stun freeze, low-quality/missing-art arrow fallback. Cosmetic shooter identity, rendered muzzle and tracer segment have separate display coordinates; authoritative ray coordinates are unchanged.
- LAN WebSocket adapter and local Worker room service, startup interface selection, same-origin endpoint/role authentication, four slots, two sockets/peer, bounded latest-state delivery/ACKs and reliable chunks, RTT/kick/reconnect, local mission/receipt APIs.
- Independent profile transfer: validation, credential/outbox exclusion, paired snapshot+journal replacement, reversible backup/failure recovery. Web Locks remains first choice; verified LAN without Web Locks uses real IndexedDB readwrite transaction exclusion around synchronous mutations.

## Necessary implementation rulings

- Native Workerd rejected socket I/O across unrelated request contexts. A single LOCAL Durable Object now owns the lobby and sockets. Binding and class migration are generated only in the launcher's ignored local config; ordinary deployment config has neither. No new package or online schema.
-4MiB reliable source data becomes over5.59MiB in base64 wire envelopes. The legal source size remains4MiB; the event wire queue uses bounded8MiB/256-frame capacity so valid source transfers are not rejected solely by encoding.
- Import replaces snapshots while idle and requires closing other destination game tabs. It does not redesign unrelated ordinary game saves or automatically merge origins.

## Evidence

- Root's75 focused art/render/camera/LAN/client/server/launcher/profile/protocol checks passed after the launcher correction. New review findings received explicit failing regressions then fixes: host-alone outage clock, late socket-open after timeout, local-host terminal expiry, closed retained session role blocking transfer, remote sprint/stun fields, interpolated muzzle and scatter start alignment.
- Real IAB browser asset inspection covered all six weapons, four directions, downed sidearm and1.56x display scale. `design/player-art-v20-preview.html` has no Game/save/session access.
- Actual browser IndexedDB test used two independent same-origin frame connections with fixture-only Web Locks absence: daily reward applied once, repeated receipt applied once,1010 final fixture credits; disposable save keys removed afterward. This is a browser storage test, not proof of a second physical device or VPN.
- Native built Worker test: four members/eight actual101 WebSockets, host broadcast to three guests, fifth join409, connected D1 rows, local mission registration/report,70-credit personal receipt, kicked control ACK/410 and reusable slots passed.
- Real Windows launcher ran on the existing Radmin VPN interface at test port8789. Its isolated local0000–0004 migrations completed and `/api/lan/info` returned200; IAB showed LAN service ready and the profile transfer controls without console errors. Windows Node preload uses file URLs; LAN persists in `.wrangler/lan/state`, separate from the old development database. This was same-PC access over the interface, not a second-PC VPN playtest.
- Final current-assets build passed. The75 focused checks and final built-Worker integration test passed;9 modified/new browser JavaScript files parsed,355 DOM IDs were unique, local script references existed, and scoped diff/line-ending checks passed. Restarting the real launcher correctly reported no migrations pending. IAB checked1280px and390px layouts; settings tabs wrap without vertical text, profile actions and the scrollable LAN address/join section remain reachable. Temporary service shutdown completed normally.
- See `docs/lan-quickstart.zh-CN.md` for user instructions and `docs/lan-v20.md` for the transport contract. Final build/check status is recorded at handoff.

## Limits

No second-PC VPN playtest, real player feel acceptance or whole-suite run. Active host refresh cannot restore an unsaved authoritative world. Online and LAN profiles remain independent.

## Follow-up verification

- All8 previous combat failures were verified as obsolete rule assertions or missing save-fixture dependencies. Updated only the test fixture/expectations, retained the original44 cases, and added explicit shotgun whole-magazine reload coverage:45/45 passed. No production gameplay changed.
- Existing oxygen, V19 regression and shared-container checks passed21/21; focused revival/whole-team-down checks passed7/7.
- New LAN gameplay integration checks passed15/15 across2/3/4 players; adjacent LAN client checks passed16/16. Actual LanCoopSession messages reach Game, Loot, Equipment and Rewards handlers via a serialized in-memory relay. Coverage includes two-second host-authoritative oxygen use (other players retain distinct oxygen values), container request replay/recipient isolation, revival/cancellation, targeted rejoin state and per-player settlement identity/counts/amounts. Socket timing and receipt HTTP are doubles, not a physical-network playtest. Together with the45 combat and28 related checks, this follow-up ran104 passing targeted checks.
- Real IAB access to the disposable fixture over HTTP on the Radmin interface at test port8795 passed: two independent pages applied daily credit once and a duplicate receipt once (1010 fixture credits). It uses a verified-LAN test stub and disposable save keys, not actual player credentials or game assets. The fixture server/tab were stopped/closed afterward.
- Added a two-PC acceptance checklist to the Chinese LAN guide. These browser/logic checks still do not prove remote-device VPN connectivity or real-network gameplay.
- This follow-up changed only tests and documentation. No production code or balances changed; no rebuild, complete-suite run, publication, commit or push was performed.
