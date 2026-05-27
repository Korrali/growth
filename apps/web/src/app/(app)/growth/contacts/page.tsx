import { requireOrgContext } from "@/lib/org-context";
import { prisma } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

export default async function ContactsPage() {
  await requireOrgContext();

  const contacts = await prisma.contact.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { company: { select: { name: true } } },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Contacts</h1>
        <p className="mt-1 text-sm text-muted-foreground">{contacts.length} total</p>
      </div>

      <Card>
        <CardContent className="p-0">
          {contacts.length === 0 ? (
            <p className="px-6 py-8 text-sm text-muted-foreground text-center">No contacts yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-6 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Name / Title</th>
                  <th className="px-4 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-6 py-2.5">
                      <Link href={`/growth/contacts/${c.id}`} className="hover:underline font-mono text-xs">
                        {c.email}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      {[c.firstName, c.lastName].filter(Boolean).join(" ") || "—"}
                      {c.title && <span className="text-muted-foreground ml-1 text-xs">· {c.title}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {c.company?.name ?? "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      {c.suppressedAt ? (
                        <Badge variant="destructive">Suppressed</Badge>
                      ) : (
                        <Badge variant="default">{c.emailStatus}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
