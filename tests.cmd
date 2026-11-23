@echo off
chcp 65001 >nul
title ApuntaPro - Tests
cd /d "%~dp0"
call scripts\windows\_pruefen.cmd || goto ende
call scripts\windows\_datenbank.cmd || goto ende
call pnpm --filter @autonomo/shared build >nul
call pnpm typecheck && call pnpm test
:ende
pause
