import { useCallback, useEffect, useState } from 'react';
import { useConnection } from '../lib/ConnectionContext';
import { AlertTriangle, Filter, Plus, Save, Search, Trash2, Trophy } from 'lucide-react';
import './AchievementEditorPage.css';

function normalizeText(value) {
  return String(value || '').toLowerCase();
}

function buildCategoryMeta(categories) {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const cache = new Map();

  const getPath = (id) => {
    if (!id || !byId.has(id)) return '';
    if (cache.has(id)) return cache.get(id);
    const node = byId.get(id);
    const parentPath = node.parentId > 0 ? getPath(node.parentId) : '';
    const path = parentPath ? `${parentPath} / ${node.name}` : node.name;
    cache.set(id, path);
    return path;
  };

  const withDepth = categories
    .map((category) => {
      let depth = 0;
      let current = category;
      while (current?.parentId > 0 && byId.has(current.parentId) && depth < 12) {
        depth += 1;
        current = byId.get(current.parentId);
      }
      return { ...category, depth, path: getPath(category.id) };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  return { withDepth, getPath };
}

function matchesSearch(achievement, search) {
  const needle = normalizeText(search).trim();
  if (!needle) return true;
  if (/^\d+$/.test(needle)) return String(achievement.id).includes(needle);
  return normalizeText(`${achievement.name} ${achievement.description} ${achievement.reward} ${achievement.categoryPath}`).includes(needle);
}

function criterionTypeLabel(type) {
  if (type === 5) return 'Reach level';
  return `Type ${type}`;
}

function factionLabel(value) {
  if (value === -1) return 'Both';
  if (value === 0) return 'Neutral';
  if (value === 1) return 'Alliance';
  if (value === 2) return 'Horde';
  return String(value);
}

function toNumber(value) {
  return Number(value) || 0;
}

function blankCriterion(orderIndex = 0) {
  return {
    id: 0,
    type: 0,
    asset1: 0,
    asset2: 0,
    asset3: 0,
    asset4: 0,
    quantity: 0,
    startEvent: 0,
    startAsset: 0,
    failEvent: 0,
    failAsset: 0,
    description: '',
    flags: 0,
    orderIndex,
    _localKey: `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
}

export default function AchievementEditorPage() {
  const { dbcPath, readAchievementsOverview, writeAchievement, createAchievement, deleteAchievement, writeAchievementCriteria, idRanges } = useConnection();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [data, setData] = useState({ achievements: [], categories: [], stats: null });
  const [selectedId, setSelectedId] = useState(0);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [pointsFilter, setPointsFilter] = useState('all');
  const [criteriaFilter, setCriteriaFilter] = useState('all');
  const [achievementDraft, setAchievementDraft] = useState(null);
  const [criteriaDraft, setCriteriaDraft] = useState([]);
  const [savingAchievement, setSavingAchievement] = useState(false);
  const [savingCriteria, setSavingCriteria] = useState(false);
  const [creatingAchievement, setCreatingAchievement] = useState(false);
  const [deletingAchievement, setDeletingAchievement] = useState(false);

  const loadOverview = useCallback(async (preferredId = 0) => {
    if (!dbcPath) {
      setError('No DBC path set in Settings.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    const result = await readAchievementsOverview();
    if (!result.success) {
      setError(result.error || 'Could not read achievement DBCs.');
      setLoading(false);
      return;
    }

    setData(result.data);
    const nextId = result.data.achievements.some((entry) => entry.id === preferredId)
      ? preferredId
      : (result.data.achievements[0]?.id || 0);
    setSelectedId(nextId);
    setLoading(false);
  }, [dbcPath, readAchievementsOverview]);

  useEffect(() => {
    loadOverview(selectedId);
  }, [loadOverview]);

  const categoryMeta = buildCategoryMeta(data.categories);
  const prepared = data.achievements.map((achievement) => ({
    ...achievement,
    categoryPath: categoryMeta.getPath(achievement.categoryId),
  }));

  const filtered = prepared.filter((achievement) => {
    if (!matchesSearch(achievement, search)) return false;
    if (categoryFilter !== 'all' && String(achievement.categoryId) !== categoryFilter) return false;
    if (pointsFilter === 'points' && achievement.points <= 0) return false;
    if (pointsFilter === 'zero' && achievement.points !== 0) return false;
    if (criteriaFilter === 'none' && achievement.criteriaCount !== 0) return false;
    if (criteriaFilter === 'single' && achievement.criteriaCount !== 1) return false;
    if (criteriaFilter === 'multi' && achievement.criteriaCount < 2) return false;
    return true;
  });

  useEffect(() => {
    if (!filtered.length) return;
    if (!filtered.some((achievement) => achievement.id === selectedId)) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);

  useEffect(() => {
    const selected = prepared.find((achievement) => achievement.id === selectedId) || null;
    setAchievementDraft(selected ? {
      id: selected.id,
      faction: selected.faction,
      mapId: selected.mapId,
      previousAchievementId: selected.previousAchievementId,
      name: selected.name,
      description: selected.description,
      categoryId: selected.categoryId,
      points: selected.points,
      orderInCategory: selected.orderInCategory,
      flags: selected.flags,
      iconId: selected.iconId,
      reward: selected.reward,
      minimumCriteria: selected.minimumCriteria,
      sharesCriteria: selected.sharesCriteria,
    } : null);
    setCriteriaDraft(selected ? selected.criteria.map((criterion) => ({ ...criterion, _localKey: `existing-${criterion.id}` })) : []);
    setStatus('');
  }, [selectedId, data]);

  const selected = prepared.find((achievement) => achievement.id === selectedId) || null;
  const incomingReferences = selected ? prepared.filter((achievement) => achievement.previousAchievementId === selected.id) : [];
  const deleteImpact = selected ? {
    achievements: 1,
    criteria: selected.criteriaCount || criteriaDraft.length || 0,
    incomingReferences: incomingReferences.length,
  } : null;

  const updateAchievementField = (field, value) => {
    setAchievementDraft((prev) => prev ? { ...prev, [field]: value } : prev);
  };

  const updateCriterion = (key, field, value) => {
    setCriteriaDraft((prev) => prev.map((criterion) => (
      (criterion._localKey || criterion.id) === key
        ? { ...criterion, [field]: value }
        : criterion
    )));
  };

  const handleSaveAchievement = async () => {
    if (!achievementDraft) return;
    setSavingAchievement(true);
    setStatus('Saving achievement...');
    const result = await writeAchievement({
      ...achievementDraft,
      id: toNumber(achievementDraft.id),
      faction: toNumber(achievementDraft.faction),
      mapId: toNumber(achievementDraft.mapId),
      previousAchievementId: toNumber(achievementDraft.previousAchievementId),
      categoryId: toNumber(achievementDraft.categoryId),
      points: toNumber(achievementDraft.points),
      orderInCategory: toNumber(achievementDraft.orderInCategory),
      flags: toNumber(achievementDraft.flags),
      iconId: toNumber(achievementDraft.iconId),
      minimumCriteria: toNumber(achievementDraft.minimumCriteria),
      sharesCriteria: toNumber(achievementDraft.sharesCriteria),
    });
    setSavingAchievement(false);
    if (!result.success) {
      setStatus(`Achievement save failed: ${result.error}`);
      return;
    }
    setStatus('Achievement saved.');
    await loadOverview(achievementDraft.id);
  };

  const handleSaveCriteria = async () => {
    if (!selected) return;
    setSavingCriteria(true);
    setStatus('Saving criteria...');
    const payload = criteriaDraft.map((criterion, index) => ({
      id: toNumber(criterion.id),
      type: toNumber(criterion.type),
      asset1: toNumber(criterion.asset1),
      asset2: toNumber(criterion.asset2),
      asset3: toNumber(criterion.asset3),
      asset4: toNumber(criterion.asset4),
      quantity: toNumber(criterion.quantity),
      startEvent: toNumber(criterion.startEvent),
      startAsset: toNumber(criterion.startAsset),
      failEvent: toNumber(criterion.failEvent),
      failAsset: toNumber(criterion.failAsset),
      description: criterion.description || '',
      flags: toNumber(criterion.flags),
      orderIndex: toNumber(criterion.orderIndex || index),
    }));
    const result = await writeAchievementCriteria(selected.id, payload);
    setSavingCriteria(false);
    if (!result.success) {
      setStatus(`Criteria save failed: ${result.error}`);
      return;
    }
    setStatus('Criteria saved.');
    await loadOverview(selected.id);
  };

  const addCriterion = () => {
    setCriteriaDraft((prev) => prev.concat(blankCriterion(prev.length)));
  };

  const handleCreateAchievement = async () => {
    const preferredCategoryId = categoryFilter !== 'all'
      ? toNumber(categoryFilter)
      : (selected?.categoryId || data.categories[0]?.id || 0);
    setCreatingAchievement(true);
    setStatus('Creating achievement...');
    const result = await createAchievement({
      startId: idRanges.achievement || 4000000,
      categoryId: preferredCategoryId,
      faction: -1,
      name: 'New Achievement',
      description: '',
      points: 0,
      reward: '',
    });
    setCreatingAchievement(false);
    if (!result.success) {
      setStatus(`Create failed: ${result.error}`);
      return;
    }
    setStatus('Achievement created.');
    await loadOverview(result.id);
  };

  const handleDeleteAchievement = async () => {
    if (!selected) return;
    const lines = [
      `Delete achievement ${selected.id} (${selected.name || 'Unnamed'})?`,
      '',
      `Impact:`,
      `- 1 achievement`,
      `- ${deleteImpact?.criteria || 0} linked criteria`,
    ];
    if (deleteImpact?.incomingReferences) {
      lines.push(`- ${deleteImpact.incomingReferences} other achievements point here via Previous Achievement`);
      lines.push('');
      lines.push('Warning: those references are not auto-rewritten yet.');
    }
    const confirmed = window.confirm(lines.join('\n'));
    if (!confirmed) return;
    try {
      setDeletingAchievement(true);
      setStatus('Deleting achievement...');
      const result = await deleteAchievement(selected.id);
      if (!result.success) {
        setStatus(`Delete failed: ${result.error}`);
        return;
      }
      setStatus(`Achievement deleted. Removed ${result.deletedCriteria || 0} linked criteria.`);
      await loadOverview(0);
    } catch (error) {
      setStatus(`Delete failed: ${error?.message || error}`);
    } finally {
      setDeletingAchievement(false);
    }
  };

  const removeCriterion = (key) => {
    setCriteriaDraft((prev) => prev.filter((criterion) => (criterion._localKey || criterion.id) !== key));
  };

  return (
    <div className="achievement-page">
      <div className="achievement-hero">
        <div>
          <div className="achievement-kicker">Achievement editing</div>
          <h1>Achievement Editor</h1>
          <p>
            This step focuses on real DBC editing for existing achievements and their linked criteria.
            Category delete and move flows can land next on top of this save pipeline.
          </p>
        </div>
        <div className="achievement-stat-grid">
          <div className="achievement-stat-card">
            <span>Achievements</span>
            <strong>{data.stats?.achievementCount ?? 0}</strong>
          </div>
          <div className="achievement-stat-card">
            <span>Criteria</span>
            <strong>{data.stats?.criteriaCount ?? 0}</strong>
          </div>
          <div className="achievement-stat-card">
            <span>Categories</span>
            <strong>{data.stats?.categoryCount ?? 0}</strong>
          </div>
        </div>
      </div>

      <div className="achievement-path-banner">
        <span>DBC path</span>
        <code>{dbcPath || 'Not configured'}</code>
      </div>

      {(error || status) && (
        <div className={error ? 'achievement-error' : 'achievement-status'}>
          <AlertTriangle size={16} />
          <span>{error || status}</span>
        </div>
      )}

      <div className="achievement-shell">
        <aside className="achievement-filters">
          <div className="achievement-panel-title"><Filter size={15} /> Filters</div>

          <label className="achievement-field">
            <span>Search</span>
            <div className="achievement-search">
              <Search size={14} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, description, ID..." />
            </div>
          </label>

          <label className="achievement-field">
            <span>Category</span>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="all">All categories</option>
              {categoryMeta.withDepth.map((category) => (
                <option key={category.id} value={String(category.id)}>
                  {`${'  '.repeat(category.depth)}${category.name}`}
                </option>
              ))}
            </select>
          </label>

          <label className="achievement-field">
            <span>Points</span>
            <select value={pointsFilter} onChange={(e) => setPointsFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="points">Only scored achievements</option>
              <option value="zero">Only zero-point / stats</option>
            </select>
          </label>

          <label className="achievement-field">
            <span>Criteria</span>
            <select value={criteriaFilter} onChange={(e) => setCriteriaFilter(e.target.value)}>
              <option value="all">Any</option>
              <option value="none">No criteria</option>
              <option value="single">Exactly one criterion</option>
              <option value="multi">Multiple criteria</option>
            </select>
          </label>

          <div className="achievement-helper-box">
            <strong>Current scope</strong>
            <p>
              Existing achievements can now be edited and saved. Criteria rows can be changed, added, removed, and written back per achievement.
            </p>
          </div>
        </aside>

        <section className="achievement-results">
          <div className="achievement-results-head">
            <div className="achievement-panel-title"><Trophy size={15} /> Results</div>
            <button className="achievement-btn" onClick={handleCreateAchievement} disabled={creatingAchievement}>
              <Plus size={14} /> {creatingAchievement ? 'Creating...' : 'New Achievement'}
            </button>
          </div>
          <div className="achievement-results-summary">
            <strong>{filtered.length}</strong>
            <span>matching achievements</span>
          </div>

          <div className="achievement-result-list">
            {loading && <div className="achievement-empty">Loading achievements...</div>}
            {!loading && !filtered.length && <div className="achievement-empty">No achievements match the current filters.</div>}
            {!loading && filtered.map((achievement) => (
              <button
                key={achievement.id}
                className={`achievement-result-row${achievement.id === selected?.id ? ' selected' : ''}`}
                onClick={() => setSelectedId(achievement.id)}
              >
                <div className="achievement-result-main">
                  <strong>{achievement.name || `Achievement ${achievement.id}`}</strong>
                  <span>{achievement.categoryPath || 'Uncategorized'}</span>
                </div>
                <div className="achievement-result-meta">
                  <span>{achievement.points} pts</span>
                  <span>{achievement.criteriaCount} criteria</span>
                  <span>{factionLabel(achievement.faction)}</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="achievement-detail">
          <div className="achievement-panel-title">Editor</div>
          {!achievementDraft && <div className="achievement-empty">Pick an achievement to edit it.</div>}

          {achievementDraft && (
            <>
              <div className="achievement-detail-card">
                <div className="achievement-toolbar">
                  <div>
                    <h2>{achievementDraft.name || `Achievement ${achievementDraft.id}`}</h2>
                    <p>Edit the core achievement row in <code>Achievement.dbc</code>.</p>
                  </div>
                  <div className="achievement-toolbar-actions">
                    <button className="achievement-btn danger" onClick={handleDeleteAchievement} disabled={deletingAchievement}>
                      <Trash2 size={14} /> {deletingAchievement ? 'Deleting...' : 'Delete Achievement'}
                    </button>
                    <button className="achievement-btn primary" onClick={handleSaveAchievement} disabled={savingAchievement}>
                      <Save size={14} /> {savingAchievement ? 'Saving...' : 'Save Achievement'}
                    </button>
                  </div>
                </div>

                <div className="achievement-impact-box">
                  <div className="achievement-impact-title">Delete Impact Preview</div>
                  <div className="achievement-impact-grid">
                    <div><span>Achievements</span><strong>{deleteImpact?.achievements || 0}</strong></div>
                    <div><span>Criteria</span><strong>{deleteImpact?.criteria || 0}</strong></div>
                    <div><span>Incoming refs</span><strong>{deleteImpact?.incomingReferences || 0}</strong></div>
                  </div>
                  {!!incomingReferences.length && (
                    <div className="achievement-impact-warning">
                      Other achievements currently reference this one through <code>Previous Achievement</code>: {incomingReferences.slice(0, 5).map((entry) => `#${entry.id}`).join(', ')}{incomingReferences.length > 5 ? '...' : ''}
                    </div>
                  )}
                </div>

                <div className="achievement-form-grid">
                  <label className="achievement-field"><span>ID</span><input value={achievementDraft.id} readOnly /></label>
                  <label className="achievement-field"><span>Category</span>
                    <select value={achievementDraft.categoryId} onChange={(e) => updateAchievementField('categoryId', e.target.value)}>
                      {categoryMeta.withDepth.map((category) => (
                        <option key={category.id} value={category.id}>{`${'  '.repeat(category.depth)}${category.name}`}</option>
                      ))}
                    </select>
                  </label>
                  <label className="achievement-field achievement-field-wide"><span>Name</span><input value={achievementDraft.name} onChange={(e) => updateAchievementField('name', e.target.value)} /></label>
                  <label className="achievement-field achievement-field-wide"><span>Description</span><textarea value={achievementDraft.description} onChange={(e) => updateAchievementField('description', e.target.value)} rows={3} /></label>
                  <label className="achievement-field achievement-field-wide"><span>Reward text</span><textarea value={achievementDraft.reward} onChange={(e) => updateAchievementField('reward', e.target.value)} rows={2} /></label>
                  <label className="achievement-field"><span>Points</span><input value={achievementDraft.points} onChange={(e) => updateAchievementField('points', e.target.value)} /></label>
                  <label className="achievement-field"><span>Faction</span>
                    <select value={achievementDraft.faction} onChange={(e) => updateAchievementField('faction', e.target.value)}>
                      <option value={-1}>Both</option>
                      <option value={0}>Neutral</option>
                      <option value={1}>Alliance</option>
                      <option value={2}>Horde</option>
                    </select>
                  </label>
                  <label className="achievement-field"><span>Map ID</span><input value={achievementDraft.mapId} onChange={(e) => updateAchievementField('mapId', e.target.value)} /></label>
                  <label className="achievement-field"><span>Previous Achievement</span><input value={achievementDraft.previousAchievementId} onChange={(e) => updateAchievementField('previousAchievementId', e.target.value)} /></label>
                  <label className="achievement-field"><span>Order In Category</span><input value={achievementDraft.orderInCategory} onChange={(e) => updateAchievementField('orderInCategory', e.target.value)} /></label>
                  <label className="achievement-field"><span>Flags</span><input value={achievementDraft.flags} onChange={(e) => updateAchievementField('flags', e.target.value)} /></label>
                  <label className="achievement-field"><span>Icon ID</span><input value={achievementDraft.iconId} onChange={(e) => updateAchievementField('iconId', e.target.value)} /></label>
                  <label className="achievement-field"><span>Minimum Criteria</span><input value={achievementDraft.minimumCriteria} onChange={(e) => updateAchievementField('minimumCriteria', e.target.value)} /></label>
                  <label className="achievement-field"><span>Shares Criteria</span><input value={achievementDraft.sharesCriteria} onChange={(e) => updateAchievementField('sharesCriteria', e.target.value)} /></label>
                </div>
              </div>

              <div className="achievement-detail-card">
                <div className="achievement-toolbar">
                  <div>
                    <div className="achievement-subtitle">Criteria ({criteriaDraft.length})</div>
                    <p>Edit linked rows in <code>Achievement_Criteria.dbc</code>.</p>
                  </div>
                  <div className="achievement-toolbar-actions">
                    <button className="achievement-btn" onClick={addCriterion}><Plus size={14} /> Add Criterion</button>
                    <button className="achievement-btn primary" onClick={handleSaveCriteria} disabled={savingCriteria}>
                      <Save size={14} /> {savingCriteria ? 'Saving...' : 'Save Criteria'}
                    </button>
                  </div>
                </div>

                {!criteriaDraft.length && <div className="achievement-empty">This achievement has no criteria yet. Add one to begin.</div>}

                <div className="achievement-criteria-stack">
                  {criteriaDraft.map((criterion, index) => {
                    const key = criterion._localKey || criterion.id;
                    return (
                      <div key={key} className="achievement-criterion-card">
                        <div className="achievement-criterion-header">
                          <strong>{criterion.id ? `Criterion ${criterion.id}` : `New Criterion ${index + 1}`}</strong>
                          <button className="achievement-icon-btn" onClick={() => removeCriterion(key)} title="Remove criterion">
                            <Trash2 size={14} />
                          </button>
                        </div>
                        <div className="achievement-criterion-grid">
                          <label className="achievement-field"><span>ID</span><input value={criterion.id || 'new'} readOnly /></label>
                          <label className="achievement-field"><span>Type</span><input value={criterion.type} onChange={(e) => updateCriterion(key, 'type', e.target.value)} /></label>
                          <label className="achievement-field"><span>Order</span><input value={criterion.orderIndex} onChange={(e) => updateCriterion(key, 'orderIndex', e.target.value)} /></label>
                          <label className="achievement-field"><span>Quantity</span><input value={criterion.quantity} onChange={(e) => updateCriterion(key, 'quantity', e.target.value)} /></label>
                          <label className="achievement-field"><span>Asset 1</span><input value={criterion.asset1} onChange={(e) => updateCriterion(key, 'asset1', e.target.value)} /></label>
                          <label className="achievement-field"><span>Asset 2</span><input value={criterion.asset2} onChange={(e) => updateCriterion(key, 'asset2', e.target.value)} /></label>
                          <label className="achievement-field"><span>Asset 3</span><input value={criterion.asset3} onChange={(e) => updateCriterion(key, 'asset3', e.target.value)} /></label>
                          <label className="achievement-field"><span>Asset 4</span><input value={criterion.asset4} onChange={(e) => updateCriterion(key, 'asset4', e.target.value)} /></label>
                          <label className="achievement-field"><span>Start Event</span><input value={criterion.startEvent} onChange={(e) => updateCriterion(key, 'startEvent', e.target.value)} /></label>
                          <label className="achievement-field"><span>Start Asset</span><input value={criterion.startAsset} onChange={(e) => updateCriterion(key, 'startAsset', e.target.value)} /></label>
                          <label className="achievement-field"><span>Fail Event</span><input value={criterion.failEvent} onChange={(e) => updateCriterion(key, 'failEvent', e.target.value)} /></label>
                          <label className="achievement-field"><span>Fail Asset</span><input value={criterion.failAsset} onChange={(e) => updateCriterion(key, 'failAsset', e.target.value)} /></label>
                          <label className="achievement-field"><span>Flags</span><input value={criterion.flags} onChange={(e) => updateCriterion(key, 'flags', e.target.value)} /></label>
                          <label className="achievement-field achievement-field-wide"><span>Description</span><textarea value={criterion.description || ''} onChange={(e) => updateCriterion(key, 'description', e.target.value)} rows={2} /></label>
                        </div>
                        <div className="achievement-criterion-footer">{criterionTypeLabel(toNumber(criterion.type))}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
