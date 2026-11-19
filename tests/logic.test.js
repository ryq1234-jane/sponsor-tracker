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
vm.runInContext(src + "\n;globalThis.__t = { cascade, calcDue, addDays, daysFromToday, todayStr, sortItems, stageOf, cardHtml, esc, getPosts, getMemos, expandedMemos, expandedPosts, memoIndex, linkify };", ctx);
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
eq("리뷰 버튼이 게시물 목록을 여닫음", /data-posts-toggle="p"/.test(pc) && /aria-controls="posts-p"/.test(pc), true);
eq("게시물 목록은 처음엔 접혀 있음", /id="posts-p"\s+hidden/.test(pc), true);
t.expandedPosts.add("p");
eq("펼친 게시물 목록은 다시 그려도 펼친 상태", /id="posts-p"\s+>/.test(t.cardHtml(three)) && /aria-expanded="true"/.test(t.cardHtml(three)), true);
eq("게시물 1개여도 리뷰 1/1 메뉴", /리뷰 0\/1/.test(t.cardHtml({ ...three, id: "q", posts: [three.posts[1]] })), true);
eq("완료한 게시물은 완료 표시", /<li class="done">/.test(pc), true);

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

console.log(fail ? `\n${fail}개 실패` : "\n모두 통과");
process.exit(fail ? 1 : 0);
