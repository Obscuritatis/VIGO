-- Nazicht VIGO: inventaris van rolstoelen, rollators, looprekken en krukken per site, de jaarlijkse nazichten,
-- toegangsregels en fotobucket.
-- Draait in hetzelfde Supabase-project als de veiligheidsrondes en de staalnamen en raakt die gegevens niet aan.
-- Het gebruikt wel de bestaande toegangslijst "toegang" en de functie heeft_toegang() van de
-- veiligheidsrondes: wie daar toegang heeft, heeft ook toegang tot deze app.
-- Plak dit volledig in Supabase > SQL Editor en klik op Run. Opnieuw uitvoeren kan geen kwaad.

-- Veiligheidscheck: de toegangslijst van de veiligheidsrondes moet al bestaan.
do $$ begin
  if to_regprocedure('public.heeft_toegang()') is null then
    raise exception 'Functie public.heeft_toegang() ontbreekt. Voer eerst het schema van de veiligheidsrondes uit.';
  end if;
end $$;

-- Inventaris per site. "soort": rolstoel, rollator, looprek of kruk.
-- "foto" en "foto2": tot 2 foto's van het toestel, zodat je het herkent.
-- "uit_dienst": afgekeurd of weg; komt niet meer in een nieuw nazicht, maar blijft in oude nazichten staan.
create table if not exists public.vigo_toestellen (
  id uuid primary key default gen_random_uuid(),
  site text not null,
  soort text not null,
  nummer text not null default '',
  merk text not null default '',
  afdeling text not null default '',
  omschrijving text not null default '',
  foto text,
  foto2 text,
  uit_dienst boolean not null default false,
  aangemaakt timestamptz not null default now(),
  aangemaakt_door uuid default auth.uid()
);
alter table public.vigo_toestellen add column if not exists serienummer text not null default '';
create index if not exists vigo_toestellen_site_idx on public.vigo_toestellen(site, soort);

-- Een nazicht: VIGO komt één keer per jaar langs op een site.
create table if not exists public.vigo_nazichten (
  id uuid primary key default gen_random_uuid(),
  site text not null,
  datum date not null,
  aangemaakt timestamptz not null default now(),
  aangemaakt_door uuid default auth.uid()
);
create index if not exists vigo_nazichten_site_idx on public.vigo_nazichten(site, datum desc);

-- Elk toestel van een nazicht, met een kopie van de gegevens uit de inventaris zodat latere
-- wijzigingen oude nazichten niet veranderen.
-- "resultaat": leeg (nog na te kijken), ok, hersteld, herstel, afgekeurd of niet-gevonden.
create table if not exists public.vigo_nazicht_toestellen (
  id uuid primary key default gen_random_uuid(),
  nazicht_id uuid not null references public.vigo_nazichten(id) on delete cascade,
  toestel_id uuid references public.vigo_toestellen(id) on delete set null,
  volgorde integer not null default 0,
  soort text not null default '',
  nummer text not null default '',
  merk text not null default '',
  afdeling text not null default '',
  omschrijving text not null default '',
  resultaat text not null default '',
  opmerkingen text not null default '',
  fotos text[] not null default '{}',
  aangemaakt timestamptz not null default now(),
  aangemaakt_door uuid default auth.uid()
);
alter table public.vigo_nazicht_toestellen add column if not exists serienummer text not null default '';
create index if not exists vigo_nazicht_toestellen_nazicht_idx on public.vigo_nazicht_toestellen(nazicht_id, volgorde);

alter table public.vigo_toestellen enable row level security;
alter table public.vigo_nazichten enable row level security;
alter table public.vigo_nazicht_toestellen enable row level security;

drop policy if exists "vigo_toestellen voor collega's" on public.vigo_toestellen;
create policy "vigo_toestellen voor collega's" on public.vigo_toestellen
  for all to authenticated using (public.heeft_toegang()) with check (public.heeft_toegang());
drop policy if exists "vigo_nazichten voor collega's" on public.vigo_nazichten;
create policy "vigo_nazichten voor collega's" on public.vigo_nazichten
  for all to authenticated using (public.heeft_toegang()) with check (public.heeft_toegang());
drop policy if exists "vigo_nazicht_toestellen voor collega's" on public.vigo_nazicht_toestellen;
create policy "vigo_nazicht_toestellen voor collega's" on public.vigo_nazicht_toestellen
  for all to authenticated using (public.heeft_toegang()) with check (public.heeft_toegang());

-- Foto's: aparte privé-bucket, enkel voor e-mailadressen in "toegang".
insert into storage.buckets (id, name, public) values ('vigo-fotos', 'vigo-fotos', false)
on conflict (id) do nothing;

drop policy if exists "vigo fotos lezen" on storage.objects;
create policy "vigo fotos lezen" on storage.objects for select to authenticated
  using (bucket_id = 'vigo-fotos' and public.heeft_toegang());
drop policy if exists "vigo fotos toevoegen" on storage.objects;
create policy "vigo fotos toevoegen" on storage.objects for insert to authenticated
  with check (bucket_id = 'vigo-fotos' and public.heeft_toegang());
drop policy if exists "vigo fotos wijzigen" on storage.objects;
create policy "vigo fotos wijzigen" on storage.objects for update to authenticated
  using (bucket_id = 'vigo-fotos' and public.heeft_toegang());
drop policy if exists "vigo fotos verwijderen" on storage.objects;
create policy "vigo fotos verwijderen" on storage.objects for delete to authenticated
  using (bucket_id = 'vigo-fotos' and public.heeft_toegang());

-- Live bijwerken wanneer een collega iets wijzigt.
do $$ begin
  alter publication supabase_realtime add table public.vigo_toestellen;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.vigo_nazichten;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.vigo_nazicht_toestellen;
exception when duplicate_object then null; end $$;
