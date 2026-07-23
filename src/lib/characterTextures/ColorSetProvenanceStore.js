const STORAGE_KEY = 'azeroth-editor.character-colour-provenance.v1';

export class ColorSetProvenanceStore {
  list() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch { return []; }
  }

  get(race, sex, outputColorIndex) {
    return this.list().find(item => item.race === race && item.sex === sex && item.outputColorIndex === outputColorIndex) || null;
  }

  save(entry) {
    const rows = this.list().filter(item => !(item.race === entry.race && item.sex === entry.sex && item.outputColorIndex === entry.outputColorIndex));
    rows.push({ ...entry, version: 1, savedAt: new Date().toISOString() });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  }
}
