@echo off
REM ============================================================
REM  V-Showcase deploy - one shot: build + upload to Cloudflare
REM ------------------------------------------------------------
REM  Uploads dist/ to the Cloudflare Pages project "vshowcase"
REM  https://vshowcase.pages.dev
REM
REM  Rules for this file - same as site.bat:
REM    1. MUST be CRLF  -- cmd.exe silently mis-parses LF-only .bat
REM    2. ASCII ONLY    -- cmd reads .bat with the system ANSI codepage
REM    3. No parentheses or quotes inside REM comments.
REM ============================================================
chcp 65001 >nul 2>&1
cd /d "%~dp0\.."

setlocal EnableDelayedExpansion

echo.
echo ============================================================
echo   V-Showcase deploy - build + upload to Cloudflare Pages
echo   https://vshowcase.pages.dev
echo ============================================================
echo.

REM ---------- [1/3] preflight ----------
where node >nul 2>&1
if %errorlevel% neq 0 (
  echo [X] Node.js not found. Install it from https://nodejs.org
  echo.
  pause
  exit /b 1
)
echo [1/3] Node.js found

if not exist "node_modules" (
  echo       First run - installing deps, about 30-90s
  call npm install --no-audit --no-fund --loglevel=error
  if !errorlevel! neq 0 (
    echo [X] Install failed. Run manually: npm install
    echo.
    pause
    exit /b 1
  )
)

REM ---------- [2/3] build ----------
echo [2/3] Building dist/ - about 5-15s
call npm run build
if !errorlevel! neq 0 (
  echo [X] Build failed. Run manually: npm run build
  echo.
  pause
  exit /b 1
)
echo       - dist/ is up to date

REM ---------- [3/3] deploy ----------
echo [3/3] Uploading to Cloudflare Pages
echo       - First run downloads wrangler, may take 1-3 minutes
call npx wrangler pages deploy dist --project-name vshowcase --branch main --commit-dirty=true
if !errorlevel! neq 0 (
  echo [X] Deploy failed.
  echo     - If wrangler asks you to log in, run: npx wrangler login
  echo     - Then run this file again.
  echo.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   Done - site updated: https://vshowcase.pages.dev
echo ============================================================
echo.
pause
endlocal
exit /b 0
