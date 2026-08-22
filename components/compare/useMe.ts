"use client";

import { useCallback, useEffect, useState } from "react";
import type { MeResponse } from "@/lib/types";

/** The signed-in account and its credit, and the way to ask again once either
 *  has moved — spending on an article, or coming back from the donate page. */
export function useMe(): { me: MeResponse | null; refreshMe: () => void } {
  const [me, setMe] = useState<MeResponse | null>(null);

  const refreshMe = useCallback(() => {
    fetch("/api/me")
      .then((res) => res.json())
      .then((json) => setMe(json))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  return { me, refreshMe };
}
