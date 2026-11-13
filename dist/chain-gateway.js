import { TESTNET_V3 } from './wallet-network.js';

export const LIVE_TRADING_ENABLED = false;

const mockGenesis = 'mock-genesis';
const approvalLifetime = 5 * 60 * 1000;
const supportedScenarios = new Set(['success', 'delayed', 'reverted']);
const intentLabels = {
  createCollection: 'Create NFT collection',
  mint: 'Mint NFT',
  approve: 'Change marketplace approval',
  list: 'Create NFT listing',
  offer: 'Make NFT offer',
  cancelListing: 'Cancel NFT listing',
  cancelOffer: 'Cancel NFT offer',
  settle: 'Settle NFT sale',
  setRoyalty: 'Set collection royalty',
  transfer: 'Transfer NFT',
};

export class GatewayError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GatewayError';
    this.code = code;
  }
}

function check(condition, code, message) {
  if (!condition) throw new GatewayError(code, message);
}

function identifier(value, label) {
  check(typeof value === 'string' && /^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(value),
    'invalid_intent', `Enter a valid ${label}.`);
  return value;
}

function label(value, field, maximum) {
  check(typeof value === 'string' && value === value.trim() && value.length > 0
    && value.length <= maximum && !/[\u0000-\u001f\u007f]/u.test(value),
  'invalid_intent', `Enter a valid ${field}.`);
  return value;
}

function atomic(value, allowZero = false) {
  check(typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value)
    && (allowZero || value !== '0'), 'invalid_amount', 'Use an exact amount in native atomic units.');
  return value;
}

function basisPoints(value, field) {
  check(Number.isInteger(value) && value >= 0 && value <= 10000,
    'invalid_royalty', `Enter ${field} from 0 through 10,000 basis points.`);
  return value;
}

function metadataRef(value) {
  const uri = value?.uri;
  const sha256 = value?.sha256;
  check(typeof uri === 'string' && uri.length <= 2048 && !/\s/.test(uri)
    && typeof sha256 === 'string' && /^[a-f0-9]{64}$/.test(sha256),
  'invalid_metadata', 'Provide an HTTPS, IPFS, or Arweave metadata reference with a SHA-256 hash.');
  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    throw new GatewayError('invalid_metadata', 'The metadata reference is not a valid URL.');
  }
  check(['https:', 'ipfs:', 'ar:'].includes(parsed.protocol) && parsed.hostname
    && !parsed.username && !parsed.password, 'invalid_metadata', 'Use a supported metadata reference.');
  return { uri, sha256 };
}

function readTokenRef(input) {
  return {
    collectionId: identifier(input.collectionId, 'collection ID'),
    tokenId: identifier(input.tokenId, 'token ID'),
  };
}

function normalizeIntent(input) {
  check(input && Object.hasOwn(intentLabels, input.kind), 'invalid_intent', 'Choose a supported NFT operation.');
  check(input.network === TESTNET_V3.network, 'wrong_network', 'Select the configured Synergy Testnet v3 network.');
  const base = {
    kind: input.kind,
    account: identifier(input.account, 'account'),
    network: input.network,
    idempotencyKey: identifier(input.idempotencyKey, 'request key'),
  };
  switch (input.kind) {
    case 'createCollection':
      return {
        ...base,
        collectionId: identifier(input.collectionId, 'collection ID'),
        name: label(input.name, 'collection name', 80),
        symbol: label(input.symbol, 'collection symbol', 12),
        metadata: metadataRef(input.metadata),
        royaltyBps: basisPoints(input.royaltyBps, 'royalty'),
        royaltyRecipient: identifier(input.royaltyRecipient, 'royalty recipient'),
      };
    case 'mint':
      return { ...base, ...readTokenRef(input), owner: identifier(input.owner, 'owner'), metadata: metadataRef(input.metadata) };
    case 'approve':
      check(typeof input.approved === 'boolean', 'invalid_intent', 'Choose whether to grant or revoke approval.');
      return { ...base, ...readTokenRef(input), operator: identifier(input.operator, 'operator'), approved: input.approved };
    case 'list':
      return { ...base, ...readTokenRef(input), listingId: identifier(input.listingId, 'listing ID'), price: atomic(input.price) };
    case 'offer':
      return {
        ...base, ...readTokenRef(input), offerId: identifier(input.offerId, 'offer ID'),
        seller: identifier(input.seller, 'expected seller'), price: atomic(input.price),
      };
    case 'cancelListing':
      return { ...base, listingId: identifier(input.listingId, 'listing ID') };
    case 'cancelOffer':
      return { ...base, offerId: identifier(input.offerId, 'offer ID') };
    case 'settle':
      check(['listing', 'offer'].includes(input.orderType), 'invalid_intent', 'Choose a listing or offer.');
      return {
        ...base, orderType: input.orderType, orderId: identifier(input.orderId, 'order ID'),
        expectedPrice: atomic(input.expectedPrice),
      };
    case 'setRoyalty':
      return {
        ...base, collectionId: identifier(input.collectionId, 'collection ID'),
        royaltyBps: basisPoints(input.royaltyBps, 'royalty'),
        royaltyRecipient: identifier(input.royaltyRecipient, 'royalty recipient'),
      };
    case 'transfer':
      return { ...base, ...readTokenRef(input), recipient: identifier(input.recipient, 'recipient') };
  }
}

function tokenKey({ collectionId, tokenId }) {
  return JSON.stringify([collectionId, tokenId]);
}

function credit(state, account, amount) {
  state.balances.set(account, (state.balances.get(account) ?? 0n) + amount);
}

function debit(state, account, amount) {
  const balance = state.balances.get(account) ?? 0n;
  check(balance >= amount, 'insufficient_balance', 'The mock wallet has insufficient funds.');
  state.balances.set(account, balance - amount);
}

function collectionFor(state, collectionId) {
  const collection = state.collections.get(collectionId);
  check(collection, 'not_found', 'The collection does not exist.');
  return collection;
}

function tokenFor(state, intent) {
  const token = state.tokens.get(tokenKey(intent));
  check(token, 'not_found', 'The NFT does not exist.');
  return token;
}

function requireOwner(token, account) {
  check(token.owner === account, 'owner_changed', 'The NFT owner changed or does not match this account.');
}

function requireApproval(token, operator) {
  check(token.approvals.includes(operator), 'approval_required', 'The current owner must approve the marketplace operator.');
}

function activeOrder(orders, id) {
  const order = orders.get(id);
  check(order?.status === 'active', 'order_unavailable', 'This order is no longer active.');
  return order;
}

function emitCancelListing(listing, emit) {
  listing.status = 'canceled';
  emit('listingCanceled', {
    listingId: listing.listingId, collectionId: listing.collectionId,
    tokenId: listing.tokenId, seller: listing.seller,
  });
}

function emitCancelOffer(state, offer, reason, emit) {
  offer.status = 'canceled';
  credit(state, offer.buyer, BigInt(offer.price));
  emit('offerCanceled', {
    offerId: offer.offerId, collectionId: offer.collectionId, tokenId: offer.tokenId,
    buyer: offer.buyer, seller: offer.seller, refund: offer.price, reason,
  });
}

function cancelOrders(state, token, reason, emit, settledOrder) {
  const key = tokenKey(token);
  for (const listing of state.listings.values()) {
    if (listing !== settledOrder && listing.status === 'active' && tokenKey(listing) === key) {
      emitCancelListing(listing, emit);
    }
  }
  for (const offer of state.offers.values()) {
    if (offer !== settledOrder && offer.status === 'active' && tokenKey(offer) === key) {
      emitCancelOffer(state, offer, reason, emit);
    }
  }
}

function payout(price, feeBps, royaltyBps) {
  const gross = BigInt(price);
  const fee = gross * BigInt(feeBps) / 10000n;
  const royalty = gross * BigInt(royaltyBps) / 10000n;
  return { fee, royalty, proceeds: gross - fee - royalty };
}

function getSettlementTerms(state, intent, config) {
  const order = activeOrder(intent.orderType === 'offer' ? state.offers : state.listings, intent.orderId);
  const token = tokenFor(state, order);
  const collection = collectionFor(state, token.collectionId);
  const { fee, royalty, proceeds } = payout(order.price, config.feeBps, collection.royaltyBps);
  return {
    collectionId: token.collectionId, tokenId: token.tokenId, seller: order.seller,
    buyer: intent.orderType === 'offer' ? order.buyer : intent.account,
    price: order.price, fee: fee.toString(), royalty: royalty.toString(), proceeds: proceeds.toString(),
    feeRecipient: config.feeRecipient, royaltyRecipient: collection.royaltyRecipient,
  };
}

function settle(state, intent, config, reviewedTerms, emit) {
  const isOffer = intent.orderType === 'offer';
  const order = activeOrder(isOffer ? state.offers : state.listings, intent.orderId);
  const token = tokenFor(state, order);
  requireOwner(token, order.seller);
  requireApproval(token, config.operator);
  const terms = getSettlementTerms(state, intent, config);
  check(terms.price === intent.expectedPrice, 'price_changed', 'The confirmed amount does not match the active order.');
  check(JSON.stringify(reviewedTerms) === JSON.stringify(terms), 'terms_changed', 'Sale terms changed. Review a new request.');
  check(terms.buyer !== terms.seller && (!isOffer || intent.account === terms.seller),
    'forbidden', 'This account cannot settle the order.');
  if (!isOffer) debit(state, terms.buyer, BigInt(terms.price));
  credit(state, terms.seller, BigInt(terms.proceeds));
  credit(state, terms.feeRecipient, BigInt(terms.fee));
  credit(state, terms.royaltyRecipient, BigInt(terms.royalty));
  cancelOrders(state, token, 'sold', emit, order);
  order.status = 'settled';
  token.owner = terms.buyer;
  token.approvals = [];
  emit('saleSettled', {
    ...terms, operator: config.operator,
    ...(isOffer ? { offerId: order.offerId } : { listingId: order.listingId }),
  });
}

function setRoyalty(collection, intent, feeBps) {
  check(collection.creator === intent.account, 'forbidden', 'Only the collection creator can change royalties.');
  check(intent.royaltyBps + feeBps <= 10000, 'invalid_royalty', 'Fee and royalty cannot exceed the sale amount.');
  collection.royaltyBps = intent.royaltyBps;
  collection.royaltyRecipient = intent.royaltyRecipient;
}

function apply(state, intent, config, reviewedTerms, emit) {
  const { account, collectionId, tokenId } = intent;
  switch (intent.kind) {
    case 'createCollection': {
      check(!state.collections.has(collectionId), 'already_exists', 'The collection ID already exists.');
      const { name, symbol, metadata } = intent;
      const collection = { collectionId, name, symbol, metadata, creator: account };
      setRoyalty(collection, intent, config.feeBps);
      state.collections.set(collectionId, collection);
      emit('collectionCreated', collection);
      return;
    }
    case 'mint': {
      const collection = collectionFor(state, collectionId);
      check(collection.creator === account, 'forbidden', 'Only the collection creator can mint.');
      check(!state.tokens.has(tokenKey(intent)), 'already_exists', 'The NFT ID already exists in this collection.');
      const { owner, metadata } = intent;
      const token = { collectionId, tokenId, owner, metadata };
      state.tokens.set(tokenKey(token), { ...token, approvals: [] });
      emit('tokenMinted', token);
      return;
    }
    case 'approve': {
      const token = tokenFor(state, intent);
      requireOwner(token, account);
      const { operator, approved } = intent;
      const approvals = new Set(token.approvals);
      if (approved) approvals.add(operator);
      else approvals.delete(operator);
      token.approvals = [...approvals];
      emit('approvalUpdated', { collectionId, tokenId, owner: account, operator, approved });
      if (!approved && operator === config.operator) {
        for (const listing of state.listings.values()) {
          if (listing.status === 'active' && tokenKey(listing) === tokenKey(token)) emitCancelListing(listing, emit);
        }
      }
      return;
    }
    case 'list': {
      const token = tokenFor(state, intent);
      requireOwner(token, account);
      requireApproval(token, config.operator);
      const { listingId, price } = intent;
      check(!state.listings.has(listingId), 'already_exists', 'The listing ID already exists.');
      check(![...state.listings.values()].some((order) => order.status === 'active' && tokenKey(order) === tokenKey(token)),
        'already_listed', 'Cancel the active listing before creating another.');
      const listing = { listingId, collectionId, tokenId, seller: account, price, operator: config.operator };
      state.listings.set(listingId, { ...listing, status: 'active' });
      emit('listingCreated', listing);
      return;
    }
    case 'offer': {
      const token = tokenFor(state, intent);
      const { offerId, price, seller } = intent;
      requireOwner(token, seller);
      check(seller !== account, 'forbidden', 'You cannot make an offer on your own NFT.');
      check(!state.offers.has(offerId), 'already_exists', 'The offer ID already exists.');
      check(![...state.offers.values()].some((order) => order.status === 'active' && order.buyer === account
        && tokenKey(order) === tokenKey(token)), 'offer_exists', 'Cancel your open offer before making another.');
      debit(state, account, BigInt(price));
      const offer = { offerId, collectionId, tokenId, buyer: account, seller, price, operator: config.operator };
      state.offers.set(offerId, { ...offer, status: 'active' });
      emit('offerCreated', offer);
      return;
    }
    case 'cancelListing': {
      const listing = activeOrder(state.listings, intent.listingId);
      check(listing.seller === account, 'forbidden', 'Only the listing seller can cancel the listing.');
      emitCancelListing(listing, emit);
      return;
    }
    case 'cancelOffer': {
      const offer = activeOrder(state.offers, intent.offerId);
      check([offer.buyer, offer.seller].includes(account), 'forbidden', 'Only the buyer or seller can cancel the offer.');
      emitCancelOffer(state, offer, offer.buyer === account ? 'withdrawn' : 'declined', emit);
      return;
    }
    case 'settle':
      return settle(state, intent, config, reviewedTerms, emit);
    case 'setRoyalty': {
      const collection = collectionFor(state, collectionId);
      setRoyalty(collection, intent, config.feeBps);
      emit('royaltyUpdated', { collectionId, royaltyBps: collection.royaltyBps, royaltyRecipient: collection.royaltyRecipient });
      return;
    }
    case 'transfer': {
      const token = tokenFor(state, intent);
      requireOwner(token, account);
      check(intent.recipient !== account, 'forbidden', 'Choose another recipient.');
      cancelOrders(state, token, 'transferred', emit);
      token.owner = intent.recipient;
      token.approvals = [];
      emit('tokenTransferred', { collectionId, tokenId, from: account, to: intent.recipient });
      return;
    }
  }
}

function describe(intent, terms) {
  const target = [intent.collectionId, intent.tokenId].filter(Boolean).join(' / ')
    || intent.orderId || intent.listingId || intent.offerId;
  const operation = intentLabels[intent.kind];
  const price = terms?.price ?? intent.price;
  return {
    operation, target, account: intent.account, network: TESTNET_V3.name,
    ...(price ? { amount: price, currency: 'SNRG', decimals: 9 } : {}),
    ...(terms ? { settlement: terms } : {}),
  };
}

export function createMockChainGateway({
  now = Date.now, scenario = 'success', delayMs = 1000, balances = {},
  operator = 'mock-marketplace', feeRecipient = 'mock-fee-recipient', feeBps = 250,
} = {}) {
  const config = {
    operator: identifier(operator, 'operator'),
    feeRecipient: identifier(feeRecipient, 'fee recipient'),
    feeBps: basisPoints(feeBps, 'marketplace fee'),
  };
  check(Number.isSafeInteger(delayMs) && delayMs >= 0 && delayMs <= approvalLifetime,
    'invalid_configuration', 'Choose a supported mock transaction delay.');
  check(typeof scenario === 'function' || supportedScenarios.has(scenario),
    'invalid_configuration', 'Choose a supported mock transaction scenario.');
  let state = {
    collections: new Map(), tokens: new Map(), listings: new Map(), offers: new Map(),
    balances: new Map(Object.entries(balances).map(([account, amount]) => [identifier(account, 'account'), BigInt(atomic(amount, true))])),
  };
  const transactions = new Map();
  const byRequest = new Map();
  const pending = new Map();
  const blocks = [];

  function finish(transaction, finishedAt) {
    const { prepared, scenario: outcome } = transaction;
    const receipt = transaction.receipt;
    if (outcome === 'reverted') {
      transaction.receipt = { ...receipt, status: 'failed', code: 'reverted', message: 'The mock transaction reverted.', finishedAt };
      return;
    }

    const draft = structuredClone(state);
    const height = blocks.length + 1;
    const parentHash = blocks.at(-1)?.hash ?? mockGenesis;
    const block = { height, hash: `mock-block-${height}`, parentHash, events: [] };
    try {
      apply(draft, prepared.intent, config, prepared.review.settlement, (type, data) => {
        block.events.push({
          type, data: structuredClone(data), transactionId: prepared.id, eventIndex: block.events.length,
          blockHeight: height, finalized: true,
        });
      });
    } catch (error) {
      if (!(error instanceof GatewayError)) throw error;
      transaction.receipt = { ...receipt, status: 'failed', code: error.code, message: error.message, finishedAt };
      return;
    }
    state = draft;
    blocks.push(block);
    transaction.receipt = { ...receipt, status: 'finalized', block, finishedAt };
  }

  function advance(timestamp = now()) {
    for (const [id, transaction] of pending) {
      if (timestamp < transaction.readyAt) continue;
      finish(transaction, timestamp);
      pending.delete(id);
    }
  }

  function prepare(input) {
    advance();
    const intent = normalizeIntent(input);
    const request = JSON.stringify([intent.account, intent.idempotencyKey]);
    const fingerprint = JSON.stringify(intent);
    const previous = byRequest.get(request);
    if (previous) {
      check(previous.fingerprint === fingerprint, 'idempotency_conflict', 'This request key is already in use.');
      return structuredClone(previous.prepared);
    }
    const terms = intent.kind === 'settle' ? getSettlementTerms(state, intent, config) : null;
    const id = `mock-tx-${transactions.size + 1}`;
    const prepared = { id, mode: 'mock', intent, review: describe(intent, terms), expiresAt: now() + approvalLifetime };
    const transaction = { prepared, fingerprint, receipt: null };
    byRequest.set(request, transaction);
    transactions.set(id, transaction);
    return structuredClone(prepared);
  }

  function submit(prepared, approval) {
    const timestamp = now();
    advance(timestamp);
    const transaction = transactions.get(prepared?.id);
    check(transaction && prepared.mode === 'mock'
      && JSON.stringify(prepared.intent) === transaction.fingerprint
      && JSON.stringify(prepared.review) === JSON.stringify(transaction.prepared.review)
      && prepared.expiresAt === transaction.prepared.expiresAt,
    'unknown_transaction', 'The prepared transaction is not recognized.');
    const { id, intent, expiresAt } = transaction.prepared;
    check(approval?.transactionId === id && approval.account === intent.account
      && ['approve', 'reject'].includes(approval.decision), 'approval_required',
    'Confirm this exact request with the prepared account.');
    if (transaction.receipt) return structuredClone(transaction.receipt);
    check(timestamp < expiresAt, 'approval_expired', 'This request expired. Prepare a new request.');
    const receipt = { id, mode: 'mock', intentKind: intent.kind, account: intent.account, submittedAt: timestamp };
    if (approval.decision === 'reject') {
      transaction.receipt = { ...receipt, status: 'failed', code: 'rejected', message: 'Mock approval rejected.', finishedAt: timestamp };
      return structuredClone(transaction.receipt);
    }
    const outcome = typeof scenario === 'function' ? scenario(structuredClone(intent)) : scenario;
    check(supportedScenarios.has(outcome), 'invalid_configuration', 'Choose a supported mock transaction scenario.');
    transaction.scenario = outcome;
    transaction.receipt = { ...receipt, status: 'pending' };
    transaction.readyAt = timestamp + (outcome === 'success' ? 0 : delayMs);
    pending.set(id, transaction);
    advance(timestamp);
    return structuredClone(transaction.receipt);
  }

  return Object.freeze({
    mode: 'mock',
    network: TESTNET_V3,
    capabilities: () => ({ mode: 'mock', canPractice: true, canSettleLive: false, operator: config.operator }),
    prepare,
    submit,
    getReceipt(id) { advance(); return structuredClone(transactions.get(id)?.receipt ?? null); },
    getBlock(height) { advance(); return structuredClone(blocks[height - 1] ?? null); },
    getCollection(id) { advance(); return structuredClone(state.collections.get(id) ?? null); },
    getToken(collectionId, tokenId) { advance(); return structuredClone(state.tokens.get(tokenKey({ collectionId, tokenId })) ?? null); },
    getBalance(account) { advance(); return (state.balances.get(account) ?? 0n).toString(); },
    getSnapshot() {
      advance();
      const latest = blocks.at(-1);
      return structuredClone({
        checkpoint: { height: latest?.height ?? 0, hash: latest?.hash ?? mockGenesis },
        tokens: [...state.tokens.values()].map(({ collectionId, tokenId, owner, approvals }) => ({
          collectionId, tokenId, owner, approvedOperators: approvals,
        })),
        listings: [...state.listings.values()]
          .filter(({ status }) => status === 'active')
          .map(({ status, ...listing }) => listing),
        offers: [...state.offers.values()]
          .filter(({ status }) => status === 'active')
          .map(({ status, ...offer }) => ({ ...offer, escrow: offer.price })),
      });
    },
  });
}

const liveGates = Object.freeze([
  'approved_deployment', 'verified_wallet_signing', 'verified_finalized_receipts',
  'verified_indexer', 'deterministic_contract_tests', 'end_to_end_wallet_tests', 'security_review',
]);

// These ports describe the future release integration. They remain disconnected
// until the release supplies an approved deployment and canonical receipt verifier.
export function createLiveChainGateway(_options = {}) {
  async function disabled() {
    throw new GatewayError('live_disabled', 'Live NFT trading requires a verified release on Synergy Network.');
  }
  return Object.freeze({
    mode: 'live',
    network: TESTNET_V3,
    capabilities: () => ({ mode: 'live', canPractice: false, canSettleLive: false, requiredGates: [...liveGates] }),
    prepare: disabled,
    submit: disabled,
    getReceipt: disabled,
    getBlock: disabled,
    getCollection: disabled,
    getToken: disabled,
    getBalance: disabled,
    getSnapshot: disabled,
  });
}
