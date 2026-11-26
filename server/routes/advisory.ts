import express from 'express';
import type { Request, Response } from 'express';
import { ThinkingLevel } from '@google/genai';
import { geminiRateLimiter, sanitizeServerInput } from '../middleware/security.ts';
import {
  CACHE_TTL_MS,
  TODAY_ADVISORY_SCHEMA,
  cleanJsonResponseText,
  executeWithGeminiFallback,
  getGeminiApiKey,
  getPersonaDisplayName,
  isAuthOrKeyError,
  isQuotaExhaustedError,
} from '../services/geminiClient.ts';

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

const todayAdvisoryCache = new Map<string, TodayAdvisoryCacheEntry>();

export function createAdvisoryRouter() {
  const router = express.Router();

  router.post('/today/advisory', geminiRateLimiter, async (req: Request, res: Response) => {
    if (!getGeminiApiKey()) {
      res.status(503).json({
        error: 'GEMINI_KEY_MISSING',
        message: 'Gemini API key is not configured. Check Settings > Secrets.',
      });
      return;
    }

    const city = sanitizeServerInput(req.body?.city, 80) || 'New Delhi';
    const state = sanitizeServerInput(req.body?.state, 80) || 'India';
    const aqi = Math.max(1, Math.round(Number(req.body?.aqi) || 100));
    const severityLabel = sanitizeServerInput(req.body?.severityLabel, 32) || 'MODERATE';
    const pm25 = Number(req.body?.pm25) || 0;
    const pm10 = Number(req.body?.pm10) || 0;
    const no2 = Number(req.body?.no2) || 0;
    const o3 = Number(req.body?.o3) || 0;
    const bestWindow = sanitizeServerInput(req.body?.bestWindow, 48) || '2 PM – 4 PM';
    const persona = sanitizeServerInput(req.body?.persona, 24) || 'parent';
    const modifiers: string[] = Array.isArray(req.body?.modifiers)
      ? req.body.modifiers.map((m: unknown) => sanitizeServerInput(m, 32)).filter(Boolean)
      : [];

    const sortedMods = modifiers.slice().sort().join(',');
    const cacheKey = `${city.toLowerCase()}|${Math.round(aqi / 5) * 5}|${bestWindow}|${persona}|${sortedMods}`;
    const cached = todayAdvisoryCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      res.json(cached.data);
      return;
    }

    const personaName = getPersonaDisplayName(persona);
    const riskText =
      modifiers.length > 0
        ? modifiers
            .map((m) =>
              m === 'asthma' ? 'Asthma / Sensitive Lungs' : 'Indian Gas Stove / LPG Cooking'
            )
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

    try {
      const { result: payload } = await executeWithGeminiFallback(
        'today-advisory',
        async (ai, model) => {
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

          const jsonStr = cleanJsonResponseText(response.text || '');
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

          return {
            heroVerdict: String(parsed.heroVerdict).trim(),
            asthmaTip: String(parsed.asthmaTip || 'Keep rescue inhaler ready outdoors').trim(),
            gasStoveTip: String(parsed.gasStoveTip || 'Run kitchen chimney 5 mins early').trim(),
            routines,
            modelUsed: model,
          };
        }
      );

      todayAdvisoryCache.set(cacheKey, {
        expiresAt: Date.now() + CACHE_TTL_MS,
        data: payload,
      });

      res.json(payload);
    } catch (lastError) {
      if (isQuotaExhaustedError(lastError)) {
        res.status(429).json({
          error: 'QUOTA_EXCEEDED',
          message:
            'Gemini quota reached. Select a billing-enabled API key in Settings > Secrets, or retry shortly.',
        });
        return;
      }

      const authIssue = isAuthOrKeyError(lastError);
      const status = authIssue ? 403 : 503;
      res.status(status).json({
        error: 'ADVISORY_FAILED',
        message: authIssue
          ? 'Gemini API key permission issue. Please check your GEMINI_API_KEY in Settings > Secrets.'
          : 'Could not generate Gemini personalized verdict right now. Tap Retry Verdict.',
      });
    }
  });

  return router;
}
