@echo off
echo ========================================
echo ESP32 UDP Audio System Setup
echo ========================================
echo.

echo Installing Node.js dependencies...
cd ..
call npm install

if %errorlevel% neq 0 (
    echo Error: Failed to install dependencies
    pause
    exit /b 1
)

echo.
echo Creating required directories...
if not exist logs mkdir logs
if not exist recordings mkdir recordings

echo.
echo ========================================
echo Setup Complete!
echo ========================================
echo.
echo To start the system:
echo   1. Start Server: npm start
echo   2. Start Simulators: npm run simulator
echo   3. Open Dashboard: npm run dashboard
echo.
echo Or use the run-all.bat script to start everything.
echo.
pause