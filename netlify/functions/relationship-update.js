/* Push edits made in Coaches' Corner back to Airtable's Relationships
   table. Matches The Bridge's relationship-update.js, plus the Owner
   field this app needs to scope by, which The Bridge's copy never had
   to touch. When nobody by that name exists yet, this creates the
   record rather than failing, same as The Bridge. */

import { whoIsCalling, coachFor, isPrincipal, at } from './_lib.js';

const RELATIONSHIPS = 'tbl3yFRxhpJxVLVHX';

const FIELD_MAP = {
  n:       'Name',
  type:    'Type',
  pri:     'Priority',
  status:  'Referrer Status',
  email:   'Email',
  phone:   'Mobile Number',
  last:    'Last Contacted',
  cadence: 'Cadence Days',
  notes:   'Notes',
  owner:   'Owner',
  company:      'Company',
  profession:   'Profession',
  category:     'Category',
  heat:         'Heat',
  birthday:     'Birthday',
  keyDateLabel: 'Key Date Label',
  keyDateValue: 'Key Date Value',
  nextAction:   'Next Action',
  log:          'Contact Log'
};

async function findRecord(base, pat, name) {
  const target = String(name || '').trim().toLowerCase();
  if (!target) return null;
  let out = [], offset;
  do {
    const q = `?pageSize=100${offset ? `&offset=${encodeURIComponent(offset)}` : ''}`;
    const r = await at(base, pat, RELATIONSHIPS, q);
    out = out.concat(r.records || []);
    offset = r.offset;
  } while (offset);
  const hits = out.filter(r => String(r.fields['Name'] || '').trim().toLowerCase() === target);
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
  if (!name && !recId) return new Response('Nothing to identify the relationship by.', { status: 400 });

  const fields = {}, skipped = [];
  Object.entries(changed).forEach(([k, v]) => {
    const col = FIELD_MAP[k];
    if (!col) { skipped.push(k); return; }
    if (v === undefined || v === null) return;
    fields[col] = (k === 'cadence' || k === 'heat') ? Number(v) || 0 : v;
  });
  if (!isPrincipal(coach)) delete fields['Owner']; /* a coach can't reassign ownership from here */

  if (!Object.keys(fields).length) {
    return Response.json({ ok: false, pushed: 0, skipped,
      message: 'None of those fields exist on Relationships in Airtable, so nothing was pushed.' });
  }

  try {
    let rec = recId ? await at(base, pat, RELATIONSHIPS, `/${recId}`).catch(() => null) : await findRecord(base, pat, name);

    if (rec && !isPrincipal(coach) && (rec.fields['Owner'] || '') !== coach) {
      return new Response('That relationship is not assigned to you in Airtable.', { status: 403 });
    }

    let id, created = false;
    if (!rec) {
      if (!fields['Name']) fields['Name'] = name;
      if (!fields['Owner'] && !isPrincipal(coach)) fields['Owner'] = coach;
      const r = await at(base, pat, RELATIONSHIPS, '', { method: 'POST', body: { typecast: true, records: [{ fields }] } });
      id = r.records[0].id;
      created = true;
    } else {
      id = rec.id;
      await at(base, pat, RELATIONSHIPS, '', { method: 'PATCH', body: { typecast: true, records: [{ id, fields }] } });
    }

    return Response.json({
      ok: true, id, created,
      pushed: Object.keys(fields).length,
      fields: Object.keys(fields),
      skipped, by: auth.who, at: new Date().toISOString()
    });
  } catch (e) {
    return new Response(e.message, { status: 502 });
  }
};
