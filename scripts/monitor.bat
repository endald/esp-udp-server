@echo off
echo ========================================
echo Starting ESP32 Audio Monitor System
echo ========================================
echo.

cd ..

echo Killing any existing Node processes...
taskkill /F /IM node.exe 2>nul
timeout /t 2 /nobreak > nul

echo.
echo Starting UDP Audio Server...
start "UDP Server" cmd /k node server/udp-server.js

timeout /t 3 /nobreak > nul

echo Starting ESP32 Simulators with Monitoring...
start "ESP32 Simulators" cmd /k node test/esp32-simulator-monitor.js --devices=3

timeout /t 3 /nobreak > nul

echo.
echo Opening Device Monitors...
echo.
echo Device 001 (Square Wave): http://localhost:8001
start http://localhost:8001

timeout /t 1 /nobreak > nul

echo Device 002 (Sawtooth Wave): http://localhost:8002
start http://localhost:8002

timeout /t 1 /nobreak > nul

echo Device 003 (Noise): http://localhost:8003
start http://localhost:8003

timeout /t 1 /nobreak > nul

echo.
echo Opening Main Dashboard...
start http://localhost:8080
start "Dashboard Server" cmd /k python -m http.server 8080 -d dashboard

echo.
echo ========================================
echo System Started Successfully!
echo ========================================
echo.
echo Monitors:
echo   Device 001: http://localhost:8001 (Square)
echo   Device 002: http://localhost:8002 (Sawtooth)
echo   Device 003: http://localhost:8003 (Noise)
echo.
echo Dashboard: http://localhost:8080
echo.
echo Configure routing in the dashboard and watch
echo real-time waveforms in device monitors!
echo.
echo Press any key to stop all services...
pause > nul

echo.
echo Stopping all services...
taskkill /FI "WindowTitle eq UDP Server*" /T /F 2>nul
taskkill /FI "WindowTitle eq ESP32 Simulators*" /T /F 2>nul
taskkill /FI "WindowTitle eq Dashboard Server*" /T /F 2>nul

echo All services stopped.
pause