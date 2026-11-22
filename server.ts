import 'dotenv/config';
import crypto from 'crypto';
import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const OSM_USER_AGENT = 'AeroPulse-UrbanAirAssistant/1.0 (https://aeropulse.local)';
const CACHE_TTL_MS = 15 * 60 * 1000;
const QUOTA_COOLDOWN_MS = 5 * 60 * 1000;

function getGeminiApiKey(): string {
  return (process.env.GEMINI_API_KEY || '').trim();
}

function createGeminiClient(apiKey: string) {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function isQuotaExhaustedError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  return /429|RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(raw);
}

function sanitizeServerInput(raw: unknown, maxLength = 240): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/<[^>]*>/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/[<>`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

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

interface RoomVisionTrap {
  id: number;
  title: string;
  x: number;
  y: number;
  category: 'Free' | 'DIY' | 'Smart';
  costBadge: string;
  fixAction: string;
  whyImpact: string;
}

interface RoomVisionDiagnosis {
  riskLevel: 'Low' | 'Moderate' | 'High' | 'Severe';
  fixPotentialPercent: number;
  traps: RoomVisionTrap[];
  modelUsed?: string;
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

const roomVisionCache = new Map<
  string,
  { expiresAt: number; diagnosis: RoomVisionDiagnosis }
>();

interface LiveAirQualityCacheEntry {
  expiresAt: number;
  data: {
    aqi: number;
    severity: 'good' | 'moderate' | 'poor' | 'severe';
    severityLabel: string;
    pm25: number;
    pm10: number;
    no2: number;
    o3: number;
    indoorCo2Estimate: number;
    safeWindowLabel: string;
    safeStartIdx: number;
    safeEndIdx: number;
    hourlyTimeline: Array<{
      hourLabel: string;
      shortLabel: string;
      aqi: number;
      pm25: number;
      status: 'peak' | 'moderate' | 'safe';
    }>;
    fetchedAtIso: string;
    fetchedAtLabel: string;
    sourceLabel: string;
  };
}

interface TodayAdvisoryCacheEntry {
  expiresAt: number;
  data: {
    heroVerdict: string;
    asthmaTip: string;
    gasStoveTip: string;
    routines: Array<{
      id: string;
      period: 'Morning' | 'Afternoon' | 'Evening';
      title: string;
      impactPill: string;
      whyPill: string;
      completed: boolean;
    }>;
    modelUsed: string;
  };
}

const liveAqiCache = new Map<string, LiveAirQualityCacheEntry>();
const todayAdvisoryCache = new Map<string, TodayAdvisoryCacheEntry>();

let commuteGeminiCooldownUntil = 0;

function cleanLocationInput(raw: string): string {
  return raw.replace(/^(Home|Office)\s*:\s*/i, '').trim();
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
  geometry?: {
    coordinates?: [number, number];
  };
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
    .filter((part, i, arr) => part.length > 0 && part.toLowerCase() !== primary.toLowerCase() && arr.indexOf(part) === i);

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
      headers: {
        'User-Agent': OSM_USER_AGENT,
        Accept: 'application/json',
      },
    });
    if (!res.ok) return [];

    const data = (await res.json()) as { features?: PhotonGeoJsonFeature[] };
    const features = Array.isArray(data.features) ? data.features : [];

    // Prioritize Indian results strictly
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

  // Attempt 1: Fuzzy Photon search biased to active Indian city coordinates
  const primaryResults = await queryPhotonRaw(cleaned, cityCenter, limit);
  if (primaryResults.length > 0) return primaryResults;

  // Attempt 2: Automatic fallback appending active city name + ", India"
  const normCleaned = cleaned.toLowerCase();
  const normCity = cityName.toLowerCase();
  const fallbackWithCity = normCleaned.includes(normCity)
    ? normCleaned.includes('india')
      ? cleaned
      : `${cleaned}, India`
    : `${cleaned}, ${cityName}, India`;

  const fallbackResults = await queryPhotonRaw(fallbackWithCity, cityCenter, limit);
  if (fallbackResults.length > 0) return fallbackResults;

  // Attempt 3: Broader Pan-India fallback ("<query>, India")
  if (!normCleaned.includes('india')) {
    const indiaWideResults = await queryPhotonRaw(`${cleaned}, India`, cityCenter, limit);
    if (indiaWideResults.length > 0) return indiaWideResults;
  }

  return [];
}

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

function matchesPlaceName(candidateName: string, query: string): boolean {
  const c = candidateName.toLowerCase().trim();
  const q = query.toLowerCase().trim().replace(/,\s*india$/i, '').trim();
  if (c === q) return true;
  const aliases = INDIAN_CITY_ALIAS_MAP[q];
  if (aliases && aliases.includes(c)) return true;
  return false;
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
  const looksStandalonePlace = !cleaned.includes(',') && cleaned.split(/\s+/).length <= 3 && !normQuery.includes(normCity);

  // For standalone city/town names (e.g. "Bengaluru", "Jatani", "Pune"), check unbiased Pan-India first
  // so local bakeries/shops near the active city don't shadow a real intercity destination.
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

async function fetchOsrmDrivingRoute(
  origin: LatLngPoint,
  destination: LatLngPoint
): Promise<{
  distanceKm: number;
  baseDurationMins: number;
  coordinates: [number, number][];
  bounds: { north: number; south: number; east: number; west: number };
} | null> {
  const key = `${origin.lat.toFixed(4)},${origin.lng.toFixed(4)}->${destination.lat.toFixed(4)},${destination.lng.toFixed(4)}`;
  const cached = osrmCache.get(key);
  if (cached) return cached;

  try {
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson&steps=false`;
    const res = await fetch(osrmUrl, {
      headers: {
        'User-Agent': OSM_USER_AGENT,
        Accept: 'application/json',
      },
    });

    if (!res.ok) return null;

    const data = (await res.json()) as {
      code?: string;
      routes?: Array<{
        distance?: number;
        duration?: number;
        geometry?: {
          coordinates?: [number, number][];
        };
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

function getCityTransitInfo(cityName: string, distanceKm: number): {
  hasMetro: boolean;
  lines: string[];
  networkName: string;
} {
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

  const geminiKey = getGeminiApiKey();
  if (!geminiKey) return { insight: null, quotaLimited: false };

  if (Date.now() < commuteGeminiCooldownUntil) {
    return { insight: null, quotaLimited: true };
  }

  const ai = createGeminiClient(geminiKey);
  const prompt = [
    `You are AeroPulse, an urban air-quality commute advisor for Indian families.`,
    `Route: "${params.origin}" to "${params.destination}" (${params.cityName}, India).`,
    `Road distance: ${params.distanceKm} km. Estimated drive: ${params.driveMins} min. Transit (${params.transitNetwork}): ~${params.transitMins} min. Current AQI: ${params.aqi}.`,
    `Write ONE concise sentence (max 22 words) recommending the cleanest practical Metro/AC bus or carpool strategy on this Indian corridor to minimize PM2.5 exposure.`,
    `Plain text only. No markdown, no bullets, no greetings.`,
  ].join('\n');

  for (const model of ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'] as const) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config:
          model === 'gemini-4-hydrogen'
            ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
            : undefined,
      });
      const text = (response.text || '').replace(/\s+/g, ' ').trim();
      const resObj = { insight: text || null, quotaLimited: false };
      commuteTipCache.set(cacheKey, { ...resObj, expiresAt: Date.now() + CACHE_TTL_MS });
      return resObj;
    } catch (err) {
      if (isQuotaExhaustedError(err)) {
        if (model === 'gemini-3.1-flash-lite') {
          commuteGeminiCooldownUntil = Date.now() + QUOTA_COOLDOWN_MS;
          return { insight: null, quotaLimited: true };
        }
        continue;
      }
      return { insight: null, quotaLimited: false };
    }
  }

  return { insight: null, quotaLimited: true };
}

function sanitizeDiagnosis(raw: unknown): RoomVisionDiagnosis {
  const parsed = (raw ?? {}) as Partial<RoomVisionDiagnosis>;
  const validRiskLevels = new Set(['Low', 'Moderate', 'High', 'Severe']);
  const riskLevel =
    typeof parsed.riskLevel === 'string' && validRiskLevels.has(parsed.riskLevel)
      ? (parsed.riskLevel as RoomVisionDiagnosis['riskLevel'])
      : 'High';

  const fixPotentialPercent = Math.max(
    12,
    Math.min(92, Math.round(Number(parsed.fixPotentialPercent) || 54))
  );

  const rawTraps = Array.isArray(parsed.traps) ? parsed.traps.slice(0, 3) : [];
  const validCategories = new Set(['Free', 'DIY', 'Smart']);

  const traps: RoomVisionTrap[] = rawTraps.map((t, index) => {
    const item = (t ?? {}) as Partial<RoomVisionTrap>;
    const category =
      typeof item.category === 'string' && validCategories.has(item.category)
        ? (item.category as RoomVisionTrap['category'])
        : index === 0
          ? 'Free'
          : index === 1
            ? 'DIY'
            : 'Smart';

    const defaultX = index === 0 ? 32 : index === 1 ? 56 : 74;
    const defaultY = index === 0 ? 44 : index === 1 ? 66 : 38;

    return {
      id: index + 1,
      title: String(item.title || `Airflow Trap ${index + 1}`).trim(),
      x: Math.max(10, Math.min(90, Math.round(Number(item.x) || defaultX))),
      y: Math.max(12, Math.min(88, Math.round(Number(item.y) || defaultY))),
      category,
      costBadge: String(
        item.costBadge || (category === 'Free' ? 'Free' : category === 'DIY' ? '₹850' : 'Smart')
      ).trim(),
      fixAction: String(item.fixAction || 'Seal visible air gap and wet-mop').trim(),
      whyImpact: String(item.whyImpact || 'Cuts fine indoor PM2.5 buildup up to 35%.').trim(),
    };
  });

  if (traps.length === 0) {
    throw new Error('Gemini Vision returned an empty traps list.');
  }

  return {
    riskLevel,
    fixPotentialPercent,
    traps,
  };
}

const ROOM_AUDIT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    riskLevel: {
      type: Type.STRING,
      enum: ['Low', 'Moderate', 'High', 'Severe'],
      description: 'Overall indoor air quality risk rating for this room given the city AQI and visible features.',
    },
    fixPotentialPercent: {
      type: Type.INTEGER,
      description: 'Estimated percentage reduction in indoor PM2.5/NO2 achievable by applying all 3 fixes (between 18 and 88).',
    },
    traps: {
      type: Type.ARRAY,
      description: 'Exactly 3 distinct smog, dust, ventilation, or combustion traps visible in the room photo.',
      items: {
        type: Type.OBJECT,
        properties: {
          id: {
            type: Type.INTEGER,
            description: 'Sequential pin number: 1, 2, or 3.',
          },
          title: {
            type: Type.STRING,
            description: 'Punchy 3 to 4 word trap label (e.g., "Balcony Slider Air Gap", "Open LPG Burner Plume").',
          },
          x: {
            type: Type.NUMBER,
            description: 'Horizontal coordinate (0 to 100 percentage from left edge) pointing directly at the visible feature in the photo.',
          },
          y: {
            type: Type.NUMBER,
            description: 'Vertical coordinate (0 to 100 percentage from top edge) pointing directly at the visible feature in the photo.',
          },
          category: {
            type: Type.STRING,
            enum: ['Free', 'DIY', 'Smart'],
            description: 'Budget tier for the recommended fix.',
          },
          costBadge: {
            type: Type.STRING,
            description: 'Compact cost badge in Indian Rupees or tier label (e.g., "Free", "₹390", "₹950", "Smart").',
          },
          fixAction: {
            type: Type.STRING,
            description: 'Ultra-concise 4 to 6 word actionable directive.',
          },
          whyImpact: {
            type: Type.STRING,
            description: 'Crisp single-line health or PM2.5/NO2 reduction impact (max 11 words).',
          },
        },
        required: ['id', 'title', 'x', 'y', 'category', 'costBadge', 'fixAction', 'whyImpact'],
      },
    },
  },
  required: ['riskLevel', 'fixPotentialPercent', 'traps'],
};

const TODAY_ADVISORY_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    heroVerdict: {
      type: Type.STRING,
      description:
        'Punchy 1-line actionable verdict (5 to 9 words max) tailored to the exact live AQI, best 2-hour window, city, and persona.',
    },
    asthmaTip: {
      type: Type.STRING,
      description:
        'Concise 5 to 9 word extra precaution specifically for an Asthma profile under today’s live PM2.5/NO2.',
    },
    gasStoveTip: {
      type: Type.STRING,
      description:
        'Concise 5 to 9 word kitchen tip specifically for an Indian LPG gas stove household under today’s AQI.',
    },
    routines: {
      type: Type.ARRAY,
      description:
        'Exactly 5 personalized daily actions covering Morning (2 items), Afternoon (1 item anchored to the real best outdoor window), and Evening (2 items).',
      items: {
        type: Type.OBJECT,
        properties: {
          period: {
            type: Type.STRING,
            enum: ['Morning', 'Afternoon', 'Evening'],
          },
          title: {
            type: Type.STRING,
            description: 'Punchy 5 to 9 word action tailored to Indian families and the selected persona.',
          },
          impactPill: {
            type: Type.STRING,
            description: 'Short quantified impact badge (2 to 4 words, e.g., "↓ 40% PM2.5", "↓ 55% NO₂", "Clean 2h Window").',
          },
          whyPill: {
            type: Type.STRING,
            description: 'Concise 4 to 7 word explanation of why this helps right now.',
          },
        },
        required: ['period', 'title', 'impactPill', 'whyPill'],
      },
    },
  },
  required: ['heroVerdict', 'asthmaTip', 'gasStoveTip', 'routines'],
};

const COPILOT_ASK_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    headline: {
      type: Type.STRING,
      description: 'Crisp 5 to 10 word direct verdict answering the user’s question.',
    },
    answer: {
      type: Type.STRING,
      description:
        'Concise 2 to 3 sentence maximum explanation grounded strictly in the live city AQI, pollutants, hourly curve, and persona, clearly explaining WHY.',
    },
    impactTag: {
      type: Type.STRING,
      description: 'Short 3 to 5 word takeaway badge (e.g., "Best Window: 2 PM – 4 PM", "N95 + Recirculate AC").',
    },
  },
  required: ['headline', 'answer', 'impactTag'],
};

const COPILOT_CHAT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    directAnswer: {
      type: Type.STRING,
      description:
        'Bold 1-line direct answer (6 to 14 words max). Calibrate tone strictly to live AQI band and cite exact live AQI/PM2.5 when relevant. Never embed JSON tags in this text.',
    },
    steps: {
      type: Type.ARRAY,
      description:
        'Exactly 1 or 2 ultra-concise, scannable actionable steps (max 15 words each). Never mandate N95 masks when live AQI < 100. For intercity trips, give train/flight/highway guidance instead of local bus routes.',
      items: {
        type: Type.STRING,
      },
    },
    whyImpact: {
      type: Type.STRING,
      description:
        'Brief single-line "Why & Impact" explanation of the health or emission benefit (max 15 words). Never claim an action lowers PM2.5 to a value higher than current live PM2.5.',
    },
    mapAction: {
      type: Type.OBJECT,
      nullable: true,
      description:
        'Include ONLY when the user asks for a map, route, distance, or travel directions between two places (local or intercity). Omit or set null for non-routing questions.',
      properties: {
        action: {
          type: Type.STRING,
          enum: ['OPEN_MAP'],
          description: 'Always "OPEN_MAP" when triggering map plotting.',
        },
        origin: {
          type: Type.STRING,
          description:
            'Clean origin location name in India (e.g., "Jatani" or "Dwarka Sector 4, New Delhi"). Default to active city if user only specifies a destination.',
        },
        destination: {
          type: Type.STRING,
          description:
            'Clean destination location name in India (e.g., "Bengaluru" or "DLF Cyber City, Gurugram").',
        },
      },
      required: ['action', 'origin', 'destination'],
    },
  },
  required: ['directAnswer', 'steps', 'whyImpact'],
};

function classifyUsAqi(aqi: number): {
  severity: 'good' | 'moderate' | 'poor' | 'severe';
  severityLabel: string;
} {
  if (aqi <= 50) return { severity: 'good', severityLabel: 'GOOD' };
  if (aqi <= 100) return { severity: 'moderate', severityLabel: 'MODERATE' };
  if (aqi <= 200) return { severity: 'poor', severityLabel: 'POOR' };
  return { severity: 'severe', severityLabel: 'SEVERE' };
}

function formatHourLabels(hour24: number): { hourLabel: string; shortLabel: string } {
  const normalized = ((hour24 % 24) + 24) % 24;
  const suffix = normalized >= 12 ? 'PM' : 'AM';
  const h12 = normalized % 12 === 0 ? 12 : normalized % 12;
  return {
    hourLabel: `${h12}:00 ${suffix}`,
    shortLabel: `${h12} ${suffix}`,
  };
}

function formatIstTimestamp(date: Date): string {
  const formatted = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(date)
    .toUpperCase();
  return `Updated ${formatted} IST`;
}

function getPersonaDisplayName(persona: string): string {
  switch (persona) {
    case 'parent':
      return 'Parent with Kids';
    case 'senior':
      return 'Senior Citizen';
    case 'commuter':
      return 'Office Commuter';
    case 'student':
      return 'Student';
    default:
      return 'Indian Family Member';
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '6mb' }));

  // 1. Reverse Geocoding via OpenStreetMap Nominatim (Zero API key or billing required)
  app.post('/api/maps/reverse-geocode', async (req: Request, res: Response) => {
    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      res.status(400).json({ error: 'INVALID_COORDS', message: 'Valid lat and lng are required.' });
      return;
    }

    try {
      const url = new URL('https://nominatim.openstreetmap.org/reverse');
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('lat', String(lat));
      url.searchParams.set('lon', String(lng));
      url.searchParams.set('accept-language', 'en');

      const response = await fetch(url.toString(), {
        headers: {
          'User-Agent': OSM_USER_AGENT,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        res.status(502).json({
          error: 'REVERSE_GEOCODE_FAILED',
          message: 'OpenStreetMap reverse geocoding service is temporarily busy.',
        });
        return;
      }

      const data = (await response.json()) as {
        display_name?: string;
        address?: {
          city?: string;
          town?: string;
          village?: string;
          municipality?: string;
          state_district?: string;
          county?: string;
          suburb?: string;
          neighbourhood?: string;
          road?: string;
          state?: string;
          country_code?: string;
        };
      };

      const addr = data.address ?? {};
      const city =
        addr.city ||
        addr.town ||
        addr.municipality ||
        addr.village ||
        addr.state_district ||
        addr.county ||
        addr.state ||
        'India';

      const locality = addr.suburb || addr.neighbourhood || addr.road || '';
      const countryCode = (addr.country_code || 'in').toUpperCase();

      res.json({
        city,
        locality,
        state: addr.state || '',
        stateCode: countryCode === 'IN' ? 'IN' : countryCode,
        countryCode,
        formattedAddress: data.display_name || city,
        lat,
        lng,
      });
    } catch (err) {
      res.status(500).json({
        error: 'REVERSE_GEOCODE_FAILED',
        message: err instanceof Error ? err.message : 'Reverse geocoding failed.',
      });
    }
  });

  // 1b. Fuzzy Indian Place Autocomplete via Photon API (Zero API key required)
  app.get('/api/commute/autocomplete', async (req: Request, res: Response) => {
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

  // 2. OSRM + Photon Fuzzy Geocoding Commute & Air Exposure Analyzer (Zero API key required)
  app.post('/api/commute/analyze', async (req: Request, res: Response) => {
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
        ? {
            lat: Number(rawOriginCoords.lat),
            lng: Number(rawOriginCoords.lng),
            displayName: originRaw,
          }
        : null;
    const destCoords: GeocodedPlace | null =
      rawDestCoords &&
      Number.isFinite(Number(rawDestCoords.lat)) &&
      Number.isFinite(Number(rawDestCoords.lng))
        ? {
            lat: Number(rawDestCoords.lat),
            lng: Number(rawDestCoords.lng),
            displayName: destinationRaw,
          }
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
      gearBadges.push({
        label: `N95 Mask Mandatory (${highRiskMins}m trip)`,
        tone: 'coral',
      });
    } else if (slotAqi >= 101) {
      gearBadges.push({
        label: `N95 / KN95 Advised (${highRiskMins}m)`,
        tone: 'amber',
      });
    } else {
      gearBadges.push({
        label: `Clean Air Ride (${highRiskMins}m)`,
        tone: 'emerald',
      });
    }

    if (slotAqi >= 120) {
      gearBadges.push({
        label: 'Car AC: Recirculate Mode',
        tone: 'cyan',
      });
    }

    if (distanceKm >= 8) {
      gearBadges.push({
        label: `Bundle Errands · Save ${distanceKm} km`,
        tone: 'emerald',
      });
    } else {
      gearBadges.push({
        label: 'Bundle Evening Errands (2–4 PM)',
        tone: 'neutral',
      });
    }

    if (highRiskMins >= 35) {
      gearBadges.push({
        label: 'Carry Water · Avoid Idling',
        tone: 'neutral',
      });
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
      groundingLinks: [
        {
          title: 'Open Route on OpenStreetMap',
          uri: osmRouteUrl,
        },
      ],
    });
  });

  // 3. Real Gemini Vision Room Audit with Structured JSON & Dynamic (x%, y%) Pin Coordinates
  app.post('/api/room-audit/analyze', async (req: Request, res: Response) => {
    const geminiKey = getGeminiApiKey();
    if (!geminiKey) {
      res.status(503).json({
        error: 'GEMINI_KEY_MISSING',
        message: 'Gemini API key is not configured. Check Settings > Secrets.',
      });
      return;
    }

    const imageBase64 = String(req.body?.imageBase64 || '').trim();
    const mimeType = String(req.body?.mimeType || 'image/jpeg').trim();
    const cityName = String(req.body?.city || 'New Delhi').trim();
    const aqi = Math.max(10, Number(req.body?.aqi) || 250);
    const roomType = String(req.body?.roomType || 'Living Room').trim();
    const riskChips = Array.isArray(req.body?.riskChips)
      ? req.body.riskChips.map((c: unknown) => String(c)).filter(Boolean)
      : [];

    if (!imageBase64) {
      res.status(400).json({
        error: 'IMAGE_REQUIRED',
        message: 'A compressed room photo is required for Gemini Vision analysis.',
      });
      return;
    }

    const imgHash = crypto
      .createHash('sha1')
      .update(imageBase64.slice(0, 12000) + '|' + imageBase64.length)
      .digest('hex');
    const cacheKey = `${imgHash}|${cityName.toLowerCase()}|${aqi}|${roomType.toLowerCase()}|${riskChips
      .slice()
      .sort()
      .join(',')}`;

    const cached = roomVisionCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      res.json(cached.diagnosis);
      return;
    }

    const ai = createGeminiClient(geminiKey);
    const activeRisksText =
      riskChips.length > 0 ? riskChips.join(', ') : 'Standard urban apartment';

    const prompt = [
      `You are AeroPulse, an Indian indoor air quality & winter smog home-audit vision specialist.`,
      `Inspect the attached room photograph carefully and locate EXACTLY 3 concrete airflow, smog seepage, dust, or indoor combustion traps visible in the image.`,
      `Context:`,
      `- Indian City: ${cityName} (Live Outdoor AQI: ${aqi})`,
      `- Selected Room Type: ${roomType}`,
      `- Active Household Risk Factors: ${activeRisksText}`,
      `Strict rules:`,
      `1. Place each pin's (x, y) coordinates (0 to 100 percentage of image width/height) directly on the actual visible object in the photo (e.g., sliding door gap, window sill, gas stove burner, chimney hood, sheer curtains, study desk, or dead-air corner). Spread the 3 pins cleanly so they do not overlap.`,
      `2. Keep text ultra-punchy: title must be 3–4 words, fixAction must be 4–6 words, whyImpact must be 1 concise line with realistic PM2.5/NO2 impact.`,
      `3. Include a practical Indian household mix across Free (₹0), DIY (< ₹1,500 in ₹), and Smart tiers where appropriate.`,
      `4. Calibrate riskLevel ("Low" | "Moderate" | "High" | "Severe") and fixPotentialPercent realistically to ${cityName}'s ${aqi} AQI and the active risk factors.`,
    ].join('\n');

    const imagePart = {
      inlineData: {
        mimeType,
        data: imageBase64,
      },
    };

    let lastError: unknown = null;

    for (const model of ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'] as const) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: { parts: [imagePart, { text: prompt }] },
          config: {
            responseMimeType: 'application/json',
            responseSchema: ROOM_AUDIT_SCHEMA,
            ...(model === 'gemini-4-hydrogen'
              ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
              : {}),
          },
        });

        const jsonStr = (response.text || '').trim();
        if (!jsonStr) {
          throw new Error('Empty JSON returned by Gemini Vision.');
        }

        const parsed = JSON.parse(jsonStr);
        const diagnosis = sanitizeDiagnosis(parsed);
        diagnosis.modelUsed = model;

        roomVisionCache.set(cacheKey, {
          expiresAt: Date.now() + CACHE_TTL_MS,
          diagnosis,
        });

        res.json(diagnosis);
        return;
      } catch (err) {
        lastError = err;
        if (isQuotaExhaustedError(err) && model === 'gemini-4-hydrogen') {
          continue;
        }
        break;
      }
    }

    if (isQuotaExhaustedError(lastError)) {
      res.status(429).json({
        error: 'QUOTA_EXCEEDED',
        message:
          'Gemini Vision quota reached. Upgrade or select a billing-enabled API key in Settings > Secrets, or retry shortly.',
      });
      return;
    }

    const msg =
      lastError instanceof Error ? lastError.message : 'Gemini Vision analysis failed.';
    const status = /PERMISSION_DENIED|API_KEY_INVALID|403|400/i.test(msg) ? 403 : 502;
    res.status(status).json({
      error: 'VISION_AUDIT_FAILED',
      message:
        status === 403
          ? 'Gemini API key permission issue. Please check Settings > Secrets.'
          : 'Could not complete Gemini Vision room scan. Please tap Retry Scan.',
    });
  });

  // 4. Live Pan-India Air Quality via Open-Meteo Air Quality API (No API key required)
  app.get('/api/air-quality/live', async (req: Request, res: Response) => {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      res.status(400).json({ error: 'INVALID_COORDS', message: 'Valid lat and lon are required.' });
      return;
    }

    const cacheKey = `${lat.toFixed(3)},${lon.toFixed(3)}`;
    const cached = liveAqiCache.get(cacheKey);
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
      res.json(cached.data);
      return;
    }

    try {
      const apiUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${encodeURIComponent(
        lat.toFixed(4)
      )}&longitude=${encodeURIComponent(
        lon.toFixed(4)
      )}&current=us_aqi,pm2_5,pm10,nitrogen_dioxide,ozone&hourly=us_aqi,pm2_5&timezone=auto&forecast_days=1`;

      const upstream = await fetch(apiUrl, {
        headers: {
          'User-Agent': OSM_USER_AGENT,
          Accept: 'application/json',
        },
      });

      if (!upstream.ok) {
        res.status(502).json({
          error: 'OPEN_METEO_UPSTREAM_ERROR',
          message: `Open-Meteo Air Quality API returned ${upstream.status}.`,
        });
        return;
      }

      const raw = (await upstream.json()) as {
        current?: {
          time?: string;
          us_aqi?: number | null;
          pm2_5?: number | null;
          pm10?: number | null;
          nitrogen_dioxide?: number | null;
          ozone?: number | null;
        };
        hourly?: {
          time?: string[];
          us_aqi?: Array<number | null>;
          pm2_5?: Array<number | null>;
        };
      };

      const cur = raw.current ?? {};
      const times = raw.hourly?.time ?? [];
      const hourlyAqis = raw.hourly?.us_aqi ?? [];
      const hourlyPm25 = raw.hourly?.pm2_5 ?? [];

      const nowHour = (() => {
        if (cur.time && cur.time.includes('T')) {
          const h = Number(cur.time.split('T')[1]?.slice(0, 2));
          if (Number.isFinite(h)) return h;
        }
        return 12;
      })();

      const fallbackHourlyAqi =
        hourlyAqis[nowHour] ?? hourlyAqis.find((v) => typeof v === 'number' && Number.isFinite(v)) ?? 0;

      const liveAqi = Math.max(
        1,
        Math.round(Number(cur.us_aqi ?? fallbackHourlyAqi ?? 0))
      );
      const pm25 = Number(Math.max(0, Number(cur.pm2_5 ?? hourlyPm25[nowHour] ?? 0)).toFixed(1));
      const pm10 = Number(Math.max(0, Number(cur.pm10 ?? 0)).toFixed(1));
      const no2 = Number(Math.max(0, Number(cur.nitrogen_dioxide ?? 0)).toFixed(1));
      const o3 = Number(Math.max(0, Number(cur.ozone ?? 0)).toFixed(1));

      // Extract real 6 AM (06:00) to 11 PM (23:00) hourly slots (18 slots)
      const byHour = new Map<number, { aqi: number; pm25: number }>();
      for (let i = 0; i < times.length; i++) {
        const t = times[i];
        const hourStr = t?.split('T')[1]?.slice(0, 2);
        const h = Number(hourStr);
        if (!Number.isFinite(h) || h < 6 || h > 23) continue;
        const aVal = hourlyAqis[i];
        const pVal = hourlyPm25[i];
        byHour.set(h, {
          aqi: Math.max(1, Math.round(Number(aVal ?? liveAqi))),
          pm25: Number(Math.max(0, Number(pVal ?? pm25)).toFixed(1)),
        });
      }

      const rawSlots: Array<{ hour24: number; aqi: number; pm25: number }> = [];
      for (let h = 6; h <= 23; h++) {
        const entry = byHour.get(h);
        rawSlots.push({
          hour24: h,
          aqi: entry ? entry.aqi : liveAqi,
          pm25: entry ? entry.pm25 : pm25,
        });
      }

      // Find the actual lowest-AQI 2-hour window between 6 AM and 11 PM
      // Window starting at index i spans hour(i) to hour(i+2), covering slots i and i+1
      let bestStartIdx = 0;
      let bestAvg = Number.POSITIVE_INFINITY;
      for (let i = 0; i <= rawSlots.length - 2; i++) {
        const avg2h = (rawSlots[i].aqi + rawSlots[i + 1].aqi) / 2;
        if (avg2h < bestAvg) {
          bestAvg = avg2h;
          bestStartIdx = i;
        }
      }
      const bestEndIdx = bestStartIdx + 1;
      const bestStartHour24 = rawSlots[bestStartIdx].hour24;
      const bestEndHour24 = bestStartHour24 + 2;
      const bestStartText = formatHourLabels(bestStartHour24).shortLabel;
      const bestEndText =
        bestEndHour24 === 24 ? '12 AM' : formatHourLabels(bestEndHour24).shortLabel;
      const safeWindowLabel = `${bestStartText} – ${bestEndText}`;

      const hourlyTimeline = rawSlots.map((slot, idx) => {
        const labels = formatHourLabels(slot.hour24);
        let status: 'peak' | 'moderate' | 'safe' = 'moderate';
        if (idx === bestStartIdx || idx === bestEndIdx || slot.aqi <= 50) {
          status = 'safe';
        } else if (slot.aqi > 100) {
          status = 'peak';
        }
        return {
          hourLabel: labels.hourLabel,
          shortLabel: labels.shortLabel,
          aqi: slot.aqi,
          pm25: slot.pm25,
          status,
        };
      });

      const { severity, severityLabel } = classifyUsAqi(liveAqi);
      const now = new Date();
      // Estimate typical closed-window indoor CO2 impact when outdoor AQI forces sealing
      const indoorCo2Estimate = Math.min(
        1180,
        Math.max(480, Math.round(520 + Math.min(liveAqi, 320) * 1.45))
      );

      const payload: LiveAirQualityCacheEntry['data'] = {
        aqi: liveAqi,
        severity,
        severityLabel,
        pm25,
        pm10,
        no2,
        o3,
        indoorCo2Estimate,
        safeWindowLabel,
        safeStartIdx: bestStartIdx,
        safeEndIdx: bestEndIdx,
        hourlyTimeline,
        fetchedAtIso: now.toISOString(),
        fetchedAtLabel: formatIstTimestamp(now),
        sourceLabel: 'Open-Meteo / CPCB Grid',
      };

      liveAqiCache.set(cacheKey, {
        expiresAt: Date.now() + 5 * 60 * 1000,
        data: payload,
      });

      res.json(payload);
    } catch (err) {
      res.status(502).json({
        error: 'OPEN_METEO_FETCH_FAILED',
        message:
          err instanceof Error
            ? err.message
            : 'Unable to fetch real-time Open-Meteo air quality data.',
      });
    }
  });

  // 5. Pan-India City Search via Open-Meteo Free Geocoding API
  app.get('/api/air-quality/search', async (req: Request, res: Response) => {
    const query = sanitizeServerInput(req.query.q, 80);
    if (query.length < 2) {
      res.json({ results: [] });
      return;
    }

    try {
      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
        query
      )}&count=8&language=en&format=json&countryCode=IN`;

      const upstream = await fetch(geoUrl, {
        headers: {
          'User-Agent': OSM_USER_AGENT,
          Accept: 'application/json',
        },
      });

      if (!upstream.ok) {
        res.status(502).json({
          error: 'GEOCODING_FAILED',
          message: 'Open-Meteo city search is temporarily unavailable.',
          results: [],
        });
        return;
      }

      const data = (await upstream.json()) as {
        results?: Array<{
          id: number;
          name: string;
          admin1?: string;
          country_code?: string;
          latitude: number;
          longitude: number;
        }>;
      };

      const results = (data.results ?? [])
        .filter((item) => !item.country_code || item.country_code.toUpperCase() === 'IN')
        .slice(0, 6)
        .map((item) => ({
          id: `om-${item.id}`,
          name: item.name,
          state: item.admin1 || 'India',
          lat: item.latitude,
          lng: item.longitude,
        }));

      res.json({ results });
    } catch {
      res.status(502).json({
        error: 'GEOCODING_FAILED',
        message: 'Could not search Indian cities right now.',
        results: [],
      });
    }
  });

  // 6. Context-Aware Gemini Hero Verdict & Morning/Afternoon/Evening Routine
  app.post('/api/today/advisory', async (req: Request, res: Response) => {
    const geminiKey = getGeminiApiKey();
    if (!geminiKey) {
      res.status(503).json({
        error: 'GEMINI_KEY_MISSING',
        message: 'Gemini API key is not configured. Check Settings > Secrets.',
      });
      return;
    }

    const city = String(req.body?.city || 'New Delhi').trim();
    const state = String(req.body?.state || 'India').trim();
    const aqi = Math.max(1, Math.round(Number(req.body?.aqi) || 100));
    const severityLabel = String(req.body?.severityLabel || 'MODERATE').trim();
    const pm25 = Number(req.body?.pm25) || 0;
    const pm10 = Number(req.body?.pm10) || 0;
    const no2 = Number(req.body?.no2) || 0;
    const o3 = Number(req.body?.o3) || 0;
    const bestWindow = String(req.body?.bestWindow || '2 PM – 4 PM').trim();
    const persona = String(req.body?.persona || 'parent').trim();
    const modifiers: string[] = Array.isArray(req.body?.modifiers)
      ? req.body.modifiers.map((m: unknown) => String(m)).filter(Boolean)
      : [];

    const sortedMods = modifiers.slice().sort().join(',');
    const cacheKey = `${city.toLowerCase()}|${Math.round(aqi / 5) * 5}|${bestWindow}|${persona}|${sortedMods}`;
    const cached = todayAdvisoryCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      res.json(cached.data);
      return;
    }

    const ai = createGeminiClient(geminiKey);
    const personaName = getPersonaDisplayName(persona);
    const riskText =
      modifiers.length > 0
        ? modifiers
            .map((m) => (m === 'asthma' ? 'Asthma / Sensitive Lungs' : 'Indian Gas Stove / LPG Cooking'))
            .join(', ')
        : 'None selected';

    const prompt = [
      `You are AeroPulse, a calm, clinical-grade urban air quality advisor for Indian families.`,
      `Generate a hyper-personalized, ultra-low-text-density Hero Verdict and 5-item Daily Routine strictly grounded in these LIVE Open-Meteo readings (NEVER invent or alter AQI numbers):`,
      `- City: ${city}, ${state}, India`,
      `- Live US AQI: ${aqi} (${severityLabel})`,
      `- Live Pollutants: PM2.5 = ${pm25} μg/m³, PM10 = ${pm10} μg/m³, NO₂ = ${no2} μg/m³, O₃ = ${o3} μg/m³`,
      `- Lowest-AQI 2-Hour Safe Outdoor Window Today: ${bestWindow}`,
      `- Active User Persona: ${personaName}`,
      `- Active Household Risk Chips: ${riskText}`,
      `Rules:`,
      `1. heroVerdict: One crisp, Apple-style actionable headline (5–9 words max) referencing the real condition or ${bestWindow} safe window for a ${personaName}.`,
      `2. routines: Exactly 5 practical Indian household actions — 2 Morning, 1 Afternoon (explicitly leveraging ${bestWindow}), and 2 Evening. Tailor directly to ${personaName} and active risk chips (${riskText}).`,
      `3. Keep every title (5–9 words), impactPill (2–4 words), and whyPill (4–7 words) ultra-crisp and grounded in real air-quality physics.`,
      `4. Always return concise asthmaTip and gasStoveTip tailored to ${city}'s live ${pm25} μg/m³ PM2.5 and ${no2} μg/m³ NO₂.`,
    ].join('\n');

    let lastError: unknown = null;
    for (const model of ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'] as const) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: TODAY_ADVISORY_SCHEMA,
            ...(model === 'gemini-4-hydrogen'
              ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
              : {}),
          },
        });

        const jsonStr = (response.text || '').trim();
        if (!jsonStr) throw new Error('Empty JSON from Gemini advisory.');

        const parsed = JSON.parse(jsonStr) as {
          heroVerdict?: string;
          asthmaTip?: string;
          gasStoveTip?: string;
          routines?: Array<{
            period?: 'Morning' | 'Afternoon' | 'Evening';
            title?: string;
            impactPill?: string;
            whyPill?: string;
          }>;
        };

        const validPeriods = new Set(['Morning', 'Afternoon', 'Evening']);
        const routines = (Array.isArray(parsed.routines) ? parsed.routines : [])
          .slice(0, 6)
          .map((item, idx) => ({
            id: `gen-${persona}-${idx + 1}`,
            period: (validPeriods.has(String(item.period))
              ? item.period
              : idx < 2
                ? 'Morning'
                : idx === 2
                  ? 'Afternoon'
                  : 'Evening') as 'Morning' | 'Afternoon' | 'Evening',
            title: String(item.title || 'Monitor outdoor AQI before stepping out').trim(),
            impactPill: String(item.impactPill || 'Lower PM2.5').trim(),
            whyPill: String(item.whyPill || `Calibrated for ${aqi} AQI`).trim(),
            completed: false,
          }));

        if (!parsed.heroVerdict || routines.length === 0) {
          throw new Error('Incomplete advisory structure returned by Gemini.');
        }

        const payload: TodayAdvisoryCacheEntry['data'] = {
          heroVerdict: String(parsed.heroVerdict).trim(),
          asthmaTip: String(parsed.asthmaTip || 'Keep rescue inhaler ready outdoors').trim(),
          gasStoveTip: String(parsed.gasStoveTip || 'Run kitchen chimney 5 mins early').trim(),
          routines,
          modelUsed: model,
        };

        todayAdvisoryCache.set(cacheKey, {
          expiresAt: Date.now() + CACHE_TTL_MS,
          data: payload,
        });

        res.json(payload);
        return;
      } catch (err) {
        lastError = err;
        if (isQuotaExhaustedError(err) && model === 'gemini-4-hydrogen') {
          continue;
        }
        break;
      }
    }

    if (isQuotaExhaustedError(lastError)) {
      res.status(429).json({
        error: 'QUOTA_EXCEEDED',
        message:
          'Gemini quota reached. Select a billing-enabled API key in Settings > Secrets, or retry shortly.',
      });
      return;
    }

    const msg = lastError instanceof Error ? lastError.message : 'Gemini advisory failed.';
    const status = /PERMISSION_DENIED|API_KEY_INVALID|403|400/i.test(msg) ? 403 : 502;
    res.status(status).json({
      error: 'ADVISORY_FAILED',
      message:
        status === 403
          ? 'Gemini API key permission issue. Please check Settings > Secrets.'
          : 'Could not generate Gemini personalized verdict right now.',
    });
  });

  // 7. Live "Ask AeroPulse" Floating Copilot grounded in real-time Open-Meteo AQI
  app.post('/api/today/ask', async (req: Request, res: Response) => {
    const geminiKey = getGeminiApiKey();
    if (!geminiKey) {
      res.status(503).json({
        error: 'GEMINI_KEY_MISSING',
        message: 'Gemini API key is not configured. Check Settings > Secrets.',
      });
      return;
    }

    const question = String(req.body?.question || '').trim();
    const ctx = req.body?.context ?? {};

    if (!question) {
      res.status(400).json({ error: 'QUESTION_REQUIRED', message: 'Please enter a question.' });
      return;
    }

    const city = String(ctx.city || 'New Delhi').trim();
    const state = String(ctx.state || 'India').trim();
    const aqi = Math.max(1, Math.round(Number(ctx.aqi) || 100));
    const severityLabel = String(ctx.severityLabel || 'MODERATE').trim();
    const pm25 = Number(ctx.pm25) || 0;
    const pm10 = Number(ctx.pm10) || 0;
    const no2 = Number(ctx.no2) || 0;
    const o3 = Number(ctx.o3) || 0;
    const bestWindow = String(ctx.bestWindow || '2 PM – 4 PM').trim();
    const hourlySummary = String(ctx.hourlySummary || '').trim();
    const personaName = getPersonaDisplayName(String(ctx.persona || 'parent'));
    const modifiers: string[] = Array.isArray(ctx.modifiers)
      ? ctx.modifiers.map((m: unknown) => String(m)).filter(Boolean)
      : [];
    const riskText =
      modifiers.length > 0
        ? modifiers
            .map((m) => (m === 'asthma' ? 'Asthma / Sensitive Lungs' : 'LPG Gas Stove Household'))
            .join(', ')
        : 'None';

    const systemInstruction = [
      `You are AeroPulse, an Apple-grade air quality copilot for Indian families.`,
      `LIVE REAL-TIME TELEMETRY CONTEXT (from Open-Meteo — NEVER invent different AQI numbers):`,
      `- Active City: ${city}, ${state}, India`,
      `- Current Live US AQI: ${aqi} (${severityLabel})`,
      `- Current Pollutants: PM2.5 = ${pm25} μg/m³, PM10 = ${pm10} μg/m³, NO₂ = ${no2} μg/m³, Ozone = ${o3} μg/m³`,
      `- Lowest-AQI 2-Hour Safe Outdoor Window Today: ${bestWindow}`,
      hourlySummary ? `- Today's Live Hourly US AQI Forecast: ${hourlySummary}` : '',
      `- Active User Persona: ${personaName}`,
      `- Active Household Risk Chips: ${riskText}`,
      `RESPONSE RULES:`,
      `1. Ground every answer in the real-time AQI, pollutant levels, and hourly forecast above.`,
      `2. Keep "answer" strictly 2 to 3 concise sentences max, plain text (no markdown bullets or asterisks), and ALWAYS explain WHY based on the pollutants, inversion timing, or persona risks.`,
      `3. Give practical Indian-context advice (N95, Metro, wet mopping, chimney/rear burner, ${bestWindow} ventilation).`,
    ]
      .filter(Boolean)
      .join('\n');

    const ai = createGeminiClient(geminiKey);
    let lastError: unknown = null;

    for (const model of ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'] as const) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: question,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: COPILOT_ASK_SCHEMA,
            ...(model === 'gemini-4-hydrogen'
              ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
              : {}),
          },
        });

        const jsonStr = (response.text || '').trim();
        if (!jsonStr) throw new Error('Empty response from Gemini copilot.');

        const parsed = JSON.parse(jsonStr) as {
          headline?: string;
          answer?: string;
          impactTag?: string;
        };

        res.json({
          headline: String(parsed.headline || `${city} Air Guidance (${aqi} AQI)`).trim(),
          answer: String(parsed.answer || '').trim(),
          impactTag: String(parsed.impactTag || `Safe Window: ${bestWindow}`).trim(),
          modelUsed: model,
        });
        return;
      } catch (err) {
        lastError = err;
        if (isQuotaExhaustedError(err) && model === 'gemini-4-hydrogen') {
          continue;
        }
        break;
      }
    }

    if (isQuotaExhaustedError(lastError)) {
      res.status(429).json({
        error: 'QUOTA_EXCEEDED',
        message:
          'Gemini quota reached. Upgrade or select a billing-enabled API key in Settings > Secrets, or retry shortly.',
      });
      return;
    }

    const msg = lastError instanceof Error ? lastError.message : 'Gemini copilot failed.';
    const status = /PERMISSION_DENIED|API_KEY_INVALID|403|400/i.test(msg) ? 403 : 502;
    res.status(status).json({
      error: 'COPILOT_FAILED',
      message:
        status === 403
          ? 'Gemini API key permission issue. Please check Settings > Secrets.'
          : 'Could not reach AeroPulse Gemini copilot right now. Please try again.',
    });
  });

  // 8. Global Multi-Turn "Ask AeroPulse" AI Copilot synced across Today, Room Audit, and Commute & Impact
  app.post('/api/copilot/chat', async (req: Request, res: Response) => {
    const geminiKey = getGeminiApiKey();
    if (!geminiKey) {
      res.status(503).json({
        error: 'GEMINI_KEY_MISSING',
        message: 'Gemini API key is not configured. Check Settings > Secrets.',
      });
      return;
    }

    const message = sanitizeServerInput(req.body?.message, 500);
    if (!message) {
      res.status(400).json({ error: 'MESSAGE_REQUIRED', message: 'Please enter a message.' });
      return;
    }

    const rawHistory = Array.isArray(req.body?.history) ? req.body.history : [];
    const ctx = req.body?.context ?? {};
    const tel = ctx.telemetry ?? {};
    const profile = ctx.profile ?? {};
    const roomAudit = ctx.roomAudit ?? null;
    const commute = ctx.commute ?? null;
    const activeHabits = Array.isArray(ctx.activeHabits) ? ctx.activeHabits : [];

    const city = String(tel.city || 'New Delhi').trim();
    const state = String(tel.state || 'India').trim();
    const aqi = Math.max(1, Math.round(Number(tel.aqi) || 0));
    const severityLabel = String(tel.severityLabel || 'MODERATE').trim();
    const pm25 = Number(tel.pm25) || 0;
    const pm10 = Number(tel.pm10) || 0;
    const no2 = Number(tel.no2) || 0;
    const o3 = Number(tel.o3) || 0;
    const safeWindow = String(tel.safeWindowLabel || '2 PM – 4 PM').trim();
    const hourlySummary = String(tel.hourlySummary || '').trim();
    const activeTab = String(ctx.activeTab || 'Today').trim();
    const personaLabel = String(
      profile.personaLabel || getPersonaDisplayName(String(profile.personaId || 'parent'))
    ).trim();
    const riskChips: string[] = Array.isArray(profile.riskChips)
      ? profile.riskChips.map((r: unknown) => String(r)).filter(Boolean)
      : [];

    const roomSection =
      roomAudit && Array.isArray(roomAudit.traps) && roomAudit.traps.length > 0
        ? [
            `LATEST ROOM AUDIT SCAN (${roomAudit.roomLabel}, Risk: ${roomAudit.riskLevel}, Fix Potential: -${roomAudit.fixPotentialPercent}% PM2.5):`,
            ...roomAudit.traps.map(
              (t: {
                id?: number;
                title?: string;
                category?: string;
                costBadge?: string;
                fixAction?: string;
                whyImpact?: string;
              }) =>
                `  • Pin ${t.id}: ${t.title} [${t.category} ${t.costBadge}] — Fix: ${t.fixAction} (${t.whyImpact})`
            ),
            roomAudit.addedFixes?.length > 0
              ? `  • Already added to user's Indoor Air Quality Hacks: ${roomAudit.addedFixes.join('; ')}`
              : `  • No Room Audit fixes added to Indoor Air Quality Hacks yet.`,
          ].join('\n')
        : 'LATEST ROOM AUDIT SCAN: Not scanned yet in this session.';

    const commuteSection =
      commute && commute.origin && commute.destination
        ? [
            `SAVED LOCAL COMMUTE ROUTE (Background reference ONLY — do NOT cite if user asks about an intercity trip to another city):`,
            `  • Local Corridor: "${commute.origin}" → "${commute.destination}"`,
            commute.distanceKm
              ? `  • Real OSRM Distance & Time: ${commute.distanceKm} km, ${commute.durationMins} mins (Mode: ${commute.selectedMode}, Slot: ${commute.departureSlot})`
              : `  • Mode: ${commute.selectedMode}, Slot: ${commute.departureSlot}`,
            commute.recommendedTitle
              ? `  • Recommended Low-Emission Option: ${commute.recommendedTitle} (~${commute.exposureAqi} AQI cabin, saves ${commute.co2SavedKg} kg CO₂/trip)`
              : '',
          ]
            .filter(Boolean)
            .join('\n')
        : 'SAVED LOCAL COMMUTE ROUTE: No custom route plotted yet.';

    const habitsSection =
      activeHabits.length > 0
        ? `TOGGLED HABIT SWAPS IN SIMULATOR:\n${activeHabits
            .map(
              (h: { title?: string; daysPerWeek?: number; tag?: string }) =>
                `  • ${h.title} (${h.daysPerWeek} days/wk — ${h.tag})`
            )
            .join('\n')}`
        : 'TOGGLED HABIT SWAPS: None currently toggled on.';

    const activeSeverityBand =
      aqi <= 50
        ? '0–50 (GOOD): Reassuring tone. No mask needed. Encourage outdoor activity and natural ventilation.'
        : aqi <= 100
          ? '51–100 (MODERATE): Normal outdoor activity is generally fine; only advise mild caution for Asthma/Seniors during peak traffic. STRICTLY DO NOT mandate or recommend N95 masks.'
          : aqi <= 200
            ? '101–200 (POOR): Limit prolonged heavy outdoor exertion; consider N95/KN95 masks for sensitive groups (Asthma/Seniors/Kids) or heavy traffic corridors.'
            : '200+ (VERY POOR / SEVERE): Strict indoor directives, N95 masks outdoors, window/door sealing, and purifier/AC recirculation.';

    const stepStyleHint =
      aqi <= 100
        ? 'natural ventilation, timing around peak traffic, AC transit/train choices, kitchen exhaust, ₹ cost context (NO N95 mask mandate)'
        : 'N95 mask fit, AC Metro/transit, wet-mopping, kitchen exhaust, window sealing, ₹ cost context';

    const systemInstruction = [
      `You are AeroPulse, an Apple-grade, multi-turn Urban Air Quality & Travel AI Copilot for Indian families.`,
      `=== LIVE GLOBAL APP CONTEXT (Updated in real time on every message) ===`,
      `ACTIVE TAB: ${activeTab}`,
      `LIVE OPEN-METEO AIR TELEMETRY:`,
      `  • Active City: ${city}, ${state}, India`,
      `  • Exact Live US AQI: ${aqi} (${severityLabel})`,
      `  • Exact Live Pollutants: PM2.5 = ${pm25} μg/m³, PM10 = ${pm10} μg/m³, NO₂ = ${no2} μg/m³, Ozone = ${o3} μg/m³`,
      `  • Calculated Safe Outdoor Window Today: ${safeWindow}`,
      hourlySummary ? `  • Today's Live Hourly US AQI (6 AM – 11 PM): ${hourlySummary}` : '',
      `USER PROFILE:`,
      `  • Active Persona: ${personaLabel}`,
      `  • Active Risk Chips: ${riskChips.length > 0 ? riskChips.join(', ') : 'None'}`,
      roomSection,
      commuteSection,
      habitsSection,
      `=== 1. STRICT AQI SEVERITY CALIBRATION (STOP SEVERE-SMOG BIAS) ===`,
      `CURRENT ACTIVE BAND FOR LIVE AQI ${aqi}: ${activeSeverityBand}`,
      `Follow these exact US AQI thresholds:`,
      `  • 0–50 (Good): Reassuring tone. No mask needed. Encourage outdoor activity and open windows.`,
      `  • 51–100 (Moderate): Normal outdoor activity is generally fine; only advise mild caution for Asthma/Seniors during peak traffic. NEVER mandate or push N95 masks when AQI < 100.`,
      `  • 101–200 (Poor): Recommend limiting prolonged outdoor exertion and considering masks for sensitive groups.`,
      `  • 200+ (Very Poor / Severe): Strict indoor directives, N95 masks, window sealing, and HEPA purification.`,
      `NUMERIC & MATH SANITY GUARDRAIL:`,
      `  • NEVER invent, estimate, or contradict numbers. Always cite the exact live AQI (${aqi}) and PM2.5 (${pm25} μg/m³) passed above.`,
      `  • NEVER claim an action "lowers" or "reduces" PM2.5 to a number higher than or equal to the current live PM2.5 (${pm25} μg/m³). If live PM2.5 is already low, advise keeping indoor air fresh rather than quoting impossible reductions.`,
      `=== 2. CONTEXT RELEVANCE (LOCAL VS. INTERCITY TRAVEL) ===`,
      `  • ONLY reference the saved local commute route above when the user specifically asks about their daily local commute, local station/bus, or current Commute tab route.`,
      `  • If the user asks about traveling to a DIFFERENT city or an intercity trip (e.g., "Jatani to Bangalore", "Delhi to Jaipur", "Mumbai to Pune"), COMPLETELY IGNORE the saved local commute route. Answer specifically for that intercity trip (Indian Railways trains, flights, or NH highway timing & emission comparison) instead of repeating local city bus/metro routes.`,
      `=== 3. INTERACTIVE MAP CAPABILITY ("OPEN_MAP" ACTION) ===`,
      `  • AeroPulse HAS a live interactive Leaflet + OpenStreetMap route map built into the "Commute & Impact" tab. NEVER say "I cannot generate maps", "I don't have a map", or "check Google Maps".`,
      `  • Whenever the user asks for a map, route, distance, or travel directions between two places (local OR intercity, e.g., "Show Jatani to Bengaluru on map", "Route from Jatani to Bangalore", "How do I get from Patia to Airport"), populate the structured JSON field \`mapAction\` with {"action": "OPEN_MAP", "origin": "<clean origin>", "destination": "<clean destination>"}.`,
      `  • If the user only names a destination (e.g., "route to Bengaluru"), set "origin" to "${city}".`,
      `  • When \`mapAction\` is populated, mention briefly that they can tap the button below to plot it live on the Commute & Impact map.`,
      `  • Do NOT include raw JSON text inside directAnswer, steps, or whyImpact—put it strictly in the \`mapAction\` schema field.`,
      `=== 4. CONCISE APPLE HIG RESPONSE FORMAT ===`,
      `Keep every reply ultra-concise and scannable (max 3–4 short lines total):`,
      `  - directAnswer: Crisp 1-line direct answer (6–14 words max).`,
      `  - steps: 1 to 2 actionable steps (max 15 words each) tailored to ${personaLabel} (${stepStyleHint}).`,
      `  - whyImpact: Brief 1-line "Why & Impact" explaining the health or CO₂/PM2.5 benefit (max 15 words).`,
      `Reference the user's actual Room Audit traps, added fixes, or toggled habits when relevant to the question or active tab (${activeTab}). If the city or persona changed since earlier turns, immediately adapt to (${city}, ${aqi} AQI, ${personaLabel}).`,
    ]
      .filter(Boolean)
      .join('\n');

    // Keep the most recent 12 turns cleanly alternating user/model
    const historyContents = rawHistory
      .slice(-12)
      .filter(
        (h: unknown): h is { role: 'user' | 'model'; text: string } =>
          Boolean(h) &&
          typeof (h as { text?: unknown }).text === 'string' &&
          ((h as { role?: unknown }).role === 'user' || (h as { role?: unknown }).role === 'model') &&
          (h as { text: string }).text.trim().length > 0
      )
      .map((h: { role: 'user' | 'model'; text: string }) => ({
        role: h.role,
        parts: [{ text: h.text.trim() }],
      }));

    const contents = [
      ...historyContents,
      { role: 'user' as const, parts: [{ text: message }] },
    ];

    const ai = createGeminiClient(geminiKey);
    let lastError: unknown = null;

    // Helper to strip any accidental inline {"action":"OPEN_MAP",...} JSON tag from text fields
    const extractInlineMapAction = (
      text: string
    ): { cleaned: string; found: { action: 'OPEN_MAP'; origin: string; destination: string } | null } => {
      const match = text.match(/\{[^{}]*"action"\s*:\s*"OPEN_MAP"[^{}]*\}/);
      if (!match) return { cleaned: text.trim(), found: null };
      let found: { action: 'OPEN_MAP'; origin: string; destination: string } | null = null;
      try {
        const obj = JSON.parse(match[0]) as { action?: string; origin?: string; destination?: string };
        if (obj.action === 'OPEN_MAP' && obj.origin?.trim() && obj.destination?.trim()) {
          found = {
            action: 'OPEN_MAP',
            origin: obj.origin.trim(),
            destination: obj.destination.trim(),
          };
        }
      } catch {
        // Ignore malformed inline tag
      }
      return {
        cleaned: text.replace(match[0], '').replace(/\s{2,}/g, ' ').trim(),
        found,
      };
    };

    for (const model of ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'] as const) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: COPILOT_CHAT_SCHEMA,
            ...(model === 'gemini-4-hydrogen'
              ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
              : {}),
          },
        });

        const jsonStr = (response.text || '').trim();
        if (!jsonStr) throw new Error('Empty JSON returned by Gemini copilot.');

        const parsed = JSON.parse(jsonStr) as {
          directAnswer?: string;
          steps?: unknown[];
          whyImpact?: string;
          mapAction?: {
            action?: string;
            origin?: string;
            destination?: string;
          } | null;
        };

        let resolvedMapAction: { action: 'OPEN_MAP'; origin: string; destination: string } | null =
          parsed.mapAction &&
          parsed.mapAction.action === 'OPEN_MAP' &&
          typeof parsed.mapAction.origin === 'string' &&
          typeof parsed.mapAction.destination === 'string' &&
          parsed.mapAction.origin.trim().length > 0 &&
          parsed.mapAction.destination.trim().length > 0
            ? {
                action: 'OPEN_MAP',
                origin: parsed.mapAction.origin.trim(),
                destination: parsed.mapAction.destination.trim(),
              }
            : null;

        const directChecked = extractInlineMapAction(
          String(parsed.directAnswer || `${city} is at ${aqi} AQI (${severityLabel}).`)
        );
        if (!resolvedMapAction && directChecked.found) {
          resolvedMapAction = directChecked.found;
        }

        const steps: string[] = [];
        if (Array.isArray(parsed.steps)) {
          for (const rawStep of parsed.steps) {
            const stepChecked = extractInlineMapAction(String(rawStep || ''));
            if (!resolvedMapAction && stepChecked.found) {
              resolvedMapAction = stepChecked.found;
            }
            if (stepChecked.cleaned) {
              steps.push(stepChecked.cleaned);
            }
            if (steps.length >= 2) break;
          }
        }

        const whyChecked = extractInlineMapAction(
          String(
            parsed.whyImpact ||
              (aqi <= 100
                ? `Current ${pm25} μg/m³ PM2.5 is manageable for routine daily plans.`
                : `Limits fine PM2.5 (${pm25} μg/m³) inhalation during peak hours.`)
          )
        );
        if (!resolvedMapAction && whyChecked.found) {
          resolvedMapAction = whyChecked.found;
        }

        res.json({
          directAnswer: directChecked.cleaned || `${city} is at ${aqi} AQI (${severityLabel}).`,
          steps:
            steps.length > 0
              ? steps
              : [
                  aqi <= 100
                    ? `Enjoy normal outdoor plans in ${city}; best air is ${safeWindow}.`
                    : `Use the ${safeWindow} safe window for outdoor errands in ${city}.`,
                ],
          whyImpact: whyChecked.cleaned,
          mapAction: resolvedMapAction,
          modelUsed: model,
        });
        return;
      } catch (err) {
        lastError = err;
        if (isQuotaExhaustedError(err) && model === 'gemini-4-hydrogen') {
          continue;
        }
        break;
      }
    }

    if (isQuotaExhaustedError(lastError)) {
      res.status(429).json({
        error: 'QUOTA_EXCEEDED',
        message:
          'Gemini quota reached. Select a billing-enabled API key in Settings > Secrets, or retry shortly.',
      });
      return;
    }

    const msg = lastError instanceof Error ? lastError.message : 'Gemini chat failed.';
    const status = /PERMISSION_DENIED|API_KEY_INVALID|403|400/i.test(msg) ? 403 : 502;
    res.status(status).json({
      error: 'COPILOT_CHAT_FAILED',
      message:
        status === 403
          ? 'Gemini API key permission issue. Please check Settings > Secrets.'
          : 'Could not reach AeroPulse Gemini copilot right now. Tap Retry.',
    });
  });

  // Mount Vite dev middleware in dev, or serve static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    process.stdout.write(`AeroPulse server running at http://0.0.0.0:${PORT}\n`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start AeroPulse server:', err);
  process.exit(1);
});
