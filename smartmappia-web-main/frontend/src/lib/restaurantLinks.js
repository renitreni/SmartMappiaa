export function normalizeRestaurantName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

// Match a marketing partner name to a live merchant from the food API.
export function findLiveRestaurantMatch(partnerName, liveList) {
  const partnerKey = normalizeRestaurantName(partnerName);
  if (!partnerKey) return null;

  return (
    liveList.find((restaurant) => {
      const liveKey = normalizeRestaurantName(restaurant.name);
      return (
        liveKey === partnerKey ||
        liveKey.includes(partnerKey) ||
        partnerKey.includes(liveKey)
      );
    }) || null
  );
}

export function liveRestaurantPath(partnerName, liveList) {
  const match = findLiveRestaurantMatch(partnerName, liveList);
  if (!match?.id || match.hasMenu === false) return null;
  return `/food/r/${match.id}`;
}
