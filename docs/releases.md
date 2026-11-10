# Application releases

`package.json` is the only application version source. It already contains `1.0.0`; the sidebar displays `v1.0` (patch-zero versions omit the last component). Release notes and notifications use the full semantic version. Nonzero patches display in full, for example `v1.0.1`.

`GET /api/version` returns only the system name, package version, and curated release records. It requires no database access and sends `Cache-Control: no-store`. The Node process reads the deployed package and changelog on startup. The browser fetches them together on navigation, window focus, and every five minutes while visible. No version changes occur on refresh, service restart, or Git pull.

## Preparing an update

This is a buildless application. `public/js/release-notes.js`, `public/changelog.json`, and `services/app-version.js` are required tracked source files, not generated artifacts. Include them, the release validator, and tests in the commit. `npm run check:release` verifies that these files are in the Git index so an untracked local file cannot silently be omitted from a clone. Run this preparation check in the source repository.

Express serves JavaScript from `public` with its JavaScript MIME type. A missing script returns an HTML 404 error; changing MIME headers or adding an empty script does not repair a missing feature. Bump the release-notes script query in `navbar.js` and navbar queries in page HTML when changing the client. Metadata is always requested without caching. A metadata failure leaves navigation usable and offers Retry in the release-notes dialog; a script-load failure offers retry directly in the sidebar.

Choose and run one command in the source checkout:

```powershell
npm version patch --no-git-tag-version
npm version minor --no-git-tag-version
npm version major --no-git-tag-version
```

Use patch for bug fixes, minor for new features, and major for breaking or significant changes. These commands synchronize `package.json` and `package-lock.json`; never run them automatically during deployment.

If PowerShell blocks `npm.ps1`, use `npm.cmd` in place of `npm` without changing the execution policy.

1. Add a record in `public/changelog.json` matching the new package version. Use `date` (`YYYY-MM-DD`), `features`, `improvements`, and `fixes` arrays. Empty arrays are allowed. Keep verified previous records; do not invent history.
2. Set the actual planned release date and describe only confirmed changes. The initial `1.0.0` entry is prepared on 2026-11-09 from existing source and Git history, including direct asset assignment, employee editing/deletion, asset filtering, and the maintenance picker and image-edit fixes. No past release dates are claimed. Confirm its date before production release.
3. Run `npm run check:release` and `node --test tests/app-version.test.cjs`, plus relevant application tests. Commit the package, lockfile, and changelog together.
4. Deploy the reviewed source using your existing deployment procedure. No database migration or record reset is needed for this feature.
5. After the approved deployment, restart the existing Windows service from an elevated PowerShell terminal: `nssm restart PrimaAssetManagement`. This feature does not change HTTPS, port 3001, certificates, or service configuration.
6. Verify `https://<production-host>:3001/api/version` and the sidebar show the deployed version. Use the server's trusted HTTPS certificate. Verify the release notes and existing navigation.

No deployment or service restart is performed by the version feature or its tests.

## Browser notifications

A browser's first visit establishes `prima.lastAcknowledgedVersion` in localStorage without displaying an update notice. A newer version shows a subtle notice once, tracked by `prima.lastNotifiedVersion`; refreshes do not repeat it even if the user did not click. Opening notes or dismissing updates the acknowledged version. Existing modal/dialog and mobile navigation workflows defer the notice; notes never open automatically. Other tabs observe storage changes. Rollbacks do not generate new-version notices. Clearing browser storage resets this baseline. If storage is blocked, version and notes remain available, but persistent update tracking is unavailable.

Release notes remain accessible beneath the logo after dismissal. If metadata is unavailable, navigation continues working without displaying a guessed version. If a deployed version lacks a matching record, its actual version is shown with a notes-unavailable message; the release check prevents this mismatch before deployment.
