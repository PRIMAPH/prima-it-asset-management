-- PRIMA IT Asset Management
-- Inventory Mode - Phase 2
--
-- Additive migration for discrepancy recording and inventory completion.
-- Phase 1 snapshot rows and the unique (session, asset) constraint are preserved.
-- The IF NOT EXISTS clauses make the structural additions safe to rerun on MariaDB.

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS actual_location_name VARCHAR(150) DEFAULT NULL
    AFTER actual_location_id,
  ADD COLUMN IF NOT EXISTS actual_custodian_name VARCHAR(150) DEFAULT NULL
    AFTER actual_employee_id,
  ADD COLUMN IF NOT EXISTS location_mismatch TINYINT(1) NOT NULL DEFAULT 0
    AFTER label_condition,
  ADD COLUMN IF NOT EXISTS custodian_mismatch TINYINT(1) NOT NULL DEFAULT 0
    AFTER location_mismatch,
  ADD COLUMN IF NOT EXISTS condition_mismatch TINYINT(1) NOT NULL DEFAULT 0
    AFTER custodian_mismatch,
  ADD COLUMN IF NOT EXISTS label_issue TINYINT(1) NOT NULL DEFAULT 0
    AFTER condition_mismatch,
  ADD COLUMN IF NOT EXISTS missing_marked_at DATETIME DEFAULT NULL
    AFTER verified_at;

-- Phase 1 "Verified" rows represented a perfect match. Copy their frozen
-- expected observations into the new actual-value fields without changing
-- their result, verifier, or timestamps.
UPDATE inventory_items
SET
  actual_location_id = expected_location_id,
  actual_location_name = expected_location_name,
  actual_employee_id = expected_employee_id,
  actual_custodian_name = expected_custodian_name,
  actual_condition = expected_condition,
  label_condition = 'Good',
  location_mismatch = 0,
  custodian_mismatch = 0,
  condition_mismatch = 0,
  label_issue = 0
WHERE verification_status = 'Verified'
  AND actual_condition IS NULL;

ALTER TABLE inventory_items
  ADD INDEX IF NOT EXISTS idx_inventory_items_discrepancies (
    inventory_session_id,
    location_mismatch,
    custodian_mismatch,
    condition_mismatch,
    label_issue
  );
