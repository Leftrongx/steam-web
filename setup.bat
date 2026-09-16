@echo off
echo ============================================
echo   StreamVerse — Initial Setup
echo ============================================
echo.
echo This will create the data directory.
echo Default admin credentials: admin / admin123
echo You can change them via environment variables:
echo   set ADMIN_USERNAME=myuser
echo   set ADMIN_PASSWORD=mypass
echo.
mkdir data 2>nul
if not exist data (
  echo ERROR: Failed to create data directory.
  exit /b 1
)
if not exist data\channels.json (
  echo {"channels":[],"streams":[],"schedule":[]} > data\channels.json
  echo Created data/channels.json with default structure.
) else (
  data/channels.json already exists.
)
echo.
echo Setup complete! Run start-server.bat to start the server.
echo.
pause
