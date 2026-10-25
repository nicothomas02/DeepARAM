LabI18n.ready(function () {
  const data = window.COOK_DATA;
  const T = LabI18n.t;
  // Official names in the visitor's language, English when there is none.
  const champ = (b) => LabI18n.name("champions", b.champion, b.champion_name);
  const augName = (a) => LabI18n.name("augments", a.id, a.name);
  const itemName = (b, i) => LabI18n.name("items", (b.item_ids || [])[i], b.items[i]);

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const icon = (path) => (window.COOK_ICONS && window.COOK_ICONS[path]) || path;
  const day = (iso) => LabI18n.date(iso, { month: "short", day: "numeric" });
  const fullDay = (iso) => LabI18n.date(iso, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  // Every build with a `chef` date was the Chef Special that day; a new one is added every day and the
  // older ones stay in the archive. Today's is the newest. No stats: a Chef Special is picked for the idea.
  const specials = data.builds.filter((b) => b.chef).sort((a, b) => b.chef.localeCompare(a.chef));
  const chef = specials[0] || null;

  // Share links open a special by its date, so they keep working after it is replaced. On the site that's
  // /kitchen/<date>, whose link preview shows the special's card; elsewhere (a saved copy) the page's own #hash.
  function shareUrl(hash) {
    const date = hash.replace(/^chefs-special-/, "");
    if (/^https?:$/.test(location.protocol) && /^\d{4}-\d{2}-\d{2}$/.test(date)) return location.origin + "/kitchen/" + date;
    return location.href.replace(/#.*$/, "") + "#" + hash;
  }
  // Same look and words as the site's Share button (web/src/components/ShareButton.tsx).
  const SHARE_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/></svg>';
  const shareButton = (b) => `<button type="button" class="share" data-share="chefs-special-${esc(b.chef)}" data-title="${esc(T(b.title))}" aria-label="${esc(T("Share {title}", { title: T(b.title) }))}">${SHARE_ICON}<span aria-live="polite">${T("Share")}</span></button>`;
  // Phones open the share sheet; elsewhere the link is copied.
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-share]");
    if (!btn) return;
    const url = btn.dataset.url || shareUrl(btn.dataset.share);
    const label = btn.querySelector("span");
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      try { await navigator.share({ title: btn.dataset.title + " · DeepARAM", url }); return; }
      catch (err) { if (err && err.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(url); label.textContent = T("Link copied"); }
    catch (err) { window.prompt(T("Copy this link"), url); }
    setTimeout(() => { label.textContent = T("Share"); }, 2500);
  });

  function augRow(a) {
    // A flex augment is optional: the build works without it.
    return `<li class="${a.core ? "core" : "flex"}">
      <img src="${icon(a.icon)}" alt="" width="32" height="32" loading="lazy">
      <div>
        <div class="name"${a.core ? "" : ` data-flex="${esc(T("flex"))}"`}>${esc(augName(a))} <span class="chip ${a.rarity.toLowerCase()}">${esc(T(a.rarity))}</span></div>
        <div class="desc">${esc(T(a.text))}</div>
      </div>
    </li>`;
  }

  function card(b) {
    return `<article class="card" id="${esc(b.id)}">
      <div class="card-head">
        <img src="${icon(b.champion_icon)}" alt="" width="52" height="52" loading="lazy">
        <div class="who">
          <h2>${esc(T(b.title))}</h2>
          <div class="sub">${esc(champ(b))}</div>
        </div>
        ${shareButton(b)}
      </div>
      <p class="why">${esc(T(b.why))}</p>
      <p class="play muted"><b>${T("How to play:")}</b> ${esc(T(b.play))}</p>
      <div class="cols">
        <div><h3>${T("Augments")}</h3><ul class="augs">${b.augments.map(augRow).join("")}</ul></div>
        <div><h3>${T("Items")}</h3><ul class="items">${b.items.map((x, i) => `<li>${esc(itemName(b, i))}</li>`).join("")}</ul></div>
      </div>
    </article>`;
  }

  // The Chef Special box shows today's special, or an older one picked from the archive.
  function showSpecial(b) {
    const box = document.getElementById("chefs-special");
    const i = specials.indexOf(b);
    const today = b === chef;
    const label = esc(T(today ? "Today's Chef Special · {date}" : "Chef Special · {date}", { date: day(b.chef) }));
    const opts = specials.map((s) => `<option value="${esc(s.chef)}"${s === b ? " selected" : ""}>${esc(day(s.chef))} · ${esc(T(s.title))} (${esc(champ(s))})</option>`).join("");
    box.innerHTML = `<div class="chef-head"><p class="eyebrow" id="chef-label">${label}</p>
      <p class="muted small">${today ? T("A new unconventional build every day, built on augments that work together.") : `${esc(T("Served {date}.", { date: fullDay(b.chef) }))} <a href="#chefs-special">${T("Back to today's")}</a>`}</p></div>
      <div class="chef-archive" id="chef-archive" role="group" aria-label="${T("Chef Special archive")}">
        <span class="eyebrow">${esc(T(specials.length === 1 ? "Archive · {n} special" : "Archive · {n} specials", { n: specials.length }))}</span>
        <button type="button" data-go="${i + 1}"${i + 1 >= specials.length ? " disabled" : ""}>${T("‹ Earlier")}</button>
        <select aria-label="${T("Pick a day")}">${opts}</select>
        <button type="button" data-go="${i - 1}"${i <= 0 ? " disabled" : ""}>${T("Later ›")}</button>
      </div>${card(b)}`;
    box.hidden = false;
    box.querySelector("select").addEventListener("change", (e) => go(specials.find((s) => s.chef === e.target.value)));
    for (const btn of box.querySelectorAll("button[data-go]")) btn.addEventListener("click", () => go(specials[+btn.dataset.go]));
  }
  function go(b) {
    if (!b) return;
    history.replaceState(null, "", b === chef ? "#chefs-special" : "#chefs-special-" + b.chef);
    showSpecial(b);
  }
  // #chefs-special-YYYY-MM-DD opens that day's special; anything else opens today's.
  function fromHash() {
    const m = location.hash.match(/^#chefs-special-(\d{4}-\d{2}-\d{2})$/);
    return (m && specials.find((s) => s.chef === m[1])) || chef;
  }
  // Community builds: sent from the Simulator by signed-in players and approved by the site owner
  // (/api/kitchen/community). Their own words stay as written; names follow the page's language.
  function communityCard(c) {
    const by = c.by ? T("by {name}", { name: c.by }) : T("by a DeepARAM player");
    // Its share link's preview shows the build's card (web/src/app/share/builds).
    const link = location.origin + "/share/builds?" + new URLSearchParams({ champ: c.champion, items: c.items.map((i) => i.id).join(","), augs: c.augments.map((a) => a.id).join(","), title: c.title, to: "kitchen" });
    return `<article class="card community-card">
      <div class="card-head">
        <img src="/icons/champions/${esc(c.champion)}.webp" alt="" width="52" height="52" loading="lazy">
        <div class="who">
          <h2 dir="auto">${esc(c.title)}</h2>
          <div class="sub">${esc(LabI18n.name("champions", c.champion, c.championName))} <span class="muted" dir="auto">· ${esc(by)}</span></div>
        </div>
        <button type="button" class="share" data-url="${esc(link)}" data-title="${esc(c.title)}" aria-label="${esc(T("Share {title}", { title: c.title }))}">${SHARE_ICON}<span aria-live="polite">${T("Share")}</span></button>
      </div>
      <p class="why" dir="auto">${esc(c.description)}</p>
      <div class="cols">
        ${c.augments.length ? `<div><h3>${T("Augments")}</h3><ul class="items">${c.augments.map((a) => `<li>${esc(LabI18n.name("augments", a.id, a.name))}</li>`).join("")}</ul></div>` : ""}
        <div><h3>${T("Items")}</h3><ul class="items">${c.items.map((i) => `<li>${esc(LabI18n.name("items", i.id, i.name))}</li>`).join("")}</ul></div>
      </div>
    </article>`;
  }
  if (/^https?:$/.test(location.protocol)) {
    fetch("/api/kitchen/community", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const list = (j && Array.isArray(j.builds) ? j.builds : []).filter((c) => c && c.title && Array.isArray(c.items) && Array.isArray(c.augments));
        if (!list.length) return;
        document.getElementById("community-builds").innerHTML = list.map(communityCard).join("");
        document.getElementById("community").hidden = false;
        if (location.hash === "#community") document.getElementById("community").scrollIntoView();
      })
      .catch(() => {});
  }

  if (chef) showSpecial(fromHash());
  window.addEventListener("hashchange", () => {
    if (!chef || !/^#(chefs-special|chef-archive)/.test(location.hash)) return;
    showSpecial(fromHash());
    document.getElementById("chefs-special").scrollIntoView();
  });
});
