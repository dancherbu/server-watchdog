# Contributing to server-watchdog

Thanks for your interest in contributing. This tool runs on production servers — please read these guidelines before submitting anything.

## What we accept

| Type | Welcome? |
|------|----------|
| Bug fixes | ✅ Always |
| New process manager adapters (systemd, docker-compose, etc.) | ✅ |
| New error classifiers / log format support | ✅ |
| `install.sh` improvements | ✅ |
| Documentation improvements | ✅ |
| New language log support (Python, Rails, Go, PHP) | ✅ |
| Performance improvements | ✅ if measured |
| Changes to AI agent core commit/rollback logic | ⚠️ Discuss in an issue first |
| New npm/pip dependencies | ⚠️ Discuss in an issue first — attack surface on servers |
| Breaking changes to `.env.watchdog` key names | ❌ Backwards compat must be preserved |

## Before you start

1. **Open an issue first** for anything beyond a simple bug fix. This avoids wasted effort if the direction isn't right.
2. **Test on a real server**, not just locally. The watchdog behaves differently when running under PM2 or systemd.
3. **Never hardcode paths, credentials, or host names.** Everything must come from `.env.watchdog`.

## Development setup

```bash
git clone https://github.com/dancherbu/server-watchdog.git
cd server-watchdog
cp .env.watchdog.example .env.watchdog
# Fill in .env.watchdog with a test project

# Syntax check all JS files
npm run check

# Run the watchdog manually (Ctrl+C to stop)
node watchdog.js
```

## Submitting a pull request

1. Fork the repo
2. Create a branch: `git checkout -b fix/my-fix` or `feat/my-feature`
3. Make your changes
4. Run `npm run check` — all files must pass `node --check`
5. Update `.env.watchdog.example` if you added new config keys
6. Update `README.md` if behaviour changed
7. Submit a PR against `main`

### PR checklist

Your PR description must confirm:

- [ ] Tested on a real server (not just locally)
- [ ] `.env.watchdog.example` updated if new config keys added
- [ ] `README.md` updated if behaviour changed
- [ ] No new dependencies introduced without prior discussion
- [ ] No hardcoded credentials, paths, or hostnames
- [ ] `npm run check` passes

## Code style

- Plain Node.js — no TypeScript, no build step, no bundler
- No npm dependencies in the core watchdog (keep it zero-dependency for Node)
- Python agent dependencies go in `ai_fix_agent/requirements.txt`
- Comments over clever code — this runs on production, readability matters

## Security

If you find a security vulnerability, **do not open a public issue**. See [SECURITY.md](SECURITY.md).
