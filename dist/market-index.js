const eventTypes = new Set([
  'collectionCreated', 'tokenMinted', 'tokenTransferred', 'approvalUpdated',
  'listingCreated', 'offerCreated', 'listingCanceled', 'offerCanceled',
  'royaltyUpdated', 'saleSettled',
]);

function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}

function identifier(value, field) {
  requireThat(typeof value === 'string' && /^[^\s\p{Cc}]{1,256}$/u.test(value), `Invalid ${field}.`);
  return value;
}

function integer(value, field) {
  requireThat(Number.isSafeInteger(value) && value >= 0, `Invalid ${field}.`);
  return value;
}

function amount(value, field, positive = false) {
  requireThat(typeof value === 'string' && /^(0|[1-9]\d{0,77})$/.test(value), `Invalid ${field}.`);
  const units = BigInt(value);
  requireThat(!positive || units > 0n, `Invalid ${field}.`);
  return units;
}

function royaltyBps(value) {
  requireThat(integer(value, 'royalty basis points') <= 10000, 'Invalid royalty basis points.');
  return value;
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map((key) =>
    JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  return JSON.stringify(value);
}

function checkpoint(value) {
  requireThat(object(value), 'Missing chain checkpoint.');
  return { height: integer(value.height, 'block height'), hash: identifier(value.hash, 'block hash') };
}

function sameCheckpoint(left, right) {
  return left.height === right.height && left.hash === right.hash;
}

function tokenIdentity(data) {
  return [identifier(data.collectionId, 'collection ID'), identifier(data.tokenId, 'token ID')];
}

function tokenKey(data) {
  return JSON.stringify(tokenIdentity(data));
}

function orderOperator(data, defaultOperator) {
  const operator = identifier(data.operator ?? defaultOperator, 'marketplace operator');
  requireThat(defaultOperator === undefined || operator === defaultOperator, 'Order uses an unexpected marketplace operator.');
  return operator;
}

function createProjection() {
  return {
    collections: new Map(),
    tokens: new Map(),
    listings: new Map(),
    activeListingByToken: new Map(),
    offers: new Map(),
    activeOffersByToken: new Map(),
    sales: [],
    transactions: new Map(),
  };
}

function getCollection(projection, collectionId) {
  const collection = projection.collections.get(identifier(collectionId, 'collection ID'));
  requireThat(collection, 'Event references an unknown collection.');
  return collection;
}

function getToken(projection, data) {
  const token = projection.tokens.get(tokenKey(data));
  requireThat(token, 'Event references an unknown NFT.');
  return token;
}

function closeListing(projection, listing, status, reason) {
  projection.activeListingByToken.delete(tokenKey(listing));
  listing.status = status;
  listing.reason = reason;
}

function closeOffer(projection, offer, status, reason) {
  const key = tokenKey(offer);
  const active = projection.activeOffersByToken.get(key);
  active.delete(offer.offerId);
  if (active.size === 0) projection.activeOffersByToken.delete(key);
  offer.status = status;
  offer.reason = reason;
  if (status !== 'invalidated') offer.escrow = '0';
}

function invalidateOrders(projection, token, reason) {
  const key = tokenKey(token);
  const listing = projection.listings.get(projection.activeListingByToken.get(key));
  if (listing) closeListing(projection, listing, 'invalidated', reason);
  for (const id of projection.activeOffersByToken.get(key) ?? []) {
    closeOffer(projection, projection.offers.get(id), 'invalidated', reason);
  }
}

function changeOwnership(projection, token, owner, reason) {
  invalidateOrders(projection, token, reason);
  token.owner = owner;
  token.approvedOperators.clear();
}

function applyCollectionEvent(projection, type, data) {
  const collectionId = identifier(data.collectionId, 'collection ID');
  const royaltyRecipient = data.royaltyRecipient == null ? null : identifier(data.royaltyRecipient, 'royalty recipient');
  const bps = royaltyBps(data.royaltyBps);
  requireThat(bps === 0 || royaltyRecipient, 'Missing royalty recipient.');
  if (type === 'royaltyUpdated') {
    const collection = getCollection(projection, collectionId);
    collection.royaltyBps = bps;
    collection.royaltyRecipient = royaltyRecipient;
    return;
  }
  requireThat(!projection.collections.has(collectionId), 'Collection already exists.');
  projection.collections.set(collectionId, {
    collectionId, creator: identifier(data.creator, 'collection creator'),
    name: data.name, symbol: data.symbol, metadata: data.metadata,
    royaltyBps: bps, royaltyRecipient,
  });
}

function applyTokenEvent(projection, type, data) {
  const [collectionId, tokenId] = tokenIdentity(data);
  const key = tokenKey(data);
  if (type === 'tokenMinted') {
    getCollection(projection, collectionId);
    requireThat(!projection.tokens.has(key), 'NFT already exists.');
    projection.tokens.set(key, {
      collectionId, tokenId, owner: identifier(data.owner, 'NFT owner'),
      approvedOperators: new Set(), metadata: data.metadata,
    });
    return;
  }

  const token = getToken(projection, data);
  if (type === 'tokenTransferred') {
    requireThat(identifier(data.from, 'transfer sender') === token.owner, 'Transfer sender differs from the NFT owner.');
    const recipient = identifier(data.to, 'transfer recipient');
    requireThat(recipient !== token.owner, 'Transfer recipient matches the NFT owner.');
    changeOwnership(projection, token, recipient, 'ownership-changed');
    return;
  }

  requireThat(identifier(data.owner, 'approval owner') === token.owner, 'Approval owner differs from the NFT owner.');
  const operator = identifier(data.operator, 'approval operator');
  requireThat(typeof data.approved === 'boolean', 'Missing approval status.');
  if (data.approved) {
    token.approvedOperators.add(operator);
    return;
  }

  token.approvedOperators.delete(operator);
  const listing = projection.listings.get(projection.activeListingByToken.get(key));
  if (listing?.operator === operator) closeListing(projection, listing, 'invalidated', 'approval-revoked');
}

function createOrder(projection, type, data, defaultOperator) {
  const token = getToken(projection, data);
  const { collectionId, tokenId } = token;
  const seller = identifier(data.seller, 'order seller');
  requireThat(seller === token.owner, 'Order seller differs from the NFT owner.');
  const operator = orderOperator(data, defaultOperator);
  amount(data.price, 'order price', true);
  const key = tokenKey(data);
  const terms = { collectionId, tokenId, seller, operator, price: data.price, status: 'active' };
  if (type === 'listingCreated') {
    const listingId = identifier(data.listingId, 'listing ID');
    requireThat(!projection.listings.has(listingId) && !projection.activeListingByToken.has(key), 'Duplicate listing.');
    requireThat(token.approvedOperators.has(operator), 'Listing is missing current marketplace approval.');
    projection.listings.set(listingId, { listingId, ...terms });
    projection.activeListingByToken.set(key, listingId);
    return;
  }

  const offerId = identifier(data.offerId, 'offer ID');
  const buyer = identifier(data.buyer, 'offer buyer');
  requireThat(buyer !== seller && !projection.offers.has(offerId), 'Invalid or duplicate offer.');
  projection.offers.set(offerId, { offerId, buyer, escrow: data.price, ...terms });
  if (!projection.activeOffersByToken.has(key)) projection.activeOffersByToken.set(key, new Set());
  projection.activeOffersByToken.get(key).add(offerId);
}

function cancelOrder(projection, type, data) {
  if (type === 'listingCanceled') {
    const listing = projection.listings.get(identifier(data.listingId, 'listing ID'));
    requireThat(listing && ['active', 'invalidated'].includes(listing.status)
      && tokenKey(listing) === tokenKey(data) && data.seller === listing.seller, 'Cancellation does not match a listing.');
    if (listing.status === 'active') closeListing(projection, listing, 'canceled', 'canceled');
    else listing.status = 'canceled';
    return;
  }

  const offer = projection.offers.get(identifier(data.offerId, 'offer ID'));
  requireThat(offer && ['active', 'invalidated'].includes(offer.status) && tokenKey(offer) === tokenKey(data)
    && data.buyer === offer.buyer && data.seller === offer.seller, 'Cancellation does not match an offer.');
  const reason = identifier(data.reason, 'offer cancellation reason');
  amount(data.refund, 'offer refund', true);
  requireThat(data.refund === offer.price, 'Offer refund differs from escrow.');
  if (offer.status === 'active') closeOffer(projection, offer, 'canceled', reason);
  else {
    offer.status = 'canceled';
    offer.reason = reason;
    offer.escrow = '0';
  }
}

function settleSale(projection, event, defaultOperator) {
  const { data } = event;
  const token = getToken(projection, data);
  const buyer = identifier(data.buyer, 'sale buyer');
  requireThat(data.seller === token.owner && buyer !== token.owner, 'Sale participants differ from current ownership.');
  const isListing = data.listingId != null;
  requireThat(isListing !== (data.offerId != null), 'Sale must settle exactly one order.');
  const order = isListing
    ? projection.listings.get(identifier(data.listingId, 'listing ID'))
    : projection.offers.get(identifier(data.offerId, 'offer ID'));
  requireThat(order?.status === 'active' && tokenKey(order) === tokenKey(data)
    && order.seller === token.owner && order.price === data.price, 'Sale does not match a current order.');
  const operator = orderOperator(data, defaultOperator);
  requireThat(order.operator === operator && token.approvedOperators.has(operator), 'Sale is missing current marketplace approval.');
  requireThat(isListing || (order.buyer === buyer && order.escrow === data.price), 'Sale differs from the funded offer.');
  const price = amount(data.price, 'sale price', true);
  const fee = amount(data.fee, 'sale fee');
  const royalty = amount(data.royalty, 'sale royalty');
  const proceeds = amount(data.proceeds, 'seller proceeds');
  requireThat(price === fee + royalty + proceeds, 'Sale payouts do not add up to the price.');
  if (fee > 0n) identifier(data.feeRecipient, 'fee recipient');
  if (royalty > 0n) identifier(data.royaltyRecipient, 'royalty recipient');

  if (isListing) closeListing(projection, order, 'filled', 'settled');
  else closeOffer(projection, order, 'filled', 'settled');
  changeOwnership(projection, token, buyer, 'sold');
  projection.sales.push({ ...data, operator, transactionId: event.transactionId, height: event.blockHeight });
}

function applyEvent(projection, event, defaultOperator) {
  const { type, data } = event;
  switch (type) {
    case 'collectionCreated':
    case 'royaltyUpdated':
      return applyCollectionEvent(projection, type, data);
    case 'tokenMinted':
    case 'tokenTransferred':
    case 'approvalUpdated':
      return applyTokenEvent(projection, type, data);
    case 'listingCreated':
    case 'offerCreated':
      return createOrder(projection, type, data, defaultOperator);
    case 'listingCanceled':
    case 'offerCanceled':
      return cancelOrder(projection, type, data);
    case 'saleSettled':
      return settleSale(projection, event, defaultOperator);
  }
}

function normalizeBlock(input) {
  const block = checkpoint(input);
  block.parentHash = identifier(input.parentHash, 'parent block hash');
  requireThat(input.finalized !== false && input.removed !== true, 'Block is not canonical and finalized.');
  requireThat(Array.isArray(input.events), 'Missing block events.');
  const logs = new Map();
  const transactions = new Set();
  let previousTransaction = null;
  let lastIndex = -1;
  block.events = [];
  for (const source of input.events) {
    requireThat(object(source) && source.blockHeight === block.height && source.finalized === true
      && source.removed !== true && (source.blockHash == null || source.blockHash === block.hash), 'Event is not finalized in this block.');
    const transactionId = identifier(source.transactionId, 'transaction ID');
    const eventIndex = integer(source.eventIndex, 'event index');
    requireThat(eventTypes.has(source.type) && object(source.data), 'Unsupported marketplace event.');
    const event = { type: source.type, transactionId, eventIndex, blockHeight: block.height, data: structuredClone(source.data) };
    const key = JSON.stringify([transactionId, eventIndex]);
    const signature = canonicalJson(event);
    if (logs.has(key)) {
      requireThat(logs.get(key) === signature, 'Conflicting duplicate event.');
      continue;
    }
    if (transactionId !== previousTransaction) {
      requireThat(!transactions.has(transactionId), 'Events for each transaction must be contiguous.');
      transactions.add(transactionId);
      previousTransaction = transactionId;
      lastIndex = -1;
    }
    requireThat(eventIndex > lastIndex, 'Transaction events are out of order.');
    lastIndex = eventIndex;
    logs.set(key, signature);
    block.events.push(event);
  }
  return block;
}

function applyBlock(projection, block, defaultOperator) {
  for (const event of block.events) {
    const indexedBlock = projection.transactions.get(event.transactionId);
    requireThat(indexedBlock === undefined || indexedBlock === block.hash, 'Transaction is already indexed in another block.');
    projection.transactions.set(event.transactionId, block.hash);
    applyEvent(projection, event, defaultOperator);
  }
}

function exactActiveListings(projection) {
  return [...projection.listings.values()].filter(({ status }) => status === 'active');
}

function exactActiveOffers(projection) {
  return [...projection.offers.values()].filter(({ status }) => status === 'active');
}

function authorityToken(token) {
  const [collectionId, tokenId] = tokenIdentity(token);
  requireThat(Array.isArray(token.approvedOperators) || token.approvedOperators instanceof Set, 'Missing NFT approval state.');
  const approvedOperators = [...new Set([...token.approvedOperators].map((operator) => identifier(operator, 'approval operator')))].sort();
  return { collectionId, tokenId, owner: identifier(token.owner, 'NFT owner'), approvedOperators };
}

function authorityListing(order) {
  const [collectionId, tokenId] = tokenIdentity(order);
  amount(order.price, 'listing price', true);
  return {
    listingId: identifier(order.listingId, 'listing ID'), collectionId, tokenId,
    seller: identifier(order.seller, 'listing seller'), operator: orderOperator(order), price: order.price,
  };
}

function authorityOffer(order) {
  const [collectionId, tokenId] = tokenIdentity(order);
  amount(order.price, 'offer price', true);
  amount(order.escrow, 'offer escrow');
  return {
    offerId: identifier(order.offerId, 'offer ID'), collectionId, tokenId,
    buyer: identifier(order.buyer, 'offer buyer'), seller: identifier(order.seller, 'offer seller'),
    operator: orderOperator(order), price: order.price, escrow: order.escrow,
  };
}

function compareRecords(indexed, authoritative, record, key, label) {
  requireThat(Array.isArray(authoritative), `Missing authoritative ${label} records.`);
  const onChain = new Map();
  for (const value of authoritative.map(record)) {
    const id = key(value);
    requireThat(!onChain.has(id), `Duplicate authoritative ${label} record.`);
    onChain.set(id, canonicalJson(value));
  }
  const mismatches = [];
  for (const value of indexed.map(record)) {
    const id = key(value);
    if (onChain.get(id) !== canonicalJson(value)) mismatches.push({ record: label, id, reason: onChain.has(id) ? 'different' : 'missing' });
    onChain.delete(id);
  }
  for (const id of onChain.keys()) mismatches.push({ record: label, id, reason: 'unindexed' });
  return mismatches;
}

function compareAuthority(projection, expected, observed) {
  requireThat(sameCheckpoint(checkpoint(observed?.checkpoint), expected), 'Authoritative snapshot is from a different block.');
  return [
    ...compareRecords([...projection.tokens.values()], observed.tokens, authorityToken, tokenKey, 'token'),
    ...compareRecords(exactActiveListings(projection), observed.listings, authorityListing, ({ listingId }) => listingId, 'listing'),
    ...compareRecords(exactActiveOffers(projection), observed.offers, authorityOffer, ({ offerId }) => offerId, 'offer'),
  ];
}

function approved(projection, order) {
  const token = projection.tokens.get(tokenKey(order));
  return token?.owner === order.seller && token.approvedOperators.has(order.operator);
}

/**
 * In-memory projection of a trusted, deployment-scoped canonical block feed.
 * The caller verifies network, emitter, receipts and finality before normalization.
 * Start at the block before the first tracked event and persist blocks externally.
 * Reorganizations require an explicit canonical branch replacement.
 */
export function createMarketplaceIndex({
  anchor: startingBlock = { height: 0, hash: 'mock-genesis' },
  marketplaceOperator,
} = {}) {
  const anchor = checkpoint(startingBlock);
  if (marketplaceOperator !== undefined) identifier(marketplaceOperator, 'marketplace operator');
  let blocks = [];
  let projection = createProjection();
  let revision = 0;
  let checkId = 0;
  let reconciliation = { status: 'unverified' };

  function tip() {
    return checkpoint(blocks.at(-1) ?? anchor);
  }

  function snapshot() {
    const verified = reconciliation.status === 'verified';
    return structuredClone({
      checkpoint: tip(),
      reconciliation,
      collections: [...projection.collections.values()],
      tokens: [...projection.tokens.values()].map((token) => ({
        ...token, approvedOperators: [...token.approvedOperators].sort(),
      })),
      listings: [...projection.listings.values()],
      offers: [...projection.offers.values()],
      sales: projection.sales,
      actionableListings: verified ? exactActiveListings(projection).filter((order) => approved(projection, order)) : [],
      actionableOffers: verified ? exactActiveOffers(projection).filter((order) => approved(projection, order)) : [],
    });
  }

  function link(parent, child, hashes) {
    requireThat(child.height === parent.height + 1 && child.parentHash === parent.hash, 'Block does not extend the canonical chain.');
    requireThat(!hashes.has(child.hash), 'Duplicate block hash.');
  }

  function commit(nextBlocks, nextProjection) {
    blocks = nextBlocks;
    projection = nextProjection;
    revision += 1;
    reconciliation = { status: 'unverified' };
  }

  function append(input) {
    const block = normalizeBlock(input);
    const existing = blocks.find(({ height }) => height === block.height);
    if (existing) {
      requireThat(canonicalJson(existing) === canonicalJson(block), 'Block conflicts with the current canonical chain. Replace the branch explicitly.');
      return snapshot();
    }
    link(tip(), block, new Set([anchor.hash, ...blocks.map(({ hash }) => hash)]));
    const nextProjection = structuredClone(projection);
    applyBlock(nextProjection, block, marketplaceOperator);
    commit([...blocks, block], nextProjection);
    return snapshot();
  }

  function replaceBranch(ancestorHash, inputs) {
    requireThat(Array.isArray(inputs), 'Missing canonical block sequence.');
    const ancestor = blocks.findIndex(({ hash }) => hash === ancestorHash);
    requireThat(ancestorHash === anchor.hash || ancestor >= 0, 'Unknown canonical ancestor.');
    const prefix = blocks.slice(0, ancestor + 1);
    const known = new Map(blocks.map((block) => [block.hash, block]));
    const hashes = new Set([anchor.hash, ...prefix.map(({ hash }) => hash)]);
    const suffix = [];
    let parent = prefix.at(-1) ?? anchor;
    for (const input of inputs) {
      const block = normalizeBlock(input);
      link(parent, block, hashes);
      if (known.has(block.hash)) {
        requireThat(canonicalJson(known.get(block.hash)) === canonicalJson(block), 'Conflicting data for a known block hash.');
      }
      suffix.push(block);
      hashes.add(block.hash);
      parent = block;
    }
    const nextBlocks = [...prefix, ...suffix];
    if (nextBlocks.length === blocks.length && nextBlocks.every((block, index) => block.hash === blocks[index].hash)) return snapshot();

    const nextProjection = createProjection();
    for (const block of nextBlocks) applyBlock(nextProjection, block, marketplaceOperator);
    commit(nextBlocks, nextProjection);
    return snapshot();
  }

  async function reconcile(readSnapshot) {
    requireThat(typeof readSnapshot === 'function', 'An independent chain state reader is required.');
    const expected = tip();
    const checkingRevision = revision;
    const checkingId = ++checkId;
    reconciliation = { status: 'checking', checkpoint: expected };
    let result;
    try {
      const observed = await readSnapshot({ ...expected });
      if (checkingRevision !== revision || checkingId !== checkId) return snapshot();
      const mismatches = compareAuthority(projection, expected, observed);
      result = mismatches.length
        ? { status: 'mismatch', checkpoint: expected, mismatches }
        : { status: 'verified', checkpoint: expected };
    } catch (error) {
      if (checkingRevision !== revision || checkingId !== checkId) return snapshot();
      result = { status: 'unavailable', checkpoint: expected, reason: error instanceof Error ? error.message : 'Chain state reader failed.' };
    }
    reconciliation = result;
    return snapshot();
  }

  return { append, replay: (inputs) => replaceBranch(anchor.hash, inputs), replaceBranch, snapshot, reconcile };
}
