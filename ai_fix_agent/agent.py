"""
agent.py — main AI fix agent entry point.

Usage (called by watchdog.js via spawnSync):
  python agent.py \\
    --project-root /var/www/myapp \\
    --error-json '{"dominantError": {...}, ...}' \\
    --env-file /path/to/.env.watchdog

Exit codes:
  0 — fix committed (or agent decided not to commit — check JSON output)
  1 — agent error (unexpected failure)

Last line of stdout is always a JSON result object.
"""

import argparse
import json
import os
import sys
import subprocess
import tempfile
import shutil
from datetime import datetime
from pathlib import Path

# Add parent dir to path for google.antigravity import
sys.path.insert(0, str(Path(__file__).parent))

from config import load_config
from prompts import build_system_prompt

try:
    import google.antigravity as agy
except ImportError:
    print(json.dumps({
        "committed": False,
        "reason": "google-antigravity not installed. Run: pip install google-antigravity",
    }))
    sys.exit(0)


# ── CLI ───────────────────────────────────────────────────────────────
def parse_args():
    parser = argparse.ArgumentParser(description="server-watchdog AI fix agent")
    parser.add_argument("--project-root", required=True, help="Absolute path to project root")
    parser.add_argument("--error-json",   required=True, help="JSON string with aggregated error payload")
    parser.add_argument("--env-file",     required=False, help="Path to .env.watchdog")
    return parser.parse_args()


# ── Safe path resolution ───────────────────────────────────────────────
def resolve_path(project_root: str, relative_or_absolute: str) -> str:
    """
    Resolve a path safely within the project root.
    Prevents path traversal outside the project.
    """
    p = Path(relative_or_absolute)
    if p.is_absolute():
        resolved = p.resolve()
    else:
        resolved = (Path(project_root) / p).resolve()

    project = Path(project_root).resolve()
    if not str(resolved).startswith(str(project)):
        raise ValueError(f"Path traversal attempt blocked: {relative_or_absolute}")
    return str(resolved)


# ── Tools ─────────────────────────────────────────────────────────────
def make_tools(project_root: str, config: dict):
    """
    Returns the tool functions exposed to the Gemini agent.
    All file paths are resolved relative to project_root and sandboxed within it.
    """

    backed_up: list[dict] = []  # track backups for rollback

    def read_file(path: str) -> str:
        """Read a file from the project. path can be relative to project root."""
        abs_path = resolve_path(project_root, path)
        if not os.path.exists(abs_path):
            return f"ERROR: File not found: {path}"
        with open(abs_path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()

    def write_file(path: str, content: str) -> str:
        """
        Write content to a file in the project.
        Automatically backs up the original before writing.
        """
        abs_path = resolve_path(project_root, path)

        # Back up original if it exists
        if os.path.exists(abs_path):
            timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
            backup = f"/tmp/watchdog-backup-{Path(abs_path).name}-{timestamp}"
            shutil.copy2(abs_path, backup)
            backed_up.append({"original": abs_path, "backup": backup})

        # Write the new content
        os.makedirs(os.path.dirname(abs_path), exist_ok=True)
        with open(abs_path, "w", encoding="utf-8") as f:
            f.write(content)
        return f"OK: wrote {len(content)} bytes to {path}"

    def list_dir(path: str = ".") -> str:
        """List files in a directory (relative to project root)."""
        abs_path = resolve_path(project_root, path)
        if not os.path.isdir(abs_path):
            return f"ERROR: Not a directory: {path}"
        entries = []
        for entry in sorted(os.scandir(abs_path), key=lambda e: (e.is_file(), e.name)):
            prefix = "📁 " if entry.is_dir() else "📄 "
            entries.append(f"{prefix}{entry.name}")
        return "\n".join(entries) or "(empty)"

    def run_command(command: str) -> str:
        """
        Run a whitelisted shell command in the project root.
        Only safe, read-only or fix-related commands are permitted.
        """
        cmd_lower = command.strip().lower()

        # Whitelist — only safe commands
        ALLOWED_PREFIXES = [
            "node --check",
            "node /tmp/watchdog-verify",
            "node /tmp/watchdog-test",
            "python3 /tmp/watchdog-verify",
            "python3 /tmp/watchdog-test",
            "git status",
            "git diff",
            "git log",
            "git checkout",
            "git pull",
            "git add",
            "git commit",
            "git push",
            "git branch",
            "git rev-parse",
        ]
        BLOCKED_KEYWORDS = [
            "rm -rf", "sudo", "curl", "wget", "npm install",
            "pip install", "pm2 delete", "pm2 stop", "systemctl stop",
            "docker stop", "docker rm", "chmod 777", "passwd",
        ]

        for blocked in BLOCKED_KEYWORDS:
            if blocked in cmd_lower:
                return f"BLOCKED: command contains forbidden operation: '{blocked}'"

        allowed = any(cmd_lower.startswith(prefix.lower()) for prefix in ALLOWED_PREFIXES)
        if not allowed:
            return f"BLOCKED: command not in whitelist. Allowed prefixes: {ALLOWED_PREFIXES[:5]}..."

        try:
            result = subprocess.run(
                command,
                shell=True,
                capture_output=True,
                text=True,
                cwd=project_root,
                timeout=config.get("test_timeout_ms", 30_000) / 1000,
            )
            output = result.stdout + result.stderr
            return (output or "(no output)") + f"\n[exit {result.returncode}]"
        except subprocess.TimeoutExpired:
            return "ERROR: Command timed out"
        except Exception as e:
            return f"ERROR: {e}"

    def write_temp_test(content: str, extension: str = "js") -> str:
        """
        Write a temporary verification test file to /tmp.
        Returns the absolute path of the test file.
        """
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S%f")
        test_path = f"/tmp/watchdog-verify-{timestamp}.{extension}"
        with open(test_path, "w", encoding="utf-8") as f:
            f.write(content)
        return test_path

    # Return tools dict and the backed_up reference
    tools = {
        "read_file":        read_file,
        "write_file":       write_file,
        "list_dir":         list_dir,
        "run_command":      run_command,
        "write_temp_test":  write_temp_test,
    }
    return tools, backed_up


# ── Agent runner ──────────────────────────────────────────────────────
def run_agent(config: dict, error_payload: dict, project_root: str) -> dict:
    """
    Builds the system prompt, runs the Gemini agent, and returns the result dict.
    """
    system_prompt = build_system_prompt(config, error_payload)
    tools, backed_up = make_tools(project_root, config)

    # Initial user message with full error context
    dominant = error_payload.get("dominantError", {})
    user_message = f"""Fix the following production error burst:

**Dominant error:** `{dominant.get("code", "unknown")}` — {dominant.get("occurrences", 1)} occurrence(s)
**Message:** {dominant.get("message", "")}
**Origin:** {dominant.get("origin", {}).get("file", "unknown")}:{dominant.get("origin", {}).get("line", "?")}
**Secondary errors (likely cascading):** {[e["code"] for e in error_payload.get("secondaryErrors", [])] or "none"}
**Total events in window:** {error_payload.get("totalEvents", 1)}

**Raw error sample:**
```
{dominant.get("raw", "")[:2000]}
```

Follow the workflow in your system prompt exactly.
Start by reading the origin file, then follow imports to find the root cause.
Check `git log --oneline -5` to see what changed recently.
Output your JSON result on the last line of your response.
"""

    try:
        agent = agy.Agent(
            model=config["ai_model"],
            api_key=config["gemini_api_key"],
            system_prompt=system_prompt,
            tools=list(tools.values()),
        )
        response = agent.run(user_message)
    except Exception as e:
        return {
            "committed": False,
            "reason": f"Agent error: {e}",
            "filesBackedUp": backed_up,
        }

    # Parse JSON result from last line of agent response
    lines = str(response).strip().split("\n")
    for line in reversed(lines):
        line = line.strip().strip("`")
        if line.startswith("{") and line.endswith("}"):
            try:
                result = json.loads(line)
                result["filesBackedUp"] = backed_up
                return result
            except json.JSONDecodeError:
                continue

    # Fallback if agent didn't output valid JSON
    return {
        "committed": False,
        "reason": "Agent did not output a valid JSON result",
        "raw_response": str(response)[-2000:],
        "filesBackedUp": backed_up,
    }


# ── Entry point ───────────────────────────────────────────────────────
def main():
    args = parse_args()

    # Load config
    config = load_config(args.env_file)

    # Override project root from CLI (watchdog passes it explicitly)
    project_root = args.project_root
    config["project_root"] = project_root

    # Parse error payload
    try:
        error_payload = json.loads(args.error_json)
    except json.JSONDecodeError as e:
        print(json.dumps({"committed": False, "reason": f"Invalid error JSON: {e}"}))
        sys.exit(0)

    # Run agent
    result = run_agent(config, error_payload, project_root)

    # Always print JSON result as last line
    print(json.dumps(result))
    sys.exit(0)  # watchdog reads exit 0 as "agent ran successfully"


if __name__ == "__main__":
    main()
