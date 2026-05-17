// ── Stop words ─────────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "a","about","above","after","again","against","all","am","an","and","any","are","aren't",
  "as","at","be","because","been","before","being","below","between","both","but","by",
  "can't","cannot","could","couldn't","did","didn't","do","does","doesn't","doing","don't",
  "down","during","each","few","for","from","further","get","got","had","hadn't","has",
  "hasn't","have","haven't","having","he","he'd","he'll","he's","her","here","here's",
  "hers","herself","him","himself","his","how","how's","i","i'd","i'll","i'm","i've","if",
  "in","into","is","isn't","it","it's","its","itself","just","let's","me","more","most",
  "mustn't","my","myself","no","nor","not","of","off","on","once","only","or","other",
  "ought","our","ours","ourselves","out","over","own","same","shan't","she","she'd",
  "she'll","she's","should","shouldn't","so","some","such","than","that","that's","the",
  "their","theirs","them","themselves","then","there","there's","these","they","they'd",
  "they'll","they're","they've","this","those","through","to","too","under","until","up",
  "very","was","wasn't","we","we'd","we'll","we're","we've","were","weren't","what",
  "what's","when","when's","where","where's","which","while","who","who's","whom","why",
  "why's","will","with","won't","would","wouldn't","you","you'd","you'll","you're","you've",
  "your","yours","yourself","yourselves","also","really","think","know","go","going","like",
  "well","still","back","feel","feeling","got","want","need","make","made","now","day","time",
  "little","much","many","one","two","three","said","say","says","way","good","great",
  "new","old","long","big","small","right","wrong","even","first","last","next","thing",
  "things","something","everything","nothing","lot","lots","bit","bit","kind","sort","type",
  "used","use","using","take","taken","taking","see","seen","seeing","come","came","coming",
  "give","given","giving","tell","told","telling","find","found","finding","try","tried",
  "trying","put","puts","putting","look","looked","looking","keep","kept","keeping",
  "let","lets","letting","start","started","starting","end","ended","ending","seem",
  "seemed","seeming","show","showed","showing","hear","heard","hearing","ask","asked",
  "asking","turn","turned","turning","move","moved","moving","might","could","would","should",
]);

// ── AFINN-lite sentiment lexicon (selected high-signal words) ─────────────────

const SENTIMENT: Record<string, number> = {
  // Positive
  love:5, wonderful:5, amazing:5, fantastic:5, excellent:5, brilliant:5, joy:5, happy:4,
  happiness:4, beautiful:4, grateful:4, gratitude:4, inspired:4, peaceful:4, excited:4,
  thrilled:4, delight:4, delighted:4, awesome:4, energized:4, hopeful:4,
  motivated:4, proud:4, calm:3, clear:3, creative:3, fun:3, great:3, good:3, nice:3,
  okay:2, fine:2, pleasant:2, steady:2, positive:3, productive:3, refreshed:3,
  relaxed:3, satisfied:3, confident:3,
  // Negative
  sad:-3, unhappy:-3, depressed:-4, anxious:-3, anxiety:-3, fear:-3, afraid:-3,
  angry:-3, anger:-3, frustrated:-3, frustration:-3, terrible:-4, awful:-4, horrible:-4,
  hate:-4, disgusting:-3, disgusted:-3, miserable:-4, lonely:-3, alone:-2,
  tired:-2, exhausted:-3, overwhelmed:-3, stuck:-2, lost:-2, confused:-2,
  worried:-3, nervous:-3, stressed:-3, stress:-3, difficult:-2, hard:-1, bad:-2,
  worse:-2, worst:-3, fail:-2, failed:-2, failure:-3, wrong:-2, broken:-3,
  empty:-2, numb:-2, dark:-2, heavy:-2, pain:-3, hurt:-2, cry:-2, crying:-2,
  scared:-3, hopeless:-4, meaningless:-4,
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SessionRecord {
  path: string;
  created: string;   // ISO string
  wordCount: number;
  tokens: string[];
  sentiment: number; // −5 to +5 (normalised)
  folder: string;    // "journal" | "stream" | "morning-pages" | "book"
}

export interface TopicCluster {
  keywords: string[];
  sessionCount: number;
  sessions: string[];  // paths
}

export interface AnalysisResult {
  sessions: SessionRecord[];
  totalWords: number;
  avgSessionWords: number;
  longestStreak: number;
  currentStreak: number;
  topTokens: [string, number][];       // [word, count] sorted desc
  nounPhrases: [string, number][];     // [phrase, score] sorted desc
  sentimentByDay: [string, number][];  // [YYYY-MM-DD, score]
  positiveWords: string[];
  negativeWords: string[];
  topics: TopicCluster[];
  computed: number;                    // Date.now()
}

// ── Text cleaning ─────────────────────────────────────────────────────────────

function stripFrontmatter(content: string): string {
  return content.replace(/^---[\s\S]*?---\n?/, "");
}

function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s/g, " ")
    .replace(/\*{1,3}/g, "")
    .replace(/[_~`]/g, "");
}

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^['-]+|['-]+$/g, ""))
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

// ── Frontmatter extraction ─────────────────────────────────────────────────────

function extractCreated(content: string): string {
  const m = content.match(/^---[\s\S]*?created:\s*([^\n]+)/);
  return m ? m[1].trim() : new Date().toISOString();
}

// ── Sentiment scoring ──────────────────────────────────────────────────────────

function scoreSentiment(tokens: string[]): number {
  if (tokens.length === 0) return 0;
  let total = 0;
  let hits = 0;
  for (const t of tokens) {
    const s = SENTIMENT[t];
    if (s !== undefined) { total += s; hits++; }
  }
  if (hits === 0) return 0;
  // Normalise to −5..5
  return Math.max(-5, Math.min(5, total / Math.max(1, hits)));
}

// ── Noun phrase extraction (bigram / trigram) ──────────────────────────────────

export function extractNounPhrases(sessions: SessionRecord[]): [string, number][] {
  const phraseCount: Map<string, number> = new Map();
  const docCount: Map<string, number> = new Map();
  const N = sessions.length;

  for (const s of sessions) {
    const seen = new Set<string>();
    const tokens = s.tokens;
    for (let i = 0; i < tokens.length - 1; i++) {
      for (let len = 2; len <= 3 && i + len <= tokens.length; len++) {
        const phrase = tokens.slice(i, i + len).join(" ");
        phraseCount.set(phrase, (phraseCount.get(phrase) ?? 0) + 1);
        if (!seen.has(phrase)) { docCount.set(phrase, (docCount.get(phrase) ?? 0) + 1); seen.add(phrase); }
      }
    }
  }

  const scored: [string, number][] = [];
  for (const [phrase, count] of phraseCount) {
    if (count < 2) continue; // must appear at least twice
    const df = docCount.get(phrase) ?? 1;
    const idf = Math.log((N + 1) / (df + 1));
    scored.push([phrase, count * idf]);
  }

  return scored.sort((a, b) => b[1] - a[1]).slice(0, 50);
}

// ── Topic clustering (cosine similarity on top tokens) ────────────────────────

export function buildTopicClusters(sessions: SessionRecord[]): TopicCluster[] {
  if (sessions.length < 3) return [];

  // Build global vocabulary (top 200 words by frequency)
  const freq: Map<string, number> = new Map();
  for (const s of sessions) {
    for (const t of s.tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  const vocab = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 200)
    .map(([w]) => w);
  const vocabIndex = new Map(vocab.map((w, i) => [w, i]));

  // Build TF vectors per session
  const vectors: number[][] = sessions.map((s) => {
    const vec = new Array(vocab.length).fill(0);
    for (const t of s.tokens) {
      const i = vocabIndex.get(t);
      if (i !== undefined) vec[i]++;
    }
    // Normalise
    const mag = Math.sqrt(vec.reduce((a, v) => a + v * v, 0)) || 1;
    return vec.map((v) => v / mag);
  });

  // Simple greedy clustering: seed with first unclustered session, assign others if similarity > threshold
  const assigned = new Array(sessions.length).fill(-1);
  const clusters: TopicCluster[] = [];
  const THRESHOLD = 0.25;

  for (let i = 0; i < sessions.length; i++) {
    if (assigned[i] !== -1) continue;
    const clusterIdx = clusters.length;
    assigned[i] = clusterIdx;
    const members = [i];

    for (let j = i + 1; j < sessions.length; j++) {
      if (assigned[j] !== -1) continue;
      const sim = cosine(vectors[i], vectors[j]);
      if (sim > THRESHOLD) { assigned[j] = clusterIdx; members.push(j); }
    }

    // Find top keywords for this cluster
    const kw: Map<string, number> = new Map();
    for (const idx of members) {
      for (const t of sessions[idx].tokens) {
        kw.set(t, (kw.get(t) ?? 0) + 1);
      }
    }
    const keywords = [...kw.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w]) => w);

    clusters.push({
      keywords,
      sessionCount: members.length,
      sessions: members.map((idx) => sessions[idx].path),
    });

    if (clusters.length >= 8) break;
  }

  return clusters.filter((c) => c.sessionCount >= 2).sort((a, b) => b.sessionCount - a.sessionCount);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // already normalised
}

// ── Streak calculation ────────────────────────────────────────────────────────

function computeStreaks(dates: string[]): { current: number; longest: number } {
  if (dates.length === 0) return { current: 0, longest: 0 };

  const unique = [...new Set(dates.map((d) => d.slice(0, 10)))].sort();
  let current = 1, longest = 1, run = 1;

  for (let i = 1; i < unique.length; i++) {
    const prev = new Date(unique[i - 1]);
    const curr = new Date(unique[i]);
    const diff = (curr.getTime() - prev.getTime()) / 86400000;
    if (diff === 1) { run++; longest = Math.max(longest, run); }
    else run = 1;
  }

  // Check if streak includes today
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const last = unique[unique.length - 1];
  current = (last === today || last === yesterday) ? run : 0;

  return { current, longest };
}

// ── Derive aggregated stats from an already-tokenised session list ────────────
// Used by InsightsView when filtering by writing mode — tokenisation is already
// done, so this is just aggregation (fast, synchronous).

export function computeFromSessions(sessions: SessionRecord[]): Omit<AnalysisResult, "computed"> {
  const totalWords = sessions.reduce((a, s) => a + s.wordCount, 0);
  const avgSessionWords = sessions.length ? Math.round(totalWords / sessions.length) : 0;

  const freq: Map<string, number> = new Map();
  for (const s of sessions) {
    for (const t of s.tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  const topTokens = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80) as [string, number][];

  const sentByDay: Map<string, number[]> = new Map();
  for (const s of sessions) {
    const day = s.created.slice(0, 10);
    if (!sentByDay.has(day)) sentByDay.set(day, []);
    sentByDay.get(day)!.push(s.sentiment);
  }
  const sentimentByDay: [string, number][] = [...sentByDay.entries()]
    .map(([d, scores]) => [d, scores.reduce((a, v) => a + v, 0) / scores.length] as [string, number])
    .sort((a, b) => a[0].localeCompare(b[0]));

  const posWords = [...freq.entries()]
    .filter(([w]) => (SENTIMENT[w] ?? 0) >= 3)
    .sort((a, b) => b[1] - a[1]).slice(0, 20).map(([w]) => w);
  const negWords = [...freq.entries()]
    .filter(([w]) => (SENTIMENT[w] ?? 0) <= -2)
    .sort((a, b) => b[1] - a[1]).slice(0, 20).map(([w]) => w);

  const { current, longest } = computeStreaks(sessions.map((s) => s.created));

  return {
    sessions,
    totalWords,
    avgSessionWords,
    longestStreak: longest,
    currentStreak: current,
    topTokens,
    nounPhrases: extractNounPhrases(sessions),
    sentimentByDay,
    positiveWords: posWords,
    negativeWords: negWords,
    topics: buildTopicClusters(sessions),
  };
}

// ── Main analysis entry point ─────────────────────────────────────────────────

export async function analyseVault(
  allFiles: { path: string; content: string; folder: string }[]
): Promise<AnalysisResult> {
  const sessions: SessionRecord[] = [];

  for (const { path, content, folder } of allFiles) {
    const body = stripMarkdown(stripFrontmatter(content));
    const tokens = tokenise(body);
    const wc = body.trim() === "" ? 0 : body.trim().split(/\s+/).length;
    if (wc === 0) continue; // skip daily-index and empty files
    sessions.push({
      path,
      created: extractCreated(content),
      wordCount: wc,
      tokens,
      sentiment: scoreSentiment(tokens),
      folder,
    });
  }

  const totalWords = sessions.reduce((a, s) => a + s.wordCount, 0);
  const avgSessionWords = sessions.length ? Math.round(totalWords / sessions.length) : 0;

  // Top tokens globally
  const freq: Map<string, number> = new Map();
  for (const s of sessions) {
    for (const t of s.tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  const topTokens = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80) as [string, number][];

  // Sentiment by day
  const sentByDay: Map<string, number[]> = new Map();
  for (const s of sessions) {
    const day = s.created.slice(0, 10);
    if (!sentByDay.has(day)) sentByDay.set(day, []);
    sentByDay.get(day)!.push(s.sentiment);
  }
  const sentimentByDay: [string, number][] = [...sentByDay.entries()]
    .map(([d, scores]) => [d, scores.reduce((a, v) => a + v, 0) / scores.length] as [string, number])
    .sort((a, b) => a[0].localeCompare(b[0]));

  // Positive / negative word highlights
  const posWords = [...freq.entries()]
    .filter(([w]) => (SENTIMENT[w] ?? 0) >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([w]) => w);
  const negWords = [...freq.entries()]
    .filter(([w]) => (SENTIMENT[w] ?? 0) <= -2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([w]) => w);

  // Streaks
  const dates = sessions.map((s) => s.created);
  const { current, longest } = computeStreaks(dates);

  const nounPhrases = extractNounPhrases(sessions);
  const topics = buildTopicClusters(sessions);

  return {
    sessions,
    totalWords,
    avgSessionWords,
    longestStreak: longest,
    currentStreak: current,
    topTokens,
    nounPhrases,
    sentimentByDay,
    positiveWords: posWords,
    negativeWords: negWords,
    topics,
    computed: Date.now(),
  };
}
