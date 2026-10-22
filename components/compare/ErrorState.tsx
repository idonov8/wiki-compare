"use client";

import { track } from "@/lib/analytics";
import { CONTACT_EMAIL, DONATE_URL, OUT_OF_CREDIT } from "@/lib/contact";

function OutOfCredit() {
  return (
    <p className="leading-[1.7]">
      Oh no, my AI account is out of credit! Sorry about that. Please{" "}
      <a
        href={DONATE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block mx-[2px] border border-ink px-[10px] py-[2px] font-mono text-[12px] tracking-[0.04em] text-ink no-underline transition-colors duration-[120ms] hover:bg-ink hover:text-paper-raised"
        onClick={() => track("donate_clicked", { from: "out_of_credit" })}
      >
        Donate
      </a>{" "}
      and send me a quick email at{" "}
      <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Wiki Compare is out of credit")}`} className="text-ink underline">
        {CONTACT_EMAIL}
      </a>
      , I&apos;m taking care of that ASAP!!
    </p>
  );
}

export default function ErrorState({ message }: { message: string }) {
  return (
    <div className="state error text-ink-soft py-[64px] pe-[24px] ps-[16px] max-w-[58ch] border-s-[3px] border-contradiction">
      <h2 className="font-display text-[27px] font-normal text-ink m-0 mb-[10px]">
        That didn&apos;t work
      </h2>
      {message === OUT_OF_CREDIT ? <OutOfCredit /> : <p>{message}</p>}
    </div>
  );
}
