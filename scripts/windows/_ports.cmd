@echo off
rem Prueft, ob die Ports fuer Web-Portal und API frei sind. LISTENING = englisches, ABHOEREN = deutsches Windows.
set BELEGT=
for %%p in (3002 4002) do (
  netstat -ano | findstr /r /c:":%%p .*LISTENING" /c:":%%p .*ABH" >nul && set BELEGT=%%p
)
if not defined BELEGT exit /b 0
echo.
echo [FEHLER] Port %BELEGT% ist schon belegt, vermutlich von einem anderen Projekt.
echo          Bitte das andere Projekt beenden oder die Ports von ApuntaPro aendern lassen.
echo          Welches Programm den Port nutzt:  netstat -ano ^| findstr :%BELEGT%
exit /b 1
