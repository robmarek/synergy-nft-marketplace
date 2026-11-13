import assert from 'node:assert/strict';
import test from 'node:test';
import { createMockChainGateway } from '../dist/chain-gateway.js';
import { createMarketplaceIndex } from '../dist/market-index.js';

const operator = 'mock-marketplace';
const collection = { collectionId: 'collection-1', creator: 'creator', royaltyBps: 500, royaltyRecipient: 'creator' };
const nft = { collectionId: collection.collectionId, tokenId: '1' };
const alice = 'alice';
const bob = 'bob';
const offer = { ...nft, offerId: 'offer-1', buyer: bob, seller: alice, operator, price: '80000000000' };
const listing = { ...nft, listingId: 'listing-1', seller: alice, operator, price: '100000000000' };

function block(height, events, { hash = `block-${height}`, parentHash = height === 1 ? 'mock-genesis' : `block-${height - 1}`, transactionId = `tx-${height}` } = {}) {
  return {
    height, hash, parentHash,
    events: events.map(([type, data], eventIndex) => ({ type, data, eventIndex, transactionId, blockHeight: height, finalized: true })),
  };
}

const seed = block(1, [
  ['collectionCreated', collection],
  ['tokenMinted', { ...nft, owner: alice }],
  ['approvalUpdated', { ...nft, owner: alice, operator, approved: true }],
]);
const listingBlock = block(2, [['listingCreated', listing]]);
const offerBlock = block(3, [['offerCreated', offer]]);
const sale = { ...listing, buyer: bob, fee: '2000000000', royalty: '5000000000', proceeds: '93000000000', feeRecipient: 'treasury', royaltyRecipient: 'creator' };

function projectedIndex() {
  const index = createMarketplaceIndex();
  index.replay([seed, listingBlock, offerBlock]);
  return index;
}

function atTip({ height = 3, hash = 'block-3', tokens = [{ ...nft, owner: alice, approvedOperators: [operator] }], listings = [listing], offers = [{ ...offer, escrow: offer.price }] } = {}) {
  return { checkpoint: { height, hash }, tokens, listings, offers };
}

test('replays, deduplicates identical logs and blocks, and isolates callers from snapshots', async () => {
  const index = createMarketplaceIndex({ marketplaceOperator: operator });
  const copy = structuredClone(seed);
  copy.events.splice(1, 0, structuredClone(copy.events[0]));
  const before = index.replay([copy, listingBlock, offerBlock]);
  assert.equal(before.collections.length, 1);
  assert.equal(before.listings[0].status, 'active');
  assert.equal(before.offers[0].escrow, offer.price);
  assert.equal(before.reconciliation.status, 'unverified');
  assert.deepEqual(before.actionableListings, []);
  assert.deepEqual(before.actionableOffers, []);
  const verified = await index.reconcile(async (tip) => {
    assert.deepEqual(tip, { height: 3, hash: 'block-3' });
    return atTip();
  });
  assert.equal(verified.reconciliation.status, 'verified');
  assert.equal(verified.actionableListings.length, 1);
  assert.equal(verified.actionableOffers.length, 1);
  assert.deepEqual(index.append(seed), verified);
  verified.tokens[0].owner = 'spoof';
  assert.equal(index.snapshot().tokens[0].owner, alice);
});

test('requires a contiguous canonical branch and rejects nonfinal, conflicting and duplicate logs atomically', () => {
  const index = projectedIndex();
  const before = index.snapshot();
  const invalid = [
    [block(5, []), /does not extend/],
    [block(3, []), /conflicts/],
    [block(4, [], { hash: 'block-2' }), /Duplicate block hash/],
    [block(4, [['offerCreated', offer]], { transactionId: 'tx-3' }), /already indexed/],
    [block(4, [['saleSettled', { ...sale, proceeds: '1' }]]), /payouts/],
    [{ ...block(4, []), finalized: false }, /not canonical/],
    [{ ...block(4, []), events: [{ ...seed.events[0], blockHeight: 4, finalized: false }] }, /not finalized/],
  ];
  for (const [candidate, error] of invalid) {
    assert.throws(() => index.append(candidate), error);
    assert.deepEqual(index.snapshot(), before);
  }
  const conflict = structuredClone(seed);
  conflict.events.splice(1, 0, { ...conflict.events[0], data: { ...collection, creator: bob } });
  assert.throws(() => index.replay([conflict]), /Conflicting duplicate event/);
  assert.deepEqual(index.snapshot(), before);
  const [event] = block(4, [['offerCreated', offer]], { transactionId: 'tx-3' }).events;
  assert.throws(() => index.append({ ...block(4, []), events: [{ ...event, eventIndex: 5 }] }), /already indexed/);
  assert.throws(() => index.replaceBranch('orphaned-parent', []), /Unknown canonical ancestor/);
});

test('explicit reorg replaces a settled branch, restores ownership and invalidates stale orders on direct transfer', async () => {
  const index = projectedIndex();
  const settled = index.append(block(4, [['saleSettled', sale]]));
  assert.equal(settled.tokens[0].owner, bob);
  assert.equal(settled.listings[0].status, 'filled');
  assert.equal(settled.offers[0].status, 'invalidated');
  assert.equal(settled.offers[0].escrow, offer.price);
  assert.equal(settled.sales[0].transactionId, 'tx-4');
  assert.deepEqual(settled.tokens[0].approvedOperators, []);
  await index.reconcile(async () => atTip({
    height: 4, hash: 'block-4', tokens: [{ ...nft, owner: bob, approvedOperators: [] }], listings: [], offers: [],
  }));

  const newBlock = block(4, [['tokenTransferred', { ...nft, from: alice, to: 'carol' }]], { hash: 'replacement' });
  assert.throws(() => index.append(newBlock), /Replace the branch explicitly/);
  const replaced = index.replaceBranch('block-3', [newBlock]);
  assert.equal(replaced.tokens[0].owner, 'carol');
  assert.equal(replaced.sales.length, 0);
  assert.equal(replaced.listings[0].reason, 'ownership-changed');
  assert.equal(replaced.offers[0].status, 'invalidated');
  assert.equal(replaced.offers[0].escrow, offer.price);
  assert.equal(replaced.reconciliation.status, 'unverified');
  const canceled = index.append(block(5, [['offerCanceled', { ...offer, reason: 'transferred', refund: offer.price }]], { parentHash: 'replacement' }));
  assert.equal(canceled.offers[0].status, 'canceled');
  assert.equal(canceled.offers[0].escrow, '0');
  const rewind = index.replaceBranch('block-3', []);
  assert.equal(rewind.tokens[0].owner, alice);
  assert.equal(rewind.listings[0].status, 'active');
  assert.equal(rewind.offers[0].escrow, offer.price);
  assert.deepEqual(rewind.actionableListings, []);
  assert.deepEqual(rewind.actionableOffers, []);
});

test('approval revocation invalidates the listing and keeps an escrowed offer nonactionable', async () => {
  const index = projectedIndex();
  index.append(block(4, [
    ['approvalUpdated', { ...nft, owner: alice, operator, approved: false }],
    ['listingCanceled', listing],
  ]));
  const snapshot = await index.reconcile(async () => atTip({
    height: 4, hash: 'block-4', tokens: [{ ...nft, owner: alice, approvedOperators: [] }], listings: [],
  }));
  assert.equal(snapshot.listings[0].status, 'canceled');
  assert.equal(snapshot.listings[0].reason, 'approval-revoked');
  assert.equal(snapshot.offers[0].escrow, offer.price);
  assert.equal(snapshot.reconciliation.status, 'verified');
  assert.deepEqual(snapshot.actionableOffers, []);
  assert.throws(() => index.append(block(5, [['saleSettled', {
    ...offer, fee: '1000000000', royalty: '4000000000', proceeds: '75000000000', feeRecipient: 'treasury', royaltyRecipient: 'creator',
  }]])), /approval/);
});

test('reconciliation fails closed when owner, terms, escrow or checkpoint differ', async () => {
  const index = projectedIndex();
  const mismatch = await index.reconcile(async () => atTip({
    tokens: [{ ...nft, owner: bob, approvedOperators: [] }],
    listings: [{ ...listing, price: '5' }],
    offers: [{ ...offer, escrow: '0' }],
  }));
  assert.equal(mismatch.reconciliation.status, 'mismatch');
  assert.deepEqual(mismatch.reconciliation.mismatches.map(({ record, reason }) => [record, reason]),
    [['token', 'different'], ['listing', 'different'], ['offer', 'different']]);
  assert.equal(mismatch.tokens[0].owner, alice);
  assert.deepEqual(mismatch.actionableOffers, []);
  assert.deepEqual(mismatch.actionableListings, []);

  assert.equal((await index.reconcile(async () => atTip({ hash: 'orphan' }))).reconciliation.status, 'unavailable');
  assert.equal((await index.reconcile(async () => { throw new Error('RPC failed'); })).reconciliation.status, 'unavailable');
  assert.equal((await index.reconcile(async () => atTip())).reconciliation.status, 'verified');
});

test('an in-flight authority result cannot mark a newer block or later reconciliation verified', async () => {
  const index = projectedIndex();
  let finish;
  const earlier = index.reconcile(() => new Promise((resolve) => { finish = resolve; }));
  assert.equal(index.snapshot().reconciliation.status, 'checking');
  index.append(block(4, []));
  finish(atTip());
  assert.equal((await earlier).reconciliation.status, 'unverified');

  const pending = index.reconcile(() => new Promise((resolve) => { finish = resolve; }));
  const latter = await index.reconcile(async () => atTip({ height: 4, hash: 'block-4', listings: [] }));
  finish(atTip({ height: 4, hash: 'block-4' }));
  assert.equal(latter.reconciliation.status, 'mismatch');
  assert.equal((await pending).reconciliation.status, 'mismatch');
});

test('rejects unexpected marketplace operators and keeps exact base units beyond JavaScript integer range', () => {
  const index = createMarketplaceIndex({ marketplaceOperator: operator });
  index.append(seed);
  assert.throws(() => index.append(block(2, [['listingCreated', { ...listing, operator: 'unknown' }]])), /unexpected marketplace operator/);
  const huge = '999999999999999999999999999999999999';
  index.append(block(2, [['listingCreated', { ...listing, price: huge }]]));
  const settled = index.append(block(3, [['saleSettled', {
    ...sale, price: huge, fee: '0', royalty: '1', proceeds: '999999999999999999999999999999999998',
  }]]));
  assert.equal(settled.sales[0].price, huge);
});

test('replays real mock gateway blocks, reconciles independently, and rolls back a replaced settlement', async () => {
  const gateway = createMockChainGateway({ balances: { [bob]: '1000000000000' } });
  const index = createMarketplaceIndex({ marketplaceOperator: gateway.capabilities().operator });
  const metadata = { uri: 'https://example.com/collection.json', sha256: 'a'.repeat(64) };
  let request = 0;
  function send(intent, decision = 'approve') {
    const prepared = gateway.prepare({
      ...intent,
      network: gateway.network.network,
      idempotencyKey: `index-parity-${++request}`,
    });
    return gateway.submit(prepared, { transactionId: prepared.id, account: intent.account, decision });
  }

  const setup = [
    { kind: 'createCollection', account: alice, ...collection, name: 'Parity Collection', symbol: 'PAR', metadata },
    { kind: 'mint', account: alice, ...nft, owner: alice, metadata },
    { kind: 'approve', account: alice, ...nft, operator, approved: true },
    { kind: 'list', account: alice, ...listing },
    { kind: 'offer', account: bob, ...offer },
  ];
  const blocks = setup.map((intent) => {
    const receipt = send(intent);
    assert.equal(receipt.status, 'finalized');
    assert.deepEqual(receipt.block, gateway.getBlock(receipt.block.height));
    return receipt.block;
  });
  const beforeSale = gateway.getSnapshot();
  index.replay(blocks);
  const verifiedBefore = await index.reconcile(() => gateway.getSnapshot());
  assert.equal(verifiedBefore.reconciliation.status, 'verified');
  assert.equal(verifiedBefore.actionableListings.length, 1);
  assert.equal(verifiedBefore.actionableOffers.length, 1);

  const saleIntent = { kind: 'settle', account: alice, orderType: 'offer', orderId: offer.offerId, expectedPrice: offer.price };
  assert.equal(send(saleIntent, 'reject').status, 'failed');
  assert.deepEqual(gateway.getSnapshot(), beforeSale);
  const receipt = send(saleIntent);
  assert.equal(receipt.status, 'finalized');
  const settled = index.append(receipt.block);
  assert.equal(settled.reconciliation.status, 'unverified');
  assert.equal(settled.tokens[0].owner, bob);
  assert.equal(settled.listings[0].status, 'canceled');
  assert.equal(settled.offers[0].status, 'filled');
  assert.equal(settled.sales[0].price, offer.price);
  const verified = await index.reconcile(() => gateway.getSnapshot());
  assert.equal(verified.reconciliation.status, 'verified');
  assert.deepEqual(index.append(receipt.block), verified);

  const rollback = index.replaceBranch(beforeSale.checkpoint.hash, []);
  assert.equal(rollback.tokens[0].owner, alice);
  assert.equal(rollback.sales.length, 0);
  assert.equal(rollback.offers[0].escrow, offer.price);
  assert.equal((await index.reconcile(() => gateway.getSnapshot())).reconciliation.status, 'unavailable');
  assert.equal((await index.reconcile(() => beforeSale)).reconciliation.status, 'verified');
});
