import assert from 'node:assert/strict';
import test from 'node:test';
import { createState, loadState, lockedBalance, parseAmount, transition } from '../dist/demo-market.js';

function apply(state, action) {
  const result = transition(state, action, 1000);
  assert.equal(result.error, undefined);
  return result.state;
}

function connect(state, wallet) {
  return apply(state, { type: 'connect', wallet });
}

function assertRejected(state, action, error) {
  const snapshot = structuredClone(state);
  const result = transition(state, action, 1000);
  assert.match(result.error, error);
  assert.equal(result.state, state);
  assert.deepEqual(result.state, snapshot);
}

test('parses exact positive SNRG amounts without rounding or exponent notation', () => {
  for (const [input, expected] of [['.01', 1], [' 0.1 ', 10], ['12.34', 1234], ['1000000.00', 100000000]]) {
    assert.equal(parseAmount(input), expected);
  }
  for (const input of ['', '0', '0.001', '1e3', '+2', '-2', 'NaN', '1,000', '1000000.01', 1]) {
    assert.equal(parseAmount(input), null);
  }
});

test('migrates saved items, ownership, listing, balance, connection and history from v1', () => {
  const legacy = {
    saved: [1, 1, 2, 100],
    connected: true,
    balance: 150000,
    owned: { 1: null, 2: 71234, 9: 100 },
    events: [{ id: 1, type: 'Purchased', amount: 48000, time: 500 }],
  };
  const state = loadState(null, JSON.stringify(legacy));
  assert.equal(state.activeWallet, 'collector');
  assert.deepEqual(state.wallets.collector, { balance: 150000, saved: [1, 2] });
  assert.deepEqual(state.positions[1], { owner: 'collector', price: null });
  assert.deepEqual(state.positions[2], { owner: 'collector', price: 71234 });
  assert.deepEqual(state.positions[3], { owner: 'catalog', price: 39000 });
  assert.deepEqual(state.events[0], { ...legacy.events[0], wallet: 'collector' });
  assert.deepEqual(loadState(JSON.stringify(state), JSON.stringify(legacy)), state);
});

test('saved items remain private to each demo wallet and default to Collector when signed out', () => {
  const initial = createState();
  let state = apply(initial, { type: 'save', itemId: 1 });
  assert.deepEqual(initial.wallets.collector.saved, []);
  state = connect(state, 'trader');
  state = apply(state, { type: 'save', itemId: 2 });
  state = apply(state, { type: 'disconnect' });
  assert.equal(state.activeWallet, null);
  assert.deepEqual(state.wallets.collector.saved, [1]);
  assert.deepEqual(state.wallets.trader.saved, [2]);
});

test('escrows offer funds, permits withdrawal, and only lets the seller decline', () => {
  let state = connect(createState(), 'collector');
  state = apply(state, { type: 'buy', itemId: 1, amount: 48000 });
  state = connect(state, 'trader');
  state = apply(state, { type: 'offer', itemId: 1, amount: 12345 });
  const firstOffer = state.offers[0];
  assert.equal(state.wallets.trader.balance, 237655);
  assert.equal(lockedBalance(state, 'trader'), 12345);
  assertRejected(state, { type: 'offer', itemId: 1, amount: 10 }, /existing offer/);
  assertRejected(state, { type: 'decline', offerId: firstOffer.id }, /seller/);
  assertRejected(state, { type: 'accept', offerId: firstOffer.id }, /seller/);
  assertRejected(state, { type: 'resolve-catalog-offer', offerId: firstOffer.id }, /requires a decision/);
  state = apply(state, { type: 'withdraw', offerId: firstOffer.id });
  assert.equal(state.wallets.trader.balance, 250000);
  assert.equal(lockedBalance(state, 'trader'), 0);
  state = apply(state, { type: 'offer', itemId: 1, amount: 10000 });
  const secondOffer = state.offers[0];
  assert.ok(secondOffer.id > firstOffer.id);
  state = connect(state, 'collector');
  assertRejected(state, { type: 'withdraw', offerId: secondOffer.id }, /buyer/);
  state = apply(state, { type: 'decline', offerId: secondOffer.id });
  assert.equal(state.wallets.trader.balance, 250000);
  assert.equal(state.events[0].type, 'Offer declined');
});

test('a wallet seller accepts a funded offer and transfers the NFT exactly once', () => {
  let state = connect(createState(), 'collector');
  state = apply(state, { type: 'buy', itemId: 2, amount: 26000 });
  state = apply(state, { type: 'list', itemId: 2, amount: 42000 });
  state = connect(state, 'trader');
  state = apply(state, { type: 'offer', itemId: 2, amount: 40001 });
  const { id } = state.offers[0];
  state = connect(state, 'collector');
  state = apply(state, { type: 'accept', offerId: id });
  assert.deepEqual(state.positions[2], { owner: 'trader', price: null });
  assert.equal(state.wallets.collector.balance, 264001);
  assert.equal(state.wallets.trader.balance, 209999);
  assert.equal(state.offers.length, 0);
  assert.equal(state.events[0].wallet, 'collector');
  assert.equal(state.events[0].counterparty, 'trader');
  assertRejected(state, { type: 'accept', offerId: id }, /no longer available/);
  assert.deepEqual(loadState(JSON.stringify(state)), state);
});

test('catalog acceptance refunds a competing bidder and requires the current offer buyer', () => {
  let state = connect(createState(), 'collector');
  state = apply(state, { type: 'offer', itemId: 1, amount: 20000 });
  const { id } = state.offers[0];
  state = connect(state, 'trader');
  state = apply(state, { type: 'offer', itemId: 1, amount: 50000 });
  assertRejected(state, { type: 'resolve-catalog-offer', offerId: id }, /requires a decision/);
  state = connect(state, 'collector');
  state = apply(state, { type: 'resolve-catalog-offer', offerId: id });
  assert.equal(state.wallets.collector.balance, 230000);
  assert.equal(state.wallets.trader.balance, 250000);
  assert.deepEqual(state.positions[1], { owner: 'collector', price: null });
  assert.equal(state.events[0].type, 'Offer accepted');
  assert.equal(state.events[1].type, 'Offer refunded');
  assert.deepEqual(state.offers, []);
});

test('resale reviews current price, refunds a buyer’s same-item escrow and credits the seller', () => {
  let state = connect(createState(), 'collector');
  state = apply(state, { type: 'buy', itemId: 2, amount: 26000 });
  state = apply(state, { type: 'list', itemId: 2, amount: 200000 });
  state = apply(state, { type: 'delist', itemId: 2 });
  state = connect(state, 'trader');
  assertRejected(state, { type: 'buy', itemId: 2, amount: 200000 }, /listing changed/);
  state = apply(state, { type: 'offer', itemId: 2, amount: 180000 });
  assertRejected(state, { type: 'offer', itemId: 1, amount: 70001 }, /insufficient funds/);
  state = connect(state, 'collector');
  state = apply(state, { type: 'list', itemId: 2, amount: 200000 });
  state = apply(state, { type: 'list', itemId: 2, amount: 200001 });
  assert.equal(state.events[0].type, 'Listing updated');
  state = connect(state, 'trader');
  assertRejected(state, { type: 'buy', itemId: 2, amount: 200000 }, /listing changed/);
  state = apply(state, { type: 'buy', itemId: 2, amount: 200001 });
  assert.deepEqual(state.positions[2], { owner: 'trader', price: null });
  assert.equal(state.wallets.collector.balance, 424001);
  assert.equal(state.wallets.trader.balance, 49999);
  assert.equal(state.offers.length, 0);
  assert.deepEqual(loadState(JSON.stringify(state)), state);
});

test('a stale review cannot commit against a switched wallet, a new seller or an updated listing', () => {
  let state = connect(createState(), 'collector');
  state = apply(state, { type: 'buy', itemId: 2, amount: 26000, wallet: 'collector', seller: 'catalog' });
  state = apply(state, { type: 'list', itemId: 2, amount: 26000, expectedPrice: null });
  assertRejected(state, { type: 'delist', itemId: 2, expectedPrice: null }, /listing changed/);
  state = connect(state, 'trader');
  assertRejected(state, { type: 'buy', itemId: 2, amount: 26000, wallet: 'collector' }, /wallet changed/);
  assertRejected(state, { type: 'buy', itemId: 2, amount: 26000, seller: 'catalog' }, /owner changed/);
  assertRejected(state, { type: 'offer', itemId: 2, amount: 10000, seller: 'catalog' }, /owner changed/);
});
