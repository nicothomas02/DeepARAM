"use client";

import { useEffect, useMemo, useState } from "react";
import type { Content, Field } from "@/lib/content";

// One form per group of fields, for the signed-in site owner. Saving commits the text (see lib/admin.ts).
export default function AdminEditor({ fields }: { fields: Field[] }) {
  const [unlocked, setUnlocked] = useState(false);
  const [saved, setSaved] = useState<Content>({});
  const [draft, setDraft] = useState<Content>({});
  const [sha, setSha] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: "ok" | "error" | "busy"; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      setStatus({ kind: "busy", text: "Loading…" });
      const res = await fetch("/api/admin/content", { cache: "no-store" });
      const data = await res.json().catch(() => ({ error: "Unexpected response" }));
      if (!res.ok) return setStatus({ kind: "error", text: data.error });
      setSaved(data.content);
      setDraft(data.content);
      setSha(data.sha);
      setUnlocked(true);
      setStatus(data.sha ? null : { kind: "error", text: "Saving isn't set up yet, so changes can't be published. Showing the current text." });
    })();
  }, []);

  const changed = useMemo(() => fields.filter((f) => (draft[f.key] ?? "") !== (saved[f.key] ?? "")).length, [fields, draft, saved]);
  const groups = useMemo(() => [...new Set(fields.map((f) => f.group))], [fields]);

  const save = async () => {
    setStatus({ kind: "busy", text: "Saving…" });
    const res = await fetch("/api/admin/content", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: draft, sha }),
    });
    const data = await res.json().catch(() => ({ error: "Unexpected response" }));
    if (!res.ok) return setStatus({ kind: "error", text: data.error });
    setSha(data.sha);
    setSaved(draft);
    setStatus({ kind: "ok", text: "Saved. The site shows it in about a minute." });
  };

  if (!unlocked) return status ? <p className={`admin-status ${status.kind}`}>{status.text}</p> : null;

  return (
    <div className="admin">
      {groups.map((g) => (
        <section key={g} className="card admin-group">
          <h2>{g}</h2>
          {fields
            .filter((f) => f.group === g)
            .map((f) => {
              const id = `f-${f.key}`;
              const props = { id, value: draft[f.key] ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft({ ...draft, [f.key]: e.target.value }) };
              return (
                <div key={f.key} className="admin-field">
                  <label htmlFor={id}>
                    {f.label}
                    {(draft[f.key] ?? "") !== (saved[f.key] ?? "") && <span className="admin-dot">edited</span>}
                  </label>
                  {f.long ? <textarea rows={3} {...props} /> : <input type="text" {...props} />}
                  {f.hint && <p className="admin-hint">{f.hint}</p>}
                </div>
              );
            })}
        </section>
      ))}
      <div className="admin-bar">
        <span className={`admin-status ${status?.kind ?? ""}`}>{status?.text ?? (changed ? `${changed} unsaved change${changed === 1 ? "" : "s"}` : "No changes")}</span>
        <button type="button" className="btn ghost" disabled={!changed} onClick={() => setDraft(saved)}>
          Discard
        </button>
        <button type="button" className="btn" disabled={!changed || !sha || status?.kind === "busy"} onClick={save}>
          Save and publish
        </button>
      </div>
    </div>
  );
}
