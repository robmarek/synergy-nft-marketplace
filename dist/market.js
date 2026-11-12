import { collections, featured, items } from './catalog.js';

const iconPaths = {
  heart: '<path d="M20.8 8.6c0 4.5-8.8 9.8-8.8 9.8s-8.8-5.3-8.8-9.8a4.6 4.6 0 0 1 8.8-1.9 4.6 4.6 0 0 1 8.8 1.9Z"/>',
  wallet: '<path d="M20 8H6a2 2 0 0 1 0-4h12v4M4 6v12a2 2 0 0 0 2 2h14V8M20 12h-5a2 2 0 1 0 0 4h5"/><path d="M15 14h.01"/>',
  'arrow-up-right': '<path d="M7 17 17 7M7 7h10v10"/>',
  grid: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
  gamepad: '<path d="M7 7h10a4 4 0 0 1 4 3.4l.8 4.4a2.9 2.9 0 0 1-4.8 2.6L14.6 15H9.4L7 17.4a2.9 2.9 0 0 1-4.8-2.6l.8-4.4A4 4 0 0 1 7 7Z"/><path d="M6.5 11.5h4m-2-2v4m7.5-2h.01m2.5 2h.01"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m3 16 4.5-4.5 3 3 3.7-4 6.8 7"/><path d="M8 8h.01"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4 4"/>',
  sort: '<path d="M7 5v14m-3-3 3 3 3-3m4-10h6m-6 5h4m-4 5h2"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  left: '<path d="m12 6-6 6 6 6m-6-6h13"/>',
  activity: '<path d="M3 12h4l3-6 4 12 3-6h4"/>',
};

function icon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${iconPaths[name]}</svg>`;
}

document.querySelectorAll('[data-icon]').forEach((element) => {
  element.innerHTML = icon(element.dataset.icon);
});

const market = document.getElementById('market');
const hero = document.getElementById('hero');
const heading = document.getElementById('market-heading');
const description = document.getElementById('market-description');
const toolbar = document.getElementById('toolbar');
const results = document.getElementById('view-content');
const status = document.getElementById('view-status');
const search = document.getElementById('search');
const sort = document.getElementById('sort');
const filters = Array.from(document.querySelectorAll('[data-category]'));
const nav = Array.from(document.querySelectorAll('[data-view]'));
const savedButton = document.querySelector('.header-saved');
const walletLabel = document.getElementById('wallet-label');
const dialog = document.getElementById('modal');
const dialogContent = document.getElementById('modal-content');
const toast = document.getElementById('toast');
const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const catalog = new Map(items.map((item) => [item.id, item]));
const maxListing = 1000000;
const storageKey = 'synergy-nft-marketplace-v1';
let storageAvailable = true;
let state = readState();
let category = 'All NFTs';
let query = '';
let order = 'featured';
let currentView = 'explore';
let modalItem = null;
let returnFocus = null;
let returnAction = null;
let toastTimer;

function defaults() {
  return { saved: [], connected: false, balance: 250000, owned: {}, events: [] };
}

function readState() {
  const initial = defaults();
  try {
    const data = JSON.parse(localStorage.getItem(storageKey));
    if (!data || typeof data !== 'object') return initial;
    if (Array.isArray(data.saved)) initial.saved = [...new Set(data.saved.filter((id) => catalog.has(id)))];
    initial.connected = data.connected === true;
    if (Number.isSafeInteger(data.balance) && data.balance >= 0 && data.balance <= 250000) initial.balance = data.balance;
    for (const item of items) {
      const value = data.owned?.[item.id];
      if (value === null || (Number.isSafeInteger(value) && value > 0 && value <= maxListing * 100)) initial.owned[item.id] = value;
    }
    if (Array.isArray(data.events)) {
      initial.events = data.events.filter((event) =>
        event && catalog.has(event.id) && ['Purchased', 'Listed', 'Listing canceled'].includes(event.type)
        && (event.amount === null || (Number.isSafeInteger(event.amount) && event.amount > 0 && event.amount <= maxListing * 100))
        && Number.isSafeInteger(event.time) && event.time > 0 && event.time <= 8640000000000000
      ).slice(0, 60);
    }
  } catch (error) {
    if (error.name !== 'SyntaxError') storageAvailable = false;
  }
  return initial;
}

function refreshState() {
  if (storageAvailable) state = readState();
}

function persist() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    storageAvailable = false;
  }
}

function notify(message) {
  toast.textContent = message + (storageAvailable ? '' : ' Changes are kept for this session.');
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3500);
}

function slug(name) {
  return name.toLowerCase().replaceAll(' ', '-');
}

function collectionHash(name) {
  return 'collection-' + slug(name);
}

function route() {
  const hash = location.hash.slice(1);
  const collection = collections.find(({ name }) => collectionHash(name) === hash);
  if (collection) return { view: 'collection', collection };
  return { view: ['collections', 'activity', 'saved', 'owned'].includes(hash) ? hash : 'explore' };
}

function navigate(hash) {
  if (location.hash === '#' + hash) {
    if (hash === 'explore') window.scrollTo(0, 0);
    else market.scrollIntoView({ block: 'start' });
    return;
  }
  location.hash = hash;
}

function owned(item) {
  return Object.hasOwn(state.owned, item.id);
}

function price(item) {
  return owned(item) ? state.owned[item.id] : item.price * 100;
}

function amount(cents) {
  return `<span class="amount">${numberFormat.format(cents / 100)} <span>SNRG</span></span>`;
}

function buttonIcon(name) {
  return `<span class="icon">${icon(name)}</span>`;
}

function card(item) {
  const saved = state.saved.includes(item.id);
  const listingPrice = price(item);
  return `
    <article class="card">
      <button type="button" class="card-open" data-action="detail" data-id="${item.id}" aria-label="View ${item.name}">
        <img class="card-art" src="${item.image}" alt="" width="512" height="512">
        <span class="card-info">
          <span class="card-kicker">${item.collection}</span>
          <span class="card-name">${item.name}</span>
          <span class="card-bottom">
            <span class="card-price"><small>${owned(item) ? (listingPrice === null ? 'Owned' : 'Your listing') : 'Sample price'}</small>
              ${listingPrice === null ? '<strong class="amount">In demo wallet</strong>' : amount(listingPrice)}</span>
            <span class="card-category">${item.category}</span>
          </span>
        </span>
      </button>
      <button type="button" class="icon-button card-save" data-action="save" data-id="${item.id}" aria-pressed="${saved}" aria-label="Save ${item.name}" title="Save ${item.name}">${buttonIcon('heart')}</button>
    </article>`;
}

function collectionCard(collection) {
  const members = items.filter((item) => item.collection === collection.name);
  const image = collection.name === featured.name ? featured.image : members[0].image;
  const itemLabel = members.length === 1 ? 'item' : 'items';
  return `
    <article class="card">
      <a class="card-open" href="#${collectionHash(collection.name)}">
        <img class="card-art" src="${image}" alt="">
        <span class="card-info"><span class="card-kicker">${collection.category}</span><span class="card-name">${collection.name}</span>
        <span class="card-bottom"><span class="card-category">${members.length} ${itemLabel}</span>${buttonIcon('arrow-up-right')}</span></span>
      </a>
    </article>`;
}

function empty(iconName, title, text, action = '') {
  return `<div class="empty">${buttonIcon(iconName)}<h3>${title}</h3><p>${text}</p>${action}</div>`;
}

function grid(content, extraClass = '') {
  return `<div class="grid ${extraClass}">${content.join('')}</div>`;
}

function matches(item) {
  return (category === 'All NFTs' || category === item.category)
    && [item.name, item.collection, item.category].some((value) => value.toLowerCase().includes(query));
}

function renderItems(list) {
  const visible = list.filter(matches);
  const byPrice = (item) => price(item) ?? item.price * 100;
  if (order === 'low') visible.sort((a, b) => byPrice(a) - byPrice(b));
  if (order === 'high') visible.sort((a, b) => byPrice(b) - byPrice(a));
  if (order === 'new') visible.sort((a, b) => b.id - a.id);
  status.textContent = `${visible.length} ${visible.length === 1 ? 'NFT' : 'NFTs'} shown.`;
  if (visible.length) return grid(visible.map(card));
  const clear = '<button class="button" data-action="clear" type="button">Clear filters</button>';
  return empty('search', 'No matching NFTs', 'Try a different search or category.', clear);
}

function activityTable() {
  if (!state.events.length) return empty('activity', 'No demo activity yet', 'Demo purchases and listings will appear here.', '<a class="button" href="#explore">Explore NFTs</a>');
  return `<div class="activity-table"><table>
    <thead><tr><th scope="col">Event</th><th scope="col">NFT</th><th scope="col">Amount</th><th scope="col">Time</th></tr></thead>
    <tbody>${state.events.map((event) => {
      const item = catalog.get(event.id);
      return `<tr><td>${event.type}</td><td><div class="activity-item"><img src="${item.image}" alt="">${item.name}</div></td>
        <td>${event.amount === null ? '—' : amount(event.amount)}</td><td class="activity-time">${timeFormat.format(event.time)}</td></tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

function updateHeader(view) {
  for (const link of nav) {
    const active = link.dataset.view === view || (view === 'collection' && link.dataset.view === 'collections');
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  savedButton.setAttribute('aria-pressed', String(view === 'saved'));
  walletLabel.textContent = state.connected ? 'Demo Wallet' : 'Connect Wallet';
}

function render() {
  const { view, collection } = route();
  currentView = view;
  updateHeader(view);
  hero.hidden = view !== 'explore';
  toolbar.hidden = !['explore', 'collection'].includes(view);
  status.textContent = '';
  for (const filter of filters) filter.setAttribute('aria-pressed', String(filter.dataset.category === category));
  search.value = search.value.trim().toLowerCase() === query ? search.value : query;
  sort.value = order;

  if (view === 'collections') {
    heading.textContent = 'Collections';
    description.textContent = 'Explore the collections in the marketplace preview.';
    results.innerHTML = grid(collections.map(collectionCard), 'collections-grid');
    return;
  }
  if (view === 'activity') {
    heading.textContent = 'Activity';
    description.textContent = 'Track demo purchases and listings on this device.';
    results.innerHTML = activityTable();
    return;
  }
  if (view === 'saved' || view === 'owned') {
    const saved = view === 'saved';
    const selected = items.filter((item) => saved ? state.saved.includes(item.id) : owned(item));
    heading.textContent = saved ? 'Saved NFTs' : 'My Demo NFTs';
    description.textContent = saved ? 'Find the NFTs you’ve saved on this device.' : 'Manage the NFTs in your demo wallet.';
    results.innerHTML = selected.length ? grid(selected.map(card)) : empty(
      saved ? 'heart' : 'wallet',
      saved ? 'No saved NFTs yet' : 'Your demo wallet is empty',
      saved ? 'Save an NFT to come back to it later.' : 'Try a demo purchase to add an NFT to your wallet.',
      '<a class="button" href="#explore">Explore NFTs</a>'
    );
    return;
  }
  heading.textContent = collection?.name ?? 'Explore NFTs';
  description.textContent = collection?.description ?? 'Discover digital art, game assets, and collectibles on Synergy.';
  const back = collection ? `<a class="button back-button" href="#collections">${buttonIcon('left')} All collections</a>` : '';
  results.innerHTML = back + renderItems(collection ? items.filter((item) => item.collection === collection.name) : items);
}

function showModal(content, { item = null, narrow = false } = {}) {
  modalItem = item;
  if (!dialog.open) {
    returnFocus = document.activeElement;
    returnAction = returnFocus?.dataset.action;
  }
  dialog.classList.toggle('narrow', narrow);
  dialogContent.innerHTML = content;
  if (!dialog.open) dialog.showModal();
  dialog.querySelector('.modal-close').focus();
}

function showDetail(item) {
  const isOwned = owned(item);
  const listingPrice = price(item);
  let action = '<button class="button primary" type="button" data-action="buy-review">Demo buy</button>';
  if (isOwned) action = listingPrice === null
    ? '<button class="button primary" type="button" data-action="list-review">List in demo</button>'
    : '<button class="button" type="button" data-action="cancel-listing">Cancel demo listing</button>';
  showModal(`
    <div class="modal-asset">
      <img class="modal-art" src="${item.image}" alt="">
      <div class="modal-inner">
        <div class="card-kicker">${item.collection} · ${item.category}</div>
        <h2 id="dialog-title">${item.name}</h2>
        <p>${item.description}</p>
        <div class="modal-pricing"><div><small>Edition</small><div>${item.edition}</div></div>
        <div><small>${isOwned ? 'Demo wallet' : 'Sample price'}</small><div>${listingPrice === null ? 'Owned' : amount(listingPrice)}</div></div></div>
        <p class="modal-label">Sample NFT · Simulated SNRG</p>
        <div class="modal-actions">${action}<button class="button" type="button" data-action="save" data-id="${item.id}">${state.saved.includes(item.id) ? 'Remove from saved' : 'Save NFT'}</button></div>
      </div>
    </div>`, { item });
}

function showWallet() {
  const content = state.connected
    ? `<p>Your demo wallet and its activity are stored in this browser.</p>
       <div class="wallet-summary"><span>Demo balance</span>${amount(state.balance)}</div>
       <div class="modal-actions"><button class="button primary" data-action="owned" type="button">My Demo NFTs</button>
       <button class="button" type="button" data-action="disconnect">Disconnect</button></div>`
    : `<p>Try buying and listing sample NFTs with a demo wallet. It uses simulated SNRG and sends no blockchain transactions.</p>
       <div class="modal-actions"><button class="button primary" data-action="connect" type="button">Connect demo wallet</button></div>`;
  showModal(`<div class="modal-inner"><h2 id="dialog-title">${state.connected ? 'Demo Wallet' : 'Connect Wallet'}</h2>${content}</div>`, { narrow: true });
}

function reviewBuy(item) {
  if (owned(item)) return showDetail(item);
  const cost = price(item);
  if (!state.connected) {
    showModal(`<div class="modal-inner"><h2 id="dialog-title">Connect demo wallet</h2>
      <p>A demo wallet lets you try buying ${item.name} using simulated SNRG.</p>
      <div class="modal-actions"><button class="button primary" data-action="connect-for-item" type="button">Connect demo wallet</button>
      <button class="button" data-action="back-to-item" type="button">Back</button></div></div>`, { item, narrow: true });
    return;
  }
  const canAfford = state.balance >= cost;
  showModal(`<div class="modal-inner"><h2 id="dialog-title">Review demo purchase</h2>
    <p>Add ${item.name} to your demo wallet. This uses simulated SNRG.</p>
    <div class="wallet-summary"><span>Purchase price</span>${amount(cost)}</div>
    <div class="wallet-summary"><span>Demo balance</span>${amount(state.balance)}</div>
    ${canAfford ? '' : '<p>Your demo balance is below the purchase price.</p>'}
    <div class="modal-actions"><button class="button primary" data-action="buy-confirm" type="button" ${canAfford ? '' : 'disabled'}>Confirm demo purchase</button>
    <button class="button" data-action="back-to-item" type="button">Back</button></div></div>`, { item, narrow: true });
}

function record(item, type, cents) {
  state.events = [{ id: item.id, type, amount: cents, time: Date.now() }, ...state.events].slice(0, 60);
  persist();
  dialog.close();
  render();
}

function buy(item) {
  refreshState();
  if (!state.connected || owned(item) || state.balance < price(item)) return reviewBuy(item);
  const cost = price(item);
  state.balance -= cost;
  state.owned[item.id] = null;
  record(item, 'Purchased', cost);
  notify(`${item.name} added to your demo wallet.`);
}

function reviewListing(item) {
  if (!state.connected || !owned(item) || price(item) !== null) return showDetail(item);
  showModal(`<div class="modal-inner"><h2 id="dialog-title">List ${item.name}</h2>
    <p>Set a simulated SNRG price for your demo listing.</p>
    <form class="listing-form" id="listing-form">
      <label>Listing price (SNRG)<input name="amount" type="number" min=".01" max="${maxListing}" step=".01" required inputmode="decimal"></label>
      <div class="modal-actions"><button class="button primary" type="submit">Publish demo listing</button><button class="button" data-action="back-to-item" type="button">Back</button></div>
    </form></div>`, { item, narrow: true });
  dialog.querySelector('input').focus();
}

function saveItem(item, source) {
  refreshState();
  const alreadySaved = state.saved.includes(item.id);
  state.saved = alreadySaved ? state.saved.filter((id) => id !== item.id) : [...state.saved, item.id];
  persist();
  if (currentView === 'saved') {
    render();
    if (source && !dialog.open) (results.querySelector('.card-save') ?? savedButton).focus();
  } else {
    const cardButton = results.querySelector(`[data-action="save"][data-id="${item.id}"]`);
    cardButton?.setAttribute('aria-pressed', String(!alreadySaved));
  }
  if (dialog.open) dialog.querySelector('[data-action="save"]').textContent = alreadySaved ? 'Save NFT' : 'Remove from saved';
  notify(alreadySaved ? 'Removed from saved NFTs.' : 'Saved to your NFTs.');
}

function clearFilters() {
  category = 'All NFTs';
  query = '';
  search.value = '';
  order = 'featured';
}

document.addEventListener('click', (event) => {
  const control = event.target.closest('[data-action], [data-category]');
  if (!control) return;
  if (control.dataset.category) {
    category = control.dataset.category;
    render();
    return;
  }
  const item = catalog.get(Number(control.dataset.id)) ?? modalItem;
  switch (control.dataset.action) {
    case 'saved': navigate('saved'); break;
    case 'featured': navigate(collectionHash(featured.name)); break;
    case 'clear': clearFilters(); render(); search.focus(); break;
    case 'close': dialog.close(); break;
    case 'wallet': refreshState(); showWallet(); break;
    case 'detail': refreshState(); showDetail(item); break;
    case 'save': saveItem(item, control); break;
    case 'back-to-item': showDetail(item); break;
    case 'owned': dialog.close(); navigate('owned'); break;
    case 'connect':
    case 'connect-for-item':
      refreshState();
      state.connected = true;
      persist();
      updateHeader(currentView);
      if (item) reviewBuy(item);
      else showWallet();
      break;
    case 'disconnect':
      refreshState();
      state.connected = false;
      persist();
      updateHeader(currentView);
      dialog.close();
      notify('Demo wallet disconnected.');
      break;
    case 'buy-review': refreshState(); reviewBuy(item); break;
    case 'buy-confirm': buy(item); break;
    case 'list-review':
      refreshState();
      if (!state.connected) showWallet();
      else reviewListing(item);
      break;
    case 'cancel-listing':
      refreshState();
      if (!state.connected) showWallet();
      else if (owned(item) && price(item) !== null) {
        const cents = price(item);
        state.owned[item.id] = null;
        record(item, 'Listing canceled', cents);
        notify('Demo listing canceled.');
      } else showDetail(item);
      break;
  }
});

dialog.addEventListener('submit', (event) => {
  if (event.target.id !== 'listing-form') return;
  event.preventDefault();
  const cents = Math.round(event.target.elements.amount.valueAsNumber * 100);
  const item = modalItem;
  refreshState();
  if (!state.connected || !owned(item) || price(item) !== null) return showDetail(item);
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > maxListing * 100) return;
  state.owned[item.id] = cents;
  record(item, 'Listed', cents);
  notify(`${item.name} listed in the demo marketplace.`);
});

dialog.addEventListener('click', (event) => {
  if (event.target === dialog) {
    const { left, top, right, bottom } = dialog.getBoundingClientRect();
    if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) dialog.close();
  }
});

dialog.addEventListener('close', () => {
  if (dialog.open) return;
  const replacement = modalItem && results.querySelector(`[data-action="detail"][data-id="${modalItem.id}"]`);
  if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  else if (replacement) replacement.focus({ preventScroll: true });
  else if (returnAction === 'wallet') document.querySelector('[data-action="wallet"]').focus({ preventScroll: true });
  modalItem = null;
  returnFocus = null;
  returnAction = null;
});

search.addEventListener('input', () => {
  query = search.value.trim().toLowerCase();
  render();
});
sort.addEventListener('change', () => {
  order = sort.value;
  render();
});
window.addEventListener('hashchange', () => {
  if (location.hash === '#market') return;
  clearFilters();
  render();
  window.scrollTo(0, 0);
});
window.addEventListener('storage', (event) => {
  if (event.key !== storageKey && event.key !== null) return;
  refreshState();
  render();
});

render();
