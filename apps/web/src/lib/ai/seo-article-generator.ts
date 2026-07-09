import { prisma } from "@/lib/db";
import { anthropic } from "@/lib/ai/claude";
import { WRITING_MODEL } from "@/lib/ai/models";
import { ContentType } from "@prisma/client";
import type { SeoTopic } from "./seo-topic-analyzer";

import { PRODUCTS } from "@/lib/products";

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

export async function generateSeoArticle(topic: SeoTopic): Promise<string> {
  const ctx = PRODUCTS[topic.product];

  // Korrali Trust is a WORKFLOW tool, not a compliance/certification authority.
  // These articles auto-publish with no human review, so the positioning
  // doctrine has to live in the prompt — never let AI copy claim the product
  // makes anyone "compliant" or "certified".
  const positioningGuard =
    topic.product === "TRUST"
      ? `

CRITICAL positioning rules (Korrali Trust is a workflow tool, NOT a compliance or certification authority):
- NEVER claim the product makes anyone "compliant", "certified", "audit-ready", or that it guarantees/ensures compliance or passing an audit.
- NEVER position it as a substitute for an auditor, legal advice, or an official certification body.
- Use operational/workflow language only: "answer security questionnaires faster", "draft responses from your knowledge base", "map where you'd get stuck", "organise evidence", "prepare for a review".
- Educational explanation of SOC 2 / GDPR / etc. is fine; claiming THIS PRODUCT delivers compliance or certification is NOT.`
      : "";

  const response = await anthropic.messages.create({
    model: WRITING_MODEL,
    max_tokens: 4096,
    system: `You are a content writer specialising in SEO-optimised long-form articles. Your articles:
- Are 1,500–2,000 words, written for the product's actual audience (stated below)
- Use plain, direct language — no marketing fluff
- Include the target keyword naturally in: H1, first paragraph, 2-3 subheadings, and conclusion
- Structure: intro (problem), body (3-4 H2 sections with practical depth), conclusion + CTA
- Format in clean Markdown (H1, H2, H3 only — no bold emphasis spam)
- End with one soft CTA mentioning the product naturally, not as an ad
- Never mention competitor brand names${positioningGuard}`,
    messages: [
      {
        role: "user",
        content: `Write a full SEO article with these specs:

Target keyword: "${topic.targetKeyword}"
Title: ${topic.suggestedTitle}
Search intent: ${topic.searchIntent}
Product to mention: ${ctx.name} — ${ctx.oneLiner}
Audience: ${ctx.buyers}
CTA line: ${ctx.seoCta}

Write the complete article in Markdown now. Start directly with the H1.`,
      },
    ],
  });

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("No text in response");
  return block.text;
}

export async function saveArticleDraft(topic: SeoTopic, body: string): Promise<string> {
  const slug = slugify(topic.suggestedTitle);

  const draft = await prisma.contentDraft.upsert({
    where: { slug },
    create: {
      type: ContentType.BLOG_POST,
      title: topic.suggestedTitle,
      body,
      status: "draft",
      slug,
      metaDescription: topic.metaDescription,
      targetKeyword: topic.targetKeyword,
      product: topic.product,
    },
    update: {
      title: topic.suggestedTitle,
      body,
      status: "draft",
      metaDescription: topic.metaDescription,
      targetKeyword: topic.targetKeyword,
    },
  });

  return draft.id;
}
