import { Feature } from 'trac-peer';
import fetch from 'bare-fetch';

/**
 * Listings Feature — writes marketplace listings WITHOUT MSB/TNK.
 *
 * Regular /tx contract calls settle through the MainSettlementBus (needs TNK on
 * mainnet → "Dropping TX" when unfunded). Features append straight to the base
 * for the sole writer (the Council/admin node), exactly like AdminBootstrap and
 * the Timer. That is our no-cost write path: the Council node validates a listing
 * (certification checked off-subnet over HTTP — allowed here in NODE context, not
 * contract context) and appends it; every peer then replicates it P2P for reading.
 * Value still settles on Bitcoin/Counterparty.
 *
 * The contract's `listing_feature` handler (contract.js) turns each append into
 * deterministic state under listings/{id} + listings_list.
 */
class Listings extends Feature {
  constructor(peer, options = {}) {
    super(peer, options);
    this.seed = options.seed || null;          // optional {listing_id,token_name,price,currency}
    this.skipCert = options.skipCert === true;  // proof/testing bypass
  }

  async start(options = {}) {
    // Seed path (proof / migration): append one listing on boot, then read it
    // back and log — proves the write→replicate→read loop with no stdin needed.
    if (this.seed) {
      await this.createListing(this.seed);
      // Poll for the contract handler to index the append (a few seconds).
      let list = null, one = null;
      for (let i = 0; i < 8; i++) {
        await this.sleep(2000);
        list = await this.peer.protocol.instance.getSigned('listings_list');
        one  = this.seed.listing_id
          ? await this.peer.protocol.instance.getSigned('listings/' + this.seed.listing_id)
          : null;
        if (one) break;
      }
      console.log('[listings] readback listings_list:', JSON.stringify(list));
      console.log('[listings] readback listing:', JSON.stringify(one));
    }
  }

  // Council-node entry point. Validates, then appends (no MSB). Also callable
  // later from the SC-Bridge so the website can post listings to the subnet.
  async createListing(input = {}) {
    const listing_id = String(input.listing_id || '').trim();
    const token_name = String(input.token_name || '').trim().toUpperCase();
    const price      = String(input.price || '').trim();
    const currency   = String(input.currency || '').trim().toUpperCase();
    if (!listing_id || !token_name || !price || !currency) {
      console.log('[listings] rejected: missing fields'); return false;
    }

    // Certification gate — checked over HTTP (node context), not on-subnet.
    if (!this.skipCert) {
      let certified = false;
      try {
        const r = await fetch(`https://unatrare.wtf/c/${token_name}.json`);
        certified = !!(r && r.ok);
      } catch (_e) { certified = false; }
      if (!certified) { console.log('[listings] rejected: token not certified:', token_name); return false; }
    }

    const existing = await this.peer.protocol.instance.getSigned('listings/' + listing_id);
    if (existing !== null) { console.log('[listings] already exists, skip:', listing_id); return false; }

    const seller = input.seller || (typeof this.peer.wallet.publicKey === 'string'
      ? this.peer.wallet.publicKey
      : Buffer.from(this.peer.wallet.publicKey).toString('hex'));

    await this.append('listing:create', { id: listing_id, token_name, price, currency, seller });
    console.log('[listings] appended listing:create', listing_id);
    return true;
  }

  async cancelListing(listing_id) {
    const id = String(listing_id || '').trim();
    if (!id) return false;
    await this.append('listing:cancel', { id });
    console.log('[listings] appended listing:cancel', id);
    return true;
  }

  async stop(options = {}) {}
}

export default Listings;
