#!/bin/bash
# VnetGrowth Telegram Session Loader - open unsigned build on macOS (Sequoia+ friendly)
set -euo pipefail

APP_NAME="Telegram Session Loader.app"
CANDIDATES=(
  "/Applications/${APP_NAME}"
  "${HOME}/Applications/${APP_NAME}"
  "${HOME}/Downloads/${APP_NAME}"
  "${HOME}/Desktop/${APP_NAME}"
)

APP=""
for candidate in "${CANDIDATES[@]}"; do
  if [[ -d "${candidate}" ]]; then
    APP="${candidate}"
    break
  fi
done

if [[ -z "${APP}" ]]; then
  echo ""
  echo "Could not find ${APP_NAME}."
  echo "Extract the ZIP, drag the app to Applications, then run this script again."
  echo ""
  read -r -p "Press Enter to close..."
  exit 1
fi

ARCH="$(uname -m)"
if [[ "${ARCH}" == "x86_64" ]]; then
  echo ""
  echo "This Mac is Intel (x86_64). Current releases are Apple Silicon (arm64) only."
  echo "Use a Windows PC, or contact support for an Intel-compatible build."
  echo ""
  read -r -p "Press Enter to close..."
  exit 1
fi

echo "Using: ${APP}"
echo "Removing download quarantine flags..."
xattr -cr "${APP}"

echo "Applying local ad-hoc signature (helps some macOS versions)..."
if codesign --force --deep --sign - "${APP}" 2>/dev/null; then
  echo "Signed."
else
  echo "Ad-hoc sign skipped (you can still try opening the app)."
fi

echo "Opening app..."
open "${APP}" || true
echo ""
echo "If macOS still blocks the app, double-click it once, click Done, then"
echo "System Settings > Privacy & Security > Security > Open Anyway."
echo ""
read -r -p "Press Enter to close..."
