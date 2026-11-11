const API_BASE_URL = 'https://script.google.com/macros/s/AKfycbzDyGvY_UKf8T11a9-7wpXXcnaeNxHNqArx3tRYgLklyiwssZp0KOvsVDYXaQ4kcqWO/exec';
let ADMIN_PIN = '26918';
let html5QrcodeScanner = null;
let scanCooldown = false;
let beepCtx = null;

const gate = document.getElementById('pin-gate');
const dashboard = document.getElementById('dashboard');
const adminPinInput = document.getElementById('adminPin');
const unlockBtn = document.getElementById('unlockBtn');
const gateError = document.getElementById('gateError');
const logoutBtn = document.getElementById('logoutBtn');

async function api(action, body = {}) {
  let res;
  try {
    res = await fetch(API_BASE_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ ...body, action, secretKey: localStorage.getItem('att_secret') || 'cyber vision' })
    });
  } catch (fetchErr) {
    throw new Error('Failed to fetch: unable to reach the backend API. Check your network connection and confirm the Google Apps Script web app is deployed with "Anyone" access.');
  }

  if (!res.ok) {
    let msg = `Server error (${res.status})`;
    try {
      const data = await res.json();
      msg = data.error || msg;
    } catch (_) { /* non-JSON error response */ }
    throw new Error(msg);
  }

  let data;
  try {
    data = await res.json();
  } catch (_) {
    throw new Error('Failed to fetch: backend returned an invalid response.');
  }
  if (!data.ok) throw new Error(data.error || 'request failed');
  return data;
}

function showResult(elId, ok, msg) {
  const el = document.getElementById(elId);
  el.className = 'result ' + (ok ? 'ok' : 'err');
  el.textContent = msg;
  el.style.display = 'block';
}

function hideResult(elId) {
  const el = document.getElementById(elId);
  el.style.display = 'none';
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + tabId).classList.add('active');
  const btn = document.querySelector('.tab[data-tab="' + tabId + '"]');
  if (btn) btn.classList.add('active');
}

function playBeep() {
  try {
    if (!beepCtx) beepCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = beepCtx.createOscillator();
    const gain = beepCtx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, beepCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, beepCtx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.1, beepCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, beepCtx.currentTime + 0.15);
    osc.connect(gain);
    gain.connect(beepCtx.destination);
    osc.start();
    osc.stop(beepCtx.currentTime + 0.15);
  } catch (e) { /* audio not critical */ }
}

unlockBtn.addEventListener('click', async () => {
  const pin = adminPinInput.value.trim();
  if (!pin) { gateError.textContent = 'Enter PIN'; return; }
  try {
    ADMIN_PIN = pin;
    localStorage.setItem('att_pin', pin);
    gate.classList.add('hidden');
    dashboard.classList.remove('hidden');
    loadStudents();
  } catch (e) {
    gateError.textContent = e.message;
  }
});

logoutBtn.addEventListener('click', () => {
  localStorage.removeItem('att_secret');
  localStorage.removeItem('att_pin');
  ADMIN_PIN = '';
  dashboard.classList.add('hidden');
  gate.classList.remove('hidden');
  adminPinInput.value = '';
  if (html5QrcodeScanner) { html5QrcodeScanner.clear(); html5QrcodeScanner = null; }
});

// Enrollment
document.getElementById('enrollForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  hideResult('enrollResult');
  const name = document.getElementById('eName').value.trim();
  const mobile = document.getElementById('eMobile').value.trim();
  const course = document.getElementById('eCourse').value.trim();
  const email = document.getElementById('eEmail').value.trim();
  const joinDate = document.getElementById('eJoinDate').value;
  if (!name || !mobile || !course || !email || !joinDate) { showResult('enrollResult', false, 'All fields required'); return; }
  try {
    const data = await api('enroll', { name, mobile, course, email, joinDate: new Date(joinDate) });
    showResult('enrollResult', true, 'Enrolled: ' + data.id + ' (seq ' + data.sequence + ')');
    document.getElementById('enrollForm').reset();
  } catch (err) { showResult('enrollResult', false, err.message); }
});

// Scanner / Manual
const modeScanner = document.getElementById('modeScanner');
const modeManual = document.getElementById('modeManual');
const scannerView = document.getElementById('scannerView');
const manualView = document.getElementById('manualView');
const scanResult = document.getElementById('scanResult');
const scanOverlay = document.getElementById('scanOverlay');
const scanStatus = document.getElementById('scanStatus');
const scanDetail = document.getElementById('scanDetail');
const mStudentId = document.getElementById('mStudentId');
const btnManualScan = document.getElementById('btnManualScan');

modeScanner.addEventListener('click', () => {
  modeScanner.classList.add('active'); modeManual.classList.remove('active');
  scannerView.classList.remove('hidden'); manualView.classList.add('hidden');
  startScanner();
});
modeManual.addEventListener('click', () => {
  modeManual.classList.add('active'); modeScanner.classList.remove('active');
  manualView.classList.remove('hidden'); scannerView.classList.add('hidden');
  if (html5QrcodeScanner) { html5QrcodeScanner.clear(); html5QrcodeScanner = null; }
});

mStudentId.addEventListener('input', (e) => {
  let v = e.target.value.trim();
  if (/^\d+$/.test(v) && v.length <= 3) {
    v = 'ENR-' + v.padStart(3, '0');
    e.target.value = v;
  }
});

btnManualScan.addEventListener('click', async () => {
  const id = mStudentId.value.trim().toUpperCase();
  if (!id) { showResult('scanResult', false, 'Enter a student ID'); return; }
  hideResult('scanResult');
  showOverlay('Processing&hellip;', 'Logging attendance for ' + id);
  playBeep();
  try {
    await api('scan_attendance', { studentId: id, status: 'PRESENT' });
    showResult('scanResult', true, id + ' marked PRESENT');
    mStudentId.value = '';
  } catch (err) {
    showResult('scanResult', false, err.message);
  } finally { hideOverlay(); }
});

function startScanner() {
  if (html5QrcodeScanner) return;
  html5QrcodeScanner = new Html5Qrcode('qr-reader');
  html5QrcodeScanner.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: 250 },
    (decodedText) => {
      if (scanCooldown) return;
      scanCooldown = true;
      const id = String(decodedText).trim().toUpperCase();
      if (!/^ENR-\d+$/.test(id) && /^\d+$/.test(id)) {
        const n = parseInt(id, 10);
        if (n <= 999) id = 'ENR-' + String(n).padStart(3, '0');
      }
      showOverlay('Scanned ' + id, 'Verifying student&hellip;');
      playBeep();
      api('scan_attendance', { studentId: id, status: 'PRESENT' })
        .then(() => {
          showResult('scanResult', true, id + ' marked PRESENT');
          hideOverlay();
        })
        .catch(err => {
          showOverlay('Error', err.message);
          setTimeout(hideOverlay, 1500);
        })
        .finally(() => { setTimeout(() => { scanCooldown = false; }, 1500); });
    },
    (errorMsg) => {}
  ).catch(err => {
    console.error('QR start failed', err);
    document.getElementById('qr-reader').innerHTML = 'Camera access unavailable. Use manual entry.';
  });
}

function showOverlay(status, detail) {
  scanOverlay.classList.remove('hidden');
  scanStatus.textContent = status;
  scanDetail.textContent = detail;
}
function hideOverlay() { scanOverlay.classList.add('hidden'); }

// Students & Metrics
const sSearch = document.getElementById('sSearch');
const btnRefreshStudents = document.getElementById('btnRefreshStudents');
const studentsList = document.getElementById('studentsList');

async function loadStudents() {
  hideResult('enrollResult'); hideResult('scanResult');
  studentsList.innerHTML = '<div class="muted">Loading&hellip;</div>';
  try {
    const data = await api('list_students');
    renderStudents(data.students);
  } catch (err) {
    studentsList.innerHTML = '<div class="result err">' + err.message + '</div>';
  }
}

function renderStudents(students) {
  if (!students || students.length === 0) { studentsList.innerHTML = '<div class="muted">No students enrolled.</div>'; return; }
  const term = sSearch.value.trim().toLowerCase();
  const filtered = students.filter(s => (s.Name || '').toLowerCase().includes(term) || (s.ID || '').toLowerCase().includes(term));
  studentsList.innerHTML = '';
  filtered.forEach(s => {
    const card = document.createElement('div');
    card.className = 'student-card';
    const photoUrl = s.PhotoUrl ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(s.PhotoUrl)}&sz=w200` : '';
    const completed = s.EndDate ? 'done' : '';
    card.innerHTML = `
      <div class="meta">
        ${photoUrl ? '<img src="' + photoUrl + '" alt="photo">' : '<div style="width:44px;height:44px;border-radius:50%;background:#334155;"></div>'}
        <div>
          <div class="id">${s.ID || ''}</div>
          <div class="name">${s.Name || ''}</div>
          <div class="muted">${s.Course || ''} &bull; ${s.Mobile || ''}</div>
        </div>
      </div>
      <div>
        <span class="pill ${completed}">${completed ? 'Completed' : 'Active'}</span>
      </div>
    `;
    card.addEventListener('click', () => openStudentMetrics(s));
    studentsList.appendChild(card);
  });
}

async function openStudentMetrics(s) {
  try {
    const data = await api('get_student', { studentId: s.ID });
    const m = data.metrics;
    const html = `
      <div class="row"><strong>${s.ID}</strong> &bull; ${s.Name}</div>
      <div class="row">${s.Course || ''} &bull; ${s.Mobile || ''} &bull; ${s.Email || ''}</div>
      <div class="row" style="margin-top:12px; font-size:13px; color:#94a3b8;">
        Possible days: ${m.possibleDays}<br>
        Days present: ${m.daysPresent}<br>
        Holidays/Sundays excluded: ${m.holidays}<br>
        Total leave (absent): ${m.totalLeave}<br>
        Attendance: ${m.attendancePercent}%
      </div>
    `;
    studentsList.innerHTML = '<div class="card" style="margin-top:16px;">' + html + '<button class="btn-outline" id="btnBackStudents" style="margin-top:10px;">Back to list</button></div>';
    document.getElementById('btnBackStudents').addEventListener('click', () => loadStudents());
  } catch (err) {
    alert('Failed to load metrics: ' + err.message);
  }
}

btnRefreshStudents.addEventListener('click', loadStudents);
sSearch.addEventListener('input', () => {
  const data = studentsList.dataset.students;
  if (data) renderStudents(JSON.parse(data));
});

// Management overrides
document.getElementById('btnMarkCompleted').addEventListener('click', async () => {
  const id = document.getElementById('mOverrideId').value.trim().toUpperCase();
  if (!id) { showResult('manageResult', false, 'Enter student ID'); return; }
  try {
    await api('mark_completed', { studentId: id, endDate: new Date() });
    showResult('manageResult', true, id + ' marked Completed (tracking frozen)');
    document.getElementById('mOverrideId').value = '';
    loadStudents();
  } catch (err) { showResult('manageResult', false, err.message); }
});

document.getElementById('btnMarkLeave').addEventListener('click', async () => {
  const id = document.getElementById('mLeaveId').value.trim().toUpperCase();
  if (!id) { showResult('manageResult', false, 'Enter student ID'); return; }
  try {
    await api('mark_leave', { studentId: id, status: 'EXCUSED' });
    showResult('manageResult', true, id + ' leave marked EXCUSED');
    document.getElementById('mLeaveId').value = '';
    loadStudents();
  } catch (err) { showResult('manageResult', false, err.message); }
});

document.getElementById('btnMarkHoliday').addEventListener('click', async () => {
  const date = document.getElementById('mHolidayDate').value;
  const reason = document.getElementById('mHolidayReason').value.trim() || 'Holiday';
  if (!date) { showResult('manageResult', false, 'Select a date'); return; }
  try {
    await api('mark_holiday', { date: new Date(date), reason: reason });
    showResult('manageResult', true, date + ' marked as holiday');
    document.getElementById('mHolidayDate').value = '';
    document.getElementById('mHolidayReason').value = '';
    loadStudents();
  } catch (err) { showResult('manageResult', false, err.message); }
});

// Restore PIN state
(function() {
  const savedPin = localStorage.getItem('att_pin');
  if (savedPin) adminPinInput.value = savedPin;
})();