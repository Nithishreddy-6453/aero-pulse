import crypto from 'crypto';
import express from 'express';
import type { Request, Response } from 'express';
import { ThinkingLevel } from '@google/genai';
import {
  geminiRateLimiter,
  sanitizeServerInput,
  validateRoomImageUpload,
} from '../middleware/security.ts';
import {
  CACHE_TTL_MS,
  ROOM_AUDIT_SCHEMA,
  cleanJsonResponseText,
  executeWithGeminiFallback,
  getGeminiApiKey,
  isAuthOrKeyError,
  isQuotaExhaustedError,
} from '../services/geminiClient.ts';

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

const roomVisionCache = new Map<
  string,
  { expiresAt: number; diagnosis: RoomVisionDiagnosis }
>();

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

export function createVisionRouter() {
  const router = express.Router();

  router.post('/room-audit/analyze', geminiRateLimiter, async (req: Request, res: Response) => {
    if (!getGeminiApiKey()) {
      res.status(503).json({
        error: 'GEMINI_KEY_MISSING',
        message: 'Gemini API key is not configured. Check Settings > Secrets.',
      });
      return;
    }

    const imageBase64 = String(req.body?.imageBase64 || '').trim();
    const mimeType = String(req.body?.mimeType || '').trim().toLowerCase();
    const cityName = sanitizeServerInput(req.body?.city, 80) || 'New Delhi';
    const aqi = Math.max(10, Number(req.body?.aqi) || 250);
    const roomType = sanitizeServerInput(req.body?.roomType, 60) || 'Living Room';
    const riskChips = Array.isArray(req.body?.riskChips)
      ? req.body.riskChips.map((c: unknown) => sanitizeServerInput(c, 40)).filter(Boolean)
      : [];

    const validation = validateRoomImageUpload(imageBase64, mimeType);
    if (!validation.ok) {
      res.status(validation.status).json({
        error: validation.error,
        message: validation.message,
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

    try {
      const { result: diagnosis } = await executeWithGeminiFallback(
        'room-audit',
        async (ai, model) => {
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

          const jsonStr = cleanJsonResponseText(response.text || '');
          if (!jsonStr) {
            throw new Error('Empty JSON returned by Gemini Vision.');
          }

          const parsed = JSON.parse(jsonStr);
          const sanitized = sanitizeDiagnosis(parsed);
          sanitized.modelUsed = model;
          return sanitized;
        }
      );

      roomVisionCache.set(cacheKey, {
        expiresAt: Date.now() + CACHE_TTL_MS,
        diagnosis,
      });

      res.json(diagnosis);
    } catch (lastError) {
      if (isQuotaExhaustedError(lastError)) {
        res.status(429).json({
          error: 'QUOTA_EXCEEDED',
          message:
            'Gemini Vision quota reached. Upgrade or select a billing-enabled API key in Settings > Secrets, or retry shortly.',
        });
        return;
      }

      const authIssue = isAuthOrKeyError(lastError);
      const status = authIssue ? 403 : 503;
      res.status(status).json({
        error: 'VISION_AUDIT_FAILED',
        message: authIssue
          ? 'Gemini API key permission issue. Please check your GEMINI_API_KEY in Settings > Secrets.'
          : 'Could not complete Gemini Vision room scan right now. Please tap Retry Scan.',
      });
    }
  });

  return router;
}
