// Everyone on the updates list, with the unsubscribe link to put in their copy
// of an update. `npm run subscribers` (reads DATABASE_URL from .env.local).
import { listSubscribers } from "../lib/db";

const site = process.env.SITE_URL ?? "https://wikicompare.app";
const people = await listSubscribers();
for (const { email, token } of people) console.log(`${email}\t${site}/unsubscribe?token=${token}`);
console.error(`${people.length} subscribed`);
