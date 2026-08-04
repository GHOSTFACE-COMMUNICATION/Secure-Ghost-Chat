---
name: GitHub remote is an unrelated history
description: How the Secure-Ghost-Chat GitHub repo relates to this workspace and how to move code between them
---

The `subrepl-0tezk6nl` remote (github.com/ghostzeronz-coder/Secure-Ghost-Chat) has a **completely unrelated git history** from this workspace — `git merge` refuses without `--allow-unrelated-histories`. It is the user's device-build lineage (EAS builds, Render-hosted backend) and keeps evolving independently.

**Why:** it was seeded as a fresh baseline, not forked from this workspace's history.

**How to apply:** never plain-pull or reset. Move features across with `git cherry-pick -n <sha>` (works because blobs enable 3-way merge) or `git show <remote>/main:<path>` for new files, then resolve conflicts by hand. In Aug 2026 five features were ported this way (decoy PIN, GHOSTPAD, reactions/v4 sealed envelope, device integrity, call-push scaffold); the outbox/SMS-fallback libs were already identical on both sides. The sealed envelope is now v4 (ttlMs `x`, sender message id `i`, reaction `r`); conversations persist encrypted-at-rest via lib/secureStorage.
