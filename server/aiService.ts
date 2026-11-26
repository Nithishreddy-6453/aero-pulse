import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

export const CACHE_TTL_MS = 15 * 60 * 1000;
export const QUOTA_COOLDOWN_MS = 5 * 60 * 1000;

let preferredWorkingGeminiKey: string | null = null;
const invalidAuthGeminiKeys = new Set<string>();

export function getCandidateGeminiApiKeys(): string[] {
  const rawKeys = [
    preferredWorkingGeminiKey,
    (process.env.GEMINI_API_KE || '').trim(),
    (process.env.GEMINI_API_KEY || '').trim(),
  ].filter(
    (k): k is string => Boolean(k && k.length > 0 && !invalidAuthGeminiKeys.has(k))
  );
  return Array.from(new Set(rawKeys));
}

export function getGeminiApiKey(): string {
  return getCandidateGeminiApiKeys()[0] || '';
}

export function createGeminiClient(apiKey: string) {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function isQuotaExhaustedError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  return /429|RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(raw);
}

export function getNumericErrorStatus(err: unknown): number | null {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const s = Number((err as { status?: unknown }).status);
    if (Number.isFinite(s) && s >= 100 && s < 600) return s;
  }
  const raw = err instanceof Error ? err.message : String(err);
  const match = raw.match(/\b(400|401|403|404|429|500|502|503|504)\b/);
  return match ? Number(match[1]) : null;
}

export function sanitizeErrorSnippet(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, '[REDACTED_KEY]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

export function isAuthOrKeyError(err: unknown): boolean {
  const status = getNumericErrorStatus(err);
  const raw = err instanceof Error ? err.message : String(err);
  return (
    status === 401 ||
    status === 403 ||
    /PERMISSION_DENIED|API_KEY_INVALID|API key not valid|UNAUTHENTICATED|invalid.?api.?key/i.test(raw)
  );
}

export function shouldFallbackModel(err: unknown): boolean {
  if (isAuthOrKeyError(err)) return false;
  return true;
}

export function cleanJsonResponseText(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced ? fenced[1] : trimmed).trim();
}

export const GEMINI_FALLBACK_MODELS = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'] as const;
export type GeminiFallbackModel = (typeof GEMINI_FALLBACK_MODELS)[number];
const MODEL_OVERLOAD_COOLDOWN_MS = 60 * 1000;
const modelCooldownUntil = new Map<GeminiFallbackModel, number>();

export function isTransientUpstreamError(err: unknown): boolean {
  const status = getNumericErrorStatus(err);
  const raw = err instanceof Error ? err.message : String(err);
  return (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    /UNAVAILABLE|high demand|overloaded|DEADLINE_EXCEEDED|TIMED_OUT|fetch failed/i.test(raw)
  );
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withAttemptTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`TIMED_OUT: ${label} exceeded ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (val) => {
        if (timer) clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        if (timer) clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export async function executeWithGeminiFallback<T>(
  routeTag: string,
  runner: (ai: GoogleGenAI, model: GeminiFallbackModel) => Promise<T>
): Promise<{ result: T; model: GeminiFallbackModel }> {
  const keys = getCandidateGeminiApiKeys();
  if (keys.length === 0) {
    throw new Error('GEMINI_KEY_MISSING');
  }

  let lastError: unknown = null;

  for (const apiKey of keys) {
    const ai = createGeminiClient(apiKey);
    let keyAuthFailed = false;

    const now = Date.now();
    const hydrogenCoolingDown = (modelCooldownUntil.get('gemini-4-hydrogen') ?? 0) > now;
    const attemptPlan: Array<{ model: GeminiFallbackModel; backoffMs: number; timeoutMs: number }> =
      hydrogenCoolingDown
        ? [
            { model: 'gemini-3.1-flash-lite', backoffMs: 0, timeoutMs: 8000 },
            { model: 'gemini-3.1-flash-lite', backoffMs: 600, timeoutMs: 8000 },
            { model: 'gemini-4-hydrogen', backoffMs: 600, timeoutMs: 9000 },
          ]
        : [
            { model: 'gemini-4-hydrogen', backoffMs: 0, timeoutMs: 8500 },
            { model: 'gemini-3.1-flash-lite', backoffMs: 0, timeoutMs: 8500 },
            { model: 'gemini-3.1-flash-lite', backoffMs: 600, timeoutMs: 8500 },
          ];

    for (let i = 0; i < attemptPlan.length; i++) {
      const { model, backoffMs, timeoutMs } = attemptPlan[i];
      if (backoffMs > 0) {
        await delayMs(backoffMs);
      }
      try {
        const result = await withAttemptTimeout(
          runner(ai, model),
          timeoutMs,
          `${routeTag}/${model}`
        );
        preferredWorkingGeminiKey = apiKey;
        return { result, model };
      } catch (err) {
        lastError = err;
        if (isAuthOrKeyError(err)) {
          keyAuthFailed = true;
          invalidAuthGeminiKeys.add(apiKey);
          break;
        }
        if (
          model === 'gemini-4-hydrogen' &&
          (isTransientUpstreamError(err) || isQuotaExhaustedError(err))
        ) {
          modelCooldownUntil.set('gemini-4-hydrogen', Date.now() + MODEL_OVERLOAD_COOLDOWN_MS);
        }
        if (i === 0 && shouldFallbackModel(err)) {
          continue;
        }
        if (isTransientUpstreamError(err)) {
          continue;
        }
        break;
      }
    }

    if (keyAuthFailed) {
      if (preferredWorkingGeminiKey === apiKey) {
        preferredWorkingGeminiKey = null;
      }
      continue;
    }

    if (isQuotaExhaustedError(lastError)) {
      continue;
    }

    break;
  }

  throw lastError ?? new Error('Gemini request failed.');
}

export interface RoomVisionTrap {
  id: number;
  title: string;
  x: number;
  y: number;
  category: 'Free' | 'DIY' | 'Smart';
  costBadge: string;
  fixAction: string;
  whyImpact: string;
}

export interface RoomVisionDiagnosis {
  riskLevel: 'Low' | 'Moderate' | 'High' | 'Severe';
  fixPotentialPercent: number;
  traps: RoomVisionTrap[];
  modelUsed?: string;
}

export interface LiveAirQualityCacheEntry {
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

export interface TodayAdvisoryCacheEntry {
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

export const commuteTipCache = new Map<
  string,
  { expiresAt: number; insight: string | null; quotaLimited: boolean }
>();

export const roomVisionCache = new Map<
  string,
  { expiresAt: number; diagnosis: RoomVisionDiagnosis }
>();

export const liveAqiCache = new Map<string, LiveAirQualityCacheEntry>();
export const todayAdvisoryCache = new Map<string, TodayAdvisoryCacheEntry>();

let commuteGeminiCooldownUntil = 0;

export async function fetchGeminiCommuteTip(params: {
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

export function sanitizeDiagnosis(raw: unknown): RoomVisionDiagnosis {
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

export const ROOM_AUDIT_SCHEMA = {
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

export const TODAY_ADVISORY_SCHEMA = {
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

export const COPILOT_ASK_SCHEMA = {
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

export const COPILOT_CHAT_SCHEMA = {
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

export function classifyUsAqi(aqi: number): {
  severity: 'good' | 'moderate' | 'poor' | 'severe';
  severityLabel: string;
} {
  if (aqi <= 50) return { severity: 'good', severityLabel: 'GOOD' };
  if (aqi <= 100) return { severity: 'moderate', severityLabel: 'MODERATE' };
  if (aqi <= 200) return { severity: 'poor', severityLabel: 'POOR' };
  return { severity: 'severe', severityLabel: 'SEVERE' };
}

export function formatHourLabels(hour24: number): { hourLabel: string; shortLabel: string } {
  const normalized = ((hour24 % 24) + 24) % 24;
  const suffix = normalized >= 12 ? 'PM' : 'AM';
  const h12 = normalized % 12 === 0 ? 12 : normalized % 12;
  return {
    hourLabel: `${h12}:00 ${suffix}`,
    shortLabel: `${h12} ${suffix}`,
  };
}

export function formatIstTimestamp(date: Date): string {
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

export function getPersonaDisplayName(persona: string): string {
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
