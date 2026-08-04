---
name: APNs credential debugging
description: How to diagnose APNs VoIP credential failures (parse errors vs InvalidProviderToken) and pitfalls when users upload keys via the secrets form.
---

Durable lessons:

- Users paste the wrong thing into secrets forms constantly: bare base64 key
  bodies, key file *names*, CSRs, Team IDs into Key ID fields, and the key body
  into every field of a multi-field form. The sender now tolerates bare-base64
  key bodies (auto-wraps into PKCS#8 PEM) and Key IDs pasted as
  `AuthKey_XXXX.p8` filenames. Always verify shape server-side (length,
  BEGIN header, `createPrivateKey` parse) before restarting.
- `createPrivateKey` failure = malformed paste. `403 InvalidProviderToken` =
  key/KeyID/TeamID trio not recognized by Apple — key parse success proves
  nothing about validity. A fresh key sometimes fixes it even when the old
  key "should" work.
- Fast triage: sign an ES256 JWT and POST to
  `api.sandbox.push.apple.com/3/device/<64 zeros>` directly.
  `BadDeviceToken` = credentials good; `InvalidProviderToken` = trio bad.

**How to apply:** if iOS native ring pushes report `error`, use
`POST /api/admin/test-ring-push` (x-admin-secret header, requires
`ADMIN_SECRET`) to see per-token results; check server logs for the APNs
`reason`. "bad-token" auto-prunes the stale token — expected behavior.
