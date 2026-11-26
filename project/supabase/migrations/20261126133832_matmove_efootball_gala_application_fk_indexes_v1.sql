begin;
create index if not exists matmove_sports_applications_wallet_id_idx
  on public.matmove_sports_applications(wallet_id);
create index if not exists matmove_sports_applications_player_id_idx
  on public.matmove_sports_applications(player_id)
  where player_id is not null;
create index if not exists matmove_sports_applications_created_by_idx
  on public.matmove_sports_applications(created_by)
  where created_by is not null;
create index if not exists matmove_sports_applications_reviewed_by_idx
  on public.matmove_sports_applications(reviewed_by)
  where reviewed_by is not null;
commit;
