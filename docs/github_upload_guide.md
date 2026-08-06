# GitHub Upload Guide

## First time — create the repo and push

```bash
# 1. Unzip the project (if it isn't already a folder on disk)
cd maa-kali-b2b

# 2. Initialize git (skip if already a repo)
git init
git branch -M main

# 3. Confirm .env.local is NOT tracked (it must never be committed)
git status
# .env.local should NOT appear — .gitignore already excludes it

# 4. Stage and commit everything
git add .
git commit -m "Phase 1: auth, role-based routing, layouts, Supabase schema"

# 5. Create the repo on GitHub (via web UI, or gh CLI if installed)
gh repo create maa-kali-b2b --private --source=. --remote=origin
# — or, if you created the repo on github.com first —
git remote add origin https://github.com/<your-username>/maa-kali-b2b.git

# 6. Push
git push -u origin main
```

## Verify before pushing

- [ ] `.env.local` does not appear in `git status` or `git log`
- [ ] `node_modules/` and `.next/` are not tracked (already in `.gitignore`)
- [ ] No real Supabase keys are hardcoded anywhere in the source — only in `.env.local` (untracked) and Vercel's environment variable settings

## Subsequent changes

```bash
git add .
git commit -m "Describe what changed"
git push
```

Pushing to `main` triggers an automatic Vercel production deploy (once connected — see `docs/deployment_guide.md`). For anything you're not sure about, push to a branch and open a Pull Request first — Vercel will build a Preview deployment for it automatically.

## Recommended repo settings

- Make the repo **private** — this is a real business's operational codebase, not an open-source project.
- Enable **branch protection** on `main` once more than one person is committing (require PR review before merge).
- Add collaborators with the least privilege they need (e.g., a contractor gets write access to a feature branch workflow, not direct push to `main`).
