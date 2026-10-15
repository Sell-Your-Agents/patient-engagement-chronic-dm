# Starts everything needed for the app, each in its own window:
#   1. Backend  (FastAPI on port 8000)
#   2. ngrok    (public https URL so Twilio can reach the backend)
#   3. Frontend (Vite on port 5173)
#
# Usage (from the project folder):
#   powershell -ExecutionPolicy Bypass -File .\start-all.ps1
#
# The ngrok domain is read from API_BASE_URL in backend\.env, so each person uses
# their own ngrok account/domain without editing this script.

$root = $PSScriptRoot

function Test-Port($port) {
    [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

function Stop-WithMessage($message) {
    Write-Host "`n$message" -ForegroundColor Red
    Write-Host "See SETUP_GUIDE.txt for help." -ForegroundColor Red
    exit 1
}

# ---------- Pre-flight checks ----------
$envFile = Join-Path $root "backend\.env"
if (-not (Test-Path $envFile)) { Stop-WithMessage "backend\.env not found. Copy backend\.env.example to backend\.env and fill it in." }
if (-not (Test-Path (Join-Path $root "backend\venv\Scripts\python.exe"))) { Stop-WithMessage "Python venv missing. Run once: cd backend; python -m venv venv; .\venv\Scripts\pip install -r requirements.txt" }
if (-not (Test-Path (Join-Path $root "frontend\node_modules"))) { Stop-WithMessage "Frontend packages missing. Run once: cd frontend; npm install" }

$apiLine = Get-Content $envFile | Where-Object { $_ -match '^\s*API_BASE_URL\s*=' } | Select-Object -First 1
$apiBase = if ($apiLine) { ($apiLine -split '=', 2)[1].Trim().Trim('"').TrimEnd('/') } else { "" }
$domain = $apiBase -replace '^https?://', ''
$useNgrok = $apiBase -match '^https://' -and $domain -notmatch '^localhost'

# Find ngrok: on PATH first, then the default winget install folder
$ngrok = (Get-Command ngrok -ErrorAction SilentlyContinue).Source
if (-not $ngrok) {
    $ngrok = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter ngrok.exe -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName
}

# ---------- 1. Backend ----------
if (Test-Port 8000) {
    Write-Host "[1/3] Backend already running on port 8000 - skipping" -ForegroundColor Yellow
} else {
    Write-Host "[1/3] Starting backend..." -ForegroundColor Cyan
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$host.UI.RawUI.WindowTitle='BACKEND'; cd '$root\backend'; .\venv\Scripts\python.exe run.py"
    for ($i = 0; $i -lt 40 -and -not (Test-Port 8000); $i++) { Start-Sleep -Seconds 1 }
    if (-not (Test-Port 8000)) { Stop-WithMessage "Backend did not start. Look at the BACKEND window for the error." }
}

# ---------- 2. ngrok ----------
if (-not $useNgrok) {
    Write-Host "[2/3] API_BASE_URL is not an https ngrok address - skipping ngrok (dashboard works, real phone calls won't)" -ForegroundColor Yellow
} elseif (-not $ngrok) {
    Write-Host "[2/3] ngrok not found - install it (see SETUP_GUIDE.txt Part D). Real phone calls won't work until then." -ForegroundColor Yellow
} else {
    Write-Host "[2/3] Starting ngrok on https://$domain ..." -ForegroundColor Cyan
    # Restart so there is never a stale/duplicate tunnel
    Get-Process ngrok -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 1
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$host.UI.RawUI.WindowTitle='NGROK'; & '$ngrok' http --domain=$domain 8000"
}

# ---------- 3. Frontend ----------
if (Test-Port 5173) {
    Write-Host "[3/3] Frontend already running on port 5173 - skipping" -ForegroundColor Yellow
} else {
    Write-Host "[3/3] Starting frontend..." -ForegroundColor Cyan
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$host.UI.RawUI.WindowTitle='FRONTEND'; cd '$root\frontend'; npm run dev"
}

# ---------- Health check through the public URL (what Twilio uses) ----------
if ($useNgrok -and $ngrok) {
    Write-Host "Checking https://$domain/health ..." -ForegroundColor Cyan
    $ok = $false
    for ($i = 0; $i -lt 15 -and -not $ok; $i++) {
        Start-Sleep -Seconds 2
        try {
            $r = Invoke-WebRequest "https://$domain/health" -Headers @{ "ngrok-skip-browser-warning" = "1" } -UseBasicParsing -TimeoutSec 5
            $ok = $r.StatusCode -eq 200
        } catch { }
    }
    if ($ok) {
        Write-Host "`nALL READY. Open http://localhost:5173  (keep the 3 windows open)" -ForegroundColor Green
    } else {
        Write-Host "`nPublic URL is NOT reachable yet. Look at the NGROK window for an error." -ForegroundColor Red
    }
} else {
    Write-Host "`nReady (without phone calls). Open http://localhost:5173" -ForegroundColor Green
}
