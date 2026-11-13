const walletPage = 'https://synergy-network.io/ecosystem/wallet';
const connector = new URL('./wallet-connector/wallet.js', import.meta.url);
const stylesheet = new URL('./wallet-connector/wallet.css', import.meta.url);

export function mountSynergyWallet(element, onState = () => {}) {
  if (!(element instanceof HTMLElement)) return () => {};

  let disposed = false;
  let unmount;
  const css = document.createElement('link');
  const styleReady = new Promise((resolve, reject) => {
    css.addEventListener('load', resolve, { once: true });
    css.addEventListener('error', reject, { once: true });
  });

  function fallback(status, message) {
    const text = document.createElement('p');
    text.textContent = message;
    element.replaceChildren(text);
    if (status === 'unavailable') {
      const link = document.createElement('a');
      link.href = walletPage;
      link.textContent = 'Visit Synergy Wallet';
      element.append(link);
    }
    onState({ status, message, session: null });
  }

  fallback('loading', 'Loading Synergy Wallet…');
  css.rel = 'stylesheet';
  css.href = stylesheet.href;
  document.head.append(css);
  Promise.all([import(connector.href), styleReady]).then(([module]) => {
    if (!disposed) unmount = module.mountWallet(element, onState);
  }).catch(() => {
    css.remove();
    if (!disposed) fallback('unavailable', 'Synergy Wallet connection is unavailable in this deployment.');
  });

  return () => {
    disposed = true;
    unmount?.();
    css.remove();
    element.replaceChildren();
  };
}
