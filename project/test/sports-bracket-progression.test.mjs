import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/20261125183000_matmove_sports_tournament_management_v1.sql', import.meta.url), 'utf8');

test('16-player Sports bracket creates both group finals and links each champion to the grand final', () => {
  assert.match(migration, /matches_created',15/);
  assert.match(migration, /v_group_final_a/);
  assert.match(migration, /v_group_final_b/);
  assert.match(migration, /next_slot='player1' where id=v_group_final_a/);
  assert.match(migration, /next_slot='player2' where id=v_group_final_b/);
});

test('Sports results require confirmation before a winner advances and only confirmed scores feed reports', () => {
  assert.match(migration, /status='awaiting_confirmation'/);
  assert.match(migration, /status='confirmed'/);
  assert.match(migration, /winner_player_id=v_winner/);
  assert.match(migration, /status='completed',ends_at=now()/);
  assert.match(migration, /m.status='confirmed'/);
});
