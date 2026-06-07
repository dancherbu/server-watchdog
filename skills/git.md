# Git Workflow

You have access to git tools. Follow this exact workflow:

## 1. Create a fix branch

```bash
git checkout <base_branch>
git pull <remote> <base_branch>
git checkout -b <fix_branch_prefix>/<error-code>-<YYYYMMDD-HHmm>
```

## 2. Back up files before patching

Before writing any changes, back up each file you plan to modify:
```
/tmp/watchdog-backup-<filename>-<timestamp>
```
Record each backup in the `filesBackedUp` array of your output JSON.
The watchdog uses this list to rollback if health fails after restart.

## 3. Apply the fix

Write the corrected file content using your file write tool.

## 4. Write and run a verification test

Write a minimal targeted test to `/tmp/watchdog-verify-<timestamp>.js` (or `.py`).
The test should exercise the exact code path that was broken.
Run it. It must exit 0 (pass) before you commit.

If the test fails, retry the fix. After max_retries failures, output `committed: false`.

## 5. Commit

```bash
git add <changed files>
# If WATCHDOG_COMMIT_TESTS=true, also add the test file (copy it to the project first)
git commit -m "fix(<scope>): <concise description>

Root cause: <what the actual bug was>
Error: <error code> — <N> occurrences
Verified: test passed before commit
AI-generated fix — review before merging"
```

## 6. Push

```bash
git push <remote> <branch>
```

## Rules

- Always base your branch off the configured base branch, not off whatever HEAD is currently at
- Never commit to main/master directly
- Never merge
- Never force push
- If git push fails (SSH not configured), output `committed: false` with reason `git_push_failed`
