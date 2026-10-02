@echo off
setlocal
rem CHORD//SCOPE launcher - opens the app in its own window
rem (Microsoft Edge or Google Chrome "app" mode: no tabs, no address bar).
rem Keep this file in the same folder as index.html.

set "APP=%~dp0index.html"
if not exist "%APP%" set "APP=%~dp0ChordScope.html"
if not exist "%APP%" (
  echo index.html was not found next to this launcher.
  echo Put this file in the same folder as index.html and try again.
  pause
  exit /b 1
)
set "URL=file:///%APP:\=/%"

rem A dedicated profile keeps the MIDI permission and the window size between launches.
set "HOME_DIR=%LOCALAPPDATA%\ChordScope"
set "PROFILE=%HOME_DIR%\browser-profile"
set "SIZE="
if not exist "%HOME_DIR%\window-v2" (
  set "SIZE=--window-size=1180,720"
  if not exist "%HOME_DIR%\" mkdir "%HOME_DIR%"
  type nul > "%HOME_DIR%\window-v2"
)

set "BROWSER="
for %%B in (
  "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
  "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
  "%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe"
  "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
  "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
) do (
  if not defined BROWSER if exist "%%~B" set "BROWSER=%%~B"
)

if not defined BROWSER (
  rem No Edge or Chrome found - fall back to the default browser.
  start "" "%APP%"
  exit /b 0
)

rem --autoplay-policy lets the piano sound straight away, without a click first.
start "" "%BROWSER%" --app="%URL%" --user-data-dir="%PROFILE%" %SIZE% --no-first-run --no-default-browser-check --autoplay-policy=no-user-gesture-required
exit /b 0
