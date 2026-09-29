$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceRoot = Join-Path $projectRoot 'design/menu-concepts-v1'
$assetRoot = Join-Path $projectRoot 'resources/images/menu'
New-Item -ItemType Directory -Path $assetRoot -Force | Out-Null
# Exact crops from the approved raster designs. Originals are never modified.
$crops = @(
  @('01-title','title-logo',560,145,555,204),
  @('02-briefing','facility-briefing',48,111,930,265),
  @('02-briefing','mission-salvage',117,602,182,78),
  @('02-briefing','mission-terminal',415,602,164,80),
  @('02-briefing','mission-extract',739,596,141,88),
  @('02-briefing','terminal-1',1040,344,104,106),
  @('02-briefing','terminal-2',1198,344,103,106),
  @('02-briefing','terminal-3',1345,344,103,106),
  @('03-map','facility-small',45,200,499,271),
  @('03-map','facility-medium',587,200,497,271),
  @('03-map','facility-large',1127,200,499,271),
  @('03-map','schematic-small',65,515,454,167),
  @('03-map','schematic-medium',605,515,454,167),
  @('03-map','schematic-large',1147,515,454,167),
  @('05-loadout','weapon-smg',58,166,483,289),
  @('05-loadout','weapon-shotgun',58,506,483,281),
  @('05-loadout','weapon-pistol',865,170,470,283),
  @('05-loadout','weapon-revolver',865,497,470,290),
  @('06-ammo','ammo-crate',54,150,498,225),
  @('06-ammo','oxygen-bottle',1138,199,155,479),
  @('04-storage','item-specimen',222,184,129,127),
  @('04-storage','item-chip',426,187,58,57),
  @('04-storage','item-alloy',222,387,193,52),
  @('07-coop','crew-host',88,217,350,217),
  @('07-coop','crew-two',473,217,349,217),
  @('07-coop','crew-three',856,217,345,217),
  @('07-coop','crew-empty',1247,217,337,217),
  @('08-tutorial','tutorial-corridor',641,194,620,355),
  @('08-tutorial','tutorial-corridor-source',641,194,986,355)
)
foreach ($crop in $crops) {
  $source = [System.Drawing.Bitmap]::FromFile((Join-Path $sourceRoot ($crop[0] + '.png')))
  try {
    $rectangle = [System.Drawing.Rectangle]::new($crop[2], $crop[3], $crop[4], $crop[5])
    $result = $source.Clone($rectangle, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try { $result.Save((Join-Path $assetRoot ($crop[1] + '.png')), [System.Drawing.Imaging.ImageFormat]::Png) }
    finally { $result.Dispose() }
  } finally { $source.Dispose() }
}
Write-Output "Extracted $($crops.Count) approved art regions."
