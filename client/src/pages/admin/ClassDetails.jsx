import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import useFetch from '../../hooks/useFetch';
import Async from '../../components/Async';
import PageHeader from '../../components/PageHeader';
import EmptyState from '../../components/EmptyState';
import Icon from '../../components/Icon';
import { useConfirm, useToast } from '../../components/Feedback';
import api from '../../utils/api';

export default function ClassDetails() {
  const { id } = useParams(), navigate = useNavigate();
  const state = useFetch('/admin/classes/' + id + '/members');
  const [query, setQuery] = useState('');
  const toast = useToast(), confirm = useConfirm();
  const [busy, setBusy] = useState(false);

  const act = async fn => {
    setBusy(true);
    try { await fn(); state.reload(); }
    catch (e) { toast.bad(e.message); }
    setBusy(false);
  };
  const copyCode = async code => {
    try { await navigator.clipboard.writeText(code); toast.ok('Class code copied.'); }
    catch { toast.bad('Could not copy the class code.'); }
  };
  const exportClass = async c => {
    const token = sessionStorage.getItem('qr_admin');
    let auth = '';
    try { auth = token ? JSON.parse(token).token : ''; } catch {}
    const configuredUrl = String(import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
    const root = configuredUrl ? (configuredUrl.endsWith('/api') ? configuredUrl : configuredUrl + '/api') : '/api';
    const res = await fetch(root + '/admin/classes/' + c._id + '/export', { headers: auth ? { Authorization: 'Bearer ' + auth } : {} });
    if (!res.ok) return toast.bad('Could not export class students.');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = c.code + '-students.csv'; a.click();
    URL.revokeObjectURL(url);
    toast.ok('Excel-compatible export downloaded.');
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
      navigate('/admin/classes');
    } catch (e) {
      toast.bad(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Async state={state}>{c => {
      const members = (c.members || []).filter(s => {
        const q = query.trim().toLowerCase();
        return !q || (s.name + ' ' + s.rollNumber).toLowerCase().includes(q);
      });
      const pct = c.maxStrength ? Math.min(100, Math.round(c.registeredCount / c.maxStrength * 100)) : 0;
      return <>
        <PageHeader title={c.name} subtitle={'Class code ' + c.code}>
          <Link className="btn ghost" to="/admin/classes">Back to classes</Link>
        </PageHeader>
        <div className="class-detail-grid">
          <section className="card class-overview-card">
            <div className="card-head"><h2><span className="hicon"><Icon name="students" size={16} /></span>Class overview</h2>
              <span className={'badge ' + (c.registrationEnabled ? 'ok' : 'bad')}>{c.registrationEnabled ? 'Registration open' : 'Registration closed'}</span>
            </div>
            <div className="class-code-row">
              <div><span className="muted small-text">Shared class code</span><strong>{c.code}</strong></div>
              <button className="ghost small" onClick={() => copyCode(c.code)}><Icon name="copy" size={14} />Copy</button>
            </div>
            <div className="class-detail-stats">
              <div><span>Capacity</span><strong>{c.maxStrength}</strong></div>
              <div><span>Registered</span><strong>{c.registeredCount}</strong></div>
              <div><span>Remaining</span><strong>{c.remainingSeats}</strong></div>
            </div>
            <div className="progress-track"><div style={{ width: pct + '%' }} /></div>
            <div className="progress-label"><span>{pct}% occupied</span><span>{c.activePinCount} active PINs</span></div>
          </section>
          <section className="card class-actions-card">
            <div className="card-head"><h2>Registration management</h2></div>
            <button className="block" onClick={() => navigate('/admin/rolls')}><Icon name="key" size={16} />Generate PINs for this class</button>
            <button className="btn ghost block" onClick={() => act(() => api('/admin/classes/' + c._id, { method: 'PATCH', body: { classCodeEnabled: !c.classCodeEnabled } }))} disabled={busy}>
              {c.classCodeEnabled ? 'Disable class code' : 'Enable class code'}
            </button>
            <button className="btn ghost block" onClick={() => exportClass(c)}><Icon name="download" size={14} />Export students to Excel CSV</button>
            <button className="danger block" onClick={() => deleteClass(c)} disabled={busy}>{busy ? 'Deleting…' : 'Delete Class'}</button>
          </section>
        </div>
        <section className="card">
          <div className="card-head"><h2><span className="hicon"><Icon name="students" size={16} /></span>Students ({c.members?.length || 0})</h2></div>
          <div className="search-input class-search"><Icon name="search" size={16} /><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name or roll number" /></div>
          {!members.length
            ? <EmptyState icon="students">{query ? 'No students match this search.' : 'No students are registered in this class yet.'}</EmptyState>
            : <div className="wrapx"><table className="class-members-table">
              <thead><tr><th>Student</th><th>Roll number</th><th>Method</th><th>Registered</th></tr></thead>
              <tbody>{members.map(s => <tr key={s._id || s.rollNumber}>
                <td><div className="student-cell"><span className="avatar">{(s.name || 'S')[0].toUpperCase()}</span><b>{s.name}</b></div></td>
                <td>{s.rollNumber}</td>
                <td><span className="badge">{s.registrationMethod === 'pin' ? 'Registration PIN' : s.registrationMethod === 'class_code' ? 'Class Code' : 'Legacy'}</span></td>
                <td className="muted small-text">{s.createdAt ? new Date(s.createdAt).toLocaleDateString() : '—'}</td>
              </tr>)}</tbody>
            </table></div>}
        </section>
      </>;
    }}</Async>
  );
}
