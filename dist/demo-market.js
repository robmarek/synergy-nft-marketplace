import { items } from './catalog.js';

export const wallets = [
  { id: 'collector', name: 'Collector Wallet' },
  { id: 'trader', name: 'Trader Wallet' },
];
export const storageKey = 'synergy-nft-marketplace-v2';
export const legacyStorageKey = 'synergy-nft-marketplace-v1';
export const maxListing = 1000000;

const version = 2;
const initialBalance = 250000;
const maxBalance = initialBalance * wallets.length;
const eventLimit = 60;
const catalog = new Map(items.map((item) => [item.id, item]));
const walletIds = new Set(wallets.map(({ id }) => id));
const owners = new Set(['catalog', ...walletIds]);
const eventTypes = new Set([
  'Purchased', 'Listed', 'Listing updated', 'Listing canceled',
  'Offer made', 'Offer withdrawn', 'Offer declined', 'Offer accepted', 'Offer refunded',
]);

function validAmount(amount) {
  return Number.isSafeInteger(amount) && amount > 0 && amount <= maxListing * 100;
}

function validBalance(amount, limit = maxBalance) {
  return Number.isSafeInteger(amount) && amount >= 0 && amount <= limit;
}

function validTime(time) {
  return Number.isSafeInteger(time) && time > 0 && time <= 8640000000000000;
}

export function parseAmount(input) {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return validAmount(amount) ? amount : null;
}

export function createState() {
  return {
    version,
    activeWallet: null,
    wallets: Object.fromEntries(wallets.map(({ id }) => [id, { balance: initialBalance, saved: [] }])),
    positions: Object.fromEntries(items.map(({ id, price }) => [id, { owner: 'catalog', price: price * 100 }])),
    offers: [],
    nextOfferId: 1,
    events: [],
  };
}

function readJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function readSaved(saved) {
  return Array.isArray(saved) ? [...new Set(saved.filter((id) => catalog.has(id)))] : [];
}

function readEvents(events) {
  if (!Array.isArray(events)) return [];
  return events.filter((event) => event && catalog.has(event.id) && eventTypes.has(event.type)
    && (event.amount === null || validAmount(event.amount)) && validTime(event.time))
    .slice(0, eventLimit)
    .map(({ id, type, amount, time, wallet, counterparty }) => ({
      id, type, amount, time,
      ...(owners.has(wallet) ? { wallet } : {}),
      ...(owners.has(counterparty) ? { counterparty } : {}),
    }));
}

function importLegacy(data) {
  const state = createState();
  if (!data || typeof data !== 'object') return state;
  const collector = state.wallets.collector;
  collector.saved = readSaved(data.saved);
  if (validBalance(data.balance, initialBalance)) collector.balance = data.balance;
  if (data.connected === true) state.activeWallet = 'collector';
  for (const { id } of items) {
    const price = data.owned?.[id];
    if (price === null || validAmount(price)) state.positions[id] = { owner: 'collector', price };
  }
  state.events = readEvents(data.events).map((event) => ({ ...event, wallet: 'collector' }));
  return state;
}

function readOffers(offers, positions) {
  if (!Array.isArray(offers)) return [];
  const ids = new Set();
  const buyersByItem = new Set();
  const normalized = [];
  for (const offer of offers) {
    if (!offer || !Number.isSafeInteger(offer.id) || offer.id < 1 || offer.id >= Number.MAX_SAFE_INTEGER
      || !catalog.has(offer.itemId) || !walletIds.has(offer.buyer) || offer.buyer === offer.seller
      || positions[offer.itemId].owner !== offer.seller || !validAmount(offer.amount) || !validTime(offer.time)) continue;
    const key = `${offer.itemId}/${offer.buyer}`;
    if (ids.has(offer.id) || buyersByItem.has(key)) continue;
    ids.add(offer.id);
    buyersByItem.add(key);
    const { id, itemId, buyer, seller, amount, time } = offer;
    normalized.push({ id, itemId, buyer, seller, amount, time });
  }
  return normalized;
}

export function loadState(currentJson, legacyJson) {
  const data = readJson(currentJson);
  if (data?.version !== version) return importLegacy(readJson(legacyJson));

  const state = createState();
  state.activeWallet = walletIds.has(data.activeWallet) ? data.activeWallet : null;
  for (const { id } of wallets) {
    const wallet = data.wallets?.[id];
    if (!validBalance(wallet?.balance)) return importLegacy(readJson(legacyJson));
    state.wallets[id] = { balance: wallet.balance, saved: readSaved(wallet.saved) };
  }
  for (const { id } of items) {
    const position = data.positions?.[id];
    if (position && owners.has(position.owner) && (position.price === null || validAmount(position.price))) {
      state.positions[id] = { owner: position.owner, price: position.price };
    }
  }
  state.offers = readOffers(data.offers, state.positions);
  const total = wallets.reduce((sum, { id }) => sum + state.wallets[id].balance + lockedBalance(state, id), 0);
  if (total > maxBalance) return importLegacy(readJson(legacyJson));
  const nextOfferId = state.offers.reduce((max, offer) => Math.max(max, offer.id + 1), 1);
  state.nextOfferId = Number.isSafeInteger(data.nextOfferId) ? Math.max(nextOfferId, data.nextOfferId) : nextOfferId;
  state.events = readEvents(data.events);
  return state;
}

export function lockedBalance(state, walletId) {
  return state.offers.reduce((total, offer) => offer.buyer === walletId ? total + offer.amount : total, 0);
}

function addEvent(state, id, type, amount, time, wallet, counterparty) {
  state.events.unshift({ id, type, amount, time, wallet, ...(counterparty ? { counterparty } : {}) });
  state.events.length = Math.min(state.events.length, eventLimit);
}

function removeOffer(state, offer, refund) {
  state.offers.splice(state.offers.indexOf(offer), 1);
  if (refund) state.wallets[offer.buyer].balance += offer.amount;
}

function transfer(state, itemId, buyer, amount, time, acceptedOffer = null) {
  const seller = state.positions[itemId].owner;
  for (const offer of state.offers.filter((candidate) => candidate.itemId === itemId)) {
    const refund = offer !== acceptedOffer;
    removeOffer(state, offer, refund);
    if (refund) addEvent(state, itemId, 'Offer refunded', offer.amount, time, offer.buyer, seller);
  }
  if (!acceptedOffer) state.wallets[buyer].balance -= amount;
  if (seller !== 'catalog') state.wallets[seller].balance += amount;
  state.positions[itemId] = { owner: buyer, price: null };
  addEvent(state, itemId, acceptedOffer ? 'Offer accepted' : 'Purchased', amount, time,
    acceptedOffer ? seller : buyer, acceptedOffer ? buyer : seller);
}

function resolveOffer(state, action, walletId, time) {
  const offer = state.offers.find(({ id }) => id === action.offerId);
  if (!offer || state.positions[offer.itemId].owner !== offer.seller) return 'This offer is no longer available.';

  const { itemId, buyer, seller, amount } = offer;
  switch (action.type) {
    case 'withdraw':
      if (buyer !== walletId) return 'Only the buyer can withdraw this offer.';
      removeOffer(state, offer, true);
      addEvent(state, itemId, 'Offer withdrawn', amount, time, buyer, seller);
      return;
    case 'decline':
      if (seller !== walletId) return 'Only the seller can decline this offer.';
      removeOffer(state, offer, true);
      addEvent(state, itemId, 'Offer declined', amount, time, seller, buyer);
      return;
    case 'accept':
      if (seller !== walletId) return 'Only the seller can accept this offer.';
      break;
    case 'resolve-catalog-offer':
      if (seller !== 'catalog' || buyer !== walletId) return 'This offer requires a decision from its seller.';
      break;
  }

  transfer(state, itemId, buyer, amount, time, offer);
}

function updateListing(state, type, itemId, amount, time, walletId) {
  const position = state.positions[itemId];
  if (position.owner !== walletId) return 'This NFT is no longer in your wallet.';
  if (type === 'delist') {
    if (position.price === null) return 'This NFT is already unlisted.';
    addEvent(state, itemId, 'Listing canceled', position.price, time, walletId);
    position.price = null;
    return;
  }
  if (!validAmount(amount)) return 'Enter a valid price with up to two decimal places.';
  if (position.price === amount) return 'This NFT is already listed at that price.';
  addEvent(state, itemId, position.price === null ? 'Listed' : 'Listing updated', amount, time, walletId);
  position.price = amount;
}

function buy(state, itemId, amount, time, walletId) {
  const position = state.positions[itemId];
  if (position.owner === walletId) return 'This NFT is already in your wallet.';
  if (position.price === null || position.price !== amount) return 'The listing changed. Review the current price before buying.';
  const wallet = state.wallets[walletId];
  const escrow = state.offers.find((offer) => offer.itemId === itemId && offer.buyer === walletId)?.amount ?? 0;
  if (wallet.balance + escrow < amount) return 'Your demo wallet has insufficient funds for this purchase.';
  transfer(state, itemId, walletId, amount, time);
}

function makeOffer(state, itemId, amount, time, walletId) {
  const seller = state.positions[itemId].owner;
  if (seller === walletId) return 'You already own this NFT.';
  if (!validAmount(amount)) return 'Enter a valid offer with up to two decimal places.';
  if (state.offers.some((offer) => offer.itemId === itemId && offer.buyer === walletId)) {
    return 'Withdraw your existing offer before making another one.';
  }
  const wallet = state.wallets[walletId];
  if (wallet.balance < amount) return 'Your demo wallet has insufficient funds for this offer.';
  if (state.nextOfferId >= Number.MAX_SAFE_INTEGER) return 'This demo wallet cannot create another offer.';
  wallet.balance -= amount;
  state.offers.push({ id: state.nextOfferId, itemId, buyer: walletId, seller, amount, time });
  state.nextOfferId += 1;
  addEvent(state, itemId, 'Offer made', amount, time, walletId, seller);
}

function applyAction(state, action, time) {
  const { type, itemId, amount } = action;
  if (type === 'connect') {
    if (!walletIds.has(action.wallet)) return 'Choose a demo wallet.';
    state.activeWallet = action.wallet;
    return;
  }
  if (type === 'disconnect') {
    state.activeWallet = null;
    return;
  }
  const walletId = state.activeWallet;
  if (Object.hasOwn(action, 'wallet') && action.wallet !== walletId) return 'The active demo wallet changed. Review the action and try again.';
  if (type === 'save') {
    if (!catalog.has(itemId)) return 'This NFT is unavailable.';
    const saved = state.wallets[walletId ?? 'collector'].saved;
    const index = saved.indexOf(itemId);
    if (index < 0) saved.push(itemId);
    else saved.splice(index, 1);
    return;
  }
  if (!walletId) return 'Connect a demo wallet to continue.';
  if (['withdraw', 'decline', 'accept', 'resolve-catalog-offer'].includes(type)) {
    return resolveOffer(state, action, walletId, time);
  }
  if (!catalog.has(itemId)) return 'This NFT is unavailable.';
  const position = state.positions[itemId];
  if (Object.hasOwn(action, 'seller') && action.seller !== position.owner) return 'The owner changed. Review this NFT and try again.';
  if (Object.hasOwn(action, 'expectedPrice') && action.expectedPrice !== position.price) return 'The listing changed. Review the current price and try again.';
  switch (type) {
    case 'list':
    case 'delist':
      return updateListing(state, type, itemId, amount, time, walletId);
    case 'buy':
      return buy(state, itemId, amount, time, walletId);
    case 'offer':
      return makeOffer(state, itemId, amount, time, walletId);
    default:
      return 'This marketplace action is unavailable.';
  }
}

export function transition(state, action, time = Date.now()) {
  if (!action || typeof action !== 'object') return { state, error: 'This marketplace action is unavailable.' };
  const next = structuredClone(state);
  const error = applyAction(next, action, validTime(time) ? time : Date.now());
  return error ? { state, error } : { state: next };
}
