# tcpwatch-app-v0.2.11

## Features

- **Settings page** — new in-app Settings UI (Cmd+, or app menu) to configure Anthropic API key, Claude model, binary paths, and reverse DNS
- **JSON config file** — settings stored in `~/Library/Application Support/tcpwatch/config.json`, persisted across restarts
- **Automatic .env migration** — existing `.env` settings are migrated to `config.json` on first launch
- **Three-tier config precedence** — shell environment variables > config.json > .env defaults
