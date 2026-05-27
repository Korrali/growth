import { requireOrgContext } from "@/lib/org-context";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { timeAgo } from "@/lib/utils";

const CATEGORY_VARIANTS: Record<string, string> = {
  INTERESTED: "success",
  NOT_NOW: "warning",
  OBJECTION: "warning",
  UNSUBSCRIBE: "default",
  WRONG_PERSON: "default",
  NEGATIVE: "destructive",
  BOUNCE: "destructive",
  AUTO_REPLY: "default",
  OTHER: "default",
};

export default async function InboxPage() {
  await requireOrgContext();

  const classifications = await prisma.replyClassification.findMany({
    orderBy: { priority: "desc" },
    take: 100,
    include: {
      message: {
        include: {
          contact: { include: { company: true } },
        },
      },
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Reply inbox</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {classifications.length} replies, sorted by priority
        </p>
      </div>

      <div className="space-y-3">
        {classifications.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              No replies yet.
            </CardContent>
          </Card>
        )}
        {classifications.map((c) => (
          <Card key={c.id}>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant={CATEGORY_VARIANTS[c.category] as never ?? "default"}>
                      {c.category}
                    </Badge>
                    <span className="text-xs text-muted-foreground">priority {c.priority}</span>
                    <span className="text-xs text-muted-foreground">{timeAgo(c.createdAt)}</span>
                  </div>
                  <p className="text-sm font-medium">
                    {c.message.contact.email}
                    {c.message.contact.company && (
                      <span className="text-muted-foreground ml-1">· {c.message.contact.company.name}</span>
                    )}
                  </p>
                  {c.message.subject && (
                    <p className="text-xs text-muted-foreground mt-0.5">{c.message.subject}</p>
                  )}
                  <p className="text-sm mt-2 text-foreground/80 line-clamp-3">{c.message.body}</p>
                </div>
              </div>
              {c.founderDraft && (
                <details className="mt-3">
                  <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                    Suggested reply
                  </summary>
                  <p className="mt-2 text-sm bg-muted rounded-md px-3 py-2 whitespace-pre-wrap">
                    {c.founderDraft}
                  </p>
                </details>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
