import { requireOrgContext } from "@/lib/org-context";
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Props { params: Promise<{ id: string }> }

export default async function ContactDetailPage({ params }: Props) {
  await requireOrgContext();
  const { id } = await params;

  const contact = await prisma.contact.findUnique({
    where: { id },
    include: {
      company: true,
      outreaches: { include: { campaign: true }, orderBy: { createdAt: "desc" }, take: 10 },
    },
  });

  if (!contact) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          {[contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.email}
        </h1>
        <p className="text-sm text-muted-foreground font-mono">{contact.email}</p>
        {contact.title && <p className="text-sm text-muted-foreground">{contact.title}</p>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-2">
            <p><span className="text-muted-foreground">Company:</span> {contact.company?.name ?? "—"}</p>
            <p><span className="text-muted-foreground">Email status:</span> <Badge variant="default">{contact.emailStatus}</Badge></p>
            {contact.suppressedAt && (
              <p><span className="text-muted-foreground">Suppressed:</span> {contact.suppressedAt.toLocaleDateString()} ({contact.suppressReason})</p>
            )}
            {contact.buyerPersona && <p><span className="text-muted-foreground">Persona:</span> {contact.buyerPersona}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Outreaches ({contact.outreaches.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            {contact.outreaches.length === 0 ? (
              <p className="px-6 pb-6 text-sm text-muted-foreground">No outreaches.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {contact.outreaches.map((o) => (
                    <tr key={o.id} className="border-t border-border">
                      <td className="px-6 py-2">{o.campaign.name}</td>
                      <td className="px-4 py-2"><Badge variant="default">{o.status}</Badge></td>
                      <td className="px-4 py-2 text-muted-foreground text-xs">step {o.currentStep}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
