import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ContentType } from "@prisma/client";
import { isReservedSlug } from "@/lib/content-slugs";

// GET /api/blog/:slug — returns full article body
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  // Internal machinery rows live in this table too — never serve them as posts.
  if (isReservedSlug(slug)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const article = await prisma.contentDraft.findFirst({
    where: { slug, type: ContentType.BLOG_POST, status: "posted" },
    select: {
      id: true, slug: true, title: true, body: true,
      metaDescription: true, targetKeyword: true, product: true,
      postedAt: true, createdAt: true,
    },
  });

  if (!article) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(article, {
    headers: { "Cache-Control": "s-maxage=600, stale-while-revalidate=1200" },
  });
}
