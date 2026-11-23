@echo off
rem Fenster bleibt bei einem Abbruch offen, damit die Fehlermeldung lesbar ist
if not defined APUNTA_FENSTER (
  set APUNTA_FENSTER=1
  cmd /k call "%~f0" %*
  exit /b
)
title ApuntaPro - Aktualisieren
cd /d "%~dp0"
echo.
echo  ===  ApuntaPro: neuen Stand holen  ===
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo [FEHLER] Git ist nicht installiert. Bitte von https://git-scm.com installieren.
  goto fehler
)

rem Nicht ueberschreiben, was lokal geaendert wurde
set GEAENDERT=
for /f "delims=" %%z in ('git status --porcelain --untracked-files=no') do set GEAENDERT=1
if defined GEAENDERT (
  echo [ABBRUCH] Folgende Dateien wurden auf diesem PC geaendert:
  git status --short --untracked-files=no
  echo.
  echo Bitte Claude die Liste schicken, dann klaeren wir, was damit passieren soll.
  goto fehler
)

echo Wechsle auf den Hauptstand (main) ...
git checkout main || goto fehler

rem Alles Folgende steht in einem Block: cmd liest ihn vollstaendig ein, bevor git pull
rem diese Datei womoeglich durch eine neue Fassung ersetzt.
(
  echo Neuer Stand wird geholt ...
  git pull --ff-only || goto fehler
  echo.
  call einrichten.cmd
  exit /b
)

:fehler
echo.
echo  Es hat nicht geklappt. Die Meldung oben bitte an Claude schicken.
echo.
pause
exit /b 1
