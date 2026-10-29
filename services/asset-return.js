// Caller owns the transaction and locks the asset and assignment before returning it.
async function returnAssignment(connection, { asset, assignment, userId, remarks, returnedAt = null, preserveExceptionalStatus = false }) {
  if (!preserveExceptionalStatus && asset.status !== 'Assigned') {
    throw Object.assign(new Error('This asset is no longer assigned.'), { status: 409 });
  }
  const nextStatus = asset.status === 'Assigned' ? 'Available' : asset.status;
  const [closed] = await connection.query(`
    UPDATE asset_assignments SET returned_at = COALESCE(?, NOW()), return_remarks = ?
    WHERE id = ? AND returned_at IS NULL
  `, [returnedAt, remarks, assignment.id]);
  if (closed.affectedRows !== 1) {
    throw Object.assign(new Error('This asset assignment has already been returned.'), { status: 409 });
  }
  if (nextStatus !== asset.status) {
    const [updated] = await connection.query("UPDATE assets SET status = 'Available' WHERE id = ? AND status = 'Assigned'", [asset.id]);
    if (updated.affectedRows !== 1) throw Object.assign(new Error('This asset is no longer assigned.'), { status: 409 });
  }
  await connection.query(`
    INSERT INTO asset_history (asset_id, action, from_status, to_status, from_employee_id, to_employee_id, remarks, performed_by)
    VALUES (?, 'Asset Returned', ?, ?, ?, NULL, ?, ?)
  `, [asset.id, asset.status, nextStatus, assignment.employee_id, remarks, userId]);
  await connection.query(`
    INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
    VALUES (?, 'RETURN', 'asset', ?, ?)
  `, [userId, String(asset.id), JSON.stringify({ asset_id: asset.asset_id, asset_name: asset.asset_name,
    assignment_id: assignment.id, employee_id: assignment.employee_id, from_status: asset.status,
    to_status: nextStatus, location_id: asset.location_id, returned_at: returnedAt || 'NOW()', remarks })]);
  return nextStatus;
}

module.exports = { returnAssignment };
