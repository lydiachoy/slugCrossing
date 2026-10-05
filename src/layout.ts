// The road's layout, shared by the road rules (sim.ts) and the garden beyond it.

export const HALF_W = 7.5; // the playfield spans x = -7.5 … 7.5
export type RowKind = 'grass' | 'road' | 'goal';
export const ROWS: readonly RowKind[] = [
  'grass', 'road', 'road', 'road', 'road', 'grass', 'road', 'road', 'road', 'road', 'goal',
];
export const GOAL_ROW = ROWS.length - 1;
