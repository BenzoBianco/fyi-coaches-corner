/* Fireflies transcript summaries, matched to a client by name off the
   meeting title, same pattern as The Bridge's fireflies.js. Read-only.

   Coach-scoped on the way out: a coach only ever receives entries for
   people who match their own client list, checked against this app's
   own roster, not trusted from Fireflies' side, which has no concept of
   coach ownership at all. */

import { whoIsCalling, coachFor, isPrincipal, fetchAll } from './_lib.js';

const CLIENTS_TABLE = 'tblsYEZBxkG7hSM5X';
const HORIZON_DAYS = 30;
const SELF = /^ben(\s+white)?$/i;

function peopleFromTitle(title) {
  const s = (title || '').trim();
  const m = s.match(/-\s*(.+)$/);
  if (!m) return [];
  const tail = m[1].trim();
  const withMatch = tail.match(/^(.+?)\s+with\s+(.+)$/i);
  if (withMatch && SELF.test(withMatch[1].trim())) {
    const names = withMatch[2].split(/\s+and\s+/i).map(x => x.trim()).filter(Boolean);
    if (names.length) return names;
  }
  const parts = tail.split(/\s+and\s+/i).map(x => x.trim()).filter(Boolean);
  const other = parts.find(p => p && !SELF.test(p));
  return other ? [other] : [];
}

async function fireflies(query, variables) {
  const key = process.env.FIREFLIES_API_KEY;
  const res = await fetch('https://api.fireflies.ai/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  const txt = await res.text();
  let d;
  try { d = JSON.parse(txt); } catch (e) { throw new Error('Fireflies did not return JSON: ' + txt.slice(0, 200)); }
  if (!res.ok) throw new Error(`Fireflies ${res.status}: ${txt.slice(0, 300)}`);
  if (d.errors && d.errors.length) throw new Error('Fireflies: ' + d.errors.map(e => e.message).join('; '));
  return d.data;
}

const QUERY = `
  query Transcripts($fromDate: DateTime, $limit: Int) {
    transcripts(fromDate: $fromDate, limit: $limit) {
      id title date duration
      summary { short_summary action_items keywords }
    }
  }
`;

export default async (req, context) => {
  const auth = whoIsCalling(req, context);
  if (!auth.ok) return new Response(auth.why, { status: 401 });

  const coach = coachFor(auth.who);
  if (!coach) return new Response(`${auth.who} is not set up as a coach in COACH_MAP.`, { status: 403 });

  const key = process.env.FIREFLIES_API_KEY;
  if (!key) {
    return Response.json({ ok: false, byClient: {},
      error: 'FIREFLIES_API_KEY is not set on this site. Add it under Site configuration, Environment variables, then redeploy.' });
  }

  const base = process.env.AIRTABLE_BASE, pat = process.env.AIRTABLE_PAT;

  try {
    /* Own client list, so a coach only ever gets matched transcripts for
       people actually assigned to them in Airtable right now, not
       whatever a calendar title happens to say. */
    let allowedNames = null;
    if (!isPrincipal(coach) && base && pat) {
      const recs = await fetchAll(base, pat, CLIENTS_TABLE);
      allowedNames = new Set(recs
        .filter(r => {
          const c = Array.isArray(r.fields['Coach Name Text']) ? r.fields['Coach Name Text'][0] : r.fields['Coach Name Text'];
          return c === coach;
        })
        .map(r => (r.fields['Client Name'] || '').trim().toLowerCase())
        .filter(Boolean));
    }

    const fromDate = new Date(Date.now() - HORIZON_DAYS * 86400000).toISOString();
    const data = await fireflies(QUERY, { fromDate, limit: 50 });
    const transcripts = (data && data.transcripts) || [];

    const byClient = {};
    let unmatched = 0, filtered = 0;
    for (const t of transcripts) {
      const people = peopleFromTitle(t.title);
      if (!people.length) { unmatched++; continue; }
      const entry = {
        id: t.id,
        date: t.date ? new Date(t.date).toISOString() : null,
        title: t.title,
        summary: (t.summary && t.summary.short_summary) || '',
        actionItems: (t.summary && t.summary.action_items) || '',
        keywords: (t.summary && t.summary.keywords) || [],
        link: `https://app.fireflies.ai/view/${t.id}`
      };
      for (const who of people) {
        if (allowedNames && !allowedNames.has(who.trim().toLowerCase())) { filtered++; continue; }
        if (!byClient[who]) byClient[who] = [];
        byClient[who].push(entry);
      }
    }
    Object.values(byClient).forEach(list => list.sort((a, b) => (b.date || '').localeCompare(a.date || '')));

    return Response.json({
      ok: true, byClient,
      transcripts: transcripts.length,
      matched: transcripts.length - unmatched,
      unmatched, filtered,
      asAt: new Date().toISOString(), horizon: HORIZON_DAYS
    });
  } catch (e) {
    return Response.json({ ok: false, byClient: {}, error: e.message });
  }
};
