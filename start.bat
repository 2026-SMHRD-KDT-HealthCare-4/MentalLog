@echo off
start "React" cmd /k "cd /d %~dp0react && npm run dev"
start "Node" cmd /k "cd /d %~dp0node && node server.js"
start "Python" cmd /k "cd /d %~dp0python && python hrv_main.py"
