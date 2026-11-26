import type { NextFunction, Request, Response } from 'express';

export const MAX_ROOM_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB strict binary cap
export const ALLOWED_ROOM_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const GEMINI_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const GEMINI_RATE_LIMIT_MAX_REQUESTS = 20;

export function sanitizeServerInput(raw: unknown, maxLength = 240): string {
  if (typeof raw !== 'string') return '';
  return raw
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

export function createRateLimiter(
  maxRequests = GEMINI_RATE_LIMIT_MAX_REQUESTS,
  windowMs = GEMINI_RATE_LIMIT_WINDOW_MS
) {
  const bucket = new Map<string, number[]>();

  return function rateLimiter(req: Request, res: Response, next: NextFunction): void {
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

    // Periodically prune stale IP keys so in-memory map stays bounded
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

export const geminiRateLimiter = createRateLimiter();

export interface ImageValidationFailure {
  valid: false;
  status: 400 | 413;
  error: string;
  message: string;
}

export type ImageValidationResult = { valid: true } | ImageValidationFailure;

export function validateRoomImageUpload(
  imageBase64: string,
  mimeType: string
): ImageValidationResult {
  const trimmedBase64 = imageBase64.trim();
  const normalizedMime = mimeType.trim().toLowerCase();

  if (!trimmedBase64) {
    return {
      valid: false,
      status: 400,
      error: 'IMAGE_REQUIRED',
      message: 'A compressed room photo is required for Gemini Vision analysis.',
    };
  }

  if (!ALLOWED_ROOM_IMAGE_MIMES.has(normalizedMime)) {
    return {
      valid: false,
      status: 400,
      error: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'Unsupported image format. Please upload a JPEG, PNG, or WebP room photo.',
    };
  }

  const decodedImageBytes = Buffer.byteLength(trimmedBase64, 'base64');
  if (decodedImageBytes > MAX_ROOM_IMAGE_BYTES) {
    return {
      valid: false,
      status: 413,
      error: 'PAYLOAD_TOO_LARGE',
      message: 'Room image exceeds the 5MB maximum size limit.',
    };
  }

  return { valid: true };
}

export function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (req.path.startsWith('/api/')) {
    res.setHeader('X-Frame-Options', 'DENY');
  }
  next();
}

export function payloadTooLargeHandler(
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

export function apiNotFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    error: 'API_NOT_FOUND',
    message: 'Requested AeroPulse API endpoint was not found.',
  });
}

export function apiErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const status =
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    typeof (err as { status?: unknown }).status === 'number'
      ? (err as { status: number }).status
      : 500;
  const message =
    err instanceof Error && err.message ? err.message : 'Unexpected AeroPulse API error. Please retry.';
  if (!res.headersSent) {
    res.status(status >= 400 && status < 600 ? status : 500).json({
      error: 'API_ERROR',
      message,
    });
  }
}
