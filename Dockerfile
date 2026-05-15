# ─────────────────────────────────────────────────────────────────────────────
# UNATRARE Deep Node — Docker image
#
# Runs the Pear/Hyperswarm P2P node for seeding certified UNATRARE art.
# Works on Windows (Docker Desktop), macOS, and Linux.
#
# Build:
#   docker build -t unatrare-node .
#
# Run (quickest):
#   docker run -d --restart=unless-stopped \
#     -e BTC_ADDRESS=1YourBitcoinAddress \
#     -e XCP_ADDRESS=1YourXcpAddress \
#     -v unatrare-stores:/data/stores \
#     -v unatrare-pear:/root/.pear \
#     --name unatrare-node \
#     unatrare-node
#
# Or use docker-compose.yml — see README for full setup.
# ─────────────────────────────────────────────────────────────────────────────

FROM node:22-bookworm-slim

# ── System dependencies ───────────────────────────────────────────────────────
# git      — required for npm git+https:// deps (trac-peer, trac-msb)
# python3, make, g++ — required for native addon compilation via node-gyp
# ca-certificates   — required for HTTPS npm registry + Pear DHT bootstrap
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    python3 \
    make \
    g++ \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# ── npm config ────────────────────────────────────────────────────────────────
ENV npm_config_update_notifier=false \
    npm_config_fund=false

# ── Install Pear runtime CLI ──────────────────────────────────────────────────
# This installs the `pear` CLI. The Pear platform itself bootstraps on first
# container start by downloading from the DHT (takes ~30–60s once, then cached
# in the /root/.pear volume).
RUN npm install -g pear

# ── Application ───────────────────────────────────────────────────────────────
WORKDIR /app

# Copy package files first — npm install layer is only re-run when these change
COPY package.json package-lock.json ./

# Install JS dependencies.
# trac-peer and trac-msb are git:// deps — git must be installed above.
# bare-* packages are BARE runtime shims and do NOT use node-gyp.
RUN npm install

# Copy all remaining application files
COPY . .

# Strip Windows CRLF line endings if the repo was cloned on Windows, then make executable.
# This prevents "$'\r': command not found" errors from the bash shebang line.
RUN sed -i 's/\r//' /app/docker-entrypoint.sh && chmod +x /app/docker-entrypoint.sh

# ── Persistent data volumes ───────────────────────────────────────────────────
# /data/stores  — Hypercore storage: peer state, DHT routing tables, art cache
#                 Must persist across restarts or the node re-syncs from scratch
# /root/.pear   — Pear platform cache: avoids re-downloading on every restart
VOLUME ["/data/stores", "/root/.pear"]

ENTRYPOINT ["/app/docker-entrypoint.sh"]
