"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Send, ArrowRight, Clock } from "lucide-react";
import type { Campaign } from "@/lib/types";
import CampaignModal from "@/components/CampaignModal";

function statusStyle(s: Campaign["status"]) {
  if (s === "sent") return { background: "#dcfce7", color: "#15803d" };
  if (s === "sending") return { background: "#fef3c7", color: "#b45309" };
  if (s === "scheduled") return { background: "#e0f2fe", color: "#0369a1" };
  return { background: "#eef2ff", color: "#4338ca" };
}

export default function CampaignsPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    // Load the list immediately — never gate it behind the dispatcher tick
    // (AutoDispatch in the layout fires the tick in the background). Re-fetch
    // once shortly after so any just-dispatched status changes show up.
    const load = () => fetch("/api/campaigns").then((r) => r.json()).then((d) => setCampaigns(d.campaigns ?? [])).catch(() => {});
    load();
    const t = setTimeout(load, 4000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Campaigns</h1>
          <p className="text-sm text-muted mt-1">Choose a list, a mail, and when to send — then track everything.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}><Send className="w-4 h-4" /> New campaign</button>
      </div>

      <div className="space-y-3">
        {campaigns.length === 0 && <div className="card p-8 text-center text-muted">No campaigns yet. Click “New campaign” to choose a list and a mail.</div>}
        {campaigns.map((c) => (
          <Link key={c.id} href={`/campaigns/${c.id}`} className="card p-5 flex items-center justify-between hover:shadow-sm transition-shadow">
            <div>
              <div className="font-semibold">{c.name}</div>
              <div className="text-sm text-muted mt-0.5 flex items-center gap-2">
                {c.recipientCount} recipients · {new Date(c.createdAt).toLocaleDateString()}
                {c.status === "scheduled" && c.scheduledAt && (
                  <span className="inline-flex items-center gap-1 text-sky-700">
                    <Clock className="w-3.5 h-3.5" /> {new Date(c.scheduledAt).toLocaleString()}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="badge" style={statusStyle(c.status)}>{c.status}</span>
              <ArrowRight className="w-4 h-4 text-muted" />
            </div>
          </Link>
        ))}
      </div>

      <CampaignModal
        open={showNew}
        onClose={() => setShowNew(false)}
        onCreated={(id) => router.push(`/campaigns/${id}`)}
      />
    </div>
  );
}
