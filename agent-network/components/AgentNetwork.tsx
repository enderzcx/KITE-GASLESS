"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BaseEdge,
  ConnectionLineType,
  Controls,
  Edge,
  EdgeLabelRenderer,
  EdgeProps,
  Handle,
  MarkerType,
  MiniMap,
  Node,
  NodeProps,
  Position,
  ReactFlow,
  getBezierPath,
  useEdgesState,
  useNodesState,
} from "reactflow";
import { motion } from "framer-motion";
import {
  Activity,
  Bot,
  Check,
  CirclePause,
  ClipboardCopy,
  Cpu,
  Play,
  RotateCcw,
  Server,
  ShieldCheck,
  SkipForward,
  Sparkles,
  Wallet,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import "reactflow/dist/style.css";

export type FlowMode = "unified";
export type PlaybackState = "idle" | "playing" | "paused" | "completed";
type PaymentPhase = "challenge" | "pay+proof" | "verify" | "unlock";

export type FlowStepId =
  | "erc8004_verify"
  | "xmtp_quote_request"
  | "xmtp_quote_return"
  | "x402_settlement"
  | "xmtp_service_result"
  | "api_order_decision";

export interface FlowStep {
  id: FlowStepId;
  index: 1 | 2 | 3 | 4 | 5 | 6;
  title: string;
  description: string;
  durationMs: number;
}

export interface AuditLogEntry {
  id: string;
  tsISO: string;
  tsLocal: string;
  mode: FlowMode;
  stepId: FlowStepId;
  stepName: string;
  blockchainVerifiable: true;
  verificationHash?: string;
  xmtpSnippet?: string;
  receiptRef?: string;
  decisionBasis?: string;
  payload: Record<string, unknown>;
}

export interface AgentNetworkProps {
  backendBaseUrl?: string;
  auditMaxEntries?: number;
}

type NodeKind = "agent" | "protocol" | "settlement" | "api" | "decision";
type EdgeChannel = "xmtp" | "x402" | "erc8004" | "decision" | "api";

interface NetworkNodeData {
  title: string;
  subtitle: string;
  kind: NodeKind;
  status?: "idle" | "active";
}

interface NetworkEdgeData {
  label: string;
  channel: EdgeChannel;
  active?: boolean;
  dimmed?: boolean;
  labelOffsetX?: number;
  labelOffsetY?: number;
  curvature?: number;
}

const COLORS: Record<EdgeChannel, string> = {
  xmtp: "#38bdf8",
  x402: "#22c55e",
  erc8004: "#a855f7",
  decision: "#f59e0b",
  api: "#f97316",
};

const X402_PHASES: PaymentPhase[] = ["challenge", "pay+proof", "verify", "unlock"];
const QUOTE_CAP = 0.00024;
const EXECUTION_THRESHOLD = 0.62;

export const FLOW_STEPS: FlowStep[] = [
  { id: "erc8004_verify", index: 1, title: "Step 1 · ERC8004 Verification", description: "Agent001 verifies collaborator agents on-chain.", durationMs: 1300 },
  { id: "xmtp_quote_request", index: 2, title: "Step 2 · XMTP DM Quote Request", description: "Agent001 asks message/technical agents for service quotes.", durationMs: 1500 },
  { id: "xmtp_quote_return", index: 3, title: "Step 3 · XMTP DM Quote Return", description: "Agents return quotes and Agent001 decides whether to pay.", durationMs: 1600 },
  { id: "x402_settlement", index: 4, title: "Step 4 · x402 Payment", description: "challenge -> pay+proof -> unlock for paid service access.", durationMs: 2500 },
  { id: "xmtp_service_result", index: 5, title: "Step 5 · XMTP DM Service Result", description: "Paid service results are returned to Agent001 over DM.", durationMs: 1700 },
  { id: "api_order_decision", index: 6, title: "Step 6 · Agent001 API Order Decision", description: "Agent001 decides whether to call API order execution.", durationMs: 1300 },
];

export const NETWORK_NODES: Node<NetworkNodeData>[] = [
  { id: "erc8004", type: "network", position: { x: 610, y: 56 }, data: { title: "ERC8004", subtitle: "Registration · Authentication · Reputation · Agent Discovery", kind: "protocol" } },
  { id: "message-agent", type: "network", position: { x: 92, y: 224 }, data: { title: "Message Agent", subtitle: "News & Sentiment Signal", kind: "agent" } },
  { id: "technical-agent", type: "network", position: { x: 92, y: 452 }, data: { title: "Technical Agent", subtitle: "Indicator & Risk Signal", kind: "agent" } },
  { id: "agent001", type: "network", position: { x: 574, y: 334 }, data: { title: "Agent001", subtitle: "Signal Aggregator & Executor", kind: "agent" } },
  { id: "decision-hub", type: "network", position: { x: 574, y: 534 }, data: { title: "Decision Hub", subtitle: "Should call API order?", kind: "decision" } },
  { id: "x402", type: "network", position: { x: 920, y: 542 }, data: { title: "x402 Settlement", subtitle: "challenge -> pay -> proof -> unlock", kind: "settlement" } },
  { id: "trading-api", type: "network", position: { x: 1248, y: 334 }, data: { title: "Trading API", subtitle: "Web2 Order Service", kind: "api" } },
];

export const NETWORK_EDGES: Edge<NetworkEdgeData>[] = [
  { id: "erc-msg", type: "glow", source: "erc8004", target: "message-agent", sourceHandle: "s-left", targetHandle: "t-top", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.erc8004 }, data: { label: "", channel: "erc8004", curvature: 0.28 } },
  { id: "erc-tech", type: "glow", source: "erc8004", target: "technical-agent", sourceHandle: "s-left", targetHandle: "t-top", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.erc8004 }, data: { label: "", channel: "erc8004", curvature: 0.35 } },
  { id: "quote-req-msg", type: "glow", source: "agent001", target: "message-agent", sourceHandle: "s-left", targetHandle: "t-right", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.xmtp }, data: { label: "① DM quote request (Message Agent)", channel: "xmtp", labelOffsetY: -30, curvature: 0.28 } },
  { id: "quote-req-tech", type: "glow", source: "agent001", target: "technical-agent", sourceHandle: "s-left", targetHandle: "t-right", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.xmtp }, data: { label: "① DM quote request (Technical Agent)", channel: "xmtp", labelOffsetY: 28, curvature: 0.16 } },
  { id: "quote-res-msg", type: "glow", source: "message-agent", target: "agent001", sourceHandle: "s-top", targetHandle: "t-top", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.xmtp }, data: { label: "② DM quote return", channel: "xmtp", labelOffsetY: -54, curvature: 0.4 } },
  { id: "quote-res-tech", type: "glow", source: "technical-agent", target: "agent001", sourceHandle: "s-bottom", targetHandle: "t-bottom", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.xmtp }, data: { label: "② DM quote return", channel: "xmtp", labelOffsetY: 54, curvature: 0.4 } },
  { id: "pay-to-x402", type: "glow", source: "agent001", target: "x402", sourceHandle: "s-bottom", targetHandle: "t-top", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.x402 }, data: { label: "③ pay + proof", channel: "x402", labelOffsetY: -6, curvature: 0.24 } },
  { id: "unlock-msg", type: "glow", source: "x402", target: "message-agent", sourceHandle: "s-left", targetHandle: "t-bottom", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.x402 }, data: { label: "④ unlock message service", channel: "x402", labelOffsetX: -28, labelOffsetY: -22, curvature: 0.34 } },
  { id: "unlock-tech", type: "glow", source: "x402", target: "technical-agent", sourceHandle: "s-left", targetHandle: "t-bottom", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.x402 }, data: { label: "④ unlock technical service", channel: "x402", labelOffsetX: -12, labelOffsetY: 20, curvature: 0.24 } },
  { id: "result-msg", type: "glow", source: "message-agent", target: "agent001", sourceHandle: "s-right", targetHandle: "t-left", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.xmtp }, data: { label: "⑤ DM service result", channel: "xmtp", labelOffsetY: -10, curvature: 0.22 } },
  { id: "result-tech", type: "glow", source: "technical-agent", target: "agent001", sourceHandle: "s-right", targetHandle: "t-left", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.xmtp }, data: { label: "⑤ DM service result", channel: "xmtp", labelOffsetY: 18, curvature: 0.15 } },
  { id: "agent-to-decision", type: "glow", source: "agent001", target: "decision-hub", sourceHandle: "s-bottom", targetHandle: "t-top", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.decision }, data: { label: "⑥ decide to call API order", channel: "decision", labelOffsetX: 12, labelOffsetY: -5, curvature: 0.2 } },
  { id: "decision-to-api", type: "glow", source: "decision-hub", target: "trading-api", sourceHandle: "s-right", targetHandle: "t-bottom", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.api }, data: { label: "⑥ API order request", channel: "api", labelOffsetX: 14, labelOffsetY: -8, curvature: 0.22 } },
  { id: "api-to-agent", type: "glow", source: "trading-api", target: "agent001", sourceHandle: "s-left", targetHandle: "t-right", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.api }, data: { label: "⑥ API result + receiptRef", channel: "api", labelOffsetY: -18, curvature: 0.24 } },
];

const ICONS: Record<NodeKind, typeof Bot> = {
  agent: Bot,
  protocol: ShieldCheck,
  settlement: Wallet,
  api: Server,
  decision: Cpu,
};

const BORDERS: Record<NodeKind, string> = {
  agent: "rgba(56, 189, 248, 0.75)",
  protocol: "rgba(168, 85, 247, 0.8)",
  settlement: "rgba(34, 197, 94, 0.78)",
  api: "rgba(249, 115, 22, 0.78)",
  decision: "rgba(245, 158, 11, 0.78)",
};

function shortHash(v: string): string {
  if (!v) return "-";
  if (v.length < 18) return v;
  return `${v.slice(0, 10)}...${v.slice(-6)}`;
}

function randomHex(n = 64): string {
  const bytes = new Uint8Array(Math.ceil(n / 2));
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, n)}`;
}

async function fetchJSON<T>(url: string, init: RequestInit = {}, timeout = 7000): Promise<T> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    window.clearTimeout(timer);
  }
}

function highlights(step: FlowStepId, quoteAccepted: boolean | null, shouldOrder: boolean | null) {
  if (step === "erc8004_verify") return { nodes: ["erc8004", "message-agent", "technical-agent"], edges: ["erc-msg", "erc-tech"] };
  if (step === "xmtp_quote_request") return { nodes: ["agent001", "message-agent", "technical-agent"], edges: ["quote-req-msg", "quote-req-tech"] };
  if (step === "xmtp_quote_return") return { nodes: ["agent001", "message-agent", "technical-agent"], edges: ["quote-res-msg", "quote-res-tech"] };
  if (step === "x402_settlement") {
    if (!quoteAccepted) return { nodes: ["agent001"], edges: [] };
    return { nodes: ["agent001", "x402", "message-agent", "technical-agent"], edges: ["pay-to-x402", "unlock-msg", "unlock-tech"] };
  }
  if (step === "xmtp_service_result") {
    if (!quoteAccepted) return { nodes: ["agent001"], edges: [] };
    return { nodes: ["agent001", "message-agent", "technical-agent"], edges: ["result-msg", "result-tech"] };
  }
  if (step === "api_order_decision") {
    if (!quoteAccepted) return { nodes: ["agent001", "decision-hub"], edges: ["agent-to-decision"] };
    if (!shouldOrder) return { nodes: ["agent001", "decision-hub"], edges: ["agent-to-decision"] };
    return { nodes: ["agent001", "decision-hub", "trading-api"], edges: ["agent-to-decision", "decision-to-api", "api-to-agent"] };
  }
  return { nodes: [], edges: [] };
}

function NetworkNode({ data }: NodeProps<NetworkNodeData>) {
  const Icon = ICONS[data.kind];
  const active = data.status === "active";
  return (
    <motion.div
      animate={{ scale: active ? 1.03 : 1, boxShadow: active ? `0 0 26px ${BORDERS[data.kind]}` : "none" }}
      className="min-w-[220px] rounded-2xl border bg-black/55 px-4 py-3 text-white backdrop-blur-lg"
      style={{ borderColor: BORDERS[data.kind] }}
    >
      <Handle id="t-top" type="target" position={Position.Top} className="!opacity-0" />
      <Handle id="t-left" type="target" position={Position.Left} className="!opacity-0" />
      <Handle id="t-right" type="target" position={Position.Right} className="!opacity-0" />
      <Handle id="t-bottom" type="target" position={Position.Bottom} className="!opacity-0" />
      <Handle id="s-top" type="source" position={Position.Top} className="!opacity-0" />
      <Handle id="s-left" type="source" position={Position.Left} className="!opacity-0" />
      <Handle id="s-right" type="source" position={Position.Right} className="!opacity-0" />
      <Handle id="s-bottom" type="source" position={Position.Bottom} className="!opacity-0" />
      <div className="mb-1 flex items-center gap-2">
        <span className="inline-flex size-7 items-center justify-center rounded-full border" style={{ borderColor: BORDERS[data.kind] }}>
          <Icon className="size-4" />
        </span>
        <span className="text-[15px] font-semibold">{data.title}</span>
      </div>
      <p className="text-[12px] text-slate-200">{data.subtitle}</p>
    </motion.div>
  );
}

function GlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps<NetworkEdgeData>) {
  const [path, x, y] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: data?.curvature ?? 0.24,
  });
  const color = COLORS[data?.channel ?? "api"];
  const active = Boolean(data?.active);
  const dim = Boolean(data?.dimmed);
  const dashed = data?.channel === "erc8004";
  const showLabel = Boolean(data?.label);

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: color,
          strokeWidth: active ? 3 : 2,
          opacity: dim ? 0.15 : active ? 1 : 0.72,
          filter: active ? `drop-shadow(0 0 8px ${color})` : "none",
          strokeDasharray: dashed ? "8 6" : active ? "14 8" : undefined,
          animation: active ? "edge-dash 1.2s linear infinite" : undefined,
        }}
      />
      {showLabel ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan rounded-full border border-white/20 bg-black/70 px-2 py-1 text-[11px] text-white"
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              whiteSpace: "nowrap",
              transform: `translate(-50%, -50%) translate(${x + (data?.labelOffsetX ?? 0)}px, ${y + (data?.labelOffsetY ?? -8)}px)`,
            }}
          >
            {data?.label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

const nodeTypes = { network: NetworkNode };
const edgeTypes = { glow: GlowEdge };

export default function AgentNetwork({ backendBaseUrl, auditMaxEntries = 200 }: AgentNetworkProps) {
  const mode: FlowMode = "unified";
  const [nodes, , onNodesChange] = useNodesState(NETWORK_NODES);
  const [edges, , onEdgesChange] = useEdgesState(NETWORK_EDGES);
  const [playback, setPlayback] = useState<PlaybackState>("idle");
  const [stepIndex, setStepIndex] = useState(-1);
  const [activeNodeIds, setActiveNodeIds] = useState<string[]>([]);
  const [activeEdgeIds, setActiveEdgeIds] = useState<string[]>([]);
  const [audit, setAudit] = useState<AuditLogEntry[]>([]);
  const [dmOpen, setDmOpen] = useState(false);
  const [x402Open, setX402Open] = useState(false);
  const [x402Phase, setX402Phase] = useState<PaymentPhase>("challenge");
  const [quoteAccepted, setQuoteAccepted] = useState<boolean | null>(null);
  const [shouldOrder, setShouldOrder] = useState<boolean | null>(null);
  const [decision, setDecision] = useState("Pending quote negotiation.");
  const [verificationHash, setVerificationHash] = useState("");
  const [messageQuote, setMessageQuote] = useState(0);
  const [technicalQuote, setTechnicalQuote] = useState(0);
  const [messageSnippet, setMessageSnippet] = useState("");
  const [technicalSnippet, setTechnicalSnippet] = useState("");
  const [messageScore, setMessageScore] = useState(0);
  const [technicalScore, setTechnicalScore] = useState(0);
  const [receiptRef, setReceiptRef] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const timerRef = useRef<number | null>(null);
  const x402TimerRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const playbackRef = useRef<PlaybackState>("idle");
  const quoteAcceptedRef = useRef<boolean | null>(null);
  const shouldOrderRef = useRef<boolean | null>(null);
  const baseUrl = backendBaseUrl || process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:3001";

  useEffect(() => {
    playbackRef.current = playback;
  }, [playback]);
  useEffect(() => {
    quoteAcceptedRef.current = quoteAccepted;
  }, [quoteAccepted]);
  useEffect(() => {
    shouldOrderRef.current = shouldOrder;
  }, [shouldOrder]);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      if (x402TimerRef.current) window.clearInterval(x402TimerRef.current);
    },
    []
  );

  const appendAudit = useCallback(
    (entry: Omit<AuditLogEntry, "id" | "tsISO" | "tsLocal">) => {
      const now = new Date();
      const row: AuditLogEntry = {
        ...entry,
        id: `${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`,
        tsISO: now.toISOString(),
        tsLocal: now.toLocaleTimeString("en-US", { hour12: false }),
      };
      setAudit((prev) => [...prev, row].slice(-auditMaxEntries));
    },
    [auditMaxEntries]
  );

  const executeStep = useCallback(
    async function run(idx: number) {
      if (runningRef.current || idx < 0 || idx >= FLOW_STEPS.length) return;
      runningRef.current = true;
      try {
        const step = FLOW_STEPS[idx];
        setStepIndex(idx);
        const hi = highlights(step.id, quoteAcceptedRef.current, shouldOrderRef.current);
        setActiveNodeIds(hi.nodes);
        setActiveEdgeIds(hi.edges);

        if (step.id === "erc8004_verify") {
          let proof = randomHex();
          try {
            const agents = await fetchJSON<{ agents?: unknown[] }>(`${baseUrl}/api/network/agents`);
            proof = `0xerc_${String(agents?.agents?.length ?? 0).padStart(2, "0")}${randomHex(58).slice(2)}`;
          } catch {
            // fallback
          }
          setVerificationHash(proof);
          appendAudit({
            mode,
            stepId: step.id,
            stepName: step.title,
            blockchainVerifiable: true,
            verificationHash: proof,
            payload: { layer: "ERC8004", verifiedAgents: ["message-agent", "technical-agent"], proof },
          });
        }

        if (step.id === "xmtp_quote_request") {
          setDmOpen(true);
          appendAudit({
            mode,
            stepId: step.id,
            stepName: step.title,
            blockchainVerifiable: true,
            xmtpSnippet: "Agent001 requested service quote from Message Agent and Technical Agent via XMTP DM.",
            payload: {
              task: "BTCUSDT strategy",
              requestedFrom: ["message-agent", "technical-agent"],
            },
          });
        }

        if (step.id === "xmtp_quote_return") {
          let mQuote = 0.00011;
          let tQuote = 0.0001;
          let mSource = "fallback";
          let tSource = "fallback";
          try {
            const m = await fetchJSON<{ result?: { confidence?: number } }>(`${baseUrl}/api/analysis/info/run`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ topic: "message agent quote for BTCUSDT service", mode: "auto", maxChars: 120 }),
            });
            const conf = Number(m?.result?.confidence ?? 0.72);
            mQuote = Number((0.00008 + (1 - conf) * 0.0001).toFixed(5));
            mSource = "backend";
          } catch {
            // fallback
          }
          try {
            const t = await fetchJSON<{ result?: { confidence?: number } }>(`${baseUrl}/api/analysis/info/run`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ topic: "technical agent quote for BTCUSDT service", mode: "auto", maxChars: 120 }),
            });
            const conf = Number(t?.result?.confidence ?? 0.75);
            tQuote = Number((0.00008 + (1 - conf) * 0.0001).toFixed(5));
            tSource = "backend";
          } catch {
            // fallback
          }

          setMessageQuote(mQuote);
          setTechnicalQuote(tQuote);
          const total = Number((mQuote + tQuote).toFixed(5));
          const accepted = total <= QUOTE_CAP;
          setQuoteAccepted(accepted);
          quoteAcceptedRef.current = accepted;
          const basis = accepted
            ? `Quote accepted. Total ${total.toFixed(5)} <= cap ${QUOTE_CAP.toFixed(5)}. Proceed to x402 payment.`
            : `Quote rejected. Total ${total.toFixed(5)} > cap ${QUOTE_CAP.toFixed(5)}. Stop before payment.`;
          setDecision(basis);
          appendAudit({
            mode,
            stepId: step.id,
            stepName: step.title,
            blockchainVerifiable: true,
            xmtpSnippet: `Message quote ${mQuote.toFixed(5)}, Technical quote ${tQuote.toFixed(5)}, total ${total.toFixed(5)}.`,
            decisionBasis: basis,
            payload: { messageQuote: mQuote, technicalQuote: tQuote, totalQuote: total, cap: QUOTE_CAP, accepted, source: { message: mSource, technical: tSource } },
          });
        }

        if (step.id === "x402_settlement") {
          if (!quoteAcceptedRef.current) {
            appendAudit({
              mode,
              stepId: step.id,
              stepName: step.title,
              blockchainVerifiable: true,
              decisionBasis: "Skipped. Quote was not accepted, so payment was not initiated.",
              payload: { executed: false },
            });
          } else {
            setX402Open(true);
            let p = 0;
            setX402Phase(X402_PHASES[p]);
            if (x402TimerRef.current) window.clearInterval(x402TimerRef.current);
            x402TimerRef.current = window.setInterval(() => {
              p += 1;
              if (p >= X402_PHASES.length) {
                if (x402TimerRef.current) window.clearInterval(x402TimerRef.current);
                return;
              }
              setX402Phase(X402_PHASES[p]);
            }, 550);

            let receipt = `receipt_${randomHex(10).slice(2)}`;
            try {
              const res = await fetchJSON<{ items?: Array<Record<string, unknown>> }>(`${baseUrl}/api/x402/mapping/latest`);
              const first = Array.isArray(res?.items) && res.items.length > 0 ? res.items[0] : null;
              const reqId = String(first?.requestId || "");
              const tx = String(first?.txHash || first?.paymentTxHash || "");
              if (reqId || tx) receipt = `${reqId || "req_unknown"}:${tx || "tx_unknown"}`;
            } catch {
              // fallback
            }
            setReceiptRef(receipt);
            appendAudit({
              mode,
              stepId: step.id,
              stepName: step.title,
              blockchainVerifiable: true,
              receiptRef: receipt,
              payload: { phases: X402_PHASES, receipt, executed: true },
            });
          }
        }

        if (step.id === "xmtp_service_result") {
          if (!quoteAcceptedRef.current) {
            setDmOpen(false);
            appendAudit({
              mode,
              stepId: step.id,
              stepName: step.title,
              blockchainVerifiable: true,
              decisionBasis: "No service result returned because payment did not complete.",
              payload: { returned: false },
            });
          } else {
            setDmOpen(true);
            let mSnippet = "Fallback: Message agent reports risk-on momentum from macro and sentiment channels.";
            let tSnippet = "Fallback: Technical agent reports trend confirmation with acceptable volatility.";
            let mScore = 0.64;
            let tScore = 0.66;
            try {
              const m = await fetchJSON<{ result?: { summary?: string; confidence?: number } }>(`${baseUrl}/api/analysis/info/run`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ topic: "message agent service result BTCUSDT", mode: "auto", maxChars: 360 }),
              });
              mSnippet = m?.result?.summary || mSnippet;
              mScore = Number((m?.result?.confidence ?? mScore).toFixed(3));
            } catch {
              // fallback
            }
            try {
              const t = await fetchJSON<{ result?: { summary?: string; confidence?: number } }>(`${baseUrl}/api/analysis/info/run`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ topic: "technical agent service result BTCUSDT", mode: "auto", maxChars: 360 }),
              });
              tSnippet = t?.result?.summary || tSnippet;
              tScore = Number((t?.result?.confidence ?? tScore).toFixed(3));
            } catch {
              // fallback
            }
            setMessageSnippet(mSnippet);
            setTechnicalSnippet(tSnippet);
            setMessageScore(mScore);
            setTechnicalScore(tScore);
            appendAudit({
              mode,
              stepId: step.id,
              stepName: step.title,
              blockchainVerifiable: true,
              xmtpSnippet: `Service payload delivered by XMTP DM. Message: ${mSnippet.slice(0, 90)}...`,
              decisionBasis: "Service result is returned via XMTP DM. x402 is only for settlement/challenge-proof.",
              payload: {
                delivery: "xmtp_dm",
                messageResult: mSnippet,
                technicalResult: tSnippet,
                messageScore: mScore,
                technicalScore: tScore,
                receiptRef,
              },
            });
          }
        }

        if (step.id === "api_order_decision") {
          setDmOpen(false);
          if (!quoteAcceptedRef.current) {
            setShouldOrder(false);
            shouldOrderRef.current = false;
            const basis = "Skipped API order decision because quote/payment stage did not pass.";
            setDecision(basis);
            appendAudit({
              mode,
              stepId: step.id,
              stepName: step.title,
              blockchainVerifiable: true,
              decisionBasis: basis,
              payload: { apiCalled: false },
            });
          } else {
            const combined = Number((messageScore * 0.5 + technicalScore * 0.5).toFixed(3));
            const approved = combined >= EXECUTION_THRESHOLD && messageScore >= 0.45 && technicalScore >= 0.45;
            setShouldOrder(approved);
            shouldOrderRef.current = approved;
            const basis = approved
              ? `Order approved. Combined service score ${combined} >= ${EXECUTION_THRESHOLD}. Calling API order endpoint.`
              : `Order rejected. Combined service score ${combined} < ${EXECUTION_THRESHOLD}.`;
            setDecision(basis);
            let orderRef = "";
            if (approved) {
              orderRef = `order_${randomHex(8).slice(2)}`;
              try {
                const res = await fetchJSON<{ result?: Record<string, unknown> }>(`${baseUrl}/api/workflow/btc-price/run`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ pair: "BTCUSDT", source: "hyperliquid" }),
                });
                const maybeRef = String(res?.result?.requestId || res?.result?.receiptRef || "");
                if (maybeRef) orderRef = maybeRef;
              } catch {
                // fallback
              }
            }
            appendAudit({
              mode,
              stepId: step.id,
              stepName: step.title,
              blockchainVerifiable: true,
              receiptRef: receiptRef || orderRef || undefined,
              decisionBasis: basis,
              payload: { messageScore, technicalScore, combined, apiCalled: approved, orderRef },
            });
          }
        }

        if (playbackRef.current === "playing") {
          if (idx >= FLOW_STEPS.length - 1) {
            setPlayback("completed");
          } else {
            if (timerRef.current) window.clearTimeout(timerRef.current);
            timerRef.current = window.setTimeout(() => {
              if (playbackRef.current === "playing") void run(idx + 1);
            }, step.durationMs);
          }
        }
      } finally {
        runningRef.current = false;
      }
    },
    [appendAudit, baseUrl, messageScore, mode, receiptRef, technicalScore]
  );

  const start = useCallback(() => {
    setPlayback("playing");
    const target = stepIndex >= 0 && stepIndex < FLOW_STEPS.length - 1 ? stepIndex + 1 : 0;
    void executeStep(target);
  }, [executeStep, stepIndex]);

  const pause = useCallback(() => {
    setPlayback("paused");
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  const next = useCallback(() => {
    setPlayback("paused");
    if (timerRef.current) window.clearTimeout(timerRef.current);
    const target = stepIndex < 0 ? 0 : Math.min(stepIndex + 1, FLOW_STEPS.length - 1);
    void executeStep(target);
  }, [executeStep, stepIndex]);

  const replay = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    if (x402TimerRef.current) window.clearInterval(x402TimerRef.current);
    setPlayback("idle");
    setStepIndex(-1);
    setActiveNodeIds([]);
    setActiveEdgeIds([]);
    setAudit([]);
    setDmOpen(false);
    setX402Open(false);
    setX402Phase("challenge");
    setQuoteAccepted(null);
    quoteAcceptedRef.current = null;
    setShouldOrder(null);
    shouldOrderRef.current = null;
    setDecision("Pending quote negotiation.");
    setVerificationHash("");
    setMessageQuote(0);
    setTechnicalQuote(0);
    setMessageSnippet("");
    setTechnicalSnippet("");
    setMessageScore(0);
    setTechnicalScore(0);
    setReceiptRef("");
    setTimeout(() => {
      setPlayback("playing");
      void executeStep(0);
    }, 120);
  }, [executeStep]);

  const drawNodes = useMemo(
    () =>
      nodes.map((n) => {
        const active = activeNodeIds.includes(n.id);
        return { ...n, data: { ...n.data, status: active ? "active" : "idle" } };
      }),
    [activeNodeIds, nodes]
  );

  const drawEdges = useMemo(
    () =>
      edges.map((e) => {
        const active = activeEdgeIds.includes(e.id);
        const dimmed = activeEdgeIds.length > 0 && !active;
        return { ...e, animated: active, data: { ...e.data, active, dimmed } };
      }),
    [activeEdgeIds, edges]
  );

  const current = stepIndex >= 0 ? FLOW_STEPS[stepIndex] : null;
  const progress = stepIndex >= 0 ? ((stepIndex + 1) / FLOW_STEPS.length) * 100 : 0;

  const copyAudit = useCallback(async (entry: AuditLogEntry) => {
    await navigator.clipboard.writeText(JSON.stringify(entry, null, 2));
    setCopiedId(entry.id);
    setTimeout(() => setCopiedId(null), 1200);
  }, []);

  return (
    <div className="space-y-4">
      <Card className="border-white/10 bg-black/45 py-4 text-white">
        <CardContent className="space-y-4 px-4 sm:px-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs text-cyan-200">
              Unified Agent Network: Message + Technical → Agent001 → Decision → x402 → API
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={start} className="h-10 bg-gradient-to-r from-cyan-400 to-blue-600 text-black">
                <Play className="size-4" />
                Start Auditable Flow Demo
              </Button>
              <Button variant="outline" className="border-white/30 bg-black/35 text-white" onClick={pause}>
                <CirclePause className="size-4" />
                Pause
              </Button>
              <Button variant="outline" className="border-white/30 bg-black/35 text-white" onClick={next}>
                <SkipForward className="size-4" />
                Next Step
              </Button>
              <Button variant="outline" className="border-white/30 bg-black/35 text-white" onClick={replay}>
                <RotateCcw className="size-4" />
                Replay
              </Button>
            </div>
          </div>

          <div className="grid gap-2 text-sm md:grid-cols-5">
            <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
              <div className="text-xs text-slate-300">Playback</div>
              <div className="font-semibold">{playback.toUpperCase()}</div>
            </div>
            <div className="rounded-lg border border-purple-400/25 bg-purple-400/8 px-3 py-2">
              <div className="text-xs text-purple-200">verificationHash</div>
              <div className="font-mono text-sm">{shortHash(verificationHash)}</div>
            </div>
            <div className="rounded-lg border border-cyan-400/25 bg-cyan-400/8 px-3 py-2">
              <div className="text-xs text-cyan-200">messageQuote</div>
              <div className="font-mono text-sm">{messageQuote > 0 ? messageQuote.toFixed(5) : "-"}</div>
            </div>
            <div className="rounded-lg border border-cyan-400/25 bg-cyan-400/8 px-3 py-2">
              <div className="text-xs text-cyan-200">technicalQuote</div>
              <div className="font-mono text-sm">{technicalQuote > 0 ? technicalQuote.toFixed(5) : "-"}</div>
            </div>
            <div className="rounded-lg border border-emerald-400/25 bg-emerald-400/8 px-3 py-2">
              <div className="text-xs text-emerald-200">receiptRef</div>
              <div className="font-mono text-sm">{shortHash(receiptRef)}</div>
            </div>
          </div>

          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <motion.div animate={{ width: `${progress}%` }} className="h-full bg-gradient-to-r from-cyan-400 via-emerald-400 to-orange-400" />
          </div>
          <p className="text-sm text-slate-300">{current ? `${current.title}: ${current.description}` : "Ready to run complete auditable agent workflow."}</p>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="relative overflow-hidden border-white/10 bg-black/45 py-0 text-white">
          <div className="relative h-[70vh] min-h-[620px]">
            <div className="pointer-events-none absolute inset-0 z-0">
              <div className="absolute left-3 top-24 h-[76%] w-[34%] rounded-[30px] border border-cyan-300/20 bg-cyan-400/10 shadow-[0_0_40px_rgba(56,189,248,0.15)]" />
              <div className="absolute left-[38%] top-24 h-[76%] w-[24%] rounded-[30px] border border-blue-300/18 bg-blue-400/10 shadow-[0_0_40px_rgba(59,130,246,0.12)]" />
              <div className="absolute right-3 top-24 h-[76%] w-[35%] rounded-[30px] border border-orange-300/20 bg-orange-400/10 shadow-[0_0_40px_rgba(249,115,22,0.14)]" />
            </div>

            <ReactFlow
              nodes={drawNodes}
              edges={drawEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={(_, node) => {
                if (node.id === "x402") setX402Open(true);
              }}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              fitView
              fitViewOptions={{ padding: 0.08 }}
              connectionLineType={ConnectionLineType.Bezier}
              className="!bg-transparent"
              minZoom={0.55}
              maxZoom={1.35}
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#111827" gap={24} size={1} />
              <Controls className="!border-white/20 !bg-black/70 !text-white" />
              <MiniMap className="!hidden sm:!block !border !border-white/10 !bg-black/60" />
              <div className="pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full border border-white/20 bg-black/70 px-4 py-2 text-xs tracking-wide">
                AGENT NETWORK · FULL AUDITABILITY
              </div>
            </ReactFlow>

            <div className="pointer-events-none absolute bottom-4 left-4 z-20 w-[320px] rounded-xl border border-white/15 bg-black/65 p-3 text-xs text-slate-100">
              <div className="mb-2 font-semibold text-white">Legend</div>
              <div className="grid gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-[2px] w-8 bg-purple-500" />
                  Purple dashed = ERC8004 verification
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-block h-[2px] w-8 bg-sky-400" />
                  Blue arrows = XMTP DM quote + service results
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-block h-[2px] w-8 bg-amber-400" />
                  Amber = Agent001 order decision
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-block h-[2px] w-8 bg-emerald-500" />
                  Green = x402 payment and unlock flow
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-block h-[2px] w-8 bg-orange-500" />
                  Orange = API order request/response
                </div>
              </div>
            </div>
          </div>
        </Card>

        <Card className="h-[70vh] min-h-[620px] border-white/10 bg-black/45 py-0 text-white">
          <CardHeader className="border-b border-white/10 pb-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Sparkles className="size-4 text-cyan-300" />
              Audit Trail
            </CardTitle>
            <CardDescription className="text-slate-300">Step-by-step verifiable records from signal ingestion to execution decision.</CardDescription>
          </CardHeader>
          <CardContent className="h-[calc(70vh-92px)] space-y-3 overflow-y-auto px-4 pb-4 pt-4">
            {audit.length === 0 ? <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-slate-300">No audit entries yet. Start demo playback.</div> : null}
            {audit.map((entry) => (
              <motion.div key={entry.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">{entry.stepName}</div>
                    <div className="text-xs text-slate-400">
                      {entry.tsLocal} · {entry.mode.toUpperCase()}
                    </div>
                  </div>
                  <Badge className="bg-emerald-500/20 text-emerald-200">Blockchain Verifiable</Badge>
                </div>
                <Separator className="bg-white/10" />
                <div className="space-y-1 text-xs text-slate-200">
                  {entry.verificationHash ? (
                    <p>
                      <span className="text-slate-400">verificationHash:</span> <span className="font-mono">{shortHash(entry.verificationHash)}</span>
                    </p>
                  ) : null}
                  {entry.xmtpSnippet ? (
                    <p>
                      <span className="text-slate-400">xmtpSnippet:</span> {entry.xmtpSnippet}
                    </p>
                  ) : null}
                  {entry.receiptRef ? (
                    <p>
                      <span className="text-slate-400">receiptRef:</span> <span className="font-mono">{shortHash(entry.receiptRef)}</span>
                    </p>
                  ) : null}
                  {entry.decisionBasis ? (
                    <p>
                      <span className="text-slate-400">decisionBasis:</span> {entry.decisionBasis}
                    </p>
                  ) : null}
                </div>
                <Button variant="outline" size="sm" className="h-8 border-white/20 bg-black/35 text-xs text-white" onClick={() => void copyAudit(entry)}>
                  {copiedId === entry.id ? (
                    <>
                      <Check className="size-3.5" />
                      Copied
                    </>
                  ) : (
                    <>
                      <ClipboardCopy className="size-3.5" />
                      Copy
                    </>
                  )}
                </Button>
              </motion.div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Dialog open={dmOpen} onOpenChange={setDmOpen}>
        <DialogContent className="max-w-xl border-cyan-400/35 bg-slate-950 text-white">
          <DialogHeader>
            <DialogTitle className="text-cyan-300">XMTP DM: Quote + Service Result</DialogTitle>
            <DialogDescription className="text-slate-300">
              Agent001 negotiates quotes first, pays through x402, then receives service results via DM.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 rounded-xl border border-cyan-400/25 bg-slate-900/70 p-4 text-sm">
            <div>
              <div className="text-xs text-cyan-200">Message Agent</div>
              <p>quote: {messageQuote > 0 ? messageQuote.toFixed(5) : "pending..."}</p>
              <p className="mt-1">{messageSnippet || "service result pending..."}</p>
              <div className="mt-1 text-xs text-slate-400">result score: {messageScore > 0 ? messageScore.toFixed(3) : "-"}</div>
            </div>
            <Separator className="bg-white/10" />
            <div>
              <div className="text-xs text-cyan-200">Technical Agent</div>
              <p>quote: {technicalQuote > 0 ? technicalQuote.toFixed(5) : "pending..."}</p>
              <p className="mt-1">{technicalSnippet || "service result pending..."}</p>
              <div className="mt-1 text-xs text-slate-400">result score: {technicalScore > 0 ? technicalScore.toFixed(3) : "-"}</div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={x402Open} onOpenChange={setX402Open}>
        <DialogContent className="max-w-xl border-emerald-400/35 bg-slate-950 text-white">
          <DialogHeader>
            <DialogTitle className="text-emerald-300">x402 Settlement Lifecycle</DialogTitle>
            <DialogDescription className="text-slate-300">{"challenge -> pay+proof -> verify -> unlock"}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {X402_PHASES.map((phase, i) => {
              const active = phase === x402Phase;
              const done = X402_PHASES.indexOf(x402Phase) > i;
              return (
                <motion.div
                  key={phase}
                  animate={{ opacity: active || done ? 1 : 0.45, scale: active ? 1.02 : 1 }}
                  className={cn(
                    "flex items-center justify-between rounded-lg border px-3 py-2 text-sm",
                    active ? "border-emerald-400/70 bg-emerald-500/15" : done ? "border-emerald-400/35 bg-emerald-500/8" : "border-white/15 bg-white/5"
                  )}
                >
                  <span>{phase}</span>
                  {active || done ? <Activity className="size-4 text-emerald-300" /> : null}
                </motion.div>
              );
            })}
          </div>
          <div className="rounded-lg border border-white/15 bg-white/5 p-3 text-xs">
            <div>decision: {decision}</div>
            <div className="font-mono">receiptRef: {receiptRef || "pending..."}</div>
          </div>
        </DialogContent>
      </Dialog>

      <style jsx global>{`
        @keyframes edge-dash {
          to {
            stroke-dashoffset: -44;
          }
        }
      `}</style>
    </div>
  );
}

