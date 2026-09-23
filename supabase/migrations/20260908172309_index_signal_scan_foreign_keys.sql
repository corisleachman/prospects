create index if not exists contacts_signal_scan_run_id_idx
  on public.contacts (signal_scan_run_id);
create index if not exists prospect_discoveries_added_contact_id_idx
  on public.prospect_discoveries (added_contact_id);
