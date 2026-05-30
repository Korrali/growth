"use client";

import { useState } from "react";
import { discoverSeoTopicsAction, generateSeoArticleAction } from "@/lib/actions/seo";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { SeoTopic } from "@/lib/ai/seo-topic-analyzer";

export function SeoTopicClient() {
  const [topics, setTopics] = useState<SeoTopic[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);

  async function handleDiscover() {
    setDiscovering(true);
    setError(null);
    try {
      const result = await discoverSeoTopicsAction();
      setTopics(result);
      setDiscovered(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDiscovered(true);
    } finally {
      setDiscovering(false);
    }
  }

  async function handleGenerate(topic: SeoTopic) {
    setGenerating(topic.targetKeyword);
    setGenerateError(null);
    try {
      await generateSeoArticleAction(JSON.stringify(topic));
      setDone((d) => [...d, topic.targetKeyword]);
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={handleDiscover}
          disabled={discovering}
          className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {discovering ? "Analysing community mentions…" : "Discover SEO topics"}
        </button>
        {topics.length > 0 && (
          <span className="text-sm text-muted-foreground">{topics.length} topics found</span>
        )}
      </div>

      {topics.length > 0 && (
        <div className="space-y-3">
          {topics.map((topic) => {
            const isDone = done.includes(topic.targetKeyword);
            const isGenerating = generating === topic.targetKeyword;
            return (
              <Card key={topic.targetKeyword}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={topic.product === "TRUST" ? "default" : "outline"}>
                          {topic.product}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {topic.sourceCount} community posts
                        </span>
                      </div>
                      <p className="text-sm font-medium">{topic.suggestedTitle}</p>
                      <p className="text-xs text-muted-foreground">
                        Keyword: <span className="font-mono">{topic.targetKeyword}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">{topic.searchIntent}</p>
                    </div>
                    <div className="shrink-0">
                      {isDone ? (
                        <span className="text-xs text-green-600 font-medium">Draft saved ✓</span>
                      ) : (
                        <button
                          onClick={() => handleGenerate(topic)}
                          disabled={isGenerating || !!generating}
                          className="inline-flex items-center rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
                        >
                          {isGenerating ? "Writing…" : "Generate article"}
                        </button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {error && (
        <p className="text-sm text-red-600 font-mono break-all border border-red-200 rounded p-2 bg-red-50">
          Error: {error}
        </p>
      )}
      {generateError && (
        <p className="text-sm text-red-600 font-mono break-all border border-red-200 rounded p-2 bg-red-50">
          Generate error: {generateError}
        </p>
      )}
      {topics.length === 0 && !discovering && !discovered && (
        <p className="text-sm text-muted-foreground">
          Click "Discover SEO topics" to analyse community mentions and surface article opportunities.
        </p>
      )}
      {topics.length === 0 && !discovering && discovered && !error && (
        <p className="text-sm text-muted-foreground">
          No topics returned — try again or run a community scan first to populate mentions.
        </p>
      )}
    </div>
  );
}
