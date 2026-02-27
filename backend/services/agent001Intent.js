function extractFirstUrlFromText(text = '') {
  const raw = String(text || '').trim();
  const match = raw.match(/https?:\/\/[^\s]+/i);
  return match ? String(match[0] || '').trim() : '';
}

function extractTradingSymbolFromText(text = '') {
  const raw = String(text || '').toUpperCase();
  if (/\bETHUSD[T]?\b/.test(raw)) return 'ETHUSDT';
  if (/\bETH\b/.test(raw)) return 'ETHUSDT';
  if (/\bBTCUSD[T]?\b/.test(raw)) return 'BTCUSDT';
  if (/\bBTC\b/.test(raw)) return 'BTCUSDT';
  return 'BTCUSDT';
}

function extractHorizonFromText(text = '') {
  const raw = String(text || '').toLowerCase();
  const match = raw.match(/(\d{1,3})\s*(m|min|minute|minutes|分钟|分)/i);
  if (!match) return 60;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return 60;
  return Math.max(5, Math.min(Math.round(value), 240));
}

function detectAgent001IntentOverrides(text = '') {
  const rawText = String(text || '').trim();
  const compactCn = rawText.replace(/\s+/g, '');
  const lowered = rawText.toLowerCase();
  const infoOnlyByLiteral =
    compactCn.includes('仅消息面') ||
    compactCn.includes('只要消息面') ||
    compactCn.includes('只看消息面') ||
    (compactCn.includes('消息面') &&
      (compactCn.includes('不要技术面') || compactCn.includes('不需要技术面') || compactCn.includes('别给技术面'))) ||
    /\bonly\s+(info|news|sentiment)\b|\bnews\s+only\b|\bsentiment\s+only\b/i.test(lowered);
  const technicalOnlyByLiteral =
    compactCn.includes('仅技术面') ||
    compactCn.includes('只要技术面') ||
    compactCn.includes('只看技术面') ||
    (compactCn.includes('技术面') &&
      (compactCn.includes('不要消息面') || compactCn.includes('不需要消息面') || compactCn.includes('别给消息面'))) ||
    /\bonly\s+technical\b|\btechnical\s+only\b/i.test(lowered);

  return {
    infoOnly:
      infoOnlyByLiteral ||
      /(仅消息面|只要消息面|只看消息面|不要技术面|不需要技术面|别给技术面|only\s+(info|news|sentiment)|news\s+only|sentiment\s+only)/i.test(
        rawText
      ),
    technicalOnly:
      technicalOnlyByLiteral ||
      /(仅技术面|只要技术面|只看技术面|不要消息面|不需要消息面|别给消息面|only\s+technical|technical\s+only)/i.test(
        rawText
      ),
    noTrade:
      /(不要交易|不需要交易|不要交易计划|不需要交易计划|不要下单|不下单|no\s+trade|no\s+order|don'?t\s+trade|do\s+not\s+trade)/i.test(
        rawText
      )
  };
}

function classifyAgent001IntentFallback(text = '') {
  const rawText = String(text || '').trim();
  const overrides = detectAgent001IntentOverrides(rawText);
  const hasTrade =
    /(交易|下单|挂单|做多|做空|交易计划|买入|卖出|开多|开空|建仓|平仓|市价|限价|止盈|止损|order|place order|plan|entry|exit|strategy|trade|buy|sell|long|short|market|limit|take profit|stop loss|tp|sl)/i.test(
      rawText
    );
  const hasTechKeyword = /(技术|technical|risk|指标|rsi|macd|ema|atr|布林|均线|支撑|阻力|趋势)/i.test(rawText);
  const hasMajorSymbol = /\bBTCUSD[T]?\b|\bBTC\b|\bETHUSD[T]?\b|\bETH\b/i.test(rawText);
  const hasHorizon = /(\d{1,3})\s*(m|min|minute|minutes|h|hr|hour|hours|分钟|分|小时)/i.test(rawText);
  const hasInfo = /(消息|news|sentiment|舆情|资讯|情绪|headline|digest|x-reader|http:\/\/|https:\/\/)/i.test(rawText);
  const hasTech = hasTechKeyword || (hasMajorSymbol && hasHorizon && !hasInfo);
  const askHelp = /(help|功能|怎么用|命令|示例)/i.test(rawText);
  if (!rawText || askHelp) {
    return { intent: 'help', symbol: 'BTCUSDT', horizonMin: 60, source: 'hyperliquid', topic: '' };
  }
  let intent = 'chat';
  if (hasTrade) intent = 'trade';
  else if (hasTech && hasInfo) intent = 'both';
  else if (hasTech) intent = 'technical';
  else if (hasInfo) intent = 'info';
  if (overrides.infoOnly) intent = 'info';
  if (overrides.technicalOnly) intent = 'technical';
  if (overrides.noTrade && intent === 'trade') {
    if (hasTech && hasInfo) intent = 'both';
    else if (hasInfo) intent = 'info';
    else if (hasTech) intent = 'technical';
    else intent = 'chat';
  }
  const url = extractFirstUrlFromText(rawText);
  const topic = url || rawText;
  return {
    intent,
    symbol: extractTradingSymbolFromText(rawText),
    horizonMin: extractHorizonFromText(rawText),
    source: 'hyperliquid',
    topic
  };
}

function resolveAgent001Intent(text = '', llmIntent = null) {
  const overrides = detectAgent001IntentOverrides(text);
  const fallback = classifyAgent001IntentFallback(text);
  if (!llmIntent || typeof llmIntent !== 'object') return fallback;
  let intent = String(llmIntent.intent || '').trim().toLowerCase();
  if (!['technical', 'info', 'both', 'trade', 'chat', 'help'].includes(intent)) return fallback;
  if (overrides.infoOnly) intent = 'info';
  if (overrides.technicalOnly) intent = 'technical';
  if (overrides.noTrade && intent === 'trade') {
    intent = fallback.intent === 'trade' ? 'chat' : fallback.intent;
  }
  return {
    intent,
    symbol: String(llmIntent.symbol || fallback.symbol || 'BTCUSDT').trim().toUpperCase() || 'BTCUSDT',
    horizonMin: Number.isFinite(Number(llmIntent.horizonMin))
      ? Math.max(5, Math.min(Math.round(Number(llmIntent.horizonMin)), 240))
      : fallback.horizonMin,
    source: String(llmIntent.source || fallback.source || 'hyperliquid').trim().toLowerCase() || 'hyperliquid',
    topic: String(llmIntent.topic || fallback.topic || '').trim()
  };
}

function isAgent001ForceOrderRequested(rawText = '') {
  const text = String(rawText || '').trim();
  if (!text) return false;
  const compactCn = text.replace(/\s+/g, '');
  const lowered = text.toLowerCase();
  if (/(不要下单|不下单|no\s+order|don'?t\s+order|do\s+not\s+order)/i.test(text)) return false;
  return (
    compactCn.includes('强制下单') ||
    compactCn.includes('立刻下单') ||
    compactCn.includes('立即下单') ||
    compactCn.includes('马上下单') ||
    compactCn.includes('直接下单') ||
    compactCn.includes('必须下单') ||
    compactCn.includes('立即执行下单') ||
    compactCn.includes('市价下单') ||
    compactCn.includes('限价下单') ||
    /\b(force\s+order|force\s+place\s+order|place\s+order\s+now|execute\s+order\s+now|order\s+now)\b/i.test(lowered)
  );
}

function detectAgent001ForcedOrderSide(rawText = '') {
  const text = String(rawText || '').trim();
  if (!text) return '';
  const compactCn = text.replace(/\s+/g, '');
  if (/(做空|卖出|卖空|看空|空单)/.test(compactCn) || /\b(sell|short)\b/i.test(text)) return 'sell';
  if (/(做多|买入|买多|看多|多单)/.test(compactCn) || /\b(buy|long)\b/i.test(text)) return 'buy';
  return '';
}

function extractAgent001NumberFromPatterns(rawText = '', patterns = []) {
  const text = String(rawText || '');
  for (const pattern of patterns) {
    const matched = text.match(pattern);
    if (!matched) continue;
    const value = Number(matched[1]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return NaN;
}

function parseAgent001OrderDirectives(rawText = '') {
  const text = String(rawText || '').trim();
  const compactCn = text.replace(/\s+/g, '');
  const hasOrderKeyword =
    /(下单|挂单|买入|卖出|做多|做空|开多|开空|建仓|平仓|order|place|buy|sell|long|short|market|limit)/i.test(text);
  const explicitMarket = /(市价|market|ioc|立即成交|马上成交)/i.test(text);
  const explicitLimit = /(限价|limit|挂单|post[\s-]*only|alo)/i.test(text);
  const orderType = explicitLimit ? 'limit' : explicitMarket ? 'market' : '';
  const tifMatch = text.match(/\btif\b\s*[:=]?\s*(gtc|ioc|alo)\b/i);
  const tif = tifMatch ? String(tifMatch[1] || '').trim() : '';
  const size = extractAgent001NumberFromPatterns(text, [
    /(?:\bsize\b|\bqty\b|\bquantity\b|数量|仓位|下单量)\s*[:=]?\s*(\d+(?:\.\d+)?)/i,
    /(?:买入|卖出|buy|sell)\s*(\d+(?:\.\d+)?)(?:\s*(?:btc|eth|usdt))?/i
  ]);
  const limitPrice = extractAgent001NumberFromPatterns(text, [
    /(?:限价|价格|价位|price)\s*[:=]?\s*(\d+(?:\.\d+)?)/i,
    /(?:at|@)\s*(\d{3,}(?:\.\d+)?)/i
  ]);
  const takeProfitPct = extractAgent001NumberFromPatterns(text, [/(?:止盈|take\s*profit|tp)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*%/i]);
  const stopLossPct = extractAgent001NumberFromPatterns(text, [/(?:止损|stop\s*loss|sl)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*%/i]);
  const takeProfit = extractAgent001NumberFromPatterns(text, [/(?:止盈|take\s*profit|tp)\s*[:=]?\s*(\d+(?:\.\d+)?)(?!\s*%)/i]);
  const stopLoss = extractAgent001NumberFromPatterns(text, [/(?:止损|stop\s*loss|sl)\s*[:=]?\s*(\d+(?:\.\d+)?)(?!\s*%)/i]);
  const wantsStopOrder =
    compactCn.includes('止盈止损') ||
    compactCn.includes('止盈') ||
    compactCn.includes('止损') ||
    /\b(tp|sl|take\s*profit|stop\s*loss)\b/i.test(text);
  const explicitOrder =
    hasOrderKeyword &&
    (explicitMarket || explicitLimit || Number.isFinite(limitPrice) || Number.isFinite(size) || detectAgent001ForcedOrderSide(text) !== '');
  const forceExecute = isAgent001ForceOrderRequested(text) || (hasOrderKeyword && (explicitMarket || explicitLimit || wantsStopOrder));
  return {
    explicitOrder,
    forceExecute,
    side: detectAgent001ForcedOrderSide(text),
    orderType,
    tif,
    size,
    limitPrice,
    takeProfit,
    stopLoss,
    takeProfitPct,
    stopLossPct,
    wantsStopOrder
  };
}

export {
  classifyAgent001IntentFallback,
  detectAgent001ForcedOrderSide,
  detectAgent001IntentOverrides,
  extractAgent001NumberFromPatterns,
  extractFirstUrlFromText,
  extractHorizonFromText,
  extractTradingSymbolFromText,
  isAgent001ForceOrderRequested,
  parseAgent001OrderDirectives,
  resolveAgent001Intent
};
