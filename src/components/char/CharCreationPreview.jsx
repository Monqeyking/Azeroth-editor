import { useState, useMemo, useEffect } from 'react';
import { ChevronLeft, ChevronRight, ImageOff, Loader2 } from 'lucide-react';
import CharM2Viewer from './CharM2Viewer';
import { useBlpTexture } from '../../lib/useBlpTexture';

const SECTION_LABELS = {
  0: 'Skin Color',
  1: 'Face',
  2: 'Facial Hair',
  3: 'Hair Style',
  4: 'Underwear',
};

function OptionThumb({ blpPath, size = 52 }) {
  const { dataUrl, loading, error } = useBlpTexture(blpPath);
  if (!blpPath) return null;
  return (
    <div className="ccp-thumb" style={{ width: size, height: size }}>
      {loading ? <Loader2 size={13} className="cc-spin" /> :
       (error || !dataUrl) ? <ImageOff size={13} className="ccp-thumb-err" /> :
       <img src={dataUrl} alt="" />}
    </div>
  );
}

function CategorySelector({ label, records, selectedIdx, onSelect }) {
  const sorted = useMemo(() =>
    [...records].sort((a, b) =>
      a.flags - b.flags || a.variationIndex - b.variationIndex || a.colorIndex - b.colorIndex
    ), [records]);

  const cur = sorted[selectedIdx] ?? sorted[0];
  const total = sorted.length;

  return (
    <div className="ccp-category">
      <div className="ccp-category-label">{label}</div>
      <div className="ccp-selector">
        <button className="ccp-arrow-btn" disabled={selectedIdx <= 0}
          onClick={() => onSelect(Math.max(0, selectedIdx - 1))}>
          <ChevronLeft size={14} />
        </button>
        <div className="ccp-thumb-row">
          {cur ? (
            <>
              <OptionThumb blpPath={cur.tex1} size={52} />
              {cur.tex2 ? <OptionThumb blpPath={cur.tex2} size={52} /> : null}
            </>
          ) : <span className="ccp-no-record">—</span>}
        </div>
        <button className="ccp-arrow-btn" disabled={selectedIdx >= total - 1}
          onClick={() => onSelect(Math.min(total - 1, selectedIdx + 1))}>
          <ChevronRight size={14} />
        </button>
        <span className="ccp-counter">{total > 0 ? `${selectedIdx + 1}/${total}` : '—'}</span>
      </div>
      {cur && (
        <div className="ccp-detail">
          <span className="ccp-detail-meta">
            ID {cur.id} &nbsp;·&nbsp; Var {cur.variationIndex} &nbsp;·&nbsp; Col {cur.colorIndex}
          </span>
          {cur.tex1 && (
            <span className="ccp-detail-path" title={cur.tex1}>{cur.tex1}</span>
          )}
          {cur.tex2 && (
            <span className="ccp-detail-path ccp-detail-path-extra" title={cur.tex2}>{cur.tex2}</span>
          )}
        </div>
      )}
    </div>
  );
}

export default function CharCreationPreview({ allRecords, race, gender, hasDataPath, preferOutput = false, textureRefreshKey = 0 }) {
  const bySection = useMemo(() => {
    const m = new Map();
    for (const r of allRecords) {
      if (r.race !== race || r.sex !== gender) continue;
      if (!m.has(r.baseSection)) m.set(r.baseSection, []);
      m.get(r.baseSection).push(r);
    }
    return m;
  }, [allRecords, race, gender]);

  const [indices, setIndices] = useState({ 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 });

  useEffect(() => {
    setIndices({ 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 });
  }, [race, gender]);

  const setIdx = (section, idx) => setIndices(prev => ({ ...prev, [section]: idx }));

  // Skin records gesorteerd voor de 3D viewer
  const skinSorted = useMemo(() => {
    const recs = bySection.get(0) || [];
    return [...recs].sort((a, b) =>
      a.flags - b.flags || a.variationIndex - b.variationIndex || a.colorIndex - b.colorIndex
    );
  }, [bySection]);

  const currentSkin = skinSorted[indices[0]];
  const selectedForSection = (section) => {
    const rows = [...(bySection.get(section) || [])].sort((a, b) => a.flags - b.flags || a.variationIndex - b.variationIndex || a.colorIndex - b.colorIndex);
    return rows[indices[section]] || rows[0] || null;
  };
  const currentFace = selectedForSection(1);
  const currentHair = selectedForSection(3);

  const sections = [0, 1, 2, 3, 4].filter(s => (bySection.get(s) || []).length > 0);

  return (
    <div className="ccp-layout">
      {/* 3D model */}
      <div className="ccp-model-panel">
        <CharM2Viewer
          race={race}
          gender={gender}
          skinBlp={currentSkin?.tex1 || null}
          skinExtraBlp={currentSkin?.tex2 || null}
          textureLayers={[
            ...(currentFace ? [{ path: currentFace.tex1, region: 'face-lower' }, { path: currentFace.tex2, region: 'face-upper' }] : []),
            ...(currentHair?.tex1 ? [{ path: currentHair.tex1, region: 'hair-primary' }] : []),
          ]}
          appearance={{ face: currentFace?.variationIndex || 0, hairStyle: currentHair?.variationIndex || 0, hairColor: currentHair?.colorIndex || 0 }}
          preferOutput={preferOutput}
          textureRefreshKey={textureRefreshKey}
          active={hasDataPath}
        />
        {!hasDataPath && (
          <div className="ccp-model-warn">Geen WoW data-pad — stel in via Settings</div>
        )}
      </div>

      {/* Opties */}
      <div className="ccp-options-panel">
        {!hasDataPath && (
          <div className="ccp-warn-banner">Textures laden niet zonder data-pad.</div>
        )}
        {sections.length === 0 ? (
          <div className="ccp-no-data">Geen records voor race/gender.</div>
        ) : (
          sections.map(s => (
            <CategorySelector
              key={s}
              label={SECTION_LABELS[s] ?? `Section ${s}`}
              records={bySection.get(s) || []}
              selectedIdx={indices[s]}
              onSelect={idx => setIdx(s, idx)}
            />
          ))
        )}
      </div>
    </div>
  );
}
