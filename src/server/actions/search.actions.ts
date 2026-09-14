"use server";

import { requireUserAction } from "@/server/auth/guard";
import { safeAction } from "@/server/errors";
import { globalSearch, searchSuggestions } from "@/server/services/search.service";
import type { ActionResult, GlobalSearchResult } from "@/types";

export async function globalSearchAction(query: string): Promise<ActionResult<GlobalSearchResult>> {
  return safeAction(async () => {
    await requireUserAction();
    return globalSearch(query, 5);
  });
}

export async function searchSuggestionsAction(
  query: string,
): Promise<ActionResult<Awaited<ReturnType<typeof searchSuggestions>>>> {
  return safeAction(async () => {
    await requireUserAction();
    return searchSuggestions(query, 8);
  });
}
