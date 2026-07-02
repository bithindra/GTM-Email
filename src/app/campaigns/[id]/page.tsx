"use client";

import { useCallback, useEffect, useState } from "react";
import { use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Send, Loader2, RefreshCw, ArrowLeft, Reply, Eye, Trash2, X, Mail, Download } from "lucide-react";
import StatusBadge from "@/components/StatusBadge";
import type { Campaign, Recipient, Template } from "@/lib/types";

type PreviewData = {
  to: string; name: string;
  first: { subject: string; body: string } | null;
  followup: { subject: string; body: string; days: number } | null;
};

const SAMPLE: Record<string, string> = { first_name: "Sofia", name: "Sofia Garcia", company: "Nova Labs", title: "Founder & CEO", city: "San Francisco", country: "United States" };
const render = (t: string) => t.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => SAMPLE[k] ?? `{{${k}}}`);

export default function CampaignDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [template, setTemplate] = useState<Template | null>(null);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [filter, setFilter] = useState<"sent" | "delivered" | "opened" | "clicked" | "replied" | null>(null);

  const load = useCallback(async () => {
    const d = await fetch(`/api/campaigns/${id}`).then((r) => r.json());
    setCampaign(d.campaign);
    setRecipients(d.recipients ?? []);
    setTemplate(d.template ?? null);
    setSel(new Set());
  }, [id]);

  function toggleSel(rid: string) {
    setSel((prev) => { const n = new Set(prev); n.has(rid) ? n.delete(rid) : n.add(rid); return n; });
  }
  function toggleAll() {
    setSel((prev) => {
      const allSel = visible.length > 0 && visible.every((r) => prev.has(r.id));
      const n = new Set(prev);
      visible.forEach((r) => (allSel ? n.delete(r.id) : n.add(r.id)));
      return n;
    });
  }
  async function deleteSelected() {
    if (sel.size === 0) return;
    if (!confirm(`Remove ${sel.size} recipient(s) from this campaign? They won't be emailed.`)) return;
    await fetch(`/api/campaigns/${id}/recipients`, {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [...sel] }),
    });
    load();
  }
  async function openPreview(rid: string) {
    setPreviewLoading(true);
    setPreview(null);
    try {
      const d = await fetch(`/api/campaigns/${id}/recipients/${rid}/preview`).then((r) => r.json());
      setPreview(d);
    } finally { setPreviewLoading(false); }
  }

  useEffect(() => { load(); }, [load]);

  // Auto-refresh only while a campaign is actively sending (every 20s). Once "sent",
  // stop polling — use the Refresh button for on-demand updates. Keeps Neon load low.
  useEffect(() => {
    if (campaign?.status !== "sending") return;
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [campaign?.status, load]);

  async function send() {
    setSending(true);
    setNotice("");
    try {
      const d = await fetch(`/api/campaigns/${id}/send`, { method: "POST" }).then((r) => r.json());
      setNotice(d.simulated ? `Simulated ${d.sent} sends (add RESEND_API_KEY to send for real).` : `Sent ${d.sent} emails${d.failed ? `, ${d.failed} failed` : ""}.`);
      await load();
    } finally { setSending(false); }
  }

  async function syncInbox() {
    setSending(true);
    setNotice("");
    try {
      const d = await fetch("/api/inbox/scan").then((r) => r.json());
      if (!d.enabled) setNotice("Inbox sync needs Gmail SMTP configured.");
      else if (d.error) setNotice(`Inbox sync error: ${d.error}`);
      else setNotice(`Inbox synced — ${d.replies} repl${d.replies === 1 ? "y" : "ies"}, ${d.bounces} bounce(s) detected (scanned ${d.scanned}).`);
      await load();
    } finally { setSending(false); }
  }

  async function runFollowups() {
    setSending(true);
    setNotice("");
    try {
      const d = await fetch(`/api/campaigns/${id}/followup`, { method: "POST" }).then((r) => r.json());
      if (d.error) setNotice(d.error);
      else setNotice(d.sent ? `Sent ${d.sent} follow-up${d.sent > 1 ? "s" : ""}.` : `No follow-ups due yet (${d.due ?? 0} pending the ${campaign?.followupDays}-day wait).`);
      await load();
    } finally { setSending(false); }
  }

  async function deleteCampaign() {
    const scheduled = campaign?.status === "scheduled";
    const msg = scheduled
      ? "Cancel this scheduled campaign? It will not send, and the campaign will be deleted."
      : "Delete this campaign and all its tracking data? This cannot be undone.";
    if (!confirm(msg)) return;
    setSending(true);
    try {
      await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
      router.push("/campaigns");
    } finally { setSending(false); }
  }

  async function retryBounced() {
    setSending(true);
    setNotice("");
    try {
      const d = await fetch(`/api/campaigns/${id}/requeue`, { method: "POST" }).then((r) => r.json());
      if (d.error) setNotice(d.error);
      else setNotice(d.requeued ? `Re-queued ${d.requeued} bounced recipient(s) — they'll resend within the mailbox's daily limit.` : "No bounced recipients to retry.");
      await load();
    } finally { setSending(false); }
  }

  // Export the current (filtered) recipient view as CSV — for reporting or CRM import.
  function exportCsv() {
    const esc = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [
      ["Name", "Email", "Company", "Status", "Opens", "Clicks", "Sent at", "Opened at", "Replied at"].join(","),
      ...visible.map((r) => [esc(r.name), esc(r.email), esc(r.company), esc(r.status), r.opens, r.clicks, esc(r.sentAt), esc(r.openedAt), esc(r.repliedAt)].join(",")),
    ];
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(campaign?.name || "campaign").replace(/[^\w.-]+/g, "_")}${filter ? `_${filter}` : ""}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function markReplied(rid: string) {
    await fetch(`/api/recipients/${rid}/event`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "replied" }) });
    await load();
  }

  if (!campaign) return <div className="p-8 text-muted">Loading…</div>;

  const counts = {
    sent: recipients.filter((r) => r.sentAt).length,
    delivered: recipients.filter((r) => r.deliveredAt).length,
    opened: recipients.filter((r) => r.openedAt).length,
    clicked: recipients.filter((r) => r.clickedAt).length,
    replied: recipients.filter((r) => r.repliedAt).length,
  };
  const queued = recipients.filter((r) => r.status === "queued").length;
  const bounced = recipients.filter((r) => r.status === "bounced").length;

  // Clicking a stat card filters the recipients table to those clients.
  const filterFns: Record<NonNullable<typeof filter>, (r: Recipient) => boolean> = {
    sent: (r) => !!r.sentAt, delivered: (r) => !!r.deliveredAt, opened: (r) => !!r.openedAt,
    clicked: (r) => !!r.clickedAt, replied: (r) => !!r.repliedAt,
  };
  const visible = filter ? recipients.filter(filterFns[filter]) : recipients;
  const stats: [typeof filter, string, number][] = [
    ["sent", "Sent", counts.sent], ["delivered", "Delivered", counts.delivered],
    ["opened", "Opened", counts.opened], ["clicked", "Clicked", counts.clicked],
    ["replied", "Replied", counts.replied],
  ];

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <Link href="/campaigns" className="text-sm text-muted flex items-center gap-1 mb-3"><ArrowLeft className="w-4 h-4" /> Campaigns</Link>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{campaign.name}</h1>
          <p className="text-sm text-muted mt-1">
            {campaign.recipientCount} recipients · 1st: {template?.name ?? "—"}
            {campaign.followupTemplateId ? ` · follow-up after ${campaign.followupDays}d` : " · no follow-up"}
          </p>
          {campaign.status === "scheduled" && campaign.scheduledAt && (
            <p className="text-sm text-sky-700 mt-1">⏱ Scheduled for {new Date(campaign.scheduledAt).toLocaleString()} — will auto-send then (or use “Send to …” to send now).</p>
          )}
        </div>
        <div className="flex gap-2">
          <button className="btn btn-ghost" onClick={load}><RefreshCw className="w-4 h-4" /> Refresh</button>
          <button className="btn btn-ghost text-danger" onClick={deleteCampaign} disabled={sending}>
            <Trash2 className="w-4 h-4" /> {campaign.status === "scheduled" ? "Cancel schedule" : "Delete"}
          </button>
          <button className="btn btn-ghost" onClick={syncInbox} disabled={sending}><Mail className="w-4 h-4" /> Sync inbox</button>
          {bounced > 0 && (
            <button className="btn btn-ghost" onClick={retryBounced} disabled={sending} title="Re-queue bounced recipients (e.g. after a daily-limit misfire)">
              <RefreshCw className="w-4 h-4" /> Retry bounced ({bounced})
            </button>
          )}
          {campaign.followupTemplateId && (
            <button className="btn btn-ghost" onClick={runFollowups} disabled={sending}><Reply className="w-4 h-4" /> Send follow-ups</button>
          )}
          <button className="btn btn-primary" onClick={send} disabled={sending || queued === 0}>
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {queued === 0 ? "All sent" : `Send to ${queued}`}
          </button>
        </div>
      </div>

      {notice && <div className="mb-5 p-3 rounded-lg bg-indigo-50 text-indigo-800 text-sm">{notice}</div>}

      {/* Stat strip — click a card to filter the recipients list to those clients */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        {stats.map(([key, label, v]) => (
          <button
            key={label}
            onClick={() => setFilter((prev) => (prev === key ? null : key))}
            disabled={v === 0}
            className={`card p-4 text-center transition ${v === 0 ? "opacity-50 cursor-default" : "cursor-pointer hover:border-primary"} ${filter === key ? "border-primary ring-2 ring-primary/30 bg-indigo-50" : ""}`}
            title={v === 0 ? `No ${label.toLowerCase()} yet` : `Show the ${v} client${v === 1 ? "" : "s"} who ${label.toLowerCase()}`}
          >
            <div className="text-2xl font-bold">{v}</div>
            <div className="text-xs text-muted mt-0.5">{label}</div>
          </button>
        ))}
      </div>

      <div className="grid md:grid-cols-[1fr_320px] gap-6">
        {/* Recipients */}
        <div className="card overflow-hidden">
          <div className="p-4 border-b border-border-soft flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">Recipients</span>
              {filter && (
                <button className="chip chip-active !py-0.5" onClick={() => setFilter(null)} title="Clear filter">
                  {filter} · {visible.length} <X className="w-3 h-3" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {sel.size > 0 && (
                <button className="btn btn-ghost !py-1.5 !px-3 text-danger" onClick={deleteSelected}>
                  <Trash2 className="w-4 h-4" /> Remove selected ({sel.size})
                </button>
              )}
              <button className="btn btn-ghost !py-1.5 !px-3" onClick={exportCsv} title="Download the current view as CSV">
                <Download className="w-4 h-4" /> Export CSV
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-muted text-left">
                <tr>
                  <th className="p-3 w-8"><input type="checkbox" checked={visible.length > 0 && visible.every((r) => sel.has(r.id))} onChange={toggleAll} /></th>
                  <th className="p-3">Client</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-center">Opens</th>
                  <th className="p-3 text-center">Clicks</th>
                  <th className="p-3 text-right">Mail</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id} className="border-t border-border-soft">
                    <td className="p-3 text-center"><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggleSel(r.id)} /></td>
                    <td className="p-3"><div className="font-medium">{r.name}</div><div className="text-xs text-muted">{r.email}</div></td>
                    <td className="p-3"><StatusBadge status={r.status} /></td>
                    <td className="p-3 text-center">{r.opens}</td>
                    <td className="p-3 text-center">{r.clicks}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-3 justify-end">
                        {r.status !== "replied" && r.status !== "queued" && (
                          <button className="text-xs text-primary font-medium flex items-center gap-1" onClick={() => markReplied(r.id)}>
                            <Reply className="w-3.5 h-3.5" /> Replied
                          </button>
                        )}
                        {r.followupSentAt && <span className="text-[11px] text-muted">↻</span>}
                        <button className="text-muted hover:text-primary flex items-center gap-1 text-xs" onClick={() => openPreview(r.id)} title="Preview the exact email this client gets">
                          <Eye className="w-4 h-4" /> View mail
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Email preview */}
        <div className="card p-5 h-fit">
          <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">Email being sent</div>
          {template ? (
            <div className="border border-border-soft rounded-lg overflow-hidden">
              <div className="px-3 py-2 border-b border-border-soft bg-slate-50 text-xs">
                <span className="text-muted">Subject: </span><span className="font-semibold">{render(template.subject)}</span>
              </div>
              <div className="p-3 text-[13px] whitespace-pre-wrap leading-relaxed">{render(template.body)}</div>
            </div>
          ) : <p className="text-sm text-muted">No template linked.</p>}
          <Link href="/templates" className="text-xs text-primary font-medium mt-3 inline-block">Edit template →</Link>
        </div>
      </div>

      {/* Per-recipient email preview modal */}
      {(preview || previewLoading) && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setPreview(null)}>
          <div className="card w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-border-soft sticky top-0 bg-white">
              <h3 className="font-bold">Email preview</h3>
              <button className="text-muted hover:text-foreground" onClick={() => setPreview(null)}><X className="w-5 h-5" /></button>
            </div>
            {previewLoading || !preview ? (
              <div className="p-8 text-center text-muted"><Loader2 className="w-5 h-5 animate-spin inline" /></div>
            ) : (
              <div className="p-5 space-y-4">
                <div className="text-sm"><span className="text-muted">To: </span><span className="font-medium">{preview.name}</span> &lt;{preview.to}&gt;</div>
                {preview.first && (
                  <div className="border border-border-soft rounded-lg overflow-hidden">
                    <div className="px-3 py-2 border-b border-border-soft bg-slate-50 text-xs">
                      <span className="text-muted">Mail 1 · Subject: </span><span className="font-semibold">{preview.first.subject}</span>
                    </div>
                    <div className="p-3 text-[13px] whitespace-pre-wrap leading-relaxed">{preview.first.body}</div>
                  </div>
                )}
                {preview.followup && (
                  <div className="border border-border-soft rounded-lg overflow-hidden">
                    <div className="px-3 py-2 border-b border-border-soft bg-slate-50 text-xs">
                      <span className="text-muted">Follow-up (after {preview.followup.days}d) · Subject: </span><span className="font-semibold">{preview.followup.subject}</span>
                    </div>
                    <div className="p-3 text-[13px] whitespace-pre-wrap leading-relaxed">{preview.followup.body}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
