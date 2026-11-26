# Code Quality

- **Strict TypeScript:** Type-checked cleanly via `tsc --noEmit` (`npm run lint`) with typed data models in `src/types/aeropulse.ts` and zero `any` usage.
- **Modular Architecture:** Client features are cleanly split across `src/components/`, `src/services/`, `src/utils/`, and `src/data/indianCities.ts`, paired with an Express API backend in `server.ts`.
- **Clean Formatting & CI:** Enforced `.editorconfig` conventions and automated lint, test, and build checks in `.github/workflows/ci.yml`.
