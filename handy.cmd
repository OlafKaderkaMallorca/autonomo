@echo off
rem Fenster bleibt bei einem Abbruch offen, damit die Fehlermeldung lesbar ist
if not defined APUNTA_FENSTER (
  set APUNTA_FENSTER=1
  cmd /k "%~f0" %*
  exit /b
)
title ApuntaPro - Handy-App (Expo)
cd /d "%~dp0"

rem IP-Adresse des PCs im WLAN/LAN ermitteln, damit das Handy die API erreicht
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL|Docker' -and $_.IPAddress -notlike '169.254*' } | Sort-Object InterfaceMetric | Select-Object -First 1).IPAddress"`) do set PC_IP=%%i
if "%PC_IP%"=="" (
  echo [FEHLER] IP-Adresse nicht gefunden. Ist der PC mit dem WLAN verbunden?
  pause
  exit /b 1
)
set EXPO_PUBLIC_API_URL=http://%PC_IP%:4002

echo.
echo  Voraussetzung: start.cmd laeuft in einem anderen Fenster.
echo  Die App spricht mit der API unter %EXPO_PUBLIC_API_URL%
echo  QR-Code mit der App "Expo Go" scannen (Handy im selben WLAN).
echo  Falls die Windows-Firewall fragt: Zugriff im privaten Netzwerk erlauben.
echo.
call pnpm dev:mobile
