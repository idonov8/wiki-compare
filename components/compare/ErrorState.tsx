"use client";

export default function ErrorState({ message }: { message: string }) {
  return (
    <div className="state error text-ink-soft py-[64px] pe-[24px] ps-[16px] max-w-[58ch] border-s-[3px] border-contradiction">
      <h2 className="font-display text-[27px] font-normal text-ink m-0 mb-[10px]">
        That didn&apos;t work
      </h2>
      <p>{message}</p>
    </div>
  );
}
