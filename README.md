# Synergy NFT Marketplace

The storefront runs in practice mode with simulated SNRG and a local sample catalog. The public source includes the Synergy Wallet integration layer. Live minting, listings, and trading are disabled.

## Run the storefront

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory dist
```

Open http://127.0.0.1:4173. Run `node --test tests/*.test.mjs` in a second terminal to verify the build. Practice trading, offers, and saved items work without a Synergy Wallet connection. The Wallets page also links to a mock chain transaction showing reviewed fees and royalties, explicit approval or rejection, and pending, finalized, or failed mock receipts.

## Wallet integration

The Wallets page mounts a React island built from the official `@synergy-network/wallet-react` package. The connector's source repository is private. The bundle is built for authorized local review and is excluded from public Git and the hosted preview. The public build displays a wallet availability message and a link to the official wallet.

On an authorized review machine, use Node 22.12 or later, npm, and GitHub CLI access to the official connector repository.

```sh
node wallet/build.mjs --private-review
```

You can pass a local packed connector archive as a second argument. This builds `dist/wallet-connector/` without source maps. Remove this directory from any release archive until the connector can be distributed.

The current connector configuration enables only the Synergy Browser Wallet for private review. Mobile pairing needs an approved marketplace origin and working relay revocation. The hosted preview's origin currently receives HTTP 403 from the pairing preflight and HTTP 500 from the configured Testnet RPC preflight. Testnet RPC verification must succeed before a local account is shown as connected.

The integration distinguishes chain ID `1266`, the wallet identifier `synergy:1266`, and the marketplace network key `synergy:testnet-v3`. It checks the wallet and configured RPC before exposing a read-only account snapshot. Signing and spending require a separate approved transport. [Synergy Forge network reference](https://forge.synergy-network.io/networks)

## Chain interfaces and release gates

- `dist/chain-gateway.js` and its TypeScript declarations define collection creation, immutable metadata references, minting, approvals, listings, offers, cancellation, royalties, transfers, and atomic settlement. The mock uses exact atomic units, explicit approval, and idempotent receipts. The live adapter fails closed.
- `dist/market-index.js` replays normalized finalized blocks, handles explicit branch replacement, invalidates stale orders, and reconciles ownership, approvals, orders, and escrow against an independent reader at the exact checkpoint. It is an in-memory projection. A production service must supply verified blocks, deployment-scoped emitters, a persistent canonical history, and an authoritative reconciliation reader.
- Enable live trading only after the approved marketplace contracts and wallet signing transport are available, the wallet origin is registered, finality and reorg behavior are verified end to end, and contract and security reviews pass. [Synergy Testnet v3 contract manifest](https://github.com/synergy-network-hq/testnet-v3/blob/main/launch/TESTNET_V3_PRODUCTION_CONTRACT_ADDRESSES.json)

## Community and creator tools

Practice mode includes curated sample creator profiles, collection statistics, rarity filters, watchlists, and price alerts while the page is open. Creator Studio stores drop drafts, proposed royalties, and moderation reports in this browser. Draft metadata and optional artwork are hashed locally. Sample artwork and metadata can be verified against the published SHA-256 manifest. Real creator verification, public reports and takedowns, durable media publishing, and out-of-session notifications require backend services and operational policies.
