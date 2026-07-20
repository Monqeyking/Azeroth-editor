const KEY = 'azeroth-editor.texture-semantic-corrections.v1';
export class TemplateCorrectionStore {
  constructor(storage = globalThis.localStorage) { this.storage = storage; }
  list(templateId, version) { try { return JSON.parse(this.storage?.getItem(KEY) || '[]').filter(x => x.templateId === templateId && x.templateVersion === version); } catch { return []; } }
  save(correction) { const all = this.listAll(); const record = { id: correction.id || `${correction.templateId}:${correction.semantic}:${Date.now()}`, scope: 'template', ...correction }; this.storage?.setItem(KEY, JSON.stringify([...all.filter(x => x.id !== record.id), record])); return record; }
  listAll() { try { return JSON.parse(this.storage?.getItem(KEY) || '[]'); } catch { return []; } }
}
