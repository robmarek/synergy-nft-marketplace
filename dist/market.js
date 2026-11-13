import { catalogIntegrity } from './catalog-integrity.js';
import {
  communityKey, creators, dropKinds, itemTraits, rarities, readCommunity, reportKinds, sha256, verifyItemIntegrity,
} from './community.js';
import { renderCommunity, renderCreatorProfile, renderItemTraits, renderReportForm, renderStudio } from './community-view.js';
import { collections, featured, items } from './catalog.js';
import { renderCollections, renderCollectionSummary } from './collection-view.js';
import {
  createState, legacyStorageKey, loadState, lockedBalance, maxListing, parseAmount, storageKey, transition, wallets,
} from './demo-market.js';

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
  exchange: '<path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4"/>',
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
const summary = document.getElementById('collection-summary');
const toolbar = document.getElementById('toolbar');
const results = document.getElementById('view-content');
const status = document.getElementById('view-status');
const search = document.getElementById('search');
const sort = document.getElementById('sort');
const listingStatus = document.getElementById('listing-status');
const rarityFilter = document.getElementById('rarity');
const walletPanel = document.getElementById('wallet-panel');
const walletStatus = document.getElementById('network-wallet-status');
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
const views = new Set(['collections', 'activity', 'saved', 'owned', 'offers', 'wallet', 'community', 'studio', 'transaction-preview']);
const defaultWallet = wallets[0].id;
let storageAvailable = true;
let state = createState();
let category = 'All NFTs';
let query = '';
let order = 'featured';
let availability = 'all';
let rarity = 'all';
let community = readCommunity(null, items);
let walletMounted = false;
let matchingAlerts = new Set();
let transactionRun = null;

for (const option of rarities) rarityFilter.add(new Option(option, option));
let currentRoute = { view: 'explore' };
let currentView = 'explore';
let modalItem = null;
let modalWallet = null;
let returnFocus = null;
let toastTimer;
let actionPending = false;

function refreshState() {
  if (!storageAvailable) return;
  try {
    state = loadState(localStorage.getItem(storageKey), localStorage.getItem(legacyStorageKey));
    community = readCommunity(localStorage.getItem(communityKey), items);
  } catch {
    storageAvailable = false;
  }
}

function notify(message) {
  toast.textContent = message + (storageAvailable ? '' : ' Changes are kept for this session.');
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 4000);
}

function showError(message) {
  const output = dialog.open ? dialogContent.querySelector('.form-error') : null;
  if (output) {
    output.textContent = message;
    output.hidden = false;
  } else notify(message);
}

async function commit(action, expectedWallet = state.activeWallet) {
  if (actionPending) return false;
  actionPending = true;
  const persist = () => {
    refreshState();
    if (state.activeWallet !== expectedWallet) {
      render();
      showError('The active demo wallet changed. Reopen this action and try again.');
      return false;
    }
    const result = transition(state, action);
    if (result.error) {
      showError(result.error);
      return false;
    }
    state = result.state;
    if (storageAvailable) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(state));
      } catch {
        storageAvailable = false;
      }
    }
    return true;
  };
  try {
    if (navigator.locks && storageAvailable) return await navigator.locks.request(storageKey, persist);
    return persist();
  } catch {
    showError('The demo action could not be saved. Try again.');
    return false;
  } finally {
    actionPending = false;
  }
}

function collectionHash(name) {
  return 'collection-' + name.toLowerCase().replaceAll(' ', '-');
}

function route() {
  const hash = location.hash.slice(1);
  if (hash === 'market') return currentRoute;
  const collection = collections.find(({ name }) => collectionHash(name) === hash);
  if (collection) return { view: 'collection', collection };
  const creator = creators.find(({ id }) => 'creator-' + id === hash);
  if (creator) return { view: 'creator', creator };
  return { view: views.has(hash) ? hash : 'explore' };
}

function navigate(hash) {
  if (location.hash !== '#' + hash) location.hash = hash;
  else if (hash === 'explore') window.scrollTo(0, 0);
  else market.scrollIntoView({ block: 'start' });
}

function walletName(wallet) {
  return wallet === 'catalog' ? 'Sample catalog' : wallets.find(({ id }) => id === wallet)?.name ?? 'Demo wallet';
}

function savedItems() {
  return state.wallets[practiceWallet()].saved;
}

function practiceWallet() {
  return state.activeWallet ?? defaultWallet;
}

function hiddenItems() {
  return new Set(community.reports[practiceWallet()].filter(({ status }) => status === 'Hidden').map(({ itemId }) => itemId));
}

function alertTriggered(item) {
  const target = community.alerts[practiceWallet()][item.id];
  const { price, owner } = position(item);
  return target && price !== null && price <= target && owner !== state.activeWallet;
}

function notifyPriceAlerts() {
  const wallet = practiceWallet();
  const previous = matchingAlerts;
  const triggered = items.filter(alertTriggered);
  matchingAlerts = new Set(triggered.map(({ id }) => wallet + ':' + id));
  const newAlerts = triggered.filter(({ id }) => !previous.has(wallet + ':' + id));
  if (!newAlerts.length) return false;
  notify(newAlerts.length === 1 ? `${newAlerts[0].name} reached your practice price alert.` : `${newAlerts.length} practice price alerts matched.`);
  return true;
}

async function changeCommunity(edit, expectedWallet = practiceWallet()) {
  const persist = () => {
    refreshState();
    if (practiceWallet() !== expectedWallet) throw new Error('The active practice wallet changed. Try again.');
    edit(community, expectedWallet);
    if (storageAvailable) {
      try {
        localStorage.setItem(communityKey, JSON.stringify(community));
      } catch {
        storageAvailable = false;
      }
    }
  };
  if (navigator.locks && storageAvailable) await navigator.locks.request(storageKey, persist);
  else persist();
}

async function mountNetworkWallet() {
  if (walletMounted) return;
  walletMounted = true;
  try {
    const { mountSynergyWallet } = await import('./wallet-session.js');
    const cleanup = mountSynergyWallet(document.getElementById('synergy-wallet'));
    window.addEventListener('pagehide', (event) => {
      if (!event.persisted) cleanup?.();
    });
  } catch {
    walletStatus.hidden = false;
    walletStatus.textContent = 'Synergy Wallet is unavailable in this build. Practice mode remains available.';
  }
}

function position(item) {
  return state.positions[item.id];
}

function owned(item) {
  return position(item).owner === state.activeWallet;
}

function offerFor(item) {
  return state.offers.find((offer) => offer.itemId === item.id && offer.buyer === state.activeWallet);
}

function amount(cents) {
  return `<span class="amount">${numberFormat.format(cents / 100)} <span>SNRG</span></span>`;
}

function buttonIcon(name) {
  return `<span class="icon">${icon(name)}</span>`;
}

function card(item) {
  const saved = savedItems().includes(item.id);
  const { owner, price } = position(item);
  const isOwned = owned(item);
  const priceLabel = isOwned ? (price === null ? 'Owned' : 'Your listing') : (price === null ? 'Availability' : 'Listed price');
  return `
    <article class="card">
      <button type="button" class="card-open" data-action="detail" data-id="${item.id}" aria-label="View ${item.name}">
        <img class="card-art" src="${item.image}" alt="" width="512" height="512">
        <span class="card-info">
          <span class="card-kicker">${item.collection} · ${itemTraits(item).rarity}</span>
          <span class="card-name">${item.name}</span>
          <span class="card-bottom">
            <span class="card-price"><small>${priceLabel}</small>
              ${price === null ? `<strong class="amount">${isOwned ? 'In your wallet' : 'Unlisted'}</strong>` : amount(price)}</span>
            <span class="card-category${alertTriggered(item) ? ' alert-hit' : ''}">${alertTriggered(item) ? 'Alert matched' : item.category}</span>
          </span>
        </span>
      </button>
      <button type="button" class="icon-button card-save" data-action="save" data-id="${item.id}" aria-pressed="${saved}" aria-label="Save ${item.name}" title="Save ${item.name}">${buttonIcon('heart')}</button>
      ${owner !== 'catalog' && price !== null ? '<span class="card-listing">Resale</span>' : ''}
    </article>`;
}

function empty(iconName, title, text, action = '') {
  return `<div class="empty">${buttonIcon(iconName)}<h3>${title}</h3><p>${text}</p>${action}</div>`;
}

function grid(content) {
  return `<div class="grid">${content.join('')}</div>`;
}

function renderItems(list) {
  const visible = list.filter((item) => {
    const listed = position(item).price !== null;
    return (category === 'All NFTs' || category === item.category)
      && (rarity === 'all' || rarity === itemTraits(item).rarity)
      && (availability === 'all' || (availability === 'listed' ? listed : !listed))
      && [item.name, item.collection, item.category].some((value) => value.toLowerCase().includes(query));
  });
  if (order === 'low' || order === 'high') {
    visible.sort((a, b) => {
      const aPrice = position(a).price;
      const bPrice = position(b).price;
      if (aPrice === null) return bPrice === null ? 0 : 1;
      if (bPrice === null) return -1;
      return order === 'low' ? aPrice - bPrice : bPrice - aPrice;
    });
  }
  if (order === 'new') visible.sort((a, b) => b.id - a.id);
  status.textContent = `${visible.length} ${visible.length === 1 ? 'NFT' : 'NFTs'} shown.`;
  if (visible.length) return grid(visible.map(card));
  return empty('search', 'No matching NFTs', 'Try a different search, category, rarity, or listing status.', '<button class="button" data-action="clear" type="button">Clear filters</button>');
}

function eventHistory(events, { itemDetails = false } = {}) {
  const eventRows = events.map((event) => {
    const item = catalog.get(event.id);
    const label = event.wallet ? walletName(event.wallet) : '—';
    const itemCell = `<td><button class="activity-item text-button" data-action="detail" data-id="${item.id}" type="button"><img src="${item.image}" alt="">${item.name}</button></td>`;
    return `<tr><td>${event.type}</td>${itemDetails ? '' : itemCell}<td>${label}</td>
      <td>${event.amount === null ? '—' : amount(event.amount)}</td><td class="activity-time">${timeFormat.format(event.time)}</td></tr>`;
  });
  return `<div class="activity-table${itemDetails ? ' item-history' : ''}"><table>
    <thead><tr><th scope="col">Event</th>${itemDetails ? '' : '<th scope="col">NFT</th>'}<th scope="col">Wallet</th><th scope="col">Amount</th><th scope="col">Time</th></tr></thead>
    <tbody>${eventRows.join('')}</tbody>
  </table></div>`;
}

function offerRow(offer) {
  const item = catalog.get(offer.itemId);
  const incoming = offer.seller === state.activeWallet;
  const actions = incoming
    ? `<button class="button primary" data-action="review-offer" data-offer="${offer.id}" type="button">Review offer</button>`
    : `<button class="button" data-action="review-offer" data-offer="${offer.id}" type="button">Manage offer</button>`;
  return `<li class="offer-row">
    <button class="activity-item text-button" data-action="detail" data-id="${item.id}" type="button">
      <img src="${item.image}" alt=""><span><strong>${item.name}</strong><small>${incoming ? 'From ' + walletName(offer.buyer) : 'To ' + walletName(offer.seller)}</small></span>
    </button>
    <span class="offer-amount">${amount(offer.amount)}</span>${actions}
  </li>`;
}

function offerGroup(title, offers, emptyMessage) {
  return `<section class="offer-group"><h3>${title} <span>${offers.length}</span></h3>
    ${offers.length ? `<ul class="offer-list">${offers.map(offerRow).join('')}</ul>` : `<p>${emptyMessage}</p>`}
  </section>`;
}

function renderOffers() {
  if (!state.activeWallet) return empty('exchange', 'Choose a demo wallet', 'Connect to see offers you have sent or received.', '<button class="button primary" data-action="wallet" type="button">Choose demo wallet</button>');
  const incoming = state.offers.filter((offer) => offer.seller === state.activeWallet);
  const outgoing = state.offers.filter((offer) => offer.buyer === state.activeWallet);
  return `<div class="offer-groups">
    ${offerGroup('Received', incoming, 'Offers on your NFTs will appear here.')}
    ${offerGroup('Sent', outgoing, 'Offers you make on other NFTs will appear here.')}
  </div>`;
}

function updateHeader(view) {
  for (const link of nav) {
    const active = link.dataset.view === view || (view === 'collection' && link.dataset.view === 'collections')
      || (['creator', 'studio'].includes(view) && link.dataset.view === 'community');
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  savedButton.setAttribute('aria-pressed', String(view === 'saved'));
  walletLabel.textContent = state.activeWallet ? walletName(state.activeWallet) : 'Choose practice wallet';
}

function render() {
  currentRoute = route();
  const { view, collection, creator } = currentRoute;
  currentView = view;
  updateHeader(view);
  hero.hidden = view !== 'explore';
  toolbar.hidden = !['explore', 'collection'].includes(view);
  results.hidden = view === 'wallet';
  walletPanel.hidden = view !== 'wallet';
  summary.hidden = !collection;
  summary.innerHTML = '';
  status.textContent = '';
  for (const filter of filters) filter.setAttribute('aria-pressed', String(filter.dataset.category === category));
  sort.value = order;
  listingStatus.value = availability;
  rarityFilter.value = rarity;
  const hidden = hiddenItems();
  const discoverable = items.filter(({ id }) => !hidden.has(id));
  const collectionOptions = {
    collections, items: discoverable, featured, positions: state.positions, collectionHash,
    formatAmount: amount, icon: buttonIcon, events: state.events,
  };
  if (view === 'wallet') {
    heading.textContent = 'Wallets';
    description.textContent = 'Verify a Synergy Testnet account or trade with a practice wallet.';
    results.innerHTML = '';
    void mountNetworkWallet();
    return;
  }
  if (creator) {
    heading.textContent = creator.name;
    description.textContent = 'Collections and collectibles from this sample creator.';
    results.innerHTML = renderCreatorProfile({ creator, collections, items: discoverable, collectionHash, icon: buttonIcon });
    return;
  }
  if (view === 'community') {
    heading.textContent = 'Community';
    description.textContent = 'Explore curated collections, creator profiles, and the Synergy ecosystem.';
    results.innerHTML = renderCommunity({ collections, items: discoverable, collectionHash });
    return;
  }
  if (view === 'transaction-preview') {
    heading.textContent = 'Practice transaction';
    description.textContent = 'Review a sample sale and see how the marketplace handles approval, pending settlement, and failed receipts.';
    results.innerHTML = `<section class="community-panel transaction-preview"><h3>Simulate an NFT purchase</h3>
      <p>This preview uses mock balances and receipts. It works without a wallet.</p>
      <form class="listing-form" id="chain-preview-form">
        <label>Scenario<select name="scenario">
          <option value="success">Successful sale</option><option value="delayed">Delayed settlement</option>
          <option value="duplicated">Duplicate submission</option><option value="reverted">Reverted settlement</option>
        </select></label>
        <button class="button primary" type="submit">Review mock transaction</button>
      </form>
    </section>`;
    return;
  }
  if (view === 'studio') {
    heading.textContent = 'Creator Studio';
    description.textContent = 'Draft a drop, review practice sales, and manage local reports.';
    const wallet = practiceWallet();
    results.innerHTML = renderStudio({ data: community, wallet, items, walletName: walletName(wallet), amount, events: state.events });
    return;
  }

  if (view === 'collections') {
    heading.textContent = 'Collections';
    description.textContent = 'Browse digital art, gaming assets, and collectibles by collection.';
    results.innerHTML = renderCollections(collectionOptions);
    return;
  }
  if (view === 'activity') {
    heading.textContent = 'Activity';
    description.textContent = 'Follow simulated sales, listings, and offers across both demo wallets.';
    results.innerHTML = state.events.length ? eventHistory(state.events) : empty('activity', 'No demo activity yet', 'Demo trades and offers will appear here.', '<a class="button" href="#explore">Explore NFTs</a>');
    return;
  }
  if (view === 'offers') {
    heading.textContent = 'Offers';
    description.textContent = state.activeWallet ? `Track bids sent and received by ${walletName(state.activeWallet)}.` : 'Manage bids and review offers on NFTs you own.';
    results.innerHTML = renderOffers();
    return;
  }
  if (view === 'saved' || view === 'owned') {
    const saved = view === 'saved';
    const selected = items.filter((item) => saved ? savedItems().includes(item.id) : owned(item));
    heading.textContent = saved ? 'Saved NFTs' : 'My Demo NFTs';
    description.textContent = saved ? 'Your watchlist for this demo wallet.' : 'Manage listings for the NFTs in your demo wallet.';
    if (view === 'owned' && !state.activeWallet) {
      results.innerHTML = empty('wallet', 'Choose a demo wallet', 'Connect to manage your inventory.', '<button class="button primary" data-action="wallet" type="button">Choose demo wallet</button>');
      return;
    }
    const watchlist = saved ? renderWatchlist() : '';
    const content = selected.length ? grid(selected.map(card)) : empty(
      saved ? 'heart' : 'wallet',
      saved ? 'No saved NFTs yet' : 'Your demo wallet is empty',
      saved ? 'Save an NFT to come back to it later.' : 'Make an offer or try a demo purchase to add an NFT to your wallet.',
      '<a class="button" href="#explore">Explore NFTs</a>'
    );
    results.innerHTML = watchlist + content;
    return;
  }

  heading.textContent = collection?.name ?? 'Explore NFTs';
  description.textContent = collection?.description ?? 'Discover digital art, game assets, and collectibles on Synergy.';
  if (collection) {
    summary.innerHTML = `<a class="button back-button" href="#collections">${buttonIcon('left')} All collections</a>`
      + renderCollectionSummary({ ...collectionOptions, collection });
  }
  results.innerHTML = renderItems(collection ? discoverable.filter((item) => item.collection === collection.name) : discoverable);
}

function showModal(content, { item = null, narrow = false, focus } = {}) {
  if (!dialog.open) returnFocus = document.activeElement;
  modalItem = item;
  modalWallet = state.activeWallet;
  dialog.classList.toggle('narrow', narrow);
  dialogContent.innerHTML = content;
  if (!dialog.open) dialog.showModal();
  (focus ? dialogContent.querySelector(focus) : dialog.querySelector('.modal-close')).focus();
  dialog.scrollTop = 0;
}

function modalBody(title, content) {
  return `<div class="modal-inner"><h2 id="dialog-title">${title}</h2>${content}<p class="form-error" role="alert" hidden></p></div>`;
}

function actionButton(action, label, { primary = false, attributes = '' } = {}) {
  return `<button class="button${primary ? ' primary' : ''}" data-action="${action}" type="button" ${attributes}>${label}</button>`;
}

function priceRow(label, value) {
  return `<div class="wallet-summary"><span>${label}</span>${amount(value)}</div>`;
}

function showDetail(item) {
  const { owner, price } = position(item);
  const isOwned = owned(item);
  const offer = offerFor(item);
  const incoming = state.activeWallet && state.offers.some((candidate) => candidate.itemId === item.id && candidate.seller === state.activeWallet);
  const itemEvents = state.events.filter((event) => event.id === item.id).slice(0, 6);
  let actions = isOwned
    ? actionButton('list-review', price === null ? 'List NFT' : 'Edit listing', { primary: true })
    : price === null ? '' : actionButton('buy-review', 'Buy in demo', { primary: true });
  if (isOwned && price !== null) actions += actionButton('delist-review', 'Cancel listing');
  if (!isOwned) actions += offer
    ? actionButton('review-offer', 'Manage offer', { attributes: `data-offer="${offer.id}"` })
    : actionButton('offer-review', 'Make offer', { primary: price === null });
  if (incoming) actions += '<a class="button" href="#offers" data-action="offers">Review offers</a>';

  showModal(`
    <div class="modal-asset">
      <img class="modal-art" src="${item.image}" alt="">
      <div class="modal-inner">
        <div class="card-kicker">${item.collection} · ${item.category}</div>
        <h2 id="dialog-title">${item.name}</h2>
        <p>${item.description}</p>
        ${renderItemTraits(item)}
        <dl class="modal-pricing">
          <div><dt>Edition</dt><dd>${item.edition}</dd></div>
          <div><dt>Owner</dt><dd>${walletName(owner)}</dd></div>
          <div><dt>Listed price</dt><dd>${price === null ? 'Unlisted' : amount(price)}</dd></div>
        </dl>
        <p class="modal-label">Sample NFT · Simulated SNRG · No practice royalty</p>
        <div class="modal-actions">${actions}
          <button class="button" type="button" data-action="save" data-id="${item.id}">${savedItems().includes(item.id) ? 'Remove from saved' : 'Save NFT'}</button>
        </div>
        <div class="detail-tools">
          ${actionButton('alert-settings', 'Price alert')}
          ${actionButton('verify-media', 'Verify artwork')}
          ${actionButton('report-item', 'Report NFT')}
        </div>
        <p class="integrity-result" role="status" hidden></p>
        <p class="form-error" role="alert" hidden></p>
      </div>
    </div>
    ${itemEvents.length ? `<section class="detail-activity" aria-label="Recent NFT activity"><h3>Recent activity</h3>${eventHistory(itemEvents, { itemDetails: true })}</section>` : ''}`,
  { item });
}

function showWallet({ item = null, next = '' } = {}) {
  const active = state.activeWallet;
  const switches = wallets.map(({ id, name }) => {
    if (id === active) return `<div class="wallet-option current-wallet"><span>${name}</span><small>Active</small></div>`;
    return `<button class="button wallet-option" data-action="connect" data-wallet="${id}" data-next="${next}" type="button">
      <span>${name}</span><small>${active ? 'Switch' : 'Connect'}</small></button>`;
  }).join('');
  const balance = active
    ? `<div class="balance-summary">${priceRow('Available balance', state.wallets[active].balance)}
       ${priceRow('Reserved for offers', lockedBalance(state, active))}</div>`
    : '';
  const manage = active
    ? `<div class="modal-actions wallet-management">
        ${actionButton('owned', 'My Demo NFTs', { primary: true })}
        ${actionButton('offers', 'My Offers')}
        ${actionButton('disconnect', 'Disconnect')}
      </div>` : '';
  showModal(modalBody('Practice Wallet',
    `<p>Use two local wallets to try both sides of a trade with simulated SNRG.</p>
    ${balance}<div class="wallet-options">${switches}</div>${manage}
    ${item ? `<div class="modal-actions">${actionButton('back-to-item', 'Back to NFT')}</div>` : ''}`),
  { item, narrow: true });
}

function reviewBuy(item) {
  if (!state.activeWallet) return showWallet({ item, next: 'buy' });
  const { owner, price } = position(item);
  if (owned(item) || price === null) return showDetail(item);
  const balance = state.wallets[state.activeWallet].balance;
  const reserved = offerFor(item)?.amount ?? 0;
  const canAfford = balance + reserved >= price;
  showModal(modalBody('Review demo purchase',
    `<p>Buy ${item.name} with simulated SNRG from ${walletName(state.activeWallet)}.</p>
    <div class="balance-summary">${priceRow('Purchase price', price)}${priceRow('Available balance', balance)}
    ${reserved ? priceRow('Released from your offer', reserved) : ''}</div>
    ${canAfford ? '' : '<p>Your demo wallet has insufficient funds.</p>'}
    <div class="modal-actions">
      ${actionButton('buy-confirm', 'Confirm demo purchase', { primary: true, attributes: `data-amount="${price}" data-seller="${owner}"${canAfford ? '' : ' disabled'}` })}
      ${actionButton('back-to-item', 'Back')}
    </div>`), { item, narrow: true });
}

function reviewAmount(item, type) {
  if (!state.activeWallet) return showWallet({ item, next: type });
  const isOffer = type === 'offer';
  const { owner, price } = position(item);
  if (isOffer === owned(item)) return showDetail(item);
  const updating = !isOffer && price !== null;
  const verb = isOffer ? 'Make an offer' : updating ? 'Edit listing' : 'List NFT';
  const label = isOffer ? 'Offer amount (SNRG)' : 'Listing price (SNRG)';
  const submit = isOffer ? 'Send demo offer' : updating ? 'Update demo listing' : 'Publish demo listing';
  const copy = isOffer
    ? `<p>Bid on ${item.name} with ${walletName(state.activeWallet)}. The amount stays reserved until the offer closes.</p>
       ${priceRow('Available balance', state.wallets[state.activeWallet].balance)}`
    : `<p>Set the simulated SNRG price for ${item.name}.</p>`;
  showModal(modalBody(verb, `${copy}
    <form class="listing-form" data-transaction="${type}" data-seller="${owner}" data-price="${price ?? ''}">
      <label>${label}<input name="amount" type="text" required inputmode="decimal" maxlength="12" aria-describedby="amount-help"${updating ? ` value="${price / 100}"` : ''}></label>
      <small id="amount-help">0.01–${numberFormat.format(maxListing)} SNRG, up to two decimal places.</small>
      <div class="modal-actions"><button class="button primary" type="submit">${submit}</button>${actionButton('back-to-item', 'Back')}</div>
    </form>`), { item, narrow: true, focus: 'input' });
}

function reviewDelist(item) {
  const { owner, price } = position(item);
  if (!owned(item) || price === null) return showDetail(item);
  showModal(modalBody('Cancel demo listing',
    `<p>Remove ${item.name} from sale. You can still receive offers on it.</p>
    <div class="modal-actions">${actionButton('delist-confirm', 'Cancel listing', { primary: true, attributes: `data-seller="${owner}" data-price="${price}"` })}${actionButton('back-to-item', 'Keep listing')}</div>`),
  { item, narrow: true });
}

function reviewOffer(offerId) {
  const offer = state.offers.find(({ id }) => id === offerId);
  const active = state.activeWallet;
  if (!active || !offer || (offer.buyer !== active && offer.seller !== active)) {
    if (dialog.open) dialog.close();
    render();
    notify('This offer is no longer available to your wallet.');
    return;
  }
  const item = catalog.get(offer.itemId);
  const incoming = offer.seller === active;
  const button = (action, label, primary = false) => actionButton(action, label, { primary, attributes: `data-offer="${offer.id}"` });
  let actions = incoming
    ? button('accept', 'Accept offer', true) + button('decline', 'Decline offer')
    : button('withdraw', 'Withdraw offer');
  if (!incoming && offer.seller === 'catalog') actions += button('resolve-catalog-offer', 'Simulate seller acceptance', true);
  const copy = incoming
    ? `Accept to transfer ${item.name} to ${walletName(offer.buyer)} and receive the offer amount.`
    : `You offered ${walletName(offer.seller)} this amount for ${item.name}. Withdrawing returns the reserved funds to your wallet.`;
  showModal(modalBody(incoming ? 'Review received offer' : 'Manage sent offer',
    `<p>${copy}</p>${priceRow('Offer amount', offer.amount)}
    <div class="modal-actions">${actions}</div>`), { item, narrow: true });
}

const successMessages = {
  buy: 'NFT purchased in the demo.',
  list: 'Demo listing saved.',
  delist: 'Demo listing canceled.',
  offer: 'Demo offer sent. The amount is reserved in your wallet.',
  accept: 'Demo offer accepted and ownership transferred.',
  decline: 'Demo offer declined. The reserved amount was returned.',
  withdraw: 'Demo offer withdrawn. The reserved amount was returned.',
  'resolve-catalog-offer': 'Demo seller accepted your offer.',
};

async function submitTransaction(action) {
  if (!await commit(action, modalWallet)) return;
  dialog.close();
  render();
  if (!notifyPriceAlerts()) notify(successMessages[action.type]);
}

async function saveItem(item, control) {
  const expected = dialog.open ? modalWallet : state.activeWallet;
  if (!await commit({ type: 'save', itemId: item.id }, expected)) return;
  const saved = savedItems().includes(item.id);
  if (currentView === 'saved') {
    render();
    if (!dialog.open) (results.querySelector('.card-save') ?? savedButton).focus();
  } else {
    results.querySelector(`[data-action="save"][data-id="${item.id}"]`)?.setAttribute('aria-pressed', String(saved));
  }
  if (dialog.open && control.isConnected) control.textContent = saved ? 'Remove from saved' : 'Save NFT';
  notify(saved ? 'Saved to your watchlist.' : 'Removed from your watchlist.');
}

function clearFilters() {
  category = 'All NFTs';
  query = '';
  search.value = '';
  order = 'featured';
  availability = 'all';
  rarity = 'all';
}

async function changeWallet(control, item) {
  const wallet = control.dataset.wallet;
  const next = control.dataset.next;
  if (!await commit({ type: 'connect', wallet }, modalWallet)) return;
  render();
  notifyPriceAlerts();
  if (!dialog.open) return;
  if (next === 'buy') reviewBuy(item);
  else if (next === 'offer') reviewAmount(item, 'offer');
  else showWallet({ item });
}

async function reviewMockTransaction(scenario) {
  try {
    const { createTransactionPreview } = await import('./transaction-preview.js');
    if (currentView !== 'transaction-preview') return;
    transactionRun = createTransactionPreview(scenario);
    const review = transactionRun.review;
    const settlement = review.settlement;
    showModal(modalBody('Review mock purchase',
      `<p>Purchase a sample NFT using the practice buyer. These amounts use simulated SNRG.</p>
      <div class="balance-summary">
        ${priceRow('Purchase price', Number(review.amount) / 1e7)}
        ${priceRow('Marketplace fee', Number(settlement.fee) / 1e7)}
        ${priceRow('Creator royalty', Number(settlement.royalty) / 1e7)}
      </div>
      <div class="modal-actions">${actionButton('chain-approve', 'Approve simulation', { primary: true })}${actionButton('chain-reject', 'Reject simulation')}</div>`),
    { narrow: true });
  } catch {
    notify('The practice transaction could not be prepared.');
  }
}

function runMockTransaction(decision) {
  const run = transactionRun;
  if (!run) return;
  const update = ({ receipt, checkpoint }) => {
    if (transactionRun !== run || !dialog.open) return;
    const messages = {
      pending: 'The mock transaction is waiting for a receipt.',
      finalized: `The mock sale is finalized and indexed at mock block ${checkpoint.height}.`,
      failed: receipt.message || 'The mock transaction failed.',
    };
    showModal(modalBody(`Mock receipt · ${receipt.status}`,
      `<p role="status">${messages[receipt.status]}</p><p>Simulation only.</p>`), { narrow: true });
    if (receipt.status === 'pending') {
      setTimeout(() => {
        if (transactionRun === run && dialog.open) update(run.getStatus());
      }, 300);
    }
  };
  try {
    update(run.submit(decision));
  } catch {
    showError('The mock transaction could not be submitted. Close and prepare a new review.');
  }
}

function renderWatchlist() {
  const targets = items.filter(({ id }) => community.alerts[practiceWallet()][id]);
  if (!targets.length) return '';
  return `<section class="community-panel watchlist-panel"><h3>Price alerts</h3>
    <p>Alerts compare simulated prices while this marketplace is open.</p>
    <ul class="studio-list">${targets.map((item) => `<li><strong>${item.name}</strong>
      <span>Target ${amount(community.alerts[practiceWallet()][item.id])}${alertTriggered(item) ? ' · Matched' : ''}</span>
      ${actionButton('alert-settings', 'Edit price alert', { attributes: `data-id="${item.id}"` })}
    </li>`).join('')}</ul></section>`;
}

function showPriceAlert(item) {
  const target = community.alerts[practiceWallet()][item.id];
  showModal(modalBody('Practice price alert', `<p>Set a target for ${item.name}. The marketplace checks your alert while it is open.</p>
    <form class="listing-form" data-community-form="alert">
      <label>Target price (SNRG)<input name="amount" type="text" required inputmode="decimal" maxlength="12" value="${target ? target / 100 : ''}"></label>
      <div class="modal-actions"><button class="button primary" type="submit">Save alert</button>
        ${target ? actionButton('remove-alert', 'Remove alert') : ''}</div>
    </form>`), { item, narrow: true, focus: 'input' });
}

async function removePriceAlert(item) {
  try {
    await changeCommunity((data, wallet) => { delete data.alerts[wallet][item.id]; }, modalWallet ?? defaultWallet);
    dialog.close();
    render();
    notifyPriceAlerts();
    notify('Practice price alert removed.');
  } catch (error) {
    showError(error.message);
  }
}

async function submitCommunityForm(form, item) {
  const type = form.dataset.communityForm;
  try {
    if (type === 'alert') {
      const target = parseAmount(form.elements.amount.value);
      if (target === null) throw new Error('Enter a positive target with up to two decimal places.');
      await changeCommunity((data, wallet) => { data.alerts[wallet][item.id] = target; }, modalWallet ?? defaultWallet);
    } else if (type === 'report') {
      const reason = form.elements.reason.value;
      const notes = form.elements.notes.value.trim();
      if (!reportKinds.includes(reason) || notes.length > 500) throw new Error('Choose a reason and limit details to 500 characters.');
      await changeCommunity((data, wallet) => {
        if (data.reports[wallet].length >= 30) throw new Error('This wallet has reached its local report limit.');
        data.reports[wallet].unshift({ id: crypto.randomUUID(), itemId: item.id, reason, notes, status: 'Open' });
      }, modalWallet ?? defaultWallet);
    }
    dialog.close();
    render();
    if (type !== 'alert' || !notifyPriceAlerts()) notify(type === 'alert' ? 'Practice price alert saved.' : 'Report saved to Creator Studio.');
  } catch (error) {
    showError(error.message);
  }
}

async function verifyMedia(item, control) {
  const output = dialogContent.querySelector('.integrity-result');
  control.disabled = true;
  output.hidden = false;
  output.textContent = 'Checking artwork and metadata…';
  try {
    const result = await verifyItemIntegrity(item, catalogIntegrity[item.id]);
    output.textContent = 'Verified against the published SHA-256 hashes for this sample.';
    for (const [label, value] of [['Artwork', result.image], ['Metadata', result.metadata]]) {
      const line = document.createElement('span');
      line.textContent = label + ' ';
      const code = document.createElement('code');
      code.textContent = value;
      line.append(code);
      output.append(line);
    }
  } catch (error) {
    output.textContent = error.message;
  } finally {
    control.disabled = false;
  }
}

async function saveDrop(form) {
  const expectedWallet = practiceWallet();
  const submit = form.querySelector('button[type="submit"]');
  const output = form.querySelector('#drop-error');
  if (submit.disabled) return;
  submit.disabled = true;
  output.hidden = true;
  try {
    const title = form.elements.title.value.trim();
    const kind = form.elements.kind.value;
    const description = form.elements.description.value.trim();
    const royalty = form.elements.royalty.value;
    const royaltyBps = Number(royalty) === 0 ? 0 : parseAmount(royalty);
    const art = form.elements.art.files[0];
    if (!title || title.length > 80 || !dropKinds.includes(kind) || description.length > 500) {
      throw new Error('Enter a title and choose a supported drop type.');
    }
    if (royaltyBps === null || royaltyBps > 1000) throw new Error('Enter a royalty between 0% and 10%.');
    if (art && (!['image/png', 'image/jpeg', 'image/webp'].includes(art.type) || art.size > 5 * 1024 * 1024 || art.size === 0)) {
      throw new Error('Choose a PNG, JPEG, or WebP file up to 5 MB.');
    }
    const mediaHash = art ? await sha256(await art.arrayBuffer()) : '';
    const metadata = { title, kind, description, royaltyBps, mediaHash };
    const metadataHash = await sha256(new TextEncoder().encode(JSON.stringify(metadata)));
    await changeCommunity((data, wallet) => {
      if (data.drafts[wallet].length >= 20) throw new Error('Remove an existing draft before adding another.');
      data.drafts[wallet].unshift({ id: crypto.randomUUID(), ...metadata, metadataHash });
    }, expectedWallet);
    if (currentView === 'studio') render();
    notify('Drop draft saved to this browser.');
  } catch (error) {
    output.textContent = error.message;
    output.hidden = false;
  } finally {
    submit.disabled = false;
  }
}

async function manageStudio(control) {
  const { action, id } = control.dataset;
  const expectedWallet = practiceWallet();
  const key = action === 'remove-draft' ? 'drafts' : 'reports';
  const statuses = { 'resolve-report': 'Resolved', 'hide-reported': 'Hidden', 'restore-reported': 'Open' };
  try {
    await changeCommunity((data, wallet) => {
      const records = data[key][wallet];
      const index = records.findIndex((record) => record.id === id);
      if (index < 0) throw new Error('This entry is no longer available.');
      if (key === 'drafts') records.splice(index, 1);
      else records[index].status = statuses[action];
    }, expectedWallet);
    render();
    heading.focus({ preventScroll: true });
    notify('Creator Studio updated.');
  } catch (error) {
    notify(error.message);
  }
}

function returnToAction() {
  if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  else if (returnFocus?.dataset.action) {
    const { action, id, offer } = returnFocus.dataset;
    const controls = document.querySelectorAll(`[data-action="${action}"]`);
    const replacement = Array.from(controls).find((control) => control.dataset.id === id && control.dataset.offer === offer);
    (replacement ?? heading).focus({ preventScroll: true });
  }
  modalItem = null;
  transactionRun = null;
  modalWallet = null;
  returnFocus = null;
}

document.addEventListener('click', async (event) => {
  const control = event.target.closest('[data-action], [data-category]');
  if (!control || actionPending) return;
  if (control.dataset.category) {
    category = control.dataset.category;
    render();
    return;
  }
  const item = catalog.get(Number(control.dataset.id)) ?? modalItem;
  const offerId = Number(control.dataset.offer);
  switch (control.dataset.action) {
    case 'saved': navigate('saved'); break;
    case 'featured': navigate(collectionHash(featured.name)); break;
    case 'clear': clearFilters(); render(); search.focus(); break;
    case 'close': dialog.close(); break;
    case 'wallet': refreshState(); showWallet(); break;
    case 'detail': refreshState(); showDetail(item); break;
    case 'save': await saveItem(item, control); break;
    case 'chain-approve':
    case 'chain-reject':
      runMockTransaction(control.dataset.action === 'chain-approve' ? 'approve' : 'reject');
      break;
    case 'alert-settings': showPriceAlert(item); break;
    case 'remove-alert': await removePriceAlert(item); break;
    case 'verify-media': await verifyMedia(item, control); break;
    case 'report-item': showModal(modalBody('Report NFT', renderReportForm(item)), { item, narrow: true }); break;
    case 'remove-draft':
    case 'resolve-report':
    case 'hide-reported':
    case 'restore-reported':
      await manageStudio(control);
      break;
    case 'back-to-item': refreshState(); showDetail(item); break;
    case 'owned':
    case 'offers':
      event.preventDefault();
      dialog.close();
      navigate(control.dataset.action);
      break;
    case 'connect': await changeWallet(control, item); break;
    case 'disconnect':
      if (await commit({ type: 'disconnect' }, modalWallet)) {
        dialog.close();
        render();
        notify('Demo wallet disconnected.');
      }
      break;
    case 'buy-review': refreshState(); reviewBuy(item); break;
    case 'buy-confirm': await submitTransaction({ type: 'buy', itemId: item.id, amount: Number(control.dataset.amount), seller: control.dataset.seller }); break;
    case 'list-review': refreshState(); reviewAmount(item, 'list'); break;
    case 'delist-review': refreshState(); reviewDelist(item); break;
    case 'delist-confirm':
      await submitTransaction({ type: 'delist', itemId: item.id, seller: control.dataset.seller, expectedPrice: Number(control.dataset.price) });
      break;
    case 'offer-review': refreshState(); reviewAmount(item, 'offer'); break;
    case 'review-offer': refreshState(); reviewOffer(offerId); break;
    case 'accept':
    case 'decline':
    case 'withdraw':
    case 'resolve-catalog-offer':
      await submitTransaction({ type: control.dataset.action, offerId });
      break;
  }
});

dialog.addEventListener('submit', async (event) => {
  if (event.target.dataset.communityForm) {
    event.preventDefault();
    await submitCommunityForm(event.target, modalItem);
    return;
  }
  const type = event.target.dataset.transaction;
  if (!['list', 'offer'].includes(type)) return;
  event.preventDefault();
  const input = event.target.elements.amount;
  const cents = parseAmount(input.value);
  if (cents === null) {
    showError('Enter a positive SNRG amount with up to two decimal places.');
    input.focus();
    return;
  }
  const { seller, price } = event.target.dataset;
  const reviewed = type === 'list' ? { expectedPrice: price ? Number(price) : null } : {};
  await submitTransaction({ type, itemId: modalItem.id, amount: cents, seller, ...reviewed });
});

dialog.addEventListener('click', (event) => {
  if (event.target !== dialog || actionPending) return;
  const { left, top, right, bottom } = dialog.getBoundingClientRect();
  if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) dialog.close();
});

dialog.addEventListener('cancel', (event) => {
  if (actionPending) event.preventDefault();
});

dialog.addEventListener('close', () => {
  if (!dialog.open) returnToAction();
});

search.addEventListener('input', () => {
  query = search.value.trim().toLowerCase();
  render();
});
sort.addEventListener('change', () => {
  order = sort.value;
  render();
});
listingStatus.addEventListener('change', () => {
  availability = listingStatus.value;
  render();
});
rarityFilter.addEventListener('change', () => {
  rarity = rarityFilter.value;
  render();
});
results.addEventListener('submit', (event) => {
  if (event.target.id === 'drop-form') {
    event.preventDefault();
    void saveDrop(event.target);
  }
  if (event.target.id === 'chain-preview-form') {
    event.preventDefault();
    void reviewMockTransaction(event.target.elements.scenario.value);
  }
});
window.addEventListener('hashchange', () => {
  if (location.hash === '#market') return;
  if (dialog.open) dialog.close();
  clearFilters();
  render();
  window.scrollTo(0, 0);
  if (currentView !== 'explore') heading.focus({ preventScroll: true });
});
window.addEventListener('storage', (event) => {
  if (event.key !== storageKey && event.key !== legacyStorageKey && event.key !== communityKey && event.key !== null) return;
  refreshState();
  render();
  notifyPriceAlerts();
  if (dialog.open && modalItem && state.activeWallet !== modalWallet) showError('The active demo wallet changed. Reopen this action and try again.');
});

refreshState();
render();
