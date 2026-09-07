/* Push edits made in Coaches' Corner back to Airtable's Clients table.
   FYI only, one table, unlike The Bridge's client-update.js which also
   handles Argo Clients. This app's token cannot see that table anyway.

   Field names match The Bridge's FIELD_MAP exactly, checked against the
   same live schema. If a field is ever added to PUSHABLE in index.html
   here, it must be added here too, in the same edit, per the standing
   rule that caused mandatedMonths to silently fail once. */

import { whoIsCalling, coachFor, isPrincipal, at } from './_lib.js';

const CLIENTS = 'tblsYEZBxkG7hSM5X';

const FIELD_MAP = {
  clientStatus: 'Status',
  business:     'Business name',
  c:            'Coach',
  p:            'Program',
  st:           'Lifecycle Stage',
  eng:          'Engagement',
  f:            'Base Monthly Fee',
  s:            'State',
  ca:           'CA Number',
  refSource:    'Referral Source',
  disc:         'DISC Profile',
  phone:        'Mobile Phone',
  dob:          'Date of Birth',
  startDate:    'Start Date',
  exitDate:     'Exit date',
  notes:        'Notes',
  mandatedMonths: 'Mandated Months',
  calName:      'Calendar Name',
  exitReasonCode: 'Exit reason',
  referredBy:   'Referred By Client',
  sup:          'Supervision Progress'
};

async function findRecord(base, pat, name) {
  const target = String(name || '').trim().toLowerCase();
  if (!target) return null;
  let out = [], offset;
  do {
    const q = `?pageSize=100${offset ? `&offset=${encodeURIComponent(offset)}` : ''}`;
    const r = await at(base, pat, CLIENTS, q);
    out = out.concat(r.records || []);
    offset = r.offset;
  } while (offset);
  const hits = out.filter(r => String(r.fields['Client Name'] || '').trim().toLowerCase() === target);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) throw new Error(`"${name}" matches ${hits.length} records in Airtable. Fix the duplicate before pushing.`);
  return null;
}

export default async (req, context) => {
  const auth = whoIsCalling(req, context);
  if (!auth.ok) return new Response(auth.why, { status: 401 });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const coach = coachFor(auth.who);
  if (!coach) return new Response(`${auth.who} is not set up as a coach in COACH_MAP.`, { status: 403 });

  const base = process.env.AIRTABLE_BASE, pat = process.env.AIRTABLE_PAT;
  if (!base || !pat) return new Response('Airtable is not configured on this site.', { status: 500 });

  let body;
  try { body = await req.json(); }
  catch (e) { return new Response('Bad request', { status: 400 }); }

  const name = (body.name || '').trim();
  const changed = body.fields || {};
  const recId = body.recordId || null;
  if (!name && !recId) return new Response('Nothing to identify the client by.', { status: 400 });

  const fields = {}, skipped = [];
  Object.entries(changed).forEach(([k, v]) => {
    const col = FIELD_MAP[k];
    if (!col) { skipped.push(k); return; }
    if (v === undefined || v === null) return;
    fields[col] = (k === 'f' || k === 'mandatedMonths') ? Number(v) || 0 : v;
  });

  if (!Object.keys(fields).length) {
    return Response.json({ ok: false, pushed: 0, skipped,
      message: 'None of those fields exist on Clients in Airtable, so nothing was pushed.' });
  }

  try {
    let rec = null;
    if (recId) {
      const r = await at(base, pat, CLIENTS, `/${recId}`);
      rec = r;
    } else {
      rec = await findRecord(base, pat, name);
    }
    if (!rec) {
      return Response.json({ ok: false, pushed: 0, skipped,
        message: `No Clients record named "${name}" in Airtable. Check the spelling matches Client Name exactly.` });
    }

    /* A coach can only ever push to a client already assigned to them.
       Ben is exempt. This is checked against Airtable's own current
       value, not whatever the browser sent, so a stale local copy can't
       be used to reassign a client sideways. */
    if (!isPrincipal(coach)) {
      const currentCoach = Array.isArray(rec.fields['Coach Name Text'])
        ? rec.fields['Coach Name Text'][0] : rec.fields['Coach Name Text'];
      if (currentCoach !== coach) {
        return new Response(`That client is not assigned to you in Airtable.`, { status: 403 });
      }
      /* Coaches cannot reassign a client to someone else from this app. */
      delete fields['Coach'];
    }

    const r2 = await at(base, pat, CLIENTS, '', { method: 'PATCH', body: {
      typecast: true, records: [{ id: rec.id, fields }]
    }});

    return Response.json({
      ok: true, id: rec.id,
      pushed: Object.keys(fields).length,
      fields: Object.keys(fields),
      skipped, by: auth.who, at: new Date().toISOString()
    });
  } catch (e) {
    return new Response(e.message, { status: 502 });
  }
};
