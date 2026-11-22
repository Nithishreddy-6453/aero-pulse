import { IndianCitySearchResult, LiveAirQualityResponse } from '../types/aeropulse';
import { sanitizeUserInput } from '../utils/impactCalc';

const LIVE_AQI_TTL_MS = 5 * 60 * 1000; // 5-minute in-memory client cache
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;

const liveAqiMemoryCache = new Map<string, { expiresAt: number; data: LiveAirQualityResponse }>();
const citySearchMemoryCache = new Map<
  string,
  { expiresAt: number; results: IndianCitySearchResult[] }
>();

export async function fetchLiveAirQuality(
  lat: number,
  lng: number,
  options?: { forceRefresh?: boolean; signal?: AbortSignal }
): Promise<LiveAirQualityResponse> {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  if (!options?.forceRefresh) {
    const cached = liveAqiMemoryCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
  }

  const refreshParam = options?.forceRefresh ? '&refresh=1' : '';
  const res = await fetch(
    `/api/air-quality/live?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}${refreshParam}`,
    { signal: options?.signal }
  );

  const data = (await res.json()) as Partial<LiveAirQualityResponse> & { message?: string };
  if (!res.ok || typeof data.aqi !== 'number' || !Array.isArray(data.hourlyTimeline)) {
    throw new Error(data.message || 'Could not fetch live Open-Meteo air quality right now.');
  }

  const liveData = data as LiveAirQualityResponse;
  liveAqiMemoryCache.set(key, {
    expiresAt: Date.now() + LIVE_AQI_TTL_MS,
    data: liveData,
  });
  return liveData;
}

export async function searchIndianCities(
  rawQuery: string,
  signal?: AbortSignal
): Promise<IndianCitySearchResult[]> {
  const cleaned = sanitizeUserInput(rawQuery, 80);
  if (cleaned.length < 2) return [];

  const cacheKey = cleaned.toLowerCase();
  const cached = citySearchMemoryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.results;
  }

  const res = await fetch(`/api/air-quality/search?q=${encodeURIComponent(cleaned)}`, {
    signal,
  });
  if (!res.ok) return [];

  const data = (await res.json()) as { results?: IndianCitySearchResult[] };
  const results = Array.isArray(data.results) ? data.results : [];
  citySearchMemoryCache.set(cacheKey, {
    expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
    results,
  });
  return results;
}

export interface ReverseGeocodeResult {
  city: string;
  locality?: string;
  state?: string;
  countryCode?: string;
}

export async function reverseGeocodeIndianCoords(
  lat: number,
  lng: number
): Promise<ReverseGeocodeResult> {
  const res = await fetch('/api/maps/reverse-geocode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat, lng }),
  });

  const data = (await res.json()) as Partial<ReverseGeocodeResult> & { message?: string };
  if (!res.ok || !data.city) {
    throw new Error(data.message || 'Could not resolve your city via OpenStreetMap.');
  }

  return {
    city: data.city,
    locality: data.locality,
    state: data.state,
    countryCode: data.countryCode,
  };
}
