# Setup Guide

## 1. Import the workflows

1. In n8n: **Workflows → Import from file** and pick one of:
   - `workflows/bewerbung-my.sanitized.json` — Telegram → job ad → Anschreiben PDF → Gmail draft
   - `workflows/answer-from-vector-v2.sanitized.json` — RAG / Supabase ingestion + agent answering
2. The sanitized files contain **no** API keys, no personal data and generic resource IDs.

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
- `<REPLACE_WITH_SUPABASE_TABLE>` / `<REPLACE_WITH_VECTOR_STORE>` → RAG storage in workflow B

## 4. Environment variables

Copy `.env.example` to `.env` locally, or store the values in n8n credentials. Never commit `.env`.

## 5. Known limitations before production use

- The PDF generator writes a **single page** (`if (y < 80) break`) — long letters are truncated.
- No `retryOnFail` / Error Trigger is configured; add an Error Handler workflow for reliability.
- Workflow B has three disabled nodes and an unconnected ingestion branch — verify the intended flow before running it.
