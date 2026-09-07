/* ============================================================
   The calendar, without OAuth. Ported from The Bridge's calendar.js,
   logic unchanged, coach-scoping added on the way out: a coach only
   ever receives session dates for their own clients, checked against
   this app's own roster.

   Google Calendar publishes a private iCal address for every calendar,
   a long, unguessable URL that returns the whole calendar as .ics text.
   No consent screen, no access tokens, no refresh tokens.

   The URL is a bearer credential: anyone holding it can read the
   calendar. It lives in GCAL_ICS, the same one already set on The
   Bridge, no reason for a second one, it isn't a scoped credential the
   way the Airtable token is.
   ============================================================ */

import { whoIsCalling, coachFor, isPrincipal, fetchAll } from './_lib.js';

const CLIENTS_TABLE = 'tblsYEZBxkG7hSM5X';
const HORIZON_DAYS = 120;
const LOOKBACK_DAYS = 120;

function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

function sydneyLocalToUTC(y, mo, d, hh, mi, ss) {
  let guess = new Date(Date.UTC(y, mo - 1, d, hh, mi, ss));
  const wanted = Date.UTC(y, mo - 1, d, hh, mi, ss);
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).formatToParts(guess);
    const get = t => +parts.find(p => p.type === t).value;
    const hour24 = get('hour') === 24 ? 0 : get('hour');
    const seenAsSydney = Date.UTC(get('year'), get('month') - 1, get('day'), hour24, get('minute'), get('second'));
    const diff = wanted - seenAsSydney;
    if (diff === 0) break;
    guess = new Date(guess.getTime() + diff);
  }
  return guess;
}

function icsDate(v) {
  const m = String(v).match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss, z] = m;
  if (!hh) return new Date(Date.UTC(+y, +mo - 1, +d));
  if (z) return new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mi, +ss));
  return sydneyLocalToUTC(+y, +mo, +d, +hh, +mi, +ss);
}

function sydneyDay(dt) {
  if (!dt) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(dt);
}

function parseEvents(ics) {
  const out = [];
  const blocks = unfold(ics).split('BEGIN:VEVENT').slice(1);
  for (const b of blocks) {
    const body = b.split('END:VEVENT')[0];
    const get = (k) => {
      const m = body.match(new RegExp('^' + k + '(?:;[^:\\n]*)?:(.*)$', 'm'));
      return m ? m[1].trim() : '';
    };
    const status = get('STATUS');
    if (/CANCELLED/i.test(status)) continue;
    if (/TRANSPARENT/i.test(get('TRANSP'))) continue;

    const dtRaw = (body.match(/^DTSTART(?:;[^:\n]*)?:(.*)$/m) || [])[1];
    if (!dtRaw) continue;
    const start = icsDate(dtRaw.trim());
    if (!start) continue;

    out.push({
      summary: get('SUMMARY'),
      start,
      rrule: get('RRULE'),
      exdates: (body.match(/^EXDATE(?:;[^:\n]*)?:(.*)$/gm) || [])
        .map(l => l.split(':').pop().trim()).join(',').split(',').filter(Boolean),
      attendees: (body.match(/^ATTENDEE(?:;[^:\n]*)?:(.*)$/gm) || []).map(l => {
        const cn = (l.match(/CN=([^;:]+)/) || [])[1] || '';
        const em = (l.split(':').pop() || '').replace(/^mailto:/i, '');
        return { name: cn.trim(), email: em.trim() };
      })
    });
  }
  return out;
}

function expand(ev, fromDay, toDate) {
  const hits = [];
  const push = (d) => { if (d >= fromDay && d <= toDate) hits.push(d); };
  if (!ev.rrule) { push(ev.start); return hits; }

  const R = {};
  ev.rrule.split(';').forEach(p => { const [k, v] = p.split('='); if (k) R[k] = v; });
  const freq = R.FREQ;
  const interval = Math.max(1, parseInt(R.INTERVAL || '1', 10));
  const until = R.UNTIL ? icsDate(R.UNTIL) : null;
  const count = R.COUNT ? parseInt(R.COUNT, 10) : null;
  const ex = new Set(ev.exdates.map(x => sydneyDay(icsDate(x.trim()))).filter(Boolean));

  if (freq !== 'WEEKLY' && freq !== 'MONTHLY') { push(ev.start); return hits; }

  let d = new Date(ev.start.getTime());
  let n = 0;
  const hardStop = 400;
  while (n < hardStop) {
    if (until && d > until) break;
    if (count !== null && n >= count) break;
    if (d > toDate) break;
    if (!ex.has(sydneyDay(d))) push(new Date(d.getTime()));
    n++;
    if (freq === 'WEEKLY') d = new Date(d.getTime() + interval * 7 * 86400000);
    else { const x = new Date(d.getTime()); x.setUTCMonth(x.getUTCMonth() + interval); d = x; }
  }
  return hits;
}

const SKIP = new RegExp([
  'lunch','break','block','prep','out of office','holiday','leave','birthday',
  'reminder','travel','trip','remuneration','transfer','payment','hotseat',
  'group chat','coaches meet','progress meeting','pay run','invoice'
].join('|'), 'i');
const MONEY_ONLY = /^[^-]{2,40}-\s*\$?[\d,]+(?:pm|\s*p\/m)?\s*$/i;
const SELF = /ben@fyibc\.com\.au/i;
const SELF_NAME = /^ben(\s+white)?$/i;

function personFrom(ev) {
  const s = (ev.summary || '').trim();
  if (!s || SKIP.test(s) || MONEY_ONLY.test(s)) return [];
  const dash = s.match(/^[^-]*-\s*(.+)$/);
  const tail = dash ? dash[1].trim() : s;

  const withMatch = tail.match(/^(.+?)\s+with\s+(.+)$/i);
  if (withMatch && SELF_NAME.test(withMatch[1].trim())) {
    const names = withMatch[2].split(/\s+and\s+/i).map(x => x.trim()).filter(Boolean);
    if (names.length) return names;
  }

  const sides = tail.split(/\s+and\s+/i).map(x => x.trim()).filter(Boolean);
  if (sides.length === 2) {
    const other = sides.find(p => !SELF_NAME.test(p));
    const self = sides.find(p => SELF_NAME.test(p));
    if (other && self) return [other];
  }

  if (dash && /^FYI/i.test(s) && !SELF_NAME.test(dash[1].trim())) return [dash[1].trim()];

  const a = (ev.attendees || []).find(x => x.name && !SELF.test(x.email || ''));
  if (a) return [a.name];
  return [];
}

export default async (req, context) => {
  const auth = whoIsCalling(req, context);
  if (!auth.ok) return new Response(auth.why, { status: 401 });

  const coach = coachFor(auth.who);
  if (!coach) return new Response(`${auth.who} is not set up as a coach in COACH_MAP.`, { status: 403 });

  const url = process.env.GCAL_ICS;
  if (!url) {
    return Response.json({ ok: false, sessions: {}, lastSessions: {},
      error: 'GCAL_ICS is not set on this site. Add it under Site configuration, Environment variables, then redeploy.' });
  }

  const base = process.env.AIRTABLE_BASE, pat = process.env.AIRTABLE_PAT;

  try {
    /* Same first-name matching The Bridge relies on, so an allow-list needs
       first names, not full Client Name values, to actually intersect. */
    let allowedFirstNames = null;
    if (!isPrincipal(coach) && base && pat) {
      const recs = await fetchAll(base, pat, CLIENTS_TABLE);
      allowedFirstNames = new Set(recs
        .filter(r => {
          const c = Array.isArray(r.fields['Coach Name Text']) ? r.fields['Coach Name Text'][0] : r.fields['Coach Name Text'];
          return c === coach;
        })
        .map(r => (r.fields['Client Name'] || '').trim().split(' ')[0].toLowerCase())
        .filter(Boolean));
    }

    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error('Calendar returned ' + res.status);
    const ics = await res.text();
    if (!/BEGIN:VCALENDAR/.test(ics)) throw new Error('That URL did not return a calendar.');

    const events = parseEvents(ics);
    const now = new Date();
    const today = sydneyDay(now);
    const fromDay = new Date(now.getTime() - LOOKBACK_DAYS * 86400000);
    const toDate = new Date(now.getTime() + HORIZON_DAYS * 86400000);

    const next = {}, last = {};
    for (const ev of events) {
      const people = personFrom(ev);
      if (!people.length) continue;
      for (const when of expand(ev, fromDay, toDate)) {
        const day = sydneyDay(when);
        if (!day) continue;
        for (const who of people) {
          if (allowedFirstNames && !allowedFirstNames.has(who.trim().split(' ')[0].toLowerCase())) continue;
          if (day >= today) { if (!next[who] || day < next[who]) next[who] = day; }
          else { if (!last[who] || day > last[who]) last[who] = day; }
        }
      }
    }

    return Response.json({
      ok: true, sessions: next, lastSessions: last,
      asAt: new Date().toISOString(), horizon: HORIZON_DAYS, lookback: LOOKBACK_DAYS
    });
  } catch (e) {
    return Response.json({ ok: false, sessions: {}, lastSessions: {}, error: e.message });
  }
};
