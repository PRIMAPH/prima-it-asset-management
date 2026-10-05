-- PRIMA IT Asset Management
-- Inventory Mode - Phase 3
--
-- Additive discrepancy-review fields. Historical snapshot and verification
-- values are preserved; this migration does not update live asset records.

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS review_status VARCHAR(40) DEFAULT NULL
    AFTER remarks,
  ADD COLUMN IF NOT EXISTS reviewed_by INT(11) DEFAULT NULL
    AFTER review_status,
  ADD COLUMN IF NOT EXISTS reviewed_at DATETIME DEFAULT NULL
    AFTER reviewed_by,
  ADD COLUMN IF NOT EXISTS review_remarks TEXT DEFAULT NULL
    AFTER reviewed_at;

-- Existing discrepancy rows begin in the review queue. Matching and unchecked
-- rows remain NULL because there is no discrepancy to review.
UPDATE inventory_items
SET review_status = 'Pending Review'
WHERE review_status IS NULL
  AND (
    verification_status = 'Missing'
    OR location_mismatch = 1
    OR custodian_mismatch = 1
    OR condition_mismatch = 1
    OR label_issue = 1
  );

ALTER TABLE inventory_items
  ADD INDEX IF NOT EXISTS idx_inventory_items_review (
    inventory_session_id,
    review_status
  ),
  ADD INDEX IF NOT EXISTS idx_inventory_items_reviewed_by (reviewed_by);

-- MariaDB does not support IF NOT EXISTS for foreign-key constraints on every
-- supported release, so add it only when INFORMATION_SCHEMA confirms it is
-- absent.
SET @inventory_review_fk_exists = (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'inventory_items'
    AND CONSTRAINT_NAME = 'fk_inv3_item_reviewed_by'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);

SET @inventory_review_fk_sql = IF(
  @inventory_review_fk_exists = 0,
  'ALTER TABLE inventory_items ADD CONSTRAINT fk_inv3_item_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES users (id) ON DELETE SET NULL',
  'SELECT 1'
);

PREPARE inventory_review_fk_statement FROM @inventory_review_fk_sql;
EXECUTE inventory_review_fk_statement;
DEALLOCATE PREPARE inventory_review_fk_statement;
