import fs from 'fs';
import path from 'path';
import { Agent, IdentifierKind, createSigner, createUser, filter } from '@xmtp/agent-sdk';

const MAX_DEDUPE_SET_SIZE = 2000;

function normalizeAddress(value = '') {
  const text = String(value || '').trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(text)) return '';
  return text.toLowerCase();
}

function normalizeAddressList(values = []) {
  const source = Array.isArray(values)
    ? values
    : String(values || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
  const out = [];
  for (const raw of source) {
    const normalized = normalizeAddress(raw);
    if (!normalized) continue;
    if (out.includes(normalized)) continue;
    out.push(normalized);
  }
  return out;
}

function normalizeText(value = '') {
  return String(value || '').trim();
}

function normalizeOptionalUrl(value = '') {
  const raw = normalizeText(value);
  if (!raw) return '';
  if (['null', 'none', 'disabled', 'off'].includes(raw.toLowerCase())) return 'null';
  return raw;
}

function normalizePrivateKey(value = '') {
  const raw = normalizeText(value);
  if (!raw) return '';
  const candidate = raw.startsWith('0x') ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(candidate)) return '';
  return candidate;
}

function normalizeHex(value = '') {
  const raw = normalizeText(value);
  if (!raw) return '';
  return raw.startsWith('0x') ? raw : `0x${raw}`;
}

function toIsoNow() {
  return new Date().toISOString();
}

function parseJsonObject(text = '') {
  const raw = normalizeText(text);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function sanitizeMockToken(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 40);
}

function buildMockTxHash(seed = '') {
  const token = sanitizeMockToken(seed) || Date.now().toString(36);
  return `mock_${token}`;
}

function rememberKey(set, key) {
  const normalized = normalizeText(key);
  if (!normalized) return;
  set.add(normalized);
  if (set.size <= MAX_DEDUPE_SET_SIZE) return;
  const oldest = set.values().next().value;
  if (oldest) set.delete(oldest);
}

function mapCanMessageResult(resultMap) {
  const out = {};
  if (!(resultMap instanceof Map)) return out;
  for (const [key, value] of resultMap.entries()) {
    out[String(key)] = Boolean(value);
  }
  return out;
}

function getFirstMapBoolean(resultMap) {
  if (!(resultMap instanceof Map)) return false;
  for (const value of resultMap.values()) {
    return Boolean(value);
  }
  return false;
}

export function createXmtpAgentRuntime(options = {}) {
  const readEvents = typeof options.readEvents === 'function' ? options.readEvents : () => [];
  const writeEvents = typeof options.writeEvents === 'function' ? options.writeEvents : () => {};
  const resolveAgentById =
    typeof options.resolveAgentById === 'function' ? options.resolveAgentById : () => null;
  const handleTaskEnvelope =
    typeof options.handleTaskEnvelope === 'function' ? options.handleTaskEnvelope : null;

  const eventRetention = Math.max(50, Math.min(Number(options.eventRetention || 600), 5000));
  const autoAck = Boolean(options.autoAck);
  const enabled = Boolean(options.enabled);
  const recoveryDelayMs = Math.max(500, Math.min(Number(options.recoveryDelayMs || 1500), 30_000));
  const recoveryCooldownMs = Math.max(2000, Math.min(Number(options.recoveryCooldownMs || 10_000), 120_000));
  const runtimeName = normalizeText(options.runtimeName || 'router-runtime') || 'router-runtime';
  const defaultAgentId = normalizeText(options.agentId || '');
  const configuredWalletKey = normalizePrivateKey(options.walletKey || '');
  const configuredDbEncryptionKey = normalizeHex(options.dbEncryptionKey || '');
  const configuredDbDirectory = normalizeText(options.dbDirectory || '');
  const configuredApiUrl = normalizeOptionalUrl(options.apiUrl || process.env.XMTP_API_URL || '');
  const configuredHistorySyncUrl = normalizeOptionalUrl(
    options.historySyncUrl !== undefined ? options.historySyncUrl : process.env.XMTP_HISTORY_SYNC_URL || ''
  );
  const configuredGatewayHost = normalizeOptionalUrl(
    options.gatewayHost || process.env.XMTP_GATEWAY_HOST || ''
  );

  const state = {
    enabled,
    configured: false,
    running: false,
    runtimeName,
    agentId: defaultAgentId,
    env: normalizeText(process.env.XMTP_ENV || options.env || 'dev').toLowerCase() || 'dev',
    address: '',
    inboxId: '',
    startedAt: '',
    stoppedAt: '',
    lastError: '',
    processedInbound: 0,
    ignoredInbound: 0,
    sentOutbound: 0,
    autoAckCount: 0,
    recovering: false,
    recoveryCount: 0
  };

  const seenMessageIds = new Set();
  const seenTaskIds = new Set();
  let agent = null;
  let recoveryTimer = null;
  let recoveryInFlight = false;
  let recoveryLastAt = 0;

  function appendEvent(input = {}) {
    const rows = Array.isArray(readEvents()) ? readEvents() : [];
    const event = {
      id: normalizeText(input.id) || `xmtp_evt_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      createdAt: toIsoNow(),
      direction: normalizeText(input.direction) || 'internal',
      event: normalizeText(input.event) || 'unknown',
      runtimeName,
      agentId: normalizeText(input.agentId || state.agentId || defaultAgentId),
      fromAgentId: normalizeText(input.fromAgentId),
      kind: normalizeText(input.kind),
      channel: normalizeText(input.channel),
      hopIndex: Number.isFinite(Number(input.hopIndex)) ? Number(input.hopIndex) : null,
      traceId: normalizeText(input.traceId),
      requestId: normalizeText(input.requestId),
      taskId: normalizeText(input.taskId),
      conversationId: normalizeText(input.conversationId),
      messageId: normalizeText(input.messageId),
      senderInboxId: normalizeText(input.senderInboxId),
      senderAddress: normalizeAddress(input.senderAddress),
      toAddress: normalizeAddress(input.toAddress),
      toAgentId: normalizeText(input.toAgentId),
      text: normalizeText(input.text),
      parsed: input.parsed && typeof input.parsed === 'object' && !Array.isArray(input.parsed) ? input.parsed : null,
      meta: input.meta && typeof input.meta === 'object' && !Array.isArray(input.meta) ? input.meta : null,
      error: normalizeText(input.error)
    };
    rows.unshift(event);
    if (rows.length > eventRetention) rows.length = eventRetention;
    writeEvents(rows);
    return event;
  }

  function getStatus() {
    return {
      ...state,
      autoAck,
      eventRetention,
      runtimeName,
      recoveryDelayMs,
      recoveryCooldownMs,
      apiUrl: configuredApiUrl && configuredApiUrl !== 'null' ? configuredApiUrl : '',
      historySyncUrl: configuredHistorySyncUrl,
      gatewayHost: configuredGatewayHost && configuredGatewayHost !== 'null' ? configuredGatewayHost : '',
      events: Array.isArray(readEvents()) ? readEvents().length : 0
    };
  }

  async function runRecovery(trigger = '', detail = '') {
    if (!enabled || recoveryInFlight) return;
    recoveryInFlight = true;
    state.recovering = true;
    state.recoveryCount += 1;
    appendEvent({
      direction: 'internal',
      event: 'runtime_recovery_started',
      error: normalizeText(detail),
      meta: {
        trigger: normalizeText(trigger),
        recoveryCount: state.recoveryCount
      }
    });
    try {
      await stop();
      const next = await start();
      appendEvent({
        direction: 'internal',
        event: next?.running ? 'runtime_recovery_succeeded' : 'runtime_recovery_failed',
        error: next?.running ? '' : normalizeText(next?.lastError || 'recovery_start_failed'),
        meta: {
          trigger: normalizeText(trigger),
          running: Boolean(next?.running)
        }
      });
    } catch (error) {
      state.lastError = normalizeText(error?.message || 'runtime_recovery_failed');
      appendEvent({
        direction: 'internal',
        event: 'runtime_recovery_failed',
        error: state.lastError,
        meta: {
          trigger: normalizeText(trigger)
        }
      });
    } finally {
      recoveryLastAt = Date.now();
      state.recovering = false;
      recoveryInFlight = false;
    }
  }

  function scheduleRecovery(trigger = '', detail = '') {
    if (!enabled) return;
    if (recoveryTimer || recoveryInFlight) return;
    const now = Date.now();
    if (recoveryLastAt && now - recoveryLastAt < recoveryCooldownMs) return;
    recoveryTimer = setTimeout(() => {
      recoveryTimer = null;
      void runRecovery(trigger, detail);
    }, recoveryDelayMs);
    appendEvent({
      direction: 'internal',
      event: 'runtime_recovery_scheduled',
      error: normalizeText(detail),
      meta: {
        trigger: normalizeText(trigger),
        delayMs: recoveryDelayMs
      }
    });
  }

  function resolveAddress(input = {}) {
    const direct = normalizeAddress(input.toAddress || '');
    if (direct) return { toAddress: direct, toAgentId: normalizeText(input.toAgentId) };
    const toAgentId = normalizeText(input.toAgentId);
    if (!toAgentId) return { toAddress: '', toAgentId: '' };
    const resolved = resolveAgentById(toAgentId);
    return {
      toAddress: normalizeAddress(resolved?.xmtpAddress || resolved?.address || ''),
      toAgentId
    };
  }

  async function canMessageAddress(address = '') {
    const toAddress = normalizeAddress(address);
    if (!toAddress) {
      return {
        ok: false,
        canMessage: false,
        reason: 'invalid_to_address',
        details: {}
      };
    }
    if (!agent?.client) {
      return {
        ok: false,
        canMessage: false,
        reason: 'xmtp_not_running',
        details: {}
      };
    }
    try {
      const identifier = {
        identifier: toAddress,
        identifierKind: IdentifierKind.Ethereum
      };
      const result = await agent.client.canMessage([identifier]);
      const details = mapCanMessageResult(result);
      const canMessage = details[toAddress] ?? getFirstMapBoolean(result);
      return {
        ok: true,
        canMessage: Boolean(canMessage),
        reason: '',
        details
      };
    } catch (error) {
      return {
        ok: false,
        canMessage: false,
        reason: normalizeText(error?.message || 'can_message_failed'),
        details: {}
      };
    }
  }

  async function resolveGroupConversation(groupId = '') {
    const normalizedGroupId = normalizeText(groupId);
    if (!normalizedGroupId || !agent?.client?.conversations) return null;
    try {
      const conversation = await agent.client.conversations.getConversationById(normalizedGroupId);
      if (!conversation || !filter.isGroup(conversation)) return null;
      return conversation;
    } catch {
      return null;
    }
  }

  function isAckPayload(payload = {}) {
    const kind = normalizeText(payload.kind || '').toLowerCase();
    return kind === 'task-ack' || kind === 'ack';
  }

  async function buildAutoTaskResultPayload(taskEnvelope = {}, runtimeContext = {}) {
    const sourceAgentId = normalizeText(taskEnvelope.fromAgentId || '');
    const sourceTaskId = normalizeText(taskEnvelope.taskId || '');
    const sourceTraceId = normalizeText(taskEnvelope.traceId || '');
    const sourceRequestId = normalizeText(taskEnvelope.requestId || '');
    const channel = normalizeText(taskEnvelope.channel || 'dm') || 'dm';
    const mode = normalizeText(taskEnvelope.mode || 'a2a') || 'a2a';
    const capability = normalizeText(taskEnvelope.capability || '');
    const input =
      taskEnvelope.input && typeof taskEnvelope.input === 'object' && !Array.isArray(taskEnvelope.input)
        ? taskEnvelope.input
        : {};
    const paymentIntent =
      taskEnvelope.paymentIntent && typeof taskEnvelope.paymentIntent === 'object' && !Array.isArray(taskEnvelope.paymentIntent)
        ? taskEnvelope.paymentIntent
        : {};
    const paymentMode = normalizeText(paymentIntent.mode || 'mock').toLowerCase() || 'mock';
    const mockTxHash = buildMockTxHash(sourceTaskId || sourceRequestId || sourceTraceId || capability || 'task_result');
    const paymentTxHash = normalizeText(paymentIntent.txHash || '') || mockTxHash;
    const paymentBlock = Number.isFinite(Number(paymentIntent.block)) ? Number(paymentIntent.block) : null;
    const paymentStatus = normalizeText(paymentIntent.status || '');
    const paymentExplorer = normalizeText(paymentIntent.explorer || '');
    const paymentVerifiedAt = normalizeText(paymentIntent.verifiedAt || '');

    const symbol = normalizeText(input.symbol || '').toUpperCase() || 'BTCUSDT';
    const horizonMinRaw = Number(input.horizonMin);
    const horizonMin = Number.isFinite(horizonMinRaw) && horizonMinRaw > 0 ? Math.round(horizonMinRaw) : 60;
    const source = normalizeText(input.source || '') || 'router-risk-demo';

    let status = 'done';
    let errorText = '';
    let resultPayload =
      capability === 'risk-score-feed'
        ? {
            summary: `Risk result ready for ${symbol} (${horizonMin}m).`,
            symbol,
            horizonMin,
            source,
            riskScore: 67,
            confidence: 'medium',
            signals: ['momentum_flat', 'volatility_moderate']
          }
        : {
            summary: capability ? `${capability} task processed by ${state.agentId || defaultAgentId}.` : 'Task processed.',
            capability,
            source
          };
    let paymentDetails = {
      mode: paymentMode,
      requestId: sourceRequestId,
      txHash: paymentTxHash,
      block: paymentBlock,
      status: paymentStatus,
      explorer: paymentExplorer,
      verifiedAt: paymentVerifiedAt
    };
    let receiptRef = {
      requestId: sourceRequestId,
      txHash: paymentTxHash,
      block: paymentBlock,
      status: paymentStatus,
      explorer: paymentExplorer,
      verifiedAt: paymentVerifiedAt,
      endpoint: sourceRequestId ? `/api/receipt/${sourceRequestId}` : ''
    };

    if (handleTaskEnvelope) {
      try {
        const handled = await handleTaskEnvelope({
          envelope: taskEnvelope,
          runtime: {
            runtimeName,
            agentId: state.agentId || defaultAgentId,
            address: state.address,
            env: state.env
          },
          context: runtimeContext
        });
        if (handled && typeof handled === 'object') {
          const nextStatus = normalizeText(handled.status || '').toLowerCase();
          if (nextStatus === 'failed') status = 'failed';
          else if (nextStatus === 'done') status = 'done';
          if (handled.result && typeof handled.result === 'object' && !Array.isArray(handled.result)) {
            resultPayload = handled.result;
          }
          if (handled.error !== undefined) {
            errorText = normalizeText(handled.error || '');
            if (errorText) status = 'failed';
          }
          if (handled.payment && typeof handled.payment === 'object' && !Array.isArray(handled.payment)) {
            paymentDetails = {
              ...paymentDetails,
              mode: normalizeText(handled.payment.mode || paymentDetails.mode).toLowerCase() || paymentDetails.mode,
              requestId: normalizeText(handled.payment.requestId || paymentDetails.requestId),
              txHash: normalizeText(handled.payment.txHash || paymentDetails.txHash),
              block: Number.isFinite(Number(handled.payment.block))
                ? Number(handled.payment.block)
                : paymentDetails.block,
              status: normalizeText(handled.payment.status || paymentDetails.status).toLowerCase(),
              explorer: normalizeText(handled.payment.explorer || paymentDetails.explorer),
              verifiedAt: normalizeText(handled.payment.verifiedAt || paymentDetails.verifiedAt)
            };
          }
          if (handled.receiptRef && typeof handled.receiptRef === 'object' && !Array.isArray(handled.receiptRef)) {
            receiptRef = {
              ...receiptRef,
              requestId: normalizeText(handled.receiptRef.requestId || receiptRef.requestId),
              txHash: normalizeText(handled.receiptRef.txHash || receiptRef.txHash),
              block: Number.isFinite(Number(handled.receiptRef.block))
                ? Number(handled.receiptRef.block)
                : receiptRef.block,
              status: normalizeText(handled.receiptRef.status || receiptRef.status).toLowerCase(),
              explorer: normalizeText(handled.receiptRef.explorer || receiptRef.explorer),
              verifiedAt: normalizeText(handled.receiptRef.verifiedAt || receiptRef.verifiedAt),
              endpoint: normalizeText(handled.receiptRef.endpoint || receiptRef.endpoint)
            };
          }
        }
      } catch (error) {
        status = 'failed';
        errorText = normalizeText(error?.message || 'task_handler_failed');
      }
    }

    return {
      kind: 'task-result',
      protocolVersion: 'kite-agent-task-v1',
      traceId: sourceTraceId,
      requestId: sourceRequestId,
      taskId: sourceTaskId,
      fromAgentId: state.agentId || defaultAgentId,
      toAgentId: sourceAgentId,
      channel,
      hopIndex: Number.isFinite(Number(taskEnvelope.hopIndex)) ? Number(taskEnvelope.hopIndex) + 1 : 2,
      mode,
      capability,
      status,
      result: resultPayload,
      error: errorText,
      payment: paymentDetails,
      receiptRef,
      producedAt: toIsoNow()
    };
  }

  async function onIncomingMessage(ctx) {
    try {
      const message = ctx?.message;
      const messageId = normalizeText(message?.id || '');
      const conversationId = normalizeText(ctx?.conversation?.id || message?.conversationId || '');
      if (!messageId) return;

      if (seenMessageIds.has(messageId)) {
        state.ignoredInbound += 1;
        appendEvent({
          direction: 'inbound',
          event: 'ignored_duplicate_message',
          conversationId,
          messageId,
          senderInboxId: normalizeText(message?.senderInboxId || '')
        });
        return;
      }
      rememberKey(seenMessageIds, messageId);

      const fromSelf = filter.fromSelf(message, ctx.client) || normalizeText(message?.senderInboxId) === normalizeText(ctx?.client?.inboxId || '');
      if (fromSelf) {
        state.ignoredInbound += 1;
        appendEvent({
          direction: 'inbound',
          event: 'ignored_from_self',
          conversationId,
          messageId,
          senderInboxId: normalizeText(message?.senderInboxId || '')
        });
        return;
      }

      if (!ctx.isText()) {
        state.ignoredInbound += 1;
        appendEvent({
          direction: 'inbound',
          event: 'ignored_non_text',
          conversationId,
          messageId,
          senderInboxId: normalizeText(message?.senderInboxId || ''),
          meta: {
            contentType: normalizeText(message?.contentType?.typeId || 'unknown')
          }
        });
        return;
      }

      const senderAddress = normalizeAddress((await ctx.getSenderAddress()) || '');
      const text = normalizeText(message?.content || '');
      const parsed = parseJsonObject(text);
      const kind = normalizeText(parsed?.kind || '');
      const fromAgentId = normalizeText(parsed?.fromAgentId || '');
      const toAgentId = normalizeText(parsed?.toAgentId || '');
      const hopIndex = Number.isFinite(Number(parsed?.hopIndex)) ? Number(parsed.hopIndex) : null;
      const channel = normalizeText(parsed?.channel || 'dm');
      const taskId = normalizeText(parsed?.taskId || '');
      const traceId = normalizeText(parsed?.traceId || '');
      const requestId = normalizeText(parsed?.requestId || '');

      if (taskId && seenTaskIds.has(taskId)) {
        state.ignoredInbound += 1;
        appendEvent({
          direction: 'inbound',
          event: 'ignored_duplicate_task',
          conversationId,
          messageId,
          senderInboxId: normalizeText(message?.senderInboxId || ''),
          senderAddress,
          fromAgentId,
          toAgentId,
          kind,
          channel,
          hopIndex,
          taskId,
          traceId,
          requestId,
          text,
          parsed
        });
        return;
      }
      if (taskId) rememberKey(seenTaskIds, taskId);

      state.processedInbound += 1;
      appendEvent({
        direction: 'inbound',
        event: 'received_text',
        conversationId,
        messageId,
        senderInboxId: normalizeText(message?.senderInboxId || ''),
        senderAddress,
        fromAgentId,
        toAgentId,
        kind,
        channel,
        hopIndex,
        taskId,
        traceId,
        requestId,
        text,
        parsed
      });

      const shouldAutoReply =
        autoAck &&
        parsed &&
        normalizeText(parsed?.kind || '').toLowerCase() === 'task-envelope' &&
        !isAckPayload(parsed);
      if (!shouldAutoReply) return;

      const resultPayload = await buildAutoTaskResultPayload(parsed, {
        conversationId,
        messageId,
        senderInboxId: normalizeText(message?.senderInboxId || ''),
        senderAddress,
        text
      });
      const resultText = JSON.stringify(resultPayload);
      const resultMessageId =
        typeof ctx?.conversation?.sendText === 'function'
          ? await ctx.conversation.sendText(resultText)
          : await ctx.conversation.send(resultText);
      state.sentOutbound += 1;
      state.autoAckCount += 1;
      appendEvent({
        direction: 'outbound',
        event: 'auto_task_result_sent',
        conversationId,
        messageId: normalizeText(resultMessageId),
        toAddress: senderAddress,
        fromAgentId: state.agentId || defaultAgentId,
        toAgentId: fromAgentId,
        kind: 'task-result',
        channel,
        hopIndex: Number.isFinite(Number(resultPayload.hopIndex)) ? Number(resultPayload.hopIndex) : null,
        taskId,
        traceId,
        requestId,
        text: resultText,
        parsed: resultPayload
      });
    } catch (error) {
      state.lastError = normalizeText(error?.message || 'xmtp_incoming_handler_failed');
      appendEvent({
        direction: 'internal',
        event: 'incoming_handler_error',
        error: state.lastError
      });
      scheduleRecovery('incoming_handler_error', state.lastError);
    }
  }

  async function start() {
    if (!enabled) {
      state.lastError = 'xmtp_disabled';
      return getStatus();
    }
    if (state.running && agent) return getStatus();

    const walletKey = configuredWalletKey || normalizePrivateKey(process.env.XMTP_WALLET_KEY || '');
    state.configured = /^0x[0-9a-fA-F]{64}$/.test(walletKey);
    if (!state.configured) {
      state.lastError = 'xmtp_wallet_key_missing_or_invalid';
      return getStatus();
    }

    const dbEncryptionKey =
      configuredDbEncryptionKey || normalizeHex(process.env.XMTP_DB_ENCRYPTION_KEY || '');
    const dbDirectory =
      configuredDbDirectory || normalizeText(process.env.XMTP_DB_DIRECTORY || '');
    const signer = createSigner(createUser(walletKey));
    const createOptions = {
      env: state.env
    };
    if (configuredApiUrl && configuredApiUrl !== 'null') {
      createOptions.apiUrl = configuredApiUrl;
    }
    if (configuredHistorySyncUrl) {
      createOptions.historySyncUrl = configuredHistorySyncUrl === 'null' ? null : configuredHistorySyncUrl;
    }
    if (configuredGatewayHost && configuredGatewayHost !== 'null') {
      createOptions.gatewayHost = configuredGatewayHost;
    }
    if (dbEncryptionKey) createOptions.dbEncryptionKey = dbEncryptionKey;
    if (dbDirectory) {
      fs.mkdirSync(dbDirectory, { recursive: true, mode: 0o700 });
      createOptions.dbPath = (inboxId) => path.join(dbDirectory, `xmtp-${inboxId}.db3`);
    }

    try {
      agent = await Agent.create(signer, createOptions);
      agent.on('message', (ctx) => {
        void onIncomingMessage(ctx);
      });
      agent.on('unhandledError', (error) => {
        state.lastError = normalizeText(error?.message || 'xmtp_unhandled_error');
        appendEvent({
          direction: 'internal',
          event: 'unhandled_error',
          error: state.lastError
        });
        scheduleRecovery('unhandled_error', state.lastError);
      });
      await agent.start();

      state.address = normalizeAddress(agent.address || '');
      state.inboxId = normalizeText(agent.client?.inboxId || '');
      state.running = true;
      state.startedAt = toIsoNow();
      state.stoppedAt = '';
      state.lastError = '';
      appendEvent({
        direction: 'internal',
        event: 'runtime_started',
        meta: {
          env: state.env,
          inboxId: state.inboxId,
          address: state.address,
          runtimeName,
          agentId: state.agentId
        }
      });
      return getStatus();
    } catch (error) {
      state.running = false;
      state.lastError = normalizeText(error?.message || 'xmtp_start_failed');
      appendEvent({
        direction: 'internal',
        event: 'runtime_start_failed',
        error: state.lastError
      });
      return getStatus();
    }
  }

  async function stop() {
    if (recoveryTimer) {
      clearTimeout(recoveryTimer);
      recoveryTimer = null;
    }
    try {
      if (agent) {
        await agent.stop();
        agent.removeAllListeners();
      }
    } catch {
      // ignore stop errors
    } finally {
      agent = null;
      state.running = false;
      state.stoppedAt = toIsoNow();
      appendEvent({
        direction: 'internal',
        event: 'runtime_stopped'
      });
    }
    return getStatus();
  }

  function listEvents(input = {}) {
    const limit = Math.max(1, Math.min(Number(input.limit || 80), 500));
    const direction = normalizeText(input.direction).toLowerCase();
    const runtime = normalizeText(input.runtimeName);
    const fromAgentId = normalizeText(input.fromAgentId);
    const toAgentId = normalizeText(input.toAgentId);
    const conversationId = normalizeText(input.conversationId);
    const kind = normalizeText(input.kind);
    const traceId = normalizeText(input.traceId);
    const taskId = normalizeText(input.taskId);
    const requestId = normalizeText(input.requestId);
    return (Array.isArray(readEvents()) ? readEvents() : [])
      .filter((row) => {
        if (direction && normalizeText(row?.direction).toLowerCase() !== direction) return false;
        if (runtime && normalizeText(row?.runtimeName) !== runtime) return false;
        if (fromAgentId && normalizeText(row?.fromAgentId) !== fromAgentId) return false;
        if (toAgentId && normalizeText(row?.toAgentId) !== toAgentId) return false;
        if (conversationId && normalizeText(row?.conversationId) !== conversationId) return false;
        if (kind && normalizeText(row?.kind) !== kind) return false;
        if (traceId && normalizeText(row?.traceId) !== traceId) return false;
        if (taskId && normalizeText(row?.taskId) !== taskId) return false;
        if (requestId && normalizeText(row?.requestId) !== requestId) return false;
        return true;
      })
      .slice(0, limit);
  }

  async function sendDm(input = {}) {
    const text = normalizeText(input.text);
    const rawEnvelope = input?.envelope && typeof input.envelope === 'object' && !Array.isArray(input.envelope)
      ? input.envelope
      : null;
    const resolved = resolveAddress(input);
    const toAgentId = normalizeText(input.toAgentId || rawEnvelope?.toAgentId || resolved.toAgentId);
    const fromAgentId = normalizeText(
      input.fromAgentId || rawEnvelope?.fromAgentId || state.agentId || defaultAgentId
    );
    const channel = normalizeText(input.channel || rawEnvelope?.channel || 'dm') || 'dm';
    const hopIndex = Number.isFinite(Number(input.hopIndex))
      ? Number(input.hopIndex)
      : Number.isFinite(Number(rawEnvelope?.hopIndex))
        ? Number(rawEnvelope.hopIndex)
        : 1;
    const envelope =
      rawEnvelope
        ? {
            ...rawEnvelope,
            fromAgentId: fromAgentId || normalizeText(rawEnvelope.fromAgentId || ''),
            toAgentId: toAgentId || normalizeText(rawEnvelope.toAgentId || ''),
            channel,
            hopIndex
          }
        : null;
    const outboundBody = envelope ? JSON.stringify(envelope) : text;
    if (!outboundBody) {
      return {
        ok: false,
        error: 'xmtp_message_required',
        reason: 'Either `text` or `envelope` is required.'
      };
    }

    if (!state.running || !agent) {
      return {
        ok: false,
        error: 'xmtp_not_running',
        reason: state.lastError || 'XMTP runtime is not running.'
      };
    }

    if (!resolved.toAddress) {
      return {
        ok: false,
        error: 'xmtp_target_not_found',
        reason: 'Provide valid `toAddress` or resolvable `toAgentId`.'
      };
    }

    const canMessage = await canMessageAddress(resolved.toAddress);
    if (!canMessage.canMessage) {
      return {
        ok: false,
        error: 'xmtp_cannot_message',
        reason: canMessage.reason || 'Target cannot be messaged on XMTP.',
        target: {
          toAddress: resolved.toAddress,
          toAgentId: resolved.toAgentId
        },
        canMessage
      };
    }

    try {
      const dm = await agent.createDmWithAddress(resolved.toAddress);
      const messageId = normalizeText(
        typeof dm?.sendText === 'function' ? await dm.sendText(outboundBody) : await dm.send(outboundBody)
      );
      const parsed = envelope || parseJsonObject(outboundBody);
      const traceId = normalizeText((envelope && envelope.traceId) || input.traceId || '');
      const requestId = normalizeText((envelope && envelope.requestId) || input.requestId || '');
      const taskId = normalizeText((envelope && envelope.taskId) || input.taskId || '');
      const kind = normalizeText((envelope && envelope.kind) || parsed?.kind || '');

      state.sentOutbound += 1;
      appendEvent({
        direction: 'outbound',
        event: 'dm_sent',
        fromAgentId,
        toAgentId: toAgentId || resolved.toAgentId,
        kind,
        channel,
        hopIndex,
        conversationId: normalizeText(dm.id || ''),
        messageId,
        toAddress: resolved.toAddress,
        traceId,
        requestId,
        taskId,
        text: outboundBody,
        parsed,
        meta: {
          canMessage: canMessage.details
        }
      });

      return {
        ok: true,
        sentAt: toIsoNow(),
        conversationId: normalizeText(dm.id || ''),
        messageId,
        toAddress: resolved.toAddress,
        toAgentId: toAgentId || resolved.toAgentId,
        fromAgentId,
        kind,
        channel,
        hopIndex,
        traceId,
        requestId,
        taskId
      };
    } catch (error) {
      const reason = normalizeText(error?.message || 'xmtp_send_failed');
      state.lastError = reason;
      appendEvent({
        direction: 'internal',
        event: 'dm_send_failed',
        toAddress: resolved.toAddress,
        toAgentId: resolved.toAgentId,
        error: reason
      });
      return {
        ok: false,
        error: 'xmtp_send_failed',
        reason
      };
    }
  }

  async function ensureGroup(input = {}) {
    const requestedGroupId = normalizeText(input.groupId);
    const groupName = normalizeText(input.groupName || '');
    const groupDescription = normalizeText(input.groupDescription || '');
    const memberAddresses = normalizeAddressList(input.memberAddresses || []);

    if (!state.running || !agent) {
      return {
        ok: false,
        error: 'xmtp_not_running',
        reason: state.lastError || 'XMTP runtime is not running.'
      };
    }

    let group = await resolveGroupConversation(requestedGroupId);
    let created = false;
    if (!group) {
      if (memberAddresses.length === 0) {
        return {
          ok: false,
          error: 'xmtp_group_member_required',
          reason: 'Provide valid `memberAddresses` to create a group.'
        };
      }
      try {
        group = await agent.createGroupWithAddresses(memberAddresses);
        created = true;
      } catch (error) {
        const reason = normalizeText(error?.message || 'xmtp_group_create_failed');
        state.lastError = reason;
        appendEvent({
          direction: 'internal',
          event: 'group_create_failed',
          error: reason
        });
        return {
          ok: false,
          error: 'xmtp_group_create_failed',
          reason
        };
      }
    }

    const memberSyncErrors = [];
    if (memberAddresses.length > 0) {
      try {
        await agent.addMembersWithAddresses(group, memberAddresses);
      } catch (error) {
        const reason = normalizeText(error?.message || 'xmtp_group_add_members_failed');
        memberSyncErrors.push(reason);
      }
    }

    if (groupName) {
      try {
        await group.updateName(groupName);
      } catch {
        // ignore metadata update errors
      }
    }
    if (groupDescription) {
      try {
        await group.updateDescription(groupDescription);
      } catch {
        // ignore metadata update errors
      }
    }

    const members = await group.members().catch(() => []);
    const memberInboxIds = Array.isArray(members)
      ? members.map((item) => normalizeText(item?.inboxId || '')).filter(Boolean)
      : [];
    const groupId = normalizeText(group?.id || requestedGroupId);

    appendEvent({
      direction: 'internal',
      event: created ? 'group_created' : 'group_reused',
      kind: 'group',
      channel: 'group',
      conversationId: groupId,
      fromAgentId: state.agentId || defaultAgentId,
      parsed: {
        groupId,
        groupName,
        memberAddresses,
        memberInboxIds,
        created
      },
      meta: {
        memberSyncErrors
      }
    });

    return {
      ok: true,
      created,
      groupId,
      groupName: normalizeText(group?.name || groupName),
      groupDescription: normalizeText(group?.description || groupDescription),
      memberAddresses,
      memberInboxIds,
      memberSyncErrors
    };
  }

  async function sendGroup(input = {}) {
    const rawEnvelope =
      input?.envelope && typeof input.envelope === 'object' && !Array.isArray(input.envelope)
        ? input.envelope
        : null;
    const text = normalizeText(input.text || '');
    const payload = rawEnvelope ? JSON.stringify(rawEnvelope) : text;
    if (!payload) {
      return {
        ok: false,
        error: 'xmtp_message_required',
        reason: 'Either `text` or `envelope` is required.'
      };
    }
    if (!state.running || !agent) {
      return {
        ok: false,
        error: 'xmtp_not_running',
        reason: state.lastError || 'XMTP runtime is not running.'
      };
    }

    let group = await resolveGroupConversation(input.groupId);
    if (!group && input.createIfMissing) {
      const ensured = await ensureGroup({
        groupId: input.groupId,
        groupName: input.groupName,
        groupDescription: input.groupDescription,
        memberAddresses: input.memberAddresses
      });
      if (!ensured.ok || !ensured.groupId) return ensured;
      group = await resolveGroupConversation(ensured.groupId);
    }
    if (!group) {
      return {
        ok: false,
        error: 'xmtp_group_not_found',
        reason: 'Provide valid `groupId` or enable `createIfMissing` with `memberAddresses`.'
      };
    }

    const fromAgentId = normalizeText(
      input.fromAgentId || rawEnvelope?.fromAgentId || state.agentId || defaultAgentId
    );
    const channel = normalizeText(input.channel || rawEnvelope?.channel || 'group') || 'group';
    const hopIndex = Number.isFinite(Number(input.hopIndex))
      ? Number(input.hopIndex)
      : Number.isFinite(Number(rawEnvelope?.hopIndex))
        ? Number(rawEnvelope.hopIndex)
        : 1;

    const parsed = rawEnvelope || parseJsonObject(payload);
    const traceId = normalizeText((rawEnvelope && rawEnvelope.traceId) || input.traceId || '');
    const requestId = normalizeText((rawEnvelope && rawEnvelope.requestId) || input.requestId || '');
    const taskId = normalizeText((rawEnvelope && rawEnvelope.taskId) || input.taskId || '');
    const kind = normalizeText((rawEnvelope && rawEnvelope.kind) || parsed?.kind || '');

    try {
      const messageId = normalizeText(
        typeof group?.sendText === 'function' ? await group.sendText(payload) : await group.send(payload)
      );
      state.sentOutbound += 1;
      appendEvent({
        direction: 'outbound',
        event: 'group_sent',
        fromAgentId,
        kind,
        channel,
        hopIndex,
        conversationId: normalizeText(group.id || ''),
        messageId,
        traceId,
        requestId,
        taskId,
        text: payload,
        parsed
      });
      return {
        ok: true,
        sentAt: toIsoNow(),
        groupId: normalizeText(group.id || ''),
        messageId,
        fromAgentId,
        kind,
        channel,
        hopIndex,
        traceId,
        requestId,
        taskId
      };
    } catch (error) {
      const reason = normalizeText(error?.message || 'xmtp_group_send_failed');
      state.lastError = reason;
      appendEvent({
        direction: 'internal',
        event: 'group_send_failed',
        conversationId: normalizeText(group.id || ''),
        error: reason
      });
      return {
        ok: false,
        error: 'xmtp_group_send_failed',
        reason
      };
    }
  }

  return {
    start,
    stop,
    sendDm,
    ensureGroup,
    sendGroup,
    canMessageAddress,
    listEvents,
    getStatus
  };
}
