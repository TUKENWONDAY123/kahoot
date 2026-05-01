const SB_URL = 'https://afwtmvturyetaqruihsr.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmd3RtdnR1cnlldGFxcnVpaHNyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMzM3MjUsImV4cCI6MjA5MDcwOTcyNX0.MmBoHJSe5uH_sOhe1WK5egr1znH-4hlm3eBzwgRwL10';

let sb = null;
let useSB = false;
if (SB_URL.startsWith('https')) {
  try { sb = window.supabase.createClient(SB_URL, SB_KEY); useSB = true; } catch (e) { console.error('Supabase init error', e); }
}
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

let realtimeChannel = null;
let isHost = false;

const store = {
  games: {},
  state: {},
  players: {},
};


function sendEvent(eventName, payload) {
  if (realtimeChannel) {
    realtimeChannel.send({ type: 'broadcast', event: eventName, payload });
  }
  onEvent(eventName, payload);
}


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


function onEvent(event, payload) {
  if (event === 'game_state') handleGameState(payload);
  if (event === 'player_join') { if (isHost) hostOnPlayerJoin(payload); }
  if (event === 'player_vote') { if (isHost) hostOnPlayerVote(payload); }
  if (event === 'request_state') { if (isHost) hostResendState(); }
  if (event === 'player_leave') { if (isHost) hostOnPlayerLeave(payload); }
  if (event === 'player_kicked') { if (!isHost) handlePlayerKicked(payload); }
}

function serializePlayers(code) {
  return Object.entries(store.players[code] || {}).map(([id, p]) => ({ id, ...p }));
}


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


function showToast(msg, color) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.background = color || 'linear-gradient(135deg, #3b82f6, #2563eb)';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}


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


function goTo(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) {
    const animations = ['slideInFromRight', 'slideInFromLeft', 'slideInFromTop', 'slideInFromBottom', 'fadeIn', 'zoomIn', 'rotateIn', 'bounceIn', 'screenDropKick'];
    const randomAnim = animations[Math.floor(Math.random() * animations.length)];
    el.style.setProperty('--enter-animation', randomAnim);
    el.classList.add('active');
  }
  if (id === 'screen-join-name') {
    joiningInProgress = false;
    const btn = document.getElementById('join-go-btn');
    if (btn) { btn.disabled = false; btn.textContent = "Let's Go! 🎉"; }
  }
}


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
  ids.forEach((id, i) => {
    const g = all[id];
    const div = document.createElement('div');
    div.className = 'saved-game-card slide-up';
    div.style.animationDelay = (i * 60) + 'ms';
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
    d.className = 'q-item slide-up' + (editingIndex === i ? ' editing' : '');
    d.style.animationDelay = (i * 40) + 'ms';
    d.onclick = () => editQuestion(i);
    d.innerHTML = `<div class="q-num">${i + 1}</div><span style="flex:1;text-align:left">${escHtml(q.q)}</span><span style="font-size:.8rem;color:#888;margin-right:6px">${q.t}s</span><button class="q-del" onclick="event.stopPropagation();deleteQuestion(${i})">✕</button>`;
    list.appendChild(d);
  });
}


function saveGameOnly() {
  const title = document.getElementById('game-title').value.trim() || 'Kahoot Game';
  if (!QUESTIONS.length) { alert('Add at least one question!'); return; }
  const id = editingGameId || ('game_' + Date.now());
  const gameObj = { id, title, questions: [...QUESTIONS], savedAt: new Date().toLocaleString() };
  saveGameToStorage(id, gameObj);
  editingGameId = id;
  showToast('💾 Game saved!', '#1368ce');
}


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
  const { id, name, code, avatarUrl } = payload;
  if (code !== curCode) return;
  if (!store.players[curCode][id]) {
    store.players[curCode][id] = { name, score: 0, answered: false, avatarUrl };
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
  const players = store.players[curCode] || {};
  const count = Object.keys(players).length;
  document.getElementById('player-count-badge').textContent = count + ' player' + (count !== 1 ? 's' : '');
  const list = document.getElementById('host-players-list');
  list.innerHTML = '';
  Object.entries(players).forEach(([pid, p]) => {
    const el = document.createElement('div');
    el.className = 'player-pill';
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.justifyContent = 'space-between';
    el.style.gap = '8px';
    el.style.padding = '8px 12px';
    el.innerHTML = `<div style="display:flex;align-items:center;gap:8px;">${getAvatarImg(p.name, 28, p.avatarUrl)}<span>${escHtml(p.name)}</span></div><button class="btn btn-red btn-sm" style="padding:4px 10px;font-size:0.75rem;" onclick="kickPlayer('${pid}')">Kick</button>`;
    list.appendChild(el);
  });
}

function kickPlayer(playerId) {
  if (!confirm('Kick this player?')) return;
  if (store.players[curCode] && store.players[curCode][playerId]) {
    const pName = store.players[curCode][playerId].name;
    delete store.players[curCode][playerId];
    updateHostLobbyUI();
    showToast('🚫 ' + pName + ' was kicked', '#ef4444');
    sendEvent('player_kicked', { id: playerId, code: curCode });
    hostResendState();
  }
}


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
    div.innerHTML = `<span class="rsb-rank">${medals[i] || i + 1}</span><span class="rsb-name" style="display:flex;align-items:center;gap:10px;">${getAvatarImg(p.name, 32, p.avatarUrl)}<span>${escHtml(p.name)}</span></span><span class="rsb-score" id="rsb-score-${i}">0</span>`;
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


function checkPin() {
  const pin = document.getElementById('join-pin').value.trim();
  const err = document.getElementById('pin-err');
  if (!pin || pin.length < 6) { err.classList.add('show'); return; }
  err.classList.remove('show');
  curCode = pin;
  goTo('screen-join-name');
}

let myAvatarUrl = 'https://api.dicebear.com/9.x/avataaars/svg?seed=Player';

function updateAvatarPreview() {
  if (avatarIsCustom) return;
  const nameEl = document.getElementById('join-name');
  const seed = (nameEl && nameEl.value.trim() !== '') ? nameEl.value.trim() : 'Player';
  myAvatarUrl = `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(seed)}`;
  const previewEl = document.getElementById('avatar-preview');
  if (previewEl) previewEl.src = myAvatarUrl;
}

let avatarIsCustom = false;

function randomizeAvatar() {
  const randomSeed = 'Avatar' + Date.now() + '_' + Math.floor(Math.random() * 999999);
  avatarIsCustom = true;
  myAvatarUrl = `https://api.dicebear.com/9.x/avataaars/svg?seed=${randomSeed}`;
  const previewEl = document.getElementById('avatar-preview');
  if (previewEl) previewEl.src = myAvatarUrl;
}

const avatarSeeds = ['Alex', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Quinn', 'Avery', 'Parker', 'Sage', 'River', 'Sky', 'Emery', 'Blake', 'Cameron', 'Dakota', 'Reese', 'Finley', 'Hayden', 'Lennox', 'Phoenix', 'Winter', 'Sage', 'Marlowe', 'Spencer', 'Tatum', 'Lane', 'Pierce', 'Remy', 'Rowan', 'Sawyer', 'Shiloh', 'Stevie', 'Sutton', 'Teagan', 'Unity', 'Venus', 'Wren', 'Zion', 'Indigo', 'Marquis', 'Dakota', 'Ellis', 'Kendall', 'Logan', 'Peyton', 'Robin', 'Shannon', 'Stacy', 'Toni', 'Val', 'Kerry', 'Les', 'Shelley', 'Stevie'];

function showAvatarPicker() {
  const modal = document.getElementById('avatar-picker-modal');
  const grid = document.getElementById('avatar-grid');
  grid.innerHTML = '';
  avatarSeeds.forEach(seed => {
    const img = document.createElement('img');
    img.src = `https://api.dicebear.com/9.x/avataaars/svg?seed=${seed}`;
    img.style.cssText = 'width:70px;height:70px;cursor:pointer;border-radius:12px;border:2px solid rgba(255,255,255,0.1);transition:all 0.2s ease;object-fit:contain;background:rgba(255,255,255,0.05);';
    img.onmouseover = () => { img.style.borderColor = '#818cf8'; img.style.transform = 'scale(1.08)'; img.style.boxShadow = '0 4px 12px rgba(129,140,248,0.3)'; };
    img.onmouseout = () => { img.style.borderColor = 'rgba(255,255,255,0.1)'; img.style.transform = 'scale(1)'; img.style.boxShadow = 'none'; };
    img.onclick = () => {
      avatarIsCustom = true;
      myAvatarUrl = `https://api.dicebear.com/9.x/avataaars/svg?seed=${seed}`;
      const previewEl = document.getElementById('avatar-preview');
      if (previewEl) previewEl.src = myAvatarUrl;
      closeAvatarPicker();
    };
    grid.appendChild(img);
  });
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeAvatarPicker() {
  document.getElementById('avatar-picker-modal').style.display = 'none';
  document.body.style.overflow = '';
}

function updateAvatarSeedFromInput() {
  updateAvatarPreview();
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

  if (!avatarIsCustom) {
    myAvatarUrl = `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(name)}`;
  }
  updateAvatarPreview();

  document.getElementById('player-lobby-name').innerHTML = `<div style="display:flex;align-items:center;justify-content:center;gap:12px;">${getAvatarImg(name, 48, myAvatarUrl)}<span>${escHtml(name)}</span></div>`;
  goTo('screen-lobby-player');

  subscribeToGame(curCode, () => {
    console.log('✅ Player subscribed to game_room_' + curCode);
    sendEvent('player_join', { id: curPlayerId, name, code: curCode, avatarUrl: myAvatarUrl });
    setTimeout(() => sendEvent('request_state', { code: curCode }), 800);
  });
}


function handleGameState(payload) {
  if (isHost) return;
  const { status, qIndex, correct, question, players, code } = payload;
  if (code && code !== curCode) return;

  if (players) {
    if (!store.players[curCode]) store.players[curCode] = {};
    players.forEach(p => { store.players[curCode][p.id] = { name: p.name, score: p.score, answered: p.answered, avatarUrl: p.avatarUrl }; });
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
          positionMsg = `Tied with <span style="display:inline-flex;align-items:center;vertical-align:middle;gap:6px;margin:0 4px;">${getAvatarImg(ahead.name, 24, ahead.avatarUrl)} ${escHtml(ahead.name)}</span>`;
        } else {
          positionMsg = `Behind <span style="display:inline-flex;align-items:center;vertical-align:middle;gap:6px;margin:0 4px;">${getAvatarImg(ahead.name, 24, ahead.avatarUrl)} ${escHtml(ahead.name)}</span> by ${diff.toLocaleString()} pts`;
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

function handlePlayerKicked(payload) {
  if (payload.id === curPlayerId) {
    showToast('🚫 You were kicked from the game!', '#ef4444');
    goTo('screen-home');
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
  flashPlayerButton(num);
  showPlayerWaiting('✅', 'Answer submitted!', false);
}


function hostRevealPodium() {
  store.state[curCode] = { status: 'podium' };
  sendEvent('game_state', { status: 'podium', code: curCode, players: serializePlayers(curCode) });
  showPodium(curCode);
}


let podiumParticles = [];
let podiumCanvasCtx = null;
let podiumVfxAnimId = null;

function initPodiumCanvas() {
  const canvas = document.getElementById('podium-canvas');
  if (!canvas) return;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  podiumCanvasCtx = canvas.getContext('2d');
  podiumParticles = [];
  
  if (podiumVfxAnimId) cancelAnimationFrame(podiumVfxAnimId);
  
  function render() {
    podiumCanvasCtx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = podiumParticles.length - 1; i >= 0; i--) {
      const p = podiumParticles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity;
      p.life -= p.decay;
      
      if (p.life <= 0) {
        podiumParticles.splice(i, 1);
        continue;
      }
      
      podiumCanvasCtx.save();
      podiumCanvasCtx.globalAlpha = Math.max(0, p.life);
      podiumCanvasCtx.fillStyle = p.color;
      
      if (p.type === 'star') {
        podiumCanvasCtx.translate(p.x, p.y);
        podiumCanvasCtx.rotate(p.life * 5);
        podiumCanvasCtx.shadowBlur = 10;
        podiumCanvasCtx.shadowColor = p.color;
        podiumCanvasCtx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      } else if (p.type === 'dust') {
        podiumCanvasCtx.beginPath();
        podiumCanvasCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        podiumCanvasCtx.fill();
      } else if (p.type === 'confetti') {
        podiumCanvasCtx.translate(p.x, p.y);
        podiumCanvasCtx.rotate(p.rotation);
        p.rotation += p.rv;
        podiumCanvasCtx.fillRect(-p.size, -p.size/2, p.size*2, p.size);
      }
      
      podiumCanvasCtx.restore();
    }
    podiumVfxAnimId = requestAnimationFrame(render);
  }
  render();
  
  window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  });
}

function spawnCanvasStarburst(x, y, color) {
  for (let i = 0; i < 40; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 8;
    podiumParticles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      gravity: 0.1,
      life: 1.0,
      decay: 0.01 + Math.random() * 0.02,
      color: color,
      size: 3 + Math.random() * 6,
      type: 'star'
    });
  }
}

function spawnCanvasSupernova() {
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  const colors = ['#ffd700', '#ff8c00', '#ffffff', '#ffec8b'];
  
  for (let i = 0; i < 150; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 5 + Math.random() * 15;
    podiumParticles.push({
      x: cx, y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      gravity: 0.05,
      life: 1.0,
      decay: 0.005 + Math.random() * 0.015,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: 4 + Math.random() * 8,
      type: 'star'
    });
  }
}

function spawnCanvasConfetti() {
  const colors = ['#ffdd00', '#ff3131', '#22d3ee', '#00c44f', '#ff4fd8', '#a78bfa', '#fb923c', '#ffffff'];
  for (let i = 0; i < 150; i++) {
    podiumParticles.push({
      x: Math.random() * window.innerWidth,
      y: -20 - Math.random() * 100,
      vx: (Math.random() - 0.5) * 4,
      vy: 2 + Math.random() * 6,
      gravity: 0.05,
      life: 1.0,
      decay: 0.002 + Math.random() * 0.003,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: 6 + Math.random() * 8,
      type: 'confetti',
      rotation: Math.random() * Math.PI,
      rv: (Math.random() - 0.5) * 0.2
    });
  }
}

function animateScoreCountUp(el, targetScore, duration = 1500) {
  const start = performance.now();
  el.classList.add('counting');
  
  function update(time) {
    let progress = (time - start) / duration;
    if (progress > 1) progress = 1;
    
    
    const easeOut = 1 - Math.pow(1 - progress, 5);
    const current = Math.round(targetScore * easeOut);
    
    el.textContent = current.toLocaleString();
    
    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      el.classList.remove('counting');
      el.textContent = targetScore.toLocaleString();
    }
  }
  requestAnimationFrame(update);
}


async function showPodium(code) {
  goTo('screen-podium');
  initPodiumCanvas();
  
  const players = Object.values(store.players[code] || {}).sort((a, b) => b.score - a.score);
  const top3 = players.slice(0, 3);
  
  
  const phases = ['podium-phase-intro', 'podium-phase-3rd', 'podium-phase-2nd', 'podium-phase-1st'];
  phases.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.className = 'podium-phase podium-phase-hidden';
    }
  });
  
  const finalBtns = document.getElementById('podium-final-btns');
  if (finalBtns) finalBtns.classList.remove('visible');

  
  const runPhase = (id, setupFn, delayBeforeExit) => new Promise(resolve => {
    const el = document.getElementById(id);
    if (!el) return resolve();
    
    if (setupFn) setupFn();
    el.className = 'podium-phase podium-phase-enter';
    
    if (delayBeforeExit) {
      setTimeout(() => {
        el.className = 'podium-phase podium-phase-exit';
        setTimeout(resolve, 500);
      }, delayBeforeExit);
    } else {
      resolve();
    }
  });

  
  await new Promise(r => setTimeout(r, 500));

  
  await runPhase('podium-phase-intro', null, 2500);

  
  if (top3[2]) {
    await runPhase('podium-phase-3rd', () => {
      document.getElementById('name-3rd').innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:8px;">${getAvatarImg(top3[2].name, 60, top3[2].avatarUrl)}<span>${escHtml(top3[2].name)}</span></div>`;
      setTimeout(() => {
        spawnCanvasStarburst(window.innerWidth * 0.3, window.innerHeight * 0.5, '#cd7f32');
        animateScoreCountUp(document.getElementById('score-3rd'), top3[2].score);
      }, 700);
    }, 3500);
  }

  
  if (top3[1]) {
    await runPhase('podium-phase-2nd', () => {
      document.getElementById('name-2nd').innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:8px;">${getAvatarImg(top3[1].name, 60, top3[1].avatarUrl)}<span>${escHtml(top3[1].name)}</span></div>`;
      setTimeout(() => {
        spawnCanvasStarburst(window.innerWidth * 0.7, window.innerHeight * 0.45, '#c0c0c0');
        animateScoreCountUp(document.getElementById('score-2nd'), top3[1].score);
      }, 700);
    }, 4000);
  }

  
  if (top3[0]) {
    await runPhase('podium-phase-1st', () => {
      document.getElementById('name-1st').innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:8px;">${getAvatarImg(top3[0].name, 80, top3[0].avatarUrl)}<span>${escHtml(top3[0].name)}</span></div>`;
      setTimeout(() => {
        spawnCanvasSupernova();
        animateScoreCountUp(document.getElementById('score-1st'), top3[0].score, 2000);
      }, 700);
      setTimeout(() => spawnCanvasConfetti(), 1500);
      setTimeout(() => spawnCanvasConfetti(), 3000);
      
      
      setTimeout(() => {
        if (finalBtns) finalBtns.classList.add('visible');
      }, 3500);
    }, 0);
  } else {
    
    await runPhase('podium-phase-1st', () => {
      document.getElementById('name-1st').textContent = 'No players 😢';
      if (finalBtns) finalBtns.classList.add('visible');
    }, 0);
  }
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function getAvatarImg(name, size = 30, avatarUrl = '') {
  const url = avatarUrl || `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(name)}`;
  return `<img src="${url}" style="width:${size}px;height:${size}px;border-radius:50%;background:#ffffff22;flex-shrink:0;object-fit:contain;" alt="avatar" />`;
}

document.getElementById('admin-pwd').addEventListener('keyup', e => { if (e.key === 'Enter') checkAdmin(); });


document.addEventListener('click', e => {
  const btn = e.target.closest('.btn');
  if (!btn || btn.disabled) return;
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  const rect = btn.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  ripple.style.width = ripple.style.height = size + 'px';
  ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
  ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
  btn.appendChild(ripple);
  setTimeout(() => ripple.remove(), 500);
});


function flashPlayerButton(num) {
  const btn = document.querySelector(`.player-ans-btn:nth-child(${num})`);
  if (!btn) return;
  const colors = { 1: 'glow-red', 2: 'glow-blue', 3: 'glow-yellow', 4: 'glow-green' };
  const cls = colors[num];
  if (cls) {
    btn.classList.add(cls);
    setTimeout(() => btn.classList.remove(cls), 1600);
  }
}

window.addEventListener('beforeunload', () => {
  if (!isHost && curPlayerId && curCode) {
    sendEvent('player_leave', { id: curPlayerId, code: curCode });
  }
});




const BURST_COLORS = ['#ffdd00', '#ff3131', '#22d3ee', '#00c44f', '#ff4fd8', '#a78bfa', '#fb923c'];
document.addEventListener('click', e => {
  const burst = document.createElement('div');
  burst.className = 'click-burst';
  const color = BURST_COLORS[Math.floor(Math.random() * BURST_COLORS.length)];
  burst.style.setProperty('--burst-color', color);
  burst.style.left = e.clientX + 'px';
  burst.style.top = e.clientY + 'px';
  document.body.appendChild(burst);
  setTimeout(() => burst.remove(), 700);
});


function spawnFloatingDots() {
  const DOT_COLORS = ['#ffdd00', '#ff3131', '#22d3ee', '#00c44f', '#ff4fd8', '#a78bfa'];
  for (let i = 0; i < 18; i++) {
    const dot = document.createElement('div');
    dot.className = 'floating-dot';
    const size = 6 + Math.random() * 18;
    dot.style.cssText = `
      width:${size}px; height:${size}px;
      background:${DOT_COLORS[Math.floor(Math.random() * DOT_COLORS.length)]};
      left:${Math.random() * 100}vw; top:${Math.random() * 100}vh;
      --tx:${(Math.random() - 0.5) * 80}px;
      --ty:${(Math.random() - 0.5) * 80}px;
      --dur:${3 + Math.random() * 5}s;
      --delay:${Math.random() * 4}s;
      --opacity:${0.3 + Math.random() * 0.5};
      border: 2px solid rgba(0,0,0,0.25);
    `;
    document.body.appendChild(dot);
  }
}
spawnFloatingDots();


const CONFETTI_COLORS = ['#ffdd00', '#ff3131', '#22d3ee', '#00c44f', '#ff4fd8', '#a78bfa', '#fb923c', '#ffffff'];
function launchConfetti(count = 60, duration = 3500) {
  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      const color = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
      const size = 8 + Math.random() * 14;
      const dur = 1.8 + Math.random() * 2;
      const drift = (Math.random() - 0.5) * 400;
      piece.style.cssText = `
        width:${size}px; height:${size}px;
        left:${Math.random() * 100}vw;
        top:-20px;
        background:${color};
        border: 2px solid rgba(0,0,0,0.2);
        border-radius:${Math.random() > 0.5 ? '50%' : '2px'};
        --dur:${dur}s;
        --delay:0s;
        --drift:${drift}px;
      `;
      document.body.appendChild(piece);
      setTimeout(() => piece.remove(), dur * 1000 + 100);
    }, Math.random() * (duration / 2));
  }
}


const GAME_EMOJIS = ['🎉', '🏆', '⭐', '🔥', '💥', '✨', '🎊', '🌟', '💯', '🎮', '👑', '⚡'];
function launchEmojiParticles(emojis = GAME_EMOJIS, count = 15) {
  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      const el = document.createElement('div');
      el.className = 'emoji-particle';
      const emoji = emojis[Math.floor(Math.random() * emojis.length)];
      el.textContent = emoji;
      const dur = 2.5 + Math.random() * 2;
      const size = 1.5 + Math.random() * 1.5;
      el.style.cssText = `
        left: ${Math.random() * 90}vw;
        font-size: ${size}rem;
        --dur: ${dur}s;
        --delay: 0s;
        --wobble1: ${(Math.random() - 0.5) * 100}px;
        --wobble2: ${(Math.random() - 0.5) * 120}px;
        --wobble3: ${(Math.random() - 0.5) * 80}px;
      `;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), dur * 1000 + 200);
    }, Math.random() * 800);
  }
}


function showScorePop(x, y, text) {
  const el = document.createElement('div');
  el.className = 'score-pop';
  el.textContent = text;
  el.style.left = (x - 30) + 'px';
  el.style.top = (y - 20) + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1300);
}


function screenShake() {
  const screen = document.querySelector('.screen.active');
  if (!screen) return;
  screen.classList.add('screen-shake');
  setTimeout(() => screen.classList.remove('screen-shake'), 600);
}




const _origGoTo = goTo;
window.goTo = function (id) {
  _origGoTo(id);
  
  if (id === 'screen-lobby-player') {
    setTimeout(() => {
      launchEmojiParticles(['🎉', '✅', '🥳', '🎊', '⭐'], 12);
      launchConfetti(40, 2000);
    }, 300);
  }
  if (id === 'screen-game-ended') {
    setTimeout(() => {
      launchConfetti(80, 4000);
      launchEmojiParticles(['🏁', '🏆', '⭐', '🔥', '💯', '🎉'], 20);
    }, 400);
  }
  if (id === 'screen-podium') {
    setTimeout(() => {
      launchConfetti(120, 6000);
      launchEmojiParticles(['🥇', '🥈', '🥉', '👑', '🏆', '✨', '🌟', '⭐'], 30);
    }, 1500);
  }
  if (id === 'screen-round-scores') {
    setTimeout(() => launchEmojiParticles(['📊', '✨', '⭐', '🔥'], 8), 500);
  }
};


const _origPlayerAnswer = window.playerAnswer;
if (typeof _origPlayerAnswer === 'function') {
  window.playerAnswer = function (num) {
    _origPlayerAnswer(num);
    
    const btn = document.querySelectorAll('.player-ans-btn')[num - 1];
    if (btn) {
      const rect = btn.getBoundingClientRect();
      showScorePop(rect.left + rect.width / 2, rect.top + rect.height / 2, '✓');
    }
  };
}


const _origHandleGameState = window.handleGameState;
window.handleGameState = function (payload) {
  if (typeof _origHandleGameState === 'function') _origHandleGameState(payload);
  if (payload && payload.status === 'reveal') {
    
    setTimeout(() => {
      const banner = document.getElementById('feedback-banner');
      if (banner && banner.classList.contains('feedback-correct')) {
        launchEmojiParticles(['✅', '⭐', '🔥', '💯', '🎉'], 8);
        launchConfetti(25, 1500);
      } else if (banner && banner.classList.contains('feedback-incorrect')) {
        screenShake();
        launchEmojiParticles(['😢', '💔', '❌'], 5);
      }
    }, 600);
  }
};


(function ambientParticles() {
  const AMBIENT = ['✨', '⭐', '💫'];
  function emitOne() {
    const screen = document.querySelector('.screen.active');
    if (!screen) return;
    const el = document.createElement('div');
    el.className = 'emoji-particle';
    el.textContent = AMBIENT[Math.floor(Math.random() * AMBIENT.length)];
    const dur = 2 + Math.random() * 2;
    el.style.cssText = `
      left: ${Math.random() * 90}vw;
      font-size: ${0.8 + Math.random() * 0.8}rem;
      opacity: 0.6;
      --dur: ${dur}s;
      --delay: 0s;
      --wobble1: ${(Math.random() - 0.5) * 60}px;
      --wobble2: ${(Math.random() - 0.5) * 80}px;
      --wobble3: ${(Math.random() - 0.5) * 50}px;
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), dur * 1000 + 200);
  }
  setInterval(emitOne, 800);
})();