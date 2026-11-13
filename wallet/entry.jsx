import React, { useLayoutEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createWalletConfig, SynergyWalletProvider, useSynergyWallet, WalletButton,
} from '@synergy-network/wallet-react';
import '@synergy-network/wallet-react/styles.css';
import { TESTNET_V3 } from './wallet-network.js';
import { createWalletSession } from './wallet-read-session.js';

function WalletAccount({ publish }) {
  const { connection, disconnect, error } = useSynergyWallet();
  const [view, setView] = useState({
    status: 'disconnected',
    message: 'Connect for read-only access to your Testnet v3 address. Mobile pairing is currently unavailable.',
    session: null,
  });
  const session = useMemo(() => createWalletSession({ publish: setView, disconnect }), [disconnect]);
  const visibleView = error && view.status !== 'verifying' && !connection
    ? { status: 'error', message: 'The wallet could not complete this request. Open Synergy Wallet to retry or check site permissions.', session: null }
    : view;

  useLayoutEffect(() => () => session.dispose(), [session]);
  useLayoutEffect(() => { void session.observe(connection); }, [connection, session]);
  useLayoutEffect(() => {
    publish(visibleView);
  }, [publish, visibleView]);

  return <>
    <span style={{ visibility: view.status === 'verifying' ? 'hidden' : undefined }}>
      <WalletButton label="Connect Synergy Wallet" color="lime" networks="synergy-only" hiddenWallets={['synergy-mobile']} />
    </span>
    <p role="status">{visibleView.message}</p>
    {visibleView.session && <p><strong>Address</strong> <span>{visibleView.session.address}</span></p>}
  </>;
}

export function mountWallet(element, publish) {
  const config = createWalletConfig({
    VITE_SYW_APP_NAME: 'Synergy NFT Marketplace',
    VITE_SYW_APP_DESCRIPTION: 'Read-only wallet connection for Synergy NFT Marketplace',
    VITE_SYW_APP_URL: window.location.origin,
    VITE_SYW_APP_ICON_URL: new URL('assets/synergy-mark.png', document.baseURI).href,
    VITE_SYW_NETWORKS: 'synergy-only',
    VITE_SYW_SYNERGY_CHAIN_ID: String(TESTNET_V3.chainId),
    VITE_SYW_SYNERGY_CHAIN_NAME: TESTNET_V3.name,
    VITE_SYW_SYNERGY_SLUG: TESTNET_V3.runtimeSlug,
    VITE_SYW_SYNERGY_RPC_URL: TESTNET_V3.rpcUrl,
    VITE_SYW_PAIRING_URL: TESTNET_V3.pairingUrl,
  });
  element.replaceChildren();
  const root = createRoot(element);
  root.render(<SynergyWalletProvider config={config}><WalletAccount publish={publish} /></SynergyWalletProvider>);
  return () => root.unmount();
}
