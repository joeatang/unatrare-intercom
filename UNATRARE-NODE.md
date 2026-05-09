# UNATRARE Node

Run a node. Become part of the permanent archive.

Every certified card on [UNATRARE](https://unatrare.wtf) — the curated Counterparty art directory on Bitcoin — is preserved in a peer-to-peer network built on [Pear / TRAC](https://trac.network). This repo is the node software.

When you run a node:
- You replicate all certified art files from the UNATRARE subnet
- You help serve art to wallets when the main server is unreachable
- You participate in the permanent record of Bitcoin-native digital art

**No tokens required. No fees. Just run the node.**

---

## Requirements

- [Pear Runtime](https://docs.pears.com/guides/getting-started) (one-time install)
- Node.js 20+ (bundled with Pear)
- ~500 MB disk for art storage (grows as cards are certified)

---

## Quick Start

```bash
# 1. Install Pear (if you haven't already)
npm install -g pear

# 2. Clone this repo
git clone https://github.com/joeatang/UNATRARE
cd UNATRARE/intercom

# 3. Install dependencies
npm install

# 4. Run the node (joins the unatrare-v1 subnet automatically)
pear run . \
  --peer-store-name unatrare-node \
  --msb-store-name unatrare-node-msb \
  --subnet-channel unatrare-v1
```

That's it. The node will discover peers on the UNATRARE subnet via HyperDHT and begin replicating art files.

---

## What happens when you run it

1. **Peer discovery** — your node announces itself on the `unatrare-v1` channel of the Hyperswarm DHT
2. **Art replication** — any certified card art stored in Hyperdrive is replicated to your local store
3. **Serving** — if the main UNATRARE server is unreachable, wallets fetching `/art/{hash}` can fall back to any online peer
4. **Verdict broadcast** — new judgments from the pepai scientist panel are broadcast to all connected peers in real time

---

## Architecture

UNATRARE uses three networking planes from the Intercom stack:

| Plane | Purpose |
|-------|---------|
| **Subnet** (`unatrare-v1`) | Hyperbee/Autobase state replication — certified cards, verdicts |
| **Sidechannel** | Ephemeral P2P messaging — real-time verdict broadcasts |
| **Hyperdrive** | Content-addressed art storage — `/art/{sha256}` files |

Art is stored at `/art/{sha256_hash}` in Hyperdrive. The hash is the content address — the same hash used in the CIP-25 metadata URLs on-chain. This means art is permanently verifiable: if you have the hash (from the Counterparty description field), you can always retrieve the art from any peer on the network.

---

## Running as a background service

```bash
# Using PM2
pm2 start "pear run . --peer-store-name unatrare-node --msb-store-name unatrare-node-msb --subnet-channel unatrare-v1" \
  --name unatrare-node

pm2 save
pm2 startup
```

---

## Connection status

The node logs peer connections to stdout. You'll see:

```
[subnet] connected to peer abc123...
[artdrive] replicated /art/bc592ed... (image/jpeg, 284kb)
[sidechannel] verdict broadcast: GIFTGOATS → CERTIFIED DANK (32.2/40)
```

---

## The archive

Every certified card has:
- **Token** — locked, non-divisible Counterparty token on Bitcoin
- **CIP-25 metadata** — served at `https://unatrare.wtf/c/TOKEN.json`, readable by all CP wallets
- **Art hash** — SHA-256 of the original art file, embedded in the on-chain description
- **P2P copy** — replicated across all UNATRARE nodes in Hyperdrive

If UNATRARE.wtf goes offline, the art is still accessible from any online node. If all nodes go offline, the hashes and metadata URLs remain on-chain forever — anyone can re-verify by running this node software against any art file.

---

## About UNATRARE

UNATRARE is a curated directory of rare digital art on Counterparty — the original Bitcoin token protocol, live since 2014. Five pepai scientists evaluate every submission. Cards that pass are listed. Cards that don't are not.

- Website: [unatrare.wtf](https://unatrare.wtf)
- Submit art: [unatrare.wtf/submit](https://unatrare.wtf/submit)
- Verdict feed: [unatrare.wtf/feed](https://unatrare.wtf/feed)
- Built on: [Counterparty](https://counterparty.io) · [TRAC Network](https://trac.network) · [Pear](https://pears.com)
