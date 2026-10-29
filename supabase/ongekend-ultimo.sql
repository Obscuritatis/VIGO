-- Status ongekend: vroeger gelabeld, maar niet aangeboden bij het nazicht.
alter table public.vigo_toestellen add column if not exists ongekend boolean not null default false;

-- Niet teruggevonden toestellen uit het overzicht van Ultimo (Sint-Alexius en PZ Tienen).
-- Een nummer dat al op de site staat (ook met of zonder voorloopnullen), wordt overgeslagen.
insert into public.vigo_toestellen (site, soort, nummer, merk, afdeling, omschrijving, ongekend)
select v.site, v.soort, v.nummer, v.merk, v.afdeling, v.omschrijving, true
from (values
  ('wzc-sint-alexius', 'rollator', '001463', 'Invacare', 'Kine', 'Reserve'),
  ('wzc-sint-alexius', 'rollator', '001542', 'Invacare P452E/3', 'Kine', 'Reserve'),
  ('wzc-sint-alexius', 'rollator', '001543', 'Invacare P452E/3', 'Kine', 'Reserve'),
  ('wzc-sint-alexius', 'rollator', '001544', 'Premis', 'Kine', 'Reserve'),
  ('wzc-sint-alexius', 'rolstoel', '001462', 'Invacare Action 3', 'Kine', ''),
  ('wzc-sint-alexius', 'rolstoel', '001461', 'Vermeire Eclips', 'Kine', ''),
  ('pz-tienen', 'rollator', '001333', 'Invacare', 'Kine', 'Reserve'),
  ('pz-tienen', 'rollator', '001334', 'Invacare P452E/3', 'Kine', 'Reserve'),
  ('pz-tienen', 'rollator', '000244', 'Vermeire', 'Ouderenpsychiatrie', ''),
  ('pz-tienen', 'rollator', '002195', 'Vermeiren', 'Ouderenpsychiatrie', ''),
  ('pz-tienen', 'rolstoel', '000230', 'Invacare Action 3', 'Algemene psychiatrie 2', ''),
  ('pz-tienen', 'rolstoel', '000241', 'Invacare Action 3', 'Algemene psychiatrie 1', ''),
  ('pz-tienen', 'rolstoel', '000248', 'Invacare Action 3', 'Ouderenpsychiatrie', ''),
  ('pz-tienen', 'rolstoel', '002193', '', 'Jeugdpsychiatrie', ''),
  ('pz-tienen', 'rolstoel', '000242', 'Vermeire 708 delight', 'Algemene psychiatrie 1', '')
) as v(site, soort, nummer, merk, afdeling, omschrijving)
where not exists (
  select 1 from public.vigo_toestellen t
  where t.site = v.site and ltrim(t.nummer, '0') = ltrim(v.nummer, '0')
);
