# Asset ID allocation and local verification

## Changes

- `public/assets.html`: read-only Asset ID preview above Asset Name, using the existing theme styles and the preview-only notice.
- `public/js/assets.js`: fetch a fresh preview on opening Add; hide the field during Edit; display the server's saved ID in the confirmation. Existing Save disabling, retry key, optional assignment, and uploads are retained.
- `services/asset-id.js`: MySQL formats and allocates the final ID. An InnoDB counter upsert locks the year's row until the caller commits or rolls back. Preview is a read-only query and never creates a counter row or reserves an ID. The year comes from the database session's date; configure the database timezone consistently with the installation.
- `server.js`: authenticated, uncached preview endpoint; manual creation and bulk imports use the same counter. Creation retries with the same user and `creation_request_id` return the stored result. The unique request key serializes concurrent retries in the same transaction as asset creation, assignment, history, and audit. Legacy retry keys are still recognized from existing audit entries.
- `migrations/005_asset_id_allocation.sql`: adds `asset_id_counters` and `asset_creation_requests`, ensures a single-column UNIQUE index on `assets.asset_id`, and seeds counters from existing PRIMA IDs. MAX is used only during this migration, never during runtime allocation. Reapplying cannot lower a counter. No existing asset is updated or deleted.
- Tests cover browser behavior, existing assignment/edit behavior, and real database concurrency.

API clients must reuse `creation_request_id` for retries of the same creation. A new logical asset needs a new key. The browser already does this. Requests without a key remain supported for compatibility but cannot be deduplicated. Keep the request table when backing up/restoring the database; its records deliberately survive asset deletion and audit cleanup so a late retry cannot recreate a deleted asset.

## Apply locally

Migration 005 is now applied to the local development database, prima_asset_management. Both new tables were previously absent, causing ER_NO_SUCH_TABLE and HTTP 500 for preview and creation. Initialization was protected with table locks. All 22 existing asset rows were compared before and after and remained identical. The 2026 counter was seeded at 24; two consecutive HTTP preview requests against this database returned 200 with PRIMA-2026-000025. Production was not accessed or changed.

For another local installation:

1. Stop local application instances and import jobs that write assets.
2. Connect to the **local** MySQL database named by `.env`, using a SQL client. Verify the selected database. Run the contents of `migrations/005_asset_id_allocation.sql` (or `SOURCE migrations/005_asset_id_allocation.sql;` in the MySQL CLI from the repository directory). Do not run old and new asset writers together during migration.
3. Confirm `assets`, `asset_assignments`, `asset_history`, and `audit_logs` use InnoDB. The inspected local database already does. Check `SHOW INDEX FROM assets;` for a unique `asset_id` index.
4. Restart with `npm start`. Open the locally configured application URL and sign in.

The UNIQUE step fails if a legacy database contains duplicates; it does not remove or renumber them. Investigate such data before continuing. All runtime asset writers must use the shared allocator; after restoring an older backup, rerun this migration with writers stopped before restarting the app.

## Automated checks

From PowerShell in the repository:

```powershell
node --test tests/asset-create-assignment.test.cjs tests/asset-edit.test.cjs tests/employee-edit.test.cjs tests/employee-delete.test.cjs
$env:RUN_ASSET_MYSQL_TEST = '1'
node --test tests/asset-id-mysql.test.cjs
Remove-Item Env:RUN_ASSET_MYSQL_TEST
```

The database test only connects to localhost/loopback, reads credentials from `.env`, and requires CREATE/DROP DATABASE permission. It creates a uniquely named scratch database from `database/schema.sql`, runs the migration and tests, then removes only that scratch database. It never changes the application database. `database/schema.sql` is an existing locally supplied file ignored by Git.

Observed results: 14 browser/service regression tests passed, plus the database integration test on local MariaDB 10.4.32 (MySQL-compatible). Oracle MySQL was not available for a separate run. Chromium required execution outside the filesystem sandbox.

The database test uses the actual Express GET/POST route handlers over HTTP with a test-only authenticated user, and verifies HTTP 200 uncached previews, successful POST responses, equal non-consuming previews, sequential saves after those previews, 16 concurrent distinct submissions, 12 concurrent retries producing one record, validation and foreign-key rollback, correction after failure, allocation shared with an import transaction, unchanged existing asset rows, repeatable migration, and database rejection of duplicate IDs. The browser test verifies Loading Asset ID..., Unable to load Asset ID with a working Retry button, reopening without creation, read-only preview, actual saved ID differing from preview, repeated-click protection, retry-key reuse, optional assignment, and absence of a post-save assignment prompt. The existing edit regression covers image uploads/removals and save/reopen persistence.

## Manual verification

1. Open Add New Asset in two signed-in browser sessions before either saves. Both should display the same preview, above Asset Name, with the preview-only notice and existing dark styling.
2. Save in session A, then session B. Confirm each success message shows its actual server-assigned ID; session B's ID should differ from its stale preview.
3. Double-click Save and confirm only one asset appears. Try an empty asset name and confirm none is created.
4. Create an asset with Assign To (Optional), then verify assignment and return. Edit an existing asset and verify its ID stays unchanged.
5. Smoke-test labels, QR/barcode scans, document uploads, inventory, reports, and a small bulk import using disposable local test assets. Those broader flows were not all exercised end-to-end by this change's automated tests.

No production upload or deployment is part of this change.
