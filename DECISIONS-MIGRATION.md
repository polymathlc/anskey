# OpenAI Decisions migration

Voice-command routing now calls `https://api.openai.com/v1/decisions` with `gpt-6-luna` and the existing server-side `OPENAI_API_KEY`.

Named answers and probability arrays are validated. Unknown choices, missing/duplicate/refused answers and malformed distributions cannot authorize an action. Existing authorization, quotas, confidence thresholds and fallback behavior remain in force. Legacy Jev function names, UI labels and persisted fields remain for compatibility; they no longer imply a Jev provider call.

Deploy `functions:ans-key-live` to activate. The repository deployment workflow requires `FIREBASE_SERVICE_ACCOUNT` for `mathgen--app`. No shared database rules are changed by this migration. Tests mock provider responses; live API availability and latency still require a deployed smoke check.

[Official API documentation](https://developers.openai.com/api/docs/guides/decisions)
