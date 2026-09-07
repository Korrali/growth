// ContentDraft doubles as a scratch table for the content engine's own
// machinery, not just articles. Anything whose slug starts with "__" is
// internal and must never reach a product's public blog.
//
// This is not hypothetical: the SEO topic cache was flipped to "posted" and
// went live as https://trust.korrali.com/blog/__seo_topics__ — a page of raw
// JSON with targetKeyword fields, listed in the blog index and the sitemap.
// Filtering on status alone was not enough, so the public read paths filter on
// the slug shape too.

export const RESERVED_SLUG_PREFIX = "__";

/** Well-known ContentDraft holding the cached SEO topic queue as a JSON blob. */
export const SEO_TOPIC_CACHE_SLUG = "__seo_topics__";

export function isReservedSlug(slug: string): boolean {
  return slug.startsWith(RESERVED_SLUG_PREFIX);
}
