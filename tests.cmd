@echo off
rem Fenster bleibt bei einem Abbruch offen, damit die Fehlermeldung lesbar ist
if not defined APUNTA_FENSTER (
  set APUNTA_FENSTER=1
  cmd /k call "%~f0" %*
  exit /b
)
title ApuntaPro - Tests
cd /d "%~dp0"
call scripts\windows\_pruefen.cmd || goto ende
call scripts\windows\_datenbank.cmd || goto ende
call pnpm --filter @autonomo/shared build >nul
call pnpm typecheck && call pnpm test
:ende
pause
