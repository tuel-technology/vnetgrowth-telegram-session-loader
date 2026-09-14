# Build a relocatable CPython + deps for Windows packaging (python-build-standalone via uv).
# Avoid astral install.ps1 on CI - it trips Get-ExecutionPolicy / Security module load failures.
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Runtime = Join-Path $Root ".sidecar-runtime"
$Cache = Join-Path $Root ".uv-python"
$Req = Join-Path $Root "python-sidecar\requirements.txt"
$PySeries = if ($env:SIDECAR_PYTHON_VERSION) { $env:SIDECAR_PYTHON_VERSION } else { "3.11" }
$UvBinDir = Join-Path $Root ".tools\uv"

function Test-UvAvailable {
  return [bool](Get-Command uv -ErrorAction SilentlyContinue)
}

function Ensure-Uv {
  if (Test-UvAvailable) { return }

  Write-Host "Installing uv (direct Windows binary, no install.ps1)..."
  New-Item -ItemType Directory -Force -Path $UvBinDir | Out-Null
  $zip = Join-Path $env:TEMP "uv-x86_64-pc-windows-msvc.zip"
  $url = "https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip"
  Invoke-WebRequest -Uri $url -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath $UvBinDir -Force
  $env:Path = "$UvBinDir;$env:Path"

  if (-not (Test-UvAvailable)) {
    $uvExe = Join-Path $UvBinDir "uv.exe"
    if (Test-Path $uvExe) {
      $env:Path = "$(Split-Path -Parent $uvExe);$env:Path"
    }
  }

  if (-not (Test-UvAvailable)) {
    throw "uv.exe not found after binary install under $UvBinDir"
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

& uv python install $PySeries
$PyBin = (& uv python find $PySeries).Trim()
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

Get-ChildItem -Path $Runtime -Filter "EXTERNALLY-MANAGED" -Recurse -ErrorAction SilentlyContinue |
  ForEach-Object { Remove-Item -Force $_.FullName }

Write-Host "Installing sidecar requirements..."
& uv pip install --python $RuntimePy --upgrade pip
& uv pip install --python $RuntimePy -r $Req

Write-Host "Verifying imports..."
& $RuntimePy -c "import telethon, opentele; print('sidecar-runtime ok')"

Write-Host "Wrote $Runtime"
