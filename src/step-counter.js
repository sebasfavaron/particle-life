export function formatStepCount(value) {
  const count = Math.max(0, Math.floor(Number(value) || 0));
  if (count < 1000) return String(count);
  const units = [['B', 1e9], ['M', 1e6], ['k', 1e3]];
  for (const [suffix, scale] of units) {
    if (count >= scale) {
      const scaled = count / scale;
      return `${scaled < 10 ? scaled.toFixed(1) : Math.floor(scaled)}${suffix}`;
    }
  }
  return String(count);
}
