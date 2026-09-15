/* Push edits made in Coaches' Corner back to Airtable's Prospects table.
   The counterpart to prospect.js, which creates. This one updates.

   Coach on Prospects is a plain singleSelect, not a linked record like
   Clients, so no Coach Name Text lookup is needed here, the REST API
   already returns a resolved string. */

import { whoIsCalling, resolveRole, at } from './_lib.js';

const PROSPECTS = 'tblbRxl3kf2wtTlBE';

const FIELD_MAP = {
  n:        'Prospect Name',
  stage:    'Status',
  src:      'Source',
  entered:  'Date Entered Pipeline',
  lastAct:  'Date of Last Activity',
  prog:     'Expected Program',
  fee:      'Expected Monthly Fee',
  close:    'Expected Close Date',
  coach:    'Coach',
  note:     'Notes',
  email:    'Email',
  mandated: '# Mandated Months',
  phone:    'Mobile Phone',
  business: 'Business name'
};

export default async (req, context) => {
  const auth = whoIsCalling(req, context);
  if (!auth.ok) return new Response(auth.why, { status: 401 });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const { coach, admin, principal } = resolveRole(auth.who);
  if (!coach && !admin) return new Response(`${auth.who} is not set up as a coach or admin.`, { status: 403 });

  const base = process.env.AIRTABLE_BASE, pat = process.env.AIRTABLE_PAT;
  if (!base || !pat) return new Response('Airtable is not configured on this site.', { status: 500 });

  let body;
  try { body = await req.json(); }
  catch (e) { return new Response('Bad request', { status: 400 }); }

  const recId = body.recordId || null;
  const changed = body.fields || {};
  if (!recId) return new Response('Nothing to identify the prospect by.', { status: 400 });

  const fields = {}, skipped = [];
  Object.entries(changed).forEach(([k, v]) => {
    const col = FIELD_MAP[k];
    if (!col) { skipped.push(k); return; }
    if (v === undefined || v === null) return;
    fields[col] = (k === 'fee') ? Number(v) || 0 : v;
  });
  /* Coaches cannot reassign a prospect to someone else from this app.
     Ben and admin staff can. */
  if (!principal) delete fields['Coach'];

  if (!Object.keys(fields).length) {
    return Response.json({ ok: false, pushed: 0, skipped,
      message: 'None of those fields exist on Prospects in Airtable, so nothing was pushed.' });
  }

  try {
    const rec = await at(base, pat, PROSPECTS, `/${recId}`);
    if (!principal && (rec.fields['Coach'] || '') !== coach) {
      return new Response('That prospect is not assigned to you in Airtable.', { status: 403 });
    }

    await at(base, pat, PROSPECTS, '', { method: 'PATCH', body: {
      typecast: true, records: [{ id: recId, fields }]
    }});

    return Response.json({
      ok: true, id: recId,
      pushed: Object.keys(fields).length,
      fields: Object.keys(fields),
      skipped, by: auth.who, at: new Date().toISOString()
    });
  } catch (e) {
    return new Response(e.message, { status: 502 });
  }
};
