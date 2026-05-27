import { PgBoss } from "pg-boss";

export const QUEUE_NAMES = {
  OUTREACH_SEND:        "outreach.send",
  FIT_SCORE:            "fit.score",
  EMAIL_GENERATE:       "email.generate",
  REPLY_CLASSIFY:       "reply.classify",
  TRIAL_INTERVENTION:   "trial.intervention",
  WEEKLY_INSIGHTS:      "weekly.insights",
  CONTENT_GENERATE:     "content.generate",
  CALL_BRIEF:           "call.brief",
  CALL_FOLLOWUP:        "call.followup",
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
    singletonKey: `trial-intervention-${payload.trialId}-${payload.dayBucket}`,
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
