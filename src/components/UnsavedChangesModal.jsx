export function UnsavedChangesModal({ onConfirm, onCancel }) {
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
          Unsaved changes
        </h3>
        <p style={{ margin: '0 0 20px', color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.5 }}>
          You have unsaved changes. Are you sure you want to leave this page?
        </p>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button className="btn-ghost" onClick={onCancel}>Stay</button>
          <button className="btn-danger" onClick={onConfirm}>Leave</button>
        </div>
      </div>
    </div>
  );
}
