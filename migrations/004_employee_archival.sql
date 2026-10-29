-- Additive migration; run against the intended database before starting the updated app.
-- Existing employee, asset, assignment and history records are not changed.
SET @employee_delete_sql = IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'employees' AND COLUMN_NAME = 'deleted_at'),
  'SELECT 1', 'ALTER TABLE employees ADD COLUMN deleted_at DATETIME NULL DEFAULT NULL');
PREPARE employee_delete_stmt FROM @employee_delete_sql;
EXECUTE employee_delete_stmt;
DEALLOCATE PREPARE employee_delete_stmt;

-- Already present in current installations; included for older database/schema.sql installs.
SET @employee_delete_sql = IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'asset_assignments' AND COLUMN_NAME = 'return_remarks'),
  'SELECT 1', 'ALTER TABLE asset_assignments ADD COLUMN return_remarks TEXT NULL');
PREPARE employee_delete_stmt FROM @employee_delete_sql;
EXECUTE employee_delete_stmt;
DEALLOCATE PREPARE employee_delete_stmt;
