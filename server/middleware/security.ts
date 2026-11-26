import type { NextFunction, Request, Response } from 'express';

export const MAX_ROOM_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB strict binary cap
export const ALLOWED_ROOM_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const GEMINI_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const GEMINI_RATE_LIMIT_MAX_REQUESTS = 20;

export function sanitizeServerInput(raw: unknown, maxLength = 240): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/[<>`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    return forwarded[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

export function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Scope X-Frame-Options: DENY to /api/* so preview iframe hosting stays intact
  if (req.path.startsWith('/api/')) {
    res.setHeader('X-Frame-Options', 'DENY');
  }
  next();
}

export function jsonPayloadErrorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (
    err &&
    typeof err === 'object' &&
    'type' in err &&
    (err as { type?: string }).type === 'entity.too.large'
  ) {
    res.status(413).json({
      error: 'PAYLOAD_TOO_LARGE',
      message: 'Upload exceeds the 5MB security limit. Please choose a smaller room photo.',
    });
    return;
  }
  next(err);
}

export interface RateLimiterOptions {
  windowMs?: number;
  maxRequests?: number;
}

export function createGeminiRateLimiter(options: RateLimiterOptions = {}) {
  const windowMs = options.windowMs ?? GEMINI_RATE_LIMIT_WINDOW_MS;
  const maxRequests = options.maxRequests ?? GEMINI_RATE_LIMIT_MAX_REQUESTS;
  const bucket = new Map<string, number[]>();

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now();
    const windowStart = now - windowMs;
    const clientIp = getClientIp(req);

    const timestamps = (bucket.get(clientIp) ?? []).filter((ts) => ts > windowStart);
    if (timestamps.length >= maxRequests) {
      const oldest = timestamps[0] ?? now;
      const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        error: 'RATE_LIMITED',
        message: `Rate limit reached (${maxRequests} AI requests/min). Please retry in ${retryAfterSec}s.`,
      });
      return;
    }

    timestamps.push(now);
    bucket.set(clientIp, timestamps);

    if (bucket.size > 500) {
      for (const [ip, hits] of bucket.entries()) {
        if (hits.every((ts) => ts <= windowStart)) {
          bucket.delete(ip);
        }
      }
    }

    next();
  };
}

export const geminiRateLimiter = createGeminiRateLimiter();

export type RoomImageValidationResult =
  | { ok: true; decodedBytes: number }
  | { ok: false; status: 400 | 413; error: string; message: string };

export function validateRoomImageUpload(
  imageBase64: string,
  mimeType: string
): RoomImageValidationResult {
  const trimmedBase64 = imageBase64.trim();
  const normalizedMime = mimeType.trim().toLowerCase();

  if (!trimmedBase64) {
    return {
      ok: false,
      status: 400,
      error: 'IMAGE_REQUIRED',
      message: 'A compressed room photo is required for Gemini Vision analysis.',
    };
  }

  if (!ALLOWED_ROOM_IMAGE_MIMES.has(normalizedMime)) {
    return {
      ok: false,
      status: 400,
      error: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'Unsupported image format. Please upload a JPEG, PNG, or WebP room photo.',
    };
  }

  const decodedBytes = Buffer.byteLength(trimmedBase64, 'base64');
  if (decodedBytes > MAX_ROOM_IMAGE_BYTES) {
    return {
      ok: false,
      status: 413,
      error: 'PAYLOAD_TOO_LARGE',
      message: 'Room image exceeds the 5MB maximum size limit.',
    };
  }

  return { ok: true, decodedBytes };
}
