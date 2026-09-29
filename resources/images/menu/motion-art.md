# Menu motion layers

Generated with the built-in image_gen tool on 2026-09-27.

Original title-background.png and prep-background.png are unchanged static fallbacks. All five output assets retain the 1672 x 941 reference plane. The two cockpit PNGs and the shared sparse debris PNG have real alpha; the two exterior plates are opaque. No video, network runtime service, or new dependency is used.

Ruling: the same six-piece debris layer is reused by both scenes with different opacity and timing. It is clipped behind each cockpit; separate copies would add bytes without changing the behavior.

## Final prompts

### title-cockpit-v1.png

Edit target: title-background.png. Transparent background: true.

Use case: background-extraction. Asset type: production parallax raster layer for VOID SHIFT menu. Image 1 is the EDIT TARGET. Remove ONLY everything seen OUTSIDE the spaceship windows (stars, planet, station, asteroids), replacing ALL window glass panes with genuinely transparent alpha. Keep the entire cockpit frame, overhead lights, dashboard, chair and foreground exactly in place, at their exact original scale and coordinates. Do NOT crop to the object. Full original 16:9 composition with the big transparent window aperture. No replacement black sky, no checkerboard painted into pixels. Match original cinematic realistic blue/amber lighting, geometry, perspective and dark palette. Preserve aspect ratio 16:9 and full-image registration; output must align when stretched to the reference's 1672 by 941 coordinate plane. No logos, text, icons, UI or watermarks.

### prep-cockpit-v1.png

Edit target: prep-background.png. Transparent background: true.

Use case: background-extraction. Asset type: production parallax raster layer for VOID SHIFT menu. Image 1 is the EDIT TARGET. Remove ONLY the view OUTSIDE ALL spaceship windows, replacing window glass with genuinely transparent alpha. Preserve the complete hangar/bridge room: ceiling, window struts, dashboard and floor, at exact original positions. Keep all three window apertures transparent. Do NOT crop. Full original 16:9 composition. No painted checkerboard, no stars or planets remaining in the transparent windows. Match original cinematic realistic blue/amber lighting, geometry, perspective and dark palette. Preserve aspect ratio 16:9 and full-image registration; output must align when stretched to the reference's 1672 by 941 coordinate plane. No logos, text, icons, UI or watermarks.

### title-exterior-v1.png

Edit target: title-background.png. Transparent background: false.

Use case: precise-object-edit. Asset type: production parallax raster layer for VOID SHIFT menu. Image 1 is the EDIT TARGET. Create the exterior-only background plate for this exact scene. Remove ALL interior spaceship window frame, cockpit, dashboard, chair and struts. Seamlessly extend the existing space view behind those removed foreground areas to fill the whole image. Preserve the original visible starfield, planet blue limb and orbital station at precisely the SAME positions and scale. Fill concealed areas plausibly, not redesign. Remove only a handful of closest isolated asteroids; retain the distant debris field. A full opaque image of space with NO interior or new major objects. Match original cinematic realistic blue/amber lighting, geometry, perspective and dark palette. Preserve aspect ratio 16:9 and full-image registration; output must align when stretched to the reference's 1672 by 941 coordinate plane. No logos, text, icons, UI or watermarks.

### prep-exterior-v1.png

Edit target: prep-background.png. Transparent background: false.

Use case: precise-object-edit. Asset type: production parallax raster layer for VOID SHIFT menu. Image 1 is the EDIT TARGET. Create the exterior-only background plate for this exact scene. Remove ALL interior bridge structure including ceiling, window frame/struts, dashboard, chair, room and floor, and continue the existing space and planet view behind them. Keep the existing starfield and blue planet horizon at EXACTLY the SAME original image coordinates and scale. Preserve distant asteroids. No cockpit, no new spacecraft, no change of camera framing. Opaque full-frame 16:9 outer space plate. Match original cinematic realistic blue/amber lighting, geometry, perspective and dark palette. Preserve aspect ratio 16:9 and full-image registration; output must align when stretched to the reference's 1672 by 941 coordinate plane. No logos, text, icons, UI or watermarks.

### drifting-debris-v1.png

Edit target: title-background.png. Transparent background: true.

Use case: background-extraction. Asset type: production parallax raster layer for VOID SHIFT menu. Image 1 is the EDIT TARGET. Extract just SIX tiny isolated foreground asteroid fragments in the same realistic dark rocky style. Keep a VERY sparse wide composition, fragments only near left and right sides, empty middle 65%. Each fragment only 1 to 2 percent of image width. Genuinely transparent alpha everywhere else. No stars, planet, station, cockpit, glow, text or background. Full 16:9 frame, do not enlarge rocks or center them as a product sheet. Match original cinematic realistic blue/amber lighting, geometry, perspective and dark palette. Preserve aspect ratio 16:9 and full-image registration; output must align when stretched to the reference's 1672 by 941 coordinate plane. No logos, text, icons, UI or watermarks.

