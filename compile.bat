@echo off
chcp 65001 > nul
echo ============================================
echo   LyricsOverlay ^^ Compiler  (.NET 4 / csc)
echo ============================================
echo.

:: Try 64-bit first, fall back to 32-bit
set CSC64=C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe
set CSC32=C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe

if exist "%CSC64%" (
    set CSC=%CSC64%
    echo [compiler] Using 64-bit csc.exe
) else if exist "%CSC32%" (
    set CSC=%CSC32%
    echo [compiler] Using 32-bit csc.exe
) else (
    echo [ERROR] .NET Framework 4 csc.exe not found!
    echo.
    echo Expected locations:
    echo   %CSC64%
    echo   %CSC32%
    echo.
    echo Make sure .NET Framework 4 is installed.
    pause
    exit /b 1
)

echo [compiler] Compiling LyricsOverlay.cs ...
echo.

"%CSC%" ^
    /target:winexe ^
    /optimize+ ^
    /r:System.dll ^
    /r:System.Drawing.dll ^
    /r:System.Windows.Forms.dll ^
    /r:System.Net.dll ^
    /out:LyricsOverlay.exe ^
    LyricsOverlay.cs

if %ERRORLEVEL% == 0 (
    echo.
    echo  SUCCESS  --  LyricsOverlay.exe created!
    echo.
    echo  Run LyricsOverlay.exe, then open your browser
    echo  with one of the userscripts installed.
) else (
    echo.
    echo  COMPILE FAILED -- see errors above.
)

echo.
pause
