// Caller owns the transaction; shared by creation and assignment.
async function assignAssets(connection, { asset_ids, employee_id, assigned_at, remarks, userId }) {
  if (!Number.isSafeInteger(Number(employee_id)) || Number(employee_id) <= 0) throw Object.assign(new Error('Select a valid employee.'), { status: 400 });
      const [employeeRows] = await connection.query(
        `
        SELECT
          id,
          employee_id,
          full_name,
          department_id,
          status
        FROM employees
        WHERE id = ? AND deleted_at IS NULL
        LIMIT 1
        FOR UPDATE
        `,
        [employee_id]
      );

      if (employeeRows.length === 0) {
        throw Object.assign(new Error('Employee not found.'), { status: 404 });
      }

      const employee = employeeRows[0];

      if (employee.status !== 'active') {
        throw Object.assign(new Error('The selected employee is not active.'), { status: 400 });
      }

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

        if (!Number.isSafeInteger(assetId) || assetId <= 0) {
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
            userId,
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
            userId
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
            userId,
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


  return { assigned: assignedCount, employee: { id: employee.id, employee_id: employee.employee_id, full_name: employee.full_name } };
}
module.exports = { assignAssets };
