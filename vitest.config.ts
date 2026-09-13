import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/helpers/setup.ts'],

    // Mock hygiene policy. This is Vitest 5's own default, stated explicitly so the
    // rule is visible at the config level rather than implied by the framework version:
    // vi.clearAllMocks() runs before every test, wiping call history but LEAVING mock
    // implementations intact.
    //
    // Implementations are therefore NOT reset between tests. Files that need that must
    // do it themselves — tests/worker/index.test.ts calls vi.resetAllMocks() in
    // beforeEach, and tests/services/rss.test.ts calls mockSynthesize.mockReset().
    // Don't delete those on the assumption this setting covers them; it does not.
    clearMocks: true,
  },
});
