import { Fragment, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import useFetch from '../../hooks/useFetch';
import usePaged from '../../hooks/usePaged';
import useRetakes from '../../hooks/useRetakes';
import PageHeader from '../../components/PageHeader';
import Pagination from '../../components/Pagination';
import EmptyState from '../../components/EmptyState';
import ResultsTable from '../../components/ResultsTable';
import Loading from '../../components/Loading';
import ErrorBox from '../../components/ErrorBox';
import Icon from '../../components/Icon';
import { useConfirm, useToast } from '../../components/Feedback';
import api from '../../utils/api';

// Registered students = registered entries of the roll allowlist (GET /admin/rolls); their history is
// their rows from GET /admin/results (results are keyed by roll number). No new endpoints needed.
export default function Students() {
  const studentsState = useFetch('/admin/students'), results = useFetch('/admin/results');
  const retakes = useRetakes(), toast = useToast(), confirm = useConfirm();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(sp.get('q') || ''), [open, setOpen] = useState(sp.get('q') || null), [busy, setBusy] = useState(false);
  const s = q.trim().toLowerCase();

  const byRoll = {};
  (results.data || []).forEach(r => (byRoll[r.roll] = byRoll[r.roll] || []).push(r));
  const students = (studentsState.data || []).map(a => {
    const rs = byRoll[a.rollNumber] || [];
    const classNames = (a.classes || []).map(c => c.name).filter(Boolean).join(', ');
    return {
      id: a.allowlistId || a._id, allowlistId: a.allowlistId, name: a.name, roll: a.rollNumber,
      enabled: a.isEnabled !== false, registrationMethod: a.registrationMethod, classes: a.classes || [], classNames,
      results: rs,
      avg: rs.length ? Math.round(rs.reduce((t, r) => t + r.percent, 0) / rs.length) : null,
      last: rs.reduce((m, r) => (!m || new Date(r.createdAt) > new Date(m) ? r.createdAt : m), null)
    };
  }).sort((a, b) => a.roll.localeCompare(b.roll));
  const rows = students.filter(x => !s || (x.name + ' ' + x.roll + ' ' + x.classNames + ' ' + x.registrationMethod).toLowerCase().includes(s));
  const pg = usePaged(rows, 20, s);

  const remove = async x => {
    if (!(await confirm({ title: 'Delete student account?', message: 'Delete ' + x.name + ' (' + x.roll + ')? This permanently deletes their account. Their past results are not affected.', confirmText: 'Delete student', danger: true }))) return;
    setBusy(true);
    try {
      if (x.allowlistId) await api('/admin/rolls/' + x.allowlistId, { method: 'DELETE' });
      else await api('/admin/students/' + encodeURIComponent(x.roll), { method: 'DELETE' });
      toast.ok(x.name + ' deleted.');
      studentsState.reload();
    } catch (e) { toast.bad(e.message); }
    setBusy(false);
  };
  const toggle = roll => { setOpen(o => o === roll ? null : roll); if (sp.get('q')) setSp({}, { replace: true }); };

  return (<>
    <PageHeader title="Students" subtitle="Students registered by PIN or Class Code, with class membership and quiz history.">
      <Link className="btn ghost" to="/admin/rolls"><Icon name="key" size={16} />Authorize roll numbers</Link>
    </PageHeader>
    <div className="card">
      <div className="toolbar">
        <div className="search-input"><Icon name="search" size={16} /><input type="search" placeholder="Search name, roll number, class, or method" value={q} onChange={e => setQ(e.target.value)} aria-label="Search students" /></div>
        <span className="muted small-text">{students.length} registered</span>
      </div>
      {studentsState.error ? <ErrorBox message={studentsState.error} onRetry={studentsState.reload} />
        : !studentsState.data ? <Loading />
        : !rows.length ? <EmptyState icon="students">{students.length ? 'No students match your search.' : <>No registered students yet. Students register after you <Link className="link" to="/admin/rolls">authorize their roll number</Link>.</>}</EmptyState>
        : (<>
          <div className="wrapx"><table>
            <thead><tr><th>Student</th><th>Roll no.</th><th>Class name</th><th>Registration method</th><th>Attempts</th><th>Average</th><th>Last attempt</th><th>Actions</th></tr></thead>
            <tbody>{pg.rows.map(x => (<Fragment key={x.id}>
              <tr>
                <td><div className="row" style={{ flexWrap: 'nowrap', gap: 10 }}><span className="avatar" style={{ width: 32, height: 32, fontSize: 13 }}>{x.name[0]?.toUpperCase()}</span><b>{x.name}</b></div></td>
                <td>{x.roll}{!x.enabled && <> <span className="badge bad" title="Roll number disabled for new registrations"><Icon name="lock" />Roll disabled</span></>}</td>
                <td>{x.classNames ? <b className="small-text">{x.classNames}</b> : <span className="muted">—</span>}</td>
                <td><span className="badge">{x.registrationMethod === 'pin' ? 'Registration PIN' : x.registrationMethod === 'class_code' ? 'Class Code' : 'Legacy'}</span></td>
                <td>{results.data ? x.results.length : '…'}</td>
                <td>{x.avg === null ? <span className="muted">—</span> : x.avg + '%'}</td>
                <td className="muted small-text">{x.last ? new Date(x.last).toLocaleString() : '—'}</td>
                <td><div className="row" style={{ flexWrap: 'nowrap', gap: 8 }}>
                  <Link className="btn outline small" to={'/admin/students/' + x.roll}>View profile</Link>
                  <button className="outline small" onClick={() => toggle(x.roll)} aria-expanded={open === x.roll}>{open === x.roll ? 'Hide history' : 'View history'}</button>
                  <button className="danger" disabled={busy} onClick={() => remove(x)}>Delete</button>
                </div></td>
              </tr>
              {open === x.roll && (
                <tr style={{ background: 'transparent' }}><td colSpan={8} style={{ whiteSpace: 'normal', padding: 16 }}>
                  {/* width:0 + min-width:100% stops the nested table from widening the outer one; it scrolls in its own box. */}
                  <div className="nested-in">
                    <h3>Quiz history of {x.name}</h3>
                    {results.error ? <p className="err">{results.error}</p> : !results.data ? <Loading /> : <ResultsTable rows={x.results} showPaper pageSize={10} {...retakes.tableProps} />}
                  </div>
                </td></tr>
              )}
            </Fragment>))}</tbody>
          </table></div>
          <Pagination {...pg} />
        </>)}
    </div>
  </>);
}
