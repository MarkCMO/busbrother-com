function nearbyCities(city, allCities, limit = 6) {
  if (!city.lat || !city.lng) return allCities.filter(c => c.slug !== city.slug).slice(0, limit);
  return allCities
    .filter(c => c.slug !== city.slug && c.lat && c.lng)
    .map(c => ({ ...c, dist: haversine(city.lat, city.lng, c.lat, c.lng) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, limit);
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function cityAttractions(citySlug, attractions) {
  return attractions.filter(a => a.citySlug === citySlug);
}

function relevantServices(pageType, services) {
  return services;
}

module.exports = { nearbyCities, cityAttractions, relevantServices, haversine };
