# Beendet noch laufende ApuntaPro-Prozesse (API, Web-Portal, Expo) aus diesem Projektordner.
# Andere Node-Programme bleiben unberührt: es zählt nur, ob der Projektordner in der Befehlszeile steht.
$ordner = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$prozesse = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
  $_.CommandLine -and $_.CommandLine.IndexOf($ordner, [StringComparison]::OrdinalIgnoreCase) -ge 0
})
foreach ($p in $prozesse) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
if ($prozesse.Count -gt 0) { Write-Host "Alte ApuntaPro-Prozesse beendet: $($prozesse.Count)" }
