# Agent MD Guide — How to write project context for server-watchdog

This file explains what to put in your `AGENT.md` (or equivalent) so the AI fix agent understands your project well enough to fix root causes, not just symptoms.

Point the watchdog at your file via:
```env
WATCHDOG_AGENT_MD=/var/www/myapp/AGENT.md
```

---

## What to include

### 1. Architecture overview
```markdown
## Architecture
- Entry point: backend/server.js → app.js → routes/
- All DB queries go through db/index.js (mysql2/promise pool)
- Services layer: business logic only, no req/res objects
- Controllers: thin, delegate to services
```

### 2. Error taxonomy — what's fixable vs. what needs a human
```markdown
## Error handling guide
### AI can fix:
- ER_BAD_FIELD_ERROR — SQL alias or column name bug
- TypeError: Cannot read properties — null check missing
- ReferenceError — variable used before declaration

### AI must NOT attempt to fix:
- ER_ACCESS_DENIED — DB credentials issue, not a code bug
- ECONNREFUSED — DB/Redis is down, infrastructure issue
- ENOMEM — out of memory, infrastructure issue
- Any error in node_modules/ — don't patch dependencies
```

### 3. Deployment context on THIS server
```markdown
## Deployment (server-side only)
- Process manager: pm2
- Restart: pm2 restart server-myapp
- Health check: GET /api/health → {"status":"ok"}
- Do NOT run: npm build, npm test, deploy scripts
- Do NOT run: pm2 delete, pm2 stop
- Git: push fix branch, do not merge
```

### 4. Key file map
```markdown
## Key files
- backend/db/index.js — DB connection pool
- backend/middleware/errorHandler.js — global error handler
- backend/routes/index.js — route registration
```

### 5. Patterns / conventions
```markdown
## Conventions
- All async route handlers are wrapped in try/catch → errorHandler
- SQL queries always use parameterised placeholders (never string concat)
- Services always return { data, error } objects
```

---

## What NOT to include

- Credentials, tokens, passwords
- Anything already obvious from reading the code
- Front-end specific details (the watchdog only touches backend)
- CI/CD pipeline details that don't apply on the server
