# Security

- **Server-Side API Keys:** `GEMINI_API_KEY` stays strictly in server-side `process.env` and is never shipped to the browser bundle.
- **Input & Upload Validation:** All user text inputs are sanitized (`sanitizeServerInput` / `sanitizeUserInput`), JSON payloads are capped at 5MB (`413` on overflow), and Room Audit image uploads enforce a strict JPEG/PNG/WebP MIME allowlist (`400` on invalid types).
- **Rate Limiting & Headers:** `/api/*` Gemini routes enforce a 20 req/min per-IP rate limiter (`429` + `Retry-After`) alongside `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and `X-Frame-Options: DENY` on API responses.
