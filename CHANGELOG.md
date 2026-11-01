# Changelog

## 0.3.0

- Fixed the PowerShell bridge: `$blendModeJsx` and `$colorHelpersJsx` had been pasted inside the
  `New-SaveJsx` here-string, so both variables were never assigned. Every JSX that interpolated them
  either lost `__psHexToColor` / `__psSetBlendMode` or emitted a literal ` = @'` line, which broke
  `create_document`, `export_active`, `adjust_image`, `place_image`, `apply_overlay`,
  `add_text_layer`, `draw_paths` and `texture_recolor`. The two blocks now sit above the functions
  that use them.
- Added a native `texture_recolor` bridge action: polygon selection, fill, and the `COLORBLEND` layer
  mode, so the recolor keeps the source texture without Pillow.
- The bridge now forces UTF-8 console output, so non-ASCII layer names and error text survive
  redirection.
- Added `dsh-plugin/`: a DeepSeek Harness host bundle exposing the same capabilities as 14 agent
  tools, with no Python and no npm dependencies.

## 0.2.0

- Added structured tools for document creation, image placement, text layers, layer operations, editable paths, and batch workflows.
- Improved project documentation for installation, usage, customization, and tool reference.
- Added open-source metadata, examples, diagrams, license, and ignore rules.

## 0.1.0

- Initial local bridge for Photoshop status, image opening, adjustments, overlay placement, texture-aware recolor, export, and custom JSX.
