@echo off
echo ========================================================
echo   Uninstalling uDrop
echo ========================================================
echo.
echo Stopping running uDrop instances...
if exist "%~dp0udrop.exe" "%~dp0udrop.exe" --stop 2>nul
if exist "%LOCALAPPDATA%\uDrop\udrop.exe" "%LOCALAPPDATA%\uDrop\udrop.exe" --stop 2>nul
taskkill /F /IM udrop.exe 2>nul

echo Removing Windows Startup auto-start entry...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "uDrop" /f 2>nul

echo Removing Explorer Share via uDrop context menu...
reg delete "HKCU\Software\Classes\*\shell\uDropShare" /f 2>nul

echo Removing Windows Installed Apps registration...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\uDrop" /f 2>nul

echo Removing Desktop and Start Menu shortcuts...
del "%USERPROFILE%\Desktop\uDrop.lnk" 2>nul
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\uDrop.lnk" 2>nul

echo Removing installation files...
if exist "%LOCALAPPDATA%\uDrop" rmdir /s /q "%LOCALAPPDATA%\uDrop" 2>nul
set "SELF_DIR=%~dp0"
if /I not "%SELF_DIR:~0,-1%"=="%CD%" (
  echo Cleanup complete.
)

echo.
echo Success: uDrop has been completely removed from this PC.
echo.
if /I not "%~1"=="/S" pause
