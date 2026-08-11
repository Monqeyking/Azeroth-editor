function registerDialogIpc(ipcMain, dialog, getParentWindow) {
  ipcMain.handle('dialog:openFile', async (_, { title, filters }) => {
    const result = await dialog.showOpenDialog(getParentWindow(), {
      title: title || 'Select file',
      properties: ['openFile'],
      filters: filters || [
        { name: 'Executables', extensions: ['exe'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:openFolder', async (_, { title }) => {
    const result = await dialog.showOpenDialog(getParentWindow(), {
      title: title || 'Select folder',
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });
}

module.exports = { registerDialogIpc };
