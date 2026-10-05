"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Send, ArrowRight, Clock } from "lucide-react";
import type { Campaign } from "@/lib/types";
import CampaignModal from "@/components/CampaignModal";
import { getJson, errorText } from "@/lib/client-fetch";

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
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    // Load the list once. The dispatcher tick runs separately via AutoDispatch; use
    // a page refresh to see status changes (avoids extra Neon-transfer round-trips).
    getJson<{ campaigns?: Campaign[] }>("/api/campaigns")
      .then((d) => { setCampaigns(d.campaigns ?? []); setLoaded(true); })
      .catch((e) => setLoadError(`Couldn’t load your campaigns — this is a connection problem, not lost data. ${errorText(e)}`));
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
        {loadError && <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">{loadError}</p>}
        {!loaded && !loadError && <div className="card p-8 text-center text-muted">Loading…</div>}
        {loaded && campaigns.length === 0 && <div className="card p-8 text-center text-muted">No campaigns yet. Click “New campaign” to choose a list and a mail.</div>}
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
