"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SEND_TIMEZONES } from "@/lib/send-window";
import { Loader2, Rocket, Clock, Send, Paperclip, X } from "lucide-react";
import type { Template, List, Attachment } from "@/lib/types";

const MAX_ATTACH_BYTES = 20 * 1024 * 1024; // 20MB total (under Gmail's 25MB)

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Pick the sending mailbox that belongs to a mail's brand, so a XamBaaz mail goes out
// from a xambaaz address and a Brand Vibe mail from a brandvibe one. Matches the
// category against the address ("XamBaaz" -> partnerships@xambaaz.com), and prefers a
// custom-domain mailbox over a free consumer one when both match — the domain sender is
// authenticated (SPF/DKIM/DMARC) and is what we want used by default.
const CONSUMER_MAIL = /@(gmail|googlemail|outlook|hotmail|yahoo|live|aol)\./i;

export function mailboxForCategory(category: string | null | undefined, mailboxes: { id: string }[]): string | null {
  const key = (category || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!key) return null;
  const matches = mailboxes.filter((m) => m.id.toLowerCase().replace(/[^a-z0-9]/g, "").includes(key));
  if (!matches.length) return null;
  return (matches.find((m) => !CONSUMER_MAIL.test(m.id)) ?? matches[0]).id;
}

// Mails grouped by category, so picking "the XamBaaz one" out of a dozen is immediate.
// The API already returns them in category order, so one pass preserves it.
function groupTemplates(templates: Template[]): [string, Template[]][] {
  const g = new Map<string, Template[]>();
  for (const t of templates) {
    const k = t.category || "Uncategorised";
    (g.get(k) ?? g.set(k, []).get(k)!).push(t);
  }
  return [...g.entries()];
}

type Target = { prospectIds: string[] } | { listId: string } | { listIds: string[] };

export default function CampaignModal({
  open,
  onClose,
  onCreated,
  target,
  count,
  defaultName,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (campaignId: string) => void;
  target?: Target; // if omitted, the modal shows a saved-list picker
  count?: number;
  defaultName?: string;
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [lists, setLists] = useState<List[]>([]);
  const [mailboxes, setMailboxes] = useState<{ id: string; label: string }[]>([]);
  const [fromMailbox, setFromMailbox] = useState("");
  const [sendTz, setSendTz] = useState<string>(SEND_TIMEZONES[0].id);
  const [name, setName] = useState(defaultName || "");
  const [templateId, setTemplateId] = useState("");
  const [followupTemplateId, setFollowupTemplateId] = useState("");
  const [followupDays, setFollowupDays] = useState(7);
  const [followup2TemplateId, setFollowup2TemplateId] = useState("");
  const [followup2Days, setFollowup2Days] = useState(7);
  const [pickedListIds, setPickedListIds] = useState<Set<string>>(new Set());
  const [when, setWhen] = useState<"now" | "schedule">("now");
  const [scheduledAt, setScheduledAt] = useState("");
  const [attachments, setAttachments] = useState<(Attachment & { size: number })[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const needsListPicker = !target;

  useEffect(() => {
    if (!open) return;
    setName(defaultName || `Outreach — ${new Date().toLocaleDateString()}`);
    setWhen("now"); setScheduledAt(""); setError(""); setPickedListIds(new Set()); setAttachments([]);
    setSendTz(SEND_TIMEZONES[0].id);
    fetch("/api/templates").then((r) => r.json()).then((d) => {
      setTemplates(d.templates ?? []);
      if (d.templates?.[0]) setTemplateId((prev) => prev || d.templates[0].id);
    });
    fetch("/api/mailboxes").then((r) => r.json()).then((d) => {
      const boxes = d.mailboxes ?? [];
      setMailboxes(boxes);
      setFromMailbox(boxes[0]?.id ?? "");
    });
    if (needsListPicker) {
      fetch("/api/lists").then((r) => r.json()).then((d) => setLists(d.lists ?? []));
    }
  }, [open, defaultName, needsListPicker]);

  function toggleList(id: string) {
    setPickedListIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  const attachBytes = useMemo(() => attachments.reduce((s, a) => s + a.size, 0), [attachments]);
  const templateGroups = useMemo(() => groupTemplates(templates), [templates]);

  // Follow the mail's brand: choosing a XamBaaz mail selects the XamBaaz sender, a Brand
  // Vibe mail the Brand Vibe one. Still fully overridable — this only sets the default,
  // so the wrong brand can't go out simply by forgetting to change the dropdown.
  const activeTemplate = templates.find((t) => t.id === templateId);
  useEffect(() => {
    if (!mailboxes.length || !activeTemplate) return;
    const want = mailboxForCategory(activeTemplate.category, mailboxes);
    if (want) setFromMailbox(want);
  }, [templateId, mailboxes, activeTemplate]);

  function readAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!files.length) return;
    setError("");
    const added: (Attachment & { size: number })[] = [];
    for (const f of files) {
      if (attachments.some((a) => a.filename === f.name && a.size === f.size)) continue;
      added.push({ filename: f.name, contentType: f.type || "application/octet-stream", content: await readAsBase64(f), size: f.size });
    }
    const next = [...attachments, ...added].slice(0, 10);
    if (next.reduce((s, a) => s + a.size, 0) > MAX_ATTACH_BYTES) {
      setError("Attachments exceed 20MB total. Use a shared link for larger files.");
      return;
    }
    setAttachments(next);
  }

  function removeAttachment(idx: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }

  const resolvedCount = useMemo(() => {
    if (target) return count ?? 0;
    // Sum of selected list counts (overlaps are de-duped at create time).
    return lists.filter((l) => pickedListIds.has(l.id)).reduce((s, l) => s + l.count, 0);
  }, [target, count, lists, pickedListIds]);

  // Rough plan: how long these will take to fully go out given a ~200/day Gmail-safe
  // pace. Purely informational so the user sets realistic expectations.
  const planNote = useMemo(() => {
    const n = resolvedCount;
    if (!n) return "";
    const perDay = 200;
    if (n <= perDay) return `≈ ${n} email${n > 1 ? "s" : ""} — should clear in one sending window.`;
    const days = Math.ceil(n / perDay);
    return `≈ ${n} emails — drips over ~${days} days at a safe ${perDay}/day pace. The rest stays queued and auto-continues.`;
  }, [resolvedCount]);

  if (!open) return null;

  async function create() {
    if (!name.trim()) { setError("Give the campaign a name."); return; }
    if (!templateId) { setError("Pick a mail to send."); return; }
    if (needsListPicker && pickedListIds.size === 0) { setError("Choose at least one client list."); return; }
    if (when === "schedule" && !scheduledAt) { setError("Pick a delivery date & time."); return; }
    if (when === "schedule" && new Date(scheduledAt).getTime() <= Date.now()) { setError("Pick a date & time in the future."); return; }
    setBusy(true);
    setError("");
    try {
      const tgt: Target = target ?? { listIds: [...pickedListIds] };
      const body: Record<string, unknown> = {
        name, templateId, followupTemplateId: followupTemplateId || null, followupDays,
        followup2TemplateId: (followupTemplateId && followup2TemplateId) || null, followup2Days,
        fromMailbox: fromMailbox || null, sendTz, ...tgt,
        attachments: attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, content: a.content })),
      };
      if (when === "schedule") body.scheduledAt = new Date(scheduledAt).toISOString();

      const d = await fetch("/api/campaigns", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }).then((r) => r.json());
      if (!d.campaign) { setError(d.error || "Failed to create campaign"); setBusy(false); return; }

      if (when === "now") {
        await fetch(`/api/campaigns/${d.campaign.id}/send`, { method: "POST" });
      }
      onCreated(d.campaign.id);
    } finally {
      setBusy(false);
    }
  }

  // datetime-local min = now (local)
  const minDt = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="card p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-lg mb-1">New campaign</h3>
        <p className="text-sm text-muted mb-1">{resolvedCount} recipients</p>
        {planNote && <p className="text-xs text-indigo-600 mb-4">{planNote}</p>}

        <label className="text-sm font-semibold block mb-1">Campaign name</label>
        <input className="input mb-4" value={name} onChange={(e) => setName(e.target.value)} />

        {needsListPicker && (
          <>
            <label className="text-sm font-semibold block mb-1">Client lists <span className="text-muted font-normal">(pick one or more)</span></label>
            {lists.length === 0 ? (
              <p className="text-sm text-muted mb-4">No lists yet — create one in Lists &amp; Upload first.</p>
            ) : (
              <div className="border border-border-soft rounded-lg mb-4 max-h-40 overflow-y-auto divide-y divide-border-soft">
                {lists.map((l) => (
                  <label key={l.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                    <input type="checkbox" checked={pickedListIds.has(l.id)} onChange={() => toggleList(l.id)} />
                    <span className="flex-1">{l.name}</span>
                    <span className="text-muted text-xs">{l.count}</span>
                  </label>
                ))}
              </div>
            )}
          </>
        )}

        {mailboxes.length > 0 && (
          <>
            <label className="text-sm font-semibold block mb-1">Send from</label>
            <select className="select" value={fromMailbox} onChange={(e) => setFromMailbox(e.target.value)}>
              {mailboxes.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <p className="text-xs text-muted mt-1 mb-4">
              {CONSUMER_MAIL.test(fromMailbox)
                ? "Free mailbox — lower inbox placement. Prefer the brand's own domain address."
                : "Matched to the mail's brand. Sends on your own authenticated domain."}
            </p>
          </>
        )}

        <label className="text-sm font-semibold block mb-1">Recipients&apos; time zone</label>
        <select className="select" value={sendTz} onChange={(e) => setSendTz(e.target.value)}>
          {SEND_TIMEZONES.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
        </select>
        <p className="text-xs text-muted mt-1 mb-4">
          Scheduled sends and follow-ups go out Mon–Sat, 9:00–20:00 in this zone — never on a Sunday here or in India.
        </p>

        <label className="text-sm font-semibold block mb-1">Mail to send</label>
        <select className="select mb-4" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
          {templateGroups.map(([cat, items]) => (
            <optgroup key={cat} label={cat}>
              {items.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </optgroup>
          ))}
        </select>

        <label className="text-sm font-semibold block mb-1">
          Follow-up <span className="text-muted font-normal">(optional, to non-repliers)</span>
        </label>
        <div className="flex gap-2 mb-4">
          <select className="select" value={followupTemplateId} onChange={(e) => setFollowupTemplateId(e.target.value)}>
            <option value="">— No follow-up —</option>
            {templateGroups.map(([cat, items]) => (
              <optgroup key={cat} label={cat}>
                {items.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </optgroup>
            ))}
          </select>
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-sm text-muted">after</span>
            <input type="number" min={1} max={60} className="input w-16 text-center" value={followupDays}
              onChange={(e) => setFollowupDays(Number(e.target.value) || 7)} disabled={!followupTemplateId} />
            <span className="text-sm text-muted">days</span>
          </div>
        </div>

        {followupTemplateId && (
          <>
            <label className="text-sm font-semibold block mb-1">
              Second follow-up <span className="text-muted font-normal">(optional &ldquo;breakup&rdquo; mail, after the first follow-up)</span>
            </label>
            <div className="flex gap-2 mb-4">
              <select className="select" value={followup2TemplateId} onChange={(e) => setFollowup2TemplateId(e.target.value)}>
                <option value="">— No second follow-up —</option>
                {templateGroups.map(([cat, items]) => (
                  <optgroup key={cat} label={cat}>
                    {items.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </optgroup>
                ))}
              </select>
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-sm text-muted">after</span>
                <input type="number" min={1} max={60} className="input w-16 text-center" value={followup2Days}
                  onChange={(e) => setFollowup2Days(Number(e.target.value) || 7)} disabled={!followup2TemplateId} />
                <span className="text-sm text-muted">days</span>
              </div>
            </div>
          </>
        )}

        <label className="text-sm font-semibold block mb-1">
          Attachments <span className="text-muted font-normal">(optional, sent with every mail)</span>
        </label>
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onPickFiles} />
        <div className="mb-1">
          <button type="button" className="chip" onClick={() => fileInputRef.current?.click()}>
            <Paperclip className="w-3.5 h-3.5" /> Attach files
          </button>
        </div>
        {attachments.length > 0 && (
          <div className="border border-border-soft rounded-lg mb-1 divide-y divide-border-soft">
            {attachments.map((a, i) => (
              <div key={`${a.filename}-${i}`} className="flex items-center gap-2 px-3 py-2 text-sm">
                <Paperclip className="w-3.5 h-3.5 text-muted shrink-0" />
                <span className="flex-1 truncate">{a.filename}</span>
                <span className="text-muted text-xs shrink-0">{humanSize(a.size)}</span>
                <button type="button" className="text-muted hover:text-danger" onClick={() => removeAttachment(i)} aria-label="Remove attachment">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-muted mb-4">
          {attachments.length > 0
            ? `${attachments.length} file${attachments.length > 1 ? "s" : ""} · ${humanSize(attachBytes)} of 20MB`
            : "Attach a deck, one-pager, or PDF. Same files go to every recipient (and follow-ups)."}
        </p>

        <label className="text-sm font-semibold block mb-2">Delivery</label>
        <div className="flex gap-2 mb-3">
          <button className={`chip ${when === "now" ? "chip-active" : ""}`} onClick={() => setWhen("now")}>
            <Send className="w-3.5 h-3.5" /> Send now
          </button>
          <button className={`chip ${when === "schedule" ? "chip-active" : ""}`} onClick={() => setWhen("schedule")}>
            <Clock className="w-3.5 h-3.5" /> Schedule
          </button>
        </div>
        {when === "schedule" && (
          <input type="datetime-local" className="input mb-1" min={minDt} value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
        )}
        <p className="text-xs text-muted mb-4">
          {when === "now"
            ? "Emails go out immediately (auto-paced under the daily cap)."
            : "Queued — it sends automatically within the hour of your scheduled time, even with the app closed. You can also open the campaign and send it manually any time."}
        </p>

        {error && <p className="text-sm text-danger mb-3 font-medium">{error}</p>}
        <div className="flex justify-end gap-2 sticky bottom-0 bg-white pt-3 -mx-6 px-6 -mb-6 pb-6 border-t border-border-soft">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={create}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
            {when === "now" ? "Create & send" : "Schedule"}
          </button>
        </div>
      </div>
    </div>
  );
}
