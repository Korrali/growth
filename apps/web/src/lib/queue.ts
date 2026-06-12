import { PgBoss } from "pg-boss";

export const QUEUE_NAMES = {
  OUTREACH_SEND:        "outreach.send",
  FIT_SCORE:            "fit.score",
  EMAIL_GENERATE:       "email.generate",
  REPLY_CLASSIFY:       "reply.classify",
  REPLY_AUTO_SEND:      "reply.auto-send",
  TRIAL_INTERVENTION:   "trial.intervention",
  WEEKLY_INSIGHTS:      "weekly.insights",
  CONTENT_GENERATE:     "content.generate",
  CONTENT_DISTRIBUTE:   "content.distribute",
  CALL_BRIEF:           "call.brief",
  CALL_FOLLOWUP:        "call.followup",
  COMPANY_DISCOVER:     "company.discover",
  CONTACT_FIND:         "contact.find",
  COMMUNITY_SCAN:       "community.scan",
  LINKEDIN_DRAFT:       "linkedin.draft",
  VISITOR_PROCESS:      "visitor.process",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export interface OutreachSendPayload {
  outreachId: string;
  stepNumber: number;
}

export interface FitScorePayload {
  companyId: string;
}

export interface EmailGeneratePayload {
  outreachId: string;
}

export interface ReplyClassifyPayload {
  messageId: string;
}

export interface TrialInterventionPayload {
  trialId: string;
  dayBucket: string;
  /** True = post-expiry win-back email instead of an activation intervention. */
  winback?: boolean;
}

export interface WeeklyInsightsPayload {
  weekOf: string; // ISO date string
}

export interface ContentGeneratePayload {
  type: string;
  sourceData: Record<string, unknown>;
}

export interface CallBriefPayload {
  callId: string;
}

export interface CallFollowupPayload {
  callId: string;
}

export interface ReplyAutoSendPayload {
  classificationId: string;
}

export interface CompanyDiscoverPayload {
  runId: string;
}

export interface ContactFindPayload {
  companyId: string;
}

let bossPromise: Promise<PgBoss> | null = null;

export function getBoss(): Promise<PgBoss> {
  if (bossPromise) return bossPromise;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL must be set for the queue to operate");
  }
  const boss = new PgBoss({ connectionString, schema: "pgboss" });
  bossPromise = boss.start().then(() => boss);
  return bossPromise;
}

export async function enqueueOutreachSend(
  payload: OutreachSendPayload,
  options?: { startAfter?: Date },
): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(QUEUE_NAMES.OUTREACH_SEND, payload, {
    singletonKey: `outreach-send-${payload.outreachId}-step${payload.stepNumber}`,
    retryLimit: 3,
    retryDelay: 60,
    expireInSeconds: 30 * 60,
    startAfter: options?.startAfter,
  });
}

export async function enqueueFitScore(
  payload: FitScorePayload,
): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(QUEUE_NAMES.FIT_SCORE, payload, {
    singletonKey: `fit-score-${payload.companyId}`,
    retryLimit: 2,
    retryDelay: 30,
    expireInSeconds: 10 * 60,
  });
}

export async function enqueueEmailGenerate(
  payload: EmailGeneratePayload,
): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(QUEUE_NAMES.EMAIL_GENERATE, payload, {
    singletonKey: `email-gen-${payload.outreachId}`,
    retryLimit: 2,
    retryDelay: 30,
    expireInSeconds: 10 * 60,
  });
}

export async function enqueueReplyClassify(
  payload: ReplyClassifyPayload,
): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(QUEUE_NAMES.REPLY_CLASSIFY, payload, {
    singletonKey: `reply-classify-${payload.messageId}`,
    retryLimit: 3,
    retryDelay: 15,
    expireInSeconds: 5 * 60,
  });
}

export async function enqueueTrialIntervention(
  payload: TrialInterventionPayload,
): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(QUEUE_NAMES.TRIAL_INTERVENTION, payload, {
    singletonKey: `trial-${payload.winback ? "winback" : "intervention"}-${payload.trialId}-${payload.dayBucket}`,
    retryLimit: 2,
    retryDelay: 60,
    expireInSeconds: 60 * 60,
  });
}

export async function enqueueWeeklyInsights(
  payload: WeeklyInsightsPayload,
): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(QUEUE_NAMES.WEEKLY_INSIGHTS, payload, {
    singletonKey: `weekly-insights-${payload.weekOf}`,
    retryLimit: 1,
    expireInSeconds: 60 * 60,
  });
}

export async function enqueueContentGenerate(
  payload: ContentGeneratePayload,
): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(QUEUE_NAMES.CONTENT_GENERATE, payload, {
    retryLimit: 2,
    retryDelay: 30,
    expireInSeconds: 10 * 60,
  });
}

export async function enqueueCallBrief(
  payload: CallBriefPayload,
): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(QUEUE_NAMES.CALL_BRIEF, payload, {
    singletonKey: `call-brief-${payload.callId}`,
    retryLimit: 2,
    retryDelay: 30,
    expireInSeconds: 10 * 60,
  });
}

export async function enqueueCallFollowup(
  payload: CallFollowupPayload,
): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(QUEUE_NAMES.CALL_FOLLOWUP, payload, {
    singletonKey: `call-followup-${payload.callId}`,
    retryLimit: 2,
    retryDelay: 30,
    expireInSeconds: 10 * 60,
  });
}

export async function enqueueReplyAutoSend(
  payload: ReplyAutoSendPayload,
  startAfter: Date,
): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(QUEUE_NAMES.REPLY_AUTO_SEND, payload, {
    singletonKey: `reply-auto-send-${payload.classificationId}`,
    retryLimit: 2,
    retryDelay: 30,
    expireInSeconds: 4 * 60 * 60, // expire after 4h — if it hasn't fired by then, skip
    startAfter,
  });
}

export async function enqueueContactFind(
  payload: ContactFindPayload,
): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(QUEUE_NAMES.CONTACT_FIND, payload, {
    singletonKey: `contact-find-${payload.companyId}`,
    retryLimit: 2,
    retryDelay: 60,
    expireInSeconds: 15 * 60,
  });
}

export async function enqueueCompanyDiscover(
  payload: CompanyDiscoverPayload,
): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(QUEUE_NAMES.COMPANY_DISCOVER, payload, {
    singletonKey: `company-discover-${payload.runId}`,
    retryLimit: 1,
    expireInSeconds: 30 * 60,
  });
}

export async function enqueueCommunityScan(): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(QUEUE_NAMES.COMMUNITY_SCAN, {}, {
    singletonKey: "community-scan",
    retryLimit: 1,
    retryDelay: 120,
    expireInSeconds: 20 * 60,
  });
}

export interface LinkedInDraftPayload {
  contactId: string;
}

export async function enqueueLinkedInDraft(
  payload: LinkedInDraftPayload,
): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(QUEUE_NAMES.LINKEDIN_DRAFT, payload, {
    singletonKey: `linkedin-draft-${payload.contactId}`,
    retryLimit: 2,
    retryDelay: 30,
    expireInSeconds: 10 * 60,
  });
}

export interface VisitorProcessPayload {
  ip: string;
  page: string;
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  sessionId?: string;
  orgName?: string;
}

export async function enqueueVisitorProcess(
  payload: VisitorProcessPayload,
): Promise<string | null> {
  const boss = await getBoss();
  // Deduplicate by IP within a 6-hour window to avoid hammering fit score for the same visitor
  const hourBucket = Math.floor(Date.now() / (6 * 60 * 60 * 1000));
  return boss.send(QUEUE_NAMES.VISITOR_PROCESS, payload, {
    singletonKey: `visitor-${payload.ip}-${hourBucket}`,
    retryLimit: 1,
    expireInSeconds: 10 * 60,
  });
}

export interface ContentDistributePayload {
  draftId: string;
}

export async function enqueueContentDistribute(
  payload: ContentDistributePayload,
): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(QUEUE_NAMES.CONTENT_DISTRIBUTE, payload, {
    singletonKey: `content-distribute-${payload.draftId}`,
    retryLimit: 2,
    retryDelay: 60,
    expireInSeconds: 60 * 60,
  });
}
