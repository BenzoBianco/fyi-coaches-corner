/* Create a new prospect in Airtable from Coaches' Corner. Same scoping
   rule as client.js: a coach can only create under their own name. */

import { whoIsCalling, coachFor, isPrincipal } from './_lib.js';

const PROSPECTS = 'tblbRxl3kf2wtTlBE';

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
  if (!name) return new Response('A prospect name is required.', { status: 400 });

  const fields = { 'Prospect Name': name };
  const map = {
    status: 'Status', source: 'Source', entered: 'Date Entered Pipeline',
    lastAct: 'Date of Last Activity', program: 'Expected Program',
    fee: 'Expected Monthly Fee', close: 'Expected Close Date',
    email: 'Email', mandated: '# Mandated Months', phone: 'Mobile Phone',
    business: 'Business name', notes: 'Notes'
  };
  Object.entries(map).forEach(([k, f]) => {
    const v = body[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      fields[f] = (k === 'fee') ? Number(v) : String(v);
    }
  });
  fields['Coach'] = isPrincipal(coach) ? (body.coach || coach) : coach;

  try {
    const res = await fetch(`https://api.airtable.com/v0/${base}/${PROSPECTS}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: [{ fields }], typecast: true })
    });
    const txt = await res.text();
    if (!res.ok) return new Response('Airtable rejected it: ' + txt, { status: 502 });
    const d = JSON.parse(txt);
    return Response.json({ ok: true, id: d.records[0].id, name, createdBy: auth.who, fields: d.records[0].fields });
  } catch (e) {
    return new Response('Could not reach Airtable: ' + e.message, { status: 502 });
  }
};
