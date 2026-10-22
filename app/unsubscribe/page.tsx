import Link from "next/link";
import { MEASURE } from "@/components/landing/Section";

export const metadata = {
  title: "Unsubscribe — Wiki Compare",
  robots: { index: false },
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { token, done, unknown } = await searchParams;
  const message = done
    ? "You're off the list. No more updates will be sent to you."
    : unknown
      ? "That link doesn't match anyone on the list. You may already be unsubscribed."
      : typeof token === "string"
        ? null
        : "This page needs the link from an update email.";

  return (
    <main className="px-[24px] py-[76px] max-tight:px-[18px] max-tight:py-[48px]">
      <div className={MEASURE}>
        <Link
          href="/"
          className="font-mono text-[11px] tracking-[0.09em] uppercase text-ink-soft no-underline hover:text-ink"
        >
          ← Wiki Compare
        </Link>
        <h1 className="mt-[28px] mb-[18px] font-display font-normal text-[clamp(30px,4vw,42px)] leading-[1.05] tracking-[-0.01em] text-ink">
          Project updates
        </h1>
        {message ? (
          <p className="m-0 text-[15px] leading-[1.7] text-ink">{message}</p>
        ) : (
          <form method="post" action="/api/unsubscribe" className="grid gap-[16px] justify-items-start">
            <p className="m-0 text-[15px] leading-[1.7] text-ink">Stop receiving updates about Wiki Compare?</p>
            <input type="hidden" name="token" value={token as string} />
            <button
              type="submit"
              className="py-[8px] px-[16px] font-mono text-[12px] tracking-[0.04em] bg-ink text-paper-raised border border-ink cursor-pointer hover:opacity-[0.82]"
            >
              Unsubscribe
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
