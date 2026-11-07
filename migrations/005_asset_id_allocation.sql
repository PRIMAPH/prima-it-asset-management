-- Run against the selected database with ALL asset writers stopped.
-- MAX is used ONLY to seed the counter during migration, never to allocate IDs.
-- Existing assets are not updated. Duplicate IDs cause the UNIQUE step to fail;
-- investigate them rather than deleting or renumbering existing records.
CREATE TABLE IF NOT EXISTS asset_id_counters (
  asset_year SMALLINT UNSIGNED NOT NULL PRIMARY KEY,
  last_number BIGINT UNSIGNED NOT NULL DEFAULT 0
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS asset_creation_requests (
  user_id INT NOT NULL,
  request_id VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  asset_db_id INT NULL,
  asset_id VARCHAR(50) NULL,
  asset_status VARCHAR(50) NULL,
  PRIMARY KEY (user_id, request_id)
) ENGINE=InnoDB;

-- Ensure there is a single-column UNIQUE index, even on older installations.
SET @has_asset_unique = (
  SELECT COUNT(*) FROM (
    SELECT index_name FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'assets' AND non_unique = 0
    GROUP BY index_name
    HAVING COUNT(*) = 1 AND MAX(column_name) = 'asset_id'
  ) AS unique_indexes
);
SET @asset_unique_sql = IF(@has_asset_unique > 0, 'SELECT 1',
  'ALTER TABLE assets ADD UNIQUE KEY uq_assets_asset_id (asset_id)');
PREPARE asset_unique_stmt FROM @asset_unique_sql;
EXECUTE asset_unique_stmt;
DEALLOCATE PREPARE asset_unique_stmt;

INSERT INTO asset_id_counters (asset_year, last_number)
SELECT CAST(SUBSTRING(asset_id, 7, 4) AS UNSIGNED),
       MAX(CAST(SUBSTRING_INDEX(asset_id, '-', -1) AS UNSIGNED))
FROM assets
WHERE asset_id REGEXP '^PRIMA-[0-9]{4}-[0-9]+$'
GROUP BY CAST(SUBSTRING(asset_id, 7, 4) AS UNSIGNED)
ON DUPLICATE KEY UPDATE last_number = GREATEST(last_number, VALUES(last_number));
