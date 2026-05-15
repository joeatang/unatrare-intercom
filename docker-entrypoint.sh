#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# UNATRARE Node — Docker entrypoint
#
# Validates required env vars, prints a startup banner, then hands off to
# `pear run`. Using exec replaces this shell with the pear process so that
# SIGTERM / SIGINT from Docker go directly to pear (clean shutdown).
# ─────────────────────────────────────────────────────────────────────────────

set -e

# ── Validate required env vars ────────────────────────────────────────────────
if [ -z "$BTC_ADDRESS" ]; then
  echo ""
  echo "╔═══════════════════════════════════════════════════════════════════╗"
  echo "║  UNATRARE NODE — MISSING REQUIRED CONFIGURATION                  ║"
  echo "╠═══════════════════════════════════════════════════════════════════╣"
  echo "║                                                                   ║"
  echo "║  BTC_ADDRESS is required.                                         ║"
  echo "║                                                                   ║"
  echo "║  Set it when running the container:                               ║"
  echo "║                                                                   ║"
  echo "║    docker run -e BTC_ADDRESS=1YourBitcoinAddress ...              ║"
  echo "║                                                                   ║"
  echo "║  Or in docker-compose.yml — see the README for full setup.        ║"
  echo "║                                                                   ║"
  echo "╚═══════════════════════════════════════════════════════════════════╝"
  echo ""
  exit 1
fi

# ── Startup banner ────────────────────────────────────────────────────────────
echo ""
echo "  ██╗   ██╗███╗   ██╗ █████╗ ████████╗██████╗  █████╗ ██████╗ ███████╗"
echo "  ██║   ██║████╗  ██║██╔══██╗╚══██╔══╝██╔══██╗██╔══██╗██╔══██╗██╔════╝"
echo "  ██║   ██║██╔██╗ ██║███████║   ██║   ██████╔╝███████║██████╔╝█████╗  "
echo "  ██║   ██║██║╚██╗██║██╔══██║   ██║   ██╔══██╗██╔══██║██╔══██╗██╔══╝  "
echo "  ╚██████╔╝██║ ╚████║██║  ██║   ██║   ██║  ██║██║  ██║██║  ██║███████╗"
echo "   ╚═════╝ ╚═╝  ╚═══╝╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝"
echo ""
echo "  DEEP NODE  ·  BITCOIN ART ARCHIVE  ·  TRAC HYPERSWARM"
echo ""
echo "  BTC:     ${BTC_ADDRESS}"
echo "  XCP:     ${XCP_ADDRESS:-not provided}"
echo "  Stores:  /data/stores/"
echo ""
echo "  ┌─ First run? ─────────────────────────────────────────────────────┐"
echo "  │  Pear will download its platform from the DHT (~30–60 seconds).  │"
echo "  │  This only happens once — subsequent starts are instant.         │"
echo "  └───────────────────────────────────────────────────────────────────┘"
echo ""

# ── Build pear command as an array (handles spaces in values safely) ──────────
PEAR_CMD=(
  pear run /app
  --peer-store-name       unatrare-node
  --peer-stores-directory /data/stores/
  --msb-stores-directory  /data/stores/
  --subnet-bootstrap      38a1b001756148f3f96f8cff7bd38d2924669f5c1880b4f779512d6449cfff56
  --btc-address           "$BTC_ADDRESS"
)

if [ -n "$XCP_ADDRESS" ]; then
  PEAR_CMD+=(--xcp-address "$XCP_ADDRESS")
fi

if [ -n "$TAP_ADDRESS" ]; then
  PEAR_CMD+=(--tap-address "$TAP_ADDRESS")
fi

# ── exec replaces this shell — signals go straight to pear ───────────────────
exec "${PEAR_CMD[@]}"
