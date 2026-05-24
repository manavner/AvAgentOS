@echo off
title Hermes Bridge
color 0A
echo.
echo  ╔══════════════════════════════════╗
echo  ║      Hermes Bridge  v1.0         ║
echo  ║   OpenAI API for Hermes Docker   ║
echo  ╚══════════════════════════════════╝
echo.

cd /d "%~dp0"

:: Install deps if needed
python -c "import fastapi" 2>nul || (
    echo  Installing dependencies...
    pip install -r requirements.txt
    echo.
)

echo  Starting bridge on http://localhost:8765
echo  Press Ctrl+C to stop.
echo.
python bridge.py
pause
