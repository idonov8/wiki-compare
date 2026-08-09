import { neon } from "@neondatabase/serverless";

/**
 * Permission to send somebody a commercial message.
 *
 * Section 30A of the Communications Law treats anything sent to promote a
 * monetary expenditure as an advertisement, and requires consent given in
 * writing *before* it is sent — opt-in, never opt-out, never inferred from a
 * donation or an account. This module is the record of that permission, and
 * `mayEmail` is the gate every future sender has to pass through.
 *
 * Nothing here sends mail, because nothing in this app sends mail yet beyond the
 * sign-in link, which is not an advertisement and is not covered. What this
 * exists to prevent is the version of that future where the list is assembled
 * first and the permission is looked for afterwards.
 */

function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Add it in the Vercel project settings.");
  return neon(url);
}

/** The surfaces that can ask. A union rather than a free string so a new asking
 *  place has to be named here, where it is visible next to the others. */
export type ConsentSource = "donate" | "unsubscribe";

export interface ConsentRecord {
  userId: string;
  email: string;
  granted: boolean;
  source: ConsentSource;
  /** The exact wording agreed to. Consent under s.30A is to a particular
   *  proposition, so a row that cannot reproduce it proves less than it looks. */
  evidence?: string;
}

/**
 * Writes one decision down.
 *
 * Every call appends; nothing here updates or deletes. A withdrawal is a new row
 * with `granted = false`, which keeps the history intact — a claim about a
 * message sent in March is answered by what the log said in March, and a table
 * that overwrites cannot answer it at all.
 */
export async function recordEmailConsent(record: ConsentRecord): Promise<void> {
  await sql()`
    INSERT INTO email_consents (user_id, email, granted, source, evidence)
    VALUES (
      ${record.userId}, ${record.email}, ${record.granted},
      ${record.source}, ${record.evidence ?? null}
    )
  `;
}

/**
 * Whether this account may be sent a commercial message right now.
 *
 * Answers false when the log is unreachable, which is the one direction this
 * question is allowed to fail in: not sending a message nobody was waiting for
 * costs nothing, and sending one without permission costs NIS 1,000 of statutory
 * damages per recipient. Callers should treat a false as final rather than
 * retrying it.
 */
export async function mayEmail(userId: string): Promise<boolean> {
  try {
    const rows = await sql()`
      SELECT granted FROM email_consents
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    return rows.length ? (rows[0].granted as boolean) : false;
  } catch {
    return false;
  }
}
