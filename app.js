// ===== 0. Supabase 연결 =====
const { SUPABASE_URL, SUPABASE_KEY } = window.APP_CONFIG;
const configured = SUPABASE_URL.startsWith("https://") && !SUPABASE_KEY.startsWith("여기에");
const db = configured ? supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// ===== 1. 화면 요소 =====
const $ = (id) => document.getElementById(id);

const authView = $("authView");
const authForm = $("authForm");
const authEmail = $("authEmail");
const authPassword = $("authPassword");
const authMessage = $("authMessage");
const authSubmit = $("authSubmit");
const authToggle = $("authToggle");

const appView = $("appView");
const list = $("list");
const emptyMessage = $("emptyMessage");
const summary = $("summary");
const filterButtons = document.querySelectorAll("#filters button");

const editDialog = $("editDialog");
const editForm = $("editForm");
const editTitle = $("editTitle");
const editMessage = $("editMessage");
const deleteButton = $("deleteButton");
const saveButton = $("saveButton");

const confirmDialog = $("confirmDialog");
const toast = $("toast");

// ===== 2. 상태 =====
let items = []; // 불러온 협찬 목록
let filter = "active"; // 지금 보고 있는 필터
let editingId = null; // 수정 중인 항목 id (새로 만들 땐 null)
let isSignup = false; // 로그인/회원가입 중 어느 화면인지
let currentUserId = null;

// ===== 3. 작은 도우미 함수들 =====

// 사용자가 입력한 글자를 HTML로 넣을 때 안전하게 바꿈 (<, > 같은 기호가 코드로 실행되지 않게)
function esc(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

// http(s) 주소만 링크로 사용
function safeUrl(url) {
  return /^https?:\/\//i.test(url || "") ? url : null;
}

// 글 속의 주소(https://..., www....)를 누를 수 있는 링크로 바꿈
// 주소에 쓰이는 영문·숫자·기호까지만 주소로 보고, 바로 뒤에 붙은 한글("...com에서")은 제외
const URL_IN_TEXT = /(?:https?:\/\/|www\.)[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/gi;

function linkify(text) {
  let html = "";
  let last = 0;
  for (const match of String(text ?? "").matchAll(URL_IN_TEXT)) {
    let url = match[0];
    // 문장 끝의 마침표·쉼표·괄호 등은 주소에서 빼기 (예: "여기 참고 https://a.com.")
    const tail = (url.match(/[.,!?;:)\]'"]+$/) || [""])[0];
    url = url.slice(0, url.length - tail.length);
    const href = /^www\./i.test(url) ? `https://${url}` : url;

    html += esc(text.slice(last, match.index));
    html += `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>${esc(tail)}`;
    last = match.index + match[0].length;
  }
  return html + esc(String(text ?? "").slice(last));
}

// "2026-11-22" → 오늘부터 며칠 남았는지 (오늘 0, 내일 1, 어제 -1)
function daysFromToday(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

// "2026-11-22" → "11/22(토)"
function formatDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  const day = "일월화수목금토"[new Date(y, m - 1, d).getDay()];
  return `${m}/${d}(${day})`;
}

// 오늘 날짜를 "2026-11-19" 모양으로
function todayStr() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

// "2026-11-19" + 7일 → "2026-11-26"
function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = new Date(y, m - 1, d + days);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

// 수령일 + "며칠 이내" → 리뷰 마감일 (둘 중 하나라도 없으면 계산 안 함)
function calcDue(receivedDate, reviewDays) {
  const days = parseInt(reviewDays, 10);
  return receivedDate && days > 0 ? addDays(receivedDate, days) : null;
}

function showToast(text) {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => (toast.hidden = true), 2500);
}

// Supabase 오류를 이해하기 쉬운 한국어로
function friendlyError(error) {
  const msg = error?.message || String(error);
  if (/Invalid login credentials/i.test(msg)) return "이메일 또는 비밀번호가 맞지 않아요.";
  if (/already registered/i.test(msg)) return "이미 가입된 이메일이에요. 로그인해 주세요.";
  if (/Email not confirmed/i.test(msg)) return "이메일 인증이 아직 안 됐어요. 메일함을 확인해 주세요.";
  if (/rate limit/i.test(msg)) return "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.";
  if (/sponsorships/i.test(msg) && /(does not exist|schema cache)/i.test(msg)) {
    return "데이터베이스 표가 아직 없어요. supabase.sql 을 먼저 실행해 주세요.";
  }
  if (/Failed to fetch/i.test(msg)) return "인터넷 연결을 확인해 주세요.";
  return msg;
}

// ===== 4. 진행 단계 =====
// 체크 상태를 보고 지금 어느 단계인지 계산
const STAGES = {
  planned:  { label: "신청 전",      order: 1 },
  applied:  { label: "선정 대기",    order: 2 },
  selected: { label: "배송 대기",    order: 3 },
  received: { label: "리뷰 작성 중", order: 4 },
  done:     { label: "완료",         order: 5 },
  rejected: { label: "미선정",       order: 6 },
};

function stageOf(it) {
  if (it.reviewed) return "done";
  if (it.rejected) return "rejected";
  if (it.received) return "received";
  if (it.selected) return "selected";
  if (it.applied) return "applied";
  return "planned";
}

const isClosed = (it) => ["done", "rejected"].includes(stageOf(it));

// 게시물 체크리스트 [{label, url, done}, ...]
// 예전에 만든 항목(posts가 비어 있음)은 "리뷰 작성" 체크와 리뷰 URL로 게시물 1개를 만들어서 보여줌
function getPosts(it) {
  if (Array.isArray(it?.posts) && it.posts.length) return it.posts;
  return [{ label: "", url: it?.review_url || "", done: !!it?.reviewed }];
}

const postLabel = (p, i) => p.label || `게시물 ${i + 1}`;

// 신청 종류 (신청의 하위 메뉴). 저장할 땐 체크한 이름만 ["제품 제공", "유가 협찬"]
const APPLY_TYPES = ["제품 제공", "유가 협찬"];

function getApplyTypes(it) {
  return Array.isArray(it?.apply_types) ? it.apply_types.filter((t) => APPLY_TYPES.includes(t)) : [];
}

// 메모 여러 개 ["...", "..."]
// 예전에 만든 항목은 메모 칸(memo) 하나를 첫 메모로 보여줌
function getMemos(it) {
  if (Array.isArray(it?.memos) && it.memos.length) return it.memos;
  return it?.memo ? [it.memo] : [];
}

// 체크 하나를 바꿀 때 앞뒤 단계도 자연스럽게 맞춰줌
// 예) "수령"을 체크하면 신청·선정도 자동 체크 / "미선정"을 체크하면 선정 이후 체크는 해제
const FLOW = ["applied", "selected", "received", "reviewed"];

function cascade(field, value) {
  const changes = { [field]: value };
  if (field === "rejected") {
    if (value) Object.assign(changes, { applied: true, selected: false, received: false, reviewed: false });
    return changes;
  }
  const idx = FLOW.indexOf(field);
  if (value) {
    FLOW.slice(0, idx).forEach((f) => (changes[f] = true)); // 앞 단계는 모두 체크
    if (idx >= 1) changes.rejected = false; // 선정 이후면 미선정 해제
  } else {
    FLOW.slice(idx + 1).forEach((f) => (changes[f] = false)); // 뒤 단계는 모두 해제
  }
  return changes;
}

// ===== 5. 로그인 =====
function setAuthMode(signup) {
  isSignup = signup;
  authSubmit.textContent = signup ? "회원가입" : "로그인";
  authToggle.textContent = signup ? "이미 계정이 있나요? 로그인" : "처음이신가요? 회원가입";
  authPassword.autocomplete = signup ? "new-password" : "current-password";
  authMessage.hidden = true;
}

function showAuthMessage(text, isError = true) {
  authMessage.textContent = text;
  authMessage.classList.toggle("error", isError);
  authMessage.hidden = false;
}

authToggle.addEventListener("click", () => setAuthMode(!isSignup));

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!db) return;
  authSubmit.disabled = true;
  const email = authEmail.value.trim();
  const password = authPassword.value;

  const { data, error } = isSignup
    ? await db.auth.signUp({ email, password })
    : await db.auth.signInWithPassword({ email, password });

  authSubmit.disabled = false;
  if (error) return showAuthMessage(friendlyError(error));
  if (isSignup && !data.session) {
    // Supabase에서 "이메일 인증"이 켜져 있으면 메일 확인 후 로그인해야 함
    showAuthMessage("가입 확인 메일을 보냈어요. 메일의 링크를 누른 뒤 로그인해 주세요.", false);
    setAuthMode(false);
  }
  // 성공하면 아래 onAuthStateChange가 화면을 바꿔줌
});

$("logoutButton").addEventListener("click", () => db.auth.signOut());

// 로그인 상태에 따라 화면 전환
function showView(session) {
  const userId = session?.user?.id ?? null;
  authView.hidden = !!userId;
  appView.hidden = !userId;
  if (userId && userId !== currentUserId) loadItems(); // 사용자가 바뀌었을 때만 새로 불러오기
  if (!userId) items = [];
  currentUserId = userId;
}

// ===== 6. 데이터 불러오기 / 저장 =====
async function loadItems() {
  const { data, error } = await db.from("sponsorships").select("*");
  if (error) {
    showToast(friendlyError(error));
    return;
  }
  items = data;
  render();
}

// ===== 7. 화면 그리기 =====
// 정렬: 진행 중인 것 먼저 → 리뷰 마감일 가까운 순 (마감일 없는 건 뒤로) → 최근 추가 순
function sortItems(arr) {
  const far = 999999;
  return [...arr].sort((a, b) => {
    const closed = isClosed(a) - isClosed(b);
    if (closed) return closed;
    const due = (daysFromToday(a.review_due) ?? far) - (daysFromToday(b.review_due) ?? far);
    if (due) return due;
    return b.created_at.localeCompare(a.created_at);
  });
}

function matchesFilter(it) {
  const stage = stageOf(it);
  if (filter === "active") return !isClosed(it);
  if (filter === "applied") return stage === "planned" || stage === "applied";
  if (filter === "done") return isClosed(it);
  return true;
}

// 리뷰 마감 D-day 표시
function dueBadge(it) {
  if (!it.review_due || isClosed(it)) return "";
  const d = daysFromToday(it.review_due);
  let cls = "";
  let text;
  if (d < 0) { cls = "overdue"; text = `마감 ${-d}일 지남`; }
  else if (d === 0) { cls = "soon"; text = "오늘 마감"; }
  else { cls = d <= 3 ? "soon" : ""; text = `D-${d}`; }
  return `<span class="dday ${cls}">${text}</span>`;
}

function cardHtml(it) {
  const stage = stageOf(it);
  const d = daysFromToday(it.review_due);
  const urgency = isClosed(it) || d === null ? "" : d < 0 ? "is-overdue" : d <= 3 ? "is-soon" : "";

  const received = it.received_date ? formatDate(it.received_date) : "";
  const recruit = safeUrl(it.recruit_url);
  const posts = getPosts(it);
  const postsDone = posts.filter((p) => p.done).length;

  // 카드의 진행 상황은 "표시"만 (누를 수 없음). 체크는 수정 창에서.
  const step = (field, label) => `<span class="chip ${it[field] ? "on" : ""}">${label}</span>`;

  // "신청" 버튼을 누르면 아래로 펼쳐지는 신청 종류 (표시만)
  const applyOpen = expandedLists.has(`apply-${it.id}`);
  const applied = getApplyTypes(it);
  const applyList = `
    <ul class="post-list apply-list" id="apply-${it.id}" ${applyOpen ? "" : "hidden"}>
      ${APPLY_TYPES.map((type) => `
        <li class="${applied.includes(type) ? "done" : ""}">
          <span class="post-mark" aria-label="${applied.includes(type) ? "신청함" : "신청 안 함"}"></span>
          <span class="post-name">${type}</span>
        </li>`).join("")}
    </ul>`;

  // "리뷰" 버튼을 누르면 아래로 펼쳐지는 게시물 목록 (표시만)
  const postsOpen = expandedLists.has(`posts-${it.id}`);
  const postList = `
    <ul class="post-list" id="posts-${it.id}" ${postsOpen ? "" : "hidden"}>
      ${posts.map((p, i) => {
        const url = safeUrl(p.url);
        return `
        <li class="${p.done ? "done" : ""}">
          <span class="post-mark" aria-label="${p.done ? "완료" : "미완료"}"></span>
          <span class="post-name">${esc(postLabel(p, i))}</span>
          ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">보기 ↗</a>` : ""}
        </li>`;
      }).join("")}
    </ul>`;

  // 메모: 좌우로 밀어서 넘기는 슬라이드 (메모가 2개 이상이면 아래에 ‹ ● ○ › 표시)
  const memos = getMemos(it);
  const memoIdx = Math.min(memoIndex.get(it.id) || 0, Math.max(memos.length - 1, 0));
  const memoBox = !memos.length ? "" : `
      <div class="memos">
        <div class="memo-track" data-track="${it.id}">
          ${memos.map((m, i) => {
            const key = `${it.id}:${i}`;
            const open = expandedMemos.has(key);
            return `
            <div class="memo-slide">
              <p class="memo ${open ? "expanded" : ""}">${linkify(m)}</p>
              <button type="button" class="memo-toggle" data-memo-toggle="${key}" hidden>${open ? "접기" : "더보기"}</button>
            </div>`;
          }).join("")}
        </div>
        ${memos.length < 2 ? "" : `
        <div class="memo-nav">
          <button type="button" data-memo-step="-1" data-id="${it.id}" aria-label="이전 메모">‹</button>
          <span class="memo-dots">${memos.map((_, i) => `<i class="${i === memoIdx ? "on" : ""}"></i>`).join("")}</span>
          <span class="memo-count">${memoIdx + 1}/${memos.length}</span>
          <button type="button" data-memo-step="1" data-id="${it.id}" aria-label="다음 메모">›</button>
        </div>`}
      </div>`;

  return `
    <article class="card stage-${stage} ${urgency}">
      <div class="card-top">
        <div class="tags">
          <span class="stage">${STAGES[stage].label}</span>
          ${it.platform ? `<span class="platform">${esc(it.platform)}</span>` : ""}
        </div>
        ${dueBadge(it)}
      </div>

      <h3 class="card-title">${esc(it.title)}</h3>
      ${it.offer ? `<p class="offer">🎁 ${esc(it.offer)}</p>` : ""}

      ${received || it.review_due || it.review_days ? `
      <dl class="meta">
        ${received ? `<div><dt>수령</dt><dd>${received}</dd></div>` : ""}
        ${it.review_due ? `<div><dt>리뷰 마감</dt><dd>${formatDate(it.review_due)}</dd></div>` : ""}
        ${!it.review_due && it.review_days ? `<div><dt>리뷰</dt><dd>수령 후 ${it.review_days}일 이내</dd></div>` : ""}
      </dl>` : ""}

      <div class="checks-row">
        <button type="button" class="chip review-chip ${it.applied ? "on" : ""}"
          data-list-toggle="apply-${it.id}" aria-expanded="${applyOpen}" aria-controls="apply-${it.id}">협찬</button>
        ${step("selected", "선정")}
        ${step("received", "수령")}
        <button type="button" class="chip review-chip ${it.reviewed ? "on" : ""}"
          data-list-toggle="posts-${it.id}" aria-expanded="${postsOpen}" aria-controls="posts-${it.id}">리뷰 ${postsDone}/${posts.length}</button>
      </div>

      ${applyList}
      ${postList}

      ${memoBox}

      <div class="card-foot">
        <div class="links">
          ${recruit ? `<a href="${esc(recruit)}" target="_blank" rel="noopener noreferrer">모집 글 ↗</a>` : ""}
        </div>
        <button type="button" class="btn btn-ghost btn-small" data-edit="${it.id}">수정</button>
      </div>
    </article>`;
}

function renderSummary() {
  const active = items.filter((it) => !isClosed(it));
  const soon = active.filter((it) => {
    const d = daysFromToday(it.review_due);
    return d !== null && d >= 0 && d <= 3;
  }).length;
  const overdue = active.filter((it) => daysFromToday(it.review_due) < 0).length;
  const waiting = active.filter((it) => it.selected && !it.received).length;

  summary.innerHTML = `
    <div class="stat"><b>${active.length}</b><span>진행 중</span></div>
    <div class="stat ${waiting ? "has-waiting" : ""}"><b>${waiting}</b><span>배송 대기</span></div>
    <div class="stat ${soon ? "has-soon" : ""}"><b>${soon}</b><span>3일 내 마감</span></div>
    <div class="stat ${overdue ? "has-overdue" : ""}"><b>${overdue}</b><span>마감 지남</span></div>`;
}

function render() {
  renderSummary();

  const shown = sortItems(items.filter(matchesFilter));
  list.innerHTML = shown.map(cardHtml).join("");
  restoreMemoSlides();
  updateMemoToggles();

  emptyMessage.hidden = shown.length > 0;
  emptyMessage.textContent = items.length
    ? "이 목록에는 아직 항목이 없어요."
    : "아직 등록한 협찬이 없어요. 오른쪽 위 \"+ 새 협찬\"으로 추가해 보세요.";

  // 모집처 자동완성 목록 (이전에 입력한 것들)
  const platforms = [...new Set(items.map((it) => it.platform).filter(Boolean))];
  $("platformList").innerHTML = platforms.map((p) => `<option value="${esc(p)}">`).join("");
}

// 메모가 세 줄을 넘을 때만 "더보기" 버튼 보이기
// (화면에 그려진 뒤에야 실제 높이를 알 수 있어서 render 다음에 확인)
const expandedMemos = new Set(); // 펼쳐 둔 메모 ("항목id:메모번호")
const expandedLists = new Set(); // 펼쳐 둔 하위 목록 ("apply-항목id" 신청 종류, "posts-항목id" 게시물)
const memoIndex = new Map(); // 항목 id → 지금 보고 있는 메모 번호

// ----- 메모 슬라이드 -----
// 다시 그려도 보던 메모 그대로 보이게 위치 복원
function restoreMemoSlides() {
  list.querySelectorAll(".memo-track").forEach((track) => {
    const idx = memoIndex.get(track.dataset.track) || 0;
    track.scrollLeft = idx * track.clientWidth;
  });
}

// 지금 몇 번째 메모인지 아래 점/숫자에 표시
function updateMemoNav(track) {
  const nav = track.nextElementSibling;
  if (!nav) return; // 메모가 1개면 표시 없음
  const total = track.children.length;
  const idx = Math.min(total - 1, Math.round(track.scrollLeft / Math.max(track.clientWidth, 1)));
  memoIndex.set(track.dataset.track, idx);
  nav.querySelectorAll(".memo-dots i").forEach((dot, i) => dot.classList.toggle("on", i === idx));
  nav.querySelector(".memo-count").textContent = `${idx + 1}/${total}`;
}

// 손가락/트랙패드로 밀었을 때 (scroll은 위로 전달되지 않아서 capture로 받음)
list.addEventListener("scroll", (e) => {
  if (e.target.classList?.contains("memo-track")) updateMemoNav(e.target);
}, true);

function updateMemoToggles() {
  list.querySelectorAll(".memo").forEach((memo) => {
    const btn = memo.nextElementSibling;
    const open = memo.classList.contains("expanded");
    btn.hidden = !open && memo.scrollHeight <= memo.clientHeight + 1;
  });
}

// 화면 폭이 바뀌면 메모 줄 수와 슬라이드 폭도 바뀜
window.addEventListener("resize", () => {
  restoreMemoSlides();
  updateMemoToggles();
});

// 카드 안의 신청(종류)·리뷰(게시물 목록)·메모 펼치기, 수정 버튼 (목록 전체에 한 번만 연결)
list.addEventListener("click", (e) => {
  const listToggle = e.target.closest("[data-list-toggle]");
  if (listToggle) {
    const key = listToggle.dataset.listToggle;
    const open = !expandedLists.has(key);
    if (open) expandedLists.add(key);
    else expandedLists.delete(key);
    listToggle.setAttribute("aria-expanded", open);
    $(key).hidden = !open;
    return;
  }

  // ‹ › 버튼으로 메모 넘기기
  const stepBtn = e.target.closest("[data-memo-step]");
  if (stepBtn) {
    const track = list.querySelector(`[data-track="${stepBtn.dataset.id}"]`);
    track.scrollBy({ left: Number(stepBtn.dataset.memoStep) * track.clientWidth, behavior: "smooth" });
    return;
  }

  const toggle = e.target.closest("[data-memo-toggle]");
  if (toggle) {
    const id = toggle.dataset.memoToggle;
    const open = !expandedMemos.has(id);
    if (open) expandedMemos.add(id);
    else expandedMemos.delete(id);
    toggle.previousElementSibling.classList.toggle("expanded", open);
    toggle.textContent = open ? "접기" : "더보기";
    return;
  }

  const btn = e.target.closest("[data-edit]");
  if (btn) openEditor(items.find((it) => it.id === btn.dataset.edit));
});

filterButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    filter = btn.dataset.filter;
    filterButtons.forEach((b) => b.classList.toggle("active", b === btn));
    render();
  });
});

// ===== 8. 추가 / 수정 창 =====
const TEXT_FIELDS = ["title", "platform", "offer", "received_date", "review_days", "review_due", "recruit_url"];
const MAX_POSTS = 10;
const MAX_MEMOS = 20;

// ----- 메모 여러 개 (창 안) -----
const memosList = $("memosList");
let formMemos = []; // 창에서 편집 중인 메모들

function renderMemoRows() {
  memosList.innerHTML = formMemos.map((m, i) => `
    <div class="memo-row">
      <textarea data-m="${i}" rows="3" placeholder="${i === 0 ? "필수 키워드·해시태그, 사진/영상 개수, 송장번호 등" : `메모 ${i + 1}`}">${esc(m)}</textarea>
      ${formMemos.length > 1 ? `<button type="button" class="icon-btn" data-memo-del="${i}" aria-label="메모 ${i + 1} 삭제">✕</button>` : ""}
    </div>`).join("");
  $("memoAdd").disabled = formMemos.length >= MAX_MEMOS;
}

$("memoAdd").addEventListener("click", () => {
  formMemos.push("");
  renderMemoRows();
  memosList.querySelector(`[data-m="${formMemos.length - 1}"]`).focus(); // 새 메모 칸으로 바로 이동
});

memosList.addEventListener("input", (e) => {
  if (e.target.dataset.m !== undefined) formMemos[e.target.dataset.m] = e.target.value;
});

memosList.addEventListener("click", (e) => {
  const del = e.target.closest("[data-memo-del]");
  if (!del) return;
  formMemos.splice(Number(del.dataset.memoDel), 1);
  renderMemoRows();
});

// ----- 게시물 체크리스트 (창 안) -----
const postsList = $("postsList");
let formPosts = []; // 창에서 편집 중인 게시물 목록

function renderPostRows() {
  postsList.innerHTML = formPosts.map((p, i) => `
    <div class="post-row">
      <input type="checkbox" data-i="${i}" ${p.done ? "checked" : ""} aria-label="게시물 ${i + 1} 완료">
      <input type="text" data-i="${i}" data-k="label" value="${esc(p.label)}" placeholder="게시물 ${i + 1} (예: 피드, 릴스)">
      <input type="url" data-i="${i}" data-k="url" value="${esc(p.url)}" placeholder="https:// 올린 게시물 주소">
    </div>`).join("");
  $("postCount").textContent = formPosts.length;
  $("postMinus").disabled = formPosts.length <= 1;
  $("postPlus").disabled = formPosts.length >= MAX_POSTS;
  updateReviewProgress();
}

// "리뷰 작성" 옆에 (완료 수/전체) 표시
function updateReviewProgress() {
  const done = formPosts.filter((p) => p.done).length;
  $("reviewProgress").textContent = `(${done}/${formPosts.length})`;
}

// 게시물이 모두 끝났는지에 맞춰 위쪽 "리뷰 작성" 체크(와 앞 단계들)를 맞춤
function syncReviewedFromPosts() {
  const allDone = formPosts.every((p) => p.done);
  if (editForm.elements.reviewed.checked === allDone) return;
  Object.entries(cascade("reviewed", allDone)).forEach(([k, v]) => (editForm.elements[k].checked = v));
}

function setPostCount(n) {
  n = Math.min(MAX_POSTS, Math.max(1, n));
  while (formPosts.length < n) formPosts.push({ label: "", url: "", done: false });
  formPosts.length = n; // 줄이면 뒤에서부터 삭제
  renderPostRows();
  syncReviewedFromPosts();
}

$("postMinus").addEventListener("click", () => setPostCount(formPosts.length - 1));
$("postPlus").addEventListener("click", () => setPostCount(formPosts.length + 1));

postsList.addEventListener("input", (e) => {
  const { i, k } = e.target.dataset;
  if (k) formPosts[i][k] = e.target.value;
});

postsList.addEventListener("change", (e) => {
  if (e.target.type !== "checkbox") return;
  formPosts[e.target.dataset.i].done = e.target.checked;
  updateReviewProgress();
  syncReviewedFromPosts();
});

// ----- 신청 종류 (창 안) -----
const applyTypesBox = $("applyTypes");
applyTypesBox.innerHTML = APPLY_TYPES.map((type) =>
  `<label><input type="checkbox" data-apply-type="${type}"> ${type}</label>`).join("");
const applyTypeInputs = () => [...applyTypesBox.querySelectorAll("[data-apply-type]")];

// 종류를 하나라도 체크하면 "신청"도 자동 체크 (해제할 땐 신청은 그대로 둠)
applyTypesBox.addEventListener("change", (e) => {
  if (!e.target.checked || editForm.elements.applied.checked) return;
  Object.entries(cascade("applied", true)).forEach(([k, v]) => (editForm.elements[k].checked = v));
});

const CHECK_FIELDS = ["applied", "selected", "rejected", "received", "reviewed"];

function openEditor(item = null) {
  editingId = item?.id ?? null;
  editTitle.textContent = item ? "협찬 수정" : "새 협찬";
  deleteButton.hidden = !item;
  editMessage.hidden = true;

  TEXT_FIELDS.forEach((f) => (editForm.elements[f].value = item?.[f] ?? ""));
  dueEditedByHand = !!item?.review_due && item.review_due !== calcDue(item.received_date, item.review_days);
  CHECK_FIELDS.forEach((f) => (editForm.elements[f].checked = !!item?.[f]));
  if (!item) editForm.elements.applied.checked = true; // 새로 추가할 땐 보통 신청한 상태
  const types = getApplyTypes(item);
  applyTypeInputs().forEach((cb) => (cb.checked = types.includes(cb.dataset.applyType)));

  formPosts = getPosts(item).map((p) => ({ label: p.label || "", url: p.url || "", done: !!p.done }));
  renderPostRows();

  formMemos = [...getMemos(item)];
  if (!formMemos.length) formMemos = [""]; // 빈 메모 칸 하나는 항상
  renderMemoRows();

  editDialog.showModal();
}

function closeEditor() {
  editDialog.close();
}

// 창 안의 체크박스도 같은 규칙으로 앞뒤 단계 맞추기
CHECK_FIELDS.forEach((f) => {
  editForm.elements[f].addEventListener("change", (e) => {
    const changes = cascade(f, e.target.checked);
    Object.entries(changes).forEach(([k, v]) => (editForm.elements[k].checked = v));
    // "신청"을 해제하면 신청 종류도 모두 해제
    if (changes.applied === false) applyTypeInputs().forEach((cb) => (cb.checked = false));
    // "리뷰 작성"이 바뀌면 게시물 체크도 모두 같이
    if ("reviewed" in changes) {
      formPosts.forEach((p) => (p.done = changes.reviewed));
      renderPostRows();
    }
    // 수령 체크 시 수령일이 비어 있으면 오늘로
    if (changes.received && !editForm.elements.received_date.value) {
      editForm.elements.received_date.value = todayStr();
      autoFillDue();
    }
  });
});

// 수령일이나 "며칠 이내"를 바꾸면 리뷰 마감일 자동 계산
// (마감일을 직접 고친 경우에는 덮어쓰지 않음)
let dueEditedByHand = false;

function autoFillDue() {
  if (dueEditedByHand) return;
  const due = calcDue(editForm.elements.received_date.value, editForm.elements.review_days.value);
  if (due) editForm.elements.review_due.value = due;
}

editForm.elements.received_date.addEventListener("input", autoFillDue);
editForm.elements.review_days.addEventListener("input", autoFillDue);
editForm.elements.review_due.addEventListener("input", () => {
  dueEditedByHand = editForm.elements.review_due.value !== "";
});

$("addButton").addEventListener("click", () => openEditor());
$("editClose").addEventListener("click", closeEditor);
$("editCancel").addEventListener("click", closeEditor);

editForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {};
  TEXT_FIELDS.forEach((f) => {
    const v = editForm.elements[f].value.trim();
    payload[f] = v === "" ? null : v; // 빈 칸은 "없음"으로 저장
  });
  if (payload.review_days !== null) payload.review_days = parseInt(payload.review_days, 10) || null;
  CHECK_FIELDS.forEach((f) => (payload[f] = editForm.elements[f].checked));
  payload.apply_types = applyTypeInputs().filter((cb) => cb.checked).map((cb) => cb.dataset.applyType);
  payload.posts = formPosts.map((p) => ({ label: p.label.trim(), url: p.url.trim(), done: p.done }));
  payload.review_url = null; // 리뷰 주소는 이제 게시물마다 저장
  payload.memos = formMemos.map((m) => m.trim()).filter(Boolean); // 빈 메모는 빼고 저장
  payload.memo = null; // 메모는 이제 memos에 여러 개로 저장

  saveButton.disabled = true;
  const query = editingId
    ? db.from("sponsorships").update(payload).eq("id", editingId)
    : db.from("sponsorships").insert(payload);
  const { data, error } = await query.select().single();
  saveButton.disabled = false;

  if (error) {
    editMessage.textContent = "저장하지 못했어요: " + friendlyError(error);
    editMessage.hidden = false;
    return;
  }

  if (editingId) items = items.map((it) => (it.id === editingId ? data : it));
  else items.push(data);
  render();
  closeEditor();
  showToast(editingId ? "수정했어요." : "추가했어요.");
});

// 삭제 (확인 창을 한 번 거침)
deleteButton.addEventListener("click", () => {
  const item = items.find((it) => it.id === editingId);
  $("confirmText").textContent = `"${item.title}"을(를) 삭제할까요? 되돌릴 수 없어요.`;
  confirmDialog.showModal();
});

$("confirmNo").addEventListener("click", () => confirmDialog.close());

$("confirmYes").addEventListener("click", async () => {
  const id = editingId;
  const { error } = await db.from("sponsorships").delete().eq("id", id);
  confirmDialog.close();
  if (error) {
    showToast("삭제하지 못했어요: " + friendlyError(error));
    return;
  }
  items = items.filter((it) => it.id !== id);
  render();
  closeEditor();
  showToast("삭제했어요.");
});

// ===== 9. 시작 =====
if (!db) {
  // config.js에 연결 정보를 아직 안 넣은 경우
  authView.hidden = false;
  showAuthMessage("config.js 에 Supabase 연결 정보를 먼저 넣어 주세요.");
  authSubmit.disabled = true;
} else {
  db.auth.getSession().then(({ data }) => showView(data.session));
  db.auth.onAuthStateChange((_event, session) => showView(session));
}

// 자정이 지나면 D-day가 바뀌므로, 다시 화면에 돌아왔을 때 새로 그림
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && currentUserId) render();
});
