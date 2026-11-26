# Testing

Run the full automated suite with:

```bash
npm test
```

- **Unit Tests (`src/utils/__tests__/aeropulse.test.ts`):** 11 tests covering AQI severity classification, 24h Clean Window calculation, Severe Smog thresholds, CO₂/errand math, and input sanitization.
- **UI & Integration Tests (`src/components/__tests__/aeropulse.ui.test.tsx`):** 5 React Testing Library + jsdom tests covering Severe Smog Emergency Banner gating, Room Audit preset scanning, Commute Errand Bundler updates, Copilot context sync, and error boundary retries.
