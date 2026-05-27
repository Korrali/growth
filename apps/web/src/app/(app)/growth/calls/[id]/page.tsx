import { requireOrgContext } from "@/lib/org-context";
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { generateCallBriefAction, generateCallFollowupAction, saveCallNotesAction } from "@/lib/actions/calls";

interface Props { params: Promise<{ id: string }> }

export default async function CallDetailPage({ params }: Props) {
  await requireOrgContext();
  const { id } = await params;

  const call = await prisma.call.findUnique({
    where: { id },
    include: { contact: true, company: true },
  });

  if (!call) notFound();

  const contactName = [call.contact.firstName, call.contact.lastName].filter(Boolean).join(" ") || call.contact.email;

  async function saveNotes(formData: FormData) {
    "use server";
    const notes = formData.get("notes") as string;
    await saveCallNotesAction(id, notes);
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Call: {contactName}</h1>
        {call.company && <p className="text-sm text-muted-foreground">{call.company.name}</p>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Call brief</CardTitle>
            <form action={generateCallBriefAction.bind(null, id)}>
              <Button type="submit" variant="outline" size="sm">Generate brief</Button>
            </form>
          </CardHeader>
          <CardContent>
            {call.brief ? (
              <pre className="text-sm whitespace-pre-wrap font-sans">{call.brief}</pre>
            ) : (
              <p className="text-sm text-muted-foreground">No brief yet. Generate one above.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={saveNotes} className="space-y-3">
              <textarea
                name="notes"
                defaultValue={call.notes ?? ""}
                placeholder="Notes from the call…"
                rows={8}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
              />
              <Button type="submit" size="sm">Save notes</Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Follow-up</CardTitle>
          <form action={generateCallFollowupAction.bind(null, id)}>
            <Button type="submit" variant="outline" size="sm">Generate follow-up</Button>
          </form>
        </CardHeader>
        <CardContent>
          {call.followUpEmail ? (
            <div className="space-y-3">
              <pre className="text-sm whitespace-pre-wrap font-sans bg-muted rounded-md p-4">{call.followUpEmail}</pre>
              {call.actionItems.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground font-medium mb-1">Action items</p>
                  <ul className="text-sm space-y-1">
                    {call.actionItems.map((item, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-muted-foreground">·</span> {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {call.nextStep && (
                <p className="text-sm"><span className="text-muted-foreground">Next step:</span> {call.nextStep}</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Add call notes first, then generate follow-up.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
