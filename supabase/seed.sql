-- Datos de ejemplo para probar el backend real (ejecutar tras las migraciones).
-- Jugadores del grupo con ranking actual + histórico y % de victorias.

insert into players (ptg_player_id, name, current_ranking, current_win_pct, historic_ranking, historic_win_pct) values
  ('ptg_yago',   'Yago',   2,  0.82, 3,  0.78),
  ('ptg_marcos', 'Marcos', 4,  0.71, 5,  0.69),
  ('ptg_diego',  'Diego',  7,  0.63, 6,  0.66),
  ('ptg_nacho',  'Nacho',  11, 0.55, 12, 0.52),
  ('ptg_alvaro', 'Álvaro', 1,  0.88, 1,  0.85),
  ('ptg_pablo',  'Pablo',  9,  0.58, 8,  0.60),
  ('ptg_luis',   'Luis',   18, 0.41, 16, 0.45),
  ('ptg_carlos', 'Carlos', 24, 0.30, 22, 0.33)
on conflict (ptg_player_id) do nothing;

-- ⚠️ Para convertir a un usuario en admin (tras registrarse con magic-link):
--   update profiles set role = 'admin' where id = '<uuid del usuario>';
-- (Y crea su monedero si no existe:)
--   insert into wallets (user_id, balance) values ('<uuid>', 0) on conflict do nothing;
