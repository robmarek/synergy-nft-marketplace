import assert from 'node:assert/strict';
import test from 'node:test';
import { createTransactionPreview, liveCapabilities } from '../dist/transaction-preview.js';

test('the browser simulator publishes only mock receipts and never enables live trading', () => {
  assert.equal(liveCapabilities.canSettleLive, false);
  const preview = createTransactionPreview('duplicated');
  assert.equal(preview.review.settlement.fee, '3000000000');
  assert.equal(preview.review.settlement.royalty, '6000000000');
  const { receipt, checkpoint } = preview.submit('approve');
  assert.equal(receipt.mode, 'mock');
  assert.equal(receipt.status, 'finalized');
  assert.equal(checkpoint.height, 5);
  assert.deepEqual(preview.getStatus(), { receipt, checkpoint });
});

test('rejecting a mock sale leaves the indexed ledger unchanged', () => {
  const preview = createTransactionPreview('success');
  const { receipt, checkpoint } = preview.submit('reject');
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.code, 'rejected');
  assert.equal(checkpoint.height, 4);
});
