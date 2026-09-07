/* Create a new client in Airtable from Coaches' Corner.
   A coach can only ever create a client under their own name. Ben can
   create under any coach. */

import { whoIsCalling, coachFor, isPrincipal } from './_lib.js';

const CLIENTS = 'tblsYEZBxkG7hSM5X';

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
  if (!name) return new Response('A client name is required.', { status: 400 });

  /* Field names checked against the live Clients table. Same three traps
     as The Bridge's client.js: Base Monthly Fee not Actual Fee Monthly,
     Mobile Phone not Mobile Number, Business name lowercase n. */
  const fields = { 'Client Name': name };
  const map = {
    program: 'Program', stage: 'Lifecycle Stage', state: 'State',
    fee: 'Base Monthly Fee', startDate: 'Start Date', phone: 'Mobile Phone',
    business: 'Business name', ca: 'CA Number', referral: 'Referral Source',
    disc: 'DISC Profile', engagement: 'Engagement', status: 'Status'
  };
  Object.entries(map).forEach(([k, f]) => {
    const v = body[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      fields[f] = (k === 'fee') ? Number(v) : v;
    }
  });

  /* Coach is always set from who is logged in, never trusted from the
     browser, so a coach cannot create a client under someone else's name. */
  fields['Coach'] = isPrincipal(coach) ? (body.coach || coach) : coach;

  try {
    const res = await fetch(`https://api.airtable.com/v0/${base}/${CLIENTS}`, {
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
