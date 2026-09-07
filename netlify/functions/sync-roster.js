/* Pulls Clients, Prospects and Relationships live from Airtable, scoped
   to the logged-in coach. Ben sees everyone; every other coach sees only
   their own, filtered server-side so a coach can never retrieve another
   coach's records even by guessing an id, not just because the UI hides
   the button.

   Read-only. Same shape as The Bridge's sync-roster.js, minus Argo and
   TES, because this token cannot see those tables even if this code
   tried to ask. */

import { whoIsCalling, coachFor, isPrincipal, fetchAll } from './_lib.js';

const CLIENTS_TABLE = 'tblsYEZBxkG7hSM5X';
const PROSPECTS_TABLE = 'tblbRxl3kf2wtTlBE';
const RELATIONSHIPS_TABLE = 'tbl3yFRxhpJxVLVHX';

/* Coach on Clients is a raw link field over Airtable's REST API: bare
   record ids only, never a resolved name. Coach Name Text is a Lookup
   pointed at the same link, already resolved to plain text. This reads
   that, not the link field. The Bridge hit this exact bug once. */
function first(v) {
  if (Array.isArray(v)) return v.length ? String(v[0]) : '';
  return v || '';
}

function mapClient(r) {
  const f = r.fields || {};
  return {
    airtableId: r.id,
    n: (f['Client Name'] || '').trim(),
    business: f['Business name'] || '',
    c: first(f['Coach Name Text']),
    p: f['Program'] || '',
    st: f['Lifecycle Stage'] || '',
    rag: f['Engagement'] || '',
    f: f['Base Monthly Fee'] || 0,
    s: f['State'] || '',
    ca: f['CA Number'] || '',
    refSource: f['Referral Source'] || '',
    d: f['DISC Profile'] || '',
    phone: f['Mobile Phone'] || '',
    dob: f['Date of Birth'] || '',
    startDate: f['Start Date'] || '',
    exitDate: f['Exit date'] || '',
    notes: f['Notes'] || '',
    mandatedMonths: f['Mandated Months'] || 0,
    calName: f['Calendar Name'] || '',
    exitReasonCode: f['Exit reason'] || '',
    email: f['Email'] || '',
    clientStatus: f['Status'] || '',
    referredBy: f['Referred By Client'] || '',
    sup: f['Supervision Progress'] || '',
    mobileInContacts: !!f['Mobile In Contacts'],
    emailInContacts: !!f['Email In Contacts'],
    addressInContacts: !!f['Address In Contacts'],
    p30running: !!f['First 30 Days Running'],
    p30: f['First 30 Days Progress'] || ''
  };
}

function mapProspect(r) {
  const f = r.fields || {};
  return {
    airtableId: r.id,
    n: (f['Prospect Name'] || '').trim(),
    stage: f['Status'] || '',
    src: f['Source'] || '',
    prog: f['Expected Program'] || '',
    fee: f['Expected Monthly Fee'] || 0,
    close: f['Expected Close Date'] || '',
    coach: f['Coach'] || '',
    entered: f['Date Entered Pipeline'] || '',
    lastAct: f['Date of Last Activity'] || '',
    days: f['Days in Pipeline'] || 0,
    idle: f['Days Since Activity'] || 0,
    annual: f['Annual Value'] || 0,
    note: f['Notes'] || '',
    email: f['Email'] || '',
    phone: f['Mobile Phone'] || '',
    business: f['Business name'] || ''
  };
}

/* Owner is a new single-select field on Relationships, plain text values
   matching coach names exactly, added specifically so this app has
   something to filter on. Airtable's Clients-side Coach bug is exactly
   why this is a select field, not a linked record. */
function mapRelationship(r) {
  const f = r.fields || {};
  return {
    airtableId: r.id,
    n: (f['Name'] || '').trim(),
    type: f['Type'] || '',
    pri: f['Priority'] || '',
    status: f['Referrer Status'] || '',
    email: f['Email'] || '',
    phone: f['Mobile Number'] || '',
    last: f['Last Contacted'] || '',
    cadence: f['Cadence Days'] || 0,
    notes: f['Notes'] || '',
    owner: f['Owner'] || ''
  };
}

export default async (req, context) => {
  const auth = whoIsCalling(req, context);
  if (!auth.ok) return new Response(auth.why, { status: 401 });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const coach = coachFor(auth.who);
  if (!coach) return new Response(
    `${auth.who} is not set up as a coach in COACH_MAP. Ask Ben to add you, then reload.`,
    { status: 403 });

  const base = process.env.AIRTABLE_BASE, pat = process.env.AIRTABLE_PAT;
  if (!base || !pat) return new Response('Airtable is not configured on this site.', { status: 500 });

  try {
    const [clientRecords, prospectRecords, relationshipRecords] = await Promise.all([
      fetchAll(base, pat, CLIENTS_TABLE),
      fetchAll(base, pat, PROSPECTS_TABLE),
      fetchAll(base, pat, RELATIONSHIPS_TABLE)
    ]);

    let clients = clientRecords.map(mapClient).filter(c => c.n);
    let prospects = prospectRecords.map(mapProspect).filter(p => p.n);
    let relationships = relationshipRecords.map(mapRelationship).filter(r => r.n);

    if (!isPrincipal(coach)) {
      clients = clients.filter(c => c.c === coach);
      prospects = prospects.filter(p => p.coach === coach);
      relationships = relationships.filter(r => r.owner === coach);
    }

    return Response.json({
      ok: true,
      coach, principal: isPrincipal(coach),
      clients, prospects, relationships,
      clientCount: clients.length,
      prospectCount: prospects.length,
      relationshipCount: relationships.length,
      by: auth.who,
      at: new Date().toISOString()
    });
  } catch (e) {
    return new Response(e.message, { status: 502 });
  }
};
