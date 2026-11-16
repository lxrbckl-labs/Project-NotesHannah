import { REFERENCE_SITES, type ReferenceSite, siteSearchUrl } from "@notes/schema";

/**
 * The outside reference sites the app knows by name. The data lives in `@notes/schema`
 * (REFERENCE_SITES) so the web app and the agents read the same list; the References page draws
 * a card for each entry, so another site is one more entry there and no new screen code.
 */
export interface BuiltInResource extends ReferenceSite {
  /** Their search for some words, or null when the site has no search address. */
  searchUrl: ((words: string) => string) | null;
}

export const BUILT_IN_RESOURCES: readonly BuiltInResource[] = REFERENCE_SITES.map((site) => ({
  ...site,
  searchUrl: site.searchPattern ? (words: string) => siteSearchUrl(site, words) : null,
}));

export const PHARMGUIDES = BUILT_IN_RESOURCES.find(
  (r) => r.id === "pharmguides",
) as BuiltInResource;

/** The built-in site an address is on, or undefined. */
export function resourceForUrl(url: string): BuiltInResource | undefined {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  return BUILT_IN_RESOURCES.find((r) => r.hosts.includes(host));
}

/** Address of PharmGuides' search for some words (used by search, concepts and the card). */
export function pharmGuidesSearch(words: string): string {
  return siteSearchUrl(PHARMGUIDES, words);
}
