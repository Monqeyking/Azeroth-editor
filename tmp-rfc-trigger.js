const fs = require('fs');
const mysql = require('mysql2/promise');

async function main() {
  const configPath = process.argv[2];
  if (!configPath) throw new Error('Usage: node tmp-rfc-trigger.js <path-to-worldserver.conf>');
  const config = fs.readFileSync(configPath, 'utf8');
  const match = config.match(/^WorldDatabaseInfo\s*=\s*"([^"]+)"/m);
  const [host, port, user, password, database] = match[1].split(';');
  const connection = await mysql.createConnection({ host, port: Number(port), user, password, database });
  const [rows] = await connection.query('SELECT * FROM areatrigger_teleport WHERE target_map = 389');
  console.log(JSON.stringify(rows, null, 2));
  await connection.end();
}
main().catch(error => { console.error(error.message); process.exit(1); });
