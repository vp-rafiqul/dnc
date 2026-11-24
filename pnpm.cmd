@echo off
setlocal

if not exist "%~dp0.local\temp\" mkdir "%~dp0.local\temp"
set "TEMP=%~dp0.local\temp"
set "TMP=%TEMP%"
if exist "%~dp0.local\node\node.exe" set "PATH=%~dp0.local\node;%PATH%"

if exist "%~dp0.local\pnpm\bin\pnpm.mjs" (
  node "%~dp0.local\pnpm\bin\pnpm.mjs" %*
  exit /b
)

where.exe npx.cmd >nul 2>&1
if errorlevel 1 (
  echo Install Node.js 22 or newer with npm, then rerun this command. 1>&2
  exit /b 1
)

call npx.cmd --yes pnpm@11.25.0 %*
exit /b
