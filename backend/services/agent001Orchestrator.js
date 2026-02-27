function assertDependency(name, value) {
  if (typeof value !== 'function') {
    throw new Error(`agent001_orchestrator_missing_dependency:${name}`);
  }
}

function createAgent001Orchestrator(deps = {}) {
  const {
    normalizeAddress,
    readIdentityProfile,
    defaultAgentIdByCapability,
    ensureNetworkAgents,
    findNetworkAgentById,
    selectServiceCandidatesByCapability,
    readServiceInvocations,
    readWorkflows,
    readX402Requests,
    mapServiceReceipt,
    computeServiceReputation,
    pickBestServiceByReputationAndPrice,
    runAgent001DispatchTask,
    extractTradingSymbolFromText,
    extractHorizonFromText,
    extractFirstUrlFromText,
    buildRiskScorePaymentIntentForTask,
    buildInfoPaymentIntentForTask,
    createTraceId
  } = deps;

  assertDependency('normalizeAddress', normalizeAddress);
  assertDependency('readIdentityProfile', readIdentityProfile);
  assertDependency('defaultAgentIdByCapability', defaultAgentIdByCapability);
  assertDependency('ensureNetworkAgents', ensureNetworkAgents);
  assertDependency('findNetworkAgentById', findNetworkAgentById);
  assertDependency('selectServiceCandidatesByCapability', selectServiceCandidatesByCapability);
  assertDependency('readServiceInvocations', readServiceInvocations);
  assertDependency('readWorkflows', readWorkflows);
  assertDependency('readX402Requests', readX402Requests);
  assertDependency('mapServiceReceipt', mapServiceReceipt);
  assertDependency('computeServiceReputation', computeServiceReputation);
  assertDependency('pickBestServiceByReputationAndPrice', pickBestServiceByReputationAndPrice);
  assertDependency('runAgent001DispatchTask', runAgent001DispatchTask);
  assertDependency('extractTradingSymbolFromText', extractTradingSymbolFromText);
  assertDependency('extractHorizonFromText', extractHorizonFromText);
  assertDependency('extractFirstUrlFromText', extractFirstUrlFromText);
  assertDependency('buildRiskScorePaymentIntentForTask', buildRiskScorePaymentIntentForTask);
  assertDependency('buildInfoPaymentIntentForTask', buildInfoPaymentIntentForTask);
  assertDependency('createTraceId', createTraceId);

  async function readNetworkAgentIdentityStatus(agent = {}) {
    const registry = normalizeAddress(agent?.identityRegistry || '');
    const agentId = String(agent?.identityAgentId || '').trim();
    if (!registry || !agentId) {
      return { configured: false, verified: false, reason: 'identity_not_configured' };
    }
    try {
      const profile = await readIdentityProfile({ registry, agentId });
      return {
        configured: true,
        verified: true,
        registry,
        agentId,
        wallet: String(profile?.agentWallet || '').trim()
      };
    } catch (error) {
      return {
        configured: true,
        verified: false,
        registry,
        agentId,
        reason: String(error?.message || 'identity_verify_failed').trim()
      };
    }
  }

  async function selectAgent001ProviderPlan({ capability = '' } = {}) {
    const normalizedCapability = String(capability || '').trim().toLowerCase();
    const fallbackAgentId = defaultAgentIdByCapability(normalizedCapability);
    const networkRows = ensureNetworkAgents().filter((item) => item?.active !== false);
    const candidateAgents = networkRows.filter((item) =>
      Array.isArray(item?.capabilities)
        ? item.capabilities.map((c) => String(c || '').trim().toLowerCase()).includes(normalizedCapability)
        : false
    );
    const fallbackAgent = findNetworkAgentById(fallbackAgentId);
    const candidateMap = new Map();
    for (const row of candidateAgents) {
      const key = String(row?.id || '').trim().toLowerCase();
      if (key) candidateMap.set(key, row);
    }
    if (fallbackAgent?.active !== false) {
      const fallbackKey = String(fallbackAgent?.id || '').trim().toLowerCase();
      if (fallbackKey) candidateMap.set(fallbackKey, fallbackAgent);
    }
    const finalCandidates = Array.from(candidateMap.values());
    const identityRows = [];
    for (const agent of finalCandidates) {
      const identity = await readNetworkAgentIdentityStatus(agent);
      identityRows.push({ agent, identity });
    }
    const verifiedFirst = identityRows.filter((item) => item.identity?.verified);
    if (verifiedFirst.length === 0) {
      const reasonParts = identityRows.map((item) => {
        const id = String(item?.agent?.id || '').trim().toLowerCase() || 'unknown-agent';
        const status = item?.identity?.configured ? 'configured' : 'not-configured';
        const detail = String(item?.identity?.reason || '').trim();
        return `${id}:${status}${detail ? `(${detail})` : ''}`;
      });
      return {
        ok: false,
        error: 'identity_verification_required',
        reason: `Identity must be verified before quote negotiation for capability ${normalizedCapability}.`,
        details: reasonParts
      };
    }
    const pickedIdentityRow = verifiedFirst[0];
    const pickedAgent = pickedIdentityRow?.agent || null;
    const identity = pickedIdentityRow?.identity || { configured: false, verified: false };

    const services = selectServiceCandidatesByCapability(normalizedCapability);
    if (services.length === 0) {
      return {
        ok: false,
        error: 'service_unavailable',
        reason: `No active service found for capability ${normalizedCapability}.`
      };
    }
    const invocations = readServiceInvocations();
    const workflows = readWorkflows();
    const workflowByTraceId = new Map(workflows.map((item) => [String(item?.traceId || '').trim(), item]));
    const requests = readX402Requests();
    const requestById = new Map(requests.map((item) => [String(item?.requestId || '').trim(), item]));
    const verifiedAgentId = String(pickedAgent?.id || fallbackAgentId).trim().toLowerCase();
    const servicesByVerifiedProvider = services.filter(
      (service) => String(service?.providerAgentId || '').trim().toLowerCase() === verifiedAgentId
    );
    const candidateServices = servicesByVerifiedProvider.length > 0 ? servicesByVerifiedProvider : services;
    const rows = candidateServices.map((service) => {
      const perServiceInv = invocations.filter(
        (item) => String(item?.serviceId || '').trim() === String(service?.id || '').trim()
      );
      const receipts = perServiceInv.map((item) => mapServiceReceipt(item, workflowByTraceId, requestById));
      const reputation = computeServiceReputation(service, receipts);
      return { service, reputation };
    });
    const pickedService = pickBestServiceByReputationAndPrice(rows);
    if (!pickedService?.service) {
      return {
        ok: false,
        error: 'service_unavailable',
        reason: `No selectable service found for capability ${normalizedCapability}.`
      };
    }

    return {
      ok: true,
      capability: normalizedCapability,
      toAgentId: verifiedAgentId,
      agent: pickedAgent,
      identity,
      service: pickedService.service,
      reputation: pickedService.reputation,
      metrics: pickedService.metrics
    };
  }

  async function runAgent001QuoteNegotiation({
    toAgentId = '',
    wantedCapability = '',
    rawText = '',
    intent = {},
    waitMsLimit = 12_000
  } = {}) {
    const input = {
      wantedCapability: String(wantedCapability || '').trim().toLowerCase(),
      symbol: String(intent?.symbol || extractTradingSymbolFromText(rawText) || 'BTCUSDT').trim().toUpperCase(),
      horizonMin: Number.isFinite(Number(intent?.horizonMin))
        ? Math.max(5, Math.min(Math.round(Number(intent.horizonMin)), 240))
        : extractHorizonFromText(rawText),
      topic: String(intent?.topic || rawText || '').trim(),
      source: String(intent?.source || 'hyperliquid').trim().toLowerCase(),
      maxChars: 900
    };
    return runAgent001DispatchTask({
      toAgentId,
      capability: 'service-quote',
      input,
      waitMsLimit
    });
  }

  async function buildAgent001StrictPaymentPlan({
    capability = '',
    rawText = '',
    intent = {},
    payer = '',
    targetAgentId = ''
  } = {}) {
    const normalizedCapability = String(capability || '').trim().toLowerCase();
    if (normalizedCapability === 'technical-analysis-feed') {
      return buildRiskScorePaymentIntentForTask({
        body: {
          input: {
            symbol: intent?.symbol || extractTradingSymbolFromText(rawText) || 'BTCUSDT',
            source: intent?.source || 'hyperliquid',
            horizonMin: intent?.horizonMin || extractHorizonFromText(rawText)
          },
          bindRealX402: true,
          strictBinding: true,
          prebindOnly: true,
          action: 'technical-analysis-feed',
          payer,
          sourceAgentId: 'router-agent',
          targetAgentId: targetAgentId || 'technical-agent'
        },
        traceId: createTraceId('agent001_pay_tech'),
        fallbackRequestId: createTraceId('agent001_req_tech'),
        defaultTask: { symbol: 'BTCUSDT', source: 'hyperliquid', horizonMin: 60 }
      });
    }
    if (normalizedCapability === 'info-analysis-feed') {
      const rawTopic = String(intent?.topic || '').trim();
      const rawUrl = String(extractFirstUrlFromText(rawText) || '').trim();
      const fallbackTopic = String(rawText || '').trim();
      const defaultTopic = `${String(intent?.symbol || 'BTCUSDT').trim().toUpperCase()} market sentiment`;
      const resolvedTopic = rawTopic || rawUrl || fallbackTopic || defaultTopic;
      return buildInfoPaymentIntentForTask({
        body: {
          input: {
            url: /^https?:\/\//i.test(resolvedTopic) ? resolvedTopic : '',
            topic: resolvedTopic,
            mode: 'auto',
            maxChars: 900
          },
          bindRealX402: true,
          strictBinding: true,
          prebindOnly: true,
          action: 'info-analysis-feed',
          payer,
          sourceAgentId: 'router-agent',
          targetAgentId: targetAgentId || 'message-agent'
        },
        traceId: createTraceId('agent001_pay_info'),
        fallbackRequestId: createTraceId('agent001_req_info'),
        defaultTask: { url: 'https://www.coindesk.com/', mode: 'news', maxChars: 900 }
      });
    }
    throw new Error(`unsupported_payment_capability:${normalizedCapability}`);
  }

  return {
    readNetworkAgentIdentityStatus,
    selectAgent001ProviderPlan,
    runAgent001QuoteNegotiation,
    buildAgent001StrictPaymentPlan
  };
}

export { createAgent001Orchestrator };
