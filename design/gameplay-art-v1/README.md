# Gameplay art proof (not approved production art)

`generate.py` builds an editable crew model in Blender and renders an overhead
frame plus an inspection view. The three files in `proof/` are the result of the
first pass. They are deliberately **not** loaded by the game or copied to Sites.

This pass proves the source-to-render pipeline, but fails the visual gate: the
armor, anatomy, weathering, and material depth are substantially simpler than
the approved realistic crew concept. Do not treat it as a 1:1 recreation or
use it as a finished sprite sheet.

`crew_v1.py` is a separate rebuild. `proof/v1-first/` and
`proof/v1-refined/` preserve two inspected iterations. The user accepted the
refined version as the style baseline for the next models; that acceptance
does not mean the original photorealistic concept was reproduced pixel for
pixel.

`enemy_v1.py --kind hunter|monster` builds independent editable models with
the crew v1 materials and inspection cameras. `proof/hunter-v1/` and
`proof/monster-v1/` contain their source files and top/three-quarter previews.
Both silhouettes were compared with the crew at reduced gameplay display
size. These are still static model previews, not directional animation or
game-ready sprite sheets; the playable room has not been made.

Run the narrow pipeline check with `BLENDER_BIN` pointing to a local Blender
executable: `node --test tests/gameplay-art-pipeline.test.cjs`.
