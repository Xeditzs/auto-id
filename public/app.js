'use strict';
const app = document.querySelector('#app');
const dialog = document.querySelector('#dialog');
const toast = document.querySelector('#toast');
const symbols = {
  logo: 'M4 8V5a1 1 0 0 1 1-1h3m8 0h3a1 1 0 0 1 1 1v3m0 8v3a1 1 0 0 1-1 1h-3m-8 0H5a1 1 0 0 1-1-1v-3M8 15l2.5-6h3l2.5 6M9 13h6',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  car: 'M5 17v3m14-3v3M3 13l2-6a2 2 0 0 1 2-1h10a2 2 0 0 1 2 1l2 6v4H3zM3 12h18M7 15h1m8 0h1',
  file: 'M7 3h7l4 4v14H6V3zm6 0v5h5M9 12h6m-6 4h6',
  wrench: 'M14 6a5 5 0 0 0-6 6L3 17a2.8 2.8 0 0 0 4 4l5-5a5 5 0 0 0 6-6l-3 3-3-3 3-4z',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0',
  qr: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM6 6h1m10 0h1M6 17h1m7-3h3v3h4v4h-3m-4-3v3',
  scan: 'M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4M4 12h16',
  plus: 'M12 5v14M5 12h14',
  arrow: 'M4 12h15m-6-6 6 6-6 6',
  gauge: 'M4 18a9 9 0 1 1 16 0H4zm8-3 4-5',
  shield: 'M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11zm-3-10 2 2 4-4',
  check: 'm5 12 4 4L19 6',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4v5l3 2',
  warn: 'M12 3 2 21h20L12 3zm0 6v5m0 3h.01',
  logout: 'M10 3H4v18h6m4-14 5 5-5 5m-6-5h11',
  close: 'm6 6 12 12M6 18 18 6',
  printer: 'M6 8V3h12v5M6 17H3V8h18v9h-3M6 14h12v7H6zM6 11h1',
  link: 'M10 13a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-2 2m2 6a4 4 0 0 0-6 0l-4 4a4 4 0 0 0 6 6l2-2',
  refresh: 'M20 8a8 8 0 1 0 0 8m0-13v5h-5',
  camera: 'M3 7h5l2-3h4l2 3h5v13H3zm9 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'
};
const icon = (name, size = 20) => `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="${symbols[name]}"/></svg>`;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const km = value => Number(value).toLocaleString('en-IN');
const dateLabel = date => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(date));
const brand = `<a class="brand" href="/" aria-label="AutoID home"><span>${icon('logo', 23)}</span>Auto<span class="brand-id">ID</span></a>`;
const button = (label, action, glyph, style = 'secondary') => `<button type="button" class="btn ${style}" data-action="${action}">${glyph ? icon(glyph, 17) : ''}${label}</button>`;
const heading = (title, sub, actions = '') => `<div class="heading"><div><h1>${title}</h1><p>${sub}</p></div><div class="actions">${actions}</div></div>`;
const empty = (glyph, title, description, actions = '') => `<div class="empty panel"><div class="tile">${icon(glyph, 24)}</div><h2>${title}</h2><p>${description}</p>${actions}</div>`;
const input = (label, name, options = '') => `<label>${label}<input name="${name}" ${options} required></label>`;
const nav = [
  ['overview', 'grid', 'Overview'], ['garage', 'car', 'My garage'], ['documents', 'file', 'Documents'],
  ['service', 'wrench', 'Service'], ['inbox', 'bell', 'Inbox'], ['identity', 'qr', 'QR identity']
];
let inboxItems = [], inboxCursor, emergencyOnly = false;
let state, page = 'overview', vehicleId, demoEnabled = false, signUp = false, recovering = false, toastTimer, cameraStream, cameraRun = 0;
const active = () => state.vehicles.find(vehicle => vehicle.id === vehicleId) || state.vehicles[0];

async function api(path, body) {
  let response;
  try {
    response = await fetch('/api' + path, body === undefined ? undefined : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
  } catch {
    throw new Error('Could not reach AutoID. Check that the server is running and try again.');
  }
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || 'The request failed.');
    error.status = response.status;
    throw error;
  }
  return result;
}
function message(text) {
  clearTimeout(toastTimer);
  toast.textContent = text;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 4500);
}
function renderAuth() {
  if (recovering) {
    simple(heading('Reset password', 'Use the recovery code you saved from Session controls.') +
      `<section class="panel public-card"><form data-form="recover">
      ${input('Email address', 'email', 'type="email" autocomplete="email"')}
      ${input('Recovery code', 'code', 'minlength="32" maxlength="32" autocomplete="off"')}
      ${input('New password', 'password', 'type="password" minlength="10" maxlength="128" autocomplete="new-password"')}
      <p class="form-error" role="alert" hidden></p><div class="actions"><button class="btn primary">Reset password</button>
      ${button('Back to sign in', 'toggle-recovery')}</div></form></section>`);
    return;
  }
  app.innerHTML = `<div class="auth-shell"><header class="simple-header">${brand}<a class="btn secondary" href="/scan">${icon('scan', 17)} Scan a QR</a></header>
    <main id="main" class="auth-main"><section class="auth-hero"><div><h1>Your vehicle,<br>all in one place.</h1><p>Manage documents and service, share a QR identity, and receive private vehicle alerts.</p></div><div class="auth-art" role="img" aria-label="Dark blue SUV illustration"></div></section>
    <section class="auth-form panel"><div class="tile">${icon('shield', 24)}</div><h2>${signUp ? 'Create an account' : 'Sign in to AutoID'}</h2><p>${signUp ? 'Set up your private vehicle dashboard.' : 'Open your vehicle dashboard.'}</p>
    <form data-form="${signUp ? 'register' : 'login'}">
    ${signUp ? input('Your name', 'name', 'autocomplete="name" maxlength="70"') : ''}
    ${input('Email address', 'email', 'type="email" autocomplete="email" maxlength="254" placeholder="you@example.com"')}
    ${input('Password', 'password', `type="password" autocomplete="${signUp ? 'new-password' : 'current-password'}" minlength="10" maxlength="128" placeholder="At least 10 characters"`)}
    <p class="form-error" role="alert" hidden></p><button class="btn primary wide">${signUp ? 'Create account' : 'Sign in'}</button>
    </form>${signUp ? '' : '<button class="text-btn switch" data-action="toggle-recovery">Reset with a recovery code</button>'}<p class="switch">${signUp ? 'Already registered?' : 'New to AutoID?'} <button class="text-btn" data-action="toggle-auth">${signUp ? 'Sign in' : 'Create an account'}</button></p>
    ${demoEnabled ? `<div class="auth-divider"></div>${button('Open sample garage', 'demo', 'arrow', 'secondary wide')}` : ''}</section></main></div>`;
}
function sidebar() {
  const initials = state.user.name.split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
  return `<aside class="sidebar">${brand}<nav aria-label="Dashboard" class="nav">${nav.map(([key, glyph, title]) =>
    `<button data-action="nav:${key}" ${page === key ? 'aria-current="page"' : ''}>${icon(glyph, 19)}<span>${title}</span>${key === 'inbox' && state.unread ? `<b class="count">${state.unread}</b>` : ''}</button>`).join('')}</nav>
    <div class="sidebar-bottom"><a class="scan-link" href="/scan">${icon('scan', 19)} Scan a QR ${icon('arrow', 15)}</a>
    <div class="account"><span class="avatar">${escapeHtml(initials)}</span><div><strong>${escapeHtml(state.user.name)}</strong><small>${state.user.email.endsWith('@autoid.invalid') ? 'Sample garage' : 'Vehicle owner'}</small></div><button class="icon-btn" data-action="logout" aria-label="Sign out" title="Sign out">${icon('logout', 17)}</button></div></div></aside>`;
}
function renderDashboard() {
  const vehicle = active();
  const currentNav = nav.find(item => item[0] === page);
  const selector = state.vehicles.length > 1 ? `<select id="vehicle-select" aria-label="Active vehicle">${state.vehicles.map(item => `<option value="${item.id}" ${vehicle.id === item.id ? 'selected' : ''}>${escapeHtml(item.name)} · ${escapeHtml(item.plate)}</option>`).join('')}</select>` : '';
  app.innerHTML = `<div class="shell">${sidebar()}<div class="workspace">
  <header class="topbar"><span class="breadcrumb">Garage <span> / </span><strong>${currentNav[2]}</strong></span><div class="top-actions">${selector}<button class="icon-btn" data-action="sessions" aria-label="Session controls" title="Session controls">${icon('shield', 19)}</button>
  <button class="icon-btn top-bell" data-action="nav:inbox" aria-label="Inbox, ${state.unread} unread">${icon('bell', 20)}${state.unread ? '<i></i>' : ''}</button></div></header>
  <main id="main" class="main" tabindex="-1">${vehicle ? views[page](vehicle) : heading(currentNav[2], 'Your vehicle workspace.', button('Add vehicle', 'add', 'plus', 'primary')) + empty('car', 'Your garage is empty', 'Add a vehicle to create a QR identity and start tracking care.', button('Add your first vehicle', 'add', 'plus', 'primary'))}</main>
  <footer class="footer"><span>AutoID</span><span>Owner-maintained vehicle records</span></footer></div></div>`;
}
const pill = status => `<span class="pill ${['Current', 'On track', 'Active'].includes(status) ? 'green' : ['Due soon', 'Missing', 'Inactive'].includes(status) ? 'amber' : 'red'}"><i></i>${status}</span>`;
function entry(notification) {
  const glyph = ['parking', 'emergency'].includes(notification.kind) ? 'warn' : notification.kind === 'service' ? 'wrench' : 'file';
  return `<article class="entry"><div class="tile ${notification.kind === 'emergency' ? 'red' : glyph === 'warn' ? 'amber' : ''}">${icon(glyph, 18)}</div>
    <div class="entry-copy"><strong>${escapeHtml(notification.title)}${notification.seen ? '' : '<i class="unread-dot" aria-label="Unread"></i>'}</strong>
    <p>${escapeHtml(notification.body)}</p><small>${escapeHtml(notification.vehicle)} · ${dateLabel(Number(notification.created))}</small></div>
    ${notification.seen ? '' : `<button class="icon-btn" title="Mark as read" aria-label="Mark ${escapeHtml(notification.title)} as read" data-action="read:${notification.id}">${icon('check', 18)}</button>`}</article>`;
}
function cardHeader(title, description, action = '') {
  return `<div class="card-header"><div><h2>${title}</h2>${description ? `<p>${description}</p>` : ''}</div>${action}</div>`;
}
function stat(glyph, color, label, value, note) {
  return `<div class="panel stat"><span class="tile ${color}">${icon(glyph, 19)}</span><div><p>${label}</p><strong>${value}</strong><small>${note}</small></div></div>`;
}
const serviceNote = vehicle => vehicle.service.remaining > 0
  ? `${km(vehicle.service.remaining)} km to service`
  : vehicle.service.remaining === 0 ? 'Service due now' : `${km(-vehicle.service.remaining)} km past due`;
const profilePath = vehicle => '/p/' + vehicle.qr;
const views = {
  overview(vehicle) {
    const first = escapeHtml(state.user.name.split(/\s+/)[0]);
    const next = vehicle.checks.filter(check => check.remaining !== null).sort((a, b) => a.remaining - b.remaining)[0];
    return heading(`Welcome back, ${first}`, 'Here’s what’s happening with your vehicle today.', button('Add vehicle', 'add', 'plus', 'primary')) +
      `<section class="hero"><div class="hero-copy"><div class="hero-label">${icon('car', 16)} ACTIVE VEHICLE</div><h2>${escapeHtml(vehicle.name)}</h2><div class="vehicle-meta"><span class="plate">${escapeHtml(vehicle.plate)}</span><span>${vehicle.model_year} model</span></div>
      ${button('View QR identity', 'nav:identity', 'qr', 'primary')}</div><div class="hero-art" aria-hidden="true"></div></section>
      <div class="stats">
      ${stat('gauge', '', 'Odometer', `${km(vehicle.odometer)} <em>km</em>`, serviceNote(vehicle))}
      ${stat('file', 'amber', 'Next document expiry', next ? (next.remaining < 0 ? 'Expired' : next.remaining === 0 ? 'Today' : `${next.remaining} <em>days</em>`) : 'No records', next?.label || 'Add a document to track expiry')}
      ${stat('bell', 'green', 'Unread notifications', state.unread, state.unread ? 'Check your private inbox' : 'You’re all caught up')}
      </div>
      <div class="overview-grid"><section class="panel health">${cardHeader('Vehicle Care Score', 'Based on your documents and service schedule.')}
      <div class="score-block"><div class="score-ring"><svg viewBox="0 0 104 104" aria-hidden="true"><circle cx="52" cy="52" r="46" stroke="#eeeafe"/><circle cx="52" cy="52" r="46" stroke="#6648e7" pathLength="100" stroke-dasharray="${vehicle.score} 100"/></svg><div><strong>${vehicle.score}</strong><small>/ 100</small></div></div>
      <div class="score-detail"><div><span>Documents</span><b>${vehicle.score - vehicle.service.points} / 60</b></div><progress aria-label="Document score" value="${vehicle.score - vehicle.service.points}" max="60"></progress><div><span>Service</span><b>${vehicle.service.points} / 40</b></div><progress aria-label="Service score" value="${vehicle.service.points}" max="40"></progress></div></div>
      <button class="text-btn score-link" data-action="rubric">How the score works ${icon('arrow', 15)}</button></section>
      <section class="panel activity">${cardHeader('Recent activity', 'Reminders and reports for your garage.', button('View inbox', 'nav:inbox'))}
      ${state.notifications.length ? state.notifications.slice(0, 3).map(entry).join('') : '<p class="muted">No activity yet.</p>'}</section></div>`;
  },
  garage() {
    return heading('My garage', 'Register vehicles and choose which one to manage.', button('Add vehicle', 'add', 'plus', 'primary')) +
      `<div class="garage-grid">${state.vehicles.map(vehicle => `<section class="panel garage-card"><div class="garage-art"></div><div class="garage-info"><div class="row"><h2>${escapeHtml(vehicle.name)}</h2>${vehicle.id === active().id ? pill('Active') : ''}</div><div class="vehicle-meta"><span class="plate">${escapeHtml(vehicle.plate)}</span><span>${vehicle.model_year} · ${km(vehicle.odometer)} km</span></div>${button('Open dashboard', `select:${vehicle.id}`, 'arrow')}</div></section>`).join('')}</div>`;
  },
  documents(vehicle) {
    const rows = [...vehicle.checks, { type: 'other', label: 'Other document' }];
    return heading('Documents', `Private records and PDFs for ${escapeHtml(vehicle.name)}.`, button('Add or upload', 'upload', 'plus', 'primary')) +
      `<section class="panel stack">${rows.map(check => {
        const doc = vehicle.documents.find(item => item.type === check.type);
        const file = vehicle.files.find(item => item.type === check.type);
        return `<article class="entry doc-entry"><div class="tile">${icon('file')}</div><div class="entry-copy"><strong>${check.label}</strong>
        <p>${doc ? `${escapeHtml(doc.reference)} · Expires ${dateLabel(doc.expiry)}` : check.type === 'other' ? 'Optional attachment' : 'Add a reference and expiry date.'}</p>
        ${file ? `<p>${escapeHtml(file.name)}</p>` : ''}</div>
        ${check.status ? pill(check.status) : ''}
        <div class="actions">${file ? `<a class="btn secondary" href="/api/vehicles/${vehicle.id}/files/${check.type}">Download PDF</a>
          ${button('Remove PDF', 'remove-pdf:' + check.type, '', 'danger')}` : ''}
        ${button(file ? 'Replace PDF' : 'Upload PDF', 'upload:' + check.type)}
        ${check.status ? button(doc ? 'Update details' : 'Add details', 'document:' + check.type) : ''}</div></article>`;
      }).join('')}</section><div class="callout">${icon('shield', 19)} PDFs are private. The expiry dates you confirm drive your reminders.</div>`;
  },
  service(vehicle) {
    const target = vehicle.last_service_km + vehicle.interval_km;
    return heading('Service', `Mileage and maintenance schedule for ${escapeHtml(vehicle.name)}.`, button('Update mileage', 'mileage', 'gauge', 'primary')) +
      `<div class="stats">${stat('gauge', '', 'Current odometer', `${km(vehicle.odometer)} <em>km</em>`, 'Owner-entered reading')}
      ${stat('wrench', 'green', 'Last service', `${km(vehicle.last_service_km)} <em>km</em>`, `Every ${km(vehicle.interval_km)} km`)}
      ${stat('clock', 'amber', 'Next service threshold', `${km(target)} <em>km</em>`, serviceNote(vehicle))}</div>
      <section class="panel stack service-panel">${cardHeader('Service schedule', 'The next threshold is the last service reading plus your interval.', pill(vehicle.service.status))}
      <progress aria-label="Mileage since last service" value="${Math.min(vehicle.interval_km, vehicle.odometer - vehicle.last_service_km)}" max="${vehicle.interval_km}"></progress>
      <div class="row service-foot"><span>${km(vehicle.odometer - vehicle.last_service_km)} km since last service</span>${button('Log completed service', 'log-service', 'check')}</div></section>
      <section class="panel stack service-panel">${cardHeader('Service history', 'Latest 20 service records.')}
      ${vehicle.serviceHistory.length ? `<ul class="rubric">${vehicle.serviceHistory.map(event => `<li><span>${dateLabel(event.serviced_on)}</span><strong>${km(event.mileage)} km</strong></li>`).join('')}</ul>`
        : '<p class="muted">No dated service entries yet. The schedule uses the last-service mileage you entered.</p>'}</section>`;
  },
  inbox() {
    return heading('Inbox', `${state.unread} unread · Vehicle reminders and private reports.`,
      button(emergencyOnly ? 'Show all reports' : 'Emergency only', 'filter-inbox', 'warn') +
      button('Refresh', 'refresh', 'refresh') + (state.unread ? button('Mark all read', 'read:all', 'check') : '')) +
      (inboxItems.length ? `<section class="panel stack inbox-stack">${inboxItems.map(entry).join('')}</section>`
        : empty('bell', emergencyOnly ? 'No emergency reports' : 'You’re all caught up', 'New reports and reminders appear here.')) +
      (inboxCursor ? `<div class="inbox-more">${button('Load older messages', 'inbox-more')}</div>` : '');
  },
  identity(vehicle) {
    const url = vehicle.qr ? state.origin + profilePath(vehicle) : '';
    return heading('QR identity', `Manage the public sticker for ${escapeHtml(vehicle.name)}.`) +
      `<div class="identity-grid"><section class="panel sticker" id="print-sticker">${brand}
      ${vehicle.qr ? `<img width="240" height="240" alt="QR code for this vehicle’s public profile" src="/api/vehicles/${vehicle.id}/qr.png?v=${vehicle.qr}"><h2>${escapeHtml(vehicle.name)}</h2><p>Scan to send the owner a private report.</p>` :
        '<div class="sticker-off"><h2>QR inactive</h2><p>Generate a new QR to reactivate the public profile.</p></div>'}</section>
      <section class="panel identity-info">${cardHeader('Public vehicle link', 'Visitors can see the make, model and year, and send a report.', pill(vehicle.qr ? 'Active' : 'Inactive'))}
      ${vehicle.qr ? `<label>Sticker URL<input readonly value="${escapeHtml(url)}"></label>
      <div class="actions"><a class="btn secondary" target="_blank" rel="noopener" href="${profilePath(vehicle)}">${icon('link', 16)} Open profile</a>${button('Print sticker', 'print', 'printer', 'primary')}</div>` : ''}
      <hr><h3>Access controls</h3><p>Revoking or replacing a QR disables its old public link. Print a new sticker after generating a new link.</p>
      <div class="actions">${vehicle.qr ? button('Revoke QR', 'qr:revoke', '', 'danger') : ''}${button(vehicle.qr ? 'Replace QR' : 'Generate QR', 'qr:replace', 'refresh')}</div>
      ${state.origin.startsWith('http://localhost:') ? '<p class="notice">This sticker uses localhost. Use the README’s phone demo steps before printing for another device.</p>' : ''}</section></div>`;
  }
};
function openDialog(title, content) {
  dialog.innerHTML = `<div class="dialog-top"><h2 id="dialog-title">${title}</h2><button class="icon-btn" data-action="close" aria-label="Close dialog">${icon('close')}</button></div>${content}`;
  dialog.showModal();
}
function formDialog(title, action, content, submit = 'Save changes') {
  openDialog(title, `<form data-form="${action}">${content}<p class="form-error" role="alert" hidden></p><div class="actions dialog-actions">${button('Cancel', 'close')}<button class="btn primary">${submit}</button></div></form>`);
}
function vehicleForm() {
  const maxYear = new Date(state.today).getUTCFullYear() + 1;
  formDialog('Add a vehicle', 'add', input('Make and model', 'name', 'placeholder="e.g. Hyundai Creta" maxlength="70"') +
    `<div class="form-row">${input('Registration plate', 'plate', 'maxlength="18" minlength="3" placeholder="KA 01 AB 2408"')}
    ${input('Model year', 'model_year', `type="number" min="1950" max="${maxYear}" value="${maxYear - 1}"`)}</div>
    ${input('Current odometer (km)', 'odometer', 'type="number" min="0" max="2000000" value="0"')}
    <div class="form-row">${input('Last service odometer (km)', 'last_service_km', 'type="number" min="0" max="2000000" value="0"')}
    ${input('Service interval (km)', 'interval_km', 'type="number" min="100" max="100000" value="5000"')}</div>
    <p class="muted">Use your maintenance schedule to choose an interval. For a new vehicle, enter 0 for last service.</p>`, 'Add vehicle');
}
function careForm(vehicle, completed) {
  formDialog(completed ? 'Log completed service' : 'Update mileage', 'care',
    input('Current odometer (km)', 'odometer', `type="number" min="${vehicle.odometer}" max="2000000" value="${vehicle.odometer}"`) +
    input('Last service odometer (km)', 'last_service_km', `type="number" min="0" max="2000000" value="${completed ? vehicle.odometer : vehicle.last_service_km}"`) +
    input('Service interval (km)', 'interval_km', `type="number" min="100" max="100000" value="${vehicle.interval_km}"`) +
    (completed ? input('Service date', 'serviced_on', `type="date" max="${state.today}" value="${state.today}"`) : ''));
}
function documentForm(vehicle, type) {
  const item = vehicle.documents.find(doc => doc.type === type);
  const check = vehicle.checks.find(check => check.type === type);
  formDialog(check.label, 'document', `<input type="hidden" name="type" value="${type}">` +
    input('Document reference', 'reference', `maxlength="100" value="${escapeHtml(item?.reference)}"`) +
    input('Expiry date', 'expiry', `type="date" min="1900-01-01" max="2199-12-31" value="${escapeHtml(item?.expiry)}"`));
}
function uploadForm(vehicle, type) {
  const types = [...vehicle.checks, { type: 'other', label: 'Other document' }];
  formDialog('Add or upload a PDF', 'upload-pdf',
    `<label>Document type<select name="type">${types.map(item => `<option value="${item.type}" ${item.type === type ? 'selected' : ''}>${item.label}</option>`).join('')}</select></label>
    <label>PDF file<input name="pdf" type="file" accept=".pdf,application/pdf" required></label>
    <div id="upload-details" class="upload-details">${input('Document reference', 'reference', 'maxlength="100"')}
    ${input('Expiry date', 'expiry', 'type="date" min="1900-01-01" max="2199-12-31"')}</div>
    <p class="muted">Choose a PDF up to 2 MB. Saving replaces the current PDF for the selected type.</p>`, 'Save PDF');
  syncUploadDetails(dialog.querySelector('form'), vehicle);
}
function syncUploadDetails(form, vehicle) {
  const type = form.elements.type.value;
  const doc = vehicle.documents.find(item => item.type === type);
  form.querySelector('#upload-details').hidden = type === 'other';
  for (const key of ['reference', 'expiry']) {
    form.elements[key].disabled = type === 'other';
    form.elements[key].value = doc?.[key] || '';
  }
}
function base64File(file) {
  if (!file?.size || file.size > 2 * 1024 * 1024) throw new Error('Choose a PDF up to 2 MB.');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('Could not read the PDF. Choose it again.'));
    reader.readAsDataURL(file);
  });
}
function rubric(vehicle) {
  openDialog('How the score works', `<p class="muted">AutoID adds four checks for a total of 100 points. The score reflects owner-entered records.</p>
  <ul class="rubric">${[...vehicle.checks, vehicle.service].map(check => `<li><span>${check.label}<small>${check.status}</small></span><strong>${check.points} / ${check.max}</strong></li>`).join('')}</ul>
  <p><strong>Documents · 60 points</strong><br>Each record earns 20 points with more than 30 days remaining, 10 from today through 30 days, and 0 when missing or expired. Dates use UTC.</p>
  <p><strong>Service · 40 points</strong><br>Earn 40 points with more than 500 km remaining, 20 with 1–500 km remaining, and 0 once due.</p>
  <p class="muted">This is a care planning score based on your entries. Confirm maintenance and documents with your provider.</p>`);
}
function simple(content) {
  app.innerHTML = `<div class="public-shell"><header class="simple-header">${brand}<a class="btn secondary" href="/scan">${icon('scan', 17)} Scan a QR</a></header><main id="main" class="public-main">${content}</main></div>`;
}
async function renderPublic(key) {
  simple(empty('qr', 'Opening vehicle profile', 'Checking the public vehicle link.'));
  try {
    const vehicle = await api('/p/' + key);
    simple(`<div class="public-banner"><div class="tile">${icon('car', 24)}</div><h1>${escapeHtml(vehicle.name)}</h1><p>${vehicle.model_year} model · Owner-maintained profile</p></div>
      <section class="panel public-card">${cardHeader('Send a private report', 'Your message goes to the vehicle owner’s AutoID inbox.')}
      <form data-form="report" data-key="${key}"><label>Report type<select name="kind"><option value="parking">Parking issue</option><option value="emergency">Emergency concern</option></select></label>
      <label>Message<textarea name="message" placeholder="Describe what happened and where the vehicle is." required minlength="5" maxlength="400" rows="4"></textarea></label>
      <p class="muted">Keep personal contact details out of the message. If there is immediate danger, contact local emergency services directly.</p>
      <p class="form-error" role="alert" hidden></p><button class="btn primary wide">Send to owner ${icon('arrow', 17)}</button></form></section>`);
  } catch (error) {
    simple(empty('qr', 'Vehicle profile unavailable', escapeHtml(error.message), '<a class="btn secondary" href="/scan">Scan another QR</a>'));
  }
}
function renderScanner() {
  simple(heading('Scan a vehicle QR', 'Open an AutoID public profile from a sticker.') +
    `<section class="panel public-card scanner-card"><div id="scan-view" class="scan-view"><div class="scan-placeholder">${icon('scan', 56)}<span>Camera preview</span></div><video muted playsinline hidden></video></div>
    <div class="actions">${button('Start camera', 'camera', 'camera', 'primary')}${button('Stop camera', 'stop-camera')}
    <label class="btn secondary file-button">Choose QR image<input id="qr-file" type="file" accept="image/*" aria-label="Choose QR image"></label></div>
    <p id="scan-status" class="muted" role="status">Camera access needs permission and an HTTPS or localhost address.</p>
    <form data-form="open-qr">${input('Or paste the sticker URL', 'url', 'maxlength="2048" placeholder="https://…/p/…"')}
    <p class="form-error" role="alert" hidden></p><button class="btn secondary">Open profile ${icon('arrow', 17)}</button></form></section>`);
}
function stopCamera() {
  cameraRun++;
  cameraStream?.getTracks().forEach(track => track.stop());
  cameraStream = null;
  const video = app.querySelector('video');
  if (video) {
    video.srcObject = null;
    video.hidden = true;
    app.querySelector('.scan-placeholder').hidden = false;
  }
}
function profileFromQR(value) {
  let url;
  try { url = new URL(value.trim(), location.origin); } catch { throw new Error('Enter a valid AutoID sticker URL.'); }
  if (url.origin !== location.origin || !/^\/p\/[\w-]{32}$/.test(url.pathname)) {
    throw new Error('This QR is not from this AutoID address. Open the sticker link in your browser.');
  }
  return url.pathname;
}
function readFrame(source, width, height, canvas) {
  const scale = Math.min(1, 900 / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return window.jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)?.data;
}
async function startCamera() {
  const status = document.querySelector('#scan-status');
  stopCamera();
  const run = cameraRun;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access requires HTTPS or localhost. You can choose a QR image or paste its URL.');
    if (!window.jsQR) throw new Error('The QR decoder could not load. Reload the page and try again.');
    status.textContent = 'Waiting for camera permission…';
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    if (run !== cameraRun) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    cameraStream = stream;
    const video = app.querySelector('video');
    video.srcObject = stream;
    await video.play();
    if (run !== cameraRun) return;
    video.hidden = false;
    app.querySelector('.scan-placeholder').hidden = true;
    status.textContent = 'Hold the QR code in front of the camera.';
    const canvas = document.createElement('canvas');
    function tick() {
      if (run !== cameraRun) return;
      try {
        if (video.videoWidth && video.readyState >= 2) {
          const found = readFrame(video, video.videoWidth, video.videoHeight, canvas);
          if (found) {
            const path = profileFromQR(found);
            stopCamera();
            location.assign(path);
            return;
          }
        }
        setTimeout(tick, 140);
      } catch (error) {
        stopCamera();
        status.textContent = error.message;
      }
    }
    tick();
  } catch (error) {
    if (run !== cameraRun) return;
    stopCamera();
    status.textContent = error.name === 'NotAllowedError' ? 'Camera permission was denied. Allow access or use the QR image option.'
      : ['NotFoundError', 'NotReadableError', 'AbortError'].includes(error.name) ? 'Camera unavailable. Try again or use a QR image.' : error.message;
  }
}
async function scanImage(file) {
  if (!file) return;
  const status = document.querySelector('#scan-status');
  try {
    stopCamera();
    if (!window.jsQR) throw new Error('The QR decoder could not load. Reload the page and try again.');
    if (file.size > 12 * 1024 * 1024) throw new Error('Choose an image smaller than 12 MB.');
    const bitmap = await createImageBitmap(file).catch(() => { throw new Error('Could not open that image. Try a PNG or JPEG.'); });
    let found;
    try { found = readFrame(bitmap, bitmap.width, bitmap.height, document.createElement('canvas')); }
    finally { bitmap.close(); }
    if (!found) throw new Error('No QR found. Choose a sharp image with the entire QR visible.');
    location.assign(profileFromQR(found));
  } catch (error) { status.textContent = error.message; }
}

async function reload() {
  const next = await api('/dashboard');
  if (page === 'inbox') {
    const inbox = await api('/inbox?emergency=' + emergencyOnly);
    inboxItems = inbox.items;
    inboxCursor = inbox.next;
  }
  state = next;
  renderDashboard();
}
async function signedIn() {
  vehicleId = undefined;
  page = 'overview';
  await reload();
}
function handleError(error) {
  if (error.status === 401 && state) {
    dialog.close();
    state = undefined;
    renderAuth();
    message('Your session ended. Sign in again.');
  } else message(error.message);
}
async function actionHandler(action) {
  const [name, arg] = action.split(':');
  if (name === 'toggle-recovery') { recovering = !recovering; signUp = false; renderAuth(); return; }
  if (name === 'toggle-auth') { signUp = !signUp; renderAuth(); return; }
  if (name === 'demo') { await api('/demo', {}); await signedIn(); return; }
  if (name === 'camera') { await startCamera(); return; }
  if (name === 'stop-camera') { stopCamera(); document.querySelector('#scan-status').textContent = 'Camera stopped.'; return; }
  if (name === 'close') { dialog.close(); return; }
  if (!state) return;
  const vehicle = active();
  if (name === 'nav') {
    page = arg;
    if (page === 'inbox') await reload();
    else renderDashboard();
    window.scrollTo(0, 0);
    document.querySelector('#main').focus({ preventScroll: true });
  } else if (name === 'select') {
    vehicleId = Number(arg); page = 'overview'; renderDashboard();
  } else if (name === 'add') vehicleForm();
  else if (name === 'document') documentForm(vehicle, arg);
  else if (name === 'upload') uploadForm(vehicle, arg);
  else if (name === 'remove-pdf') formDialog('Remove this PDF?', 'remove-pdf',
    `<input type="hidden" name="type" value="${arg}"><p class="muted">Your expiry record will remain.</p>`, 'Remove PDF');
  else if (name === 'sessions') {
    openDialog('Session controls', `<p class="muted">Sign out other devices or create a one-time password recovery code.</p>
      <div class="actions">${button('Sign out other devices', 'confirm-sessions', 'logout')}
      ${button('Create recovery code', 'create-recovery', 'shield')}</div>`);
  } else if (name === 'confirm-sessions') {
    dialog.close();
    formDialog('Sign out other devices?', 'sessions', '<p class="muted">This device will stay signed in.</p>', 'Sign out other devices');
  } else if (name === 'create-recovery') {
    dialog.close();
    formDialog('Create recovery code', 'recovery-code', input('Current password', 'password', 'type="password" autocomplete="current-password" minlength="10" maxlength="128"') +
      '<p class="muted">Creating a new code replaces any previous code. Save it somewhere private.</p>', 'Create code');
  } else if (name === 'filter-inbox') {
    emergencyOnly = !emergencyOnly;
    await reload();
  } else if (name === 'inbox-more') {
    const result = await api(`/inbox?before=${inboxCursor}&emergency=${emergencyOnly}`);
    inboxItems.push(...result.items);
    inboxCursor = result.next;
    renderDashboard();
  }
  else if (name === 'mileage' || name === 'log-service') careForm(vehicle, name === 'log-service');
  else if (name === 'rubric') rubric(vehicle);
  else if (name === 'print') {
    const img = document.querySelector('#print-sticker img');
    await img.decode();
    window.print();
  } else if (name === 'qr') {
    formDialog(arg === 'revoke' ? 'Revoke this QR?' : vehicle.qr ? 'Replace this QR?' : 'Generate a new QR?',
      'qr', `<input type="hidden" name="action" value="${arg}"><p class="muted">${vehicle.qr ? 'The current sticker link will stop working immediately.' : 'AutoID will create a new public sticker link.'}</p>`,
      arg === 'revoke' ? 'Revoke QR' : 'Generate new QR');
  } else if (name === 'refresh') { await reload(); message('Inbox refreshed.'); }
  else if (name === 'read') { await api('/notifications/' + arg, {}); await reload(); message('Marked as read.'); }
  else if (name === 'logout') { await api('/logout', {}); state = undefined; signUp = false; renderAuth(); }
}
document.addEventListener('click', async event => {
  const control = event.target.closest('[data-action]');
  if (!control || control.disabled) return;
  control.disabled = true;
  try { await actionHandler(control.dataset.action); } catch (error) { handleError(error); }
  finally { control.disabled = false; }
});
document.addEventListener('change', event => {
  if (event.target.matches('[data-form="upload-pdf"] select[name="type"]')) syncUploadDetails(event.target.form, active());
  if (event.target.id === 'vehicle-select') { vehicleId = Number(event.target.value); renderDashboard(); }
  if (event.target.id === 'qr-file') { scanImage(event.target.files[0]); event.target.value = ''; }
});
document.addEventListener('submit', async event => {
  const form = event.target;
  const action = form.dataset.form;
  if (!action) return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  for (const input of form.querySelectorAll('input[type=number]')) data[input.name] = input.valueAsNumber;
  const submit = form.querySelector('button:not([type=button])');
  const feedback = form.querySelector('.form-error');
  feedback.hidden = true;
  submit.disabled = true;
  try {
    if (action === 'recover') {
      await api('/recover', data);
      recovering = false;
      renderAuth();
      message('Password reset. Sign in with your new password.');
    } else if (action === 'recovery-code') {
      const { code } = await api('/sessions/recovery-code', data);
      dialog.close();
      openDialog('Save your recovery code', `<p class="muted">This one-time code can reset your password. Save it before closing.</p>
        <label>Recovery code<input readonly value="${escapeHtml(code)}"></label>`);
    } else if (action === 'register' || action === 'login') {
      await api('/' + action, data); await signedIn();
    } else if (action === 'report') {
      await api(`/p/${form.dataset.key}/report`, data);
      form.outerHTML = `<div class="callout success" role="status">${icon('check')} Report delivered to the owner’s AutoID inbox.</div>`;
    } else if (action === 'open-qr') location.assign(profileFromQR(data.url));
    else if (['upload-pdf', 'remove-pdf', 'sessions'].includes(action)) {
      const id = active()?.id;
      if (action === 'sessions') await api('/sessions/revoke-others', {});
      else if (action === 'remove-pdf') await api(`/vehicles/${id}/files/${data.type}`, { action: 'remove' });
      else {
        const { pdf, reference, expiry, type } = data;
        await api(`/vehicles/${id}/files/${type}`, { name: pdf.name, content: await base64File(pdf), reference, expiry });
      }
      dialog.close();
      await reload();
      message({ 'upload-pdf': 'PDF saved.', 'remove-pdf': 'PDF removed.', sessions: 'Other devices signed out.' }[action]);
    }
    else {
      const paths = { document: 'documents', care: 'care', qr: 'qr' };
      const result = await api(action === 'add' ? '/vehicles' : `/vehicles/${active().id}/${paths[action]}`, data);
      if (action === 'add') { vehicleId = result.id; page = 'overview'; }
      dialog.close();
      await reload();
      message({ add: 'Vehicle added.', document: 'Document record saved.', care: 'Service schedule updated.', qr: data.action === 'revoke' ? 'QR revoked.' : 'New QR generated.' }[action]);
    }
  } catch (error) {
    if (error.status === 401 && state) handleError(error);
    else if (dialog.contains(form) && !dialog.open) handleError(error);
    else { feedback.textContent = error.message; feedback.hidden = false; }
  } finally { submit.disabled = false; }
});
window.addEventListener('pagehide', stopCamera);
async function start() {
  const match = /^\/p\/([\w-]{32})$/.exec(location.pathname);
  if (match) { await renderPublic(match[1]); return; }
  if (location.pathname === '/scan') { renderScanner(); return; }
  try {
    ({ demo: demoEnabled } = await api('/config'));
    await reload();
  } catch (error) {
    if (error.status === 401) renderAuth();
    else simple(empty('warn', 'AutoID could not load', escapeHtml(error.message), '<a class="btn secondary" href="/">Try again</a>'));
  }
}
setInterval(async () => {
  if (!state || page !== 'inbox' || document.hidden || dialog.open || document.activeElement?.closest('.inbox-stack, .inbox-more, .heading') || inboxItems.length > 25) return;
  try { await reload(); } catch (error) { if (error.status === 401) handleError(error); }
}, 20000);
start();
