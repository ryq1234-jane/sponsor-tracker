// ===== 0. Supabase 연결 =====
const { SUPABASE_URL, SUPABASE_KEY } = window.APP_CONFIG;
const configured = SUPABASE_URL.startsWith("https://") && !SUPABASE_KEY.startsWith("여기에");
const db = configured ? supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// ===== 1. 화면 요소 =====
const $ = (id) => document.getElementById(id);

const authView = $("authView");
const loginForm = $("loginForm");
const signupForm = $("signupForm");
const forgotForm = $("forgotForm");
const resetForm = $("resetForm");

const appView = $("appView");
const list = $("list");
const emptyMessage = $("emptyMessage");
const filterButtons = document.querySelectorAll("#filters [data-filter]"); // 필터 줄의 "+ 새 협찬"은 제외

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
let currentUserId = null;
let currentEmail = "";
let profile = { nickname: "", avatar: null }; // 내 프로필 (닉네임, 사진)
// 메일의 "비밀번호 재설정" 링크로 들어왔는지 (주소 끝에 type=recovery 가 붙어 옴)
let recoveryMode = /type=recovery/.test(window.location?.hash || "");

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
  if (/rate limit|security purposes/i.test(msg)) return "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.";
  if (/should be different/i.test(msg)) return "지금 쓰는 비밀번호와 다른 비밀번호를 입력해 주세요.";
  if (/at least 6/i.test(msg)) return "비밀번호는 6자 이상이어야 해요.";
  if (/invalid.*email|email.*invalid/i.test(msg)) return "이메일 주소를 다시 확인해 주세요.";
  if (/sending.*email|email.*send/i.test(msg)) return "메일을 보내지 못했어요. 잠시 후 다시 시도해 주세요.";
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
const PAID_TYPE = "유가 협찬"; // 이 종류에만 금액(원) 입력칸

// 협찬 경로: 내가 신청한 건지, 업체에서 제안받은 건지 (DB에는 영어 값으로 저장)
const ORIGINS = { applied: "직접 신청", offered: "제안 받음" };

// 300000 → "300,000"
const formatWon = (n) => Number(n).toLocaleString("ko-KR");

// "30만", "300,000원" 같은 입력에서 숫자만 뽑아 정수로 (없으면 null)
function parseWon(text) {
  const digits = String(text ?? "").replace(/\D/g, "").slice(0, 12);
  return digits ? parseInt(digits, 10) : null;
}

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

// ===== 5. 로그인 · 회원가입 · 비밀번호 찾기 =====
// 메일 링크를 누르면 돌아올 주소 (지금 사이트 주소, # 뒤는 빼고)
const siteUrl = () => window.location.origin + window.location.pathname;

// 화면 전환: 주소 끝 #signup / #forgot 에 따라 (뒤로 가기 버튼도 동작)
const AUTH_SCREENS = ["login", "signup", "forgot"];
let authScreenReady = false; // 로그인 쪽 화면을 한 번이라도 골랐는지

function authScreenFromHash(hash = window.location?.hash || "") {
  const name = hash.slice(1);
  return AUTH_SCREENS.includes(name) ? name : "login";
}

function showAuthScreen(name) {
  authView.querySelectorAll("[data-auth]").forEach((sec) => {
    sec.hidden = sec.dataset.auth !== name;
    sec.querySelector(".message").hidden = true; // 이전에 띄운 안내 문구는 지우기
  });
}

window.addEventListener("hashchange", () => {
  if (!currentUserId && !recoveryMode) showAuthScreen(authScreenFromHash());
});

function showFormMessage(form, text, isError = true) {
  const msg = form.querySelector(".message");
  msg.textContent = text;
  msg.classList.toggle("error", isError);
  msg.hidden = false;
}

// 폼 제출 공통 처리: 버튼 잠그기 → 실행 → 오류면 문구 표시
function onAuthSubmit(form, handler) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!db) return;
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      await handler(form.elements);
    } catch (error) {
      showFormMessage(form, friendlyError(error));
    } finally {
      button.disabled = false;
    }
  });
}

// 로그인
onAuthSubmit(loginForm, async (f) => {
  const { error } = await db.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
  if (error) throw error;
  // 성공하면 아래 onAuthStateChange가 화면을 바꿔줌
});

// 회원가입
onAuthSubmit(signupForm, async (f) => {
  if (f.password.value !== f.password2.value) {
    return showFormMessage(signupForm, "비밀번호 확인이 일치하지 않아요.");
  }
  const { data, error } = await db.auth.signUp({
    email: f.email.value.trim(),
    password: f.password.value,
    options: { emailRedirectTo: siteUrl() },
  });
  if (error) throw error;
  if (!data.session) {
    // Supabase에서 "가입 시 이메일 인증"이 켜져 있으면 메일 확인 후 로그인
    showFormMessage(signupForm, "가입 확인 메일을 보냈어요. 메일의 링크를 누르면 가입이 끝나요. 메일이 안 보이면 스팸함도 확인해 주세요.", false);
  }
});

// 비밀번호 찾기: 재설정 링크 메일 보내기
onAuthSubmit(forgotForm, async (f) => {
  const { error } = await db.auth.resetPasswordForEmail(f.email.value.trim(), { redirectTo: siteUrl() });
  if (error) throw error;
  showFormMessage(forgotForm,
    "재설정 링크를 보냈어요. 메일의 링크를 누르면 새 비밀번호를 정할 수 있어요. 메일이 안 보이면 스팸함도 확인해 주세요.", false);
});

// 새 비밀번호 저장 (재설정 링크로 들어온 상태)
onAuthSubmit(resetForm, async (f) => {
  if (f.password.value !== f.password2.value) {
    return showFormMessage(resetForm, "비밀번호 확인이 일치하지 않아요.");
  }
  const { error } = await db.auth.updateUser({ password: f.password.value });
  if (error) throw error;
  recoveryMode = false;
  resetForm.reset();
  window.history?.replaceState(null, "", siteUrl()); // 주소창의 #... 정리
  showToast("비밀번호를 바꿨어요.");
  const { data } = await db.auth.getSession();
  showView(data.session);
});

// 메일 링크가 만료됐거나 잘못된 경우 (주소 끝에 #error=...&error_description=... 이 붙어 옴)
function handleLinkError() {
  const hash = window.location?.hash || "";
  if (!/error=/.test(hash)) return;
  const params = new URLSearchParams(hash.slice(1));
  window.history?.replaceState(null, "", siteUrl());
  recoveryMode = false;
  authScreenReady = true;
  const expired = /expired|invalid/i.test(`${params.get("error_code")} ${params.get("error_description")}`);
  showAuthScreen(expired ? "forgot" : "login");
  showFormMessage(expired ? forgotForm : loginForm, expired
    ? "링크가 만료됐거나 이미 사용됐어요. 다시 요청해 주세요."
    : "링크를 확인하지 못했어요: " + (params.get("error_description") || ""));
}

// 로그아웃 버튼: PC는 달력 밑, 휴대폰은 목록 맨 아래 (둘 다 같은 동작)
document.querySelectorAll("[data-logout]").forEach((b) => b.addEventListener("click", () => db.auth.signOut()));

// ----- 마이페이지 메뉴 (나의 정보 / 로그아웃) -----
function closeMypageMenus() {
  document.querySelectorAll("[data-mypage-toggle]").forEach((btn) => {
    btn.setAttribute("aria-expanded", "false");
    btn.nextElementSibling.hidden = true;
  });
}

document.querySelectorAll("[data-mypage-toggle]").forEach((btn) => btn.addEventListener("click", () => {
  const menu = btn.nextElementSibling;
  const open = menu.hidden;
  menu.hidden = !open;
  btn.setAttribute("aria-expanded", String(open));
}));

// 메뉴 밖을 누르면 메뉴 닫기
document.addEventListener("click", (e) => {
  if (!e.target.closest(".mypage")) closeMypageMenus();
});

// ----- 프로필 (사진 + 닉네임) -----
// 사진은 900×900 정사각형 WEBP(안 되면 JPG)로 줄여서 profiles 표에 글자(data URL)로 저장 (보통 20~40KB)
const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 원본 사진은 5MB까지
const AVATAR_SIZE = 900; // 휴대폰 상단에 가로로 크게 보여도 깨지지 않을 크기
const MAX_AVATAR_CHARS = 280000; // DB 한도(300,000자) 안쪽으로 — 보통 100~200KB
const AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const PERSON_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7.5" r="4.5"/><path d="M2.5 24c0-5.6 4.3-9.5 9.5-9.5s9.5 3.9 9.5 9.5z"/></svg>`;
const GEAR_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`;

// 저장된 사진이 있으면 사진, 없으면 빈 사람 모양
function avatarHtml(src) {
  return /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(src || "")
    ? `<img src="${src}" alt="프로필 사진">`
    : PERSON_SVG;
}

// 올리려는 사진 확인 (문제가 있으면 안내 문구, 괜찮으면 null)
function checkAvatarFile(file) {
  if (!AVATAR_TYPES.includes(file?.type)) return "JPG, PNG, WEBP 사진만 올릴 수 있어요.";
  if (file.size > MAX_AVATAR_BYTES) {
    return `사진 용량이 너무 커요 (${(file.size / 1024 / 1024).toFixed(1)}MB). 5MB 이하의 사진을 골라 주세요.`;
  }
  return null;
}

// 사진을 가운데 기준 정사각형으로 자르고 900×900 으로 줄이기
// 큰 사진을 한 번에 확 줄이면 깨져 보여서, 절반씩 여러 번 나눠 줄임
function resizeToSquare(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const target = Math.min(AVATAR_SIZE, side); // 원본이 작으면 억지로 키우지 않음

      // 1) 가운데 정사각형 잘라내기 (투명한 PNG는 흰 배경)
      let canvas = document.createElement("canvas");
      canvas.width = canvas.height = side;
      let ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, side, side);
      ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, side, side);

      // 2) 목표 크기의 2배보다 크면 절반씩 줄이기 → 마지막에 목표 크기로
      let size = side;
      while (size / 2 >= target) {
        size = Math.round(size / 2);
        canvas = shrink(canvas, size);
      }
      if (size !== target) canvas = shrink(canvas, target);

      const dataUrl = encodeAvatar(canvas);
      if (dataUrl) resolve(dataUrl);
      else reject(new Error("사진을 저장할 수 있는 크기로 줄이지 못했어요. 다른 사진을 골라 주세요."));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("사진을 읽지 못했어요. 다른 사진을 골라 주세요."));
    };
    img.src = url;
  });
}

function shrink(source, size) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, size, size);
  return canvas;
}

// WEBP(같은 화질에 더 작은 용량)로, 안 되는 브라우저는 JPG로.
// 한도를 넘으면 화질을 조금씩 낮춰서 맞춤
function encodeAvatar(canvas) {
  const webp = canvas.toDataURL("image/webp", 0.5).startsWith("data:image/webp");
  const type = webp ? "image/webp" : "image/jpeg";
  for (const quality of [0.9, 0.85, 0.8, 0.74, 0.68, 0.6]) {
    const dataUrl = canvas.toDataURL(type, quality);
    if (dataUrl.length <= MAX_AVATAR_CHARS) return dataUrl;
  }
  return null;
}

// 프로필: 가로로 긴 직사각형 사진(9:4) + 사진 안 왼쪽 아래 닉네임 (사진은 가운데 위쪽 기준으로 잘림)
// PC(withGear)는 마우스를 올리면 톱니바퀴, 휴대폰은 톱니바퀴 없음 (마이페이지 → 나의 정보에서 바꿈)
function profileBannerHtml(p, withGear = false) {
  const hasPhoto = avatarHtml(p.avatar).startsWith("<img"); // 올바른 사진일 때만
  return `
    <div class="banner ${hasPhoto ? "" : "no-photo"}">
      ${hasPhoto ? avatarHtml(p.avatar) : `<span class="avatar avatar-banner">${PERSON_SVG}</span>`}
      <p class="banner-name ${p.nickname ? "" : "is-empty"}">${esc(p.nickname || "닉네임을 설정해 주세요")}</p>
      ${withGear ? `<button type="button" class="profile-gear" data-open-info aria-label="프로필 설정">${GEAR_SVG}</button>` : ""}
    </div>`;
}

function renderProfile() {
  $("profileSide").innerHTML = profileBannerHtml(profile, true);
  $("profileBanner").innerHTML = profileBannerHtml(profile);
}

renderProfile(); // 불러오기 전에는 기본 이미지로

// 사진은 이 브라우저에 기억해 두고(updated_at 이 같으면 그대로 사용), 바뀌었을 때만 다시 받음
// → 사진이 커져도 매번 내려받지 않아서 데이터 사용량이 늘지 않음
const profileCacheKey = (userId) => `profile-photo:${userId}`;

function readPhotoCache(userId) {
  try { return JSON.parse(localStorage.getItem(profileCacheKey(userId))); } catch { return null; }
}

function writePhotoCache(userId, updatedAt, avatar) {
  try { localStorage.setItem(profileCacheKey(userId), JSON.stringify({ updatedAt, avatar })); } catch { /* 저장 못 해도 괜찮음 */ }
}

async function loadProfile(userId) {
  const { data } = await db.from("profiles").select("nickname, updated_at").eq("id", userId).maybeSingle();
  let avatar = null;
  if (data) {
    const cached = readPhotoCache(userId);
    if (cached && cached.updatedAt === data.updated_at) {
      avatar = cached.avatar;
    } else {
      const { data: photo } = await db.from("profiles").select("avatar").eq("id", userId).maybeSingle();
      avatar = photo?.avatar || null;
      writePhotoCache(userId, data.updated_at, avatar);
    }
  }
  profile = { nickname: data?.nickname || "", avatar };
  renderProfile();
}

// ----- 나의 정보 창 -----
const infoDialog = $("infoDialog");
const profileForm = $("profileForm");
const passwordForm = $("passwordForm");
let formAvatar = null; // 창에서 고른 사진 (저장 전)

function openInfo() {
  closeMypageMenus();
  formAvatar = profile.avatar;
  $("editAvatar").innerHTML = avatarHtml(formAvatar);
  profileForm.elements.nickname.value = profile.nickname;
  $("infoEmail").textContent = currentEmail;
  passwordForm.reset();
  infoDialog.querySelectorAll(".message").forEach((m) => (m.hidden = true));
  infoDialog.showModal();
}

// 마이페이지 → 나의 정보, 프로필의 톱니바퀴 (톱니바퀴는 다시 그려지므로 문서 전체에서 받음)
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-open-info]")) openInfo();
});
$("infoClose").addEventListener("click", () => infoDialog.close());

$("avatarFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = ""; // 같은 사진을 다시 골라도 동작하게
  if (!file) return;
  const problem = checkAvatarFile(file);
  if (problem) return showFormMessage(profileForm, problem);
  try {
    formAvatar = await resizeToSquare(file);
    $("editAvatar").innerHTML = avatarHtml(formAvatar);
    showFormMessage(profileForm, "사진을 골랐어요. 아래 \"프로필 저장\"을 눌러야 반영돼요.", false);
  } catch (error) {
    showFormMessage(profileForm, error.message);
  }
});

$("avatarReset").addEventListener("click", () => {
  formAvatar = null;
  $("editAvatar").innerHTML = avatarHtml(null);
  showFormMessage(profileForm, "기본 이미지로 바꿨어요. 아래 \"프로필 저장\"을 눌러야 반영돼요.", false);
});

onAuthSubmit(profileForm, async (f) => {
  const nickname = f.nickname.value.trim().slice(0, 20);
  const { data, error } = await db.from("profiles")
    .upsert({ id: currentUserId, nickname: nickname || null, avatar: formAvatar })
    .select("updated_at").single();
  if (error) throw error;
  writePhotoCache(currentUserId, data.updated_at, formAvatar);
  profile = { nickname, avatar: formAvatar };
  renderProfile();
  showFormMessage(profileForm, "프로필을 저장했어요.", false);
});

// 비밀번호 변경: 현재 비밀번호로 본인 확인 → 새 비밀번호 저장
onAuthSubmit(passwordForm, async (f) => {
  if (f.password.value !== f.password2.value) {
    return showFormMessage(passwordForm, "새 비밀번호 확인이 일치하지 않아요.");
  }
  const { error: authError } = await db.auth.signInWithPassword({ email: currentEmail, password: f.current.value });
  if (authError) {
    const wrong = /Invalid login credentials/i.test(authError.message);
    return showFormMessage(passwordForm, wrong ? "현재 비밀번호가 맞지 않아요." : friendlyError(authError));
  }
  const { error } = await db.auth.updateUser({ password: f.password.value });
  if (error) throw error;
  passwordForm.reset();
  showFormMessage(passwordForm, "비밀번호를 바꿨어요. 다음 로그인부터 새 비밀번호를 사용해 주세요.", false);
});

// ----- 회원 탈퇴 -----
// Supabase의 delete_my_account 함수가 "지금 로그인한 본인" 계정과 협찬 기록을 지움
const withdrawDialog = $("withdrawDialog");
const withdrawForm = $("withdrawForm");

document.querySelectorAll("[data-withdraw]").forEach((b) => b.addEventListener("click", () => {
  if (infoDialog.open) infoDialog.close(); // 나의 정보 창에서 눌렀으면 그 창은 닫고
  withdrawForm.reset();
  $("withdrawYes").disabled = true;
  withdrawForm.querySelector(".message").hidden = true;
  withdrawDialog.showModal();
}));

// 비밀번호를 입력해야 버튼이 눌림
withdrawForm.elements.password.addEventListener("input", (e) => {
  $("withdrawYes").disabled = e.target.value === "";
});

$("withdrawCancel").addEventListener("click", () => withdrawDialog.close());

withdrawForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const password = withdrawForm.elements.password.value;
  if (!password) return;
  const button = $("withdrawYes");
  button.disabled = true;

  // 본인 확인: 지금 로그인한 이메일 + 입력한 비밀번호로 다시 로그인되는지 확인
  const { data: { session } } = await db.auth.getSession();
  const { error: authError } = await db.auth.signInWithPassword({ email: session?.user?.email, password });
  if (authError) {
    button.disabled = false;
    const wrong = /Invalid login credentials/i.test(authError.message);
    return showFormMessage(withdrawForm, wrong ? "비밀번호가 맞지 않아요." : friendlyError(authError));
  }

  const { error } = await db.rpc("delete_my_account");
  if (error) {
    button.disabled = false;
    return showFormMessage(withdrawForm, "탈퇴하지 못했어요: " + friendlyError(error));
  }
  withdrawDialog.close();
  await db.auth.signOut({ scope: "local" }); // 계정이 이미 지워졌으니 이 기기의 로그인 정보만 정리
  window.history?.replaceState(null, "", siteUrl());
  showToast("탈퇴가 완료되었습니다. 그동안 이용해 주셔서 감사합니다.");
});

// 로그인 상태에 따라 화면 전환
function showView(session) {
  // 재설정 링크로 들어온 경우: 로그인은 됐지만 먼저 새 비밀번호 화면
  if (recoveryMode && session) {
    authView.hidden = false;
    appView.hidden = true;
    showAuthScreen("reset");
    return;
  }
  const userId = session?.user?.id ?? null;
  authView.hidden = !!userId;
  appView.hidden = !userId;
  // 처음 열었을 때와 로그아웃했을 때만 화면 고르기 (띄워 둔 안내 문구가 지워지지 않게)
  if (!userId && (currentUserId || !authScreenReady)) {
    showAuthScreen(authScreenFromHash());
    authScreenReady = true;
  }
  currentEmail = session?.user?.email ?? "";
  if (userId && userId !== currentUserId) {
    // 사용자가 바뀌었을 때만 새로 불러오기
    loadItems();
    loadProfile(userId);
  }
  if (!userId) {
    items = [];
    profile = { nickname: "", avatar: null };
    closeMypageMenus();
  }
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
    <ul class="post-list apply-list ${it.applied ? "on" : ""}" id="apply-${it.id}" ${applyOpen ? "" : "hidden"}>
      ${APPLY_TYPES.map((type) => `
        <li class="${applied.includes(type) ? "done" : ""}">
          <span class="post-mark" aria-label="${applied.includes(type) ? "신청함" : "신청 안 함"}"></span>
          <span class="post-name">${type}</span>
          ${type === PAID_TYPE && applied.includes(type) && it.paid_amount ? `<span class="apply-amount">${formatWon(it.paid_amount)}원</span>` : ""}
        </li>`).join("")}
    </ul>`;

  // "리뷰" 버튼을 누르면 아래로 펼쳐지는 게시물 목록 (표시만)
  const postsOpen = expandedLists.has(`posts-${it.id}`);
  const postList = `
    <ul class="post-list ${it.reviewed ? "on" : ""}" id="posts-${it.id}" ${postsOpen ? "" : "hidden"}>
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
          ${ORIGINS[it.origin] ? `<span class="origin origin-${it.origin}">${ORIGINS[it.origin]}</span>` : ""}
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
        <!-- 리뷰: 왼쪽 동그라미 없이, 다 끝나면 "리뷰 ✓", 아니면 "리뷰 1/3" -->
        <button type="button" class="chip review-chip posts-chip ${it.reviewed ? "on" : ""}"
          data-list-toggle="posts-${it.id}" aria-expanded="${postsOpen}" aria-controls="posts-${it.id}">리뷰 ${it.reviewed || postsDone === posts.length ? "✓" : `${postsDone}/${posts.length}`}</button>
        <!-- 펼친 목록은 같은 칸 바로 아래에 같은 너비로 (협찬: 1번째 칸, 리뷰: 4번째 칸) -->
        ${applyList}
        ${postList}
      </div>

      ${memoBox}

      <div class="card-foot">
        <div class="links">
          ${recruit ? `<a href="${esc(recruit)}" target="_blank" rel="noopener noreferrer">모집 글 ↗</a>` : ""}
        </div>
        <button type="button" class="btn btn-ghost btn-small" data-edit="${it.id}">수정</button>
      </div>
    </article>`;
}

// 요약 숫자 3개 (달력 안 "리뷰 마감 · 완료" 아래 작은 상자) — "마감 지남"은 사용자 요청으로 뺌
function summaryHtml(list) {
  const active = list.filter((it) => !isClosed(it));
  const soon = active.filter((it) => {
    const d = daysFromToday(it.review_due);
    return d !== null && d >= 0 && d <= 3;
  }).length;
  const waiting = active.filter((it) => it.selected && !it.received).length;

  return `
    <div class="stat"><b>${active.length}</b><span>진행 중</span></div>
    <div class="stat ${waiting ? "has-waiting" : ""}"><b>${waiting}</b><span>배송 대기</span></div>
    <div class="stat stat-soon ${soon ? "has-soon" : ""}"><b>${soon}</b><span>3일 내 마감</span></div>`;
}

// ----- 일정 달력 -----
// 날짜별 일정: 리뷰 마감일만
const calendarSide = $("calendarSide");
const calendarSheet = $("calendarSheet");
const calendarDialog = $("calendarDialog");
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth(); // 0 = 1월
let calSelected = todayStr();

const ymd = (y, m, d) => {
  const t = new Date(y, m, d);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};

// { "2026-11-26": [{ item }, ...] }
function calendarEvents(list) {
  const map = {};
  list.forEach((it) => {
    if (it.review_due) (map[it.review_due] ||= []).push({ item: it });
  });
  return map;
}

// 일정 점 색깔: 남은 날짜에 따라, 끝난 건 회색
function eventClass(ev) {
  if (isClosed(ev.item)) return "ev-done";
  const d = daysFromToday(ev.item.review_due);
  return d < 0 ? "ev-overdue" : d <= 3 ? "ev-soon" : "ev-due";
}

// 한국 공휴일 (대체공휴일·선거일 포함). 출처: timeanddate.com 2026·2027 목록 (2026-11-25 확인)
// ⚠️ 2028년부터는 여기에 새로 추가해야 빨간 날로 보여요.
const HOLIDAYS = {
  "2026-01-01": "신정",
  "2026-02-16": "설날 연휴", "2026-02-17": "설날", "2026-02-18": "설날 연휴",
  "2026-03-01": "삼일절", "2026-03-02": "대체공휴일(삼일절)",
  "2026-05-05": "어린이날",
  "2026-05-24": "부처님오신날", "2026-05-25": "대체공휴일(부처님오신날)",
  "2026-06-03": "전국동시지방선거",
  "2026-06-06": "현충일",
  "2026-07-17": "제헌절",
  "2026-08-15": "광복절", "2026-08-17": "대체공휴일(광복절)",
  "2026-09-24": "추석 연휴", "2026-09-25": "추석", "2026-09-26": "추석 연휴",
  "2026-10-03": "개천절", "2026-10-05": "대체공휴일(개천절)",
  "2026-10-09": "한글날",
  "2026-12-25": "성탄절",
  "2027-01-01": "신정",
  "2027-02-06": "설날 연휴", "2027-02-07": "설날", "2027-02-08": "설날 연휴", "2027-02-09": "대체공휴일(설날)",
  "2027-03-01": "삼일절",
  "2027-05-01": "노동절", "2027-05-03": "대체공휴일(노동절)",
  "2027-05-05": "어린이날",
  "2027-05-13": "부처님오신날",
  "2027-06-06": "현충일",
  "2027-07-17": "제헌절", "2027-07-19": "대체공휴일(제헌절)",
  "2027-08-15": "광복절", "2027-08-16": "대체공휴일(광복절)",
  "2027-09-14": "추석 연휴", "2027-09-15": "추석", "2027-09-16": "추석 연휴",
  "2027-10-03": "개천절", "2027-10-04": "대체공휴일(개천절)",
  "2027-10-09": "한글날", "2027-10-11": "대체공휴일(한글날)",
  "2027-12-25": "성탄절", "2027-12-27": "대체공휴일(성탄절)",
};

// 빨간 날: 토요일·일요일·공휴일
function isRedDay(date) {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return dow === 0 || dow === 6 || date in HOLIDAYS;
}

function calendarHtml(list, year, month, selected, withSummary = false) {
  const events = calendarEvents(list);
  const today = todayStr();
  const offset = new Date(year, month, 1).getDay(); // 1일이 무슨 요일인지
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = Math.ceil((offset + daysInMonth) / 7) * 7;

  let days = "";
  for (let i = 0; i < cells; i++) {
    const date = ymd(year, month, i - offset + 1);
    const [, m, d] = date.split("-").map(Number);
    const evs = events[date] || [];
    const cls = [
      "cal-day",
      m - 1 !== month ? "other" : "",
      date === today ? "today" : "",
      date === selected ? "selected" : "",
      isRedDay(date) ? "red" : "",
    ].filter(Boolean).join(" ");
    const holiday = HOLIDAYS[date];
    days += `
      <button type="button" class="${cls}" data-cal-date="${date}"${holiday ? ` title="${holiday}"` : ""} aria-label="${m}월 ${d}일${holiday ? ` ${holiday}` : ""}${evs.length ? `, 일정 ${evs.length}개` : ""}">
        <span class="num">${d}</span>
        <span class="cal-dots">${evs.slice(0, 3).map((ev) => `<i class="${eventClass(ev)}"></i>`).join("")}</span>
      </button>`;
  }

  // 고른 날짜의 일정 목록
  const picked = events[selected] || [];
  const dayList = picked.length
    ? picked.map((ev) => `
      <li>
        <button type="button" class="cal-event" data-cal-edit="${ev.item.id}">
          <span class="ev-tag ${eventClass(ev)}">리뷰 마감</span>
          <span class="cal-event-title">${esc(ev.item.title)}</span>
          ${dueBadge(ev.item)}
        </button>
      </li>`).join("")
    : `<li class="cal-none">일정이 없어요.</li>`;

  return `
    <div class="cal-head">
      <button type="button" class="icon-btn" data-cal-nav="-1" aria-label="이전 달">‹</button>
      <b>${year}년 ${month + 1}월</b>
      <button type="button" class="icon-btn" data-cal-nav="1" aria-label="다음 달">›</button>
      <button type="button" class="btn btn-ghost btn-small" data-cal-today>오늘</button>
    </div>
    <div class="cal-grid">
      ${[..."일월화수목금토"].map((w) => `<span class="cal-wd">${w}</span>`).join("")}
      ${days}
    </div>
    <div class="cal-legend">
      <span><i class="ev-due"></i>리뷰 마감</span>
      <span><i class="ev-done"></i>완료</span>
    </div>
    ${withSummary ? `<div class="mini-summary">${summaryHtml(list)}</div>` : ""}
    <div class="cal-list">
      <h3>${formatDate(selected)}</h3>
      <ul>${dayList}</ul>
    </div>`;
}

function renderCalendars() {
  // 요약 숫자는 달력 안에 (PC 왼쪽 달력, 휴대폰 달력 창 둘 다)
  const html = calendarHtml(items, calYear, calMonth, calSelected, true);
  calendarSide.innerHTML = html;
  calendarSheet.innerHTML = html;
}

// 달력 안의 버튼들 (PC 왼쪽 달력, 휴대폰 달력 창 둘 다)
function onCalendarClick(e) {
  const nav = e.target.closest("[data-cal-nav]");
  if (nav) {
    const t = new Date(calYear, calMonth + Number(nav.dataset.calNav), 1);
    calYear = t.getFullYear();
    calMonth = t.getMonth();
    return renderCalendars();
  }
  if (e.target.closest("[data-cal-today]")) {
    calSelected = todayStr();
    calYear = new Date().getFullYear();
    calMonth = new Date().getMonth();
    return renderCalendars();
  }
  const day = e.target.closest("[data-cal-date]");
  if (day) {
    calSelected = day.dataset.calDate;
    const [y, m] = calSelected.split("-").map(Number);
    calYear = y; // 앞뒤 달 날짜를 누르면 그 달로 이동
    calMonth = m - 1;
    return renderCalendars();
  }
  // 일정을 누르면 그 협찬의 수정 창 열기
  const ev = e.target.closest("[data-cal-edit]");
  if (ev) {
    if (calendarDialog.open) calendarDialog.close();
    openEditor(items.find((it) => it.id === ev.dataset.calEdit));
  }
}

calendarSide.addEventListener("click", onCalendarClick);
calendarSheet.addEventListener("click", onCalendarClick);

$("calendarButton").addEventListener("click", () => {
  renderCalendars();
  calendarDialog.showModal();
});
$("calendarClose").addEventListener("click", () => calendarDialog.close());

// 휴대폰 달력 창을 연 채로 화면이 PC 폭으로 넓어지면 창은 닫기 (왼쪽 달력이 대신 보임)
window.matchMedia?.("(min-width: 1024px)").addEventListener?.("change", (e) => {
  if (e.matches && calendarDialog.open) calendarDialog.close();
});

function render() {
  renderCalendars();

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
applyTypesBox.innerHTML = APPLY_TYPES.map((type) => `
  <span class="apply-type">
    <label><input type="checkbox" data-apply-type="${type}"> ${type}</label>
    ${type === PAID_TYPE ? `
    <span class="amount-input">
      <input type="text" id="paidAmount" inputmode="numeric" autocomplete="off" placeholder="금액" aria-label="유가 협찬 금액 (원)">
      <span>원</span>
    </span>` : ""}
  </span>`).join("");
const applyTypeInputs = () => [...applyTypesBox.querySelectorAll("[data-apply-type]")];
const paidAmount = $("paidAmount");
const paidCheckbox = () => applyTypeInputs().find((cb) => cb.dataset.applyType === PAID_TYPE);

// 종류를 하나라도 체크하면 "협찬"(신청)도 자동 체크 (해제할 땐 그대로 둠)
function checkApplied() {
  if (editForm.elements.applied.checked) return;
  Object.entries(cascade("applied", true)).forEach(([k, v]) => (editForm.elements[k].checked = v));
}

applyTypesBox.addEventListener("change", (e) => {
  if (e.target.dataset.applyType !== undefined && e.target.checked) checkApplied();
});

// 경로(직접 신청 / 제안 받음)를 고르면 "협찬"도 자동 체크
const originInputs = () => [...editForm.querySelectorAll('input[name="origin"]')];
originInputs().forEach((r) => r.addEventListener("change", checkApplied));

// 금액을 입력하면 세 자리마다 쉼표, "유가 협찬"도 자동 체크
paidAmount.addEventListener("input", () => {
  const fromEnd = paidAmount.value.length - paidAmount.selectionEnd; // 커서 위치 유지용
  const n = parseWon(paidAmount.value);
  paidAmount.value = n === null ? "" : formatWon(n);
  const pos = Math.max(0, paidAmount.value.length - fromEnd);
  paidAmount.setSelectionRange(pos, pos);
  if (n !== null && !paidCheckbox().checked) {
    paidCheckbox().checked = true;
    checkApplied();
  }
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
  paidAmount.value = item?.paid_amount ? formatWon(item.paid_amount) : "";
  originInputs().forEach((r) => (r.checked = r.value === item?.origin));

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
    if (changes.applied === false) [...applyTypeInputs(), ...originInputs()].forEach((cb) => (cb.checked = false));
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

// "+ 새 협찬": PC는 오른쪽 위, 휴대폰은 필터 줄 오른쪽
document.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => openEditor()));
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
  payload.origin = originInputs().find((r) => r.checked)?.value ?? null;
  // 금액은 "유가 협찬"을 체크했을 때만 저장
  payload.paid_amount = payload.apply_types.includes(PAID_TYPE) ? parseWon(paidAmount.value) : null;
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
  showFormMessage(loginForm, "config.js 에 Supabase 연결 정보를 먼저 넣어 주세요.");
  loginForm.querySelector('[type="submit"]').disabled = true;
} else {
  handleLinkError();
  db.auth.getSession().then(({ data }) => showView(data.session));
  db.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") recoveryMode = true;
    showView(session);
  });
}

// 자정이 지나면 D-day가 바뀌므로, 다시 화면에 돌아왔을 때 새로 그림
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && currentUserId) render();
});
