import { Feature } from 'trac-peer';

/**
 * AdminBootstrap Feature
 *
 * Sets the contract's admin_address on first boot without requiring MSB validators.
 * Uses the Feature mechanism (peer.base.append directly) which works for the sole writer.
 *
 * The contract's admin_bootstrap_feature handler handles this idempotently.
 * After the first successful run, the feature is a no-op on subsequent boots.
 */
class AdminBootstrap extends Feature {

    constructor(peer, options = {}) {
        super(peer, options);
    }

    async start(options = {}) {
        // Check if admin_address is already in contract state
        const existing = await this.peer.protocol.instance.getSigned('admin_address');
        if (existing !== null) {
            console.log('[unatrare] Admin already bootstrapped:', String(existing).slice(0, 8) + '...');
            return;
        }

        // Append the admin address directly to the base via the Feature mechanism.
        // this.peer.wallet.publicKey is the hex pubkey string — same value as this.address
        // in contract tx context (ipk = invoker public key).
        const adminPubkey = typeof this.peer.wallet.publicKey === 'string'
            ? this.peer.wallet.publicKey
            : Buffer.from(this.peer.wallet.publicKey).toString('hex');

        await this.append('adminPubkey', adminPubkey);
        console.log('[unatrare] Admin bootstrap feature appended:', adminPubkey.slice(0, 8) + '...');
    }

    async stop(options = {}) {}
}

export default AdminBootstrap;
