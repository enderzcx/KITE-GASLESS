import AgentNetwork from "@/components/AgentNetwork";

export default function Home() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_10%_10%,rgba(56,189,248,0.18),transparent_35%),radial-gradient(circle_at_90%_15%,rgba(168,85,247,0.18),transparent_30%),linear-gradient(160deg,#030712,#020617_40%,#0a0b12)] p-4 text-white md:p-6">
      <section className="mx-auto max-w-[1680px]">
        <header className="mb-4 rounded-2xl border border-white/10 bg-black/45 px-5 py-6 backdrop-blur-xl">
          <h1 className="text-3xl font-bold tracking-tight md:text-5xl">Agent Network</h1>
          <p className="mt-2 text-sm text-slate-300 md:text-base">
            Powered by XMTP × x402 × ERC8004
          </p>
        </header>
        <AgentNetwork />
      </section>
    </main>
  );
}
