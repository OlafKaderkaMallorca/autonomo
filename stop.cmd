@echo off
title ApuntaPro - Stopp
cd /d "%~dp0"
echo API und Web-Portal werden beendet ...
call scripts\windows\_beenden.cmd
echo Datenbank wird gestoppt (die Daten bleiben erhalten) ...
call docker compose -f dev\docker-compose.yml down
echo Fertig.
timeout /t 3 >nul
