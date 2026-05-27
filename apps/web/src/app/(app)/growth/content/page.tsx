import { requireOrgContext } from "@/lib/org-context";
import { prisma } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { approveContentAction } from "@/lib/actions/content";

export default async function ContentPage() {
  await requireOrgContext();

  const drafts = await prisma.contentDraft.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Content drafts</h1>
        <p className="mt-1 text-sm text-muted-foreground">{drafts.length} drafts</p>
      </div>

      <div className="space-y-4">
        {drafts.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              No content drafts yet. Generate from the settings page.
            </CardContent>
          </Card>
        )}
        {drafts.map((d) => (
          <Card key={d.id}>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="default">{d.type}</Badge>
                    <Badge variant={d.status === "approved" ? "success" : "warning"}>
                      {d.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{formatDate(d.createdAt)}</span>
                  </div>
                  {d.title && <p className="font-medium text-sm mb-1">{d.title}</p>}
                  <p className="text-sm text-foreground/80 line-clamp-4 whitespace-pre-wrap">{d.body}</p>
                </div>
                {d.status === "draft" && (
                  <form action={approveContentAction.bind(null, d.id)}>
                    <Button type="submit" variant="outline" size="sm">Approve</Button>
                  </form>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
