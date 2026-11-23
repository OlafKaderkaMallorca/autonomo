@echo off
rem Beendet noch laufende ApuntaPro-Prozesse aus diesem Projektordner (siehe _beenden.ps1).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0_beenden.ps1"
exit /b 0
