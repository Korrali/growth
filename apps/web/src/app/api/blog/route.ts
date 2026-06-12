import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ContentType } from "@prisma/client";
import { MARKETED_PRODUCT_KEYS, type MarketedProduct } from "@/lib/products";

// GET /api/blog?product=TRUST|REVENUE|BILLCLEAR|MEDSCAN
// Public endpoint — consumed by each product's /blog page
export async function GET(req: NextRequest) {
  const product = req.nextUrl.searchParams.get("product")?.toUpperCase();
  if (!product || !MARKETED_PRODUCT_KEYS.includes(product as MarketedProduct)) {
    return NextResponse.json(
      { error: `product must be one of ${MARKETED_PRODUCT_KEYS.join(", ")}` },
      { status: 400 },
    );
  }

  const articles = await prisma.contentDraft.findMany({
    where: { type: ContentType.BLOG_POST, product, status: "posted" },
    select: {
      id: true, slug: true, title: true, metaDescription: true,
      targetKeyword: true, postedAt: true, createdAt: true,
    },
    orderBy: { postedAt: "desc" },
  });

  return NextResponse.json(articles, {
    headers: {
      "Cache-Control": "s-maxage=300, stale-while-revalidate=600",
      // Public read-only content; a comma-separated origin list is not valid CORS,
      // so serve it to any origin.
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET",
    },
  });
}
