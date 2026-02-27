export function createX402ReceiptService({ readX402Requests, readWorkflows } = {}) {
  if (typeof readX402Requests !== 'function') {
    throw new Error('createX402ReceiptService requires readX402Requests function');
  }
  if (typeof readWorkflows !== 'function') {
    throw new Error('createX402ReceiptService requires readWorkflows function');
  }

  function mapX402Item(item = {}, workflow = null) {
    const paidAt = Number(item.paidAt || 0);
    const createdAt = Number(item.createdAt || 0);
    return {
      requestId: item.requestId || '',
      action: item.action || '',
      flowMode: item.a2a ? 'a2a+x402' : 'agent-to-api+x402',
      sourceAgentId: item?.a2a?.sourceAgentId || '',
      targetAgentId: item?.a2a?.targetAgentId || '',
      agentId: item?.identity?.agentId || '',
      payer: item.payer || '',
      amount: item.amount || '',
      status: item.status || '',
      paidAt: paidAt > 0 ? new Date(paidAt).toISOString() : '',
      createdAt: createdAt > 0 ? new Date(createdAt).toISOString() : '',
      paymentTxHash: item.paymentTxHash || item?.paymentProof?.txHash || '',
      query: item.query || '',
      tokenAddress: item.tokenAddress || '',
      recipient: item.recipient || '',
      workflowState: workflow?.state || '',
      workflowTraceId: workflow?.traceId || item?.a2a?.traceId || '',
      workflowUpdatedAt: workflow?.updatedAt || workflow?.createdAt || '',
      workflowError: workflow?.error || '',
      policyDecision: item?.policy?.decision || '',
      identity: item.identity || null
    };
  }

  function buildLatestWorkflowByRequestId(workflows = []) {
    const index = new Map();
    for (const item of workflows) {
      const requestId = String(item?.requestId || '').trim();
      if (!requestId) continue;
      const prev = index.get(requestId);
      const prevTs = new Date(prev?.updatedAt || prev?.createdAt || 0).getTime();
      const currTs = new Date(item?.updatedAt || item?.createdAt || 0).getTime();
      if (!prev || currTs >= prevTs) {
        index.set(requestId, item);
      }
    }
    return index;
  }

  function parsePositiveNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? num : NaN;
  }

  function buildDemoPriceSeries(limitInput = 60) {
    const limit = Math.max(10, Math.min(Number(limitInput || 60), 300));
    const workflowByRequestId = buildLatestWorkflowByRequestId(readWorkflows());
    const dedup = new Map();

    for (const item of readX402Requests()) {
      if (!item || typeof item !== 'object') continue;
      const requestId = String(item.requestId || '').trim();
      if (!requestId) continue;
      const action = String(item.action || '').trim().toLowerCase();
      const status = String(item.status || '').trim().toLowerCase();
      if (action !== 'btc-price-feed' || status !== 'paid') continue;

      const workflow = workflowByRequestId.get(requestId) || null;
      const quote = item?.result?.quote || workflow?.result?.quote || null;
      const priceUsd = parsePositiveNumber(quote?.priceUsd);
      if (!Number.isFinite(priceUsd)) continue;

      const fetchedAtRaw = String(
        quote?.fetchedAt ||
          workflow?.updatedAt ||
          workflow?.createdAt ||
          (Number(item.paidAt || 0) > 0 ? new Date(Number(item.paidAt)).toISOString() : '') ||
          (Number(item.createdAt || 0) > 0 ? new Date(Number(item.createdAt)).toISOString() : '')
      ).trim();
      const fetchedMs = Date.parse(fetchedAtRaw);
      if (!Number.isFinite(fetchedMs)) continue;

      const nextRow = {
        t: new Date(fetchedMs).toISOString(),
        priceUsd: Number(priceUsd.toFixed(6)),
        provider: String(quote?.provider || '').trim().toLowerCase() || 'unknown',
        traceId: String(workflow?.traceId || item?.a2a?.traceId || '').trim(),
        requestId
      };
      const prev = dedup.get(requestId);
      if (!prev || Date.parse(prev.t) <= fetchedMs) {
        dedup.set(requestId, nextRow);
      }
    }

    const series = [...dedup.values()]
      .sort((a, b) => Date.parse(a.t) - Date.parse(b.t))
      .slice(-limit);

    return { limit, series };
  }

  function toIsoFromMs(value) {
    const ms = Number(value || 0);
    return ms > 0 ? new Date(ms).toISOString() : '';
  }

  function normalizeExecutionState(value = '', fallback = 'running') {
    const raw = String(value || '').trim().toLowerCase();
    if (['unlocked', 'success', 'ok', 'completed', 'paid'].includes(raw)) return 'success';
    if (['failed', 'error', 'expired', 'rejected'].includes(raw)) return 'failed';
    if (['running', 'pending', 'processing'].includes(raw)) return 'running';
    return fallback;
  }

  function buildA2AReceipt(requestItem = {}, workflow = null, overrides = {}) {
    const requestId = String(requestItem.requestId || '').trim();
    const workflowTraceId = String(workflow?.traceId || '').trim();
    const linkedTraceId = String(requestItem?.a2a?.traceId || '').trim();
    const traceId = String(overrides.traceId || workflowTraceId || linkedTraceId).trim();
    const sourceAgentId = String(overrides.sourceAgentId || requestItem?.a2a?.sourceAgentId || '').trim();
    const targetAgentId = String(overrides.targetAgentId || requestItem?.a2a?.targetAgentId || '').trim();
    const capability = String(overrides.capability || requestItem?.a2a?.taskType || requestItem.action || '').trim();
    const requestStatus = String(requestItem.status || '').trim().toLowerCase();
    const state = normalizeExecutionState(
      overrides.state || workflow?.state || requestStatus || 'running',
      'running'
    );
    const paymentTxHash = String(requestItem.paymentTxHash || requestItem?.paymentProof?.txHash || '').trim();
    const createdAt = toIsoFromMs(requestItem.createdAt);
    const paidAt = toIsoFromMs(requestItem.paidAt);
    const updatedAt = String(
      overrides.updatedAt || workflow?.updatedAt || workflow?.createdAt || paidAt || createdAt || new Date().toISOString()
    ).trim();
    const phase = String(
      overrides.phase ||
        (state === 'failed'
          ? 'failed'
          : requestStatus === 'paid'
            ? state === 'success'
              ? 'settled'
              : 'paid'
            : 'payment_required')
    ).trim();

    const links = {
      workflow: traceId ? `/api/workflow/${traceId}` : '',
      evidence: traceId ? `/api/evidence/export?traceId=${encodeURIComponent(traceId)}` : ''
    };

    return {
      protocol: 'x402-a2a-v1',
      interactionId: requestId,
      traceId,
      sourceAgentId,
      targetAgentId,
      capability,
      state,
      phase,
      query: String(requestItem.query || '').trim(),
      payment: {
        requestId,
        status: requestStatus || '',
        payer: String(requestItem.payer || '').trim(),
        amount: String(requestItem.amount || '').trim(),
        tokenAddress: String(requestItem.tokenAddress || '').trim(),
        recipient: String(requestItem.recipient || '').trim(),
        txHash: paymentTxHash
      },
      timing: {
        createdAt,
        paidAt,
        updatedAt
      },
      result: {
        summary: String(workflow?.result?.summary || overrides.summary || '').trim(),
        error: String(workflow?.error || overrides.error || '').trim()
      },
      links
    };
  }

  function listA2AReceipts(input = {}) {
    const sourceFilter = String(input.sourceAgentId || '').trim().toLowerCase();
    const targetFilter = String(input.targetAgentId || '').trim().toLowerCase();
    const capabilityFilter = String(input.capability || '').trim().toLowerCase();
    const stateFilter = String(input.state || '').trim().toLowerCase();
    const limit = Math.max(1, Math.min(Number(input.limit || 50), 500));

    const workflows = readWorkflows();
    const workflowByRequestId = buildLatestWorkflowByRequestId(workflows);
    const receipts = readX402Requests()
      .filter((item) => item?.a2a && (item?.a2a?.sourceAgentId || item?.a2a?.targetAgentId))
      .map((item) =>
        buildA2AReceipt(item, workflowByRequestId.get(String(item?.requestId || '').trim()) || null, {
          traceId: item?.a2a?.traceId || ''
        })
      )
      .filter((row) => {
        const sourceOk = !sourceFilter || String(row.sourceAgentId || '').toLowerCase() === sourceFilter;
        const targetOk = !targetFilter || String(row.targetAgentId || '').toLowerCase() === targetFilter;
        const capabilityOk = !capabilityFilter || String(row.capability || '').toLowerCase() === capabilityFilter;
        const stateOk = !stateFilter || String(row.state || '').toLowerCase() === stateFilter;
        return sourceOk && targetOk && capabilityOk && stateOk;
      });
    return receipts.slice(0, limit);
  }

  function buildA2ANetworkGraph(receipts = []) {
    const edges = new Map();
    const nodes = new Map();

    function ensureNode(agentId = '') {
      const key = String(agentId || '').trim();
      if (!key) return null;
      if (!nodes.has(key)) {
        nodes.set(key, {
          agentId: key,
          outCount: 0,
          inCount: 0,
          successCount: 0,
          failedCount: 0,
          runningCount: 0,
          outAmount: 0,
          inAmount: 0
        });
      }
      return nodes.get(key);
    }

    for (const receipt of receipts) {
      const source = String(receipt.sourceAgentId || '').trim();
      const target = String(receipt.targetAgentId || '').trim();
      const capability = String(receipt.capability || 'unknown').trim();
      if (!source || !target) continue;
      const amount = Number(receipt?.payment?.amount || 0);
      const safeAmount = Number.isFinite(amount) ? amount : 0;
      const state = normalizeExecutionState(receipt.state, 'running');

      const edgeKey = `${source}->${target}::${capability}`;
      if (!edges.has(edgeKey)) {
        edges.set(edgeKey, {
          edgeId: edgeKey,
          sourceAgentId: source,
          targetAgentId: target,
          capability,
          totalCount: 0,
          successCount: 0,
          failedCount: 0,
          runningCount: 0,
          totalAmount: 0,
          latestAt: '',
          lastState: '',
          lastTxHash: ''
        });
      }
      const edge = edges.get(edgeKey);
      edge.totalCount += 1;
      edge.totalAmount = Number((edge.totalAmount + safeAmount).toFixed(6));
      if (state === 'success') edge.successCount += 1;
      else if (state === 'failed') edge.failedCount += 1;
      else edge.runningCount += 1;
      const updatedAt = String(receipt?.timing?.updatedAt || '').trim();
      if (!edge.latestAt || new Date(updatedAt).getTime() >= new Date(edge.latestAt).getTime()) {
        edge.latestAt = updatedAt;
        edge.lastState = state;
        edge.lastTxHash = String(receipt?.payment?.txHash || '').trim();
      }

      const sourceNode = ensureNode(source);
      const targetNode = ensureNode(target);
      if (sourceNode) {
        sourceNode.outCount += 1;
        sourceNode.outAmount = Number((sourceNode.outAmount + safeAmount).toFixed(6));
        if (state === 'success') sourceNode.successCount += 1;
        else if (state === 'failed') sourceNode.failedCount += 1;
        else sourceNode.runningCount += 1;
      }
      if (targetNode) {
        targetNode.inCount += 1;
        targetNode.inAmount = Number((targetNode.inAmount + safeAmount).toFixed(6));
        if (state === 'success') targetNode.successCount += 1;
        else if (state === 'failed') targetNode.failedCount += 1;
        else targetNode.runningCount += 1;
      }
    }

    const edgeRows = Array.from(edges.values()).sort((a, b) => {
      const atA = Number.isFinite(Date.parse(a.latestAt || '')) ? Date.parse(a.latestAt || '') : 0;
      const atB = Number.isFinite(Date.parse(b.latestAt || '')) ? Date.parse(b.latestAt || '') : 0;
      return atB - atA;
    });
    const nodeRows = Array.from(nodes.values()).sort((a, b) => (b.outCount + b.inCount) - (a.outCount + a.inCount));

    return {
      protocol: 'x402-a2a-v1',
      generatedAt: new Date().toISOString(),
      nodeCount: nodeRows.length,
      edgeCount: edgeRows.length,
      nodes: nodeRows,
      edges: edgeRows
    };
  }

  function computeDashboardKpi(items = []) {
    let pending = 0;
    let paid = 0;
    let failed = 0;
    let todaySpend = 0;
    const now = Date.now();
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayStartMs = dayStart.getTime();

    for (const item of items) {
      const status = String(item.status || '').toLowerCase();
      const createdAt = Number(item.createdAt || 0);
      const expiresAt = Number(item.expiresAt || 0);
      if (status === 'paid') {
        paid += 1;
        const paidAtMs = Number(item.paidAt || createdAt || 0);
        if (paidAtMs >= dayStartMs) {
          const amount = Number(item.amount || 0);
          if (Number.isFinite(amount)) {
            todaySpend += amount;
          }
        }
      } else if (status === 'pending') {
        if (expiresAt > 0 && now > expiresAt) {
          failed += 1;
        } else {
          pending += 1;
        }
      } else if (status === 'failed' || status === 'rejected' || status === 'error' || status === 'expired') {
        failed += 1;
      }
    }

    return {
      pending,
      paid,
      failed,
      todaySpend: Number(todaySpend.toFixed(6))
    };
  }

  return {
    mapX402Item,
    buildLatestWorkflowByRequestId,
    buildDemoPriceSeries,
    normalizeExecutionState,
    buildA2AReceipt,
    listA2AReceipts,
    buildA2ANetworkGraph,
    computeDashboardKpi
  };
}
