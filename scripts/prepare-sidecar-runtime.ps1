# Build a relocatable CPython + deps for Windows packaging (python-build-standalone via uv).
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Runtime = Join-Path $Root ".sidecar-runtime"
$Cache = Join-Path $Root ".uv-python"
$Req = Join-Path $Root "python-sidecar\requirements.txt"
$PySeries = if ($env:SIDECAR_PYTHON_VERSION) { $env:SIDECAR_PYTHON_VERSION } else { "3.11" }

function Ensure-Uv {
  if (Get-Command uv -ErrorAction SilentlyContinue) { return }
  Write-Host "Installing uv..."
  irm https://astral.sh/uv/install.ps1 | iex
  $env:Path = "$env:USERPROFILE\.local\bin;$env:USERPROFILE\.cargo\bin;$env:Path"
  if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    throw "uv not found on PATH after install"
  }
}

Write-Host "Preparing relocatable sidecar runtime ($PySeries)..."
Ensure-Uv
New-Item -ItemType Directory -Force -Path $Cache | Out-Null
$env:UV_PYTHON_INSTALL_DIR = $Cache

if (Test-Path $Runtime) {
  Remove-Item -Recurse -Force $Runtime
}
New-Item -ItemType Directory -Force -Path $Runtime | Out-Null

uv python install $PySeries
$PyBin = (uv python find $PySeries).Trim()
if (-not (Test-Path $PyBin)) {
  throw "Could not resolve uv python for $PySeries"
}

$PyHome = Split-Path -Parent $PyBin
Write-Host "Copying standalone Python from $PyHome"
Copy-Item -Path (Join-Path $PyHome "*") -Destination $Runtime -Recurse -Force

$RuntimePy = Join-Path $Runtime "python.exe"
if (-not (Test-Path $RuntimePy)) {
  throw "Standalone python.exe missing under $Runtime"
}

Get-ChildItem -Path (Join-Path $Runtime "Lib") -Filter "EXTERNALLY-MANAGED" -Recurse -ErrorAction SilentlyContinue |
  ForEach-Object { Remove-Item -Force $_.FullName }

Write-Host "Installing sidecar requirements..."
uv pip install --python $RuntimePy --upgrade pip
uv pip install --python $RuntimePy -r $Req

Write-Host "Verifying imports..."
& $RuntimePy -c "import telethon, opentele; print('sidecar-runtime ok')"

Write-Host "Wrote $Runtime"
