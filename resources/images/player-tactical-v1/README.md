# Tactical astronaut layers

Four original transparent RGBA PNGs,1254×1254 each, created with the built-in imagegen tool. No Phantom Squad media was used as a texture or copied into these assets. Runtime names match `PlayerArt.assets`.

| File | Role | Selected generated source |
| --- | --- | --- |
| upper-short.png | Helmet, shoulders, backpack and empty compact-grip hands; no legs/gun | exec-2dcbe7ca-7fa6-44a4-884a-ff787726a93b.png |
| upper-long.png | Same upper identity, separated long-gun grip; no legs/gun | exec-c533a6bc-2e40-42ad-8cfc-fbdd2fa23804.png |
| legs-idle.png | Overhead trousers, boots and belt only | exec-eb82ecbd-ef1e-491b-93dc-958e3241785f.png |
| legs-walk.png | Four-by-four lower-body atlas: forward/backward/left/right rows | exec-7a64e6b7-c47d-42f8-85e2-d5d402e669d0.png |

The selected originals remain under `C:/Users/User/.codex/generated_images/01a0c479-4324-7510-b495-cedc9562af68/`; workspace PNGs are unmodified binary copies. Rejected full-body and side-view candidates are not runtime assets.

## Final prompt set

- **Short upper:** edit the identity-reference astronaut, remove both legs/boots and the entire pistol to genuine alpha; preserve helmet, shoulders, arms, empty hands, torso, oxygen pack and overhead/right-facing orientation. No extra parts, background or marks.
- **Long upper:** use the accepted short upper as identity/placement reference; change only forearms and empty hands for a long-gun grip, approximately85%/95% width along the horizontal axis. Preserve absence of legs and weapons, alpha and90-degree overhead orientation.
- **Idle legs:** retain only the reference's two armored legs, two boots and belt/hip connector; remove head, torso, oxygen pack, arms and gun. Preserve the overhead horizontal orientation, boots extending left and the character facing right; no floor/shadow/background.
- **Walk legs:** use idle legs as reference; generate a square4×4 atlas, four steps each of forward, backward, left strafe and right strafe. Keep body facing right in every cell, belt position/scale consistent, only two legs, no other anatomy/text/grid/background. Depict different foot placements, not rotated standing side views.

## Assembly

Upper/idle quads retain the nominal40-world-unit centered frame. Generated walk figures occupy more of each source cell, so they use a20-unit drawing quad and16 calibrated pivots from the visible waist connector. These align to the idle seam at approximately(-2.84,-0.048) world units. The actor origin, hitbox and logical gun ray never move.

Atlas cells are313.5px square; fractional source rectangles are intentional. Do not rescale/recenter the PNGs without recalibrating and checking all phases in `design/phantom-player-preview.html`.

Compressed total:3,240,971 bytes. Theoretical decoded RGBA pixels:25,160,256 bytes before browser/GPU/cache overhead; this is not a measured whole-game memory peak. Images share the existing cache across players. Existing six gun PNGs and V20 downed art remain unchanged.
