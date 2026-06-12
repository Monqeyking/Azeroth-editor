// DBC binary parser + SQLite bridge for the DBC SQL editor

function parseDbc(buffer) {
  if (buffer.length < 20) throw new Error('File too small to be a DBC');
  const magic = buffer.toString('ascii', 0, 4);
  if (magic !== 'WDBC') throw new Error('Not a valid DBC file (missing WDBC header)');

  const recordCount   = buffer.readUInt32LE(4);
  const fieldCount    = buffer.readUInt32LE(8);
  const recordSize    = buffer.readUInt32LE(12);
  const strBlockSize  = buffer.readUInt32LE(16);

  const HEADER = 20;
  const strBlockOffset = HEADER + recordCount * recordSize;
  const stringBlock = buffer.slice(strBlockOffset, strBlockOffset + strBlockSize);

  const realFields = Math.floor(recordSize / 4);
  const records = [];
  for (let i = 0; i < recordCount; i++) {
    const fields = [];
    for (let j = 0; j < realFields; j++) {
      fields.push(buffer.readInt32LE(HEADER + i * recordSize + j * 4));
    }
    records.push(fields);
  }

  return { recordCount, fieldCount: realFields, recordSize, strBlockSize, records, stringBlock };
}

function getString(stringBlock, offset) {
  if (!offset || offset >= stringBlock.length) return '';
  let end = offset;
  while (end < stringBlock.length && stringBlock[end] !== 0) end++;
  return stringBlock.toString('utf8', offset, end);
}

// Write modified SQLite records back to a DBC buffer (preserves string block)
function serializeDbc(originalBuffer, db, fieldCount, originalRecordCount) {
  const HEADER = 20;
  const rows = db.prepare('SELECT * FROM dbc ORDER BY rowid').all();
  const recordSize = fieldCount * 4;
  const strBlockSize = originalBuffer.readUInt32LE(16);
  const strBlockOffset = HEADER + originalRecordCount * recordSize;

  const out = Buffer.alloc(HEADER + rows.length * recordSize + strBlockSize);

  // Header
  originalBuffer.copy(out, 0, 0, HEADER);
  out.writeUInt32LE(rows.length, 4); // update record count

  // Records
  rows.forEach((row, i) => {
    for (let j = 0; j < fieldCount; j++) {
      out.writeInt32LE(row[`field_${j}`] ?? 0, HEADER + i * recordSize + j * 4);
    }
  });

  // String block (unchanged)
  originalBuffer.copy(out, HEADER + rows.length * recordSize, strBlockOffset, strBlockOffset + strBlockSize);

  return out;
}

module.exports = { parseDbc, getString, serializeDbc };
