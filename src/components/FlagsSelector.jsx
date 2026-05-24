import { useState, useRef, useEffect } from 'react';
import { CheckCircle2 } from 'lucide-react';
import './FlagsSelector.css';

const FLAG_DEFINITIONS = {
  npcflag: [
    { bit: 0, label: 'Gossip' },
    { bit: 1, label: 'Quest Giver' },
    { bit: 2, label: 'Unnamed 3' },
    { bit: 3, label: 'Unnamed 4' },
    { bit: 4, label: 'Trainer' },
    { bit: 5, label: 'Class Trainer' },
    { bit: 6, label: 'Flightmaster' },
    { bit: 7, label: 'Vendor' },
    { bit: 8, label: 'Vendor Armor' },
    { bit: 9, label: 'Vendor Food' },
    { bit: 10, label: 'Vendor Poison' },
    { bit: 11, label: 'Vendor Reagent' },
    { bit: 12, label: 'Repair' },
    { bit: 13, label: 'Repair Armor' },
    { bit: 14, label: 'Repair Weapon' },
    { bit: 15, label: 'Auctioneer' },
    { bit: 16, label: 'Stable Master' },
    { bit: 17, label: 'Banker' },
    { bit: 18, label: 'Petitioner' },
    { bit: 19, label: 'Tabard Designer' },
    { bit: 20, label: 'Battlemaster' },
    { bit: 21, label: 'Bank' },
    { bit: 22, label: 'Innkeeper' },
    { bit: 23, label: 'Mailbox' },
    { bit: 24, label: 'Mailbox' },
    { bit: 25, label: 'Steering' },
    { bit: 26, label: 'Spellclick' },
    { bit: 27, label: 'Player Vehicle' },
  ],
  unit_flags: [
    { bit: 0, label: 'Server Controlled' },
    { bit: 1, label: 'Non-attackable' },
    { bit: 2, label: 'Disable Movement' },
    { bit: 3, label: 'PvP Attackable' },
    { bit: 4, label: 'Rename' },
    { bit: 5, label: 'Preparation' },
    { bit: 6, label: 'Unk6' },
    { bit: 7, label: 'Not Attackable 1' },
    { bit: 8, label: 'Passive' },
    { bit: 9, label: 'Looting' },
    { bit: 10, label: 'Pet In Combat' },
    { bit: 11, label: 'PvP Flagged' },
    { bit: 12, label: 'Silenced' },
    { bit: 13, label: 'Cannot Swim' },
    { bit: 14, label: 'Unk14' },
    { bit: 15, label: 'Unk15' },
    { bit: 16, label: 'Unk16' },
    { bit: 17, label: 'Remove From Combat' },
    { bit: 18, label: 'Dynamic' },
    { bit: 19, label: 'Invisible' },
    { bit: 20, label: 'Unk20' },
    { bit: 21, label: 'Unk21' },
    { bit: 22, label: 'Unk22' },
    { bit: 23, label: 'Cannot Turn' },
    { bit: 24, label: 'Unk24' },
    { bit: 25, label: 'Unk25' },
    { bit: 26, label: 'Unk26' },
    { bit: 27, label: 'Unk27' },
    { bit: 28, label: 'Unk28' },
    { bit: 29, label: 'Unk29' },
    { bit: 30, label: 'Dead' },
  ],
  unit_flags2: [
    { bit: 0, label: 'Feign Death' },
    { bit: 1, label: 'Hide Body' },
    { bit: 2, label: 'Ignore Reputation' },
    { bit: 3, label: 'Comprehend Lang' },
    { bit: 4, label: 'Mime' },
    { bit: 5, label: 'Dont Fade In' },
    { bit: 6, label: 'Phase' },
    { bit: 7, label: 'Healing Dependent' },
    { bit: 8, label: 'Force Movement' },
    { bit: 9, label: 'Disarm' },
    { bit: 10, label: 'Disarm Offhand' },
    { bit: 11, label: 'Disable Pred' },
    { bit: 12, label: 'Allow Changing Talents' },
    { bit: 13, label: 'Large Aura' },
  ],
  dynamicflags: [
    { bit: 0, label: 'Lootable' },
    { bit: 1, label: 'Tapped' },
    { bit: 2, label: 'Tapped By Player' },
    { bit: 3, label: 'Tapped By All Threat List' },
    { bit: 4, label: 'Has Loot' },
    { bit: 5, label: 'Track Unit' },
    { bit: 6, label: 'Tagged For Pvp' },
  ],
  flags_extra: [
    { bit: 0, label: 'Instance Bind' },
    { bit: 1, label: 'Civilian' },
    { bit: 2, label: 'No Parry' },
    { bit: 3, label: 'No Parry Hasten' },
    { bit: 4, label: 'No Block' },
    { bit: 5, label: 'No Crush' },
    { bit: 6, label: 'No Xp Requirements' },
    { bit: 7, label: 'No Loot' },
    { bit: 8, label: 'Uses Default Loot' },
    { bit: 9, label: 'Protect From Pvp' },
    { bit: 10, label: 'Ghost Visibility' },
    { bit: 11, label: 'No Aggro On Sight' },
    { bit: 12, label: 'Treat As Cursed' },
  ],
};

export default function FlagsSelector({ field, value, onChange, label }) {
  const [showModal, setShowModal] = useState(false);
  const [checked, setChecked] = useState({});
  const modalRef = useRef(null);

  const bits = FLAG_DEFINITIONS[field] || [];
  const displayValue = value ?? 0;

  useEffect(() => {
    const newChecked = {};
    bits.forEach(b => {
      newChecked[b.bit] = (displayValue & (1 << b.bit)) !== 0;
    });
    setChecked(newChecked);
  }, [displayValue, bits]);

  const handleCheck = (bit) => {
    const newChecked = { ...checked, [bit]: !checked[bit] };
    setChecked(newChecked);
    const newValue = bits.reduce((sum, b) => sum + (newChecked[b.bit] ? (1 << b.bit) : 0), 0);
    onChange(newValue);
  };

  const handleClickOutside = (e) => {
    if (modalRef.current && !modalRef.current.contains(e.target)) {
      setShowModal(false);
    }
  };

  useEffect(() => {
    if (showModal) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showModal]);

  const checkedCount = Object.values(checked).filter(Boolean).length;

  return (
    <div className="flags-selector">
      <div className="flags-input-group">
        <input
          type="number"
          value={displayValue}
          onChange={e => onChange(parseInt(e.target.value) || 0)}
          readOnly
        />
        <button className="btn-ghost flags-btn" onClick={() => setShowModal(!showModal)}>
          Bits {checkedCount > 0 && <span className="flags-badge">{checkedCount}</span>}
        </button>
      </div>

      {showModal && (
        <div className="flags-modal" ref={modalRef}>
          <div className="flags-modal-header">
            <h4>{label || field}</h4>
          </div>
          <div className="flags-modal-content">
            {bits.map(b => (
              <label key={b.bit} className="flags-checkbox">
                <input
                  type="checkbox"
                  checked={checked[b.bit] || false}
                  onChange={() => handleCheck(b.bit)}
                />
                <span className="checkbox-mark">
                  {checked[b.bit] && <CheckCircle2 size={14} />}
                </span>
                <span className="checkbox-label">{b.label}</span>
                <span className="checkbox-bit">{b.bit}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
