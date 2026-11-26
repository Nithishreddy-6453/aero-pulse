import express from 'express';
import type { Request, Response } from 'express';
import { ThinkingLevel } from '@google/genai';
import { geminiRateLimiter, sanitizeServerInput } from '../middleware/security.ts';
import {
  CACHE_TTL_MS,
  OSM_USER_AGENT,
  QUOTA_COOLDOWN_MS,
  executeWithGeminiFallback,
  getGeminiApiKey,
  isQuotaExhaustedError,
} from '../services/geminiClient.ts';

interface LatLngPoint {
  lat: number;
  lng: number;
}

interface RouteOptionMetrics {
  available: boolean;
  mode: 'TRANSIT' | 'DRIVE' | 'TWO_WHEELER';
  distanceKm: number;
  durationMins: number;
  coordinates: [number, number][];
  startLocation: LatLngPoint | null;
  endLocation: LatLngPoint | null;
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  } | null;
  transitLines: string[];
}

interface GeocodedPlace {
  lat: number;
  lng: number;
  displayName: string;
}

interface PhotonPlaceSuggestion {
  id: string;
  name: string;
  subtitle: string;
  label: string;
  lat: number;
  lng: number;
  osmValue?: string;
}

interface PhotonGeoJsonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    osm_id?: number;
    osm_type?: string;
    name?: string;
    street?: string;
    district?: string;
    locality?: string;
    city?: string;
    county?: string;
    state?: string;
    country?: string;
    countrycode?: string;
    osm_value?: string;
  };
}

const geocodeCache = new Map<string, GeocodedPlace>([
  ['dwarka sector 4, new delhi', { lat: 28.5993, lng: 77.0494, displayName: 'Dwarka Sector 4, New Delhi' }],
  ['dlf cyber city, gurugram', { lat: 28.4949, lng: 77.0895, displayName: 'DLF Cyber City, Gurugram' }],
  ['salt lake sector iii, kolkata', { lat: 22.5736, lng: 88.4143, displayName: 'Salt Lake Sector III, Kolkata' }],
  ['park street, kolkata', { lat: 22.5535, lng: 88.3526, displayName: 'Park Street, Kolkata' }],
  ['powai, mumbai', { lat: 19.1197, lng: 72.9051, displayName: 'Powai, Mumbai' }],
  ['bandra kurla complex, mumbai', { lat: 19.0653, lng: 72.8682, displayName: 'Bandra Kurla Complex, Mumbai' }],
  ['patia, bhubaneswar', { lat: 20.3533, lng: 85.8266, displayName: 'Patia, Bhubaneswar' }],
  ['infocity, bhubaneswar', { lat: 20.3474, lng: 85.8075, displayName: 'Infocity, Bhubaneswar' }],
  ['indiranagar, bengaluru', { lat: 12.9784, lng: 77.6408, displayName: 'Indiranagar, Bengaluru' }],
  ['bellandur, bengaluru', { lat: 12.9259, lng: 77.6762, displayName: 'Bellandur, Bengaluru' }],
]);

const osrmCache = new Map<
  string,
  {
    distanceKm: number;
    baseDurationMins: number;
    coordinates: [number, number][];
    bounds: { north: number; south: number; east: number; west: number };
  }
>();

const commuteTipCache = new Map<
  string,
  { expiresAt: number; insight: string | null; quotaLimited: boolean }
>();

let commuteGeminiCooldownUntil = 0;

const SETTLEMENT_OSM_VALUES = new Set([
  'city',
  'town',
  'village',
  'municipality',
  'state',
  'administrative',
  'county',
  'district',
]);

const INDIAN_CITY_ALIAS_MAP: Record<string, string[]> = {
  bangalore: ['bengaluru', 'bangalore'],
  bengaluru: ['bengaluru', 'bangalore'],
  bombay: ['mumbai', 'bombay'],
  mumbai: ['mumbai', 'bombay'],
  calcutta: ['kolkata', 'calcutta'],
  kolkata: ['kolkata', 'calcutta'],
  madras: ['chennai', 'madras'],
  chennai: ['chennai', 'madras'],
  delhi: ['new delhi', 'delhi'],
  'new delhi': ['new delhi', 'delhi'],
  mysore: ['mysuru', 'mysore'],
  mysuru: ['mysuru', 'mysore'],
  trivandrum: ['thiruvananthapuram', 'trivandrum'],
  cochin: ['kochi', 'cochin'],
  gurgaon: ['gurugram', 'gurgaon'],
  gurugram: ['gurugram', 'gurgaon'],
  jatni: ['jatani', 'jatni'],
  jatani: ['jatani', 'jatni'],
};

function cleanLocationInput(raw: string): string {
  return raw.replace(/^(Home|Office)\s*:\s*/i, '').trim();
}

function formatPhotonFeature(f: PhotonGeoJsonFeature, idx: number): PhotonPlaceSuggestion | null {
  const coords = f.geometry?.coordinates;
  if (!coords || coords.length < 2) return null;
  const lng = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const p = f.properties ?? {};
  const primary = (p.name || p.street || p.locality || p.city || '').trim();
  if (!primary) return null;

  const secondaryParts = [p.locality, p.district, p.city, p.state]
    .map((part) => (part || '').trim())
    .filter(
      (part, i, arr) =>
        part.length > 0 &&
        part.toLowerCase() !== primary.toLowerCase() &&
        arr.indexOf(part) === i
    );

  const subtitle = secondaryParts.slice(0, 3).join(', ') || p.country || 'India';
  const compactCity = secondaryParts[0] || p.state || '';
  const label = compactCity ? `${primary}, ${compactCity}` : primary;

  return {
    id: `ph-${p.osm_type || 'n'}-${p.osm_id || idx}-${lat.toFixed(4)}`,
    name: primary,
    subtitle,
    label,
    lat,
    lng,
    osmValue: (p.osm_value || '').toLowerCase(),
  };
}

async function queryPhotonRaw(
  query: string,
  cityCenter?: LatLngPoint | null,
  limit = 5
): Promise<PhotonPlaceSuggestion[]> {
  try {
    const url = new URL('https://photon.komoot.io/api/');
    url.searchParams.set('q', query);
    url.searchParams.set('limit', String(limit));
    if (cityCenter && Number.isFinite(cityCenter.lat) && Number.isFinite(cityCenter.lng)) {
      url.searchParams.set('lat', cityCenter.lat.toFixed(5));
      url.searchParams.set('lon', cityCenter.lng.toFixed(5));
    }

    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': OSM_USER_AGENT, Accept: 'application/json' },
    });
    if (!res.ok) return [];

    const data = (await res.json()) as { features?: PhotonGeoJsonFeature[] };
    const features = Array.isArray(data.features) ? data.features : [];

    const indianFeatures = features.filter((f) => {
      const cc = (f.properties?.countrycode || '').toUpperCase();
      const country = (f.properties?.country || '').toLowerCase();
      return cc === 'IN' || country === 'india';
    });

    const seen = new Set<string>();
    const results: PhotonPlaceSuggestion[] = [];
    for (let i = 0; i < indianFeatures.length; i++) {
      const item = formatPhotonFeature(indianFeatures[i], i);
      if (!item) continue;
      const dedupeKey = `${item.name.toLowerCase()}|${item.lat.toFixed(3)}|${item.lng.toFixed(3)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      results.push(item);
    }
    return results;
  } catch {
    return [];
  }
}

async function searchPhotonIndianPlaces(
  rawQuery: string,
  cityName: string,
  cityCenter?: LatLngPoint | null,
  limit = 5
): Promise<PhotonPlaceSuggestion[]> {
  const cleaned = cleanLocationInput(rawQuery);
  if (!cleaned) return [];

  const primaryResults = await queryPhotonRaw(cleaned, cityCenter, limit);
  if (primaryResults.length > 0) return primaryResults;

  const normCleaned = cleaned.toLowerCase();
  const normCity = cityName.toLowerCase();
  const fallbackWithCity = normCleaned.includes(normCity)
    ? normCleaned.includes('india')
      ? cleaned
      : `${cleaned}, India`
    : `${cleaned}, ${cityName}, India`;

  const fallbackResults = await queryPhotonRaw(fallbackWithCity, cityCenter, limit);
  if (fallbackResults.length > 0) return fallbackResults;

  if (!normCleaned.includes('india')) {
    const indiaWideResults = await queryPhotonRaw(`${cleaned}, India`, cityCenter, limit);
    if (indiaWideResults.length > 0) return indiaWideResults;
  }

  return [];
}

function matchesPlaceName(candidateName: string, query: string): boolean {
  const c = candidateName.toLowerCase().trim();
  const q = query.toLowerCase().trim().replace(/,\s*india$/i, '').trim();
  if (c === q) return true;
  const aliases = INDIAN_CITY_ALIAS_MAP[q];
  return Boolean(aliases && aliases.includes(c));
}

async function geocodeIndianLocation(
  rawQuery: string,
  cityName: string,
  cityCenter?: LatLngPoint | null
): Promise<GeocodedPlace | null> {
  const cleaned = cleanLocationInput(rawQuery);
  if (!cleaned) return null;

  const cacheKey = `${cleaned.toLowerCase()}|${cityName.toLowerCase()}`;
  const cached = geocodeCache.get(cacheKey) ?? geocodeCache.get(cleaned.toLowerCase());
  if (cached) return cached;

  const normQuery = cleaned.toLowerCase();
  const normCity = cityName.toLowerCase();
  const looksStandalonePlace =
    !cleaned.includes(',') && cleaned.split(/\s+/).length <= 3 && !normQuery.includes(normCity);

  if (looksStandalonePlace) {
    const unbiasedHits = await queryPhotonRaw(`${cleaned}, India`, null, 6);
    const exactSettlement = unbiasedHits.find(
      (h) => matchesPlaceName(h.name, cleaned) && h.osmValue && SETTLEMENT_OSM_VALUES.has(h.osmValue)
    );
    if (exactSettlement) {
      const hit: GeocodedPlace = {
        lat: exactSettlement.lat,
        lng: exactSettlement.lng,
        displayName: exactSettlement.label,
      };
      geocodeCache.set(cacheKey, hit);
      return hit;
    }
  }

  const photonHits = await searchPhotonIndianPlaces(cleaned, cityName, cityCenter, 5);
  if (photonHits.length > 0) {
    const best = photonHits[0];
    const hit: GeocodedPlace = {
      lat: best.lat,
      lng: best.lng,
      displayName: best.label,
    };
    geocodeCache.set(cacheKey, hit);
    return hit;
  }

  return null;
}

function computeBounds(coords: [number, number][]) {
  let north = -90;
  let south = 90;
  let east = -180;
  let west = 180;
  for (const [lat, lng] of coords) {
    if (lat > north) north = lat;
    if (lat < south) south = lat;
    if (lng > east) east = lng;
    if (lng < west) west = lng;
  }
  return { north, south, east, west };
}

async function fetchOsrmDrivingRoute(origin: LatLngPoint, destination: LatLngPoint) {
  const key = `${origin.lat.toFixed(4)},${origin.lng.toFixed(4)}->${destination.lat.toFixed(4)},${destination.lng.toFixed(4)}`;
  const cached = osrmCache.get(key);
  if (cached) return cached;

  try {
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson&steps=false`;
    const res = await fetch(osrmUrl, {
      headers: { 'User-Agent': OSM_USER_AGENT, Accept: 'application/json' },
    });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      routes?: Array<{
        distance?: number;
        duration?: number;
        geometry?: { coordinates?: [number, number][] };
      }>;
    };

    const route = data.routes?.[0];
    if (!route || !route.geometry?.coordinates || route.geometry.coordinates.length < 2) {
      return null;
    }

    const coordinates: [number, number][] = route.geometry.coordinates.map(([lng, lat]) => [
      lat,
      lng,
    ]);
    const distanceKm = Number(Math.max(0.2, (route.distance ?? 0) / 1000).toFixed(1));
    const baseDurationMins = Math.max(3, Math.round((route.duration ?? 0) / 60));
    const bounds = computeBounds(coordinates);

    const parsed = { distanceKm, baseDurationMins, coordinates, bounds };
    osrmCache.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

function getCityTransitInfo(cityName: string, distanceKm: number) {
  if (distanceKm > 80) {
    return {
      hasMetro: true,
      lines: ['Indian Railways Express', 'Intercity AC Bus'],
      networkName: 'Indian Railways / Intercity AC',
    };
  }
  const norm = cityName.toLowerCase();
  if (/delhi|gurugram|gurgaon|noida|faridabad/.test(norm)) {
    return {
      hasMetro: true,
      lines: distanceKm > 10 ? ['Delhi Metro', 'Rapid Metro'] : ['Delhi Metro'],
      networkName: 'Delhi Metro',
    };
  }
  if (/mumbai|thane|navi mumbai/.test(norm)) {
    return {
      hasMetro: true,
      lines: ['Mumbai Metro', 'AC Local / BEST'],
      networkName: 'Mumbai Metro / AC Local',
    };
  }
  if (/bengaluru|bangalore/.test(norm)) {
    return {
      hasMetro: true,
      lines: ['Namma Metro', 'BMTC Vayu Vajra AC'],
      networkName: 'Namma Metro / AC Bus',
    };
  }
  if (/kolkata|howrah|salt lake/.test(norm)) {
    return {
      hasMetro: true,
      lines: ['Kolkata Metro', 'WBTC AC Bus'],
      networkName: 'Kolkata Metro',
    };
  }
  if (/hyderabad|chennai|pune|ahmedabad|jaipur|lucknow|kochi|nagpur/.test(norm)) {
    return {
      hasMetro: true,
      lines: [`${cityName} Metro`, 'City AC Bus'],
      networkName: `${cityName} Metro`,
    };
  }
  return {
    hasMetro: true,
    lines: ['Mo Bus / City AC Transit'],
    networkName: 'City AC Transit',
  };
}

async function fetchGeminiCommuteTip(params: {
  origin: string;
  destination: string;
  cityName: string;
  aqi: number;
  distanceKm: number;
  driveMins: number;
  transitMins: number;
  transitNetwork: string;
}): Promise<{ insight: string | null; quotaLimited: boolean }> {
  const cacheKey = `${params.origin.toLowerCase()}|${params.destination.toLowerCase()}|${params.cityName.toLowerCase()}`;
  const cached = commuteTipCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { insight: cached.insight, quotaLimited: cached.quotaLimited };
  }

  if (!getGeminiApiKey()) return { insight: null, quotaLimited: false };

  if (Date.now() < commuteGeminiCooldownUntil) {
    return { insight: null, quotaLimited: true };
  }

  const prompt = [
    `You are AeroPulse, an urban air-quality commute advisor for Indian families.`,
    `Route: "${params.origin}" to "${params.destination}" (${params.cityName}, India).`,
    `Road distance: ${params.distanceKm} km. Estimated drive: ${params.driveMins} min. Transit (${params.transitNetwork}): ~${params.transitMins} min. Current AQI: ${params.aqi}.`,
    `Write ONE concise sentence (max 22 words) recommending the cleanest practical Metro/AC bus or carpool strategy on this Indian corridor to minimize PM2.5 exposure.`,
    `Plain text only. No markdown, no bullets, no greetings.`,
  ].join('\n');

  try {
    const { result: text } = await executeWithGeminiFallback('commute', async (ai, model) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config:
          model === 'gemini-4-hydrogen'
            ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
            : undefined,
      });
      return (response.text || '').replace(/\s+/g, ' ').trim();
    });
    const resObj = { insight: text || null, quotaLimited: false };
    commuteTipCache.set(cacheKey, { ...resObj, expiresAt: Date.now() + CACHE_TTL_MS });
    return resObj;
  } catch (err) {
    if (isQuotaExhaustedError(err)) {
      commuteGeminiCooldownUntil = Date.now() + QUOTA_COOLDOWN_MS;
      return { insight: null, quotaLimited: true };
    }
    return { insight: null, quotaLimited: false };
  }
}

export function createCommuteRouter() {
  const router = express.Router();

  router.get('/commute/autocomplete', async (req: Request, res: Response) => {
    const query = sanitizeServerInput(req.query.q, 100);
    const cityName = sanitizeServerInput(req.query.city, 80) || 'New Delhi';
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);

    if (query.length < 2) {
      res.json({ suggestions: [] });
      return;
    }

    const cityCenter =
      Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lng: lon } : null;

    const suggestions = await searchPhotonIndianPlaces(query, cityName, cityCenter, 5);
    res.json({ suggestions });
  });

  router.post('/commute/analyze', geminiRateLimiter, async (req: Request, res: Response) => {
    const originRaw = sanitizeServerInput(req.body?.origin, 120);
    const destinationRaw = sanitizeServerInput(req.body?.destination, 120);
    const cityName = sanitizeServerInput(req.body?.cityName, 80) || 'New Delhi';
    const aqi = Math.max(10, Number(req.body?.aqi) || 180);
    const departureSlot = sanitizeServerInput(req.body?.departureSlot, 24) || '8:30-peak';
    const selectedMode = sanitizeServerInput(req.body?.selectedMode, 24) || 'metro';
    const rawCenter = req.body?.cityCenter;
    const cityCenter: LatLngPoint | null =
      rawCenter && Number.isFinite(Number(rawCenter.lat)) && Number.isFinite(Number(rawCenter.lng))
        ? { lat: Number(rawCenter.lat), lng: Number(rawCenter.lng) }
        : null;

    const rawOriginCoords = req.body?.originCoords;
    const rawDestCoords = req.body?.destinationCoords;
    const originCoords: GeocodedPlace | null =
      rawOriginCoords &&
      Number.isFinite(Number(rawOriginCoords.lat)) &&
      Number.isFinite(Number(rawOriginCoords.lng))
        ? { lat: Number(rawOriginCoords.lat), lng: Number(rawOriginCoords.lng), displayName: originRaw }
        : null;
    const destCoords: GeocodedPlace | null =
      rawDestCoords &&
      Number.isFinite(Number(rawDestCoords.lat)) &&
      Number.isFinite(Number(rawDestCoords.lng))
        ? { lat: Number(rawDestCoords.lat), lng: Number(rawDestCoords.lng), displayName: destinationRaw }
        : null;

    if (!originRaw || !destinationRaw) {
      res.status(400).json({ error: 'INVALID_ROUTE', message: 'Origin and destination are required.' });
      return;
    }

    const [originGeo, destinationGeo] = await Promise.all([
      originCoords
        ? Promise.resolve(originCoords)
        : geocodeIndianLocation(originRaw, cityName, cityCenter),
      destCoords
        ? Promise.resolve(destCoords)
        : geocodeIndianLocation(destinationRaw, cityName, cityCenter),
    ]);

    if (!originGeo || !destinationGeo) {
      res.status(404).json({
        error: 'PLACE_NOT_FOUND',
        message: `Could not locate "${!originGeo ? originRaw : destinationRaw}" in India. Pick a suggestion from the dropdown or add a nearby landmark.`,
      });
      return;
    }

    const osrmRoute = await fetchOsrmDrivingRoute(
      { lat: originGeo.lat, lng: originGeo.lng },
      { lat: destinationGeo.lat, lng: destinationGeo.lng }
    );

    if (!osrmRoute) {
      res.status(404).json({
        error: 'ROUTE_NOT_FOUND',
        message: 'OSRM could not compute a road route between those two Indian locations.',
      });
      return;
    }

    const trafficFactor =
      departureSlot === '8:30-peak' ? 1.28 : departureSlot === '10:30-mid' ? 1.12 : 1.0;
    const slotAqiFactor =
      departureSlot === '2:00-safe' ? 0.52 : departureSlot === '10:30-mid' ? 0.82 : 1.05;
    const slotAqi = Math.round(aqi * slotAqiFactor);

    const distanceKm = osrmRoute.distanceKm;
    const driveMins = Math.max(4, Math.round(osrmRoute.baseDurationMins * trafficFactor));
    const twoWheelerMins = Math.max(4, Math.round(driveMins * 0.84));
    const transitInfo = getCityTransitInfo(cityName, distanceKm);
    const transitMins =
      distanceKm > 80
        ? Math.max(60, Math.round(distanceKm * 0.95 + 30))
        : Math.max(6, Math.round(distanceKm * 2.25 + (distanceKm > 6 ? 10 : 7)));

    const startLocation = { lat: originGeo.lat, lng: originGeo.lng };
    const endLocation = { lat: destinationGeo.lat, lng: destinationGeo.lng };

    const driveMetrics: RouteOptionMetrics = {
      available: true,
      mode: 'DRIVE',
      distanceKm,
      durationMins: driveMins,
      coordinates: osrmRoute.coordinates,
      startLocation,
      endLocation,
      bounds: osrmRoute.bounds,
      transitLines: [],
    };

    const twoWheelerMetrics: RouteOptionMetrics = {
      available: true,
      mode: 'TWO_WHEELER',
      distanceKm,
      durationMins: twoWheelerMins,
      coordinates: osrmRoute.coordinates,
      startLocation,
      endLocation,
      bounds: osrmRoute.bounds,
      transitLines: [],
    };

    const transitMetrics: RouteOptionMetrics = {
      available: transitInfo.hasMetro,
      mode: 'TRANSIT',
      distanceKm,
      durationMins: transitMins,
      coordinates: osrmRoute.coordinates,
      startLocation,
      endLocation,
      bounds: osrmRoute.bounds,
      transitLines: transitInfo.lines,
    };

    const CAR_CO2_PER_KM = 0.192;
    const TWO_WHEELER_CO2_PER_KM = 0.072;
    const CARPOOL_CO2_PER_KM = 0.064;
    const TRANSIT_CO2_PER_KM = 0.032;

    const soloCarCo2 = Number((distanceKm * CAR_CO2_PER_KM).toFixed(2));
    const twoWheelerCo2 = Number((distanceKm * TWO_WHEELER_CO2_PER_KM).toFixed(2));

    const recModeUsed: 'transit' | 'carpool' =
      selectedMode === 'carpool' ? 'carpool' : 'transit';
    const recDurationMins = recModeUsed === 'transit' ? transitMins : driveMins;
    const recCo2Kg = Number(
      (distanceKm * (recModeUsed === 'transit' ? TRANSIT_CO2_PER_KM : CARPOOL_CO2_PER_KM)).toFixed(2)
    );
    const co2SavedKg = Number(Math.max(0.1, soloCarCo2 - recCo2Kg).toFixed(1));

    const recExposureAqi = Math.max(
      28,
      Math.round(slotAqi * (recModeUsed === 'transit' ? 0.34 : 0.48))
    );
    const recExposureLabel =
      recExposureAqi <= 80
        ? 'Low Exposure'
        : recExposureAqi <= 140
          ? 'Filtered Cabin'
          : 'Reduced Exposure';

    const highRiskIsTwoWheeler = selectedMode === 'two-wheeler';
    const highRiskMins = highRiskIsTwoWheeler ? twoWheelerMins : driveMins;
    const highRiskExposureAqi = Math.round(slotAqi * (highRiskIsTwoWheeler ? 1.18 : 1.0));
    const highRiskCo2Added = Number(
      (highRiskIsTwoWheeler ? twoWheelerCo2 : soloCarCo2).toFixed(1)
    );
    const highRiskExposureLabel =
      highRiskExposureAqi >= 250
        ? 'Severe Roadside Dose'
        : highRiskExposureAqi >= 150
          ? 'High Exposure'
          : 'Elevated Traffic NO₂';

    const gearBadges: Array<{
      label: string;
      tone: 'coral' | 'amber' | 'emerald' | 'cyan' | 'neutral';
    }> = [];

    if (slotAqi >= 200 || (slotAqi >= 150 && highRiskMins >= 25)) {
      gearBadges.push({ label: `N95 Mask Mandatory (${highRiskMins}m trip)`, tone: 'coral' });
    } else if (slotAqi >= 101) {
      gearBadges.push({ label: `N95 / KN95 Advised (${highRiskMins}m)`, tone: 'amber' });
    } else {
      gearBadges.push({ label: `Clean Air Ride (${highRiskMins}m)`, tone: 'emerald' });
    }

    if (slotAqi >= 120) {
      gearBadges.push({ label: 'Car AC: Recirculate Mode', tone: 'cyan' });
    }

    if (distanceKm >= 8) {
      gearBadges.push({ label: `Bundle Errands · Save ${distanceKm} km`, tone: 'emerald' });
    } else {
      gearBadges.push({ label: 'Bundle Evening Errands (2–4 PM)', tone: 'neutral' });
    }

    if (highRiskMins >= 35) {
      gearBadges.push({ label: 'Carry Water · Avoid Idling', tone: 'neutral' });
    }

    const geminiTip = await fetchGeminiCommuteTip({
      origin: originRaw,
      destination: destinationRaw,
      cityName,
      aqi: slotAqi,
      distanceKm,
      driveMins,
      transitMins,
      transitNetwork: transitInfo.networkName,
    });

    const osmRouteUrl = `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${originGeo.lat.toFixed(5)}%2C${originGeo.lng.toFixed(5)}%3B${destinationGeo.lat.toFixed(5)}%2C${destinationGeo.lng.toFixed(5)}`;

    res.json({
      originResolved: originGeo.displayName,
      destinationResolved: destinationGeo.displayName,
      routes: {
        transit: transitMetrics,
        drive: driveMetrics,
        twoWheeler: twoWheelerMetrics,
      },
      recommended: {
        title:
          recModeUsed === 'transit'
            ? `Transit: ${transitInfo.lines.slice(0, 2).join(' + ')}`
            : 'AC Carpool + Recirculate',
        modeUsed: recModeUsed,
        durationMins: recDurationMins,
        distanceKm,
        exposureAqi: recExposureAqi,
        exposureLabel: recExposureLabel,
        co2Kg: Number(recCo2Kg.toFixed(1)),
        co2SavedKg,
        transitLines: transitInfo.lines,
        whyLine:
          recModeUsed === 'transit'
            ? `Via ${transitInfo.networkName} cuts tailpipe PM2.5 dose ~66% over ${distanceKm} km.`
            : `Shared AC cabin cuts per-rider emissions by 67% over ${distanceKm} km.`,
      },
      highRisk: {
        title: highRiskIsTwoWheeler ? 'Open 2-Wheeler in Traffic' : 'Solo Car in Traffic',
        modeUsed: highRiskIsTwoWheeler ? 'two-wheeler' : 'car',
        durationMins: highRiskMins,
        distanceKm,
        exposureAqi: highRiskExposureAqi,
        exposureLabel: highRiskExposureLabel,
        co2AddedKg: highRiskCo2Added,
        whyLine: highRiskIsTwoWheeler
          ? `${highRiskMins} mins in open exhaust spikes direct PM2.5 & NO₂ intake.`
          : `${highRiskMins} mins stop-and-go driving adds ${highRiskCo2Added} kg CO₂ across ${distanceKm} km.`,
      },
      gearBadges,
      geminiInsight: geminiTip.insight,
      geminiQuotaLimited: geminiTip.quotaLimited,
      groundingLinks: [{ title: 'Open Route on OpenStreetMap', uri: osmRouteUrl }],
    });
  });

  return router;
}
