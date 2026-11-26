# Efficiency

- **TTL Caching:** Live Open-Meteo telemetry (5 min), Gemini Today Advisory & Room Audit outputs (15 min), and OSRM/Photon commute routes are cached server-side and in memory to minimize latency and redundant upstream calls.
- **Code Splitting:** Heavy secondary tabs (`RoomAuditTab` and `CommuteImpactTab`) are lazy-loaded via `React.lazy` and `Suspense`.
- **Resilient Upstream Routing:** Bounded per-attempt timeouts (`withAttemptTimeout`), overload cooldown tracking, and compressed JPEG room uploads keep responses fast.
