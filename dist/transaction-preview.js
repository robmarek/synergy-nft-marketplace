import { createLiveChainGateway, createMockChainGateway } from './chain-gateway.js';
import { createMarketplaceIndex } from './market-index.js';

export const liveCapabilities = createLiveChainGateway().capabilities();

const sampleMetadata = { uri: 'https://example.com/practice.json', sha256: 'a'.repeat(64) };

export function createTransactionPreview(scenario) {
  const gateway = createMockChainGateway({
    scenario: (intent) => intent.kind === 'settle' && (scenario === 'delayed' || scenario === 'reverted') ? scenario : 'success',
    delayMs: 1200,
    balances: { 'practice-buyer': '1000000000000' },
    feeBps: 250,
  });
  const index = createMarketplaceIndex();
  const base = { network: gateway.network.network, account: 'practice-seller' };
  const collectionId = 'practice-relics';
  const token = { collectionId, tokenId: '001' };

  function seed(kind, options) {
    const prepared = gateway.prepare({ ...base, ...options, kind, idempotencyKey: kind });
    const receipt = gateway.submit(prepared, { transactionId: prepared.id, account: base.account, decision: 'approve' });
    index.append(receipt.block);
  }

  seed('createCollection', {
    collectionId, name: 'Practice Relics', symbol: 'PRAC', metadata: sampleMetadata,
    royaltyBps: 500, royaltyRecipient: 'practice-creator',
  });
  seed('mint', { ...token, owner: base.account, metadata: sampleMetadata });
  seed('approve', { ...token, operator: gateway.capabilities().operator, approved: true });
  seed('list', { ...token, listingId: 'practice-listing', price: '120000000000' });

  const prepared = gateway.prepare({
    ...base, account: 'practice-buyer', kind: 'settle', idempotencyKey: 'settle',
    orderType: 'listing', orderId: 'practice-listing', expectedPrice: '120000000000',
  });

  function state(receipt) {
    if (receipt.status === 'finalized') index.append(receipt.block);
    return { receipt, checkpoint: index.snapshot().checkpoint };
  }

  return {
    review: prepared.review,
    submit(decision) {
      const approval = { transactionId: prepared.id, account: prepared.intent.account, decision };
      const receipt = gateway.submit(prepared, approval);
      if (scenario === 'duplicated') gateway.submit(prepared, approval);
      return state(receipt);
    },
    getStatus: () => state(gateway.getReceipt(prepared.id)),
  };
}
