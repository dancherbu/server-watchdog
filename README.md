# server-watchdog

**Universal self-healing daemon for production backend servers.**

Watches your error logs, identifies root causes with AI (Gemini), applies minimal code fixes, writes a verification test, restarts your process, and confirms health — automatically, on any server.

```
Error burst detected (50 errors, 60s window)
        ↓
Root cause identified (not just symptoms)
        ↓
Minimal patch applied + verification test written
        ↓
Test passes → committed to ai-fix/ branch
        ↓
Server restarted → /health returns ok
        ↓
You get notified → merge when ready
```

Works with **any backend** (Node.js, Python, Ruby, Go, PHP) and any process manager (PM2, systemd, Docker, docker-compose).

---

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/dancherbu/server-watchdog/main/install.sh | bash
```

Then edit `~/.server-watchdog/.env.watchdog` and start the watchdog:

```bash
pm2 restart server-watchdog
```

---

## Configuration

All configuration lives in `~/.server-watchdog/.env.watchdog`. Copy the example:

```bash
cp ~/.server-watchdog/.env.watchdog.example ~/.server-watchdog/.env.watchdog
```

### Minimal config (required)

```env
WATCHDOG_PROJECT_ROOT=/var/www/myapp
WATCHDOG_LOG_PATH=/var/www/myapp/logs/error.log
WATCHDOG_HEALTH_URL=https://myapp.com/api/health
GEMINI_API_KEY=your_key_here
WATCHDOG_RESTART_MODE=pm2
WATCHDOG_PM2_APP_NAME=server-myapp
```

### Full config reference

See [`.env.watchdog.example`](.env.watchdog.example) for all options with documentation.

---

## How it works

### 1. Log polling
The watchdog tails your error log every `WATCHDOG_POLL_MS` milliseconds (default: 60s). Errors within the same window are deduplicated — 50 errors from one bug = one agent invocation.

### 2. AI root cause analysis
The Gemini agent reads the crash files (from stack traces), follows imports to find root cause, and reads your `AGENT.md` or `WATCHDOG_AGENT_MD` for project-specific architectural knowledge.

### 3. Fix + test
The agent applies a minimal patch and writes a targeted verification test. The test must pass before any commit happens.

### 4. Commit
The fix is committed to a `ai-fix/<error-code>-<timestamp>` branch. You review and merge.

### 5. Restart + health check
The server is restarted using your configured process manager. If `/health` returns `ok`, the fix is confirmed. If not, original files are restored and the server is restarted cleanly — you get notified of the failure.

---

## Project-specific AI knowledge

The agent becomes dramatically more effective when it knows your project's architecture. Point it at your `AGENT.md` or equivalent:

```env
WATCHDOG_AGENT_MD=/var/www/myapp/AGENT.md
```

The agent reads this before every fix attempt. Include:
- Directory structure and patterns
- How DB queries work in your stack
- Which errors are fixable vs. which need human review
- What "deploy" means on this server (e.g., `pm2 restart` only — no build steps)

See [`skills/agent-md-guide.md`](skills/agent-md-guide.md) for a template.

---

## Process managers

| `WATCHDOG_RESTART_MODE` | Required env vars |
|-------------------------|-------------------|
| `pm2` | `WATCHDOG_PM2_APP_NAME` |
| `systemd` | `WATCHDOG_SYSTEMD_SERVICE` |
| `docker` | `WATCHDOG_DOCKER_CONTAINER` |
| `docker-compose` | `WATCHDOG_DOCKER_COMPOSE_FILE`, `WATCHDOG_DOCKER_COMPOSE_SERVICE` |

---

## Security

- `.env.watchdog` is `chmod 600` automatically — never readable by other users
- The watchdog never reads or transmits your `.env.watchdog` to any external service
- Only error log snippets and the patched source files are sent to the Gemini API
- To report a security vulnerability: use [GitHub private security advisories](https://github.com/dancherbu/server-watchdog/security/advisories/new)

See [SECURITY.md](SECURITY.md) for the full policy.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

[MIT](LICENSE)
