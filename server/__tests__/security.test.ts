import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_ROOM_IMAGE_BYTES,
  createRateLimiter,
  sanitizeServerInput,
  validateRoomImageUpload,
} from '../middleware.ts';

function createMockResponse() {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let body: unknown = null;

  const res = {
    setHeader(name: string, value: string) {
      headers[name] = value;
      return this;
    },
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
  } as unknown as Response;

  return {
    res,
    getHeaders: () => headers,
    getStatus: () => statusCode,
    getBody: () => body,
  };
}

describe('AeroPulse Server Security Middleware', () => {
  it('allows normal traffic within limit and returns 429 + Retry-After when exceeded', () => {
    const limiter = createRateLimiter(3, 60_000);
    const req = {
      headers: { 'x-forwarded-for': '203.0.113.10' },
      ip: '203.0.113.10',
      socket: { remoteAddress: '203.0.113.10' },
    } as unknown as Request;

    const next = vi.fn() as unknown as NextFunction;

    for (let i = 0; i < 3; i++) {
      const mock = createMockResponse();
      limiter(req, mock.res, next);
    }
    expect(next).toHaveBeenCalledTimes(3);

    const blocked = createMockResponse();
    limiter(req, blocked.res, next);
    expect(next).toHaveBeenCalledTimes(3);
    expect(blocked.getStatus()).toBe(429);
    expect(Number(blocked.getHeaders()['Retry-After'])).toBeGreaterThanOrEqual(1);
    expect(blocked.getBody()).toMatchObject({ error: 'RATE_LIMITED' });
  });

  it('rejects unsupported MIME image types with 400 UNSUPPORTED_MEDIA_TYPE', () => {
    const result = validateRoomImageUpload('aGVsbG8=', 'image/svg+xml');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.status).toBe(400);
      expect(result.error).toBe('UNSUPPORTED_MEDIA_TYPE');
    }

    const validJpeg = validateRoomImageUpload('aGVsbG8=', 'image/jpeg');
    expect(validJpeg.valid).toBe(true);
  });

  it('rejects decoded image payloads larger than 5MB with 413 PAYLOAD_TOO_LARGE', () => {
    const oversizedBuffer = Buffer.alloc(MAX_ROOM_IMAGE_BYTES + 1024, 1);
    const result = validateRoomImageUpload(oversizedBuffer.toString('base64'), 'image/jpeg');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.status).toBe(413);
      expect(result.error).toBe('PAYLOAD_TOO_LARGE');
    }
  });

  it('strips <script>/HTML tags and control characters in sanitizeServerInput', () => {
    const dirty = '<script>alert("xss")</script>\u0000\u0007Dwarka\tSector\n<b>4</b>`';
    const cleaned = sanitizeServerInput(dirty, 100);
    expect(cleaned).not.toContain('<');
    expect(cleaned).not.toContain('>');
    expect(cleaned).not.toContain('`');
    expect(cleaned).not.toMatch(/[\u0000-\u001F\u007F]/);
    expect(cleaned).toBe('alert("xss") Dwarka Sector 4');
  });
});
