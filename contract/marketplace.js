/**
 * UNATRARE Marketplace — contract extension (Phase 1: listings + provenance)
 *
 * Deterministic, MSB-free. Follows the same invariants as the base contract:
 *   No try-catch · No throws · No random · No HTTP · No Date.now()
 *   Time comes from the Timer oracle stored in 'currentTime'.
 *   Value settles OFF-subnet on Bitcoin/Counterparty; the subnet is the
 *   canonical LEDGER of what's for sale and what sold (provenance), not a
 *   custodian of funds.
 *
 * State layout (added):
 *   listings/{id}            : { id, seller, token_name, price, currency,
 *                                status:'active'|'sold'|'cancelled',
 *                                created_at, updated_at }
 *   listings_list            : array of listing ids (ordered)
 *   listings_by_seller/{addr}: array of listing ids owned by a seller
 *   sales/{txid}             : { txid, listing_id, token_name, seller, buyer,
 *                                price, currency, sold_at } — the provenance record
 *   sales_list               : array of sale txids (ordered)
 *
 * Each function takes the contract instance `c` and uses:
 *   c.get / c.put / c.assert / c.protocol.safeClone / c.address / c.value
 * so the pure logic is unit-testable with a mock context (see marketplace.test.js).
 */

// Schemas registered on the contract via addSchema(name, {value:{...}}).
export const MARKETPLACE_SCHEMAS = {
  createListing: {
    value: {
      $$strict: true,
      $$type: 'object',
      op:         { type: 'string', min: 1, max: 128 },
      listing_id: { type: 'string', min: 8, max: 80, pattern: /^[a-zA-Z0-9._-]+$/ },
      token_name: { type: 'string', min: 1, max: 21, pattern: /^[A-Z0-9.]+$/ },
      price:      { type: 'string', min: 1, max: 40, pattern: /^[0-9]+(\.[0-9]+)?$/ },
      currency:   { type: 'string', min: 2, max: 12, pattern: /^[A-Z0-9]+$/ },
    },
  },
  cancelListing: {
    value: {
      $$strict: true,
      $$type: 'object',
      op:         { type: 'string', min: 1, max: 128 },
      listing_id: { type: 'string', min: 8, max: 80, pattern: /^[a-zA-Z0-9._-]+$/ },
    },
  },
  recordSale: {
    value: {
      $$strict: true,
      $$type: 'object',
      op:            { type: 'string', min: 1, max: 128 },
      listing_id:    { type: 'string', min: 8, max: 80, pattern: /^[a-zA-Z0-9._-]+$/ },
      buyer_address: { type: 'string', min: 20, max: 120 },
      txid:          { type: 'string', min: 64, max: 64, pattern: /^[a-fA-F0-9]+$/ },
    },
  },
  getListing: {
    value: {
      $$strict: true,
      $$type: 'object',
      op:         { type: 'string', min: 1, max: 128 },
      listing_id: { type: 'string', min: 8, max: 80 },
    },
  },
};

// ── Create a listing (seller = caller; token must be a certified card) ──────
export async function createListing(c) {
  const id = c.value.listing_id;

  // Idempotent: never overwrite an existing listing id.
  const existing = await c.get('listings/' + id);
  if (existing !== null) return;

  // Gate: only Council-certified cards can be listed. Ties listings to the
  // same provenance authority that certifies art.
  const card = await c.get('cards/' + c.value.token_name);
  if (card === null) return; // uncertified token — reject silently (no throw)

  const now = await c.get('currentTime');
  const listing = {
    id,
    seller:     c.address,           // the signer IS the seller — non-spoofable
    token_name: c.value.token_name,
    price:      c.value.price,       // decimal string; settled on Bitcoin
    currency:   c.value.currency,
    status:     'active',
    created_at: now ?? null,
    updated_at: now ?? null,
  };

  const list        = (await c.get('listings_list')) ?? [];
  const updatedList = c.protocol.safeClone(list);
  c.assert(updatedList !== null);
  updatedList.push(id);

  const sellerKey  = 'listings_by_seller/' + c.address;
  const sellerList = (await c.get(sellerKey)) ?? [];
  const updSeller  = c.protocol.safeClone(sellerList);
  c.assert(updSeller !== null);
  updSeller.push(id);

  await c.put('listings/' + id, listing);
  await c.put('listings_list', updatedList);
  await c.put(sellerKey, updSeller);
}

// ── Cancel a listing (seller only) ──────────────────────────────────────────
export async function cancelListing(c) {
  const id      = c.value.listing_id;
  const listing = await c.get('listings/' + id);
  if (listing === null) return;             // no such listing
  if (listing.seller !== c.address) return; // only the seller can cancel
  if (listing.status !== 'active') return;  // already sold/cancelled — idempotent

  const now     = await c.get('currentTime');
  const updated = c.protocol.safeClone(listing);
  c.assert(updated !== null);
  updated.status     = 'cancelled';
  updated.updated_at = now ?? null;

  await c.put('listings/' + id, updated);
}

// ── Record a sale (seller confirms the on-Bitcoin settlement → provenance) ──
export async function recordSale(c) {
  const id      = c.value.listing_id;
  const listing = await c.get('listings/' + id);
  if (listing === null) return;
  if (listing.seller !== c.address) return; // only the seller records their sale
  if (listing.status !== 'active') return;  // can't sell a sold/cancelled listing

  const txid = c.value.txid.toLowerCase();

  // Idempotent: a txid can back exactly one sale record.
  const existingSale = await c.get('sales/' + txid);
  if (existingSale !== null) return;

  const now = await c.get('currentTime');
  const sale = {
    txid,
    listing_id: id,
    token_name: listing.token_name,
    seller:     listing.seller,
    buyer:      c.value.buyer_address,
    price:      listing.price,
    currency:   listing.currency,
    sold_at:    now ?? null,
  };

  const salesList = (await c.get('sales_list')) ?? [];
  const updSales  = c.protocol.safeClone(salesList);
  c.assert(updSales !== null);
  updSales.push(txid);

  const updListing = c.protocol.safeClone(listing);
  c.assert(updListing !== null);
  updListing.status     = 'sold';
  updListing.updated_at = now ?? null;

  await c.put('sales/' + txid, sale);
  await c.put('sales_list', updSales);
  await c.put('listings/' + id, updListing);
}

// ── Feature-write path (NO MSB / NO TNK) ─────────────────────────────────────
// Applied by the contract's `listing_feature` handler when the Council/admin node
// appends a 'listing:create' / 'listing:cancel' op. Only the sole writer can
// append features, so this is inherently Council-gated (no per-caller check).
// Deterministic: validation already happened off-subnet in the Listings feature.
// Returns 'created' | 'cancelled' | undefined (no-op).
export async function applyListingFeature(c, op) {
  const key = op?.key;
  const v   = op?.value;
  if (key !== 'listing:create' && key !== 'listing:cancel') return;
  if (!v || typeof v !== 'object') return;
  const id = v.id;
  if (typeof id !== 'string' || id.length < 8) return;
  const now = await c.get('currentTime');

  // NOTE: feature-handler context only guarantees get/put. Do NOT use
  // this.protocol.safeClone or this.assert here — use plain JS clones.
  if (key === 'listing:create') {
    const existing = await c.get('listings/' + id);
    if (null !== existing) return; // idempotent
    const listing = {
      id, seller: v.seller, token_name: v.token_name, price: v.price,
      currency: v.currency, status: 'active', created_at: now ?? null, updated_at: now ?? null,
    };
    const list = (await c.get('listings_list')) ?? [];
    const upd  = Array.isArray(list) ? list.slice() : [];
    upd.push(id);
    await c.put('listings/' + id, listing);
    await c.put('listings_list', upd);
    return 'created';
  }

  // listing:cancel
  const listing = await c.get('listings/' + id);
  if (null === listing || listing.status !== 'active') return;
  const updated = Object.assign({}, listing, { status: 'cancelled', updated_at: now ?? null });
  await c.put('listings/' + id, updated);
  return 'cancelled';
}
