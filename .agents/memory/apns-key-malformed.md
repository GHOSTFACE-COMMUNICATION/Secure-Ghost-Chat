---
name: Dev APNS_VOIP_KEY is malformed
description: The APNS_VOIP_KEY secret in this workspace fails Node createPrivateKey ("DECODER routines::unsupported"), so APNs VoIP sends throw/report "error".
---

The `APNS_VOIP_KEY` secret currently stored in the workspace is not a valid PEM
that Node's `createPrivateKey` can parse — attempts to sign the APNs provider
JWT fail with `error:1E08010C:DECODER routines::unsupported`.

**Why:** discovered while smoke-testing `/admin/test-ring-push` (Aug 2026). Any
APNs VoIP ring push will report per-token `error` until the user re-uploads a
valid `.p8` key (literal `\n` escapes are already handled by the sender).

**How to apply:** if iOS native ring pushes report `error`, suspect this secret
first; use `POST /api/admin/test-ring-push` (x-admin-secret header, requires
`ADMIN_SECRET`) to verify per-token results without a second phone.
