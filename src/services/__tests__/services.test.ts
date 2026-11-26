// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchLiveAirQuality } from '../../services/airQuality';
import {
  clearAdvisoryCacheForCity,
  fetchTodayAdvisory,
  sendCopilotChatMessage,
} from '../../services/gemini';
import { LiveAirQualityResponse, LiveAppContext } from '../../types/aeropulse';

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeLiveAqiPayload(aqi: number): LiveAirQualityResponse {
  return {
    aqi,
    severity: aqi <= 50 ? 'good' : aqi <= 100 ? 'moderate' : 'poor',
    severityLabel: aqi <= 50 ? 'GOOD' : aqi <= 100 ? 'MODERATE' : 'POOR',
    pm25: 28.4,
    pm10: 54.2,
    no2: 18.1,
    o3: 41.0,
    indoorCo2Estimate: 640,
    safeWindowLabel: '2 PM – 4 PM',
    safeStartIdx: 8,
    safeEndIdx: 9,
    hourlyTimeline: [
      { hourLabel: '6:00 AM', shortLabel: '6 AM', aqi, pm25: 28.4, status: 'moderate' },
    ],
    fetchedAtIso: new Date().toISOString(),
    fetchedAtLabel: 'Updated 10:00 AM IST',
    sourceLabel: 'Open-Meteo / CPCB Grid',
  };
}

const SAMPLE_CONTEXT: LiveAppContext = {
  activeTab: 'Today',
  telemetry: {
    city: 'Delhi',
    state: 'Delhi',
    aqi: 185,
    severityLabel: 'POOR',
    pm25: 75,
    pm10: 130,
    no2: 34,
    o3: 28,
    safeWindowLabel: '2 PM – 4 PM',
    hourlySummary: 'Morning 220 AQI, Afternoon 150 AQI',
    isLive: true,
  },
  profile: {
    personaId: 'parent',
    personaLabel: 'Parent with Kids',
    riskChips: [],
  },
  roomAudit: null,
  commute: null,
  activeHabits: [],
};

describe('AeroPulse Client Services (airQuality.ts & gemini.ts)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('Open-Meteo Air Quality Service (fetchLiveAirQuality)', () => {
    it('serves subsequent calls from the TTL cache and bypasses cache on forceRefresh', async () => {
      // Unique coordinates so no other test shares this cache key
      const lat = 28.6139;
      const lng = 77.2091;

      fetchMock
        .mockResolvedValueOnce(makeJsonResponse(makeLiveAqiPayload(142)))
        .mockResolvedValueOnce(makeJsonResponse(makeLiveAqiPayload(178)));

      const first = await fetchLiveAirQuality(lat, lng);
      expect(first.aqi).toBe(142);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Second call without forceRefresh hits TTL cache
      const cached = await fetchLiveAirQuality(lat, lng);
      expect(cached.aqi).toBe(142);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Manual refresh bypasses cache and includes refresh=1 query param
      const refreshed = await fetchLiveAirQuality(lat, lng, { forceRefresh: true });
      expect(refreshed.aqi).toBe(178);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(String(fetchMock.mock.calls[1][0])).toContain('refresh=1');
    });

    it('handles network failures cleanly when both proxy and direct Open-Meteo fail', async () => {
      const lat = 19.0761;
      const lng = 72.8777;

      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(fetchLiveAirQuality(lat, lng)).rejects.toThrow('Failed to fetch');
      // Called proxy first, then fell back to direct Open-Meteo API
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(String(fetchMock.mock.calls[1][0])).toContain('air-quality-api.open-meteo.com');
    });

    it('throws a clean error when direct Open-Meteo returns 503 after proxy failure', async () => {
      const lat = 12.9716;
      const lng = 77.5946;

      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/air-quality/live')) {
          return new Response('<html>Gateway</html>', { status: 502 });
        }
        return makeJsonResponse({ reason: 'Service unavailable' }, 503);
      });

      await expect(fetchLiveAirQuality(lat, lng)).rejects.toThrow(
        'Could not reach live Open-Meteo Air Quality API.'
      );
    });
  });

  describe('Gemini Client Service (gemini.ts)', () => {
    it('surfaces clean error message on HTTP 429 rate-limit response without caching failure', async () => {
      clearAdvisoryCacheForCity('test-delhi-429');

      fetchMock.mockResolvedValueOnce(
        makeJsonResponse(
          {
            error: 'RATE_LIMITED',
            message: 'Too many requests right now. Please wait a minute before retrying.',
          },
          429
        )
      );

      await expect(
        fetchTodayAdvisory({
          cityId: 'test-delhi-429',
          city: 'Delhi',
          state: 'Delhi',
          aqi: 220,
          severityLabel: 'SEVERE',
          pm25: 95,
          pm10: 160,
          no2: 40,
          o3: 32,
          bestWindow: '2 PM – 4 PM',
          persona: 'parent',
          modifiers: [],
        })
      ).rejects.toThrow('Too many requests right now. Please wait a minute before retrying.');
    });

    it('surfaces clean fallback messages on 500 JSON and HTML server errors', async () => {
      clearAdvisoryCacheForCity('test-delhi-500');

      fetchMock.mockResolvedValueOnce(
        makeJsonResponse({ message: 'Gemini advisory model temporarily unavailable.' }, 500)
      );

      await expect(
        fetchTodayAdvisory({
          cityId: 'test-delhi-500',
          city: 'Delhi',
          state: 'Delhi',
          aqi: 190,
          severityLabel: 'POOR',
          pm25: 75,
          pm10: 130,
          no2: 34,
          o3: 28,
          bestWindow: '2 PM – 4 PM',
          persona: 'senior',
          modifiers: ['asthma'],
        })
      ).rejects.toThrow('Gemini advisory model temporarily unavailable.');

      // Non-JSON 500 HTML error page should trigger safe server-restarting message instead of JSON.parse SyntaxError
      fetchMock.mockResolvedValueOnce(
        new Response('<!doctype html><html><body>500 Error</body></html>', {
          status: 500,
          headers: { 'Content-Type': 'text/html' },
        })
      );

      await expect(
        sendCopilotChatMessage({
          message: 'Should seniors walk at 6 AM?',
          history: [],
          context: SAMPLE_CONTEXT,
        })
      ).rejects.toThrow('AeroPulse Copilot is reconnecting. Please tap Retry.');
    });
  });
});
