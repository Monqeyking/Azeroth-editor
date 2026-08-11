const fs = require('fs');
const path = require('path');
const { parseDbc, serializeDbc, getString } = require('./dbc-sql');

let BetterSqlite3 = null;
try { BetterSqlite3 = require('better-sqlite3'); }
catch (error) { console.warn('better-sqlite3 not available'); }

function registerDbcSqlIpc(ipcMain, dependencies = {}) {
  const Sqlite = dependencies.BetterSqlite3 || BetterSqlite3;
  const parse = dependencies.parseDbc || parseDbc;
  const serialize = dependencies.serializeDbc || serializeDbc;
  const readString = dependencies.getString || getString;

  ipcMain.handle('dbcSql:listFiles', async (_, { folder }) => {
    try {
      if (!fs.existsSync(folder)) return { success: true, files: [] };
      const files = fs.readdirSync(folder)
        .filter(file => file.toLowerCase().endsWith('.dbc'))
        .sort()
        .map(name => {
          try {
            const buffer = fs.readFileSync(path.join(folder, name));
            if (buffer.length >= 20 && buffer.toString('ascii', 0, 4) === 'WDBC') {
              return { name, records: buffer.readUInt32LE(4), fields: buffer.readUInt32LE(8) };
            }
          } catch {}
          return { name, records: null, fields: null };
        });
      return { success: true, files };
    } catch (error) {
      return { success: false, error: error.message, files: [] };
    }
  });

  ipcMain.handle('dbcSql:query', async (_, { filePath, sql, writeBack, stringCols = [] }) => {
    if (!Sqlite) {
      return {
        success: false,
        error: 'better-sqlite3 not installed.\nRun: npm install better-sqlite3 --legacy-peer-deps && npm run rebuild',
      };
    }
    let db = null;
    try {
      const buffer = fs.readFileSync(filePath);
      const { records, fieldCount, recordCount, stringBlock } = parse(buffer);
      const stringColumns = new Set(stringCols);
      db = new Sqlite(':memory:');
      const definitions = Array.from({ length: fieldCount }, (_, index) =>
        `field_${index} ${stringColumns.has(index) ? 'TEXT' : 'INTEGER'}`
      ).join(', ');
      db.exec(`CREATE TABLE dbc (${definitions})`);

      if (records.length) {
        const insert = db.prepare(`INSERT INTO dbc VALUES (${Array(fieldCount).fill('?').join(',')})`);
        db.transaction(rows => {
          for (const record of rows) {
            const row = stringColumns.size
              ? record.map((value, index) => stringColumns.has(index) ? readString(stringBlock, value) : value)
              : record;
            insert.run(...row);
          }
        })(records);
      }

      if (sql.trim().toUpperCase().startsWith('SELECT')) {
        const statement = db.prepare(sql);
        const rows = statement.all();
        const columns = rows.length ? Object.keys(rows[0]) : statement.columns().map(column => column.name);
        return { success: true, rows, columns, changes: 0 };
      }

      const info = db.prepare(sql).run();
      const result = { success: true, rows: [], columns: [], changes: info.changes };
      if (writeBack && info.changes > 0) {
        fs.writeFileSync(filePath, serialize(buffer, db, fieldCount, recordCount));
        result.written = true;
      }
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    } finally {
      try { db?.close(); } catch {}
    }
  });
}

module.exports = { registerDbcSqlIpc };
