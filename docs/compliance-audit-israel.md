# Regulatory audit — Israel, pre-launch

**Date:** August 2026 · **Scope:** this repository at `claude/posthog-israel-compliance-audit-gq9st0`

I am not a lawyer and this is not legal advice. It is an engineer's read of what the code
does, set against the law as it currently stands, so that a lawyer's hour can be spent on the
two or three things that actually need one. Where I am unsure I have said so.

---

## The three questions, answered

**Was the PostHog integration OK?** No. Not because PostHog is the wrong tool, but because it
was initialised on its defaults, and the defaults are built for a SaaS dashboard rather than
for a site whose pages are Wikipedia articles about the Israeli–Palestinian conflict. As
configured it set a year-long cookie, autocaptured the text of everything a reader clicked,
and sent all of it to a US endpoint — while the site had no privacy notice at all. Details in
[Finding 1](#1-posthog-ran-on-its-defaults-fixed).

**Did you need a cookie banner?** Under the previous configuration, yes. As of this branch, no.

**Can you collect similar data without one?** Yes, and it is done — PostHog's cookieless mode,
with autocapture and person profiles off. You keep every funnel you had. You lose the ability
to follow one reader across sessions, which those funnels were not using. See
[The banner question](#the-banner-question) for why this works and what it rests on.

---

## What actually applies here

| Instrument | Bearing on this project |
|---|---|
| **Protection of Privacy Law 5741-1981, as amended by Amendment 13** (in force 14 Aug 2025) | The main one. Informed consent, notice at collection, access/correction/deletion rights, PPA enforcement. |
| **Privacy Protection (Data Security) Regulations 5777-2017** | Applies to any database here. Security procedures, access control, a database definition document. |
| **Communications (Bezeq and Broadcasts) Law, s.30A** — the spam law | Bites on two promises the donation flow makes. [Finding 5](#5-the-code-promises-emails-that-s30a-would-not-permit). |
| **Equal Rights for Persons with Disabilities (Service Accessibility) Regulations 5773-2013 / IS 5568** | Probably exempt today on turnover; not exempt once real money moves. [Finding 8](#8-accessibility-is-5568). |
| **Prohibition of Defamation Law 5725-1965** | Live risk, given LLM-generated characterisations of living people. [Finding 7](#7-defamation-exposure-on-llm-generated-claims). |
| **CC BY-SA 4.0** (not Israeli law, but binding) | The site reproduces Wikipedia prose with no attribution. [Finding 6](#6-wikipedia-content-is-reproduced-with-no-attribution) — the largest non-privacy exposure in the repo. |

Two pieces of good news, since they save work:

- **You almost certainly do not need to register a database.** Amendment 13 removed registration
  for most private controllers; it now lands on data brokers over 10,000 subjects, and public
  bodies. You are neither.
- **You almost certainly do not need a DPO.** The triggers are public bodies, data brokers,
  controllers whose core activity is processing highly sensitive data, and systematic
  monitoring. A comparison site with a credit ledger is none of those — but see
  [Finding 2](#2-reading-history-on-these-topics-is-not-ordinary-data), which is the one place
  that could be argued.

---

## The banner question

Israel has no ePrivacy Directive. There is no Israeli rule that says "storing information on
terminal equipment requires consent", which is the rule that produces cookie banners across
Europe. So the question is never "is this a cookie" — it is **"is personal data being
collected into a database, and if so, was there informed consent?"**

That reframing is what makes the banner avoidable:

- A **persistent identifier stored on the device** and used to link one reader's visits over
  time is personal data. Collecting it needs informed consent, and the PPA's guidance —
  a recommendation rather than binding law, but the standard an enforcement action would be
  measured against — is that it should be **opt-in**. That is a banner. This is what the old
  configuration required.
- **No identifier, no profile, no device storage** means no personal data collected in the
  browser. What is owed then is a **notice**, not a choice. No banner.

The auth session cookie is unaffected either way. It is set only after a deliberate sign-in,
it is strictly necessary to deliver the thing being asked for, and no reading of the PPL turns
that into a consent prompt.

**One caveat, and it matters:** cookieless mode is not fully in your control from this repo. It
must also be switched on in the PostHog project settings — "Cookieless server hash mode" —
or PostHog silently drops every event the site sends. The failure mode is an empty dashboard
rather than an error. ✅ Enabled 9 Aug 2026.

---

## Findings

Ordered by how much they should worry you.

### 1. PostHog ran on its defaults *(fixed)*

`lib/analytics.ts` initialised with only `capture_pageview: false` set. Everything else was
PostHog's default, and four of those defaults were wrong here:

| Default | What it did | Now |
|---|---|---|
| `persistence: "localStorage+cookie"` | Set `ph_<key>_posthog`, **365-day expiry**, holding a persistent `distinct_id`. This alone required a banner. | `cookieless_mode: "always"` — nothing on the device. |
| `autocapture: true` | Captured every click, form interaction and input focus, including **the text and attributes of the element clicked**. On this site that text is Wikipedia prose about the conflict. | `autocapture: false` |
| `person_profiles: "identified_only"` | No profile for anonymous readers, but the persistent id was still stored, and any future `identify()` call would have created profiles keyed to email-bearing accounts. | `person_profiles: "never"` |
| `disable_session_recording: false` | Replay was one checkbox in the PostHog dashboard away from recording readers' screens, with nothing in the repo to say it had changed. | `disable_session_recording: true` |

Outside the repo: **cookieless server hash mode is enabled** ✅. Still to do in the same
settings screen —

- **Turn on "Discard client IP data."** The client no longer stores an identifier, but
  ingestion still reads the source IP off the request — that is now the only personal data left
  in the pipeline. Note that the `ip: false` config option is deprecated and does nothing; this
  has to be the project setting.
- **Turn off autocapture and session replay at the project level.** Both are already off in
  code, so this is belt-and-braces — but it is the cheap kind: it means a future `posthog.init`
  written by someone who has not read this file cannot quietly turn them back on.
- **Move to an EU project** (`https://eu.i.posthog.com`). Israel holds an EU adequacy decision,
  so EU-hosted processing is a one-line disclosure. A US project is a transfer to a
  jurisdiction with no reciprocal finding, and a longer paragraph to defend. `.env.example` now
  suggests the EU host; the code default is still US, so this is an env change, not a deploy.

Also removed: the exported `identify()` function. It was never called from anywhere — dead
code — but it was dead code that would have re-created exactly the problem above the moment
someone wired it up.

### 2. Reading history on these topics is not ordinary data

This is the finding that raises the stakes on all the others, and the reason I would not have
been comfortable leaving the old configuration in place even with a banner.

Amendment 13 defines **data of special sensitivity** to include data on a person's *political
opinions, religious beliefs, or worldview*. `article_opened` carries the subject's Wikidata
QID. Under the old configuration that QID was attached to a persistent device identifier — so
the pipeline was building, per device, *a list of which conflict subjects this person reads
about, in which language*. That is a reasonable proxy for political opinion, and a regulator
looking at it after a complaint would not have to stretch.

Cookieless mode resolves this: the QIDs are still collected, but there is nothing durable to
attach them to, so they are counts rather than a reading list.

**Keep it that way.** The specific thing not to do later is add `person_profiles: "always"`, or
call `identify()` on the client, or start passing account ids into `capture()` from routes
where the account is not the subject of the event. `lib/analytics.ts` now says this in a
comment at each place it could go wrong.

### 3. There was no privacy notice at all *(drafted)*

Independent of cookies, s.11 of the PPL requires that a person asked for data be told who is
asking, for what purpose, whether they are obliged to provide it, and what happens if they
don't. Amendment 13 strengthened this. The site asked for an email address on the sign-in
screen with none of it stated anywhere.

Added: `app/privacy/page.tsx`, linked from the footer on every page and from directly beneath
the sign-in form — the notice has to be where the address is asked for, not only in a footer.

**This draft needs your review before launch.** I wrote it from what the code actually does,
which makes it accurate but not authoritative. Specifically: it names you personally as
responsible (correct today, wrong the moment there is a company); its retention statements are
intentions that no code currently enforces (see Finding 4); and nobody with a licence has read
it.

### 4. Deleting an account does not delete the person

`db/schema.sql` keeps `user_id TEXT` on `donations`, `spends` and `coupon_redemptions`
deliberately without a foreign key, so that closing an account leaves the ledger intact. The
comment argues a dangling id is the correct outcome, and as a *product* argument that is right
— the count of people who tried to pay is the point of the table.

As a *compliance* argument it does not hold. `user_id` is a pseudonymous identifier for an
identifiable person, so retaining it after an erasure request retains personal data. The PPL
gives a data subject the right to have data deleted, and Amendment 13 put real enforcement
behind it.

The fix keeps both: on account deletion, **anonymise rather than retain**. Replace `user_id`
with a one-way salted hash (or simply `NULL`, if you don't need to know that two rows were the
same person). The aggregate survives, the link to a human does not. Related, and smaller: the
`session` table stores `ipAddress` and `userAgent` with no cleanup of expired rows — expired
sessions should be deleted on a schedule, not left to accumulate.

There is also no route to *make* a deletion request other than emailing you, which is
acceptable at this scale as long as the address in the notice is monitored and answered inside
30 days.

### 5. The code promises emails that s.30A would not permit *(fixed)*

Two places commit to sending future email:

- `app/api/donate/route.ts` — *"You'll get an email once we are ready to accept payments."*
- `components/Donate.tsx:381` — *"Cancel whenever. We'll email before each one."*

Section 30A of the Communications Law defines an advertisement as a message intended to
promote a monetary expenditure, and requires **prior explicit consent, in writing**, before
sending one. "We'll email you when you can pay us" is squarely that. Statutory damages are up
to **NIS 1,000 per message, without proof of damage** — which for a list of any size is the
kind of number that ends a side project.

Nothing has been sent yet, so there is no violation today. But there is also nowhere in the
schema to record consent, and no unsubscribe mechanism. Before either promise is kept you need:
an explicit opt-in at the point of the promise (an unticked checkbox, separately worded), a
column recording when and how it was given, the sender's name and contact in the message body,
the word "advertisement" where required, and one-click unsubscribe.

**Done.** `email_consents` logs each decision — grant and withdrawal alike — with the account,
the surface that asked, and the exact wording agreed to. It is a log rather than a flag on the
user row because a flag answers "may we write to them now" while only a log answers "were we
allowed to send the one we sent in March", which is the question a claim actually asks.
`mayEmail()` in `lib/consent.ts` is the gate, and answers false when the log is unreachable.

The asking happens on the reveal, after the payment, as a button reading *"Send me an email
once payments are available"* — `POST /api/email-consent`, its own route rather than a field on
the donation. Consent carried inside the payment body is consent inferred from a payment, which
is the thing the section does not allow; a separate deliberate press is the written permission
it does. The reveal copy no longer promises mail to anyone, and the monthly row lost "we'll
email before each one" for the same reason.

`EMAIL_CONSENT_WORDING` lives in `lib/types.ts` because both sides need the same string and
neither may own it — the button renders it, the route stores it as the evidence. Stored per row
rather than looked up, so changing the sentence later cannot rewrite what past consents meant.

Still outstanding, for whenever mail actually starts going out: the message body needs the
sender's name and contact, the word "advertisement" where required, and one-click
unsubscribe writing a `granted = false` row through `recordEmailConsent`.

### 6. Wikipedia content is reproduced with no attribution *(fixed)*

Not privacy, and the largest single exposure in the repo.

The site renders Wikipedia article prose verbatim (`section.text` through `components/Columns.tsx`)
and hotlinks lead photographs from `upload.wikimedia.org` (`extractLeadImage` in
`lib/wikipedia.ts`). Wikipedia text is CC BY-SA 4.0, which requires attribution to the
authors, a statement of the licence, an indication that the material was modified, and that
derivatives carry the same licence. The site currently provides none of these — the footer
credits you and nobody else.

**Done, both halves.**

- **Text:** each column head now carries the CC BY-SA 4.0 deed beside its revision link, and the
  footer states the standing part — that the text is excerpted and abridged, that it is
  Wikipedia contributors' work, and that this page and anything drawn from it carry the same
  terms.
- **Images:** candidates are restricted to files hosted on **Commons**, which is the licence
  question in disguise — Commons accepts freely licensed and public-domain files only, while a
  file uploaded locally to an edition is overwhelmingly the opposite case (album covers, film
  posters, portraits of living people) kept under a rationale covering that one article.
  `withImageCredit` then resolves author and licence from the file page and the renderer prints
  them under the photo. **Every failure drops the image** — file gone, API unreachable, licence
  unreadable or non-free — because a photograph whose terms we cannot name is one we have no
  permission to publish.

  Verified live: `Thriller (album)` used to lead with its non-free cover, and now falls through
  to a public-domain press photo further down the page. `PARSER_VERSION` moved to `v5` so
  snapshots cached with the old picks are re-read rather than served.

  One wrinkle worth knowing: fixture replay is offline, so `snapshotOf` cannot look a credit up
  and dev fixtures render their photo uncredited. Production always goes through `fetchArticle`,
  which does. Re-record with `npm run fixtures:refresh` if that ever matters.

### 7. Defamation exposure on LLM-generated claims

The Prohibition of Defamation Law allows statutory damages of roughly **NIS 75,000 per
publication without proof of damage**, doubled where intent to harm is shown. The site
generates characterisations of how sources disagree about subjects who include living people,
on the most litigated topic in the country, and publishes them as marked-up claims.

The footer disclaimer — *"treat a marked difference as a pointer to check the sources, not a
finding"* — is genuinely useful and well-placed. It is not a defence on its own. What was
missing is a **route to complain**, and that is now in the footer beside the disclaimer: a
mailto with a subject line, and a stated commitment to take a comparison down while it is
looked at.

**A per-comparison report button is not what the law asks for, and is the wrong first move.**
What matters to a defamation claim is that a complaint reaches you and that you act on it
quickly — the speed of the response, not the ergonomics of the reporting. A standing contact on
every page satisfies that today, at the cost of one line. A button next to the marks would be a
UI feature with a queue and a moderation workflow behind it, and it is worth building only when
volume makes the inbox the bottleneck.

The remaining half is the commitment itself: when a complaint arrives, the fastest thing you can
do is delete the row from `comparisons` for that `cache_key`, which drops the comparison
entirely and makes the next request re-read the article. Worth knowing before you need it.

Still the one finding worth a lawyer's specific attention. It is where the downside is not a
fine but a lawsuit.

### 8. Accessibility (IS 5568)

Israeli service-accessibility regulations require public-facing websites to meet IS 5568
(WCAG 2.0 AA) and to publish an accessibility statement. Private businesses under roughly
**NIS 100,000** annual turnover are exempt — which today is almost certainly you, and is why
this is not higher up the list. The exemption stops applying the moment donations become real
revenue.

The code is in better shape than most: `role="alert"` on the sign-in error, `aria-describedby`
on the invalid field, Escape to dismiss the tooltip, real semantic elements. Two gaps I noticed:
lead-photo `alt` text is passed through from Wikipedia and is `undefined` when absent
(`lib/wikipedia.ts:283`), and the highlight marks convey category through colour — the legend
mitigates this, but it is worth a contrast check against 4.5:1 before launch.

Plan for an accessibility statement page and an audit against IS 5568 at the point payments go
live, not before.

### 9. Google Fonts is a third-party call before consent

`app/layout.tsx` loads eight families from `fonts.googleapis.com` / `fonts.gstatic.com`. Every
visitor's IP reaches Google before they have interacted with anything. Israeli law is far less
exercised about this than German courts have been, and it is disclosed in the new notice, but
it is avoidable: `next/font/google` self-hosts the files at build time, removing the request
entirely. It would also make the page faster, which is the better argument.

### 10. Cross-border transfers, and the paperwork underneath

Personal data reaches Vercel, Neon, PostHog, Resend and Google, all outside Israel. Amendment
13's transfer rules require a lawful basis and disclosure. Disclosure is now handled in the
notice. What is not handled:

- **DPAs.** Each of these vendors offers a standard data processing agreement. Accepting them
  is a few minutes in each dashboard and is the paperwork a regulator asks for first.
- **A database definition document.** The 2017 Data Security Regulations require one for the
  database regardless of registration: what is held, why, who can reach it, how long it is
  kept. Much of it can be lifted from the privacy notice and `db/schema.sql`'s comments.
- **Terms of use.** None exist. Not strictly required, but it is where the LLM-output
  disclaimer, the takedown route from Finding 7, and the licensing notice from Finding 6
  naturally live.

---

## What this branch changed

**Privacy and analytics**

- `lib/analytics.ts` — cookieless mode, autocapture off, person profiles off, session recording
  off; removed the unused `identify()` path and the pending-identity queue it needed.
- `app/privacy/page.tsx` — new privacy notice. **Draft; needs your review.**
- `components/SignIn.tsx` — notice at the point the email address is asked for.
- `.env.example` — documented the PostHog variables, which were undocumented, along with the
  project settings the code cannot enforce.

**Licensing and defamation**

- `lib/wikipedia.ts` — Commons-only image selection, `withImageCredit`, `PARSER_VERSION` → `v5`.
- `lib/types.ts` — `ImageCredit`; `ArticleImage` gains `file` and `credit`.
- `components/Columns.tsx` — the credit beneath each photo, the licence beside each revision link.
- `components/Footer.tsx` — the standing licence notice, the privacy link, and the takedown route.

**Email consent**

- `db/schema.sql` — `email_consents`.
- `lib/consent.ts` — `recordEmailConsent`, `mayEmail`.
- `app/api/email-consent/route.ts` — the one act that grants permission.
- `components/Donate.tsx`, `app/api/donate/route.ts` — the button on the reveal, and reveal copy
  that no longer promises mail to anybody.

Typecheck, `npm run check` and `npm run build` all pass. No behavioural change to any funnel:
all fifteen events in `EVENTS` still fire, from the same call sites, with the same properties.

## What is left, in the order I would do it

**Before launch**

1. Enable cookieless mode in the PostHog project, or the analytics silently stop working.
2. Enable "Discard client IP data" in the same place.
3. Turn off autocapture and session replay at the project level too, so the code and the
   dashboard agree rather than relying on the code alone.
4. Read the privacy notice and correct it where it is wrong about you.
5. Run `npm run db:init` so `email_consents` exists before the donate route writes to it.

**Soon after**

6. Anonymise `user_id` on account deletion; expire old sessions (Finding 4).
7. Move PostHog to the EU project.
8. Accept the vendor DPAs; write the database definition document.
9. Self-host the fonts.
10. Unsubscribe handling, if and when mail starts going out (Finding 5).

**When money becomes real**

11. IS 5568 audit and accessibility statement.
12. Terms of use.
13. A lawyer on Finding 7 — the one where the downside is not a fine but a lawsuit.

---

## Sources

- [Israel marks a new era in privacy law: Amendment 13 ushers in sweeping reform — IAPP](https://iapp.org/news/a/israel-marks-a-new-era-in-privacy-law-amendment-13-ushers-in-sweeping-reform)
- [Amendment No. 13 to the Israeli Privacy Protection Law — Herzog](https://herzoglaw.co.il/en/news-and-insights/amendment-no-13-to-the-israeli-privacy-protection-law/)
- [Israel: Significant Amendment to the Privacy Law Takes Effect — Pearl Cohen](https://www.pearlcohen.com/israel-significant-amendment-to-the-privacy-law-takes-effect/)
- [The Israeli PPA Recommends Obtaining User Consent to Cookies — Pearl Cohen](https://www.pearlcohen.com/the-israeli-privacy-protection-authority-recommends-obtaining-user-consent-to-cookies/)
- [Overview of Amendment No. 13 to the Israeli Privacy Law — Israel Tech Policy Institute](https://techpolicy.org.il/wp-content/uploads/2024/10/Overview-of-Amendment-no-13-FINAL-FINAL-FOR-UPLOAD-FOR-WEBSITE-COLLATED-1.pdf)
- [Israel — Cookies & Similar Technologies Guidance Note (AYR)](https://www.ayr.co.il/wp-content/uploads/2024/04/Israel-Cookies-Similar-Technologies-Guidance-Note-.pdf)
- [Data Protection & Privacy 2026: Israel — Chambers](https://practiceguides.chambers.com/practice-guides/data-protection-privacy-2026/israel)
- [International Data Transfer: Israel — Baker McKenzie](https://resourcehub.bakermckenzie.com/en/resources/global-data-and-cyber-handbook/emea/israel/topics/international-data-transfer)
- [Israeli Anti-SPAM Legislation — law.co.il](https://www.law.co.il/en/news/2016/08/19/israeli-anti-spam-law-amended-for-first-time/)
- [Types of Compensation in Defamation Lawsuits in Israel](https://adv-yariv.com/en/types-compensation-defamation-lawsuits/)
- [What is IS 5568? — accessiBe](https://accessibe.com/compliance/is-5568)
- [PostHog: cookieless tracking](https://posthog.com/tutorials/cookieless-tracking) · [privacy controls](https://posthog.com/docs/product-analytics/privacy) · [persistence](https://posthog.com/docs/libraries/js/persistence)
