function assertDependency(name, value) {
  if (typeof value !== 'function') {
    throw new Error(`agent001_execution_missing_dependency:${name}`);
  }
}

function createAgent001ExecutionService(deps = {}) {
  const {
    fetchJsonResponseWithTimeout,
    buildInternalAgentHeaders,
    createTraceId,
    isTransientTransportError,
    waitMs,
    hasStrictX402Evidence,
    upsertAgent001ResultRecord,
    normalizeAddress,
    getXmtpRuntime,
    port
  } = deps;

  assertDependency('fetchJsonResponseWithTimeout', fetchJsonResponseWithTimeout);
  assertDependency('buildInternalAgentHeaders', buildInternalAgentHeaders);
  assertDependency('createTraceId', createTraceId);
  assertDependency('isTransientTransportError', isTransientTransportError);
  assertDependency('waitMs', waitMs);
  assertDependency('hasStrictX402Evidence', hasStrictX402Evidence);
  assertDependency('upsertAgent001ResultRecord', upsertAgent001ResultRecord);
  assertDependency('normalizeAddress', normalizeAddress);
  assertDependency('getXmtpRuntime', getXmtpRuntime);
  const safePort = Number(port || 0);
  if (!Number.isFinite(safePort) || safePort <= 0) {
    throw new Error('agent001_execution_missing_dependency:port');
  }

  async function runAgent001HyperliquidOrderWorkflow({
    plan = null,
    payer = '',
    sourceAgentId = 'router-agent',
    targetAgentId = 'executor-agent',
    traceId = ''
  } = {}) {
    if (!plan || typeof plan !== 'object') {
      throw new Error('trade_plan_missing');
    }
    const orderTimeoutMs = Math.max(10_000, Math.min(Number(process.env.AGENT001_ORDER_TIMEOUT_MS || 90_000), 300_000));
    const { response, payload } = await fetchJsonResponseWithTimeout(
      `http://127.0.0.1:${safePort}/api/workflow/hyperliquid-order/run`,
      {
        method: 'POST',
        headers: buildInternalAgentHeaders(),
        timeoutMs: orderTimeoutMs,
        label: 'agent001 hyperliquid-order workflow',
        body: JSON.stringify({
          traceId: traceId || createTraceId('agent001_order'),
          symbol: plan.symbol || 'BTCUSDT',
          side: plan.side || '',
          orderType: plan.orderType || 'limit',
          tif: plan.tif || 'Gtc',
          price: plan.entryPrice,
          size: plan.size,
          reduceOnly: plan.reduceOnly === true || String(plan.reduceOnly || '').trim().toLowerCase() === 'true',
          payer,
          sourceAgentId,
          targetAgentId,
          bindRealX402: true,
          strictBinding: true,
          simulate: plan.simulate === true || plan.dryRun === true
        })
      }
    );
    if (!response.ok || payload?.ok === false) {
      const workflow = payload?.workflow && typeof payload.workflow === 'object' ? payload.workflow : null;
      const steps = Array.isArray(workflow?.steps) ? workflow.steps : [];
      const lastNonFailedStep =
        [...steps]
          .reverse()
          .find((step) => String(step?.step || '').trim() && String(step?.step || '').trim() !== 'failed') || null;
      const failedStep = String(lastNonFailedStep?.step || '').trim();
      const requestId = String(payload?.requestId || payload?.payment?.requestId || workflow?.requestId || '').trim();
      const workflowTraceId = String(payload?.traceId || workflow?.traceId || '').trim();
      const reasonBase = String(payload?.reason || payload?.error || '').trim();
      const reason = reasonBase || `workflow/hyperliquid-order/run failed: HTTP ${response.status}`;
      const error = new Error(reason);
      error.httpStatus = Number(response.status || 0);
      error.requestId = requestId;
      error.workflowTraceId = workflowTraceId;
      error.failedStep = failedStep;
      error.workflow = workflow;
      throw error;
    }
    return payload;
  }

  async function runAgent001StopOrderWorkflow({
    symbol = 'BTCUSDT',
    takeProfit = NaN,
    stopLoss = NaN,
    quantity = NaN,
    payer = '',
    sourceAgentId = 'router-agent',
    targetAgentId = 'risk-agent',
    traceId = ''
  } = {}) {
    if (!Number.isFinite(Number(takeProfit)) || Number(takeProfit) <= 0) {
      throw new Error('stop_order_take_profit_required');
    }
    if (!Number.isFinite(Number(stopLoss)) || Number(stopLoss) <= 0) {
      throw new Error('stop_order_stop_loss_required');
    }
    const stopTimeoutMs = Math.max(12_000, Math.min(Number(process.env.AGENT001_STOP_ORDER_TIMEOUT_MS || 120_000), 300_000));
    const body = {
      traceId: traceId || createTraceId('agent001_stop_order'),
      symbol: String(symbol || 'BTCUSDT').trim().toUpperCase() || 'BTCUSDT',
      takeProfit: Number(takeProfit),
      stopLoss: Number(stopLoss),
      payer,
      sourceAgentId,
      targetAgentId
    };
    if (Number.isFinite(Number(quantity)) && Number(quantity) > 0) {
      body.quantity = Number(quantity);
    }
    const maxAttempts = Math.max(1, Math.min(Number(process.env.AGENT001_STOP_ORDER_RETRIES || 3), 6));
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const { response, payload } = await fetchJsonResponseWithTimeout(
          `http://127.0.0.1:${safePort}/api/workflow/stop-order/run`,
          {
            method: 'POST',
            headers: buildInternalAgentHeaders(),
            timeoutMs: stopTimeoutMs,
            label: 'agent001 stop-order workflow',
            body: JSON.stringify(body)
          }
        );
        if (!response.ok || payload?.ok === false) {
          throw new Error(String(payload?.reason || payload?.error || `workflow/stop-order/run failed: HTTP ${response.status}`).trim());
        }
        return payload;
      } catch (error) {
        lastError = error;
        const reason = String(error?.message || 'stop_order_failed').trim();
        const retryable = isTransientTransportError(reason) || reason.toLowerCase().includes('tls connection');
        if (!retryable || attempt >= maxAttempts) break;
        await waitMs(Math.min(2000 * attempt, 5000));
      }
    }
    throw lastError || new Error('stop_order_workflow_failed');
  }

  function buildAgent001FailureReply({ stage = '', capability = '', reason = '', requestId = '', txHash = '' } = {}) {
    const safeStage = String(stage || '').trim() || '-';
    const safeCapability = String(capability || '').trim() || '-';
    const safeReason = String(reason || 'unknown_error').trim() || 'unknown_error';
    const safeRequestId = String(requestId || '').trim();
    const safeTxHash = String(txHash || '').trim();
    const lowered = safeReason.toLowerCase();
    let code = 'agent001_failed';
    if (lowered.includes('timeout')) code = 'timeout';
    else if (lowered.includes('session_not_found')) code = 'session_not_found';
    else if (lowered.includes('session_agent_mismatch')) code = 'session_agent_mismatch';
    else if (lowered.includes('session_rule_failed')) code = 'session_rule_failed';
    else if (lowered.includes('invalid_session_id')) code = 'invalid_session_id';
    else if (lowered.includes('insufficient_funds')) code = 'insufficient_funds';
    else if (lowered.includes('insufficient_kite_gas')) code = 'insufficient_kite_gas';
    else if (lowered.includes('eth_estimateuseroperationgas') || lowered.includes('bundler') || lowered.includes('reverted')) code = 'bundler_reverted';

    const lines = [`失败: stage=${safeStage} capability=${safeCapability} code=${code}`, `reason: ${safeReason}`];
    if (safeRequestId) lines.push(`requestId: ${safeRequestId}`);
    if (safeTxHash) lines.push(`txHash: ${safeTxHash}`);
    if (safeRequestId) lines.push(`pull: /api/agent001/results/${safeRequestId}`);
    if (code === 'timeout') {
      lines.push('need: 请提供 /api/session/runtime 与最近 5 条 /api/x402/requests，定位 session/pay 队列阻塞。');
    } else if (['session_not_found', 'session_agent_mismatch', 'session_rule_failed', 'invalid_session_id'].includes(code)) {
      lines.push('need: 请先在 Agent Settings 同步 sessionId/sessionKey/AA payer。');
    } else if (['insufficient_funds', 'insufficient_kite_gas'].includes(code)) {
      lines.push('need: 请给 AA payer 充值 USDT 与 KITE gas。');
    } else if (code === 'bundler_reverted') {
      lines.push('need: 请提供 bundler 错误原文 + /api/session/runtime + 该 requestId 的 receipt。');
    }
    return lines.join('\n');
  }

  async function maybeSendAgent001ProgressDm({
    context = null,
    capability = '',
    summary = '',
    payment = null
  } = {}) {
    const senderAddress = normalizeAddress(context?.senderAddress || '');
    if (!senderAddress) return { ok: false, skipped: true, reason: 'sender_address_missing' };
    const requestId = String(payment?.requestId || '').trim();
    const txHash = String(payment?.txHash || '').trim();
    const label = capability === 'technical-analysis-feed' ? '技术面' : capability === 'info-analysis-feed' ? '消息面' : '分析';
    const lines = [`${label}结果已返回`, `summary: ${String(summary || '').trim() || '-'}`, `x402: requestId=${requestId || '-'} txHash=${txHash || '-'}`];
    if (requestId) lines.push(`pull: /api/agent001/results/${requestId}`);
    const result = await getXmtpRuntime().sendDm({
      fromAgentId: 'router-agent',
      toAddress: senderAddress,
      toAgentId: 'human-user',
      channel: 'dm',
      hopIndex: 1,
      text: lines.join('\n')
    });
    return result?.ok ? { ok: true } : { ok: false, skipped: false, reason: result?.reason || result?.error || 'xmtp_send_failed' };
  }

  async function maybeSendAgent001TradePlanDm({
    context = null,
    tradePlanText = '',
    infoPayment = null,
    technicalPayment = null
  } = {}) {
    const senderAddress = normalizeAddress(context?.senderAddress || '');
    if (!senderAddress) return { ok: false, skipped: true, reason: 'sender_address_missing' };
    const planText = String(tradePlanText || '').trim();
    if (!planText) return { ok: false, skipped: true, reason: 'trade_plan_missing' };

    const infoRequestId = String(infoPayment?.requestId || '').trim();
    const infoTxHash = String(infoPayment?.txHash || '').trim();
    const technicalRequestId = String(technicalPayment?.requestId || '').trim();
    const technicalTxHash = String(technicalPayment?.txHash || '').trim();
    const lines = ['AGENT001 交易计划', planText];
    if (infoRequestId || infoTxHash || technicalRequestId || technicalTxHash) {
      lines.push('');
      lines.push(`消息面 x402: requestId=${infoRequestId || '-'} txHash=${infoTxHash || '-'}`);
      lines.push(`技术面 x402: requestId=${technicalRequestId || '-'} txHash=${technicalTxHash || '-'}`);
      if (infoRequestId) lines.push(`消息面 pull: /api/agent001/results/${infoRequestId}`);
      if (technicalRequestId) lines.push(`技术面 pull: /api/agent001/results/${technicalRequestId}`);
    }
    const result = await getXmtpRuntime().sendDm({
      fromAgentId: 'router-agent',
      toAddress: senderAddress,
      toAgentId: 'human-user',
      channel: 'dm',
      hopIndex: 1,
      text: lines.join('\n')
    });
    return result?.ok ? { ok: true } : { ok: false, skipped: false, reason: result?.reason || result?.error || 'xmtp_send_failed' };
  }

  async function appendAgent001OrderExecutionLines({
    lines = [],
    plan = null,
    payer = '',
    orderDirectives = null,
    orderTraceId = 'agent001_trade_order',
    stopTraceId = 'agent001_trade_stop',
    failureStage = 'trade_order',
    resultSource = 'agent001_trade'
  } = {}) {
    const targetLines = Array.isArray(lines) ? lines : [];
    try {
      const orderResult = await runAgent001HyperliquidOrderWorkflow({
        plan,
        payer,
        sourceAgentId: 'router-agent',
        targetAgentId: 'executor-agent',
        traceId: createTraceId(orderTraceId)
      });
      const payment = orderResult?.payment || null;
      const receiptRef = orderResult?.receiptRef || null;
      if (!hasStrictX402Evidence(payment)) {
        return {
          ok: false,
          hardFailureReply: buildAgent001FailureReply({
            stage: failureStage,
            capability: 'hyperliquid-order-testnet',
            reason: 'order stage missing strict x402 evidence',
            requestId: String(payment?.requestId || orderResult?.requestId || '').trim(),
            txHash: String(payment?.txHash || orderResult?.txHash || '').trim()
          })
        };
      }

      targetLines.push('');
      targetLines.push('下单执行: 已触发 Hyperliquid 测试网下单。');
      targetLines.push(`order state: ${String(orderResult?.state || orderResult?.workflow?.state || '').trim() || '-'}`);
      targetLines.push(`x402 requestId: ${String(payment?.requestId || orderResult?.requestId || '').trim() || '-'}`);
      targetLines.push(`x402 txHash: ${String(payment?.txHash || orderResult?.txHash || '').trim() || '-'}`);
      targetLines.push(`receipt: ${String(receiptRef?.endpoint || '').trim() || '-'}`);

      const takePrice = Number(plan?.takePrice ?? NaN);
      const stopPrice = Number(plan?.stopPrice ?? NaN);
      const stopOrderEnabled =
        Number.isFinite(takePrice) &&
        takePrice > 0 &&
        Number.isFinite(stopPrice) &&
        stopPrice > 0 &&
        (plan?.stopOrderEnabled === true || orderDirectives?.wantsStopOrder === true);
      if (stopOrderEnabled) {
        try {
          const stopOrder = await runAgent001StopOrderWorkflow({
            symbol: plan?.symbol || 'BTCUSDT',
            takeProfit: takePrice,
            stopLoss: stopPrice,
            quantity: Number(plan?.size ?? NaN),
            payer,
            sourceAgentId: 'router-agent',
            targetAgentId: 'risk-agent',
            traceId: createTraceId(stopTraceId)
          });
          const stopRequestId = String(stopOrder?.requestId || '').trim();
          const stopTxHash = String(stopOrder?.txHash || '').trim();
          if (stopRequestId && stopTxHash) {
            upsertAgent001ResultRecord({
              requestId: stopRequestId,
              capability: 'reactive-stop-orders',
              stage: 'dispatch',
              status: 'done',
              toAgentId: 'risk-agent',
              payer,
              input: {
                symbol: plan?.symbol || 'BTCUSDT',
                takeProfit: takePrice,
                stopLoss: stopPrice,
                quantity: Number(plan?.size ?? NaN)
              },
              payment: {
                requestId: stopRequestId,
                txHash: stopTxHash
              },
              receiptRef: {
                requestId: stopRequestId,
                txHash: stopTxHash,
                endpoint: `/api/receipt/${stopRequestId}`
              },
              result: {
                summary: `Reactive TP/SL configured: ${plan?.symbol || 'BTCUSDT'} TP ${takePrice} SL ${stopPrice}`,
                workflowTraceId: String(stopOrder?.traceId || '').trim(),
                workflowState: String(stopOrder?.state || stopOrder?.workflow?.state || '').trim()
              },
              source: resultSource
            });
          }
          targetLines.push('');
          targetLines.push('止盈止损: 已触发 TP/SL 工作流。');
          targetLines.push(`tp/sl x402: requestId=${stopRequestId || '-'} txHash=${stopTxHash || '-'}`);
          if (stopRequestId) {
            targetLines.push(`tp/sl pull: /api/agent001/results/${stopRequestId}`);
          }
        } catch (stopError) {
          targetLines.push('');
          targetLines.push(`止盈止损设置失败: ${String(stopError?.message || 'unknown').trim()}`);
        }
      }
      return { ok: true };
    } catch (error) {
      targetLines.push('');
      targetLines.push(`下单执行失败: ${String(error?.message || 'unknown').trim()}`);
      return { ok: false };
    }
  }

  return {
    appendAgent001OrderExecutionLines,
    buildAgent001FailureReply,
    maybeSendAgent001ProgressDm,
    maybeSendAgent001TradePlanDm,
    runAgent001HyperliquidOrderWorkflow,
    runAgent001StopOrderWorkflow
  };
}

export { createAgent001ExecutionService };
