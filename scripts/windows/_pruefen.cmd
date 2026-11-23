@echo off
rem Gemeinsame Prüfungen: Node.js, pnpm und Docker Desktop. Wird von den anderen .cmd-Dateien aufgerufen.

where node >nul 2>&1
if errorlevel 1 (
  echo [FEHLER] Node.js ist nicht installiert. Bitte Node.js 24 (LTS) von https://nodejs.org installieren.
  exit /b 1
)

where pnpm >nul 2>&1
if errorlevel 1 (
  echo pnpm wird eingerichtet ...
  call corepack enable
  if errorlevel 1 (
    echo [FEHLER] corepack enable ist fehlgeschlagen. Terminal einmal als Administrator starten und erneut versuchen.
    exit /b 1
  )
)

docker info >nul 2>&1
if not errorlevel 1 exit /b 0

echo Docker Desktop wird gestartet ...
if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
set /a VERSUCHE=0
:warte_docker
timeout /t 3 /nobreak >nul
docker info >nul 2>&1
if not errorlevel 1 exit /b 0
set /a VERSUCHE+=1
if %VERSUCHE% lss 40 goto warte_docker
echo [FEHLER] Docker Desktop antwortet nicht. Bitte Docker Desktop starten und erneut versuchen.
exit /b 1
