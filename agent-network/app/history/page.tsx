"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, RefreshCcw, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface X402RequestItem {
  requestId?: string;
  action?: string;
  status?: string;
  amount?: string | number;
  paymentTxHash?: string;
  paymentProof?: { txHash?: string };
  paidAt?: string | number;
  updatedAt?: string | number;
  createdAt?: string | number;
  payer?: string;
  recipient?: string;
}

interface X402RequestsResp {
  ok?: boolean;
  items?: X402RequestItem[];
}

interface TraceResp {
  ok?: boolean;
  traceId?: string;
}

function shortHash(v: string): string {
  const raw = String(v || "").trim();
  if (!raw) return "-";
  if (raw.length <= 18) return raw;
  return `${raw.slice(0, 10)}...${raw.slice(-6)}`;
}

function parseTimestampMs(input: unknown): number {
  if (typeof input === "number" && Number.isFinite(input) && input > 0) return input;
  const raw = String(input ?? "").trim();
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
}

async function fetchJSON<T>(url: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    window.clearTimeout(timer);
  }
}

export default function HistoryPage() {
  const baseUrl = process.env.NEXT_PUBLIC_BACKEND_URL || (typeof window !== "undefined" ? window.location.origin : "");
  const [rows, setRows] = useState<X402RequestItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchJSON<X402RequestsResp>(`${baseUrl}/api/x402/requests?limit=200`, {}, 20_000);
      const items = Array.isArray(data?.items) ? data.items : [];
      items.sort((a, b) => {
        const ta = parseTimestampMs(a.paidAt) || parseTimestampMs(a.updatedAt) || parseTimestampMs(a.createdAt);
        const tb = parseTimestampMs(b.paidAt) || parseTimestampMs(b.updatedAt) || parseTimestampMs(b.createdAt);
        return tb - ta;
      });
      setRows(items);
    } catch (e) {
      setError(String((e as Error)?.message || "history_fetch_failed"));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return rows;
    return rows.filter((item) => {
      const requestId = String(item.requestId || "").toLowerCase();
      const action = String(item.action || "").toLowerCase();
      const txHash = String(item.paymentTxHash || item.paymentProof?.txHash || "").toLowerCase();
      const status = String(item.status || "").toLowerCase();
      return requestId.includes(keyword) || action.includes(keyword) || txHash.includes(keyword) || status.includes(keyword);
    });
  }, [query, rows]);

  const downloadEvidence = useCallback(
    async (requestId: string) => {
      const id = String(requestId || "").trim();
      if (!id) return;
      setDownloadingId(id);
      setError("");
      const popup = window.open("", "_blank", "noopener,noreferrer");
      try {
        const traceResp = await fetchJSON<TraceResp>(`${baseUrl}/api/demo/trace-by-request/${encodeURIComponent(id)}`);
        const traceId = String(traceResp?.traceId || "").trim();
        if (!traceId) {
          throw new Error("trace_not_found_for_request");
        }
        const url = `${baseUrl}/api/evidence/export?traceId=${encodeURIComponent(traceId)}&download=1`;
        if (popup) popup.location.href = url;
        else window.open(url, "_blank", "noopener,noreferrer");
      } catch (e) {
        if (popup) popup.close();
        setError(`Evidence download failed for ${id}: ${String((e as Error)?.message || "unknown_error")}`);
      } finally {
        setDownloadingId("");
      }
    },
    [baseUrl]
  );

  const downloadReceipt = useCallback(
    (requestId: string) => {
      const id = String(requestId || "").trim();
      if (!id) return;
      const url = `${baseUrl}/api/receipt/${encodeURIComponent(id)}?download=1`;
      window.open(url, "_blank", "noopener,noreferrer");
    },
    [baseUrl]
  );

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_10%_10%,rgba(56,189,248,0.15),transparent_35%),radial-gradient(circle_at_90%_15%,rgba(249,115,22,0.15),transparent_30%),linear-gradient(160deg,#030712,#020617_42%,#0a0b12)] p-4 text-white md:p-6">
      <section className="mx-auto max-w-[1680px] space-y-4">
        <Card className="border-white/10 bg-black/45 text-white">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-2xl md:text-3xl">Audit History</CardTitle>
              <CardDescription className="text-slate-300">
                Query historical x402 requests and download evidence packages or receipts.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" className="border-white/30 bg-black/35 text-white" onClick={() => void load()} disabled={loading}>
                <RefreshCcw className="size-4" />
                Refresh
              </Button>
              <Link href="/">
                <Button variant="outline" className="border-cyan-400/35 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20">
                  Back To Demo
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2">
              <Search className="size-4 text-slate-300" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by requestId / action / txHash / status"
                className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
              />
            </div>
            {error ? <p className="text-sm text-rose-300">{error}</p> : null}
            <div className="rounded-xl border border-white/10 bg-black/30">
              <div className="grid grid-cols-[1.2fr_0.9fr_0.7fr_0.8fr_1fr_1fr] gap-2 border-b border-white/10 px-3 py-2 text-xs text-slate-300">
                <div>RequestId</div>
                <div>Action</div>
                <div>Status</div>
                <div>Amount</div>
                <div>TxHash</div>
                <div>Actions</div>
              </div>
              <div className="max-h-[68vh] overflow-y-auto">
                {loading ? <p className="px-3 py-6 text-sm text-slate-300">Loading history...</p> : null}
                {!loading && filtered.length === 0 ? <p className="px-3 py-6 text-sm text-slate-300">No history records found.</p> : null}
                {!loading
                  ? filtered.map((item) => {
                      const requestId = String(item.requestId || "").trim();
                      const action = String(item.action || "-").trim();
                      const status = String(item.status || "unknown").trim().toLowerCase();
                      const amount = String(item.amount ?? "-").trim();
                      const txHash = String(item.paymentTxHash || item.paymentProof?.txHash || "").trim();
                      const paidAtMs = parseTimestampMs(item.paidAt) || parseTimestampMs(item.updatedAt) || parseTimestampMs(item.createdAt);
                      const paidAtText = paidAtMs > 0 ? new Date(paidAtMs).toLocaleString("en-US", { hour12: false }) : "n/a";
                      const statusColor =
                        status === "paid" || status === "success"
                          ? "bg-emerald-500/20 text-emerald-200"
                          : status === "failed" || status === "error"
                            ? "bg-rose-500/20 text-rose-200"
                            : "bg-amber-500/20 text-amber-200";

                      return (
                        <div key={requestId || `${action}_${txHash}`} className="grid grid-cols-[1.2fr_0.9fr_0.7fr_0.8fr_1fr_1fr] gap-2 border-b border-white/10 px-3 py-3 text-xs text-slate-200 last:border-b-0">
                          <div className="space-y-1">
                            <div className="font-mono">{shortHash(requestId)}</div>
                            <div className="text-[11px] text-slate-400">{paidAtText}</div>
                          </div>
                          <div className="break-all">{action}</div>
                          <div>
                            <Badge className={statusColor}>{status}</Badge>
                          </div>
                          <div className="font-mono">{amount}</div>
                          <div>
                            {txHash ? (
                              <a
                                href={`https://testnet.kitescan.ai/tx/${txHash}`}
                                target="_blank"
                                rel="noreferrer"
                                className="font-mono text-cyan-300 underline decoration-cyan-400/40 underline-offset-2"
                              >
                                {shortHash(txHash)}
                              </a>
                            ) : (
                              "-"
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 border-cyan-400/35 bg-cyan-500/10 text-[11px] text-cyan-100 hover:bg-cyan-500/20"
                              onClick={() => void downloadEvidence(requestId)}
                              disabled={!requestId || downloadingId === requestId}
                            >
                              <Download className="size-3.5" />
                              Evidence
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 border-white/25 bg-black/35 text-[11px] text-white"
                              onClick={() => downloadReceipt(requestId)}
                              disabled={!requestId}
                            >
                              Receipt
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  : null}
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
