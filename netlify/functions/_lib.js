/* Shared helpers for every function in this app. One copy, not eight, so
   the auth pattern and the coach map can never drift out of sync with
   each other the way PUSHABLE and FIELD_MAP once did in The Bridge. */

/* Netlify Identity, no widget script. AUTH_MODE stays here for parity
   with The Bridge and Argo Forms, but this app only ever runs as
   'identity': there is no team-private mode for a site coaches log
   into directly. */
export function whoIsCalling(req, context) {
  const ctxUser = context && context.clientContext && context.clientContext.user;
  if (ctxUser) return { ok: true, who: ctxUser.email };
  const header = (req.headers.get('authorization') || '');
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return { ok: false, why: 'No login token was sent with the request.' };
  try {
    const parts = m[1].split('.');
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(json);
    if (payload.exp && payload.exp * 1000 < Date.now())
      return { ok: false, why: 'Login token has expired. Sign out and back in.' };
    return { ok: true, who: payload.email || 'identity user' };
  } catch (e) { return { ok: false, why: 'Could not read the login token.' }; }
}

/* COACH_MAP is a JSON object in Netlify's environment variables, email to
   coach name exactly as it appears in Airtable's Coach Name Text field.
     {"helen@fyibc.com.au":"Helen","ben@fyibc.com.au":"Ben"}
   Onboarding a new coach means adding a line here and redeploying. That
   is a real limitation, flagged on purpose rather than hidden: worth
   moving to an Airtable-backed roster once this app has more than a
   handful of coaches on it. */
export function coachFor(email) {
  let map = {};
  try { map = JSON.parse(process.env.COACH_MAP || '{}'); } catch (e) { map = {}; }
  const hit = Object.entries(map).find(([k]) => k.toLowerCase() === String(email || '').toLowerCase());
  return hit ? hit[1] : null;
}

/* Ben sees every coach's clients and relationships. Everyone else is
   scoped to their own name only. This is the one place that decision is
   made, so it can't be applied inconsistently across functions. */
export function isPrincipal(coachName) {
  return coachName === 'Ben';
}

/* Admin staff, Darrel and Samantha's role: full read and write access to
   everything, same as Ben, but they are not coaches themselves and have
   no entry in COACH_MAP. ADMIN_EMAILS is a comma-separated list in
   Netlify's environment variables, e.g.
     darrell@fyibc.com.au,sam@fyibc.com.au
   Checked separately from COACH_MAP so an admin never needs a fake
   coach name to get through the door. */
export function isAdmin(email) {
  const list = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(String(email || '').toLowerCase());
}

/* The single place every function resolves who is calling and what they
   can see. coach is null for admins, since they have no coach identity
   of their own, principal is true for Ben and for any admin, meaning
   full visibility and no ownership check on writes. */
export function resolveRole(email) {
  const coach = coachFor(email);
  const admin = isAdmin(email);
  const principal = admin || isPrincipal(coach);
  return { coach, admin, principal };
}

export async function at(base, pat, table, path, opts = {}, attempt = 0) {
  const res = await fetch(`https://api.airtable.com/v0/${base}/${table}${path}`, {
    method: opts.method || 'GET',
    headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (res.status === 429 && attempt < 4) {
    await new Promise(r => setTimeout(r, 250 * Math.pow(2, attempt)));
    return at(base, pat, table, path, opts, attempt + 1);
  }
  const txt = await res.text();
  if (!res.ok) throw new Error(`Airtable ${res.status}: ${txt}`);
  return txt ? JSON.parse(txt) : {};
}

export async function fetchAll(base, pat, table) {
  let out = [], offset;
  do {
    const q = `?pageSize=100${offset ? `&offset=${encodeURIComponent(offset)}` : ''}`;
    const r = await at(base, pat, table, q);
    out = out.concat(r.records || []);
    offset = r.offset;
  } while (offset);
  return out;
}
