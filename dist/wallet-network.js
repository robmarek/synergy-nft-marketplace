export const TESTNET_V3 = Object.freeze({
  name: 'Synergy Testnet v3',
  chainId: 1266,
  walletChainId: 'synergy:1266',
  network: 'synergy:testnet-v3',
  runtimeSlug: 'synergy-testnet-v3',
  rpcUrl: 'https://testnet-core-rpc.synergy-network.io',
  pairingUrl: 'https://synergy-network.io/api/wallet-pairing',
});

export function isTestnetRpcChain(value) {
  return value === TESTNET_V3.chainId || value === String(TESTNET_V3.chainId)
    || (typeof value === 'string' && /^0x4f2$/i.test(value));
}

export function isTestnetWalletChain(value) {
  return value === TESTNET_V3.walletChainId || isTestnetRpcChain(value);
}

export async function verifyTestnet(fetcher = fetch, signal) {
  const timeout = AbortSignal.timeout(8_000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const id = 'synergy-marketplace-chain';
  let payload;
  try {
    const response = await fetcher(TESTNET_V3.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method: 'synergy_getChainId', params: [] }),
      signal: requestSignal,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
    });
    if (!response.ok) throw new Error('RPC request failed');
    payload = await response.json();
  } catch {
    signal?.throwIfAborted();
    throw new Error('The official Synergy Testnet RPC is unavailable. Try again when the network service is reachable.');
  }
  signal?.throwIfAborted();
  if (payload?.jsonrpc !== '2.0' || payload.id !== id || payload.error || !Object.hasOwn(payload, 'result')) {
    throw new Error('The official Synergy Testnet RPC did not return a chain ID. Try again when the network service is reachable.');
  }
  if (!isTestnetRpcChain(payload.result)) {
    throw new Error('The official RPC did not identify itself as Synergy Testnet v3.');
  }
  return TESTNET_V3;
}
