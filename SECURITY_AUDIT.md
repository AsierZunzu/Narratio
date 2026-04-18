# Security Audit: Narratio v2

## Context

This is a security audit of the Narratio v2 application — a personal RSS-to-podcast converter. The app has two Node processes (server + worker) sharing a SQLite DB and a `data/audio/` volume. The attack surfaces are: the Express HTTP server (5 routes + REST API), the RSS feed fetcher, article content extractor, and the Wyoming TTS TCP client.

The goal is to identify and fix all exploitable vulnerabilities before the app is exposed beyond localhost.

---

## Confirmed Vulnerabilities

### HIGH — `javascript:` XSS via article link
**File:** `src/server/templates/dashboard.ejs:142`
```ejs
<a class="btn btn-link" href="<%= a.link %>" target="_blank" rel="noopener">↗ Article</a>
```
EJS `<%=` escapes HTML entities but does **not** block `javascript:` URIs. If an RSS feed item has `<link>javascript:alert(document.domain)</link>`, clicking "↗ Article" executes arbitrary JS in the user's browser.

**Fix:** Validate `a.link` before rendering. In `src/server/ui.ts`, sanitize each article's link: only allow `http:` and `https:` protocols; replace anything else with `''` before passing to the template.

---

### HIGH — SSRF via article content extraction
**File:** `src/services/rss.ts:74–86` (`fetchFullContent`) and call site at line ~146
```typescript
const article = await Promise.race([extract(url), ...]);
```
`item.link` from the RSS feed is passed directly to `@extractus/article-extractor` with no protocol or IP validation. An attacker who controls the RSS feed can supply:
- `file:///etc/passwd` — local file read
- `http://169.254.169.254/latest/meta-data/` — cloud metadata service
- `http://localhost:5432/` — internal service port scan

**Fix:** In `fetchFullContent()` (rss.ts), validate the URL before calling `extract()`. Parse with `new URL(url)` and reject anything whose `protocol` is not `http:` or `https:`, and optionally block private/loopback IPs.

---

### MEDIUM — SSRF via RSS_URL env var
**File:** `src/utils/env.ts:25`
```typescript
RSS_URL: () => requireStr('RSS_URL'),
```
No protocol validation. `RSS_URL=file:///etc/passwd` or `RSS_URL=http://169.254.169.254/...` are accepted as-is.

**Fix:** In `env.ts`, after reading `RSS_URL`, parse with `new URL()` and throw if protocol is not `http:` or `https:`.

---

### MEDIUM — Path traversal incomplete check
**File:** `src/server/index.ts:54`
```typescript
if (!filename || filename.includes('..') || filename.includes('/')) {
```
This is safe on Linux in practice (the only path separator is `/`), but is fragile and non-idiomatic. A safer approach is to normalise first.

**Fix:** Replace the check with:
```typescript
const safe = path.basename(filename);
if (!safe || safe !== filename) { res.status(400)... }
const filePath = path.join(AUDIO_DIR, safe);
```
`path.basename()` strips all directory components, making traversal impossible regardless of OS or future code changes.

---

### LOW — No CSRF protection on state-changing API endpoints
**File:** `src/server/index.ts:98, 116, 126`

`DELETE /api/articles/:guid`, `POST /api/articles/:guid/retry`, `POST /api/articles/:guid/purge` accept requests from any origin with no CSRF token.

**Fix:** Since the app is self-hosted and the admin UI is the only legitimate caller, the simplest effective mitigation is to check the `Origin` or `Referer` header on mutating endpoints and reject cross-origin requests. Alternatively, add a static CSRF token in the dashboard HTML (rendered server-side) and validate it on the API.

---

### LOW — Unbounded TTS receive buffer (DoS)
**File:** `src/services/tts.ts` — `recvBuf` accumulation (lines ~50, ~123)
```typescript
recvBuf = Buffer.concat([recvBuf, chunk]);
```
No size cap. A malicious or buggy Piper instance can stream infinite data, exhausting Node heap memory.

**Fix:** Add a maximum buffer size constant (e.g. `MAX_RECV_BUF = 200 * 1024 * 1024` — 200 MB) and reject/abort if `recvBuf.length` exceeds it.

---

### LOW — `data_length` / `payload_length` not bounds-checked
**File:** `src/services/tts.ts:174–175`

Wyoming event fields `data_length` / `payload_length` are read from JSON without validation. `payload_length: -1` or `payload_length: 1e15` could corrupt buffer logic or exhaust memory.

**Fix:** After parsing, validate: `Number.isInteger(n) && n >= 0 && n <= MAX_RECV_BUF`.

---

### INFO — No security headers
**File:** `src/server/index.ts:45–46`

No `X-Content-Type-Options`, `X-Frame-Options`, or `Content-Security-Policy` headers.

**Fix:** Add `helmet` (already a known Express security middleware), or manually set the three most impactful headers in a single `app.use()` before all routes.

---

## Files to Modify

| File | Change |
|---|---|
| `src/server/templates/dashboard.ejs:142` | Conditionally omit `href` if link is not http/https |
| `src/server/ui.ts` | Sanitize article links before passing to template |
| `src/services/rss.ts:74–86` | Validate URL protocol in `fetchFullContent()` |
| `src/utils/env.ts:25` | Validate `RSS_URL` protocol on read |
| `src/server/index.ts:54` | Replace string checks with `path.basename()` |
| `src/server/index.ts:45–46` | Add security headers middleware |
| `src/server/index.ts:98, 116, 126` | Add Origin/Referer check on mutating endpoints |
| `src/services/tts.ts` | Cap `recvBuf` size; validate `payload_length` |

---

## Verification

1. **`javascript:` XSS:** Insert a test article with `link = 'javascript:alert(1)'` in the DB; confirm the "↗ Article" button is absent or the href is replaced.
2. **SSRF:** Call `fetchFullContent('file:///etc/passwd', ...)` in a unit test; confirm it throws/returns null.
3. **Path traversal:** `GET /audio/..%2Fetc%2Fpasswd` — must return 400 (confirm `path.basename` approach still returns 400).
4. **TTS buffer DoS:** In the TTS TCP server test fixture, stream >200 MB; confirm the socket is aborted with an error before the process OOMs.
5. **Run full test suite:** `npm test` — all 41 tests must still pass.
