# wireguard-apple — vendored

Upstream: https://github.com/WireGuard/wireguard-apple
Vendored at commit `2fec12a6e1f6e3460b6ee483aa00ad29cddadab1`, 2 September 2026.

## The only change from upstream

`Package.swift` line 1: `swift-tools-version:5.3` → `5.5`.

Upstream declares tools version 5.3 while using PackageDescription 5.5 APIs
(`.macOS(.v12)`, `.iOS(.v15)`), which modern Xcode refuses to resolve at all —
it fails with "'v12'/'v15' is unavailable". That is the whole fork. Diff it
against upstream and you should see one line.

`WireGuard.xcodeproj` was dropped: it builds upstream's own standalone app,
which this project does not use, and it referenced targets not vendored here.

## Why it is vendored rather than fetched

It used to be an `XCRemoteSwiftPackageReference` pointing at a personal GitHub
fork. On 2 Sep 2026 that fork's owner account moved to an organisation, the old
URL began returning 404, and **every iOS build failed** at
`xcodebuild: error: Could not resolve package dependencies`.

That is a bad failure mode for this dependency in particular. `WireGuardKit` is
compiled into the VPN **network extension**, and `scripts/link-wireguard-kit.mjs`
runs `make` on `Sources/WireGuardKitGo` during the build. A remote URL meant a
third party's Swift and Go, and their makefile, could enter this app's binary if
that namespace ever changed hands. During the same incident a placeholder edit
briefly pointed the URL at `github.com/OWNER/wireguard-apple` — and
`github.com/OWNER` turned out to be a **real organisation**. Nothing was pulled,
because that repo does not exist, but the pointer was live.

Vendoring removes the remote entirely: the source that gets compiled is the
source in this repository, reviewable in the diff, and it cannot change because
someone renamed an account.

## What this does NOT pin

`Sources/WireGuardKitGo` still builds with `go build` against `go.mod` /
`go.sum`, so the Go dependencies are fetched at build time. They are
checksum-pinned by `go.sum`, which is materially stronger than an unpinned
branch reference, but it is not the same as vendored source. Vendoring the Go
module cache too is the next step if the external audit wants it.

## Updating

Re-copy from upstream, reapply the one-line tools-version bump, update the
commit hash above, and diff to confirm nothing else moved.
