import load from './load';

// Download a PDF (or any binary) from the deployed API, not from the client origin.
// Shared by every PDF button — student, teacher and owner.
export default async function downloadFile(path, filename, storeKey = 'qr_admin') {
  const s = load(storeKey, null, sessionStorage);
  const configuredUrl = String(import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
  const apiRoot = configuredUrl
    ? (configuredUrl.endsWith('/api') ? configuredUrl : configuredUrl + '/api')
    : '/api';
  const normalizedPath = path.startsWith('/') ? path : '/' + path;

  let res;
  try {
    res = await fetch(apiRoot + normalizedPath, {
      headers: s?.token ? { Authorization: 'Bearer ' + s.token } : {}
    });
  } catch {
    throw new Error('Could not reach the report server. Check your connection and try again.');
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let message = 'Failed to generate the PDF.';
    try {
      const data = body ? JSON.parse(body) : {};
      if (data.error) message = data.error;
    } catch {
      if (res.status === 404) message = 'The PDF endpoint was not found.';
    }
    throw new Error(message);
  }

  const contentType = (res.headers.get('content-type') || '').toLower();
  if (!contentType.includes('application/pdf')) {
    throw new Error('The server did not return a PDF. Please try again.');
  }

  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const header = String.fromCharCode(...bytes.slice(0, 5));
  if (header !== '%PDF-') {
    throw new Error('The downloaded report is not a valid PDF.');
  }

  const blob = new Blob([buffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
