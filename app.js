// ── SUPABASE CONFIG ──────────────────────────────────────────────────────
const SB_URL = 'https://afwtmvturyetaqruihsr.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmd3RtdnR1cnlldGFxcnVpaHNyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMzM3MjUsImV4cCI6MjA5MDcwOTcyNX0.MmBoHJSe5uH_sOhe1WK5egr1znH-4hlm3eBzwgRwL10';

let sb = null;
let useSB = false;
if (SB_URL.startsWith('https')) {
  try { sb = window.supabase.createClient(SB_URL, SB_KEY); useSB = true; } catch (e) { console.error('Supabase init error', e); }
}

// ── SAVED GAMES (Supabase table: saved_games) ────────────────────────────
async function getSavedGames() {
  if (useSB) {
    const { data, error } = await sb.from('saved_games').select('*');
    if (error) { console.error(error); return {}; }
    const obj = {};
    (data || []).forEach(row => { obj[row.id] = row.game_data; });
    return obj;
  }
  try { return JSON.parse(localStorage.getItem('kahoot_saved') || '{}'); } catch (e) { return {}; }
}

async function saveGameToStorage(id, gameObj) {
  console.log('Saving game with questions:', JSON.stringify(gameObj.questions));
  if (useSB) {
    const { error } = await sb.from('saved_games').upsert({ id, game_data: gameObj, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (error) console.error(error);
    return;
  }
  const all = await getSavedGames();
  all[id] = gameObj;
  localStorage.setItem('kahoot_saved', JSON.stringify(all));
}

async function deleteGameFromStorage(id) {
  if (useSB) {
    const { error } = await sb.from('saved_games').delete().eq('id', id);
    if (error) console.error(error);
    return;
  }
  const all = await getSavedGames();
  delete all[id];
  localStorage.setItem('kahoot_saved', JSON.stringify(all));
}

// ── REALTIME CHANNEL ─────────────────────────────────────────────────────
let realtimeChannel = null;
let isHost = false;

// In-memory store (authoritative on the HOST side only)
const store = {
  games: {},
  state: {},
  players: {},
};

// Broadcast an event to everyone in the game room (including self)
function sendEvent(eventName, payload) {
  if (realtimeChannel) {
    realtimeChannel.send({ type: 'broadcast', event: eventName, payload });
  }
  onEvent(eventName, payload);
}

// Subscribe to a game room and set up listener
function subscribeToGame(code, onReady) {
  if (realtimeChannel) {
    try { sb && sb.removeChannel(realtimeChannel); } catch (_) { }
    realtimeChannel = null;
  }

  if (!useSB) {
    if (!window._localBC) {
      window._localBC = new BroadcastChannel('kahoot_local_' + code);
      window._localBC.onmessage = e => onEvent(e.data.event, e.data.payload);
    }
    if (onReady) onReady();
    return;
  }

  realtimeChannel = sb.channel('game_room_' + code, {
    config: { 
      broadcast: { self: false },
      presence: { key: isHost ? 'host' : (curPlayerId || 'unknown') }
    }
  });

  realtimeChannel
    .on('broadcast', { event: '*' }, ({ event, payload }) => {
      onEvent(event, payload);
    })
    .on('presence', { event: 'leave' }, ({ key }) => {
      if (key && key !== 'host') {
        onEvent('player_leave', { id: key, code: code });
      }
    })
    .subscribe(async status => {
      console.log('Channel status:', status);
      if (status === 'SUBSCRIBED') {
        try {
          await realtimeChannel.track({ id: isHost ? 'host' : curPlayerId });
        } catch (e) { console.error('Presence track error', e); }
        if (onReady) onReady();
      }
    });
}

// ── EVENT DISPATCHER ─────────────────────────────────────────────────────
function onEvent(event, payload) {
  if (event === 'game_state') handleGameState(payload);
  if (event === 'player_join') { if (isHost) hostOnPlayerJoin(payload); }
  if (event === 'player_vote') { if (isHost) hostOnPlayerVote(payload); }
  if (event === 'request_state') { if (isHost) hostResendState(); }
  if (event === 'player_leave') { if (isHost) hostOnPlayerLeave(payload); }
}

function serializePlayers(code) {
  return Object.entries(store.players[code] || {}).map(([id, p]) => ({ id, ...p }));
}

// ── APP STATE ────────────────────────────────────────────────────────────
let QUESTIONS = [];
let editingIndex = -1;
let editingGameId = null;
let curCode = '';
let curPlayerId = '';
let curName = '';
let myScore = 0;
let myAnswered = false;
let myLastAnswer = null;
let questionStartTime = 0;
let lastQIndex = -1;
let hostQIndex = 0;
let hostPhase = 'question';
let prevScores = {};
let joiningInProgress = false;
let playerCountdownInterval = null;
let currentImageUrl = '';
let imageUploadInProgress = false;

// ── TOAST ────────────────────────────────────────────────────────────────
function showToast(msg, color) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.background = color || 'linear-gradient(135deg, #3b82f6, #2563eb)';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

// ── IMAGE UPLOAD ──────────────────────────────────────────────────────────
async function uploadImageToStorage(file) {
  if (!file || !useSB) return null;
  
  const fileName = `game_${editingGameId || 'new'}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
  const { data, error } = await sb.storage
    .from('kahoot-storage')
    .upload(fileName, file);

  if (error) {
    console.error('Image upload error:', error);
    showToast('❌ Failed to upload image', '#ef4444');
    return null;
  }

  const { data: { publicUrl } } = sb.storage
    .from('kahoot-storage')
    .getPublicUrl(fileName);

  return publicUrl;
}

async function handleImageUpload(input) {
  const file = input.files[0];
  if (!file) return;

  if (file.size > 2 * 1024 * 1024) {
    alert('Image too large! Please use images under 2MB.');
    input.value = '';
    return;
  }

  document.getElementById('img-uploading').style.display = 'block';
  imageUploadInProgress = true;

  try {
    currentImageUrl = await uploadImageToStorage(file);
    if (currentImageUrl) {
      document.getElementById('img-preview-src').src = currentImageUrl;
      document.getElementById('img-preview').style.display = 'block';
      showToast('🖼️ Image added!', '#26890c');
    }
  } catch (e) {
    console.error('Upload error:', e);
    showToast('❌ Upload failed', '#ef4444');
  } finally {
    document.getElementById('img-uploading').style.display = 'none';
    imageUploadInProgress = false;
    input.value = '';
  }
}

function removeImage() {
  currentImageUrl = '';
  document.getElementById('qb-img').value = '';
  document.getElementById('img-preview').style.display = 'none';
  document.getElementById('img-preview-src').src = '';
}

// ── NAVIGATION ───────────────────────────────────────────────────────────
function goTo(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
  if (id === 'screen-join-name') {
    joiningInProgress = false;
    const btn = document.getElementById('join-go-btn');
    if (btn) { btn.disabled = false; btn.textContent = "Let's Go! 🎉"; }
  }
}

// ── ADMIN AUTH (Supabase) ───────────────────────────────────────────────────
const ADMIN_EMAIL = 'waleed@admin.com';
let isAdminLoggedIn = false;

async function checkAdmin() {
  const pwd = document.getElementById('admin-pwd').value;
  if (!pwd) return;
  
  if (!sb || !useSB) {
    document.getElementById('admin-err').textContent = '⚠️ Supabase not connected';
    document.getElementById('admin-err').classList.add('show');
    console.log('Supabase status:', { sb: !!sb, useSB });
    return;
  }

  console.log('Trying login with:', ADMIN_EMAIL);
  const { data, error } = await sb.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: pwd
  });

  console.log('Login result:', { data, error });

  if (error) {
    document.getElementById('admin-err').textContent = '❌ Wrong password';
    document.getElementById('admin-err').classList.add('show');
    return;
  }

  isAdminLoggedIn = true;
  document.getElementById('admin-err').classList.remove('show');
  document.getElementById('admin-pwd').value = '';
  updateAdminUI();
  openAdminDash();
}

async function checkAdminSession() {
  if (!sb || !useSB) return false;
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    isAdminLoggedIn = true;
    updateAdminUI();
  }
  return !!session;
}

async function adminSignOut() {
  if (sb) await sb.auth.signOut();
  isAdminLoggedIn = false;
  updateAdminUI();
  goTo('screen-home');
  showToast('Signed out', '#6366f1');
}

function updateAdminUI() {
  const btns = document.querySelectorAll('.admin-logout-btn');
  btns.forEach(btn => {
    if (isAdminLoggedIn) {
      btn.style.display = 'inline-block';
    } else {
      btn.style.display = 'none';
    }
  });
}

checkAdminSession();

// ── ADMIN DASHBOARD ──────────────────────────────────────────────────────
async function openAdminDash() {
  if (!isAdminLoggedIn) {
    goTo('screen-admin-login');
    showToast('Please login first', '#6366f1');
    return;
  }
  await renderSavedGames();
  goTo('screen-admin-dash');
}

async function renderSavedGames() {
  const all = await getSavedGames();
  const container = document.getElementById('saved-games-list');
  const ids = Object.keys(all);
  if (!ids.length) { container.innerHTML = '<p class="no-saved">No saved games yet. Create one!</p>'; return; }
  container.innerHTML = '';
  ids.forEach(id => {
    const g = all[id];
    const div = document.createElement('div');
    div.className = 'saved-game-card';
    div.innerHTML = `
      <div style="flex:1">
        <div class="sg-title">${escHtml(g.title)}</div>
        <div class="sg-meta">${g.questions.length} question${g.questions.length !== 1 ? 's' : ''} · ${g.savedAt || ''}</div>
      </div>
      <div class="sg-actions">
        <button class="sg-btn sg-edit" onclick="event.stopPropagation();loadGameForEdit('${id}')">✏️ Edit</button>
        <button class="sg-btn sg-host" onclick="event.stopPropagation();loadGameAndHost('${id}')">🚀 Host</button>
        <button class="sg-btn sg-del"  onclick="event.stopPropagation();deleteSavedGame('${id}')">🗑</button>
      </div>`;
    container.appendChild(div);
  });
}

async function deleteSavedGame(id) {
  if (!confirm('Delete this game?')) return;
  await deleteGameFromStorage(id);
  await renderSavedGames();
  showToast('Game deleted', '#e21b3c');
}

// ── CREATE / EDIT GAME ───────────────────────────────────────────────────
function startNewGame() {
  QUESTIONS = []; editingGameId = null; editingIndex = -1;
  currentImageUrl = '';
  document.getElementById('game-title').value = '';
  document.getElementById('create-game-title').textContent = '✏️ Create Game';
  clearBuilder(); renderQuestionList(); goTo('screen-create-game');
}

async function loadGameForEdit(id) {
  const all = await getSavedGames();
  const g = all[id]; if (!g) return;
  QUESTIONS = [...g.questions]; editingGameId = id; editingIndex = -1;
  document.getElementById('game-title').value = g.title;
  document.getElementById('create-game-title').textContent = '✏️ Edit Game';
  clearBuilder(); renderQuestionList(); goTo('screen-create-game');
}

// ── QUESTION BUILDER ─────────────────────────────────────────────────────
function addOrUpdateQuestion() {
  const q = document.getElementById('qb-q').value.trim();
  const a1 = document.getElementById('qb-a1').value.trim();
  const a2 = document.getElementById('qb-a2').value.trim();
  const a3 = document.getElementById('qb-a3').value.trim();
  const a4 = document.getElementById('qb-a4').value.trim();
  const c = parseInt(document.getElementById('qb-correct').value);
  const t = parseInt(document.getElementById('qb-time').value) || 20;
  const img = currentImageUrl;
  if (!q) { alert('Enter a question!'); return; }
  if (!a1) { alert('Enter Answer 1!'); return; }
  if (!a2) { alert('Enter Answer 2!'); return; }
  const qObj = { q, a1, a2, a3, a4, c, t, img };
  if (editingIndex >= 0) { QUESTIONS[editingIndex] = qObj; showToast('Question updated ✅', '#26890c'); }
  else { QUESTIONS.push(qObj); showToast('Question added ✅', '#26890c'); }
  cancelEdit(); renderQuestionList();
}

function editQuestion(i) {
  editingIndex = i;
  const q = QUESTIONS[i];
  document.getElementById('qb-q').value = q.q;
  document.getElementById('qb-a1').value = q.a1;
  document.getElementById('qb-a2').value = q.a2;
  document.getElementById('qb-a3').value = q.a3 || '';
  document.getElementById('qb-a4').value = q.a4 || '';
  document.getElementById('qb-correct').value = String(q.c);
  document.getElementById('qb-time').value = q.t;
  
  currentImageUrl = q.img || '';
  if (currentImageUrl) {
    document.getElementById('img-preview-src').src = currentImageUrl;
    document.getElementById('img-preview').style.display = 'block';
  } else {
    document.getElementById('img-preview').style.display = 'none';
  }
  
  document.getElementById('builder-title').textContent = '✏️ Edit Question';
  document.getElementById('add-q-btn').textContent = '💾 Save Changes';
  document.getElementById('add-q-btn').className = 'btn btn-orange';
  document.getElementById('cancel-edit-btn').style.display = 'block';
  document.getElementById('edit-banner').classList.add('show');
  document.getElementById('edit-banner-num').textContent = i + 1;
  renderQuestionList();
  document.getElementById('builder-title').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cancelEdit() {
  editingIndex = -1; clearBuilder(); renderQuestionList();
}

function clearBuilder() {
  ['qb-q', 'qb-a1', 'qb-a2', 'qb-a3', 'qb-a4', 'qb-time'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('qb-correct').value = '1';
  document.getElementById('builder-title').textContent = '➕ Add a Question';
  document.getElementById('add-q-btn').textContent = '+ Add Question';
  document.getElementById('add-q-btn').className = 'btn btn-green';
  document.getElementById('cancel-edit-btn').style.display = 'none';
  document.getElementById('edit-banner').classList.remove('show');
  currentImageUrl = '';
  document.getElementById('img-preview').style.display = 'none';
  document.getElementById('img-preview-src').src = '';
}

function deleteQuestion(i) {
  if (editingIndex === i) cancelEdit();
  QUESTIONS.splice(i, 1);
  if (editingIndex > i) editingIndex--;
  renderQuestionList();
}

function renderQuestionList() {
  const list = document.getElementById('q-list');
  document.getElementById('q-count').textContent = QUESTIONS.length;
  list.innerHTML = '';
  QUESTIONS.forEach((q, i) => {
    const d = document.createElement('div');
    d.className = 'q-item' + (editingIndex === i ? ' editing' : '');
    d.onclick = () => editQuestion(i);
    d.innerHTML = `<div class="q-num">${i + 1}</div><span style="flex:1;text-align:left">${escHtml(q.q)}</span><span style="font-size:.8rem;color:#888;margin-right:6px">${q.t}s</span><button class="q-del" onclick="event.stopPropagation();deleteQuestion(${i})">✕</button>`;
    list.appendChild(d);
  });
}

// ── SAVE GAME ────────────────────────────────────────────────────────────
function saveGameOnly() {
  const title = document.getElementById('game-title').value.trim() || 'Kahoot Game';
  if (!QUESTIONS.length) { alert('Add at least one question!'); return; }
  const id = editingGameId || ('game_' + Date.now());
  const gameObj = { id, title, questions: [...QUESTIONS], savedAt: new Date().toLocaleString() };
  saveGameToStorage(id, gameObj);
  editingGameId = id;
  showToast('💾 Game saved!', '#1368ce');
}

// ── HOST GAME ────────────────────────────────────────────────────────────
async function saveAndHost() {
  const title = document.getElementById('game-title').value.trim() || 'Kahoot Game';
  if (!QUESTIONS.length) { alert('Add at least one question!'); return; }
  saveGameOnly();
  await startHosting(title, QUESTIONS);
}

async function loadGameAndHost(id) {
  const all = await getSavedGames();
  const g = all[id]; if (!g) return;
  console.log('Loading game:', g);
  console.log('Questions in game:', g.questions);
  if (g.questions && g.questions[0]) console.log('First question:', JSON.stringify(g.questions[0]));
  await startHosting(g.title, g.questions);
}

async function startHosting(title, questions) {
  console.log('startHosting questions:', questions);
  isHost = true;
  const code = String(Math.floor(100000 + Math.random() * 900000));
  curCode = code;
  store.games[code] = { code, title, questions: [...questions] };
  store.players[code] = {};
  store.state[code] = { status: 'lobby', qIndex: 0 };

  document.getElementById('host-pin-display').textContent = code;
  updateHostLobbyUI();
  goTo('screen-lobby-host');

  subscribeToGame(code, () => {
    console.log('✅ Host subscribed to game_room_' + code);
    showToast('Game ready! PIN: ' + code, '#26890c');
  });
}

function hostResendState() {
  const st = store.state[curCode];
  if (!st) return;
  sendEvent('game_state', { ...st, code: curCode, players: serializePlayers(curCode) });
}

function hostOnPlayerJoin(payload) {
  const { id, name, code } = payload;
  if (code !== curCode) return;
  if (!store.players[curCode][id]) {
    store.players[curCode][id] = { name, score: 0, answered: false };
    updateHostLobbyUI();
    showToast('👋 ' + name + ' joined!', '#26890c');
  }
  hostResendState();
}

function hostOnPlayerLeave(payload) {
  const { id, code } = payload;
  if (code !== curCode) return;
  if (store.players[curCode] && store.players[curCode][id]) {
    const pName = store.players[curCode][id].name;
    delete store.players[curCode][id];
    updateHostLobbyUI();
    showToast('👋 ' + pName + ' left', '#e21b3c');
    hostResendState();

    if (hostPhase === 'question') {
      updateVoteBar();
      const all = Object.values(store.players[curCode]);
      if (all.length > 0 && all.every(p => p.answered)) {
        hostRevealAnswer();
      }
    }
  }
}

function hostOnPlayerVote(payload) {
  const { id, answer, code } = payload;
  if (code !== curCode) return;
  const player = store.players[curCode] && store.players[curCode][id];
  if (!player || player.answered) return;
  const st = store.state[curCode];
  const game = store.games[curCode];
  if (!st || !game || st.status !== 'question') return;
  const q = game.questions[st.qIndex];
  player.answered = true;

  let points = 0;
  if (q && q.c === answer) {
    const timeTakenMs = payload.timeTaken || 0;
    const totalTimeMs = (q.t || 20) * 1000;
    points = Math.round(1000 * (1 - ((timeTakenMs / totalTimeMs) / 2)));
    points = Math.max(500, Math.min(1000, points));
  } else {
    points = 0;
  }

  player.score += points;
  sendEvent('game_state', { ...store.state[curCode], code: curCode, players: serializePlayers(curCode) });
  updateVoteBar();
  const all = Object.values(store.players[curCode]);
  if (all.length > 0 && all.every(p => p.answered) && hostPhase === 'question') {
    hostRevealAnswer();
  }
}

function updateHostLobbyUI() {
  const players = Object.values(store.players[curCode] || {});
  const count = players.length;
  document.getElementById('player-count-badge').textContent = count + ' player' + (count !== 1 ? 's' : '');
  const list = document.getElementById('host-players-list');
  list.innerHTML = '';
  players.forEach(p => {
    const el = document.createElement('div');
    el.className = 'player-pill';
    el.textContent = p.name;
    list.appendChild(el);
  });
}

// ── HOST GAME FLOW ───────────────────────────────────────────────────────
function hostStartGame() {
  const players = Object.values(store.players[curCode] || {});
  if (!players.length && !confirm('No players yet — start anyway for a demo?')) return;
  hostQIndex = 0;
  hostPhase = 'question';
  store.state[curCode] = { status: 'countdown', qIndex: 0 };
  sendEvent('game_state', { status: 'countdown', code: curCode, players: serializePlayers(curCode) });
  goTo('screen-countdown');
  let count = 10;
  document.getElementById('countdown-number').textContent = count;
  const tick = setInterval(() => {
    count--;
    document.getElementById('countdown-number').textContent = count;
    if (count <= 0) {
      clearInterval(tick);
      store.state[curCode] = { status: 'question', qIndex: hostQIndex };
      showHostQuestion();
    }
  }, 1000);
}

function showHostQuestion() {
  const game = store.games[curCode];
  const q = game.questions[hostQIndex];
  console.log('Question data:', q);
  prevScores = {};
  Object.entries(store.players[curCode] || {}).forEach(([id, p]) => prevScores[id] = p.score);
  Object.values(store.players[curCode] || {}).forEach(p => p.answered = false);
  store.state[curCode] = { status: 'question', qIndex: hostQIndex };
  sendEvent('game_state', { status: 'question', qIndex: hostQIndex, question: q, code: curCode, players: serializePlayers(curCode) });
  goTo('screen-host-game');
  document.getElementById('host-q-meta').textContent = `Question ${hostQIndex + 1} of ${game.questions.length}`;
  document.getElementById('host-question-text').textContent = q.q;
  
  const hostImg = document.getElementById('host-question-img');
  console.log('Image URL:', q.img);
  if (q.img) {
    hostImg.src = q.img;
    hostImg.style.display = 'block';
  } else {
    hostImg.style.display = 'none';
  }
  
  [q.a1, q.a2, q.a3, q.a4].forEach((label, i) => {
    document.getElementById('hat-' + (i + 1)).textContent = label || '';
    const ha = document.getElementById('ha-' + (i + 1));
    ha.style.opacity = label ? '1' : '0.15';
    ha.classList.remove('dim', 'correct');
  });
  hostPhase = 'question';
  updateVoteBar();
  const rt = document.getElementById('reveal-timer');
  if (rt) rt.style.display = 'none';
  document.getElementById('screen-host-game').style.background = '';
}

function updateVoteBar() {
  const players = Object.values(store.players[curCode] || {});
  const total = players.length;
  const voted = players.filter(p => p.answered).length;
  const pct = total > 0 ? Math.round((voted / total) * 100) : 0;
  const bar = document.getElementById('vote-bar');
  const label = document.getElementById('vote-count-label');
  if (bar) bar.style.width = pct + '%';
  if (label) label.textContent = voted + '/' + total;
}

function hostRevealAnswer() {
  if (hostPhase !== 'question') return;
  hostPhase = 'reveal';
  const correct = store.games[curCode].questions[hostQIndex].c;
  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById('ha-' + i);
    if (i === correct) el.classList.add('correct'); else el.classList.add('dim');
  }
  document.getElementById('screen-host-game').style.background = 'radial-gradient(circle at center, #064e3b 0%, #0f172a 100%)';

  store.state[curCode] = { status: 'reveal', qIndex: hostQIndex, correct };
  sendEvent('game_state', { status: 'reveal', qIndex: hostQIndex, correct, code: curCode, players: serializePlayers(curCode) });

  const rt = document.getElementById('reveal-timer');
  if (rt) {
    rt.style.display = 'flex';
    let left = 7;
    rt.textContent = left;
    const iv = setInterval(() => {
      left--;
      rt.textContent = left;
      if (left <= 0) {
        clearInterval(iv);
        rt.style.display = 'none';
        showRoundScoreboard();
      }
    }, 1000);
  } else {
    setTimeout(() => showRoundScoreboard(), 7000);
  }
}

function hostSkipQuestion() {
  if (!isHost || hostPhase !== 'question') return;

  const players = store.players[curCode] || {};
  Object.values(players).forEach(p => {
    p.score += 50;
    p.answered = true;
  });

  showToast('⏭ Question Skipped! +50 points for everyone', '#f59e0b');
  hostPhase = 'reveal';

  sendEvent('game_state', { status: 'reveal', qIndex: hostQIndex, code: curCode, players: serializePlayers(curCode), skipped: true });

  setTimeout(() => {
    showRoundScoreboard(true);
  }, 800);
}

function showRoundScoreboard(wasSkipped = false) {
  const game = store.games[curCode];
  const isLast = hostQIndex >= game.questions.length - 1;

  if (isLast) {
    store.state[curCode] = { status: 'game_ended' };
    sendEvent('game_state', { status: 'game_ended', code: curCode, players: serializePlayers(curCode) });
    goTo('screen-game-ended');
    return;
  }

  const players = Object.entries(store.players[curCode] || {}).map(([id, p]) => ({ id, ...p })).sort((a, b) => b.score - a.score);
  const top5 = players.slice(0, 5);
  const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
  document.getElementById('rsb-header').textContent = wasSkipped ? '⏭ Question Skipped!' : `Round ${hostQIndex + 1} Results`;
  document.getElementById('rsb-subheader').textContent = wasSkipped ? 'Everyone received 50 points!' : `Question ${hostQIndex + 1} of ${game.questions.length}`;
  document.getElementById('rsb-next-hint').textContent = isLast ? '🏆 Final scores coming up…' : '⏭ Next question coming up…';
  const list = document.getElementById('rsb-list');
  list.innerHTML = '';
  top5.forEach((p, i) => {
    const delta = p.score - (prevScores[p.id] || 0);
    const div = document.createElement('div');
    div.className = 'rsb-item';
    div.innerHTML = `<span class="rsb-rank">${medals[i] || i + 1}</span><span class="rsb-name">${escHtml(p.name)}</span><span class="rsb-score" id="rsb-score-${i}">0</span>`;
    list.appendChild(div);
  });
  goTo('screen-round-scores');
  top5.forEach((p, i) => {
    setTimeout(() => {
      if (list.children[i]) list.children[i].classList.add('show');
      const el = document.getElementById('rsb-score-' + i);
      if (!el) return;
      let step = 0; const steps = 30; const duration = 900;
      const iv = setInterval(() => {
        step++;
        el.textContent = Math.round((step / steps) * p.score).toLocaleString();
        if (step >= steps) { el.textContent = p.score.toLocaleString(); clearInterval(iv); }
      }, duration / steps);
    }, i * 220);
  });
  setTimeout(() => {
    let remaining = 10;
    const countdownEl = document.getElementById('rsb-countdown');
    const hintEl = document.getElementById('rsb-next-hint');
    countdownEl.style.display = 'block';
    countdownEl.textContent = remaining;
    hintEl.textContent = '⏭ Next question in…';

    const tick = setInterval(() => {
      remaining--;
      countdownEl.textContent = remaining;
      if (remaining <= 3) {
        countdownEl.style.color = '#ff4444';
        countdownEl.style.textShadow = '0 0 20px rgba(255,68,68,0.8)';
      } else if (remaining <= 5) {
        countdownEl.style.color = '#ffaa00';
        countdownEl.style.textShadow = '0 0 20px rgba(255,170,0,0.8)';
      }
      if (remaining <= 0) {
        clearInterval(tick);
        countdownEl.style.display = 'none';
        countdownEl.style.color = 'white';
        countdownEl.style.textShadow = '0 0 20px rgba(255,255,255,0.5)';
        hostQIndex++;
        hostPhase = 'question';
        store.state[curCode] = { status: 'question', qIndex: hostQIndex };
        showHostQuestion();
      }
    }, 1000);
  }, wasSkipped ? 800 : 2500);
}

// ── JOIN FLOW ────────────────────────────────────────────────────────────
function checkPin() {
  const pin = document.getElementById('join-pin').value.trim();
  const err = document.getElementById('pin-err');
  if (!pin || pin.length < 6) { err.classList.add('show'); return; }
  err.classList.remove('show');
  curCode = pin;
  goTo('screen-join-name');
}

async function joinGame() {
  if (joiningInProgress) return;
  joiningInProgress = true;
  const name = document.getElementById('join-name').value.trim() || 'Player';
  curName = name;
  curPlayerId = 'p_' + Math.random().toString(36).slice(2, 9);
  myScore = 0;
  myAnswered = false;
  lastQIndex = -1;
  document.getElementById('player-lobby-name').textContent = name;
  goTo('screen-lobby-player');

  subscribeToGame(curCode, () => {
    console.log('✅ Player subscribed to game_room_' + curCode);
    sendEvent('player_join', { id: curPlayerId, name, code: curCode });
    setTimeout(() => sendEvent('request_state', { code: curCode }), 800);
  });
}

// ── PLAYER — handle incoming game state ──────────────────────────────────
function handleGameState(payload) {
  if (isHost) return;
  const { status, qIndex, correct, question, players, code } = payload;
  if (code && code !== curCode) return;

  if (players) {
    if (!store.players[curCode]) store.players[curCode] = {};
    players.forEach(p => { store.players[curCode][p.id] = { name: p.name, score: p.score, answered: p.answered }; });
  }

  if (status === 'lobby') {
    const active = document.querySelector('.screen.active');
    if (active && active.id !== 'screen-lobby-player' && active.id !== 'screen-join-name') goTo('screen-lobby-player');

  } else if (status === 'countdown') {
    if (playerCountdownInterval) return;
    let count = 10;
    goTo('screen-countdown');
    document.getElementById('countdown-number').textContent = count;
    playerCountdownInterval = setInterval(() => {
      count--;
      document.getElementById('countdown-number').textContent = count;
      if (count <= 0) { clearInterval(playerCountdownInterval); playerCountdownInterval = null; }
    }, 1000);

  } else if (status === 'question') {
    if (playerCountdownInterval) { clearInterval(playerCountdownInterval); playerCountdownInterval = null; }
    if (question) {
      if (!store.games[curCode]) store.games[curCode] = { questions: [] };
      store.games[curCode].questions[qIndex] = question;
      
      const playerImgContainer = document.getElementById('player-question-img-container');
      const playerImg = document.getElementById('player-question-img');
      if (question.img) {
        playerImg.src = question.img;
        playerImgContainer.style.display = 'block';
      } else {
        playerImgContainer.style.display = 'none';
      }
    }
    if (qIndex !== lastQIndex) {
      lastQIndex = qIndex;
      myAnswered = false;
      myLastAnswer = null;
      questionStartTime = performance.now();
    }
    if (!myAnswered) showPlayerButtons();
    else showPlayerWaiting('⏳', 'Answer sent!', false);

  } else if (status === 'reveal') {
    const isCorrect = myLastAnswer === correct;
    const wasSkipped = payload.skipped;

    const sorted = (players || []).sort((a, b) => b.score - a.score);
    const myIdx = sorted.findIndex(p => p.id === curPlayerId);
    const myPlayer = sorted[myIdx];

    if (myPlayer) {
      myScore = myPlayer.score;
      const rank = myIdx + 1;
      const suffix = (rank === 1 ? 'st' : rank === 2 ? 'nd' : rank === 3 ? 'rd' : 'th');

      let positionMsg = "";
      if (rank === 1) {
        positionMsg = "You're in the lead! 🏆";
      } else {
        const ahead = sorted[myIdx - 1];
        const diff = ahead.score - myPlayer.score;
        if (diff === 0) {
          positionMsg = `Tied with <span>${escHtml(ahead.name)}</span>`;
        } else {
          positionMsg = `Behind <span>${escHtml(ahead.name)}</span> by ${diff.toLocaleString()} pts`;
        }
      }

      showPlayerRankFeedback(wasSkipped ? '⏭ SKIPPED' : (isCorrect ? '✅ CORRECT' : '❌ INCORRECT'), isCorrect, rank + suffix, positionMsg);
    } else {
      const msg = wasSkipped ? '⏭ Question Skipped!' : '📊 Look at the screen!';
      showPlayerWaiting(wasSkipped ? '⏭' : '📊', msg, false);
    }

  } else if (status === 'game_ended') {
    showPlayerWaiting('🏁', 'Game Over! Results coming soon…', true);

  } else if (status === 'podium') {
    goTo('screen-home');
    document.getElementById('join-pin').value = '';
    curCode = '';
    curPlayerId = '';
  }
}

function showPlayerButtons() {
  goTo('screen-player-game');
  document.getElementById('player-buttons').classList.remove('hidden');
  document.getElementById('player-rank-feedback').style.display = 'none';
  document.getElementById('screen-player-game').style.background = '';
  const w = document.getElementById('player-waiting');
  w.classList.remove('show');
  w.style.display = 'none';
}

function showPlayerWaiting(icon, msg, showScore) {
  goTo('screen-player-game');
  document.getElementById('player-buttons').classList.add('hidden');
  document.getElementById('player-rank-feedback').style.display = 'none';
  const w = document.getElementById('player-waiting');
  w.style.display = 'flex';
  w.classList.add('show');
  document.getElementById('wait-icon').textContent = icon;
  document.getElementById('player-status-msg').textContent = msg;
  const sc = document.getElementById('player-score-badge');
  sc.style.display = showScore ? 'block' : 'none';
  if (showScore) sc.textContent = 'Score: ' + myScore.toLocaleString();
}

function showPlayerRankFeedback(title, isCorrect, rankStr, posMsg) {
  goTo('screen-player-game');
  document.getElementById('player-buttons').classList.add('hidden');
  document.getElementById('player-waiting').style.display = 'none';

  const fb = document.getElementById('player-rank-feedback');
  fb.style.display = 'flex';

  const banner = document.getElementById('feedback-banner');
  banner.textContent = title;

  const isSkipped = title.includes('SKIPPED');
  banner.className = 'feedback-banner ' + (isSkipped ? '' : (isCorrect ? 'feedback-correct' : 'feedback-incorrect'));

  document.getElementById('feedback-rank').textContent = rankStr;
  document.getElementById('feedback-position').innerHTML = posMsg;
  document.getElementById('feedback-total-score').textContent = myScore.toLocaleString() + ' pts';

  const screen = document.getElementById('screen-player-game');
  if (isSkipped) {
    screen.style.background = '';
  } else if (isCorrect) {
    screen.style.background = 'linear-gradient(135deg, #064e3b 0%, #065f46 100%)';
  } else {
    screen.style.background = 'linear-gradient(135deg, #7f1d1d 0%, #991b1b 100%)';
  }
}

function playerAnswer(num) {
  if (myAnswered) return;
  myAnswered = true;
  myLastAnswer = num;
  const q = store.games[curCode] && store.games[curCode].questions[lastQIndex];
  let earned = 0;
  if (q) {
    if (q.c === num) {
      const timeTakenMs = performance.now() - questionStartTime;
      const totalTimeMs = (q.t || 20) * 1000;
      earned = Math.round(1000 * (1 - ((timeTakenMs / totalTimeMs) / 2)));
      earned = Math.max(500, Math.min(1000, earned));
    } else {
      earned = 0;
    }
  }
  myScore += earned;
  sendEvent('player_vote', { id: curPlayerId, answer: num, code: curCode, timeTaken: performance.now() - questionStartTime });
  showPlayerWaiting('✅', 'Answer submitted!', false);
}

// ── HOST: REVEAL PODIUM ─────────────────────────────────────────────────
function hostRevealPodium() {
  store.state[curCode] = { status: 'podium' };
  sendEvent('game_state', { status: 'podium', code: curCode, players: serializePlayers(curCode) });
  showPodium(curCode);
}

// ── PODIUM ───────────────────────────────────────────────────────────────
function showPodium(code) {
  goTo('screen-podium');
  const players = Object.values(store.players[code] || {}).sort((a, b) => b.score - a.score);

  ['3rd', '2nd', '1st'].forEach(rank => {
    document.getElementById(`podium-${rank}`).classList.remove(`animate-${rank}`);
  });

  ['3rd', '2nd', '1st'].forEach(rank => {
    document.getElementById(`name-${rank}`).textContent = '???';
    document.getElementById(`score-${rank}`).textContent = '?';
    document.getElementById(`name-${rank}`).classList.remove('reveal');
    document.getElementById(`score-${rank}`).classList.remove('reveal');
  });

  document.querySelectorAll('.winner-rank').forEach(el => el.classList.remove('show'));

  document.querySelectorAll('.star-particle, .cosmic-dust, .hyperspace, .nebula').forEach(c => c.remove());

  const nebula1 = document.createElement('div');
  nebula1.className = 'nebula nebula-1';
  document.getElementById('screen-podium').appendChild(nebula1);

  const nebula2 = document.createElement('div');
  nebula2.className = 'nebula nebula-2';
  document.getElementById('screen-podium').appendChild(nebula2);

  let hyperspace = document.querySelector('.hyperspace');
  if (!hyperspace) {
    hyperspace = document.createElement('div');
    hyperspace.className = 'hyperspace';
    document.body.appendChild(hyperspace);
  }

  if (!players.length) {
    document.getElementById('name-1st').textContent = 'No players 😢';
    return;
  }

  const top3 = players.slice(0, 3);

  const titleEl = document.querySelector('.podium-title');
  titleEl.classList.remove('entrance');
  void titleEl.offsetWidth;
  titleEl.classList.add('entrance');

  createCosmicDust();

  setTimeout(() => {
    hyperspace.classList.add('active');
    setTimeout(() => hyperspace.classList.remove('active'), 1000);

    setTimeout(() => {
      if (top3[2]) {
        const nameEl = document.getElementById('name-3rd');
        const scoreEl = document.getElementById('score-3rd');

        nameEl.textContent = escHtml(top3[2].name);
        scoreEl.textContent = top3[2].score.toLocaleString();

        document.getElementById('podium-3rd').classList.add('animate-3rd');
        createStarBurst(window.innerWidth * 0.3, window.innerHeight * 0.5, '#cd5c3c');

        setTimeout(() => {
          nameEl.classList.add('reveal');
          document.querySelector('#winner-3rd .winner-rank').classList.add('show');
        }, 1200);

        setTimeout(() => {
          scoreEl.classList.add('reveal');
        }, 1400);
      }
    }, 500);
  }, 2000);

  setTimeout(() => {
    hyperspace.classList.add('active');
    setTimeout(() => hyperspace.classList.remove('active'), 1000);

    setTimeout(() => {
      if (top3[1]) {
        const nameEl = document.getElementById('name-2nd');
        const scoreEl = document.getElementById('score-2nd');

        nameEl.textContent = escHtml(top3[1].name);
        scoreEl.textContent = top3[1].score.toLocaleString();

        document.getElementById('podium-2nd').classList.add('animate-2nd');
        createStarBurst(window.innerWidth * 0.7, window.innerHeight * 0.45, '#a0c0e0');

        setTimeout(() => {
          nameEl.classList.add('reveal');
          document.querySelector('#winner-2nd .winner-rank').classList.add('show');
        }, 1400);

        setTimeout(() => {
          scoreEl.classList.add('reveal');
        }, 1600);
      }
    }, 500);
  }, 4500);

  setTimeout(() => {
    hyperspace.classList.add('active');
    setTimeout(() => hyperspace.classList.remove('active'), 1500);

    createSupernova();

    setTimeout(() => {
      if (top3[0]) {
        const nameEl = document.getElementById('name-1st');
        const scoreEl = document.getElementById('score-1st');

        nameEl.textContent = escHtml(top3[0].name);
        scoreEl.textContent = top3[0].score.toLocaleString();

        document.getElementById('podium-1st').classList.add('animate-1st');

        setTimeout(() => {
          nameEl.classList.add('reveal');
          document.querySelector('#winner-1st .winner-rank').classList.add('show');
          createStarBurst(window.innerWidth * 0.5, window.innerHeight * 0.4, '#ffd700');
        }, 1800);

        setTimeout(() => {
          scoreEl.classList.add('reveal');
        }, 2000);

        setTimeout(() => createVictoryStars(), 2500);
        setTimeout(() => createVictoryStars(), 3000);
      }
    }, 800);
  }, 7500);

  const medals = ['🥇', '🥈', '🥉'];
  const list = document.getElementById('podium-list');
  list.innerHTML = '';
  players.slice(0, 3).forEach((p, i) => {
    const li = document.createElement('li');
    li.className = 'podium-item';
    li.innerHTML = `<span class="podium-rank">${medals[i] || i + 1}</span><span style="flex:1">${escHtml(p.name)}</span><span class="podium-score">${p.score.toLocaleString()}</span>`;
    list.appendChild(li);
  });
}

function createStarBurst(x, y, color) {
  for (let i = 0; i < 20; i++) {
    const star = document.createElement('div');
    star.className = 'star-particle';
    star.style.left = x + 'px';
    star.style.top = y + 'px';
    star.style.background = color;
    star.style.boxShadow = `0 0 10px ${color}, 0 0 20px ${color}`;

    const angle = (i / 20) * Math.PI * 2;
    const distance = 100 + Math.random() * 150;
    star.style.setProperty('--sx', Math.cos(angle) * distance + 'px');
    star.style.setProperty('--sy', Math.sin(angle) * distance + 'px');
    star.style.animation = `starBurst ${0.8 + Math.random() * 0.4}s cubic-bezier(0.16, 1, 0.3, 1) forwards`;

    document.body.appendChild(star);
    setTimeout(() => star.remove(), 1200);
  }
}

function createSupernova() {
  const centerX = window.innerWidth * 0.5;
  const centerY = window.innerHeight * 0.5;

  for (let ring = 0; ring < 3; ring++) {
    setTimeout(() => {
      const count = 30 + ring * 10;
      const colors = ['#ffd700', '#ff8c00', '#ff6b00', '#ffffff', '#ffec8b'];

      for (let i = 0; i < count; i++) {
        const star = document.createElement('div');
        star.className = 'star-particle';
        star.style.left = centerX + 'px';
        star.style.top = centerY + 'px';
        const color = colors[Math.floor(Math.random() * colors.length)];
        star.style.background = color;
        star.style.boxShadow = `0 0 15px ${color}, 0 0 30px ${color}`;
        star.style.width = (4 + Math.random() * 6) + 'px';
        star.style.height = star.style.width;

        const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
        const distance = 150 + ring * 100 + Math.random() * 100;
        star.style.setProperty('--sx', Math.cos(angle) * distance + 'px');
        star.style.setProperty('--sy', Math.sin(angle) * distance + 'px');
        star.style.animation = `starBurst ${1 + Math.random() * 0.5}s cubic-bezier(0.16, 1, 0.3, 1) forwards`;

        document.body.appendChild(star);
        setTimeout(() => star.remove(), 1500);
      }
    }, ring * 200);
  }
}

function createCosmicDust() {
  for (let i = 0; i < 30; i++) {
    setTimeout(() => {
      const dust = document.createElement('div');
      dust.className = 'cosmic-dust';
      dust.style.left = Math.random() * 100 + '%';
      dust.style.animation = `dustFloat ${8 + Math.random() * 6}s linear forwards`;
      dust.style.opacity = 0.3 + Math.random() * 0.4;

      document.getElementById('screen-podium').appendChild(dust);
      setTimeout(() => dust.remove(), 15000);
    }, i * 300);
  }
}

function createVictoryStars() {
  const colors = ['#ffd700', '#ffec8b', '#ffffff', '#00ccff', '#ff00cc'];

  for (let i = 0; i < 25; i++) {
    setTimeout(() => {
      const star = document.createElement('div');
      star.className = 'star-particle';
      star.style.left = (Math.random() * 100) + '%';
      star.style.top = '-10px';
      const color = colors[Math.floor(Math.random() * colors.length)];
      star.style.background = color;
      star.style.boxShadow = `0 0 10px ${color}`;
      star.style.width = (3 + Math.random() * 5) + 'px';
      star.style.height = star.style.width;
      star.style.animation = `dustFloat ${3 + Math.random() * 2}s linear forwards`;

      document.body.appendChild(star);
      setTimeout(() => star.remove(), 5000);
    }, i * 80);
  }
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

document.getElementById('admin-pwd').addEventListener('keyup', e => { if (e.key === 'Enter') checkAdmin(); });

window.addEventListener('beforeunload', () => {
  if (!isHost && curPlayerId && curCode) {
    sendEvent('player_leave', { id: curPlayerId, code: curCode });
  }
});
