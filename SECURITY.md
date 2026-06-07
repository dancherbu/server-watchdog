# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| `main` (latest) | ✅ |
| Older tagged releases | ⚠️ Best-effort |

## Reporting a Vulnerability

**Do NOT open a public GitHub issue for security vulnerabilities.**

server-watchdog runs on production servers with access to source code, process managers, and API keys. Security issues must be disclosed privately.

**Report here:**
👉 [Open a private security advisory](https://github.com/dancherbu/server-watchdog/security/advisories/new)

GitHub private advisories let you submit full details confidentially. The maintainer will respond within **48 hours** and coordinate a fix before any public disclosure.

## What counts as a security vulnerability

- Code execution or privilege escalation via `.env.watchdog` parsing
- Credential leakage (API keys, SSH keys) in logs or error output
- Path traversal in file read/write tools used by the AI agent
- The install script downloading or executing unverified code
- Any attack vector that could cause the watchdog to push malicious commits

## What does NOT count

- Errors caused by misconfiguration of your own `.env.watchdog`
- The AI agent producing an incorrect fix (this is an AI limitation, not a CVE)
- Rate limiting or quota issues with the Gemini API
