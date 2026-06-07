"""
config.py — reads configuration for the AI fix agent from .env.watchdog.
All other agent modules import from here.
"""

import os
import sys
from pathlib import Path
from dotenv import load_dotenv


def load_config(env_file: str | None = None) -> dict:
    """
    Load and return the agent config.
    env_file: path to .env.watchdog (passed via CLI --env-file).
    """
    if env_file and Path(env_file).exists():
        load_dotenv(env_file, override=False)
    else:
        # Fallback: look for .env.watchdog next to this file's parent (watchdog install dir)
        default = Path(__file__).parent.parent / ".env.watchdog"
        if default.exists():
            load_dotenv(default, override=False)

    def required(key: str) -> str:
        val = os.environ.get(key, "").strip()
        if not val:
            print(f"[config] ERROR: Missing required config: {key}", file=sys.stderr)
            sys.exit(1)
        return val

    def optional(key: str, default: str = "") -> str:
        return os.environ.get(key, default).strip()

    def optional_float(key: str, default: float) -> float:
        val = os.environ.get(key, "")
        try:
            return float(val) if val.strip() else default
        except ValueError:
            return default

    def optional_int(key: str, default: int) -> int:
        val = os.environ.get(key, "")
        try:
            return int(val) if val.strip() else default
        except ValueError:
            return default

    def optional_bool(key: str, default: bool) -> bool:
        val = os.environ.get(key, "").strip().lower()
        if not val:
            return default
        return val == "true"

    return {
        # Target project
        "project_root":   required("WATCHDOG_PROJECT_ROOT"),
        # Git
        "git_branch":     optional("WATCHDOG_GIT_BRANCH", "main"),
        "git_fix_prefix": optional("WATCHDOG_GIT_FIX_BRANCH_PREFIX", "ai-fix"),
        "git_remote":     optional("WATCHDOG_GIT_REMOTE", "origin"),
        # AI
        "gemini_api_key":     required("GEMINI_API_KEY"),
        "ai_model":           optional("AI_FIX_MODEL", "gemini-2.5-flash"),
        "commit_threshold":   optional_float("AI_FIX_COMMIT_THRESHOLD", 0.80),
        "max_retries":        optional_int("AI_FIX_MAX_RETRIES", 2),
        # Process manager
        "restart_mode":           optional("WATCHDOG_RESTART_MODE", "pm2"),
        "pm2_app_name":           optional("WATCHDOG_PM2_APP_NAME", ""),
        "systemd_service":        optional("WATCHDOG_SYSTEMD_SERVICE", ""),
        "docker_container":       optional("WATCHDOG_DOCKER_CONTAINER", ""),
        "docker_compose_file":    optional("WATCHDOG_DOCKER_COMPOSE_FILE", ""),
        "docker_compose_service": optional("WATCHDOG_DOCKER_COMPOSE_SERVICE", ""),
        # Project-specific AI knowledge
        "agent_md":    optional("WATCHDOG_AGENT_MD", ""),
        "extra_skills": optional("WATCHDOG_EXTRA_SKILLS", ""),
        # Test execution
        "test_timeout_ms": optional_int("WATCHDOG_TEST_TIMEOUT_MS", 30_000),
        "commit_tests":    optional_bool("WATCHDOG_COMMIT_TESTS", True),
    }
