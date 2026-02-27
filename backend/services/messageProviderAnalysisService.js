export function createMessageProviderAnalysisService(options = {}) {
  const analysisProvider = String(options.analysisProvider || 'openclaw').trim().toLowerCase() || 'openclaw';
  const messageProviderDefaultKeywords = Array.isArray(options.messageProviderDefaultKeywords)
    ? options.messageProviderDefaultKeywords
    : [];
  const messageProviderMarketDataFallback = Boolean(options.messageProviderMarketDataFallback);

  const openNews = options.openNews && typeof options.openNews === 'object' ? options.openNews : {};
  const openTwitter = options.openTwitter && typeof options.openTwitter === 'object' ? options.openTwitter : {};

  const OPENNEWS_API_BASE = String(openNews.baseUrl || '').trim().replace(/\/+$/, '');
  const OPENNEWS_TOKEN = String(openNews.token || '').trim();
  const OPENNEWS_TIMEOUT_MS = Number(openNews.timeoutMs || 8000);
  const OPENNEWS_RETRY = Number(openNews.retries || 0);
  const OPENNEWS_MAX_ROWS = Number(openNews.maxRows || 8);

  const OPENTWITTER_API_BASE = String(openTwitter.baseUrl || '').trim().replace(/\/+$/, '');
  const OPENTWITTER_TOKEN = String(openTwitter.token || '').trim();
  const OPENTWITTER_TIMEOUT_MS = Number(openTwitter.timeoutMs || 8000);
  const OPENTWITTER_RETRY = Number(openTwitter.retries || 0);
  const OPENTWITTER_MAX_ROWS = Number(openTwitter.maxRows || 8);

  const clampNumber = options.clampNumber;
  const normalizeFreshIsoTimestamp = options.normalizeFreshIsoTimestamp;
  const normalizeStringArray = options.normalizeStringArray;
  const normalizeInfoAnalysisResult = options.normalizeInfoAnalysisResult;
  const averageNumbers = options.averageNumbers;
  const normalizeXReaderParams = options.normalizeXReaderParams;
  const runMarketInfoAnalysis = options.runMarketInfoAnalysis;

  if (typeof clampNumber !== 'function') {
    throw new Error('createMessageProviderAnalysisService requires clampNumber');
  }
  if (typeof normalizeFreshIsoTimestamp !== 'function') {
    throw new Error('createMessageProviderAnalysisService requires normalizeFreshIsoTimestamp');
  }
  if (typeof normalizeStringArray !== 'function') {
    throw new Error('createMessageProviderAnalysisService requires normalizeStringArray');
  }
  if (typeof normalizeInfoAnalysisResult !== 'function') {
    throw new Error('createMessageProviderAnalysisService requires normalizeInfoAnalysisResult');
  }
  if (typeof averageNumbers !== 'function') {
    throw new Error('createMessageProviderAnalysisService requires averageNumbers');
  }
  if (typeof normalizeXReaderParams !== 'function') {
    throw new Error('createMessageProviderAnalysisService requires normalizeXReaderParams');
  }
  if (typeof runMarketInfoAnalysis !== 'function') {
    throw new Error('createMessageProviderAnalysisService requires runMarketInfoAnalysis');
  }

  function sanitizePlainText(value = '') {
    return String(value || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokenizeMessageTopic(task = {}) {
    const raw = String(task?.topic || task?.url || '').trim();
    const seed = [raw, ...messageProviderDefaultKeywords]
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .join(' ');
    const tokens = seed
      .split(/[\s,;|/]+/)
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .slice(0, 32);
    const uniq = [];
    for (const token of tokens) {
      const key = token.toLowerCase();
      if (uniq.some((item) => item.toLowerCase() === key)) continue;
      uniq.push(token);
    }
    return uniq;
  }

  function extractCoinSymbolsFromTokens(tokens = []) {
    const allow = new Set(['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'ADA', 'LTC', 'AVAX', 'LINK']);
    const out = [];
    for (const tokenRaw of tokens) {
      const token = String(tokenRaw || '').trim().toUpperCase().replace(/[^A-Z]/g, '');
      if (!token || !allow.has(token)) continue;
      if (!out.includes(token)) out.push(token);
      if (out.length >= 8) break;
    }
    return out;
  }

  function computeNewsRelevanceScore(item = {}, tokens = []) {
    const text = sanitizePlainText(item?.text || item?.description || '').toLowerCase();
    const coinSymbols = Array.isArray(item?.coins)
      ? item.coins.map((coin) => String(coin?.symbol || '').trim().toLowerCase()).filter(Boolean)
      : [];
    const sourceText = `${String(item?.engineType || '').toLowerCase()} ${String(item?.newsType || '').toLowerCase()} ${String(item?.source || '').toLowerCase()}`;
    let score = 0;
    for (const tokenRaw of tokens) {
      const token = String(tokenRaw || '').trim().toLowerCase();
      if (!token) continue;
      if (text.includes(token)) score += 3;
      if (sourceText.includes(token)) score += 2;
      if (coinSymbols.includes(token)) score += 4;
    }
    const aiScore = Number(item?.aiRating?.score);
    if (Number.isFinite(aiScore)) score += Math.max(0, Math.min(aiScore / 20, 5));
    return score;
  }

  function mapSignalToSentiment(signalRaw = '', scoreRaw = NaN, fallback = 0) {
    const signal = String(signalRaw || '').trim().toLowerCase();
    const score = Number(scoreRaw);
    const scoreScale = Number.isFinite(score) ? Math.max(0.2, Math.min(score / 100, 1)) : 0.55;
    if (signal === 'long' || signal === 'bullish') return Number((0.62 * scoreScale).toFixed(4));
    if (signal === 'short' || signal === 'bearish') return Number((-0.62 * scoreScale).toFixed(4));
    if (signal === 'neutral') return 0;
    return fallback;
  }

  function inferTextSentiment(text = '') {
    const raw = String(text || '').toLowerCase();
    if (!raw) return 0;
    const bullish = ['bullish', 'long', 'breakout', 'pump', 'rally', '看多', '利好', '上涨', '新高'];
    const bearish = ['bearish', 'short', 'dump', 'crash', '看空', '利空', '下跌', '暴跌'];
    let score = 0;
    for (const word of bullish) {
      if (raw.includes(word)) score += 1;
    }
    for (const word of bearish) {
      if (raw.includes(word)) score -= 1;
    }
    if (score === 0) return 0;
    return clampNumber(score / 4, -1, 1, 0);
  }

  function createProviderError({
    provider = 'provider',
    code = 'provider_unavailable',
    message = 'provider unavailable',
    statusCode = 0,
    responseBody = null
  } = {}) {
    const error = new Error(String(message || code || 'provider_unavailable').trim() || 'provider_unavailable');
    error.code = String(code || 'provider_unavailable').trim().toLowerCase() || 'provider_unavailable';
    error.provider = String(provider || '').trim().toLowerCase();
    error.statusCode = Number.isFinite(Number(statusCode)) ? Number(statusCode) : 0;
    error.responseBody = responseBody;
    return error;
  }

  function classifyProviderErrorCode(error = null) {
    const statusCode = Number(error?.statusCode || 0);
    if (statusCode === 401 || statusCode === 403) return 'provider_auth_failed';
    if (statusCode === 429) return 'provider_rate_limited';
    if (statusCode >= 500) return 'provider_unavailable';
    const codeRaw = String(error?.code || '').trim().toLowerCase();
    if (codeRaw.startsWith('provider_')) return codeRaw;
    const reasonRaw = String(error?.message || '').trim().toLowerCase();
    if (reasonRaw.includes('timeout') || reasonRaw.includes('aborted')) return 'provider_timeout';
    if (reasonRaw.includes('econnreset') || reasonRaw.includes('fetch failed')) return 'provider_unavailable';
    return 'provider_unavailable';
  }

  function shouldRetryProviderError(error = null) {
    const code = classifyProviderErrorCode(error);
    if (code === 'provider_auth_failed') return false;
    return ['provider_timeout', 'provider_unavailable', 'provider_rate_limited'].includes(code);
  }

  async function requestJsonWithTimeoutDetailed({
    url = '',
    method = 'POST',
    headers = {},
    body = undefined,
    timeoutMs = 8000
  } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs || 8000)));
    try {
      const resp = await fetch(String(url || '').trim(), {
        method: String(method || 'POST').trim().toUpperCase() || 'POST',
        headers: headers || {},
        body,
        signal: controller.signal
      });
      const rawText = await resp.text();
      let payload = null;
      try {
        payload = rawText ? JSON.parse(rawText) : {};
      } catch {
        payload = { raw: rawText };
      }
      if (!resp.ok) {
        throw createProviderError({
          code: classifyProviderErrorCode({ statusCode: resp.status }),
          message: `HTTP ${resp.status}`,
          statusCode: resp.status,
          responseBody: payload
        });
      }
      return payload && typeof payload === 'object' ? payload : {};
    } catch (error) {
      const reason = String(error?.message || '').trim().toLowerCase();
      if (reason.includes('abort') || reason.includes('timeout')) {
        throw createProviderError({
          code: 'provider_timeout',
          message: reason || 'request timeout',
          statusCode: Number(error?.statusCode || 0),
          responseBody: error?.responseBody || null
        });
      }
      if (String(error?.code || '').trim().toLowerCase().startsWith('provider_')) {
        throw error;
      }
      throw createProviderError({
        code: 'provider_unavailable',
        message: reason || 'provider request failed',
        statusCode: Number(error?.statusCode || 0),
        responseBody: error?.responseBody || null
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function runProviderRequestWithRetry({ provider = 'provider', retries = 0, run }) {
    const maxAttempts = Math.max(1, Number(retries || 0) + 1);
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await run();
      } catch (error) {
        const coded = createProviderError({
          provider,
          code: classifyProviderErrorCode(error),
          message: String(error?.message || 'provider request failed').trim() || 'provider request failed',
          statusCode: Number(error?.statusCode || 0),
          responseBody: error?.responseBody || null
        });
        lastError = coded;
        if (attempt >= maxAttempts || !shouldRetryProviderError(coded)) {
          break;
        }
        const backoff = 250 * attempt;
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
    throw lastError || createProviderError({ provider, code: 'provider_unavailable', message: 'provider request failed' });
  }

  function buildProviderFailureSummary(provider = '', error = null) {
    const code = classifyProviderErrorCode(error);
    const reason = String(error?.message || code || 'provider_unavailable').trim() || 'provider_unavailable';
    return {
      provider: String(provider || '').trim().toLowerCase(),
      code,
      reason,
      statusCode: Number(error?.statusCode || 0) || 0
    };
  }

  async function fetchOpenNewsSnapshot(task = {}) {
    if (!OPENNEWS_TOKEN) {
      throw createProviderError({
        provider: 'opennews',
        code: 'provider_auth_failed',
        message: 'OPENNEWS_TOKEN not configured',
        statusCode: 401
      });
    }
    const terms = tokenizeMessageTopic(task);
    const coins = extractCoinSymbolsFromTokens(terms);
    const body = {
      limit: OPENNEWS_MAX_ROWS,
      page: 1
    };
    if (terms.length > 0) body.q = terms.slice(0, 16).join(' ');
    if (coins.length > 0) body.coins = coins;

    const runSearch = async (searchBody) =>
      runProviderRequestWithRetry({
        provider: 'opennews',
        retries: OPENNEWS_RETRY,
        run: async () =>
          requestJsonWithTimeoutDetailed({
            url: `${OPENNEWS_API_BASE}/open/news_search`,
            method: 'POST',
            headers: {
              Authorization: `Bearer ${OPENNEWS_TOKEN}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(searchBody || {}),
            timeoutMs: OPENNEWS_TIMEOUT_MS
          })
      });

    let payload = await runSearch(body);

    if (payload?.success !== true) {
      throw createProviderError({
        provider: 'opennews',
        code: 'provider_unavailable',
        message: String(payload?.message || payload?.error || 'opennews request failed').trim() || 'opennews request failed',
        statusCode: 502,
        responseBody: payload
      });
    }
    let rows = Array.isArray(payload?.data) ? payload.data : [];
    if (rows.length === 0 && (body.q || (Array.isArray(body.coins) && body.coins.length > 0))) {
      payload = await runSearch({
        limit: OPENNEWS_MAX_ROWS,
        page: 1
      });
      rows = Array.isArray(payload?.data) ? payload.data : [];
    }
    if (rows.length === 0) {
      throw createProviderError({
        provider: 'opennews',
        code: 'provider_unavailable',
        message: 'opennews returned empty data',
        statusCode: 502,
        responseBody: payload
      });
    }
    const rankingTokens = tokenizeMessageTopic(task);
    rows = [...rows]
      .map((item, index) => ({
        item,
        score: computeNewsRelevanceScore(item, rankingTokens),
        index
      }))
      .sort((a, b) => {
        const diff = Number(b.score || 0) - Number(a.score || 0);
        if (Math.abs(diff) > 1e-9) return diff > 0 ? 1 : -1;
        return Number(a.index || 0) - Number(b.index || 0);
      })
      .map((entry) => entry.item);

    const headlines = [];
    const keyFactors = [];
    const sentimentSamples = [];
    let asOf = '';
    for (const item of rows.slice(0, OPENNEWS_MAX_ROWS)) {
      const text = sanitizePlainText(item?.text || item?.description || '');
      if (text) headlines.push(text);
      const aiRating = item?.aiRating && typeof item.aiRating === 'object' ? item.aiRating : {};
      const signal = String(aiRating?.signal || '').trim().toLowerCase();
      const score = Number(aiRating?.score);
      const sentiment = mapSignalToSentiment(signal, score, inferTextSentiment(text));
      if (Number.isFinite(sentiment)) sentimentSamples.push(sentiment);
      const engineType = String(item?.engineType || '').trim();
      const newsType = String(item?.newsType || '').trim();
      const source = String(item?.source || '').trim();
      if (engineType || newsType || source) {
        keyFactors.push(`opennews:${engineType || 'news'}/${newsType || source || 'source'}`);
      }
      if (!asOf) {
        asOf = normalizeFreshIsoTimestamp(item?.ts || item?.createdAt || '');
      }
    }

    const signalCounts = rows.reduce(
      (acc, row) => {
        const signal = String(row?.aiRating?.signal || '').trim().toLowerCase();
        if (signal === 'long') acc.long += 1;
        else if (signal === 'short') acc.short += 1;
        else acc.neutral += 1;
        return acc;
      },
      { long: 0, short: 0, neutral: 0 }
    );
    keyFactors.push(`opennewsSignals long=${signalCounts.long} short=${signalCounts.short} neutral=${signalCounts.neutral}`);
    return {
      provider: 'opennews-mcp',
      headlines: normalizeStringArray(headlines, 8),
      keyFactors: normalizeStringArray(keyFactors, 12),
      sentimentSamples,
      asOf: asOf || new Date().toISOString(),
      summary: `opennews: ${rows.length} 条，long=${signalCounts.long} short=${signalCounts.short} neutral=${signalCounts.neutral}`,
      quota: String(payload?.quota || '').trim(),
      cost: String(payload?.cost || '').trim()
    };
  }

  async function fetchOpenTwitterSnapshot(task = {}) {
    if (!OPENTWITTER_TOKEN) {
      throw createProviderError({
        provider: 'opentwitter',
        code: 'provider_auth_failed',
        message: 'TWITTER_TOKEN not configured',
        statusCode: 401
      });
    }
    const terms = tokenizeMessageTopic(task);
    const keywordExpr = terms.slice(0, 8).join(' OR ');
    const body = {
      keywords: keywordExpr || 'BTC OR ETH',
      product: 'Top',
      maxResults: OPENTWITTER_MAX_ROWS,
      excludeReplies: true,
      excludeRetweets: true
    };
    const payload = await runProviderRequestWithRetry({
      provider: 'opentwitter',
      retries: OPENTWITTER_RETRY,
      run: async () =>
        requestJsonWithTimeoutDetailed({
          url: `${OPENTWITTER_API_BASE}/open/twitter_search`,
          method: 'POST',
          headers: {
            Authorization: `Bearer ${OPENTWITTER_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body),
          timeoutMs: OPENTWITTER_TIMEOUT_MS
        })
    });
    if (payload?.success !== true) {
      throw createProviderError({
        provider: 'opentwitter',
        code: 'provider_unavailable',
        message:
          String(payload?.message || payload?.error || 'opentwitter request failed').trim() || 'opentwitter request failed',
        statusCode: 502,
        responseBody: payload
      });
    }
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    if (rows.length === 0) {
      throw createProviderError({
        provider: 'opentwitter',
        code: 'provider_unavailable',
        message: 'opentwitter returned empty data',
        statusCode: 502,
        responseBody: payload
      });
    }

    const headlines = [];
    const keyFactors = [];
    const sentimentSamples = [];
    const topUsers = [];
    let asOf = '';
    for (const row of rows.slice(0, OPENTWITTER_MAX_ROWS)) {
      const text = sanitizePlainText(row?.text || '');
      if (text) headlines.push(text);
      const likes = Number(row?.favoriteCount);
      const retweets = Number(row?.retweetCount);
      const replies = Number(row?.replyCount);
      const engagement =
        (Number.isFinite(likes) ? likes : 0) +
        (Number.isFinite(retweets) ? retweets * 2 : 0) +
        (Number.isFinite(replies) ? replies * 1.5 : 0);
      const baseSentiment = inferTextSentiment(text);
      const sentimentBoost = clampNumber(engagement / 5000, 0, 0.18, 0);
      const sentiment = clampNumber(baseSentiment + (baseSentiment >= 0 ? sentimentBoost : -sentimentBoost), -1, 1, 0);
      sentimentSamples.push(sentiment);
      const user = String(row?.userScreenName || row?.userName || '').trim();
      if (user && !topUsers.includes(user)) topUsers.push(user);
      if (user) {
        keyFactors.push(`x:@${user} likes=${Number.isFinite(likes) ? likes : 0} rt=${Number.isFinite(retweets) ? retweets : 0}`);
      }
      if (!asOf) {
        asOf = normalizeFreshIsoTimestamp(row?.createdAt || row?.ts || '');
      }
    }
    keyFactors.push(`twitterTopUsers=${topUsers.slice(0, 3).join(',') || 'n/a'}`);
    return {
      provider: 'opentwitter-mcp',
      headlines: normalizeStringArray(headlines, 8),
      keyFactors: normalizeStringArray(keyFactors, 12),
      sentimentSamples,
      asOf: asOf || new Date().toISOString(),
      summary: `opentwitter: ${rows.length} 条，top=${topUsers.slice(0, 3).join(',') || 'n/a'}`,
      quota: String(payload?.quota || '').trim(),
      cost: String(payload?.cost || '').trim()
    };
  }

  function mergeMessageProviderSnapshots(task = {}, snapshots = [], failures = []) {
    const successful = Array.isArray(snapshots) ? snapshots.filter(Boolean) : [];
    const failed = Array.isArray(failures) ? failures.filter(Boolean) : [];
    const headlines = normalizeStringArray(
      successful.flatMap((item) => (Array.isArray(item?.headlines) ? item.headlines : [])),
      8
    );
    const sentimentSamples = successful.flatMap((item) =>
      Array.isArray(item?.sentimentSamples) ? item.sentimentSamples : []
    );
    const avgSentiment = Number.isFinite(averageNumbers(sentimentSamples)) ? averageNumbers(sentimentSamples) : 0;
    const providerCount = successful.length;
    const confidence = clampNumber(0.42 + providerCount * 0.12 + headlines.length * 0.03, 0.35, 0.93, 0.5);
    const keyFactors = [
      ...successful.flatMap((item) => (Array.isArray(item?.keyFactors) ? item.keyFactors : [])),
      ...failed.map((item) => `${item.provider}:${item.code}`)
    ];
    const providerLabel = successful.map((item) => item.provider).join('+') || analysisProvider;
    const detailSummary = successful.map((item) => item.summary).filter(Boolean).join(' | ');
    const summary = detailSummary || `${providerLabel}: ${headlines[0] || task?.topic || '消息面分析完成'}`;
    const asOf = normalizeFreshIsoTimestamp(
      successful.map((item) => item.asOf).find((item) => String(item || '').trim()),
      new Date().toISOString()
    );
    return normalizeInfoAnalysisResult(
      {
        provider: providerLabel,
        traceId: String(task?.traceId || '').trim(),
        topic: String(task?.topic || task?.url || '').trim(),
        sentimentScore: avgSentiment,
        confidence,
        headlines,
        keyFactors: normalizeStringArray(keyFactors, 16),
        summary,
        asOf
      },
      task
    );
  }

  async function runMessageProviderInfoAnalysis(params = {}) {
    const task = normalizeXReaderParams(params);
    const traceId = String(params?.traceId || '').trim();
    const mode = String(task.mode || 'auto').trim().toLowerCase();
    const requestedProviders =
      mode === 'opennews'
        ? ['opennews']
        : mode === 'opentwitter'
          ? ['opentwitter']
          : ['opennews', 'opentwitter'];
    const snapshots = [];
    const failures = [];
    const runners = [];
    if (requestedProviders.includes('opennews')) {
      runners.push(
        fetchOpenNewsSnapshot({ ...task, traceId })
          .then((result) => snapshots.push(result))
          .catch((error) => failures.push(buildProviderFailureSummary('opennews', error)))
      );
    }
    if (requestedProviders.includes('opentwitter')) {
      runners.push(
        fetchOpenTwitterSnapshot({ ...task, traceId })
          .then((result) => snapshots.push(result))
          .catch((error) => failures.push(buildProviderFailureSummary('opentwitter', error)))
      );
    }

    if (runners.length > 0) {
      await Promise.all(runners);
    }
    if (snapshots.length > 0) {
      return mergeMessageProviderSnapshots({ ...task, traceId }, snapshots, failures);
    }
    if (mode !== 'market-data' && messageProviderMarketDataFallback) {
      const fallback = await runMarketInfoAnalysis({
        ...task,
        traceId
      });
      fallback.provider = 'market-data-fallback';
      fallback.keyFactors = normalizeStringArray(
        [
          ...(Array.isArray(fallback.keyFactors) ? fallback.keyFactors : []),
          ...failures.map((item) => `${item.provider}:${item.code}`)
        ],
        16
      );
      fallback.summary = `${fallback.summary} | upstream=${failures.map((item) => item.provider).join(',') || 'none'}`;
      return fallback;
    }

    const reason = failures.map((item) => `${item.provider}:${item.code}`).join(' | ') || 'message provider unavailable';
    throw createProviderError({
      provider: 'message-provider',
      code: 'provider_unavailable',
      message: reason,
      statusCode: 502,
      responseBody: failures
    });
  }

  async function runInfoAnalysis(params = {}) {
    const task = normalizeXReaderParams(params);
    const traceId = String(params?.traceId || '').trim();
    if (String(task.mode || '').trim().toLowerCase() === 'market-data') {
      return runMarketInfoAnalysis({
        ...task,
        traceId
      });
    }
    return runMessageProviderInfoAnalysis({
      ...task,
      traceId
    });
  }

  return {
    runInfoAnalysis
  };
}
