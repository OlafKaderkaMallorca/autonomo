@echo off
rem Startet die lokale Datenbank (Port 5434) und wartet, bis sie bereit ist.
call docker compose -f dev\docker-compose.yml up -d
if errorlevel 1 (
  echo [FEHLER] Datenbank konnte nicht gestartet werden.
  exit /b 1
)
set /a VERSUCHE=0
:warte_db
docker compose -f dev\docker-compose.yml exec -T postgres pg_isready -U autonomo_owner -d autonomo >nul 2>&1
if not errorlevel 1 exit /b 0
set /a VERSUCHE+=1
if %VERSUCHE% geq 30 (
  echo [FEHLER] Datenbank ist nach 60 Sekunden noch nicht bereit.
  exit /b 1
)
timeout /t 2 /nobreak >nul
goto warte_db
