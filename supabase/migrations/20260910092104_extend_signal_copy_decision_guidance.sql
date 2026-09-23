alter table public.signal_copy_templates
  add column if not exists signal_strength text,
  add column if not exists progression_condition text,
  add column if not exists useful_value text,
  add column if not exists avoid_text text;

alter table public.signal_copy_templates
  drop constraint if exists signal_copy_templates_signal_strength_check;

alter table public.signal_copy_templates
  add constraint signal_copy_templates_signal_strength_check
  check (signal_strength is null or signal_strength in ('Weak', 'Developing', 'Strong'));
