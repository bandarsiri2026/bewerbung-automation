# Setup Guide

## 1. Import the workflow

1. In n8n: **Workflows → Import from file** and pick:
   - `workflows/bewerbung-my.sanitized.json` — Telegram → job ad → Anschreiben PDF → Gmail draft
2. The sanitized file contains **no** API keys, no personal data and generic resource IDs.

> The companion RAG workflow (`Answer from vector v2`) is published in its own repository: [answer-from-vector-v2](https://github.com/bandarsiri2026/answer-from-vector-v2).

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

## 4. Environment variables

Copy `.env.example` to `.env` locally, or store the values in n8n credentials. Never commit `.env`.

## 5. Known limitations before production use

- The PDF generator writes a **single page** (`if (y < 80) break`) — long letters are truncated.
- No `retryOnFail` / Error Trigger is configured; add an Error Handler workflow for reliability.
- No scheduled trigger: the pipeline only runs when someone messages the bot.

---

The companion RAG assistant (`Answer from vector v2`) is published separately: [answer-from-vector-v2](https://github.com/bandarsiri2026/answer-from-vector-v2).
