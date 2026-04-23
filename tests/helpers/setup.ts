// Vitest global setup — runs before each test file.
// Clear inherited BASE_URL from the outer shell so server tests get a clean slate.
// Tests that need to exercise BASE_URL set it explicitly.
delete process.env['BASE_URL'];
