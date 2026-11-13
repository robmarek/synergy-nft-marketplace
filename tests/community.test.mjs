import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { items } from '../dist/catalog.js';
import { catalogIntegrity } from '../dist/catalog-integrity.js';
import { escapeHtml, readCommunity, verifyItemIntegrity } from '../dist/community.js';

test('all catalog artwork and canonical metadata match their published hashes', async () => {
  const fetchAsset = async (path) => new Response(await readFile(new URL('../dist/' + path, import.meta.url)));
  for (const item of items) {
    assert.deepEqual(await verifyItemIntegrity(item, catalogIntegrity[item.id], fetchAsset), catalogIntegrity[item.id]);
  }
  await assert.rejects(verifyItemIntegrity(items[0], catalogIntegrity[1], async () => new Response('replacement')), /differs/);
  await assert.rejects(verifyItemIntegrity({ ...items[0], description: 'edited' }, catalogIntegrity[1], fetchAsset), /differs/);
});

test('community storage sanitizes records, isolates wallets, and escapes user text', () => {
  const id = 'd80081d2-68c8-4693-9c9a-0a67f9f407de';
  const data = readCommunity(JSON.stringify({
    alerts: { collector: { 1: 12500, 2: -4, 99: 450 }, trader: { 2: 400 } },
    drafts: { collector: [{ id, title: '<img>', kind: 'Achievement', description: '', mediaHash: '', royaltyBps: 0 }] },
    reports: { trader: [{ id, itemId: 1, reason: 'Counterfeit', notes: '', status: 'Hidden' }] },
  }), items);
  assert.deepEqual(data.alerts, { collector: { 1: 12500 }, trader: { 2: 400 } });
  assert.equal(data.drafts.collector.length, 1);
  assert.equal(data.drafts.trader.length, 0);
  assert.equal(data.reports.collector.length, 0);
  assert.equal(data.reports.trader[0].status, 'Hidden');
  assert.equal(escapeHtml(data.drafts.collector[0].title), '&lt;img&gt;');
  assert.deepEqual(readCommunity('corrupt data', items).alerts, { collector: {}, trader: {} });
});
