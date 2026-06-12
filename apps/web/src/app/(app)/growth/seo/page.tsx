import { requireOrgContext } from "@/lib/org-context";
import { prisma } from "@/lib/db";
import { PRODUCTS, type MarketedProduct } from "@/lib/products";
import { ContentType } from "@prisma/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { publishArticleAction, unpublishArticleAction } from "@/lib/actions/seo";
import { SeoTopicClient } from "./SeoTopicClient";
import { formatDate } from "@/lib/utils";

export default async function SeoPage() {
  await requireOrgContext();

  const articles = await prisma.contentDraft.findMany({
    where: { type: ContentType.BLOG_POST },
    orderBy: { createdAt: "desc" },
  });

  const published = articles.filter((a) => a.status === "posted");
  const drafts = articles.filter((a) => a.status !== "posted");

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">SEO Content</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {published.length} published · {drafts.length} drafts — articles are served at
          trust.korrali.com/blog and revenue.korrali.com/blog
        </p>
      </div>

      {/* Topic discovery */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Discover topics from community mentions
        </h2>
        <SeoTopicClient />
      </section>

      {/* Draft articles */}
      {drafts.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Drafts
          </h2>
          {drafts.map((a) => (
            <Card key={a.id}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {a.product && <Badge variant="outline">{a.product}</Badge>}
                      {a.targetKeyword && (
                        <span className="text-xs font-mono text-muted-foreground">{a.targetKeyword}</span>
                      )}
                      <span className="text-xs text-muted-foreground">{formatDate(a.createdAt)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{a.title}</p>
                      <a href={`/growth/seo/preview/${a.id}`} className="text-xs text-blue-600 hover:underline shrink-0">
                        Preview ↗
                      </a>
                    </div>
                    {a.metaDescription && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{a.metaDescription}</p>
                    )}
                    <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">
                      {a.body.slice(0, 300)}…
                    </p>
                  </div>
                  <form action={publishArticleAction.bind(null, a.id)} className="shrink-0">
                    <button
                      type="submit"
                      className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                    >
                      Publish
                    </button>
                  </form>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {/* Published articles */}
      {published.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Published
          </h2>
          {published.map((a) => (
            <Card key={a.id} className="border-green-200">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {a.product && <Badge variant="default">{a.product}</Badge>}
                      <a
                        href={`/growth/seo/preview/${a.id}`}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Preview ↗
                      </a>
                      {a.slug && (
                        <a
                          href={`${PRODUCTS[a.product as MarketedProduct]?.url ?? "https://korrali.com"}/blog/${a.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-muted-foreground hover:underline"
                        >
                          Live site ↗
                        </a>
                      )}
                      <span className="text-xs text-muted-foreground">
                        Published {a.postedAt ? formatDate(a.postedAt) : ""}
                      </span>
                    </div>
                    <p className="text-sm font-medium">{a.title}</p>
                    {a.targetKeyword && (
                      <p className="text-xs font-mono text-muted-foreground">{a.targetKeyword}</p>
                    )}
                  </div>
                  <form action={unpublishArticleAction.bind(null, a.id)} className="shrink-0">
                    <button
                      type="submit"
                      className="inline-flex items-center rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
                    >
                      Unpublish
                    </button>
                  </form>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {articles.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No articles yet. Discover topics above to get started.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
