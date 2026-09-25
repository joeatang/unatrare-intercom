import {Protocol} from "trac-peer";
import { bufferToBigInt, bigIntToDecimalString } from "trac-msb/src/utils/amountSerialization.js";
import b4a from "b4a";
import PeerWallet from "trac-wallet";
import fs from "fs";

const stableStringify = (value) => {
    if (value === null || value === undefined) return 'null';
    if (typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
};

const normalizeInvitePayload = (payload) => {
    return {
        channel: String(payload?.channel ?? ''),
        inviteePubKey: String(payload?.inviteePubKey ?? '').trim().toLowerCase(),
        inviterPubKey: String(payload?.inviterPubKey ?? '').trim().toLowerCase(),
        inviterAddress: payload?.inviterAddress ?? null,
        issuedAt: Number(payload?.issuedAt),
        expiresAt: Number(payload?.expiresAt),
        nonce: String(payload?.nonce ?? ''),
        version: Number.isFinite(payload?.version) ? Number(payload.version) : 1,
    };
};

const normalizeWelcomePayload = (payload) => {
    return {
        channel: String(payload?.channel ?? ''),
        ownerPubKey: String(payload?.ownerPubKey ?? '').trim().toLowerCase(),
        text: String(payload?.text ?? ''),
        issuedAt: Number(payload?.issuedAt),
        version: Number.isFinite(payload?.version) ? Number(payload.version) : 1,
    };
};

const parseInviteArg = (raw) => {
    if (!raw) return null;
    let text = String(raw || '').trim();
    if (!text) return null;
    if (text.startsWith('@')) {
        try {
            text = fs.readFileSync(text.slice(1), 'utf8').trim();
        } catch (_e) {
            return null;
        }
    }
    if (text.startsWith('b64:')) text = text.slice(4);
    if (text.startsWith('{')) {
        try {
            return JSON.parse(text);
        } catch (_e) {}
    }
    try {
        const decoded = b4a.toString(b4a.from(text, 'base64'));
        return JSON.parse(decoded);
    } catch (_e) {}
    return null;
};

const parseWelcomeArg = (raw) => {
    if (!raw) return null;
    let text = String(raw || '').trim();
    if (!text) return null;
    if (text.startsWith('@')) {
        try {
            text = fs.readFileSync(text.slice(1), 'utf8').trim();
        } catch (_e) {
            return null;
        }
    }
    if (text.startsWith('b64:')) text = text.slice(4);
    if (text.startsWith('{')) {
        try {
            return JSON.parse(text);
        } catch (_e) {}
    }
    try {
        const decoded = b4a.toString(b4a.from(text, 'base64'));
        return JSON.parse(decoded);
    } catch (_e) {}
    return null;
};

class UnatrareProtocol extends Protocol {

    /**
     * Extending from Protocol inherits its capabilities and allows you to define your own protocol.
     * The protocol supports the corresponding contract. Both files come in pairs.
     *
     * Instances of this class do NOT run in contract context. The constructor is only called once on Protocol
     * instantiation.
     *
     * this.peer: an instance of the entire Peer class, the actual node that runs the contract and everything else.
     * this.base: the database engine, provides await this.base.view.get('key') to get unsigned data (not finalized data).
     * this.options: the option stack passed from Peer instance.
     *
     * @param peer
     * @param base
     * @param options
     */
    constructor(peer, base, options = {}) {
        // calling super and passing all parameters is required.
        super(peer, base, options);
    }

    /**
     * The Protocol superclass ProtocolApi instance already provides numerous api functions.
     * You can extend the built-in api based on your protocol requirements.
     *
     * @returns {Promise<void>}
     */
    async extendApi() {
        const self = this;
        // Expose read helpers for SC-Bridge / Next.js API queries
        this.api.getNodeData  = async (pubkey) => self.getSigned('nodes/' + pubkey);
        this.api.getNodesList = async ()       => self.getSigned('nodes_list');
        this.api.getCardsList = async ()       => self.getSigned('cards_list');
        this.api.getCardData  = async (token)  => self.getSigned('cards/' + token);
        this.api.getSnapshot  = async ()       => ({
            nodes: (await self.getSigned('nodes_list'))?.length ?? 0,
            cards: (await self.getSigned('cards_list'))?.length ?? 0,
            currentTime: await self.getSigned('currentTime'),
        });

        // ── Marketplace read helpers (SC-Bridge / Next.js) ───────────────────
        this.api.getListing       = async (id)     => self.getSigned('listings/' + id);
        this.api.getListingsList  = async ()       => self.getSigned('listings_list');
        this.api.getListingsBySeller = async (addr) => self.getSigned('listings_by_seller/' + addr);
        this.api.getSale          = async (txid)   => self.getSigned('sales/' + txid);
        this.api.getSalesList     = async ()       => self.getSigned('sales_list');
        // Hydrate every active listing in one call (what the marketplace page needs).
        this.api.getActiveListings = async () => {
            const ids = (await self.getSigned('listings_list')) ?? [];
            const out = [];
            for (const id of ids) {
                const l = await self.getSigned('listings/' + id);
                if (l && l.status === 'active') out.push(l);
            }
            return out;
        };
    }

    /**
     * In order for a transaction to successfully trigger,
     * you need to create a mapping for the incoming tx command,
     * pointing at the contract function to execute.
     *
     * You can perform basic sanitization here, but do not use it to protect contract execution.
     * Instead, use the built-in schema support for in-contract sanitization instead
     * (Contract.addSchema() in contract constructor).
     *
     * @param command
     * @returns {{type: string, value: *}|null}
     */
    mapTxCommand(command) {
        const obj = { type: '', value: null };

        // ── No-payload commands ───────────────────────────────────────────────
        if (command === 'heartbeat') {
            obj.type = 'heartbeat';
            return obj;
        }
        if (command === 'get_all_nodes') {
            obj.type = 'getAllNodes';
            return obj;
        }
        if (command === 'get_all_cards') {
            obj.type = 'getAllCards';
            return obj;
        }
        if (command === 'get_network_snapshot') {
            obj.type = 'getNetworkSnapshot';
            return obj;
        }
        // Marketplace no-payload reads MUST be matched here, BEFORE the JSON
        // parser (safeJsonParse throws on non-JSON like 'get_all_listings').
        if (command === 'get_all_listings') { obj.type = 'getAllListings'; return obj; }
        if (command === 'get_all_sales')    { obj.type = 'getAllSales';    return obj; }

        // ── JSON payload commands ─────────────────────────────────────────────
        // Only parse when it actually looks like JSON, and guard every access so
        // an unknown/typo command returns null instead of crashing the terminal.
        const json = (typeof command === 'string' && command.trim().startsWith('{'))
            ? this.safeJsonParse(command)
            : null;
        if (json && json.op === 'certify_card') { obj.type = 'certifyCard'; obj.value = json; return obj; }
        if (json && json.op === 'register_node') { obj.type = 'registerNode'; obj.value = json; return obj; }
        if (json && json.op === 'get_node_state') { obj.type = 'getNodeState'; obj.value = json; return obj; }
        if (json && json.op === 'get_card') { obj.type = 'getCard'; obj.value = json; return obj; }

        // ── Marketplace JSON commands ─────────────────────────────────────────
        if (json && json.op === 'create_listing') { obj.type = 'createListing'; obj.value = json; return obj; }
        if (json && json.op === 'cancel_listing') { obj.type = 'cancelListing'; obj.value = json; return obj; }
        if (json && json.op === 'record_sale')    { obj.type = 'recordSale';    obj.value = json; return obj; }
        if (json && json.op === 'get_listing')    { obj.type = 'getListing';    obj.value = json; return obj; }

        return null;
    }

    /**
     * Prints additional options for your protocol underneath the system ones in terminal.
     *
     * @returns {Promise<void>}
     */
    async printOptions() {
        console.log(' ');
        console.log('═══ UNATRARE Contract Commands ══════════════════════════════════════════');
        console.log("  /tx --command 'heartbeat'                                 (registered nodes only; max 1/hour)");
        console.log("  /tx --command 'get_all_nodes'                             (print all registered node addresses)");
        console.log("  /tx --command 'get_all_cards'                             (print all certified cards)");
        console.log("  /tx --command 'get_network_snapshot'                      (print node + card counts)");
        console.log("  /tx --command '{ \"op\": \"certify_card\", \"token_name\": \"RAREUNATPEPE\", \"art_hash\": \"<64-hex>\" }'");
        console.log("  /tx --command '{ \"op\": \"register_node\", \"btc_address\": \"bc1q...\" }'");
        console.log("  /tx --command '{ \"op\": \"get_node_state\", \"pubkey\": \"<pubkey-hex>\" }'");
        console.log("  /tx --command '{ \"op\": \"get_card\", \"token_name\": \"RAREUNATPEPE\" }'");
        console.log(' ');
        console.log('═══ UNATRARE Marketplace Commands ═══════════════════════════════════════');
        console.log("  /tx --command '{ \"op\": \"create_listing\", \"listing_id\": \"lst_...\", \"token_name\": \"CASTLEPEPE\", \"price\": \"12\", \"currency\": \"XCP\" }'  (seller = you; token must be certified)");
        console.log("  /tx --command '{ \"op\": \"cancel_listing\", \"listing_id\": \"lst_...\" }'   (seller only)");
        console.log("  /tx --command '{ \"op\": \"record_sale\", \"listing_id\": \"lst_...\", \"buyer_address\": \"...\", \"txid\": \"<64-hex>\" }'  (seller records the on-Bitcoin settlement)");
        console.log("  /tx --command 'get_all_listings'                          (print all listing ids)");
        console.log("  /tx --command 'get_all_sales'                             (print provenance ledger)");
        console.log("  /tx --command '{ \"op\": \"get_listing\", \"listing_id\": \"lst_...\" }'");
        console.log(' ');
        console.log('═══ System Commands ════════════════════════════════════════════════════');
        console.log('  /get --key "<key>" [--confirmed true|false]               (read contract state)');
        console.log('  /msb                                                      (print MSB txv + peer info)');
        console.log('  /sc_join --channel "<name>"                               (join ephemeral sidechannel)');
        console.log('  /sc_open --channel "<name>" [--via "<channel>"]           (request others to open channel)');
        console.log('  /sc_send --channel "<name>" --message "<text>"            (send sidechannel message)');
        console.log('  /sc_invite --channel "<name>" --pubkey "<hex>" [--ttl <sec>]');
        console.log('  /sc_welcome --channel "<name>" --text "<message>"');
        console.log('  /sc_stats                                                 (show channels + connection count)');
    }

    /**
     * Extend the terminal system commands and execute your custom ones for your protocol.
     * This is not transaction execution itself (though can be used for it based on your requirements).
     * For transactions, use the built-in /tx command in combination with command mapping (see above)
     *
     * @param input
     * @returns {Promise<void>}
     */
    async customCommand(input) {
        await super.tokenizeInput(input);
        if (this.input.startsWith("/get")) {
            const m = input.match(/(?:^|\s)--key(?:=|\s+)(\"[^\"]+\"|'[^']+'|\S+)/);
            const raw = m ? m[1].trim() : null;
            if (!raw) {
                console.log('Usage: /get --key "<hyperbee-key>" [--confirmed true|false] [--unconfirmed 1]');
                return;
            }
            const key = raw.replace(/^\"(.*)\"$/, "$1").replace(/^'(.*)'$/, "$1");
            const confirmedMatch = input.match(/(?:^|\s)--confirmed(?:=|\s+)(\S+)/);
            const unconfirmedMatch = input.match(/(?:^|\s)--unconfirmed(?:=|\s+)?(\S+)?/);
            const confirmed = unconfirmedMatch ? false : confirmedMatch ? confirmedMatch[1] === "true" || confirmedMatch[1] === "1" : true;
            const v = confirmed ? await this.getSigned(key) : await this.get(key);
            console.log(v);
            return;
        }
        if (this.input.startsWith("/msb")) {
            const txv = await this.peer.msbClient.getTxvHex();
            const peerMsbAddress = this.peer.msbClient.pubKeyHexToAddress(this.peer.wallet.publicKey);
            const entry = await this.peer.msbClient.getNodeEntryUnsigned(peerMsbAddress);
            const balance = entry?.balance ? bigIntToDecimalString(bufferToBigInt(entry.balance)) : 0;
            const feeBuf = this.peer.msbClient.getFee();
            const fee = feeBuf ? bigIntToDecimalString(bufferToBigInt(feeBuf)) : 0;
            const validators = this.peer.msbClient.getConnectedValidatorsCount();
            console.log({
                networkId: this.peer.msbClient.networkId,
                msbBootstrap: this.peer.msbClient.bootstrapHex,
                txv,
                msbSignedLength: this.peer.msbClient.getSignedLength(),
                msbUnsignedLength: this.peer.msbClient.getUnsignedLength(),
                connectedValidators: validators,
                peerMsbAddress,
                peerMsbBalance: balance,
                msbFee: fee,
            });
            return;
        }
        if (this.input.startsWith("/sc_join")) {
            const args = this.parseArgs(input);
            const name = args.channel || args.ch || args.name;
            const inviteArg = args.invite || args.invite_b64 || args.invitebase64;
            const welcomeArg = args.welcome || args.welcome_b64 || args.welcomebase64;
            if (!name) {
                console.log('Usage: /sc_join --channel "<name>" [--invite <json|b64|@file>] [--welcome <json|b64|@file>]');
                return;
            }
            if (!this.peer.sidechannel) {
                console.log('Sidechannel not initialized.');
                return;
            }
            let invite = null;
            if (inviteArg) {
                invite = parseInviteArg(inviteArg);
                if (!invite) {
                    console.log('Invalid invite. Pass JSON, base64, or @file.');
                    return;
                }
            }
            let welcome = null;
            if (welcomeArg) {
                welcome = parseWelcomeArg(welcomeArg);
                if (!welcome) {
                    console.log('Invalid welcome. Pass JSON, base64, or @file.');
                    return;
                }
            }
            if (invite || welcome) {
                this.peer.sidechannel.acceptInvite(String(name), invite, welcome);
            }
            const ok = await this.peer.sidechannel.addChannel(String(name));
            if (!ok) {
                console.log('Join denied (invite required or invalid).');
                return;
            }
            console.log('Joined sidechannel:', name);
            return;
        }
        if (this.input.startsWith("/sc_send")) {
            const args = this.parseArgs(input);
            const name = args.channel || args.ch || args.name;
            const message = args.message || args.msg;
            const inviteArg = args.invite || args.invite_b64 || args.invitebase64;
            const welcomeArg = args.welcome || args.welcome_b64 || args.welcomebase64;
            if (!name || message === undefined) {
                console.log('Usage: /sc_send --channel "<name>" --message "<text>" [--invite <json|b64|@file>] [--welcome <json|b64|@file>]');
                return;
            }
            if (!this.peer.sidechannel) {
                console.log('Sidechannel not initialized.');
                return;
            }
            let invite = null;
            if (inviteArg) {
                invite = parseInviteArg(inviteArg);
                if (!invite) {
                    console.log('Invalid invite. Pass JSON, base64, or @file.');
                    return;
                }
            }
            let welcome = null;
            if (welcomeArg) {
                welcome = parseWelcomeArg(welcomeArg);
                if (!welcome) {
                    console.log('Invalid welcome. Pass JSON, base64, or @file.');
                    return;
                }
            }
            if (invite || welcome) {
                this.peer.sidechannel.acceptInvite(String(name), invite, welcome);
            }
            const ok = await this.peer.sidechannel.addChannel(String(name));
            if (!ok) {
                console.log('Send denied (invite required or invalid).');
                return;
            }
            const sent = this.peer.sidechannel.broadcast(String(name), message, invite ? { invite } : undefined);
            if (!sent) {
                console.log('Send denied (owner-only or invite required).');
            }
            return;
        }
        if (this.input.startsWith("/sc_open")) {
            const args = this.parseArgs(input);
            const name = args.channel || args.ch || args.name;
            const via = args.via || args.channel_via;
            const inviteArg = args.invite || args.invite_b64 || args.invitebase64;
            const welcomeArg = args.welcome || args.welcome_b64 || args.welcomebase64;
            if (!name) {
                console.log('Usage: /sc_open --channel "<name>" [--via "<channel>"] [--invite <json|b64|@file>] [--welcome <json|b64|@file>]');
                return;
            }
            if (!this.peer.sidechannel) {
                console.log('Sidechannel not initialized.');
                return;
            }
            let invite = null;
            if (inviteArg) {
                invite = parseInviteArg(inviteArg);
                if (!invite) {
                    console.log('Invalid invite. Pass JSON, base64, or @file.');
                    return;
                }
            }
            let welcome = null;
            if (welcomeArg) {
                welcome = parseWelcomeArg(welcomeArg);
                if (!welcome) {
                    console.log('Invalid welcome. Pass JSON, base64, or @file.');
                    return;
                }
            } else if (typeof this.peer.sidechannel.getWelcome === 'function') {
                welcome = this.peer.sidechannel.getWelcome(String(name));
            }
            const viaChannel = via || this.peer.sidechannel.entryChannel || null;
            if (!viaChannel) {
                console.log('No entry channel configured. Pass --via "<channel>".');
                return;
            }
            this.peer.sidechannel.requestOpen(String(name), String(viaChannel), invite, welcome);
            console.log('Requested channel:', name);
            return;
        }
        if (this.input.startsWith("/sc_invite")) {
            const args = this.parseArgs(input);
            const channel = args.channel || args.ch || args.name;
            const invitee = args.pubkey || args.invitee || args.peer || args.key;
            const ttlRaw = args.ttl || args.ttl_sec || args.ttl_s;
            const welcomeArg = args.welcome || args.welcome_b64 || args.welcomebase64;
            if (!channel || !invitee) {
                console.log('Usage: /sc_invite --channel "<name>" --pubkey "<peer-pubkey-hex>" [--ttl <sec>] [--welcome <json|b64|@file>]');
                return;
            }
            if (!this.peer.sidechannel) {
                console.log('Sidechannel not initialized.');
                return;
            }
            if (this.peer?.wallet?.ready) {
                try {
                    await this.peer.wallet.ready;
                } catch (_e) {}
            }
            const walletPub = this.peer?.wallet?.publicKey;
            const inviterPubKey = walletPub
                ? typeof walletPub === 'string'
                    ? walletPub.trim().toLowerCase()
                    : b4a.toString(walletPub, 'hex')
                : null;
            if (!inviterPubKey) {
                console.log('Wallet not ready; cannot sign invite.');
                return;
            }
            let inviterAddress = null;
            try {
                if (this.peer?.msbClient) {
                    inviterAddress = this.peer.msbClient.pubKeyHexToAddress(inviterPubKey);
                }
            } catch (_e) {}
            const issuedAt = Date.now();
            let ttlMs = null;
            if (ttlRaw !== undefined) {
                const ttlSec = Number.parseInt(String(ttlRaw), 10);
                ttlMs = Number.isFinite(ttlSec) ? Math.max(ttlSec, 0) * 1000 : null;
            } else if (Number.isFinite(this.peer.sidechannel.inviteTtlMs) && this.peer.sidechannel.inviteTtlMs > 0) {
                ttlMs = this.peer.sidechannel.inviteTtlMs;
            } else {
                ttlMs = 0;
            }
            if (!ttlMs || ttlMs <= 0) {
                console.log('Invite TTL is required. Pass --ttl <sec> or set --sidechannel-invite-ttl.');
                return;
            }
            const expiresAt = issuedAt + ttlMs;
            const payload = normalizeInvitePayload({
                channel: String(channel),
                inviteePubKey: String(invitee).trim().toLowerCase(),
                inviterPubKey,
                inviterAddress,
                issuedAt,
                expiresAt,
                nonce: Math.random().toString(36).slice(2, 10),
                version: 1,
            });
            const message = stableStringify(payload);
            const msgBuf = b4a.from(message);
            let sig = this.peer.wallet.sign(msgBuf);
            let sigHex = '';
            if (typeof sig === 'string') {
                sigHex = sig;
            } else if (sig && sig.length > 0) {
                sigHex = b4a.toString(sig, 'hex');
            }
            if (!sigHex) {
                const walletSecret = this.peer?.wallet?.secretKey;
                const secretBuf = walletSecret
                    ? b4a.isBuffer(walletSecret)
                        ? walletSecret
                        : typeof walletSecret === 'string'
                            ? b4a.from(walletSecret, 'hex')
                            : b4a.from(walletSecret)
                    : null;
                if (secretBuf) {
                    const sigBuf = PeerWallet.sign(msgBuf, secretBuf);
                    if (sigBuf && sigBuf.length > 0) {
                        sigHex = b4a.toString(sigBuf, 'hex');
                    }
                }
            }
            let welcome = null;
            if (welcomeArg) {
                welcome = parseWelcomeArg(welcomeArg);
                if (!welcome) {
                    console.log('Invalid welcome. Pass JSON, base64, or @file.');
                    return;
                }
            } else if (typeof this.peer.sidechannel.getWelcome === 'function') {
                welcome = this.peer.sidechannel.getWelcome(String(channel));
            }
            const invite = { payload, sig: sigHex, welcome: welcome || undefined };
            const inviteJson = JSON.stringify(invite);
            const inviteB64 = b4a.toString(b4a.from(inviteJson), 'base64');
            if (!sigHex) {
                console.log('Failed to sign invite; wallet secret key unavailable.');
                return;
            }
            console.log(inviteJson);
            console.log('invite_b64:', inviteB64);
            return;
        }
        if (this.input.startsWith("/sc_welcome")) {
            const args = this.parseArgs(input);
            const channel = args.channel || args.ch || args.name;
            const text = args.text || args.message || args.msg;
            if (!channel || text === undefined) {
                console.log('Usage: /sc_welcome --channel "<name>" --text "<message>"');
                return;
            }
            if (!this.peer.sidechannel) {
                console.log('Sidechannel not initialized.');
                return;
            }
            if (this.peer?.wallet?.ready) {
                try {
                    await this.peer.wallet.ready;
                } catch (_e) {}
            }
            const walletPub = this.peer?.wallet?.publicKey;
            const ownerPubKey = walletPub
                ? typeof walletPub === 'string'
                    ? walletPub.trim().toLowerCase()
                    : b4a.toString(walletPub, 'hex')
                : null;
            if (!ownerPubKey) {
                console.log('Wallet not ready; cannot sign welcome.');
                return;
            }
            const payload = normalizeWelcomePayload({
                channel: String(channel),
                ownerPubKey,
                text: String(text),
                issuedAt: Date.now(),
                version: 1,
            });
            const message = stableStringify(payload);
            const msgBuf = b4a.from(message);
            let sig = this.peer.wallet.sign(msgBuf);
            let sigHex = '';
            if (typeof sig === 'string') {
                sigHex = sig;
            } else if (sig && sig.length > 0) {
                sigHex = b4a.toString(sig, 'hex');
            }
            if (!sigHex) {
                const walletSecret = this.peer?.wallet?.secretKey;
                const secretBuf = walletSecret
                    ? b4a.isBuffer(walletSecret)
                        ? walletSecret
                        : typeof walletSecret === 'string'
                            ? b4a.from(walletSecret, 'hex')
                            : b4a.from(walletSecret)
                    : null;
                if (secretBuf) {
                    const sigBuf = PeerWallet.sign(msgBuf, secretBuf);
                    if (sigBuf && sigBuf.length > 0) {
                        sigHex = b4a.toString(sigBuf, 'hex');
                    }
                }
            }
            if (!sigHex) {
                console.log('Failed to sign welcome; wallet secret key unavailable.');
                return;
            }
            const welcome = { payload, sig: sigHex };
            // Store the welcome in-memory so the owner peer can auto-send it to new connections
            // without requiring a restart (and so /sc_invite can embed it by default).
            try {
                this.peer.sidechannel.acceptInvite(String(channel), null, welcome);
            } catch (_e) {}
            const welcomeJson = JSON.stringify(welcome);
            const welcomeB64 = b4a.toString(b4a.from(welcomeJson), 'base64');
            console.log(welcomeJson);
            console.log('welcome_b64:', welcomeB64);
            return;
        }
        if (this.input.startsWith("/sc_stats")) {
            if (!this.peer.sidechannel) {
                console.log('Sidechannel not initialized.');
                return;
            }
            const channels = Array.from(this.peer.sidechannel.channels.keys());
            const connectionCount = this.peer.sidechannel.connections.size;
            console.log({ channels, connectionCount });
            return;
        }
        if (this.input.startsWith("/print")) {
            const splitted = this.parseArgs(input);
            console.log(splitted.text);
        }
    }
}

export default UnatrareProtocol;
