const { returnAssignment } = require('./asset-return');
const RETURN_REASON = 'Automatically returned to inventory due to employee deletion.';
const fail = (status, message) => Object.assign(new Error(message), { status });

async function archiveEmployee(pool, employeeId, userId) {
  const connection = await pool.getConnection();
  let transactionStarted = false;
  try {
    await connection.beginTransaction();
    transactionStarted = true;
    const [employees] = await connection.query('SELECT * FROM employees WHERE id = ? FOR UPDATE', [employeeId]);
    if (!employees.length) throw fail(404, 'Employee not found.');
    const employee = employees[0];
    if (employee.deleted_at) throw fail(409, 'This employee has already been deleted.');
    const [users] = await connection.query('SELECT id FROM users WHERE employee_id = ? FOR UPDATE', [employee.employee_id]);
    if (users.some(user => user.id === userId)) throw fail(409, 'Another administrator must delete the employee linked to your own account.');

    // Assignment creation locks the employee first, preventing new assignments during archival.
    const [active] = await connection.query(`
      SELECT id, asset_id FROM asset_assignments WHERE employee_id = ? AND returned_at IS NULL ORDER BY asset_id, id
    `, [employeeId]);
    const returned = [];
    const preservedStatuses = [];
    for (const assetId of [...new Set(active.map(row => row.asset_id))]) {
      // Match the normal return workflow's asset-before-assignment locking order.
      const [assets] = await connection.query('SELECT * FROM assets WHERE id = ? FOR UPDATE', [assetId]);
      if (!assets.length) throw fail(409, 'An assigned asset is missing. Resolve the assignment before deleting this employee.');
      const asset = assets[0];
      const [assignments] = await connection.query(`
        SELECT id, employee_id FROM asset_assignments WHERE asset_id = ? AND returned_at IS NULL FOR UPDATE
      `, [assetId]);
      if (!assignments.length) continue; // A normal return committed before we locked the asset.
      if (assignments.length !== 1 || assignments[0].employee_id !== employeeId) {
        throw fail(409, `Asset ${asset.asset_id} has conflicting assignments. Resolve them before deleting the employee.`);
      }
      const status = await returnAssignment(connection, { asset, assignment: assignments[0], userId,
        remarks: RETURN_REASON, preserveExceptionalStatus: true });
      returned.push({ id: asset.id, asset_id: asset.asset_id, location_id: asset.location_id, status });
      if (status !== 'Available') preservedStatuses.push({ asset_id: asset.asset_id, status });
    }
    await connection.query("UPDATE users SET status = 'inactive' WHERE employee_id = ?", [employee.employee_id]);
    const [archived] = await connection.query("UPDATE employees SET deleted_at = NOW(), status = 'inactive' WHERE id = ? AND deleted_at IS NULL", [employeeId]);
    if (archived.affectedRows !== 1) throw fail(409, 'This employee has already been deleted.');
    await connection.query(`
      INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
      VALUES (?, 'DELETE', 'employee', ?, ?)
    `, [userId, String(employeeId), JSON.stringify({ archived: true, employee_id: employee.employee_id,
      full_name: employee.full_name, returned_assets: returned, disabled_user_ids: users.map(user => user.id), reason: RETURN_REASON })]);
    await connection.commit();
    transactionStarted = false;
    return { ok: true, full_name: employee.full_name, returned_count: returned.length,
      preserved_statuses: preservedStatuses,
      message: returned.length
        ? `Employee ${employee.full_name} has been deleted. ${returned.length} assigned asset(s) have been automatically returned to Inventory at their existing locations.`
        : `Employee ${employee.full_name} has been deleted successfully. No assigned assets needed to be returned.` };
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
module.exports = { archiveEmployee, RETURN_REASON };
