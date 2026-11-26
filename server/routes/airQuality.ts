import express from 'express';
import type { Request, Response } from 'express';
import { sanitizeServerInput } from '../middleware/security.ts';
import { OSM_USER_AGENT } from '../services/geminiClient.ts';

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

const liveAqiCache = new Map<string, LiveAirQualityCacheEntry>();

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

export function createAirQualityRouter() {
  const router = express.Router();

  // Reverse Geocoding via OpenStreetMap Nominatim (Zero API key required)
  router.post('/maps/reverse-geocode', async (req: Request, res: Response) => {
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
        res.status(503).json({
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

  // Live Pan-India Air Quality via Open-Meteo Air Quality API
  router.get('/air-quality/live', async (req: Request, res: Response) => {
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
        res.status(503).json({
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
        hourlyAqis[nowHour] ??
        hourlyAqis.find((v) => typeof v === 'number' && Number.isFinite(v)) ??
        0;

      const liveAqi = Math.max(1, Math.round(Number(cur.us_aqi ?? fallbackHourlyAqi ?? 0)));
      const pm25 = Number(Math.max(0, Number(cur.pm2_5 ?? hourlyPm25[nowHour] ?? 0)).toFixed(1));
      const pm10 = Number(Math.max(0, Number(cur.pm10 ?? 0)).toFixed(1));
      const no2 = Number(Math.max(0, Number(cur.nitrogen_dioxide ?? 0)).toFixed(1));
      const o3 = Number(Math.max(0, Number(cur.ozone ?? 0)).toFixed(1));

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
      res.status(503).json({
        error: 'OPEN_METEO_FETCH_FAILED',
        message:
          err instanceof Error
            ? err.message
            : 'Unable to fetch real-time Open-Meteo air quality data.',
      });
    }
  });

  // Pan-India City Search via Open-Meteo Free Geocoding API
  router.get('/air-quality/search', async (req: Request, res: Response) => {
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
        res.status(503).json({
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
      res.status(503).json({
        error: 'GEOCODING_FAILED',
        message: 'Could not reach Open-Meteo city search.',
        results: [],
      });
    }
  });

  return router;
}
