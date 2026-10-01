export function createSequencer() {
  let current = 0;
  return { next: () => ++current, isCurrent: (token) => token === current };
}

export function resolveOrigin(fix, last, now, maxAgeMs) {
  if (fix) return { origin: fix, stale: false };
  if (last && now - last.t <= maxAgeMs) return { origin: last.origin, stale: true };
  return null;
}
