-- Niet teruggevonden toestellen uit het overzicht van Ultimo (WZC-Passionisten).
-- Een nummer dat al op de site staat (ook met of zonder voorloopnullen), wordt overgeslagen.
insert into public.vigo_toestellen (site, soort, nummer, merk, afdeling, omschrijving, ongekend)
select v.site, v.soort, v.nummer, v.merk, v.afdeling, v.omschrijving, true
from (values
  ('wzc-passionisten', 'rollator', '001448', 'Invacare', 'Kine', 'Reserve'),
  ('wzc-passionisten', 'rollator', '001449', 'Invacare', 'Kine', 'Reserve'),
  ('wzc-passionisten', 'rollator', '001450', 'Invacare', 'Kine', 'Reserve'),
  ('wzc-passionisten', 'rollator', '001454', 'Invacare', 'Kine', 'Reserve'),
  ('wzc-passionisten', 'rollator', '001456', 'Invacare', 'Kine', 'Reserve'),
  ('wzc-passionisten', 'rollator', '001455', 'Vermeire', 'Kine', 'Reserve'),
  ('wzc-passionisten', 'rollator', '001458', 'Vermeire', 'Kine', 'Reserve'),
  ('wzc-passionisten', 'rolstoel', '001445', 'Invacare Action 3', 'Kine', ''),
  ('wzc-passionisten', 'rolstoel', '001457', 'Invacare Action 3', 'Kine', ''),
  ('wzc-passionisten', 'rolstoel', '001552', 'Invacare Action 3', 'Kine', ''),
  ('wzc-passionisten', 'rolstoel', '001452', 'Vermeire', 'Kine', '')
) as v(site, soort, nummer, merk, afdeling, omschrijving)
where not exists (select 1 from public.vigo_toestellen t
  where t.site = v.site and ltrim(t.nummer, '0') = ltrim(v.nummer, '0'));
