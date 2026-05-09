import {Contract} from 'trac-peer'

/**
 * UNATRARE Contract — TRAC R1 Subnet
 *
 * State layout:
 *   admin_address          : string  — address of the bootstrap admin (set once)
 *   currentTime            : number  — ms timestamp fed by the Timer feature (admin node)
 *   nodes/{address}        : object  — { btc_address, registered_at, last_heartbeat, total_heartbeats, is_genesis }
 *   nodes_list             : array   — ordered list of registered node addresses
 *   cards/{token_name}     : object  — { token_name, art_hash, certified_at }
 *   cards_list             : array   — ordered list of certified token names
 *
 * Rules:
 *   - set_admin        : first-call-wins; sets admin_address to caller
 *   - certify_card     : admin only
 *   - register_node    : anyone, once per address; first 100 earn genesis status (2× reward)
 *   - heartbeat        : registered nodes only; rate-limited to 1 per hour via Timer oracle
 *   - get_*            : read-only helpers (no state writes)
 *
 * Contract invariants (enforced by trac-peer):
 *   No try-catch · No throws · No random values · No HTTP calls · No Date.now()
 *   All time values come from the Timer feature oracle stored in 'currentTime'.
 */
class UnatrareContract extends Contract {
    constructor(protocol, options = {}) {
        super(protocol, options);

        // ── No-payload functions ──────────────────────────────────────────────
        this.addFunction('setAdmin');
        this.addFunction('heartbeat');
        this.addFunction('getAllNodes');
        this.addFunction('getAllCards');
        this.addFunction('getNetworkSnapshot');

        // ── Schema-validated functions ────────────────────────────────────────
        this.addSchema('certifyCard', {
            value: {
                $$strict: true,
                $$type: 'object',
                op:         { type: 'string', min: 1, max: 128 },
                token_name: { type: 'string', min: 1, max: 21, pattern: /^[A-Z0-9.]+$/ },
                art_hash:   { type: 'string', min: 64, max: 64, pattern: /^[a-fA-F0-9]+$/ },
            }
        });

        this.addSchema('registerNode', {
            value: {
                $$strict: true,
                $$type: 'object',
                op:          { type: 'string', min: 1, max: 128 },
                btc_address: { type: 'string', min: 20, max: 100 },
            }
        });

        this.addSchema('getNodeState', {
            value: {
                $$strict: true,
                $$type: 'object',
                op:     { type: 'string', min: 1, max: 128 },
                pubkey: { type: 'string', min: 1, max: 256 },
            }
        });

        this.addSchema('getCard', {
            value: {
                $$strict: true,
                $$type: 'object',
                op:         { type: 'string', min: 1, max: 128 },
                token_name: { type: 'string', min: 1, max: 21 },
            }
        });

        // ── Timer feature (currentTime oracle — only active on admin node) ────
        this.addSchema('feature_entry', {
            key:   { type: 'string', min: 1, max: 256 },
            value: { type: 'any' },
        });

        const _this = this;
        this.addFeature('timer_feature', async function () {
            if (false === _this.check.validateSchema('feature_entry', _this.op)) return;
            if (_this.op.key === 'currentTime') {
                await _this.put('currentTime', _this.op.value);
            }
        });
    }

    // ── Set Admin — first-call-wins bootstrap ─────────────────────────────────
    async setAdmin() {
        const existing = await this.get('admin_address');
        if (null !== existing) return; // already set; ignore subsequent calls
        await this.put('admin_address', this.address);
        console.log('[unatrare] Admin set:', this.address);
    }

    // ── Certify a card (admin only) ───────────────────────────────────────────
    async certifyCard() {
        const adminAddress = await this.get('admin_address');
        if (adminAddress !== this.address) return; // caller is not admin

        const tokenName = this.value.token_name;
        const artHash   = this.value.art_hash.toLowerCase();

        const existing = await this.get('cards/' + tokenName);
        if (null !== existing) return; // already certified; idempotent

        const currentTime = await this.get('currentTime');
        const card = {
            token_name:   tokenName,
            art_hash:     artHash,
            certified_at: currentTime ?? null,
        };

        const cardsList    = (await this.get('cards_list')) ?? [];
        const updatedCards = this.protocol.safeClone(cardsList);
        this.assert(updatedCards !== null);
        updatedCards.push(tokenName);

        await this.put('cards/' + tokenName, card);
        await this.put('cards_list', updatedCards);
        console.log('[unatrare] Card certified:', tokenName, artHash.slice(0, 8) + '...');
    }

    // ── Register as a network node ─────────────────────────────────────────────
    async registerNode() {
        const existing = await this.get('nodes/' + this.address);
        if (null !== existing) return; // already registered; idempotent

        const btcAddress  = this.value.btc_address;
        const currentTime = await this.get('currentTime');
        const nodesList   = (await this.get('nodes_list')) ?? [];
        const isGenesis   = nodesList.length < 100; // first 100 nodes earn genesis 2× reward rate

        const node = {
            btc_address:      btcAddress,
            registered_at:    currentTime ?? null,
            last_heartbeat:   null,
            total_heartbeats: 0,
            is_genesis:       isGenesis,
        };

        const updatedNodes = this.protocol.safeClone(nodesList);
        this.assert(updatedNodes !== null);
        updatedNodes.push(this.address);

        await this.put('nodes/' + this.address, node);
        await this.put('nodes_list', updatedNodes);
        console.log('[unatrare] Node registered:', this.address, isGenesis ? '(GENESIS)' : '');
    }

    // ── Heartbeat (registered nodes only, max once per hour) ─────────────────
    async heartbeat() {
        const node = await this.get('nodes/' + this.address);
        if (null === node) return; // not registered; ignore

        const currentTime = await this.get('currentTime');
        const HOUR_MS     = 3_600_000;

        // Rate limit: enforce 1-hour gap when the timer oracle is active
        if (currentTime !== null && node.last_heartbeat !== null) {
            if (currentTime - node.last_heartbeat < HOUR_MS) return;
        }

        const updated = this.protocol.safeClone(node);
        this.assert(updated !== null);
        updated.last_heartbeat   = currentTime ?? null;
        updated.total_heartbeats = (node.total_heartbeats || 0) + 1;

        await this.put('nodes/' + this.address, updated);
        console.log('[unatrare] Heartbeat from', this.address.slice(0, 8) + '...', '| total:', updated.total_heartbeats);
    }

    // ── Read: single node state ────────────────────────────────────────────────
    async getNodeState() {
        const pubkey = this.value?.pubkey;
        if (!pubkey) return;
        const node = await this.get('nodes/' + pubkey);
        console.log('[unatrare] node/' + pubkey.slice(0, 8) + '...:', node);
    }

    // ── Read: all registered node addresses ───────────────────────────────────
    async getAllNodes() {
        const nodesList = await this.get('nodes_list');
        console.log('[unatrare] nodes (' + (nodesList?.length ?? 0) + '):', nodesList);
    }

    // ── Read: single certified card ────────────────────────────────────────────
    async getCard() {
        const tokenName = this.value?.token_name;
        if (!tokenName) return;
        const card = await this.get('cards/' + tokenName);
        console.log('[unatrare] card/' + tokenName + ':', card);
    }

    // ── Read: all certified token names ───────────────────────────────────────
    async getAllCards() {
        const cardsList = await this.get('cards_list');
        console.log('[unatrare] cards (' + (cardsList?.length ?? 0) + '):', cardsList);
    }

    // ── Read: network summary ──────────────────────────────────────────────────
    async getNetworkSnapshot() {
        const nodesList   = await this.get('nodes_list');
        const cardsList   = await this.get('cards_list');
        const currentTime = await this.get('currentTime');
        const admin       = await this.get('admin_address');
        console.log('[unatrare] snapshot:', {
            nodes:       nodesList?.length ?? 0,
            cards:       cardsList?.length ?? 0,
            currentTime: currentTime ?? null,
            admin:       admin ? admin.slice(0, 8) + '...' : null,
        });
    }
}

export default UnatrareContract;

