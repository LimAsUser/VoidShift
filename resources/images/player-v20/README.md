# VOID SHIFT player art V20

Created with the built-in image generator; original transparent raster art, no downloaded assets. Existing shop and LOADOUT side-view images are unchanged.

Runtime files: `short-poses.png`, `long-poses.png` and `pistol.png`, `smg.png`, `shotgun.png`, `revolver.png`, `machinegun.png`, `mini-shotgun.png`. `reference-pistol.png` preserves the character/style reference, not a runtime sprite.

Both body atlases are 1536x1024, three columns by two rows. Cell order is idle, four walking phases, downed. The renderer uses measured per-cell pivots and source crop rectangles in `js/player-art.js`; it never changes collision radius or attack origins. PNG alpha is retained. Six firearms face right and use top surfaces; the discarded first SMG side-view candidate is not shipped.

## Prompt set

Character reference: one salvage astronaut in dark navy-grey sealed industrial armor, compact armored shoulders, oxygen backpack, dark helmet and restrained pale cyan markings. Chunky clean painted shapes with lightly stepped edges; not strict pixel-grid or photorealism. Strict 90-degree overhead orthographic camera, facing right; visible top of helmet, shoulder/back/limb upper surfaces, no front face or chest plane. Full body holds a compact pistol. Transparent alpha, no floor, outside aura, text or watermark.

Atlas reference edits: preserve exact character identity, materials, scale, lighting and consistent hip pivot. Exactly six equal square cells in a3x2 transparent atlas, facing right. Remove weapon pixels and retain plausible empty short-gun or long-gun hand grips. Idle, alternating four walking phases and living downed/prone pose. Short atlas received a cleanup edit preserving all six figures and removing exterior grey halos/shading while retaining dark armor alpha.

Final firearm prompts all use the reference pistol's overhead camera and navy-steel/cyan painted style. Gun is parallel to XY ground, camera on +Z, muzzle right. Show only top surfaces; underside hand grips and magazines extend into Z and are not hanging side-view shapes. True transparent exterior, no hands/person, floor, shadow, aura or text.

- Pistol: compact short rectangular slide and narrow muzzle, compact rear grip housing from above.
- SMG: thin approximately5:1 silhouette, small folding stock with two rails, narrow short barrel, centered top receiver/rail, no hanging magazine or L-shaped grip.
- Shotgun: approximately6:1 long broad single barrel, thick ribbed pump segment, large receiver and solid stock top.
- Revolver: approximately3.5:1 silhouette, wide cylindrical drum bulges in the rear third, narrow barrel and small rear hammer block.
- Machine gun: approximately4.5:1 broad receiver, side-feed ammo box visible from above, ventilated shroud and folded bipod lugs, no loose belt.
- Mini shotgun: approximately2.5:1 compact wide receiver, two short parallel barrels and muzzle tips, no shoulder stock.

Inspect `design/player-art-v20-preview.html` through a local web server. The inspection page contains no game session or save access.
