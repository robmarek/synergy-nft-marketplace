export const creators = [
  { id: 'genesis-studio', name: 'Genesis Studio', collections: ['Genesis Relics'], bio: 'Concept artists imagining the first expeditions across the Synergy ecosystem.' },
  { id: 'frontier-foundry', name: 'Frontier Foundry', collections: ['Frontier Gear'], bio: 'Game-item designers working on gear, spacecraft, and collectible equipment.' },
  { id: 'deep-field-atelier', name: 'Deep Field Atelier', collections: ['Deep Field'], bio: 'Digital artists exploring planets, nebulae, and uncharted space.' },
];

export const rarities = ['Legendary', 'Epic', 'Rare', 'Uncommon', 'Common'];

const traits = {
  1: { rarity: 'Rare', utility: 'Game collectible' },
  2: { rarity: 'Common', utility: 'Game collectible' },
  3: { rarity: 'Epic', utility: 'Digital artwork' },
  4: { rarity: 'Epic', utility: 'Game equipment' },
  5: { rarity: 'Uncommon', utility: 'Game collectible' },
  6: { rarity: 'Legendary', utility: 'Achievement collectible' },
};

export function itemTraits(item) {
  return traits[item.id];
}

export function creatorFor(collection) {
  return creators.find((creator) => creator.collections.includes(collection));
}

export const communityKey = 'synergy-marketplace-community-v1';
export const dropKinds = ['Game collectible', 'Achievement', 'Utility NFT'];
export const reportKinds = ['Counterfeit', 'Intellectual property', 'Unsafe media', 'Misleading listing'];

function validId(id) {
  return typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id);
}

function safeRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

export function readCommunity(raw, items) {
  let parsed;
  try { parsed = JSON.parse(raw); } catch { parsed = null; }
  const ids = new Set(items.map(({ id }) => id));
  const stored = safeRecord(parsed) ? parsed : {};
  const alerts = {};
  const drafts = {};
  const reports = {};
  const wallets = ['collector', 'trader'];
  for (const wallet of wallets) {
    alerts[wallet] = {};
    drafts[wallet] = [];
    reports[wallet] = [];
    for (const [id, amount] of Object.entries(stored.alerts?.[wallet] ?? {})) {
      if (ids.has(Number(id)) && Number.isSafeInteger(amount) && amount > 0 && amount <= 100000000) alerts[wallet][Number(id)] = amount;
    }
    if (Array.isArray(stored.drafts?.[wallet])) {
      drafts[wallet] = stored.drafts[wallet].filter((draft) => safeRecord(draft) && validId(draft.id)
        && typeof draft.title === 'string' && draft.title.length > 0 && draft.title.length <= 80
        && dropKinds.includes(draft.kind) && typeof draft.description === 'string' && draft.description.length <= 500
        && typeof draft.mediaHash === 'string' && /^(?:[a-f0-9]{64})?$/.test(draft.mediaHash)
        && (draft.metadataHash === undefined || (typeof draft.metadataHash === 'string' && /^[a-f0-9]{64}$/.test(draft.metadataHash)))
        && Number.isSafeInteger(draft.royaltyBps) && draft.royaltyBps >= 0 && draft.royaltyBps <= 1000
      ).slice(0, 20);
    }
    if (Array.isArray(stored.reports?.[wallet])) {
      reports[wallet] = stored.reports[wallet].filter((report) => safeRecord(report) && validId(report.id) && ids.has(report.itemId)
        && reportKinds.includes(report.reason) && typeof report.notes === 'string' && report.notes.length <= 500
        && ['Open', 'Resolved', 'Hidden'].includes(report.status)).slice(0, 30);
    }
  }
  return { alerts, drafts, reports };
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

export async function sha256(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error('Media verification requires HTTPS or localhost.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function canonicalMetadata(item) {
  return JSON.stringify({
    name: item.name, collection: item.collection, category: item.category,
    description: item.description, edition: item.edition, traits: itemTraits(item), image: item.image,
  });
}

export async function verifyItemIntegrity(item, expected, fetchResource = fetch) {
  if (!expected || !/^[a-f0-9]{64}$/.test(expected.image) || !/^[a-f0-9]{64}$/.test(expected.metadata)) {
    throw new Error('This sample is missing its published integrity hashes.');
  }
  const response = await fetchResource(item.image, { credentials: 'same-origin' });
  if (!response.ok) throw new Error('Sample artwork could not be loaded.');
  const [image, metadata] = await Promise.all([
    sha256(await response.arrayBuffer()),
    sha256(new TextEncoder().encode(canonicalMetadata(item))),
  ]);
  if (image !== expected.image || metadata !== expected.metadata) throw new Error('The artwork or metadata differs from its published hash.');
  return expected;
}
