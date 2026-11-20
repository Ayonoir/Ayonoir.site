-- =====================================================================
--  Ayo Noir client galleries — database + storage setup
--  Paste this whole file into Supabase -> SQL Editor -> Run. Safe to re-run.
--  BEFORE running: create your admin user (Authentication -> Users).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- tables ----------
create table if not exists public.galleries (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  pin text not null check (pin ~ '^[0-9]{6}$'),
  title text not null,
  client_name text not null,
  event_date date,
  expires_at timestamptz not null,
  downloads_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  gallery_id uuid not null references public.galleries(id) on delete cascade,
  path text not null,
  thumb_path text,
  width int,
  height int,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists photos_gallery_pos_idx on public.photos (gallery_id, position);

create table if not exists public.favourites (
  photo_id uuid primary key references public.photos(id) on delete cascade,
  gallery_id uuid not null references public.galleries(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists favourites_gallery_idx on public.favourites (gallery_id);

create table if not exists public.pin_attempts (
  id bigserial primary key,
  slug text not null,
  attempted_at timestamptz not null default now()
);
create index if not exists pin_attempts_idx on public.pin_attempts (slug, attempted_at);

-- ---------- who is the admin? ----------
-- The FIRST user ever created in Supabase Auth is the admin. Nobody else counts.
create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select auth.uid() is not null
     and auth.uid() = (select id from auth.users order by created_at asc limit 1);
$$;

-- ---------- lock everything down (row level security) ----------
alter table public.galleries    enable row level security;
alter table public.photos       enable row level security;
alter table public.favourites   enable row level security;
alter table public.pin_attempts enable row level security;

drop policy if exists "admin all galleries"    on public.galleries;
drop policy if exists "admin all photos"       on public.photos;
drop policy if exists "admin all favourites"   on public.favourites;
drop policy if exists "admin all pin_attempts" on public.pin_attempts;

create policy "admin all galleries"    on public.galleries    for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin all photos"       on public.photos       for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin all favourites"   on public.favourites   for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin all pin_attempts" on public.pin_attempts for all to authenticated using (public.is_admin()) with check (public.is_admin());
-- No policies for anonymous visitors: they can ONLY use the functions below.

-- ---------- PIN check with lockout (5 wrong tries = 15 minute pause) ----------
create or replace function public._check_access(p_slug text, p_pin text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  g public.galleries;
  fails int;
begin
  select count(*) into fails from public.pin_attempts
   where slug = left(coalesce(p_slug, ''), 64) and attempted_at > now() - interval '15 minutes';
  if fails >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;

  select * into g from public.galleries where slug = p_slug;
  if not found or g.pin is distinct from p_pin then
    insert into public.pin_attempts (slug) values (left(coalesce(p_slug, ''), 64));
    delete from public.pin_attempts where attempted_at < now() - interval '2 days';
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  if g.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  return jsonb_build_object('ok', true, 'id', g.id);
end;
$$;

-- ---------- what a client can do ----------
create or replace function public.client_open(p_slug text, p_pin text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  chk jsonb;
  g public.galleries;
begin
  chk := public._check_access(p_slug, p_pin);
  if not (chk->>'ok')::boolean then
    return chk;
  end if;

  select * into g from public.galleries where id = (chk->>'id')::uuid;

  return jsonb_build_object(
    'ok', true,
    'gallery', jsonb_build_object(
      'title', g.title,
      'client_name', g.client_name,
      'event_date', g.event_date,
      'expires_at', g.expires_at,
      'downloads_enabled', g.downloads_enabled
    ),
    'photos', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', p.id, 'path', p.path, 'thumb', p.thumb_path, 'w', p.width, 'h', p.height, 'fav', f.photo_id is not null)
        order by p.position, p.created_at)
      from public.photos p
      left join public.favourites f on f.photo_id = p.id
      where p.gallery_id = g.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.client_set_fav(p_slug text, p_pin text, p_photo uuid, p_fav boolean)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  chk jsonb;
  gid uuid;
begin
  chk := public._check_access(p_slug, p_pin);
  if not (chk->>'ok')::boolean then
    return chk;
  end if;
  gid := (chk->>'id')::uuid;

  if not exists (select 1 from public.photos where id = p_photo and gallery_id = gid) then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  if p_fav then
    insert into public.favourites (photo_id, gallery_id) values (p_photo, gid) on conflict do nothing;
  else
    delete from public.favourites where photo_id = p_photo;
  end if;

  return jsonb_build_object('ok', true, 'fav', p_fav);
end;
$$;

revoke all on function public._check_access(text, text) from public, anon, authenticated;
grant execute on function public.client_open(text, text) to anon, authenticated;
grant execute on function public.client_set_fav(text, text, uuid, boolean) to anon, authenticated;

-- ---------- photo storage ----------
-- Public bucket, but every file has a random unguessable name that is only
-- revealed to someone who has entered the right PIN.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 10485760;

drop policy if exists "admin read photos"   on storage.objects;
drop policy if exists "admin upload photos" on storage.objects;
drop policy if exists "admin update photos" on storage.objects;
drop policy if exists "admin delete photos" on storage.objects;

create policy "admin read photos"   on storage.objects for select to authenticated using (bucket_id = 'photos' and public.is_admin());
create policy "admin upload photos" on storage.objects for insert to authenticated with check (bucket_id = 'photos' and public.is_admin());
create policy "admin update photos" on storage.objects for update to authenticated using (bucket_id = 'photos' and public.is_admin());
create policy "admin delete photos" on storage.objects for delete to authenticated using (bucket_id = 'photos' and public.is_admin());
