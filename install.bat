@echo off
setlocal EnableDelayedExpansion
title PoleBrowse Installer

:: ╔══════════════════════════════════════════════╗
:: ║       PoleBrowse Windows Installer           ║
:: ║              by RidelL                       ║
:: ╚══════════════════════════════════════════════╝

set "APP_NAME=PoleBrowse"
set "APP_VERSION=1.0.0"
set "REPO_URL=https://github.com/RidelLazor/polebrowse"
set "INSTALL_DIR=%LOCALAPPDATA%\PoleBrowse"
set "NODE_MIN=16"

echo.
echo  ██████╗  ██████╗ ██╗     ███████╗
echo  ██╔══██╗██╔═══██╗██║     ██╔════╝
echo  ██████╔╝██║   ██║██║     █████╗
echo  ██╔═══╝ ██║   ██║██║     ██╔══╝
echo  ██║     ╚██████╔╝███████╗███████╗
echo  ╚═╝      ╚═════╝ ╚══════╝╚══════╝
echo            B R O W S E  by RidelL
echo.

:: Check for uninstall flag
if "%1"=="--uninstall" goto :uninstall
if "%1"=="/uninstall" goto :uninstall

:: Check Node.js
echo [^>] Checking Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Node.js not found. Opening download page...
    start https://nodejs.org/en/download
    echo [!] Please install Node.js 18+, then run this installer again.
    pause
    exit /b 1
)

for /f "tokens=1 delims=v." %%a in ('node --version') do set NODE_VER=%%a
echo [OK] Node.js found

:: Check git
echo [^>] Checking git...
where git >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Git not found. Opening download page...
    start https://git-scm.com/download/win
    echo [!] Please install Git, then run this installer again.
    pause
    exit /b 1
)
echo [OK] Git found

:: Create install dir
echo [^>] Creating install directory...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

:: Clone or copy
echo [^>] Downloading PoleBrowse...
if exist "%INSTALL_DIR%\app" (
    echo [^>] Updating existing installation...
    cd /d "%INSTALL_DIR%\app"
    git pull
) else (
    git clone --depth=1 "%REPO_URL%" "%INSTALL_DIR%\app"
    if %errorlevel% neq 0 (
        echo [!] Could not clone from GitHub.
        echo [^>] Trying local files...
        xcopy /E /I /Y "%~dp0src" "%INSTALL_DIR%\app\src\"
        copy "%~dp0package.json" "%INSTALL_DIR%\app\"
        copy "%~dp0forge.config.js" "%INSTALL_DIR%\app\"
    )
)

:: Install npm deps
echo [^>] Installing dependencies...
cd /d "%INSTALL_DIR%\app"
call npm install --omit=dev
if %errorlevel% neq 0 call npm install

:: Create launcher batch
echo [^>] Creating launcher...
(
echo @echo off
echo cd /d "%INSTALL_DIR%\app"
echo start "" npx electron .
) > "%LOCALAPPDATA%\Microsoft\WindowsApps\polebrowse.bat"

:: Create Start Menu shortcut
set "SHORTCUT=%APPDATA%\Microsoft\Windows\Start Menu\Programs\PoleBrowse.lnk"
powershell -Command "$WS = New-Object -ComObject WScript.Shell; $SC = $WS.CreateShortcut('%SHORTCUT%'); $SC.TargetPath = '%LOCALAPPDATA%\Microsoft\WindowsApps\polebrowse.bat'; $SC.WorkingDirectory = '%INSTALL_DIR%\app'; $SC.Description = 'PoleBrowse Browser'; $SC.Save()"

:: Create Desktop shortcut
set "DESKTOP_SC=%USERPROFILE%\Desktop\PoleBrowse.lnk"
powershell -Command "$WS = New-Object -ComObject WScript.Shell; $SC = $WS.CreateShortcut('%DESKTOP_SC%'); $SC.TargetPath = '%LOCALAPPDATA%\Microsoft\WindowsApps\polebrowse.bat'; $SC.WorkingDirectory = '%INSTALL_DIR%\app'; $SC.Description = 'PoleBrowse Browser'; $SC.Save()"

echo.
echo  ==========================================
echo    PoleBrowse installed successfully!
echo  ==========================================
echo.
echo   Run:    polebrowse  (from Command Prompt)
echo   Or:     Desktop shortcut / Start Menu
echo   Remove: install.bat --uninstall
echo.
pause
exit /b 0

:uninstall
echo [^>] Uninstalling PoleBrowse...
if exist "%INSTALL_DIR%" rmdir /S /Q "%INSTALL_DIR%"
if exist "%LOCALAPPDATA%\Microsoft\WindowsApps\polebrowse.bat" del "%LOCALAPPDATA%\Microsoft\WindowsApps\polebrowse.bat"
if exist "%APPDATA%\Microsoft\Windows\Start Menu\Programs\PoleBrowse.lnk" del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\PoleBrowse.lnk"
if exist "%USERPROFILE%\Desktop\PoleBrowse.lnk" del "%USERPROFILE%\Desktop\PoleBrowse.lnk"
echo [OK] PoleBrowse uninstalled.
pause
exit /b 0
