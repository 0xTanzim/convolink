# install.ps1 — Universal Windows PowerShell installer for ConvoLink CLI
# Usage: irm https://raw.githubusercontent.com/0xTanzim/convolink/main/scripts/install.ps1 | iex
$ErrorActionPreference = "Stop"

Write-Host "ConvoLink Universal Runtime Installer (Windows)" -ForegroundColor Cyan
Write-Host ""

# 1. Environment Auditing
$arch = $env:PROCESSOR_ARCHITECTURE
Write-Host "i Detected environment: Windows ($arch)" -ForegroundColor Blue

# 2. Target Directory Setup
$installDir = Join-Path $env:LOCALAPPDATA "convolink\bin"
if (-not (Test-Path $installDir)) {
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
}

# 3. Resolve Runtime Engine
$hasBun = Get-Command bun -ErrorAction SilentlyContinue
$hasNode = Get-Command node -ErrorAction SilentlyContinue

if (-not $hasBun -and -not $hasNode) {
    Write-Host "Warning: Neither Bun nor Node.js was found in PATH." -ForegroundColor Yellow
    Write-Host "Installing Bun runtime recommended: powershell -c ""irm bun.sh/install.ps1|iex""" -ForegroundColor Blue
}

# 4. Generate Wrappers (Batch CMD + PowerShell PS1)
$cmdWrapper = Join-Path $installDir "convo.cmd"
$cmdContent = @"
@echo off
where bun >nul 2>nul
if %errorlevel% equ 0 (
    bunx -y convolink@latest %*
) else (
    npx -y convolink@latest %*
)
"@
Set-Content -Path $cmdWrapper -Value $cmdContent -Encoding ASCII

$ps1Wrapper = Join-Path $installDir "convo.ps1"
$ps1Content = @"
if (Get-Command bun -ErrorAction SilentlyContinue) {
    & bunx -y convolink@latest @args
} else {
    & npx -y convolink@latest @args
}
"@
Set-Content -Path $ps1Wrapper -Value $ps1Content -Encoding ASCII

Write-Host "OK ConvoLink executable wrappers created at $installDir" -ForegroundColor Green

# 5. User PATH Registration
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -split ';' -notcontains $installDir) {
    $newUserPath = "$installDir;$userPath".TrimEnd(';')
    [Environment]::SetEnvironmentVariable("Path", $newUserPath, "User")
    $env:Path = "$installDir;$env:Path"
    Write-Host "OK Added $installDir to User PATH." -ForegroundColor Green
} else {
    Write-Host "OK $installDir is already in User PATH." -ForegroundColor Green
}

Write-Host ""
Write-Host "Installation complete! Run 'convo doctor' in a new terminal to test." -ForegroundColor Green
