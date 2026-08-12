-- Reference data: cuisines. Small, stable, and needed before any restaurant
-- can complete its profile.
--
-- Idempotent: safe to re-run.

INSERT INTO cuisine (slug, name, sort_order) VALUES
  ('pakistani',     'Pakistani',      10),
  ('indian',        'Indian',         20),
  ('middle-eastern','Middle Eastern', 30),
  ('lebanese',      'Lebanese',       40),
  ('turkish',       'Turkish',        50),
  ('afghan',        'Afghan',         60),
  ('persian',       'Persian',        70),
  ('somali',        'Somali',         80),
  ('north-african', 'North African',  90),
  ('malaysian',     'Malaysian',     100),
  ('indonesian',    'Indonesian',    110),
  ('bangladeshi',   'Bangladeshi',   120),
  ('mediterranean', 'Mediterranean', 130),
  ('burgers',       'Burgers',       140),
  ('fried-chicken', 'Fried Chicken', 150),
  ('pizza',         'Pizza',         160),
  ('breakfast',     'Breakfast',     170),
  ('desserts',      'Desserts',      180),
  ('beverages',     'Beverages',     190)
ON CONFLICT (slug) DO NOTHING;
