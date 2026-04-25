#!/usr/bin/env node
/**
 * BusBrother.com Static Site Generator
 * Generates ~5000 pages from JSON data + HTML templates
 */

const fs = require('fs');
const path = require('path');
const { render, loadTemplate } = require('./lib/template-engine');
const { pick, pickN, fillTokens } = require('./lib/content-generator');
const { nearbyCities, cityAttractions, haversine } = require('./lib/link-builder');
const { generateSitemapIndex, generateSubSitemap, generateLlmSitemap, generateRobots } = require('./lib/sitemap-generator');

const DIST = path.join(__dirname, 'dist');
const DATA = path.join(__dirname, 'data');
const STATIC = path.join(__dirname, 'static');

// ── Helpers ───────────────────────────────────────────────
function loadJSON(name) {
  const fp = path.join(DATA, name + '.json');
  if (!fs.existsSync(fp)) { console.warn(`  WARN: ${name}.json not found, using empty array`); return []; }
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writePage(urlPath, html) {
  const dir = path.join(DIST, urlPath);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, 'index.html'), html);
}

function copyDirSync(src, dest) {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}

// ── Load Data ─────────────────────────────────────────────
console.log('Loading data...');
const cities = loadJSON('cities');
const services = loadJSON('services');
const attractions = loadJSON('attractions');
const routes = loadJSON('routes');
const venues = loadJSON('venues');
const hotels = loadJSON('hotels');
const schools = loadJSON('schools');
const airports = loadJSON('airports');
const cruisePorts = loadJSON('cruise-ports');
const neighborhoods = loadJSON('neighborhoods');
const seasonalEvents = loadJSON('seasonal-events');
const sportsVenues = loadJSON('sports-venues');
const blogTopics = loadJSON('blog-topics');
const guides = loadJSON('guides');
const restaurants = loadJSON('restaurants');
const cruiseLines = loadJSON('cruise-lines');
const scenicRoutes = loadJSON('scenic-routes');
const thingsToDo = loadJSON('things-to-do');
const themeParkGuides = loadJSON('theme-park-guides');
const portTerminals = loadJSON('port-terminals');
const hotelAreaGuides = loadJSON('hotel-area-guides');
const busSizes = loadJSON('bus-sizes');
const images = (() => { try { return JSON.parse(fs.readFileSync(path.join(DATA, 'images.json'), 'utf8')); } catch(e) { return {}; } })();

// Build lookup maps
const cityMap = {};
cities.forEach(c => { cityMap[c.slug] = c; });
const serviceMap = {};
services.forEach(s => { serviceMap[s.slug] = s; });

// Footer cities (top 10)
const footerCities = cities.filter(c => c.tier === 1).slice(0, 10);

// ── Image helper ──────────────────────────────────────────
function getImageForService(serviceSlug) {
  for (const [key, img] of Object.entries(images)) {
    if (img.services && img.services.includes(serviceSlug)) return img;
  }
  return null;
}

// ── Content blocks for unique paragraphs ──────────────────
const introBlocks = {
  'city-landing': [
    "{{cityName}} is one of Central Florida's most popular destinations for group travel. BusBrother provides reliable charter bus and shuttle service throughout the {{cityName}} area, connecting your group to cruise ports, airports, theme parks, beaches, and events across the state.",
    "Looking for charter bus service in {{cityName}}, Florida? BusBrother provides professional group transportation for corporate events, school field trips, wedding parties, cruise transfers, and more. Our drivers know {{countyName}} roads and traffic patterns inside and out.",
    "Whether you are planning a corporate outing, school field trip, or family reunion in {{cityName}}, BusBrother is your local group transportation expert. We serve {{cityName}} and all surrounding areas with motorcoaches and minibuses holding 15 to 57 passengers.",
    "BusBrother brings full-service charter bus transportation directly to {{cityName}} groups. From airport pickups to cruise port transfers, theme park day trips to corporate event shuttles, we handle every detail so your group can travel together in comfort.",
    "{{cityName}} groups trust BusBrother for all their charter bus and shuttle needs. Located in the heart of Central Florida, we provide door-to-door group transportation with professional drivers, climate-controlled vehicles, and 24/7 availability."
  ],
  'why-choose': [
    "BusBrother has extensive experience serving the {{cityName}} area with professional drivers who know local roads, traffic patterns, and the fastest routes to every major destination in Florida. Our fleet is fully licensed, insured, and maintained to the highest safety standards.",
    "Our drivers live and work in Central Florida - they know {{cityName}} and {{countyName}} like the back of their hand. Every BusBrother vehicle is climate-controlled, professionally cleaned before each trip, and equipped for your comfort. We are available 24/7 including holidays.",
    "When you book BusBrother from {{cityName}}, you get more than a bus - you get a transportation partner. We monitor traffic in real time, adjust routes as needed, and communicate proactively so your group arrives on time, every time. ADA accessible vehicles available on request.",
    "Groups in {{cityName}} choose BusBrother because we combine local expertise with professional service. Every driver undergoes background checks and drug testing. Every vehicle is DOT compliant. And every quote includes luggage assistance, meet-and-greet, and no hidden fees."
  ],
  'service-city': [
    "Need {{serviceName}} in {{cityName}}? BusBrother is your local expert for professional {{serviceNameLower}} serving groups throughout {{cityName}} and {{countyName}}. Our fleet of motorcoaches and minibuses holds 15 to 57 passengers with luggage storage, climate control, and professional drivers.",
    "BusBrother brings professional {{serviceNameLower}} directly to groups in {{cityName}}, Florida. Whether you need a one-way trip, round trip with return service, or multi-stop itinerary, we customize every trip to your group's specific needs and schedule.",
    "{{cityName}} groups looking for {{serviceNameLower}} choose BusBrother for our combination of local knowledge, professional service, and competitive pricing. We serve the entire {{cityName}} area with pickup from any hotel, office, school, or private address.",
    "Book {{serviceNameLower}} in {{cityName}} with BusBrother and experience the difference professional group transportation makes. Our drivers know the best routes, handle all logistics, and ensure your group arrives together, on time, and stress-free."
  ],
  'corporate-city': [
    "{{cityName}} is a major hub for corporate events, conferences, and business travel in Florida. BusBrother provides professional corporate charter bus service for companies and organizations hosting events in the {{cityName}} area, from small executive groups to full-scale conventions.",
    "Planning a corporate event in {{cityName}}? BusBrother handles all group transportation logistics so your team can focus on business. We coordinate hotel-to-venue shuttles, airport transfers for attendees, and evening event transportation across {{cityName}} and surrounding areas.",
    "BusBrother is the preferred corporate transportation provider for companies and event planners in {{cityName}}, Florida. We offer dedicated event coordinators for large groups, multi-bus fleet deployment, and customized scheduling to match your conference or retreat agenda."
  ]
};

function getIntro(type, slug, ctx) {
  const blocks = introBlocks[type] || introBlocks['city-landing'];
  const template = pick(slug, blocks);
  return fillTokens(template, ctx);
}

function getWhyChoose(slug, ctx) {
  const template = pick(slug, introBlocks['why-choose'], 'why');
  return fillTokens(template, ctx);
}

// ── City FAQs ─────────────────────────────────────────────
const cityFaqTemplates = [
  { q: "How far in advance should I book a charter bus from {{cityName}}?", a: "We recommend booking at least 1-2 weeks in advance for standard trips and 3-4 weeks for peak season events. Same-day availability is sometimes possible but not guaranteed." },
  { q: "What size buses does BusBrother have for {{cityName}} groups?", a: "We offer minibuses (15-30 passengers) and full motorcoaches (45-57 passengers). For groups over 57, we coordinate multi-bus service." },
  { q: "Do you offer round trip service from {{cityName}}?", a: "Yes, we offer one-way, round trip, and multi-stop service from {{cityName}}. Select your preferred trip type when requesting a quote." },
  { q: "Are BusBrother vehicles ADA accessible?", a: "Yes, we have ADA wheelchair accessible vehicles available on request. Please indicate your accessibility needs when booking." },
  { q: "Can you pick up from multiple locations in {{cityName}}?", a: "Absolutely. We offer multi-stop pickup from hotels, offices, homes, and other locations in the {{cityName}} area. Additional stops are coordinated into your trip itinerary." },
  { q: "What is included in the charter bus price?", a: "Every BusBrother quote includes the vehicle, professional driver, fuel, luggage assistance, and meet-and-greet service. No hidden fees or surge pricing." },
  { q: "Do you provide transportation for corporate events in {{cityName}}?", a: "Yes, corporate transportation is one of our specialties. We handle conference shuttles, team building outings, airport transfers for attendees, and evening event transportation." },
  { q: "Can I book a bus for a wedding in {{cityName}}?", a: "Yes, we provide wedding guest shuttle service for ceremonies and receptions throughout {{cityName}} and the surrounding area. Our drivers wear professional attire." }
];

function getCityFaqs(slug, ctx, count = 5) {
  const selected = pickN(slug, cityFaqTemplates, count, 'faq');
  return selected.map(f => ({
    q: fillTokens(f.q, ctx),
    a: fillTokens(f.a, ctx)
  }));
}

// ── FAQ Schema Builder ────────────────────────────────────
function buildFaqSchema(faqs) {
  if (!faqs || !faqs.length) return '';
  return faqs.map(f => {
    const q = String(f.q).replace(/"/g, '\\"');
    const a = String(f.a).replace(/"/g, '\\"');
    return `{"@type":"Question","name":"${q}","acceptedAnswer":{"@type":"Answer","text":"${a}"}}`;
  }).join(',');
}

// ── Page Counters ─────────────────────────────────────────
let totalPages = 0;
const sitemapUrls = {
  areas: [], services: [], attractions: [], routes: [],
  venues: [], hotels: [], schools: [], airports: [],
  events: [], sports: [], blog: [], corporate: [],
  weddings: [], neighborhoods: [], other: [],
  'svc-attractions': [], 'city-attractions': [],
  'svc-events': [], 'svc-venues': [], 'neighborhood-svc': [],
  guides: [], dining: [], 'cruise-lines-pages': [],
  'scenic-drives': [], 'things-to-do-pages': [],
  'theme-parks-pages': [], 'port-terminals-pages': [],
  'hotel-guides-pages': [], 'expanded-routes': []
};

function track(section, urlPath, priority = '0.5') {
  totalPages++;
  const loc = urlPath === '/' ? '/' : urlPath.replace(/\/+$/, '') + '/';
  sitemapUrls[section].push({ loc, priority });
}

// ── Load Templates ────────────────────────────────────────
console.log('Loading templates...');
const templates = {};
const templateNames = [
  'homepage', 'city-landing', 'service-city', 'service-hub', 'attraction', 'route',
  'blog-post', 'blog-index', 'venue', 'hotel-shuttle', 'school-transport',
  'seasonal-event', 'sports-venue', 'corporate-city', 'wedding-venue',
  'neighborhood', 'airport-transfer', 'index-areas',
  'about', 'fleet', 'faq', 'book', 'contact', 'thank-you', 'job-page', 'admin-jobs', 'terms', 'pricing',
  'how-it-works', 'reviews', 'ada-accessibility', 'safety', 'bus-size', 'privacy',
  'church-bus', 'employee-shuttle', 'conference-shuttle', 'government-military', 'movie-production',
  'wedding-transportation-guide', 'cruise-port-guide', 'corporate-event-planning',
  'school-field-trip-guide', 'charter-bus-vs-alternatives', 'airport-transfer-guide',
  'guide', 'restaurant', 'cruise-line', 'scenic-route',
  'things-to-do', 'theme-park-guide', 'port-guide', 'hotel-area-guide',
  'service-attraction', 'city-attraction'
];
for (const name of templateNames) {
  try { templates[name] = loadTemplate(name); }
  catch(e) { console.warn(`  WARN: template ${name} not found`); }
}

// ══════════════════════════════════════════════════════════
//  PHASE 1: GENERATE PAGES
// ══════════════════════════════════════════════════════════
console.log('Generating pages...');
const startTime = Date.now();

// ── 1. Homepage ───────────────────────────────────────────
if (templates['homepage']) {
  const html = render(templates['homepage'], {
    pageTitle: 'BusBrother | Charter Bus & Group Transportation - Central Florida',
    metaDescription: 'Central Florida charter bus and group transportation. Cruise port shuttles, airport transfers, corporate charters, wedding transportation, theme park shuttles. Serving 120+ cities from Tampa to Fort Lauderdale. Available 24/7.',
    canonicalPath: '/',
    geoPlacename: 'Central Florida',
    geoPosition: '28.3922;-80.6077',
    footerCities
  });
  ensureDir(DIST);
  fs.writeFileSync(path.join(DIST, 'index.html'), html);
  totalPages++;
  sitemapUrls.other.push({ loc: '/', priority: '1.0', freq: 'daily' });
}

// ── 2. City Landing Pages ─────────────────────────────────
if (templates['city-landing']) {
  console.log('  City pages...');
  for (const city of cities) {
    const ctx = {
      cityName: city.name, citySlug: city.slug, countyName: city.county,
      regionName: city.region, cityZip: city.zip, cityPopulation: city.population,
      cityEmoji: city.emoji || '📍',
      serviceName: '', serviceNameLower: ''
    };
    const slug = `city-${city.slug}`;
    const nearby = nearbyCities(city, cities, 6);
    const localAttractions = cityAttractions(city.slug, attractions).slice(0, 8);
    const img = getImageForService(city.tier === 1 ? 'theme-parks' : 'hotel-shuttle');

    const html = render(templates['city-landing'], {
      ...ctx,
      pageTitle: `Charter Bus ${city.name} FL - Group Transportation | BusBrother`,
      metaDescription: `Professional charter bus and group transportation in ${city.name}, Florida. Cruise port shuttles, airport transfers, corporate charters, wedding transportation. Available 24/7.`,
      canonicalPath: `/areas/${city.slug}`,
      geoPlacename: `${city.name}, Florida`,
      geoPosition: city.lat && city.lng ? `${city.lat};${city.lng}` : '28.3922;-80.6077',
      introContent: getIntro('city-landing', slug, ctx),
      whyChooseContent: getWhyChoose(slug, ctx),
      heroImage: img ? true : false,
      heroImageFile: img ? img.file : '',
      heroImageAlt: img ? img.alt : '',
      serviceLinks: services.map(s => ({ ...s, citySlug: city.slug })),
      nearbyAttractions: localAttractions,
      nearbyCities: nearby,
      faqs: getCityFaqs(slug, ctx),
      faqSchema: buildFaqSchema(getCityFaqs(slug, ctx)),
      footerCities
    });
    writePage(`/areas/${city.slug}`, html);
    track('areas', `/areas/${city.slug}`, city.tier === 1 ? '0.9' : city.tier === 2 ? '0.7' : '0.5');
  }
}

// ── 3. Service + City Combo Pages ─────────────────────────
if (templates['service-city']) {
  console.log('  Service+City pages...');
  for (const city of cities) {
    for (const svc of services) {
      const ctx = {
        cityName: city.name, citySlug: city.slug, countyName: city.county,
        serviceName: svc.name, serviceNameLower: svc.name.toLowerCase(),
        serviceSlug: svc.slug, serviceEmoji: svc.emoji || ''
      };
      const slug = `svc-${city.slug}-${svc.slug}`;
      const nearby = nearbyCities(city, cities, 5);
      const img = getImageForService(svc.slug);
      const otherSvcs = services.filter(s => s.slug !== svc.slug).slice(0, 6);

      const html = render(templates['service-city'], {
        ...ctx,
        pageTitle: `${svc.name} ${city.name} FL | BusBrother`,
        metaDescription: `Professional ${svc.name.toLowerCase()} for groups in ${city.name}, Florida. Licensed, insured, available 24/7. Get a free quote from BusBrother.`,
        canonicalPath: `/areas/${city.slug}/${svc.slug}`,
        geoPlacename: `${city.name}, Florida`,
        geoPosition: city.lat && city.lng ? `${city.lat};${city.lng}` : '28.3922;-80.6077',
        introContent: getIntro('service-city', slug, ctx),
        whyChooseContent: getWhyChoose(slug, ctx),
        heroImage: img ? true : false,
        heroImageFile: img ? img.file : '',
        heroImageAlt: img ? img.alt : '',
        serviceFeatures: svc.features || [],
        faqs: (svc.faqs || []).slice(0, 3),
        faqSchema: buildFaqSchema((svc.faqs || []).slice(0, 3)),
        otherServices: otherSvcs.map(s => ({ ...s, citySlug: city.slug })),
        nearbyCities: nearby.map(c => ({ ...c, serviceSlug: svc.slug })),
        footerCities
      });
      writePage(`/areas/${city.slug}/${svc.slug}`, html);
      track('services', `/areas/${city.slug}/${svc.slug}`, '0.5');
    }
  }
}

// ── 4. Attraction Pages ───────────────────────────────────
if (templates['attraction']) {
  console.log('  Attraction pages...');
  for (const attr of attractions) {
    const city = cityMap[attr.citySlug] || { name: 'Florida', slug: 'orlando' };
    const nearbyAttrs = attractions.filter(a => a.slug !== attr.slug && a.citySlug === attr.citySlug).slice(0, 6);
    if (nearbyAttrs.length < 6) {
      const others = attractions.filter(a => a.slug !== attr.slug && a.citySlug !== attr.citySlug).slice(0, 6 - nearbyAttrs.length);
      nearbyAttrs.push(...others);
    }
    const svcLinks = (attr.popularServices || []).map(s => serviceMap[s]).filter(Boolean);
    const img = getImageForService(attr.type === 'theme-park' ? 'theme-parks' : attr.type === 'beach' ? 'hotel-shuttle' : 'corporate-charter');

    const html = render(templates['attraction'], {
      attractionName: attr.name, attractionEmoji: attr.emoji || '📍',
      attractionDescription: attr.description || '',
      attractionAddress: attr.address || `${city.name}, FL`,
      attractionType: (attr.type || '').replace(/-/g, ' '),
      transportNotes: attr.transportNotes || `BusBrother provides group charter bus service to ${attr.name} from any location in Central Florida.`,
      cityName: city.name, citySlug: city.slug,
      heroImage: img ? true : false,
      heroImageFile: img ? img.file : '',
      heroImageAlt: img ? img.alt : '',
      tips: attr.tips || [],
      popularServiceLinks: svcLinks,
      nearbyAttractions: nearbyAttrs.slice(0, 6),
      pageTitle: `${attr.name} Group Transportation | BusBrother`,
      metaDescription: `Charter bus and group shuttle to ${attr.name} in ${city.name}, FL. Book BusBrother for reliable group transportation.`,
      canonicalPath: `/attractions/${attr.slug}`,
      geoPlacename: `${city.name}, Florida`,
      geoPosition: attr.lat && attr.lng ? `${attr.lat};${attr.lng}` : '28.3922;-80.6077',
      footerCities
    });
    writePage(`/attractions/${attr.slug}`, html);
    track('attractions', `/attractions/${attr.slug}`, '0.6');
  }
}

// ── 5. Route Pages ────────────────────────────────────────
if (templates['route']) {
  console.log('  Route pages...');
  const routePairs = new Set();
  for (const route of routes) {
    const from = cityMap[route.fromSlug];
    const to = cityMap[route.toSlug];
    if (!from || !to) continue;
    const pairKey = `${route.fromSlug}-${route.toSlug}`;
    if (routePairs.has(pairKey)) continue;
    routePairs.add(pairKey);

    // Forward direction
    const html = render(templates['route'], {
      fromName: from.name, toName: to.name,
      distanceMiles: route.distanceMiles || '~',
      driveMinutes: route.driveMinutes || '~',
      highway: route.highway || 'Florida highways',
      routeDescription: route.description || `BusBrother provides charter bus service from ${from.name} to ${to.name}, Florida.`,
      popularReasons: route.popularReasons || ['group travel', 'event transportation', 'airport transfer'],
      reverseSlug: `${to.slug}-to-${from.slug}`,
      pageTitle: `${from.name} to ${to.name} Charter Bus | BusBrother`,
      metaDescription: `Group bus from ${from.name} to ${to.name} FL. ${route.distanceMiles || '~'} miles, ~${route.driveMinutes || '~'} min. Charter bus, round trip, multi-stop. Get a free quote.`,
      canonicalPath: `/routes/${from.slug}-to-${to.slug}`,
      geoPlacename: `${from.name}, Florida`,
      geoPosition: from.lat && from.lng ? `${from.lat};${from.lng}` : '28.3922;-80.6077',
      footerCities
    });
    writePage(`/routes/${from.slug}-to-${to.slug}`, html);
    track('routes', `/routes/${from.slug}-to-${to.slug}`);

    // Reverse direction
    const revKey = `${route.toSlug}-${route.fromSlug}`;
    if (!routePairs.has(revKey)) {
      routePairs.add(revKey);
      const revHtml = render(templates['route'], {
        fromName: to.name, toName: from.name,
        distanceMiles: route.distanceMiles || '~',
        driveMinutes: route.driveMinutes || '~',
        highway: route.highway || 'Florida highways',
        routeDescription: `BusBrother provides charter bus service from ${to.name} to ${from.name}, Florida. The return route follows ${route.highway || 'Florida highways'}.`,
        popularReasons: route.popularReasons || ['group travel', 'event transportation', 'return trip'],
        reverseSlug: `${from.slug}-to-${to.slug}`,
        pageTitle: `${to.name} to ${from.name} Charter Bus | BusBrother`,
        metaDescription: `Group bus from ${to.name} to ${from.name} FL. ${route.distanceMiles || '~'} miles, ~${route.driveMinutes || '~'} min. Get a free quote.`,
        canonicalPath: `/routes/${to.slug}-to-${from.slug}`,
        geoPlacename: `${to.name}, Florida`,
        geoPosition: to.lat && to.lng ? `${to.lat};${to.lng}` : '28.3922;-80.6077',
        footerCities
      });
      writePage(`/routes/${to.slug}-to-${from.slug}`, revHtml);
      track('routes', `/routes/${to.slug}-to-${from.slug}`);
    }
  }
}

// ── 6. Venue Pages ────────────────────────────────────────
if (templates['venue'] && venues.length) {
  console.log('  Venue pages...');
  for (const v of venues) {
    const city = cityMap[v.citySlug] || { name: 'Florida' };
    const html = render(templates['venue'], {
      venueName: v.name, venueEmoji: v.emoji || '🏢',
      venueDescription: v.description || '',
      venueAddress: v.address || `${city.name}, FL`,
      venueCapacity: v.capacity || 'Varies',
      venueType: (v.type || '').replace(/-/g, ' '),
      cityName: city.name,
      transportNeeds: v.transportNeeds || [],
      popularEvents: v.popularEvents || [],
      pageTitle: `${v.name} Group Transportation | BusBrother`,
      metaDescription: `Charter bus and shuttle for events at ${v.name} in ${city.name}, FL. Corporate, wedding, and group transportation.`,
      canonicalPath: `/venues/${v.slug}`,
      geoPlacename: `${city.name}, Florida`,
      geoPosition: '28.3922;-80.6077',
      footerCities
    });
    writePage(`/venues/${v.slug}`, html);
    track('venues', `/venues/${v.slug}`);
  }
}

// ── 7. Corporate City Pages ───────────────────────────────
if (templates['corporate-city']) {
  console.log('  Corporate pages...');
  for (const city of cities) {
    const ctx = { cityName: city.name, countyName: city.county };
    const cityVenues = venues.filter(v => v.citySlug === city.slug).slice(0, 6);
    const img = getImageForService('corporate-charter');
    const html = render(templates['corporate-city'], {
      ...ctx, citySlug: city.slug,
      introContent: getIntro('corporate-city', `corp-${city.slug}`, ctx),
      heroImage: img ? true : false,
      heroImageFile: img ? img.file : '',
      heroImageAlt: img ? img.alt : '',
      cityVenues,
      pageTitle: `Corporate Charter Bus ${city.name} FL | BusBrother`,
      metaDescription: `Corporate charter bus service in ${city.name}, FL. Conferences, retreats, team events, employee shuttles. Professional group transportation.`,
      canonicalPath: `/corporate/${city.slug}`,
      geoPlacename: `${city.name}, Florida`,
      geoPosition: city.lat && city.lng ? `${city.lat};${city.lng}` : '28.3922;-80.6077',
      footerCities
    });
    writePage(`/corporate/${city.slug}`, html);
    track('corporate', `/corporate/${city.slug}`);
  }
}

// ── 8. Wedding Venue Pages ────────────────────────────────
if (templates['wedding-venue']) {
  console.log('  Wedding pages...');
  const weddingVenues = venues.filter(v => v.type === 'wedding-venue' || v.type === 'hotel-resort' || v.type === 'waterfront-venue' || v.type === 'country-club');
  // If not enough wedding venues, use all venues
  const wVenues = weddingVenues.length > 10 ? weddingVenues : venues;
  for (const v of wVenues) {
    const city = cityMap[v.citySlug] || { name: 'Florida' };
    const img = getImageForService('wedding-events');
    const html = render(templates['wedding-venue'], {
      venueName: v.name, cityName: city.name,
      heroImage: img ? true : false,
      heroImageFile: img ? img.file : '',
      heroImageAlt: img ? img.alt : '',
      pageTitle: `Wedding Transportation ${v.name} | BusBrother`,
      metaDescription: `Wedding guest shuttle to ${v.name} in ${city.name}, FL. Elegant transportation for ceremonies and receptions.`,
      canonicalPath: `/weddings/${v.slug}`,
      geoPlacename: `${city.name}, Florida`,
      geoPosition: '28.3922;-80.6077',
      footerCities
    });
    writePage(`/weddings/${v.slug}`, html);
    track('weddings', `/weddings/${v.slug}`);
  }
}

// ── 9. Hotel Shuttle Pages ────────────────────────────────
if (templates['hotel-shuttle'] && hotels.length) {
  console.log('  Hotel pages...');
  for (const h of hotels) {
    const city = cityMap[h.citySlug] || { name: 'Florida' };
    const html = render(templates['hotel-shuttle'], {
      hotelName: h.name, hotelDescription: h.description || '',
      cityName: city.name,
      transportNeeds: h.transportNeeds || ['cruise-shuttle', 'airport-transfers', 'theme-parks'],
      pageTitle: `${h.name} Shuttle Service | BusBrother`,
      metaDescription: `Group shuttle from ${h.name} in ${city.name}, FL. Cruise port, airport, theme park, and event transportation.`,
      canonicalPath: `/hotels/${h.slug}`,
      geoPlacename: `${city.name}, Florida`,
      geoPosition: '28.3922;-80.6077',
      footerCities
    });
    writePage(`/hotels/${h.slug}`, html);
    track('hotels', `/hotels/${h.slug}`);
  }
}

// ── 10. School Transport Pages ────────────────────────────
if (templates['school-transport'] && schools.length) {
  console.log('  School pages...');
  for (const s of schools) {
    const city = cityMap[s.citySlug] || { name: 'Florida' };
    const html = render(templates['school-transport'], {
      schoolName: s.name, schoolDescription: s.description || '',
      cityName: city.name,
      pageTitle: `${s.name} Group Bus Service | BusBrother`,
      metaDescription: `Charter bus and field trip transportation for ${s.name} in ${city.name}, FL. School groups, athletics, campus events.`,
      canonicalPath: `/schools/${s.slug}`,
      geoPlacename: `${city.name}, Florida`,
      geoPosition: '28.3922;-80.6077',
      footerCities
    });
    writePage(`/schools/${s.slug}`, html);
    track('schools', `/schools/${s.slug}`);
  }
}

// ── 11. Seasonal Event Pages ──────────────────────────────
if (templates['seasonal-event'] && seasonalEvents.length) {
  console.log('  Event pages...');
  for (const ev of seasonalEvents) {
    const city = cityMap[ev.citySlug] || { name: 'Florida' };
    const img = getImageForService((ev.popularServices || [])[0] || 'theme-parks');
    const html = render(templates['seasonal-event'], {
      eventName: ev.name, eventEmoji: ev.emoji || '🎉',
      eventDescription: ev.description || '',
      eventMonths: (ev.months || []).join(', '),
      transportNotes: ev.transportNotes || `BusBrother provides group shuttle service for ${ev.name} attendees.`,
      cityName: city.name, citySlug: city.slug,
      heroImage: img ? true : false,
      heroImageFile: img ? img.file : '',
      heroImageAlt: img ? img.alt : '',
      pageTitle: `${ev.name} Transportation | BusBrother`,
      metaDescription: `Group bus and shuttle for ${ev.name} in ${city.name}, FL. Hotel pickups, round trip, multi-stop service.`,
      canonicalPath: `/events/${ev.slug}`,
      geoPlacename: `${city.name}, Florida`,
      geoPosition: '28.3922;-80.6077',
      footerCities
    });
    writePage(`/events/${ev.slug}`, html);
    track('events', `/events/${ev.slug}`);
  }
}

// ── 12. Sports Venue Pages ────────────────────────────────
if (templates['sports-venue'] && sportsVenues.length) {
  console.log('  Sports pages...');
  for (const sv of sportsVenues) {
    const city = cityMap[sv.citySlug] || { name: 'Florida' };
    const html = render(templates['sports-venue'], {
      venueName: sv.name, venueEmoji: sv.emoji || '🏟️',
      venueDescription: sv.description || '',
      venueCapacity: sv.capacity || 'Varies',
      cityName: city.name,
      majorEvents: sv.majorEvents || [],
      pageTitle: `${sv.name} Game Day Transportation | BusBrother`,
      metaDescription: `Charter bus to ${sv.name} in ${city.name}, FL. Skip parking, arrive together. Group game day transportation.`,
      canonicalPath: `/sports/${sv.slug}`,
      geoPlacename: `${city.name}, Florida`,
      geoPosition: '28.3922;-80.6077',
      footerCities
    });
    writePage(`/sports/${sv.slug}`, html);
    track('sports', `/sports/${sv.slug}`);
  }
}

// ── 13. Blog Posts ────────────────────────────────────────
if (templates['blog-post'] && blogTopics.length) {
  console.log('  Blog pages...');
  for (const blog of blogTopics) {
    const relSvcLinks = (blog.relatedServices || []).map(s => serviceMap[s]).filter(Boolean);
    const relCityLinks = (blog.relatedCities || []).map(s => cityMap[s]).filter(Boolean);
    const recentPosts = blogTopics.filter(b => b.slug !== blog.slug).slice(0, 5);

    const html = render(templates['blog-post'], {
      blogTitle: blog.title, blogEmoji: blog.emoji || '📝',
      blogDate: blog.date || '2026', blogReadTime: blog.readTime || '5 min',
      blogCategory: blog.category || 'Travel',
      sections: blog.sections || [],
      relatedServiceLinks: relSvcLinks,
      relatedCityLinks: relCityLinks,
      recentPosts,
      pageTitle: `${blog.title} | BusBrother`,
      metaDescription: blog.metaDescription || `${blog.title} - BusBrother group transportation guide.`,
      canonicalPath: `/blog/${blog.slug}`,
      geoPlacename: 'Central Florida',
      geoPosition: '28.3922;-80.6077',
      footerCities
    });
    writePage(`/blog/${blog.slug}`, html);
    track('blog', `/blog/${blog.slug}`);
  }
}

// ── 14. Neighborhood Pages ────────────────────────────────
if (templates['neighborhood'] && neighborhoods.length) {
  console.log('  Neighborhood pages...');
  for (const n of neighborhoods) {
    const city = cityMap[n.citySlug] || { name: 'Florida', slug: 'orlando' };
    const html = render(templates['neighborhood'], {
      neighborhoodName: n.name, neighborhoodDescription: n.description || '',
      cityName: city.name, citySlug: city.slug,
      highlights: n.highlights || [],
      serviceLinks: services.map(s => ({ ...s, citySlug: city.slug })),
      pageTitle: `${n.name} Charter Bus | ${city.name} FL | BusBrother`,
      metaDescription: `Group transportation in ${n.name}, ${city.name}, FL. Hotel shuttles, event transport, charter bus service.`,
      canonicalPath: `/areas/${city.slug}/neighborhoods/${n.slug}`,
      geoPlacename: `${city.name}, Florida`,
      geoPosition: city.lat && city.lng ? `${city.lat};${city.lng}` : '28.3922;-80.6077',
      footerCities
    });
    writePage(`/areas/${city.slug}/neighborhoods/${n.slug}`, html);
    track('neighborhoods', `/areas/${city.slug}/neighborhoods/${n.slug}`);
  }
}

// ── 15. Airport Transfer Pages ────────────────────────────
if (templates['airport-transfer']) {
  console.log('  Airport transfer pages...');
  for (const apt of airports) {
    const topCities = cities.filter(c => c.tier <= 2).slice(0, 40);
    for (const city of topCities) {
      const img = getImageForService('airport-transfers');
      const html = render(templates['airport-transfer'], {
        airportName: apt.name, airportCode: apt.code,
        airportDescription: apt.description || '',
        cityName: city.name,
        heroImage: img ? true : false,
        heroImageFile: img ? img.file : '',
        heroImageAlt: img ? img.alt : '',
        pageTitle: `${apt.code} to ${city.name} Group Shuttle | BusBrother`,
        metaDescription: `Group airport transfer from ${apt.code} to ${city.name}, FL. Meet-and-greet, luggage help, flight monitoring.`,
        canonicalPath: `/airports/${apt.slug}-to-${city.slug}`,
        geoPlacename: `${city.name}, Florida`,
        geoPosition: city.lat && city.lng ? `${city.lat};${city.lng}` : '28.3922;-80.6077',
        footerCities
      });
      writePage(`/airports/${apt.slug}-to-${city.slug}`, html);
      track('airports', `/airports/${apt.slug}-to-${city.slug}`);
    }
  }
}

// ── 16. Index/Hub Pages ───────────────────────────────────
if (templates['index-areas']) {
  console.log('  Index pages...');
  const html = render(templates['index-areas'], {
    tier1Cities: cities.filter(c => c.tier === 1),
    tier2Cities: cities.filter(c => c.tier === 2),
    tier3Cities: cities.filter(c => c.tier === 3),
    pageTitle: '120+ Florida Cities Served | BusBrother Charter Bus',
    metaDescription: 'BusBrother serves 120+ cities across Central and South Florida with charter bus and group transportation. Orlando, Tampa, Fort Lauderdale, Daytona Beach, and more.',
    canonicalPath: '/areas',
    geoPlacename: 'Central Florida',
    geoPosition: '28.3922;-80.6077',
    footerCities
  });
  writePage('/areas', html);
  track('other', '/areas', '0.8');
}

// ── 17. Service Hub Pages ─────────────────────────────────
if (templates['service-hub']) {
  console.log('  Service hub pages...');
  for (const svc of services) {
    const img = getImageForService(svc.slug);
    const topCities = cities.filter(c => c.tier <= 2).slice(0, 20).map(c => ({ ...c, serviceSlug: svc.slug }));
    const html = render(templates['service-hub'], {
      serviceName: svc.name, serviceNameLower: svc.name.toLowerCase(),
      serviceEmoji: svc.emoji || '', serviceSlug: svc.slug,
      serviceDescription: svc.description || '',
      serviceFeatures: svc.features || [],
      faqs: svc.faqs || [],
      topCities,
      allServices: services,
      heroImage: img ? true : false,
      heroImageFile: img ? img.file : '',
      heroImageAlt: img ? img.alt : '',
      pageTitle: `${svc.name} | BusBrother - Central Florida`,
      metaDescription: `Professional ${svc.name.toLowerCase()} across 120+ Florida cities. Licensed, insured, 24/7. Get a free quote from BusBrother.`,
      canonicalPath: `/services/${svc.slug}`,
      geoPlacename: 'Central Florida',
      geoPosition: '28.3922;-80.6077',
      footerCities
    });
    writePage(`/services/${svc.slug}`, html);
    track('other', `/services/${svc.slug}`, '0.8');
  }
  // Services index
  writePage('/services', render(templates['service-hub'], {
    serviceName: 'All Services', serviceNameLower: 'group transportation',
    serviceEmoji: '🚌', serviceSlug: '',
    serviceDescription: 'BusBrother provides a full range of charter bus and group transportation services across 120+ Florida cities. From cruise port shuttles to corporate charters, wedding transportation to school field trips - we handle it all.',
    serviceFeatures: ['Cruise port shuttles to Port Canaveral, Tampa, and Everglades', 'Airport transfers from MCO, TPA, FLL, SFB, PBI, DAB', 'Corporate event and conference transportation', 'Wedding guest shuttle service', 'School and university group trips', 'Theme park and attraction shuttles', 'Rocket launch viewing transport', 'Hotel shuttle service', 'Sports event game day buses'],
    faqs: [], topCities: cities.filter(c => c.tier === 1).map(c => ({ ...c, serviceSlug: '' })),
    allServices: services, heroImage: false, heroImageFile: '', heroImageAlt: '',
    pageTitle: 'Charter Bus Services | BusBrother - Central Florida',
    metaDescription: 'Full range of charter bus and group transportation services across 120+ Florida cities. Cruise shuttles, airports, corporate, weddings, schools, theme parks.',
    canonicalPath: '/services', geoPlacename: 'Central Florida', geoPosition: '28.3922;-80.6077', footerCities
  }));
  track('other', '/services', '0.9');
}

// ── 18. Static Pages ──────────────────────────────────────
console.log('  Static pages...');
const staticPages = ['about', 'fleet', 'faq', 'book', 'contact', 'thank-you', 'jobs', 'admin/jobs', 'terms', 'pricing', 'privacy', 'how-it-works', 'reviews', 'ada-accessibility', 'safety', 'services/church-bus', 'services/employee-shuttle', 'services/conference-shuttle', 'services/government-military', 'services/movie-production', 'guides/wedding-transportation', 'guides/cruise-port', 'guides/corporate-event-planning', 'guides/school-field-trip', 'guides/charter-bus-vs-alternatives', 'guides/airport-transfer'];
const staticMeta = {
  about: { title: 'About BusBrother | Charter Bus & Group Transportation', desc: 'Learn about BusBrother - Central Florida charter bus and group transportation. 120+ cities, 24/7 service, professional drivers.' },
  fleet: { title: 'Our Fleet | BusBrother Charter Bus', desc: 'BusBrother fleet: motorcoaches (45-57 pax), premium coaches (30-40 pax), minibuses (15-30 pax). Climate-controlled, ADA accessible, DOT compliant.' },
  faq: { title: 'FAQ | BusBrother Charter Bus & Group Transportation', desc: 'Frequently asked questions about BusBrother charter bus service. Pricing, booking, vehicles, ADA access, service areas, and more.' },
  book: { title: 'Get a Free Quote | BusBrother Charter Bus', desc: 'Request a free charter bus quote from BusBrother. One-way, round trip, multi-stop. ADA accessible. We respond within 2 hours.' },
  contact: { title: 'Contact BusBrother | Charter Bus & Group Transportation', desc: 'Contact BusBrother for charter bus and group transportation in Florida. Available 24/7. Email info@busbrother.com.' },
  'thank-you': { title: 'Quote Request Received | BusBrother', desc: 'Thank you for your quote request. BusBrother will respond within 2 hours with custom pricing.' },
  'jobs': { title: 'Job Details & Bid Submission | BusBrother', desc: 'View job details and submit your bid for BusBrother transportation jobs.' },
  'admin/jobs': { title: 'Job Manager | BusBrother Admin', desc: 'Admin dashboard for managing jobs and vendor bids.' },
  'terms': { title: 'Terms of Service | BusBrother', desc: 'BusBrother Terms of Service. Transportation broker operated by WETYR Corporation. Liability limitations, booking terms, and cancellation policy.' },
  'pricing': { title: 'Charter Bus Prices in Florida | How Much Does a Bus Cost? | BusBrother', desc: 'Charter bus rental prices in Florida. Motorcoach $150-$300/hr, minibus $100-$200/hr. See pricing by vehicle type, route estimates, and what affects cost. Free custom quotes.' },
  'privacy': { title: 'Privacy Policy | BusBrother', desc: 'BusBrother Privacy Policy. How we collect, use, and protect your personal information when you use our charter bus booking service.' },
  'how-it-works': { title: 'How BusBrother Works | Charter Bus Booking in 3 Steps', desc: 'Book a charter bus in 3 easy steps. Tell us your trip, get a custom quote in 2 hours, ride with confidence. Licensed carriers, no hidden fees, 24/7 availability.' },
  'reviews': { title: 'Customer Reviews | BusBrother Charter Bus Florida', desc: 'Read reviews from BusBrother customers. 4.9/5 rating from 127+ reviews. Cruise transfers, weddings, corporate events, school trips across Florida.' },
  'ada-accessibility': { title: 'ADA Accessible Charter Bus Rental | Wheelchair Accessible Bus | BusBrother', desc: 'ADA accessible charter bus and minibus rental in Florida. Wheelchair lifts, ramp access, service animals welcome. Inclusive group transportation for all.' },
  'safety': { title: 'Charter Bus Safety Standards | BusBrother', desc: 'BusBrother safety standards. USDOT registered carriers, FMCSA compliance, $5M insurance, CDL drivers with background checks. Your group safety is our priority.' },
  'services/church-bus': { title: 'Church Bus Rental Florida | Religious Group Transportation | BusBrother', desc: 'Charter bus rental for churches and religious groups in Florida. Sunday outings, retreats, mission trips, youth camps, VBS, conferences. Licensed, insured, 24/7.' },
  'services/employee-shuttle': { title: 'Employee Shuttle Service Florida | Corporate Commuter Bus | BusBrother', desc: 'Employee shuttle service across Florida. Daily commuter buses, campus shuttles, off-site parking transport, construction site shuttles. Recurring and one-time service.' },
  'services/conference-shuttle': { title: 'Conference Shuttle Bus Rental Orlando | Convention Transportation | BusBrother', desc: 'Conference and convention shuttle bus rental in Orlando and Tampa. Hotel-to-venue loops, airport transfers, multi-bus coordination. Serving OCCC, Tampa Convention Center.' },
  'services/government-military': { title: 'Government & Military Charter Bus Rental Florida | BusBrother', desc: 'Charter bus transportation for government agencies and military installations in Florida. DOT compliant, background-checked drivers, secure transportation.' },
  'services/movie-production': { title: 'Film Production Crew Transportation Florida | BusBrother', desc: 'Charter bus transportation for film and TV production crews in Florida. Cast shuttles, crew transport, location moves, basecamp shuttles. 24/7 flexible scheduling.' },
  'guides/wedding-transportation': { title: 'Florida Wedding Transportation Guide | Shuttle Service for Weddings | BusBrother', desc: 'Complete guide to wedding transportation in Florida. Vehicle options, timeline, pickup coordination, top FL wedding venues, cost breakdown. Free quote.' },
  'guides/cruise-port': { title: 'Florida Cruise Port Shuttle Guide | Port Canaveral, Tampa, Everglades | BusBrother', desc: 'Complete guide to Florida cruise port transportation. All 3 ports compared, pre-cruise hotels, embarkation timing, parking vs shuttle costs.' },
  'guides/corporate-event-planning': { title: 'Corporate Event Transportation Planning Guide | BusBrother', desc: 'Plan transportation for corporate events in Florida. Conferences, retreats, incentive trips, multi-bus logistics, branding, billing options.' },
  'guides/school-field-trip': { title: 'School Field Trip Bus Guide Florida | BusBrother', desc: 'Plan school field trips with BusBrother. Student safety, cost per student, fundraising, top FL field trip destinations. Licensed drivers, insured buses.' },
  'guides/charter-bus-vs-alternatives': { title: 'Charter Bus vs Uber, Rental Cars, Taxis | Group Transportation Comparison | BusBrother', desc: 'Detailed comparison of charter bus vs Uber XL, rental cars, taxis for groups. Cost tables for 10/20/30/50 person groups. See why charter wins.' },
  'guides/airport-transfer': { title: 'Florida Airport Shuttle Guide | MCO, TPA, FLL, SFB Transfers | BusBrother', desc: 'Complete Florida airport transfer guide. All 6 airports compared. Group pickup procedures, flight delay handling, cruise combos. Free quote.' }
};
const templateMap = { 'jobs': 'job-page', 'admin/jobs': 'admin-jobs', 'services/church-bus': 'church-bus', 'services/employee-shuttle': 'employee-shuttle', 'services/conference-shuttle': 'conference-shuttle', 'services/government-military': 'government-military', 'services/movie-production': 'movie-production', 'guides/wedding-transportation': 'wedding-transportation-guide', 'guides/cruise-port': 'cruise-port-guide', 'guides/corporate-event-planning': 'corporate-event-planning', 'guides/school-field-trip': 'school-field-trip-guide', 'guides/charter-bus-vs-alternatives': 'charter-bus-vs-alternatives', 'guides/airport-transfer': 'airport-transfer-guide' };
for (const page of staticPages) {
  const tplName = templateMap[page] || page;
  if (templates[tplName]) {
    const meta = staticMeta[page];
    const html = render(templates[tplName], {
      pageTitle: meta.title, metaDescription: meta.desc,
      canonicalPath: `/${page}`, geoPlacename: 'Central Florida', geoPosition: '28.3922;-80.6077',
      footerCities
    });
    writePage(`/${page}`, html);
    track('other', `/${page}`, page === 'book' ? '0.9' : '0.6');
  }
}

// ── 19. Blog Index ────────────────────────────────────────
if (templates['blog-index']) {
  console.log('  Blog index...');
  const html = render(templates['blog-index'], {
    posts: blogTopics.slice(0, 60),
    noPosts: blogTopics.length === 0 ? true : false,
    pageTitle: 'Travel Blog & Guides | BusBrother',
    metaDescription: 'Florida group transportation guides, travel tips, and charter bus articles from BusBrother. Cruise ports, theme parks, airports, events.',
    canonicalPath: '/blog', geoPlacename: 'Central Florida', geoPosition: '28.3922;-80.6077',
    footerCities
  });
  writePage('/blog', html);
  track('other', '/blog', '0.7');
}

// ── 20. Attractions Index ─────────────────────────────────
if (templates['index-areas']) {
  // Reuse areas index template style for attractions
  const attrHtml = `{{> head}}{{> schema}}{{> nav}}<div class="page-hero"><div class="page-hero-grid"></div><div class="container" style="position:relative;z-index:2;"><div class="breadcrumb"><a href="/">Home</a><span class="breadcrumb-sep">&rsaquo;</span><span>Attractions</span></div><h1>Florida Attractions | BusBrother Group Transportation</h1><p class="subtitle">Charter bus and group shuttle service to all major Florida attractions.</p></div></div><section class="section"><div class="container"><div class="areas-grid">${attractions.map(a => `<a href="/attractions/${a.slug}/" class="area-chip">${a.emoji || '📍'} ${a.name}</a>`).join('')}</div><div style="text-align:center;margin-top:3rem;"><a href="/book/" class="btn btn-primary btn-lg">Get a Free Quote &rarr;</a></div></div></section>{{> footer}}`;
  const html = render(attrHtml, {
    pageTitle: 'Florida Attractions | BusBrother Group Transportation',
    metaDescription: 'Charter bus to all major Florida attractions. Disney World, Universal, KSC, SeaWorld, beaches, museums. Group transportation.',
    canonicalPath: '/attractions', geoPlacename: 'Central Florida', geoPosition: '28.3922;-80.6077',
    footerCities
  });
  writePage('/attractions', html);
  track('other', '/attractions', '0.7');
}

// ── 20b. Bus Size/Capacity Pages ──────────────────────────
if (templates['bus-size'] && busSizes.length) {
  console.log('  Bus size pages...');
  for (const bs of busSizes) {
    const otherSizes = busSizes.filter(b => b.slug !== bs.slug);
    const html = render(templates['bus-size'], {
      ...bs, otherSizes,
      pageTitle: `${bs.busSize} Passenger ${bs.busType} Rental Florida | BusBrother`,
      metaDescription: `Rent a ${bs.busSize}-passenger ${bs.busTypeLower} in Florida. $${bs.priceLow}-$${bs.priceHigh}/hr. ${bs.idealFor}. Free quote from BusBrother.`,
      canonicalPath: `/bus-rental/${bs.slug}`,
      geoPlacename: 'Central Florida', geoPosition: '28.3922;-80.6077', footerCities
    });
    writePage(`/bus-rental/${bs.slug}`, html);
    track('other', `/bus-rental/${bs.slug}`, '0.7');
  }
  // Bus rental index
  const brIdx = `{{> head}}{{> schema}}{{> nav}}<div class="page-hero"><div class="page-hero-grid"></div><div class="container" style="position:relative;z-index:2;"><h1>Charter Bus Rental by Size | BusBrother Florida</h1><p class="subtitle">Choose the right bus for your group. From 15-passenger minibuses to 56-passenger motorcoaches.</p></div></div><section class="section"><div class="container"><div class="grid-3">${busSizes.map(b => `<a href="/bus-rental/${b.slug}/" class="card" style="text-decoration:none;"><div class="card-top-bar"></div><div class="card-body" style="text-align:center;"><div style="font-family:Bebas Neue,sans-serif;font-size:3rem;color:var(--gold);">${b.busSize}</div><div style="font-size:0.8rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:0.5rem;">Passengers</div><h3>${b.busType}</h3><p style="color:var(--muted);font-size:0.85rem;">$${b.priceLow}-$${b.priceHigh}/hr</p><span style="color:var(--gold);font-size:0.8rem;font-family:Space Mono,monospace;">VIEW DETAILS &rarr;</span></div></a>`).join('')}</div><div style="text-align:center;margin-top:3rem;"><a href="/book/" class="btn btn-primary btn-lg">Get a Free Quote &rarr;</a></div></div></section>{{> footer}}`;
  writePage('/bus-rental', render(brIdx, { pageTitle: 'Charter Bus Rental by Size | BusBrother Florida', metaDescription: 'Choose the right charter bus size for your group. 15 to 56 passenger vehicles. Minibuses, coaches, motorcoaches. Pricing and features for each.', canonicalPath: '/bus-rental', geoPlacename: 'Central Florida', geoPosition: '28.3922;-80.6077', footerCities }));
  track('other', '/bus-rental', '0.8');
}

// ── 21. Travel Guide Pages ────────────────────────────────
if (templates['guide'] && guides.length) {
  console.log('  Guide pages...');
  for (const g of guides) {
    const relGuides = guides.filter(x => x.slug !== g.slug && x.category === g.category).slice(0, 4);
    const relAttrs = (g.relatedCities || []).flatMap(cs => attractions.filter(a => a.citySlug === cs)).slice(0, 6);
    const html = render(templates['guide'], {
      guideTitle: g.title, guideSubtitle: g.subtitle || g.title,
      guideEmoji: g.emoji || '📖', guideDate: g.date || '2026',
      guideReadTime: g.readTime || '8 min', guideCategory: g.category || 'Travel',
      sections: g.sections || [], externalLinks: g.externalLinks || [],
      quickFacts: g.quickFacts || [], relatedGuides: relGuides, nearbyAttractions: relAttrs,
      pageTitle: `${g.title} | BusBrother Travel Guide`,
      metaDescription: g.subtitle || `${g.title} - Complete travel guide from BusBrother.`,
      canonicalPath: `/guides/${g.slug}`,
      geoPlacename: 'Central Florida', geoPosition: '28.3922;-80.6077', footerCities
    });
    writePage(`/guides/${g.slug}`, html);
    track('other', `/guides/${g.slug}`, '0.6');
  }
  // Guides index
  const gIdx = `{{> head}}{{> schema}}{{> nav}}<div class="page-hero"><div class="page-hero-grid"></div><div class="container" style="position:relative;z-index:2;"><h1>Florida Travel Guides | BusBrother</h1><p class="subtitle">In-depth travel guides for Central Florida - cruise lines, airports, theme parks, state parks, scenic drives, and more.</p></div></div><section class="section"><div class="container"><div class="grid-3">${guides.map(g => `<a href="/guides/${g.slug}/" class="card" style="text-decoration:none;"><div class="card-top-bar"></div><div class="card-body"><span style="font-size:2rem;">${g.emoji||'📖'}</span><h3 style="margin-top:0.5rem;">${g.title}</h3><span style="color:var(--gold);font-size:0.75rem;font-family:'Space Mono',monospace;">${g.category||'Guide'}</span></div></a>`).join('')}</div></div></section>{{> footer}}`;
  writePage('/guides', render(gIdx, { pageTitle: 'Florida Travel Guides | BusBrother', metaDescription: 'In-depth travel guides for Central Florida cruise lines, airports, theme parks, state parks, scenic drives, and more.', canonicalPath: '/guides', geoPlacename: 'Central Florida', geoPosition: '28.3922;-80.6077', footerCities }));
  track('other', '/guides', '0.8');
}

// ── 22. Restaurant Pages ──────────────────────────────────
if (templates['restaurant'] && restaurants.length) {
  console.log('  Restaurant pages...');
  for (const r of restaurants) {
    const nearAttrs = (r.nearbyAttractions || []).map(s => attractions.find(a => a.slug === s)).filter(Boolean);
    const html = render(templates['restaurant'], {
      restaurantName: r.name, cityName: r.cityName || 'Florida',
      cuisineType: r.cuisineType || 'American', cuisineEmoji: r.cuisineEmoji || '🍽️',
      priceRange: r.priceRange || '$$', address: r.address || '',
      neighborhood: r.neighborhood || '', description: r.description || '',
      groupDiningNotes: r.groupDiningNotes || '', groupFriendly: r.groupFriendly || 'Yes',
      nearbyLandmark: r.nearbyLandmark || r.neighborhood || r.cityName || '',
      website: r.website || '', websiteDomain: r.websiteDomain || '',
      nearbyAttractions: nearAttrs,
      pageTitle: `${r.name} | ${r.cityName || 'FL'} Dining Guide | BusBrother`,
      metaDescription: `${r.name} - ${r.cuisineType || ''} dining in ${r.cityName || 'Florida'}. Group-friendly restaurant guide from BusBrother.`,
      canonicalPath: `/dining/${r.slug}`,
      geoPlacename: `${r.cityName || 'Florida'}`, geoPosition: '28.3922;-80.6077', footerCities
    });
    writePage(`/dining/${r.slug}`, html);
    track('other', `/dining/${r.slug}`);
  }
  // Dining index
  const dIdx = `{{> head}}{{> schema}}{{> nav}}<div class="page-hero"><div class="page-hero-grid"></div><div class="container" style="position:relative;z-index:2;"><h1>Florida Restaurant & Dining Guide | BusBrother</h1><p class="subtitle">Top restaurants across Central and South Florida - group-friendly dining for charter bus groups.</p></div></div><section class="section"><div class="container"><div class="areas-grid">${restaurants.map(r => `<a href="/dining/${r.slug}/" class="area-chip">${r.cuisineEmoji||'🍽️'} ${r.name}</a>`).join('')}</div></div></section>{{> footer}}`;
  writePage('/dining', render(dIdx, { pageTitle: 'Florida Restaurant Guide | BusBrother', metaDescription: 'Top restaurants across Central Florida for groups. Dining guides from BusBrother charter bus.', canonicalPath: '/dining', geoPlacename: 'Central Florida', geoPosition: '28.3922;-80.6077', footerCities }));
  track('other', '/dining', '0.7');
}

// ── 23. Cruise Line Pages ─────────────────────────────────
if (templates['cruise-line'] && cruiseLines.length) {
  console.log('  Cruise line pages...');
  for (const cl of cruiseLines) {
    const html = render(templates['cruise-line'], {
      cruiseLineName: cl.cruiseLineName, cruiseLineShort: cl.cruiseLineShort,
      portName: cl.portName, description: cl.description || '',
      terminalInfo: cl.terminalInfo || '', checkInTime: cl.checkInTime || '',
      popularShips: cl.popularShips || '', gettingThereContent: cl.gettingThereContent || '',
      preCruiseHotels: cl.preCruiseHotels || '', tips: cl.tips || [],
      checklist: cl.checklist || [], externalLinks: cl.externalLinks || [],
      otherLines: cl.otherLines || [],
      pageTitle: `${cl.cruiseLineName} - ${cl.portName} Guide | BusBrother`,
      metaDescription: `Complete guide to ${cl.cruiseLineName} from ${cl.portName}. Terminals, check-in, parking, pre-cruise hotels, group transportation.`,
      canonicalPath: `/cruise-lines/${cl.slug}`,
      geoPlacename: cl.portName, geoPosition: '28.3922;-80.6077', footerCities
    });
    writePage(`/cruise-lines/${cl.slug}`, html);
    track('other', `/cruise-lines/${cl.slug}`, '0.7');
  }
  const clIdx = `{{> head}}{{> schema}}{{> nav}}<div class="page-hero"><div class="page-hero-grid"></div><div class="container" style="position:relative;z-index:2;"><h1>Cruise Line Guides | BusBrother</h1><p class="subtitle">Complete guides for every cruise line at Port Canaveral, Port Tampa Bay, and Port Everglades.</p></div></div><section class="section"><div class="container"><div class="areas-grid">${cruiseLines.map(c => `<a href="/cruise-lines/${c.slug}/" class="area-chip">🛳️ ${c.cruiseLineShort} - ${c.portName}</a>`).join('')}</div></div></section>{{> footer}}`;
  writePage('/cruise-lines', render(clIdx, { pageTitle: 'Cruise Line Guides | BusBrother', metaDescription: 'Cruise line guides for Port Canaveral, Port Tampa Bay, Port Everglades. Terminals, ships, check-in, group shuttles.', canonicalPath: '/cruise-lines', geoPlacename: 'Central Florida', geoPosition: '28.3922;-80.6077', footerCities }));
  track('other', '/cruise-lines', '0.8');
}

// ── 24. Scenic Route Pages ────────────────────────────────
if (templates['scenic-route'] && scenicRoutes.length) {
  console.log('  Scenic route pages...');
  for (const sr of scenicRoutes) {
    const html = render(templates['scenic-route'], {
      routeName: sr.routeName, routeSubtitle: sr.routeSubtitle || '',
      description: sr.description || '', distanceMiles: sr.distanceMiles || '~',
      driveTime: sr.driveTime || '~', numStops: sr.numStops || '~',
      bestSeason: sr.bestSeason || 'Year-round', routeOverview: sr.routeOverview || '',
      stops: sr.stops || [], drivingTips: sr.drivingTips || [],
      externalLinks: sr.externalLinks || [],
      pageTitle: `${sr.routeName} | Florida Scenic Drive Guide`,
      metaDescription: `${sr.routeName} - scenic drive guide with stops, landmarks, and driving tips. ${sr.distanceMiles || ''} miles.`,
      canonicalPath: `/scenic-drives/${sr.slug}`,
      geoPlacename: 'Central Florida', geoPosition: '28.3922;-80.6077', footerCities
    });
    writePage(`/scenic-drives/${sr.slug}`, html);
    track('other', `/scenic-drives/${sr.slug}`);
  }
  const srIdx = `{{> head}}{{> schema}}{{> nav}}<div class="page-hero"><div class="page-hero-grid"></div><div class="container" style="position:relative;z-index:2;"><h1>Florida Scenic Drives | BusBrother</h1><p class="subtitle">The best scenic routes and road trips across Central Florida.</p></div></div><section class="section"><div class="container"><div class="areas-grid">${scenicRoutes.map(s => `<a href="/scenic-drives/${s.slug}/" class="area-chip">🛣️ ${s.routeName}</a>`).join('')}</div></div></section>{{> footer}}`;
  writePage('/scenic-drives', render(srIdx, { pageTitle: 'Florida Scenic Drives | BusBrother', metaDescription: 'Best scenic drives and road trips in Central Florida.', canonicalPath: '/scenic-drives', geoPlacename: 'Central Florida', geoPosition: '28.3922;-80.6077', footerCities }));
  track('other', '/scenic-drives', '0.7');
}

// ── 25. Things To Do Pages ────────────────────────────────
if (templates['things-to-do'] && thingsToDo.length) {
  console.log('  Things to do pages...');
  for (const td of thingsToDo) {
    const nearGuides = thingsToDo.filter(x => x.slug !== td.slug).slice(0, 5);
    const html = render(templates['things-to-do'], {
      pageHeading: td.pageHeading || td.title, pageSubtitle: td.pageSubtitle || '',
      pageEmoji: td.pageEmoji || '🎯', introContent: td.introContent || '',
      activities: td.activities || [], externalLinks: td.externalLinks || [],
      nearbyGuides: nearGuides,
      pageTitle: `${td.pageHeading || td.title} | BusBrother`,
      metaDescription: td.pageSubtitle || `${td.title} - complete activity guide from BusBrother.`,
      canonicalPath: `/things-to-do/${td.slug}`,
      geoPlacename: 'Central Florida', geoPosition: '28.3922;-80.6077', footerCities
    });
    writePage(`/things-to-do/${td.slug}`, html);
    track('other', `/things-to-do/${td.slug}`, '0.6');
  }
  const tdIdx = `{{> head}}{{> schema}}{{> nav}}<div class="page-hero"><div class="page-hero-grid"></div><div class="container" style="position:relative;z-index:2;"><h1>Things to Do in Florida | BusBrother</h1><p class="subtitle">Activity guides for every city and attraction in Central Florida.</p></div></div><section class="section"><div class="container"><div class="areas-grid">${thingsToDo.map(t => `<a href="/things-to-do/${t.slug}/" class="area-chip">${t.pageEmoji||'🎯'} ${t.title||t.pageHeading}</a>`).join('')}</div></div></section>{{> footer}}`;
  writePage('/things-to-do', render(tdIdx, { pageTitle: 'Things to Do in Florida | BusBrother', metaDescription: 'Activity guides for every city in Central Florida.', canonicalPath: '/things-to-do', geoPlacename: 'Central Florida', geoPosition: '28.3922;-80.6077', footerCities }));
  track('other', '/things-to-do', '0.7');
}

// ── 26. Theme Park Guide Pages ────────────────────────────
if (templates['theme-park-guide'] && themeParkGuides.length) {
  console.log('  Theme park guide pages...');
  for (const tp of themeParkGuides) {
    const html = render(templates['theme-park-guide'], {
      parkName: tp.parkName, parkEmoji: tp.parkEmoji || '🎢',
      parkSubtitle: tp.parkSubtitle || '', cityName: tp.cityName || 'Orlando',
      citySlug: tp.citySlug || 'orlando', parkDescription: tp.parkDescription || '',
      openedYear: tp.openedYear || '', parkSize: tp.parkSize || '',
      annualVisitors: tp.annualVisitors || '', numRides: tp.numRides || '',
      parkHours: tp.parkHours || '', parkingInfo: tp.parkingInfo || '',
      history: tp.history || '', areas: tp.areas || [],
      topAttractions: tp.topAttractions || [], insiderTips: tp.insiderTips || [],
      bestTimes: tp.bestTimes || '', ticketInfo: tp.ticketInfo || '',
      dining: tp.dining || '', externalLinks: tp.externalLinks || [],
      pageTitle: `${tp.parkName} Complete Visitor Guide | BusBrother`,
      metaDescription: `${tp.parkName} complete guide - rides, areas, tips, tickets, dining, and group transportation.`,
      canonicalPath: `/theme-parks/${tp.slug}`,
      geoPlacename: `${tp.cityName || 'Orlando'}, Florida`, geoPosition: '28.3922;-80.6077', footerCities
    });
    writePage(`/theme-parks/${tp.slug}`, html);
    track('other', `/theme-parks/${tp.slug}`, '0.7');
  }
  const tpIdx = `{{> head}}{{> schema}}{{> nav}}<div class="page-hero"><div class="page-hero-grid"></div><div class="container" style="position:relative;z-index:2;"><h1>Theme Park Guides | BusBrother</h1><p class="subtitle">Complete visitor guides for every theme park in Central Florida.</p></div></div><section class="section"><div class="container"><div class="grid-3">${themeParkGuides.map(t => `<a href="/theme-parks/${t.slug}/" class="card" style="text-decoration:none;"><div class="card-top-bar"></div><div class="card-body"><span style="font-size:2.5rem;">${t.parkEmoji||'🎢'}</span><h3 style="margin-top:0.5rem;">${t.parkName}</h3></div></a>`).join('')}</div></div></section>{{> footer}}`;
  writePage('/theme-parks', render(tpIdx, { pageTitle: 'Theme Park Guides | BusBrother', metaDescription: 'Complete visitor guides for Disney World, Universal, SeaWorld, Busch Gardens, LEGOLAND and all Florida theme parks.', canonicalPath: '/theme-parks', geoPlacename: 'Central Florida', geoPosition: '28.3922;-80.6077', footerCities }));
  track('other', '/theme-parks', '0.8');
}

// ── 27. Port Terminal Pages ───────────────────────────────
if (templates['port-guide'] && portTerminals.length) {
  console.log('  Port terminal pages...');
  for (const pt of portTerminals) {
    const html = render(templates['port-guide'], {
      terminalName: pt.terminalName, terminalNumber: pt.terminalNumber || '',
      portName: pt.portName, portSlug: pt.portSlug || '',
      cruiseLinesServed: pt.cruiseLinesServed || '', address: pt.address || '',
      description: pt.description || '', parkingInfo: pt.parkingInfo || '',
      checkInInfo: pt.checkInInfo || '', nearbyHotels: pt.nearbyHotels || '',
      nearbyDining: pt.nearbyDining || '', thingsToDo: pt.thingsToDo || '',
      externalLinks: pt.externalLinks || [],
      pageTitle: `${pt.terminalName} Guide | BusBrother`,
      metaDescription: `${pt.terminalName} complete guide - parking, check-in, hotels, dining, and group shuttle service.`,
      canonicalPath: `/cruise-ports/${pt.slug}`,
      geoPlacename: pt.portName, geoPosition: '28.3922;-80.6077', footerCities
    });
    writePage(`/cruise-ports/${pt.slug}`, html);
    track('other', `/cruise-ports/${pt.slug}`, '0.6');
  }
  const ptIdx = `{{> head}}{{> schema}}{{> nav}}<div class="page-hero"><div class="page-hero-grid"></div><div class="container" style="position:relative;z-index:2;"><h1>Cruise Port Terminal Guides | BusBrother</h1><p class="subtitle">Complete terminal guides for Port Canaveral, Port Tampa Bay, and Port Everglades.</p></div></div><section class="section"><div class="container"><div class="areas-grid">${portTerminals.map(p => `<a href="/cruise-ports/${p.slug}/" class="area-chip">🛳️ ${p.terminalName}</a>`).join('')}</div></div></section>{{> footer}}`;
  writePage('/cruise-ports', render(ptIdx, { pageTitle: 'Cruise Port Terminal Guides | BusBrother', metaDescription: 'Terminal guides for Port Canaveral, Port Tampa Bay, Port Everglades.', canonicalPath: '/cruise-ports', geoPlacename: 'Central Florida', geoPosition: '28.3922;-80.6077', footerCities }));
  track('other', '/cruise-ports', '0.7');
}

// ── 28. Hotel Area Guide Pages ────────────────────────────
if (templates['hotel-area-guide'] && hotelAreaGuides.length) {
  console.log('  Hotel area guide pages...');
  for (const hg of hotelAreaGuides) {
    const html = render(templates['hotel-area-guide'], {
      pageHeading: hg.pageHeading, pageSubtitle: hg.pageSubtitle || '',
      areaName: hg.areaName || '', introContent: hg.introContent || '',
      hotels: hg.hotels || [], whyStayContent: hg.whyStayContent || '',
      gettingAroundContent: hg.gettingAroundContent || '',
      externalLinks: hg.externalLinks || [],
      pageTitle: `${hg.pageHeading} | BusBrother`,
      metaDescription: hg.pageSubtitle || `${hg.pageHeading} - hotel guide from BusBrother.`,
      canonicalPath: `/hotel-guides/${hg.slug}`,
      geoPlacename: 'Central Florida', geoPosition: '28.3922;-80.6077', footerCities
    });
    writePage(`/hotel-guides/${hg.slug}`, html);
    track('other', `/hotel-guides/${hg.slug}`);
  }
  const hgIdx = `{{> head}}{{> schema}}{{> nav}}<div class="page-hero"><div class="page-hero-grid"></div><div class="container" style="position:relative;z-index:2;"><h1>Florida Hotel Guides | BusBrother</h1><p class="subtitle">Find the best hotels near cruise ports, theme parks, airports, and attractions across Florida.</p></div></div><section class="section"><div class="container"><div class="areas-grid">${hotelAreaGuides.map(h => `<a href="/hotel-guides/${h.slug}/" class="area-chip">🏨 ${h.pageHeading}</a>`).join('')}</div></div></section>{{> footer}}`;
  writePage('/hotel-guides', render(hgIdx, { pageTitle: 'Florida Hotel Guides | BusBrother', metaDescription: 'Best hotels near cruise ports, theme parks, airports across Central Florida.', canonicalPath: '/hotel-guides', geoPlacename: 'Central Florida', geoPosition: '28.3922;-80.6077', footerCities }));
  track('other', '/hotel-guides', '0.7');
}

// ══════════════════════════════════════════════════════════
//  PHASE 1B: MULTIPLIER PAGES (25K target)
// ══════════════════════════════════════════════════════════

// ── M1. Service x Attraction Pages ────────────────────────
if (templates['service-attraction']) {
  console.log('  Service x Attraction pages...');
  for (const attr of attractions) {
    const city = cityMap[attr.citySlug] || { name: 'Florida' };
    const relevantSvcs = (attr.popularServices || []).map(s => serviceMap[s]).filter(Boolean);
    const svcsToUse = relevantSvcs.length >= 2 ? relevantSvcs : services.slice(0, 5);
    for (const svc of svcsToUse) {
      const ctx = { cityName: city.name, serviceName: svc.name, serviceNameLower: svc.name.toLowerCase(), attractionName: attr.name };
      const otherSvcs = services.filter(s => s.slug !== svc.slug).slice(0, 5);
      const html = render(templates['service-attraction'], {
        serviceName: svc.name, serviceNameLower: svc.name.toLowerCase(),
        serviceEmoji: svc.emoji || '', attractionName: attr.name,
        attractionSlug: attr.slug, attractionDescription: attr.description || '',
        cityName: city.name, serviceFeatures: svc.features || [],
        tips: attr.tips || [],
        introContent: getIntro('service-city', `sa-${attr.slug}-${svc.slug}`, ctx),
        otherServices: otherSvcs.map(s => ({ ...s, attractionSlug: attr.slug })),
        pageTitle: `${svc.name} to ${attr.name} | BusBrother`,
        metaDescription: `${svc.name} for groups visiting ${attr.name} in ${city.name}, FL. Professional group transportation from BusBrother.`,
        canonicalPath: `/attractions/${attr.slug}/${svc.slug}`,
        geoPlacename: `${city.name}, Florida`, geoPosition: attr.lat && attr.lng ? `${attr.lat};${attr.lng}` : '28.3922;-80.6077',
        footerCities
      });
      writePage(`/attractions/${attr.slug}/${svc.slug}`, html);
      track('svc-attractions', `/attractions/${attr.slug}/${svc.slug}`);
    }
  }
}

// ── M2. City to Attraction Transport Pages ────────────────
if (templates['city-attraction']) {
  console.log('  City x Attraction pages...');
  const topCities = cities; // ALL cities
  const topAttractions = attractions; // ALL attractions
  for (const city of topCities) {
    for (const attr of topAttractions) {
      if (attr.citySlug === city.slug) continue;
      const attrCity = cityMap[attr.citySlug] || { name: 'Florida', lat: 28.39, lng: -80.60 };
      const dist = city.lat && city.lng && attrCity.lat && attrCity.lng
        ? Math.round(haversine(city.lat, city.lng, attrCity.lat, attrCity.lng))
        : '~';
      const mins = typeof dist === 'number' ? Math.round(dist * 1.3) : '~';
      const otherAttrs = topAttractions.filter(a => a.slug !== attr.slug).slice(0, 5);
      const html = render(templates['city-attraction'], {
        fromCityName: city.name, fromCitySlug: city.slug,
        attractionName: attr.name, attractionSlug: attr.slug,
        attractionEmoji: attr.emoji || '📍',
        attractionDescription: attr.description || '',
        attrCityName: attrCity.name || 'Florida',
        distanceMiles: dist, driveMinutes: mins,
        highway: 'Florida highways',
        otherAttractions: otherAttrs.map(a => ({ ...a, fromCitySlug: city.slug })),
        pageTitle: `${city.name} to ${attr.name} Group Bus | BusBrother`,
        metaDescription: `Charter bus from ${city.name} to ${attr.name}. ${dist} miles, ~${mins} min. Group transportation from BusBrother.`,
        canonicalPath: `/from/${city.slug}/to/${attr.slug}`,
        geoPlacename: `${city.name}, Florida`, geoPosition: city.lat && city.lng ? `${city.lat};${city.lng}` : '28.3922;-80.6077',
        footerCities
      });
      writePage(`/from/${city.slug}/to/${attr.slug}`, html);
      track('city-attractions', `/from/${city.slug}/to/${attr.slug}`);
    }
  }
}

// ── M3. Service x Event Pages ─────────────────────────────
if (templates['service-city'] && seasonalEvents.length) {
  console.log('  Service x Event pages...');
  for (const ev of seasonalEvents) {
    const city = cityMap[ev.citySlug] || { name: 'Florida' };
    const svcsToUse = services.slice(0, 5); // top 5 services per event
    for (const svc of svcsToUse) {
      const ctx = { cityName: city.name, serviceName: svc.name, serviceNameLower: svc.name.toLowerCase(), countyName: city.county || '' };
      const html = render(templates['service-city'], {
        ...ctx, citySlug: city.slug, serviceSlug: svc.slug, serviceEmoji: svc.emoji || '',
        introContent: `Need ${svc.name.toLowerCase()} for ${ev.name}? BusBrother provides professional group transportation for ${ev.name} attendees in ${city.name}, Florida. Hotel pickups, round trip, multi-stop service available.`,
        whyChooseContent: `BusBrother knows ${ev.name} logistics inside and out. Our drivers handle event traffic, know the best drop-off points, and coordinate pickup times around event schedules.`,
        heroImage: false, heroImageFile: '', heroImageAlt: '',
        serviceFeatures: svc.features || [], faqs: (svc.faqs || []).slice(0, 2),
        otherServices: services.filter(s => s.slug !== svc.slug).slice(0, 4).map(s => ({ ...s, citySlug: city.slug })),
        nearbyCities: [],
        pageTitle: `${svc.name} for ${ev.name} | BusBrother`,
        metaDescription: `${svc.name} for ${ev.name} in ${city.name}, FL. Group transportation from BusBrother.`,
        canonicalPath: `/events/${ev.slug}/${svc.slug}`,
        geoPlacename: `${city.name}, Florida`, geoPosition: '28.3922;-80.6077', footerCities
      });
      writePage(`/events/${ev.slug}/${svc.slug}`, html);
      track('svc-events', `/events/${ev.slug}/${svc.slug}`);
    }
  }
}

// ── M4. Service x Venue Pages ─────────────────────────────
if (templates['service-city'] && venues.length) {
  console.log('  Service x Venue pages...');
  for (const v of venues) {
    const city = cityMap[v.citySlug] || { name: 'Florida' };
    const svcsToUse = services.slice(0, 5); // top 5 services per venue
    for (const svc of svcsToUse) {
      const ctx = { cityName: city.name, serviceName: svc.name, serviceNameLower: svc.name.toLowerCase(), countyName: city.county || '' };
      const html = render(templates['service-city'], {
        ...ctx, citySlug: city.slug, serviceSlug: svc.slug, serviceEmoji: svc.emoji || '',
        introContent: `BusBrother provides ${svc.name.toLowerCase()} for events at ${v.name} in ${city.name}, Florida. Whether you need hotel shuttles, airport transfers, or multi-bus coordination, we handle the transportation logistics.`,
        whyChooseContent: `Our drivers know ${v.name} and the surrounding area. We coordinate drop-off and pickup at the venue entrance, handle multiple hotels, and offer on-site standby for flexible departure times.`,
        heroImage: false, heroImageFile: '', heroImageAlt: '',
        serviceFeatures: svc.features || [], faqs: [],
        otherServices: services.filter(s => s.slug !== svc.slug).slice(0, 4).map(s => ({ ...s, citySlug: city.slug })),
        nearbyCities: [],
        pageTitle: `${svc.name} to ${v.name} | BusBrother`,
        metaDescription: `${svc.name} for events at ${v.name} in ${city.name}, FL. Group bus from BusBrother.`,
        canonicalPath: `/venues/${v.slug}/${svc.slug}`,
        geoPlacename: `${city.name}, Florida`, geoPosition: '28.3922;-80.6077', footerCities
      });
      writePage(`/venues/${v.slug}/${svc.slug}`, html);
      track('svc-venues', `/venues/${v.slug}/${svc.slug}`);
    }
  }
}

// ── M5. Neighborhood x Service Pages ──────────────────────
if (templates['service-city'] && neighborhoods.length) {
  console.log('  Neighborhood x Service pages...');
  for (const n of neighborhoods) {
    const city = cityMap[n.citySlug] || { name: 'Florida', slug: 'orlando', county: '' };
    for (const svc of services) {
      const ctx = { cityName: `${n.name}, ${city.name}`, serviceName: svc.name, serviceNameLower: svc.name.toLowerCase(), countyName: city.county || '' };
      const html = render(templates['service-city'], {
        ...ctx, citySlug: city.slug, serviceSlug: svc.slug, serviceEmoji: svc.emoji || '',
        introContent: `Looking for ${svc.name.toLowerCase()} in ${n.name}, ${city.name}? BusBrother provides professional group transportation with pickup from any hotel or address in the ${n.name} area.`,
        whyChooseContent: `Our drivers know ${n.name} and all of ${city.name}. We pick up from hotels, offices, and residences throughout the neighborhood and connect your group to any destination in Florida.`,
        heroImage: false, heroImageFile: '', heroImageAlt: '',
        serviceFeatures: svc.features || [], faqs: [],
        otherServices: services.filter(s => s.slug !== svc.slug).slice(0, 4).map(s => ({ ...s, citySlug: city.slug })),
        nearbyCities: [],
        pageTitle: `${svc.name} ${n.name} ${city.name} FL | BusBrother`,
        metaDescription: `${svc.name} in ${n.name}, ${city.name}, FL. Group transportation from BusBrother. 24/7 availability.`,
        canonicalPath: `/areas/${city.slug}/neighborhoods/${n.slug}/${svc.slug}`,
        geoPlacename: `${city.name}, Florida`, geoPosition: city.lat && city.lng ? `${city.lat};${city.lng}` : '28.3922;-80.6077', footerCities
      });
      writePage(`/areas/${city.slug}/neighborhoods/${n.slug}/${svc.slug}`, html);
      track('neighborhood-svc', `/areas/${city.slug}/neighborhoods/${n.slug}/${svc.slug}`);
    }
  }
}

// ── M6. Expanded City-to-City Routes ──────────────────────
if (templates['route']) {
  console.log('  Expanded routes...');
  const tier12Cities = cities.filter(c => c.tier <= 2);
  const existingRoutes = new Set();
  routes.forEach(r => { existingRoutes.add(`${r.fromSlug}-${r.toSlug}`); existingRoutes.add(`${r.toSlug}-${r.fromSlug}`); });

  for (const from of tier12Cities) {
    for (const to of tier12Cities) {
      if (from.slug === to.slug) continue;
      const key = `${from.slug}-${to.slug}`;
      if (existingRoutes.has(key)) continue;
      existingRoutes.add(key);
      existingRoutes.add(`${to.slug}-${from.slug}`);

      const dist = from.lat && from.lng && to.lat && to.lng
        ? Math.round(haversine(from.lat, from.lng, to.lat, to.lng))
        : 50;
      if (dist > 200) continue; // skip routes over 200 miles
      const mins = Math.round(dist * 1.3);

      const html = render(templates['route'], {
        fromName: from.name, toName: to.name,
        distanceMiles: dist, driveMinutes: mins,
        highway: 'Florida highways',
        routeDescription: `BusBrother provides charter bus service from ${from.name} to ${to.name}, Florida. The route covers approximately ${dist} miles and takes about ${mins} minutes. Our professional drivers know Central Florida roads and traffic patterns to ensure on-time arrival for your group.`,
        popularReasons: ['group travel', 'corporate events', 'airport transfers', 'theme park day trips'],
        reverseSlug: `${to.slug}-to-${from.slug}`,
        pageTitle: `${from.name} to ${to.name} Charter Bus | BusBrother`,
        metaDescription: `Group bus from ${from.name} to ${to.name} FL. ${dist} miles, ~${mins} min. Charter bus from BusBrother.`,
        canonicalPath: `/routes/${from.slug}-to-${to.slug}`,
        geoPlacename: `${from.name}, Florida`, geoPosition: from.lat && from.lng ? `${from.lat};${from.lng}` : '28.3922;-80.6077',
        footerCities
      });
      writePage(`/routes/${from.slug}-to-${to.slug}`, html);
      track('expanded-routes', `/routes/${from.slug}-to-${to.slug}`);
    }
  }
}

// ══════════════════════════════════════════════════════════
//  PHASE 2: STATIC ASSETS & SITEMAPS
// ══════════════════════════════════════════════════════════
console.log('Copying static assets...');
copyDirSync(STATIC, DIST);

console.log('Generating sitemaps...');
const sitemapFiles = [];
for (const [section, urls] of Object.entries(sitemapUrls)) {
  if (urls.length > 0) {
    const f = generateSubSitemap(section, urls, DIST);
    sitemapFiles.push(f);
  }
}
generateSitemapIndex(sitemapFiles, DIST);
generateRobots(DIST);

// LLM Sitemap - tells AI crawlers which pages have authoritative answer content
const llmPages = [
  { loc: '/llm.txt', priority: '1.0', contentType: 'llm-instructions', topics: 'charter bus, group transportation, Florida, cruise shuttle, airport transfer' },
  { loc: '/', priority: '1.0', contentType: 'entity-authority', topics: 'BusBrother, Florida charter bus broker' },
  { loc: '/about/', priority: '0.9', contentType: 'entity-authority', topics: 'BusBrother company information' },
  { loc: '/how-it-works/', priority: '0.95', contentType: 'process-explanation', topics: 'how to book charter bus, BusBrother process' },
  { loc: '/pricing/', priority: '0.95', contentType: 'pricing-information', topics: 'charter bus prices, cost, hourly rates Florida' },
  { loc: '/safety/', priority: '0.9', contentType: 'authoritative-content', topics: 'charter bus safety standards, FMCSA, USDOT, driver requirements' },
  { loc: '/ada-accessibility/', priority: '0.9', contentType: 'authoritative-content', topics: 'ADA accessible bus, wheelchair accessible transportation' },
  { loc: '/reviews/', priority: '0.9', contentType: 'social-proof', topics: 'BusBrother customer reviews, ratings' },
  { loc: '/fleet/', priority: '0.9', contentType: 'product-information', topics: 'charter bus types, motorcoach, minibus' },
  { loc: '/faq/', priority: '0.95', contentType: 'faq-answers', topics: 'charter bus questions, group transportation FAQ' },
  { loc: '/terms/', priority: '0.7', contentType: 'legal-information', topics: 'terms of service, broker liability' },
  { loc: '/privacy/', priority: '0.7', contentType: 'legal-information', topics: 'privacy policy' },
  { loc: '/bus-rental/', priority: '0.9', contentType: 'product-catalog', topics: 'charter bus sizes 15 18 20 25 30 35 40 56 passenger' },
  { loc: '/services/', priority: '0.9', contentType: 'service-catalog', topics: 'charter bus services Florida' },
  { loc: '/services/cruise-shuttle/', priority: '0.95', contentType: 'service-detail', topics: 'cruise port shuttle, Port Canaveral, Port Tampa Bay, Port Everglades' },
  { loc: '/services/airport-transfers/', priority: '0.95', contentType: 'service-detail', topics: 'airport shuttle, MCO TPA FLL SFB PBI DAB group transfer' },
  { loc: '/services/corporate-charter/', priority: '0.9', contentType: 'service-detail', topics: 'corporate charter bus Florida conferences events' },
  { loc: '/services/wedding-events/', priority: '0.9', contentType: 'service-detail', topics: 'wedding shuttle Florida transportation' },
  { loc: '/services/school-groups/', priority: '0.9', contentType: 'service-detail', topics: 'school field trip bus rental' },
  { loc: '/services/theme-parks/', priority: '0.9', contentType: 'service-detail', topics: 'Disney Universal SeaWorld theme park shuttle' },
  { loc: '/services/kennedy-space-center/', priority: '0.9', contentType: 'service-detail', topics: 'Kennedy Space Center group tours transportation' },
  { loc: '/services/rocket-launch/', priority: '0.9', contentType: 'service-detail', topics: 'SpaceX NASA rocket launch viewing transport' },
  { loc: '/services/church-bus/', priority: '0.85', contentType: 'service-detail', topics: 'church group bus rental Florida' },
  { loc: '/services/employee-shuttle/', priority: '0.85', contentType: 'service-detail', topics: 'employee shuttle commuter bus Florida' },
  { loc: '/services/conference-shuttle/', priority: '0.85', contentType: 'service-detail', topics: 'conference convention shuttle Orlando Tampa' },
  { loc: '/guides/wedding-transportation/', priority: '0.85', contentType: 'in-depth-guide', topics: 'Florida wedding transportation guide' },
  { loc: '/guides/cruise-port/', priority: '0.85', contentType: 'in-depth-guide', topics: 'Florida cruise port guide' },
  { loc: '/guides/corporate-event-planning/', priority: '0.85', contentType: 'in-depth-guide', topics: 'corporate event transportation planning' },
  { loc: '/guides/school-field-trip/', priority: '0.85', contentType: 'in-depth-guide', topics: 'school field trip planning bus' },
  { loc: '/guides/charter-bus-vs-alternatives/', priority: '0.9', contentType: 'comparison-guide', topics: 'charter bus vs Uber rental cars taxi comparison' },
  { loc: '/guides/airport-transfer/', priority: '0.85', contentType: 'in-depth-guide', topics: 'Florida airport transfer guide' },
  { loc: '/areas/', priority: '0.9', contentType: 'location-hub', topics: 'Florida cities served, charter bus service areas' },
  { loc: '/areas/orlando/', priority: '0.95', contentType: 'location-detail', topics: 'Orlando charter bus, group transportation' },
  { loc: '/areas/tampa/', priority: '0.95', contentType: 'location-detail', topics: 'Tampa charter bus, group transportation' },
  { loc: '/areas/fort-lauderdale/', priority: '0.95', contentType: 'location-detail', topics: 'Fort Lauderdale charter bus' },
  { loc: '/areas/cape-canaveral/', priority: '0.95', contentType: 'location-detail', topics: 'Cape Canaveral charter bus, Space Coast' },
  { loc: '/areas/cocoa-beach/', priority: '0.9', contentType: 'location-detail', topics: 'Cocoa Beach charter bus' },
  { loc: '/areas/kissimmee/', priority: '0.9', contentType: 'location-detail', topics: 'Kissimmee charter bus, Disney area' },
  { loc: '/areas/melbourne/', priority: '0.9', contentType: 'location-detail', topics: 'Melbourne FL charter bus' },
  { loc: '/areas/daytona-beach/', priority: '0.9', contentType: 'location-detail', topics: 'Daytona Beach charter bus' },
  { loc: '/areas/west-palm-beach/', priority: '0.9', contentType: 'location-detail', topics: 'West Palm Beach charter bus' },
  { loc: '/areas/clearwater/', priority: '0.9', contentType: 'location-detail', topics: 'Clearwater charter bus' },
  { loc: '/areas/st-petersburg/', priority: '0.9', contentType: 'location-detail', topics: 'St Petersburg charter bus' }
];
generateLlmSitemap(DIST, llmPages);
console.log('LLM sitemap generated with', llmPages.length, 'AI-priority pages');

// ══════════════════════════════════════════════════════════
//  DONE
// ══════════════════════════════════════════════════════════
const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
console.log(`\n✓ BUILD COMPLETE`);
console.log(`  Total pages: ${totalPages}`);
console.log(`  Sitemaps: ${sitemapFiles.length} sub-sitemaps`);
console.log(`  Build time: ${elapsed}s`);
console.log(`  Output: ${DIST}`);
