@echo off
echo ========================================
echo Starting UDP Audio System
echo ========================================
echo.

cd ..

echo Starting UDP Server...
start "UDP Server" cmd /k node server/udp-server.js

timeout /t 2 /nobreak > nul

echo Starting ESP32 Simulators...
start "ESP32 Simulators" cmd /k node test/esp32-simulator.js --devices=3

timeout /t 2 /nobreak > nul

echo Opening Dashboard...
start http://localhost:8080
start "Dashboard Server" cmd /k python -m http.server 8080 -d dashboard

echo.
echo ========================================
echo System Started!
echo ========================================
echo.
echo Server: http://localhost:8081 (WebSocket)
echo Dashboard: http://localhost:8080
echo.
echo Press any key to stop all services...
pause > nul

echo.
echo Stopping services...
taskkill /FI "WindowTitle eq UDP Server*" /T /F
taskkill /FI "WindowTitle eq ESP32 Simulators*" /T /F
taskkill /FI "WindowTitle eq Dashboard Server*" /T /F

echo All services stopped.
pause