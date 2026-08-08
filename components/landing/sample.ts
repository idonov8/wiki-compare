import type { Claim, Lang } from "@/lib/types";

/**
 * The one comparison the landing page shows before anybody has run one.
 *
 * It is static on purpose. The `demo:` fixture route that drives the same
 * example in development is gated to non-production (`app/api/articles`,
 * `app/api/compare`), so a landing page that fetched it would render an empty
 * section on the deployed site — the one place it actually has to work. Static
 * also means the section costs nothing: no request, no tokens, no wait.
 *
 * EVERY STRING BELOW IS VERBATIM. The excerpts are exact substrings of the
 * recorded article text in `fixtures/palestinian-legislative-council.json`, and
 * the summary and explanation are copied from the `framing` draft in
 * `fixtures/demo.ts`. The whole argument of this section is that these are real
 * sentences from real articles; an editor who rewords them for flow destroys
 * that, and the `mark` substrings below would stop matching besides.
 *
 * To re-derive them after a fixture refresh:
 *
 *   npx tsx -e 'import {demoComparison} from "./fixtures/demo"; \
 *     console.log(JSON.stringify(demoComparison("palestinian-legislative-council").claims, null, 2))'
 */

export interface SampleExcerpt {
  lang: Lang;
  /** Verbatim run of article text — no ellipses, no tidying. */
  text: string;
  /** Verbatim substring of `text` that carries the mark. */
  mark: string;
  /** Set when `text` picks up mid-sentence, so the column can print the
   *  leading ellipsis rather than smuggling one into the quotation. */
  elided?: boolean;
}

export interface Sample {
  /** The article this was lifted from, so the section can link into it. */
  title: string;
  /** Language the title above is written in — what `comparePath` needs. */
  lang: Lang;
  type: Claim["type"];
  summary: string;
  explanation: string;
  excerpts: SampleExcerpt[];
}

/**
 * A framing difference rather than a contradiction, deliberately: a
 * contradiction over a seat count is the easier thing to show and the smaller
 * point. Three encyclopaedias describing the same electoral districts and
 * placing them in three differently-named territories is the thing a reader
 * cannot get by reading any one of them, which is what this site is for.
 */
export const SAMPLE: Sample = {
  title: "Palestinian Legislative Council",
  lang: "en",
  type: "framing",
  summary: "Districts named differently",
  explanation:
    "Hebrew places the electoral districts in Judea and Samaria, English in the West Bank, and Arabic in the West Bank including East Jerusalem.",
  excerpts: [
    {
      lang: "en",
      text: "elected by the Palestinian residents of the Palestinian territories of the West Bank and Gaza Strip.",
      mark: "West Bank",
      elided: true,
    },
    {
      lang: "he",
      text: "במועצה המחוקקת יש 132 מושבים, שנבחרים ב-16 מחוזות בחירה ביהודה ושומרון ורצועת עזה.",
      mark: "ביהודה ושומרון",
    },
    {
      lang: "ar",
      text: "وبذلك تم الاتفاق على إنشاء مجلس يتم انتخابه من الفلسطينيين القاطنين في الضفة الغربية وقطاع غزة.",
      mark: "الضفة الغربية",
    },
  ],
};

/** What each marked phrase actually says, for the reader who cannot read all
 *  three scripts — which is the reader this site exists for. */
export const GLOSS: Record<Lang, string> = {
  en: "“the West Bank”",
  he: "“Judea and Samaria”",
  ar: "“the West Bank”",
};
