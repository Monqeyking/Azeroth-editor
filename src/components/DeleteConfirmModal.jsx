import { useState, useEffect } from 'react';

export function DeleteConfirmModal({ title = 'Verwijderen', message, onConfirm, onCancel }) {
	const [selected, setSelected] = useState('yes');

	useEffect(() => {
		const down = (e) => {
			if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
				e.preventDefault();
				setSelected(s => (s === 'yes' ? 'no' : 'yes'));
			} else if (e.key === 'Enter') {
				e.preventDefault();
				if (selected === 'yes') onConfirm(); else onCancel();
			} else if (e.key === 'Escape') {
				e.preventDefault();
				onCancel();
			}
		};
		window.addEventListener('keydown', down);
		return () => window.removeEventListener('keydown', down);
	}, [selected, onConfirm, onCancel]);

	return (
		<div style={{
			position: 'fixed', inset: 0, zIndex: 1000,
			background: 'rgba(0,0,0,0.6)',
			display: 'flex', alignItems: 'center', justifyContent: 'center',
		}}>
			<div style={{
				background: 'var(--bg-secondary)',
				border: '1px solid var(--border)',
				borderRadius: '8px',
				padding: '24px',
				minWidth: '360px',
				maxWidth: '460px',
			}}>
				<h3 style={{ margin: '0 0 12px', color: 'var(--text-primary)', fontSize: '15px' }}>
					{title}
				</h3>
				<p style={{ margin: '0 0 20px', color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.5 }}>
					{message}
				</p>
				<div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
					<button
						className="btn-ghost"
						autoFocus={selected === 'no'}
						style={selected === 'no' ? { outline: '2px solid var(--gold)' } : undefined}
						onClick={onCancel}
						onMouseEnter={() => setSelected('no')}
					>
						No
					</button>
					<button
						className="btn-danger"
						autoFocus={selected === 'yes'}
						style={selected === 'yes' ? { outline: '2px solid var(--gold)' } : undefined}
						onClick={onConfirm}
						onMouseEnter={() => setSelected('yes')}
					>
						Yes
					</button>
				</div>
			</div>
		</div>
	);
}
