@echo off
chcp 65001 >nul
title ApuntaPro - Stopp
cd /d "%~dp0"
echo Datenbank wird gestoppt (die Daten bleiben erhalten) ...
call docker compose -f dev\docker-compose.yml down
echo Fertig.
timeout /t 3 >nul
