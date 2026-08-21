"use client";

import { OUT_OF_CREDIT } from "@/lib/types";
import { CONTACT_EMAIL } from "@/lib/contact";

/**
 * The site is out of model credit, said plainly and in the first person.
 *
 * Not the ordinary "that didn't work" panel: nothing the reader typed is at
 * fault, retrying will not help, and the two things that would help — money and
 * somebody telling me it has happened — are the only controls on it.
 */
export default function Outage({ from }: { from: string }) {
  return (
    <div className="outage text-ink-soft py-[64px] pe-[24px] ps-[16px] max-w-[58ch] border-s-[3px] border-contradiction">
      <h2 className="font-display text-[27px] font-normal text-ink m-0 mb-[10px]">
        The site is out of credit
      </h2>
      <p className="m-0 mb-[14px]">{OUT_OF_CREDIT}</p>
      <p className="m-0 mb-[14px]">
        If you want the site to come back please donate, and{" "}
        <a className="text-ink underline underline-offset-[3px]" href={`mailto:${CONTACT_EMAIL}`}>
          email me at {CONTACT_EMAIL}
        </a>
        .
      </p>
      {/* On its own line rather than inside the sentence: a filled button set
          mid-paragraph breaks the line wherever it lands and reads as a word
          somebody shouted. */}
      <a
        className="inline-block mb-[18px] border border-ink bg-ink px-[18px] py-[9px] font-mono text-[12px] tracking-[0.07em] uppercase text-paper-raised no-underline hover:bg-ink-soft hover:border-ink-soft"
        href={`/donate?from=${encodeURIComponent(from)}`}
      >
        Donate
      </a>
      <p className="m-0">Apologies for the temporary inconvenience.</p>
    </div>
  );
}
