// ─────────────────────────────────────────────────────────────
//  합동 비서실 · Shared Assistant Office
//  공유 보드 / 공동 할 일 / 아이들 보드 / 비서 현황
//  저장소: Firebase Realtime Database 또는 localStorage(로컬 모드)
// ─────────────────────────────────────────────────────────────
import { FIREBASE_CONFIG } from './firebase-config.js';

const DEFAULT_ENTRY_CODE = 'office2026';   // 기본 입장 코드 (설정에서 변경 가능)
const FB_SDK = 'https://www.gstatic.com/firebasejs/10.12.2';

const K = {
  code: 'so.entry-code',
  state: 'so.state',
  fb: 'so.firebase-config',
  me: 'so.me',
  unlocked: 'so.unlocked',
  chatAuthor: 'so.chat-author'
};

const CATEGORY_ICON = { '공지': '📢', '요청': '🙋', '메모': '📝' };
const KID_ICON = { '준비물': '🎒', '일정': '📅', '전달': '📣' };

// 채팅: 기본 작성자 후보와 직접 입력 항목
const CHAT_AUTHORS = ['정석 비서', '미경 비서', '정석', '미경'];
const CHAT_CUSTOM = '직접 입력';

// ── 작은 도우미들 ─────────────────────────────────────────────
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const uid = () => 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const norm = (v) => String(v ?? '').trim().toLowerCase();
const pad2 = (n) => String(n).padStart(2, '0');

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - Number(ts);
  if (diff < 0) return '방금 전';
  if (diff < 60e3) return '방금 전';
  if (diff < 3600e3) return `${Math.floor(diff / 60e3)}분 전`;
  if (diff < 86400e3) return `${Math.floor(diff / 3600e3)}시간 전`;
  if (diff < 7 * 86400e3) return `${Math.floor(diff / 86400e3)}일 전`;
  const d = new Date(Number(ts));
  return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`;
}

function dateLabel(dateStr) {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const diff = Math.round((d - today) / 86400e3);
  if (diff === 0) return { text: '오늘', soon: true };
  if (diff === 1) return { text: '내일', soon: true };
  if (diff === -1) return { text: '어제', soon: false };
  if (diff < 0) return { text: `${-diff}일 지남`, soon: true };
  if (diff <= 7) return { text: `D-${diff}`, soon: diff <= 2 };
  return { text: `${d.getMonth() + 1}/${d.getDate()}`, soon: false };
}

// ── 채팅 도우미 ─────────────────────────────────────────────
function hhmm(ts) {
  const d = new Date(Number(ts) || Date.now());
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function dayKey(ts) {
  const d = new Date(Number(ts) || Date.now());
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function dayLabel(key) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${key}T00:00:00`);
  if (Number.isNaN(d.getTime())) return key;
  const diff = Math.round((d - today) / 86400e3);
  if (diff === 0) return '오늘';
  if (diff === -1) return '어제';
  if (diff === 1) return '내일';
  return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`;
}

function avatarClass(name) {
  const s = String(name || '');
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.codePointAt(0)) % 97;
  return ['', 'a2', 'a3', 'a4'][h % 4];
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

// ── 설정 값 ──────────────────────────────────────────────────
const entryCode = () => localStorage.getItem(K.code) || DEFAULT_ENTRY_CODE;
const myName = () => localStorage.getItem(K.me) || '정석 비서';
const setMyName = (v) => localStorage.setItem(K.me, String(v).trim() || '정석 비서');

function savedFbConfig() {
  try {
    const raw = localStorage.getItem(K.fb);
    if (!raw) return null;
    const cfg = JSON.parse(raw);
    return cfg && cfg.databaseURL ? cfg : null;
  } catch { return null; }
}
function codeFbConfig() {
  return FIREBASE_CONFIG && FIREBASE_CONFIG.databaseURL ? FIREBASE_CONFIG : null;
}
const fbConfig = () => savedFbConfig() || codeFbConfig();

// ── 앱 상태 ──────────────────────────────────────────────────
const store = { mode: 'local', data: {}, backend: null, ready: false };
const ui = { view: 'board', boardCat: '전체', todoFilter: 'all', kidTab: 'all' };
const chatState = { lastKey: null, authorSig: '' };

const myKey = (name = myName()) =>
  'u_' + String(name).trim().replace(/[.#$\[\]\/]/g, '_').slice(0, 40);

// ── 초기 예시 데이터 (개인정보 없음 · 첫 실행 때만) ──────────────
function seedState() {
  const now = Date.now();
  const d = 86400e3;
  const day = (offset) => {
    const t = new Date(now + offset * d);
    return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
  };
  return {
    meta: { version: 1, createdAt: now },
    children: {
      c1: { name: '첫째', emoji: '🧒', createdAt: now },
      c2: { name: '둘째', emoji: '👦', createdAt: now },
      c3: { name: '셋째', emoji: '🧸', createdAt: now }
    },
    board: {
      b1: {
        category: '공지', author: '정석 비서', pinned: true,
        text: '합동 비서실이 열렸습니다. 이 보드는 여러 비서와 가족이 함께 보는 공유 공간입니다.\n공지 · 요청 · 메모를 자유롭게 남겨 주세요.',
        createdAt: now - 3 * d, updatedAt: now - 3 * d
      },
      b2: {
        category: '요청', author: '직접 작성', pinned: false,
        text: '이번 주 가족 일정 정리 부탁드립니다. 확정되면 공지로 올려 주세요.',
        createdAt: now - 2 * d, updatedAt: now - 2 * d
      },
      b3: {
        category: '메모', author: '미경 비서', pinned: false,
        text: '장보기 목록: 우유 · 계란 · 과일 · 아이 간식',
        createdAt: now - d, updatedAt: now - d
      }
    },
    todos: {
      t1: { title: '이번 주 병원 예약 시간 확인', assignee: '정석 비서', due: day(2), priority: '보통', done: false, createdAt: now - 2 * d },
      t2: { title: '아이들 체육복·실내화 챙기기', assignee: '미경 비서', due: day(1), priority: '높음', done: false, createdAt: now - d },
      t3: { title: '비서실 입장 코드 가족에게 공유', assignee: '정석 비서', due: '', priority: '낮음', done: true, createdAt: now - 3 * d }
    },
    kids: {
      k1: { child: 'c1', type: '준비물', text: '체육복 · 실내화', date: day(1), done: false, createdAt: now - d },
      k2: { child: 'c2', type: '일정', text: '학원 6시 (수학)', date: day(0), done: false, createdAt: now - d },
      k3: { child: 'c3', type: '전달', text: '내일 물병 가져가기', date: '', done: false, createdAt: now - d }
    },
    status: {}
  };
}

// ── 저장소: 로컬 모드 ────────────────────────────────────────
function connectLocal() {
  let bc = null;
  try { bc = new BroadcastChannel('shared-office'); } catch { /* 미지원 브라우저 */ }

  const read = () => {
    try {
      const raw = localStorage.getItem(K.state);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  };
  const write = (d) => localStorage.setItem(K.state, JSON.stringify(d));
  const ensure = () => {
    const cur = read();
    if (!cur || !cur.meta) {
      const seeded = seedState();
      write(seeded);
      return seeded;
    }
    return cur;
  };
  const apply = (d) => { store.data = d || {}; store.ready = true; renderAll(); };
  const broadcast = (d) => { if (bc) bc.postMessage({ type: 'state', state: d }); };

  apply(ensure());

  window.addEventListener('storage', (e) => {
    if (e.key === K.state) apply(read() || {});
  });
  if (bc) bc.onmessage = (e) => { if (e.data && e.data.type === 'state') apply(e.data.state); };

  store.mode = 'local';
  store.backend = {
    add: async (path, item) => {
      const d = ensure();
      const id = uid();
      d[path] = d[path] || {};
      d[path][id] = item;
      write(d); apply(d); broadcast(d);
      return id;
    },
    update: async (path, id, patch) => {
      const d = ensure();
      d[path] = d[path] || {};
      d[path][id] = { ...(d[path][id] || {}), ...patch };
      write(d); apply(d); broadcast(d);
    },
    put: async (path, id, value) => {
      const d = ensure();
      d[path] = d[path] || {};
      d[path][id] = value;
      write(d); apply(d); broadcast(d);
    },
    remove: async (path, id) => {
      const d = ensure();
      if (!d[path] || !(id in d[path])) return;
      delete d[path][id];
      write(d); apply(d); broadcast(d);
    }
  };
  updateConnBadge();
}

// ── 저장소: Firebase Realtime Database ──────────────────────
async function connectFirebase(config) {
  const appMod = await import(`${FB_SDK}/firebase-app.js`);
  const dbMod = await import(`${FB_SDK}/firebase-database.js`);

  let app = appMod.getApps().find((a) => a.name === 'shared-office');
  if (!app) app = appMod.initializeApp(config, 'shared-office');
  const db = dbMod.getDatabase(app);
  const rootRef = dbMod.ref(db, '/');

  let seeded = false;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('연결 시간이 초과되었습니다. databaseURL과 DB 규칙을 확인해 주세요.'));
    }, 12000);

    dbMod.onValue(rootRef, (snap) => {
      clearTimeout(timer);
      const val = snap.val();
      if (!snap.exists() && !seeded) {
        seeded = true;
        const initial = seedState();
        dbMod.set(rootRef, initial).catch((e) => toast('초기 데이터 생성 실패: ' + e.message));
        store.data = initial;
      } else {
        store.data = val || {};
      }
      store.ready = true;
      renderAll();
      resolve();
    }, (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  store.mode = 'firebase';
  store.backend = {
    add: async (path, item) => {
      const r = await dbMod.push(dbMod.ref(db, path), item);
      return r.key;
    },
    update: async (path, id, patch) => {
      await dbMod.update(dbMod.ref(db, `${path}/${id}`), patch);
    },
    put: async (path, id, value) => {
      await dbMod.set(dbMod.ref(db, `${path}/${id}`), value);
    },
    remove: async (path, id) => {
      await dbMod.remove(dbMod.ref(db, `${path}/${id}`));
    }
  };
  updateConnBadge();
}

async function startStore() {
  const cfg = fbConfig();
  if (cfg) {
    try {
      await connectFirebase(cfg);
      return;
    } catch (err) {
      console.warn('[shared-office] Firebase 연결 실패:', err);
      toast('실시간 DB 연결에 실패해 로컬 모드로 시작합니다');
    }
  }
  connectLocal();
}

// ── 쓰기 래퍼 ───────────────────────────────────────────────
async function addItem(path, item) {
  try { return await store.backend.add(path, item); }
  catch (e) { toast('저장 실패: ' + e.message); throw e; }
}
async function updateItem(path, id, patch) {
  try { await store.backend.update(path, id, patch); }
  catch (e) { toast('수정 실패: ' + e.message); throw e; }
}
async function removeItem(path, id) {
  try { await store.backend.remove(path, id); }
  catch (e) { toast('삭제 실패: ' + e.message); throw e; }
}

const entries = (path) => Object.entries(store.data[path] || {}).map(([id, v]) => ({ id, ...v }));

// ── 렌더링 ──────────────────────────────────────────────────
function renderAll() {
  if (!store.ready) return;
  renderBoard();
  renderTodos();
  renderKids();
  renderKidTabs();
  renderChildEditor();
  renderChatAuthors();
  renderChat();
  renderStatus();
  updateConnBadge();
}

function emptyBox(icon, title, desc) {
  return `<div class="empty"><b>${icon}</b><span>${esc(title)}<br>${esc(desc)}</span></div>`;
}

/* ── 공유 보드 ─────────────────────────────── */
function renderBoard() {
  const host = $('#boardList');
  const items = entries('board')
    .filter((v) => ui.boardCat === '전체' || v.category === ui.boardCat)
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.createdAt || 0) - (a.createdAt || 0));

  if (!items.length) {
    host.innerHTML = emptyBox('📌', '아직 글이 없어요', '위에서 첫 공지를 남겨 보세요.');
    return;
  }
  const me = norm(myName());
  host.innerHTML = items.map((v) => {
    const mine = norm(v.author) === me;
    const edited = v.updatedAt && v.createdAt && v.updatedAt - v.createdAt > 60000;
    return `<article class="item ${v.pinned ? 'pinned' : ''}" data-id="${esc(v.id)}">
      <div class="item-head">
        ${v.pinned ? '<span class="tag pin">📌 고정</span>' : ''}
        <span class="tag cat-${esc(v.category || '메모')}">${CATEGORY_ICON[v.category] || '📝'} ${esc(v.category || '메모')}</span>
        <span class="tag author ${mine ? 'mine' : ''}">${esc(v.author || '익명')}</span>
      </div>
      <p class="item-text">${esc(v.text)}</p>
      <div class="item-foot">
        <span>${esc(timeAgo(v.createdAt))}${edited ? ' · 수정됨' : ''}</span>
        <span class="item-actions">
          <button type="button" data-act="pin" title="${v.pinned ? '고정 해제' : '상단 고정'}">${v.pinned ? '📌' : '📍'}</button>
          <button type="button" data-act="edit" title="수정">✏️</button>
          <button type="button" data-act="del" title="삭제">🗑️</button>
        </span>
      </div>
    </article>`;
  }).join('');
}

/* ── 공동 할 일 ────────────────────────────── */
function renderTodos() {
  const host = $('#todoList');
  const all = entries('todos');
  const list = all
    .filter((v) => ui.todoFilter === 'all' || (ui.todoFilter === 'open' ? !v.done : !!v.done));

  if (!list.length) {
    host.innerHTML = all.length
      ? emptyBox('✅', ui.todoFilter === 'done' ? '완료된 일이 없어요' : '남은 일이 없어요', '필터를 바꿔 보세요.')
      : emptyBox('✅', '할 일이 없어요', '위에서 첫 할 일을 추가해 보세요.');
    return;
  }

  const order = { '높음': 0, '보통': 1, '낮음': 2 };
  host.innerHTML = list
    .sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0)
      || (order[a.priority] ?? 1) - (order[b.priority] ?? 1)
      || (a.due || '9999').localeCompare(b.due || '9999'))
    .map((v) => {
      const due = dateLabel(v.due);
      return `<article class="item" data-id="${esc(v.id)}">
        <div class="todo">
          <button class="box ${v.done ? 'on' : ''}" type="button" data-act="toggle" aria-label="완료 토글">✓</button>
          <div class="body">
            <p class="title ${v.done ? 'done' : ''}">${esc(v.title)}</p>
            <div class="meta">
              <span class="tag author ${norm(v.assignee) === norm(myName()) ? 'mine' : ''}">${esc(v.assignee || '미지정')}</span>
              <span class="prio ${esc(v.priority || '보통')}">${esc(v.priority || '보통')}</span>
              ${due ? `<span class="due ${due.soon && !v.done ? 'soon' : ''}">${esc(due.text)}</span>` : ''}
              <span class="item-actions" style="margin-left:auto">
                <button type="button" data-act="del" title="삭제">🗑️</button>
              </span>
            </div>
          </div>
        </div>
      </article>`;
    }).join('');
}

/* ── 아이들 보드 ───────────────────────────── */
function renderKidTabs() {
  const host = $('#kidTabs');
  const kids = entries('children').sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  host.innerHTML = [`<button class="chip ${ui.kidTab === 'all' ? 'active' : ''}" data-kid="all" type="button">전체</button>`]
    .concat(kids.map((c) => `<button class="chip ${ui.kidTab === c.id ? 'active' : ''}" data-kid="${esc(c.id)}" type="button">${esc(c.emoji || '🧒')} ${esc(c.name)}</button>`))
    .join('');
  host.dataset.kids = kids.map((c) => c.id).join(',');

  const sel = $('#kidChild');
  const prev = sel.value;
  sel.innerHTML = kids.map((c) => `<option value="${esc(c.id)}">${esc(c.emoji || '🧒')} ${esc(c.name)}</option>`).join('');
  if (kids.some((c) => c.id === prev)) sel.value = prev;
}

function renderKids() {
  const host = $('#kidList');
  const kids = Object.fromEntries(entries('children').map((c) => [c.id, c]));
  const all = entries('kids');
  const list = all
    .filter((v) => ui.kidTab === 'all' || v.child === ui.kidTab)
    .sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0)
      || (a.date || '9999').localeCompare(b.date || '9999')
      || (b.createdAt || 0) - (a.createdAt || 0));

  if (!list.length) {
    host.innerHTML = emptyBox('🧒', '아직 카드가 없어요', '준비물 · 일정 · 전달사항을 추가해 보세요.');
    return;
  }
  host.innerHTML = list.map((v) => {
    const child = kids[v.child];
    const due = dateLabel(v.date);
    return `<article class="item kid-card" data-id="${esc(v.id)}">
      <div class="todo">
        <button class="box ${v.done ? 'on' : ''}" type="button" data-act="toggle" aria-label="완료 토글">✓</button>
        <div class="body">
          <div class="item-head" style="margin-bottom:6px">
            <span class="ktype ${esc(v.type || '준비물')}">${KID_ICON[v.type] || '🎒'} ${esc(v.type || '준비물')}</span>
            <span class="tag author">${esc(child ? `${child.emoji || '🧒'} ${child.name}` : '공통')}</span>
          </div>
          <p class="title ${v.done ? 'done' : ''}">${esc(v.text)}</p>
          <div class="meta">
            ${due ? `<span class="due ${due.soon && !v.done ? 'soon' : ''}">${esc(due.text)}</span>` : ''}
            ${v.date ? `<span class="due">${esc(v.date.slice(5).replace('-', '/'))}</span>` : ''}
            <span class="item-actions" style="margin-left:auto">
              <button type="button" data-act="del" title="삭제">🗑️</button>
            </span>
          </div>
        </div>
      </div>
    </article>`;
  }).join('');
}

function renderChildEditor() {
  const host = $('#childEditor');
  if (host.contains(document.activeElement)) return;   // 입력 중에는 다시 그리지 않음
  const kids = entries('children').sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  host.innerHTML = kids.map((c) => `<div class="child-row" data-id="${esc(c.id)}">
      <input class="emoji" data-field="emoji" value="${esc(c.emoji || '🧒')}" maxlength="4" aria-label="이모지">
      <input data-field="name" value="${esc(c.name)}" placeholder="이름" aria-label="이름">
      <button class="btn ghost danger" type="button" data-act="del-child">삭제</button>
    </div>`).join('')
    + `<div class="row"><button class="btn ghost" type="button" id="addChild">+ 자녀 추가</button></div>`;
}

/* ── 채팅 ─────────────────────────────────── */
function chatAuthorNames() {
  const names = [];
  const push = (n) => {
    const v = String(n || '').trim();
    if (v && v !== CHAT_CUSTOM && !names.some((x) => norm(x) === norm(v))) names.push(v);
  };
  push(localStorage.getItem(K.chatAuthor));
  push(myName());
  CHAT_AUTHORS.forEach(push);
  entries('status').forEach((s) => push(s.name));
  return names;
}

function currentChatAuthor() {
  const custom = $('#chatAuthorCustom');
  if (custom && !custom.hidden && custom.value.trim()) return custom.value.trim();
  return $('#chatAuthor')?.value || myName();
}

function renderChatAuthors() {
  const sel = $('#chatAuthor');
  if (!sel) return;
  const names = chatAuthorNames();
  const custom = $('#chatAuthorCustom');
  const prev = sel.value || localStorage.getItem(K.chatAuthor) || myName();
  const sig = `${names.join('|')}#${prev}`;
  if (sig !== chatState.authorSig) {
    chatState.authorSig = sig;
    sel.innerHTML = names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('')
      + `<option value="${CHAT_CUSTOM}">✏️ ${CHAT_CUSTOM}</option>`;
    sel.value = (prev === CHAT_CUSTOM || names.includes(prev)) ? prev : (names[0] || myName());
  }
  if (custom) custom.hidden = sel.value !== CHAT_CUSTOM;
}

function renderChat() {
  const host = $('#chatList');
  if (!host) return;
  const list = entries('chat').sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const me = norm(currentChatAuthor());
  const atBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 72;

  if (!list.length) {
    host.innerHTML = '<div class="empty chat-empty"><b>💬</b><span>아직 대화가 없어요<br>첫 메시지를 남겨 보세요.</span></div>';
    chatState.lastKey = null;
    return;
  }

  let lastDay = '';
  let prevAuthor = '';
  const rows = [];
  list.forEach((v) => {
    const ts = Number(v.createdAt) || 0;
    const key = dayKey(ts);
    if (key !== lastDay) {
      rows.push(`<div class="chat-day">${esc(dayLabel(key))}</div>`);
      lastDay = key;
      prevAuthor = '';
    }
    const mine = norm(v.author) === me;
    const sameRun = !!prevAuthor && norm(prevAuthor) === norm(v.author);
    const initial = String(v.author || '?').trim().slice(0, 1) || '?';
    rows.push(`<div class="msg ${mine ? 'mine' : ''}" data-id="${esc(v.id)}">
      ${mine ? '' : `<div class="msg-avatar ${avatarClass(v.author)}" aria-hidden="true">${esc(initial)}</div>`}
      <div class="msg-body">
        ${mine || sameRun ? '' : `<span class="msg-author">${esc(v.author || '익명')}</span>`}
        <div class="bubble">${esc(v.text)}</div>
        <div class="msg-meta">
          <span>${esc(hhmm(ts))}</span>
          ${mine ? '<button type="button" data-act="del" title="이 메시지 지우기" aria-label="메시지 삭제">🗑️</button>' : ''}
        </div>
      </div>
    </div>`);
    prevAuthor = v.author || '';
  });
  host.innerHTML = rows.join('');

  const last = list[list.length - 1];
  const changed = last.id !== chatState.lastKey;
  chatState.lastKey = last.id;
  if (changed && (atBottom || norm(last.author) === me)) host.scrollTop = host.scrollHeight;
}

/* ── 비서 현황 ─────────────────────────────── */
function renderStatus() {
  const host = $('#statusList');
  const list = entries('status')
    .sort((a, b) => (b.lastSeen || b.updatedAt || 0) - (a.lastSeen || a.updatedAt || 0));
  if (!list.length) {
    host.innerHTML = emptyBox('👥', '아직 등록된 비서가 없어요', '위에서 이름과 상태 한 줄을 남겨 보세요.');
    return;
  }
  const palette = ['', 'a2', 'a3', 'a4'];
  host.innerHTML = list.map((v, i) => {
    const live = Date.now() - Number(v.lastSeen || 0) < 3 * 60e3;
    const initial = String(v.name || '?').trim().slice(0, 1);
    return `<article class="status-item item" data-id="${esc(v.id)}">
      <div class="avatar ${palette[i % 4]}">${esc(initial)}</div>
      <div style="flex:1;min-width:0">
        <div class="item-head" style="margin-bottom:4px">
          <span class="tag author ${norm(v.name) === norm(myName()) ? 'mine' : ''}">${esc(v.name || '이름 없음')}</span>
          ${live ? '<span class="live-dot" style="font-size:11px">접속 중</span>' : `<span class="hint">${esc(timeAgo(v.lastSeen))} 접속</span>`}
        </div>
        <p class="status-line">${esc(v.line || '상태 메시지 없음')}</p>
        <div class="status-meta"><span>업데이트 ${esc(timeAgo(v.updatedAt || v.lastSeen))}</span></div>
      </div>
      <span class="item-actions"><button type="button" data-act="del" title="삭제">🗑️</button></span>
    </article>`;
  }).join('');
}

function updateConnBadge() {
  const badge = $('#connBadge');
  const text = $('#connText');
  if (!badge || !text) return;
  if (store.mode === 'firebase') {
    badge.classList.add('online');
    text.textContent = '실시간 DB 연결됨';
    $('#modeFooter').textContent = 'Firebase Realtime Database · 실시간 동기화';
  } else {
    badge.classList.remove('online');
    text.textContent = '실시간 DB 미연결 · 로컬 모드';
    $('#modeFooter').textContent = '로컬 모드 · 이 기기에만 저장';
  }
}

// ── 잠금 ────────────────────────────────────────────────────
function showApp() {
  $('#lockScreen').hidden = true;
  $('#app').hidden = false;
}

function lockApp() {
  sessionStorage.removeItem(K.unlocked);
  $('#app').hidden = true;
  $('#lockScreen').hidden = false;
  $('#lockCode').value = '';
  $('#lockError').textContent = '';
}

async function boot() {
  // 이름 기본값 반영
  $$('#boardAuthor, #todoAssignee, #statusName').forEach((el) => { el.value = myName(); });

  if (sessionStorage.getItem(K.unlocked) === '1') {
    showApp();
    await startStore();
  }
}

// ── 이벤트: 잠금 화면 ────────────────────────────────────────
$('#lockForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#lockCode');
  if (norm(input.value) === norm(entryCode())) {
    sessionStorage.setItem(K.unlocked, '1');
    $('#lockError').textContent = '';
    showApp();
    startStore();
  } else {
    $('#lockError').textContent = '입장 코드가 맞지 않습니다.';
    input.value = '';
    input.focus();
    $('.lock-card').classList.add('shake');
    setTimeout(() => $('.lock-card').classList.remove('shake'), 400);
  }
});

$('#lockBtn').addEventListener('click', lockApp);

// ── 이벤트: 탭 ──────────────────────────────────────────────
$('#tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  ui.view = btn.dataset.view;
  $$('.tab').forEach((t) => t.classList.toggle('active', t === btn));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${ui.view}`));
  if (ui.view === 'chat') {
    requestAnimationFrame(() => {
      const list = $('#chatList');
      if (list) list.scrollTop = list.scrollHeight;
    });
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ── 이벤트: 공유 보드 ───────────────────────────────────────
$('#boardForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('#boardText').value.trim();
  if (!text) return;
  const now = Date.now();
  await addItem('board', {
    category: $('#boardCategory').value,
    author: $('#boardAuthor').value.trim() || myName(),
    pinned: $('#boardPinned').checked,
    text,
    createdAt: now,
    updatedAt: now
  });
  $('#boardText').value = '';
  $('#boardPinned').checked = false;
  toast('보드에 올렸습니다');
});

$('#boardList').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.closest('.item')?.dataset.id;
  if (!id) return;
  const item = (store.data.board || {})[id];
  if (!item) return;

  if (btn.dataset.act === 'pin') {
    await updateItem('board', id, { pinned: !item.pinned, updatedAt: Date.now() });
  } else if (btn.dataset.act === 'edit') {
    openEdit(id);
  } else if (btn.dataset.act === 'del') {
    if (confirm('이 글을 삭제할까요?')) await removeItem('board', id);
  }
});

$('#boardFilters').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  ui.boardCat = chip.dataset.cat;
  $$('#boardFilters .chip').forEach((c) => c.classList.toggle('active', c === chip));
  renderBoard();
});

/* 편집 모달 */
let editingId = null;
function openEdit(id) {
  const item = (store.data.board || {})[id];
  if (!item) return;
  editingId = id;
  $('#editCategory').value = item.category || '메모';
  $('#editAuthor').value = item.author || myName();
  $('#editPinned').checked = !!item.pinned;
  $('#editText').value = item.text || '';
  openModal('#editModal');
  setTimeout(() => $('#editText').focus(), 80);
}

$('#editSave').addEventListener('click', async () => {
  if (!editingId) return;
  const text = $('#editText').value.trim();
  if (!text) { toast('내용을 입력하세요'); return; }
  await updateItem('board', editingId, {
    category: $('#editCategory').value,
    author: $('#editAuthor').value.trim() || myName(),
    pinned: $('#editPinned').checked,
    text,
    updatedAt: Date.now()
  });
  closeModal('#editModal');
  editingId = null;
  toast('수정했습니다');
});

/* ── 이벤트: 공동 할 일 ───────────────────────────────────── */
$('#todoForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = $('#todoTitle').value.trim();
  if (!title) return;
  await addItem('todos', {
    title,
    assignee: $('#todoAssignee').value.trim() || myName(),
    due: $('#todoDue').value || '',
    priority: $('#todoPriority').value,
    done: false,
    createdAt: Date.now()
  });
  $('#todoTitle').value = '';
  $('#todoDue').value = '';
  toast('할 일을 추가했습니다');
});

$('#todoFilters').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  ui.todoFilter = chip.dataset.filter;
  $$('#todoFilters .chip').forEach((c) => c.classList.toggle('active', c === chip));
  renderTodos();
});

$('#todoList').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.closest('.item')?.dataset.id;
  if (!id) return;
  const item = (store.data.todos || {})[id];
  if (!item) return;

  if (btn.dataset.act === 'toggle') {
    await updateItem('todos', id, { done: !item.done, doneAt: !item.done ? Date.now() : null });
  } else if (btn.dataset.act === 'del') {
    if (confirm(`"${item.title}" 할 일을 삭제할까요?`)) await removeItem('todos', id);
  }
});

/* ── 이벤트: 아이들 보드 ──────────────────────────────────── */
$('#kidForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('#kidText').value.trim();
  if (!text) return;
  if (!$('#kidChild').value) { toast('먼저 자녀 탭을 추가하세요'); return; }
  await addItem('kids', {
    child: $('#kidChild').value,
    type: $('#kidType').value,
    text,
    date: $('#kidDate').value || '',
    done: false,
    createdAt: Date.now()
  });
  $('#kidText').value = '';
  $('#kidDate').value = '';
  toast('카드를 추가했습니다');
});

$('#kidTabs').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  ui.kidTab = chip.dataset.kid;
  renderKidTabs();
  renderKids();
});

$('#kidList').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.closest('.item')?.dataset.id;
  if (!id) return;
  const item = (store.data.kids || {})[id];
  if (!item) return;

  if (btn.dataset.act === 'toggle') {
    await updateItem('kids', id, { done: !item.done, doneAt: !item.done ? Date.now() : null });
  } else if (btn.dataset.act === 'del') {
    if (confirm('이 카드를 삭제할까요?')) await removeItem('kids', id);
  }
});

$('#childEditor').addEventListener('change', async (e) => {
  const field = e.target.dataset.field;
  if (!field) return;
  const row = e.target.closest('.child-row');
  if (!row) return;
  await updateItem('children', row.dataset.id, { [field]: e.target.value.trim() || '이름' });
});

$('#childEditor').addEventListener('click', async (e) => {
  if (e.target.id === 'addChild') {
    await addItem('children', { name: `자녀 ${entries('children').length + 1}`, emoji: '🧒', createdAt: Date.now() });
    return;
  }
  const btn = e.target.closest('[data-act="del-child"]');
  if (!btn) return;
  const row = btn.closest('.child-row');
  const id = row?.dataset.id;
  if (!id) return;
  const child = (store.data.children || {})[id];
  if (!confirm(`"${child?.name || '이 자녀'}" 탭과 이 탭의 카드를 모두 삭제할까요?`)) return;
  const cards = entries('kids').filter((k) => k.child === id);
  for (const card of cards) await removeItem('kids', card.id);
  await removeItem('children', id);
  if (ui.kidTab === id) ui.kidTab = 'all';
  toast('삭제했습니다');
});

/* ── 이벤트: 채팅 ── */
function growChatInput() {
  const el = $('#chatInput');
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
}

async function sendChat() {
  const input = $('#chatInput');
  const text = input.value.trim();
  if (!text) return;
  if (!store.ready || !store.backend) { toast('잠시 후 다시 시도해 주세요'); return; }
  const sel = $('#chatAuthor');
  const author = currentChatAuthor();
  if (!author) { toast('작성자를 선택하거나 이름을 입력하세요'); return; }
  if (sel && sel.value !== CHAT_CUSTOM) localStorage.setItem(K.chatAuthor, sel.value);
  await addItem('chat', { author, text, createdAt: Date.now() });
  input.value = '';
  growChatInput();
  input.focus();
}

$('#chatForm').addEventListener('submit', (e) => {
  e.preventDefault();
  sendChat();
});

$('#chatInput').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.shiftKey) return;
  if (e.isComposing || e.keyCode === 229) return;   // 한글 조합 중의 Enter 는 무시
  e.preventDefault();
  sendChat();
});

$('#chatInput').addEventListener('input', growChatInput);

$('#chatAuthor').addEventListener('change', () => {
  const sel = $('#chatAuthor');
  const custom = $('#chatAuthorCustom');
  const isCustom = sel.value === CHAT_CUSTOM;
  custom.hidden = !isCustom;
  if (isCustom) {
    custom.value = '';
    custom.focus();
  } else {
    localStorage.setItem(K.chatAuthor, sel.value);
  }
  renderChat();
});

$('#chatAuthorCustom').addEventListener('input', () => renderChat());

$('#chatList').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act="del"]');
  if (!btn) return;
  const id = btn.closest('.msg')?.dataset.id;
  if (!id) return;
  const item = (store.data.chat || {})[id];
  if (!item) return;
  if (norm(item.author) !== norm(currentChatAuthor())) {
    toast('내가 보낸 메시지만 지울 수 있어요');
    return;
  }
  if (!confirm('이 메시지를 지울까요?')) return;
  await removeItem('chat', id);
  toast('메시지를 지웠습니다');
});

/* ── 이벤트: 비서 현황 ── */
$('#statusForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#statusName').value.trim() || myName();
  const line = $('#statusLine').value.trim();
  if (!line) return;
  if (!store.backend) { toast('잠시 후 다시 시도해 주세요'); return; }
  const now = Date.now();
  await store.backend.put('status', myKey(name), { name, line, updatedAt: now, lastSeen: now });
  setMyName(name);
  $('#statusLine').value = '';
  toast('상태를 업데이트했습니다');
});

$('#statusList').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act="del"]');
  if (!btn) return;
  const id = btn.closest('.item')?.dataset.id;
  if (!id) return;
  if (confirm('이 현황 항목을 삭제할까요?')) await removeItem('status', id);
});

/* ── 접속 하트비트 ────────────────────────────────────────── */
let heartbeat = null;
function startHeartbeat() {
  const beat = () => {
    if (document.hidden || !store.ready || !store.backend) return;
    store.backend.update('status', myKey(), { name: myName(), lastSeen: Date.now() })
      .catch(() => { /* 조용히 무시 */ });
  };
  beat();
  clearInterval(heartbeat);
  heartbeat = setInterval(beat, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) beat(); });
}

/* ── 모달 공통 ────────────────────────────────────────────── */
function openModal(sel) { $(sel).hidden = false; }
function closeModal(sel) {
  $(sel).hidden = true;
  if (sel === '#settingsModal') $('#connBadge').blur();
}

document.addEventListener('click', (e) => {
  const closer = e.target.closest('[data-close]');
  if (closer) {
    const modal = closer.closest('.modal');
    if (modal) modal.hidden = true;
  }
  if (e.target.classList.contains('modal')) e.target.hidden = true;
});

/* ── 설정 ─────────────────────────────────────────────────── */
$('#settingsBtn').addEventListener('click', () => {
  const cfg = savedFbConfig() || codeFbConfig();
  $('#fbConfigInput').value = cfg ? JSON.stringify(cfg, null, 2) : '';
  $('#fbStatus').textContent = store.mode === 'firebase'
    ? '현재 실시간 DB에 연결되어 있습니다.'
    : '현재 로컬 모드입니다. 이 기기에만 저장됩니다.';
  $('#myName').value = myName();
  $('#codeStatus').textContent = '';
  $('#newCode').value = '';
  openModal('#settingsModal');
});

$('#connBadge').addEventListener('click', () => $('#settingsBtn').click());

$('#fbConnect').addEventListener('click', () => {
  const raw = $('#fbConfigInput').value.trim();
  if (!raw) { $('#fbStatus').textContent = '설정 JSON을 붙여넣어 주세요.'; return; }
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch {
    // 흔한 형식 오류 보정: 작은따옴표 / 후행 쉼표
    try { cfg = JSON.parse(raw.replace(/'/g, '"').replace(/,\s*}/g, '}')); }
    catch { $('#fbStatus').textContent = 'JSON 형식이 올바르지 않습니다.'; return; }
  }
  if (!cfg.databaseURL) {
    cfg.databaseURL = cfg.projectId ? `https://${cfg.projectId}-default-rtdb.firebaseio.com` : '';
  }
  if (!cfg.databaseURL) { $('#fbStatus').textContent = 'databaseURL 이 없습니다. Firebase 구성 전체를 붙여넣어 주세요.'; return; }

  localStorage.setItem(K.fb, JSON.stringify(cfg));
  $('#fbStatus').textContent = '연결 중…';
  location.reload();
});

$('#fbDisconnect').addEventListener('click', () => {
  if (!savedFbConfig()) {
    if (codeFbConfig()) { $('#fbStatus').textContent = 'firebase-config.js 에 설정이 들어 있어 해제할 수 없습니다.'; return; }
    $('#fbStatus').textContent = '연결되어 있지 않습니다.';
    return;
  }
  if (!confirm('실시간 DB 연결을 해제하고 로컬 모드로 돌아갈까요?\n(DB에 저장된 데이터는 그대로 남습니다)')) return;
  localStorage.removeItem(K.fb);
  location.reload();
});

$('#saveCode').addEventListener('click', () => {
  const v = $('#newCode').value.trim();
  if (v.length < 4) { $('#codeStatus').textContent = '4자 이상으로 정해 주세요.'; return; }
  localStorage.setItem(K.code, v);
  $('#newCode').value = '';
  $('#codeStatus').textContent = '입장 코드를 변경했습니다.';
});

$('#saveName').addEventListener('click', () => {
  const v = $('#myName').value.trim();
  if (!v) return;
  setMyName(v);
  $$('#boardAuthor, #todoAssignee, #statusName').forEach((el) => { el.value = v; });
  renderAll();
  toast('이름을 저장했습니다');
});

$('#resetLocal').addEventListener('click', () => {
  if (store.mode !== 'local') { toast('로컬 모드에서만 초기화할 수 있습니다'); return; }
  if (!confirm('이 기기의 로컬 보드 데이터를 모두 지우고 예시 데이터로 되돌릴까요?')) return;
  localStorage.removeItem(K.state);
  location.reload();
});

/* ── 시작 ─────────────────────────────────────────────────── */
boot();

// 앱이 열릴 때마다 하트비트 시작 (저장소 연결 후 ready 되는 시점에 동작)
const heartbeatWatch = setInterval(() => {
  if (store.ready && store.backend) {
    clearInterval(heartbeatWatch);
    startHeartbeat();
  }
}, 500);
