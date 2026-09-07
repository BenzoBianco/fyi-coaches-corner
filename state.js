/* Saves Coach Training sign-off progress. Nothing else in this app has
   local-only state worth persisting: Clients, Prospects and
   Relationships all round-trip through Airtable directly.

   This needs its own Airtable table, separate from The Bridge's Bridge
   State table, because this app's token is deliberately not scoped to
   see that table. Create a table called "Coaches Corner State" with
   three fields: Key (single line text), Chunk (number), Payload (long
   text), and put its table id in COACHES_STATE_TABLE.

   Keyed per coach, "training-Helen", "training-Ben", so one coach's
   save can never overwrite another's, and no cross-coach filtering
   logic is needed here at all. */

import { whoIsCalling, coachFor, at } from './_lib.js';

const CHUNK = 90000;

export default async (req, context) => {
  const auth = whoIsCalling(req, context);
  if (!auth.ok) return new Response(auth.why, { status: 401 });

  const coach = coachFor(auth.who);
  if (!coach) return new Response(`${auth.who} is not set up as a coach in COACH_MAP.`, { status: 403 });

  const base = process.env.AIRTABLE_BASE, pat = process.env.AIRTABLE_PAT, table = process.env.COACHES_STATE_TABLE;
  if (!base || !pat || !table) {
    return new Response('COACHES_STATE_TABLE is not set. Create the table in Airtable and add its id, then redeploy.', { status: 500 });
  }

  const KEY = 'training-' + coach;

  async function listMine() {
    let out = [], offset;
    do {
      const q = `?pageSize=100${offset ? `&offset=${encodeURIComponent(offset)}` : ''}`;
      const r = await at(base, pat, table, q);
      out = out.concat((r.records || []).filter(x => x.fields.Key === KEY));
      offset = r.offset;
    } while (offset);
    return out.sort((a, b) => (a.fields.Chunk || 0) - (b.fields.Chunk || 0));
  }

  try {
    if (req.method === 'GET') {
      const mine = await listMine();
      if (!mine.length) return Response.json({ value: null });
      const json = mine.map(r => r.fields.Payload || '').join('');
      try { JSON.parse(json); } catch (e) { return Response.json({ value: null, error: 'Saved progress could not be read. Nothing was overwritten.' }); }
      return Response.json({ value: json });
    }

    if (req.method === 'POST') {
      const { value } = await req.json();
      if (typeof value !== 'string') return new Response('Bad payload', { status: 400 });
      try { JSON.parse(value); } catch (e) { return new Response('Refused: not valid JSON.', { status: 400 }); }

      const before = (await listMine()).map(r => r.id);
      const parts = [];
      for (let i = 0; i < value.length; i += CHUNK) parts.push(value.slice(i, i + CHUNK));

      for (let i = 0; i < parts.length; i += 10) {
        await at(base, pat, table, '', { method: 'POST', body: {
          records: parts.slice(i, i + 10).map((p, j) => ({ fields: { Key: KEY, Chunk: i + j, Payload: p } }))
        }});
      }
      for (let i = 0; i < before.length; i += 10) {
        const q = '?' + before.slice(i, i + 10).map(id => `records[]=${id}`).join('&');
        await at(base, pat, table, q, { method: 'DELETE' });
      }
      return Response.json({ ok: true, savedBy: auth.who, at: new Date().toISOString() });
    }

    return new Response('Method not allowed', { status: 405 });
  } catch (e) {
    return new Response(e.message, { status: 500 });
  }
};
