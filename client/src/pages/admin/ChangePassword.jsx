import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import PasswordField from '../../components/PasswordField';
import Icon from '../../components/Icon';
import { useToast } from '../../components/Feedback';
import api from '../../utils/api';
import load from '../../utils/load';

export default function ChangePassword() {
  const session = load('qr_admin', null, sessionStorage);
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [fieldErrors, setFieldErrors] = useState({});
  const [loading, setLoading] = useState(false);

  if (!session) return <Navigate to="/admin-login" replace />;
  if (session.isSuper) return <Navigate to="/admin/settings" replace />;

  const setField = (field, value) => {
    setForm(f => ({ ...f, [field]: value }));
    setFieldErrors(e => ({ ...e, [field]: '' }));
  };

  const requirements = [
    { label: 'At least 6 characters', met: form.newPassword.length >= 6 },
    { label: 'At least 1 uppercase letter', met: /[A-Z]/.test(form.newPassword) },
    { label: 'At least 1 number', met: /[0-9]/.test(form.newPassword) },
    { label: 'At least 1 special character', met: /[^A-Za-z0-9\s]/.test(form.newPassword) }
  ];
  const passwordStrong = requirements.every(requirement => requirement.met);

  const validate = () => {
    const errors = {};
    if (!form.currentPassword) errors.currentPassword = 'Enter your current password.';
    if (!form.newPassword) errors.newPassword = 'Enter a new password.';
    else if (!passwordStrong) errors.newPassword = 'New password does not meet all password requirements.';
    if (!form.confirmPassword) errors.confirmPassword = 'Confirm your new password.';
    else if (form.newPassword !== form.confirmPassword) errors.confirmPassword = 'New passwords do not match.';
    if (form.currentPassword && form.newPassword && form.currentPassword === form.newPassword) {
      errors.newPassword = 'New password must be different from your current password.';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const submit = async event => {
    event.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      const data = await api('/admin/teachers/change-password', { method: 'POST', body: form });
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      toast.ok(data.message || 'Password changed successfully.');
    } catch (error) {
      toast.bad(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <PageHeader title="Change Password" subtitle="Update the password for your teacher account." />
      <div className="change-password-wrap">
        <form className="card change-password-card" onSubmit={submit} noValidate>
          <div className="card-head">
            <h2><span className="hicon"><Icon name="key" size={16} /></span>Password &amp; Security</h2>
          </div>
          <p className="muted change-password-intro">Use at least 6 characters with an uppercase letter, number and special character.</p>

          <label className="field" htmlFor="current-password">Current Password</label>
          <PasswordField id="current-password" value={form.currentPassword} onChange={e => setField('currentPassword', e.target.value)} placeholder="Enter current password" autoComplete="current-password" />
          {fieldErrors.currentPassword && <p className="err field-error" role="alert">{fieldErrors.currentPassword}</p>}

          <label className="field" htmlFor="new-password">New Password</label>
          <PasswordField id="new-password" value={form.newPassword} onChange={e => setField('newPassword', e.target.value)} placeholder="Enter new password" autoComplete="new-password" />
          {fieldErrors.newPassword && <p className="err field-error" role="alert">{fieldErrors.newPassword}</p>}
          <div className="password-requirements" aria-live="polite">
            <b>Password Requirements</b>
            <ul>
              {requirements.map(requirement => (
                <li key={requirement.label} className={requirement.met ? 'met' : 'unmet'}>
                  <span className="requirement-icon" aria-hidden="true">{requirement.met ? '✓' : '✗'}</span>
                  <span>{requirement.label}</span>
                </li>
              ))}
            </ul>
          </div>

          <label className="field" htmlFor="confirm-password">Confirm New Password</label>
          <PasswordField id="confirm-password" value={form.confirmPassword} onChange={e => setField('confirmPassword', e.target.value)} placeholder="Confirm new password" autoComplete="new-password" />
          {fieldErrors.confirmPassword && <p className="err field-error" role="alert">{fieldErrors.confirmPassword}</p>}

          <div className="change-password-actions">
            <button type="button" className="ghost" onClick={() => navigate('/admin/settings')} disabled={loading}>Cancel</button>
            <button type="submit" disabled={loading}>
              {loading ? <><span className="spinner" />Changing...</> : <><Icon name="key" size={16} />Change Password</>}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
