
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import "reactflow/dist/style.css";

export type FlowMode = "a2a" | "atapi";
export type PlaybackState = "idle" | "playing" | "paused" | "completed";
type PaymentPhase = "challenge" | "pay+proof" | "verify" | "unlock";

export type FlowStepId =
  | "erc8004_verify"
  | "xmtp_dm_negotiate"
  | "xmtp_result_return"
  | "trade_plan_decision"
  | "x402_settlement"
  | "atapi_order_gate";

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
  initialMode?: FlowMode;
  backendBaseUrl?: string;
  auditMaxEntries?: number;
}

type NodeKind = "agent" | "protocol" | "settlement" | "api" | "decision";
type NodeLane = "a2a" | "atapi" | "global";
type EdgeChannel = "xmtp" | "x402" | "erc8004" | "http" | "atapi";

interface NetworkNodeData {
  title: string;
  subtitle: string;
  kind: NodeKind;
  lane: NodeLane;
  status?: "idle" | "active" | "dimmed";
}

interface NetworkEdgeData {
  label: string;
  channel: EdgeChannel;
  lane: "a2a" | "atapi" | "both";
  active?: boolean;
  dimmed?: boolean;
  labelOffsetX?: number;
  labelOffsetY?: number;
  curvature?: number;
}

const COLORS: Record<EdgeChannel, string> = {
  xmtp: "#3b82f6",
  x402: "#22c55e",
  erc8004: "#a855f7",
  http: "#94a3b8",
  atapi: "#f97316",
};

const QUOTE_CAP = 0.00015;
const X402_PHASES: PaymentPhase[] = ["challenge", "pay+proof", "verify", "unlock"];

export const FLOW_STEPS: FlowStep[] = [
  { id: "erc8004_verify", index: 1, title: "Step 1 · ERC8004 Identity Verification", description: "Verify identity proofs.", durationMs: 1300 },
  { id: "xmtp_dm_negotiate", index: 2, title: "Step 2 · XMTP DM Negotiation", description: "Negotiate task and quote.", durationMs: 1600 },
  { id: "xmtp_result_return", index: 3, title: "Step 3 · XMTP Result Return", description: "Receive final quote.", durationMs: 1300 },
  { id: "trade_plan_decision", index: 4, title: "Step 4 · Decision Logic", description: "Check quote against threshold.", durationMs: 1200 },
  { id: "x402_settlement", index: 5, title: "Step 5 · x402 Settlement", description: "challenge -> pay+proof -> unlock", durationMs: 2500 },
  { id: "atapi_order_gate", index: 6, title: "Step 6 · ATAPI Route Gate", description: "Decide ATAPI execution route.", durationMs: 1300 },
];

export const NETWORK_NODES: Node<NetworkNodeData>[] = [
  { id: "erc8004", type: "network", position: { x: 530, y: 48 }, data: { title: "ERC8004", subtitle: "Trust & Registration", kind: "protocol", lane: "global" } },
  { id: "a2a-agent001", type: "network", position: { x: 80, y: 282 }, data: { title: "Agent001", subtitle: "Task Initiator", kind: "agent", lane: "a2a" } },
  { id: "a2a-msgtech", type: "network", position: { x: 450, y: 282 }, data: { title: "Msg/Tech Agent", subtitle: "Service Provider Agent", kind: "agent", lane: "a2a" } },
  { id: "a2a-x402", type: "network", position: { x: 270, y: 500 }, data: { title: "x402 Settlement", subtitle: "challenge -> pay -> proof -> unlock", kind: "settlement", lane: "a2a" } },
  { id: "decision-hub", type: "network", position: { x: 560, y: 188 }, data: { title: "Decision Hub", subtitle: "Is quote acceptable?", kind: "decision", lane: "global" } },
  { id: "atapi-agent001", type: "network", position: { x: 860, y: 282 }, data: { title: "Agent001", subtitle: "Task Initiator", kind: "agent", lane: "atapi" } },
  { id: "atapi-api", type: "network", position: { x: 1240, y: 282 }, data: { title: "Trading API", subtitle: "Web2 Trading Service", kind: "api", lane: "atapi" } },
  { id: "atapi-x402", type: "network", position: { x: 1020, y: 500 }, data: { title: "x402 Settlement", subtitle: "challenge -> pay -> proof -> unlock", kind: "settlement", lane: "atapi" } },
];

export const NETWORK_EDGES: Edge<NetworkEdgeData>[] = [
  { id: "a2a-1", type: "glow", source: "a2a-agent001", target: "a2a-msgtech", sourceHandle: "s-right", targetHandle: "t-left", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.xmtp }, data: { label: "① XMTP Negotiation (Task & Price)", channel: "xmtp", lane: "a2a", labelOffsetY: -16, curvature: 0.22 } },
  { id: "a2a-2", type: "glow", source: "a2a-msgtech", target: "a2a-agent001", sourceHandle: "s-top", targetHandle: "t-top", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.x402 }, data: { label: "② x402 challenge", channel: "x402", lane: "a2a", labelOffsetY: -34, curvature: 0.35 } },
  { id: "a2a-3", type: "glow", source: "a2a-agent001", target: "a2a-x402", sourceHandle: "s-bottom", targetHandle: "t-left", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.x402 }, data: { label: "③ pay + proof", channel: "x402", lane: "a2a", labelOffsetX: -10, labelOffsetY: -2, curvature: 0.22 } },
  { id: "a2a-4", type: "glow", source: "a2a-x402", target: "a2a-msgtech", sourceHandle: "s-right", targetHandle: "t-bottom", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.x402 }, data: { label: "④ unlock", channel: "x402", lane: "a2a", labelOffsetX: 16, labelOffsetY: 0, curvature: 0.2 } },
  { id: "a2a-5", type: "glow", source: "a2a-msgtech", target: "a2a-agent001", sourceHandle: "s-bottom", targetHandle: "t-bottom", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.xmtp }, data: { label: "⑤ XMTP Result + receiptRef", channel: "xmtp", lane: "a2a", labelOffsetY: 32, curvature: 0.35 } },
  { id: "api-1", type: "glow", source: "atapi-agent001", target: "atapi-api", sourceHandle: "s-right", targetHandle: "t-left", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.http }, data: { label: "① HTTP Request", channel: "http", lane: "atapi", labelOffsetY: -14, curvature: 0.2 } },
  { id: "api-2", type: "glow", source: "atapi-api", target: "atapi-agent001", sourceHandle: "s-top", targetHandle: "t-top", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.x402 }, data: { label: "② x402 challenge", channel: "x402", lane: "atapi", labelOffsetY: -34, curvature: 0.33 } },
  { id: "api-3", type: "glow", source: "atapi-agent001", target: "atapi-x402", sourceHandle: "s-bottom", targetHandle: "t-left", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.x402 }, data: { label: "③ pay + proof", channel: "x402", lane: "atapi", labelOffsetX: -10, curvature: 0.22 } },
  { id: "api-4", type: "glow", source: "atapi-x402", target: "atapi-api", sourceHandle: "s-right", targetHandle: "t-bottom", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.x402 }, data: { label: "④ unlock", channel: "x402", lane: "atapi", labelOffsetX: 18, labelOffsetY: 4, curvature: 0.2 } },
  { id: "api-5", type: "glow", source: "atapi-api", target: "atapi-agent001", sourceHandle: "s-bottom", targetHandle: "t-bottom", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.atapi }, data: { label: "⑤ HTTP Result + receiptRef", channel: "atapi", lane: "atapi", labelOffsetY: 30, curvature: 0.33 } },
  { id: "erc-a2a-agent", type: "glow", source: "erc8004", target: "a2a-agent001", sourceHandle: "s-left", targetHandle: "t-top", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.erc8004 }, data: { label: "ERC8004 proof", channel: "erc8004", lane: "both", labelOffsetX: -16, labelOffsetY: -10, curvature: 0.26 } },
  { id: "erc-a2a-msg", type: "glow", source: "erc8004", target: "a2a-msgtech", sourceHandle: "s-bottom", targetHandle: "t-top", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.erc8004 }, data: { label: "ERC8004 proof", channel: "erc8004", lane: "both", labelOffsetX: 14, labelOffsetY: -2, curvature: 0.2 } },
  { id: "erc-atapi-agent", type: "glow", source: "erc8004", target: "atapi-agent001", sourceHandle: "s-right", targetHandle: "t-top", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.erc8004 }, data: { label: "ERC8004 proof", channel: "erc8004", lane: "both", labelOffsetX: -10, labelOffsetY: 10, curvature: 0.3 } },
  { id: "erc-atapi-api", type: "glow", source: "erc8004", target: "atapi-api", sourceHandle: "s-right", targetHandle: "t-top", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.erc8004 }, data: { label: "ERC8004 proof", channel: "erc8004", lane: "both", labelOffsetX: 26, labelOffsetY: -8, curvature: 0.22 } },
];

const ICONS: Record<NodeKind, typeof Bot> = { agent: Bot, protocol: ShieldCheck, settlement: Wallet, api: Server, decision: Cpu };
const BORDERS: Record<NodeKind, string> = {
  agent: "rgba(56, 189, 248, 0.72)",
  protocol: "rgba(168, 85, 247, 0.76)",
  settlement: "rgba(34, 197, 94, 0.74)",
  api: "rgba(249, 115, 22, 0.74)",
  decision: "rgba(245, 158, 11, 0.7)",
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

function highlights(step: FlowStepId, mode: FlowMode, shouldExecute: boolean | null) {
  if (step === "erc8004_verify") return { nodes: ["erc8004", "a2a-agent001", "a2a-msgtech", "atapi-agent001", "atapi-api"], edges: ["erc-a2a-agent", "erc-a2a-msg", "erc-atapi-agent", "erc-atapi-api"] };
  if (step === "xmtp_dm_negotiate") return { nodes: ["a2a-agent001", "a2a-msgtech"], edges: ["a2a-1"] };
  if (step === "xmtp_result_return") return { nodes: ["a2a-agent001", "a2a-msgtech"], edges: ["a2a-5"] };
  if (step === "trade_plan_decision") return { nodes: ["decision-hub", mode === "atapi" ? "atapi-agent001" : "a2a-agent001"], edges: [] };
  if (step === "x402_settlement") {
    return mode === "atapi"
      ? { nodes: ["atapi-agent001", "atapi-api", "atapi-x402"], edges: ["api-2", "api-3", "api-4"] }
      : { nodes: ["a2a-agent001", "a2a-msgtech", "a2a-x402"], edges: ["a2a-2", "a2a-3", "a2a-4"] };
  }
  if (mode === "atapi" && shouldExecute) return { nodes: ["atapi-agent001", "atapi-api", "decision-hub"], edges: ["api-5"] };
  return { nodes: ["decision-hub"], edges: [] };
}

function NetworkNode({ data }: NodeProps<NetworkNodeData>) {
  const Icon = ICONS[data.kind];
  const active = data.status === "active";
  const dim = data.status === "dimmed";
  return (
    <motion.div
      animate={{ scale: active ? 1.03 : 1, boxShadow: active ? `0 0 25px ${BORDERS[data.kind]}` : "none" }}
      className={cn("min-w-[210px] rounded-2xl border bg-black/55 px-4 py-3 text-white backdrop-blur-lg", dim && "opacity-40")}
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

function GlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data }: EdgeProps<NetworkEdgeData>) {
  const [path, x, y] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: data?.curvature ?? 0.24,
  });
  const color = COLORS[data?.channel ?? "http"];
  const active = Boolean(data?.active);
  const dim = Boolean(data?.dimmed);
  const dashed = data?.channel === "erc8004";
  const showLabel = !dim || active;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: color,
          strokeWidth: active ? 3 : 2,
          opacity: dim ? 0.22 : active ? 1 : 0.7,
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

export default function AgentNetwork({ initialMode = "a2a", backendBaseUrl, auditMaxEntries = 200 }: AgentNetworkProps) {
  const [mode, setMode] = useState<FlowMode>(initialMode);
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
  const [quote, setQuote] = useState(0.00014);
  const [shouldExecute, setShouldExecute] = useState<boolean | null>(null);
  const [decision, setDecision] = useState("Pending quote validation.");
  const [verificationHash, setVerificationHash] = useState("");
  const [xmtpSnippet, setXmtpSnippet] = useState("");
  const [receiptRef, setReceiptRef] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const timerRef = useRef<number | null>(null);
  const x402TimerRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const playbackRef = useRef<PlaybackState>("idle");
  const baseUrl = backendBaseUrl || process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:3001";

  useEffect(() => {
    playbackRef.current = playback;
  }, [playback]);

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    if (x402TimerRef.current) window.clearInterval(x402TimerRef.current);
  }, []);

  const appendAudit = useCallback((entry: Omit<AuditLogEntry, "id" | "tsISO" | "tsLocal">) => {
    const now = new Date();
    const row: AuditLogEntry = {
      ...entry,
      id: `${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`,
      tsISO: now.toISOString(),
      tsLocal: now.toLocaleTimeString("en-US", { hour12: false }),
    };
    setAudit((prev) => [...prev, row].slice(-auditMaxEntries));
  }, [auditMaxEntries]);

  const executeStep = useCallback(async function run(idx: number) {
    if (runningRef.current || idx < 0 || idx >= FLOW_STEPS.length) return;
    runningRef.current = true;
    try {
      const step = FLOW_STEPS[idx];
      setStepIndex(idx);
      const hi = highlights(step.id, mode, shouldExecute);
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
        appendAudit({ mode, stepId: step.id, stepName: step.title, blockchainVerifiable: true, verificationHash: proof, payload: { layer: "ERC8004", proof } });
      }

      if (step.id === "xmtp_dm_negotiate") {
        setDmOpen(true);
        let snippet = "Fallback: Negotiation completed over XMTP DM.";
        let q = 0.00014;
        let source = "fallback";
        try {
          const res = await fetchJSON<{ result?: { summary?: string; confidence?: number } }>(`${baseUrl}/api/analysis/info/run`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ topic: "BTCUSDT strategy negotiation", mode: "auto", maxChars: 400 }),
          });
          snippet = res?.result?.summary || snippet;
          const conf = Number(res?.result?.confidence ?? 0.75);
          q = Number((0.0001 + (1 - conf) * 0.00007).toFixed(5));
          source = "backend";
        } catch {
          // fallback
        }
        setXmtpSnippet(snippet);
        setQuote(q);
        appendAudit({ mode, stepId: step.id, stepName: step.title, blockchainVerifiable: true, xmtpSnippet: snippet, payload: { quote: q, source } });
      }

      if (step.id === "xmtp_result_return") {
        setDmOpen(false);
        appendAudit({ mode, stepId: step.id, stepName: step.title, blockchainVerifiable: true, xmtpSnippet: xmtpSnippet || "XMTP final quote return.", payload: { finalQuote: quote, ttlSec: 90 } });
      }

      if (step.id === "trade_plan_decision") {
        const accepted = quote <= QUOTE_CAP;
        const basis = accepted ? `Quote ${quote.toFixed(5)} <= cap ${QUOTE_CAP.toFixed(5)}. Execution approved.` : `Quote ${quote.toFixed(5)} > cap ${QUOTE_CAP.toFixed(5)}. Execution rejected.`;
        setShouldExecute(accepted);
        setDecision(basis);
        appendAudit({ mode, stepId: step.id, stepName: step.title, blockchainVerifiable: true, decisionBasis: basis, payload: { quote, cap: QUOTE_CAP, execute: accepted } });
      }

      if (step.id === "x402_settlement") {
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
        appendAudit({ mode, stepId: step.id, stepName: step.title, blockchainVerifiable: true, receiptRef: receipt, payload: { phases: X402_PHASES, receipt } });
      }

      if (step.id === "atapi_order_gate") {
        if (mode === "atapi" && shouldExecute) {
          appendAudit({ mode, stepId: step.id, stepName: step.title, blockchainVerifiable: true, receiptRef: receiptRef || `receipt_${randomHex(8).slice(2)}`, decisionBasis: "ATAPI route enabled.", payload: { atapiRouted: true } });
        } else {
          appendAudit({ mode, stepId: step.id, stepName: step.title, blockchainVerifiable: true, decisionBasis: mode !== "atapi" ? "ATAPI route skipped in A2A mode." : "ATAPI route skipped due to quote threshold.", payload: { atapiRouted: false } });
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
  }, [appendAudit, baseUrl, mode, quote, receiptRef, shouldExecute, xmtpSnippet]);

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
    setVerificationHash("");
    setXmtpSnippet("");
    setReceiptRef("");
    setDecision("Pending quote validation.");
    setShouldExecute(null);
    setQuote(0.00014);
    setTimeout(() => {
      setPlayback("playing");
      void executeStep(0);
    }, 120);
  }, [executeStep]);

  const drawNodes = useMemo(() => nodes.map((n) => {
    const active = activeNodeIds.includes(n.id);
    const dim = n.data.lane !== "global" && ((mode === "a2a" && n.data.lane === "atapi") || (mode === "atapi" && n.data.lane === "a2a"));
    return { ...n, data: { ...n.data, status: active ? "active" : dim ? "dimmed" : "idle" } };
  }), [activeNodeIds, mode, nodes]);

  const drawEdges = useMemo(() => edges.map((e) => {
    const active = activeEdgeIds.includes(e.id);
    const dim = e.data?.lane !== "both" && ((mode === "a2a" && e.data?.lane === "atapi") || (mode === "atapi" && e.data?.lane === "a2a"));
    return { ...e, animated: active, data: { ...e.data, active, dimmed: dim } };
  }), [activeEdgeIds, edges, mode]);

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
            <Tabs value={mode} onValueChange={(v) => setMode(v as FlowMode)} className="w-full lg:max-w-[430px]">
              <TabsList className="grid w-full grid-cols-2 bg-white/8">
                <TabsTrigger value="a2a" className="data-[state=active]:bg-blue-500/30">A2A Path</TabsTrigger>
                <TabsTrigger value="atapi" className="data-[state=active]:bg-orange-500/30">ATAPI Path</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={start} className="h-10 bg-gradient-to-r from-cyan-400 to-blue-600 text-black"><Play className="size-4" />▶ Start Auditable Flow Demo</Button>
              <Button variant="outline" className="border-white/30 bg-black/35 text-white" onClick={pause}><CirclePause className="size-4" />Pause</Button>
              <Button variant="outline" className="border-white/30 bg-black/35 text-white" onClick={next}><SkipForward className="size-4" />Next Step</Button>
              <Button variant="outline" className="border-white/30 bg-black/35 text-white" onClick={replay}><RotateCcw className="size-4" />Replay</Button>
            </div>
          </div>
          <div className="grid gap-2 text-sm md:grid-cols-4">
            <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2"><div className="text-xs text-slate-300">Playback</div><div className="font-semibold">{playback.toUpperCase()}</div></div>
            <div className="rounded-lg border border-purple-400/25 bg-purple-400/8 px-3 py-2"><div className="text-xs text-purple-200">verificationHash</div><div className="font-mono text-sm">{shortHash(verificationHash)}</div></div>
            <div className="rounded-lg border border-cyan-400/25 bg-cyan-400/8 px-3 py-2"><div className="text-xs text-cyan-200">xmtpSnippet</div><div className="truncate text-sm">{xmtpSnippet || "-"}</div></div>
            <div className="rounded-lg border border-emerald-400/25 bg-emerald-400/8 px-3 py-2"><div className="text-xs text-emerald-200">receiptRef</div><div className="font-mono text-sm">{shortHash(receiptRef)}</div></div>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/10"><motion.div animate={{ width: `${progress}%` }} className="h-full bg-gradient-to-r from-cyan-400 via-emerald-400 to-orange-400" /></div>
          <p className="text-sm text-slate-300">{current ? `${current.title}: ${current.description}` : "Ready to run complete auditable agent workflow."}</p>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="relative overflow-hidden border-white/10 bg-black/45 py-0 text-white">
          <div className="relative h-[68vh] min-h-[560px]">
            <div className="pointer-events-none absolute inset-0 z-0">
              <div className={cn("absolute left-4 top-24 h-[74%] w-[46%] rounded-[32px] border border-cyan-300/20 bg-cyan-400/10", mode === "a2a" && "bg-cyan-400/16 shadow-[0_0_60px_rgba(56,189,248,0.25)]")} />
              <div className={cn("absolute right-4 top-24 h-[74%] w-[46%] rounded-[32px] border border-orange-300/20 bg-orange-400/10", mode === "atapi" && "bg-orange-400/16 shadow-[0_0_60px_rgba(249,115,22,0.25)]")} />
            </div>
            <ReactFlow
              nodes={drawNodes}
              edges={drawEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={(_, node) => { if (node.id.includes("x402")) setX402Open(true); }}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              fitView
              fitViewOptions={{ padding: 0.08 }}
              connectionLineType={ConnectionLineType.Bezier}
              className="!bg-transparent"
              minZoom={0.5}
              maxZoom={1.3}
              proOptions={{ hideAttribution: true }}
            >
              <Background color={mode === "a2a" ? "#0f172a" : "#1f1307"} gap={24} size={1} />
              <Controls className="!border-white/20 !bg-black/70 !text-white" />
              <MiniMap className="!hidden sm:!block !border !border-white/10 !bg-black/60" />
              <div className="pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full border border-white/20 bg-black/70 px-4 py-2 text-xs tracking-wide">AGENT NETWORK · FULL AUDITABILITY</div>
            </ReactFlow>
            <div className="pointer-events-none absolute bottom-4 left-4 z-20 w-[300px] rounded-xl border border-white/15 bg-black/65 p-3 text-xs text-slate-100">
              <div className="mb-2 font-semibold text-white">Legend</div>
              <div className="grid gap-1.5">
                <div className="flex items-center gap-2"><span className="inline-block h-[2px] w-8 bg-blue-500" />Blue arrows = XMTP communication</div>
                <div className="flex items-center gap-2"><span className="inline-block h-[2px] w-8 bg-emerald-500" />Green arrows = x402 payment/settlement</div>
                <div className="flex items-center gap-2"><span className="inline-block h-[2px] w-8 border-t-2 border-dashed border-purple-500" />Dashed = ERC8004 verification</div>
                <div className="flex items-center gap-2"><span className="inline-block h-[2px] w-8 bg-orange-500" />Orange highlight = ATAPI route</div>
              </div>
            </div>
          </div>
        </Card>

        <Card className="h-[68vh] min-h-[560px] border-white/10 bg-black/45 py-0 text-white">
          <CardHeader className="border-b border-white/10 pb-4">
            <CardTitle className="flex items-center gap-2 text-lg"><Sparkles className="size-4 text-cyan-300" />Audit Trail</CardTitle>
            <CardDescription className="text-slate-300">Step-by-step verifiable workflow records.</CardDescription>
          </CardHeader>
          <CardContent className="h-[calc(68vh-92px)] space-y-3 overflow-y-auto px-4 pb-4 pt-4">
            {audit.length === 0 ? <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-slate-300">No audit entries yet. Start demo playback.</div> : null}
            {audit.map((entry) => (
              <motion.div key={entry.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div><div className="text-sm font-semibold">{entry.stepName}</div><div className="text-xs text-slate-400">{entry.tsLocal} · {entry.mode.toUpperCase()}</div></div>
                  <Badge className="bg-emerald-500/20 text-emerald-200">Blockchain Verifiable</Badge>
                </div>
                <Separator className="bg-white/10" />
                <div className="space-y-1 text-xs text-slate-200">
                  {entry.verificationHash ? <p><span className="text-slate-400">verificationHash:</span> <span className="font-mono">{shortHash(entry.verificationHash)}</span></p> : null}
                  {entry.xmtpSnippet ? <p><span className="text-slate-400">xmtpSnippet:</span> {entry.xmtpSnippet}</p> : null}
                  {entry.receiptRef ? <p><span className="text-slate-400">receiptRef:</span> <span className="font-mono">{shortHash(entry.receiptRef)}</span></p> : null}
                  {entry.decisionBasis ? <p><span className="text-slate-400">decisionBasis:</span> {entry.decisionBasis}</p> : null}
                </div>
                <Button variant="outline" size="sm" className="h-8 border-white/20 bg-black/35 text-xs text-white" onClick={() => void copyAudit(entry)}>
                  {copiedId === entry.id ? <><Check className="size-3.5" />Copied</> : <><ClipboardCopy className="size-3.5" />Copy</>}
                </Button>
              </motion.div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Dialog open={dmOpen} onOpenChange={setDmOpen}>
        <DialogContent className="max-w-xl border-cyan-400/35 bg-slate-950 text-white">
          <DialogHeader>
            <DialogTitle className="text-cyan-300">XMTP DM Negotiation</DialogTitle>
            <DialogDescription className="text-slate-300">Task scope + quote negotiation thread.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 rounded-xl border border-cyan-400/25 bg-slate-900/70 p-4 text-sm">
            <p>Agent001: Need BTCUSDT 60m signal and execution policy.</p>
            <p>Msg/Tech Agent: Quote {quote.toFixed(5)} with x402 settlement binding.</p>
            <p>Agent001: Include confidence and risk factors.</p>
            <p>Msg/Tech Agent: Accepted. Returning audited payload.</p>
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
                <motion.div key={phase} animate={{ opacity: active || done ? 1 : 0.45, scale: active ? 1.02 : 1 }} className={cn("flex items-center justify-between rounded-lg border px-3 py-2 text-sm", active ? "border-emerald-400/70 bg-emerald-500/15" : done ? "border-emerald-400/35 bg-emerald-500/8" : "border-white/15 bg-white/5")}>
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
