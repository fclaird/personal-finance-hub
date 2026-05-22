# Migration from legacy Finance Hub

Move the application from the current location into this umbrella repository **without** touching runtime data under `~/.local/share/finance-hub/`.

## Source and target

| | Path |
|---|------|
| **Legacy app** | `~/personal-finance-hub/finance-hub/` |
| **Legacy remote** | `https://github.com/fclaird/finance-hub.git` |
| **Target app** | `~/Projects/personal-finance-hub/apps/finance-hub/` |
| **Target umbrella** | `~/Projects/personal-finance-hub/` |

## Pre-migration checklist

- [ ] Commit or stash all in-progress work in the legacy repo
- [ ] Note current branch and remote: `git -C ~/personal-finance-hub/finance-hub status`
- [ ] Confirm runtime data exists (optional): `ls ~/.local/share/finance-hub/`
- [ ] Stop any running dev server or Electron instance
- [ ] Ensure `~/Projects/personal-finance-hub` scaffold exists (this repo)

## Migration steps

### 1. Dry run (recommended)

```bash
~/Projects/personal-finance-hub/scripts/migrate-from-legacy.sh --dry-run
```

Review the file list. No files are written.

### 2. Copy application tree

```bash
~/Projects/personal-finance-hub/scripts/migrate-from-legacy.sh
```

This rsyncs the legacy app into `apps/finance-hub/`, excluding `node_modules`, `.next`, `.git`, `.env.local`, and build artifacts.

### 3. Preserve git history (optional)

**Option A — keep legacy repo as submodule of history**

After copy, in the umbrella repo:

```bash
cd ~/Projects/personal-finance-hub
git remote add legacy-finance-hub https://github.com/fclaird/finance-hub.git
git fetch legacy-finance-hub
git tag legacy/pre-umbrella legacy-finance-hub/main
```

**Option B — replace `apps/finance-hub` with filtered history**

For full commit history under `apps/finance-hub/`, use `git filter-repo` (one-time, advanced):

```bash
git clone https://github.com/fclaird/finance-hub.git /tmp/finance-hub-filter
cd /tmp/finance-hub-filter
git filter-repo --to-subdirectory-filter apps/finance-hub
# Then merge into personal-finance-hub (manual step — do when ready)
```

### 4. Install and verify

```bash
cd ~/Projects/personal-finance-hub/apps/finance-hub
cp ~/personal-finance-hub/finance-hub/.env.local .env.local   # if not copied (gitignored)
npm install
npm run build
npm run dev
```

Smoke-test:

- [ ] Dashboard loads
- [ ] Schwab connection / sync works
- [ ] SQLite data present (same net worth / holdings as before)
- [ ] Desktop dev starts: `npm run desktop:dev`

### 5. Update local habits

| Before | After |
|--------|-------|
| `cd ~/personal-finance-hub/finance-hub` | `cd ~/Projects/personal-finance-hub/apps/finance-hub` |
| Open legacy folder in Cursor | Open `~/Projects/personal-finance-hub` |
| Push to `fclaird/finance-hub` | Push umbrella repo (new remote TBD) |

### 6. Retire legacy checkout (after confidence period)

```bash
# Optional: rename legacy folder instead of deleting immediately
mv ~/personal-finance-hub ~/personal-finance-hub.archived
```

Archive or mark read-only the old GitHub repo once the new remote is canonical.

## What does NOT migrate

These stay where they are:

- `~/.local/share/finance-hub/` — database and secrets
- `~/Projects/SimulatedDividendPortfolio/` — already a separate repo
- User-level Cursor rules/skills under `~/.cursor/`

## Rollback

If something goes wrong before deleting the legacy tree:

1. Continue using `~/personal-finance-hub/finance-hub/`
2. Delete `~/Projects/personal-finance-hub/apps/finance-hub/` and re-run migration

Runtime data is unchanged either way.

## Post-migration cleanup (finance-hub codebase)

Already done or planned in the legacy app before/at migration:

- Dividend **models** tab removed → logic moved under Dividends tab or SimulatedDividendPortfolio
- Update root `README.md` in `apps/finance-hub` to point at umbrella docs
