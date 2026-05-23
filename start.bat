@echo off
title AvAgentOS Mission Control
color 0B
echo.
echo  ╔══════════════════════════════════════╗
echo  ║        AvAgentOS  v1.0               ║
echo  ║     Starting Mission Control...      ║
echo  ╚══════════════════════════════════════╝
echo.

cd /d "%~dp0"

:: Check if node_modules exists
if not exist "node_modules" (
    echo  Installing dependencies...
    npm install
    echo.
)

echo  Opening browser in 2 seconds...
timeout /t 2 /nobreak >nul
start http://localhost:3131

echo  Server running at http://localhost:3131
echo  Press Ctrl+C to stop.
echo.
node server.js
pause
