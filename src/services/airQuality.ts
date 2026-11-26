import { HourlyWindowSlot, IndianCitySearchResult, LiveAirQualityResponse } from '../types/aeropulse';
import {
  classifyAqiSeverity,
  findBestCleanWindow,
  sanitizeUserInput,
} from '../utils/impactCalc';

const LIVE_AQI_TTL_MS = 5 * 60 * 1000; // 5-minute in-memory client cache
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;

const liveAqiMemoryCache = new Map<string, { expiresAt: number; data: LiveAirQualityResponse }>();
const citySearchMemoryCache = new Map<
  string,
  { expiresAt: number; results: IndianCitySearchResult[] }
>();

async function safeParseJson<T>(res: Response): Promise<T | null> {
  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith('<') || (!contentType.includes('json') && !trimmed.startsWith('{') && !trimmed.startsWith('['))) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
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

function formatIstNowLabel(): string {
  const formatted = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(new Date())
    .toUpperCase();
  return `Updated ${formatted} IST`;
}

async function fetchOpenMeteoDirect(
  lat: number,
  lng: number,
  signal?: AbortSignal
): Promise<LiveAirQualityResponse> {
  const apiUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${encodeURIComponent(
    lat.toFixed(4)
  )}&longitude=${encodeURIComponent(
    lng.toFixed(4)
  )}&current=us_aqi,pm2_5,pm10,nitrogen_dioxide,ozone&hourly=us_aqi,pm2_5&timezone=auto&forecast_days=1`;

  const res = await fetch(apiUrl, { signal, headers: { Accept: 'application/json' } });
  const raw = await safeParseJson<{
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
  }>(res);

  if (!res.ok || !raw) {
    throw new Error('Could not reach live Open-Meteo Air Quality API.');
  }

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

  const fallbackAqi =
    hourlyAqis[nowHour] ?? hourlyAqis.find((v) => typeof v === 'number' && Number.isFinite(v)) ?? 0;
  const liveAqi = Math.max(1, Math.round(Number(cur.us_aqi ?? fallbackAqi ?? 0)));
  const pm25 = Number(Math.max(0, Number(cur.pm2_5 ?? hourlyPm25[nowHour] ?? 0)).toFixed(1));
  const pm10 = Number(Math.max(0, Number(cur.pm10 ?? 0)).toFixed(1));
  const no2 = Number(Math.max(0, Number(cur.nitrogen_dioxide ?? 0)).toFixed(1));
  const o3 = Number(Math.max(0, Number(cur.ozone ?? 0)).toFixed(1));

  const byHour = new Map<number, { aqi: number; pm25: number }>();
  for (let i = 0; i < times.length; i++) {
    const h = Number(times[i]?.split('T')[1]?.slice(0, 2));
    if (!Number.isFinite(h) || h < 6 || h > 23) continue;
    const aVal = hourlyAqis[i];
    const pVal = hourlyPm25[i];
    byHour.set(h, {
      aqi: Math.max(1, Math.round(typeof aVal === 'number' && Number.isFinite(aVal) ? aVal : liveAqi)),
      pm25: Number(Math.max(0, typeof pVal === 'number' && Number.isFinite(pVal) ? pVal : pm25).toFixed(1)),
    });
  }

  const slots: Array<{ hour24: number; aqi: number; pm25: number }> = [];
  for (let h = 6; h <= 23; h++) {
    const entry = byHour.get(h);
    slots.push({
      hour24: h,
      aqi: entry?.aqi ?? liveAqi,
      pm25: entry?.pm25 ?? pm25,
    });
  }

  const bestWindow = findBestCleanWindow(
    slots.map((s) => s.aqi),
    6
  );

  const hourlyTimeline: HourlyWindowSlot[] = slots.map((slot, idx) => {
    const labels = formatHourLabels(slot.hour24);
    const isBest2h = idx === bestWindow.startIdx || idx === bestWindow.endIdx;
    const status: HourlyWindowSlot['status'] = isBest2h
      ? 'safe'
      : slot.aqi <= 50
        ? 'safe'
        : slot.aqi <= 100
          ? 'moderate'
          : 'peak';
    return {
      hourLabel: labels.hourLabel,
      shortLabel: labels.shortLabel,
      aqi: slot.aqi,
      pm25: slot.pm25,
      status,
    };
  });

  const { severity, severityLabel } = classifyAqiSeverity(liveAqi);
  const indoorCo2Estimate = Math.min(1350, Math.max(540, Math.round(520 + liveAqi * 1.45)));

  return {
    aqi: liveAqi,
    severity,
    severityLabel,
    pm25,
    pm10,
    no2,
    o3,
    indoorCo2Estimate,
    safeWindowLabel: bestWindow.label,
    safeStartIdx: bestWindow.startIdx,
    safeEndIdx: bestWindow.endIdx,
    hourlyTimeline,
    fetchedAtIso: new Date().toISOString(),
    fetchedAtLabel: formatIstNowLabel(),
    sourceLabel: 'Open-Meteo / CPCB Grid',
  };
}

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
  let liveData: LiveAirQualityResponse | null = null;

  try {
    const res = await fetch(
      `/api/air-quality/live?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}${refreshParam}`,
      { signal: options?.signal }
    );
    const data = await safeParseJson<Partial<LiveAirQualityResponse> & { message?: string }>(res);
    if (res.ok && data && typeof data.aqi === 'number' && Array.isArray(data.hourlyTimeline)) {
      liveData = data as LiveAirQualityResponse;
    } else if (data && !res.ok && data.message) {
      // Backend explicitly returned structured JSON error; fall back to direct Open-Meteo
      liveData = await fetchOpenMeteoDirect(lat, lng, options?.signal);
    } else {
      // Proxy returned HTML / non-JSON: seamlessly query Open-Meteo directly (CORS-enabled, zero API key)
      liveData = await fetchOpenMeteoDirect(lat, lng, options?.signal);
    }
  } catch (err) {
    if (options?.signal?.aborted) throw err;
    liveData = await fetchOpenMeteoDirect(lat, lng, options?.signal);
  }

  liveAqiMemoryCache.set(key, {
    expiresAt: Date.now() + LIVE_AQI_TTL_MS,
    data: liveData,
  });
  return liveData;
}

async function searchOpenMeteoCitiesDirect(
  cleaned: string,
  signal?: AbortSignal
): Promise<IndianCitySearchResult[]> {
  const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
    cleaned
  )}&count=8&language=en&format=json&countryCode=IN`;
  const res = await fetch(geoUrl, { signal, headers: { Accept: 'application/json' } });
  const data = await safeParseJson<{
    results?: Array<{
      id: number;
      name: string;
      admin1?: string;
      country_code?: string;
      latitude: number;
      longitude: number;
    }>;
  }>(res);
  if (!res.ok || !data?.results) return [];
  return data.results
    .filter((item) => !item.country_code || item.country_code.toUpperCase() === 'IN')
    .slice(0, 6)
    .map((item) => ({
      id: `om-${item.id}`,
      name: item.name,
      state: item.admin1 || 'India',
      lat: item.latitude,
      lng: item.longitude,
    }));
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

  let results: IndianCitySearchResult[] = [];
  try {
    const res = await fetch(`/api/air-quality/search?q=${encodeURIComponent(cleaned)}`, {
      signal,
    });
    const data = await safeParseJson<{ results?: IndianCitySearchResult[] }>(res);
    if (res.ok && data && Array.isArray(data.results)) {
      results = data.results;
    } else {
      results = await searchOpenMeteoCitiesDirect(cleaned, signal);
    }
  } catch (err) {
    if (signal?.aborted) throw err;
    results = await searchOpenMeteoCitiesDirect(cleaned, signal);
  }

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

  const data = await safeParseJson<Partial<ReverseGeocodeResult> & { message?: string }>(res);
  if (!res.ok || !data?.city) {
    throw new Error(data?.message || 'Could not resolve your city via OpenStreetMap right now.');
  }

  return {
    city: data.city,
    locality: data.locality,
    state: data.state,
    countryCode: data.countryCode,
  };
}
