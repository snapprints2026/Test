@echo off
REM Starts the SnapPrints agent automatically every time this Windows user logs in.
cd /d "%~dp0"
set "TARGET=%~dp0start-agent.bat"
set "LINK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\SnapPrints Print Agent.lnk"
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%LINK%'); $s.TargetPath='%TARGET%'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.Save()"
if exist "%LINK%" (echo Done. The agent will start automatically when you log in.) else (echo Could not create the startup shortcut.)
pause
