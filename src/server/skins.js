// Server-side skin catalog — the TRUSTED price/ownership source.
// Mirrors the client registry's ids/prices (src/public/js/theme.js) but is
// intentionally separate: the server never reads a price from the client.
// Keep the two lists in sync when adding a skin.

export const SKINS = {
  detective: { id: 'detective', label: 'Case Files', free: true, priceInDiamonds: 0 },
  space: { id: 'space', label: 'Deep Space Mission', free: false, priceInDiamonds: 120 },
  treasure: { id: 'treasure', label: 'Treasure Hunt', free: false, priceInDiamonds: 120 },
};

export function isKnownSkin(id) {
  return Object.prototype.hasOwnProperty.call(SKINS, id);
}

export function getSkin(id) {
  return SKINS[id] ?? null;
}

export function skinCatalog() {
  return Object.values(SKINS).map((s) => ({
    id: s.id,
    label: s.label,
    free: Boolean(s.free),
    priceInDiamonds: s.priceInDiamonds,
  }));
}
