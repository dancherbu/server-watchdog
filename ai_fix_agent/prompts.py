"""
prompts.py — assembles the AI agent system prompt from layered context.

Layer order (each extends the previous):
  1. base.md       — what the agent is and its core rules
  2. git.md        — how to branch, commit, push
  3. AGENT.md      — project-specific architecture (from WATCHDOG_AGENT_MD)
  4. extra_skills  — optional additional context (from WATCHDOG_EXTRA_SKILLS)
  5. runtime block — injected at call time: project root, restart command, etc.
"""

import os
from pathlib import Path


SKILLS_DIR = Path(__file__).parent.parent / "skills"


def _read(path: str | Path) -> str:
    try:
        return Path(path).read_text(encoding="utf-8").strip()
    except Exception:
        return ""


def build_system_prompt(config: dict, error_payload: dict) -> str:
    parts = []

    # 1. Base agent identity
    base = _read(SKILLS_DIR / "base.md")
    if base:
        parts.append(base)

    # 2. Git workflow
    git_skill = _read(SKILLS_DIR / "git.md")
    if git_skill:
        parts.append(git_skill)

    # 3. Project AGENT.md / copilot-instructions.md
    agent_md_path = config.get("agent_md", "")
    if not agent_md_path:
        # Try conventional locations within the project root
        project_root = config["project_root"]
        for candidate in ["AGENT.md", ".github/copilot-instructions.md", "copilot-instructions.md"]:
            candidate_path = Path(project_root) / candidate
            if candidate_path.exists():
                agent_md_path = str(candidate_path)
                break

    if agent_md_path:
        content = _read(agent_md_path)
        if content:
            parts.append(f"# Project Knowledge (from {Path(agent_md_path).name})\n\n{content}")

    # 4. Extra skills
    extra_path = config.get("extra_skills", "")
    if extra_path:
        content = _read(extra_path)
        if content:
            parts.append(f"# Additional Context\n\n{content}")

    # 5. Runtime context — injected fresh every invocation
    restart_cmd = _build_restart_command(config)
    dominant = error_payload.get("dominantError", {})
    secondaries = error_payload.get("secondaryErrors", [])

    runtime = f"""# Runtime Context (read carefully — this overrides any conflicting instructions above)

## Server environment
- Project root on this server: `{config["project_root"]}`
- Process manager: `{config["restart_mode"]}`
- Restart command: `{restart_cmd}`
- Git branch to base fixes off: `{config["git_branch"]}`
- Git remote: `{config["git_remote"]}`
- Fix branch prefix: `{config["git_fix_prefix"]}`

## Current error burst
- Dominant error: `{dominant.get("code", "unknown")}` — {dominant.get("occurrences", 1)} occurrence(s)
- Message: {dominant.get("message", "")}
- Origin: {dominant.get("origin", {}).get("file", "unknown")}:{dominant.get("origin", {}).get("line", "?")}
- Secondary errors (likely cascading): {[e["code"] for e in secondaries] or "none"}
- Total events in window: {error_payload.get("totalEvents", 1)}

## Critical rules for this server
- DO apply a minimal, targeted fix to the root cause only
- DO write a verification test and run it before committing
- DO commit the fix (and test if WATCHDOG_COMMIT_TESTS=true) to a new branch named:
  `{config["git_fix_prefix"]}/<error-code>-<YYYYMMDD-HHmm>`
- DO push the branch to `{config["git_remote"]}`
- DO NOT restart the server yourself — the watchdog handles restart after you commit
- DO NOT run: npm build, npm test, deploy scripts, pm2 delete, pm2 stop
- DO NOT modify files in node_modules/
- DO NOT attempt to fix infrastructure errors (ECONNREFUSED, ENOMEM, ER_ACCESS_DENIED)
- DO NOT merge the fix branch — leave it for human review
- If you cannot produce a fix with confidence ≥ {config["commit_threshold"]}, output JSON with committed=false and reason
- Secondary errors are almost certainly cascading from the dominant — fix the dominant only
"""
    parts.append(runtime)

    return "\n\n---\n\n".join(parts)


def _build_restart_command(config: dict) -> str:
    mode = config.get("restart_mode", "pm2")
    if mode == "pm2":
        return f"pm2 restart {config.get('pm2_app_name', '<app_name>')}"
    if mode == "systemd":
        return f"sudo systemctl restart {config.get('systemd_service', '<service>')}"
    if mode == "docker":
        return f"docker restart {config.get('docker_container', '<container>')}"
    if mode == "docker-compose":
        return (f"docker compose -f {config.get('docker_compose_file')} "
                f"restart {config.get('docker_compose_service')}")
    return f"<restart via {mode}>"
