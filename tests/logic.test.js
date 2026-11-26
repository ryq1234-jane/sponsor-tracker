// app.js 의 계산 로직을 가짜 화면(DOM) 위에서 실행해 보는 테스트
// 실행: 프로젝트 폴더에서  node tests/logic.test.js
// (Supabase나 브라우저 없이 마감일 계산, 체크 단계, 정렬, 카드 표시, 메모 링크 등을 확인)
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// 무엇이든 받아주는 가짜 객체 (화면 요소 대신)
const stub = () => new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => "" : k === "value" ? "" : stub()),
  set: () => true,
  apply: () => stub(),
});

const ctx = {
  window: { APP_CONFIG: { SUPABASE_URL: "여기에", SUPABASE_KEY: "여기에" }, addEventListener() {} },
  document: stub(),
  console,
  setTimeout, clearTimeout,
};
vm.createContext(ctx);
const src = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
vm.runInContext(src + "\n;globalThis.__t = { cascade, calcDue, addDays, daysFromToday, todayStr, sortItems, stageOf, cardHtml, esc, getPosts, getMemos, getApplyTypes, parseWon, formatWon, expandedMemos, expandedLists, calendarEvents, calendarHtml, eventClass, isRedDay, applyChipLabel, inPeriod, monthRange, settleDate, settlement, settleHtml, authScreenFromHash, friendlyError, avatarHtml, checkAvatarFile, profileBannerHtml, memoIndex, linkify };", ctx);
const t = ctx.__t;

let fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${ok ? "" : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`);
};

// 마감일 계산
eq("수령 11/19 + 7일", t.calcDue("2026-11-19", 7), "2026-11-26");
eq("월말 넘김 11/28 + 7일", t.calcDue("2026-11-28", "7"), "2026-12-05");
eq("연말 넘김 12/30 + 3일", t.calcDue("2026-12-30", 3), "2027-01-02");
eq("며칠 비어있으면 계산 안 함", t.calcDue("2026-11-19", ""), null);
eq("수령일 없으면 계산 안 함", t.calcDue(null, 7), null);

// 체크 단계 연결
eq("수령 체크 → 신청·선정 자동", t.cascade("received", true), { received: true, applied: true, selected: true, rejected: false });
eq("선정 해제 → 수령·리뷰 해제", t.cascade("selected", false), { selected: false, received: false, reviewed: false });
eq("미선정 체크", t.cascade("rejected", true), { rejected: true, applied: true, selected: false, received: false, reviewed: false });
eq("신청 체크는 미선정 그대로", t.cascade("applied", true), { applied: true });

// 단계
eq("수령만 → 리뷰 작성 중", t.stageOf({ applied: true, selected: true, received: true }), "received");
eq("선정 → 배송 대기", t.stageOf({ applied: true, selected: true }), "selected");

// 정렬: 진행 중 먼저, 마감 가까운 순, 마감 없는 건 뒤로
const today = t.todayStr();
const items = [
  { id: "a", title: "마감없음", applied: true, review_due: null, created_at: "2026-11-01" },
  { id: "b", title: "5일후", applied: true, selected: true, received: true, review_due: t.addDays(today, 5), created_at: "2026-11-02" },
  { id: "c", title: "완료", reviewed: true, review_due: t.addDays(today, -10), created_at: "2026-11-03" },
  { id: "d", title: "지남", applied: true, selected: true, received: true, review_due: t.addDays(today, -2), created_at: "2026-11-04" },
  { id: "e", title: "2일후", applied: true, selected: true, received: true, review_due: t.addDays(today, 2), created_at: "2026-11-05" },
];
eq("정렬 순서", t.sortItems(items).map((i) => i.title), ["지남", "2일후", "5일후", "마감없음", "완료"]);

// 카드 표시
const card = t.cardHtml(items[4]);
eq("2일 남음 → 주황 강조", /is-soon/.test(card) && /D-2/.test(card), true);
eq("지남 → 빨간 강조", /is-overdue/.test(t.cardHtml(items[3])) && /마감 2일 지남/.test(t.cardHtml(items[3])), true);
eq("수령 후 N일 표시", /수령 후 7일 이내/.test(t.cardHtml({ ...items[0], review_days: 7 })), true);
const evil = t.cardHtml({ ...items[0], title: "<img src=x onerror=alert(1)>", recruit_url: "javascript:alert(1)" });
eq("위험한 입력은 글자로만 표시", !/<img/.test(evil) && !/javascript:/.test(evil), true);

// 게시물 체크리스트
eq("예전 항목은 게시물 1개로", t.getPosts({ reviewed: true, review_url: "https://a.com", posts: [] }), [{ label: "", url: "https://a.com", done: true }]);
const three = { id: "p", title: "3개", applied: true, selected: true, received: true, reviewed: false, created_at: "x",
  posts: [{ label: "피드", url: "", done: true }, { label: "릴스", url: "https://ig.com/r", done: false }, { label: "", url: "", done: false }] };
const pc = t.cardHtml(three);
eq("카드에 리뷰 1/3 표시", /리뷰 1\/3/.test(pc), true);
eq("카드에 게시물 이름 표시 (빈 이름은 '게시물 3')", /피드/.test(pc) && /릴스/.test(pc) && /게시물 3/.test(pc), true);
eq("게시물 링크 표시", /https:\/\/ig\.com\/r/.test(pc), true);
eq("카드에는 누를 수 있는 체크박스가 없음", /type="checkbox"/.test(pc), false);
eq("리뷰 버튼이 게시물 목록을 여닫음", /data-list-toggle="posts-p"/.test(pc) && /aria-controls="posts-p"/.test(pc), true);
eq("게시물 목록은 처음엔 접혀 있음", /id="posts-p"\s+hidden/.test(pc), true);
t.expandedLists.add("posts-p");
eq("펼친 게시물 목록은 다시 그려도 펼친 상태", /id="posts-p"\s+>/.test(t.cardHtml(three)) && /aria-expanded="true"/.test(t.cardHtml(three)), true);
eq("게시물 1개여도 리뷰 1/1 메뉴", /리뷰 0\/1/.test(t.cardHtml({ ...three, id: "q", posts: [three.posts[1]] })), true);
eq("리뷰 다 끝나면 '리뷰 ✓'", />리뷰 ✓<\/button>/.test(t.cardHtml({ ...three, id: "r1", reviewed: true, posts: three.posts.map((p) => ({ ...p, done: true })) })), true);
eq("리뷰 덜 끝났으면 개수만", />리뷰 1\/3<\/button>/.test(pc), true);
eq("완료한 게시물은 완료 표시", /<li class="done">/.test(pc), true);

// 신청 종류 (신청의 하위 메뉴)
eq("예전 항목은 신청 종류 없음", t.getApplyTypes({ applied: true }), []);
eq("모르는 종류는 무시", t.getApplyTypes({ apply_types: ["유가 협찬", "이상한값"] }), ["유가 협찬"]);
const ac = t.cardHtml({ ...three, id: "ap", apply_types: ["유가 협찬"] });
eq("신청 버튼이 신청 종류 목록을 여닫음", /data-list-toggle="apply-ap"/.test(ac) && /aria-controls="apply-ap"/.test(ac), true);
eq("신청 종류 목록은 처음엔 접혀 있음", /id="apply-ap"\s+hidden/.test(ac), true);
eq("두 종류 모두 표시, 유가 협찬만 체크", /<li class="">\s*<span[^>]*><\/span>\s*<span class="post-name">제품 제공/.test(ac) && /<li class="done">\s*<span[^>]*><\/span>\s*<span class="post-name">유가 협찬/.test(ac), true);
eq("신청 칩은 신청 상태면 체크 표시", /review-chip on( paid)?"\s+data-list-toggle="apply-ap"/.test(ac), true);
eq("금액 읽기: 쉼표·원 무시", t.parseWon("300,000원"), 300000);
eq("금액 읽기: 숫자 없으면 비움", t.parseWon("금액"), null);
eq("금액 표시: 세 자리 쉼표", t.formatWon(1500000), "1,500,000");
eq("유가 협찬 옆에 금액 표시", /유가 협찬<\/span>\s*<span class="apply-amount">300,000원/.test(t.cardHtml({ ...three, id: "m1", apply_types: ["유가 협찬"], paid_amount: 300000 })), true);
eq("유가 협찬 체크 안 했으면 금액 숨김", /apply-amount/.test(t.cardHtml({ ...three, id: "m2", apply_types: ["제품 제공"], paid_amount: 300000 })), false);
eq("제안 받음 태그", /<span class="origin origin-offered">제안 받음<\/span>/.test(t.cardHtml({ ...three, id: "o1", origin: "offered" })), true);
eq("직접 신청 태그", /<span class="origin origin-applied">직접 신청<\/span>/.test(t.cardHtml({ ...three, id: "o2", origin: "applied" })), true);
eq("경로 없거나 이상한 값이면 태그 없음", /class="origin/.test(t.cardHtml({ ...three, id: "o3" })) || /class="origin/.test(t.cardHtml({ ...three, id: "o4", origin: "<b>x" })), false);
eq("종류를 안 골랐으면 버튼 이름은 '협찬'", /aria-controls="apply-n0">협찬<\/button>/.test(t.cardHtml({ ...three, id: "n0", apply_types: [] })), true);
t.expandedLists.add("apply-ap");
eq("펼친 신청 종류는 다시 그려도 펼친 상태", /id="apply-ap"\s+>/.test(t.cardHtml({ ...three, id: "ap" })), true);

// 메모 (여러 개, 슬라이드)
eq("예전 메모 1개 → 메모 목록으로", t.getMemos({ memo: "옛 메모", memos: [] }), ["옛 메모"]);
eq("메모 없음 → 빈 목록", t.getMemos({ memo: null, memos: [] }), []);
const memoCard = t.cardHtml({ ...three, memos: ["첫 메모\n2\n3\n4", "<b>둘째</b>", "셋째"] });
eq("메모 3장 슬라이드", (memoCard.match(/class="memo-slide"/g) || []).length, 3);
eq("메모 넘기기 버튼과 1/3 표시", /data-memo-step="1"/.test(memoCard) && /data-memo-step="-1"/.test(memoCard) && /1\/3/.test(memoCard), true);
eq("메모 글자도 안전하게 표시", /<b>둘째/.test(memoCard), false);
eq("메모 1장이면 넘기기 표시 없음", /memo-nav/.test(t.cardHtml({ ...three, memos: ["하나"] })), false);
eq("메모 없으면 메모 칸 없음", /class="memos"/.test(t.cardHtml({ ...three, memos: [] })), false);
t.memoIndex.set("p", 2);
eq("보던 메모 번호 유지 (3/3)", /3\/3/.test(t.cardHtml({ ...three, memos: ["a", "b", "c"] })), true);
eq("메모가 줄어도 번호가 넘치지 않음 (2/2)", /2\/2/.test(t.cardHtml({ ...three, memos: ["a", "b"] })), true);
t.expandedMemos.add("p:1");
const exp = t.cardHtml({ ...three, memos: ["a", "b"] });
eq("두 번째 메모만 펼친 상태 유지", (exp.match(/memo expanded/g) || []).length === 1 && /data-memo-toggle="p:1"[^>]*>접기/.test(exp), true);

// 메모 속 링크
const A = (href, text = href) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
eq("기본 링크", t.linkify("가이드 https://a.com/x?y=1&z=2 확인"), `가이드 ${A("https://a.com/x?y=1&amp;z=2")} 확인`);
eq("뒤에 붙은 한글은 제외", t.linkify("https://a.com에서 확인"), `${A("https://a.com")}에서 확인`);
eq("문장 끝 마침표 제외", t.linkify("참고: https://a.com."), `참고: ${A("https://a.com")}.`);
eq("괄호 안 주소", t.linkify("(https://a.com)"), `(${A("https://a.com")})`);
eq("www 주소는 https 붙여서", t.linkify("www.naver.com"), A("https://www.naver.com", "www.naver.com"));
eq("여러 줄 · 여러 링크", t.linkify("1 http://a.com\n2 https://b.com"), `1 ${A("http://a.com")}\n2 ${A("https://b.com")}`);
eq("링크 없는 글은 그대로(안전 처리만)", t.linkify("<b>굵게</b> & 끝"), "&lt;b&gt;굵게&lt;/b&gt; &amp; 끝");
eq("javascript: 는 링크 안 됨", /<a/.test(t.linkify("javascript:alert(1)")), false);
eq("주소 속 따옴표로 코드 삽입 불가", /onmouseover=/.test(t.linkify('https://a.com/"onmouseover="x')) && !/" onmouseover/.test(t.linkify('https://a.com/"onmouseover="x')), true);
eq("카드 메모에 링크 표시", /<a href="https:\/\/ig\.com\/p"/.test(t.cardHtml({ ...three, memos: ["가이드 https://ig.com/p"] })), true);

// 일정 달력
const calItems = [
  { id: "c1", title: "마감항목", applied: true, selected: true, received: true, received_date: "2026-11-10", review_due: "2026-11-17", created_at: "x" },
  { id: "c2", title: "<b>위험</b>", applied: true, selected: true, received: true, review_due: "2026-11-17", created_at: "x" },
  { id: "c3", title: "완료", reviewed: true, review_due: "2026-12-01", created_at: "x" },
];
const evs = t.calendarEvents(calItems);
eq("같은 날 마감 2개", evs["2026-11-17"].map((e) => e.item.id), ["c1", "c2"]);
eq("수령일은 달력에 안 나옴", evs["2026-11-10"], undefined);
eq("완료한 항목은 회색", t.eventClass(evs["2026-12-01"][0]), "ev-done");
eq("수령 표시 없음", /수령/.test(t.calendarHtml(calItems, 2026, 10, "2026-11-10")), false);
const cal = t.calendarHtml(calItems, 2026, 10, "2026-11-17"); // 2026년 11월
eq("달 제목", /2026년 11월/.test(cal), true);
eq("11/1은 일요일 → 앞에 빈 칸 없이 시작, 5주(35칸)", (cal.match(/data-cal-date=/g) || []).length === 35 && /data-cal-date="2026-11-01"/.test(cal.split("cal-day")[1]), true);
eq("2026년 2월은 4주(28칸)", (t.calendarHtml([], 2026, 1, "2026-02-01").match(/data-cal-date=/g) || []).length, 28);
eq("2026년 8월은 6주(42칸, 1일이 토요일)", (t.calendarHtml([], 2026, 7, "2026-08-01").match(/data-cal-date=/g) || []).length, 42);
eq("앞뒤 달 날짜는 흐리게", /class="cal-day other" data-cal-date="2026-12-01"/.test(cal) || /cal-day other[^"]*" data-cal-date="2026-12-0/.test(cal), true);
eq("고른 날짜 표시", /cal-day[^"]*selected" data-cal-date="2026-11-17"/.test(cal), true);
eq("고른 날짜의 일정 2개 목록", (cal.match(/data-cal-edit=/g) || []).length, 2);
eq("일정 제목도 안전하게", /<b>위험/.test(cal), false);
eq("일정 없는 날", /일정이 없어요/.test(t.calendarHtml(calItems, 2026, 10, "2026-11-05")), true);
eq("일정 3개까지만 점", (t.calendarHtml([...calItems, ...calItems], 2026, 10, "x").split('data-cal-date="2026-11-17"')[1].split("</button>")[0].match(/<i /g) || []).length, 3);

// 로그인 쪽 화면 고르기 (주소 끝 #...)
eq("주소에 # 없으면 로그인", t.authScreenFromHash(""), "login");
eq("#signup → 회원가입", t.authScreenFromHash("#signup"), "signup");
eq("#forgot → 비밀번호 찾기", t.authScreenFromHash("#forgot"), "forgot");
eq("메일 링크 주소(#access_token...)는 로그인으로", t.authScreenFromHash("#access_token=x&type=recovery"), "login");
eq("#reset 은 직접 못 들어감", t.authScreenFromHash("#reset"), "login");

// 오류 문구
eq("초대 코드 거절", t.friendlyError({ message: "Database error saving new user" }), "초대 코드가 올바르지 않거나 마감됐어요. 안내받은 코드를 다시 확인해 주세요.");
eq("로그인 실패", t.friendlyError({ message: "Invalid login credentials" }), "이메일 또는 비밀번호가 맞지 않아요.");
eq("같은 비밀번호로 변경", t.friendlyError({ message: "New password should be different from the old password." }), "지금 쓰는 비밀번호와 다른 비밀번호를 입력해 주세요.");
eq("메일 너무 자주 요청", t.friendlyError({ message: "For security purposes, you can only request this after 42 seconds." }), "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.");
eq("메일 발송 실패", t.friendlyError({ message: "Error sending recovery email" }), "메일을 보내지 못했어요. 잠시 후 다시 시도해 주세요.");

// 프로필
eq("사진 없으면 빈 사람 모양", /<svg/.test(t.avatarHtml(null)) && !/<img/.test(t.avatarHtml(null)), true);
eq("저장된 사진은 이미지로", /<img src="data:image\/jpeg;base64,AAAA"/.test(t.avatarHtml("data:image/jpeg;base64,AAAA")), true);
eq("이상한 주소는 사진으로 안 씀", /<img/.test(t.avatarHtml('javascript:alert(1)')) || /<img/.test(t.avatarHtml('data:image/jpeg;base64,AA" onerror="x')), false);
eq("5MB 넘는 사진 막기", /너무 커요 \(6\.0MB\)/.test(t.checkAvatarFile({ type: "image/jpeg", size: 6 * 1024 * 1024 })), true);
eq("5MB 이하 사진은 통과", t.checkAvatarFile({ type: "image/png", size: 5 * 1024 * 1024 }), null);
eq("사진이 아닌 파일 막기", t.checkAvatarFile({ type: "application/pdf", size: 1000 }), "JPG, PNG, WEBP 사진만 올릴 수 있어요.");
eq("아이폰 HEIC 막기", t.checkAvatarFile({ type: "image/heic", size: 1000 }), "JPG, PNG, WEBP 사진만 올릴 수 있어요.");
const pc1 = t.profileBannerHtml({ nickname: "", avatar: null }, true);
eq("닉네임 없으면 안내 문구", /banner-name is-empty">닉네임을 설정해 주세요/.test(pc1), true);
eq("PC 프로필에는 톱니바퀴", /class="profile-gear" data-open-info/.test(pc1), true);
eq("휴대폰 프로필에는 톱니바퀴 없음", /profile-gear/.test(t.profileBannerHtml({ nickname: "", avatar: null })), false);
eq("닉네임은 사진 안에 (안전하게)", /<img[^>]*>\s*<p class="banner-name ">&lt;b&gt;수이/.test(t.profileBannerHtml({ nickname: "<b>수이", avatar: "data:image/webp;base64,AAAA" }, true)), true);
eq("사진 없으면 빈 사람 모양 줄", /banner no-photo/.test(pc1), true);

// 빨간 날 (주말·공휴일)
eq("일요일은 빨간 날", t.isRedDay("2026-11-29"), true);
eq("토요일은 빨간 날", t.isRedDay("2026-11-28"), true);
eq("평일은 아님", t.isRedDay("2026-11-25"), false);
eq("추석 연휴(목)는 빨간 날", t.isRedDay("2026-09-24"), true);
eq("대체공휴일(월)도 빨간 날", t.isRedDay("2026-10-05"), true);
const dec = t.calendarHtml([], 2026, 11, "2026-12-01");
eq("성탄절 칸에 빨강 표시와 이름", /cal-day red" data-cal-date="2026-12-25" title="성탄절"/.test(dec), true);
eq("평일 칸에는 빨강 없음", /class="cal-day" data-cal-date="2026-12-24"/.test(dec), true);

// 협찬 버튼에 체크한 종류 표시
eq("종류 없으면 '협찬'", t.applyChipLabel([]), "협찬");
eq("하나면 그 이름", t.applyChipLabel(["제품 제공"]), "제품 제공");
eq("둘 다면 '유가 협찬'만", t.applyChipLabel(["제품 제공", "유가 협찬"]), "유가 협찬");
eq("카드 버튼에 반영", /aria-controls="apply-ap">유가 협찬<\/button>/.test(t.cardHtml({ ...three, id: "ap", apply_types: ["유가 협찬"] })), true);

// 유가 협찬이면 협찬 버튼·목록 분홍(paid)
const paidCard = t.cardHtml({ ...three, id: "pd", apply_types: ["제품 제공", "유가 협찬"] });
eq("유가 협찬 → 협찬 버튼 분홍", /class="chip review-chip on paid"/.test(paidCard), true);
eq("유가 협찬 → 펼친 목록도 분홍", /apply-list on paid"/.test(paidCard), true);
eq("제품 제공만이면 분홍 아님", /paid/.test(t.cardHtml({ ...three, id: "pp", apply_types: ["제품 제공"] })), false);

// 기간별 조회 (리뷰 마감일 기준)
eq("기간 없으면 모두", t.inPeriod({ review_due: null }, "", ""), true);
eq("기간 안", t.inPeriod({ review_due: "2026-11-15" }, "2026-11-01", "2026-11-30"), true);
eq("시작일·종료일 당일 포함", t.inPeriod({ review_due: "2026-11-30" }, "2026-11-01", "2026-11-30") && t.inPeriod({ review_due: "2026-11-01" }, "2026-11-01", ""), true);
eq("기간 밖", t.inPeriod({ review_due: "2026-12-01" }, "2026-11-01", "2026-11-30"), false);
eq("기간 정하면 마감일 없는 건 빠짐", t.inPeriod({ review_due: null }, "2026-11-01", ""), false);
eq("이번 달 범위", t.monthRange(0, new Date(2026, 10, 26)), ["2026-11-01", "2026-11-30"]);
eq("지난 달 범위 (해 넘김)", t.monthRange(-1, new Date(2027, 0, 5)), ["2026-12-01", "2026-12-31"]);
eq("2월 마지막 날", t.monthRange(0, new Date(2028, 1, 10)), ["2028-02-01", "2028-02-29"]);

// 월별 정산 (리뷰 완료한 달 기준)
eq("리뷰 전이면 정산 날짜 없음", t.settleDate({ reviewed: false, review_due: "2026-11-01" }), null);
eq("리뷰 완료일 기준", t.settleDate({ reviewed: true, reviewed_date: "2026-11-03", review_due: "2026-10-30" }), { date: "2026-11-03", guessed: false });
eq("완료일 없는 예전 기록은 마감일로 추정", t.settleDate({ reviewed: true, review_due: "2026-10-30" }), { date: "2026-10-30", guessed: true });
const sl = [
  { id: "s1", title: "A", reviewed: true, reviewed_date: "2026-11-03", apply_types: ["제품 제공", "유가 협찬"], paid_amount: 300000, deposited: true },
  { id: "s2", title: "B", reviewed: true, reviewed_date: "2026-11-20", apply_types: ["유가 협찬"], paid_amount: 200000, deposited: false },
  { id: "s3", title: "C", reviewed: true, reviewed_date: "2026-11-21", apply_types: ["제품 제공"] },
  { id: "s4", title: "D", reviewed: true, review_due: "2026-10-05", apply_types: ["유가 협찬"], paid_amount: 100000 },
  { id: "s5", title: "E", reviewed: true, reviewed_date: "2025-12-31", apply_types: ["유가 협찬"], paid_amount: 999 },
  { id: "s6", title: "F", selected: true, apply_types: ["유가 협찬"], paid_amount: 50000 },
  { id: "s7", title: "G", applied: true, apply_types: ["유가 협찬"], paid_amount: 70000 },
];
const st = t.settlement(sl, 2026);
eq("달별로 나눔 (최근 달 위)", st.rows.map((r) => r.month), [11, 10]);
eq("11월 합계·입금", [st.rows[0].amount, st.rows[0].deposited, st.rows[0].paidCount, st.rows[0].productCount], [500000, 300000, 2, 1]);
eq("한 해 합계 (다른 해 제외)", st.total, { amount: 600000, deposited: 300000, paidCount: 3, productCount: 1 });
eq("리뷰 전 유가 협찬 = 정산 예정 (선정된 것만)", st.upcoming, { count: 1, amount: 50000 });
eq("추정한 예전 기록 수", st.guessed, 1);
const sh = t.settleHtml(sl, 2026);
eq("정산 화면: 입금 전 금액", /입금 전 200,000원/.test(sh), true);
eq("정산 화면: 추정 안내", /예전 기록 1건/.test(sh), true);
eq("정산 화면: 누르면 수정 창", /data-settle-edit="s2"/.test(sh), true);
eq("빈 해 안내", /2024년에 리뷰를 완료한 협찬이 없어요/.test(t.settleHtml(sl, 2024)), true);
eq("카드에 입금 여부", /입금 완료/.test(t.cardHtml({ ...three, id: "dp", apply_types: ["유가 협찬"], deposited: true })) && /입금 전/.test(t.cardHtml({ ...three, id: "dq", apply_types: ["유가 협찬"] })), true);
eq("제품 제공만이면 입금 표시 없음", /입금/.test(t.cardHtml({ ...three, id: "dr", apply_types: ["제품 제공"] })), false);

console.log(fail ? `\n${fail}개 실패` : "\n모두 통과");
process.exit(fail ? 1 : 0);
