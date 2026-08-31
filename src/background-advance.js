export function canAdvanceInBackground({ hidden, running, scanning, enabled }) {
  return Boolean(hidden && running && !scanning && enabled);
}
