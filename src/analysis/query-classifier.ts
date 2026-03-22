/**
 * Query Classifier Module
 *
 * Classifies search queries by user intent using pattern-based rules.
 * Supports informational, transactional, navigational, investigational,
 * and problem-solving intents.
 */

/**
 * The detected intent category of a search query.
 */
export type QueryIntent =
  | 'informational'
  | 'transactional'
  | 'navigational'
  | 'investigational'
  | 'problem_solving';

/**
 * A search query annotated with its classified intent.
 */
export interface ClassifiedQuery {
  /** The original query string. */
  query: string;
  /** The primary detected intent. */
  intent: QueryIntent;
  /** A more specific sub-type (e.g., "how-to", "comparison", "pricing"). */
  subType?: string;
  /** Confidence score from 0 to 1. Higher values indicate a stronger signal. */
  confidence: number;
}

/**
 * Internal representation of a classification rule.
 */
interface ClassificationRule {
  intent: QueryIntent;
  subType?: string;
  /** Pattern tested against the lowercased query. */
  pattern: RegExp;
  /** Base confidence when this pattern matches. */
  confidence: number;
}

/**
 * Classification rules ordered by specificity (most specific first).
 * When multiple rules match, the first match wins.
 */
const CLASSIFICATION_RULES: readonly ClassificationRule[] = [
  // Problem solving (check before informational since "how to fix" could match both)
  { intent: 'problem_solving', subType: 'troubleshoot', pattern: /\b(troubleshoot|diagnose)\b/, confidence: 0.9 },
  { intent: 'problem_solving', subType: 'debug', pattern: /\b(debug|debugging)\b/, confidence: 0.9 },
  { intent: 'problem_solving', subType: 'fix', pattern: /\b(fix|repair|resolve)\b/, confidence: 0.85 },
  { intent: 'problem_solving', subType: 'error', pattern: /\b(error|errors|exception|crash|crashed)\b/, confidence: 0.85 },
  { intent: 'problem_solving', subType: 'issue', pattern: /\b(issue|issues|problem|problems)\b/, confidence: 0.75 },
  { intent: 'problem_solving', subType: 'fix', pattern: /\bnot working\b/, confidence: 0.9 },
  { intent: 'problem_solving', subType: 'fix', pattern: /\bsolve\b/, confidence: 0.8 },

  // Investigational (check before informational since "best way to" could match both)
  { intent: 'investigational', subType: 'comparison', pattern: /\b(vs\.?|versus|compared to|comparison)\b/, confidence: 0.9 },
  { intent: 'investigational', subType: 'alternative', pattern: /\b(alternative|alternatives|instead of|similar to)\b/, confidence: 0.85 },
  { intent: 'investigational', subType: 'review', pattern: /\b(review|reviews|rating|ratings)\b/, confidence: 0.85 },
  { intent: 'investigational', subType: 'best', pattern: /\b(best|top\s+\d+|top\s+ten)\b/, confidence: 0.8 },
  { intent: 'investigational', subType: 'recommendation', pattern: /\b(recommend|recommendation|suggestions?)\b/, confidence: 0.8 },

  // Transactional
  { intent: 'transactional', subType: 'purchase', pattern: /\b(buy|purchase|order|add to cart)\b/, confidence: 0.9 },
  { intent: 'transactional', subType: 'pricing', pattern: /\b(price|pricing|cost|how much)\b/, confidence: 0.85 },
  { intent: 'transactional', subType: 'deal', pattern: /\b(cheap|deal|deals|discount|sale|coupon|promo|voucher)\b/, confidence: 0.85 },
  { intent: 'transactional', subType: 'shopping', pattern: /\b(shop|shopping|store|checkout)\b/, confidence: 0.8 },
  { intent: 'transactional', subType: 'shipping', pattern: /\b(free shipping|delivery|shipping)\b/, confidence: 0.8 },
  { intent: 'transactional', subType: 'subscription', pattern: /\b(subscribe|subscription|plan|plans|tier)\b/, confidence: 0.75 },

  // Navigational
  { intent: 'navigational', subType: 'login', pattern: /\b(login|log in|sign in|signin|sign up|signup|register)\b/, confidence: 0.9 },
  { intent: 'navigational', subType: 'account', pattern: /\b(dashboard|account|my account|profile|settings)\b/, confidence: 0.85 },
  { intent: 'navigational', subType: 'contact', pattern: /\b(contact|support|help center|customer service)\b/, confidence: 0.8 },
  { intent: 'navigational', subType: 'download', pattern: /\b(download|install|app)\b/, confidence: 0.7 },

  // Informational
  { intent: 'informational', subType: 'how-to', pattern: /^how (to|do|does|can|should)\b/, confidence: 0.9 },
  { intent: 'informational', subType: 'definition', pattern: /^what (is|are|was|were|does)\b/, confidence: 0.9 },
  { intent: 'informational', subType: 'explanation', pattern: /^why (is|are|do|does|did|would|should)\b/, confidence: 0.9 },
  { intent: 'informational', subType: 'temporal', pattern: /^when (is|are|do|does|did|was|were|will)\b/, confidence: 0.9 },
  { intent: 'informational', subType: 'location', pattern: /^where (is|are|do|does|can|to)\b/, confidence: 0.9 },
  { intent: 'informational', subType: 'identity', pattern: /^who (is|are|was|were)\b/, confidence: 0.9 },
  { intent: 'informational', subType: 'guide', pattern: /\b(guide|tutorial|walkthrough|step by step)\b/, confidence: 0.85 },
  { intent: 'informational', subType: 'learning', pattern: /\b(learn|learning|understand|explained|explanation)\b/, confidence: 0.8 },
  { intent: 'informational', subType: 'definition', pattern: /\b(meaning|definition|define|what does .+ mean)\b/, confidence: 0.85 },
  { intent: 'informational', subType: 'example', pattern: /\b(example|examples|sample|template)\b/, confidence: 0.75 },
];

/**
 * Classifies a single search query by user intent.
 *
 * Uses a prioritized set of pattern-based rules. When no rule matches,
 * the query is classified as informational with low confidence. Single-word
 * queries that match no other rule are classified as navigational (likely
 * brand searches).
 *
 * @param query - The raw search query string.
 * @returns The classified query with intent, optional sub-type, and confidence.
 */
export function classifyQuery(query: string): ClassifiedQuery {
  const normalized = query.toLowerCase().trim();

  for (const rule of CLASSIFICATION_RULES) {
    if (rule.pattern.test(normalized)) {
      return {
        query,
        intent: rule.intent,
        subType: rule.subType,
        confidence: rule.confidence,
      };
    }
  }

  // Heuristic: single-word queries without other signals are often navigational
  // (brand searches like "github", "amazon", "netflix")
  const wordCount = normalized.split(/\s+/).length;
  if (wordCount === 1 && normalized.length > 2) {
    return {
      query,
      intent: 'navigational',
      subType: 'brand',
      confidence: 0.4,
    };
  }

  // Default: informational with low confidence
  return {
    query,
    intent: 'informational',
    confidence: 0.3,
  };
}

/**
 * Classifies an array of search queries by user intent.
 *
 * @param queries - An array of raw search query strings.
 * @returns An array of classified queries, one per input.
 */
export function classifyQueries(queries: readonly string[]): ClassifiedQuery[] {
  return queries.map(classifyQuery);
}

/**
 * Computes the distribution of intents across a set of classified queries.
 *
 * @param classified - An array of previously classified queries.
 * @returns A record mapping each intent to the count of queries with that intent.
 */
export function getIntentDistribution(
  classified: readonly ClassifiedQuery[]
): Record<QueryIntent, number> {
  const distribution: Record<QueryIntent, number> = {
    informational: 0,
    transactional: 0,
    navigational: 0,
    investigational: 0,
    problem_solving: 0,
  };

  for (const item of classified) {
    distribution[item.intent]++;
  }

  return distribution;
}
