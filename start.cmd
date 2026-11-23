@echo off
rem Fenster bleibt bei einem Abbruch offen, damit die Fehlermeldung lesbar ist
if not defined APUNTA_FENSTER (
  set APUNTA_FENSTER=1
  cmd /k call "%~f0" %*
  exit /b
)
title ApuntaPro - API (4002) + Web (3002)
cd /d "%~dp0"

call scripts\windows\_pruefen.cmd || goto fehler
if not exist node_modules (
  echo Noch nicht eingerichtet. Bitte zuerst einrichten.cmd ausfuehren.
  goto fehler
)
call scripts\windows\_ports.cmd || goto fehler
call scripts\windows\_datenbank.cmd || goto fehler

rem Ausstehende Datenbank-Aenderungen nach einem Update einspielen
call pnpm --filter @autonomo/shared build >nul || goto fehler
call pnpm --filter @autonomo/api migrate:dev || goto fehler

rem Browser oeffnen, sobald das Portal antwortet
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 60;$i++){try{Invoke-WebRequest http://localhost:3002/login -UseBasicParsing -TimeoutSec 2 | Out-Null; Start-Process 'http://localhost:3002'; break}catch{Start-Sleep 2}}"

echo.
echo  Web-Portal: http://localhost:3002    API: http://localhost:4002
echo  Anmeldelinks per E-Mail erscheinen hier im Fenster.
echo  Beenden mit Strg+C (danach optional stop.cmd fuer die Datenbank).
echo.
call pnpm dev
exit /b 0

:fehler
pause
exit /b 1
