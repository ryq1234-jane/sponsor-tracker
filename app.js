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

// 체크박스를 바로 눌렀을 때: 화면 먼저 바꾸고 → 저장 (실패하면 되돌림)
async function updateChecks(id, changes) {
  const item = items.find((it) => it.id === id);
  const before = { ...item };
  Object.assign(item, changes);
  render();

  const { error } = await db.from("sponsorships").update(changes).eq("id", id);
  if (error) {
    Object.assign(item, before);
    render();
    showToast("저장하지 못했어요: " + friendlyError(error));
  }
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
  const review = safeUrl(it.review_url);

  const check = (field, label) => `
    <label class="chip-check">
      <input type="checkbox" data-id="${it.id}" data-field="${field}" ${it[field] ? "checked" : ""}>
      <span>${label}</span>
    </label>`;

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
        ${check("applied", "신청")}
        ${check("selected", "선정")}
        ${check("received", "수령")}
        ${check("reviewed", "리뷰")}
      </div>

      ${it.memo ? `<p class="memo">${esc(it.memo)}</p>` : ""}

      <div class="card-foot">
        <div class="links">
          ${recruit ? `<a href="${esc(recruit)}" target="_blank" rel="noopener noreferrer">모집 글 ↗</a>` : ""}
          ${review ? `<a href="${esc(review)}" target="_blank" rel="noopener noreferrer">내 리뷰 ↗</a>` : ""}
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

  emptyMessage.hidden = shown.length > 0;
  emptyMessage.textContent = items.length
    ? "이 목록에는 아직 항목이 없어요."
    : "아직 등록한 협찬이 없어요. 오른쪽 위 \"+ 새 협찬\"으로 추가해 보세요.";

  // 모집처 자동완성 목록 (이전에 입력한 것들)
  const platforms = [...new Set(items.map((it) => it.platform).filter(Boolean))];
  $("platformList").innerHTML = platforms.map((p) => `<option value="${esc(p)}">`).join("");
}

// 카드 안의 체크박스 / 수정 버튼 (목록 전체에 한 번만 연결)
list.addEventListener("change", (e) => {
  const box = e.target.closest("input[data-field]");
  if (!box) return;
  const item = items.find((it) => it.id === box.dataset.id);
  const changes = cascade(box.dataset.field, box.checked);

  // 택배 수령을 체크하면: 수령일을 오늘로, 리뷰 마감일도 자동 계산 (이미 있으면 그대로)
  if (changes.received && !item.received) {
    const receivedDate = item.received_date || todayStr();
    changes.received_date = receivedDate;
    if (!item.review_due) {
      const due = calcDue(receivedDate, item.review_days);
      if (due) changes.review_due = due;
    }
  }

  updateChecks(item.id, changes);
  if (changes.review_due) showToast(`리뷰 마감일을 ${formatDate(changes.review_due)}로 정했어요.`);
});

list.addEventListener("click", (e) => {
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
const TEXT_FIELDS = ["title", "platform", "offer", "received_date", "review_days", "review_due", "recruit_url", "review_url", "memo"];
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
