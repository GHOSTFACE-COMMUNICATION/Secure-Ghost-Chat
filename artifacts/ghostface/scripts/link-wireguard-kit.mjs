#!/usr/bin/env node
// Wires WireGuard's official Swift Package (wireguard-apple) into the
// network-packet-tunnel extension, adapted from the manual steps in
// https://github.com/WireGuard/wireguard-apple's README "WireGuardKit
// integration" section -- WireGuardKit links against a Go-based core
// (wireguard-go-bridge) that SPM cannot build automatically, so:
//   1. Link the WireGuardKit product to both the extension AND the main app.
//   2. Create a target that runs `make` against Sources/WireGuardKitGo in
//      the resolved SPM checkout. The README says to use an "External
//      Build System" target (PBXLegacyTarget) -- that failed to spawn
//      `make` at all here (see ensureGoBridgeTarget's comment), so this
//      uses a PBXAggregateTarget + Run Script build phase instead, which
//      accomplishes the same thing through a more common code path.
//   3. Make the extension target depend on that target.
// It also links native/vpn-tunnel/ (the VPNTunnelModule RN native module
// that drives NETunnelProviderManager from the main app) into the GHOSTFACE
// target -- see ensureNativeBridgeModuleLinked's comment.
//
// This is NOT a config plugin. @bacons/apple-targets has no declarative way
// to add a Swift Package Manager dependency to a target (see its README),
// and its own plugin creates every targets/* target AND seals its custom
// "xcodeProjectBeta2" mod's provider in one atomic function call -- there is
// no config-plugin mod-ordering (typed, dangerous, or otherwise) that runs
// after that target exists on disk but before the next `expo prebuild`
// finishes. Both a same-slot action and a `withDangerousMod` were tried and
// both saw a pre-target-creation snapshot of project.pbxproj.
//
// So this runs as a plain post-prebuild step instead, operating on the
// fully-finished ios/ directory:
//
//   npx expo prebuild -p ios --clean && node scripts/link-wireguard-kit.mjs
//
// Requires a local Go toolchain (`brew install go`) for the actual `make`
// build to succeed -- this script only wires the Xcode project graph, it
// doesn't build anything itself. Idempotent -- safe to run multiple times
// or after every prebuild.
import {
  XcodeProject,
  XCRemoteSwiftPackageReference,
  XCSwiftPackageProductDependency,
  PBXAggregateTarget,
  PBXShellScriptBuildPhase,
  PBXFileSystemSynchronizedRootGroup,
} from "@bacons/xcode";
import * as xcodeParse from "@bacons/xcode/json";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

// Pinned to our own fork, not the official repo: upstream's Package.swift
// (both on GitHub and the true upstream git.zx2c4.com) currently declares
// swift-tools-version:5.3 while using PackageDescription 5.5 APIs
// (.macOS(.v12), .iOS(.v15)), which modern Xcode refuses to resolve at all
// ("'v12'/'v15' is unavailable"). Our fork carries a one-line fix bumping
// the version declaration to match -- no other changes. If upstream ever
// fixes this, switch back to WireGuard/wireguard-apple directly.
const WIREGUARD_REPO_URL = "https://github.com/ghostzeronz-coder/wireguard-apple";
const WIREGUARD_PRODUCT_NAME = "WireGuardKit";
// The targets/network-packet-tunnel directory name gets hyphens stripped
// when @bacons/apple-targets derives the actual Xcode target name from it.
const EXTENSION_TARGET_NAME = "networkpackettunnel";
const MAIN_APP_TARGET_NAME = "GHOSTFACE";
// Name of the old, now-removed PBXLegacyTarget ("External Build System")
// approach -- kept only so ensureGoBridgeTarget can clean up a stale one
// from an earlier run of this script. See ensureGoBridgeTarget's comment.
const LEGACY_TARGET_NAME = "WireGuardGoBridgeiOS";
const GO_BRIDGE_TARGET_NAME = "WireGuardGoBridge";
// Folder name under native/ (sibling of ios/ and targets/, so it survives
// `expo prebuild --clean`) holding the VPNTunnelModule RN native module.
const NATIVE_BRIDGE_MODULE_DIR = "vpn-tunnel";
// The real make binary, not /usr/bin/make -- that path is actually an
// xcode-select shim (com.apple.dt.xcode_select.tool-shim-public), and both
// it and its concrete `xcrun --find make` target failed to spawn under
// ExternalBuildToolExecution on this machine. Still used here since a
// Run Script build phase's /bin/sh has no such issue -- kept concrete
// (not the shim) anyway since it's marginally more predictable.
const GO_BRIDGE_BUILD_TOOL_PATH = "/Applications/Xcode.app/Contents/Developer/usr/bin/make";
// The official README locates the SPM checkout via
// `${BUILD_DIR%Build/*}SourcePackages/checkouts/...` -- that only works
// when BUILD_DIR follows Xcode's default DerivedData layout
// (.../DerivedData/<Name>/Build/Products/<config>). This project's Podfile
// (via Expo/CocoaPods convention) overrides BUILD_DIR/SYMROOT/OBJROOT to a
// plain `ios/build` path with no "Build/" segment at all, so that string
// substitution silently no-ops and produces a nonsense concatenated path
// ("...iosbuildSourcePackages/..."). SPM's actual checkout still lands in
// the standard per-project DerivedData location regardless of that
// override (checkout placement is controlled by Xcode's package manager
// subsystem, not BUILD_DIR) -- so locate it dynamically instead of trying
// to derive it from a build setting that doesn't reflect where it is.
// `ls -dt` picks the most-recently-modified match in case multiple stale
// DerivedData folders exist for this project (e.g. from prior `expo
// prebuild --clean` regenerations, which change Xcode's DerivedData hash).
const GO_BRIDGE_SHELL_SCRIPT = `set -e
# Locate the SPM checkout. The standard per-project DerivedData path covers
# local builds; EAS sets a custom derived-data location, so fall back to
# searching under DERIVED_DATA_DIR/BUILD_DIR when the usual path misses.
BRIDGE_DIR=$(ls -dt "$HOME"/Library/Developer/Xcode/DerivedData/"$PROJECT_NAME"-*/SourcePackages/checkouts/wireguard-apple/Sources/WireGuardKitGo 2>/dev/null | head -1)
if [ -z "$BRIDGE_DIR" ]; then
  for ROOT in "\${DERIVED_DATA_DIR:-}" "\${BUILD_DIR:-}" "\${SRCROOT:-}/.."; do
    [ -n "$ROOT" ] || continue
    BRIDGE_DIR=$(find "$ROOT" -type d -path "*/checkouts/wireguard-apple/Sources/WireGuardKitGo" 2>/dev/null | head -1)
    [ -n "$BRIDGE_DIR" ] && break
  done
fi
if [ -z "$BRIDGE_DIR" ]; then
  echo "error: [link-wireguard-kit] could not locate the wireguard-apple SPM checkout for project $PROJECT_NAME -- has the package been resolved yet (xcodebuild -resolvePackageDependencies)?" >&2
  exit 1
fi

# Go is needed to build wireguard-go-bridge. Xcode Run Script phases get a
# minimal PATH that excludes Homebrew, so add the usual prefixes explicitly
# (Apple Silicon and Intel) before looking.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v go >/dev/null 2>&1; then
  echo "error: [link-wireguard-kit] Go is not on PATH. WireGuardKit's wireguard-go-bridge cannot be built without it. Locally: brew install go. On EAS: the eas-build-pre-install hook (scripts/eas-install-go.sh) is responsible for this." >&2
  exit 1
fi

# Prefer make from PATH; fall back to Xcode's bundled copy. The hardcoded
# /Applications/Xcode.app path does not hold on EAS, whose images use
# versioned Xcode_*.app directories.
MAKE_BIN=$(command -v make || echo "${GO_BRIDGE_BUILD_TOOL_PATH}")

cd "$BRIDGE_DIR"
"$MAKE_BIN"
`;

async function findPbxprojPath() {
  const iosDir = path.join(projectRoot, "ios");
  const entries = await fs.readdir(iosDir, { withFileTypes: true });
  const xcodeprojDir = entries.find((e) => e.isDirectory() && e.name.endsWith(".xcodeproj"));
  if (!xcodeprojDir) {
    throw new Error(`link-wireguard-kit: no .xcodeproj found in ${iosDir} -- run "npx expo prebuild -p ios" first.`);
  }
  return path.join(iosDir, xcodeprojDir.name, "project.pbxproj");
}

function findTarget(project, name) {
  return (project.rootObject.props.targets || []).find((t) => t.props && t.props.name === name);
}

function ensurePackageReference(project) {
  let pkgRef = (project.rootObject.props.packageReferences || []).find(
    (p) => p.props && p.props.repositoryURL === WIREGUARD_REPO_URL,
  );
  if (pkgRef) {
    console.log("[link-wireguard-kit] Package reference already present, reusing it.");
    return pkgRef;
  }
  pkgRef = XCRemoteSwiftPackageReference.create(project, {
    repositoryURL: WIREGUARD_REPO_URL,
    // Tracking the official repo's default branch rather than pinning a
    // semver tag -- wireguard-apple doesn't publish frequent SPM version
    // tags, its Package.swift is consumed straight from source.
    requirement: { kind: "branch", branch: "master" },
  });
  project.rootObject.props.packageReferences = [...(project.rootObject.props.packageReferences || []), pkgRef];
  console.log(`[link-wireguard-kit] Added package reference: ${WIREGUARD_REPO_URL}`);
  return pkgRef;
}

function ensureProductLinked(project, target, pkgRef) {
  const alreadyLinked = (target.props.packageProductDependencies || []).some(
    (d) => d.props && d.props.productName === WIREGUARD_PRODUCT_NAME,
  );
  if (alreadyLinked) {
    console.log(`[link-wireguard-kit] ${WIREGUARD_PRODUCT_NAME} already linked to "${target.props.name}", nothing to do.`);
    return;
  }
  const productDep = XCSwiftPackageProductDependency.create(project, {
    package: pkgRef,
    productName: WIREGUARD_PRODUCT_NAME,
  });
  target.props.packageProductDependencies = [...(target.props.packageProductDependencies || []), productDep];
  target.getFrameworksBuildPhase().createFile({ productRef: productDep });
  console.log(`[link-wireguard-kit] Linked ${WIREGUARD_PRODUCT_NAME} to target "${target.props.name}".`);
}

function ensureGoBridgeTarget(project) {
  // Originally a PBXLegacyTarget ("External Build System" in Xcode's UI),
  // matching the official README exactly. That failed to spawn `make` at
  // all under xcodebuild's ExternalBuildToolExecution on this machine
  // ("unable to spawn process ... No such file or directory") even though
  // the exact same binary runs fine from a normal shell -- true for both
  // the /usr/bin/make xcode-select shim AND the concrete toolchain path
  // resolved via `xcrun --find make`. ExternalBuildToolExecution is a
  // rarely-used, long-deprecated Xcode mechanism; plausible this specific
  // pre-release macOS/Xcode combination has a real bug in it.
  //
  // Switched to a PBXAggregateTarget + Run Script build phase instead --
  // the same mechanism every other native module in this app's Podfile
  // already uses for its own script phases (see the "[CP-User]" phases in
  // any `expo run:ios` log), so it's a well-exercised code path rather
  // than a legacy one.
  removeStaleLegacyTarget(project);

  let bridgeTarget = findTarget(project, GO_BRIDGE_TARGET_NAME);
  if (bridgeTarget) {
    const scriptPhase = bridgeTarget.getBuildPhase(PBXShellScriptBuildPhase);
    if (scriptPhase) scriptPhase.props.shellScript = GO_BRIDGE_SHELL_SCRIPT;
    console.log(`[link-wireguard-kit] "${GO_BRIDGE_TARGET_NAME}" target already present, re-synced its build script.`);
    return bridgeTarget;
  }

  bridgeTarget = PBXAggregateTarget.create(project, {
    name: GO_BRIDGE_TARGET_NAME,
    productName: GO_BRIDGE_TARGET_NAME,
    buildPhases: [],
    buildRules: [],
    dependencies: [],
  });

  bridgeTarget.createConfigurationList({ defaultConfigurationName: "Release" }, [
    { name: "Debug", buildSettings: { PRODUCT_NAME: GO_BRIDGE_TARGET_NAME, SDKROOT: "iphoneos" } },
    { name: "Release", buildSettings: { PRODUCT_NAME: GO_BRIDGE_TARGET_NAME, SDKROOT: "iphoneos" } },
  ]);

  bridgeTarget.createBuildPhase(PBXShellScriptBuildPhase, {
    name: "Build WireGuardKitGo (make)",
    inputPaths: [],
    outputPaths: [],
    shellPath: "/bin/sh",
    shellScript: GO_BRIDGE_SHELL_SCRIPT,
  });

  project.rootObject.props.targets = [...(project.rootObject.props.targets || []), bridgeTarget];
  console.log(`[link-wireguard-kit] Created "${GO_BRIDGE_TARGET_NAME}" (aggregate target, Run Script phase invokes make against WireGuardKitGo).`);
  return bridgeTarget;
}

// Xcode's Explicit Modules build path (CLANG_ENABLE_EXPLICIT_MODULES /
// SWIFT_ENABLE_EXPLICIT_MODULES, on by default in recent Xcode) hits a
// non-deterministic "module file '.../ExplicitPrecompiledModules/
// _DarwinFoundation2-<hash>.pcm' not found" fatal error when compiling
// WireGuardKitC/WireGuardKitGo's C sources on this machine (stable Xcode
// 26.6 on pre-release macOS 27 -- Homebrew itself flags this OS as
// unsupported, and this looks like the same class of bug).
//
// Set here at the project level for GHOSTFACE.xcodeproj's own targets (the
// main app and the networkpackettunnel extension) as defense in depth, but
// -- confirmed empirically -- this does NOT reach the WireGuardKit SPM
// package graph: Xcode builds resolved Swift Packages as a separate
// synthesized project and does not inherit arbitrary build settings from
// the consuming .xcodeproj. A project.pbxproj-only version of this fix
// still failed with the exact same .pcm error on WireGuardKitC's sources.
// The only thing that has actually worked is passing both flags as
// xcodebuild COMMAND-LINE overrides, which apply to the whole build graph
// including packages -- see the `ios:sim:build` script in package.json for
// the local Simulator build wrapper that does this.
function ensureExplicitModulesDisabled(project) {
  const configs = project.rootObject.props.buildConfigurationList?.props.buildConfigurations || [];
  for (const config of configs) {
    config.props.buildSettings.CLANG_ENABLE_EXPLICIT_MODULES = "NO";
    config.props.buildSettings.SWIFT_ENABLE_EXPLICIT_MODULES = "NO";
  }
  console.log("[link-wireguard-kit] Disabled Explicit Modules at the project level (does not cover the SPM package graph -- see package.json's ios:sim:build for the actual local-build workaround).");
}

// Adds native/vpn-tunnel/ (VPNTunnelModule.swift + .m) to the main app
// target as a "synchronized group" (Xcode 16's folder-reference mechanism,
// already used by @bacons/apple-targets for targets/network-packet-tunnel/
// -- see the PBXFileSystemSynchronizedRootGroup section it generates) rather
// than individual PBXFileReference/PBXBuildFile entries in the classic
// Sources build phase. This is simpler (one group, not one entry per file)
// and means future edits to those two files never need this script re-run --
// same benefit @bacons/apple-targets gets for extension target code.
// Coexists fine with GHOSTFACE's existing classic Sources build phase; Xcode
// supports mixing both membership mechanisms on one target.
function ensureNativeBridgeModuleLinked(project, mainAppTarget) {
  const alreadyLinked = (mainAppTarget.props.fileSystemSynchronizedGroups || []).some(
    (g) => g.props && g.props.path === `../native/${NATIVE_BRIDGE_MODULE_DIR}`,
  );
  if (alreadyLinked) {
    console.log(`[link-wireguard-kit] native/${NATIVE_BRIDGE_MODULE_DIR}/ already linked to "${mainAppTarget.props.name}", nothing to do.`);
    return;
  }

  const group = PBXFileSystemSynchronizedRootGroup.create(project, {
    path: `../native/${NATIVE_BRIDGE_MODULE_DIR}`,
    sourceTree: "<group>",
    explicitFileTypes: {},
    explicitFolders: [],
  });

  project.rootObject.props.mainGroup.props.children = [
    ...(project.rootObject.props.mainGroup.props.children || []),
    group,
  ];
  mainAppTarget.props.fileSystemSynchronizedGroups = [
    ...(mainAppTarget.props.fileSystemSynchronizedGroups || []),
    group,
  ];

  console.log(`[link-wireguard-kit] Linked native/${NATIVE_BRIDGE_MODULE_DIR}/ into "${mainAppTarget.props.name}" as a synchronized group.`);
}

function removeStaleLegacyTarget(project) {
  const stale = findTarget(project, LEGACY_TARGET_NAME);
  if (!stale) return;
  stale.removeFromProject();
  project.rootObject.props.targets = (project.rootObject.props.targets || []).filter((t) => t.uuid !== stale.uuid);
  // removeFromProject() strips the removed target's uuid out of anything
  // referencing it, but leaves the now-broken PBXTargetDependency/
  // PBXContainerItemProxy objects themselves in place (e.g. still in some
  // other target's `dependencies` array) with an undefined `targetProxy` --
  // AbstractTarget.getDependencyForTarget crashes on those
  // ("Cannot read properties of undefined (reading 'uuid')") the next time
  // anything calls addDependency. Drop any dependency entry left in that
  // broken state.
  for (const target of project.rootObject.props.targets || []) {
    if (!target.props.dependencies) continue;
    const ok = [];
    const broken = [];
    for (const dep of target.props.dependencies) {
      (dep.props.targetProxy && dep.props.target ? ok : broken).push(dep);
    }
    target.props.dependencies = ok;
    // Filtering them out of the target's array isn't enough -- the objects
    // themselves are still registered in the project's own object map
    // (XcodeProject extends Map, nothing removes an object from it besides
    // an explicit delete) and project.toJSON() serializes every object in
    // that map, broken or not.
    for (const dep of broken) {
      if (dep.props.targetProxy?.uuid) project.delete(dep.props.targetProxy.uuid);
      project.delete(dep.uuid);
    }
  }
  console.log(`[link-wireguard-kit] Removed stale "${LEGACY_TARGET_NAME}" (External Build System) target.`);
}

async function main() {
  const pbxprojPath = await findPbxprojPath();
  const project = XcodeProject.open(pbxprojPath);

  const extensionTarget = findTarget(project, EXTENSION_TARGET_NAME);
  if (!extensionTarget) {
    // Guard, not a normal path: today every profile generates the extension,
    // so this should not fire. It exists because a config that drops
    // @bacons/apple-targets (as the briefly-lived 1.0.2 VPN cut did) leaves
    // this script throwing on a project that is otherwise perfectly valid,
    // turning a deliberate configuration choice into an opaque post-install
    // failure. Everything below -- the WireGuardKit package reference, the Go
    // bridge target, native/vpn-tunnel/ -- exists only to serve that
    // extension, so with it absent the right answer is to do nothing rather
    // than fail. A missing MAIN app target still throws below: that is a real
    // error, not a configuration choice.
    if (process.env.EAS_BUILD_PROFILE === "production") {
      console.log(
        `[link-wireguard-kit] "${EXTENSION_TARGET_NAME}" not present under EAS_BUILD_PROFILE=production -- nothing to link, skipping.`,
      );
      return;
    }
    throw new Error(
      `link-wireguard-kit: could not find the "${EXTENSION_TARGET_NAME}" target in ${pbxprojPath} -- make sure targets/network-packet-tunnel exists and "expo prebuild" completed successfully.`,
    );
  }
  const mainAppTarget = findTarget(project, MAIN_APP_TARGET_NAME);
  if (!mainAppTarget) {
    throw new Error(`link-wireguard-kit: could not find the main app target "${MAIN_APP_TARGET_NAME}" in ${pbxprojPath}.`);
  }

  const pkgRef = ensurePackageReference(project);
  // Per the official README: WireGuardKit must be linked to BOTH the
  // network extension (where the tunnel actually runs) and the main app
  // (which builds/saves the NETunnelProviderManager configuration).
  ensureProductLinked(project, extensionTarget, pkgRef);
  ensureProductLinked(project, mainAppTarget, pkgRef);

  const bridgeTarget = ensureGoBridgeTarget(project);
  extensionTarget.addDependency(bridgeTarget);
  console.log(`[link-wireguard-kit] "${EXTENSION_TARGET_NAME}" now depends on "${GO_BRIDGE_TARGET_NAME}".`);

  ensureExplicitModulesDisabled(project);
  ensureNativeBridgeModuleLinked(project, mainAppTarget);

  const contents = xcodeParse.build(project.toJSON());
  await fs.writeFile(pbxprojPath, contents);
  console.log(`[link-wireguard-kit] Wrote ${pbxprojPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
