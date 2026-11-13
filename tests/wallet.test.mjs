import assert from 'node:assert/strict';
import test from 'node:test';
import { createWalletSession } from '../dist/wallet-read-session.js';
import { TESTNET_V3, isTestnetRpcChain, isTestnetWalletChain, verifyTestnet } from '../dist/wallet-network.js';

const address = 'synw1234567890AbcdEF1234567890AbcdEF12345678';
const wait = () => new Promise((resolve) => setImmediate(resolve));

function approvedWallet(options = {}) {
  return {
    walletId: 'synergy-browser', family: 'synergy', address, chainId: 'synergy:1266', subscribe() {},
    provider: { request: async ({ method }) => method === 'synergy_accounts' ? [{ synergyAddress: address }] : '0x4f2', on() {}, removeListener() {} },
    ...options,
  };
}

function sessionFixture(verify = async () => TESTNET_V3) {
  const views = [];
  const disconnections = [];
  const session = createWalletSession({ publish: (view) => views.push(view), disconnect: () => disconnections.push(true), verify });
  return { views, session, disconnections };
}

test('canonical IDs are checked in the appropriate context', () => {
  assert.equal(TESTNET_V3.network, 'synergy:testnet-v3');
  assert.equal(TESTNET_V3.runtimeSlug, 'synergy-testnet-v3');
  for (const value of [1266, '1266', '0x4f2', '0x4F2']) assert.equal(isTestnetRpcChain(value), true);
  for (const value of ['synergy:1266', 'synergy:testnet-v3', 'eip155:1266', '1266.0', 1264, null]) assert.equal(isTestnetRpcChain(value), false);
  assert.equal(isTestnetWalletChain('synergy:1266'), true);
  assert.equal(isTestnetWalletChain('synergy:testnet-v3'), false);
});

test('network verification only accepts a matching read from the pinned RPC', async () => {
  const read = (reply) => async (url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(url, TESTNET_V3.rpcUrl);
    assert.equal(body.method, 'synergy_getChainId');
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: body.id, ...reply }) };
  };
  assert.equal(await verifyTestnet(read({ result: '0x4f2' })), TESTNET_V3);
  await assert.rejects(verifyTestnet(read({ result: 1264 })), /did not identify/);
  await assert.rejects(verifyTestnet(read({ result: 1266, id: 2 })), /did not return/);
  await assert.rejects(verifyTestnet(read({ error: { code: -32001 } })), /did not return/);
  await assert.rejects(verifyTestnet(async () => { throw new TypeError('Network unavailable'); }), /RPC is unavailable/);
});

test('approved wallet publishes public identity only and clears on account change', async () => {
  const { session, views, disconnections } = sessionFixture();
  const wallet = approvedWallet();
  await session.observe(wallet);
  assert.equal(views.at(-1).status, 'connected');
  assert.deepEqual(Object.keys(views.at(-1).session), ['address', 'chainId', 'network', 'walletName', 'access', 'expiresAt']);
  assert.equal(views.at(-1).session.access, 'read-only');
  await session.observe({ ...wallet });
  assert.equal(views.at(-1).status, 'connected');
  await session.observe({ ...wallet, address: 'synw' + '1'.repeat(40) });
  assert.equal(views.at(-1).session, null);
  assert.match(views.at(-1).message, /account or network changed/);
  assert.equal(disconnections.length, 1);
  session.dispose();
});

test('wrong chain or a provider account mismatch is never connected', async () => {
  for (const wallet of [
    approvedWallet({ chainId: 'eip155:1266' }),
    approvedWallet({ provider: { ...approvedWallet().provider, request: async () => '0x4f2' } }),
    approvedWallet({ provider: { ...approvedWallet().provider, on: undefined } }),
    approvedWallet({ address: '<invalid>' }),
  ]) {
    const { session, views, disconnections } = sessionFixture();
    await session.observe(wallet);
    assert.equal(views.at(-1).status, 'error');
    assert.equal(views.at(-1).session, null);
    assert.equal(disconnections.length, 1);
    session.dispose();
  }
});

test('disconnect notifications clear a previously verified wallet', async () => {
  const { session, views } = sessionFixture();
  await session.observe(approvedWallet());
  await session.observe(null);
  assert.equal(views.at(-1).status, 'disconnected');
  assert.equal(views.at(-1).session, null);
  session.dispose();
});

test('provider events clear session and unsubscribe even without a changed connector object', async () => {
  for (const [event, value] of [['accountsChanged', []], ['chainChanged', '0x4f0'], ['disconnect', null]]) {
    const { session, views, disconnections } = sessionFixture();
    const listeners = new Map();
    const wallet = approvedWallet({ provider: {
      ...approvedWallet().provider,
      on: (name, listener) => listeners.set(name, listener),
      removeListener: (name, listener) => { if (listeners.get(name) === listener) listeners.delete(name); },
    } });
    await session.observe(wallet);
    assert.equal(listeners.size, 3);
    listeners.get('accountsChanged')([address]);
    listeners.get('chainChanged')('0x4f2');
    assert.equal(views.at(-1).status, 'connected');
    listeners.get(event)(value);
    assert.equal(views.at(-1).session, null);
    assert.equal(listeners.size, 0);
    await wait();
    assert.equal(disconnections.length, 1);
    session.dispose();
  }
});

test('account polling clears approval when a wallet fails to emit a change notification', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const { session, views, disconnections } = sessionFixture();
  const wallet = approvedWallet();
  await session.observe(wallet);
  wallet.provider.request = async ({ method }) => method === 'synergy_accounts' ? [] : '0x4f2';
  context.mock.timers.tick(30_000);
  await wait();
  assert.equal(views.at(-1).status, 'error');
  assert.equal(views.at(-1).session, null);
  assert.equal(disconnections.length, 1);
  session.dispose();
});

test('verification cannot revive a wallet after a disconnect or disposal', async () => {
  for (const dispose of [false, true]) {
    let resolve;
    const rpc = new Promise((complete) => { resolve = complete; });
    const { session, views } = sessionFixture(() => rpc);
    const pending = session.observe(approvedWallet());
    if (dispose) session.dispose();
    else await session.observe(null);
    resolve(TESTNET_V3);
    await pending;
    assert.equal(views.some(({ status }) => status === 'connected'), false);
  }
});

test('session expires and clears identity even if the wallet remains approved', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const { session, views, disconnections } = sessionFixture();
  await session.observe(approvedWallet());
  assert.equal(views.at(-1).status, 'connected');
  context.mock.timers.tick(15 * 60_000);
  await wait();
  assert.equal(views.at(-1).status, 'disconnected');
  assert.equal(views.at(-1).session, null);
  assert.equal(disconnections.length, 1);
  session.dispose();
});
