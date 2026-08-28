#!/usr/bin/env bash
# EAS Build pre-install hook: make a Go toolchain available.
#
# WHY: WireGuardKit links against wireguard-go-bridge, a Go core that SPM
# cannot build. link-wireguard-kit.mjs wires an Xcode Run Script phase that
# runs `make` against the resolved SPM checkout, and that make invocation
# needs Go on PATH. EAS's macOS build images do not ship Go, which is the
# blocker recorded in STATUS.md — cloud builds of the network-packet-tunnel
# extension cannot succeed without this.
#
# Runs only on EAS (EAS_BUILD is set) and only on macOS, so it is a no-op
# locally and on Android builds. Local machines already have Go installed
# (Go 1.27.0 via Homebrew, per STATUS).
#
# Deliberately does NOT fail the build if the install does not work: a clear
# error from the actual `make` step is more useful than an opaque failure
# here, and this hook runs long before anything Go-dependent is needed.

set -uo pipefail

if [ -z "${EAS_BUILD:-}" ]; then
  echo "[eas-install-go] Not an EAS build — skipping."
  exit 0
fi

if [ "$(uname -s)" != "Darwin" ]; then
  echo "[eas-install-go] Not macOS — skipping (Go is only needed for the iOS tunnel extension)."
  exit 0
fi

if command -v go >/dev/null 2>&1; then
  echo "[eas-install-go] Go already present: $(go version)"
  exit 0
fi

echo "[eas-install-go] Go not found. Installing via Homebrew..."
if command -v brew >/dev/null 2>&1; then
  brew install go || echo "[eas-install-go] WARNING: brew install go failed."
else
  echo "[eas-install-go] WARNING: Homebrew not available on this image."
fi

if command -v go >/dev/null 2>&1; then
  echo "[eas-install-go] Installed: $(go version)"
  echo "[eas-install-go] go binary at: $(command -v go)"
else
  echo "[eas-install-go] WARNING: Go is still unavailable."
  echo "[eas-install-go] The wireguard-go-bridge build phase will fail with a"
  echo "[eas-install-go] clearer error than this hook could give."
fi

exit 0
