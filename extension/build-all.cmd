@echo off
setlocal

cd /d "%~dp0"

echo Building Chrome extension...
call pnpm build
if errorlevel 1 (
  echo Chrome build failed.
  pause
  exit /b 1
)

echo Building Edge extension...
call pnpm build:edge
if errorlevel 1 (
  echo Edge build failed.
  pause
  exit /b 1
)

echo.
echo Chrome and Edge builds completed successfully.
pause