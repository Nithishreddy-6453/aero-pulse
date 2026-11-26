import {
  CopilotChatReply,
  LiveAppContext,
  PersonaId,
  QuickModifier,
  RoomVisionDiagnosis,
  TodayAdvisoryPayload,
} from '../types/aeropulse';
import { sanitizeUserInput } from '../utils/impactCalc';

const ADVISORY_CACHE_TTL_MS = 10 * 60 * 1000;
const ROOM_VISION_CACHE_TTL_MS = 10 * 60 * 1000;

const advisoryMemoryCache = new Map<string, { expiresAt: number; data: TodayAdvisoryPayload }>();
const roomVisionMemoryCache = new Map<string, { expiresAt: number; data: RoomVisionDiagnosis }>();

async function safeParseJson<T>(res: Response): Promise<T | null> {
  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();
  const trimmed = text.trim();
  if (
    !trimmed ||
    trimmed.startsWith('<') ||
    (!contentType.includes('json') && !trimmed.startsWith('{') && !trimmed.startsWith('['))
  ) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

export interface FetchTodayAdvisoryParams {
  cityId: string;
  city: string;
  state: string;
  aqi: number;
  severityLabel: string;
  pm25: number;
  pm10: number;
  no2: number;
  o3: number;
  bestWindow: string;
  persona: PersonaId;
  modifiers: QuickModifier[];
  forceRefresh?: boolean;
  signal?: AbortSignal;
}

export function clearAdvisoryCacheForCity(cityId: string): void {
  for (const key of advisoryMemoryCache.keys()) {
    if (key.startsWith(`${cityId}|`)) {
      advisoryMemoryCache.delete(key);
    }
  }
}

export async function fetchTodayAdvisory(
  params: FetchTodayAdvisoryParams
): Promise<TodayAdvisoryPayload> {
  const modsKey = params.modifiers.slice().sort().join(',');
  const cacheKey = `${params.cityId}|${Math.round(params.aqi / 5) * 5}|${params.persona}|${modsKey}`;

  if (!params.forceRefresh) {
    const cached = advisoryMemoryCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
  }

  const res = await fetch('/api/today/advisory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: params.signal,
    body: JSON.stringify({
      city: sanitizeUserInput(params.city, 80),
      state: sanitizeUserInput(params.state, 80),
      aqi: params.aqi,
      severityLabel: params.severityLabel,
      pm25: params.pm25,
      pm10: params.pm10,
      no2: params.no2,
      o3: params.o3,
      bestWindow: params.bestWindow,
      persona: params.persona,
      modifiers: params.modifiers,
    }),
  });

  const data = await safeParseJson<Partial<TodayAdvisoryPayload> & { message?: string }>(res);
  if (!data) {
    throw new Error('AeroPulse server is restarting or busy. Tap Retry Verdict.');
  }
  if (!res.ok || !data.heroVerdict || !Array.isArray(data.routines)) {
    throw new Error(data.message || 'Could not generate Gemini personalized routine right now.');
  }

  const payload: TodayAdvisoryPayload = {
    heroVerdict: data.heroVerdict,
    asthmaTip: data.asthmaTip || '',
    gasStoveTip: data.gasStoveTip || '',
    routines: data.routines,
    modelUsed: data.modelUsed,
  };

  advisoryMemoryCache.set(cacheKey, {
    expiresAt: Date.now() + ADVISORY_CACHE_TTL_MS,
    data: payload,
  });

  return payload;
}

export interface RoomVisionRequestParams {
  imageBase64: string;
  mimeType: 'image/jpeg';
  city: string;
  aqi: number;
  roomType: string;
  riskChips: string[];
  cacheSignature?: string;
  forceRefresh?: boolean;
}

export async function analyzeRoomPhotoWithGemini(
  params: RoomVisionRequestParams
): Promise<RoomVisionDiagnosis> {
  const key =
    params.cacheSignature ||
    `${params.city}|${Math.round(params.aqi / 10) * 10}|${params.roomType}|${params.riskChips.slice().sort().join(',')}|${params.imageBase64.slice(0, 48)}`;

  if (!params.forceRefresh) {
    const cached = roomVisionMemoryCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
  }

  const res = await fetch('/api/room-audit/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageBase64: params.imageBase64,
      mimeType: params.mimeType,
      city: sanitizeUserInput(params.city, 80),
      aqi: params.aqi,
      roomType: sanitizeUserInput(params.roomType, 60),
      riskChips: params.riskChips.map((r) => sanitizeUserInput(r, 40)),
    }),
  });

  const data = await safeParseJson<RoomVisionDiagnosis & { message?: string }>(res);
  if (!data) {
    throw new Error('Room Vision service is reconnecting. Please tap Retry Vision Scan.');
  }
  if (!res.ok || !Array.isArray(data.traps)) {
    throw new Error(data.message || 'Could not complete Gemini Vision room scan. Tap Retry Scan.');
  }

  roomVisionMemoryCache.set(key, {
    expiresAt: Date.now() + ROOM_VISION_CACHE_TTL_MS,
    data,
  });
  return data;
}

export interface CopilotChatRequestParams {
  message: string;
  history: Array<{ role: 'user' | 'model'; text: string }>;
  context: LiveAppContext;
}

export async function sendCopilotChatMessage(
  params: CopilotChatRequestParams
): Promise<CopilotChatReply> {
  const cleanedMessage = sanitizeUserInput(params.message, 500);
  if (!cleanedMessage) {
    throw new Error('Please enter a question for AeroPulse.');
  }

  const res = await fetch('/api/copilot/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: cleanedMessage,
      history: params.history.slice(-12),
      context: params.context,
    }),
  });

  const data = await safeParseJson<Partial<CopilotChatReply> & { message?: string }>(res);
  if (!data) {
    throw new Error('AeroPulse Copilot is reconnecting. Please tap Retry.');
  }
  if (!res.ok || !data.directAnswer) {
    throw new Error(data.message || 'Could not reach AeroPulse Gemini copilot right now.');
  }

  return {
    directAnswer: data.directAnswer,
    steps: Array.isArray(data.steps) ? data.steps : [],
    whyImpact: data.whyImpact || '',
    mapAction: data.mapAction ?? null,
    modelUsed: data.modelUsed,
  };
}
