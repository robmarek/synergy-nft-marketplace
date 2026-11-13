import { TESTNET_V3, isTestnetWalletChain, verifyTestnet } from './wallet-network.js';

const walletLifetimeMs = 15 * 60_000;
const walletCheckIntervalMs = 30_000;
const accountPattern = /^synw(?:[a-fA-F0-9]{40}|1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{36})$/;

function firstNativeAccount(accounts) {
  const account = Array.isArray(accounts) ? accounts[0] : undefined;
  return typeof account === 'string' ? account : account?.synergyAddress ?? account?.address;
}

function readApprovedWallet(provider, signal) {
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(8_000)]);
  return new Promise((resolve, reject) => {
    const canceled = () => reject(requestSignal.reason);
    requestSignal.addEventListener('abort', canceled, { once: true });
    Promise.all([
      Promise.resolve().then(() => provider.request({ method: 'synergy_chainId' })),
      Promise.resolve().then(() => provider.request({ method: 'synergy_accounts' })),
    ]).then(resolve, reject).finally(() => requestSignal.removeEventListener('abort', canceled));
  });
}

export function createWalletSession({ publish, disconnect, verify = verifyTestnet, now = Date.now }) {
  let active;
  let disposed = false;

  function emit(status, message, session = null) {
    if (!disposed) publish({ status, message, session });
  }

  function clear() {
    const previous = active;
    active = undefined;
    previous?.controller.abort();
    clearTimeout(previous?.expiry);
    clearTimeout(previous?.check);
    previous?.unsubscribe?.();
    return previous;
  }

  function invalidate(message, status = 'error') {
    if (!clear()) return;
    emit(status, message);
    void Promise.resolve().then(disconnect).catch(() => {
      if (!active) emit('error', 'The local connection ended. Check Synergy Wallet to revoke any remaining site permissions.');
    });
  }

  async function observe(connection) {
    if (disposed) return;
    if (!connection) {
      if (clear()) emit('disconnected', 'Wallet disconnected, expired, or changed. Connect again to continue.');
      return;
    }
    if (active && active.connection.provider === connection.provider
      && active.connection.address === connection.address && active.connection.chainId === connection.chainId
      && active.connection.walletId === connection.walletId) return;
    if (active) {
      invalidate('Your wallet account or network changed. Connect again to continue.');
      return;
    }

    const entry = { connection: { ...connection }, controller: new AbortController() };
    active = entry;
    const { signal } = entry.controller;
    emit('verifying', 'Verifying the approved wallet and Synergy Testnet v3…');
    try {
      const { address, chainId, family, walletId, provider } = connection;
      if (family !== 'synergy' || !isTestnetWalletChain(chainId)) {
        throw new Error('Connect a wallet on Synergy Testnet v3 (chain 1266).');
      }
      if (typeof address !== 'string' || !accountPattern.test(address)) {
        throw new Error('Synergy Wallet returned an unsupported account address.');
      }
      if (walletId !== 'synergy-browser' || typeof provider?.request !== 'function'
        || typeof provider?.on !== 'function' || typeof provider?.removeListener !== 'function'
        || typeof connection.subscribe !== 'function') {
        throw new Error('This wallet cannot provide the required read-only session and change notifications.');
      }

      const changed = 'The approved wallet account or network changed. Connect again to continue.';
      const subscriptions = {
        accountsChanged: (accounts) => {
          if (firstNativeAccount(accounts) !== address) invalidate(changed);
        },
        chainChanged: (walletChain) => {
          if (!isTestnetWalletChain(walletChain)) invalidate(changed);
        },
        disconnect: () => invalidate('Wallet disconnected. Connect again to continue.', 'disconnected'),
      };
      const listeners = Object.entries(subscriptions);
      entry.unsubscribe = () => {
        for (const [event, listener] of listeners) provider.removeListener(event, listener);
      };
      for (const [event, listener] of listeners) provider.on(event, listener);

      await verify(undefined, signal);
      signal.throwIfAborted();
      async function verifyAccount() {
        const [walletChain, accounts] = await readApprovedWallet(provider, signal)
          .catch(() => { throw new Error('Synergy Wallet could not verify the approved account.'); });
        if (!isTestnetWalletChain(walletChain) || firstNativeAccount(accounts) !== address) {
          throw new Error(changed);
        }
      }

      await verifyAccount();
      if (active !== entry) return;

      const expiresAt = now() + walletLifetimeMs;
      function checkAgain() {
        entry.check = setTimeout(async () => {
          if (active !== entry) return;
          try {
            await verifyAccount();
            if (active === entry) checkAgain();
          } catch (error) {
            if (active === entry) invalidate(error.message);
          }
        }, walletCheckIntervalMs);
        entry.check.unref?.();
      }
      checkAgain();
      entry.expiry = setTimeout(() => {
        if (active === entry) invalidate('The read-only session expired. Connect again to continue.', 'disconnected');
      }, walletLifetimeMs);
      entry.expiry.unref?.();
      emit('connected', 'Read-only connection verified on Synergy Testnet v3.', Object.freeze({
        address,
        chainId: TESTNET_V3.chainId,
        network: TESTNET_V3.network,
        walletName: 'Synergy Browser Wallet',
        access: 'read-only',
        expiresAt,
      }));
    } catch (error) {
      if (active === entry) invalidate(error.message);
    }
  }

  return { observe, dispose: () => { disposed = true; clear(); } };
}
