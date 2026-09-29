$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$designRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'design/menu-concepts-v1'
$reviewRoot = Join-Path $designRoot 'validation'
$pages = @('01-title','02-briefing','03-map','04-storage','05-loadout','06-ammo','07-coop','08-tutorial')
foreach ($page in $pages) {
  $captureName = if ($page -eq '07-coop') { '07-coop-fixture-1920.png' } else { "$page-1920.png" }
  $reference = [Drawing.Bitmap]::FromFile((Join-Path $designRoot "$page.png"))
  $capture = [Drawing.Bitmap]::FromFile((Join-Path $reviewRoot $captureName))
  $overlay = [Drawing.Bitmap]::new(1920,1080)
  $graphics = [Drawing.Graphics]::FromImage($overlay)
  $attributes = [Drawing.Imaging.ImageAttributes]::new()
  try {
    $bounds = [Drawing.Rectangle]::new(0,0,1920,1080)
    $graphics.DrawImage($reference,$bounds)
    $alpha = [Drawing.Imaging.ColorMatrix]::new()
    $alpha.Matrix33 = 0.5
    $attributes.SetColorMatrix($alpha)
    $graphics.DrawImage($capture,$bounds,0,0,$capture.Width,$capture.Height,[Drawing.GraphicsUnit]::Pixel,$attributes)
    $overlay.Save((Join-Path $reviewRoot "$page-overlay.png"),[Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose(); $attributes.Dispose(); $overlay.Dispose(); $reference.Dispose(); $capture.Dispose()
  }
}
Write-Output 'Created eight 1920x1080 half-opacity overlays; this is a visual comparison, not a pixel-equivalence assertion.'
