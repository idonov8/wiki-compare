"use client";

import { useCallback, useEffect, useState } from "react";
import { creditsExplained, markCreditsExplained } from "../CreditsModal";
import type { Phase } from "./types";
import type { MeResponse } from "@/lib/types";

/**
 * The credit explainer, shown once over the first article a new account opens —
 * whether they searched their way to it or were sent back to it by the login
 * redirect. On the article, not on arrival: the modal's button spends credit on
 * the page under it, so it waits for there to be a page under it.
 */
export function useCreditsExplainer(me: MeResponse | null, phase: Phase) {
  const [explaining, setExplaining] = useState(false);

  useEffect(() => {
    if (!me?.newcomer || creditsExplained()) return;
    if (phase !== "comparing" && phase !== "done") return;
    setExplaining(true);
  }, [me, phase]);

  const dismiss = useCallback(() => {
    markCreditsExplained();
    setExplaining(false);
  }, []);

  return { explaining, dismiss };
}
