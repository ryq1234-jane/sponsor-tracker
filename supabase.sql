-- 협찬 체크리스트 테이블
-- Supabase 대시보드 → SQL Editor 에 이 내용을 전부 붙여 넣고 Run 하세요.
-- (예전 버전을 이미 실행했어도 다시 실행하면 새 구조로 맞춰져요.)

create table if not exists public.sponsorships (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,

  title        text not null,          -- 업체 / 브랜드 이름
  platform     text,                   -- 모집처 (예: 레뷰, 브랜드 DM)
  offer        text,                   -- 제공 내용 (제품명, 금액 등)

  applied      boolean not null default false,  -- 신청함
  selected     boolean not null default false,  -- 선정됨
  rejected     boolean not null default false,  -- 미선정
  received     boolean not null default false,  -- 택배 수령
  reviewed     boolean not null default false,  -- 리뷰 작성 완료

  received_date date,                  -- 수령일
  review_days  integer,                -- 수령 후 며칠 이내 리뷰 (예: 7)
  review_due   date,                   -- 리뷰 마감일

  recruit_url  text,                   -- 모집 글 주소
  review_url   text,                   -- (예전 버전) 작성한 리뷰 주소 — 지금은 posts 사용
  apply_types  jsonb not null default '[]'::jsonb,  -- 신청 종류 ["제품 제공", "유가 협찬"] 중 체크한 것
  paid_amount  bigint,                 -- 유가 협찬 금액 (원)
  origin       text,                   -- 경로: 'applied' 직접 신청 / 'offered' 제안 받음
  posts        jsonb not null default '[]'::jsonb,  -- 게시물 체크리스트 [{label, url, done}, ...]
  memo         text,                   -- (예전 버전) 메모 1개 — 지금은 memos 사용
  memos        jsonb not null default '[]'::jsonb,  -- 메모 여러 개 ["...", "..."]

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- 예전 버전(방문 방식)에서 바뀐 부분 맞추기
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'sponsorships' and column_name = 'visited') then
    alter table public.sponsorships rename column visited to received;
  end if;
end $$;

alter table public.sponsorships add column if not exists received_date date;
alter table public.sponsorships add column if not exists review_days integer;
alter table public.sponsorships add column if not exists posts jsonb not null default '[]'::jsonb;
alter table public.sponsorships add column if not exists memos jsonb not null default '[]'::jsonb;
alter table public.sponsorships add column if not exists apply_types jsonb not null default '[]'::jsonb;
alter table public.sponsorships add column if not exists paid_amount bigint;
alter table public.sponsorships add column if not exists origin text;
alter table public.sponsorships drop column if exists visit_date;
alter table public.sponsorships drop column if exists visit_time;

-- 수정할 때마다 updated_at 자동 갱신
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists sponsorships_touch on public.sponsorships;
create trigger sponsorships_touch
  before update on public.sponsorships
  for each row execute function public.touch_updated_at();

-- 보안: 로그인한 사람은 "자기 것"만 보고/추가하고/고치고/지울 수 있음
alter table public.sponsorships enable row level security;

drop policy if exists "본인 것만 보기" on public.sponsorships;
create policy "본인 것만 보기" on public.sponsorships
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "본인 것만 추가" on public.sponsorships;
create policy "본인 것만 추가" on public.sponsorships
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "본인 것만 수정" on public.sponsorships;
create policy "본인 것만 수정" on public.sponsorships
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "본인 것만 삭제" on public.sponsorships;
create policy "본인 것만 삭제" on public.sponsorships
  for delete to authenticated using (auth.uid() = user_id);

-- 웹사이트(로그인한 사용자)가 이 테이블을 쓸 수 있게 허용. 로그인 안 한 사람(anon)은 접근 불가.
grant select, insert, update, delete on public.sponsorships to authenticated;
revoke all on public.sponsorships from anon;

-- 회원 탈퇴: 로그인한 "본인" 계정과 협찬 기록만 지우는 함수
-- (사이트에서 db.rpc("delete_my_account") 로 부름. 다른 사람 계정은 지울 수 없음)
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다';
  end if;
  delete from public.sponsorships where user_id = auth.uid();
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- 프로필: 닉네임 + 사진(900×900 WEBP/JPG를 글자로 바꾼 data URL, 최대 약 300KB)
-- 탈퇴하면(auth.users 삭제) 프로필도 함께 지워짐
create table if not exists public.profiles (
  id          uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  nickname    text check (char_length(nickname) <= 20),
  avatar      text check (avatar is null or (avatar like 'data:image/%' and length(avatar) <= 300000)),
  updated_at  timestamptz not null default now()
);

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

alter table public.profiles enable row level security;

drop policy if exists "본인 프로필만 보기" on public.profiles;
create policy "본인 프로필만 보기" on public.profiles
  for select to authenticated using (auth.uid() = id);

drop policy if exists "본인 프로필만 추가" on public.profiles;
create policy "본인 프로필만 추가" on public.profiles
  for insert to authenticated with check (auth.uid() = id);

drop policy if exists "본인 프로필만 수정" on public.profiles;
create policy "본인 프로필만 수정" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

grant select, insert, update on public.profiles to authenticated;
revoke all on public.profiles from anon;
