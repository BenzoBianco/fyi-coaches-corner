import { resolveRole } from './_lib.js';

export default async (req, context) => {
  const user = context.clientContext && context.clientContext.user;
  const header = (req.headers.get('authorization') || '');
  const hasBearer = /^Bearer\s+\S+/i.test(header);
  const email = user ? user.email : null;
  const role = email ? resolveRole(email) : { coach: null, admin: false, principal: false };

  return Response.json({
    signedIn: !!user || hasBearer,
    signedInAs: email,
    coach: role.coach,
    admin: role.admin,
    principal: role.principal,
    hasAirtable: !!process.env.AIRTABLE_PAT,
    hasStateTable: !!process.env.COACHES_STATE_TABLE,
    hasCoachMap: !!process.env.COACH_MAP,
    hasAdminEmails: !!process.env.ADMIN_EMAILS
  });
};
