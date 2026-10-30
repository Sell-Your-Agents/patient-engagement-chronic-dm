# Starts everything needed for the app, each in its own window:
#   1. Cloudflare tunnel (public https URL so Twilio can reach the backend)
#   2. Backend  (FastAPI on port 8000)
#   3. Frontend (Vite on port 5173)
#
# Usage (from the project folder):
#   powershell -ExecutionPolicy Bypass -File .\start-all.ps1
#
# Uses a free Cloudflare "quick tunnel" (no account needed). Its address
# (https://<random>.trycloudflare.com) changes every time the tunnel starts, so this
# script writes the new address into API_BASE_URL in backend\.env and (re)starts the
# backend so it picks it up. Always start through this script.

$root = $PSScriptRoot

function Test-Port($port) {
    [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

function Stop-WithMessage($message) {
    Write-Host "`n$message" -ForegroundColor Red
    Write-Host "See SETUP_GUIDE.txt for help." -ForegroundColor Red
    exit 1
}

function Set-EnvValue($file, $key, $value) {
    $found = $false
    $lines = foreach ($line in Get-Content $file) {
        if ($line -match "^\s*$key\s*=") { $found = $true; "$key=$value" } else { $line }
    }
    if (-not $found) { $lines = @($lines) + "$key=$value" }
    # UTF-8 without BOM so the .env loader reads the first line cleanly
    [IO.File]::WriteAllLines($file, [string[]]$lines, (New-Object Text.UTF8Encoding $false))
}

function Stop-Backend {
    $owner = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty OwningProcess
    if (-not $owner) { return }
    # uvicorn --reload runs a reloader plus a worker process; kill the whole python tree
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$owner"
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($proc.ParentProcessId)" -ErrorAction SilentlyContinue
    $target = if ($parent -and $parent.Name -like 'python*') { $parent.ProcessId } else { $owner }
    taskkill /PID $target /T /F | Out-Null
    for ($i = 0; $i -lt 10 -and (Test-Port 8000); $i++) { Start-Sleep -Seconds 1 }
}

# ---------- Pre-flight checks ----------
$envFile = Join-Path $root "backend\.env"
if (-not (Test-Path $envFile)) { Stop-WithMessage "backend\.env not found. Copy backend\.env.example to backend\.env and fill it in." }
if (-not (Test-Path (Join-Path $root "backend\venv\Scripts\python.exe"))) { Stop-WithMessage "Python venv missing. Run once: cd backend; python -m venv venv; .\venv\Scripts\pip install -r requirements.txt" }
if (-not (Test-Path (Join-Path $root "frontend\node_modules"))) { Stop-WithMessage "Frontend packages missing. Run once: cd frontend; npm install" }

# Find cloudflared: on PATH first, then the usual install folders
$cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cloudflared) {
    $cloudflared = @(
        "C:\cloudflared\cloudflared.exe",
        "$env:ProgramFiles\cloudflared\cloudflared.exe",
        "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $cloudflared) {
    $cloudflared = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter cloudflared.exe -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName
}

# ---------- 1. Cloudflare tunnel ----------
$publicUrl = $null
if (-not $cloudflared) {
    Write-Host "[1/3] cloudflared not found - install it (see SETUP_GUIDE.txt Part D). Real phone calls won't work until then." -ForegroundColor Yellow
} else {
    Write-Host "[1/3] Starting Cloudflare tunnel..." -ForegroundColor Cyan
    # Restart so there is never a stale/duplicate tunnel (only ours, not other cloudflared uses)
    Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" |
        Where-Object { $_.CommandLine -match 'localhost:8000' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    $logDir = Join-Path $root "backend\logs"
    New-Item -ItemType Directory -Force $logDir | Out-Null
    $tunnelLog = Join-Path $logDir "cloudflared.log"
    Remove-Item $tunnelLog -ErrorAction SilentlyContinue
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$host.UI.RawUI.WindowTitle='CLOUDFLARE'; & '$cloudflared' tunnel --no-autoupdate --logfile '$tunnelLog' --url http://localhost:8000"
    for ($i = 0; $i -lt 40 -and -not $publicUrl; $i++) {
        Start-Sleep -Seconds 1
        if (Test-Path $tunnelLog) {
            $match = Select-String -Path $tunnelLog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
            if ($match) { $publicUrl = $match.Matches[0].Value }
        }
    }
    if ($publicUrl) {
        Set-EnvValue $envFile "API_BASE_URL" $publicUrl
        Write-Host "      Public URL: $publicUrl  (saved to API_BASE_URL in backend\.env)" -ForegroundColor Green
    } else {
        Write-Host "      Tunnel did not report a URL. Look at the CLOUDFLARE window for an error." -ForegroundColor Red
    }
}

# ---------- 2. Backend ----------
if ((Test-Port 8000) -and $publicUrl) {
    # The backend reads API_BASE_URL only at startup, so restart it to pick up the new tunnel URL
    Write-Host "[2/3] Restarting backend to use the new public URL..." -ForegroundColor Cyan
    Stop-Backend
}
if (Test-Port 8000) {
    Write-Host "[2/3] Backend already running on port 8000 - skipping" -ForegroundColor Yellow
} else {
    Write-Host "[2/3] Starting backend..." -ForegroundColor Cyan
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$host.UI.RawUI.WindowTitle='BACKEND'; cd '$root\backend'; .\venv\Scripts\python.exe run.py"
    for ($i = 0; $i -lt 40 -and -not (Test-Port 8000); $i++) { Start-Sleep -Seconds 1 }
    if (-not (Test-Port 8000)) { Stop-WithMessage "Backend did not start. Look at the BACKEND window for the error." }
}

# ---------- 3. Frontend ----------
if (Test-Port 5173) {
    Write-Host "[3/3] Frontend already running on port 5173 - skipping" -ForegroundColor Yellow
} else {
    Write-Host "[3/3] Starting frontend..." -ForegroundColor Cyan
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$host.UI.RawUI.WindowTitle='FRONTEND'; cd '$root\frontend'; npm run dev"
}

# ---------- Health check through the public URL (what Twilio uses) ----------
if ($publicUrl) {
    Write-Host "Checking $publicUrl/health ..." -ForegroundColor Cyan
    $ok = $false
    for ($i = 0; $i -lt 20 -and -not $ok; $i++) {
        Start-Sleep -Seconds 2
        try {
            $r = Invoke-WebRequest "$publicUrl/health" -UseBasicParsing -TimeoutSec 5
            $ok = $r.StatusCode -eq 200
        } catch { }
    }
    if ($ok) {
        Write-Host "`nALL READY. Open http://localhost:5173  (keep the 3 windows open)" -ForegroundColor Green
    } else {
        Write-Host "`nPublic URL is NOT reachable yet. Look at the CLOUDFLARE and BACKEND windows for an error." -ForegroundColor Red
    }
} else {
    Write-Host "`nReady (without phone calls). Open http://localhost:5173" -ForegroundColor Green
}
