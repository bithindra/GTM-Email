"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Users, Send, MailOpen, Reply, MousePointerClick, AlertTriangle, ArrowRight, Gauge, Clock } from "lucide-react";

type Stats = {
  totals: { prospects: number; campaigns: number; sent: number; delivered: number; opened: number; clicked: number; replied: number; bounced: number };
  rates: { deliveryRate: number; openRate: number; clickRate: number; replyRate: number; bounceRate: number };
  funnel: { stage: string; value: number }[];
  sendBudget: { sentToday: number; dailyLimit: number; remaining: number };
  scheduled: { id: string; name: string; scheduledAt: string | null; recipientCount: number }[];
  campaignPerformance: { id: string; name: string; status: string; recipients: number; sent: number; delivered: number; opened: number; clicked: number; replied: number }[];
};

const FUNNEL_COLORS = ["#6366f1", "#3b82f6", "#f59e0b", "#06b6d4", "#10b981"];

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [campaigns, setCampaigns] = useState<{ id: string; name: string; status: string; recipientCount: number; createdAt: string }[]>([]);

  useEffect(() => {
    // Load dashboard data immediately. The dispatcher tick runs separately via
    // AutoDispatch (in the layout), so the UI never waits on the ~3.5s tick.
    const load = () => {
      fetch("/api/stats").then((r) => r.json()).then(setStats).catch(() => {});
      fetch("/api/campaigns").then((r) => r.json()).then((d) => setCampaigns(d.campaigns ?? [])).catch(() => {});
    };
    load();
    const t = setTimeout(load, 4000);
    return () => clearTimeout(t);
  }, []);

  const t = stats?.totals;
  const rt = stats?.rates;

  const cards = [
    { label: "Prospects", value: t?.prospects ?? 0, icon: Users, color: "#6366f1" },
    { label: "Emails Sent", value: t?.sent ?? 0, icon: Send, color: "#3b82f6" },
    { label: "Opened", value: t?.opened ?? 0, sub: rt ? `${rt.openRate}% open rate` : "", icon: MailOpen, color: "#f59e0b" },
    { label: "Clicked", value: t?.clicked ?? 0, sub: rt ? `${rt.clickRate}% CTR` : "", icon: MousePointerClick, color: "#06b6d4" },
    { label: "Replied", value: t?.replied ?? 0, sub: rt ? `${rt.replyRate}% reply rate` : "", icon: Reply, color: "#10b981" },
    { label: "Bounced", value: t?.bounced ?? 0, sub: rt ? `${rt.bounceRate}% bounce` : "", icon: AlertTriangle, color: "#ef4444" },
  ];

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">GTM Dashboard</h1>
          <p className="text-sm text-muted mt-1">Outreach performance across all campaigns</p>
        </div>
        <Link href="/prospects" className="btn btn-primary">Find founders <ArrowRight className="w-4 h-4" /></Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className="card p-5">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted">{c.label}</span>
                <span className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: c.color + "1a" }}>
                  <Icon className="w-[18px] h-[18px]" style={{ color: c.color }} />
                </span>
              </div>
              <div className="text-3xl font-bold mt-2">{c.value}</div>
              {c.sub ? <div className="text-xs text-muted mt-0.5">{c.sub}</div> : null}
            </div>
          );
        })}
      </div>

      {/* Today's send budget + upcoming scheduled */}
      <div className="grid md:grid-cols-2 gap-6 mb-6">
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-2"><Gauge className="w-[18px] h-[18px] text-primary" /><h2 className="font-semibold">Today’s send budget</h2></div>
          {stats ? (
            <>
              <div className="flex items-end justify-between mb-2">
                <div className="text-3xl font-bold">{stats.sendBudget.sentToday}<span className="text-base text-muted font-normal"> / {stats.sendBudget.dailyLimit}</span></div>
                <div className="text-sm text-muted">{stats.sendBudget.remaining} left today</div>
              </div>
              <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full bg-primary" style={{ width: `${Math.min(100, (stats.sendBudget.sentToday / stats.sendBudget.dailyLimit) * 100)}%` }} />
              </div>
              <p className="text-xs text-muted mt-2">Sends auto-pace under this cap (Gmail safety). Remaining rolls to the next dispatch.</p>
            </>
          ) : <p className="text-sm text-muted">Loading…</p>}
        </div>

        <div className="card p-5">
          <div className="flex items-center gap-2 mb-3"><Clock className="w-[18px] h-[18px] text-primary" /><h2 className="font-semibold">Scheduled sends</h2></div>
          {stats && stats.scheduled.length > 0 ? (
            <div className="space-y-2">
              {stats.scheduled.slice(0, 5).map((s) => (
                <Link key={s.id} href={`/campaigns/${s.id}`} className="flex items-center justify-between p-3 rounded-lg border border-border-soft hover:bg-slate-50">
                  <div>
                    <div className="font-medium text-sm">{s.name}</div>
                    <div className="text-xs text-muted">{s.recipientCount} recipients</div>
                  </div>
                  <span className="text-xs text-sky-700">{s.scheduledAt ? new Date(s.scheduledAt).toLocaleString() : ""}</span>
                </Link>
              ))}
            </div>
          ) : <p className="text-sm text-muted">No upcoming scheduled campaigns.</p>}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="card p-5">
          <h2 className="font-semibold mb-1">Conversion Funnel</h2>
          <p className="text-xs text-muted mb-4">From send to reply</p>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats?.funnel ?? []} layout="vertical" margin={{ left: 10, right: 20 }}>
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                <YAxis type="category" dataKey="stage" width={72} tick={{ fontSize: 12 }} />
                <Tooltip cursor={{ fill: "#f1f5f9" }} />
                <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                  {(stats?.funnel ?? []).map((_, i) => (
                    <Cell key={i} fill={FUNNEL_COLORS[i % FUNNEL_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Recent Campaigns</h2>
            <Link href="/campaigns" className="text-sm text-primary font-medium">View all</Link>
          </div>
          <div className="space-y-2">
            {campaigns.length === 0 && <p className="text-sm text-muted">No campaigns yet.</p>}
            {campaigns.slice(0, 6).map((c) => (
              <Link key={c.id} href={`/campaigns/${c.id}`} className="flex items-center justify-between p-3 rounded-lg border border-border-soft hover:bg-slate-50">
                <div>
                  <div className="font-medium text-sm">{c.name}</div>
                  <div className="text-xs text-muted">{c.recipientCount} recipients</div>
                </div>
                <span className="badge" style={{ background: "#eef2ff", color: "#4338ca" }}>{c.status}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Campaign-wise performance */}
      <div className="card overflow-hidden mt-6">
        <div className="p-4 border-b border-border-soft font-semibold">Campaign performance</div>
        {stats && stats.campaignPerformance.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-muted text-left">
                <tr>
                  <th className="p-3">Campaign</th>
                  <th className="p-3 text-center">Recipients</th>
                  <th className="p-3 text-center">Sent</th>
                  <th className="p-3 text-center">Delivered</th>
                  <th className="p-3 text-center">Opened</th>
                  <th className="p-3 text-center">Replied</th>
                  <th className="p-3 text-center">Open %</th>
                </tr>
              </thead>
              <tbody>
                {stats.campaignPerformance.map((c) => (
                  <tr key={c.id} className="border-t border-border-soft hover:bg-slate-50">
                    <td className="p-3">
                      <Link href={`/campaigns/${c.id}`} className="font-medium text-primary hover:underline">{c.name}</Link>
                      <span className="ml-2 badge" style={{ background: "#eef2ff", color: "#4338ca" }}>{c.status}</span>
                    </td>
                    <td className="p-3 text-center">{c.recipients}</td>
                    <td className="p-3 text-center">{c.sent}</td>
                    <td className="p-3 text-center">{c.delivered}</td>
                    <td className="p-3 text-center">{c.opened}</td>
                    <td className="p-3 text-center font-semibold" style={{ color: c.replied ? "#15803d" : undefined }}>{c.replied}</td>
                    <td className="p-3 text-center text-muted">{c.delivered ? Math.round((c.opened / c.delivered) * 100) : 0}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="p-6 text-sm text-muted">No campaigns yet.</p>}
      </div>
    </div>
  );
}
