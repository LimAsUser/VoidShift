param(
    [string]$Ip,
    [string]$Interface,
    [int]$Port = 8787,
    [switch]$List,
    [switch]$NoOpen
)

$launcherArgs = @((Join-Path $PSScriptRoot 'start-lan.mjs'), '--port', "$Port")
if ($Ip) { $launcherArgs += @('--ip', $Ip) }
if ($Interface) { $launcherArgs += @('--interface', $Interface) }
if ($List) { $launcherArgs += '--list' }
if ($NoOpen) { $launcherArgs += '--no-open' }
& node @launcherArgs
exit $LASTEXITCODE
