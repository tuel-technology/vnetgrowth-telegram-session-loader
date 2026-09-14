#!/usr/bin/env bash
# Build a relocatable CPython + deps for packaging (python-build-standalone via uv).
# A normal `venv --copies` from actions/setup-python still dyld-links
# /Library/Frameworks/Python.framework and breaks on user Macs.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME="${ROOT}/.sidecar-runtime"
CACHE="${ROOT}/.uv-python"
REQ="${ROOT}/python-sidecar/requirements.txt"
PY_SERIES="${SIDECAR_PYTHON_VERSION:-3.11}"

ensure_uv() {
  if command -v uv >/dev/null 2>&1; then
    return 0
  fi
  echo "Installing uv..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="${HOME}/.local/bin:${PATH}"
  if ! command -v uv >/dev/null 2>&1; then
    echo "uv not found on PATH after install" >&2
    exit 1
  fi
}

echo "Preparing relocatable sidecar runtime (${PY_SERIES})..."
ensure_uv
mkdir -p "${CACHE}"
export UV_PYTHON_INSTALL_DIR="${CACHE}"

rm -rf "${RUNTIME}"
mkdir -p "${RUNTIME}"

uv python install "${PY_SERIES}"
PY_BIN="$(uv python find "${PY_SERIES}")"
if [[ ! -x "${PY_BIN}" ]]; then
  echo "Could not resolve uv python for ${PY_SERIES}" >&2
  exit 1
fi

PY_HOME="$(cd "$(dirname "${PY_BIN}")/.." && pwd)"
echo "Copying standalone Python from ${PY_HOME}"
# Prefer rsync; fall back to cp -R
if command -v rsync >/dev/null 2>&1; then
  rsync -a "${PY_HOME}/" "${RUNTIME}/"
else
  cp -R "${PY_HOME}/." "${RUNTIME}/"
fi

RUNTIME_PY="${RUNTIME}/bin/python3"
if [[ ! -x "${RUNTIME_PY}" ]]; then
  RUNTIME_PY="${RUNTIME}/bin/python"
fi
if [[ ! -x "${RUNTIME_PY}" ]]; then
  echo "Standalone python binary missing under ${RUNTIME}/bin" >&2
  exit 1
fi

# uv marks installs as externally-managed; this copy is ours to mutate for bundling.
shopt -s nullglob
for marker in "${RUNTIME}"/lib/python*/EXTERNALLY-MANAGED; do
  rm -f "${marker}"
done
shopt -u nullglob

# Make libpython relocatable relative to the executable (macOS).
if [[ "$(uname -s)" == "Darwin" ]]; then
  shopt -s nullglob
  for dylib in "${RUNTIME}"/lib/libpython*.dylib; do
    base="$(basename "${dylib}")"
    echo "Fixing dylib id: ${base}"
    install_name_tool -id "@executable_path/../lib/${base}" "${dylib}" || true
  done
  shopt -u nullglob

  if otool -L "${RUNTIME_PY}" | grep -E '/Library/Frameworks/Python|/opt/homebrew|/usr/local/opt/python' >/dev/null; then
    echo "ERROR: bundled python still links to a machine-local framework:" >&2
    otool -L "${RUNTIME_PY}" >&2
    exit 1
  fi
fi

echo "Installing sidecar requirements..."
# Prefer uv pip against the copied interpreter (fast, relocatable-friendly).
uv pip install --python "${RUNTIME_PY}" --upgrade pip
uv pip install --python "${RUNTIME_PY}" -r "${REQ}"

echo "Verifying imports..."
"${RUNTIME_PY}" -c "import telethon, opentele; print('sidecar-runtime ok', telethon.__version__)"

echo "Wrote ${RUNTIME}"
