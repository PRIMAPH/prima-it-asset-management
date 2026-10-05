-- PRIMA IT Asset Management
-- Inventory Mode - Phase 1
-- Safe additive migration. Existing asset and assignment data is not modified.

CREATE TABLE IF NOT EXISTS inventory_sessions (
  id INT(11) NOT NULL AUTO_INCREMENT,
  inventory_no VARCHAR(50) NOT NULL,
  name VARCHAR(200) NOT NULL,
  scope_type ENUM(
    'All Assets',
    'Department',
    'Location',
    'Category',
    'Custodian'
  ) NOT NULL DEFAULT 'All Assets',
  department_id INT(11) DEFAULT NULL,
  location_id INT(11) DEFAULT NULL,
  category_id INT(11) DEFAULT NULL,
  employee_id INT(11) DEFAULT NULL,
  status ENUM(
    'Draft',
    'In Progress',
    'Completed',
    'Cancelled'
  ) NOT NULL DEFAULT 'Draft',
  remarks TEXT DEFAULT NULL,
  created_by INT(11) DEFAULT NULL,
  started_by INT(11) DEFAULT NULL,
  started_at DATETIME DEFAULT NULL,
  completed_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_inventory_sessions_no (inventory_no),
  KEY idx_inventory_sessions_status (status),
  KEY idx_inventory_sessions_department (department_id),
  KEY idx_inventory_sessions_location (location_id),
  KEY idx_inventory_sessions_category (category_id),
  KEY idx_inventory_sessions_employee (employee_id),
  KEY idx_inventory_sessions_created_by (created_by),
  KEY idx_inventory_sessions_started_by (started_by),
  CONSTRAINT fk_inventory_session_department
    FOREIGN KEY (department_id) REFERENCES departments (id) ON DELETE SET NULL,
  CONSTRAINT fk_inventory_session_location
    FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE SET NULL,
  CONSTRAINT fk_inventory_session_category
    FOREIGN KEY (category_id) REFERENCES asset_categories (id) ON DELETE SET NULL,
  CONSTRAINT fk_inventory_session_employee
    FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE SET NULL,
  CONSTRAINT fk_inventory_session_created_by
    FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_inventory_session_started_by
    FOREIGN KEY (started_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS inventory_items (
  id INT(11) NOT NULL AUTO_INCREMENT,
  inventory_session_id INT(11) NOT NULL,
  asset_id INT(11) NOT NULL,

  expected_location_id INT(11) DEFAULT NULL,
  actual_location_id INT(11) DEFAULT NULL,
  expected_employee_id INT(11) DEFAULT NULL,
  actual_employee_id INT(11) DEFAULT NULL,
  expected_department_id INT(11) DEFAULT NULL,

  expected_location_name VARCHAR(150) DEFAULT NULL,
  expected_custodian_name VARCHAR(150) DEFAULT NULL,
  expected_department_name VARCHAR(100) DEFAULT NULL,
  expected_condition VARCHAR(50) DEFAULT NULL,
  actual_condition VARCHAR(50) DEFAULT NULL,

  verification_status VARCHAR(40) NOT NULL DEFAULT 'Not Yet Checked',
  verification_method VARCHAR(40) DEFAULT NULL,
  label_condition VARCHAR(40) DEFAULT NULL,
  verified_by INT(11) DEFAULT NULL,
  verified_at DATETIME DEFAULT NULL,
  remarks TEXT DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_inventory_item_session_asset (inventory_session_id, asset_id),
  KEY idx_inventory_items_asset (asset_id),
  KEY idx_inventory_items_status (inventory_session_id, verification_status),
  KEY idx_inventory_items_expected_location (expected_location_id),
  KEY idx_inventory_items_actual_location (actual_location_id),
  KEY idx_inventory_items_expected_employee (expected_employee_id),
  KEY idx_inventory_items_actual_employee (actual_employee_id),
  KEY idx_inventory_items_expected_department (expected_department_id),
  KEY idx_inventory_items_verified_by (verified_by),

  CONSTRAINT fk_inv1_item_session
    FOREIGN KEY (inventory_session_id) REFERENCES inventory_sessions (id) ON DELETE CASCADE,
  CONSTRAINT fk_inv1_item_asset
    FOREIGN KEY (asset_id) REFERENCES assets (id),
  CONSTRAINT fk_inv1_item_expected_location
    FOREIGN KEY (expected_location_id) REFERENCES locations (id) ON DELETE SET NULL,
  CONSTRAINT fk_inv1_item_actual_location
    FOREIGN KEY (actual_location_id) REFERENCES locations (id) ON DELETE SET NULL,
  CONSTRAINT fk_inv1_item_expected_employee
    FOREIGN KEY (expected_employee_id) REFERENCES employees (id) ON DELETE SET NULL,
  CONSTRAINT fk_inv1_item_actual_employee
    FOREIGN KEY (actual_employee_id) REFERENCES employees (id) ON DELETE SET NULL,
  CONSTRAINT fk_inv1_item_expected_department
    FOREIGN KEY (expected_department_id) REFERENCES departments (id) ON DELETE SET NULL,
  CONSTRAINT fk_inv1_item_verified_by
    FOREIGN KEY (verified_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
