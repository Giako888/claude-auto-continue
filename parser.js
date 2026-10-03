'use strict';

// Rileva messaggi di limite di Claude Code e calcola l'orario di reset.
// Formati supportati:
//   "5-hour limit reached ∙ resets 3pm" / "resets 3:30 pm (Europe/Rome)"
//   "Claude usage limit reached. Your limit will reset at 3pm (Europe/Rome)."
//   "Claude AI usage limit reached|1760000000"  (epoch secondi)

const LIMIT_RE = /(usage limit reached|limit reached|hit your limit|limit will reset)/i;
const EPOCH_RE = /usage limit reached\|(\d{10})/i;
const TIME_RE = /reset[s]?(?:\s+at)?\s+(?:(\w{3,9})\s+(\d{1,2}),?\s+)?(\d{1,2})(?::(\d{2}))?\s*([ap]m)?(?:\s*\(([^)]+)\))?/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function tzOffsetMs(date, tz) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(f.formatToParts(date).map(x => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// Costruisce un istante a partire da data/ora "a muro" in un fuso (o locale se tz assente).
function wallToInstant(y, mo, d, h, mi, tz) {
  if (!tz) return new Date(y, mo, d, h, mi, 0, 0);
  const guess = Date.UTC(y, mo, d, h, mi, 0, 0);
  let t = guess - tzOffsetMs(new Date(guess), tz);
  t = guess - tzOffsetMs(new Date(t), tz);
  return new Date(t);
}

function wallParts(date, tz) {
  if (!tz) return { y: date.getFullYear(), mo: date.getMonth(), d: date.getDate() };
  const shifted = new Date(date.getTime() + tzOffsetMs(date, tz));
  return { y: shifted.getUTCFullYear(), mo: shifted.getUTCMonth(), d: shifted.getUTCDate() };
}

/**
 * @param {string} text   testo del messaggio
 * @param {Date}   ref    istante in cui il messaggio è stato emesso
 * @returns {Date|null}   istante di reset, o null se non è un messaggio di limite
 */
function parseResetTime(text, ref) {
  if (!text || !LIMIT_RE.test(text)) return null;

  const e = EPOCH_RE.exec(text);
  if (e) return new Date(Number(e[1]) * 1000);

  const m = TIME_RE.exec(text);
  if (!m) return null;
  let [, monName, day, hh, mm, ampm, tz] = m;
  let h = Number(hh);
  const mi = mm ? Number(mm) : 0;
  if (ampm) {
    ampm = ampm.toLowerCase();
    if (h === 12) h = 0;
    if (ampm === 'pm') h += 12;
  }
  if (h > 23 || mi > 59) return null;
  if (tz) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz.trim() }); tz = tz.trim(); } catch { tz = undefined; }
  }

  const base = wallParts(ref, tz);
  if (monName && day) {
    const mo = MONTHS.indexOf(monName.slice(0, 3).toLowerCase());
    if (mo >= 0) {
      let t = wallToInstant(base.y, mo, Number(day), h, mi, tz);
      if (t <= ref) t = wallToInstant(base.y + 1, mo, Number(day), h, mi, tz);
      return t;
    }
  }
  let t = wallToInstant(base.y, base.mo, base.d, h, mi, tz);
  if (t <= ref) t = wallToInstant(base.y, base.mo, base.d + 1, h, mi, tz);
  return t;
}

module.exports = { parseResetTime, LIMIT_RE };
