const fs = require('fs');

const CHAR_SECTIONS_PATHS = [
  'DBFilesClient\\CharSections.dbc',
  'DBfilesclient\\CharSections.dbc',
];

function parseCharSectionsBuffer(buf) {
  if (!buf || buf.toString('ascii', 0, 4) !== 'WDBC') return null;
  const recordCount = buf.readUInt32LE(4);
  const recordSize = buf.readUInt32LE(12);
  const dataStart = 20;
  const stringStart = dataStart + recordCount * recordSize;
  if (recordSize < 40 || stringStart > buf.length) return null;
  const readStr = offset => {
    if (!offset) return '';
    const start = stringStart + offset;
    if (start < stringStart || start >= buf.length) return '';
    let end = start;
    while (end < buf.length && buf[end] !== 0) end++;
    return buf.toString('utf8', start, end);
  };
  const records = [];
  for (let i = 0; i < recordCount; i++) {
    const offset = dataStart + i * recordSize;
    records.push({
      id: buf.readUInt32LE(offset),
      race: buf.readUInt32LE(offset + 4),
      sex: buf.readUInt32LE(offset + 8),
      baseSection: buf.readUInt32LE(offset + 12),
      tex1: readStr(buf.readUInt32LE(offset + 16)),
      tex2: readStr(buf.readUInt32LE(offset + 20)),
      tex3: readStr(buf.readUInt32LE(offset + 24)),
      flags: buf.readUInt32LE(offset + 28),
      variationIndex: buf.readUInt32LE(offset + 32),
      colorIndex: buf.readUInt32LE(offset + 36),
    });
  }
  return records;
}

function registerCharSectionsIpc(ipcMain, { getMpqReader }) {
  ipcMain.handle('dbc:readCharSectionsFile', async (_, filePath) => {
    try {
      if (!filePath) return { success: false, error: 'CharSections.dbc path is missing.' };
      const records = parseCharSectionsBuffer(fs.readFileSync(filePath));
      return records ? { success: true, records, sourcePath: filePath } : { success: false, error: 'The selected file is not a valid CharSections.dbc.' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('dbc:readCharSectionsFromMpq', async (_, dataPath, archivePath) => {
    try {
      const reader = getMpqReader?.();
      if (!dataPath || !archivePath || !reader?.readFileFromMpqEntry) return { success: false, error: 'Client archive is not available.' };
      let buffer = null;
      for (const internalPath of CHAR_SECTIONS_PATHS) {
        buffer = await reader.readFileFromMpqEntry(dataPath, archivePath, internalPath);
        if (buffer) break;
      }
      const records = parseCharSectionsBuffer(buffer);
      return records ? { success: true, records, archivePath } : { success: false, error: 'CharSections.dbc was not found in the selected client archive.' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { registerCharSectionsIpc };
