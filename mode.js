import { coachFor } from './_lib.js';

export default async (req, context) => {
  const user = context.clientContext && context.clientContext.user;
  const header = (req.headers.get('authorization') || '');
  const hasBearer = /^Bearer\s+\S+/i.test(header);
  const email = user ? user.email : null;

  return Response.json({
    signedIn: !!user || hasBearer,
    signedInAs: email,
    coach: email ? coachFor(email) : null,
    hasAirtable: !!process.env.AIRTABLE_PAT,
    hasStateTable: !!process.env.COACHES_STATE_TABLE,
    hasCoachMap: !!process.env.COACH_MAP
  });
};
