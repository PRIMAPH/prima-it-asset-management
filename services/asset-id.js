// Call allocation inside the same transaction as the asset INSERT. The upsert
// takes an InnoDB exclusive row lock, held through commit/rollback.
const formatId = (value, year = 'YEAR(CURRENT_DATE())') => `CONCAT('PRIMA-', ${year}, '-', LPAD(CAST(${value} AS CHAR), GREATEST(6, CHAR_LENGTH(CAST(${value} AS CHAR))), '0'))`;

async function allocateAssetId(connection) {
  const [[{ asset_year }]] = await connection.query('SELECT YEAR(CURRENT_DATE()) AS asset_year');
  await connection.query(`
    INSERT INTO asset_id_counters (asset_year, last_number)
    VALUES (?, 1)
    ON DUPLICATE KEY UPDATE last_number = last_number + 1
  `, [asset_year]);
  const [[row]] = await connection.query(`
    SELECT ${formatId('last_number', 'asset_year')} AS asset_id
    FROM asset_id_counters WHERE asset_year = ?
  `, [asset_year]);
  return row.asset_id;
}

async function previewAssetId(connection) {
  const [[row]] = await connection.query(`
    SELECT ${formatId('COALESCE((SELECT last_number FROM asset_id_counters WHERE asset_year = YEAR(CURRENT_DATE())), 0) + 1')} AS asset_id
  `);
  return row.asset_id;
}

module.exports = { allocateAssetId, previewAssetId };
