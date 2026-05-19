#!/usr/bin/env bash
# ── UNATRARE Intercom Admin Peer ──────────────────────────────────────────────
# Run this to start the UNATRARE subnet peer with SC-Bridge enabled.
# The Next.js backend connects to it via ws://127.0.0.1:49222
#
# Usage:
#   ./start-peer.sh
#
# Stop:
#   kill $(cat unatrare-peer.pid)
# ──────────────────────────────────────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load nvm + Node 22 (required by Pear)
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  source "$NVM_DIR/nvm.sh"
  nvm use 22 --silent
fi

# SC-Bridge token — set SC_BRIDGE_TOKEN in env or use the generated default
SC_BRIDGE_TOKEN="${SC_BRIDGE_TOKEN:-3f113ec0131dfff2e0bcb73146ee8339b43279b224118ede854b2899704fdc33}"

echo "========================================"
echo "  UNATRARE Intercom Peer Starting"
echo "  Subnet:    unatrare-art-archive-v1"
echo "  SC-Bridge: ws://127.0.0.1:49222"
echo "  Node:      $(node -v)"
echo "========================================"

pear run . \
  --peer-store-name    unatrare-admin \
  --msb-store-name     unatrare-admin-msb \
  --subnet-channel     unatrare-art-archive-v1 \
  --sidechannels       unatrare-verdicts,unatrare-query \
  --sc-bridge          1 \
  --sc-bridge-port     49222 \
  --sc-bridge-token    "$SC_BRIDGE_TOKEN" \
  --sidechannel-quiet  1 \
  &

PEER_PID=$!
echo "$PEER_PID" > unatrare-peer.pid
echo "Peer PID: $PEER_PID (saved to unatrare-peer.pid)"
echo "Waiting for peer to initialize..."

# Wait for the ready signal
wait $PEER_PID
