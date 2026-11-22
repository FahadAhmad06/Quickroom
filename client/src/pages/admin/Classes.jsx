import { useState } from 'react';
import { Link } from 'react-router-dom';
import useFetch from '../../hooks/useFetch';
import Async from '../../components/Async';
import PageHeader from '../../components/PageHeader';
import EmptyState from '../../components/EmptyState';
import Icon from '../../components/Icon';
import { useConfirm, useToast } from '../../components/Feedback';
import api from '../../utils/api';

export default function Classes() {
  const state = useFetch('/admin/classes'), toast = useToast(), confirm = useConfirm();
  const [form, setForm] = useState({ name: '', maxStrength: '42', code: '', registrationEnabled: true, classCodeEnabled: true });
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const reloadAct = async fn => {
    setBusy(true);
    try { await fn(); toast.ok('Class updated.'); state.reload(); }
    catch (e) { toast.bad(e.message); }
    setBusy(false);
  };
  const create = () => reloadAct(async () => {
    const body = { name: form.name, maxStrength: Number(form.maxStrength), code: form.code, registrationEnabled: form.registrationEnabled !== false, classCodeEnabled: form.classCodeEnabled !== false };
    if (editing) {
      await api('/admin/classes/' + editing._id, { method: 'PATCH', body });
    } else {
      await api('/admin/classes', { method: 'POST', body });
    }
    setForm({ name: '', maxStrength: '42', code: '', registrationEnabled: true, classCodeEnabled: true });
    setEditing(null);
    setModal(false);
  });
  const editStrength = async c => {
    setEditing(c);
    setForm({
      name: c.name,
      maxStrength: String(c.maxStrength),
      code: c.code,
      registrationEnabled: c.registrationEnabled,
      classCodeEnabled: c.classCodeEnabled
    });
    setModal(true);
  };
  const toggle = (c, field) => reloadAct(() => api('/admin/classes/' + c._id, { method: 'PATCH', body: { [field]: !c[field] } }));
  const regenerate = async c => {
    if (!await confirm({ title: 'Regenerate class code?', message: 'Students using ' + c.code + ' will need the new code.' })) return;
    await reloadAct(() => api('/admin/classes/' + c._id + '/regenerate-code', { method: 'POST', body: {} }));
  };
  const deleteClass = async c => {
    if (busy) return;
    const confirmed = await confirm({
      title: 'Delete ' + c.name + '?',
      message: 'Are you sure you want to delete this class? It will be removed from active Class Management. Registrations, PINs and class assignments will be cleaned up, while historical attempts and results will remain accessible.',
      confirmText: 'Delete Class',
      cancelText: 'Cancel',
      danger: true
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await api('/admin/classes/' + c._id, { method: 'DELETE' });
      toast.ok(c.name + ' deleted.');
      state.reload();
    } catch (e) {
      toast.bad(e.message);
    } finally {
      setBusy(false);
    }
  };

  return <>
    <PageHeader title="Class Management" subtitle="Create, organize, and monitor class registrations.">
      <button onClick={() => { setEditing(null); setForm({ name: '', maxStrength: '42', code: '', registrationEnabled: true, classCodeEnabled: true }); setModal(true); }}><Icon name="plus" size={16} />Create class</button>
    </PageHeader>
    <Async state={state}>{classes => {
      const filtered = classes.filter(c => (c.name + ' ' + c.code).toLowerCase().includes(search.trim().toLowerCase()));
      const openCount = classes.filter(c => c.registrationEnabled).length;
      const students = classes.reduce((n, c) => n + c.registeredCount, 0);
      const seats = classes.reduce((n, c) => n + c.remainingSeats, 0);
      const stats = [
        ['Total Classes', classes.length, 'students', 'purple'],
        ['Registered Students', students, 'checkCircle', 'green'],
        ['Available Seats', seats, 'key', 'blue'],
        ['Registration Open', openCount, 'unlock', 'green'],
        ['Registration Closed', classes.length - openCount, 'lock', 'red']
      ];
      return <>
        <div className="class-stat-grid">{stats.map(([label, value, icon, tone]) =>
          <div className="class-stat-card" key={label}><span className={'class-stat-icon ' + tone}><Icon name={icon} size={18} /></span><div><b>{value}</b><span>{label}</span></div></div>
        )}</div>
        <div className="card class-toolbar-card">
          <div className="search-input class-search"><Icon name="search" size={16} /><input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search class name or code" /></div>
          <span className="muted small-text">{filtered.length} of {classes.length} classes</span>
        </div>
        {!filtered.length
          ? <div className="card"><EmptyState icon="students">{classes.length ? 'No classes match your search.' : 'No classes yet. Create the first class.'}</EmptyState></div>
          : <div className="class-card-grid">{filtered.map(c => {
            const pct = c.maxStrength ? Math.min(100, Math.round(c.registeredCount / c.maxStrength * 100)) : 0;
            return <article className="card class-card" key={c._id}>
              <div className="class-card-head">
                <div><span className="class-code">{c.code}</span><h2>{c.name}</h2></div>
                <span className={'badge ' + (c.registrationEnabled ? 'ok' : 'bad')}>{c.registrationEnabled ? 'Open' : 'Closed'}</span>
              </div>
              <div className="class-progress-header"><span>Enrollment</span><strong>{c.registeredCount} / {c.maxStrength}</strong></div>
              <div className="progress-track"><div style={{ width: pct + '%' }} /></div>
              <div className="class-meta-grid">
                <div><span>Registered</span><b>{c.registeredCount}</b></div>
                <div><span>Remaining</span><b>{c.remainingSeats}</b></div>
                <div><span>PINs</span><b>{c.activePinCount}</b></div>
              </div>
              {c.registeredCount > c.maxStrength && <p className="err small-text">Over capacity. Existing students are preserved; new registrations are blocked.</p>}
              <div className="class-method-row">
                <span className={'method-pill ' + (c.activePinCount >= 0 ? 'on' : '')}><Icon name="key" size={13} />PIN</span>
                <span className={'method-pill ' + (c.classCodeEnabled ? 'on' : '')}><Icon name="students" size={13} />Class Code</span>
              </div>
              <div className="muted small-text class-created">Created {c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '—'}</div>
              <div className="class-card-actions">
                <Link className="btn small" to={'/admin/classes/' + c._id}>View class</Link>
                <button className="ghost small" onClick={() => editStrength(c)} disabled={busy}>Edit capacity</button>
                <Link className="ghost small" to={'/admin/classes/' + c._id}>Manage students</Link>
                <button className="ghost small" onClick={() => toggle(c, 'registrationEnabled')} disabled={busy}>{c.registrationEnabled ? 'Close' : 'Open'}</button>
                <button className="ghost small" onClick={() => toggle(c, 'classCodeEnabled')} disabled={busy}>{c.classCodeEnabled ? 'Disable code' : 'Enable code'}</button>
                <button className="ghost small" onClick={() => regenerate(c)} disabled={busy}>New code</button>
                <button className="danger small" onClick={() => deleteClass(c)} disabled={busy}>{busy ? 'Deleting…' : 'Delete Class'}</button>
              </div>
            </article>;
          })}</div>}
      </>;
    }}</Async>
    {modal && <div className="class-modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) { setModal(false); setEditing(null); } }}>
      <div className="class-modal" role="dialog" aria-modal="true" aria-labelledby="create-class-title">
        <div className="card-head"><h2 id="create-class-title">{editing ? 'Edit class' : 'Create a class'}</h2><button className="icon-btn" onClick={() => { setModal(false); setEditing(null); }} aria-label="Close"><Icon name="close" size={18} /></button></div>
        <label className="field" htmlFor="cc-name">Class name</label>
        <input id="cc-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. BSCS Semester 3" />
        <label className="field" htmlFor="cc-strength">Maximum student capacity</label>
        <input id="cc-strength" type="number" min="1" max="100000" value={form.maxStrength} onChange={e => setForm({ ...form, maxStrength: e.target.value })} />
        <label className="chk"><input type="checkbox" checked={form.registrationEnabled} onChange={e => setForm({ ...form, registrationEnabled: e.target.checked })} />Registration enabled</label>
        <label className="chk"><input type="checkbox" checked={form.classCodeEnabled} onChange={e => setForm({ ...form, classCodeEnabled: e.target.checked })} />Allow shared Class Code registration</label>
        {!editing && <><button className="ghost small" type="button" onClick={() => setShowAdvanced(v => !v)}>{showAdvanced ? 'Hide' : 'Add'} custom class code</button>
        {showAdvanced && <><label className="field" htmlFor="cc-code">Custom class code</label><input id="cc-code" value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="Optional" /></>}</>}
        <div className="class-modal-actions"><button className="ghost" onClick={() => { setModal(false); setEditing(null); }}>Cancel</button><button disabled={busy || !form.name.trim()} onClick={create}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Create class'}</button></div>
      </div>
    </div>}
  </>;
}
