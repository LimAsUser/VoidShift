# Approved menu artwork

Production assets for the menu only. These files are copied by the existing resources packaging path; the running game does not read design/.

- Original raster crops: scripts/extract-menu-art.ps1, sourced from design/menu-concepts-v1. No source image is overwritten. It records every crop rectangle for reproducibility.
- The original cropped title-logo is used, preserving its exact letter shapes. An experimental AI-extracted logo was not adopted.
- Built-in imagegen background cleanups: title-background.png, prep-background.png, tutorial-corridor-clean.png. No external CLI/API dependency.

## Cleanup prompts

Title: Remove only overlaid VOID SHIFT lettering, two buttons and tiny Chinese caption; restore the starfield/planet behind them while preserving cockpit, framing, colors and lighting. No text/UI in the resulting background.

Preparation: Extract/reconstruct the dark blue spaceship bridge behind the approved briefing screenshot; remove all UI panels, navigation, footer, text and foreground illustration cards. Keep the visible margins' perspective, materials and lighting.

Tutorial: Remove only W/A/S/D/Shift keycaps and the bottom-right Chinese caption from tutorial-corridor-source.png. Keep astronaut size, framing, hallway, cyan floor arrows, colors and physical wall text unchanged. Preserve the wide aspect ratio.

Prices, counts, status text, buttons, keyboard hints and inventory cells are live HTML/CSS, not baked into these assets. Small printed labels visible on equipment are decorative artwork.
