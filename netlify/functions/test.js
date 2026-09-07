/* Connection test. Run this FIRST from the Netlify Functions tab after
   every deploy that touches environment variables. */

export default async () => {
  const lines = [];
  const base = process.env.AIRTABLE_BASE;
  const pat  = process.env.AIRTABLE_PAT;
  const stateTbl = process.env.COACHES_STATE_TABLE;
  const coachMap = process.env.COACH_MAP;
  const gcal = process.env.GCAL_ICS;

  lines.push('ENVIRONMENT VARIABLES');
  lines.push('  AIRTABLE_BASE         ' + (base ? 'set  (' + base + ')' : 'MISSING'));
  lines.push('  AIRTABLE_PAT          ' + (pat ? 'set  (' + pat.slice(0, 8) + '...)' : 'MISSING'));
  lines.push('  COACHES_STATE_TABLE   ' + (stateTbl ? 'set  (' + stateTbl + ')' : 'MISSING'));
  lines.push('  COACH_MAP             ' + (coachMap ? 'set' : 'MISSING'));
  lines.push('  GCAL_ICS              ' + (gcal ? 'set' : 'not set, next/last session will be skipped'));
  lines.push('');

  if (coachMap) {
    try {
      const parsed = JSON.parse(coachMap);
      lines.push('COACH_MAP contents');
      Object.entries(parsed).forEach(([email, name]) => lines.push('  ' + email + '  ->  ' + name));
      lines.push('');
    } catch (e) {
      lines.push('COACH_MAP does not parse as JSON. Check the format: {"email":"Name"}');
      lines.push('');
    }
  }

  if (!base || !pat) {
    lines.push('Stop here. Add the missing variables under Site configuration, Environment variables, then REDEPLOY.');
    return new Response(lines.join('\n'));
  }

  lines.push('CONNECTIONS');
  async function check(label, table) {
    if (!table) { lines.push('  ' + label + '  SKIPPED, no table id set'); return; }
    try {
      const r = await fetch(`https://api.airtable.com/v0/${base}/${table}?pageSize=1`, { headers: { Authorization: `Bearer ${pat}` } });
      if (r.status === 401) return lines.push('  ' + label + '  FAILED, token rejected. Check the PAT.');
      if (r.status === 403) return lines.push('  ' + label + '  FAILED, token has no access to this table.');
      if (r.status === 404) return lines.push('  ' + label + '  FAILED, table not found. Check the id.');
      if (!r.ok) return lines.push('  ' + label + '  FAILED, status ' + r.status);
      lines.push('  ' + label + '  ok');
    } catch (e) { lines.push('  ' + label + '  FAILED, ' + e.message); }
  }

  await check('Clients        ', 'tblsYEZBxkG7hSM5X');
  await check('Prospects      ', 'tblbRxl3kf2wtTlBE');
  await check('Relationships  ', 'tbl3yFRxhpJxVLVHX');
  await check('Coaches State  ', stateTbl);

  lines.push('');
  lines.push('If every line above says ok, and COACH_MAP lists you, load the site and log in.');
  return new Response(lines.join('\n'));
};
