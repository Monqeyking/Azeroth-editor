import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Pencil, Search, X } from 'lucide-react';
import { useConnection } from '../lib/ConnectionContext';
import './SpellLookup.css';

export default function SpellLookup({ onSelect, onClose, title = 'Spell Lookup' }) {
  const { searchSpellsDbc } = useConnection();
  const [term, setTerm] = useState(''); const [results, setResults] = useState([]); const [status, setStatus] = useState(''); const [copied, setCopied] = useState(null); const input = useRef(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    let active = true;
    const removeListener = window.azeroth.window.onSpellLookupQuery?.(query => setTerm(String(query || '')));
    window.azeroth.window.getSpellLookupQuery?.().then(query => { if (active) setTerm(String(query || '')); });
    return () => { active = false; removeListener?.(); };
  }, []);
  useEffect(() => { const timer = setTimeout(async () => { setStatus('Searching…'); const r = await searchSpellsDbc(term.trim(), { limit: 100, excludeProcSpells: false }); setResults(r?.success ? r.data || [] : []); setStatus(r?.success ? '' : r?.error || 'Search failed'); }, 160); return () => clearTimeout(timer); }, [term, searchSpellsDbc]);
  const copy = async id => { await window.azeroth.clipboard.writeText(id); setCopied(id); setTimeout(() => setCopied(null), 1200); };
  return <section className="spell-lookup"><header><h2>{title}</h2>{onClose && <button onClick={onClose}><X size={16}/></button>}</header><label><Search size={16}/><input ref={input} value={term} onChange={e=>setTerm(e.target.value)} placeholder="Search by name or spell ID…"/></label><small>{status || `${results.length} spells`}</small><main>{results.map(s=><div key={s.ID}><button className="spell-result" onClick={()=>onSelect ? onSelect(s) : copy(s.ID)}><b>{s.Name_Lang_enUS}</b><span>{s.ID}{s.NameSubtext_Lang_enUS ? ` — ${s.NameSubtext_Lang_enUS}` : ''}</span></button><button onClick={()=>window.azeroth.window.openSpellEditor(s.ID)} title="Open in Spell Editor"><Pencil size={15}/></button><button onClick={()=>copy(s.ID)} title="Copy spell ID">{copied===s.ID?<Check size={15}/>:<Copy size={15}/>}</button></div>)} {!status && !results.length && <p>No spells found.</p>}</main></section>;
}
