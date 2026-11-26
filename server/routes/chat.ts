import express from 'express';
import type { Request, Response } from 'express';
import { ThinkingLevel } from '@google/genai';
import { geminiRateLimiter, sanitizeServerInput } from '../middleware/security.ts';
import {
  COPILOT_ASK_SCHEMA,
  COPILOT_CHAT_SCHEMA,
  cleanJsonResponseText,
  executeWithGeminiFallback,
  getGeminiApiKey,
  getPersonaDisplayName,
  isAuthOrKeyError,
  isQuotaExhaustedError,
} from '../services/geminiClient.ts';

function extractInlineMapAction(text: string): {
  cleaned: string;
  found: { action: 'OPEN_MAP'; origin: string; destination: string } | null;
} {
  const match = text.match(/\{[^{}]*"action"\s*:\s*"OPEN_MAP"[^{}]*\}/);
  if (!match) return { cleaned: text.trim(), found: null };
  let found: { action: 'OPEN_MAP'; origin: string; destination: string } | null = null;
  try {
    const obj = JSON.parse(match[0]) as {
      action?: string;
      origin?: string;
      destination?: string;
    };
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
}

export function createChatRouter() {
  const router = express.Router();

  router.post('/today/ask', geminiRateLimiter, async (req: Request, res: Response) => {
    if (!getGeminiApiKey()) {
      res.status(503).json({
        error: 'GEMINI_KEY_MISSING',
        message: 'Gemini API key is not configured. Check Settings > Secrets.',
      });
      return;
    }

    const question = sanitizeServerInput(req.body?.question, 500);
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

    try {
      const { result } = await executeWithGeminiFallback('today-ask', async (ai, model) => {
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

        const jsonStr = cleanJsonResponseText(response.text || '');
        if (!jsonStr) throw new Error('Empty response from Gemini copilot.');

        const parsed = JSON.parse(jsonStr) as {
          headline?: string;
          answer?: string;
          impactTag?: string;
        };

        return {
          headline: String(parsed.headline || `${city} Air Guidance (${aqi} AQI)`).trim(),
          answer: String(parsed.answer || '').trim(),
          impactTag: String(parsed.impactTag || `Safe Window: ${bestWindow}`).trim(),
          modelUsed: model,
        };
      });

      res.json(result);
    } catch (lastError) {
      if (isQuotaExhaustedError(lastError)) {
        res.status(429).json({
          error: 'QUOTA_EXCEEDED',
          message:
            'Gemini quota reached. Upgrade or select a billing-enabled API key in Settings > Secrets, or retry shortly.',
        });
        return;
      }

      const authIssue = isAuthOrKeyError(lastError);
      const status = authIssue ? 403 : 503;
      res.status(status).json({
        error: 'COPILOT_FAILED',
        message: authIssue
          ? 'Gemini API key permission issue. Please check your GEMINI_API_KEY in Settings > Secrets.'
          : 'Could not reach AeroPulse Gemini copilot right now. Please try again.',
      });
    }
  });

  router.post('/copilot/chat', geminiRateLimiter, async (req: Request, res: Response) => {
    if (!getGeminiApiKey()) {
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

    const historyContents = rawHistory
      .slice(-12)
      .filter(
        (h: unknown): h is { role: 'user' | 'model'; text: string } =>
          Boolean(h) &&
          typeof (h as { text?: unknown }).text === 'string' &&
          ((h as { role?: unknown }).role === 'user' ||
            (h as { role?: unknown }).role === 'model') &&
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

    try {
      const { result } = await executeWithGeminiFallback('copilot-chat', async (ai, model) => {
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

        const jsonStr = cleanJsonResponseText(response.text || '');
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

        return {
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
        };
      });

      res.json(result);
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
        error: 'COPILOT_CHAT_FAILED',
        message: authIssue
          ? 'Gemini API key permission issue. Please check your GEMINI_API_KEY in Settings > Secrets.'
          : 'Gemini is temporarily busy due to high demand. Tap Retry.',
      });
    }
  });

  return router;
}
