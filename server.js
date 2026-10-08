require('dotenv').config();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const express = require('express');
const session = require('express-session');
const { Server: SocketIOServer } = require('socket.io');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise'); 
const XLSX = require('xlsx');
const nodemailer = require('nodemailer');


const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024
  }
});

const backupUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 1
  }
});

const app = express();
const PORT = Number(process.env.PORT || 3001);

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'prima_asset_management',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: true,
    maxAge: 8 * 60 * 60 * 1000
  }
});

app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  '/uploads',
  express.static(path.join(__dirname, 'uploads'))
);

function isPageNavigation(req) {
  const fetchMode = String(req.get('sec-fetch-mode') || '').toLowerCase();
  const accept = String(req.get('accept') || '').toLowerCase();

  return req.method === 'GET' && (
    fetchMode === 'navigate' ||
    accept.includes('text/html')
  );
}

function sendLoginRequired(req, res) {
  if (isPageNavigation(req)) {
    const currentPath = String(req.originalUrl || '');
    const returnTo = currentPath.startsWith('/api/')
      ? ''
      : `&returnTo=${encodeURIComponent(currentPath)}`;

    return res.redirect(302, `/?session=expired${returnTo}`);
  }

  return res.status(401).json({ message: 'Login required.' });
}

function requireLogin(req, res, next) {
  if (!req.session.user) return sendLoginRequired(req, res);
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) return sendLoginRequired(req, res);
  if (req.session.user.role !== 'admin') return res.status(403).json({ message: 'Admin access required.' });
  next();
}

function requireMaintenanceStaff(req, res, next) {
  if (!req.session.user) {
    return sendLoginRequired(req, res);
  }

  if (!['admin', 'it_staff', 'technician'].includes(req.session.user.role)) {
    return res.status(403).json({
      message: 'Admin or IT Staff access required.'
    });
  }

  next();
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, database: 'connected' });
  } catch (error) {
    res.status(500).json({ ok: false, database: 'disconnected', error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: 'Username and password are required.' });

    const [rows] = await pool.query(
      `SELECT id, employee_id, full_name, username, password_hash, role, status
       FROM users WHERE username = ? LIMIT 1`,
      [username.trim()]
    );

    if (!rows.length) return res.status(401).json({ message: 'Invalid username or password.' });
    const user = rows[0];
    const matches = await bcrypt.compare(password, user.password_hash);
    if (!matches) return res.status(401).json({ message: 'Invalid username or password.' });
    if (user.status !== 'active') return res.status(403).json({ message: `Account is ${user.status}.` });

    req.session.user = {
      id: user.id,
      employee_id: user.employee_id,
      full_name: user.full_name,
      username: user.username,
      role: user.role
    };

    res.json({ ok: true, user: req.session.user });
  } catch (error) {
    res.status(500).json({ message: 'Login failed.', error: error.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ message: 'Not logged in.' });
  res.json(req.session.user);
});

// ============================================================
// USER MANAGEMENT
// ============================================================

app.get('/api/users', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        u.id,
        u.employee_id,
        u.full_name,
        u.username,
        u.role,
        u.status,
        u.created_at,
        e.email,
        d.name AS department_name
      FROM users u
      LEFT JOIN employees e
        ON e.employee_id = u.employee_id
      LEFT JOIN departments d
        ON d.id = e.department_id
      ORDER BY u.full_name ASC, u.username ASC
    `);

    return res.json({ ok: true, users: rows });
  } catch (error) {
    console.error('LIST USERS ERROR:', error);
    return res.status(500).json({
      message: 'Unable to load system users.'
    });
  }
});

app.post('/api/users', requireAdmin, async (req, res) => {
  const connection = await pool.getConnection();
  let transactionStarted = false;

  try {
    const fullName = String(req.body.full_name || '').trim();
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const employeeId = String(req.body.employee_id || '').trim() || null;
    const role = String(req.body.role || 'viewer').trim().toLowerCase();
    const status = String(req.body.status || 'active').trim().toLowerCase();

    if (fullName.length < 2 || fullName.length > 150) {
      return res.status(400).json({
        message: 'Full name must contain between 2 and 150 characters.'
      });
    }

    if (!/^[A-Za-z0-9._-]{3,50}$/.test(username)) {
      return res.status(400).json({
        message: 'Username must be 3–50 characters and may use letters, numbers, dots, underscores, and hyphens.'
      });
    }

    if (password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
      return res.status(400).json({
        message: 'Password must be at least 8 characters and no more than 72 bytes.'
      });
    }

    if (!['admin', 'it_staff', 'viewer'].includes(role)) {
      return res.status(400).json({ message: 'Invalid user role.' });
    }

    if (!['active', 'inactive', 'pending'].includes(status)) {
      return res.status(400).json({ message: 'Invalid account status.' });
    }

    if (employeeId) {
      const [employeeRows] = await connection.query(
        'SELECT employee_id FROM employees WHERE employee_id = ? LIMIT 1',
        [employeeId]
      );

      if (!employeeRows.length) {
        return res.status(400).json({
          message: 'The selected employee ID does not exist.'
        });
      }
    }

    const [existingRows] = await connection.query(
      'SELECT id FROM users WHERE username = ? LIMIT 1',
      [username]
    );

    if (existingRows.length) {
      return res.status(409).json({ message: 'Username already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await connection.beginTransaction();
    transactionStarted = true;

    const [result] = await connection.query(`
      INSERT INTO users
        (employee_id, full_name, username, password_hash, role, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [employeeId, fullName, username, passwordHash, role, status]);

    await connection.query(`
      INSERT INTO audit_logs
        (user_id, action, entity_type, entity_id, details)
      VALUES (?, 'CREATE_USER', 'user', ?, ?)
    `, [
      req.session.user.id,
      String(result.insertId),
      JSON.stringify({
        username,
        full_name: fullName,
        employee_id: employeeId,
        role,
        status
      })
    ]);

    await connection.commit();
    transactionStarted = false;

    return res.status(201).json({
      ok: true,
      id: result.insertId,
      message: 'User account created successfully.'
    });
  } catch (error) {
    if (transactionStarted) {
      try { await connection.rollback(); } catch (_) {}
    }

    console.error('CREATE USER ERROR:', error);

    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Username already exists.' });
    }

    return res.status(500).json({
      message: 'Unable to create user account.'
    });
  } finally {
    connection.release();
  }
});

app.get('/api/dashboard/summary', requireLogin, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        COUNT(*) AS total_assets,
        COALESCE(SUM(status = 'Available'), 0) AS available,
        COALESCE(SUM(status = 'Assigned'), 0) AS assigned,
        COALESCE(SUM(status IN ('For Repair', 'Repairing')), 0) AS for_repair,
        COALESCE(SUM(status = 'For Disposal'), 0) AS for_disposal
      FROM assets
    `);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ message: 'Unable to load asset summary.', error: error.message });
  }
});

app.get('/dashboard', requireLogin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));

app.get('/employees', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'employees.html'));
});

app.get('/assets', requireLogin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'assets.html')));

app.get('/api/asset-categories', requireLogin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name FROM asset_categories ORDER BY name');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: 'Unable to load asset categories.', error: error.message });
  }
});
app.get('/clearance', requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'clearance.html'));
});

// ============================================================
// RETURN ASSIGNED ASSET
// ============================================================
app.post('/api/assets/:id/return', requireLogin, async (req, res) => {

  const connection = await pool.getConnection();

  try {

    const assetDbId = Number(req.params.id);

    if (!Number.isInteger(assetDbId) || assetDbId <= 0) {

      return res.status(400).json({
        message: 'Invalid asset ID.'
      });

    }

    const returnedAt =
      req.body.returned_at &&
      String(req.body.returned_at).trim()
        ? req.body.returned_at
        : null;

    const remarks =
      String(req.body.remarks || '').trim() ||
      'Asset returned to IT inventory.';

    await connection.beginTransaction();

    // --------------------------------------------------------
    // GET ASSET
    // --------------------------------------------------------

    const [assetRows] = await connection.query(`
      SELECT
        id,
        asset_id,
        asset_name,
        status
      FROM assets
      WHERE id = ?
      LIMIT 1
      FOR UPDATE
    `, [assetDbId]);

    if (!assetRows.length) {

      await connection.rollback();

      return res.status(404).json({
        message: 'Asset not found.'
      });

    }

    const asset = assetRows[0];

    if (asset.status !== 'Assigned') {

      await connection.rollback();

      return res.status(409).json({
        message:
          `${asset.asset_id} is currently ${asset.status} and cannot be returned.`
      });

    }

    // --------------------------------------------------------
    // GET ACTIVE ASSIGNMENT
    // --------------------------------------------------------

    const [assignmentRows] = await connection.query(`
      SELECT
        id,
        asset_id,
        employee_id
      FROM asset_assignments
      WHERE asset_id = ?
        AND returned_at IS NULL
      ORDER BY id DESC
      LIMIT 1
      FOR UPDATE
    `, [assetDbId]);

    if (!assignmentRows.length) {

      await connection.rollback();

      return res.status(400).json({
        message: 'This asset does not have an active custodian assignment.'
      });

    }

    const assignment = assignmentRows[0];

    // --------------------------------------------------------
    // CLOSE ACTIVE ASSIGNMENT
    // --------------------------------------------------------

    const [assignmentUpdate] = await connection.query(`
      UPDATE asset_assignments
      SET
        returned_at = COALESCE(?, NOW()),
        return_remarks = ?
      WHERE id = ?
        AND returned_at IS NULL
    `, [
      returnedAt,
      remarks,
      assignment.id
    ]);

    if (assignmentUpdate.affectedRows !== 1) {

      await connection.rollback();

      return res.status(409).json({
        message: 'This asset assignment has already been returned.'
      });

    }

    // --------------------------------------------------------
    // UPDATE ASSET STATUS
    // --------------------------------------------------------

    const [assetUpdate] = await connection.query(`
      UPDATE assets
      SET status = 'Available'
      WHERE id = ?
        AND status = 'Assigned'
    `, [assetDbId]);

    if (assetUpdate.affectedRows !== 1) {

      await connection.rollback();

      return res.status(409).json({
        message: 'This asset is no longer assigned.'
      });

    }

    // --------------------------------------------------------
    // ASSET HISTORY
    // --------------------------------------------------------

    await connection.query(`
      INSERT INTO asset_history
      (
        asset_id,
        action,
        from_status,
        to_status,
        from_employee_id,
        to_employee_id,
        remarks,
        performed_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      assetDbId,
      'Asset Returned',
      asset.status,
      'Available',
      assignment.employee_id,
      null,
      remarks,
      req.session.user.id
    ]);

    // --------------------------------------------------------
    // AUDIT LOG
    // --------------------------------------------------------

    await connection.query(`
      INSERT INTO audit_logs
      (
        user_id,
        action,
        entity_type,
        entity_id,
        details
      )
      VALUES (?, ?, ?, ?, ?)
    `, [
      req.session.user.id,
      'RETURN',
      'asset',
      String(assetDbId),
      JSON.stringify({
        asset_id: asset.asset_id,
        asset_name: asset.asset_name,
        assignment_id: assignment.id,
        employee_id: assignment.employee_id,
        returned_at: returnedAt || 'NOW()',
        remarks: remarks
      })
    ]);

    await connection.commit();

    return res.json({
      success: true,
      message: 'Asset returned successfully.',
      asset_id: asset.asset_id,
      status: 'Available'
    });

  } catch (error) {

    try {
      await connection.rollback();
    } catch (_) {}

    console.error(
      'RETURN ASSET ERROR:',
      error
    );

    return res.status(500).json({
      message: 'Unable to return asset.',
      error: error.message
    });

  } finally {

    connection.release();

  }

});

// =====================================================
// DEPARTMENTS
// =====================================================

app.get('/api/departments', requireLogin, async (req, res) => {
  try {

    const [rows] = await pool.query(`
      SELECT
        id,
        name
      FROM departments
      ORDER BY name
    `);

    res.json(rows);

  } catch (error) {

    console.error('Load departments error:', error);

    res.status(500).json({
      message: 'Unable to load departments.',
      error: error.message
    });

  }
});

// PRIMA IT Asset Management - Management Dashboard Analytics routes
// Paste this route block into server.js AFTER pool/requireLogin are initialized.
// The route uses the existing tables:
// assets, asset_categories, locations, asset_assignments, employees, departments, asset_repairs.

app.get('/api/dashboard/analytics', requireLogin, async (req, res) => {
  try {
    const [statusRows] = await pool.query(`
      SELECT
        status AS label,
        COUNT(*) AS value
      FROM assets
      GROUP BY status
      ORDER BY value DESC, label ASC
    `);

    const [categoryRows] = await pool.query(`
      SELECT
        COALESCE(ac.name, 'Uncategorized') AS label,
        COUNT(*) AS value
      FROM assets a
      LEFT JOIN asset_categories ac ON ac.id = a.category_id
      GROUP BY COALESCE(ac.name, 'Uncategorized')
      ORDER BY value DESC, label ASC
    `);

    const [departmentRows] = await pool.query(`
      SELECT
        COALESCE(d.name, 'Unassigned') AS label,
        COUNT(*) AS value
      FROM assets a
      LEFT JOIN asset_assignments aa
        ON aa.asset_id = a.id
       AND aa.returned_at IS NULL
      LEFT JOIN employees e ON e.id = aa.employee_id
      LEFT JOIN departments d ON d.id = e.department_id
      GROUP BY COALESCE(d.name, 'Unassigned')
      ORDER BY value DESC, label ASC
    `);

    const [locationRows] = await pool.query(`
      SELECT
        COALESCE(l.name, 'Unspecified') AS label,
        COUNT(*) AS value
      FROM assets a
      LEFT JOIN locations l ON l.id = a.location_id
      GROUP BY COALESCE(l.name, 'Unspecified')
      ORDER BY value DESC, label ASC
    `);

    const [summaryRows] = await pool.query(`
      SELECT COALESCE(SUM(purchase_cost), 0) AS inventory_value
      FROM assets
    `);

    const [valueStatusRows] = await pool.query(`
      SELECT
        status AS label,
        COALESCE(SUM(purchase_cost), 0) AS value
      FROM assets
      GROUP BY status
      ORDER BY value DESC, label ASC
    `);

    const [repairTrendRows] = await pool.query(`
      SELECT
        DATE_FORMAT(months.month_start, '%b %Y') AS label,
        COALESCE(COUNT(ar.id), 0) AS value
      FROM (
        SELECT DATE_FORMAT(CURRENT_DATE, '%Y-%m-01') AS month_start
        UNION ALL SELECT DATE_FORMAT(DATE_SUB(CURRENT_DATE, INTERVAL 1 MONTH), '%Y-%m-01')
        UNION ALL SELECT DATE_FORMAT(DATE_SUB(CURRENT_DATE, INTERVAL 2 MONTH), '%Y-%m-01')
        UNION ALL SELECT DATE_FORMAT(DATE_SUB(CURRENT_DATE, INTERVAL 3 MONTH), '%Y-%m-01')
        UNION ALL SELECT DATE_FORMAT(DATE_SUB(CURRENT_DATE, INTERVAL 4 MONTH), '%Y-%m-01')
        UNION ALL SELECT DATE_FORMAT(DATE_SUB(CURRENT_DATE, INTERVAL 5 MONTH), '%Y-%m-01')
        UNION ALL SELECT DATE_FORMAT(DATE_SUB(CURRENT_DATE, INTERVAL 6 MONTH), '%Y-%m-01')
        UNION ALL SELECT DATE_FORMAT(DATE_SUB(CURRENT_DATE, INTERVAL 7 MONTH), '%Y-%m-01')
        UNION ALL SELECT DATE_FORMAT(DATE_SUB(CURRENT_DATE, INTERVAL 8 MONTH), '%Y-%m-01')
        UNION ALL SELECT DATE_FORMAT(DATE_SUB(CURRENT_DATE, INTERVAL 9 MONTH), '%Y-%m-01')
        UNION ALL SELECT DATE_FORMAT(DATE_SUB(CURRENT_DATE, INTERVAL 10 MONTH), '%Y-%m-01')
        UNION ALL SELECT DATE_FORMAT(DATE_SUB(CURRENT_DATE, INTERVAL 11 MONTH), '%Y-%m-01')
      ) months
      LEFT JOIN asset_repairs ar
        ON DATE_FORMAT(ar.created_at, '%Y-%m-01') = months.month_start
      GROUP BY months.month_start
      ORDER BY months.month_start ASC
    `);

    const [repairCostRows] = await pool.query(`
      SELECT
        DATE_FORMAT(months.month_start, '%b %Y') AS label,
        COALESCE(SUM(ar.total_cost), 0) AS value
      FROM (
        SELECT DATE_FORMAT(CURRENT_DATE, '%Y-%m-01') AS month_start
        UNION ALL SELECT DATE_FORMAT(DATE_SUB(CURRENT_DATE, INTERVAL 1 MONTH), '%Y-%m-01')
        UNION ALL SELECT DATE_FORMAT(DATE_SUB(CURRENT_DATE, INTERVAL 2 MONTH), '%Y-%m-01')
        UNION ALL SELECT DATE_FORMAT(DATE_SUB(CURRENT_DATE, INTERVAL 3 MONTH), '%Y-%m-01')
        UNION ALL SELECT DATE_FORMAT(DATE_SUB(CURRENT_DATE, INTERVAL 4 MONTH), '%Y-%m-01')
        UNION ALL SELECT DATE_FORMAT(DATE_SUB(CURRENT_DATE, INTERVAL 5 MONTH), '%Y-%m-01')
        UNION ALL SELECT DATE_FORMAT(DATE_SUB(CURRENT_DATE, INTERVAL 6 MONTH), '%Y-%m-01')
        UNION ALL SELECT DATE_FORMAT(DATE_SUB(CURRENT_DATE, INTERVAL 7 MONTH), '%Y-%m-01')
        UNION ALL SELECT DATE_FORMAT(DATE_SUB(CURRENT_DATE, INTERVAL 8 MONTH), '%Y-%m-01')
        UNION ALL SELECT DATE_FORMAT(DATE_SUB(CURRENT_DATE, INTERVAL 9 MONTH), '%Y-%m-01')
        UNION ALL SELECT DATE_FORMAT(DATE_SUB(CURRENT_DATE, INTERVAL 10 MONTH), '%Y-%m-01')
        UNION ALL SELECT DATE_FORMAT(DATE_SUB(CURRENT_DATE, INTERVAL 11 MONTH), '%Y-%m-01')
      ) months
      LEFT JOIN asset_repairs ar
        ON DATE_FORMAT(ar.created_at, '%Y-%m-01') = months.month_start
      GROUP BY months.month_start
      ORDER BY months.month_start ASC
    `);

    return res.json({
      ok: true,
      summary: {
        inventory_value: Number(summaryRows[0]?.inventory_value || 0),
        inventory_value_by_status: valueStatusRows.map(row => ({
          label: row.label,
          value: Number(row.value || 0)
        }))
      },
      status: statusRows.map(row => ({
        label: row.label || 'Unknown',
        value: Number(row.value || 0)
      })),
      category: categoryRows.map(row => ({
        label: row.label,
        value: Number(row.value || 0)
      })),
      department: departmentRows.map(row => ({
        label: row.label,
        value: Number(row.value || 0)
      })),
      location: locationRows.map(row => ({
        label: row.label,
        value: Number(row.value || 0)
      })),
      repairTrend: repairTrendRows.map(row => ({
        label: row.label,
        value: Number(row.value || 0)
      })),
      repairCost: repairCostRows.map(row => ({
        label: row.label,
        value: Number(row.value || 0)
      }))
    });
  } catch (error) {
    console.error('DASHBOARD ANALYTICS ERROR:', error);
    return res.status(500).json({
      ok: false,
      message: 'Unable to load dashboard analytics.',
      error: error.message
    });
  }
});


// =====================================================
// EMPLOYEES - LIST
// =====================================================

app.get('/api/employees', requireLogin, async (req, res) => {
  try {

    const search =
      String(req.query.search || '').trim();

    const departmentId =
      Number(req.query.department_id || 0);

    const status =
      String(req.query.status || '').trim();

    let sql = `
      SELECT
        e.id,
        e.employee_id,
        e.full_name,
        e.email,
        e.department_id,
        e.position_title,
        e.status,
        e.created_at,
        d.name AS department_name
      FROM employees e
      LEFT JOIN departments d
        ON d.id = e.department_id
      WHERE 1=1
    `;

    const params = [];

    // ---------------------------------------------
    // SEARCH
    // ---------------------------------------------

    if (search) {

      sql += `
        AND (
          e.employee_id LIKE ?
          OR e.full_name LIKE ?
          OR e.email LIKE ?
          OR e.position_title LIKE ?
          OR d.name LIKE ?
        )
      `;

      const term = `%${search}%`;

      params.push(
        term,
        term,
        term,
        term,
        term
      );
    }


    // ---------------------------------------------
    // DEPARTMENT
    // ---------------------------------------------

    if (departmentId) {

      sql += `
        AND e.department_id = ?
      `;

      params.push(departmentId);

    }


    // ---------------------------------------------
    // STATUS
    // ---------------------------------------------

    if (status) {

      sql += `
        AND e.status = ?
      `;

      params.push(status);

    }


    sql += `
      ORDER BY e.full_name ASC
    `;


    const [rows] =
      await pool.query(sql, params);


    res.json(rows);

  } catch (error) {

    console.error('Load employees error:', error);

    res.status(500).json({
      message: 'Unable to load employees.',
      error: error.message
    });

  }
});

// =====================================================
// CUSTODIAN MANAGEMENT
// =====================================================

// -----------------------------------------------------
// LIST ACTIVE CUSTODIANS + CURRENT ASSIGNED ASSET COUNT
// -----------------------------------------------------

app.get('/api/custodians', requireLogin, async (req, res) => {
  try {
    const search =
      String(req.query.search || '').trim();

    let sql = `
      SELECT
        e.id,
        e.employee_id,
        e.full_name,
        e.email,
        e.position_title,
        e.status,
        d.name AS department_name,

        (
          SELECT COUNT(*)
          FROM asset_assignments aa2
          WHERE aa2.employee_id = e.id
            AND aa2.returned_at IS NULL
        ) AS assigned_asset_count

      FROM employees e

      LEFT JOIN departments d
        ON d.id = e.department_id

      WHERE e.status = 'active'
    `;

    const params = [];

    if (search) {

      sql += `
        AND (
          e.employee_id LIKE ?
          OR e.full_name LIKE ?
          OR e.email LIKE ?
          OR e.position_title LIKE ?
          OR d.name LIKE ?
        )
      `;

      const term = `%${search}%`;

      params.push(
        term,
        term,
        term,
        term,
        term
      );
    }

    sql += `
      ORDER BY
        e.full_name ASC
    `;

    const [rows] =
      await pool.query(
        sql,
        params
      );

    res.json(rows);

  } catch (error) {

    console.error(
      'Load custodians error:',
      error
    );

    res.status(500).json({
      message:
        'Unable to load custodians.',
      error:
        error.message
    });
  }
});


// -----------------------------------------------------
// GET ONE CUSTODIAN + CURRENT ASSIGNED ASSETS
// -----------------------------------------------------
app.get(
  '/api/custodians/:id',
  requireLogin,
  async (req, res) => {

    try {

      const employeeId =
        Number(req.params.id);

      if (!Number.isInteger(employeeId)) {

        return res.status(400).json({
          message:
            'Invalid employee ID.'
        });

      }

      // -----------------------------------------------
      // EMPLOYEE
      // -----------------------------------------------

      const [employeeRows] =
        await pool.query(`
          SELECT
            e.id,
            e.employee_id,
            e.full_name,
            e.email,
            e.position_title,
            e.status,
            d.name AS department_name
          FROM employees e
          LEFT JOIN departments d
            ON d.id = e.department_id
          WHERE e.id = ?
          LIMIT 1
        `, [
          employeeId
        ]);

      if (!employeeRows.length) {

        return res.status(404).json({
          message:
            'Custodian not found.'
        });

      }

      const employee =
        employeeRows[0];



      // -----------------------------------------------
      // CURRENTLY ASSIGNED ASSETS
      // -----------------------------------------------

      const [assetRows] =
        await pool.query(`
          SELECT
            a.id,
            a.asset_id,
            a.asset_name,
            a.brand,
            a.model,
            a.serial_number,
            a.barcode,
            a.condition_status,
            a.status,
            a.purchase_date,
            a.purchase_cost,
            a.warranty_expiry,
            a.notes,

            c.name AS category_name,

            l.name AS location_name,

            aa.id AS assignment_id,
            aa.assigned_at,
            aa.remarks AS assignment_remarks

          FROM asset_assignments aa

          INNER JOIN assets a
            ON a.id = aa.asset_id

          LEFT JOIN asset_categories c
            ON c.id = a.category_id

          LEFT JOIN locations l
            ON l.id = a.location_id

          WHERE aa.employee_id = ?
            AND aa.returned_at IS NULL

          ORDER BY
            aa.assigned_at ASC,
            a.asset_id ASC
        `, [
          employeeId
        ]);

      res.json({
        employee,
        assets: assetRows
      });

    } catch (error) {

      console.error(
        'Load custodian details error:',
        error
      );

      res.status(500).json({
        message:
          'Unable to load custodian details.',
        error:
          error.message
      });
    }
  }
);

// ============================================================
// ASSET HISTORY
// ============================================================

app.get(
  '/api/assets/:id/history',
  requireLogin,
  async (req, res) => {

    try {

      const assetId =
        Number(req.params.id);

      if (
        !Number.isInteger(assetId) ||
        assetId <= 0
      ) {
        return res.status(400).json({
          message: 'Invalid asset ID.'
        });
      }


      const [rows] =
        await pool.query(
          `
          SELECT

            ah.id,
            ah.asset_id,
            ah.action,
            ah.from_status,
            ah.to_status,

            ah.from_employee_id,
            ah.to_employee_id,

            ah.remarks,
            ah.created_at,

            from_emp.employee_id
              AS from_employee_code,

            from_emp.full_name
              AS from_employee_name,

            to_emp.employee_id
              AS to_employee_code,

            to_emp.full_name
              AS to_employee_name,

            u.full_name
              AS performed_by_name,

            u.username
              AS performed_by_username

          FROM asset_history ah

          LEFT JOIN employees from_emp
            ON from_emp.id =
               ah.from_employee_id

          LEFT JOIN employees to_emp
            ON to_emp.id =
               ah.to_employee_id

          LEFT JOIN users u
            ON u.id =
               ah.performed_by

          WHERE ah.asset_id = ?

          ORDER BY
            ah.created_at DESC,
            ah.id DESC
          `,
          [assetId]
        );


      return res.json({
        ok: true,
        history: rows
      });

    } catch (error) {

      console.error(
        'GET ASSET HISTORY ERROR:',
        error
      );

      return res.status(500).json({
        message:
          'Unable to load asset history.',
        error:
          error.message
      });
    }
  }
);

// =====================================================
// EMPLOYEES - VIEW
// =====================================================

app.get('/api/employees/:id', requireLogin, async (req, res) => {
  try {

    const [rows] = await pool.query(`
      SELECT
        e.id,
        e.employee_id,
        e.full_name,
        e.email,
        e.department_id,
        e.position_title,
        e.status,
        e.created_at,
        d.name AS department_name
      FROM employees e
      LEFT JOIN departments d
        ON d.id = e.department_id
      WHERE e.id = ?
      LIMIT 1
    `, [req.params.id]);


    if (!rows.length) {

      return res.status(404).json({
        message: 'Employee not found.'
      });

    }


    res.json(rows[0]);

  } catch (error) {

    console.error('View employee error:', error);

    res.status(500).json({
      message: 'Unable to load employee.',
      error: error.message
    });

  }
});

// =====================================================
// EMPLOYEE - CURRENT ASSIGNED ASSETS
// =====================================================

app.get('/api/employees/:id/assets', requireLogin, async (req, res) => {
  try {

    const employeeId = Number(req.params.id);

    if (!employeeId) {
      return res.status(400).json({
        message: 'Invalid employee ID.'
      });
    }

    const [rows] = await pool.query(`
      SELECT
        aa.id AS assignment_id,
        aa.assigned_at,
        aa.returned_at,
        aa.remarks AS assignment_remarks,

        a.id,
        a.asset_id,
        a.asset_name,
        a.brand,
        a.model,
        a.serial_number,
        a.barcode,
        a.purchase_date,
        a.purchase_cost,
        a.warranty_expiry,
        a.condition_status,
        a.status,
        a.location_id,
        a.notes,

        c.name AS category_name,
        l.name AS location_name

      FROM asset_assignments aa

      INNER JOIN assets a
        ON a.id = aa.asset_id

      LEFT JOIN asset_categories c
        ON c.id = a.category_id

      LEFT JOIN locations l
        ON l.id = a.location_id

      WHERE aa.employee_id = ?
        AND aa.returned_at IS NULL

      ORDER BY
        aa.assigned_at DESC,
        aa.id DESC
    `, [employeeId]);

    res.json(rows);

  } catch (error) {

    console.error('Load employee assets error:', error);

    res.status(500).json({
      message: 'Unable to load employee assets.',
      error: error.message
    });

  }
});

// =====================================================
// EMPLOYEES - CREATE
// =====================================================

app.post('/api/employees', requireLogin, async (req, res) => {

  const connection =
    await pool.getConnection();

  try {

    const {
      employee_id,
      full_name,
      email,
      department_id,
      position_title,
      status
    } = req.body;


    // ---------------------------------------------
    // VALIDATION
    // ---------------------------------------------

    if (
      !employee_id ||
      !String(employee_id).trim()
    ) {

      return res.status(400).json({
        message: 'Employee ID is required.'
      });

    }


    if (
      !full_name ||
      !String(full_name).trim()
    ) {

      return res.status(400).json({
        message: 'Full Name is required.'
      });

    }


    const employeeId =
      String(employee_id).trim();

    const fullName =
      String(full_name).trim();

    const employeeStatus =
      String(status || 'active')
        .trim()
        .toLowerCase();


    if (
      !['active', 'inactive']
        .includes(employeeStatus)
    ) {

      return res.status(400).json({
        message: 'Status must be active or inactive.'
      });

    }


    // ---------------------------------------------
    // CHECK DUPLICATE EMPLOYEE ID
    // ---------------------------------------------

    const [existing] =
      await connection.query(`
        SELECT id
        FROM employees
        WHERE employee_id = ?
        LIMIT 1
      `, [employeeId]);


    if (existing.length) {

      return res.status(409).json({
        message: 'Employee ID already exists.'
      });

    }


    // ---------------------------------------------
    // VERIFY DEPARTMENT
    // ---------------------------------------------

    let departmentId = null;

    if (department_id) {

      const [departmentRows] =
        await connection.query(`
          SELECT id
          FROM departments
          WHERE id = ?
          LIMIT 1
        `, [department_id]);


      if (!departmentRows.length) {

        return res.status(400).json({
          message: 'Selected department was not found.'
        });

      }


      departmentId =
        Number(department_id);

    }


    // ---------------------------------------------
    // INSERT EMPLOYEE
    // ---------------------------------------------

    await connection.beginTransaction();


    const [result] =
      await connection.query(`
        INSERT INTO employees
        (
          employee_id,
          full_name,
          email,
          department_id,
          position_title,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `, [
        employeeId,
        fullName,
        email || null,
        departmentId,
        position_title || null,
        employeeStatus
      ]);





    // ---------------------------------------------
    // AUDIT LOG
    // ---------------------------------------------

    await connection.query(`
      INSERT INTO audit_logs
      (
        user_id,
        action,
        entity_type,
        entity_id,
        details
      )
      VALUES (?, 'CREATE', 'employee', ?, ?)
    `, [
      req.session.user.id,
      String(result.insertId),
      JSON.stringify({
        employee_id: employeeId,
        full_name: fullName
      })
    ]);


    await connection.commit();


    res.status(201).json({
      ok: true,
      id: result.insertId,
      employee_id: employeeId,
      message: 'Employee created successfully.'
    });


  } catch (error) {

    await connection.rollback();

    console.error(
      'Create employee error:',
      error
    );


    if (error.code === 'ER_DUP_ENTRY') {

      return res.status(409).json({
        message: 'Employee ID already exists.'
      });

    }


    res.status(500).json({
      message: 'Unable to create employee.',
      error: error.message
    });


  } finally {

    connection.release();

  }

});

// =====================================================
// EMPLOYEES - DELETE
// =====================================================

app.delete('/api/employees/:id', requireAdmin, async (req, res) => {
  const employeeId = Number(req.params.id);

  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    return res.status(400).json({ message: 'Invalid employee ID.' });
  }

  const connection = await pool.getConnection();
  let transactionStarted = false;

  try {
    await connection.beginTransaction();
    transactionStarted = true;

    const [employeeRows] = await connection.query(`
      SELECT
        id,
        employee_id,
        full_name,
        email,
        status
      FROM employees
      WHERE id = ?
      LIMIT 1
      FOR UPDATE
    `, [employeeId]);

    if (!employeeRows.length) {
      await connection.rollback();
      transactionStarted = false;

      return res.status(404).json({ message: 'Employee not found.' });
    }

    const employee = employeeRows[0];

    const [assignedAssets] = await connection.query(`
      SELECT
        a.id,
        a.asset_id,
        a.asset_name
      FROM asset_assignments aa
      INNER JOIN assets a
        ON a.id = aa.asset_id
      WHERE aa.employee_id = ?
        AND aa.returned_at IS NULL
      ORDER BY a.asset_id ASC
      FOR UPDATE
    `, [employeeId]);

    if (assignedAssets.length) {
      await connection.rollback();
      transactionStarted = false;

      return res.status(409).json({
        code: 'EMPLOYEE_HAS_ASSIGNED_ASSETS',
        message: `Return all ${assignedAssets.length} assigned asset${assignedAssets.length === 1 ? '' : 's'} before deleting this employee.`,
        assigned_assets: assignedAssets
      });
    }

    // Preserve repair records while removing references to the employee.
    await connection.query(
      'UPDATE asset_repairs SET custodian_id = NULL WHERE custodian_id = ?',
      [employeeId]
    );
    await connection.query(
      'UPDATE asset_repairs SET technician_id = NULL WHERE technician_id = ?',
      [employeeId]
    );

    // These records belong to the employee and otherwise restrict deletion.
    // Child rows are removed by their configured cascading foreign keys.
    await connection.query(
      'DELETE FROM employee_clearances WHERE employee_id = ?',
      [employeeId]
    );
    await connection.query(
      'DELETE FROM custodian_forms WHERE employee_id = ?',
      [employeeId]
    );
    await connection.query(
      'DELETE FROM asset_assignments WHERE employee_id = ?',
      [employeeId]
    );

    const [deleteResult] = await connection.query(
      'DELETE FROM employees WHERE id = ?',
      [employeeId]
    );

    if (!deleteResult.affectedRows) {
      throw new Error('Employee could not be deleted.');
    }

    await connection.query(`
      INSERT INTO audit_logs
        (user_id, action, entity_type, entity_id, details)
      VALUES (?, 'DELETE', 'employee', ?, ?)
    `, [
      req.session.user.id,
      String(employeeId),
      JSON.stringify({
        employee_id: employee.employee_id,
        full_name: employee.full_name,
        email: employee.email || null,
        status: employee.status
      })
    ]);

    await connection.commit();
    transactionStarted = false;

    return res.json({
      ok: true,
      message: `Employee ${employee.employee_id} deleted successfully.`
    });
  } catch (error) {
    if (transactionStarted) {
      try { await connection.rollback(); } catch (_) {}
    }

    console.error('DELETE EMPLOYEE ERROR:', error);

    if (
      error.code === 'ER_ROW_IS_REFERENCED' ||
      error.code === 'ER_ROW_IS_REFERENCED_2'
    ) {
      return res.status(409).json({
        message: 'This employee still has related system records and cannot be deleted.'
      });
    }

    return res.status(500).json({
      message: 'Unable to delete employee.'
    });
  } finally {
    connection.release();
  }
});

app.get('/api/locations', requireLogin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name FROM locations ORDER BY name');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: 'Unable to load locations.', error: error.message });
  }
});

app.get('/api/assets', requireLogin, async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const status = String(req.query.status || '').trim();
    const categoryId = Number(req.query.category_id || 0);

    let sql = `
      SELECT
        a.id,
        a.asset_id,
        a.asset_name,
        a.brand,
        a.model,
        a.serial_number,
        a.barcode,
        a.purchase_date,
        a.purchase_cost,
        a.warranty_expiry,
        a.condition_status,
        a.status,
        a.notes,
        a.created_at,
        c.name AS category_name,
        l.name AS location_name,
        e.id AS custodian_id,
        e.full_name AS custodian_name,
        e.employee_id AS custodian_employee_id,
        d.name AS department_name,
        aa.assigned_at
      FROM assets a
      LEFT JOIN asset_categories c ON c.id = a.category_id
      LEFT JOIN locations l ON l.id = a.location_id
      LEFT JOIN asset_assignments aa ON aa.asset_id = a.id AND aa.returned_at IS NULL
      LEFT JOIN employees e ON e.id = aa.employee_id
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      sql += ` AND (a.asset_id LIKE ? OR a.asset_name LIKE ? OR a.brand LIKE ? OR a.model LIKE ? OR a.serial_number LIKE ? OR a.barcode LIKE ? OR e.full_name LIKE ?)`;
      const term = `%${search}%`;
      params.push(term, term, term, term, term, term, term);
    }

    if (status) {
      sql += ' AND a.status = ?';
      params.push(status);
    }

    if (categoryId) {
      sql += ' AND a.category_id = ?';
      params.push(categoryId);
    }

    sql += ' ORDER BY a.id DESC';

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: 'Unable to load assets.', error: error.message });
  }
});

app.post('/api/assets', requireLogin, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const {
      category_id,
      asset_name,
      brand,
      model,
      serial_number,
      barcode,
      purchase_date,
      purchase_cost,
      warranty_expiry,
      condition_status,
      location_id,
      notes
    } = req.body;

    if (!asset_name || !String(asset_name).trim()) {
      return res.status(400).json({ message: 'Asset name is required.' });
    }

    await connection.beginTransaction();

    const currentYear = new Date().getFullYear();
    const assetPrefix = `PRIMA-${currentYear}-`;

    const [numberRows] = await connection.query(`
      SELECT
        COALESCE(
          MAX(
            CAST(
              SUBSTRING_INDEX(asset_id, '-', -1)
              AS UNSIGNED
            )
          ),
          0
        ) AS highest_number
      FROM assets
      WHERE asset_id LIKE ?
    `, [`${assetPrefix}%`]);

    const nextNumber = Number(numberRows[0]?.highest_number || 0) + 1;
    const assetId = `${assetPrefix}${String(nextNumber).padStart(6, '0')}`;

    const [result] = await connection.query(`
      INSERT INTO assets (
        asset_id, category_id, asset_name, brand, model, serial_number, barcode,
        purchase_date, purchase_cost, warranty_expiry, condition_status,
        status, location_id, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Available', ?, ?)
    `, [
      assetId,
      category_id || null,
      String(asset_name).trim(),
      brand || null,
      model || null,
      serial_number || null,
      barcode || null,
      purchase_date || null,
      purchase_cost || null,
      warranty_expiry || null,
      condition_status || 'Good',
      location_id || null,
      notes || null
    ]);

    await connection.query(`
      INSERT INTO asset_history (asset_id, action, from_status, to_status, remarks, performed_by)
      VALUES (?, 'Asset Created', NULL, 'Available', ?, ?)
    `, [result.insertId, 'Initial asset registration', req.session.user.id]);

    await connection.query(`
      INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
      VALUES (?, 'CREATE', 'asset', ?, ?)
    `, [req.session.user.id, String(result.insertId), JSON.stringify({ asset_id: assetId, asset_name: String(asset_name).trim() })]);

    await connection.commit();
    res.status(201).json({ ok: true, id: result.insertId, asset_id: assetId, message: 'Asset created successfully.' });
  } catch (error) {
    await connection.rollback();

    if (error.code === 'ER_DUP_ENTRY') {
      console.error('CREATE ASSET DUPLICATE:', error.message);
      return res.status(409).json({
        message: 'The Asset Tag, serial number, or barcode already exists.',
        error: error.message
      });
    }

    console.error('CREATE ASSET ERROR:', error);
    return res.status(500).json({
      message: 'Unable to create asset.',
      error: error.message
    });
  } finally {
    connection.release();
  }
});

app.get('/api/assets/:id', requireLogin, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        a.*,
        c.name AS category_name,
        l.name AS location_name,
        e.id AS custodian_id,
        e.full_name AS custodian_name,
        e.employee_id AS custodian_employee_id,
        d.name AS department_name,
        aa.assigned_at
      FROM assets a
      LEFT JOIN asset_categories c ON c.id = a.category_id
      LEFT JOIN locations l ON l.id = a.location_id
      LEFT JOIN asset_assignments aa ON aa.asset_id = a.id AND aa.returned_at IS NULL
      LEFT JOIN employees e ON e.id = aa.employee_id
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE a.id = ?
      LIMIT 1
    `, [req.params.id]);

    if (!rows.length) return res.status(404).json({ message: 'Asset not found.' });
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ message: 'Unable to load asset.', error: error.message });
  }
});
// ============================================================
// UPDATE ASSET
// PUT /api/assets/:id
// ============================================================
app.put('/api/assets/:id', requireLogin, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const assetId = Number(req.params.id);

    if (!assetId) {
      return res.status(400).json({
        message: 'Invalid asset ID.'
      });
    }

    const {
      category_id,
      asset_name,
      brand,
      model,
      serial_number,
      barcode,
      purchase_date,
      purchase_cost,
      warranty_expiry,
      condition_status,
      location_id,
      notes
    } = req.body;

    if (!asset_name || !String(asset_name).trim()) {
      return res.status(400).json({
        message: 'Asset name is required.'
      });
    }

    await connection.beginTransaction();

    // Get existing asset first
    const [existingRows] = await connection.query(
      `SELECT *
       FROM assets
       WHERE id = ?
       FOR UPDATE`,
      [assetId]
    );

    if (!existingRows.length) {
      await connection.rollback();

      return res.status(404).json({
        message: 'Asset not found.'
      });
    }

    const existingAsset = existingRows[0];

    // Keep the current status.
    // Editing asset information should NOT automatically
    // change Available / Assigned / For Repair / etc.
    await connection.query(`
      UPDATE assets
      SET
        category_id = ?,
        asset_name = ?,
        brand = ?,
        model = ?,
        serial_number = ?,
        barcode = ?,
        purchase_date = ?,
        purchase_cost = ?,
        warranty_expiry = ?,
        condition_status = ?,
        location_id = ?,
        notes = ?
      WHERE id = ?
    `, [
      category_id || null,
      String(asset_name).trim(),
      brand || null,
      model || null,
      serial_number || null,
      barcode || null,
      purchase_date || null,
      purchase_cost || null,
      warranty_expiry || null,
      condition_status || 'Good',
      location_id || null,
      notes || null,
      assetId
    ]);

    // Record the edit in history
    await connection.query(`
      INSERT INTO asset_history (
        asset_id,
        action,
        from_status,
        to_status,
        remarks,
        performed_by
      )
      VALUES (?, 'Asset Updated', ?, ?, ?, ?)
    `, [
      assetId,
      existingAsset.status,
      existingAsset.status,
      `Asset information updated for ${existingAsset.asset_id}`,
      req.session.user.id
    ]);

    // Audit log
    await connection.query(`
      INSERT INTO audit_logs (
        user_id,
        action,
        entity_type,
        entity_id,
        details
      )
      VALUES (?, 'UPDATE', 'asset', ?, ?)
    `, [
      req.session.user.id,
      String(assetId),
      JSON.stringify({
        asset_id: existingAsset.asset_id,
        asset_name: String(asset_name).trim()
      })
    ]);

    await connection.commit();

    res.json({
      ok: true,
      id: assetId,
      asset_id: existingAsset.asset_id,
      message: 'Asset updated successfully.'
    });

  } catch (error) {
    await connection.rollback();

    const message =
      error.code === 'ER_DUP_ENTRY'
        ? 'The serial number or barcode already exists.'
        : 'Unable to update asset.';

    console.error('UPDATE ASSET ERROR:', error);

    res.status(500).json({
      message,
      error: error.message
    });

  } finally {
    connection.release();
  }
});

// ============================================================
// DELETE ASSET
// ============================================================

app.delete('/api/assets/:id', requireAdmin, async (req, res) => {
  const assetId = Number(req.params.id);

  if (!Number.isInteger(assetId) || assetId <= 0) {
    return res.status(400).json({ message: 'Invalid asset ID.' });
  }

  const connection = await pool.getConnection();
  let transactionStarted = false;

  try {
    await connection.beginTransaction();
    transactionStarted = true;

    const [assetRows] = await connection.query(`
      SELECT
        id,
        asset_id,
        asset_name,
        status,
        serial_number,
        barcode
      FROM assets
      WHERE id = ?
      LIMIT 1
      FOR UPDATE
    `, [assetId]);

    if (!assetRows.length) {
      await connection.rollback();
      transactionStarted = false;

      return res.status(404).json({ message: 'Asset not found.' });
    }

    const asset = assetRows[0];

    const [activeAssignments] = await connection.query(`
      SELECT
        aa.id,
        e.id AS employee_id,
        e.employee_id AS employee_code,
        e.full_name AS employee_name
      FROM asset_assignments aa
      INNER JOIN employees e
        ON e.id = aa.employee_id
      WHERE aa.asset_id = ?
        AND aa.returned_at IS NULL
      LIMIT 1
      FOR UPDATE
    `, [assetId]);

    if (asset.status === 'Assigned' || activeAssignments.length) {
      await connection.rollback();
      transactionStarted = false;

      return res.status(409).json({
        code: 'ASSET_IS_ASSIGNED',
        message: 'This asset is assigned to an employee. Return the asset before deleting it.',
        custodian: activeAssignments[0] || null
      });
    }

    // Remove related snapshots and workflow records that restrict the asset.
    await connection.query(
      'DELETE FROM annual_inventory_items WHERE asset_id = ?',
      [assetId]
    );
    await connection.query(
      'DELETE FROM employee_clearance_items WHERE asset_id = ?',
      [assetId]
    );
    await connection.query(
      'DELETE FROM custodian_form_assets WHERE asset_id = ?',
      [assetId]
    );
    await connection.query(
      'DELETE FROM asset_disposal_items WHERE asset_id = ?',
      [assetId]
    );
    await connection.query(
      'DELETE FROM asset_disposals WHERE asset_id = ?',
      [assetId]
    );
    await connection.query(
      'DELETE FROM asset_repairs WHERE asset_id = ?',
      [assetId]
    );

    const [deleteResult] = await connection.query(
      'DELETE FROM assets WHERE id = ?',
      [assetId]
    );

    if (!deleteResult.affectedRows) {
      throw new Error('Asset could not be deleted.');
    }

    await connection.query(`
      INSERT INTO audit_logs
        (user_id, action, entity_type, entity_id, details)
      VALUES (?, 'DELETE', 'asset', ?, ?)
    `, [
      req.session.user.id,
      String(assetId),
      JSON.stringify({
        asset_id: asset.asset_id,
        asset_name: asset.asset_name,
        status: asset.status,
        serial_number: asset.serial_number || null,
        barcode: asset.barcode || null
      })
    ]);

    await connection.commit();
    transactionStarted = false;

    return res.json({
      ok: true,
      message: `Asset ${asset.asset_id} deleted successfully.`
    });
  } catch (error) {
    if (transactionStarted) {
      try { await connection.rollback(); } catch (_) {}
    }

    console.error('DELETE ASSET ERROR:', error);

    if (
      error.code === 'ER_ROW_IS_REFERENCED' ||
      error.code === 'ER_ROW_IS_REFERENCED_2'
    ) {
      return res.status(409).json({
        message: 'This asset still has related system records and cannot be deleted.'
      });
    }

    return res.status(500).json({
      message: 'Unable to delete asset.'
    });
  } finally {
    connection.release();
  }
});

// ============================================================
// SEND REPORT VIA EMAIL (PDF ATTACHMENT)
// ============================================================

app.post('/api/reports/send', requireLogin, async (req, res) => {
  try {
    const {
      to, status, category_id, location_id, search,
      category_name, location_name
    } = req.body;

    const recipient = String(to || '').trim();

    if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      return res.status(400).json({ message: 'A valid recipient email is required.' });
    }

    const filters = {
      status: status && status !== 'all' ? status : '',
      categoryId: Number(category_id || 0),
      locationId: Number(location_id || 0),
      search: String(search || '').trim()
    };

    const title = REPORT_TITLES[status || 'all'] || 'Asset Report';

    await sendAssetReportEmail({
      recipients: [recipient],
      title,
      subject: `${title} - ${new Date().toLocaleDateString('en-PH')}`,
      filters,
      meta: {
        categoryName: category_name || 'All Categories',
        locationName: location_name || 'All Locations',
        search: filters.search
      }
    });

    res.json({ ok: true, message: `Report sent to ${recipient}.` });

  } catch (error) {
    console.error('SEND REPORT ERROR:', error);

    res.status(500).json({
      message: 'Unable to send report.',
      error: error.message
    });
  }
});

// ============================================================
// ASSET IMAGE UPLOAD CONFIGURATION
// ============================================================

const assetUploadDir = path.join(__dirname, 'uploads', 'assets');

// Create directory if it doesn't exist
if (!fs.existsSync(assetUploadDir)) {
  fs.mkdirSync(assetUploadDir, {
    recursive: true
  });
}

const assetStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, assetUploadDir);
  },

  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();

    const safeExt = [
      '.jpg',
      '.jpeg',
      '.png',
      '.webp'
    ].includes(ext)
      ? ext
      : '.jpg';

    const prefix =
      file.fieldname === 'receipt_image'
        ? 'receipt'
        : 'asset';

    cb(
      null,
      `${prefix}-${Date.now()}-${Math.round(Math.random() * 100000)}${safeExt}`
    );
  }
});

const assetImageUpload = multer({
  storage: assetStorage,

  limits: {
    fileSize: 10 * 1024 * 1024
  },

  fileFilter: function (req, file, cb) {
    const allowed = [
      'image/jpeg',
      'image/png',
      'image/webp'
    ];

    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG, PNG, and WEBP images are allowed.'));
    }
  }
});
// =====================================================
// EMPLOYEE EXCEL IMPORT
// =====================================================

app.post('/api/employees/import', requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      message: 'Please select an Excel file.'
    });
  }

  const connection = await pool.getConnection();

  try {
    const workbook = XLSX.read(req.file.buffer, {
      type: 'buffer',
      cellDates: true
    });

    const sheetName = workbook.SheetNames[0];

    if (!sheetName) {
      return res.status(400).json({
        message: 'The Excel file does not contain a worksheet.'
      });
    }

    const worksheet = workbook.Sheets[sheetName];

    const rows = XLSX.utils.sheet_to_json(worksheet, {
      defval: '',
      raw: false
    });

    if (!rows.length) {
      return res.status(400).json({
        message: 'The Excel worksheet is empty.'
      });
    }

    await connection.beginTransaction();

    // ---------------------------------------------
    // LOAD DEPARTMENTS
    // ---------------------------------------------

    const [departmentRows] = await connection.query(
      'SELECT id, name FROM departments'
    );

const departmentMap = new Map();

function normalizeDepartmentName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

departmentRows.forEach(dept => {
  departmentMap.set(
    normalizeDepartmentName(dept.name),
    {
      id: dept.id,
      name: dept.name
    }
  );
});

const departmentAliases = new Map([
  ['it department', 'IT DEPT'],
  ['it dept', 'IT DEPT'],
  ['information technology', 'IT DEPT'],
  ['accounting department', 'Accounting'],
  ['hr department', 'HR'],
  ['human resources', 'HR'],
  ['qa department', 'QA'],
  ['quality assurance', 'QA'],
  ['team leader department', 'Team Leader'],
  ['customer service department', 'Customer Service'],
  ['production department', 'Production'],
  ['other department', 'Other']
]);

    // ---------------------------------------------
    // IMPORT RESULTS
    // ---------------------------------------------

    const results = {
      total: rows.length,
      imported: 0,
      skipped: 0,
      successes: [],
      errors: [],
      warnings: []
    };

    // ---------------------------------------------
    // PROCESS EACH EXCEL ROW
    // ---------------------------------------------

    for (let index = 0; index < rows.length; index++) {

      const row = rows[index];

      // Excel header is row 1
      // Therefore actual data starts at row 2
      const excelRow = index + 2;

      const employeeId = String(
        row['Employee ID'] ??
        row['employee_id'] ??
        ''
      ).trim();

      const fullName = String(
        row['Full Name'] ??
        row['full_name'] ??
        ''
      ).trim();

      const email = String(
        row['Email'] ??
        row['email'] ??
        ''
      ).trim();

      const department = String(
        row['Department'] ??
        row['department'] ??
        ''
      ).trim();

      const position = String(
        row['Position'] ??
        row['Position Title'] ??
        row['position_title'] ??
        ''
      ).trim();

      let status = String(
        row['Status'] ??
        row['status'] ??
        'active'
      ).trim().toLowerCase();

      // ---------------------------------------------
      // VALIDATE EMPLOYEE ID
      // ---------------------------------------------

      if (!employeeId) {
        results.skipped++;

        results.errors.push({
          row: excelRow,
          employee_id: employeeId,
          full_name: fullName,
          reason: 'Employee ID is required.'
        });

        continue;
      }

      // ---------------------------------------------
      // VALIDATE FULL NAME
      // ---------------------------------------------

      if (!fullName) {
        results.skipped++;

        results.errors.push({
          row: excelRow,
          employee_id: employeeId,
          full_name: fullName,
          reason: 'Full Name is required.'
        });

        continue;
      }

      // ---------------------------------------------
      // VALIDATE STATUS
      // ---------------------------------------------

      if (!['active', 'inactive'].includes(status)) {

        results.skipped++;

        results.errors.push({
          row: excelRow,
          employee_id: employeeId,
          full_name: fullName,
          reason: 'Status must be active or inactive.'
        });

        continue;
      }

      // ---------------------------------------------
      // FIND DEPARTMENT
      // ---------------------------------------------

      let departmentId = null;
      let resolvedDepartmentName = '';
      let departmentWarning = null;

      if (department) {

        const normalizedDepartment =
          normalizeDepartmentName(department);

        let resolvedDepartment =
          departmentMap.get(normalizedDepartment);

        if (!resolvedDepartment) {
          const aliasTarget =
            departmentAliases.get(normalizedDepartment);

          if (aliasTarget) {
            resolvedDepartment = departmentMap.get(
              normalizeDepartmentName(aliasTarget)
            );

            if (resolvedDepartment) {
              departmentWarning =
                `Department "${department}" was mapped to "${resolvedDepartment.name}".`;
            }
          }
        }

        if (!resolvedDepartment) {

          results.skipped++;

          results.errors.push({
            row: excelRow,
            employee_id: employeeId,
            full_name: fullName,
            reason: `Department "${department}" was not found.`
          });

          continue;
        }

        departmentId = resolvedDepartment.id;
        resolvedDepartmentName = resolvedDepartment.name;
      }

      // ---------------------------------------------
      // CHECK DUPLICATE EMPLOYEE ID
      // ---------------------------------------------

      const [existing] = await connection.query(
        `
        SELECT id
        FROM employees
        WHERE employee_id = ?
        LIMIT 1
        `,
        [employeeId]
      );

      if (existing.length) {

        results.skipped++;

        results.errors.push({
          row: excelRow,
          employee_id: employeeId,
          full_name: fullName,
          reason: 'Employee ID already exists.'
        });

        continue;
      }

      // ---------------------------------------------
      // INSERT EMPLOYEE
      // ---------------------------------------------

      try {
        await connection.query(
          `
          INSERT INTO employees
          (
            employee_id,
            full_name,
            email,
            department_id,
            position_title,
            status
          )
          VALUES (?, ?, ?, ?, ?, ?)
          `,
          [
            employeeId,
            fullName,
            email || null,
            departmentId,
            position || null,
            status
          ]
        );
      } catch (rowError) {
        results.skipped++;
        results.errors.push({
          row: excelRow,
          employee_id: employeeId,
          full_name: fullName,
          reason: rowError.code === 'ER_DUP_ENTRY'
            ? 'Employee ID or email already exists.'
            : rowError.message || 'Unable to import employee.'
        });
        continue;
      }

      results.imported++;

      results.successes.push({
        row: excelRow,
        employee_id: employeeId,
        full_name: fullName,
        email,
        department: resolvedDepartmentName,
        position,
        status
      });

      if (departmentWarning) {
        results.warnings.push({
          row: excelRow,
          employee_id: employeeId,
          message: departmentWarning
        });
      }
    }

    // ---------------------------------------------
    // AUDIT LOG
    // ---------------------------------------------

    await connection.query(
      `
      INSERT INTO audit_logs
      (
        user_id,
        action,
        entity_type,
        entity_id,
        details
      )
      VALUES (?, 'IMPORT', 'employees', NULL, ?)
      `,
      [
        req.session.user.id,
        JSON.stringify({
          filename: req.file.originalname,
          total: results.total,
          imported: results.imported,
          skipped: results.skipped,
          warnings: results.warnings.length,
          errors: results.errors.length
        })
      ]
    );

    await connection.commit();

    res.json({
      ok: true,
      message: 'Employee import completed.',
      results
    });

  } catch (error) {

    await connection.rollback();

    console.error('Employee import error:', error);

    res.status(500).json({
      message: 'Unable to import employees.',
      error: error.message
    });

  } finally {

    connection.release();
  }
});


// =====================================================
// ASSET EXCEL IMPORT
// =====================================================

function normalizeAssetLookup(value) {

  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

}


function normalizeExcelDate(value) {

  if (value === null || value === undefined || value === '') {
    return null;
  }


  // Excel serial date
  if (typeof value === 'number') {

    const date =
      XLSX.SSF.parse_date_code(value);

    if (!date) {
      return null;
    }

    return [
      date.y,
      String(date.m).padStart(2, '0'),
      String(date.d).padStart(2, '0')
    ].join('-');

  }


  const text =
    String(value).trim();


  if (!text) {
    return null;
  }


  // YYYY-MM-DD

  if (
    /^\d{4}-\d{2}-\d{2}$/.test(text)
  ) {

    return text;

  }


  // MM/DD/YYYY

  const slashMatch =
    text.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
    );


  if (slashMatch) {

    const month =
      String(slashMatch[1]).padStart(2, '0');

    const day =
      String(slashMatch[2]).padStart(2, '0');

    const year =
      slashMatch[3];

    return `${year}-${month}-${day}`;

  }


  // MM-DD-YYYY

  const dashMatch =
    text.match(
      /^(\d{1,2})-(\d{1,2})-(\d{4})$/
    );


  if (dashMatch) {

    const month =
      String(dashMatch[1]).padStart(2, '0');

    const day =
      String(dashMatch[2]).padStart(2, '0');

    const year =
      dashMatch[3];

    return `${year}-${month}-${day}`;

  }


  return null;

}


// ============================================================
// IMPORT ASSETS FROM EXCEL / CSV
// ============================================================

app.get('/api/import/template/assets', requireAdmin, (req, res) => {

  try {

    const workbook = XLSX.utils.book_new();

    const headers = [
      'Asset Name',
      'Category',
      'Brand',
      'Model',
        'Serial Number',
      'Barcode',
      'Purchase Date',
      'Purchase Cost',
      'Warranty Expiry',
      'Condition',
      'Location',
      'Notes'
    ];

    const worksheet = XLSX.utils.aoa_to_sheet([
      headers,
      [
        'Laptop',
        'Laptop',
        'Dell',
        'Latitude 5420',
        'TEST-SERIAL-001',
        'TEST-BARCODE-001',
        '2026-01-15',
        45000,
        '2029-01-15',
        'Good',
        'IT Room',
        'Sample only'
      ]
    ]);

    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      'Assets'
    );

    const buffer = XLSX.write(
      workbook,
      {
        type: 'buffer',
        bookType: 'xlsx'
      }
    );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    res.setHeader(
      'Content-Disposition',
      'attachment; filename="asset-import-template.xlsx"'
    );

    res.send(buffer);

  } catch (error) {

    console.error(
      'ASSET IMPORT TEMPLATE ERROR:',
      error
    );

    res.status(500).json({
      message: 'Unable to generate asset import template.'
    });

  }

});


app.post(
  '/api/assets/import',
  requireAdmin,
  upload.single('file'),
  async (req, res) => {

    if (!req.file) {

      return res.status(400).json({
        ok: false,
        message: 'Please upload an Excel or CSV file.'
      });

    }

    let connection;

    try {

      // ========================================================
      // READ EXCEL FILE
      // ========================================================

      const workbook =
        XLSX.read(
          req.file.buffer,
          {
            type: 'buffer',
            cellDates: true
          }
        );

      const sheetName =
        workbook.SheetNames[0];

      if (!sheetName) {

        return res.status(400).json({
          ok: false,
          message: 'The uploaded file does not contain a worksheet.'
        });

      }

      const worksheet =
        workbook.Sheets[sheetName];

      const rows =
        XLSX.utils.sheet_to_json(
          worksheet,
          {
            defval: '',
            raw: true
          }
        );

      if (!rows.length) {

        return res.status(400).json({
          ok: false,
          message: 'The uploaded worksheet is empty.'
        });

      }


      // ========================================================
      // HELPER - NORMALIZE LOOKUP VALUE
      // ========================================================

      function normalizeLookup(value) {

        return String(value ?? '')
          .trim()
          .replace(/\s+/g, ' ')
          .toLowerCase();

      }


      // ========================================================
      // HELPER - NORMALIZE EXCEL DATE
      // ========================================================

      function normalizeExcelDate(value) {

        if (
          value === null ||
          value === undefined ||
          value === ''
        ) {

          return null;

        }


        // ------------------------------------------------------
        // JavaScript Date
        // ------------------------------------------------------

        if (value instanceof Date) {

          if (Number.isNaN(value.getTime())) {
            return null;
          }

          return value
            .toISOString()
            .slice(0, 10);

        }


        // ------------------------------------------------------
        // Excel serial number
        // ------------------------------------------------------

        if (
          typeof value === 'number' &&
          Number.isFinite(value)
        ) {

          try {

            const parsed =
              XLSX.SSF.parse_date_code(value);

            if (parsed) {

              const year =
                String(parsed.y).padStart(4, '0');

              const month =
                String(parsed.m).padStart(2, '0');

              const day =
                String(parsed.d).padStart(2, '0');

              return `${year}-${month}-${day}`;

            }

          } catch (error) {

            console.error(
              'Excel date parse error:',
              error
            );

          }

          return null;

        }


        // ------------------------------------------------------
        // String date
        // ------------------------------------------------------

        const text =
          String(value)
            .trim();


        if (!text) {
          return null;
        }


        // YYYY-MM-DD

        let match =
          text.match(
            /^(\d{4})-(\d{1,2})-(\d{1,2})$/
          );

        if (match) {

          const year =
            match[1];

          const month =
            String(match[2]).padStart(2, '0');

          const day =
            String(match[3]).padStart(2, '0');

          return `${year}-${month}-${day}`;

        }


        // MM/DD/YYYY

        match =
          text.match(
            /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
          );

        if (match) {

          const month =
            String(match[1]).padStart(2, '0');

          const day =
            String(match[2]).padStart(2, '0');

          const year =
            match[3];

          return `${year}-${month}-${day}`;

        }


        // MM-DD-YYYY

        match =
          text.match(
            /^(\d{1,2})-(\d{1,2})-(\d{4})$/
          );

        if (match) {

          const month =
            String(match[1]).padStart(2, '0');

          const day =
            String(match[2]).padStart(2, '0');

          const year =
            match[3];

          return `${year}-${month}-${day}`;

        }


        // ------------------------------------------------------
        // Last attempt using JavaScript Date
        // ------------------------------------------------------

        const parsedDate =
          new Date(text);

        if (
          !Number.isNaN(
            parsedDate.getTime()
          )
        ) {

          return parsedDate
            .toISOString()
            .slice(0, 10);

        }


        return null;

      }
      // ========================================================
      // HELPER - NORMALIZE MONEY
      // ========================================================

      function normalizeMoney(value) {

        if (
          value === null ||
          value === undefined ||
          value === ''
        ) {

          return null;

        }


        if (
          typeof value === 'number' &&
          Number.isFinite(value)
        ) {

          if (value < 0) {
            return null;
          }

          return value;

        }


        const text =
          String(value)
            .trim()
            .replace(/₱/g, '')
            .replace(/PHP/gi, '')
            .replace(/,/g, '')
            .replace(/\s/g, '');


        if (!text) {
          return null;
        }


        const number =
          Number(text);


        if (
          !Number.isFinite(number) ||
          number < 0
        ) {

          return null;

        }


        return number;

      }


      // ========================================================
      // HELPER - GET EXCEL COLUMN
      // ========================================================

      function getValue(row, ...names) {

        for (const name of names) {

          if (
            Object.prototype.hasOwnProperty.call(
              row,
              name
            )
          ) {

            return row[name];

          }

        }

        return '';

      }


      // ========================================================
      // LOAD CATEGORIES
      // ========================================================

      const [categoryRows] =
        await pool.query(
          `
          SELECT
            id,
            name
          FROM asset_categories
          ORDER BY name
          `
        );


      const categoryMap =
        new Map();

      const categoryNameById =
        new Map();


      categoryRows.forEach(
        category => {

          categoryMap.set(
            normalizeLookup(category.name),
            category.id
          );

          categoryNameById.set(
            Number(category.id),
            category.name
          );

        }
      );


      // ========================================================
      // CATEGORY ALIASES
      // ========================================================
      //
      // These aliases map Excel names to existing categories.
      //
      // Example:
      //
      // Network Device
      // Network Switch
      // Access Point
      //
      // all become:
      //
      // Network Equipment
      //
      // ========================================================

      const categoryAliases = {

        // ------------------------------------------------------
        // COMPUTERS
        // ------------------------------------------------------

        'notebook':
          'laptop',

        'notebook computer':
          'laptop',

        'laptop computer':
          'laptop',

        'pc':
          'desktop',

        'desktop computer':
          'desktop',


        // ------------------------------------------------------
        // NETWORK
        // ------------------------------------------------------

        'network device':
          'network equipment',

        'network devices':
          'network equipment',

        'network switch':
          'network equipment',

        'switch':
          'network equipment',

        'network switches':
          'network equipment',

        'access point':
          'network equipment',

        'wireless access point':
          'network equipment',

        'wifi access point':
          'network equipment',

        'wi-fi access point':
          'network equipment',

        'router':
          'network equipment',

        'firewall':
          'network equipment',

        'network router':
          'network equipment',


        // ------------------------------------------------------
        // KEYBOARD / MOUSE
        // ------------------------------------------------------

        'keyboard/mouse':
          'other',

        'keyboard mouse':
          'other',

        'keyboard and mouse':
          'other',

        'keyboard & mouse':
          'other',

        'mouse/keyboard':
          'other',


        // ------------------------------------------------------
        // STORAGE
        // ------------------------------------------------------

        'nas':
          'nas / storage',

        'nas storage':
          'nas / storage',

        'network attached storage':
          'nas / storage',

        'storage':
          'nas / storage',

        'hard drive':
          'nas / storage',

        'hdd':
          'nas / storage',

        'ssd':
          'nas / storage',

        'solid state drive':
          'nas / storage',


        // ------------------------------------------------------
        // RAM
        // ------------------------------------------------------

        'memory':
          'ram',

        'memory module':
          'ram',

        'ram module':
          'ram',

        'memory card':
          'ram',


        // ------------------------------------------------------
        // CAMERA / VIDEO
        // ------------------------------------------------------

        'web camera':
          'webcam',

        'web cam':
          'webcam',

        'camera':
          'webcam',


        // ------------------------------------------------------
        // DOCK
        // ------------------------------------------------------

        'dock':
          'docking station',

        'docking':
          'docking station',

        'usb dock':
          'docking station',

        'usb-c dock':
          'docking station',

        'usb c dock':
          'docking station'


      };


      // ========================================================
      // FALLBACK CATEGORIES
      // ========================================================

      function resolveCategory(
        rawCategory
      ) {

        const original =
          String(
            rawCategory ?? ''
          ).trim();


        if (!original) {

          return {
            id: null,
            name: '',
            mapped: false
          };

        }


        const normalized =
          normalizeLookup(
            original
          );


        // ------------------------------------------------------
        // Exact match
        // ------------------------------------------------------

        if (
          categoryMap.has(
            normalized
          )
        ) {

          return {

            id:
              categoryMap.get(
                normalized
              ),

            name:
              original,

            mapped:
              false

          };

        }


        // ------------------------------------------------------
        // Alias
        // ------------------------------------------------------

        const alias =
          categoryAliases[
            normalized
          ];


        if (alias) {

          const aliasNormalized =
            normalizeLookup(
              alias
            );


          if (
            categoryMap.has(
              aliasNormalized
            )
          ) {

            return {

              id:
                categoryMap.get(
                  aliasNormalized
                ),

              name:
                alias,

              mapped:
                true

            };

          }

        }


        // ------------------------------------------------------
        // Automatic fallback to "Other"
        // ------------------------------------------------------

        if (
          categoryMap.has('other')
        ) {

          return {

            id:
              categoryMap.get('other'),

            name:
              'Other',

            mapped:
              true

          };

        }


        return {

          id: null,
          name: '',
          mapped: false

        };

      }


      // ========================================================
      // LOAD LOCATIONS
      // ========================================================

      const [locationRows] =
        await pool.query(
          `
          SELECT
            id,
            name
          FROM locations
          ORDER BY name
          `
        );


      const locationMap =
        new Map();

      const locationNameById =
        new Map();


      locationRows.forEach(
        location => {

          locationMap.set(
            normalizeLookup(location.name),
            location.id
          );

          locationNameById.set(
            Number(location.id),
            location.name
          );

        }
      );


      // ========================================================
      // RESOLVE EXISTING LOCATION
      // ========================================================

      async function resolveLocation(
        rawLocation
      ) {

        const original =
          String(
            rawLocation ?? ''
          ).trim();


        // Blank location is allowed.

        if (!original) {

          return {
            id: null,
            name: '',
            created: false
          };

        }


        const normalized =
          normalizeLookup(
            original
          );


        // Existing location

        if (
          locationMap.has(
            normalized
          )
        ) {

          const locationId =
            locationMap.get(
              normalized
            );

          return {

            id:
              locationId,

            name:
              locationNameById.get(
                Number(locationId)
              ) || original,

            created:
              false

          };

        }

        throw new Error(
          `Location "${original}" was not found.`
        );

      }


      // ========================================================
      // VALID VALUES
      // ========================================================

      const validConditions = [
        'New',
        'Good',
        'Fair',
        'Damaged'
      ];


      // ========================================================
      // STATUS NORMALIZATION
      // ========================================================

      function resolveCondition(
        value
      ) {

        const normalized =
          normalizeLookup(
            value
          );


        const found =
          validConditions.find(
            item =>
              normalizeLookup(item) ===
              normalized
          );


        return found || null;

      }


      // ========================================================
      // CONNECT TO DATABASE
      // ========================================================

      connection =
        await pool.getConnection();


      await connection.beginTransaction();


      // ========================================================
      // CURRENT YEAR
      // ========================================================

      const currentYear =
        new Date()
          .getFullYear();


   // ========================================================
// FIND NEXT PRIMA ASSET NUMBER
// ========================================================

const [
  assetNumberRows
] =
  await connection.query(
    `
    SELECT
      MAX(
        CAST(
          SUBSTRING_INDEX(asset_id, '-', -1)
          AS UNSIGNED
        )
      ) AS max_number
    FROM assets
    WHERE asset_id LIKE ?
    `,
    [
      `PRIMA-${currentYear}-%`
    ]
  );


let nextAssetNumber =
  Number(
    assetNumberRows[0]?.max_number || 0
  ) + 1;


// ========================================================
// MAKE SURE GENERATED ASSET ID DOES NOT ALREADY EXIST
// ========================================================

while (true) {

  const testAssetId =
    `PRIMA-${currentYear}-${String(
      nextAssetNumber
    ).padStart(
      6,
      '0'
    )}`;


  const [
    duplicateAssetRows
  ] =
    await connection.query(
      `
      SELECT
        id
      FROM assets
      WHERE asset_id = ?
      LIMIT 1
      `,
      [
        testAssetId
      ]
    );


  if (
    duplicateAssetRows.length === 0
  ) {

    break;

  }


  nextAssetNumber++;

}
      // ========================================================
      // EXISTING SERIAL NUMBERS
      // ========================================================

      const [
        existingSerialRows
      ] =
        await connection.query(
          `
          SELECT
            serial_number
          FROM assets
          WHERE serial_number IS NOT NULL
            AND TRIM(serial_number) <> ''
          `
        );


      const existingSerials =
        new Set();


      existingSerialRows.forEach(
        row => {

          existingSerials.add(
            normalizeLookup(
              row.serial_number
            )
          );

        }
      );


      // ========================================================
      // EXISTING BARCODES
      // ========================================================

      const [
        existingBarcodeRows
      ] =
        await connection.query(
          `
          SELECT
            barcode
          FROM assets
          WHERE barcode IS NOT NULL
            AND TRIM(barcode) <> ''
          `
        );


      const existingBarcodes =
        new Set();


      existingBarcodeRows.forEach(
        row => {

          existingBarcodes.add(
            normalizeLookup(
              row.barcode
            )
          );

        }
      );


      // ========================================================
      // IMPORT TRACKING
      // ========================================================

      let imported =
        0;

      let skipped =
        0;

      const errors =
        [];

      const warnings =
        [];

      const successes =
        [];


      // ========================================================
      // DUPLICATES INSIDE THIS EXCEL FILE
      // ========================================================

      const importSerials =
        new Set();

      const importBarcodes =
        new Set();


      // ========================================================
      // PROCESS EACH ROW
      // ========================================================

      for (
        let index = 0;
        index < rows.length;
        index++
      ) {

        const row =
          rows[index];


        const excelRowNumber =
          index + 2;


        try {

          // ----------------------------------------------------
          // GET VALUES
          // ----------------------------------------------------

          const assetName =
            String(
              getValue(
                row,
                'Asset Name',
                'asset_name'
              ) || ''
            ).trim();


          const rawCategory =
            String(
              getValue(
                row,
                'Category',
                'category'
              ) || ''
            ).trim();


          const brand =
            String(
              getValue(
                row,
                'Brand',
                'brand'
              ) || ''
            ).trim();


          const model =
            String(
              getValue(
                row,
                'Model',
                'model'
              ) || ''
            ).trim();


          const serialNumber =
            String(
              getValue(
                row,
                'Serial Number',
                'serial_number'
              ) || ''
            ).trim();


          const barcode =
            String(
              getValue(
                row,
                'Barcode',
                'barcode'
              ) || ''
            ).trim();


          const purchaseDate =
            normalizeExcelDate(
              getValue(
                row,
                'Purchase Date',
                'purchase_date'
              )
            );


          const purchaseCost =
            normalizeMoney(
              getValue(
                row,
                'Purchase Cost',
                'purchase_cost'
              )
            );


          const warrantyExpiry =
            normalizeExcelDate(
              getValue(
                row,
                'Warranty Expiry',
                'warranty_expiry'
              )
            );


          const rawCondition =
            String(
              getValue(
                row,
                'Condition',
                'condition',
                'condition_status'
              ) || ''
            ).trim();


          const rawLocation =
            String(
              getValue(
                row,
                'Location',
                'location'
              ) || ''
            ).trim();


          const notes =
            String(
              getValue(
                row,
                'Notes',
                'notes'
              ) || ''
            ).trim();


          // ----------------------------------------------------
          // VALIDATE ASSET NAME
          // ----------------------------------------------------

          if (!assetName) {

            throw new Error(
              'Asset Name is required.'
            );

          }


          // ----------------------------------------------------
          // RESOLVE CATEGORY
          // ----------------------------------------------------

          const category =
            resolveCategory(
              rawCategory
            );


          if (!category.id) {

            throw new Error(
              `Category "${rawCategory}" was not found and "Other" is not available.`
            );

          }


          // ----------------------------------------------------
          // CATEGORY WARNING
          // ----------------------------------------------------

          if (
            category.mapped &&
            rawCategory
          ) {

            warnings.push({

              row:
                excelRowNumber,

              asset_name:
                assetName,

              message:
                `Category "${rawCategory}" was mapped to "${category.name}".`

            });

          }


          // ----------------------------------------------------
          // CONDITION
          // ----------------------------------------------------

          const condition =
            resolveCondition(
              rawCondition ||
              'Good'
            );


          if (!condition) {

            throw new Error(
              `Invalid Condition "${rawCondition}". Allowed values: ${validConditions.join(', ')}.`
            );

          }


          // ----------------------------------------------------
          // INITIAL STATUS
          // ----------------------------------------------------

          const status =
            'Available';


          // ----------------------------------------------------
          // SERIAL NUMBER DUPLICATE
          // ----------------------------------------------------

          if (serialNumber) {

            const normalizedSerial =
              normalizeLookup(
                serialNumber
              );


            if (
              existingSerials.has(
                normalizedSerial
              )
            ) {

              throw new Error(
                `Serial Number "${serialNumber}" already exists.`
              );

            }


            if (
              importSerials.has(
                normalizedSerial
              )
            ) {

              throw new Error(
                `Serial Number "${serialNumber}" is duplicated in this Excel file.`
              );

            }

          }


          // ----------------------------------------------------
          // BARCODE DUPLICATE
          // ----------------------------------------------------

          if (barcode) {

            const normalizedBarcode =
              normalizeLookup(
                barcode
              );


            if (
              existingBarcodes.has(
                normalizedBarcode
              )
            ) {

              throw new Error(
                `Barcode "${barcode}" already exists.`
              );

            }


            if (
              importBarcodes.has(
                normalizedBarcode
              )
            ) {

              throw new Error(
                `Barcode "${barcode}" is duplicated in this Excel file.`
              );

            }

          }


          // ----------------------------------------------------
          // LOCATION
          // ----------------------------------------------------

          const location =
            await resolveLocation(
              rawLocation
            );


          // ----------------------------------------------------
          // GENERATE ASSET ID
          // ----------------------------------------------------

          const assetId =
            `PRIMA-${currentYear}-${String(
              nextAssetNumber
            ).padStart(
              6,
              '0'
            )}`;


          nextAssetNumber++;


          // ----------------------------------------------------
          // INSERT ASSET
          // ----------------------------------------------------

          const [
            result
          ] =
            await connection.query(
              `
              INSERT INTO assets
              (
                asset_id,
                asset_name,
                category_id,
                brand,
                model,
                serial_number,
                barcode,
                purchase_date,
                purchase_cost,
                warranty_expiry,
                condition_status,
                status,
                location_id,
                notes
              )
              VALUES
              (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `,
              [

                assetId,

                assetName,

                category.id,

                brand || null,

                model || null,

                serialNumber || null,

                barcode || null,

                purchaseDate,

                purchaseCost,

                warrantyExpiry,

                condition,

                status,

                location.id,

                notes || null

              ]
            );


          // ----------------------------------------------------
          // ASSET HISTORY
          // ----------------------------------------------------

          await connection.query(
            `
            INSERT INTO asset_history
            (
              asset_id,
              action,
              from_status,
              to_status,
              from_employee_id,
              to_employee_id,
              remarks,
              performed_by
            )
            VALUES
            (?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [

              result.insertId,

              'Asset Imported',

              null,

              status,

              null,

              null,

              'Imported from Excel',

              req.session.user.id

            ]
          );


          // ----------------------------------------------------
          // TRACK IMPORTED VALUES
          // ----------------------------------------------------

          if (serialNumber) {

            importSerials.add(
              normalizeLookup(
                serialNumber
              )
            );

            existingSerials.add(
              normalizeLookup(
                serialNumber
              )
            );

          }


          if (barcode) {

            importBarcodes.add(
              normalizeLookup(
                barcode
              )
            );

            existingBarcodes.add(
              normalizeLookup(
                barcode
              )
            );

          }


          successes.push({

            row:
              excelRowNumber,

            asset_id:
              assetId,

            asset_name:
              assetName,

            serial_number:
              serialNumber,

            barcode,

            category:
              categoryNameById.get(
                Number(category.id)
              ) || category.name,

            location:
              location.id
                ? locationNameById.get(
                    Number(location.id)
                  ) || location.name
                : '',

            status

          });


          imported++;

        } catch (rowError) {

          skipped++;

          errors.push({

            row:
              excelRowNumber,

            asset_name:
              String(
                row['Asset Name'] ||
                row['asset_name'] ||
                ''
              ).trim(),

            reason:
              rowError.message ||
              'Unknown import error.'

          });

        }

      }


      // ========================================================
      // AUDIT LOG
      // ========================================================

      await connection.query(
        `
        INSERT INTO audit_logs
        (
          user_id,
          action,
          entity_type,
          entity_id,
          details
        )
        VALUES
        (?, ?, ?, ?, ?)
        `,
        [

          req.session.user.id,

          'IMPORT',

          'asset',

          null,

          JSON.stringify({

            filename:
              req.file.originalname,

            total:
              rows.length,

            imported,

            skipped,

            warnings:
              warnings.length,

            errors:
              errors.length

          })

        ]
      );


      // ========================================================
      // COMMIT
      // ========================================================

      await connection.commit();


      // ========================================================
      // RESPONSE
      // ========================================================

      return res.json({

        ok:
          true,

        total:
          rows.length,

        imported,

        skipped,

        errors,

        warnings,

        successes

      });

    } catch (error) {

      // ========================================================
      // ROLLBACK
      // ========================================================

      if (connection) {

        try {

          await connection.rollback();

        } catch (rollbackError) {

          console.error(
            'Rollback error:',
            rollbackError
          );

        }

      }


      console.error(
        'Asset import error:',
        error
      );


      return res.status(500).json({

        ok:
          false,

        message:
          'Unable to import assets.',

        error:
          error.message

      });

    } finally {

      // ========================================================
      // RELEASE CONNECTION
      // ========================================================

      if (connection) {

        connection.release();

      }

    }

  }
);

// =====================================================
// ASSIGN ASSETS TO EMPLOYEE
// ============================================

app.post(
  '/api/assets/assign',
  requireAdmin,
  async (req, res) => {

    const connection = await pool.getConnection();

    try {

      const {
        asset_ids,
        employee_id,
        assigned_at,
        remarks
      } = req.body;

      // ----------------------------------------
      // VALIDATION
      // ----------------------------------------

      if (
        !Array.isArray(asset_ids) ||
        asset_ids.length === 0
      ) {
        return res.status(400).json({
          message: 'Please select at least one asset.'
        });
      }

      if (!employee_id) {
        return res.status(400).json({
          message: 'Employee is required.'
        });
      }

      // ----------------------------------------
      // CHECK EMPLOYEE
      // ----------------------------------------

      const [employeeRows] = await connection.query(
        `
        SELECT
          id,
          employee_id,
          full_name,
          department_id,
          status
        FROM employees
        WHERE id = ?
        LIMIT 1
        `,
        [employee_id]
      );

      if (employeeRows.length === 0) {
        return res.status(404).json({
          message: 'Employee not found.'
        });
      }

      const employee = employeeRows[0];

      if (employee.status !== 'active') {
        return res.status(400).json({
          message: 'The selected employee is not active.'
        });
      }

      // ----------------------------------------
      // BEGIN TRANSACTION
      // ----------------------------------------

      await connection.beginTransaction();

      let assignedCount = 0;

      let assignedAtValue = null;

      if (assigned_at) {

        assignedAtValue =
          assigned_at.replace('T', ' ');

        // Add seconds if they are not included
        if (assignedAtValue.length === 16) {
          assignedAtValue += ':00';
        }
      }

      // ----------------------------------------
      // PROCESS EACH ASSET
      // ----------------------------------------

      for (const rawAssetId of asset_ids) {

        const assetId = Number(rawAssetId);

        if (!Number.isInteger(assetId)) {
          throw new Error(
            'Invalid asset ID.'
          );
        }

        // --------------------------------------
        // LOCK ASSET
        // --------------------------------------

        const [assetRows] = await connection.query(
          `
          SELECT
            id,
            asset_id,
            asset_name,
            status
          FROM assets
          WHERE id = ?
          FOR UPDATE
          `,
          [assetId]
        );

        if (assetRows.length === 0) {
          throw new Error(
            `Asset ID ${assetId} was not found.`
          );
        }

        const asset = assetRows[0];

        // --------------------------------------
        // ONLY AVAILABLE ASSETS
        // --------------------------------------

        if (asset.status !== 'Available') {
          throw new Error(
            `${asset.asset_id} (${asset.asset_name}) is currently ${asset.status} and cannot be assigned.`
          );
        }

        // --------------------------------------
        // CHECK ACTIVE ASSIGNMENT
        // --------------------------------------

        const [activeAssignmentRows] =
          await connection.query(
            `
            SELECT
              aa.id,
              aa.employee_id,
              e.employee_id AS employee_code,
              e.full_name
            FROM asset_assignments aa
            INNER JOIN employees e
              ON e.id = aa.employee_id
            WHERE aa.asset_id = ?
              AND aa.returned_at IS NULL
            ORDER BY aa.id DESC
            LIMIT 1
            `,
            [asset.id]
          );

        if (activeAssignmentRows.length > 0) {

          const currentCustodian =
            activeAssignmentRows[0];

          throw new Error(
            `${asset.asset_id} (${asset.asset_name}) is already assigned to ${currentCustodian.full_name}.`
          );
        }

        // --------------------------------------
        // INSERT ASSIGNMENT
        // --------------------------------------

        await connection.query(
          `
          INSERT INTO asset_assignments
          (
            asset_id,
            employee_id,
            assigned_by,
            assigned_at,
            returned_at,
            remarks
          )
          VALUES (?, ?, ?, ?, NULL, ?)
          `,
          [
            asset.id,
            employee.id,
            req.session.user.id,
            assignedAtValue || new Date(),
            remarks || null
          ]
        );

        // --------------------------------------
        // UPDATE ASSET STATUS
        // --------------------------------------

        await connection.query(
          `
          UPDATE assets
          SET status = 'Assigned'
          WHERE id = ?
          `,
          [asset.id]
        );

        // --------------------------------------
        // ASSET HISTORY
        // --------------------------------------

        await connection.query(
          `
          INSERT INTO asset_history
          (
            asset_id,
            action,
            from_status,
            to_status,
            from_employee_id,
            to_employee_id,
            remarks,
            performed_by
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            asset.id,
            'Asset Assigned',
            'Available',
            'Assigned',
            null,
            employee.id,
            remarks ||
              `Assigned to ${employee.full_name}`,
            req.session.user.id
          ]
        );

        // --------------------------------------
        // AUDIT LOG
        // --------------------------------------

        await connection.query(
          `
          INSERT INTO audit_logs
          (
            user_id,
            action,
            entity_type,
            entity_id,
            details
          )
          VALUES (?, ?, ?, ?, ?)
          `,
          [
            req.session.user.id,
            'ASSIGN',
            'asset',
            asset.id,
            JSON.stringify({
              asset_id: asset.asset_id,
              asset_name: asset.asset_name,
              employee_id: employee.employee_id,
              employee_name: employee.full_name,
              remarks: remarks || null
            })
          ]
        );

        assignedCount++;
      }

      // ----------------------------------------
      // COMMIT
      // ----------------------------------------

      await connection.commit();

      res.json({
        ok: true,
        assigned: assignedCount,

        employee: {
          id: employee.id,
          employee_id: employee.employee_id,
          full_name: employee.full_name
        }
      });

    } catch (error) {

      // ----------------------------------------
      // ROLLBACK
      // ----------------------------------------

      await connection.rollback();

      console.error(
        'Asset assignment error:',
        error
      );

      res.status(400).json({
        message:
          error.message ||
          'Unable to assign assets.'
      });

    } finally {

      connection.release();

    }
  }
);

// ============================================
// RETURN ASSET FROM EMPLOYEE
// ============================================

app.post(
  '/api/assets/return',
  requireAdmin,
  async (req, res) => {

    const connection = await pool.getConnection();

    try {

      const {
        asset_id,
        returned_at,
        remarks
      } = req.body;

      // ----------------------------------------
      // VALIDATION
      // ----------------------------------------

      const assetId = Number(asset_id);

      if (!Number.isInteger(assetId)) {
        return res.status(400).json({
          message: 'Invalid asset ID.'
        });
      }

      // ----------------------------------------
      // BEGIN TRANSACTION
      // ----------------------------------------

      await connection.beginTransaction();

      // ----------------------------------------
      // LOCK ASSET
      // ----------------------------------------

      const [assetRows] = await connection.query(
        `
        SELECT
          a.id,
          a.asset_id,
          a.asset_name,
          a.status
        FROM assets a
        WHERE a.id = ?
        FOR UPDATE
        `,
        [assetId]
      );

      if (assetRows.length === 0) {
        throw new Error('Asset not found.');
      }

      const asset = assetRows[0];

      // ----------------------------------------
      // ASSET MUST BE ASSIGNED
      // ----------------------------------------

      if (asset.status !== 'Assigned') {
        throw new Error(
          `${asset.asset_id} is currently ${asset.status} and cannot be returned.`
        );
      }

      // ----------------------------------------
      // GET CURRENT ASSIGNMENT
      // ----------------------------------------

      const [assignmentRows] = await connection.query(
        `
        SELECT
          aa.id,
          aa.employee_id,
          aa.assigned_at,
          e.employee_id AS custodian_employee_id,
          e.full_name AS custodian_name
        FROM asset_assignments aa
        INNER JOIN employees e
          ON e.id = aa.employee_id
        WHERE aa.asset_id = ?
          AND aa.returned_at IS NULL
        ORDER BY aa.id DESC
        LIMIT 1
        FOR UPDATE
        `,
        [asset.id]
      );

      if (assignmentRows.length === 0) {
        throw new Error(
          'No active assignment was found for this asset.'
        );
      }

      const assignment = assignmentRows[0];

      // ----------------------------------------
      // RETURN DATE
      // ----------------------------------------

      let returnedAtValue = null;

      if (returned_at) {

        returnedAtValue =
          String(returned_at).replace('T', ' ');

        if (returnedAtValue.length === 16) {
          returnedAtValue += ':00';
        }

      } else {

        returnedAtValue =
          new Date();

      }

      // ----------------------------------------
      // CLOSE ASSIGNMENT
      // ----------------------------------------

      await connection.query(
        `
        UPDATE asset_assignments
        SET
          returned_at = ?,
          remarks = ?
        WHERE id = ?
        `,
        [
          returnedAtValue,
          remarks || null,
          assignment.id
        ]
      );

      // ----------------------------------------
      // UPDATE ASSET STATUS
      // ----------------------------------------

      await connection.query(
        `
        UPDATE assets
        SET status = 'Available'
        WHERE id = ?
        `,
        [asset.id]
      );

      // ----------------------------------------
      // ASSET HISTORY
      // ----------------------------------------

      await connection.query(
        `
        INSERT INTO asset_history
        (
          asset_id,
          action,
          from_status,
          to_status,
          from_employee_id,
          to_employee_id,
          remarks,
          performed_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          asset.id,
          'Asset Returned',
          'Assigned',
          'Available',
          assignment.employee_id,
          null,
          remarks ||
            `Returned by ${assignment.custodian_name}`,
          req.session.user.id
        ]
      );

      // ----------------------------------------
      // AUDIT LOG
      // ----------------------------------------

      await connection.query(
        `
        INSERT INTO audit_logs
        (
          user_id,
          action,
          entity_type,
          entity_id,
          details
        )
        VALUES (?, ?, ?, ?, ?)
        `,
        [
          req.session.user.id,
          'RETURN',
          'asset',
          asset.id,
          JSON.stringify({
            asset_id: asset.asset_id,
            asset_name: asset.asset_name,
            employee_id:
              assignment.custodian_employee_id,
            employee_name:
              assignment.custodian_name,
            remarks:
              remarks || null
          })
        ]
      );

      // ----------------------------------------
      // COMMIT
      // ----------------------------------------

      await connection.commit();

      res.json({
        ok: true,
        message: 'Asset returned successfully.',
        asset: {
          id: asset.id,
          asset_id: asset.asset_id,
          asset_name: asset.asset_name
        },
        employee: {
          employee_id:
            assignment.custodian_employee_id,
          full_name:
            assignment.custodian_name
        }
      });

    } catch (error) {

      await connection.rollback();

      console.error(
        'Asset return error:',
        error
      );

      res.status(400).json({
        message:
          error.message ||
          'Unable to return asset.'
      });

    } finally {

      connection.release();

    }

  }
);

// ============================================
// SCAN ASSET BY ASSET ID / BARCODE / SERIAL
// ============================================

app.get(
  '/api/assets/scan/:code',
  requireLogin,
  async (req, res) => {

    try {

      const code = String(
        req.params.code || ''
      ).trim();

      if (!code) {

        return res.status(400).json({
          ok: false,
          message: 'Scan value is required.'
        });

      }

      const [rows] = await pool.query(
        `
        SELECT
          a.id,
          a.asset_id,
          a.asset_name,
          a.brand,
          a.model,
          a.serial_number,
          a.barcode,
          a.purchase_date,
          a.purchase_cost,
          a.warranty_expiry,
          a.condition_status,
          a.status,
          a.notes,

          c.id AS category_id,
          c.name AS category_name,

          l.id AS location_id,
          l.name AS location_name,

          e.id AS employee_id,
          e.employee_id AS employee_code,
          e.full_name AS custodian_name,

          d.name AS department_name

        FROM assets a

        LEFT JOIN asset_categories c
          ON c.id = a.category_id

        LEFT JOIN locations l
          ON l.id = a.location_id

        LEFT JOIN asset_assignments aa
          ON aa.asset_id = a.id
          AND aa.returned_at IS NULL

        LEFT JOIN employees e
          ON e.id = aa.employee_id

        LEFT JOIN departments d
          ON d.id = e.department_id

        WHERE
          a.asset_id = ?
          OR a.barcode = ?
          OR a.serial_number = ?

        LIMIT 1
        `,
        [
          code,
          code,
          code
        ]
      );

      if (!rows.length) {

        return res.status(404).json({
          ok: false,
          message: 'Asset not found.'
        });

      }

      const asset = rows[0];

      res.json({
        ok: true,
        asset
      });

    } catch (error) {

      console.error(
        'Asset scan error:',
        error
      );

      res.status(500).json({
        ok: false,
        message: 'Failed to search asset.'
      });

    }

  }
);

// ============================================================
// INVENTORY MODE - PHASE 1 + PHASE 2 + PHASE 3
// Inventory is an audit. These routes only write inventory_sessions,
// inventory_items, and audit_logs. They never correct live asset data.
// ============================================================

const INVENTORY_SCOPE_TYPES = new Set([
  'All Assets',
  'Department',
  'Location',
  'Category',
  'Custodian'
]);

const INVENTORY_VERIFICATION_STATUSES = new Set([
  'Not Yet Checked',
  'Verified',
  'Wrong Location',
  'Wrong Custodian',
  'Condition Changed',
  'Label Damaged',
  'Missing'
]);

const INVENTORY_ITEM_FILTERS = new Set([
  ...INVENTORY_VERIFICATION_STATUSES,
  'Discrepancies',
  'All Issues',
  'Label Issue'
]);

const INVENTORY_REVIEW_STATUSES = new Set([
  'Pending Review',
  'Reviewed',
  'Action Required',
  'Resolved',
  'No Change Required'
]);

const INVENTORY_VERIFICATION_METHODS = new Set([
  'QR',
  'Barcode',
  'Asset Tag',
  'Serial Number',
  'Manual Search'
]);

let inventoryIo = null;

function broadcastInventoryUpdate(sessionId, eventName, payload = {}) {
  if (!inventoryIo || !sessionId) return;

  inventoryIo
    .to(`inventory:${sessionId}`)
    .emit(eventName, {
      session_id: Number(sessionId),
      occurred_at: new Date().toISOString(),
      ...payload
    });
}

const INVENTORY_LABEL_CONDITIONS = new Set([
  'Good',
  'QR Unreadable',
  'Barcode Unreadable',
  'Damaged',
  'Missing Label'
]);

const INVENTORY_ASSET_CONDITIONS = new Set([
  'New',
  'Good',
  'Fair',
  'Damaged'
]);


function normalizeInventoryPositiveId(value) {

  const id = Number(value);

  return Number.isInteger(id) && id > 0
    ? id
    : null;

}


function normalizeInventoryNullableId(value) {

  if (value === null || value === undefined || String(value).trim() === '') {
    return { valid: true, value: null };
  }

  const id = normalizeInventoryPositiveId(value);

  return {
    valid: Boolean(id),
    value: id
  };

}


function inventoryPrimaryStatus({
  custodianMismatch,
  locationMismatch,
  conditionMismatch,
  labelIssue
}) {

  if (custodianMismatch) return 'Wrong Custodian';
  if (locationMismatch) return 'Wrong Location';
  if (conditionMismatch) return 'Condition Changed';
  if (labelIssue) return 'Label Damaged';
  return 'Verified';

}


function inventoryIssueList(row) {

  const issues = [];

  if (Number(row?.custodian_mismatch || 0)) issues.push('Wrong Custodian');
  if (Number(row?.location_mismatch || 0)) issues.push('Wrong Location');
  if (Number(row?.condition_mismatch || 0)) issues.push('Condition Changed');
  if (Number(row?.label_issue || 0)) {
    issues.push(String(row?.label_condition || 'Label Damaged'));
  }

  return issues;

}


function normalizeInventorySummary(row, sessionStatus = '') {

  const expected = Number(row?.expected_assets || 0);
  const checked = Number(row?.checked_assets || 0);
  const verified = Number(row?.verified || row?.verified_assets || 0);
  const notYetChecked = Number(
    row?.not_yet_checked ?? Math.max(0, expected - checked)
  );
  const progress = sessionStatus === 'Completed'
    ? 100
    : expected > 0
      ? Math.round((checked / expected) * 100)
      : 0;

  return {
    expected_assets: expected,
    checked_assets: checked,
    verified,
    verified_assets: verified,
    wrong_location: Number(row?.wrong_location || 0),
    wrong_custodian: Number(row?.wrong_custodian || 0),
    condition_changed: Number(row?.condition_changed || 0),
    label_issues: Number(row?.label_issues || 0),
    missing: Number(row?.missing || 0),
    not_yet_checked: notYetChecked,
    discrepancies: Number(row?.discrepancies || 0),
    progress_percentage: progress,
    progress_percent: progress
  };

}


function normalizeInventorySession(row) {

  if (!row) return null;

  return {
    ...row,
    ...normalizeInventorySummary(row, row.status)
  };

}


async function loadInventorySession(database, sessionId) {

  const [rows] = await database.query(`
    SELECT
      s.*,
      creator.full_name AS created_by_name,
      starter.full_name AS started_by_name,
      d.name AS department_name,
      l.name AS location_name,
      c.name AS category_name,
      e.full_name AS employee_name,
      e.employee_id AS employee_code,
      COALESCE(item_summary.expected_assets, 0) AS expected_assets,
      COALESCE(item_summary.checked_assets, 0) AS checked_assets,
      COALESCE(item_summary.verified, 0) AS verified,
      COALESCE(item_summary.wrong_location, 0) AS wrong_location,
      COALESCE(item_summary.wrong_custodian, 0) AS wrong_custodian,
      COALESCE(item_summary.condition_changed, 0) AS condition_changed,
      COALESCE(item_summary.label_issues, 0) AS label_issues,
      COALESCE(item_summary.missing, 0) AS missing,
      COALESCE(item_summary.not_yet_checked, 0) AS not_yet_checked,
      COALESCE(item_summary.discrepancies, 0) AS discrepancies
    FROM inventory_sessions s
    LEFT JOIN users creator
      ON creator.id = s.created_by
    LEFT JOIN users starter
      ON starter.id = s.started_by
    LEFT JOIN departments d
      ON d.id = s.department_id
    LEFT JOIN locations l
      ON l.id = s.location_id
    LEFT JOIN asset_categories c
      ON c.id = s.category_id
    LEFT JOIN employees e
      ON e.id = s.employee_id
    LEFT JOIN (
      SELECT
        inventory_session_id,
        COUNT(*) AS expected_assets,
        SUM(verification_status <> 'Not Yet Checked') AS checked_assets,
        SUM(verification_status = 'Verified') AS verified,
        SUM(location_mismatch = 1) AS wrong_location,
        SUM(custodian_mismatch = 1) AS wrong_custodian,
        SUM(condition_mismatch = 1) AS condition_changed,
        SUM(label_issue = 1) AS label_issues,
        SUM(verification_status = 'Missing') AS missing,
        SUM(verification_status = 'Not Yet Checked') AS not_yet_checked,
        SUM(
          location_mismatch = 1
          OR custodian_mismatch = 1
          OR condition_mismatch = 1
          OR label_issue = 1
        ) AS discrepancies
      FROM inventory_items
      GROUP BY inventory_session_id
    ) item_summary
      ON item_summary.inventory_session_id = s.id
    WHERE s.id = ?
    LIMIT 1
  `, [sessionId]);

  return normalizeInventorySession(rows[0]);

}


async function loadInventorySummary(database, sessionId) {

  const [rows] = await database.query(`
    SELECT
      session.status AS session_status,
      COUNT(item.id) AS expected_assets,
      COALESCE(SUM(item.verification_status <> 'Not Yet Checked'), 0) AS checked_assets,
      COALESCE(SUM(item.verification_status = 'Verified'), 0) AS verified,
      COALESCE(SUM(item.location_mismatch = 1), 0) AS wrong_location,
      COALESCE(SUM(item.custodian_mismatch = 1), 0) AS wrong_custodian,
      COALESCE(SUM(item.condition_mismatch = 1), 0) AS condition_changed,
      COALESCE(SUM(item.label_issue = 1), 0) AS label_issues,
      COALESCE(SUM(item.verification_status = 'Missing'), 0) AS missing,
      COALESCE(SUM(item.verification_status = 'Not Yet Checked'), 0) AS not_yet_checked,
      COALESCE(SUM(
        item.location_mismatch = 1
        OR item.custodian_mismatch = 1
        OR item.condition_mismatch = 1
        OR item.label_issue = 1
      ), 0) AS discrepancies
    FROM inventory_sessions session
    LEFT JOIN inventory_items item
      ON item.inventory_session_id = session.id
    WHERE session.id = ?
    GROUP BY session.id, session.status
  `, [sessionId]);

  if (!rows.length) return null;

  return normalizeInventorySummary(rows[0], rows[0].session_status);

}


async function loadInventoryItems(
  database,
  sessionId,
  { filter = '', search = '' } = {}
) {

  let sql = `
    SELECT
      item.id,
      item.inventory_session_id,
      item.asset_id AS asset_database_id,
      item.expected_location_id,
      item.actual_location_id,
      item.expected_employee_id,
      item.actual_employee_id,
      item.expected_department_id,
      item.expected_location_name,
      item.actual_location_name,
      item.expected_custodian_name,
      item.actual_custodian_name,
      item.expected_department_name,
      item.expected_condition,
      item.actual_condition,
      item.verification_status,
      item.verification_method,
      item.label_condition,
      item.location_mismatch,
      item.custodian_mismatch,
      item.condition_mismatch,
      item.label_issue,
      item.verified_at,
      item.missing_marked_at,
      item.remarks,
      item.review_status,
      item.reviewed_by,
      item.reviewed_at,
      item.review_remarks,
      asset.asset_id,
      asset.asset_name,
      asset.brand,
      asset.model,
      asset.serial_number,
      asset.barcode,
      asset.status AS current_asset_status,
      asset.condition_status AS current_condition,
      category.name AS category_name,
      verifier.full_name AS verified_by_name,
      reviewer.full_name AS reviewed_by_name
    FROM inventory_items item
    INNER JOIN assets asset
      ON asset.id = item.asset_id
    LEFT JOIN asset_categories category
      ON category.id = asset.category_id
    LEFT JOIN users verifier
      ON verifier.id = item.verified_by
    LEFT JOIN users reviewer
      ON reviewer.id = item.reviewed_by
    WHERE item.inventory_session_id = ?
  `;

  const params = [sessionId];

  if (filter === 'All Issues') {
    sql += ` AND (
      item.verification_status = 'Missing'
      OR item.location_mismatch = 1
      OR item.custodian_mismatch = 1
      OR item.condition_mismatch = 1
      OR item.label_issue = 1
    )`;
  } else if (filter === 'Discrepancies') {
    sql += ` AND (
      item.location_mismatch = 1
      OR item.custodian_mismatch = 1
      OR item.condition_mismatch = 1
      OR item.label_issue = 1
    )`;
  } else if (filter === 'Wrong Location') {
    sql += ' AND item.location_mismatch = 1';
  } else if (filter === 'Wrong Custodian') {
    sql += ' AND item.custodian_mismatch = 1';
  } else if (filter === 'Condition Changed') {
    sql += ' AND item.condition_mismatch = 1';
  } else if (filter === 'Label Issue') {
    sql += ' AND item.label_issue = 1';
  } else if (filter) {
    sql += ' AND item.verification_status = ?';
    params.push(filter);
  }

  if (search) {
    const term = `%${search}%`;
    sql += `
      AND (
        asset.asset_id LIKE ?
        OR asset.asset_name LIKE ?
        OR asset.brand LIKE ?
        OR asset.model LIKE ?
        OR asset.serial_number LIKE ?
        OR asset.barcode LIKE ?
        OR item.expected_custodian_name LIKE ?
        OR item.expected_location_name LIKE ?
        OR item.actual_custodian_name LIKE ?
        OR item.actual_location_name LIKE ?
      )
    `;
    params.push(
      term, term, term, term, term,
      term, term, term, term, term
    );
  }

  sql += `
    ORDER BY
      FIELD(
        item.verification_status,
        'Not Yet Checked',
        'Wrong Custodian',
        'Wrong Location',
        'Condition Changed',
        'Label Damaged',
        'Missing',
        'Verified'
      ),
      asset.asset_id ASC
  `;

  const [items] = await database.query(sql, params);

  return items.map(item => ({
    ...item,
    issues: item.verification_status === 'Missing'
      ? ['Missing']
      : inventoryIssueList(item)
  }));

}


function inventoryScopeDescription(session) {

  if (!session) return 'All Assets';

  if (session.scope_type === 'Department') {
    return session.department_name || 'Department';
  }

  if (session.scope_type === 'Location') {
    return session.location_name || 'Location';
  }

  if (session.scope_type === 'Category') {
    return session.category_name || 'Category';
  }

  if (session.scope_type === 'Custodian') {
    return session.employee_name || 'Custodian';
  }

  return 'All Assets';

}


app.get('/inventory', requireMaintenanceStaff, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'inventory.html'));
});

app.get('/inventory-report', requireMaintenanceStaff, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'inventory-report.html'));
});

app.get('/inventory-discrepancy-report', requireMaintenanceStaff, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'inventory-report.html'));
});


app.get(
  '/api/inventory/sessions',
  requireMaintenanceStaff,
  async (req, res) => {

    try {

      const [rows] = await pool.query(`
        SELECT
          s.*,
          creator.full_name AS created_by_name,
          starter.full_name AS started_by_name,
          d.name AS department_name,
          l.name AS location_name,
          c.name AS category_name,
          e.full_name AS employee_name,
          e.employee_id AS employee_code,
          COALESCE(item_summary.expected_assets, 0) AS expected_assets,
          COALESCE(item_summary.checked_assets, 0) AS checked_assets,
          COALESCE(item_summary.verified, 0) AS verified,
          COALESCE(item_summary.wrong_location, 0) AS wrong_location,
          COALESCE(item_summary.wrong_custodian, 0) AS wrong_custodian,
          COALESCE(item_summary.condition_changed, 0) AS condition_changed,
          COALESCE(item_summary.label_issues, 0) AS label_issues,
          COALESCE(item_summary.missing, 0) AS missing,
          COALESCE(item_summary.not_yet_checked, 0) AS not_yet_checked,
          COALESCE(item_summary.discrepancies, 0) AS discrepancies
        FROM inventory_sessions s
        LEFT JOIN users creator
          ON creator.id = s.created_by
        LEFT JOIN users starter
          ON starter.id = s.started_by
        LEFT JOIN departments d
          ON d.id = s.department_id
        LEFT JOIN locations l
          ON l.id = s.location_id
        LEFT JOIN asset_categories c
          ON c.id = s.category_id
        LEFT JOIN employees e
          ON e.id = s.employee_id
        LEFT JOIN (
          SELECT
            inventory_session_id,
            COUNT(*) AS expected_assets,
            SUM(verification_status <> 'Not Yet Checked') AS checked_assets,
            SUM(verification_status = 'Verified') AS verified,
            SUM(location_mismatch = 1) AS wrong_location,
            SUM(custodian_mismatch = 1) AS wrong_custodian,
            SUM(condition_mismatch = 1) AS condition_changed,
            SUM(label_issue = 1) AS label_issues,
            SUM(verification_status = 'Missing') AS missing,
            SUM(verification_status = 'Not Yet Checked') AS not_yet_checked,
            SUM(
              location_mismatch = 1
              OR custodian_mismatch = 1
              OR condition_mismatch = 1
              OR label_issue = 1
            ) AS discrepancies
          FROM inventory_items
          GROUP BY inventory_session_id
        ) item_summary
          ON item_summary.inventory_session_id = s.id
        ORDER BY s.created_at DESC, s.id DESC
      `);

      const sessions = rows.map(row => {
        const session = normalizeInventorySession(row);
        session.scope_description = inventoryScopeDescription(session);
        return session;
      });

      return res.json({ ok: true, sessions });

    } catch (error) {

      console.error('LOAD INVENTORY SESSIONS ERROR:', error);

      return res.status(500).json({
        message: 'Unable to load inventory sessions.'
      });

    }

  }
);


app.post(
  '/api/inventory/sessions',
  requireMaintenanceStaff,
  async (req, res) => {

    const name = String(req.body?.name || '').trim();
    const scopeType = String(req.body?.scope_type || 'All Assets').trim();
    const remarks = String(req.body?.remarks || '').trim() || null;

    if (!name || name.length > 200) {
      return res.status(400).json({
        message: 'Inventory name is required and must not exceed 200 characters.'
      });
    }

    if (!INVENTORY_SCOPE_TYPES.has(scopeType)) {
      return res.status(400).json({ message: 'Invalid inventory scope.' });
    }

    const scopeConfiguration = {
      Department: {
        field: 'department_id',
        table: 'departments',
        label: 'department'
      },
      Location: {
        field: 'location_id',
        table: 'locations',
        label: 'location'
      },
      Category: {
        field: 'category_id',
        table: 'asset_categories',
        label: 'category'
      },
      Custodian: {
        field: 'employee_id',
        table: 'employees',
        label: 'custodian'
      }
    };

    let departmentId = null;
    let locationId = null;
    let categoryId = null;
    let employeeId = null;

    const selectedScope = scopeConfiguration[scopeType];

    if (selectedScope) {

      const selectedId = normalizeInventoryPositiveId(
        req.body?.[selectedScope.field]
      );

      if (!selectedId) {
        return res.status(400).json({
          message: `Select a valid ${selectedScope.label}.`
        });
      }

      const [referenceRows] = await pool.query(
        `SELECT id FROM \`${selectedScope.table}\` WHERE id = ? LIMIT 1`,
        [selectedId]
      );

      if (!referenceRows.length) {
        return res.status(400).json({
          message: `The selected ${selectedScope.label} was not found.`
        });
      }

      if (scopeType === 'Department') departmentId = selectedId;
      if (scopeType === 'Location') locationId = selectedId;
      if (scopeType === 'Category') categoryId = selectedId;
      if (scopeType === 'Custodian') employeeId = selectedId;

    }

    const connection = await pool.getConnection();
    let transactionStarted = false;

    try {

      await connection.beginTransaction();
      transactionStarted = true;

      const [yearRows] = await connection.query(
        'SELECT YEAR(CURDATE()) AS current_year'
      );

      const year = Number(yearRows[0].current_year);
      const prefix = `INV-${year}-`;

      const [lastRows] = await connection.query(`
        SELECT inventory_no
        FROM inventory_sessions
        WHERE inventory_no LIKE ?
        ORDER BY inventory_no DESC
        LIMIT 1
        FOR UPDATE
      `, [`${prefix}%`]);

      const lastSequence = lastRows.length
        ? Number(String(lastRows[0].inventory_no).slice(-6)) || 0
        : 0;

      const inventoryNo =
        `${prefix}${String(lastSequence + 1).padStart(6, '0')}`;

      const [result] = await connection.query(`
        INSERT INTO inventory_sessions (
          inventory_no,
          name,
          scope_type,
          department_id,
          location_id,
          category_id,
          employee_id,
          status,
          remarks,
          created_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'Draft', ?, ?)
      `, [
        inventoryNo,
        name,
        scopeType,
        departmentId,
        locationId,
        categoryId,
        employeeId,
        remarks,
        req.session.user.id
      ]);

      await connection.query(`
        INSERT INTO audit_logs
          (user_id, action, entity_type, entity_id, details)
        VALUES (?, 'INVENTORY_SESSION_CREATED', 'inventory_session', ?, ?)
      `, [
        req.session.user.id,
        String(result.insertId),
        JSON.stringify({
          inventory_no: inventoryNo,
          name,
          scope_type: scopeType,
          department_id: departmentId,
          location_id: locationId,
          category_id: categoryId,
          employee_id: employeeId
        })
      ]);

      await connection.commit();
      transactionStarted = false;

      const session = await loadInventorySession(pool, result.insertId);
      session.scope_description = inventoryScopeDescription(session);

      return res.status(201).json({
        ok: true,
        message: `Inventory session ${inventoryNo} created as Draft.`,
        session
      });

    } catch (error) {

      if (transactionStarted) {
        try { await connection.rollback(); } catch (_) {}
      }

      console.error('CREATE INVENTORY SESSION ERROR:', error);

      return res.status(500).json({
        message:
          error.code === 'ER_DUP_ENTRY'
            ? 'Unable to generate a unique inventory number. Please try again.'
            : 'Unable to create the inventory session.'
      });

    } finally {

      connection.release();

    }

  }
);


app.post(
  '/api/inventory/sessions/:id/start',
  requireMaintenanceStaff,
  async (req, res) => {

    const sessionId = normalizeInventoryPositiveId(req.params.id);

    if (!sessionId) {
      return res.status(400).json({ message: 'Invalid inventory session ID.' });
    }

    const connection = await pool.getConnection();
    let transactionStarted = false;

    try {

      await connection.beginTransaction();
      transactionStarted = true;

      const [sessionRows] = await connection.query(`
        SELECT *
        FROM inventory_sessions
        WHERE id = ?
        LIMIT 1
        FOR UPDATE
      `, [sessionId]);

      if (!sessionRows.length) {
        await connection.rollback();
        transactionStarted = false;
        return res.status(404).json({ message: 'Inventory session not found.' });
      }

      const session = sessionRows[0];

      if (session.status !== 'Draft') {
        await connection.rollback();
        transactionStarted = false;
        return res.status(409).json({
          code: 'INVENTORY_ALREADY_STARTED',
          message:
            session.status === 'In Progress'
              ? 'This inventory session has already started.'
              : `A ${session.status} inventory session cannot be started.`
        });
      }

      let scopeWhere = '';
      const scopeParams = [];

      if (session.scope_type === 'Department') {
        scopeWhere = 'WHERE employee.department_id = ?';
        scopeParams.push(session.department_id);
      } else if (session.scope_type === 'Location') {
        scopeWhere = 'WHERE asset.location_id = ?';
        scopeParams.push(session.location_id);
      } else if (session.scope_type === 'Category') {
        scopeWhere = 'WHERE asset.category_id = ?';
        scopeParams.push(session.category_id);
      } else if (session.scope_type === 'Custodian') {
        scopeWhere = 'WHERE active_assignment.employee_id = ?';
        scopeParams.push(session.employee_id);
      }

      const [snapshotResult] = await connection.query(`
        INSERT INTO inventory_items (
          inventory_session_id,
          asset_id,
          expected_location_id,
          expected_employee_id,
          expected_department_id,
          expected_location_name,
          expected_custodian_name,
          expected_department_name,
          expected_condition,
          verification_status
        )
        SELECT
          ?,
          asset.id,
          asset.location_id,
          active_assignment.employee_id,
          employee.department_id,
          location.name,
          employee.full_name,
          department.name,
          asset.condition_status,
          'Not Yet Checked'
        FROM assets asset
        LEFT JOIN locations location
          ON location.id = asset.location_id
        LEFT JOIN (
          SELECT assignment.asset_id, assignment.employee_id
          FROM asset_assignments assignment
          INNER JOIN (
            SELECT asset_id, MAX(id) AS latest_id
            FROM asset_assignments
            WHERE returned_at IS NULL
            GROUP BY asset_id
          ) latest_assignment
            ON latest_assignment.latest_id = assignment.id
        ) active_assignment
          ON active_assignment.asset_id = asset.id
        LEFT JOIN employees employee
          ON employee.id = active_assignment.employee_id
        LEFT JOIN departments department
          ON department.id = employee.department_id
        ${scopeWhere}
        ORDER BY asset.id
      `, [sessionId, ...scopeParams]);

      const expectedAssets = Number(snapshotResult.affectedRows || 0);

      if (!expectedAssets) {
        await connection.rollback();
        transactionStarted = false;
        return res.status(400).json({
          message: 'No assets currently match this inventory scope.'
        });
      }

      await connection.query(`
        UPDATE inventory_sessions
        SET
          status = 'In Progress',
          started_by = ?,
          started_at = NOW(),
          completed_at = NULL
        WHERE id = ?
      `, [req.session.user.id, sessionId]);

      await connection.query(`
        INSERT INTO audit_logs
          (user_id, action, entity_type, entity_id, details)
        VALUES (?, 'INVENTORY_SESSION_STARTED', 'inventory_session', ?, ?)
      `, [
        req.session.user.id,
        String(sessionId),
        JSON.stringify({
          inventory_no: session.inventory_no,
          scope_type: session.scope_type,
          expected_assets: expectedAssets
        })
      ]);

      await connection.commit();
      transactionStarted = false;

      const startedSession = await loadInventorySession(pool, sessionId);
      startedSession.scope_description = inventoryScopeDescription(startedSession);

      broadcastInventoryUpdate(sessionId, 'inventory:session-started', {
        session: startedSession,
        actor_name: req.session.user.full_name
      });

      return res.json({
        ok: true,
        message: `${session.inventory_no} started with ${expectedAssets} expected asset${expectedAssets === 1 ? '' : 's'}.`,
        session: startedSession
      });

    } catch (error) {

      if (transactionStarted) {
        try { await connection.rollback(); } catch (_) {}
      }

      console.error('START INVENTORY SESSION ERROR:', error);

      return res.status(500).json({
        message: 'Unable to start the inventory session.'
      });

    } finally {

      connection.release();

    }

  }
);


app.get(
  '/api/inventory/sessions/:id',
  requireMaintenanceStaff,
  async (req, res) => {

    const sessionId = normalizeInventoryPositiveId(req.params.id);

    if (!sessionId) {
      return res.status(400).json({ message: 'Invalid inventory session ID.' });
    }

    try {

      const session = await loadInventorySession(pool, sessionId);

      if (!session) {
        return res.status(404).json({ message: 'Inventory session not found.' });
      }

      session.scope_description = inventoryScopeDescription(session);

      return res.json({ ok: true, session });

    } catch (error) {

      console.error('LOAD INVENTORY SESSION ERROR:', error);

      return res.status(500).json({
        message: 'Unable to load the inventory session.'
      });

    }

  }
);


app.get(
  '/api/inventory/sessions/:id/summary',
  requireMaintenanceStaff,
  async (req, res) => {

    const sessionId = normalizeInventoryPositiveId(req.params.id);

    if (!sessionId) {
      return res.status(400).json({ message: 'Invalid inventory session ID.' });
    }

    try {

      const session = await loadInventorySession(pool, sessionId);

      if (!session) {
        return res.status(404).json({ message: 'Inventory session not found.' });
      }

      return res.json({
        ok: true,
        summary: await loadInventorySummary(pool, sessionId)
      });

    } catch (error) {

      console.error('LOAD INVENTORY SUMMARY ERROR:', error);

      return res.status(500).json({
        message: 'Unable to load inventory progress.'
      });

    }

  }
);


app.get(
  '/api/inventory/sessions/:id/items',
  requireMaintenanceStaff,
  async (req, res) => {

    const sessionId = normalizeInventoryPositiveId(req.params.id);
    const filter = String(req.query.filter || req.query.status || '').trim();
    const search = String(req.query.q || '').trim();

    if (!sessionId) {
      return res.status(400).json({ message: 'Invalid inventory session ID.' });
    }

    if (filter && !INVENTORY_ITEM_FILTERS.has(filter)) {
      return res.status(400).json({ message: 'Invalid inventory item filter.' });
    }

    if (search.length > 150) {
      return res.status(400).json({ message: 'Inventory search is too long.' });
    }

    try {

      const session = await loadInventorySession(pool, sessionId);

      if (!session) {
        return res.status(404).json({ message: 'Inventory session not found.' });
      }

      const items = await loadInventoryItems(pool, sessionId, {
        filter,
        search
      });

      return res.json({
        ok: true,
        items
      });

    } catch (error) {

      console.error('LOAD INVENTORY ITEMS ERROR:', error);

      return res.status(500).json({
        message: 'Unable to load inventory items.'
      });

    }

  }
);


app.post(
  '/api/inventory/sessions/:sessionId/items/:itemId/review',
  requireMaintenanceStaff,
  async (req, res) => {

    const sessionId = normalizeInventoryPositiveId(req.params.sessionId);
    const itemId = normalizeInventoryPositiveId(req.params.itemId);
    const reviewStatus = String(req.body?.review_status || '').trim();
    const reviewRemarks = String(req.body?.review_remarks || '').trim() || null;

    if (!sessionId || !itemId) {
      return res.status(400).json({ message: 'Invalid inventory review request.' });
    }

    if (!INVENTORY_REVIEW_STATUSES.has(reviewStatus)) {
      return res.status(400).json({ message: 'Select a valid review status.' });
    }

    if (reviewRemarks && reviewRemarks.length > 2000) {
      return res.status(400).json({
        message: 'Review remarks must not exceed 2,000 characters.'
      });
    }

    const connection = await pool.getConnection();
    let transactionStarted = false;

    try {
      await connection.beginTransaction();
      transactionStarted = true;

      const [rows] = await connection.query(`
        SELECT
          item.id,
          item.asset_id,
          item.verification_status,
          item.location_mismatch,
          item.custodian_mismatch,
          item.condition_mismatch,
          item.label_issue,
          item.label_condition,
          item.review_status,
          session.inventory_no,
          session.status AS session_status,
          asset.asset_id AS asset_tag,
          asset.asset_name
        FROM inventory_items item
        INNER JOIN inventory_sessions session
          ON session.id = item.inventory_session_id
        INNER JOIN assets asset
          ON asset.id = item.asset_id
        WHERE item.id = ?
          AND item.inventory_session_id = ?
        LIMIT 1
        FOR UPDATE
      `, [itemId, sessionId]);

      if (!rows.length) {
        await connection.rollback();
        transactionStarted = false;
        return res.status(404).json({ message: 'Inventory discrepancy not found.' });
      }

      const item = rows[0];
      const hasIssue = item.verification_status === 'Missing' ||
        Number(item.location_mismatch) === 1 ||
        Number(item.custodian_mismatch) === 1 ||
        Number(item.condition_mismatch) === 1 ||
        Number(item.label_issue) === 1;

      if (!hasIssue) {
        await connection.rollback();
        transactionStarted = false;
        return res.status(409).json({
          message: 'This inventory item has no discrepancy to review.'
        });
      }

      if (!['In Progress', 'Completed'].includes(item.session_status)) {
        await connection.rollback();
        transactionStarted = false;
        return res.status(409).json({
          message: `Discrepancies in a ${item.session_status} session cannot be reviewed.`
        });
      }

      await connection.query(`
        UPDATE inventory_items
        SET
          review_status = ?,
          reviewed_by = ?,
          reviewed_at = NOW(),
          review_remarks = ?
        WHERE id = ?
          AND inventory_session_id = ?
      `, [
        reviewStatus,
        req.session.user.id,
        reviewRemarks,
        itemId,
        sessionId
      ]);

      const auditAction = reviewStatus === 'Resolved'
        ? 'INVENTORY_DISCREPANCY_RESOLVED'
        : 'INVENTORY_DISCREPANCY_REVIEWED';

      await connection.query(`
        INSERT INTO audit_logs
          (user_id, action, entity_type, entity_id, details)
        VALUES (?, ?, 'inventory_item', ?, ?)
      `, [
        req.session.user.id,
        auditAction,
        String(itemId),
        JSON.stringify({
          inventory_session_id: sessionId,
          inventory_no: item.inventory_no,
          asset_database_id: item.asset_id,
          asset_id: item.asset_tag,
          asset_name: item.asset_name,
          previous_review_status: item.review_status,
          review_status: reviewStatus,
          review_remarks: reviewRemarks,
          issues: item.verification_status === 'Missing'
            ? ['Missing']
            : inventoryIssueList(item)
        })
      ]);

      await connection.commit();
      transactionStarted = false;

      broadcastInventoryUpdate(sessionId, 'inventory:discrepancy-reviewed', {
        item_id: itemId,
        asset_id: item.asset_tag,
        asset_name: item.asset_name,
        review_status: reviewStatus,
        actor_name: req.session.user.full_name
      });

      return res.json({
        ok: true,
        message: `${item.asset_tag} review saved as ${reviewStatus}.`,
        review: {
          review_status: reviewStatus,
          review_remarks: reviewRemarks,
          reviewed_by: req.session.user.id,
          reviewed_by_name: req.session.user.full_name,
          reviewed_at: new Date()
        }
      });

    } catch (error) {
      if (transactionStarted) {
        try { await connection.rollback(); } catch (_) {}
      }
      console.error('REVIEW INVENTORY DISCREPANCY ERROR:', error);
      return res.status(500).json({
        message: 'Unable to save the discrepancy review.'
      });
    } finally {
      connection.release();
    }

  }
);


app.post(
  '/api/inventory/sessions/:id/print',
  requireMaintenanceStaff,
  async (req, res) => {

    const sessionId = normalizeInventoryPositiveId(req.params.id);
    const reportType = String(req.body?.report_type || '').trim();

    if (!sessionId || !['inventory', 'discrepancy'].includes(reportType)) {
      return res.status(400).json({ message: 'Invalid inventory print request.' });
    }

    try {
      const session = await loadInventorySession(pool, sessionId);
      if (!session) {
        return res.status(404).json({ message: 'Inventory session not found.' });
      }

      await pool.query(`
        INSERT INTO audit_logs
          (user_id, action, entity_type, entity_id, details)
        VALUES (?, 'INVENTORY_REPORT_PRINTED', 'inventory_session', ?, ?)
      `, [
        req.session.user.id,
        String(sessionId),
        JSON.stringify({
          inventory_no: session.inventory_no,
          report_type: reportType
        })
      ]);

      return res.json({ ok: true });
    } catch (error) {
      console.error('LOG INVENTORY PRINT ERROR:', error);
      return res.status(500).json({ message: 'Unable to record the print action.' });
    }

  }
);


app.post(
  '/api/inventory/sessions/:sessionId/items/:itemId/label-reprint',
  requireMaintenanceStaff,
  async (req, res) => {

    const sessionId = normalizeInventoryPositiveId(req.params.sessionId);
    const itemId = normalizeInventoryPositiveId(req.params.itemId);

    if (!sessionId || !itemId) {
      return res.status(400).json({ message: 'Invalid label reprint request.' });
    }

    try {
      const [rows] = await pool.query(`
        SELECT
          item.id,
          item.asset_id,
          item.label_condition,
          session.inventory_no,
          asset.asset_id AS asset_tag
        FROM inventory_items item
        INNER JOIN inventory_sessions session
          ON session.id = item.inventory_session_id
        INNER JOIN assets asset
          ON asset.id = item.asset_id
        WHERE item.id = ?
          AND item.inventory_session_id = ?
          AND item.label_issue = 1
        LIMIT 1
      `, [itemId, sessionId]);

      if (!rows.length) {
        return res.status(404).json({
          message: 'A label issue was not found for this inventory item.'
        });
      }

      const item = rows[0];
      await pool.query(`
        INSERT INTO audit_logs
          (user_id, action, entity_type, entity_id, details)
        VALUES (?, 'INVENTORY_LABEL_REPRINTED', 'inventory_item', ?, ?)
      `, [
        req.session.user.id,
        String(itemId),
        JSON.stringify({
          inventory_session_id: sessionId,
          inventory_no: item.inventory_no,
          asset_database_id: item.asset_id,
          asset_id: item.asset_tag,
          label_condition: item.label_condition
        })
      ]);

      return res.json({ ok: true });
    } catch (error) {
      console.error('LOG INVENTORY LABEL REPRINT ERROR:', error);
      return res.status(500).json({ message: 'Unable to record the label reprint.' });
    }

  }
);


app.get(
  '/api/inventory/sessions/:id/export',
  requireMaintenanceStaff,
  async (req, res) => {

    const sessionId = normalizeInventoryPositiveId(req.params.id);

    if (!sessionId) {
      return res.status(400).json({ message: 'Invalid inventory session ID.' });
    }

    try {
      const session = await loadInventorySession(pool, sessionId);
      if (!session) {
        return res.status(404).json({ message: 'Inventory session not found.' });
      }
      session.scope_description = inventoryScopeDescription(session);

      const items = await loadInventoryItems(pool, sessionId);
      const discrepancies = items.filter(item =>
        item.verification_status === 'Missing' ||
        Number(item.location_mismatch) === 1 ||
        Number(item.custodian_mismatch) === 1 ||
        Number(item.condition_mismatch) === 1 ||
        Number(item.label_issue) === 1
      );

      const toYesNo = value => Number(value) === 1 ? 'Yes' : 'No';
      const asDate = value => value
        ? new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })
        : '';
      const exportRow = item => {
        const missing = item.verification_status === 'Missing';
        const notLocated = missing ? 'Not Located During Inventory' : '';
        return {
          'Inventory No.': session.inventory_no,
          'Inventory Name': session.name,
          'Scope': session.scope_type,
          'Scope Value': session.scope_description,
          'Status': session.status,
          'Asset Tag': item.asset_id,
          'Asset Name': item.asset_name,
          'Category': item.category_name || '',
          'Brand': item.brand || '',
          'Model': item.model || '',
          'Serial Number': item.serial_number || '',
          'Barcode': item.barcode || '',
          'Expected Custodian': item.expected_custodian_name || 'IT Inventory / Unassigned',
          'Actual Custodian': missing
            ? notLocated
            : item.actual_custodian_name || 'IT Inventory / Unassigned',
          'Expected Department': item.expected_department_name || '',
          'Expected Location': item.expected_location_name || '',
          'Actual Location': missing ? notLocated : item.actual_location_name || '',
          'Expected Condition': item.expected_condition || '',
          'Actual Condition': missing ? notLocated : item.actual_condition || '',
          'Label Condition': missing ? 'Not observed' : item.label_condition || '',
          'Wrong Location': toYesNo(item.location_mismatch),
          'Wrong Custodian': toYesNo(item.custodian_mismatch),
          'Condition Changed': toYesNo(item.condition_mismatch),
          'Label Issue': toYesNo(item.label_issue),
          'Issue(s)': (item.issues || []).join(', '),
          'Primary Result': item.verification_status,
          'Verification Method': item.verification_method || '',
          'Verified By': item.verified_by_name || (missing ? 'System completion' : ''),
          'Verified At': asDate(item.verified_at || item.missing_marked_at),
          'Remarks': item.remarks || '',
          'Review Status': item.review_status || '',
          'Reviewed By': item.reviewed_by_name || '',
          'Reviewed At': asDate(item.reviewed_at),
          'Review Remarks': item.review_remarks || ''
        };
      };

      const workbook = XLSX.utils.book_new();
      const summarySheet = XLSX.utils.aoa_to_sheet([
        ['PRIMA IT Asset Management - Inventory Summary', ''],
        ['Inventory No.', session.inventory_no],
        ['Inventory Name', session.name],
        ['Scope', session.scope_type],
        ['Scope Value', session.scope_description],
        ['Status', session.status],
        ['Started By', session.started_by_name || ''],
        ['Started At', asDate(session.started_at)],
        ['Completed At', asDate(session.completed_at)],
        ['Remarks', session.remarks || ''],
        ['Expected Assets', session.expected_assets],
        ['Checked Assets', session.checked_assets],
        ['Verified Assets', session.verified_assets],
        ['Discrepancy Assets', session.discrepancies],
        ['Missing Assets', session.missing],
        ['Wrong Location', session.wrong_location],
        ['Wrong Custodian', session.wrong_custodian],
        ['Condition Changed', session.condition_changed],
        ['Label Issues', session.label_issues]
      ]);
      summarySheet['!cols'] = [{ wch: 28 }, { wch: 54 }];
      XLSX.utils.book_append_sheet(workbook, summarySheet, 'Inventory Summary');

      const itemSheet = XLSX.utils.json_to_sheet(items.map(exportRow));
      itemSheet['!cols'] = Array(34).fill({ wch: 20 });
      XLSX.utils.book_append_sheet(workbook, itemSheet, 'Inventory Items');

      const discrepancySheet = XLSX.utils.json_to_sheet(
        discrepancies.length
          ? discrepancies.map(exportRow)
          : [{ Message: 'No discrepancies were recorded for this inventory.' }]
      );
      discrepancySheet['!cols'] = Array(34).fill({ wch: 20 });
      XLSX.utils.book_append_sheet(workbook, discrepancySheet, 'Discrepancies');

      await pool.query(`
        INSERT INTO audit_logs
          (user_id, action, entity_type, entity_id, details)
        VALUES (?, 'INVENTORY_EXPORTED', 'inventory_session', ?, ?)
      `, [
        req.session.user.id,
        String(sessionId),
        JSON.stringify({
          inventory_no: session.inventory_no,
          item_count: items.length,
          discrepancy_count: discrepancies.length,
          format: 'xlsx'
        })
      ]);

      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      const safeNumber = String(session.inventory_no || `inventory-${sessionId}`)
        .replace(/[^a-zA-Z0-9._-]+/g, '_');
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${safeNumber}-inventory.xlsx"`
      );
      return res.send(buffer);

    } catch (error) {
      console.error('EXPORT INVENTORY ERROR:', error);
      return res.status(500).json({ message: 'Unable to export this inventory.' });
    }

  }
);


app.get(
  '/api/inventory/sessions/:id/search',
  requireMaintenanceStaff,
  async (req, res) => {

    const sessionId = normalizeInventoryPositiveId(req.params.id);
    const search = String(req.query.q || '').trim();

    if (!sessionId) {
      return res.status(400).json({ message: 'Invalid inventory session ID.' });
    }

    if (!search || search.length > 150) {
      return res.status(400).json({
        message: 'Enter a search value up to 150 characters.'
      });
    }

    try {

      const session = await loadInventorySession(pool, sessionId);

      if (!session) {
        return res.status(404).json({ message: 'Inventory session not found.' });
      }

      if (session.status !== 'In Progress') {
        return res.status(409).json({
          message: 'Start this inventory session before searching for assets.'
        });
      }

      const term = `%${search}%`;

      const [results] = await pool.query(`
        SELECT
          item.id AS inventory_item_id,
          item.asset_id AS asset_database_id,
          item.expected_location_id,
          item.actual_location_id,
          item.expected_employee_id,
          item.actual_employee_id,
          item.expected_location_name,
          item.actual_location_name,
          item.expected_custodian_name,
          item.actual_custodian_name,
          item.expected_department_name,
          item.expected_condition,
          item.actual_condition,
          item.verification_status,
          item.verification_method,
          item.label_condition,
          item.location_mismatch,
          item.custodian_mismatch,
          item.condition_mismatch,
          item.label_issue,
          item.verified_at,
          item.missing_marked_at,
          item.remarks,
          asset.asset_id,
          asset.asset_name,
          asset.brand,
          asset.model,
          asset.serial_number,
          asset.barcode,
          asset.status AS current_asset_status,
          asset.condition_status AS current_condition,
          category.name AS category_name,
          verifier.full_name AS verified_by_name,
          CASE
            WHEN asset.asset_id = ? THEN 'Asset Tag'
            WHEN COALESCE(asset.barcode, '') = ? THEN 'Barcode'
            WHEN COALESCE(asset.serial_number, '') = ? THEN 'Serial Number'
            ELSE 'Manual Search'
          END AS matched_by,
          CASE
            WHEN asset.asset_id = ? THEN 0
            WHEN COALESCE(asset.barcode, '') = ? THEN 1
            WHEN COALESCE(asset.serial_number, '') = ? THEN 2
            WHEN asset.asset_id LIKE ? THEN 3
            WHEN COALESCE(asset.barcode, '') LIKE ? THEN 4
            WHEN COALESCE(asset.serial_number, '') LIKE ? THEN 5
            WHEN asset.asset_name LIKE ? THEN 6
            WHEN COALESCE(asset.brand, '') LIKE ? THEN 7
            ELSE 8
          END AS match_rank
        FROM inventory_items item
        INNER JOIN assets asset
          ON asset.id = item.asset_id
        LEFT JOIN asset_categories category
          ON category.id = asset.category_id
        LEFT JOIN users verifier
          ON verifier.id = item.verified_by
        WHERE item.inventory_session_id = ?
          AND (
            asset.asset_id LIKE ?
            OR asset.asset_name LIKE ?
            OR asset.brand LIKE ?
            OR asset.model LIKE ?
            OR asset.serial_number LIKE ?
            OR asset.barcode LIKE ?
          )
        ORDER BY match_rank ASC, asset.asset_id ASC
        LIMIT 25
      `, [
        search,
        search,
        search,
        search,
        search,
        search,
        term,
        term,
        term,
        term,
        term,
        sessionId,
        term,
        term,
        term,
        term,
        term,
        term
      ]);

      return res.json({
        ok: true,
        query: search,
        results: results.map(result => ({
          ...result,
          exact_match: Number(result.match_rank) <= 2,
          issues: inventoryIssueList(result)
        }))
      });

    } catch (error) {

      console.error('SEARCH INVENTORY ASSETS ERROR:', error);

      return res.status(500).json({
        message: 'Unable to search this inventory session.'
      });

    }

  }
);


app.post(
  '/api/inventory/sessions/:id/verify',
  requireMaintenanceStaff,
  async (req, res) => {

    const sessionId = normalizeInventoryPositiveId(req.params.id);
    const assetId = normalizeInventoryPositiveId(req.body?.asset_id);
    const actualLocation = normalizeInventoryNullableId(
      req.body?.actual_location_id
    );
    const actualEmployee = normalizeInventoryNullableId(
      req.body?.actual_employee_id
    );
    const actualCondition = String(req.body?.actual_condition || '').trim();
    const labelCondition = String(
      req.body?.label_condition || 'Good'
    ).trim();
    const method = String(
      req.body?.verification_method || 'Manual Search'
    ).trim();
    const remarks = String(req.body?.remarks || '').trim() || null;
    const allowUpdate = req.body?.allow_update === true;

    if (!sessionId || !assetId) {
      return res.status(400).json({
        message: 'A valid inventory session and asset are required.'
      });
    }

    if (!INVENTORY_VERIFICATION_METHODS.has(method)) {
      return res.status(400).json({ message: 'Invalid verification method.' });
    }

    if (!actualLocation.valid || !actualEmployee.valid) {
      return res.status(400).json({
        message: 'Select a valid actual location and custodian.'
      });
    }

    if (!INVENTORY_ASSET_CONDITIONS.has(actualCondition)) {
      return res.status(400).json({ message: 'Select a valid actual condition.' });
    }

    if (!INVENTORY_LABEL_CONDITIONS.has(labelCondition)) {
      return res.status(400).json({ message: 'Select a valid label condition.' });
    }

    if (remarks && remarks.length > 2000) {
      return res.status(400).json({
        message: 'Verification remarks must not exceed 2,000 characters.'
      });
    }

    const connection = await pool.getConnection();
    let transactionStarted = false;

    try {

      await connection.beginTransaction();
      transactionStarted = true;

      const [sessionRows] = await connection.query(`
        SELECT id, inventory_no, status
        FROM inventory_sessions
        WHERE id = ?
        LIMIT 1
        FOR UPDATE
      `, [sessionId]);

      if (!sessionRows.length) {
        await connection.rollback();
        transactionStarted = false;
        return res.status(404).json({ message: 'Inventory session not found.' });
      }

      const session = sessionRows[0];

      if (session.status !== 'In Progress') {
        await connection.rollback();
        transactionStarted = false;
        return res.status(409).json({
          message: 'Only an In Progress inventory session can verify assets.'
        });
      }

      const [itemRows] = await connection.query(`
        SELECT
          item.id,
          item.asset_id,
          item.expected_location_id,
          item.expected_employee_id,
          item.expected_condition,
          item.verification_status,
          item.verification_method,
          item.actual_location_id,
          item.actual_employee_id,
          item.actual_condition,
          item.label_condition,
          item.location_mismatch,
          item.custodian_mismatch,
          item.condition_mismatch,
          item.label_issue,
          item.remarks,
          item.verified_by,
          item.verified_at,
          asset.asset_id AS asset_tag,
          asset.asset_name,
          verifier.full_name AS verified_by_name
        FROM inventory_items item
        INNER JOIN assets asset
          ON asset.id = item.asset_id
        LEFT JOIN users verifier
          ON verifier.id = item.verified_by
        WHERE item.inventory_session_id = ?
          AND item.asset_id = ?
        LIMIT 1
        FOR UPDATE
      `, [sessionId, assetId]);

      if (!itemRows.length) {
        await connection.rollback();
        transactionStarted = false;
        return res.status(404).json({
          code: 'ASSET_NOT_EXPECTED',
          message: 'This asset is not part of the frozen inventory snapshot.'
        });
      }

      const item = itemRows[0];
      const isCorrection = item.verification_status !== 'Not Yet Checked';

      if (isCorrection && !allowUpdate) {
        await connection.rollback();
        transactionStarted = false;
        const currentSummary = await loadInventorySummary(pool, sessionId);
        return res.status(409).json({
          code: 'ALREADY_VERIFIED',
          message: `${item.asset_tag} was already verified in this inventory session.`,
          summary: currentSummary,
          item: {
            inventory_item_id: item.id,
            asset_database_id: item.asset_id,
            asset_id: item.asset_tag,
            asset_name: item.asset_name,
            verification_status: item.verification_status,
            verification_method: item.verification_method,
            actual_location_id: item.actual_location_id,
            actual_employee_id: item.actual_employee_id,
            actual_condition: item.actual_condition,
            label_condition: item.label_condition,
            location_mismatch: item.location_mismatch,
            custodian_mismatch: item.custodian_mismatch,
            condition_mismatch: item.condition_mismatch,
            label_issue: item.label_issue,
            remarks: item.remarks,
            verified_by_name: item.verified_by_name,
            verified_at: item.verified_at,
            issues: inventoryIssueList(item)
          }
        });
      }

      let actualLocationName = null;
      let actualCustodianName = null;

      if (actualLocation.value) {
        const [locationRows] = await connection.query(
          'SELECT name FROM locations WHERE id = ? LIMIT 1',
          [actualLocation.value]
        );
        if (!locationRows.length) {
          await connection.rollback();
          transactionStarted = false;
          return res.status(400).json({ message: 'The actual location was not found.' });
        }
        actualLocationName = locationRows[0].name;
      }

      if (actualEmployee.value) {
        const [employeeRows] = await connection.query(
          'SELECT full_name FROM employees WHERE id = ? LIMIT 1',
          [actualEmployee.value]
        );
        if (!employeeRows.length) {
          await connection.rollback();
          transactionStarted = false;
          return res.status(400).json({ message: 'The actual custodian was not found.' });
        }
        actualCustodianName = employeeRows[0].full_name;
      }

      const expectedLocationId = normalizeInventoryPositiveId(
        item.expected_location_id
      );
      const expectedEmployeeId = normalizeInventoryPositiveId(
        item.expected_employee_id
      );
      const locationMismatch = expectedLocationId !== actualLocation.value;
      const custodianMismatch = expectedEmployeeId !== actualEmployee.value;
      const conditionMismatch =
        String(item.expected_condition || '').trim() !== actualCondition;
      const labelIssue = labelCondition !== 'Good';
      const verificationStatus = inventoryPrimaryStatus({
        custodianMismatch,
        locationMismatch,
        conditionMismatch,
        labelIssue
      });

      await connection.query(`
        UPDATE inventory_items
        SET
          actual_location_id = ?,
          actual_location_name = ?,
          actual_employee_id = ?,
          actual_custodian_name = ?,
          actual_condition = ?,
          label_condition = ?,
          location_mismatch = ?,
          custodian_mismatch = ?,
          condition_mismatch = ?,
          label_issue = ?,
          verification_status = ?,
          verification_method = ?,
          verified_by = ?,
          verified_at = NOW(),
          missing_marked_at = NULL,
          remarks = ?,
          review_status = ?,
          reviewed_by = NULL,
          reviewed_at = NULL,
          review_remarks = NULL
        WHERE id = ?
      `, [
        actualLocation.value,
        actualLocationName,
        actualEmployee.value,
        actualCustodianName,
        actualCondition,
        labelCondition,
        locationMismatch ? 1 : 0,
        custodianMismatch ? 1 : 0,
        conditionMismatch ? 1 : 0,
        labelIssue ? 1 : 0,
        verificationStatus,
        method,
        req.session.user.id,
        remarks,
        verificationStatus === 'Verified' ? null : 'Pending Review',
        item.id
      ]);

      const auditAction = isCorrection
        ? 'INVENTORY_VERIFICATION_UPDATED'
        : 'INVENTORY_ASSET_VERIFIED';

      await connection.query(`
        INSERT INTO audit_logs
          (user_id, action, entity_type, entity_id, details)
        VALUES (?, ?, 'inventory_item', ?, ?)
      `, [
        req.session.user.id,
        auditAction,
        String(item.id),
        JSON.stringify({
          inventory_session_id: sessionId,
          inventory_no: session.inventory_no,
          asset_id: item.asset_tag,
          asset_database_id: item.asset_id,
          previous_status: item.verification_status,
          verification_status: verificationStatus,
          verification_method: method,
          actual_location_id: actualLocation.value,
          actual_employee_id: actualEmployee.value,
          actual_condition: actualCondition,
          label_condition: labelCondition,
          location_mismatch: locationMismatch,
          custodian_mismatch: custodianMismatch,
          condition_mismatch: conditionMismatch,
          label_issue: labelIssue
        })
      ]);

      await connection.commit();
      transactionStarted = false;

      const updatedItem = {
        inventory_item_id: item.id,
        asset_database_id: item.asset_id,
        asset_id: item.asset_tag,
        asset_name: item.asset_name,
        actual_location_id: actualLocation.value,
        actual_location_name: actualLocationName,
        actual_employee_id: actualEmployee.value,
        actual_custodian_name: actualCustodianName,
        actual_condition: actualCondition,
        label_condition: labelCondition,
        location_mismatch: locationMismatch ? 1 : 0,
        custodian_mismatch: custodianMismatch ? 1 : 0,
        condition_mismatch: conditionMismatch ? 1 : 0,
        label_issue: labelIssue ? 1 : 0,
        verification_status: verificationStatus,
        verification_method: method,
        remarks,
        review_status: verificationStatus === 'Verified'
          ? null
          : 'Pending Review',
        reviewed_by: null,
        reviewed_at: null,
        review_remarks: null,
        verified_by_name: req.session.user.full_name,
        verified_at: new Date()
      };
      updatedItem.issues = inventoryIssueList(updatedItem);

      const updatedSummary = await loadInventorySummary(pool, sessionId);

      broadcastInventoryUpdate(
        sessionId,
        isCorrection
          ? 'inventory:verification-updated'
          : 'inventory:item-verified',
        {
          item: updatedItem,
          summary: updatedSummary,
          actor_name: req.session.user.full_name
        }
      );

      return res.json({
        ok: true,
        message: isCorrection
          ? `${item.asset_tag} verification updated successfully.`
          : verificationStatus === 'Verified'
            ? `${item.asset_tag} verified successfully.`
            : `${item.asset_tag} verified with ${updatedItem.issues.length} discrepancy${updatedItem.issues.length === 1 ? '' : 'ies'}.`,
        item: updatedItem,
        summary: updatedSummary
      });

    } catch (error) {

      if (transactionStarted) {
        try { await connection.rollback(); } catch (_) {}
      }

      console.error('VERIFY INVENTORY ASSET ERROR:', error);

      return res.status(500).json({
        message: 'Unable to verify the inventory asset.'
      });

    } finally {

      connection.release();

    }

  }
);


app.post(
  '/api/inventory/sessions/:id/complete',
  requireMaintenanceStaff,
  async (req, res) => {

    const sessionId = normalizeInventoryPositiveId(req.params.id);

    if (!sessionId) {
      return res.status(400).json({ message: 'Invalid inventory session ID.' });
    }

    const connection = await pool.getConnection();
    let transactionStarted = false;

    try {

      await connection.beginTransaction();
      transactionStarted = true;

      const [sessionRows] = await connection.query(`
        SELECT id, inventory_no, status
        FROM inventory_sessions
        WHERE id = ?
        LIMIT 1
        FOR UPDATE
      `, [sessionId]);

      if (!sessionRows.length) {
        await connection.rollback();
        transactionStarted = false;
        return res.status(404).json({ message: 'Inventory session not found.' });
      }

      const session = sessionRows[0];

      if (session.status !== 'In Progress') {
        await connection.rollback();
        transactionStarted = false;
        return res.status(409).json({
          code: 'INVENTORY_NOT_IN_PROGRESS',
          message: `A ${session.status} inventory session cannot be completed.`
        });
      }

      const [countRows] = await connection.query(`
        SELECT
          COUNT(*) AS total_expected,
          COALESCE(SUM(verification_status <> 'Not Yet Checked'), 0) AS checked_count,
          COALESCE(SUM(verification_status = 'Verified'), 0) AS verified_count,
          COALESCE(SUM(verification_status = 'Not Yet Checked'), 0) AS missing_count
        FROM inventory_items
        WHERE inventory_session_id = ?
      `, [sessionId]);

      const totals = countRows[0];
      const totalExpected = Number(totals.total_expected || 0);
      const checkedCount = Number(totals.checked_count || 0);
      const verifiedCount = Number(totals.verified_count || 0);
      const missingCount = Number(totals.missing_count || 0);

      await connection.query(`
        UPDATE inventory_items
        SET
          verification_status = 'Missing',
          verification_method = NULL,
          verified_by = NULL,
          verified_at = NULL,
          missing_marked_at = NOW(),
          actual_location_id = NULL,
          actual_location_name = NULL,
          actual_employee_id = NULL,
          actual_custodian_name = NULL,
          actual_condition = NULL,
          label_condition = NULL,
          location_mismatch = 0,
          custodian_mismatch = 0,
          condition_mismatch = 0,
          label_issue = 0,
          review_status = 'Pending Review',
          reviewed_by = NULL,
          reviewed_at = NULL,
          review_remarks = NULL
        WHERE inventory_session_id = ?
          AND verification_status = 'Not Yet Checked'
      `, [sessionId]);

      await connection.query(`
        UPDATE inventory_sessions
        SET status = 'Completed', completed_at = NOW()
        WHERE id = ?
          AND status = 'In Progress'
      `, [sessionId]);

      await connection.query(`
        INSERT INTO audit_logs
          (user_id, action, entity_type, entity_id, details)
        VALUES (?, 'INVENTORY_SESSION_COMPLETED', 'inventory_session', ?, ?)
      `, [
        req.session.user.id,
        String(sessionId),
        JSON.stringify({
          inventory_no: session.inventory_no,
          expected_count: totalExpected,
          checked_before_completion: checkedCount,
          verified_count: verifiedCount,
          missing_count: missingCount
        })
      ]);

      await connection.commit();
      transactionStarted = false;

      const completedSession = await loadInventorySession(pool, sessionId);
      const completedSummary = await loadInventorySummary(pool, sessionId);

      broadcastInventoryUpdate(sessionId, 'inventory:session-completed', {
        session: completedSession,
        summary: completedSummary,
        actor_name: req.session.user.full_name
      });

      return res.json({
        ok: true,
        message: 'Inventory completed successfully.',
        missing_count: missingCount,
        checked_count: checkedCount,
        verified_count: verifiedCount,
        total_expected: totalExpected,
        session: completedSession,
        summary: completedSummary
      });

    } catch (error) {

      if (transactionStarted) {
        try { await connection.rollback(); } catch (_) {}
      }

      console.error('COMPLETE INVENTORY SESSION ERROR:', error);

      return res.status(500).json({
        message: 'Unable to complete the inventory session.'
      });

    } finally {

      connection.release();

    }

  }
);

// ============================================================
// HTTPS SERVER
// ============================================================

const CERT_PATH = path.join(
  __dirname,
  'server-cert.pem'
);

const KEY_PATH = path.join(
  __dirname,
  'server-key.pem'
);


// ------------------------------------------------------------
// CHECK CERTIFICATE
// ------------------------------------------------------------

if (!fs.existsSync(CERT_PATH)) {

  console.error('');
  console.error(
    '============================================================'
  );
  console.error(
    'HTTPS CERTIFICATE NOT FOUND'
  );
  console.error(
    '============================================================'
  );

  console.error('');

  console.error(
    `Missing certificate: ${CERT_PATH}`
  );

  console.error('');

  console.error(
    'Make sure server-cert.pem is in the same folder as server.js.'
  );

  console.error('');

  process.exit(1);
}


// ------------------------------------------------------------
// CHECK PRIVATE KEY
// ------------------------------------------------------------

if (!fs.existsSync(KEY_PATH)) {

  console.error('');
  console.error(
    '============================================================'
  );
  console.error(
    'HTTPS PRIVATE KEY NOT FOUND'
  );
  console.error(
    '============================================================'
  );

  console.error('');

  console.error(
    `Missing private key: ${KEY_PATH}`
  );

  console.error('');

  console.error(
    'Make sure server-key.pem is in the same folder as server.js.'
  );

  console.error('');

  process.exit(1);
}


// ------------------------------------------------------------
// LOAD HTTPS CERTIFICATE
// ------------------------------------------------------------

const httpsOptions = {
  key: fs.readFileSync(
    path.join(__dirname, 'certs', 'localhost+3-key.pem')
  ),
  cert: fs.readFileSync(
    path.join(__dirname, 'certs', 'localhost+3.pem')
  )
};


// ------------------------------------------------------------
// CREATE HTTPS SERVER
// ------------------------------------------------------------

const httpsServer =
  https.createServer(
    httpsOptions,
    app
  );

inventoryIo = new SocketIOServer(httpsServer, {
  serveClient: true,
  transports: ['websocket', 'polling']
});

inventoryIo.engine.use(sessionMiddleware);

inventoryIo.use((socket, next) => {
  const user = socket.request.session?.user;

  if (!user) {
    return next(new Error('Login required.'));
  }

  if (!['admin', 'it_staff', 'technician'].includes(user.role)) {
    return next(new Error('Inventory access required.'));
  }

  socket.data.user = {
    id: user.id,
    role: user.role,
    full_name: user.full_name
  };
  return next();
});

inventoryIo.on('connection', socket => {
  socket.on('inventory:join', async (payload = {}, acknowledge = () => {}) => {
    const sessionId = normalizeInventoryPositiveId(payload.session_id);

    if (!sessionId) {
      acknowledge({ ok: false, message: 'Invalid inventory session.' });
      return;
    }

    try {
      const [rows] = await pool.query(
        'SELECT id, status FROM inventory_sessions WHERE id = ? LIMIT 1',
        [sessionId]
      );

      if (!rows.length) {
        acknowledge({ ok: false, message: 'Inventory session not found.' });
        return;
      }

      for (const room of socket.rooms) {
        if (room.startsWith('inventory:')) socket.leave(room);
      }

      socket.join(`inventory:${sessionId}`);
      socket.data.inventorySessionId = sessionId;
      acknowledge({ ok: true, session_id: sessionId, status: rows[0].status });
    } catch (error) {
      console.error('INVENTORY SOCKET JOIN ERROR:', error);
      acknowledge({ ok: false, message: 'Unable to join live inventory updates.' });
    }
  });

  socket.on('inventory:leave', () => {
    const sessionId = socket.data.inventorySessionId;
    if (sessionId) socket.leave(`inventory:${sessionId}`);
    socket.data.inventorySessionId = null;
  });
});

  
const REPAIR_STATUSES = [
  'For Repair',
  'Under Diagnosis',
  'Under Repair',
  'Waiting for Parts',
  'Repaired',
  'Returned',
  'For Disposal',
  'Beyond Repair',
  'Cancelled'
];

const REPAIR_PRIORITIES = [
  'Low',
  'Medium',
  'High',
  'Critical'
];

app.get('/maintenance',requireLogin,(req,res)=>res.sendFile(path.join(__dirname,'public','maintenance.html')));

app.get('/api/maintenance/summary', requireLogin, async (req, res) => {
    try {

        const [rows] = await pool.query(`
            SELECT
                COALESCE(
                    SUM(
                        status IN (
                            'Under Diagnosis',
                            'Under Repair',
                            'Waiting for Parts'
                        )
                    ),
                    0
                ) AS under_repair,

                COALESCE(SUM(status = 'Repaired'), 0) AS repaired,
                COALESCE(SUM(status = 'For Disposal'), 0) AS for_disposal,

                COALESCE(SUM(
                    CASE
                        WHEN status <> 'Cancelled'
                        THEN COALESCE(total_cost, 0)
                        ELSE 0
                    END
                ), 0) AS total_repair_cost,

                COALESCE(SUM(status = 'For Repair'), 0)
                    AS legacy_for_repair,

                COALESCE(SUM(status = 'Beyond Repair'), 0)
                    AS legacy_beyond_repair

            FROM asset_repairs
        `);

        const x = rows[0] || {};

        res.json({
            under_repair: +(x.under_repair || 0),
            repaired: +(x.repaired || 0),
            for_disposal: +(x.for_disposal || 0),
            total_repair_cost: +(x.total_repair_cost || 0),
            legacy_for_repair: +(x.legacy_for_repair || 0),
            legacy_beyond_repair: +(x.legacy_beyond_repair || 0)
        });

    } catch (e) {

        res.status(500).json({
            message: 'Unable to load maintenance summary.',
            error: e.message
        });

    }
});
app.get('/api/repairs', requireLogin, async (req, res) => {

  try {

    const search =
      String(req.query.search || '').trim();

    const status =
      String(req.query.status || '').trim();

    const priority =
      String(req.query.priority || '').trim();

    let sql = `
      SELECT
        ar.*,

        ad.id AS disposal_id,

        /* =====================================================
           ASSET INFORMATION
           ===================================================== */

        a.id AS db_asset_id,
        a.asset_id AS asset_code,
        a.asset_name,
        a.brand,
        a.model,
        a.serial_number,
        a.barcode,
        a.status AS asset_status,
        a.condition_status,

        /* =====================================================
           CATEGORY / LOCATION
           ===================================================== */

        c.name AS category_name,
        l.name AS location_name,

        /* =====================================================
           CUSTODIAN
           ===================================================== */

        ce.full_name AS custodian_name,
        ce.employee_id AS custodian_employee_id,

        d.name AS department_name,

        /* =====================================================
           TECHNICIAN
           ===================================================== */

        te.full_name AS technician_name,
        te.employee_id AS technician_employee_id,

        /* =====================================================
           REPORTED BY
           ===================================================== */

        u.full_name AS reported_by_name

      FROM asset_repairs ar

      INNER JOIN assets a
        ON a.id = ar.asset_id

      LEFT JOIN (
        SELECT
          d1.repair_id,
          MAX(d1.id) AS id
        FROM asset_disposals d1
        WHERE d1.status NOT IN ('Rejected', 'Disposed')
        GROUP BY d1.repair_id
      ) ad
        ON ad.repair_id = ar.id

      LEFT JOIN asset_categories c
        ON c.id = a.category_id

      LEFT JOIN locations l
        ON l.id = a.location_id

      LEFT JOIN employees ce
        ON ce.id = ar.custodian_id

      LEFT JOIN departments d
        ON d.id = ce.department_id

      LEFT JOIN employees te
        ON te.id = ar.technician_id

      LEFT JOIN users u
        ON u.id = ar.reported_by

      WHERE 1 = 1
    `;

    const params = [];

    /* ==========================================================
       SEARCH
       ========================================================== */

    if (search) {

      sql += `
        AND (
          ar.repair_no LIKE ?
          OR a.asset_id LIKE ?
          OR a.asset_name LIKE ?
          OR a.brand LIKE ?
          OR a.model LIKE ?
          OR a.serial_number LIKE ?
          OR a.barcode LIKE ?
          OR ce.full_name LIKE ?
          OR ce.employee_id LIKE ?
          OR te.full_name LIKE ?
        )
      `;

      const term = `%${search}%`;

      params.push(
        term,
        term,
        term,
        term,
        term,
        term,
        term,
        term,
        term,
        term
      );
    }

    /* ==========================================================
       STATUS FILTER
       ========================================================== */

    if (status) {

      sql += `
        AND ar.status = ?
      `;

      params.push(status);
    }

    /* ==========================================================
       PRIORITY FILTER
       ========================================================== */

    if (priority) {

      sql += `
        AND ar.priority = ?
      `;

      params.push(priority);
    }

    /* ==========================================================
       ORDER
       ========================================================== */

    sql += `
      ORDER BY
        ar.date_reported DESC,
        ar.id DESC
    `;

    const [rows] =
      await pool.query(
        sql,
        params
      );

    return res.json(rows);

  } catch (e) {

    console.error(
      'LOAD REPAIR RECORDS ERROR:',
      e
    );

    return res.status(500).json({
      message:
        'Unable to load repair records.',
      error:
        e.message
    });

  }

});
app.get('/api/repairs/:id', requireLogin, async (req, res) => {
  try {
    const id = Number(req.params.id);

    const [rows] = await pool.query(`
      SELECT
        ar.*,
        EXISTS (
          SELECT 1
          FROM asset_assignments current_assignment
          INNER JOIN employees current_custodian
            ON current_custodian.id = current_assignment.employee_id
          WHERE current_assignment.asset_id = ar.asset_id
            AND current_assignment.returned_at IS NULL
            AND current_custodian.status = 'active'
        ) AS has_active_custodian,
        d.id AS disposal_id,
        d.disposal_no,
        d.status AS disposal_status,
        d.disposal_method,
        d.disposal_remarks,
        a.id AS db_asset_id,
        a.asset_id AS asset_code,
        a.asset_name,
        a.brand,
        a.model,
        a.serial_number,
        a.barcode,
        a.condition_status,
        a.status AS asset_status,
        c.name AS category_name,
        l.name AS location_name,
        ce.full_name AS custodian_name,
        ce.employee_id AS custodian_employee_id,
        dp.name AS department_name,
        te.full_name AS technician_name,
        te.employee_id AS technician_employee_id,
        u.full_name AS reported_by_name
      FROM asset_repairs ar
      INNER JOIN assets a
        ON a.id = ar.asset_id
      LEFT JOIN asset_disposals d
        ON d.repair_id = ar.id
      LEFT JOIN asset_categories c
        ON c.id = a.category_id
      LEFT JOIN locations l
        ON l.id = a.location_id
      LEFT JOIN employees ce
        ON ce.id = ar.custodian_id
      LEFT JOIN departments dp
        ON dp.id = ce.department_id
      LEFT JOIN employees te
        ON te.id = ar.technician_id
      LEFT JOIN users u
        ON u.id = ar.reported_by
      WHERE ar.id = ?
      ORDER BY d.id DESC
      LIMIT 1
    `, [id]);

    if (!rows.length) {
      return res.status(404).json({ message: 'Repair record not found.' });
    }

    return res.json(rows[0]);
  } catch (error) {
    return res.status(500).json({
      message: 'Unable to load repair record.',
      error: error.message
    });
  }
});

app.post('/api/repairs', requireMaintenanceStaff, async (req, res) => {

  const connection = await pool.getConnection();

  try {

    const {
      asset_id,
      date_reported,
      date_received,
      problem_description,
      priority,
      initial_condition,
      technician_id,
      vendor,
      diagnosis,
      repair_action,
      parts_replaced,
      parts_cost,
      labor_cost,
      warranty,
      status,
      remarks
    } = req.body;

    const aid = Number(asset_id);

    if (!aid) {
      return res.status(400).json({
        message: 'Please select an asset.'
      });
    }

    if (!String(problem_description || '').trim()) {
      return res.status(400).json({
        message: 'Problem / Issue is required.'
      });
    }

    const validPriorities = [
      'Low',
      'Medium',
      'High',
      'Critical'
    ];

    const validStatuses = [
      'For Repair',
      'Under Diagnosis',
      'Under Repair',
      'Waiting for Parts',
      'Repaired'
    ];

    const repairPriority =
      validPriorities.includes(priority)
        ? priority
        : 'Medium';

    const repairStatus =
      validStatuses.includes(status)
        ? status
        : 'For Repair';

    const normalizeDate = value => {
      if (!value) return null;

      return String(value)
        .replace('T', ' ')
        .slice(0, 19);
    };

    const technicianId =
      technician_id
        ? Number(technician_id)
        : null;

    const partsCost =
      Math.max(
        0,
        Number(parts_cost) || 0
      );

    const laborCost =
      Math.max(
        0,
        Number(labor_cost) || 0
      );

    const totalCost =
      partsCost + laborCost;

    await connection.beginTransaction();

    /* ============================================================
       GET ASSET + ACTIVE CUSTODIAN
       ============================================================ */

    const [assetRows] =
      await connection.query(
        `
        SELECT
          a.id,
          a.asset_id,
          a.asset_name,
          a.status,
          a.condition_status,

          aa.employee_id AS active_employee_id,

          e.employee_id AS custodian_employee_id,
          e.full_name AS custodian_name

        FROM assets a

        LEFT JOIN asset_assignments aa
          ON aa.asset_id = a.id
         AND aa.returned_at IS NULL

        LEFT JOIN employees e
          ON e.id = aa.employee_id

        WHERE a.id = ?

        LIMIT 1

        FOR UPDATE
        `,
        [aid]
      );

    if (!assetRows.length) {
      throw new Error(
        'Asset not found.'
      );
    }

    const asset = assetRows[0];

    /* ============================================================
       PREVENT DUPLICATE OPEN REPAIR
       ============================================================ */

    const [existingRepairs] =
      await connection.query(
        `
        SELECT
          id,
          repair_no,
          status

        FROM asset_repairs

        WHERE asset_id = ?

        AND status IN (
          'For Repair',
          'Under Diagnosis',
          'Under Repair',
          'Waiting for Parts',
          'Repaired'
        )

        LIMIT 1
        `,
        [aid]
      );

    if (existingRepairs.length) {

      throw new Error(
        `${asset.asset_id} already has an active repair record (${existingRepairs[0].repair_no}).`
      );
    }

   if (['Disposed', 'Retired', 'For Disposal'].includes(asset.status)) {

      throw new Error(
        `${asset.asset_id} is ${asset.status} and cannot be sent for repair.`
      );
    }

    /* ============================================================
       CREATE REPAIR
       ============================================================ */

    const [result] =
      await connection.query(
        `
        INSERT INTO asset_repairs
        (
          repair_no,
          asset_id,
          reported_by,
          custodian_id,
          technician_id,

          asset_previous_status,

          date_reported,
          date_received,

          problem_description,
          initial_condition,

          priority,

          diagnosis,
          repair_action,
          parts_replaced,

          parts_cost,
          labor_cost,
          total_cost,

          vendor,
          warranty,

          status,
          remarks
        )

        VALUES
        (
          'TEMP',
          ?, ?, ?, ?,
          ?,
          ?, ?,
          ?, ?,
          ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?,
          ?,
          ?
        )
        `,
        [

          asset.id,

          req.session.user.id,

          asset.active_employee_id || null,

          technicianId,

          asset.status,

          normalizeDate(date_reported) ||
            new Date(),

          normalizeDate(date_received),

          String(
            problem_description
          ).trim(),

          initial_condition ||
            asset.condition_status ||
            null,

          repairPriority,

          diagnosis || null,

          repair_action || null,

          parts_replaced || null,

          partsCost,

          laborCost,

          totalCost,

          vendor || null,

          warranty || null,

          repairStatus,

          remarks || null
        ]
      );

    /* ============================================================
       GENERATE REPAIR NUMBER
       ============================================================ */

    const repairNo =
      `REP-${new Date().getFullYear()}-${String(
        result.insertId
      ).padStart(6, '0')}`;

    await connection.query(
      `
      UPDATE asset_repairs

      SET repair_no = ?

      WHERE id = ?
      `,
      [
        repairNo,
        result.insertId
      ]
    );

    /* ============================================================
       UPDATE ASSET STATUS
       ============================================================ */

    let nextAssetStatus =
      'For Repair';

    if (
      [
        'Under Diagnosis',
        'Under Repair',
        'Waiting for Parts',
        'Repaired'
      ].includes(repairStatus)
    ) {
      nextAssetStatus =
        'Repairing';
    }

    await connection.query(
      `
      UPDATE assets

      SET status = ?

      WHERE id = ?
      `,
      [
        nextAssetStatus,
        asset.id
      ]
    );

    /* ============================================================
       ASSET HISTORY
       ============================================================ */

    await connection.query(
      `
      INSERT INTO asset_history
      (
        asset_id,
        action,
        from_status,
        to_status,
        from_employee_id,
        to_employee_id,
        remarks,
        performed_by
      )

      VALUES
      (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        asset.id,

        'Repair Reported',

        asset.status,

        nextAssetStatus,

        asset.active_employee_id || null,

        asset.active_employee_id || null,

        String(
          problem_description
        ).trim(),

        req.session.user.id
      ]
    );

    /* ============================================================
       AUDIT LOG
       ============================================================ */

    await connection.query(
      `
      INSERT INTO audit_logs
      (
        user_id,
        action,
        entity_type,
        entity_id,
        details
      )

      VALUES
      (?, ?, ?, ?, ?)
      `,
      [
        req.session.user.id,

        'REPAIR_CREATE',

        'asset_repair',

        result.insertId,

        JSON.stringify({
          repair_no: repairNo,
          asset_id: asset.asset_id,
          asset_name: asset.asset_name,
          previous_status:
            asset.status
        })
      ]
    );

    await connection.commit();

    return res.status(201).json({
      ok: true,

      message:
        'Repair request created successfully.',

      id:
        result.insertId,

      repair_no:
        repairNo
    });

  } catch (error) {

    await connection.rollback();

    console.error(
      'CREATE REPAIR ERROR:',
      error
    );

    return res.status(400).json({
      message:
        error.message ||
        'Unable to create repair request.'
    });

  } finally {

    connection.release();

  }

});
app.put('/api/repairs/:id', requireMaintenanceStaff, async (req, res) => {
  const c = await pool.getConnection();

  try {
    const id = Number(req.params.id);

    const {
      status,
      priority,
      technician_id,
      date_received,
      date_completed,
      diagnosis,
      repair_action,
      parts_replaced,
      parts_cost,
      labor_cost,
      vendor,
      warranty,
      remarks
    } = req.body;

    const cleanStatus = String(status || '').trim();
    const cleanPriority = String(priority || '').trim();

    if (!REPAIR_STATUSES.includes(cleanStatus)) {
      return res.status(400).json({
        message: `Invalid repair status: ${cleanStatus}`
      });
    }

    if (!REPAIR_PRIORITIES.includes(cleanPriority)) {
      return res.status(400).json({
        message: `Invalid repair priority: ${cleanPriority}`
      });
    }

    await c.beginTransaction();

    const [rr] = await c.query(`
      SELECT
        ar.*,
        a.id AS db_asset_id,
        a.asset_id AS asset_code,
        a.status AS asset_status
      FROM asset_repairs ar
      INNER JOIN assets a
        ON a.id = ar.asset_id
      WHERE ar.id = ?
      LIMIT 1
      FOR UPDATE
    `, [id]);

    if (!rr.length) {
      throw new Error('Repair record not found.');
    }

    const r = rr[0];

    if (r.status === 'Returned') {
      throw new Error(
        `Repair record ${r.repair_no} is already Returned and cannot be modified.`
      );
    }

    const tech = technician_id
      ? Number(technician_id)
      : null;

    const norm = value => {
      if (!value) return null;

      return String(value)
        .replace('T', ' ')
        .trim();
    };

    const pc = Math.max(0, Number(parts_cost) || 0);
    const lc = Math.max(0, Number(labor_cost) || 0);
    const tc = pc + lc;

    const completed =
      cleanStatus === 'Repaired' && !date_completed
        ? new Date()
        : norm(date_completed);

    await c.query(`
      UPDATE asset_repairs
      SET
        status = ?,
        priority = ?,
        technician_id = ?,
        date_received = ?,
        date_completed = ?,
        diagnosis = ?,
        repair_action = ?,
        parts_replaced = ?,
        parts_cost = ?,
        labor_cost = ?,
        total_cost = ?,
        vendor = ?,
        warranty = ?,
        remarks = ?
      WHERE id = ?
    `, [
      cleanStatus,
      cleanPriority,
      tech,
      norm(date_received),
      completed,
      diagnosis || null,
      repair_action || null,
      parts_replaced || null,
      pc,
      lc,
      tc,
      vendor || null,
      warranty || null,
      remarks || null,
      id
    ]);

    let next = r.asset_status;

    if (cleanStatus === 'For Repair') {
      next = 'For Repair';
    } else if (
      [
        'Under Diagnosis',
        'Under Repair',
        'Waiting for Parts',
        'Repaired'
      ].includes(cleanStatus)
    ) {
      next = 'Repairing';
    } else if (cleanStatus === 'Beyond Repair') {
      next = 'Broken';
    } else if (cleanStatus === 'Cancelled') {
      next = r.asset_previous_status || 'Available';
    }

    if (next !== r.asset_status) {
      const [aa] = await c.query(`
        SELECT employee_id
        FROM asset_assignments
        WHERE asset_id = ?
          AND returned_at IS NULL
        ORDER BY id DESC
        LIMIT 1
      `, [r.db_asset_id]);

      const emp = aa[0]?.employee_id || null;

      await c.query(`
        UPDATE assets
        SET status = ?
        WHERE id = ?
      `, [next, r.db_asset_id]);

      await c.query(`
        INSERT INTO asset_history (
          asset_id,
          action,
          from_status,
          to_status,
          from_employee_id,
          to_employee_id,
          remarks,
          performed_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        r.db_asset_id,
        'Repair Status Updated',
        r.asset_status,
        next,
        emp,
        emp,
        `Repair ${r.repair_no}: ${cleanStatus}`,
        req.session.user.id
      ]);
    }

    await c.query(`
      INSERT INTO audit_logs (
        user_id,
        action,
        entity_type,
        entity_id,
        details
      )
      VALUES (?, ?, ?, ?, ?)
    `, [
      req.session.user.id,
      'REPAIR_UPDATE',
      'asset_repair',
      id,
      JSON.stringify({
        repair_no: r.repair_no,
        asset_id: r.asset_code,
        old_status: r.status,
        new_status: cleanStatus,
        total_cost: tc
      })
    ]);

    await c.commit();

    return res.json({
      ok: true,
      message: 'Repair record updated successfully.'
    });

  } catch (e) {
    try {
      await c.rollback();
    } catch (_) {}

    console.error('UPDATE REPAIR ERROR:', e);

    return res.status(400).json({
      message: e.message || 'Unable to update repair record.'
    });

  } finally {
    c.release();
  }
});

app.put('/api/repairs/:id/legacy', requireMaintenanceStaff, async (req, res) => {const c=await pool.getConnection();try{const id=+req.params.id;const{status,priority,technician_id,date_received,date_completed,diagnosis,repair_action,parts_replaced,parts_cost,labor_cost,vendor,warranty,remarks}=req.body;if(!REPAIR_STATUSES.includes(status)||!REPAIR_PRIORITIES.includes(priority))return res.status(400).json({message:'Invalid repair status or priority.'});await c.beginTransaction();const[rr]=await c.query(`SELECT ar.*,a.asset_id asset_code,a.status asset_status FROM asset_repairs ar INNER JOIN assets a ON a.id=ar.asset_id WHERE ar.id=? LIMIT 1 FOR UPDATE`,[id]);if(!rr.length)throw Error('Repair record not found.');
const r=rr[0];
if (r.status === 'Returned') {
  throw Error(
    `Repair record ${r.repair_no} is already Returned and cannot be modified.`
  );
}
const tech=technician_id?+technician_id:null;const norm=v=>v?String(v).replace('T',' '):null;const pc=Math.max(0,Number(parts_cost)||0),lc=Math.max(0,Number(labor_cost)||0),tc=pc+lc,completed=(status==='Repaired'&&!date_completed)?new Date():norm(date_completed);await c.query(`UPDATE asset_repairs SET status=?,priority=?,technician_id=?,date_received=?,date_completed=?,diagnosis=?,repair_action=?,parts_replaced=?,parts_cost=?,labor_cost=?,total_cost=?,vendor=?,warranty=?,remarks=? WHERE id=?`,[status,priority,tech,norm(date_received),completed,diagnosis||null,repair_action||null,parts_replaced||null,pc,lc,tc,vendor||null,warranty||null,remarks||null,id]);let next=r.asset_status;if(status==='For Repair')next='For Repair';else if(['Under Diagnosis','Under Repair','Waiting for Parts','Repaired'].includes(status))next='Repairing';else if(status==='Beyond Repair')next='Broken';else if(status==='Cancelled')next=r.asset_previous_status||'Available';if(next!==r.asset_status){const[aa]=await c.query(`SELECT employee_id FROM asset_assignments WHERE asset_id=? AND returned_at IS NULL ORDER BY id DESC LIMIT 1`,[r.asset_id]);const emp=aa[0]?.employee_id||null;await c.query(`UPDATE assets SET status=? WHERE id=?`,[next,r.asset_id]);await c.query(`INSERT INTO asset_history(asset_id,action,from_status,to_status,from_employee_id,to_employee_id,remarks,performed_by) VALUES(?,?,?,?,?,?,?,?)`,[r.asset_id,'Repair Status Updated',r.asset_status,next,emp,emp,`Repair ${r.repair_no}: ${status}`,req.session.user.id])}await c.query(`INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details) VALUES(?,?,?,?,?)`,[req.session.user.id,'REPAIR_UPDATE','asset_repair',id,JSON.stringify({repair_no:r.repair_no,asset_id:r.asset_code,old_status:r.status,new_status:status,total_cost:tc})]);await c.commit();res.json({ok:true,message:'Repair record updated successfully.'})}catch(e){await c.rollback();res.status(400).json({message:e.message||'Unable to update repair record.'})}finally{c.release()}});

app.post('/api/repairs/:id/finalize-old', requireMaintenanceStaff, async (req, res) => {
  const repairId = Number(req.params.id);
  const disposition = String(req.body.disposition || '').trim().toLowerCase();
  const remarks = String(req.body.remarks || '').trim();

  if (!Number.isInteger(repairId) || repairId <= 0) {
    return res.status(400).json({ message: 'Invalid repair ID.' });
  }

  const validDispositions = ['custodian', 'inventory', 'disposal'];

  if (!validDispositions.includes(disposition)) {
    return res.status(400).json({ message: 'Invalid final disposition.' });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(`
      SELECT
        r.*,
        a.id AS db_asset_id,
        a.asset_id AS asset_code,
        a.status AS asset_status,
        a.asset_name,
        a.serial_number,
        a.barcode,
        a.category_id,
        a.location_id
      FROM asset_repairs r
      INNER JOIN assets a
        ON a.id = r.asset_id
      WHERE r.id = ?
      LIMIT 1
      FOR UPDATE
    `, [repairId]);

    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ message: 'Repair record not found.' });
    }

    const repair = rows[0];
    const assetDbId = Number(repair.db_asset_id);
    const assetTag = repair.asset_code;

    console.log('FINALIZE ASSET:', {
      repairId,
      assetDbId,
      assetTag,
      disposition
    });

    if (repair.status === 'Returned') {
      await conn.rollback();
      return res.status(400).json({
        message: 'This repair has already been finalized.'
      });
    }

    if (repair.status === 'Cancelled') {
      await conn.rollback();
      return res.status(400).json({
        message: 'Cancelled repairs cannot be finalized.'
      });
    }

    if (disposition === 'disposal') {
      const allowedStatuses = [
        'For Repair',
        'Under Diagnosis',
        'Under Repair',
        'Waiting for Parts',
        'Repaired',
        'Beyond Repair'
      ];

      if (!allowedStatuses.includes(repair.status)) {
        await conn.rollback();
        return res.status(400).json({
          message:
            `Repair status "${repair.status}" cannot be sent for disposal.`
        });
      }

      await conn.query(`
        UPDATE asset_assignments
        SET returned_at = NOW(), return_remarks = ?
        WHERE asset_id = ?
          AND returned_at IS NULL
      `, [
        remarks || 'Asset sent to For Disposal status.',
        assetDbId
      ]);

      await conn.query(`
        UPDATE assets
        SET status = 'For Disposal'
        WHERE id = ?
      `, [assetDbId]);

      await conn.query(`
        UPDATE asset_repairs
        SET
          status = 'For Disposal',
          date_completed = COALESCE(date_completed, NOW()),
          remarks = ?
        WHERE id = ?
      `, [remarks || 'Asset marked For Disposal.', repairId]);

      await conn.query(`
        INSERT INTO asset_history (
          asset_id,
          action,
          from_status,
          to_status,
          remarks,
          performed_by
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `, [
        assetDbId,
        'Asset Marked For Disposal',
        repair.asset_status,
        'For Disposal',
        `Repair ${repair.repair_no} marked asset ${assetTag} For Disposal.`,
        req.session.user.id
      ]);

      await conn.query(`
        INSERT INTO audit_logs (
          user_id,
          action,
          entity_type,
          entity_id,
          details
        )
        VALUES (?, ?, ?, ?, ?)
      `, [
        req.session.user.id,
        'ASSET_FOR_DISPOSAL',
        'asset_repairs',
        repairId,
        JSON.stringify({
          asset_id: assetTag,
          repair_no: repair.repair_no,
          message: `Asset ${assetTag} marked For Disposal.`
        })
      ]);

      await conn.commit();

      return res.json({
        success: true,
        message:
          'Asset marked For Disposal. Create the disposal request from Disposal Requests.',
        asset_id: assetTag,
        repair_id: repairId,
        status: 'For Disposal'
      });
    }

    if (repair.status !== 'Repaired') {
      await conn.rollback();
      return res.status(400).json({
        message:
          disposition === 'custodian'
            ? 'The repair must be marked Repaired before returning it to the custodian.'
            : 'The repair must be marked Repaired before returning it to IT inventory.'
      });
    }

    if (disposition === 'custodian') {
      const [assignment] = await conn.query(`
        SELECT aa.id, aa.employee_id
        FROM asset_assignments aa
        INNER JOIN employees e
          ON e.id = aa.employee_id
        WHERE aa.asset_id = ?
          AND aa.returned_at IS NULL
          AND e.status = 'active'
        ORDER BY aa.id DESC
        LIMIT 1
        FOR UPDATE
      `, [assetDbId]);

      if (!assignment.length) {
        await conn.rollback();
        return res.status(400).json({
          message:
            'No active custodian assignment was found for this asset. Use "Return to IT Inventory" if the asset has already been returned.'
        });
      }

      await conn.query(`UPDATE assets SET status = 'Assigned' WHERE id = ?`, [assetDbId]);
      await conn.query(`
        UPDATE asset_repairs
        SET status = 'Returned', date_completed = COALESCE(date_completed, NOW()), remarks = ?
        WHERE id = ?
      `, [remarks || 'Repaired asset returned to custodian.', repairId]);

      await conn.query(`
        INSERT INTO asset_history (asset_id, action, from_status, to_status, remarks, performed_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [
        assetDbId,
        'Repair Finalized',
        repair.asset_status,
        'Assigned',
        `Repair ${repair.repair_no} returned to custodian.`,
        req.session.user.id
      ]);

      await conn.query(`
        INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
        VALUES (?, ?, ?, ?, ?)
      `, [
        req.session.user.id,
        'REPAIR_FINALIZE',
        'asset_repairs',
        repairId,
        JSON.stringify({
          repair_no: repair.repair_no,
          asset_id: assetTag,
          disposition: 'custodian'
        })
      ]);

      await conn.commit();
      return res.json({
        success: true,
        message: 'Repaired asset returned to custodian.',
        asset_id: assetTag,
        repair_id: repairId,
        status: 'Returned'
      });
    }

    await conn.query(`
      UPDATE asset_assignments
      SET returned_at = NOW(), return_remarks = ?
      WHERE asset_id = ?
        AND returned_at IS NULL
    `, [remarks || 'Repaired asset returned to IT inventory.', assetDbId]);

    await conn.query(`UPDATE assets SET status = 'Available' WHERE id = ?`, [assetDbId]);
    await conn.query(`
      UPDATE asset_repairs
      SET status = 'Returned', date_completed = COALESCE(date_completed, NOW()), remarks = ?
      WHERE id = ?
    `, [remarks || 'Repaired asset returned to IT inventory.', repairId]);

    await conn.query(`
      INSERT INTO asset_history (asset_id, action, from_status, to_status, remarks, performed_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      assetDbId,
      'Repair Finalized',
      repair.asset_status,
      'Available',
      `Repair ${repair.repair_no} returned to IT inventory.`,
      req.session.user.id
    ]);

    await conn.query(`
      INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
      VALUES (?, ?, ?, ?, ?)
    `, [
      req.session.user.id,
      'REPAIR_FINALIZE',
      'asset_repairs',
      repairId,
      JSON.stringify({
        repair_no: repair.repair_no,
        asset_id: assetTag,
        disposition: 'inventory'
      })
    ]);

    await conn.commit();

    return res.json({
      success: true,
      message: 'Repaired asset returned to IT inventory.',
      asset_id: assetTag,
      repair_id: repairId,
      status: 'Returned'
    });

  } catch (err) {
    try {
      await conn.rollback();
    } catch (_) {}

    console.error('FINALIZE REPAIR ERROR:', err);

    return res.status(500).json({
      message: 'Failed to finalize repair.',
      error: err.message
    });

  } finally {
    conn.release();
  }
});

app.post('/api/repairs/:id/finalize', requireMaintenanceStaff, async (req, res) => {
      const repairId = Number(req.params.id);
    const disposition = String(req.body.disposition || '').trim().toLowerCase();

    const disposalMethod = String(
        req.body.disposal_method || ''
    ).trim();

    const remarks = String(
        req.body.remarks || ''
    ).trim();

    if (!Number.isInteger(repairId) || repairId <= 0) {
        return res.status(400).json({
            message: 'Invalid repair ID.'
        });
    }

    const validDispositions = [
        'custodian',
        'inventory',
        'disposal'
    ];

    if (!validDispositions.includes(disposition)) {
        return res.status(400).json({
            message: 'Invalid final disposition.'
        });
    }

    if (disposition === 'disposal' && !disposalMethod) {
        return res.status(400).json({
            message: 'Disposal Method is required.'
        });
    }

    const conn = await pool.getConnection();

    try {
        await conn.beginTransaction();

        /*
         * Get repair + asset and lock the rows.
         */
        const [rows] = await conn.query(`
            SELECT
                r.*,
                a.id AS db_asset_id,
                a.asset_id AS asset_code,
                a.status AS asset_status,
                a.asset_name,
                a.serial_number,
                a.barcode,
                a.category_id,
                a.location_id
            FROM asset_repairs r
            INNER JOIN assets a
                ON a.id = r.asset_id
            WHERE r.id = ?
            FOR UPDATE
        `, [repairId]);

        if (!rows.length) {
            await conn.rollback();

            return res.status(404).json({
                message: 'Repair record not found.'
            });
        }

        const repair = rows[0];

        const assetDbId = Number(repair.db_asset_id);
        const assetTag = String(repair.asset_code || '').trim();

        if (!Number.isInteger(assetDbId) || assetDbId <= 0 || !assetTag) {
            throw new Error('The repair record has an invalid asset reference.');
        }

        /*
         * Do not allow a repair that has already been finalized.
         */
        if (repair.status === 'Returned') {
            await conn.rollback();

            return res.status(400).json({
                message: 'This repair has already been finalized.'
            });
        }

        if (repair.status === 'Cancelled') {
            await conn.rollback();

            return res.status(400).json({
                message: 'Cancelled repairs cannot be finalized.'
            });
        }

        /*
         * Disposal can be selected when the technician determines
         * that the asset should go through the disposal process.
         */
       const disposalAllowedStatuses = [
    'For Repair',
    'Under Diagnosis',
    'Under Repair',
    'Waiting for Parts',
    'Repaired',
    'Beyond Repair',
    'For Disposal'
];
        if (
            disposition === 'disposal' &&
            !disposalAllowedStatuses.includes(repair.status)
        ) {
            await conn.rollback();

            return res.status(400).json({
                message:
                    `Repair status "${repair.status}" cannot be sent for disposal.`
            });
        }

        /*
         * Normal finalization requires Repaired.
         */
        if (
            disposition !== 'disposal' &&
            repair.status !== 'Repaired'
        ) {
            await conn.rollback();

            return res.status(400).json({
                message:
                    'The repair must be marked Repaired before returning it to the custodian or IT inventory.'
            });
        }

        /*
         * ==========================================================
         * FOR DISPOSAL
         * ==========================================================
         */
        if (disposition === 'disposal') {

            /*
             * Prevent duplicate active disposal requests.
             */
            const [existingDisposals] = await conn.query(`
                SELECT
                    id,
                    disposal_no,
                    status
                FROM asset_disposals
                WHERE asset_id = ?
                  AND status NOT IN ('Rejected', 'Disposed')
                LIMIT 1
                FOR UPDATE
            `, [assetDbId]);

            if (existingDisposals.length) {
                await conn.rollback();

                return res.status(409).json({
                    message:
                        `An active disposal request already exists: ${existingDisposals[0].disposal_no}`,
                    disposal_id: existingDisposals[0].id,
                    disposal_no: existingDisposals[0].disposal_no
                });
            }

            console.log('DISPOSAL ASSET RESOLUTION:', {
                assetTag,
                assetDbId
            });

            /*
             * Close the active custodian assignment.
             */
            await conn.query(`
                UPDATE asset_assignments
                SET
                    returned_at = NOW(),
                    return_remarks = ?
                WHERE asset_id = ?
                  AND returned_at IS NULL
            `, [
                remarks || 'Asset sent for disposal approval.',
                assetDbId
            ]);

            /*
             * Generate disposal number.
             */
            const year = new Date().getFullYear();

            const [lastDisposal] = await conn.query(`
                SELECT disposal_no
                FROM asset_disposals
                WHERE disposal_no LIKE ?
                ORDER BY id DESC
                LIMIT 1
                FOR UPDATE
            `, [`DISP-${year}-%`]);

            let nextNumber = 1;

            if (lastDisposal.length) {
                const match =
                    String(lastDisposal[0].disposal_no)
                        .match(/DISP-\d{4}-(\d+)$/);

                if (match) {
                    nextNumber = Number(match[1]) + 1;
                }
            }

            const disposalNo =
                `DISP-${year}-${String(nextNumber).padStart(4, '0')}`;

            /*
             * Build disposal reason/recommendation.
             */
            const reason =
                String(
                    repair.diagnosis ||
                    repair.problem_description ||
                    'Asset recommended for disposal.'
                ).trim();

            const recommendation =
                String(
                    repair.repair_action ||
                    'Recommend disposal subject to IT, Accounting Head, and President approval.'
                ).trim();

            // ==========================================================
            // CREATE DISPOSAL REQUEST
            // ==========================================================

            const [disposalResult] = await conn.query(`
                INSERT INTO asset_disposals (
                    disposal_no,
                    asset_id,
                    repair_id,
                    reason,
                    recommendation,
                    disposal_method,
                    status,
                    created_by
                )
                VALUES (?, ?, ?, ?, ?, ?, 'Pending Approval', ?)
            `, [
                disposalNo,
                assetDbId,
                repairId,
                reason,
                recommendation,
                disposalMethod,
                req.session.user.id
            ]);

            const [itemResult] = await conn.query(`
                INSERT INTO asset_disposal_items (
                    disposal_id,
                    asset_id,
                    repair_id,
                    reason,
                    remarks
                )
                VALUES (?, ?, ?, ?, ?)
            `, [
                disposalResult.insertId,
                assetDbId,
                repairId,
                reason,
                remarks || null
            ]);

            console.log('========================================');
            console.log('DISPOSAL ITEM CREATED SUCCESSFULLY');
            console.log('itemResult:', itemResult);
            console.log('itemId:', itemResult.insertId);
            console.log('disposalId:', disposalResult.insertId);
            console.log('assetId:', assetDbId);
            console.log('repairId:', repairId);
            console.log('========================================');

            /*
             * Update asset.
             */
            await conn.query(`
                UPDATE assets
                SET status = 'For Disposal'
                WHERE id = ?
            `, [assetDbId]);

            /*
             * Update repair.
             */
            await conn.query(`
                UPDATE asset_repairs
                SET
                    status = 'For Disposal',
                    date_completed = COALESCE(date_completed, NOW()),
                    remarks = ?
                WHERE id = ?
            `, [
                remarks || 'Asset sent for disposal approval.',
                repairId
            ]);

            // ==========================================================
            // ASSET HISTORY
            // ==========================================================

            await conn.query(`
                INSERT INTO asset_history (
                    asset_id,
                    action,
                    from_status,
                    to_status,
                    remarks,
                    performed_by
                )
                VALUES (?, ?, ?, ?, ?, ?)
            `, [
                assetDbId,
                'Asset For Disposal',
                repair.asset_previous_status || null,
                'For Disposal',
                `Repair ${repair.repair_no} finalized for disposal. Disposal No: ${disposalNo}.`,
                req.session.user.id
            ]);

            /*
             * Audit.
             */
            await conn.query(`
                INSERT INTO audit_logs (
                    user_id,
                    action,
                    entity_type,
                    entity_id,
                    details
                )
                VALUES (?, ?, ?, ?, JSON_OBJECT(
                    'asset_id', ?,
                    'disposal_no', ?,
                    'repair_no', ?,
                    'message', ?
                ))
            `, [
                req.session.user.id,
                'ASSET_FOR_DISPOSAL',
                'asset_disposals',
                disposalResult.insertId,
                assetTag,
                disposalNo,
                repair.repair_no,
                `Asset ${assetTag} sent for disposal approval. Disposal No: ${disposalNo}.`
            ]);

            await conn.commit();

            return res.json({
                success: true,
                message: 'Asset sent for disposal approval.',
                disposal_id: disposalResult.insertId,
                disposal_no: disposalNo,
                asset_id: assetTag,
                repair_id: repairId,
                status: 'Pending Approval'
            });
        }

        /*
         * ==========================================================
         * RETURN TO CUSTODIAN
         * ==========================================================
         */
        if (disposition === 'custodian') {

            const [assignment] = await conn.query(`
                SELECT
                    aa.id,
                    aa.employee_id
                FROM asset_assignments aa
                INNER JOIN employees e
                    ON e.id = aa.employee_id
                WHERE aa.asset_id = ?
                  AND aa.returned_at IS NULL
                  AND e.status = 'active'
                ORDER BY aa.id DESC
                LIMIT 1
                FOR UPDATE
            `, [assetDbId]);

            if (!assignment.length) {
                await conn.rollback();

                return res.status(400).json({
                    message:
                        'No active custodian assignment was found for this asset.'
                });
            }

            await conn.query(`
                UPDATE assets
                SET status = 'Assigned'
                WHERE id = ?
            `, [assetDbId]);

            await conn.query(`
                UPDATE asset_repairs
                SET
                    status = 'Returned',
                    date_completed = COALESCE(date_completed, NOW()),
                    remarks = ?
                WHERE id = ?
            `, [
                remarks || 'Repaired asset returned to custodian.',
                repairId
            ]);

            await conn.query(`
                INSERT INTO asset_history (
                    asset_id,
                    action,
                    from_status,
                    to_status,
                    remarks,
                    performed_by
                )
                VALUES (?, ?, ?, ?, ?, ?)
            `, [
                assetDbId,
                'Repair Finalized',
                repair.asset_status,
                'Assigned',
                `Repair ${repair.repair_no} returned to custodian.`,
                req.session.user.id
            ]);

            await conn.query(`
                INSERT INTO audit_logs (
                    user_id,
                    action,
                    entity_type,
                    entity_id,
                    details
                )
                VALUES (?, ?, ?, ?, ?)
            `, [
                req.session.user.id,
                'REPAIR_FINALIZE',
                'asset_repairs',
                repairId,
                JSON.stringify({
                    repair_no: repair.repair_no,
                    asset_id: assetTag,
                    from_status: repair.asset_status,
                    to_status: 'Assigned',
                    message: `Repair ${repair.repair_no} returned to custodian.`
                })
            ]);

            await conn.commit();

            return res.json({
                success: true,
                message: 'Repaired asset returned to custodian.',
                asset_id: assetTag,
                repair_id: repairId,
                status: 'Returned'
            });
        }

        /*
         * ==========================================================
         * RETURN TO IT INVENTORY
         * ==========================================================
         */
        if (disposition === 'inventory') {

            await conn.query(`
                UPDATE asset_assignments
                SET
                    returned_at = NOW(),
                    return_remarks = ?
                WHERE asset_id = ?
                  AND returned_at IS NULL
            `, [
                remarks || 'Repaired asset returned to IT inventory.',
                assetDbId
            ]);

            await conn.query(`
                UPDATE assets
                SET status = 'Available'
                WHERE id = ?
            `, [assetDbId]);

            await conn.query(`
                UPDATE asset_repairs
                SET
                    status = 'Returned',
                    date_completed = COALESCE(date_completed, NOW()),
                    remarks = ?
                WHERE id = ?
            `, [
                remarks || 'Repaired asset returned to IT inventory.',
                repairId
            ]);

            await conn.query(`
                INSERT INTO asset_history (
                    asset_id,
                    action,
                    from_status,
                    to_status,
                    remarks,
                    performed_by
                )
                VALUES (?, ?, ?, ?, ?, ?)
            `, [
                assetDbId,
                'Repair Finalized',
                repair.asset_status,
                'Available',
                `Repair ${repair.repair_no} returned to IT inventory.`,
                req.session.user.id
            ]);

            await conn.query(`
                INSERT INTO audit_logs (
                    user_id,
                    action,
                    entity_type,
                    entity_id,
                    details
                )
                VALUES (?, ?, ?, ?, ?)
            `, [
                req.session.user.id,
                'REPAIR_FINALIZE',
                'asset_repairs',
                repairId,
                JSON.stringify({
                    repair_no: repair.repair_no,
                    asset_id: assetTag,
                    from_status: repair.asset_status,
                    to_status: 'Available',
                    message: `Repair ${repair.repair_no} returned to IT inventory.`
                })
            ]);

            await conn.commit();

            return res.json({
                success: true,
                message: 'Repaired asset returned to IT inventory.',
                asset_id: assetTag,
                repair_id: repairId,
                status: 'Returned'
            });
        }

    } catch (err) {
        try {
            await conn.rollback();
        } catch (_) {}

        console.error('FINALIZE REPAIR ERROR:', err);

        return res.status(500).json({
            message: err.message || 'Failed to finalize repair.',
            error: err.message
        });

    } finally {
        conn.release();
    }
});



// ============================================================
// DISPOSAL APPROVAL FORM DATA
// ============================================================
app.get(
  '/api/disposals/:id/approval-form',
  requireLogin,
  async (req, res) => {

    try {

      const disposalId =
        Number(req.params.id);

      if (
        !Number.isInteger(disposalId) ||
        disposalId <= 0
      ) {

        return res.status(400).json({
          message: 'Invalid disposal ID.'
        });

      }


      // ========================================================
      // DISPOSAL HEADER
      // ========================================================

      const [disposalRows] =
        await pool.query(
          `
          SELECT

            d.id,

            d.disposal_no,

            d.reason,

            d.recommendation,

            d.disposal_method,

            d.status,

            d.it_remarks,

            d.accounting_approved_by,

            d.accounting_approved_name,

            d.accounting_approved_at,

            d.accounting_remarks,

            d.president_approved_by,

            d.president_approved_name,

            d.president_approved_at,

            d.president_remarks,

            d.created_at,

            d.created_by,

            u.full_name AS created_by_name

          FROM asset_disposals d

          LEFT JOIN users u
            ON u.id = d.created_by

          WHERE d.id = ?

          LIMIT 1
          `,
          [disposalId]
        );


      if (!disposalRows.length) {

        return res.status(404).json({
          message:
            'Disposal record not found.'
        });

      }


      const disposal =
        disposalRows[0];


      // ========================================================
      // DISPOSAL ITEMS
      // ========================================================

      const [items] =
        await pool.query(
          `
          SELECT

            di.id AS disposal_item_id,

            di.disposal_id,

            di.asset_id,

            di.repair_id,

            di.reason AS item_reason,

            di.remarks AS item_remarks,

            di.created_at AS item_created_at,


            /* ================================================
               ASSET
            ================================================= */

            a.asset_id AS asset_tag,

            a.asset_name,

            a.brand,

            a.model,

            a.serial_number,

            a.barcode,

            a.condition_status,

            a.condition_status AS asset_condition,

            a.status AS asset_status,


            /* ================================================
               CATEGORY / LOCATION
            ================================================= */

            c.name AS category_name,

            c.name AS category,

            l.name AS location_name,

            l.name AS location,


            /* ================================================
               REPAIR INFORMATION
            ================================================= */

            r.repair_no,

            r.problem_description,

            r.initial_condition,

            r.priority,

            r.diagnosis,

            r.repair_action,

            r.parts_replaced,

            r.parts_cost,

            r.labor_cost,

            r.total_cost,

            r.vendor,

            r.date_reported,

            r.date_received,

            r.date_completed,


            /* ================================================
               MOST RECENT CUSTODIAN
            ================================================= */

            aa.id AS assignment_id,

            aa.returned_at AS assignment_returned_at,

            ce.full_name AS custodian_name,

            ce.employee_id AS custodian_employee_id,

            dp.name AS department_name


          FROM asset_disposal_items di


          INNER JOIN assets a
            ON a.id = di.asset_id


          LEFT JOIN asset_categories c
            ON c.id = a.category_id


          LEFT JOIN locations l
            ON l.id = a.location_id


          LEFT JOIN asset_repairs r
            ON r.id = di.repair_id


          /* ================================================
             IMPORTANT:

             Get the MOST RECENT assignment.

             We do NOT use:
             returned_at IS NULL

             because disposal already returns the asset
             from the employee before approval.
          ================================================= */

          LEFT JOIN asset_assignments aa
            ON aa.id = (
              SELECT aa2.id

              FROM asset_assignments aa2

              WHERE aa2.asset_id = a.id

              ORDER BY aa2.id DESC

              LIMIT 1
            )


          LEFT JOIN employees ce
            ON ce.id = aa.employee_id


          LEFT JOIN departments dp
            ON dp.id = ce.department_id


          WHERE di.disposal_id = ?


          ORDER BY di.id ASC
          `,
          [disposalId]
        );


      // ========================================================
      // BACKWARD COMPATIBILITY
      //
      // Older disposal records may have asset_id directly
      // inside asset_disposals instead of asset_disposal_items.
      // ========================================================

      if (items.length === 0) {

        const [legacyItems] =
          await pool.query(
            `
            SELECT

              d.asset_id,

              d.repair_id,

              d.reason AS item_reason,

              NULL AS item_remarks,


              /* ==============================================
                 ASSET
              =============================================== */

              a.asset_id AS asset_tag,

              a.asset_name,

              a.brand,

              a.model,

              a.serial_number,

              a.barcode,

              a.condition_status,

              a.condition_status AS asset_condition,

              a.status AS asset_status,


              /* ==============================================
                 CATEGORY / LOCATION
              =============================================== */

              c.name AS category_name,

              c.name AS category,

              l.name AS location_name,

              l.name AS location,


              /* ==============================================
                 REPAIR
              =============================================== */

              r.repair_no,

              r.problem_description,

              r.initial_condition,

              r.priority,

              r.diagnosis,

              r.repair_action,

              r.parts_replaced,

              r.parts_cost,

              r.labor_cost,

              r.total_cost,

              r.vendor,

              r.date_reported,

              r.date_received,

              r.date_completed,


              /* ==============================================
                 MOST RECENT CUSTODIAN
              =============================================== */

              aa.id AS assignment_id,

              aa.returned_at AS assignment_returned_at,

              ce.full_name AS custodian_name,

              ce.employee_id AS custodian_employee_id,

              dp.name AS department_name


            FROM asset_disposals d


            INNER JOIN assets a
              ON a.id = d.asset_id


            LEFT JOIN asset_categories c
              ON c.id = a.category_id


            LEFT JOIN locations l
              ON l.id = a.location_id


            LEFT JOIN asset_repairs r
              ON r.id = d.repair_id


            LEFT JOIN asset_assignments aa
              ON aa.id = (
                SELECT aa2.id

                FROM asset_assignments aa2

                WHERE aa2.asset_id = a.id

                ORDER BY aa2.id DESC

                LIMIT 1
              )


            LEFT JOIN employees ce
              ON ce.id = aa.employee_id


            LEFT JOIN departments dp
              ON dp.id = ce.department_id


            WHERE d.id = ?


            LIMIT 1
            `,
            [disposalId]
          );


        return res.json({

          success: true,

          disposal,

          items: legacyItems

        });

      }


      // ========================================================
      // RESPONSE
      // ========================================================

      return res.json({

        success: true,

        disposal,

        items

      });


    } catch (error) {

      console.error(
        'DISPOSAL APPROVAL FORM ERROR:',
        error
      );


      return res.status(500).json({

        message:
          'Unable to load disposal approval form.',

        error:
          error.message

      });

    }

  }
);
// ============================================================
// DISPOSAL REQUESTS LIST
// ============================================================

app.get('/api/disposals', requireLogin, async (req, res) => {
  try {

    const search = String(req.query.search || '').trim();
    const status = String(req.query.status || '').trim();

    const params = [];
    const where = [];

    if (search) {
      where.push(`
        (
          d.disposal_no LIKE ?
          OR a.asset_id LIKE ?
          OR a.asset_name LIKE ?
        )
      `);

      const keyword = `%${search}%`;

      params.push(
        keyword,
        keyword,
        keyword
      );
    }

    if (status) {
      where.push(`d.status = ?`);
      params.push(status);
    }

    const whereSql =
      where.length
        ? `WHERE ${where.join(' AND ')}`
        : '';

    const [rows] = await pool.query(`
      SELECT
        d.id,
        d.disposal_no,
        d.reason,
        d.recommendation,
        d.disposal_method,
        d.status,
        d.created_at,
        d.updated_at,

        u.full_name AS created_by_name,

        COUNT(DISTINCT di.id) AS asset_count,

        GROUP_CONCAT(
          DISTINCT a.asset_id
          ORDER BY a.asset_id
          SEPARATOR ', '
        ) AS asset_tags

      FROM asset_disposals d

      LEFT JOIN users u
        ON u.id = d.created_by

      LEFT JOIN asset_disposal_items di
        ON di.disposal_id = d.id

      LEFT JOIN assets a
        ON a.id = di.asset_id

      ${whereSql}

      GROUP BY
        d.id,
        d.disposal_no,
        d.reason,
        d.recommendation,
        d.disposal_method,
        d.status,
        d.created_at,
        d.updated_at,
        u.full_name

      ORDER BY d.id DESC
    `, params);

    res.json({
      success: true,
      disposals: rows
    });

  } catch (error) {

    console.error(
      'GET DISPOSALS ERROR:',
      error
    );

    res.status(500).json({
      message: 'Unable to load disposal requests.',
      error: error.message
    });

  }
});

// ============================================================
// GET ASSETS ELIGIBLE FOR DISPOSAL
// ============================================================

app.get('/api/disposals/eligible-assets', requireMaintenanceStaff, async (req, res) => {

  try {

    const [rows] = await pool.query(`
      SELECT
        a.id,
        a.asset_id,
        a.asset_name,
        a.brand,
        a.model,
        a.serial_number,
        a.barcode,
        a.condition_status,
        a.status,

        c.name AS category_name,
        l.name AS location_name

      FROM assets a

      LEFT JOIN asset_categories c
        ON c.id = a.category_id

      LEFT JOIN locations l
        ON l.id = a.location_id

      WHERE a.status = 'For Disposal'

        AND NOT EXISTS (
          SELECT 1
          FROM asset_disposal_items di
          INNER JOIN asset_disposals d
            ON d.id = di.disposal_id
          WHERE di.asset_id = a.id
            AND d.status NOT IN ('Rejected', 'Disposed')
        )

        AND NOT EXISTS (
          SELECT 1
          FROM asset_disposals d
          WHERE d.asset_id = a.id
            AND d.status NOT IN ('Rejected', 'Disposed')
        )

      ORDER BY a.asset_id ASC
    `);

    res.json({
      success: true,
      assets: rows
    });

  } catch (error) {

    console.error(
      'GET ELIGIBLE DISPOSAL ASSETS ERROR:',
      error
    );

    res.status(500).json({
      message: 'Unable to load assets eligible for disposal.',
      error: error.message
    });

  }

});

// ============================================================
// CREATE MULTI-ASSET DISPOSAL REQUEST
// ============================================================

app.post('/api/disposals', requireMaintenanceStaff, async (req, res) => {

  const assetIds = Array.isArray(req.body.asset_ids)
    ? req.body.asset_ids
    : [];

  const reason = String(req.body.reason || '').trim();
  const recommendation = String(req.body.recommendation || '').trim();
  const disposalMethod = String(req.body.disposal_method || '').trim();
  const remarks = String(req.body.remarks || '').trim();

  const normalizedAssetIds = [
    ...new Set(
      assetIds
        .map(id => Number(id))
        .filter(id => Number.isInteger(id) && id > 0)
    )
  ];

  if (!normalizedAssetIds.length) {
    return res.status(400).json({
      message: 'Please select at least one asset.'
    });
  }

  if (!reason) {
    return res.status(400).json({
      message: 'Reason is required.'
    });
  }

  if (!recommendation) {
    return res.status(400).json({
      message: 'Recommendation is required.'
    });
  }

  if (!disposalMethod) {
    return res.status(400).json({
      message: 'Disposal Method is required.'
    });
  }

  const conn = await pool.getConnection();

  try {

    await conn.beginTransaction();

    const placeholders = normalizedAssetIds.map(() => '?').join(',');

    const [assets] = await conn.query(`
      SELECT
        a.id,
        a.asset_id,
        a.asset_name,
        a.status
      FROM assets a
      WHERE a.id IN (${placeholders})
      FOR UPDATE
    `, normalizedAssetIds);

    if (assets.length !== normalizedAssetIds.length) {
      await conn.rollback();

      return res.status(400).json({
        message: 'One or more selected assets could not be found.'
      });
    }

    const invalidAssets = assets.filter(
      asset => asset.status !== 'For Disposal'
    );

    if (invalidAssets.length) {
      await conn.rollback();

      return res.status(409).json({
        message: 'One or more selected assets are no longer marked For Disposal.',
        assets: invalidAssets.map(asset => asset.asset_id)
      });
    }

    const [existingItemRows] = await conn.query(`
      SELECT
        di.asset_id,
        a.asset_id AS asset_tag,
        d.disposal_no,
        d.status
      FROM asset_disposal_items di
      INNER JOIN asset_disposals d
        ON d.id = di.disposal_id
      INNER JOIN assets a
        ON a.id = di.asset_id
      WHERE di.asset_id IN (${placeholders})
        AND d.status NOT IN ('Rejected', 'Disposed')
      FOR UPDATE
    `, normalizedAssetIds);

    const [existingLegacyRows] = await conn.query(`
      SELECT
        d.asset_id,
        a.asset_id AS asset_tag,
        d.disposal_no,
        d.status
      FROM asset_disposals d
      INNER JOIN assets a
        ON a.id = d.asset_id
      WHERE d.asset_id IN (${placeholders})
        AND d.status NOT IN ('Rejected', 'Disposed')
      FOR UPDATE
    `, normalizedAssetIds);

    const duplicateMap = new Map();

    for (const row of existingItemRows) {
      duplicateMap.set(row.asset_id, row);
    }

    for (const row of existingLegacyRows) {
      duplicateMap.set(row.asset_id, row);
    }

    if (duplicateMap.size) {
      await conn.rollback();

      return res.status(409).json({
        message: 'One or more selected assets already have an active disposal request.',
        duplicates: [...duplicateMap.values()].map(row => ({
          asset_id: row.asset_id,
          asset_tag: row.asset_tag,
          disposal_no: row.disposal_no,
          status: row.status
        }))
      });
    }

    const [forDisposalRepairs] = await conn.query(`
      SELECT id, asset_id
      FROM asset_repairs
      WHERE asset_id IN (${placeholders})
        AND status = 'For Disposal'
      ORDER BY id DESC
      FOR UPDATE
    `, normalizedAssetIds);

    const repairIdByAsset = new Map();

    for (const repair of forDisposalRepairs) {
      if (!repairIdByAsset.has(repair.asset_id)) {
        repairIdByAsset.set(repair.asset_id, repair.id);
      }
    }

    const year = new Date().getFullYear();

    const [lastDisposal] = await conn.query(`
      SELECT disposal_no
      FROM asset_disposals
      WHERE disposal_no LIKE ?
      ORDER BY id DESC
      LIMIT 1
      FOR UPDATE
    `, [`DISP-${year}-%`]);

    let nextNumber = 1;

    if (lastDisposal.length) {
      const match = String(lastDisposal[0].disposal_no)
        .match(/DISP-\d{4}-(\d+)$/);

      if (match) {
        nextNumber = Number(match[1]) + 1;
      }
    }

    const disposalNo =
      `DISP-${year}-${String(nextNumber).padStart(4, '0')}`;

    const firstAssetId = normalizedAssetIds[0];
    const disposalRepairId =
      normalizedAssetIds.length === 1
        ? repairIdByAsset.get(firstAssetId) || null
        : null;

    const [disposalResult] = await conn.query(`
      INSERT INTO asset_disposals (
        disposal_no,
        asset_id,
        repair_id,
        reason,
        recommendation,
        disposal_method,
        status,
        created_by
      )
      VALUES (?, ?, ?, ?, ?, ?, 'Pending Approval', ?)
    `, [
      disposalNo,
      firstAssetId,
      disposalRepairId,
      reason,
      recommendation,
      disposalMethod,
      req.session.user.id
    ]);

    const disposalId = disposalResult.insertId;

    for (const assetId of normalizedAssetIds) {
      await conn.query(`
        INSERT INTO asset_disposal_items (
          disposal_id,
          asset_id,
          repair_id,
          reason,
          remarks
        )
        VALUES (?, ?, ?, ?, ?)
      `, [
        disposalId,
        assetId,
        repairIdByAsset.get(assetId) || null,
        reason,
        remarks || null
      ]);
    }

    await conn.query(`
      UPDATE assets
      SET status = 'For Disposal'
      WHERE id IN (${placeholders})
    `, normalizedAssetIds);

    for (const asset of assets) {
      await conn.query(`
        INSERT INTO asset_history (
          asset_id,
          action,
          from_status,
          to_status,
          remarks,
          performed_by
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `, [
        asset.id,
        'Asset For Disposal',
        asset.status,
        'For Disposal',
        `Asset added to disposal request ${disposalNo}.`,
        req.session.user.id
      ]);
    }

    await conn.query(`
      INSERT INTO audit_logs (
        user_id,
        action,
        entity_type,
        entity_id,
        details
      )
      VALUES (?, ?, ?, ?, JSON_OBJECT(
        'disposal_no', ?,
        'asset_count', ?,
        'message', ?
      ))
    `, [
      req.session.user.id,
      'CREATE_DISPOSAL_REQUEST',
      'asset_disposals',
      disposalId,
      disposalNo,
      normalizedAssetIds.length,
      `Created disposal request ${disposalNo} with ${normalizedAssetIds.length} asset(s).`
    ]);

    await conn.commit();

    res.status(201).json({
      success: true,
      message: 'Disposal request created successfully.',
      disposal_id: disposalId,
      disposal_no: disposalNo,
      asset_count: normalizedAssetIds.length,
      status: 'Pending Approval'
    });

  } catch (error) {

    await conn.rollback();

    console.error(
      'CREATE DISPOSAL REQUEST ERROR:',
      error
    );

    res.status(500).json({
      message: 'Failed to create disposal request.',
      error: error.message
    });

  } finally {

    conn.release();

  }

});

// ============================================================
// DISPOSAL APPROVAL - IT APPROVE
// ============================================================
app.put('/api/disposals/:id/it-approve', requireMaintenanceStaff, async (req, res) => {
  const disposalId = Number(req.params.id);
  const remarks = String(req.body.remarks || '').trim();

  if (!Number.isInteger(disposalId) || disposalId <= 0) {
    return res.status(400).json({ message: 'Invalid disposal ID.' });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(`
      SELECT d.*, u.full_name AS created_by_name
      FROM asset_disposals d
      LEFT JOIN users u ON u.id = d.created_by
      WHERE d.id = ?
      LIMIT 1
      FOR UPDATE
    `, [disposalId]);

    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ message: 'Disposal request not found.' });
    }

    const disposal = rows[0];

    if (disposal.status !== 'Pending Approval') {
      await conn.rollback();
      return res.status(400).json({
        message: `IT approval is only allowed when the request is Pending Approval. Current status: ${disposal.status}`
      });
    }

    const approvalRemarks = remarks || 'Approved by IT.';

    await conn.query(`
      UPDATE asset_disposals
      SET status = 'IT Approved', it_approved_by = ?, it_approved_at = NOW(), it_remarks = ?
      WHERE id = ?
    `, [req.session.user.id, approvalRemarks, disposalId]);

    await conn.query(`
      INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
      VALUES (?, ?, ?, ?, JSON_OBJECT('disposal_no', ?, 'from_status', ?, 'to_status', ?, 'remarks', ?))
    `, [req.session.user.id, 'DISPOSAL_IT_APPROVE', 'asset_disposals', disposalId, disposal.disposal_no, disposal.status, 'IT Approved', approvalRemarks]);

    await conn.commit();
    return res.json({ success: true, message: 'Disposal request approved by IT.', disposal_id: disposalId, status: 'IT Approved' });
  } catch (error) {
    try { await conn.rollback(); } catch (_) {}
    console.error('DISPOSAL IT APPROVAL ERROR:', error);
    return res.status(500).json({ message: 'Failed to approve disposal request.', error: error.message });
  } finally {
    conn.release();
  }
});

// ============================================================
// DISPOSAL APPROVAL - ACCOUNTING APPROVE
// ============================================================
app.put('/api/disposals/:id/accounting-approve', requireLogin, async (req, res) => {
  const disposalId = Number(req.params.id);
  const approverName = String(req.body.approver_name || '').trim();
  const remarks = String(req.body.remarks || '').trim();

  if (!Number.isInteger(disposalId) || disposalId <= 0) {
    return res.status(400).json({ message: 'Invalid disposal ID.' });
  }
  if (!approverName) {
    return res.status(400).json({ message: 'Accounting approver name is required.' });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(`
      SELECT * FROM asset_disposals
      WHERE id = ?
      LIMIT 1
      FOR UPDATE
    `, [disposalId]);

    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ message: 'Disposal request not found.' });
    }

    const disposal = rows[0];

    if (disposal.status !== 'IT Approved') {
      await conn.rollback();
      return res.status(400).json({
        message: `Accounting approval is only allowed after IT approval. Current status: ${disposal.status}`
      });
    }

    const approvalRemarks = `Approved by Accounting: ${approverName}` + (remarks ? `\nRemarks: ${remarks}` : '');

    await conn.query(`
      UPDATE asset_disposals
      SET status = 'Accounting Approved', accounting_approved_by = NULL,
        accounting_approved_name = ?,
        accounting_approved_at = NOW(), accounting_remarks = ?
      WHERE id = ?
    `, [approverName, approvalRemarks, disposalId]);

    await conn.query(`
      INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
      VALUES (?, ?, ?, ?, JSON_OBJECT('disposal_no', ?, 'approver_name', ?, 'from_status', ?, 'to_status', ?, 'remarks', ?))
    `, [req.session.user.id, 'DISPOSAL_ACCOUNTING_APPROVE', 'asset_disposals', disposalId, disposal.disposal_no, approverName, disposal.status, 'Accounting Approved', remarks]);

    await conn.commit();
    return res.json({ success: true, message: 'Disposal request approved by Accounting.', disposal_id: disposalId, status: 'Accounting Approved' });
  } catch (error) {
    try { await conn.rollback(); } catch (_) {}
    console.error('DISPOSAL ACCOUNTING APPROVAL ERROR:', error);
    return res.status(500).json({ message: 'Failed to record Accounting approval.', error: error.message });
  } finally {
    conn.release();
  }
});

// ============================================================
// DISPOSAL - PRESIDENT APPROVE
// ============================================================

app.put('/api/disposals/:id/president-approve', requireLogin, async (req, res) => {
    try {
        const disposalId = Number(req.params.id);

        const approverName = String(
            req.body?.approver_name || ''
        ).trim();

        const remarks = String(
            req.body?.remarks || ''
        ).trim();

        if (!Number.isInteger(disposalId) || disposalId <= 0) {
            return res.status(400).json({
                message: 'Invalid disposal ID.'
            });
        }

        if (!approverName) {
            return res.status(400).json({
                message: 'President approver name is required.'
            });
        }

        const [rows] = await pool.query(`
            SELECT
                id,
                disposal_no,
                status
            FROM asset_disposals
            WHERE id = ?
            LIMIT 1
        `, [disposalId]);

        if (!rows.length) {
            return res.status(404).json({
                message: 'Disposal request not found.'
            });
        }

        const disposal = rows[0];

        if (disposal.status !== 'Accounting Approved') {
            return res.status(400).json({
                message: `President approval is not allowed while the request is "${disposal.status}".`
            });
        }

        await pool.query(`
            UPDATE asset_disposals
            SET
                status = 'President Approved',
                president_approved_by = NULL,
                president_approved_name = ?,
                president_approved_at = NOW(),
                president_remarks = ?
            WHERE id = ?
        `, [
            approverName,
            remarks || null,
            disposalId
        ]);

        res.json({
            success: true,
            message: 'Disposal request approved by President.',
            status: 'President Approved'
        });

    } catch (error) {
        console.error(
            'PRESIDENT APPROVE DISPOSAL ERROR:',
            error
        );

        res.status(500).json({
            message: 'Unable to record President approval.',
            error: error.message
        });
    }
});
// ============================================================
// DISPOSAL - REJECT
// ============================================================
app.put('/api/disposals/:id/reject', requireMaintenanceStaff, async (req, res) => {
  const disposalId = Number(req.params.id);
  const remarks = String(req.body.remarks || '').trim();

  if (!Number.isInteger(disposalId) || disposalId <= 0) {
    return res.status(400).json({ message: 'Invalid disposal ID.' });
  }
  if (!remarks) {
    return res.status(400).json({ message: 'Rejection remarks are required.' });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(`
      SELECT * FROM asset_disposals
      WHERE id = ?
      LIMIT 1
      FOR UPDATE
    `, [disposalId]);

    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ message: 'Disposal request not found.' });
    }

    const disposal = rows[0];
    const rejectableStatuses = ['Pending Approval', 'IT Approved', 'Accounting Approved', 'President Approved'];

    if (!rejectableStatuses.includes(disposal.status)) {
      await conn.rollback();
      return res.status(400).json({
        message: `This disposal request cannot be rejected at status "${disposal.status}".`
      });
    }

    await conn.query(`
      UPDATE asset_disposals
      SET status = 'Rejected', disposal_remarks = ?
      WHERE id = ?
    `, [remarks, disposalId]);

    const [items] = await conn.query(`
      SELECT asset_id, repair_id
      FROM asset_disposal_items
      WHERE disposal_id = ?
    `, [disposalId]);

    for (const item of items) {
      let repairId =
        Number(item.repair_id || 0);

      if (
        Number.isInteger(repairId) &&
        repairId > 0
      ) {
        const [linkedRepairs] = await conn.query(`
          SELECT id
          FROM asset_repairs
          WHERE id = ?
            AND asset_id = ?
            AND status = 'For Disposal'
          LIMIT 1
          FOR UPDATE
        `, [repairId, item.asset_id]);

        repairId = Number(linkedRepairs[0]?.id || 0);
      } else {
        repairId = 0;
      }

      if (!repairId) {
        const [fallbackRepairs] = await conn.query(`
          SELECT id
          FROM asset_repairs
          WHERE asset_id = ?
            AND status = 'For Disposal'
          ORDER BY id DESC
          LIMIT 1
          FOR UPDATE
        `, [item.asset_id]);

        repairId = Number(fallbackRepairs[0]?.id || 0);
      }

      const [assetUpdate] = await conn.query(`
        UPDATE assets
        SET status = 'For Repair'
        WHERE id = ?
          AND status = 'For Disposal'
      `, [item.asset_id]);

      if (repairId) {
        await conn.query(`
          UPDATE asset_repairs
          SET status = 'For Repair'
          WHERE id = ?
            AND asset_id = ?
            AND status = 'For Disposal'
        `, [repairId, item.asset_id]);
      }

      if (assetUpdate.affectedRows > 0) {
        await conn.query(`
          INSERT INTO asset_history (asset_id, action, from_status, to_status, remarks, performed_by)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [item.asset_id, 'Disposal Request Rejected', 'For Disposal', 'For Repair', `Disposal request ${disposal.disposal_no} rejected. Reason: ${remarks}`, req.session.user.id]);
      }
    }

    await conn.query(`
      INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
      VALUES (?, ?, ?, ?, JSON_OBJECT('disposal_no', ?, 'from_status', ?, 'to_status', ?, 'remarks', ?))
    `, [req.session.user.id, 'DISPOSAL_REJECT', 'asset_disposals', disposalId, disposal.disposal_no, disposal.status, 'Rejected', remarks]);

    await conn.commit();
    return res.json({ success: true, message: 'Disposal request rejected.', disposal_id: disposalId, status: 'Rejected' });
  } catch (error) {
    try { await conn.rollback(); } catch (_) {}
    console.error('DISPOSAL REJECT ERROR:', error);
    return res.status(500).json({ message: 'Failed to reject disposal request.', error: error.message });
  } finally {
    conn.release();
  }
});

// ============================================================
// DISPOSAL - FINAL DISPOSE
// ============================================================
// ============================================================
// DISPOSAL - MARK AS DISPOSED
// ============================================================

app.put('/api/disposals/:id/dispose', requireMaintenanceStaff, async (req, res) => {
    const connection = await pool.getConnection();

    try {
        const disposalId = Number(req.params.id);

        const remarks = String(
            req.body?.remarks || ''
        ).trim();

        if (!Number.isInteger(disposalId) || disposalId <= 0) {
            return res.status(400).json({
                message: 'Invalid disposal ID.'
            });
        }

        await connection.beginTransaction();

        const [disposalRows] = await connection.query(`
            SELECT
                id,
                disposal_no,
                status
            FROM asset_disposals
            WHERE id = ?
            FOR UPDATE
        `, [disposalId]);

        if (!disposalRows.length) {
            await connection.rollback();

            return res.status(404).json({
                message: 'Disposal request not found.'
            });
        }

        const disposal = disposalRows[0];

        if (disposal.status !== 'Approved for Disposal') {
            await connection.rollback();

            return res.status(400).json({
                message: `This request cannot be marked as Disposed while it is "${disposal.status}".`
            });
        }

        const [items] = await connection.query(`
            SELECT
                di.asset_id,
                a.asset_id AS asset_tag,
                a.status AS current_status
            FROM asset_disposal_items di
            INNER JOIN assets a
                ON a.id = di.asset_id
            WHERE di.disposal_id = ?
            FOR UPDATE
        `, [disposalId]);

        if (!items.length) {
            await connection.rollback();

            return res.status(400).json({
                message: 'No assets were found in this disposal request.'
            });
        }

      for (const item of items) {

  // ==========================================================
  // UPDATE ASSET
  // ==========================================================

  await connection.query(`
    UPDATE assets
    SET status = 'Disposed'
    WHERE id = ?
  `, [
    item.asset_id
  ]);


  // ==========================================================
  // UPDATE RELATED REPAIR RECORD(S)
  // ==========================================================

  await connection.query(`
    UPDATE asset_repairs
    SET
      status = 'Disposed',
      date_completed =
        COALESCE(date_completed, NOW()),
      remarks =
        CONCAT(
          COALESCE(remarks, ''),
          CASE
            WHEN COALESCE(remarks, '') = ''
            THEN ''
            ELSE ' '
          END,
          ?
        )
    WHERE asset_id = ?
      AND status = 'For Disposal'
  `, [
    `Asset disposed under ${disposal.disposal_no}.`,
    item.asset_id
  ]);


  // ==========================================================
  // ASSET HISTORY
  // ==========================================================

  await connection.query(`
    INSERT INTO asset_history (
      asset_id,
      action,
      from_status,
      to_status,
      remarks,
      performed_by
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `, [
    item.asset_id,
    'Asset Disposed',
    item.current_status,
    'Disposed',
    remarks ||
      `Disposal request ${disposal.disposal_no} completed.`,
    req.session.user.id
  ]);

}

        await connection.query(`
            UPDATE asset_disposals
            SET
                status = 'Disposed',
                disposed_by = ?,
                disposed_at = NOW(),
                disposal_remarks = ?
            WHERE id = ?
        `, [
            req.session.user.id,
            remarks || null,
            disposalId
        ]);

        await connection.commit();

        res.json({
            success: true,
            message: 'Disposal request completed successfully.',
            status: 'Disposed',
            asset_count: items.length
        });

    } catch (error) {

        try {
            await connection.rollback();
        } catch (_) {}

        console.error(
            'MARK DISPOSED ERROR:',
            error
        );

        res.status(500).json({
            message: 'Unable to complete disposal request.',
            error: error.message
        });

    } finally {
        connection.release();
    }
});

// ============================================================
// SINGLE DISPOSAL REQUEST
// ============================================================

app.get('/api/disposals/:id', requireLogin, async (req, res) => {

  try {

    const disposalId =
      Number(req.params.id);

    if (
      !Number.isInteger(disposalId) ||
      disposalId <= 0
    ) {
      return res.status(400).json({
        message: 'Invalid disposal ID.'
      });
    }

    const [disposalRows] =
      await pool.query(`
        SELECT
          d.id,
          d.disposal_no,
          d.reason,
          d.recommendation,
          d.disposal_method,
          d.status,

          d.it_approved_by,
          d.it_approved_at,
          d.it_remarks,

          d.accounting_approved_by,
          d.accounting_approved_at,
          d.accounting_remarks,

          d.president_approved_by,
          d.president_approved_at,
          d.president_remarks,

          d.disposed_by,
          d.disposed_at,
          d.disposal_remarks,

          d.created_at,
          d.updated_at,

          u.full_name AS created_by_name

        FROM asset_disposals d

        LEFT JOIN users u
          ON u.id = d.created_by

        WHERE d.id = ?

        LIMIT 1
      `, [disposalId]);

    if (!disposalRows.length) {
      return res.status(404).json({
        message: 'Disposal request not found.'
      });
    }

    const disposal =
      disposalRows[0];

    const [items] =
      await pool.query(`
        SELECT

          di.id AS disposal_item_id,
          di.disposal_id,
          di.asset_id,
          di.repair_id,

          di.reason AS item_reason,
          di.remarks AS item_remarks,
          di.created_at AS item_created_at,

          a.asset_id AS asset_tag,
          a.asset_name,
          a.brand,
          a.model,
          a.serial_number,
          a.barcode,
          a.condition_status,
          a.status AS asset_status,

          c.name AS category_name,
          l.name AS location_name,

          r.repair_no,
          r.problem_description,
          r.initial_condition,
          r.priority,
          r.diagnosis,
          r.repair_action,
          r.parts_replaced,
          r.parts_cost,
          r.labor_cost,
          r.total_cost,
          r.vendor,
          r.date_reported,
          r.date_received,
          r.date_completed

        FROM asset_disposal_items di

        INNER JOIN assets a
          ON a.id = di.asset_id

        LEFT JOIN asset_categories c
          ON c.id = a.category_id

        LEFT JOIN locations l
          ON l.id = a.location_id

        LEFT JOIN asset_repairs r
          ON r.id = di.repair_id

        WHERE di.disposal_id = ?

        ORDER BY di.id ASC
      `, [disposalId]);

    res.json({
      success: true,
      disposal,
      items
    });

  } catch (error) {

    console.error(
      'GET SINGLE DISPOSAL ERROR:',
      error
    );

    res.status(500).json({
      message: 'Unable to load disposal request.',
      error: error.message
    });

  }

});

// ============================================================
// DISPOSAL - APPROVE FOR DISPOSAL
// ============================================================

app.put('/api/disposals/:id/approve-for-disposal', requireMaintenanceStaff, async (req, res) => {
    try {
        const disposalId = Number(req.params.id);

        const remarks = String(
            req.body?.remarks || ''
        ).trim();

        if (!Number.isInteger(disposalId) || disposalId <= 0) {
            return res.status(400).json({
                message: 'Invalid disposal ID.'
            });
        }

        const [rows] = await pool.query(`
            SELECT
                id,
                disposal_no,
                status
            FROM asset_disposals
            WHERE id = ?
            LIMIT 1
        `, [disposalId]);

        if (!rows.length) {
            return res.status(404).json({
                message: 'Disposal request not found.'
            });
        }

        const disposal = rows[0];

        if (disposal.status !== 'President Approved') {
            return res.status(400).json({
                message: `Final disposal approval is not allowed while the request is "${disposal.status}".`
            });
        }

        await pool.query(`
            UPDATE asset_disposals
            SET
                status = 'Approved for Disposal',
                disposal_remarks = ?
            WHERE id = ?
        `, [
            remarks || null,
            disposalId
        ]);

        res.json({
            success: true,
            message: 'Asset disposal has been approved for disposal.',
            status: 'Approved for Disposal'
        });

    } catch (error) {
        console.error(
            'APPROVE FOR DISPOSAL ERROR:',
            error
        );

        res.status(500).json({
            message: 'Unable to approve asset for disposal.',
            error: error.message
        });
    }
});

// ------------------------------------------------------------
// LIST CLEARANCES
// ------------------------------------------------------------

app.get(
  '/api/clearances',
  requireLogin,
  async (req, res) => {

    try {

      const search =
        String(
          req.query.search || ''
        ).trim();

      const status =
        String(
          req.query.status || ''
        ).trim();


      let sql = `
        SELECT

          ec.id,
          ec.clearance_no,
          ec.employee_id,
          ec.separation_date,
          ec.clearance_date,
          ec.separation_reason,
          ec.status,
          ec.remarks,
          ec.created_at,

          e.employee_id AS employee_code,
          e.full_name AS employee_name,
          e.position_title,

          d.name AS department_name,

          (
            SELECT COUNT(*)
            FROM employee_clearance_items eci
            WHERE eci.clearance_id = ec.id
          ) AS total_items,

          (
            SELECT COUNT(*)
            FROM employee_clearance_items eci
            WHERE eci.clearance_id = ec.id
              AND eci.return_status = 'Returned'
          ) AS returned_items

        FROM employee_clearances ec

        INNER JOIN employees e
          ON e.id = ec.employee_id

        LEFT JOIN departments d
          ON d.id = e.department_id

        WHERE 1 = 1
      `;

      const params = [];


      if (search) {

        sql += `
          AND (
            ec.clearance_no LIKE ?
            OR e.employee_id LIKE ?
            OR e.full_name LIKE ?
            OR d.name LIKE ?
          )
        `;

        const term =
          `%${search}%`;

        params.push(
          term,
          term,
          term,
          term
        );

      }


      if (status) {

        sql += `
          AND ec.status = ?
        `;

        params.push(status);

      }


      sql += `
        ORDER BY
          ec.created_at DESC,
          ec.id DESC
      `;


      const [rows] =
        await pool.query(
          sql,
          params
        );


      res.json(rows);

    } catch (error) {

      console.error(
        'LOAD CLEARANCES ERROR:',
        error
      );

      res.status(500).json({
        message:
          'Unable to load clearance records.',
        error:
          error.message
      });

    }

  }
);


// ------------------------------------------------------------
// GET EMPLOYEES WITH ACTIVE ASSET ASSIGNMENTS
// ------------------------------------------------------------

app.get(
  '/api/clearance-employees',
  requireLogin,
  async (req, res) => {

    try {

      const [rows] =
        await pool.query(`

          SELECT

            e.id,
            e.employee_id,
            e.full_name,
            e.email,
            e.position_title,
            e.status,

            d.name AS department_name,

            COUNT(aa.id) AS assigned_asset_count

          FROM employees e

          LEFT JOIN departments d
            ON d.id = e.department_id

          LEFT JOIN asset_assignments aa
            ON aa.employee_id = e.id
            AND aa.returned_at IS NULL

          GROUP BY
            e.id,
            e.employee_id,
            e.full_name,
            e.email,
            e.position_title,
            e.status,
            d.name

          ORDER BY
            e.full_name ASC

        `);


      res.json(rows);

    } catch (error) {

      console.error(
        'LOAD CLEARANCE EMPLOYEES ERROR:',
        error
      );

      res.status(500).json({
        message:
          'Unable to load employees.',
        error:
          error.message
      });

    }

  }
);


// ------------------------------------------------------------
// CREATE CLEARANCE
// ------------------------------------------------------------

app.post(
  '/api/clearances',
  requireMaintenanceStaff,
  async (req, res) => {

    const connection =
      await pool.getConnection();

    try {

      const employeeId =
        Number(
          req.body.employee_id
        );

      const separationDate =
        req.body.separation_date ||
        null;

      const separationReason =
        String(
          req.body.separation_reason ||
          'Resignation'
        ).trim();

      const remarks =
        String(
          req.body.remarks || ''
        ).trim();


      if (
        !Number.isInteger(employeeId) ||
        employeeId <= 0
      ) {

        return res.status(400).json({
          message:
            'Invalid employee.'
        });

      }


      const allowedReasons = [
        'Resignation',
        'End of Contract',
        'Termination',
        'Retirement',
        'Transfer',
        'Other'
      ];


      if (
        !allowedReasons.includes(
          separationReason
        )
      ) {

        return res.status(400).json({
          message:
            'Invalid separation reason.'
        });

      }


      await connection.beginTransaction();


      // ------------------------------------------------------
      // EMPLOYEE
      // ------------------------------------------------------

      const [employeeRows] =
        await connection.query(`

          SELECT
            e.*,
            d.name AS department_name

          FROM employees e

          LEFT JOIN departments d
            ON d.id = e.department_id

          WHERE e.id = ?

          LIMIT 1

          FOR UPDATE

        `, [
          employeeId
        ]);


      if (!employeeRows.length) {

        throw new Error(
          'Employee not found.'
        );

      }


      const employee =
        employeeRows[0];


      // ------------------------------------------------------
      // PREVENT DUPLICATE OPEN CLEARANCE
      // ------------------------------------------------------

      const [existingRows] =
        await connection.query(`

          SELECT
            id,
            clearance_no,
            status

          FROM employee_clearances

          WHERE employee_id = ?

            AND status IN (
              'Draft',
              'Pending',
              'On Hold'
            )

          LIMIT 1

        `, [
          employeeId
        ]);


      if (existingRows.length) {

        throw new Error(
          `This employee already has an active clearance (${existingRows[0].clearance_no}).`
        );

      }


      // ------------------------------------------------------
      // GET CURRENT ASSIGNED ASSETS
      // ------------------------------------------------------

      const [assetRows] =
        await connection.query(`

          SELECT

            a.id,
            a.asset_id,
            a.asset_name,
            a.serial_number,
            a.condition_status,

            aa.assigned_at,
            aa.remarks AS assignment_remarks

          FROM asset_assignments aa

          INNER JOIN assets a
            ON a.id = aa.asset_id

          WHERE aa.employee_id = ?

            AND aa.returned_at IS NULL

          ORDER BY
            aa.assigned_at ASC,
            a.asset_id ASC

          FOR UPDATE

        `, [
          employeeId
        ]);


      // ------------------------------------------------------
      // CREATE CLEARANCE NUMBER
      // ------------------------------------------------------

      const year =
        new Date()
          .getFullYear();


      const [countRows] =
        await connection.query(`

          SELECT
            COUNT(*) AS total

          FROM employee_clearances

          WHERE YEAR(created_at) = ?

        `, [
          year
        ]);


      const nextNumber =
        Number(
          countRows[0].total || 0
        ) + 1;


      const clearanceNo =
        `CLR-${year}-${String(
          nextNumber
        ).padStart(6, '0')}`;


      // ------------------------------------------------------
      // INSERT CLEARANCE
      // ------------------------------------------------------

      const [result] =
        await connection.query(`

          INSERT INTO employee_clearances
          (
            employee_id,
            clearance_no,
            separation_date,
            clearance_date,
            separation_reason,
            status,
            remarks,
            prepared_by
          )

          VALUES
          (?, ?, ?, NULL, ?, 'Draft', ?, ?)

        `, [

          employeeId,
          clearanceNo,
          separationDate,
          separationReason,
          remarks || null,
          req.session.user.id

        ]);


      const clearanceId =
        result.insertId;


      // ------------------------------------------------------
      // SNAPSHOT ASSETS
      // ------------------------------------------------------

      for (
        const asset of assetRows
      ) {

        await connection.query(`

          INSERT INTO employee_clearance_items
          (
            clearance_id,
            asset_id,
            asset_tag,
            asset_name,
            serial_number,
            condition_at_clearance,
            assignment_date,
            return_status,
            remarks
          )

          VALUES
          (?, ?, ?, ?, ?, ?, ?, 'Pending', ?)

        `, [

          clearanceId,
          asset.id,
          asset.asset_id,
          asset.asset_name,
          asset.serial_number || null,
          asset.condition_status || null,
          asset.assigned_at || null,
          asset.assignment_remarks || null

        ]);

      }


      // ------------------------------------------------------
      // AUDIT LOG
      // ------------------------------------------------------

      await connection.query(`

        INSERT INTO audit_logs
        (
          user_id,
          action,
          entity_type,
          entity_id,
          details
        )

        VALUES
        (?, 'CLEARANCE_CREATE',
         'employee_clearance', ?, ?)

      `, [

        req.session.user.id,

        clearanceId,

        JSON.stringify({

          clearance_no:
            clearanceNo,

          employee_id:
            employee.employee_id,

          employee_name:
            employee.full_name,

          assigned_assets:
            assetRows.length

        })

      ]);


      await connection.commit();


      res.status(201).json({

        ok: true,

        id:
          clearanceId,

        clearance_no:
          clearanceNo,

        asset_count:
          assetRows.length,

        message:
          'Employee clearance created successfully.'

      });

    } catch (error) {

      await connection.rollback();

      console.error(
        'CREATE CLEARANCE ERROR:',
        error
      );

      res.status(400).json({
        message:
          error.message ||
          'Unable to create clearance.'
      });

    } finally {

      connection.release();

    }

  }
);


// ------------------------------------------------------------
// GET ONE CLEARANCE
// ------------------------------------------------------------

app.get(
  '/api/clearances/:id',
  requireLogin,
  async (req, res) => {

    try {

      const id =
        Number(
          req.params.id
        );


      if (
        !Number.isInteger(id) ||
        id <= 0
      ) {

        return res.status(400).json({
          message:
            'Invalid clearance ID.'
        });

      }


      const [clearanceRows] =
        await pool.query(`

          SELECT

            ec.*,

            e.employee_id AS employee_code,
            e.full_name AS employee_name,
            e.email,
            e.position_title,

            d.name AS department_name,

            u.full_name AS prepared_by_name

          FROM employee_clearances ec

          INNER JOIN employees e
            ON e.id = ec.employee_id

          LEFT JOIN departments d
            ON d.id = e.department_id

          LEFT JOIN users u
            ON u.id = ec.prepared_by

          WHERE ec.id = ?

          LIMIT 1

        `, [
          id
        ]);


      if (!clearanceRows.length) {

        return res.status(404).json({
          message:
            'Clearance not found.'
        });

      }


      const [items] =
        await pool.query(`

          SELECT

            eci.*,

            a.status AS current_asset_status,
            a.location_id,

            l.name AS location_name

          FROM employee_clearance_items eci

          LEFT JOIN assets a
            ON a.id = eci.asset_id

          LEFT JOIN locations l
            ON l.id = a.location_id

          WHERE eci.clearance_id = ?

          ORDER BY
            eci.id ASC

        `, [
          id
        ]);


      res.json({

        ok: true,

        clearance:
          clearanceRows[0],

        items

      });

    } catch (error) {

      console.error(
        'GET CLEARANCE ERROR:',
        error
      );

      res.status(500).json({
        message:
          'Unable to load clearance.',
        error:
          error.message
      });

    }

  }
);



// ============================================================
// PROCESS CLEARANCE ITEM RETURN
// ============================================================

app.put(
  '/api/clearance-items/:id',
  requireMaintenanceStaff,
  async (req, res) => {

    const connection =
      await pool.getConnection();

    try {

      const itemId =
        Number(req.params.id);

      const returnStatus =
        String(
          req.body.return_status || ''
        ).trim();

      const remarks =
        String(
          req.body.remarks || ''
        ).trim();


      // --------------------------------------------------------
      // VALIDATE ITEM ID
      // --------------------------------------------------------

      if (
        !Number.isInteger(itemId) ||
        itemId <= 0
      ) {

        return res.status(400).json({
          message:
            'Invalid clearance item.'
        });

      }


      // --------------------------------------------------------
      // VALID RETURN STATUS
      // --------------------------------------------------------

      const allowedStatuses = [
        'Pending',
        'Returned',
        'Lost',
        'Damaged',
        'For Repair',
        'Not Found',
        'Waived'
      ];


      if (
        !allowedStatuses.includes(
          returnStatus
        )
      ) {

        return res.status(400).json({
          message:
            'Invalid return status.'
        });

      }


      await connection.beginTransaction();


      // --------------------------------------------------------
      // GET CLEARANCE ITEM
      // --------------------------------------------------------

      const [itemRows] =
        await connection.query(`

          SELECT

            eci.*,

            ec.clearance_no,
            ec.status AS clearance_status,
            ec.employee_id,

            a.asset_id AS current_asset_tag,
            a.status AS current_asset_status

          FROM employee_clearance_items eci

          INNER JOIN employee_clearances ec
            ON ec.id = eci.clearance_id

          LEFT JOIN assets a
            ON a.id = eci.asset_id

          WHERE eci.id = ?

          LIMIT 1

          FOR UPDATE

        `, [
          itemId
        ]);


      if (!itemRows.length) {

        throw new Error(
          'Clearance item not found.'
        );

      }


      const item =
        itemRows[0];


      // --------------------------------------------------------
      // PREVENT CHANGES TO CANCELLED CLEARANCE
      // --------------------------------------------------------

      if (
        item.clearance_status ===
        'Cancelled'
      ) {

        throw new Error(
          'This clearance has been cancelled and can no longer be processed.'
        );

      }


      // --------------------------------------------------------
      // UPDATE CLEARANCE ITEM
      // --------------------------------------------------------

      let returnDate = null;


      if (
        returnStatus !== 'Pending'
      ) {

        returnDate =
          new Date();

      }


      await connection.query(`

        UPDATE employee_clearance_items

        SET
          return_status = ?,
          return_date = ?,
          remarks = ?

        WHERE id = ?

      `, [

        returnStatus,
        returnDate,
        remarks || null,
        itemId

      ]);


      // --------------------------------------------------------
      // UPDATE ACTUAL ASSET STATUS
      // --------------------------------------------------------

      if (
        returnStatus === 'Returned'
      ) {

        await connection.query(`

          UPDATE assets

          SET
            status = 'Available'

          WHERE id = ?

        `, [
          item.asset_id
        ]);

      }


      else if (
        returnStatus === 'For Repair'
      ) {

        await connection.query(`

          UPDATE assets

          SET
            status = 'For Repair'

          WHERE id = ?

        `, [
          item.asset_id
        ]);

      }


      else if (
        returnStatus === 'Damaged'
      ) {

        await connection.query(`

          UPDATE assets

          SET
            status = 'Broken'

          WHERE id = ?

        `, [
          item.asset_id
        ]);

      }


      else if (
        returnStatus === 'Lost' ||
        returnStatus === 'Not Found'
      ) {

        await connection.query(`

          UPDATE assets

          SET
            status = 'Lost'

          WHERE id = ?

        `, [
          item.asset_id
        ]);

      }


      // --------------------------------------------------------
      // UPDATE ASSET ASSIGNMENT
      // --------------------------------------------------------
      // Only a normal Returned item closes the assignment.
      // For Lost/Damaged/Repair/etc., we keep the assignment
      // history intact for accountability.
      // --------------------------------------------------------

      if (
        returnStatus === 'Returned'
      ) {

        await connection.query(`

          UPDATE asset_assignments

          SET
            returned_at = NOW()

          WHERE asset_id = ?

            AND employee_id = ?

            AND returned_at IS NULL

        `, [

          item.asset_id,
          item.employee_id

        ]);

      }


      // --------------------------------------------------------
      // GET ALL ITEMS FOR THIS CLEARANCE
      // --------------------------------------------------------

      const [allItems] =
        await connection.query(`

          SELECT
            return_status

          FROM employee_clearance_items

          WHERE clearance_id = ?

        `, [
          item.clearance_id
        ]);


      // --------------------------------------------------------
      // CALCULATE OVERALL CLEARANCE STATUS
      // --------------------------------------------------------

      const issueStatuses = [
        'Lost',
        'Damaged',
        'For Repair',
        'Not Found'
      ];


      const hasIssue =
        allItems.some(
          row =>
            issueStatuses.includes(
              row.return_status
            )
        );


      const allCompleted =
        allItems.length > 0 &&
        allItems.every(
          row =>
            row.return_status === 'Returned' ||
            row.return_status === 'Waived'
        );


      const hasProcessing =
        allItems.some(
          row =>
            row.return_status !== 'Pending'
        );


      let newClearanceStatus =
        'Draft';


      if (hasIssue) {

        newClearanceStatus =
          'On Hold';

      }

      else if (allCompleted) {

        newClearanceStatus =
          'Cleared';

      }

      else if (hasProcessing) {

        newClearanceStatus =
          'Pending';

      }


      // --------------------------------------------------------
      // UPDATE CLEARANCE STATUS
      // --------------------------------------------------------

      await connection.query(`

        UPDATE employee_clearances

        SET
          status = ?,
          clearance_date =
            CASE
              WHEN ? = 'Cleared'
              THEN CURDATE()
              ELSE NULL
            END

        WHERE id = ?

      `, [

        newClearanceStatus,
        newClearanceStatus,
        item.clearance_id

      ]);


      // --------------------------------------------------------
      // AUDIT LOG
      // --------------------------------------------------------

      await connection.query(`

        INSERT INTO audit_logs
        (
          user_id,
          action,
          entity_type,
          entity_id,
          details
        )

        VALUES
        (
          ?,
          'CLEARANCE_ITEM_RETURN',
          'employee_clearance_item',
          ?,
          ?
        )

      `, [

        req.session.user.id,

        itemId,

        JSON.stringify({

          clearance_id:
            item.clearance_id,

          clearance_no:
            item.clearance_no,

          asset_id:
            item.asset_id,

          asset_tag:
            item.asset_tag,

          previous_return_status:
            item.return_status,

          new_return_status:
            returnStatus,

          clearance_status:
            newClearanceStatus,

          remarks:
            remarks || null

        })

      ]);


      await connection.commit();


      // --------------------------------------------------------
      // RESPONSE
      // --------------------------------------------------------

      res.json({

        ok: true,

        message:
          'Clearance item updated successfully.',

        item_id:
          itemId,

        return_status:
          returnStatus,

        clearance_status:
          newClearanceStatus

      });


    } catch (error) {

      await connection.rollback();

      console.error(
        'PROCESS CLEARANCE ITEM ERROR:',
        error
      );

      res.status(400).json({

        message:
          error.message ||
          'Unable to process clearance item.'

      });

    } finally {

      connection.release();

    }

  }
);


// ============================================================
// UPLOAD / REMOVE ASSET & RECEIPT IMAGES
// POST /api/assets/:id/images
// ============================================================
app.post(
  '/api/assets/:id/images',
  requireLogin,
  assetImageUpload.fields([
    { name: 'asset_image', maxCount: 1 },
    { name: 'receipt_image', maxCount: 1 }
  ]),
  async (req, res) => {

    const connection = await pool.getConnection();

    try {

      const assetId = Number(req.params.id);

      if (!assetId) {
        return res.status(400).json({
          message: 'Invalid asset ID.'
        });
      }


      // ========================================================
      // DEBUG - SHOW WHAT FRONTEND SENT
      // ========================================================

      console.log(
        'IMAGE UPDATE REQUEST:',
        {
          assetId,
          body: req.body,
          files: Object.keys(req.files || {})
        }
      );


      // ========================================================
      // GET ASSET
      // ========================================================

      const [rows] = await connection.query(
        `
        SELECT
          id,
          asset_id,
          asset_image,
          receipt_image
        FROM assets
        WHERE id = ?
        `,
        [assetId]
      );


      if (!rows.length) {

        return res.status(404).json({
          message: 'Asset not found.'
        });

      }


      const asset = rows[0];


      // ========================================================
      // FILES
      // ========================================================

      const assetImage =
        req.files?.asset_image?.[0] || null;

      const receiptImage =
        req.files?.receipt_image?.[0] || null;


      // ========================================================
      // REMOVE FLAGS
      // ========================================================

      const removeAssetImage =
        String(
          req.body.remove_asset_image || ''
        ).toLowerCase() === 'true';

      const removeReceiptImage =
        String(
          req.body.remove_receipt_image || ''
        ).toLowerCase() === 'true';


      console.log(
        'IMAGE UPDATE FLAGS:',
        {
          assetImage: !!assetImage,
          receiptImage: !!receiptImage,
          removeAssetImage,
          removeReceiptImage,
          existingAssetImage: asset.asset_image,
          existingReceiptImage: asset.receipt_image
        }
      );


      // ========================================================
      // NOTHING TO DO
      // ========================================================

      if (
        !assetImage &&
        !receiptImage &&
        !removeAssetImage &&
        !removeReceiptImage
      ) {

        return res.status(400).json({
          message: 'No image changes were submitted.'
        });

      }


      // ========================================================
      // START TRANSACTION
      // ========================================================

      await connection.beginTransaction();


      const updateFields = [];
      const updateValues = [];


      // ========================================================
      // ASSET IMAGE
      // ========================================================

      if (assetImage) {

        console.log(
          'Replacing asset image:',
          assetImage.filename
        );


        // Delete old file
        if (asset.asset_image) {

          const oldPath = path.join(
            __dirname,
            asset.asset_image.replace(/^\/+/, '')
          );


          console.log(
            'Old asset image path:',
            oldPath
          );


          if (fs.existsSync(oldPath)) {

            try {

              fs.unlinkSync(oldPath);

              console.log(
                'Old asset image deleted.'
              );

            } catch (err) {

              console.warn(
                'Unable to delete previous asset image:',
                err.message
              );

            }

          }

        }


        updateFields.push(
          'asset_image = ?'
        );

        updateValues.push(
          `/uploads/assets/${assetImage.filename}`
        );

      }

      else if (
        removeAssetImage
      ) {

        console.log(
          'REMOVING ASSET IMAGE'
        );


        // Delete physical file
        if (asset.asset_image) {

          const oldPath = path.join(
            __dirname,
            asset.asset_image.replace(/^\/+/, '')
          );


          console.log(
            'Asset image file:',
            oldPath
          );


          if (fs.existsSync(oldPath)) {

            try {

              fs.unlinkSync(oldPath);

              console.log(
                'Asset image physical file deleted.'
              );

            } catch (err) {

              console.warn(
                'Unable to delete asset image file:',
                err.message
              );

            }

          }
          else {

            console.log(
              'Asset image physical file does not exist.'
            );

          }

        }


        // ALWAYS clear database field
        updateFields.push(
          'asset_image = NULL'
        );

      }


      // ========================================================
      // RECEIPT IMAGE
      // ========================================================

      if (receiptImage) {

        console.log(
          'Replacing receipt image:',
          receiptImage.filename
        );


        if (asset.receipt_image) {

          const oldPath = path.join(
            __dirname,
            asset.receipt_image.replace(/^\/+/, '')
          );


          console.log(
            'Old receipt image path:',
            oldPath
          );


          if (fs.existsSync(oldPath)) {

            try {

              fs.unlinkSync(oldPath);

              console.log(
                'Old receipt image deleted.'
              );

            } catch (err) {

              console.warn(
                'Unable to delete previous receipt image:',
                err.message
              );

            }

          }

        }


        updateFields.push(
          'receipt_image = ?'
        );

        updateValues.push(
          `/uploads/assets/${receiptImage.filename}`
        );

      }

      else if (
        removeReceiptImage
      ) {

        console.log(
          'REMOVING RECEIPT IMAGE'
        );


        if (asset.receipt_image) {

          const oldPath = path.join(
            __dirname,
            asset.receipt_image.replace(/^\/+/, '')
          );


          console.log(
            'Receipt image file:',
            oldPath
          );


          if (fs.existsSync(oldPath)) {

            try {

              fs.unlinkSync(oldPath);

              console.log(
                'Receipt image physical file deleted.'
              );

            } catch (err) {

              console.warn(
                'Unable to delete receipt image file:',
                err.message
              );

            }

          }
          else {

            console.log(
              'Receipt image physical file does not exist.'
            );

          }

        }


        // ALWAYS clear database field
        updateFields.push(
          'receipt_image = NULL'
        );

      }


      // ========================================================
      // UPDATE DATABASE
      // ========================================================

      if (updateFields.length) {

        updateValues.push(assetId);


        console.log(
          'DATABASE IMAGE UPDATE:',
          updateFields
        );


        await connection.query(
          `
          UPDATE assets
          SET ${updateFields.join(', ')}
          WHERE id = ?
          `,
          updateValues
        );

      }


      // ========================================================
      // AUDIT LOG
      // ========================================================

      await connection.query(
        `
        INSERT INTO audit_logs
        (
          user_id,
          action,
          entity_type,
          entity_id,
          details
        )
        VALUES (?, 'UPDATE', 'asset', ?, ?)
        `,
        [
          req.session.user.id,
          String(assetId),
          JSON.stringify({
            asset_id: asset.asset_id,
            asset_image_uploaded: !!assetImage,
            receipt_image_uploaded: !!receiptImage,
            asset_image_removed: removeAssetImage,
            receipt_image_removed: removeReceiptImage
          })
        ]
      );


      // ========================================================
      // GET UPDATED VALUES
      // ========================================================

      const [updatedRows] = await connection.query(
        `
        SELECT
          id,
          asset_id,
          asset_image,
          receipt_image
        FROM assets
        WHERE id = ?
        `,
        [assetId]
      );


      await connection.commit();


      // ========================================================
      // RESPONSE
      // ========================================================

      const updatedAsset =
        updatedRows[0] || {};


      console.log(
        'IMAGE UPDATE COMPLETE:',
        {
          asset_image:
            updatedAsset.asset_image,

          receipt_image:
            updatedAsset.receipt_image
        }
      );


      res.json({

        ok: true,

        message:
          'Asset images updated successfully.',

        asset_image:
          updatedAsset.asset_image || null,

        receipt_image:
          updatedAsset.receipt_image || null

      });


    } catch (error) {

      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.warn(
          'Rollback error:',
          rollbackError.message
        );
      }


      console.error(
        'ASSET IMAGE UPDATE ERROR:',
        error
      );


      res.status(500).json({

        message:
          'Unable to update asset images.',

        error:
          error.message

      });


    } finally {

      connection.release();

    }

  }
);
// ============================================================
// REPORTS ROUTES
// Add these BEFORE app.listen(...)
// ============================================================

app.get('/reports', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reports.html'));
});


// ============================================================
// ASSET SUMMARY
// ============================================================

app.get('/api/reports/asset-summary', requireLogin, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        COUNT(*) AS total_assets,

        COALESCE(SUM(status = 'Available'), 0) AS available,
        COALESCE(SUM(status = 'Assigned'), 0) AS assigned,
        COALESCE(SUM(status = 'For Repair'), 0) AS for_repair,
        COALESCE(SUM(status = 'Repairing'), 0) AS repairing,
        COALESCE(SUM(status = 'Broken'), 0) AS broken,
        COALESCE(SUM(status = 'Lost'), 0) AS lost,
        COALESCE(SUM(status = 'For Disposal'), 0) AS for_disposal,
        COALESCE(SUM(status = 'Disposed'), 0) AS disposed,
        COALESCE(SUM(status = 'Retired'), 0) AS retired,

        COALESCE(SUM(purchase_cost), 0) AS total_purchase_cost

      FROM assets
    `);

    res.json(rows[0] || {});

  } catch (error) {

    console.error('REPORT SUMMARY ERROR:', error);

    res.status(500).json({
      message: 'Unable to load asset report summary.',
      error: error.message
    });
  }
});

// ============================================================
// ASSET REPORT
// ============================================================

app.get('/api/reports/assets', requireLogin, async (req, res) => {

  try {

    const status = String(req.query.status || '').trim();

    const categoryId = Number(req.query.category_id || 0);

    const locationId = Number(req.query.location_id || 0);

    const search = String(req.query.search || '').trim();


    const allowedStatuses = [
      'Available',
      'Assigned',
      'For Repair',
      'Repairing',
      'Broken',
      'Lost',
      'For Disposal',
      'Disposed',
      'Retired'
    ];


    if (status && !allowedStatuses.includes(status)) {

      return res.status(400).json({
        message: 'Invalid asset report status.'
      });

    }


    let sql = `

      SELECT

        a.id,

        a.asset_id,

        a.asset_name,

        a.brand,

        a.model,

        a.serial_number,

        a.barcode,

        a.purchase_date,

        a.purchase_cost,

        a.warranty_expiry,

        a.condition_status,

        a.status,

        c.name AS category_name,

        l.name AS location_name,

        e.full_name AS custodian_name,

        e.employee_id AS custodian_employee_id,

        e.position_title AS custodian_position,

        d.name AS department_name

      FROM assets a


      LEFT JOIN asset_categories c

        ON c.id = a.category_id


      LEFT JOIN locations l

        ON l.id = a.location_id


      /*
        Get only ONE active assignment per asset.

        This prevents duplicate report rows if the database
        happens to contain more than one active assignment.
      */

      LEFT JOIN (

        SELECT aa1.*

        FROM asset_assignments aa1

        INNER JOIN (

          SELECT

            asset_id,

            MAX(id) AS max_id

          FROM asset_assignments

          WHERE returned_at IS NULL

          GROUP BY asset_id

        ) latest

          ON latest.max_id = aa1.id

      ) aa

        ON aa.asset_id = a.id


      LEFT JOIN employees e

        ON e.id = aa.employee_id


      LEFT JOIN departments d

        ON d.id = e.department_id


      WHERE 1 = 1

    `;


    const params = [];


    // --------------------------------------------------------
    // STATUS
    // --------------------------------------------------------

    if (status) {

      sql += `

        AND a.status = ?

      `;

      params.push(status);

    }


    // --------------------------------------------------------
    // CATEGORY
    // --------------------------------------------------------

    if (categoryId) {

      sql += `

        AND a.category_id = ?

      `;

      params.push(categoryId);

    }


    // --------------------------------------------------------
    // LOCATION
    // --------------------------------------------------------

    if (locationId) {

      sql += `

        AND a.location_id = ?

      `;

      params.push(locationId);

    }


    // --------------------------------------------------------
    // SEARCH
    // --------------------------------------------------------

    if (search) {

      sql += `

        AND (

          a.asset_id LIKE ?

          OR a.asset_name LIKE ?

          OR a.brand LIKE ?

          OR a.model LIKE ?

          OR a.serial_number LIKE ?

          OR a.barcode LIKE ?

          OR e.full_name LIKE ?

          OR e.employee_id LIKE ?

        )

      `;


      const term = `%${search}%`;


      params.push(

        term,

        term,

        term,

        term,

        term,

        term,

        term,

        term

      );

    }


    sql += `

      ORDER BY a.asset_id ASC

    `;


    const [rows] = await pool.query(sql, params);


    res.json({

      ok: true,

      rows

    });


  } catch (error) {

    console.error('REPORT ASSETS ERROR:', error);


    res.status(500).json({

      message: 'Unable to load asset report.',

      error: error.message

    });

  }

});


// ============================================================
// REPORT FILTER OPTIONS
// ============================================================

app.get('/api/reports/assets/filters', requireLogin, async (req, res) => {

  try {

    const [categories] = await pool.query(`

      SELECT

        id,

        name

      FROM asset_categories

      ORDER BY name ASC

    `);


    const [locations] = await pool.query(`

      SELECT

        id,

        name

      FROM locations

      ORDER BY name ASC

    `);


    res.json({

      ok: true,

      categories,

      locations

    });


  } catch (error) {

    console.error('REPORT FILTERS ERROR:', error);


    res.status(500).json({

      message: 'Unable to load report filters.',

      error: error.message

    });

  }

});


// ============================================================
// ASSET PDF REPORT DATA
// ============================================================

app.get('/api/reports/pdf/assets', requireLogin, async (req, res) => {

  try {

    const allowedStatuses = [

      'Available',

      'Assigned',

      'For Repair',

      'Repairing',

      'Broken',

      'Lost',

      'For Disposal',

      'Disposed',

      'Retired'

    ];


    const requestedStatus = String(

      req.query.status || 'ALL'

    ).trim();


    const status =

      requestedStatus.toUpperCase() === 'ALL'

        ? null

        : requestedStatus;


    if (

      status &&

      !allowedStatuses.includes(status)

    ) {

      return res.status(400).json({

        message: 'Invalid report status.'

      });

    }


    const search = String(

      req.query.search || ''

    ).trim();


    const category = String(

      req.query.category || ''

    ).trim();


    const location = String(

      req.query.location || ''

    ).trim();


    const where = [];

    const params = [];


    // --------------------------------------------------------
    // STATUS
    // --------------------------------------------------------

    if (status) {

      where.push(`

        a.status = ?

      `);

      params.push(status);

    }


    // --------------------------------------------------------
    // SEARCH
    // --------------------------------------------------------

    if (search) {

      where.push(`

        (

          a.asset_id LIKE ?

          OR a.asset_name LIKE ?

          OR a.brand LIKE ?

          OR a.model LIKE ?

          OR a.serial_number LIKE ?

          OR a.barcode LIKE ?

          OR e.full_name LIKE ?

          OR e.employee_id LIKE ?

        )

      `);


      const term = `%${search}%`;


      params.push(

        term,

        term,

        term,

        term,

        term,

        term,

        term,

        term

      );

    }


    // --------------------------------------------------------
    // CATEGORY
    // --------------------------------------------------------

    if (category) {

      where.push(`

        c.name = ?

      `);

      params.push(category);

    }


    // --------------------------------------------------------
    // LOCATION
    // --------------------------------------------------------

    if (location) {

      where.push(`

        l.name = ?

      `);

      params.push(location);

    }


    const whereSql =

      where.length

        ? `WHERE ${where.join(' AND ')}`

        : '';


    // --------------------------------------------------------
    // REPORT RECORDS
    // --------------------------------------------------------

    const [rows] = await pool.query(`

      SELECT

        a.id,

        a.asset_id,

        a.asset_name,

        a.brand,

        a.model,

        a.serial_number,

        a.barcode,

        a.condition_status,

        a.status,

        a.purchase_date,

        a.purchase_cost,

        a.warranty_expiry,

        c.name AS category_name,

        l.name AS location_name,

        e.employee_id AS employee_code,

        e.full_name AS employee_name,

        e.position_title AS employee_position,

        d.name AS employee_department

      FROM assets a


      LEFT JOIN asset_categories c

        ON c.id = a.category_id


      LEFT JOIN locations l

        ON l.id = a.location_id


      /*
        Latest active custodian assignment only.
      */

      LEFT JOIN (

        SELECT aa1.*

        FROM asset_assignments aa1

        INNER JOIN (

          SELECT

            asset_id,

            MAX(id) AS max_id

          FROM asset_assignments

          WHERE returned_at IS NULL

          GROUP BY asset_id

        ) latest

          ON latest.max_id = aa1.id

      ) aa

        ON aa.asset_id = a.id


      LEFT JOIN employees e

        ON e.id = aa.employee_id


      LEFT JOIN departments d

        ON d.id = e.department_id


      ${whereSql}


      ORDER BY

        a.asset_id ASC

    `, params);


    // --------------------------------------------------------
    // FILTERED SUMMARY
    // --------------------------------------------------------

    const summaryWhere = [];


    const summaryParams = [];


    if (status) {

      summaryWhere.push(`

        a.status = ?

      `);

      summaryParams.push(status);

    }


    if (category) {

      summaryWhere.push(`

        c.name = ?

      `);

      summaryParams.push(category);

    }


    if (location) {

      summaryWhere.push(`

        l.name = ?

      `);

      summaryParams.push(location);

    }


    if (search) {

      summaryWhere.push(`

        (

          a.asset_id LIKE ?

          OR a.asset_name LIKE ?

          OR a.brand LIKE ?

          OR a.model LIKE ?

          OR a.serial_number LIKE ?

          OR a.barcode LIKE ?

          OR e.full_name LIKE ?

          OR e.employee_id LIKE ?

        )

      `);


      const term = `%${search}%`;


      summaryParams.push(

        term,

        term,

        term,

        term,

        term,

        term,

        term,

        term

      );

    }


    const summaryWhereSql =

      summaryWhere.length

        ? `WHERE ${summaryWhere.join(' AND ')}`

        : '';


    const [[summaryRow]] = await pool.query(`

      SELECT

        COUNT(*) AS total_assets,

        COALESCE(

          SUM(a.status = 'Available'),

          0

        ) AS available,

        COALESCE(

          SUM(a.status = 'Assigned'),

          0

        ) AS assigned,

        COALESCE(

          SUM(a.status = 'For Repair'),

          0

        ) AS for_repair,

        COALESCE(

          SUM(a.status = 'Repairing'),

          0

        ) AS repairing,

        COALESCE(

          SUM(a.status = 'Broken'),

          0

        ) AS broken,

        COALESCE(

          SUM(a.status = 'Lost'),

          0

        ) AS lost,

        COALESCE(

          SUM(a.status = 'For Disposal'),

          0

        ) AS for_disposal,

        COALESCE(

          SUM(a.status = 'Disposed'),

          0

        ) AS disposed,

        COALESCE(

          SUM(a.status = 'Retired'),

          0

        ) AS retired,

        COALESCE(

          SUM(a.purchase_cost),

          0

        ) AS inventory_value

      FROM assets a


      LEFT JOIN asset_categories c

        ON c.id = a.category_id


      LEFT JOIN locations l

        ON l.id = a.location_id


      LEFT JOIN (

        SELECT aa1.*

        FROM asset_assignments aa1

        INNER JOIN (

          SELECT

            asset_id,

            MAX(id) AS max_id

          FROM asset_assignments

          WHERE returned_at IS NULL

          GROUP BY asset_id

        ) latest

          ON latest.max_id = aa1.id

      ) aa

        ON aa.asset_id = a.id


      LEFT JOIN employees e

        ON e.id = aa.employee_id


      ${summaryWhereSql}

    `, summaryParams);


    // --------------------------------------------------------
    // TOTAL VALUE OF FILTERED RECORDS
    // --------------------------------------------------------

    const totalValue = rows.reduce(

      (sum, row) =>

        sum + Number(row.purchase_cost || 0),

      0

    );


    res.json({

      ok: true,

      rows,

      total_value: totalValue,

      summary: {

        total_assets:

          Number(summaryRow?.total_assets || 0),

        available:

          Number(summaryRow?.available || 0),

        assigned:

          Number(summaryRow?.assigned || 0),

        for_repair:

          Number(summaryRow?.for_repair || 0),

        repairing:

          Number(summaryRow?.repairing || 0),

        broken:

          Number(summaryRow?.broken || 0),

        lost:

          Number(summaryRow?.lost || 0),

        for_disposal:

          Number(summaryRow?.for_disposal || 0),

        disposed:

          Number(summaryRow?.disposed || 0),

        retired:

          Number(summaryRow?.retired || 0),

        inventory_value:

          Number(summaryRow?.inventory_value || 0)

      }

    });


  } catch (error) {

    console.error(

      'ASSET PDF REPORT ERROR:',

      error

    );


    res.status(500).json({

      message: 'Unable to generate asset report.',

      error: error.message

    });

  }

});

// ============================================================
// SHARED REPORT DATA FETCHER
// (mirrors /api/reports/assets query logic)
// ============================================================

async function fetchAssetReportRows(filters) {
  const { status, categoryId, locationId, search } = filters;

  const allowedStatuses = [
    'Available', 'Assigned', 'For Repair', 'Repairing',
    'Broken', 'Lost', 'For Disposal', 'Disposed', 'Retired'
  ];

  if (status && !allowedStatuses.includes(status)) {
    throw new Error('Invalid asset report status.');
  }

  let sql = `
    SELECT
      a.asset_id, a.asset_name, a.brand, a.model, a.serial_number,
      a.purchase_cost, a.status,
      c.name AS category_name,
      l.name AS location_name,
      e.full_name AS custodian_name,
      d.name AS department_name
    FROM assets a
    LEFT JOIN asset_categories c ON c.id = a.category_id
    LEFT JOIN locations l ON l.id = a.location_id
    LEFT JOIN (
      SELECT aa1.* FROM asset_assignments aa1
      INNER JOIN (
        SELECT asset_id, MAX(id) AS max_id
        FROM asset_assignments WHERE returned_at IS NULL
        GROUP BY asset_id
      ) latest ON latest.max_id = aa1.id
    ) aa ON aa.asset_id = a.id
    LEFT JOIN employees e ON e.id = aa.employee_id
    LEFT JOIN departments d ON d.id = e.department_id
    WHERE 1=1
  `;

  const params = [];

  if (status) {
    sql += ' AND a.status = ?';
    params.push(status);
  }
  if (categoryId) {
    sql += ' AND a.category_id = ?';
    params.push(categoryId);
  }
  if (locationId) {
    sql += ' AND a.location_id = ?';
    params.push(locationId);
  }
  if (search) {
    sql += ` AND (
      a.asset_id LIKE ? OR a.asset_name LIKE ? OR a.brand LIKE ? OR
      a.model LIKE ? OR a.serial_number LIKE ? OR a.barcode LIKE ? OR
      e.full_name LIKE ?
    )`;
    const term = `%${search}%`;
    params.push(term, term, term, term, term, term, term);
  }

  sql += ' ORDER BY a.asset_id ASC';

  const [rows] = await pool.query(sql, params);
  return rows;
}

// ============================================================
// BUILD PRINTABLE REPORT HTML (server-side, for Puppeteer)
// ============================================================

function buildReportHtml(rows, title, meta) {
  const esc = v => String(v ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;');

  const money = v => Number(v || 0).toLocaleString('en-PH', {
    style: 'currency', currency: 'PHP', minimumFractionDigits: 2
  });

  const date = new Date().toLocaleString('en-PH', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  const bodyRows = rows.length ? rows.map(r => `
    <tr>
      <td>${esc(r.asset_id)}</td>
      <td>${esc(r.asset_name)}</td>
      <td>${esc(r.category_name || '—')}</td>
      <td>${esc([r.brand, r.model].filter(Boolean).join(' ') || '—')}</td>
      <td>${esc(r.serial_number || '—')}</td>
      <td>${esc(r.custodian_name || 'IT Inventory')}</td>
      <td>${esc(r.department_name || '—')}</td>
      <td>${esc(r.location_name || '—')}</td>
      <td>${esc(r.status || '—')}</td>
      <td class="amount">${money(r.purchase_cost)}</td>
    </tr>
  `).join('') : '<tr><td colspan="10" style="text-align:center;padding:18px;">No records.</td></tr>';

  const totalCost = rows.reduce((s, r) => s + Number(r.purchase_cost || 0), 0);

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
  <style>
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;color:#111;font-size:8.5px;background:#fff}
  .page{width:297mm;min-height:210mm;padding:8mm;margin:0 auto}
  .header{text-align:center;border-bottom:2px solid #111;padding-bottom:3.5mm;margin-bottom:3mm}
  .company{font-size:14px;font-weight:700}.title{font-size:16px;font-weight:700;margin-top:1.5mm;text-transform:uppercase}
  .meta{text-align:center;color:#555;font-size:8px;margin-top:1mm}
  .filters{display:grid;grid-template-columns:repeat(4,1fr);gap:2.5mm;margin-bottom:3mm}
  .filter-box,.summary-box{border:1px solid #999;padding:2.4mm}.label{font-size:7px;color:#666;text-transform:uppercase}.value{font-size:9px;font-weight:700;margin-top:1mm}
  table{width:100%;border-collapse:collapse;margin-top:2.5mm}th,td{border:1px solid #222;padding:1.8mm 1.3mm;vertical-align:top}th{background:#f1f1f1;font-size:7.4px;text-align:left}td{font-size:7.6px}.amount{text-align:right;white-space:nowrap}
  .summary{display:grid;grid-template-columns:1fr 1fr 1fr;gap:2.5mm;margin-top:3mm}.summary-box .value{font-size:11px}
  .footer{margin-top:4mm;padding-top:2mm;border-top:1px solid #999;text-align:center;color:#666;font-size:7px;line-height:1.25}
  @page{size:A4 landscape;margin:0}
  </style></head><body><div class="page">
  <div class="header"><div class="company">Prima Fintech (Philippines) Lending Corporation</div><div class="title">${esc(title)}</div><div class="meta">Generated ${esc(date)}</div></div>
  <div class="filters">
    <div class="filter-box"><div class="label">Report Type</div><div class="value">${esc(title)}</div></div>
    <div class="filter-box"><div class="label">Category</div><div class="value">${esc(meta.categoryName)}</div></div>
    <div class="filter-box"><div class="label">Location</div><div class="value">${esc(meta.locationName)}</div></div>
    <div class="filter-box"><div class="label">Search</div><div class="value">${esc(meta.search || 'None')}</div></div>
  </div>
  <table><thead><tr><th>Asset Tag</th><th>Asset</th><th>Category</th><th>Brand / Model</th><th>Serial Number</th><th>Custodian / Assigned User</th><th>Department</th><th>Location</th><th>Status</th><th>Purchase Cost</th></tr></thead><tbody>${bodyRows}</tbody></table>
  <div class="summary"><div class="summary-box"><div class="label">Records</div><div class="value">${rows.length}</div></div><div class="summary-box"><div class="label">Report</div><div class="value">${esc(title)}</div></div><div class="summary-box"><div class="label">Purchase Value</div><div class="value">${money(totalCost)}</div></div></div>
  <div class="footer">PRIMA IT Asset Management • Prima Fintech (Philippines) Lending Corporation</div>
  </div></body></html>`;
}

const REPORT_TITLES = {
  all: 'All Assets', Available: 'Available Assets', Assigned: 'Assigned Assets',
  'For Repair': 'For Repair Assets', Repairing: 'Repairing Assets', Broken: 'Broken Assets',
  Lost: 'Lost Assets', 'For Disposal': 'For Disposal Assets', Disposed: 'Disposed Assets',
  Retired: 'Retired Assets'
};


// ============================================================
// DATABASE BACKUP / RESTORE
// ============================================================

const DATABASE_BACKUP_FORMAT =
  'prima-it-asset-management-backup';

const DATABASE_BACKUP_VERSION = 1;

const BACKUP_BINARY_TYPES = new Set([
  'binary',
  'varbinary',
  'tinyblob',
  'blob',
  'mediumblob',
  'longblob',
  'bit'
]);


function createBackupError(statusCode, message) {

  const error = new Error(message);
  error.statusCode = statusCode;
  return error;

}


function quoteDatabaseIdentifier(value) {

  const identifier = String(value || '');

  if (!/^[A-Za-z0-9_]+$/.test(identifier)) {
    throw createBackupError(400, 'The backup contains an invalid database identifier.');
  }

  return `\`${identifier}\``;

}


async function verifyBackupAdminPassword(req, rawPassword) {

  const password =
    typeof rawPassword === 'string'
      ? rawPassword
      : '';

  if (!password) {
    throw createBackupError(400, 'Admin password is required.');
  }

  if (Buffer.byteLength(password, 'utf8') > 72) {
    throw createBackupError(400, 'Invalid admin password.');
  }

  const [users] = await pool.query(
    `
    SELECT id, username, password_hash, role, status
    FROM users
    WHERE id = ?
    LIMIT 1
    `,
    [req.session.user.id]
  );

  const admin = users[0];

  if (
    !admin ||
    admin.role !== 'admin' ||
    admin.status !== 'active'
  ) {
    throw createBackupError(403, 'An active administrator account is required.');
  }

  const passwordMatches =
    await bcrypt.compare(password, admin.password_hash);

  if (!passwordMatches) {
    throw createBackupError(401, 'Incorrect admin password.');
  }

  return admin;

}


async function getBackupTableDefinitions(connection) {

  const [columns] = await connection.query(`
    SELECT
      c.TABLE_NAME AS table_name,
      c.COLUMN_NAME AS column_name,
      c.DATA_TYPE AS data_type,
      c.ORDINAL_POSITION AS ordinal_position,
      c.GENERATION_EXPRESSION AS generation_expression
    FROM information_schema.COLUMNS c
    INNER JOIN information_schema.TABLES t
      ON t.TABLE_SCHEMA = c.TABLE_SCHEMA
      AND t.TABLE_NAME = c.TABLE_NAME
      AND t.TABLE_TYPE = 'BASE TABLE'
    WHERE c.TABLE_SCHEMA = DATABASE()
    ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION
  `);

  const definitions = new Map();

  for (const column of columns) {

    if (!definitions.has(column.table_name)) {
      definitions.set(column.table_name, {
        name: column.table_name,
        columns: []
      });
    }

    if (column.generation_expression) continue;

    definitions.get(column.table_name).columns.push({
      name: column.column_name,
      dataType: String(column.data_type || '').toLowerCase()
    });

  }

  if (!definitions.size) {
    throw new Error('No application tables were found.');
  }

  return definitions;

}


function receiveDatabaseBackup(req, res, next) {

  backupUpload.single('backup')(req, res, error => {

    if (!error) {
      next();
      return;
    }

    if (error.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({
        message: 'The backup file exceeds the 50 MB limit.'
      });
      return;
    }

    res.status(400).json({
      message: 'Unable to read the selected backup file.'
    });

  });

}


function validateDatabaseBackup(backup, definitions) {

  if (
    !backup ||
    backup.format !== DATABASE_BACKUP_FORMAT ||
    backup.version !== DATABASE_BACKUP_VERSION ||
    !backup.tables ||
    typeof backup.tables !== 'object' ||
    Array.isArray(backup.tables)
  ) {
    throw createBackupError(400, 'This is not a valid PRIMA database backup.');
  }

  const expectedTables =
    Array.from(definitions.keys()).sort();

  const suppliedTables =
    Object.keys(backup.tables).sort();

  const missingTables =
    expectedTables.filter(name => !suppliedTables.includes(name));

  const unknownTables =
    suppliedTables.filter(name => !expectedTables.includes(name));

  if (missingTables.length || unknownTables.length) {
    throw createBackupError(
      400,
      'The backup does not match the current database structure.'
    );
  }

  let totalRows = 0;

  for (const tableName of expectedTables) {

    const tableBackup = backup.tables[tableName];
    const definition = definitions.get(tableName);
    const expectedColumns = definition.columns.map(column => column.name);

    if (
      !tableBackup ||
      !Array.isArray(tableBackup.columns) ||
      !Array.isArray(tableBackup.rows) ||
      tableBackup.columns.length !== expectedColumns.length ||
      tableBackup.columns.some((name, index) => name !== expectedColumns[index])
    ) {
      throw createBackupError(
        400,
        `The backup structure for ${tableName} is not compatible.`
      );
    }

    totalRows += tableBackup.rows.length;

    if (totalRows > 1000000) {
      throw createBackupError(400, 'The backup contains too many records.');
    }

    for (const row of tableBackup.rows) {

      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw createBackupError(400, `The backup contains an invalid ${tableName} record.`);
      }

      const rowColumns = Object.keys(row);

      if (
        rowColumns.length !== expectedColumns.length ||
        expectedColumns.some(column => !Object.prototype.hasOwnProperty.call(row, column))
      ) {
        throw createBackupError(400, `The backup contains an incomplete ${tableName} record.`);
      }

    }

  }

  return totalRows;

}


app.post('/api/backup/export', requireAdmin, async (req, res) => {

  let connection;

  try {

    const admin =
      await verifyBackupAdminPassword(
        req,
        req.body?.password
      );

    connection = await pool.getConnection();

    const definitions =
      await getBackupTableDefinitions(connection);

    const backup = {
      format: DATABASE_BACKUP_FORMAT,
      version: DATABASE_BACKUP_VERSION,
      application: 'PRIMA IT Asset Management',
      exported_at: new Date().toISOString(),
      tables: {}
    };

    let totalRows = 0;

    for (const definition of definitions.values()) {

      const tableName =
        quoteDatabaseIdentifier(definition.name);

      const selectColumns =
        definition.columns.map(column => {

          const columnName =
            quoteDatabaseIdentifier(column.name);

          if (BACKUP_BINARY_TYPES.has(column.dataType)) {
            return `TO_BASE64(${columnName}) AS ${columnName}`;
          }

          if (column.dataType === 'json') {
            return `CAST(${columnName} AS CHAR) AS ${columnName}`;
          }

          return columnName;

        }).join(', ');

      const [rows] = await connection.query({
        sql: `SELECT ${selectColumns} FROM ${tableName}`,
        dateStrings: true,
        supportBigNumbers: true,
        bigNumberStrings: true
      });

      totalRows += rows.length;

      backup.tables[definition.name] = {
        columns: definition.columns.map(column => column.name),
        rows
      };

    }

    const payload = JSON.stringify(backup, null, 2);

    await connection.query(
      `
      INSERT INTO audit_logs
        (user_id, action, entity_type, entity_id, details)
      VALUES
        (?, 'DATABASE_BACKUP_EXPORTED', 'system', NULL, ?)
      `,
      [
        admin.id,
        JSON.stringify({
          tables: definitions.size,
          records: totalRows,
          exported_by: admin.username
        })
      ]
    );

    const timestamp =
      new Date().toISOString().replace(/[:.]/g, '-');

    res.set({
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition':
        `attachment; filename="prima-database-backup-${timestamp}.json"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });

    return res.status(200).send(payload);

  } catch (error) {

    console.error('DATABASE BACKUP EXPORT ERROR:', error);

    return res.status(error.statusCode || 500).json({
      message:
        error.statusCode
          ? error.message
          : 'Unable to export the database backup.'
    });

  } finally {

    connection?.release();

  }

});


app.post(
  '/api/backup/import',
  requireAdmin,
  receiveDatabaseBackup,
  async (req, res) => {

    let connection;
    let transactionStarted = false;
    let foreignKeyChecksDisabled = false;

    try {

      const admin =
        await verifyBackupAdminPassword(
          req,
          req.body?.password
        );

      if (!req.file?.buffer) {
        throw createBackupError(400, 'Select a database backup file.');
      }

      if (!String(req.file.originalname || '').toLowerCase().endsWith('.json')) {
        throw createBackupError(400, 'Select a PRIMA JSON backup file.');
      }

      let backup;

      try {
        const json = req.file.buffer
          .toString('utf8')
          .replace(/^\uFEFF/, '');
        backup = JSON.parse(json);
      } catch (_) {
        throw createBackupError(400, 'The selected backup file contains invalid JSON.');
      }

      connection = await pool.getConnection();

      const definitions =
        await getBackupTableDefinitions(connection);

      const restoredRows =
        validateDatabaseBackup(backup, definitions);

      await connection.query('SET FOREIGN_KEY_CHECKS = 0');
      foreignKeyChecksDisabled = true;

      await connection.beginTransaction();
      transactionStarted = true;

      for (const definition of definitions.values()) {
        await connection.query(
          `DELETE FROM ${quoteDatabaseIdentifier(definition.name)}`
        );
      }

      for (const definition of definitions.values()) {

        const tableBackup = backup.tables[definition.name];

        if (!tableBackup.rows.length) continue;

        const columnSql = definition.columns
          .map(column => quoteDatabaseIdentifier(column.name))
          .join(', ');

        const chunkSize = 200;

        for (
          let start = 0;
          start < tableBackup.rows.length;
          start += chunkSize
        ) {

          const chunk =
            tableBackup.rows.slice(start, start + chunkSize);

          const values = [];

          const rowSql = chunk.map(row => {

            for (const column of definition.columns) {

              let value = row[column.name];

              if (
                value !== null &&
                BACKUP_BINARY_TYPES.has(column.dataType)
              ) {
                value = Buffer.from(String(value), 'base64');
              }

              values.push(value);

            }

            return `(${definition.columns.map(() => '?').join(', ')})`;

          }).join(', ');

          await connection.query(
            `
            INSERT INTO ${quoteDatabaseIdentifier(definition.name)}
              (${columnSql})
            VALUES ${rowSql}
            `,
            values
          );

        }

      }

      const [restoredAdmins] = await connection.query(
        `
        SELECT id
        FROM users
        WHERE username = ?
          AND role = 'admin'
        LIMIT 1
        `,
        [admin.username]
      );

      await connection.query(
        `
        INSERT INTO audit_logs
          (user_id, action, entity_type, entity_id, details)
        VALUES
          (?, 'DATABASE_BACKUP_RESTORED', 'system', NULL, ?)
        `,
        [
          restoredAdmins[0]?.id || null,
          JSON.stringify({
            tables: definitions.size,
            records: restoredRows,
            backup_exported_at: backup.exported_at || null,
            restored_by: admin.username
          })
        ]
      );

      await connection.commit();
      transactionStarted = false;

      await new Promise(resolve => {
        req.session.destroy(error => {
          if (error) {
            console.error('SESSION RESET AFTER RESTORE ERROR:', error);
          }
          resolve();
        });
      });

      return res.json({
        ok: true,
        restored: restoredRows,
        message:
          `${restoredRows.toLocaleString()} records restored successfully. Please sign in again.`
      });

    } catch (error) {

      if (transactionStarted && connection) {
        try {
          await connection.rollback();
        } catch (_) {
          // Preserve the original restore error.
        }
      }

      console.error('DATABASE BACKUP RESTORE ERROR:', error);

      return res.status(error.statusCode || 500).json({
        message:
          error.statusCode
            ? error.message
            : 'Unable to restore the database backup. Existing data was preserved.'
      });

    } finally {

      if (connection && foreignKeyChecksDisabled) {
        try {
          await connection.query('SET FOREIGN_KEY_CHECKS = 1');
        } catch (error) {
          console.error('RESTORE FOREIGN KEY RESET ERROR:', error);
        }
      }

      connection?.release();

    }

  }
);



app.get('/settings', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'settings.html'));
});


app.get('/audit-logs', requireAdmin, (req, res) => {
  res.sendFile(
    path.join(__dirname, 'public', 'audit-logs.html')
  );
});

app.get('/custodian-forms', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'custodian-forms.html'));
});





// ============================================================
// AUDIT LOGS
// ADMIN ONLY
// ============================================================

app.get('/api/audit-logs', requireAdmin, async (req, res) => {

  try {

    const search = String(req.query.search || '').trim();
    const action = String(req.query.action || '').trim();
    const entityType = String(req.query.entity_type || '').trim();
    const dateFrom = String(req.query.date_from || '').trim();
    const dateTo = String(req.query.date_to || '').trim();

    const page = Math.max(
      1,
      Number(req.query.page || 1)
    );

    const limit = Math.min(
      100,
      Math.max(
        10,
        Number(req.query.limit || 25)
      )
    );

    const offset = (page - 1) * limit;


    // ========================================================
    // BASE QUERY
    // ========================================================

    let where = `WHERE 1=1`;

    const params = [];


    // ========================================================
    // SEARCH
    // ========================================================

    if (search) {

      where += `
        AND (
          u.full_name LIKE ?
          OR u.username LIKE ?
          OR al.action LIKE ?
          OR al.entity_type LIKE ?
          OR CAST(al.entity_id AS CHAR) LIKE ?
          OR al.details LIKE ?
          OR a.asset_id LIKE ?
          OR a.asset_name LIKE ?
          OR e.employee_id LIKE ?
          OR e.full_name LIKE ?
        )
      `;

      const term = `%${search}%`;

      params.push(
        term,
        term,
        term,
        term,
        term,
        term,
        term,
        term,
        term,
        term
      );

    }


    // ========================================================
    // ACTION
    // ========================================================

    if (action) {

      where += `
        AND al.action = ?
      `;

      params.push(action);

    }


    // ========================================================
    // ENTITY TYPE
    // ========================================================

    if (entityType) {

      where += `
        AND al.entity_type = ?
      `;

      params.push(entityType);

    }


    // ========================================================
    // DATE FROM
    // ========================================================

    if (dateFrom) {

      where += `
        AND al.created_at >= ?
      `;

      params.push(`${dateFrom} 00:00:00`);

    }


    // ========================================================
    // DATE TO
    // ========================================================

    if (dateTo) {

      where += `
        AND al.created_at <= ?
      `;

      params.push(`${dateTo} 23:59:59`);

    }


    // ========================================================
    // TOTAL
    // ========================================================

    const [countRows] = await pool.query(
      `
      SELECT COUNT(*) AS total
      FROM audit_logs al

      LEFT JOIN users u
        ON u.id = al.user_id

      LEFT JOIN assets a
        ON al.entity_type = 'asset'
        AND a.id = al.entity_id

      LEFT JOIN employees e
        ON al.entity_type IN ('employee', 'employees')
        AND e.id = al.entity_id

      ${where}
      `,
      params
    );


    const total = Number(
      countRows[0]?.total || 0
    );


    // ========================================================
    // DATA
    // ========================================================

    const [rows] = await pool.query(
      `
      SELECT

        al.id,

        al.user_id,

        al.action,

        al.entity_type,

        al.entity_id,

        al.details,

        al.created_at,

        u.full_name AS user_name,

        u.username AS username,

        a.asset_id,

        a.asset_name,

        e.employee_id AS employee_code,

        e.full_name AS employee_name

      FROM audit_logs al

      LEFT JOIN users u
        ON u.id = al.user_id

      LEFT JOIN assets a
        ON al.entity_type = 'asset'
        AND a.id = al.entity_id

      LEFT JOIN employees e
        ON al.entity_type IN ('employee', 'employees')
        AND e.id = al.entity_id

      ${where}

      ORDER BY
        al.created_at DESC,
        al.id DESC

      LIMIT ? OFFSET ?
      `,
      [
        ...params,
        limit,
        offset
      ]
    );


    // ========================================================
    // RESPONSE
    // ========================================================

    res.json({

      ok: true,

      rows,

      pagination: {

        page,

        limit,

        total,

        totalPages:
          Math.ceil(total / limit)

      }

    });


  } catch (error) {

    console.error(
      'AUDIT LOGS ERROR:',
      error
    );

    res.status(500).json({

      message:
        'Unable to load audit logs.',

      error:
        error.message

    });

  }

});


// ============================================================
// CLEAR AUDIT LOGS
// ADMIN ONLY - REQUIRES CURRENT ADMIN PASSWORD
// ============================================================

app.delete('/api/audit-logs', requireAdmin, async (req, res) => {

  const password =
    typeof req.body?.password === 'string'
      ? req.body.password
      : '';


  if (!password) {

    return res.status(400).json({
      message: 'Admin password is required.'
    });

  }


  if (Buffer.byteLength(password, 'utf8') > 72) {

    return res.status(400).json({
      message: 'Invalid admin password.'
    });

  }


  let connection;


  try {

    const [users] = await pool.query(
      `
      SELECT
        id,
        username,
        password_hash,
        role,
        status
      FROM users
      WHERE id = ?
      LIMIT 1
      `,
      [req.session.user.id]
    );


    const admin = users[0];


    if (
      !admin ||
      admin.role !== 'admin' ||
      admin.status !== 'active'
    ) {

      return res.status(403).json({
        message: 'An active administrator account is required.'
      });

    }


    const passwordMatches =
      await bcrypt.compare(
        password,
        admin.password_hash
      );


    if (!passwordMatches) {

      return res.status(401).json({
        message: 'Incorrect admin password.'
      });

    }


    connection =
      await pool.getConnection();


    await connection.beginTransaction();


    const [countRows] =
      await connection.query(
        'SELECT COUNT(*) AS total FROM audit_logs'
      );


    const clearedRecords =
      Number(countRows[0]?.total || 0);


    await connection.query(
      'DELETE FROM audit_logs'
    );


    await connection.query(
      `
      INSERT INTO audit_logs
        (user_id, action, entity_type, entity_id, details)
      VALUES
        (?, 'AUDIT_LOGS_CLEARED', 'system', NULL, ?)
      `,
      [
        admin.id,
        JSON.stringify({
          cleared_records: clearedRecords,
          cleared_by: admin.username
        })
      ]
    );


    await connection.commit();


    return res.json({
      ok: true,
      cleared: clearedRecords,
      message:
        `${clearedRecords.toLocaleString()} audit log record${clearedRecords === 1 ? '' : 's'} cleared successfully. The clear action was recorded.`
    });

  } catch (error) {

    if (connection) {

      try {
        await connection.rollback();
      } catch (_) {
        // Preserve the original database error.
      }

    }


    console.error(
      'CLEAR AUDIT LOGS ERROR:',
      error
    );


    return res.status(500).json({
      message: 'Unable to clear audit logs.'
    });

  } finally {

    connection?.release();

  }

});


// ------------------------------------------------------------
// START SERVER
// ------------------------------------------------------------

httpsServer.listen(
  PORT,
  '0.0.0.0',
  () => {

    console.log('');

    console.log(
      '============================================================'
    );

    console.log(
      '        PRIMA IT ASSET MANAGEMENT'
    );

    console.log(
      '============================================================'
    );

    console.log('');

    console.log(
      'HTTPS SERVER STARTED'
    );

    console.log('');

    console.log(
      `Local: https://localhost:${PORT}`
    );

    console.log(
      `LAN:   https://10.10.0.5:${PORT}`
    );

    console.log('');

    console.log(
      `Assets: https://10.10.0.5:${PORT}/assets`
    );

    console.log('');

    console.log(
      'QR / Barcode camera scanning is enabled through HTTPS.'
    );

    console.log('');

    console.log(
      '============================================================'
    );

    console.log('');
  }
);
// ================================================================
// PRIMA IT ASSET MANAGEMENT - SELECTABLE PDF REPORT ROUTES
// Add this block to server.js after `pool`, `app`, and `requireLogin`
// are available.
// ================================================================
const puppeteer = require('puppeteer');

const REPORT_EMAIL_FREQUENCIES = new Set([
  'daily',
  'weekly',
  'monthly'
]);

const REPORT_EMAIL_STATUSES =
  new Set(Object.keys(REPORT_TITLES));

let reportEmailSettingsInitialization;
let reportEmailSchedulerRunning = false;


function ensureReportEmailSettingsTable() {

  if (!reportEmailSettingsInitialization) {

    reportEmailSettingsInitialization = (async () => {

      await pool.query(`
        CREATE TABLE IF NOT EXISTS report_email_settings (
          id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
          enabled TINYINT(1) NOT NULL DEFAULT 0,
          recipients TEXT NOT NULL,
          frequency VARCHAR(20) NOT NULL DEFAULT 'weekly',
          send_time TIME NOT NULL DEFAULT '08:00:00',
          day_of_week TINYINT UNSIGNED NOT NULL DEFAULT 1,
          day_of_month TINYINT UNSIGNED NOT NULL DEFAULT 1,
          report_status VARCHAR(50) NOT NULL DEFAULT 'all',
          category_id INT NULL,
          location_id INT NULL,
          email_subject VARCHAR(200) NOT NULL DEFAULT 'Scheduled Asset Report',
          smtp_host VARCHAR(255) NULL,
          smtp_port SMALLINT UNSIGNED NOT NULL DEFAULT 587,
          smtp_secure TINYINT(1) NOT NULL DEFAULT 0,
          smtp_user VARCHAR(255) NULL,
          smtp_password_encrypted TEXT NULL,
          smtp_from VARCHAR(255) NULL,
          next_run_at DATETIME NULL,
          last_sent_at DATETIME NULL,
          last_error TEXT NULL,
          updated_by INT NULL,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB
      `);

      await pool.query(`
        INSERT IGNORE INTO report_email_settings
          (id, enabled, recipients)
        VALUES
          (1, 0, '')
      `);

    })().catch(error => {
      reportEmailSettingsInitialization = null;
      throw error;
    });

  }

  return reportEmailSettingsInitialization;

}


function reportSettingsEncryptionKey() {

  return crypto
    .createHash('sha256')
    .update(
      process.env.SETTINGS_ENCRYPTION_KEY ||
      process.env.SESSION_SECRET ||
      'prima-local-settings-key'
    )
    .digest();

}


function encryptReportSecret(value) {

  if (!value) return null;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    'aes-256-gcm',
    reportSettingsEncryptionKey(),
    iv
  );

  const encrypted = Buffer.concat([
    cipher.update(String(value), 'utf8'),
    cipher.final()
  ]);

  return [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    encrypted.toString('base64')
  ].join(':');

}


function decryptReportSecret(value) {

  if (!value) return '';

  const [version, ivText, tagText, encryptedText] =
    String(value).split(':');

  if (
    version !== 'v1' ||
    !ivText ||
    !tagText ||
    !encryptedText
  ) {
    throw new Error('The saved SMTP password could not be decrypted.');
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    reportSettingsEncryptionKey(),
    Buffer.from(ivText, 'base64')
  );

  decipher.setAuthTag(Buffer.from(tagText, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, 'base64')),
    decipher.final()
  ]).toString('utf8');

}


function parseReportRecipients(value) {

  const recipients = String(value || '')
    .split(/[;,\n]+/)
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);

  return [...new Set(recipients)];

}


function isValidEmailAddress(value) {
  const email = String(value || '');
  return email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}


function envFlag(value) {
  return ['1', 'true', 'yes', 'on'].includes(
    String(value || '').toLowerCase()
  );
}


async function loadReportEmailSettings() {

  await ensureReportEmailSettingsTable();

  const [rows] = await pool.query(`
    SELECT
      s.*,
      c.name AS category_name,
      l.name AS location_name
    FROM report_email_settings s
    LEFT JOIN asset_categories c ON c.id = s.category_id
    LEFT JOIN locations l ON l.id = s.location_id
    WHERE s.id = 1
    LIMIT 1
  `);

  return rows[0];

}


function effectiveReportMailConfiguration(settings = {}) {

  const usingSavedHost = Boolean(settings.smtp_host);

  const host =
    settings.smtp_host ||
    process.env.SMTP_HOST ||
    '';

  const port = Number(
    settings.smtp_port ||
    process.env.SMTP_PORT ||
    587
  );

  const secure = usingSavedHost
    ? Boolean(Number(settings.smtp_secure))
    : envFlag(process.env.SMTP_SECURE);

  const user =
    settings.smtp_user ||
    process.env.SMTP_USER ||
    '';

  const password = settings.smtp_password_encrypted
    ? decryptReportSecret(settings.smtp_password_encrypted)
    : process.env.SMTP_PASSWORD || '';

  const from =
    settings.smtp_from ||
    process.env.SMTP_FROM ||
    'PRIMA IT Asset Management <no-reply@prima.local>';

  if (!host) {
    throw new Error('SMTP host is not configured.');
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SMTP port is invalid.');
  }

  if ((user && !password) || (!user && password)) {
    throw new Error('Both SMTP username and password are required.');
  }

  return { host, port, secure, user, password, from };

}


function createReportMailTransporter(settings) {

  const configuration =
    effectiveReportMailConfiguration(settings);

  const transportOptions = {
    host: configuration.host,
    port: configuration.port,
    secure: configuration.secure
  };

  if (configuration.user) {
    transportOptions.auth = {
      user: configuration.user,
      pass: configuration.password
    };
  }

  return {
    transporter: nodemailer.createTransport(transportOptions),
    from: configuration.from
  };

}


async function createAssetReportPdf(rows, title, meta) {

  let browser;

  try {

    const html = buildReportHtml(rows, title, meta);

    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    return await page.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 }
    });

  } finally {

    if (browser) {
      try {
        await browser.close();
      } catch (_) {
        // Preserve the report generation error.
      }
    }

  }

}


async function sendAssetReportEmail({
  recipients,
  title,
  subject,
  filters,
  meta,
  settings
}) {

  const recipientList =
    Array.isArray(recipients)
      ? recipients
      : parseReportRecipients(recipients);

  if (
    !recipientList.length ||
    recipientList.some(email => !isValidEmailAddress(email))
  ) {
    throw new Error('At least one valid recipient email is required.');
  }

  const reportSettings =
    settings ||
    await loadReportEmailSettings();

  const rows = await fetchAssetReportRows(filters);
  const pdfBuffer = await createAssetReportPdf(rows, title, meta);
  const { transporter, from } =
    createReportMailTransporter(reportSettings);

  const generatedAt =
    new Date().toLocaleString('en-PH');

  const info = await transporter.sendMail({
    from,
    to: recipientList.join(', '),
    subject,
    text:
      `Please find attached the ${title} report, generated on ${generatedAt}.\n\n` +
      `Total records: ${rows.length}`,
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#172033;line-height:1.6">
        <h2 style="margin:0 0 8px">${title}</h2>
        <p style="margin:0 0 14px;color:#526273">Generated ${generatedAt}</p>
        <p>The requested PRIMA IT asset report is attached as a PDF.</p>
        <p><strong>Total records:</strong> ${rows.length}</p>
        <p style="margin-top:24px;color:#718096;font-size:12px">
          PRIMA IT Asset Management<br>
          Prima Fintech (Philippines) Lending Corporation
        </p>
      </div>
    `,
    attachments: [{
      filename: `${title.replace(/[^A-Za-z0-9]+/g, '-')}-${Date.now()}.pdf`,
      content: pdfBuffer
    }]
  });

  return {
    records: rows.length,
    messageId: info.messageId || null
  };

}


function toMysqlLocalDateTime(date) {

  const pad = value => String(value).padStart(2, '0');

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('-') + ' ' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join(':');

}


function calculateNextReportRun(settings, fromDate = new Date()) {

  const frequency = String(settings.frequency || 'weekly');
  const [hours, minutes] = String(settings.send_time || '08:00:00')
    .split(':')
    .map(Number);

  const next = new Date(fromDate);
  next.setSeconds(0, 0);
  next.setHours(hours || 0, minutes || 0, 0, 0);

  if (frequency === 'daily') {
    if (next <= fromDate) next.setDate(next.getDate() + 1);
    return next;
  }

  if (frequency === 'weekly') {
    const targetDay = Number(settings.day_of_week || 0);
    const daysAhead = (targetDay - next.getDay() + 7) % 7;
    next.setDate(next.getDate() + daysAhead);
    if (next <= fromDate) next.setDate(next.getDate() + 7);
    return next;
  }

  const targetDate = Math.min(
    28,
    Math.max(1, Number(settings.day_of_month || 1))
  );

  next.setDate(targetDate);

  if (next <= fromDate) {
    next.setMonth(next.getMonth() + 1, targetDate);
  }

  return next;

}


function scheduledReportParameters(settings) {

  const reportStatus =
    settings.report_status || 'all';

  return {
    title: REPORT_TITLES[reportStatus] || 'Asset Report',
    filters: {
      status: reportStatus === 'all' ? '' : reportStatus,
      categoryId: Number(settings.category_id || 0),
      locationId: Number(settings.location_id || 0),
      search: ''
    },
    meta: {
      categoryName: settings.category_name || 'All Categories',
      locationName: settings.location_name || 'All Locations',
      search: ''
    }
  };

}


function publicReportEmailSettings(settings) {

  const nextRun = settings.next_run_at
    ? new Date(settings.next_run_at)
    : null;

  const lastSent = settings.last_sent_at
    ? new Date(settings.last_sent_at)
    : null;

  const usingSavedHost = Boolean(settings.smtp_host);

  return {
    enabled: Boolean(Number(settings.enabled)),
    recipients: settings.recipients || '',
    frequency: settings.frequency || 'weekly',
    send_time: String(settings.send_time || '08:00:00').slice(0, 5),
    day_of_week: Number(settings.day_of_week || 0),
    day_of_month: Number(settings.day_of_month || 1),
    report_status: settings.report_status || 'all',
    category_id: settings.category_id || '',
    location_id: settings.location_id || '',
    email_subject: settings.email_subject || 'Scheduled Asset Report',
    smtp_host: settings.smtp_host || process.env.SMTP_HOST || '',
    smtp_port: Number(settings.smtp_port || process.env.SMTP_PORT || 587),
    smtp_secure: usingSavedHost
      ? Boolean(Number(settings.smtp_secure))
      : envFlag(process.env.SMTP_SECURE),
    smtp_user: settings.smtp_user || process.env.SMTP_USER || '',
    smtp_from: settings.smtp_from || process.env.SMTP_FROM || '',
    smtp_password_configured: Boolean(
      settings.smtp_password_encrypted ||
      process.env.SMTP_PASSWORD
    ),
    next_run_at:
      nextRun && !Number.isNaN(nextRun.getTime())
        ? nextRun.toISOString()
        : null,
    last_sent_at:
      lastSent && !Number.isNaN(lastSent.getTime())
        ? lastSent.toISOString()
        : null,
    last_error: settings.last_error || ''
  };

}


app.get('/api/settings/report-email', requireAdmin, async (req, res) => {

  try {
    const settings = await loadReportEmailSettings();
    res.json({ ok: true, settings: publicReportEmailSettings(settings) });
  } catch (error) {
    console.error('LOAD REPORT EMAIL SETTINGS ERROR:', error);
    res.status(500).json({ message: 'Unable to load report email settings.' });
  }

});


app.put('/api/settings/report-email', requireAdmin, async (req, res) => {

  try {

    await ensureReportEmailSettingsTable();

    const current = await loadReportEmailSettings();
    const enabled = Boolean(req.body?.enabled);
    const recipients = parseReportRecipients(req.body?.recipients);
    const frequency = String(req.body?.frequency || 'weekly');
    const sendTime = String(req.body?.send_time || '08:00');
    const dayOfWeek = Number(req.body?.day_of_week ?? 1);
    const dayOfMonth = Number(req.body?.day_of_month ?? 1);
    const reportStatus = String(req.body?.report_status || 'all');
    const categoryId = req.body?.category_id ? Number(req.body.category_id) : null;
    const locationId = req.body?.location_id ? Number(req.body.location_id) : null;
    const emailSubject = String(req.body?.email_subject || '').trim();
    const smtpHost = String(req.body?.smtp_host || '').trim() || null;
    const smtpPort = Number(req.body?.smtp_port || 587);
    const smtpSecure = Boolean(req.body?.smtp_secure);
    const smtpUser = String(req.body?.smtp_user || '').trim() || null;
    const smtpFrom = String(req.body?.smtp_from || '').trim() || null;
    const smtpPassword = String(req.body?.smtp_password || '');

    if (recipients.length > 20 || recipients.some(email => !isValidEmailAddress(email))) {
      return res.status(400).json({ message: 'Enter up to 20 valid recipient email addresses.' });
    }

    if (enabled && !recipients.length) {
      return res.status(400).json({ message: 'Add at least one recipient before enabling scheduled reports.' });
    }

    if (!REPORT_EMAIL_FREQUENCIES.has(frequency)) {
      return res.status(400).json({ message: 'Invalid report frequency.' });
    }

    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(sendTime)) {
      return res.status(400).json({ message: 'Invalid report delivery time.' });
    }

    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      return res.status(400).json({ message: 'Invalid weekly delivery day.' });
    }

    if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 28) {
      return res.status(400).json({ message: 'Monthly delivery day must be between 1 and 28.' });
    }

    if (!REPORT_EMAIL_STATUSES.has(reportStatus)) {
      return res.status(400).json({ message: 'Invalid scheduled report type.' });
    }

    if (!emailSubject || emailSubject.length > 200) {
      return res.status(400).json({ message: 'Email subject is required and must not exceed 200 characters.' });
    }

    if (/\r|\n/.test(emailSubject)) {
      return res.status(400).json({ message: 'Email subject must be a single line.' });
    }

    if (
      (smtpHost && smtpHost.length > 255) ||
      (smtpUser && smtpUser.length > 255) ||
      (smtpFrom && smtpFrom.length > 255)
    ) {
      return res.status(400).json({ message: 'One or more SMTP settings are too long.' });
    }

    if (
      [smtpHost, smtpUser, smtpFrom]
        .filter(Boolean)
        .some(value => /\r|\n/.test(value))
    ) {
      return res.status(400).json({ message: 'SMTP settings must use single-line values.' });
    }

    if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
      return res.status(400).json({ message: 'Invalid SMTP port.' });
    }

    if (smtpPassword.length > 500) {
      return res.status(400).json({ message: 'SMTP password is too long.' });
    }

    if (categoryId) {
      const [categories] = await pool.query('SELECT id FROM asset_categories WHERE id = ? LIMIT 1', [categoryId]);
      if (!categories.length) return res.status(400).json({ message: 'Selected asset category was not found.' });
    }

    if (locationId) {
      const [locations] = await pool.query('SELECT id FROM locations WHERE id = ? LIMIT 1', [locationId]);
      if (!locations.length) return res.status(400).json({ message: 'Selected location was not found.' });
    }

    const passwordEncrypted = smtpPassword
      ? encryptReportSecret(smtpPassword)
      : current.smtp_password_encrypted;

    const proposedSettings = {
      smtp_host: smtpHost,
      smtp_port: smtpPort,
      smtp_secure: smtpSecure ? 1 : 0,
      smtp_user: smtpUser,
      smtp_password_encrypted: passwordEncrypted,
      smtp_from: smtpFrom
    };

    if (enabled) {
      effectiveReportMailConfiguration(proposedSettings);
    }

    const scheduleSettings = {
      frequency,
      send_time: `${sendTime}:00`,
      day_of_week: dayOfWeek,
      day_of_month: dayOfMonth
    };

    const nextRun = enabled
      ? toMysqlLocalDateTime(calculateNextReportRun(scheduleSettings))
      : null;

    await pool.query(`
      UPDATE report_email_settings
      SET
        enabled = ?, recipients = ?, frequency = ?, send_time = ?,
        day_of_week = ?, day_of_month = ?, report_status = ?,
        category_id = ?, location_id = ?, email_subject = ?,
        smtp_host = ?, smtp_port = ?, smtp_secure = ?, smtp_user = ?,
        smtp_password_encrypted = ?, smtp_from = ?, next_run_at = ?,
        last_error = NULL, updated_by = ?
      WHERE id = 1
    `, [
      enabled ? 1 : 0,
      recipients.join(', '),
      frequency,
      `${sendTime}:00`,
      dayOfWeek,
      dayOfMonth,
      reportStatus,
      categoryId,
      locationId,
      emailSubject,
      smtpHost,
      smtpPort,
      smtpSecure ? 1 : 0,
      smtpUser,
      passwordEncrypted,
      smtpFrom,
      nextRun,
      req.session.user.id
    ]);

    await pool.query(`
      INSERT INTO audit_logs
        (user_id, action, entity_type, entity_id, details)
      VALUES (?, 'REPORT_EMAIL_SETTINGS_UPDATED', 'system', NULL, ?)
    `, [
      req.session.user.id,
      JSON.stringify({
        enabled,
        recipients,
        frequency,
        send_time: sendTime,
        report_status: reportStatus,
        category_id: categoryId,
        location_id: locationId
      })
    ]);

    const saved = await loadReportEmailSettings();

    res.json({
      ok: true,
      message: enabled
        ? 'Scheduled report email is active.'
        : 'Report email settings saved. Automatic sending is disabled.',
      settings: publicReportEmailSettings(saved)
    });

  } catch (error) {
    console.error('SAVE REPORT EMAIL SETTINGS ERROR:', error);
    res.status(500).json({
      message: error.message || 'Unable to save report email settings.'
    });
  }

});


async function deliverSavedReportEmail(settings, trigger) {

  const parameters = scheduledReportParameters(settings);
  const recipients = parseReportRecipients(settings.recipients);

  if (!recipients.length) {
    throw new Error('No report recipients are configured.');
  }

  const result = await sendAssetReportEmail({
    recipients,
    title: parameters.title,
    subject: settings.email_subject || 'Scheduled Asset Report',
    filters: parameters.filters,
    meta: parameters.meta,
    settings
  });

  await pool.query(`
    UPDATE report_email_settings
    SET last_sent_at = NOW(), last_error = NULL
    WHERE id = 1
  `);

  await pool.query(`
    INSERT INTO audit_logs
      (user_id, action, entity_type, entity_id, details)
    VALUES (?, 'ASSET_REPORT_EMAILED', 'system', NULL, ?)
  `, [
    settings.updated_by || null,
    JSON.stringify({
      trigger,
      recipients,
      report_status: settings.report_status,
      records: result.records,
      message_id: result.messageId
    })
  ]);

  return result;

}


app.post('/api/settings/report-email/send-now', requireAdmin, async (req, res) => {

  try {
    const settings = await loadReportEmailSettings();
    const result = await deliverSavedReportEmail(settings, 'manual');
    res.json({
      ok: true,
      message: `Asset report sent successfully to ${parseReportRecipients(settings.recipients).join(', ')}.`,
      records: result.records
    });
  } catch (error) {
    console.error('SEND SAVED REPORT EMAIL ERROR:', error);
    await ensureReportEmailSettingsTable();
    await pool.query(
      'UPDATE report_email_settings SET last_error = ? WHERE id = 1',
      [String(error.message || 'Unable to send report.').slice(0, 2000)]
    ).catch(() => {});
    res.status(500).json({
      message: 'Unable to send the asset report. Check the recipients and SMTP settings.'
    });
  }

});


async function checkScheduledReportEmail() {

  if (reportEmailSchedulerRunning) return;
  reportEmailSchedulerRunning = true;

  try {

    const settings = await loadReportEmailSettings();

    if (!Number(settings.enabled)) return;

    let nextRun = settings.next_run_at
      ? new Date(settings.next_run_at)
      : null;

    if (!nextRun || Number.isNaN(nextRun.getTime())) {
      nextRun = calculateNextReportRun(settings);
      await pool.query(
        'UPDATE report_email_settings SET next_run_at = ? WHERE id = 1',
        [toMysqlLocalDateTime(nextRun)]
      );
      return;
    }

    if (nextRun > new Date()) return;

    const followingRun =
      calculateNextReportRun(settings, new Date());

    const [claim] = await pool.query(`
      UPDATE report_email_settings
      SET next_run_at = ?
      WHERE id = 1
        AND enabled = 1
        AND next_run_at <= NOW()
    `, [toMysqlLocalDateTime(followingRun)]);

    if (!claim.affectedRows) return;

    try {
      await deliverSavedReportEmail(settings, 'scheduled');
    } catch (error) {
      console.error('SCHEDULED REPORT EMAIL ERROR:', error);
      await pool.query(
        'UPDATE report_email_settings SET last_error = ? WHERE id = 1',
        [String(error.message || 'Unable to send scheduled report.').slice(0, 2000)]
      );
      await pool.query(`
        INSERT INTO audit_logs
          (user_id, action, entity_type, entity_id, details)
        VALUES (?, 'ASSET_REPORT_EMAIL_FAILED', 'system', NULL, ?)
      `, [
        settings.updated_by || null,
        JSON.stringify({
          trigger: 'scheduled',
          error: String(error.message || 'Unknown email error').slice(0, 500)
        })
      ]).catch(() => {});
    }

  } catch (error) {
    console.error('REPORT EMAIL SCHEDULER ERROR:', error);
  } finally {
    reportEmailSchedulerRunning = false;
  }

}


async function initializeReportEmailScheduler() {

  await ensureReportEmailSettingsTable();
  await checkScheduledReportEmail();

  const timer = setInterval(
    checkScheduledReportEmail,
    30000
  );

  timer.unref?.();

}


initializeReportEmailScheduler().catch(error => {
  console.error('REPORT EMAIL SCHEDULER START ERROR:', error);
});

app.get('/reports-pdf', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reports-pdf.html'));
});

// app.get('/api/reports/assets/filters', requireLogin, async (req, res) => {
//   try {
//     const [[categories], [locations]] = await Promise.all([
//       pool.query(`SELECT id, name FROM asset_categories ORDER BY name ASC`),
//       pool.query(`SELECT id, name FROM locations ORDER BY name ASC`)
//     ]);
//     res.json({ categories, locations });
//   } catch (error) {
//     console.error('REPORT FILTERS ERROR:', error);
//     res.status(500).json({ message: 'Unable to load report filters.', error: error.message });
//   }
// });

// app.get('/api/reports/pdf/assets', requireLogin, async (req, res) => {
//   try {
//     const allowedStatuses = ['Available','Assigned','For Repair','Repairing','Broken','Lost'];
//     const requestedStatus = String(req.query.status || 'ALL');
//     const status = requestedStatus === 'ALL' ? null : requestedStatus;

//     if (status && !allowedStatuses.includes(status)) {
//       return res.status(400).json({ message: 'Invalid report status.' });
//     }

//     const search = String(req.query.search || '').trim();
//     const category = String(req.query.category || '').trim();
//     const location = String(req.query.location || '').trim();

//     const where = [];
//     const params = [];

//     if (status) {
//       where.push('a.status = ?');
//       params.push(status);
//     }
//     if (search) {
//       where.push(`(
//         a.asset_id LIKE ? OR a.asset_name LIKE ? OR a.brand LIKE ? OR a.model LIKE ? OR
//         a.serial_number LIKE ? OR a.barcode LIKE ? OR e.full_name LIKE ? OR e.employee_id LIKE ?
//       )`);
//       const s = `%${search}%`;
//       params.push(s,s,s,s,s,s,s,s);
//     }
//     if (category) {
//       where.push('c.name = ?');
//       params.push(category);
//     }
//     if (location) {
//       where.push('l.name = ?');
//       params.push(location);
//     }

//     const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

//     const [rows] = await pool.query(`
//       SELECT
//         a.id,
//         a.asset_id,
//         a.asset_name,
//         a.brand,
//         a.model,
//         a.serial_number,
//         a.barcode,
//         a.condition_status,
//         a.status,
//         a.purchase_date,
//         a.purchase_cost,
//         a.warranty_expiry,
//         c.name AS category_name,
//         l.name AS location_name,
//         e.employee_id AS employee_code,
//         e.full_name AS employee_name,
//         e.position_title AS employee_position,
//         d.name AS employee_department
//       FROM assets a
//       LEFT JOIN asset_categories c ON c.id = a.category_id
//       LEFT JOIN locations l ON l.id = a.location_id
//       LEFT JOIN (
//         SELECT aa1.*
//         FROM asset_assignments aa1
//         INNER JOIN (
//           SELECT asset_id, MAX(id) AS max_id
//           FROM asset_assignments
//           WHERE returned_at IS NULL
//           GROUP BY asset_id
//         ) latest ON latest.max_id = aa1.id
//       ) aa ON aa.asset_id = a.id
//       LEFT JOIN employees e ON e.id = aa.employee_id
//       LEFT JOIN departments d ON d.id = e.department_id
//       ${whereSql}
//       ORDER BY a.asset_id ASC
//     `, params);

//     const [[summaryRow]] = await pool.query(`
//       SELECT
//         COUNT(*) AS total_assets,
//         COALESCE(SUM(status = 'Available'),0) AS available,
//         COALESCE(SUM(status = 'Assigned'),0) AS assigned,
//         COALESCE(SUM(status = 'For Repair'),0) AS for_repair,
//         COALESCE(SUM(status = 'Repairing'),0) AS repairing,
//         COALESCE(SUM(status = 'Broken'),0) AS broken,
//         COALESCE(SUM(status = 'Lost'),0) AS lost,
//         COALESCE(SUM(purchase_cost),0) AS inventory_value
//       FROM assets
//     `);

//     const totalValue = rows.reduce((sum, row) => sum + Number(row.purchase_cost || 0), 0);

//     res.json({
//       ok: true,
//       rows,
//       total_value: totalValue,
//       summary: {
//         total_assets: Number(summaryRow.total_assets || 0),
//         available: Number(summaryRow.available || 0),
//         assigned: Number(summaryRow.assigned || 0),
//         for_repair: Number(summaryRow.for_repair || 0),
//         repairing: Number(summaryRow.repairing || 0),
//         broken: Number(summaryRow.broken || 0),
//         lost: Number(summaryRow.lost || 0),
//         inventory_value: Number(summaryRow.inventory_value || 0)
//       }
//     });
//   } catch (error) {
//     console.error('ASSET PDF REPORT ERROR:', error);
//     res.status(500).json({ message: 'Unable to generate asset report.', error: error.message });
//   }
// });
// ============================================================
