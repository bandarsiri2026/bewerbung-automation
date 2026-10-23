# Changelog

All notable changes to this repository are recorded here.

## v1.1.0 — hardening (2026-10-23)

**Workflow A — `Bewerbung My`**
- **Multi-page PDF**: the hand-written PDF generator now flushes a new page when the
  bottom margin is reached instead of silently truncating the letter (`pdf_pages` is
  returned for observability). Verified with `scripts/pdf_test.js` (6-page output,
  valid `/Kids`, `/Count` and xref offsets).
- **Config-driven applicant profile**: a new `Applicant Profile` code node reads
  `APPLICANT_NAME`, `APPLICANT_ADDRESS`, `APPLICANT_PHONE`, `YOUR_EMAIL` and
  `FALLBACK_EMAIL` from the environment, with placeholder fallbacks. The e-mail body,
  subject and PDF header all read from this single node instead of hard-coded strings.
- **Retries**: `retryOnFail` + `maxTries: 3` + `waitBetweenRetries: 2` on every network
  node (HTTP, OpenAI, Drive, Sheets, Gmail, Telegram) — 13 nodes.
- **Dead code removed**: the unused `is_yes` / `is_no` flags from the message parser.

**Workflow B — `Answer from vector v2`**
- Retries enabled on the 7 active network nodes (OpenAI, Drive, Telegram).

**New shared workflow**
- `workflows/error-handler.sanitized.json`: Error Trigger → error summary → Telegram
  alert. Attach it as the *Error Workflow* of both workflows (see `docs/setup.md`).

**Tooling**
- `scripts/validate_workflows.py` — parses every export, scans for secret-like tokens,
  and checks that all connections point to existing nodes.
- `scripts/pdf_test.js` — runnable test harness for the PDF layout code.
- `.github/workflows/validate.yml` — CI runs both checks on every push.

## v1.0.0 — initial public release (2026-10-23)

- Sanitized exports of both workflows with all API keys, tokens and personal data removed.
- README with architecture diagrams, node-by-node explanation and troubleshooting table.
- `docs/setup.md`, `.env.example`, `.gitignore` (raw exports/screenshots excluded), MIT license.
