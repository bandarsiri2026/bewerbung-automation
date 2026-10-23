# Security Audit — n8n Workflow Export (pre-publication review)

**Files audited:** `Bewerbung My (2).json`, `Answer from vector v2.json` and the two canvas screenshots.
**Method:** static inspection of the exported JSON only. No workflow was executed, no external service was contacted, and **the original files were not modified**. Secret values are described below but never reproduced in this report.

## 1. Executive summary

| # | Finding | Where | Severity | Status |
|---|---------|-------|----------|--------|
| 1 | OpenAI API key written in plaintext inside HTTP request headers | `Analyze Job Posting (OpenAI)`, `Analyze Job Text (OpenAI)`, `Generate Cover Letter (OpenAI)` — `headerParameters.parameters[].value` | **Critical** | Must be revoked + replaced |
| 2 | Personal data (name, address, phone, e-mail) hardcoded in Code nodes and in the PDF template | `Parse & Enrich Job Data`, `Parse & Enrich Job Data (Text)`, `Prepare Email & Summary`, `Generate Anschreiben PDF` | **High** | Must be moved to config/env |
| 3 | `pinData` contains a real Telegram message from a third-party account (display name, username, numeric chat/user ID) plus the pasted job text | top-level `pinData` object of `Bewerbung My (2).json` | **High** | Must be deleted before publishing |
| 4 | Hardcoded fallback recipient e-mail address used when no contact e-mail is found | `Prepare Email & Summary` (Code node) | Medium | Review / make explicit |
| 5 | Internal resource identifiers embedded in the export (Google Sheets IDs, Google Drive file/folder IDs, Supabase table name, n8n webhook IDs) | several nodes | Medium | Parameterise or accept as low risk |
| 6 | Credential metadata (credential names + internal credential IDs) | every node with `credentials` | Low | Normal for n8n exports; no secret values present |
| 7 | Instance fingerprint (`meta.instanceId`) and workflow/version IDs | top-level `meta`, `id`, `versionId` | Low | Optional to strip |
| 8 | Public API key string used as `X-API-Key` together with a User-Agent that mimics the official Arbeitsagentur app | `Fetch Job Page` | Low / compliance note | Consider documenting or using an official key |

**No passwords, cookies, database connection strings, private IP addresses or internal server URLs were found.** n8n exports never contain credential *values* — only references (id + name), which is why finding 6 is low risk.

---

## 2. Detailed findings

### Finding 1 — Plaintext OpenAI API key (Critical)
**Location:** three `httpRequest` nodes in `Bewerbung My (2).json`. Each node has an explicit header `Authorization: Bearer <40+ character OpenAI project key>` written directly into the JSON.

**Risk:**
- Anyone who receives this file can use the key to make paid API calls on your account (credit abuse, data exfiltration).
- If the file is pushed to GitHub even once, the key is permanently in the commit history — deleting it later does not undo exposure.
- The same key appears three times, so any leak is complete.

**Additional inconsistency:** those nodes *also* declare `authentication: genericCredentialType` with a stored n8n credential (`httpBearerAuth`, id masked here). Two authentication mechanisms are configured at the same time. Which one actually wins cannot be proven from the JSON alone; in practice an explicitly set header is sent alongside the credential-derived header, which can cause duplicate or conflicting `Authorization` headers.

**Required action:**
1. Revoke/rotate this key immediately in the OpenAI dashboard (do not just delete it from the file).
2. Replace the literal value with a stored n8n credential or an environment variable: `=Bearer {{ $env.OPENAI_API_KEY }}`.
3. Prefer n8n's built-in OpenAI nodes (`@n8n/n8n-nodes-langchain.openAi`) instead of raw HTTP calls — credentials are then handled by n8n.

### Finding 2 — Personal data hardcoded in workflow logic (High)
**Location:** Code nodes assign `applicant_name`, `applicant_address`, `applicant_phone`, `applicant_email` as string literals; the PDF generator embeds the same name, address, phone and e-mail into the document header, and the cover-letter prompt contains a full CV summary (education, work history, language skills).

**Risk:** publishing the repository exposes your full identity, address and phone number. It also makes the workflow unusable by anyone else without editing code.

**Action:** move these values to an environment variable set, a config node, or a Google Sheet row that is read at runtime. Keep only placeholders in the published JSON.

### Finding 3 — `pinData` with real third-party data (High)
n8n stores pinned sample input under `pinData`. In this export it contains one genuine Telegram message: another user's display name, username and numeric chat/user ID, a timestamp, and ~3.3 KB of pasted job-posting text.

**Risk:** GDPR-relevant personal data of a real person is published with the repository; the IDs are also usable for enumeration.

**Action:** delete `pinData` before publishing (the sanitized copy in this folder already has it emptied).

### Finding 4 — Hardcoded fallback recipient e-mail (Medium)
When no contact e-mail is extracted, the Code node falls back to a fixed address. This means an application draft can silently be addressed to an unrelated mailbox.

**Action:** make the fallback explicit in documentation, or stop the workflow and send a warning message to Telegram instead of guessing a recipient.

### Finding 5 — Internal identifiers (Medium/Low)
The export contains two Google Sheets document IDs, three Google Drive file IDs plus one folder ID, and five n8n `webhookId` UUIDs.

**Risk:** these are not secrets in the cryptographic sense, but they identify private resources. A Sheets/Drive document that is "anyone with the link can view" becomes directly accessible to anyone reading the repo.

**Action:** replace IDs with placeholder variables (`<SHEET_ID>`, `<CV_FILE_ID>`), and verify the sharing permissions of each referenced document before publishing.

### Finding 6 — Credential metadata (Low)
Credential entries store only `id` + `name` (e.g. "Telegram account", "Google Drive account 2"), never the token itself. This is expected for n8n exports and does not leak secrets, but it reveals which services and how many accounts are used.

### Finding 7 — Instance/version fingerprints (Low)
`meta.instanceId`, `id`, `versionId` identify your n8n instance and workflow version. Harmless in most cases; strip if you want minimal metadata.

### Finding 8 — Public API key + spoofed User-Agent (compliance note)
The `Fetch Job Page` node sends a fixed public key value used by the official job portal front-end, together with a User-Agent string that mimics an official mobile app. This works technically but is not a documented integration.

**Action:** document it as "unofficial endpoint usage" or obtain a proper API key; check the Arbeitsagentur API terms of use before publishing the workflow publicly.

### Screenshots
Both screenshots show only the canvas layout (node names and connections). No credential values are visible in them. Still, re-check any screenshot you publish for open node panels containing keys.

---

## 3. Sanitized copy created

A sanitized copy was created **without touching the original**: published here as `workflows/bewerbung-my.sanitized.json`. It:
- replace the three plaintext OpenAI keys with `Bearer {{ $env.OPENAI_API_KEY }}`,
- empty `pinData` (the original contained a real third-party Telegram message),
- replace personal name/address/phone/e-mail literals with `<APPLICANT_NAME>`, `<APPLICANT_ADDRESS>`, `<APPLICANT_PHONE>`, `<YOUR_EMAIL>`, `<FALLBACK_EMAIL>`,
- replace Google Sheets / Drive resource IDs with `=<REPLACE_WITH_SHEET_ID>`, `=<REPLACE_WITH_DRIVE_FOLDER_ID>`, `=<REPLACE_WITH_FILE_ID>` and drop the cached result URLs,
- regenerate every `webhookId` so the published file carries no instance fingerprint.

The file is valid JSON, keeps the original connection graph (24 nodes after hardening) and can be imported into n8n for testing after you attach your own credentials. Two minor residues remain by design: the city string `'Ulm, den '` in the PDF date line (change it to a config value if you want full neutrality) and generic file names such as `Lebenslauf.pdf`.

The second workflow (`Answer from vector v2`) was sanitised with the same rules and published in its own repository.

### Hardening applied after the audit

- `retryOnFail` / `maxTries: 3` / `waitBetweenRetries: 2` on all network nodes.
- New `workflows/error-handler.sanitized.json` (Error Trigger → summary → Telegram alert); attach it as each workflow's Error Workflow.
- Applicant data centralised in one `Applicant Profile` node that reads environment variables instead of literals.
- `scripts/validate_workflows.py` re-scans every published JSON for secret-like tokens and dangling connections; it runs in CI (`.github/workflows/validate.yml`).

**Reminder:** the OpenAI key that appeared in the original export must be **rotated**, not merely removed from the file — a leaked credential stays leaked even after the text is deleted.

## 4. Pre-publication checklist

1. Revoke the exposed OpenAI key (rotate, not just delete).
2. Create n8n credentials: Telegram bot token, Google OAuth (Sheets + Drive), Gmail OAuth, OpenAI, Supabase/Postgres.
3. Set environment variables (`OPENAI_API_KEY`, applicant profile values) or use a config node.
4. Delete `pinData` and screenshots that show open node panels.
5. Replace resource IDs with placeholders in the published JSON.
6. Confirm Google Sheets/Drive sharing settings are restricted to your account.
7. Never commit `.env`; add it to `.gitignore`.
8. Add a short "Security" section to the README stating that no secrets are stored inside the workflow file.
