INSERT INTO registry_generations (id, active)
VALUES ('synthetic-v1', NOT EXISTS (SELECT 1 FROM registry_generations WHERE active))
ON CONFLICT (id) DO NOTHING;

INSERT INTO registry_numbers (generation_id, phone, jurisdiction) VALUES
  ('synthetic-v1', '2125550100', 'FEDERAL'),
  ('synthetic-v1', '2125550100', 'NY'),
  ('synthetic-v1', '3055550123', 'FL'),
  ('synthetic-v1', '3055550123', 'TX'),
  ('synthetic-v1', '2025550111', 'FEDERAL'),
  ('synthetic-v1', '3125550175', 'IL'),
  ('synthetic-v1', '6175550132', 'FEDERAL'),
  ('synthetic-v1', '7135550142', 'TX'),
  ('synthetic-v1', '2065550169', 'FEDERAL'),
  ('synthetic-v1', '2065550169', 'WA')
ON CONFLICT DO NOTHING;
