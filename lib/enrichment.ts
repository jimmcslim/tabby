/**
 * "Enrichment" is everything a snapshot sync kicks off *besides* writing tab
 * rows: OG image fetches, tweet lookups, and the Ollama classify/summarize
 * pass. All of it is fire-and-forget, and all of it talks to the network —
 * which makes a sync non-deterministic and offline-hostile, exactly wrong for
 * the end-to-end harness in `tests/`.
 *
 * Set `TABBY_DISABLE_ENRICHMENT=1` to suppress it. Nothing else changes: the
 * tab, session and group writes a sync performs are untouched, only the
 * background follow-up work is skipped.
 */
export function isEnrichmentDisabled(): boolean {
  const flag = process.env.TABBY_DISABLE_ENRICHMENT
  return flag === "1" || flag === "true"
}
