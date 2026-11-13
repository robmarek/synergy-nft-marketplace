function collectionDetails(collection, items, featured, positions) {
  const members = items.filter((item) => item.collection === collection.name);
  const prices = members
    .map((item) => positions[item.id]?.price)
    .filter((price) => Number.isSafeInteger(price) && price > 0);

  return {
    cover: collection.name === featured.name ? featured.image : members[0]?.image,
    total: members.length,
    listed: prices.length,
    floor: prices.length ? Math.min(...prices) : null,
  };
}

function stat(label, value) {
  return `<div class="collection-summary-stat">
    <dt class="collection-stat-label">${label}</dt>
    <dd class="collection-stat-value">${value}</dd>
  </div>`;
}

function priceLabel(floor, formatAmount) {
  return floor === null ? '—' : formatAmount(floor);
}

export function renderCollections({ collections, items, featured, positions, collectionHash, formatAmount, icon }) {
  if (!collections.length) {
    return `<div class="empty">${icon('layers')}<h3>No collections yet</h3><p>Collections will appear here as they’re added.</p></div>`;
  }

  const cards = collections.map((collection) => {
    const details = collectionDetails(collection, items, featured, positions);
    const hash = collectionHash(collection.name);
    const cover = details.cover
      ? `<img class="card-art" src="${details.cover}" alt="" loading="lazy">`
      : `<span class="card-art collection-art-placeholder">${icon('layers')}</span>`;

    return `<article class="card collection-card">
      <a class="card-open" href="#${hash}" aria-labelledby="${hash}-title">
        ${cover}
        <div class="card-info">
          <span class="card-kicker">${collection.category}</span>
          <span class="collection-card-title"><span class="card-name" id="${hash}-title">${collection.name}</span>${icon('arrow-up-right')}</span>
          <p class="collection-card-description">${collection.description}</p>
          <dl class="collection-card-meta">
            ${stat('NFTs', details.total)}
            ${stat('Listed', details.listed)}
            ${stat('Floor', priceLabel(details.floor, formatAmount))}
          </dl>
        </div>
      </a>
    </article>`;
  });

  return `<div class="grid collections-grid">${cards.join('')}</div>`;
}

export function renderCollectionSummary({ collection, items, featured, positions, formatAmount }) {
  const details = collectionDetails(collection, items, featured, positions);
  const cover = details.cover
    ? `<img class="collection-summary-cover" src="${details.cover}" alt="">`
    : '';

  return `<div class="collection-summary">
    <dl class="collection-summary-stats" aria-label="Collection statistics">
      ${stat('Category', collection.category)}
      ${stat('NFTs', details.total)}
      ${stat('Listed', details.listed)}
      ${stat('Floor price', priceLabel(details.floor, formatAmount))}
    </dl>
    ${cover}
  </div>`;
}
