# convo-debug.ps1 — Native Windows PowerShell browser debugging probe & WSL2 bridge helper
param (
    [int]$Port = 9222,
    [switch]$ConfigureWslBridge
)

$ErrorActionPreference = "Continue"

Write-Host "ConvoLink Windows Browser Debug Probe" -ForegroundColor Cyan
Write-Host ""

$debugUrl = "http://127.0.0.1:$Port/json/version"

# 1. Probe local loopback
Write-Host "Probing 127.0.0.1:$Port..." -ForegroundColor Gray
try {
    $res = Invoke-RestMethod -Uri $debugUrl -TimeoutSec 1 -ErrorAction Stop
    Write-Host "OK Remote debugging is ACTIVE on 127.0.0.1:$Port" -ForegroundColor Green
    Write-Host "   Browser: $($res.Browser)" -ForegroundColor Gray
    Write-Host "   WebSocket: $($res.webSocketDebuggerUrl)" -ForegroundColor Gray
    exit 0
} catch {
    # Port is not listening
}

# 2. Check running processes
$runningBrowsers = Get-Process chrome, msedge, brave -ErrorAction SilentlyContinue
if ($runningBrowsers) {
    Write-Host ""
    Write-Host "Warning: Browser is currently running, but remote debugging port $Port is closed." -ForegroundColor Yellow
    Write-Host "Chromium ignores '--remote-debugging-port' when joining an already-running process."
    Write-Host ""
    Write-Host "Recommended solutions:"
    Write-Host "  1. In your active browser, open: chrome://inspect/#remote-debugging"
    Write-Host "  2. Or pair the Companion Extension: convo ext pair"
    Write-Host "  3. Or launch with an isolated profile: convo profile select 1"
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "i No active browser detected on port $Port." -ForegroundColor Blue
    Write-Host "Launch Chrome with remote debugging:"
    Write-Host "  chrome.exe --remote-debugging-port=$Port"
    Write-Host ""
}

# 3. WSL2 Portproxy & Firewall Setup
if ($ConfigureWslBridge) {
    Write-Host "Configuring WSL2 Port Proxy and Windows Defender Firewall rule..." -ForegroundColor Cyan
    Write-Host "Elevated Administrator privileges are required for netsh and firewall rules." -ForegroundColor Gray
    try {
        netsh interface portproxy add v4tov4 listenport=$Port listenaddress=0.0.0.0 connectport=$Port connectaddress=127.0.0.1
        Write-Host "OK Port proxy active: 0.0.0.0:$Port -> 127.0.0.1:$Port" -ForegroundColor Green

        New-NetFirewallRule -DisplayName "ConvoLink WSL Chrome CDP" -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -ErrorAction SilentlyContinue | Out-Null
        Write-Host "OK Windows Defender Firewall rule added for port $Port." -ForegroundColor Green
    } catch {
        Write-Host "Error configuring port proxy: $_" -ForegroundColor Red
        Write-Host "Run this command in an elevated PowerShell terminal (Run as Administrator):"
        Write-Host "  netsh interface portproxy add v4tov4 listenport=$Port listenaddress=0.0.0.0 connectport=$Port connectaddress=127.0.0.1"
    }
} else {
    Write-Host "Tip for WSL2 users:" -ForegroundColor Gray
    Write-Host "  To bridge Windows Chrome to WSL2, run with -ConfigureWslBridge in Administrator PowerShell:"
    Write-Host "  powershell -File .\scripts\convo-debug.ps1 -ConfigureWslBridge" -ForegroundColor Gray
}
