// The caller owns the transaction. The unique department name prevents races.
async function getOthersDepartmentId(connection) {
  const [existing] = await connection.query('SELECT id FROM departments WHERE name = ? LIMIT 1', ['Others']);
  if (existing.length) return Number(existing[0].id);
  const [result] = await connection.query(
    "INSERT INTO departments (name) VALUES ('Others') ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)"
  );
  return Number(result.insertId);
}
module.exports = { getOthersDepartmentId };
