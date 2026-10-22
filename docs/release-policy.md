# KITS-AKSHAR-EOS — Semantic Versioning & Release Policy

## 1. Overview & Architecture

KITS-EOS follows **Semantic Versioning 2.0.0** (`MAJOR.MINOR.PATCH`).
The **root `package.json`** serves as the single authoritative source of truth for the platform's product version.

During build execution across the monorepo, `scripts/versionPlugin.mts` dynamically resolves this authoritative version, validates strict semantic syntax, generates compile-time constants (`__APP_VERSION__`, `__APP_BUILD_ID__`, `__APP_BUILT_AT__`), and emits `/version.json` for all three frontends:
- `apps/public-student`
- `apps/admin-coordinator`
- `apps/fallback`

---

## 2. Versioning Semantics

Given a version number `MAJOR.MINOR.PATCH`:

1. **PATCH (`3.0.x`)**:
   - Backward-compatible bug fixes, styling corrections, hotfixes, or performance tuning.
   - Example: Fixing an update prompt bug, patching an attendance scanner glitch, or updating button styling (`3.0.0` → `3.0.1`).
2. **MINOR (`3.x.0`)**:
   - Backward-compatible features, new sub-event capabilities, or schema additions that do not break client contracts.
   - Example: Introducing bulk registration downloads, live assessment leaderboards, or new report export formats (`3.0.0` → `3.1.0`).
3. **MAJOR (`x.0.0`)**:
   - Incompatible architectural shifts, breaking RPC/database schema overhauls, or brand new institutional platform generations.
   - Example: Moving from KITS-EOS Generation 3 to Generation 4 (`3.x.x` → `4.0.0`).

---

## 3. Semantic Versions vs. Build Identifiers

- **Semantic Version (`version`)**: Represents deliberate, public, human-meaningful product releases. It is **never** incremented automatically on arbitrary CI rebuilds or local runs.
- **Build Identifier (`buildId`)**: A unique timestamp string (`Date.now()`, e.g. `1792642572626`) generated at build time. Build IDs serve strictly operational functions:
  - Cache-busting service worker script bytes (`dist/sw.js`).
  - Distinguishing individual deployment bundles on edge CDNs.
  - Tracking anti-loop reload protection (`canSafelyReload`).
  - Scoping deferral state so new deployments prompt users cleanly.

---

## 4. Release Procedure (Step-by-Step)

When the engineering team approves a new release:

### Step 1: Bump Authoritative Version
Update the `"version"` field in the root [package.json](file:///c:/Users/PRASANTH/Desktop/KITS-EOS-V3/package.json):
```json
{
  "name": "kits-eos-v3",
  "version": "3.0.1"
}
```

### Step 2: Synchronize Child Application Packages
Synchronize the child applications:
- `apps/public-student/package.json` → `"version": "3.0.1"`
- `apps/admin-coordinator/package.json` → `"version": "3.0.1"`
- `apps/fallback/package.json` → `"version": "3.0.1"`

*(Note: Internal library packages like `packages/shared` maintain independent package lifecycles unless affected by breaking shared changes).*

### Step 3: Run Validation & Build Gates
Execute the comprehensive test suite and production compile:
```bash
# 1. Typecheck project references
npm run typecheck

# 2. Run automated test suite
npx vitest run

# 3. Compile production bundles
npm run build
```

### Step 4: Verify Output Manifests
Verify that `dist/version.json` in each application output directory reflects the new version:
- `apps/public-student/dist/version.json`
- `apps/admin-coordinator/dist/version.json`
- `apps/fallback/dist/version.json`

Each manifest must contain:
```json
{
  "version": "3.0.1",
  "buildId": "<unique-timestamp>",
  "builtAt": "<iso-timestamp>"
}
```

### Step 5: Commit and Create Annotated Git Tag
Once verified, stage, commit, and create an annotated Git tag:
```bash
git add package.json apps/*/package.json
git commit -m "chore(release): bump product version to v3.0.1"
git tag -a v3.0.1 -m "Release v3.0.1: KITS-EOS Production Release"
```

### Step 6: Deploy to Firebase Hosting
Deploy all targets or specific targets:
```bash
firebase deploy --only hosting
```
