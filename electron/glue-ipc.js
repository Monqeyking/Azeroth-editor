const fs = require('fs');
const path = require('path');

const GLUE_ROOT = 'Interface\\GlueXML';
const GLUE_TOC = `${GLUE_ROOT}\\GlueXML.toc`;

function decodeTextBuffer(buffer) {
  if (!Buffer.isBuffer(buffer)) return '';
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.toString('utf16le', 2);
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.allocUnsafe(buffer.length - 2);
    for (let i = 2; i + 1 < buffer.length; i += 2) {
      swapped[i - 2] = buffer[i + 1];
      swapped[i - 1] = buffer[i];
    }
    return swapped.toString('utf16le');
  }
  return buffer.toString('utf8').replace(/^\uFEFF/, '');
}

function normalizeInternalPath(value) {
  const normalized = String(value || '').replace(/\//g, '\\').replace(/^\\+/, '');
  if (!normalized || normalized.split('\\').includes('..') || path.win32.isAbsolute(normalized)) return null;
  return normalized;
}

function tocPath(line) {
  const value = String(line || '').trim();
  if (!value || value.startsWith('#') || !/\.(?:xml|lua)$/i.test(value)) return null;
  return normalizeInternalPath(`${GLUE_ROOT}\\${value}`);
}

function registerGlueIpc(ipcMain, { getMpqReader, getOutputRoot }) {
  async function readText(dataPath, internalPath) {
    const safePath = normalizeInternalPath(internalPath);
    if (!dataPath || !safePath) return { success: false, error: 'Missing or invalid client path.', path: internalPath };
    let buffer = null;
    const mpqReader = getMpqReader();
    if (mpqReader.isDataPath(dataPath) && mpqReader.readFileFromMpqs) buffer = await mpqReader.readFileFromMpqs(dataPath, safePath);
    if (!buffer) {
      const direct = path.join(dataPath, ...safePath.split('\\'));
      if (fs.existsSync(direct) && fs.statSync(direct).isFile()) buffer = fs.readFileSync(direct);
    }
    if (!buffer) return { success: false, error: 'File not found.', path: safePath };
    return { success: true, path: safePath, text: decodeTextBuffer(buffer) };
  }

  ipcMain.handle('glue:readTextFile', async (_, dataPath, internalPath) => {
    try { return await readText(dataPath, internalPath); }
    catch (error) { return { success: false, error: error.message, path: internalPath }; }
  });

  ipcMain.handle('glue:readBundle', async (_, dataPath, entryPaths = []) => {
    try {
      const toc = await readText(dataPath, GLUE_TOC);
      const requested = Array.isArray(entryPaths) ? entryPaths.map(normalizeInternalPath).filter(Boolean) : [];
      const tocFiles = toc.success ? toc.text.split(/\r?\n/).map(tocPath).filter(Boolean) : [];
      const requestedNames = new Set(requested.map(file => path.win32.basename(file).toLowerCase()));
      const lastEntryIndex = tocFiles.reduce((last, file, index) => requestedNames.has(path.win32.basename(file).toLowerCase()) ? index : last, -1);
      const dependencyRange = lastEntryIndex >= 0 ? tocFiles.slice(0, lastEntryIndex + 1) : tocFiles;
      const dependencies = dependencyRange.filter(file => /\.xml$/i.test(file) || /GlueStrings\.lua$/i.test(file));
      const paths = [...new Set([GLUE_TOC, ...dependencies, ...requested])];
      const files = [];
      for (const file of paths) files.push(await readText(dataPath, file));
      return { success: true, files, tocFound: toc.success };
    } catch (error) {
      return { success: false, error: error.message, files: [] };
    }
  });

  ipcMain.handle('glue:writeTextFile', async (_, relativePath, text) => {
    try {
      const safePath = normalizeInternalPath(relativePath);
      if (!safePath) return { success: false, error: 'Missing or invalid output path.' };
      const outputRoot = path.resolve(getOutputRoot());
      const outputPath = path.resolve(outputRoot, ...safePath.split('\\'));
      if (outputPath !== outputRoot && !outputPath.startsWith(`${outputRoot}${path.sep}`)) return { success: false, error: 'Output path escapes the editor output folder.' };
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, String(text ?? ''), 'utf8');
      return { success: true, path: safePath, absPath: outputPath };
    } catch (error) {
      return { success: false, error: error.message, path: relativePath };
    }
  });
}

module.exports = { decodeTextBuffer, normalizeInternalPath, registerGlueIpc };
