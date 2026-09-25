// Unit test for the marketplace contract logic — mocks the contract context
// (Map-backed state) so the deterministic rules are provable without Pear/MSB.
// Run: node contract/marketplace.test.js

import { createListing, cancelListing, recordSale } from './marketplace.js';

let passed = 0, failed = 0;
const ok  = (cond, msg) => { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL:', msg); } };

// Mock contract context. `address` = the signing caller; `value` = the payload.
function makeCtx({ address, value, seed = {} }) {
  const state = new Map(Object.entries(seed));
  return {
    address,
    value,
    _state: state,
    async get(k) { return state.has(k) ? state.get(k) : null; },
    async put(k, v) { state.set(k, v); },
    assert(cond) { if (!cond) throw new Error('assert failed'); },
    protocol: { safeClone: (v) => JSON.parse(JSON.stringify(v)) },
  };
}

const CERT = { cards: { 'CASTLEPEPE': { token_name: 'CASTLEPEPE', art_hash: 'ab'.repeat(32) } } };
// Seed helper: certified card + a clock.
const seedCertified = () => ({ 'cards/CASTLEPEPE': CERT.cards.CASTLEPEPE, currentTime: 1000 });

(async () => {
  // 1. Happy path: create a listing on a certified card.
  {
    const c = makeCtx({ address: 'alice', seed: seedCertified(),
      value: { op: 'createListing', listing_id: 'lst_castle_001', token_name: 'CASTLEPEPE', price: '12', currency: 'XCP' } });
    await createListing(c);
    const l = await c.get('listings/lst_castle_001');
    ok(l && l.seller === 'alice' && l.status === 'active' && l.price === '12' && l.currency === 'XCP', 'creates active listing, seller=caller');
    ok(JSON.stringify(await c.get('listings_list')) === JSON.stringify(['lst_castle_001']), 'listings_list updated');
    ok(JSON.stringify(await c.get('listings_by_seller/alice')) === JSON.stringify(['lst_castle_001']), 'seller index updated');
    ok(l.created_at === 1000, 'created_at from oracle, not Date.now');
  }

  // 2. Reject listing an UNCERTIFIED token.
  {
    const c = makeCtx({ address: 'alice', seed: { currentTime: 1000 },
      value: { op: 'createListing', listing_id: 'lst_fake_001', token_name: 'NOTACARD', price: '12', currency: 'XCP' } });
    await createListing(c);
    ok(await c.get('listings/lst_fake_001') === null, 'uncertified token cannot be listed');
  }

  // 3. Idempotent create: second create with same id is a no-op (no dup in list).
  {
    const c = makeCtx({ address: 'alice', seed: seedCertified(),
      value: { op: 'createListing', listing_id: 'lst_castle_001', token_name: 'CASTLEPEPE', price: '12', currency: 'XCP' } });
    await createListing(c);
    await createListing(c);
    ok((await c.get('listings_list')).length === 1, 'duplicate create id is a no-op');
  }

  // 4. Cancel: only the seller can cancel; non-seller is ignored.
  {
    const c = makeCtx({ address: 'alice', seed: seedCertified(),
      value: { op: 'createListing', listing_id: 'lst_castle_002', token_name: 'CASTLEPEPE', price: '5', currency: 'PEPECASH' } });
    await createListing(c);
    // mallory tries to cancel alice's listing
    c.address = 'mallory'; c.value = { op: 'cancelListing', listing_id: 'lst_castle_002' };
    await cancelListing(c);
    ok((await c.get('listings/lst_castle_002')).status === 'active', 'non-seller cannot cancel');
    // alice cancels her own
    c.address = 'alice';
    await cancelListing(c);
    ok((await c.get('listings/lst_castle_002')).status === 'cancelled', 'seller can cancel');
  }

  // 5. recordSale: seller records the on-Bitcoin settlement → provenance; listing → sold.
  {
    const c = makeCtx({ address: 'alice', seed: seedCertified(),
      value: { op: 'createListing', listing_id: 'lst_castle_003', token_name: 'CASTLEPEPE', price: '12', currency: 'XCP' } });
    await createListing(c);
    const txid = 'cd'.repeat(32);
    c.value = { op: 'recordSale', listing_id: 'lst_castle_003', buyer_address: 'bob', txid };
    await recordSale(c);
    const sale = await c.get('sales/' + txid);
    ok(sale && sale.buyer === 'bob' && sale.seller === 'alice' && sale.price === '12', 'sale provenance recorded');
    ok((await c.get('listings/lst_castle_003')).status === 'sold', 'listing marked sold');
    ok(JSON.stringify(await c.get('sales_list')) === JSON.stringify([txid]), 'sales_list updated');
    // idempotent: same txid again is a no-op
    await recordSale(c);
    ok((await c.get('sales_list')).length === 1, 'duplicate sale txid is a no-op');
  }

  // 6. Can't sell a cancelled listing; non-seller can't record a sale.
  {
    const c = makeCtx({ address: 'alice', seed: seedCertified(),
      value: { op: 'createListing', listing_id: 'lst_castle_004', token_name: 'CASTLEPEPE', price: '9', currency: 'CASH' } });
    await createListing(c);
    c.address = 'mallory';
    c.value = { op: 'recordSale', listing_id: 'lst_castle_004', buyer_address: 'bob', txid: 'ef'.repeat(32) };
    await recordSale(c);
    ok(await c.get('sales/' + 'ef'.repeat(32)) === null, 'non-seller cannot record a sale');
    c.address = 'alice'; c.value = { op: 'cancelListing', listing_id: 'lst_castle_004' };
    await cancelListing(c);
    c.value = { op: 'recordSale', listing_id: 'lst_castle_004', buyer_address: 'bob', txid: 'ef'.repeat(32) };
    await recordSale(c);
    ok(await c.get('sales/' + 'ef'.repeat(32)) === null, 'cannot sell a cancelled listing');
  }

  console.log(`\n${failed === 0 ? '✅' : '❌'} marketplace contract: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
