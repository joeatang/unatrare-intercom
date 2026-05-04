/**
 * artdrive/index.js — Hyperdrive-based P2P art storage for UNATRARE
 *
 * Stores approved art files in a Hyperdrive keyed by SHA-256 hash.
 * The drive replicates to any peer that joins with the drive key,
 * enabling community members to seed approved art by running intercom/.
 *
 * Commands accepted via SC-Bridge onUnknownCommand:
 *   store_art  { hash, data (base64), mime }  → { type: 'art_stored', hash }
 *   drive_info {}                              → { type: 'drive_info', key }
 */

import Feature from 'trac-peer/src/artifacts/feature.js';
import b4a from 'b4a';
import path from 'path';
import Corestore from 'corestore';
import Hyperdrive from 'hyperdrive';
import Hyperswarm from 'hyperswarm';

class ArtDrive extends Feature {
  constructor(peer, config = {}) {
    super(peer, config);
    this.key = 'artdrive';
    this.drive = null;
    this.store = null;
    this.swarm = null;
    this.storesDir = typeof config.storesDir === 'string' ? config.storesDir : 'stores/';
    this.storeName = typeof config.storeName === 'string' ? config.storeName : 'peer';
  }

  async start() {
    const storePath = path.join(this.storesDir, this.storeName, 'artdrive');
    this.store = new Corestore(storePath);
    this.drive = new Hyperdrive(this.store);
    await this.drive.ready();

    // Announce drive on DHT — other peers with the key can replicate
    this.swarm = new Hyperswarm();
    this.swarm.on('connection', (socket) => {
      this.store.replicate(socket);
    });
    this.swarm.join(this.drive.discoveryKey, { server: true, client: true });

    const driveKey = b4a.toString(this.drive.key, 'hex');
    console.log('[artdrive] Ready. Drive key:', driveKey);
    return this;
  }

  /**
   * Store a file by its SHA-256 hash.
   * @param {string} hash    hex SHA-256 of the file
   * @param {string} base64  base64-encoded file bytes
   * @param {string} mime    MIME type (image/png, image/gif, etc.)
   */
  async storeFile(hash, base64, mime) {
    if (!this.drive) throw new Error('[artdrive] Not started');
    const buffer = b4a.from(base64, 'base64');
    await this.drive.put(`/art/${hash}`, buffer, {
      metadata: { contentType: mime },
    });
    console.log(`[artdrive] Stored /art/${hash} (${buffer.length} bytes)`);
    return true;
  }

  /**
   * Retrieve a stored file by its SHA-256 hash.
   * Returns { data: Buffer, mime: string } or null if not found.
   */
  async getFile(hash) {
    if (!this.drive) throw new Error('[artdrive] Not started');
    const entry = await this.drive.entry(`/art/${hash}`);
    if (!entry) return null;
    const buf = await this.drive.get(`/art/${hash}`);
    const mime = entry.value?.metadata?.contentType || 'application/octet-stream';
    return { data: buf, mime };
  }

  /** Return the drive's public key as a hex string. */
  getDriveKey() {
    return this.drive ? b4a.toString(this.drive.key, 'hex') : null;
  }

  async stop() {
    await this.swarm?.destroy();
    await this.drive?.close();
    await this.store?.close();
  }
}

export default ArtDrive;
