import { creators, creatorFor, dropKinds, escapeHtml as escape, itemTraits, reportKinds } from './community.js';

export function renderCommunity({ collections, items, collectionHash }) {
  return `<div class="community-links">
    <a class="button primary" href="#studio">Creator Studio</a>
    <a class="button" href="#collections">Browse all collections</a>
  </div>
  <div class="grid collections-grid">${creators.map((creator) => {
    const collection = collections.find(({ name }) => name === creator.collections[0]);
    const cover = items.find((item) => item.collection === collection.name)?.image;
    if (!cover) return '';
    return `<article class="card community-creator">
      <img class="card-art" src="${cover}" alt="" loading="lazy">
      <div class="card-info">
        <span class="card-kicker">Sample creator</span>
        <h3 class="card-name"><a href="#creator-${creator.id}">${creator.name}</a></h3>
        <p>${creator.bio}</p>
        <a class="text-link" href="#${collectionHash(collection.name)}">${collection.name} ↗</a>
      </div>
    </article>`;
  }).join('')}</div>
  <section class="community-panel discovery-panel"><h3>Discover Synergy</h3>
    <p>Find creator and gaming experiences across the Synergy ecosystem.</p>
    <a class="text-link" href="https://synergy-network.io/discover-synergy" target="_blank" rel="noopener noreferrer">Synergy ecosystem guide ↗</a>
  </section>`;
}

export function renderStudio({ data, wallet, items, walletName, amount, events }) {
  const drafts = data.drafts[wallet];
  const reports = data.reports[wallet];
  const sales = events.filter((event) => ['Purchased', 'Offer accepted'].includes(event.type));
  const proceeds = sales.filter((event) => (event.type === 'Purchased' ? event.counterparty : event.wallet) === wallet);
  return `<div class="studio-grid">
    <section class="community-panel"><h3>Launchpad drafts</h3>
      <p>Plan a drop for a game collectible, an achievement, or a utility NFT. Drafts stay in this browser.</p>
      <form id="drop-form" class="listing-form">
        <label>Drop title<input name="title" required maxlength="80"></label>
        <label>Type<select name="kind">${dropKinds.map((kind) => `<option>${kind}</option>`).join('')}</select></label>
        <label>Description<textarea name="description" maxlength="500" rows="3"></textarea></label>
        <label>Artwork <small>Optional · PNG, JPEG or WebP · 5 MB max</small><input name="art" type="file" accept="image/png,image/jpeg,image/webp"></label>
        <label>Proposed creator royalty (%)<input name="royalty" type="number" min="0" max="10" step=".01" value="0" required></label>
        <p role="alert" class="studio-error" id="drop-error" hidden></p>
        <button class="button primary" type="submit">Save drop draft</button>
      </form>
    </section>
    <section class="community-panel"><h3>Creator dashboard</h3>
      <p>${walletName} · Practice sales and royalties.</p>
      <dl class="studio-stats">
        <div><dt>Sales in activity history</dt><dd>${proceeds.length}</dd></div>
        <div><dt>Simulated sale proceeds</dt><dd>${amount(proceeds.reduce((total, event) => total + event.amount, 0))}</dd></div>
        <div><dt>Royalties charged in practice</dt><dd>0%</dd></div>
      </dl>
      <h4>Saved drops</h4>
      ${drafts.length ? `<ul class="studio-list">${drafts.map((draft) => `<li>
        <strong>${escape(draft.title)}</strong><span>${draft.kind} · ${draft.royaltyBps / 100}% proposed royalty</span>
        ${draft.description ? `<p>${escape(draft.description)}</p>` : ''}
        ${draft.metadataHash ? `<small>Metadata SHA-256 <code>${draft.metadataHash}</code></small>` : ''}
        ${draft.mediaHash ? `<small>Artwork SHA-256 <code>${draft.mediaHash}</code></small>` : ''}
        <button class="button" data-action="remove-draft" data-id="${draft.id}" type="button">Remove draft</button></li>`).join('')}</ul>` : '<p>No drop drafts yet.</p>'}
    </section>
    <section class="community-panel report-panel"><h3>Reports and moderation</h3>
      <p>Review reports filed in this browser. Hiding an item removes it from your practice discovery views.</p>
      ${reports.length ? `<ul class="studio-list">${reports.map((report) => {
        const item = items.find(({ id }) => id === report.itemId);
        return `<li><strong>${item.name} · ${report.reason}</strong>
          <span>${report.status}</span>${report.notes ? `<p>${escape(report.notes)}</p>` : ''}
          <div class="modal-actions">
            ${report.status === 'Open' ? `<button class="button" data-action="resolve-report" data-id="${report.id}" type="button">Resolve report</button><button class="button" data-action="hide-reported" data-id="${report.id}" type="button">Hide NFT locally</button>` : ''}
            ${report.status === 'Hidden' ? `<button class="button" data-action="restore-reported" data-id="${report.id}" type="button">Restore NFT</button>` : ''}
          </div></li>`;
      }).join('')}</ul>` : '<p>No local reports yet.</p>'}
    </section>
  </div>`;
}

export function renderReportForm(item) {
  return `<p>Record a concern about ${item.name}. This report stays in this browser for practice review.</p>
    <form class="listing-form" data-community-form="report">
      <label>Reason<select name="reason">${reportKinds.map((reason) => `<option>${reason}</option>`).join('')}</select></label>
      <label>Details<textarea name="notes" maxlength="500" rows="3"></textarea></label>
      <button class="button primary" type="submit">Save report</button>
    </form>`;
}

export function renderItemTraits(item) {
  const { rarity, utility } = itemTraits(item);
  return `<div class="trait-tags"><span>${rarity}</span><span>${utility}</span></div>
    <p class="creator-note">Sample creator · ${creatorFor(item.collection).name}</p>`;
}

export function renderCreatorProfile({ creator, collections, items, collectionHash, icon }) {
  const featuredCollections = collections.filter(({ name }) => creator.collections.includes(name));
  return `<a class="button back-button" href="#community">${icon('left')} Community</a>
  <section class="community-panel creator-profile">
    <h3>Creator profile</h3>
    <p>${creator.bio}</p>
    <p>Sample profile · Network verification is pending.</p>
    <h4>Curated collections</h4>
    <ul class="studio-list">${featuredCollections.map((collection) => {
      const count = items.filter((item) => item.collection === collection.name).length;
      return `<li><a class="text-link" href="#${collectionHash(collection.name)}">${collection.name} ↗</a>
        <span>${count} ${count === 1 ? 'collectible' : 'collectibles'}</span><p>${collection.description}</p></li>`;
    }).join('')}</ul>
  </section>`;
}
