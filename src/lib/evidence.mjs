// Merging evidence rows, so one script cannot erase another's findings.
//
// WHY. prospect-recon.mjs wrote `crm_save({ id, evidence })` with only the rows
// it had just produced. crm_save replaces the column, so running recon after
// prospect-officials, prospect-enrich and prospect-verify-email silently wiped
// every row they had written: the decision maker, the confirmed website, and
// the proof of where each email address came from. Nothing errored, and the
// only visible symptom was gate 3 blocking sends again.
//
// So every writer tags its rows with `by`, and merges rather than assigns:
// its own tagged rows are refreshed, everything else is kept untouched.
// Untagged rows predate this and are always kept.

/** Stamp a batch with the script that found it. */
export function tag(rows, by) {
  return (rows || []).map((r) => ({ ...r, by }));
}

/**
 * The existing rows plus this script's fresh ones.
 *
 * Only rows carrying this same `by` are dropped, because only this script is
 * entitled to supersede its own findings.
 */
export function merge(existing, fresh, by) {
  const keep = (Array.isArray(existing) ? existing : []).filter((r) => r?.by !== by);
  return [...keep, ...tag(fresh, by)];
}
