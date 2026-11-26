import { GoogleGenAI, Type } from '@google/genai';

export const OSM_USER_AGENT = 'AeroPulse-UrbanAirAssistant/1.0 (https://aeropulse.local)';
export const CACHE_TTL_MS = 15 * 60 * 1000;
export const QUOTA_COOLDOWN_MS = 5 * 60 * 1000;

export const GEMINI_FALLBACK_MODELS = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'] as const;
export type GeminiFallbackModel = (typeof GEMINI_FALLBACK_MODELS)[number];

const MODEL_OVERLOAD_COOLDOWN_MS = 60 * 1000;
const modelCooldownUntil = new Map<GeminiFallbackModel, number>();

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

export function createGeminiClient(apiKey: string): GoogleGenAI {
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
    /PERMISSION_DENIED|API_KEY_INVALID|API key not valid|UNAUTHENTICATED|invalid.?api.?key/i.test(
      raw
    )
  );
}

export function shouldFallbackModel(err: unknown): boolean {
  return !isAuthOrKeyError(err);
}

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

export function cleanJsonResponseText(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced ? fenced[1] : trimmed).trim();
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

export const ROOM_AUDIT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    riskLevel: {
      type: Type.STRING,
      enum: ['Low', 'Moderate', 'High', 'Severe'],
      description:
        'Overall indoor air quality risk rating for this room given the city AQI and visible features.',
    },
    fixPotentialPercent: {
      type: Type.INTEGER,
      description:
        'Estimated percentage reduction in indoor PM2.5/NO2 achievable by applying all 3 fixes (between 18 and 88).',
    },
    traps: {
      type: Type.ARRAY,
      description:
        'Exactly 3 distinct smog, dust, ventilation, or combustion traps visible in the room photo.',
      items: {
        type: Type.OBJECT,
        properties: {
          id: {
            type: Type.INTEGER,
            description: 'Sequential pin number: 1, 2, or 3.',
          },
          title: {
            type: Type.STRING,
            description:
              'Punchy 3 to 4 word trap label (e.g., "Balcony Slider Air Gap", "Open LPG Burner Plume").',
          },
          x: {
            type: Type.NUMBER,
            description:
              'Horizontal coordinate (0 to 100 percentage from left edge) pointing directly at the visible feature in the photo.',
          },
          y: {
            type: Type.NUMBER,
            description:
              'Vertical coordinate (0 to 100 percentage from top edge) pointing directly at the visible feature in the photo.',
          },
          category: {
            type: Type.STRING,
            enum: ['Free', 'DIY', 'Smart'],
            description: 'Budget tier for the recommended fix.',
          },
          costBadge: {
            type: Type.STRING,
            description:
              'Compact cost badge in Indian Rupees or tier label (e.g., "Free", "₹390", "₹950", "Smart").',
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
            description:
              'Short quantified impact badge (2 to 4 words, e.g., "↓ 40% PM2.5", "↓ 55% NO₂", "Clean 2h Window").',
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
      description:
        'Short 3 to 5 word takeaway badge (e.g., "Best Window: 2 PM – 4 PM", "N95 + Recirculate AC").',
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
