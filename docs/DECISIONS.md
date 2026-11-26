# Architecture Decisions

- **Open-Meteo + Photon + OSRM (No Key Lock-In):** Chose free, key-less Open-Meteo Air Quality/Geocoding, Photon fuzzy search, OpenStreetMap tiles, and OSRM routing for reliable Pan-India coverage without billing barriers.
- **Server-Side Gemini Proxy (`server.ts`):** Kept `@google/genai` strictly server-side with structured JSON schemas (`TODAY_ADVISORY_SCHEMA`, `ROOM_AUDIT_SCHEMA`, `COPILOT_CHAT_SCHEMA`) and model fallback (`gemini-4-hydrogen` → `gemini-3.1-flash-lite`).
- **Single-Page Frosted Light Mode:** Built with React 19, Vite, and Tailwind CSS using GPU-accelerated atmospheric gradients and lazy-loaded secondary tabs.
