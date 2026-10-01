import { walkMin, runMin } from './geo.js';
import { MIN_PER_STOP } from './config.js';

const toMin = (ms) => (typeof ms === 'number' ? Math.max(0, ms / 60000) : null);

export function etasFor(arrivalJson, serviceNo) {
  const svc = arrivalJson?.services?.find((s) => s.no === serviceNo);
  if (!svc) return null;
  return { eta1: toMin(svc.next?.duration_ms), eta2: toMin(svc.subsequent?.duration_ms) };
}

export function decide({ walk, run, eta1, eta2 }) {
  if (eta1 == null) return null;
  if (eta1 >= walk) return { verdict: 'WALK', etaCaught: eta1 };
  if (eta1 >= run) return { verdict: 'RUN', etaCaught: eta1 };
  if (eta2 == null || eta2 < run) return null;
  return { verdict: 'WAIT', etaCaught: eta2 };
}

export function rankOptions(candidates, arrivalsByStop) {
  const ranked = [];
  for (const c of candidates) {
    const etas = etasFor(arrivalsByStop[c.boardStop.code], c.service);
    if (!etas) continue;
    const walk = walkMin(c.boardStop.distM);
    const run = runMin(c.boardStop.distM);
    const d = decide({ walk, run, ...etas });
    if (!d) continue;
    const rideMin = c.stopsCount * MIN_PER_STOP;
    ranked.push({ ...c, ...etas, walk, run, ...d, rideMin, totalMin: d.etaCaught + rideMin });
  }
  return ranked.sort((a, b) => a.totalMin - b.totalMin);
}

export function adviceFor(option, { wetForecast, raining }) {
  const wet = wetForecast || raining;
  const eta = Math.round(option.etaCaught);
  if (option.verdict === 'RUN') return wet ? 'RUN — rain is coming, catch this one.' : 'Run — you can just make it.';
  if (option.verdict === 'WALK') return wet ? 'Walk briskly — rain expected.' : 'Walk — you have time.';
  if (raining) return `Stay sheltered — next bus in ${eta} min.`;
  if (wetForecast) return 'Shelter at the stop — rain on the way.';
  return `Missed this one — next bus in ${eta} min.`;
}
