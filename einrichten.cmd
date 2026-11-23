@echo off
chcp 65001 >nul
title ApuntaPro - Einrichten
cd /d "%~dp0"
echo.
echo  ===  ApuntaPro: einmalige Einrichtung  ===
echo.

call scripts\windows\_pruefen.cmd || goto fehler

echo Pakete werden installiert ...
call pnpm install || goto fehler

echo Datenbank wird gestartet (Port 5434) ...
call scripts\windows\_datenbank.cmd || goto fehler

echo Datenbank und Demo-Daten werden eingerichtet ...
call pnpm run einrichten || goto fehler

echo.
echo  Fertig. Starte jetzt start.cmd
echo  Anmeldung: olaf@demo.local / demo-passwort
echo.
pause
exit /b 0

:fehler
echo.
echo  Einrichtung abgebrochen. Die Meldung oben zeigt den Grund.
pause
exit /b 1
