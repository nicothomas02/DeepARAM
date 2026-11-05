@echo off
rem Double-click to open the stats dashboard. With League open and signed in, it imports your Mayhem games
rem by itself after each game. Keep this window open while you play; close it to stop.
cd /d "%~dp0"
py -3 mayhem_import.py --serve --watch %* || python mayhem_import.py --serve --watch %*
pause
