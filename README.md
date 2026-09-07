# FYI Coaches' Corner, setup

Two things need doing in Airtable and Netlify before this works. Neither is optional.

## 1. Create the Coaches Corner State table

This app's Airtable token is deliberately scoped to Clients, Prospects and Relationships only, so it cannot reuse The Bridge's Bridge State table for saving Coach Training progress. Create a new table in the same base:

**Table name:** Coaches Corner State
**Fields, exactly:**
- `Key` — single line text
- `Chunk` — number
- `Payload` — long text

Copy its table id (starts `tbl`) for the next step.

## 2. Set the new environment variables in Netlify

Site configuration, Environment variables, on the Coaches' Corner site:

| Variable | Value |
|---|---|
| `AIRTABLE_BASE` | `appnCOCVS7Gie9lrW` |
| `AIRTABLE_PAT` | your new restricted token |
| `COACHES_STATE_TABLE` | the table id from step 1 |
| `COACH_MAP` | see below |

`COACH_MAP` is a single-line JSON object, email to coach name exactly as it appears in the Coach Name Text field on Clients:

```
{"helen@fyibc.com.au":"Helen","ben@fyibc.com.au":"Ben"}
```

Onboarding a new coach later means adding a line here and redeploying. Worth moving to an Airtable-backed roster once there are more than a handful of coaches.

**Your restricted PAT also needs write access to Coaches Corner State**, or Coach Training progress will fail to save. If you scoped the token to specific tables rather than the whole base, add this one to it now.

Redeploy after saving the variables. Nothing takes effect until you do.

## 3. Run the connectivity check

Once deployed, open:

```
https://<your-site>.netlify.app/.netlify/functions/test
```

Every line should say `ok`, and `COACH_MAP` should list every coach by email.

## 4. Invite Helen

Netlify Identity, Users tab, Invite user, her email. She'll get an email with a link containing a token. On the Coaches' Corner login screen, she clicks "Accepting an invite?", pastes the token, and sets her password there. That's a single call under the hood, not two, which is why a half-finished invite acceptance can't leave her stuck.

## What this app can and can't do

Clients and Prospects: view, edit, create. Relationships: view, edit, create, scoped by the Owner field. SOPs and Coach Training: reference content, duplicated from The Bridge, not read from Airtable. Coach Training sign-off progress saves per coach, to the new state table.

A coach only ever sees and edits their own clients and relationships. Ben sees and edits everyone's. This is enforced server-side in every function, not just hidden in the interface.
