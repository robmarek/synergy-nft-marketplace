import assert from 'node:assert/strict';
import test from 'node:test';
import { createLiveChainGateway, createMockChainGateway, LIVE_TRADING_ENABLED } from '../dist/chain-gateway.js';

const network = 'synergy:testnet-v3';
const token = { collectionId: 'relics', tokenId: '1' };
const metadata = { uri: 'https://example.com/relics.json', sha256: 'a'.repeat(64) };
const balances = { bob: '20000', carol: '20000' };

function request(gateway, kind, account, fields, idempotencyKey = kind + '-' + account) {
  return gateway.prepare({ kind, account, network, idempotencyKey, ...fields });
}

function submit(gateway, prepared, decision = 'approve', account = prepared.intent.account) {
  return gateway.submit(prepared, { transactionId: prepared.id, account, decision });
}

function finalize(gateway, kind, account, fields, idempotencyKey) {
  const receipt = submit(gateway, request(gateway, kind, account, fields, idempotencyKey));
  assert.equal(receipt.status, 'finalized', receipt.message);
  return receipt;
}

function setup(gateway) {
  finalize(gateway, 'createCollection', 'creator', {
    collectionId: token.collectionId, name: 'Relics', symbol: 'RLC', metadata,
    royaltyBps: 500, royaltyRecipient: 'creator',
  });
  finalize(gateway, 'mint', 'creator', { ...token, owner: 'alice', metadata });
  finalize(gateway, 'approve', 'alice', { ...token, operator: gateway.capabilities().operator, approved: true });
  return gateway;
}

function list(gateway, price = '10000', id = 'listing-1') {
  return finalize(gateway, 'list', 'alice', { ...token, listingId: id, price }, id);
}

function offer(gateway, account = 'bob', price = '8000', id = 'offer-1') {
  return finalize(gateway, 'offer', account, { ...token, offerId: id, seller: 'alice', price }, id);
}

test('mock collection and metadata remain immutable and returned blocks are detached', () => {
  const gateway = setup(createMockChainGateway());
  const collection = gateway.getCollection(token.collectionId);
  collection.metadata.sha256 = 'b'.repeat(64);
  assert.deepEqual(gateway.getCollection(token.collectionId).metadata, metadata);
  const block = gateway.getBlock(1);
  block.events[0].data.name = 'changed';
  assert.equal(gateway.getBlock(1).events[0].data.name, 'Relics');
  assert.equal(block.parentHash, 'mock-genesis');
  assert.equal(gateway.getBlock(2).parentHash, block.hash);
  assert.equal(gateway.getToken(token.collectionId, token.tokenId).owner, 'alice');
  assert.throws(() => request(gateway, 'mint', 'creator', {
    ...token, owner: 'alice', metadata: { ...metadata, uri: 'data:text/html,test' },
  }, 'bad-metadata'), { code: 'invalid_metadata' });
  assert.throws(() => request(gateway, 'list', 'alice', { ...token, listingId: 'bad', price: 1000 }),
    { code: 'invalid_amount' });
});

test('preparation checks network and binds approval to the reviewed account and request', () => {
  const gateway = setup(createMockChainGateway());
  assert.throws(() => request(gateway, 'transfer', 'alice', { ...token, recipient: 'bob', network: 'synergy:1266' }),
    { code: 'wrong_network' });
  const prepared = request(gateway, 'transfer', 'alice', { ...token, recipient: 'bob' });
  assert.throws(() => gateway.submit(prepared), { code: 'approval_required' });
  assert.throws(() => submit(gateway, prepared, 'approve', 'bob'), { code: 'approval_required' });
  const altered = structuredClone(prepared);
  altered.review.account = 'bob';
  assert.throws(() => submit(gateway, altered), { code: 'unknown_transaction' });
  const rejected = submit(gateway, prepared, 'reject');
  assert.equal(rejected.status, 'failed');
  assert.equal(rejected.code, 'rejected');
  assert.deepEqual(submit(gateway, prepared), rejected);
  assert.equal(gateway.getToken(token.collectionId, token.tokenId).owner, 'alice');
});

test('mock approval expires before first submission', () => {
  let time = 1000;
  const gateway = setup(createMockChainGateway({ now: () => time }));
  const prepared = request(gateway, 'transfer', 'alice', { ...token, recipient: 'bob' });
  time = prepared.expiresAt;
  assert.throws(() => submit(gateway, prepared), { code: 'approval_expired' });
  assert.equal(gateway.getReceipt(prepared.id), null);
});

test('delayed submissions stay pending and duplicate idempotency keys settle only once', () => {
  let time = 1000;
  const gateway = setup(createMockChainGateway({ now: () => time, delayMs: 500, balances,
    scenario: ({ kind }) => kind === 'settle' ? 'delayed' : 'success' }));
  list(gateway);
  const requestFields = { orderType: 'listing', orderId: 'listing-1', expectedPrice: '10000' };
  const prepared = request(gateway, 'settle', 'bob', requestFields);
  assert.deepEqual(request(gateway, 'settle', 'bob', requestFields), prepared);
  assert.throws(() => request(gateway, 'settle', 'bob', { ...requestFields, expectedPrice: '9999' }),
    { code: 'idempotency_conflict' });
  const pending = submit(gateway, prepared);
  assert.equal(pending.status, 'pending');
  assert.equal(pending.block, undefined);
  assert.deepEqual(submit(gateway, prepared), pending);
  assert.equal(gateway.getToken(token.collectionId, token.tokenId).owner, 'alice');
  time += 500;
  const receipt = gateway.getReceipt(prepared.id);
  assert.equal(receipt.status, 'finalized');
  assert.deepEqual(submit(gateway, prepared), receipt);
  assert.equal(gateway.getBalance('bob'), '10000');
  assert.equal(gateway.getBalance('alice'), '9250');
  assert.equal(gateway.getBalance('creator'), '500');
  assert.equal(gateway.getBalance('mock-fee-recipient'), '250');
  assert.equal(receipt.block.events[0].type, 'saleSettled');
  assert.equal(gateway.getBlock(receipt.block.height + 1), null);
});

test('concurrent listing purchase and offer acceptance cannot both transfer the same NFT', () => {
  let time = 2000;
  const gateway = setup(createMockChainGateway({ now: () => time, balances, delayMs: 10,
    scenario: ({ kind }) => kind === 'settle' ? 'delayed' : 'success' }));
  list(gateway);
  offer(gateway, 'carol');
  const purchase = request(gateway, 'settle', 'bob', {
    orderType: 'listing', orderId: 'listing-1', expectedPrice: '10000',
  });
  const accept = request(gateway, 'settle', 'alice', {
    orderType: 'offer', orderId: 'offer-1', expectedPrice: '8000',
  });
  submit(gateway, purchase);
  submit(gateway, accept);
  time += 10;
  const receipt = gateway.getReceipt(purchase.id);
  assert.equal(receipt.status, 'finalized');
  assert.deepEqual(receipt.block.events.map(({ type }) => type), ['offerCanceled', 'saleSettled']);
  assert.equal(receipt.block.events[0].data.refund, '8000');
  assert.equal(gateway.getReceipt(accept.id).code, 'order_unavailable');
  assert.equal(gateway.getToken(token.collectionId, token.tokenId).owner, 'bob');
  assert.equal(gateway.getBalance('carol'), '20000');
  assert.equal(gateway.getSnapshot().offers.length, 0);
});

test('accepted escrow pays seller, fee and royalty while competing offers are refunded', () => {
  const gateway = setup(createMockChainGateway({ balances }));
  list(gateway);
  offer(gateway);
  offer(gateway, 'carol', '7500', 'offer-2');
  const prepared = request(gateway, 'settle', 'alice', {
    orderType: 'offer', orderId: 'offer-1', expectedPrice: '8000',
  });
  assert.deepEqual(prepared.review.settlement, {
    ...token, seller: 'alice', buyer: 'bob', price: '8000', fee: '200', royalty: '400', proceeds: '7400',
    feeRecipient: 'mock-fee-recipient', royaltyRecipient: 'creator',
  });
  const receipt = submit(gateway, prepared);
  assert.equal(receipt.status, 'finalized');
  assert.deepEqual(receipt.block.events.map(({ type }) => type), ['listingCanceled', 'offerCanceled', 'saleSettled']);
  assert.equal(gateway.getBalance('bob'), '12000');
  assert.equal(gateway.getBalance('carol'), '20000');
  assert.equal(gateway.getBalance('alice'), '7400');
  assert.equal(gateway.getBalance('creator'), '400');
  assert.equal(gateway.getBalance('mock-fee-recipient'), '200');
  assert.deepEqual(gateway.getSnapshot().listings, []);
  assert.deepEqual(gateway.getSnapshot().offers, []);
  assert.deepEqual(gateway.getToken(token.collectionId, token.tokenId).approvals, []);
});

test('canceling an offer refunds escrow once, and revoked approval invalidates a listing', () => {
  const gateway = setup(createMockChainGateway({ balances }));
  list(gateway);
  offer(gateway);
  assert.equal(gateway.getBalance('bob'), '12000');
  const cancel = request(gateway, 'cancelOffer', 'bob', { offerId: 'offer-1' });
  assert.equal(submit(gateway, cancel).status, 'finalized');
  assert.equal(submit(gateway, cancel).status, 'finalized');
  assert.equal(gateway.getBalance('bob'), '20000');

  offer(gateway, 'carol', '7500', 'offer-2');
  const revoked = finalize(gateway, 'approve', 'alice', {
    ...token, operator: gateway.capabilities().operator, approved: false,
  }, 'revoke');
  assert.deepEqual(revoked.block.events.map(({ type }) => type), ['approvalUpdated', 'listingCanceled']);
  assert.equal(gateway.getSnapshot().listings.length, 0);
  assert.equal(gateway.getSnapshot().offers[0].escrow, '7500');
  const blocked = request(gateway, 'settle', 'alice', {
    orderType: 'offer', orderId: 'offer-2', expectedPrice: '7500',
  });
  assert.equal(submit(gateway, blocked).code, 'approval_required');
  const transfer = finalize(gateway, 'transfer', 'alice', { ...token, recipient: 'bob' });
  assert.deepEqual(transfer.block.events.map(({ type }) => type), ['offerCanceled', 'tokenTransferred']);
  assert.equal(gateway.getBalance('carol'), '20000');
});

test('revert and changed royalty leave ownership, orders and balances intact', () => {
  const reverted = setup(createMockChainGateway({ balances, delayMs: 0,
    scenario: ({ kind }) => kind === 'settle' ? 'reverted' : 'success' }));
  list(reverted);
  const fields = { orderType: 'listing', orderId: 'listing-1', expectedPrice: '10000' };
  const receipt = submit(reverted, request(reverted, 'settle', 'bob', fields));
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.code, 'reverted');
  assert.equal(receipt.block, undefined);
  assert.equal(reverted.getBalance('bob'), '20000');
  assert.equal(reverted.getSnapshot().listings.length, 1);

  const changed = setup(createMockChainGateway({ balances }));
  list(changed);
  const pendingApproval = request(changed, 'settle', 'bob', fields);
  finalize(changed, 'setRoyalty', 'creator', {
    collectionId: token.collectionId, royaltyRecipient: 'creator', royaltyBps: 700,
  });
  assert.equal(submit(changed, pendingApproval).code, 'terms_changed');
  assert.equal(changed.getToken(token.collectionId, token.tokenId).owner, 'alice');
  assert.equal(changed.getBalance('bob'), '20000');
  assert.equal(changed.getSnapshot().listings.length, 1);
});

test('live adapter stays disabled even with a transport or supplied release data', async () => {
  const call = () => assert.fail('Live transport was invoked.');
  const live = createLiveChainGateway({
    deployment: { network, chainId: 1266 },
    transport: { verifyNetwork: call, prepare: call, sign: call, submitSigned: call },
  });
  assert.equal(LIVE_TRADING_ENABLED, false);
  assert.equal(live.capabilities().canSettleLive, false);
  await assert.rejects(live.prepare({ kind: 'mint' }), { code: 'live_disabled' });
  await assert.rejects(live.getBalance('alice'), { code: 'live_disabled' });
  await assert.rejects(live.getSnapshot(), { code: 'live_disabled' });
});
