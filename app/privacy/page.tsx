import Link from "next/link";
import { MEASURE } from "@/components/landing/Section";
import { CONTACT_EMAIL } from "@/lib/contact";

export const metadata = {
  title: "Privacy — Wiki Compare",
  description: "What this site collects, why, who it reaches, and how to have it removed.",
};

/**
 * The notice that section 11 of the Protection of Privacy Law requires at the
 * point of collection, and the reason this site can run without a consent
 * banner in front of it: with nothing stored on a reader's device, a notice is
 * what is owed, rather than a choice.
 *
 * Every claim below is a claim about code, so it has to be re-read whenever the
 * code moves. The load-bearing ones: lib/analytics.ts must stay cookieless and
 * profileless, app/api/feedback/route.ts must keep mailing feedback rather than
 * storing it, and the third-party list is the set of hosts a reader's browser or
 * our server actually talks to.
 */

const UPDATED = "October 2026";

export default function Page() {
  return (
    <main className="px-[24px] py-[76px] max-tight:px-[18px] max-tight:py-[48px]">
      <div className={MEASURE}>
        <Link
          href="/"
          className="font-mono text-[11px] tracking-[0.09em] uppercase text-ink-soft no-underline hover:text-ink"
        >
          ← Wiki Compare
        </Link>

        <h1 className="mt-[28px] mb-[10px] font-display font-normal text-[clamp(30px,4vw,42px)] leading-[1.05] tracking-[-0.01em] text-ink">
          Privacy
        </h1>
        <p className="m-0 font-mono text-[11px] tracking-[0.04em] text-ink-soft">
          Last updated {UPDATED}
        </p>

        <div className="mt-[36px] grid gap-[30px] text-[15px] leading-[1.7] text-ink">
          <Block heading="The short version">
            <p>
              Reading this site sets no cookies and creates no record of you. There is no cookie
              banner because there are no cookies to ask about. If you send feedback, we
              receive what you wrote and the email address you gave. If you sign up for updates, we
              keep your email address until you unsubscribe. Either can be deleted by asking.
            </p>
          </Block>

          <Block heading="Who is responsible">
            <p>
              This site is run by Ido Nov as a personal project. Questions about your data, requests
              to see it, correct it or delete it, all go to{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-ink underline">
                {CONTACT_EMAIL}
              </a>
              , and are answered by a person rather than a process.
            </p>
          </Block>

          <Block heading="If you only read">
            <p>
              No account and no cookie. Your browser keeps two display settings in local storage (how
              far through the introduction you are, and whether every difference is shown), and they
              never leave it. Analytics runs in cookieless mode:
              PostHog counts visits using a hash it computes on its own servers from your IP address
              and browser, salted with a key that is thrown away daily, so the count cannot be
              turned back into a person or followed from one day to the next. We record which
              article was opened and whether it came from cache — never what you searched for, and
              never the text you clicked. Vercel, which hosts the site, also counts page views
              without cookies, from a hash of the request that it discards daily.
            </p>
            <p>
              Two other parties see your IP address simply because your browser talks to them: the
              article photographs are served by Wikimedia, and the typefaces by Google Fonts.
            </p>
          </Block>

          <Block heading="If you send feedback">
            <p>
              The feedback form asks for your email address, your message and, if you like, your
              name. They are emailed to our inbox and kept there, not in the site&apos;s database.
            </p>
          </Block>

          <Block heading="If you sign up for updates">
            <p>
              The address you give is kept in the site&apos;s database and used for one thing: an
              occasional email when there is news about the project. Every update carries a link to
              unsubscribe, and you can also ask to be removed by writing to the address above.
            </p>
          </Block>

          <Block heading="Why we hold it">
            <p>
              To answer your feedback, to send the updates you asked for, and to know whether anybody
              is using this. Nothing here is
              sold, rented, or used to advertise to you, and none of it is used to build a profile of
              what you read.
            </p>
          </Block>

          <Block heading="Who processes it for us">
            <ul className="m-0 grid list-disc gap-[6px] pl-[22px]">
              <li>Vercel: hosting, and the page-view count.</li>
              <li>Neon: the database.</li>
              <li>PostHog: analytics, as described above.</li>
              <li>Resend: delivering feedback to our inbox.</li>
              <li>Google: the typefaces.</li>
              <li>
                TypeSafe: reads the Wikipedia articles to produce the comparison. It is sent the
                encyclopedia&apos;s text and nothing about you.
              </li>
              <li>
                Anthropic: writes the explanation of a difference the first time anyone points at it.
                It is sent the passages involved and nothing about you.
              </li>
            </ul>
            <p>
              These are companies outside Israel, mostly in the United States and the EU, so using
              this site means your data is handled abroad.
            </p>
          </Block>

          <Block heading="Email">
            <p>
              Nothing is emailed to you automatically. We write only to answer feedback you sent,
              or to send updates if you signed up for them. Sending feedback never puts you on the
              updates list, and if we ever want to write to you about anything else, we will ask
              first and take no for an answer.
            </p>
          </Block>

          <Block heading="Your rights">
            <p>
              Under the Protection of Privacy Law you may ask to see the data held about you, to
              have it corrected if it is wrong, and to have it deleted. Write to{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-ink underline">
                {CONTACT_EMAIL}
              </a>{" "}
              and you will get an answer within 30 days. Providing any of this is voluntary — the
              only consequence of withholding an email address is that we cannot reply to you.
            </p>
          </Block>

          <Block heading="Wikipedia text and photographs">
            <p>
              The article prose and the lead photographs in the columns are the work of
              Wikipedia&apos;s contributors, excerpted and abridged for comparison rather than
              reproduced whole, and reused under{" "}
              <a
                href="https://creativecommons.org/licenses/by-sa/4.0/"
                target="_blank"
                rel="license noopener noreferrer"
                className="text-ink underline"
              >
                CC BY-SA 4.0
              </a>
              , which this site and anything drawn from it carry too. Each column links the exact
              revision it was read from, and each photograph names its author and licence.
            </p>
          </Block>

          <Block heading="If a comparison is wrong about you">
            <p>
              Comparisons and their explanations are produced by language models from the articles, so they can be wrong or
              incomplete, and a marked difference is a pointer to check the sources rather than a
              finding. If one says something false about you, write to{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-ink underline">
                {CONTACT_EMAIL}
              </a>{" "}
              and the comparison comes down while it is looked at.
            </p>
          </Block>

          <Block heading="Changes">
            <p>
              If this notice changes in a way that matters, the date at the top changes with it.
            </p>
          </Block>
        </div>
      </div>
    </main>
  );
}

function Block({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-[10px]">
      <h2 className="m-0 font-mono text-[11px] tracking-[0.09em] uppercase text-ink-soft">
        {heading}
      </h2>
      {children}
    </section>
  );
}
