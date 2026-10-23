# Setup Guide

## 1. Import the workflows

1. In n8n: **Workflows → Import from file** and pick:
   - `workflows/bewerbung-my.sanitized.json` — Telegram → job ad → Anschreiben PDF → Gmail draft
   - `workflows/error-handler.sanitized.json` — shared error handler for the pipeline
2. The sanitized files contain **no** API keys, no personal data and only generic resource IDs.

> The second workflow from the original project (`Answer from vector v2`, a multimodal RAG assistant) is published in its own repository: [answer-from-vector-v2](https://github.com/bandarsiri2026/answer-from-vector-v2).

## 1b. Wire up the error handler

After importing `error-handler.sanitized.json`, open each of the other workflows → **Settings** → **Error Workflow** and select it. Set `<REPLACE_WITH_TELEGRAM_CHAT_ID>` in its Telegram node to your chat ID so failures are reported instead of silently ending.

## 2. Attach credentials

Open each node that references an environment variable and create the matching n8n credential:

| Node type | Credential to attach |
|---|---|
| OpenAI / LLM nodes | OpenAI API key (never hard-coded) |
| Telegram Trigger | Telegram bot access token |
| Gmail nodes | OAuth2 client ID + secret, or n8n Gmail credential |
| Google Drive / Sheets | OAuth2 credential with Drive + Sheets scopes |
| HTTP Request (Arbeitsagentur) | none required (public API) |

## 3. Replace placeholder IDs

The sanitized exports use placeholders that must be replaced with your own resource IDs:

- `<REPLACE_WITH_SHEET_ID>` → the Google Sheet used for logging
- `<REPLACE_WITH_DRIVE_FOLDER_ID>` → the Drive folder for generated PDFs
- `<REPLACE_WITH_FILE_ID>` → the CV / certificate files in Drive
- `<REPLACE_WITH_TELEGRAM_CHAT_ID>` → chat ID used by the error handler

## 4. Environment variables

Copy `.env.example` to `.env` locally, or store the values in n8n credentials. Never commit `.env`.

## 5. Test the logic without n8n

```bash
python3 scripts/validate_workflows.py   # parses every export, scans for secrets, checks connections
node scripts/pdf_test.js                # renders docs/sample-anschreiben.pdf (multi-page layout)
```

Both commands run in GitHub Actions on every push (`.github/workflows/validate.yml`).

## 6. Known limitations before production use

- Only Arbeitsagentur URLs are fetched automatically; other portals need pasted text.
- OpenAI calls are raw HTTP requests rather than n8n's built-in OpenAI nodes — move them to credentials for cleaner auth.
- No input validation node: incomplete extraction still produces a document ("Unknown Company").
- No scheduled trigger: the pipeline only runs when someone messages the bot.
- The RAG workflow (`Answer from vector v2`) is not part of this repository; it has three disabled nodes and an ingestion branch that must be run manually — see its own repo for details.

---

See `CHANGELOG.md` for what was hardened compared to the original export (multi-page PDF, retries, error handler, env-driven applicant profile).
