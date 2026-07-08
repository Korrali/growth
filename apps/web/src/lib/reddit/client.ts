const UA = process.env.REDDIT_USER_AGENT ?? "";

if (UA && !UA.match(/^korrali-growth\/[0-9.]+ by u\/[a-zA-Z0-9_-]+$/)) {
  console.warn(
    "[reddit] REDDIT_USER_AGENT format may be rejected — expected: 'korrali-growth/1.0 by u/USERNAME'",
  );
}

export interface RedditPost {
  id: string;
  subreddit: string;
  title: string;
  selftext: string;
  url: string;
  permalink: string;
  author: string;
  score: number;
  num_comments: number;
  created_utc: number;
}

export type RedditTimeWindow = "hour" | "day" | "week" | "month" | "year" | "all";

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  // Token expires in 1 hour; refresh 30s before expiry
  if (cachedToken && Date.now() < cachedToken.expiresAt - 30_000) return cachedToken.value;

  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET not set");

  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": UA,
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`Reddit auth failed: ${res.status} ${await res.text().catch(() => "")}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

export async function searchSubreddit(
  subreddit: string,
  keyword: string,
  after?: string | null,
  limit = 25,
  time: RedditTimeWindow = "week",
): Promise<{ posts: RedditPost[]; nextCursor: string | null }> {
  const token = await getAccessToken();
  const params = new URLSearchParams({
    q: keyword,
    sort: "new",
    limit: String(limit),
    t: time,
    restrict_sr: "true",
    ...(after ? { after } : {}),
  });

  const res = await fetch(`https://oauth.reddit.com/r/${subreddit}/search?${params}`, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": UA },
  });

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("Retry-After") ?? "60", 10);
    throw new Error(`RATE_LIMITED:${retryAfter}`);
  }
  if (!res.ok) {
    throw new Error(`Reddit search error ${res.status}: ${await res.text().catch(() => "")}`);
  }

  const data = (await res.json()) as {
    data: { children: Array<{ data: RedditPost }>; after: string | null };
  };
  return {
    posts: data.data.children.map((c) => c.data),
    nextCursor: data.data.after,
  };
}
