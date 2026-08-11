# MathWeaver Privacy Policy

**Last updated:** 2026-08-08

## Overview

MathWeaver is a desktop application that runs locally on your computer. We are committed to transparency about how your data is handled.

## Data Stored Locally

The following data is stored on your device using `electron-store` and SQLite:

| Data | Location | Purpose |
|------|----------|---------|
| LLM API key | `crypto.json` (AES-256-GCM encrypted) | Authenticate with your chosen LLM provider |
| LLM configuration | `config.json` | Provider, model, temperature settings |
| Session history | `mathweaver.db` (SQLite) | Chat messages, proof attempts, conjectures |
| Window state | `config.json` | Position, size, maximized state |
| Onboarding progress | `config.json` | Whether initial setup was completed |

**No data leaves your device** unless you explicitly configure an LLM provider.

## Data Sent to Third Parties

When you configure an LLM provider (e.g., DeepSeek, OpenAI, Claude), the following data is sent to that provider's API:

- Your chat messages and math questions
- Proof attempts and conjecture text
- Curriculum context for the current problem

**This data is governed by your chosen provider's privacy policy.** MathWeaver does not add any additional tracking, analytics, or telemetry.

## Crash Reports

MathWeaver collects native crash dumps (segfaults, aborts) using Electron's `crashReporter`. These dumps are:

- Written to a local directory on your device by default
- Uploaded to a crash reporting server **only** if `CRASH_REPORTER_URL` environment variable is set
- Never include your LLM API key or session content

Crash dumps contain: stack traces, register state, and loaded module list. They do **not** contain your personal data or API keys.

## What We Do NOT Collect

- No analytics or usage telemetry
- No IP addresses or device fingerprints
- No advertising identifiers
- No crash reports without explicit configuration

## Data Deletion

To delete all MathWeaver data from your device:

1. Uninstall MathWeaver
2. Delete the remaining data directory:
   - **Windows:** `%APPDATA%/MathWeaver/`
   - **macOS:** `~/Library/Application Support/MathWeaver/`
   - **Linux:** `~/.config/MathWeaver/`

## Children's Privacy

MathWeaver is designed for educational use, including by students under 18. No personal information is collected from any user, regardless of age. LLM provider data sharing is initiated by the user's own configuration.

## Open Source

MathWeaver is open source (Apache-2.0). You can audit the complete codebase at:
https://github.com/toki0413/mathweaver

## Contact

For privacy questions, please open an issue on the GitHub repository.

---

*This privacy policy may be updated as the application evolves. Changes will be documented in the CHANGELOG.md.*
