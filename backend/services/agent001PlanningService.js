function assertDependency(name, value) {
  if (typeof value !== 'function') {
    throw new Error(`agent001_planning_missing_dependency:${name}`);
  }
}

function createAgent001PlanningService(deps = {}) {
  const {
    parseAgent001OrderDirectives,
    extractTradingSymbolFromText,
    extractHorizonFromText,
    clampNumber,
    toRiskLevel
  } = deps;

  assertDependency('parseAgent001OrderDirectives', parseAgent001OrderDirectives);
  assertDependency('extractTradingSymbolFromText', extractTradingSymbolFromText);
  assertDependency('extractHorizonFromText', extractHorizonFromText);
  assertDependency('clampNumber', clampNumber);
  assertDependency('toRiskLevel', toRiskLevel);

  function roundPriceByMagnitude(value, fallbackDigits = 2) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return '';
    if (numeric >= 1000) return numeric.toFixed(2);
    if (numeric >= 100) return numeric.toFixed(3);
    if (numeric >= 1) return numeric.toFixed(4);
    return numeric.toFixed(Math.max(4, fallbackDigits));
  }

  function pickTradeDecisionSide({
    trend = '',
    momentum = '',
    bias = '',
    sentimentScore = NaN
  } = {}) {
    let longScore = 0;
    let shortScore = 0;
    const reasons = [];
    const safeTrend = String(trend || '').trim().toLowerCase();
    const safeMomentum = String(momentum || '').trim().toLowerCase();
    const safeBias = String(bias || '').trim().toLowerCase();

    if (/(up|bull)/.test(safeTrend)) {
      longScore += 2;
      reasons.push('技术趋势偏多');
    } else if (/(down|bear)/.test(safeTrend)) {
      shortScore += 2;
      reasons.push('技术趋势偏空');
    } else {
      reasons.push('技术趋势偏震荡');
    }

    if (/(bull|long)/.test(safeBias)) {
      longScore += 2;
      reasons.push('技术偏向做多');
    } else if (/(bear|short)/.test(safeBias)) {
      shortScore += 2;
      reasons.push('技术偏向做空');
    } else if (safeBias) {
      reasons.push(`技术偏向 ${safeBias}`);
    }

    if (/(bull|up|positive|strong)/.test(safeMomentum)) longScore += 1;
    if (/(bear|down|negative|weak)/.test(safeMomentum)) shortScore += 1;

    const sentiment = Number(sentimentScore);
    if (Number.isFinite(sentiment)) {
      if (sentiment >= 0.2) {
        longScore += 1;
        reasons.push('消息面情绪偏正向');
      } else if (sentiment <= -0.2) {
        shortScore += 1;
        reasons.push('消息面情绪偏负向');
      } else {
        reasons.push('消息面情绪中性');
      }
    } else {
      reasons.push('消息面情绪未量化');
    }

    const diff = Math.abs(longScore - shortScore);
    const side = longScore > shortScore ? 'long' : shortScore > longScore ? 'short' : 'none';
    return {
      side: diff >= 2 ? side : 'none',
      longScore,
      shortScore,
      diff,
      reasons
    };
  }

  function coerceAgent001ForcedTradePlan({
    rawText = '',
    tradePlan = null,
    technical = null,
    info = null,
    directives = null
  } = {}) {
    const plan = tradePlan && typeof tradePlan === 'object' ? { ...tradePlan } : {};
    const parsed = directives && typeof directives === 'object' ? directives : parseAgent001OrderDirectives(rawText);
    const technicalResult =
      technical?.taskResult?.result && typeof technical.taskResult.result === 'object' && !Array.isArray(technical.taskResult.result)
        ? technical.taskResult.result
        : {};
    const technicalAnalysis =
      technicalResult?.analysis && typeof technicalResult.analysis === 'object' && !Array.isArray(technicalResult.analysis)
        ? technicalResult.analysis
        : technicalResult?.technical && typeof technicalResult.technical === 'object' && !Array.isArray(technicalResult.technical)
          ? technicalResult.technical
          : {};
    const technicalQuote =
      technicalResult?.quote && typeof technicalResult.quote === 'object' && !Array.isArray(technicalResult.quote)
        ? technicalResult.quote
        : technicalAnalysis?.quote && typeof technicalAnalysis.quote === 'object' && !Array.isArray(technicalAnalysis.quote)
          ? technicalAnalysis.quote
          : {};
    const infoResult =
      info?.taskResult?.result && typeof info.taskResult.result === 'object' && !Array.isArray(info.taskResult.result)
        ? info.taskResult.result
        : {};
    const infoPayload =
      infoResult?.info && typeof infoResult.info === 'object' && !Array.isArray(infoResult.info) ? infoResult.info : {};

    const symbol =
      String(plan.symbol || technicalAnalysis?.symbol || extractTradingSymbolFromText(rawText) || 'BTCUSDT')
        .trim()
        .toUpperCase() || 'BTCUSDT';
    const sideByText = String(parsed.side || '').trim().toLowerCase();
    const sentimentScore = Number(plan.sentimentScore ?? infoPayload?.sentimentScore ?? NaN);
    const side =
      sideByText ||
      (['buy', 'sell'].includes(String(plan.side || '').trim().toLowerCase()) ? String(plan.side || '').trim().toLowerCase() : '') ||
      (Number.isFinite(sentimentScore) && sentimentScore < 0 ? 'sell' : 'buy');

    const orderTypeByDirective = String(parsed.orderType || '').trim().toLowerCase();
    const existingOrderType = String(plan.orderType || '').trim().toLowerCase();
    const orderType =
      orderTypeByDirective === 'limit' || orderTypeByDirective === 'market'
        ? orderTypeByDirective
        : existingOrderType === 'limit' || existingOrderType === 'market'
          ? existingOrderType
          : 'market';
    const tifByDirective = String(parsed.tif || '').trim();
    const tif = tifByDirective || (orderType === 'market' ? 'Ioc' : String(plan.tif || 'Gtc').trim() || 'Gtc');

    const quotePrice = Number(technicalQuote?.priceUsd ?? NaN);
    const directiveLimitPrice = Number(parsed.limitPrice ?? NaN);
    const currentEntry = Number(plan.entryPrice ?? NaN);
    let entryPrice = Number.isFinite(directiveLimitPrice) && directiveLimitPrice > 0
      ? directiveLimitPrice
      : Number.isFinite(currentEntry) && currentEntry > 0
        ? currentEntry
        : NaN;
    if ((!Number.isFinite(entryPrice) || entryPrice <= 0) && Number.isFinite(quotePrice) && quotePrice > 0) {
      entryPrice = side === 'sell' ? quotePrice * 0.9992 : quotePrice * 1.0008;
    }

    const directiveSize = Number(parsed.size ?? NaN);
    const currentSize = Number(plan.size ?? NaN);
    const size = Number.isFinite(directiveSize) && directiveSize > 0
      ? Number(directiveSize.toFixed(6))
      : Number.isFinite(currentSize) && currentSize > 0
        ? Number(currentSize.toFixed(6))
        : 0.001;
    const basePriceForProtect = Number.isFinite(entryPrice) && entryPrice > 0 ? entryPrice : quotePrice;
    const explicitTakeProfit = Number(parsed.takeProfit ?? NaN);
    const explicitStopLoss = Number(parsed.stopLoss ?? NaN);
    const explicitTakeProfitPct = Number(parsed.takeProfitPct ?? NaN);
    const explicitStopLossPct = Number(parsed.stopLossPct ?? NaN);
    let takePrice = Number(plan.takePrice ?? NaN);
    let stopPrice = Number(plan.stopPrice ?? NaN);
    if (Number.isFinite(explicitTakeProfit) && explicitTakeProfit > 0) {
      takePrice = explicitTakeProfit;
    } else if (Number.isFinite(explicitTakeProfitPct) && explicitTakeProfitPct > 0 && Number.isFinite(basePriceForProtect) && basePriceForProtect > 0) {
      takePrice = side === 'sell' ? basePriceForProtect * (1 - explicitTakeProfitPct / 100) : basePriceForProtect * (1 + explicitTakeProfitPct / 100);
    }
    if (Number.isFinite(explicitStopLoss) && explicitStopLoss > 0) {
      stopPrice = explicitStopLoss;
    } else if (Number.isFinite(explicitStopLossPct) && explicitStopLossPct > 0 && Number.isFinite(basePriceForProtect) && basePriceForProtect > 0) {
      stopPrice = side === 'sell' ? basePriceForProtect * (1 + explicitStopLossPct / 100) : basePriceForProtect * (1 - explicitStopLossPct / 100);
    }
    if (parsed.wantsStopOrder && Number.isFinite(basePriceForProtect) && basePriceForProtect > 0) {
      if (!Number.isFinite(takePrice) || takePrice <= 0) {
        takePrice = side === 'sell' ? basePriceForProtect * 0.97 : basePriceForProtect * 1.03;
      }
      if (!Number.isFinite(stopPrice) || stopPrice <= 0) {
        stopPrice = side === 'sell' ? basePriceForProtect * 1.015 : basePriceForProtect * 0.985;
      }
    }

    const canPlaceOrder =
      ['buy', 'sell'].includes(side) &&
      Number.isFinite(size) &&
      size > 0 &&
      (orderType === 'market' || (Number.isFinite(entryPrice) && entryPrice > 0));
    const stopOrderEnabled = Number.isFinite(takePrice) && takePrice > 0 && Number.isFinite(stopPrice) && stopPrice > 0;

    let forceReason = '检测到明确下单参数，已按指令覆盖策略结果并执行。';
    if (!['buy', 'sell'].includes(side)) forceReason = '缺少买卖方向（buy/sell 或 买入/卖出）。';
    else if (!Number.isFinite(size) || size <= 0) forceReason = '下单数量无效（size/qty/数量 必须 > 0）。';
    else if (orderType === 'limit' && (!Number.isFinite(entryPrice) || entryPrice <= 0)) forceReason = '限价下单缺少可用价格（请提供 price/限价）。';
    else if (parsed.forceExecute) forceReason = '用户明确要求强制下单，已绕过策略阈值并按当前可用参数执行。';

    const orderParamLine =
      orderType === 'limit' && Number.isFinite(entryPrice) && entryPrice > 0
        ? `下单指令参数: ${symbol} ${side} ${orderType} size=${size} price=${roundPriceByMagnitude(entryPrice)}`
        : `下单指令参数: ${symbol} ${side} ${orderType} size=${size}`;
    const stopOrderLine =
      stopOrderEnabled
        ? `止盈止损参数: TP=${roundPriceByMagnitude(takePrice)} SL=${roundPriceByMagnitude(stopPrice)}`
        : '';
    const suffixLines = [
      '',
      parsed.forceExecute ? '强制下单覆盖: 已收到强制执行指令，跳过策略阈值检查。' : '下单参数覆盖: 已按你的订单指令覆盖默认策略参数。',
      orderParamLine
    ];
    if (stopOrderLine) suffixLines.push(stopOrderLine);

    return {
      ...plan,
      text: `${String(plan.text || '交易计划（规则版）').trim()}${suffixLines.join('\n')}`,
      symbol,
      decision: `force-${orderType}-${side}`,
      decisionReason: forceReason,
      side,
      orderType,
      tif,
      entryPrice: orderType === 'limit' && Number.isFinite(entryPrice) && entryPrice > 0 ? Number(entryPrice.toFixed(8)) : null,
      size,
      takePrice: stopOrderEnabled ? Number(takePrice.toFixed(8)) : null,
      stopPrice: stopOrderEnabled ? Number(stopPrice.toFixed(8)) : null,
      canPlaceOrder,
      forceOrder: parsed.forceExecute,
      forceOrderReason: forceReason,
      orderDirectiveApplied: true,
      stopOrderEnabled
    };
  }

  function buildAgent001TradePlan({
    rawText = '',
    intent = {},
    technical = null,
    info = null,
    returnObject = false
  } = {}) {
    const technicalResult =
      technical?.taskResult?.result && typeof technical.taskResult.result === 'object' && !Array.isArray(technical.taskResult.result)
        ? technical.taskResult.result
        : {};
    const infoResult =
      info?.taskResult?.result && typeof info.taskResult.result === 'object' && !Array.isArray(info.taskResult.result)
        ? info.taskResult.result
        : {};

    const analysis =
      technicalResult?.analysis && typeof technicalResult.analysis === 'object' && !Array.isArray(technicalResult.analysis)
        ? technicalResult.analysis
        : technicalResult?.technical && typeof technicalResult.technical === 'object' && !Array.isArray(technicalResult.technical)
          ? technicalResult.technical
          : {};
    const risk =
      technicalResult?.risk && typeof technicalResult.risk === 'object' && !Array.isArray(technicalResult.risk)
        ? technicalResult.risk
        : {};
    const quote =
      technicalResult?.quote && typeof technicalResult.quote === 'object' && !Array.isArray(technicalResult.quote)
        ? technicalResult.quote
        : analysis?.quote && typeof analysis.quote === 'object' && !Array.isArray(analysis.quote)
          ? analysis.quote
          : {};
    const infoPayload =
      infoResult?.info && typeof infoResult.info === 'object' && !Array.isArray(infoResult.info)
        ? infoResult.info
        : {};

    const symbol =
      String(
        analysis?.symbol ||
          risk?.symbol ||
          intent?.symbol ||
          extractTradingSymbolFromText(rawText) ||
          'BTCUSDT'
      )
        .trim()
        .toUpperCase() || 'BTCUSDT';
    const horizonMin = Number.isFinite(Number(intent?.horizonMin))
      ? Math.max(5, Math.min(Math.round(Number(intent.horizonMin)), 240))
      : Number.isFinite(Number(risk?.horizonMin))
        ? Math.max(5, Math.min(Math.round(Number(risk.horizonMin)), 240))
        : extractHorizonFromText(rawText);
    const priceUsd = Number(quote?.priceUsd ?? NaN);
    const riskScoreRaw = Number(risk?.score ?? analysis?.riskScore ?? NaN);
    const riskScore = Number.isFinite(riskScoreRaw) ? Math.max(5, Math.min(95, Math.round(riskScoreRaw))) : 50;
    const riskLevel = String(risk?.level || toRiskLevel(riskScore)).trim().toLowerCase() || toRiskLevel(riskScore);
    const sentimentScore = Number(infoPayload?.sentimentScore ?? NaN);
    const sentimentConfidence = Number(infoPayload?.confidence ?? NaN);
    const signals =
      analysis?.signals && typeof analysis.signals === 'object' && !Array.isArray(analysis.signals)
        ? analysis.signals
        : {};
    const riskBand =
      analysis?.riskBand && typeof analysis.riskBand === 'object' && !Array.isArray(analysis.riskBand)
        ? analysis.riskBand
        : {};
    const stopLossPct = clampNumber(riskBand?.stopLossPct, 0.2, 20, 1.5);
    const takeProfitPct = clampNumber(riskBand?.takeProfitPct, 0.4, 40, 3);

    const sideDecision = pickTradeDecisionSide({
      trend: signals?.trend,
      momentum: signals?.momentum,
      bias: signals?.bias,
      sentimentScore
    });

    let decision = 'no-order';
    let decisionReason = '';
    if (riskScore > 65) {
      decision = 'no-order';
      decisionReason = `风险分 ${riskScore}/100 偏高，先观望`;
    } else if (sideDecision.side === 'long') {
      decision = 'long-limit';
      decisionReason = '技术面与消息面偏多，执行挂单做多';
    } else if (sideDecision.side === 'short') {
      decision = 'short-limit';
      decisionReason = '技术面与消息面偏空，执行挂单做空';
    } else {
      decision = 'no-order';
      decisionReason = '信号冲突或强度不足，暂不挂单';
    }

    let entryPrice = NaN;
    let stopPrice = NaN;
    let takePrice = NaN;
    if (Number.isFinite(priceUsd) && priceUsd > 0 && decision === 'long-limit') {
      entryPrice = priceUsd * (1 - 0.0012);
      stopPrice = entryPrice * (1 - stopLossPct / 100);
      takePrice = entryPrice * (1 + takeProfitPct / 100);
    } else if (Number.isFinite(priceUsd) && priceUsd > 0 && decision === 'short-limit') {
      entryPrice = priceUsd * (1 + 0.0012);
      stopPrice = entryPrice * (1 + stopLossPct / 100);
      takePrice = entryPrice * (1 - takeProfitPct / 100);
    }

    const positionPct = riskScore >= 55 ? 20 : riskScore >= 45 ? 30 : 40;
    const orderSize = riskScore <= 35 ? 0.004 : riskScore <= 50 ? 0.003 : riskScore <= 65 ? 0.002 : 0;
    const technicalSummary = String(technicalResult?.summary || technical?.reason || technical?.error || '').trim();
    const infoSummary = String(infoResult?.summary || info?.reason || info?.error || '').trim();
    const sentimentText = Number.isFinite(sentimentScore)
      ? `${sentimentScore.toFixed(3)}${Number.isFinite(sentimentConfidence) ? ` (置信度 ${sentimentConfidence.toFixed(2)})` : ''}`
      : 'N/A';

    const lines = [
      '交易计划（规则版）',
      `标的: ${symbol} | 周期: ${horizonMin}m`,
      `决策: ${
        decision === 'long-limit' ? '挂单做多' : decision === 'short-limit' ? '挂单做空' : '不挂单'
      }`,
      `决策理由: ${decisionReason}`,
      `风险: ${riskScore}/100 (${riskLevel}) | 消息情绪: ${sentimentText}`,
      `信号评分: long=${sideDecision.longScore}, short=${sideDecision.shortScore}`
    ];

    if (decision !== 'no-order' && Number.isFinite(entryPrice) && Number.isFinite(stopPrice) && Number.isFinite(takePrice)) {
      lines.push(`入场挂单: ${roundPriceByMagnitude(entryPrice)}`);
      lines.push(`止损: ${roundPriceByMagnitude(stopPrice)} (${stopLossPct.toFixed(2)}%)`);
      lines.push(`止盈: ${roundPriceByMagnitude(takePrice)} (${takeProfitPct.toFixed(2)}%)`);
      lines.push(`下单数量(BTC): ${orderSize}`);
      lines.push(`建议仓位: 账户可用保证金的 ${positionPct}%`);
      lines.push('订单失效: 30 分钟未成交则撤单重评');
    } else if (decision !== 'no-order') {
      lines.push('入场挂单: 当前缺少有效价格，先请求最新报价后再下单');
    } else {
      lines.push('执行建议: 等待下一轮信号（建议 15-30 分钟后重评）');
    }

    lines.push(`技术面摘要: ${technicalSummary || '暂无技术面摘要'}`);
    lines.push(`消息面摘要: ${infoSummary || '暂无消息面摘要'}`);
    if (sideDecision.reasons.length > 0) {
      lines.push(`规则依据: ${sideDecision.reasons.join('；')}`);
    }
    lines.push('提示: 仅用于研究与演示，不构成投资建议。');
    const text = lines.join('\n');
    const canPlaceOrder =
      decision !== 'no-order' && Number.isFinite(entryPrice) && entryPrice > 0 && Number.isFinite(orderSize) && orderSize > 0;
    const side = decision === 'long-limit' ? 'buy' : decision === 'short-limit' ? 'sell' : '';
    if (!returnObject) return text;
    return {
      text,
      symbol,
      horizonMin,
      decision,
      decisionReason,
      side,
      riskScore,
      riskLevel,
      sentimentScore: Number.isFinite(sentimentScore) ? Number(sentimentScore.toFixed(4)) : null,
      sentimentConfidence: Number.isFinite(sentimentConfidence) ? Number(sentimentConfidence.toFixed(4)) : null,
      entryPrice: Number.isFinite(entryPrice) ? Number(entryPrice.toFixed(8)) : null,
      stopPrice: Number.isFinite(stopPrice) ? Number(stopPrice.toFixed(8)) : null,
      takePrice: Number.isFinite(takePrice) ? Number(takePrice.toFixed(8)) : null,
      size: orderSize > 0 ? Number(orderSize.toFixed(6)) : null,
      orderType: 'limit',
      tif: 'Gtc',
      canPlaceOrder,
      technicalSummary,
      infoSummary
    };
  }

  return {
    buildAgent001TradePlan,
    coerceAgent001ForcedTradePlan,
    pickTradeDecisionSide,
    roundPriceByMagnitude
  };
}

export { createAgent001PlanningService };
