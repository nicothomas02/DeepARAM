"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { ACCOUNT_EVENT, forgetAccount, syncAccount } from "@/lib/account-sync";
import { useBotCheck } from "@/lib/bot-check-client";
import championNames from "@/data/champion-names.json";
import { LocalDate, useNames, useT } from "./I18n";

// The account page (/account): sign in or create an account, then manage it. Settings
// sync on their own (lib/account-sync.ts); this page covers passkeys, the password, the connected Riot
// account, the profile, the email and deleting the account. The owner opens the 3D Simulator from the Simulator page.

type Account = {
  signedIn: true;
  id: string;
  email: string | null;
  /** Display name and champion icon, shown on this page. */
  name: string | null;
  icon: string | null;
  hasPassword: boolean;
  owner: boolean;
  data: { settings: Record<string, unknown> };
  passkeys: { id: string; label: string; created: string }[];
  riot: { name: string; platform: string | null; page: string | null } | null;
  passkeySession: boolean;
  /** Sign in with Google or Apple: the ones switched on (lib/oauth.ts), and the ones this account uses. */
  providers: Provider[];
  logins: { provider: Provider; name: string; email: string | null }[];
};

type Provider = "google" | "apple" | "discord" | "twitch" | "microsoft" | "steam" | "facebook" | "x" | "github";
const PROVIDER_NAMES: Record<Provider, string> = {
  google: "Google",
  apple: "Apple",
  discord: "Discord",
  twitch: "Twitch",
  microsoft: "Microsoft",
  steam: "Steam",
  facebook: "Facebook",
  x: "X",
  github: "GitHub",
};
// Shown as buttons; the rest sit under "More".
const MAIN: Provider[] = ["google", "apple", "discord", "twitch"];

/** Buttons for the sign-in services that are switched on: the main ones, then a "More" menu. */
function ProviderButtons({ providers, mode }: { providers: Provider[]; mode: "signin" | "connect" }) {
  const t = useT("account");
  const main = providers.filter((p) => MAIN.includes(p));
  const more = providers.filter((p) => !MAIN.includes(p));
  const label = (name: string) => (mode === "signin" ? t("Continue with {name}", { name }) : t("Connect {name}", { name }));
  const link = (p: Provider) => (
    <a key={p} className="btn ghost acct-provider" href={`/api/account/oauth/${p}/start?mode=${mode}`}>
      {label(PROVIDER_NAMES[p])}
    </a>
  );
  return (
    <>
      {main.map(link)}
      {more.length > 0 && (
        <details className="acct-more">
          <summary>{mode === "signin" ? t("More ways to sign in") : t("More ways to connect")}</summary>
          <div>{more.map(link)}</div>
        </details>
      )}
    </>
  );
}

type Msg = { kind: "ok" | "error"; text: string } | null;

async function call(path: string, method: string, payload?: unknown) {
  const res = await fetch(path, {
    method,
    headers: payload === undefined ? undefined : { "content-type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({ error: "Something went wrong. Try again." }));
  if (!res.ok) throw new Error(data.error ?? "Something went wrong. Try again.");
  return data;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Try again.");
// Passkey prompts the visitor closes on purpose aren't errors worth showing.
const cancelled = (e: unknown) => e instanceof Error && /NotAllowedError|AbortError|cancel/i.test(`${e.name} ${e.message}`);

// Messages, the server's included, are English sentences that double as translation keys.
function Note({ msg }: { msg: Msg }) {
  const t = useT("account");
  return msg ? <p className={`acct-note ${msg.kind}`} role={msg.kind === "error" ? "alert" : "status"}>{t(msg.text)}</p> : null;
}

/** A translated sentence with a link or button where it says {key}. */
function around(text: string, key: string, node: React.ReactNode) {
  const [before, after = ""] = text.split(`{${key}}`);
  return (
    <>
      {before}
      {node}
      {after}
    </>
  );
}

/** What a new passkey is called in the list, from the device that made it. */
function deviceLabel() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|Mac/.test(ua) ? "Apple device" : /Android/.test(ua) ? "Android phone" : /Windows/.test(ua) ? "Windows PC" : "Passkey";
}

// Who is looking at the page, for sections passed in as children (see SignedInOnly).
const Viewer = createContext<{ signedIn: boolean; owner: boolean }>({ signedIn: false, owner: false });

/** Shows its children only to a signed-in player (or only the owner), so their requests aren't sent for anyone else. */
export function SignedInOnly({ owner = false, children }: { owner?: boolean; children: React.ReactNode }) {
  const v = useContext(Viewer);
  return v.signedIn && (!owner || v.owner) ? children : null;
}

export default function AccountPanel({ children }: { children?: React.ReactNode }) {
  const t = useT("account");
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [providers, setProviders] = useState<Provider[]>([]);
  // Coming back from another sign-in service: ?signin-error=<what went wrong>, or a Riot connect: ?riot=connected / ?riot-error=.
  const [riotMsg, setRiotMsg] = useState<Msg>(null);

  const refresh = useCallback(async () => {
    const a = await fetch("/api/account", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
    setProviders(Array.isArray(a?.providers) ? a.providers : []);
    setAccount(a?.signedIn ? a : null);
  }, []);

  useEffect(() => {
    void refresh();
    const q = new URLSearchParams(location.search);
    const error = q.get("riot-error") ?? q.get("signin-error");
    if (error || q.get("riot") === "connected") {
      setRiotMsg(error ? { kind: "error", text: error.slice(0, 200) } : { kind: "ok", text: "Your Riot account is connected." });
      history.replaceState(null, "", location.pathname);
      if (!error) void syncAccount().then(() => window.dispatchEvent(new Event(ACCOUNT_EVENT)));
    }
  }, [refresh]);

  const signedIn = async () => {
    await syncAccount();
    window.dispatchEvent(new Event(ACCOUNT_EVENT));
    await refresh();
  };

  if (account === undefined) return <p className="acct-loading">{t("Loading your account…")}</p>;
  return (
    <Viewer.Provider value={{ signedIn: Boolean(account), owner: Boolean(account?.owner) }}>
      <Note msg={riotMsg} />
      {account ? (
        <Manage account={account} refresh={refresh}>
          {children}
        </Manage>
      ) : (
        <>
          <div className="acct-start">
            <SignIn onDone={signedIn} providers={providers} />
            <Perks />
          </div>
          {children}
        </>
      )}
    </Viewer.Provider>
  );
}

/** Beside the sign-in form: what an account adds, only what the site does today. */
function Perks() {
  const t = useT("account");
  const perks: [string, string, string][] = [
    ["tier", t("Your own Mayhem stats"), t("Connect Mayhem Stats on the computer where you play to see your win rate, champions, augments and recent games here.")],
    ["lab", t("Builds in The Kitchen"), t("Send builds from the Simulator. Approved ones show in The Kitchen with your display name.")],
    ["info", t("Settings on every device"), t("Your settings, like motion, sound and page detail, follow you to every browser you sign in on.")],
    ["gold", t("Your name and icon"), t("Pick a display name and a champion icon for your account.")],
  ];
  return (
    <section className="acct-perks" aria-labelledby="acct-perks-title">
      <h2 id="acct-perks-title">{t("What an account gets you")}</h2>
      <ul>
        {perks.map(([accent, title, text]) => (
          <li key={title} data-accent={accent}>
            <b>{title}</b>
            <span>{text}</span>
          </li>
        ))}
      </ul>
      <p className="acct-hint">{t("Free, and you never need your Riot password.")}</p>
    </section>
  );
}

function SignIn({ onDone, providers }: { onDone: () => Promise<void>; providers: Provider[] }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [passkeys, setPasskeys] = useState(false);
  const bot = useBotCheck();
  const t = useT("account");

  useEffect(() => setPasskeys(browserSupportsWebAuthn()), []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await call(`/api/account/${mode}`, "POST", { email, password, check: bot.token });
      await onDone();
    } catch (err) {
      setMsg({ kind: "error", text: errText(err) });
      bot.reset();
    } finally {
      setBusy(false);
    }
  };

  const passkey = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const options = await call("/api/account/passkey", "POST", { step: "signin-options" });
      const response = await startAuthentication({ optionsJSON: options });
      await call("/api/account/passkey", "POST", { step: "signin", response });
      await onDone();
    } catch (err) {
      if (!cancelled(err)) setMsg({ kind: "error", text: errText(err) });
    } finally {
      setBusy(false);
    }
  };

  // Create account with a passkey instead of a password: one step, the passkey is the way in.
  const createPasskey = async () => {
    if (!email.trim()) return setMsg({ kind: "error", text: "Enter your email first." });
    setBusy(true);
    setMsg(null);
    try {
      const options = await call("/api/account/passkey", "POST", { step: "signup-options", email, check: bot.token });
      const response = await startRegistration({ optionsJSON: options });
      await call("/api/account/passkey", "POST", { step: "signup", response, label: deviceLabel() });
      await onDone();
    } catch (err) {
      if (!cancelled(err)) setMsg({ kind: "error", text: errText(err) });
      bot.reset();
    } finally {
      setBusy(false);
    }
  };

  const signup = mode === "signup";
  return (
    <div className="acct-signin card" data-accent="gold">
      <div className="acct-tabs" role="tablist" aria-label={t("Sign in or create an account")}>
        {(["signin", "signup"] as const).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? "active" : ""} onClick={() => (setMode(m), setMsg(null))}>
            {m === "signin" ? t("Sign in") : t("Create account")}
          </button>
        ))}
      </div>
      <form className="acct-form" method="post" action="/account" onSubmit={submit}>
        <label>
          {t("Email")}
          <input type="email" name="email" autoComplete={signup ? "email" : "username webauthn"} required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          {t("Password")}
          <input
            type="password"
            name="password"
            autoComplete={signup ? "new-password" : "current-password"}
            required
            minLength={signup ? 10 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {signup && <p className="acct-hint">{t("At least 10 characters. A passphrase of a few words works well.")}</p>}
        <div ref={bot.box} className="acct-botcheck" />
        <button type="submit" className="btn" disabled={busy}>
          {busy ? t("One moment…") : signup ? t("Create account") : t("Sign in")}
        </button>
      </form>
      {(passkeys || providers.length > 0) && <p className="acct-or">{t("or")}</p>}
      {passkeys && (
        <button type="button" className="btn ghost acct-passkey" onClick={signup ? createPasskey : passkey} disabled={busy}>
          {signup ? t("Create a passkey") : t("Sign in with a passkey")}
        </button>
      )}
      <ProviderButtons providers={providers} mode="signin" />
      <Note msg={msg} />
      <p className="acct-hint">
        {signup
          ? passkeys
            ? t("No password needed with a passkey: enter your email and create one. Your settings follow you to every browser you sign in on.")
            : t("Your settings will follow you to every browser you sign in on.")
          : t("Forgot your password? Sign in with a passkey, then set a new one here.")}
      </p>
    </div>
  );
}

/** The name to greet: the display name, else the part of the email before the @, else the Riot name. */
function greetName(account: Account) {
  return account.name ?? account.email?.split("@")[0] ?? account.riot?.name.split("#")[0] ?? null;
}

// The page's sections in order. My Stats, Kitchen builds and Messages come from other components (passed in as
// children), so their links only show once those sections are on the page.
const SECTIONS = [
  { id: "riot", label: "Riot account" },
  { id: "my-stats", label: "My Stats" },
  { id: "kitchen", label: "Kitchen builds" },
  { id: "messages", label: "Messages" },
  { id: "profile", label: "Profile" },
  { id: "security", label: "Sign-in and security" },
  { id: "delete", label: "Delete account" },
];

function SectionNav() {
  const t = useT("account");
  const [present, setPresent] = useState<string[]>([]);
  useEffect(() => {
    const look = () => {
      const ids = SECTIONS.filter((x) => document.getElementById(x.id)).map((x) => x.id);
      setPresent((old) => (old.join() === ids.join() ? old : ids));
    };
    look();
    const watch = new MutationObserver(look);
    watch.observe(document.querySelector("main") ?? document.body, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, []);
  if (present.length < 2) return null;
  return (
    <nav className="acct-nav" aria-label={t("Jump to")}>
      {SECTIONS.filter((x) => present.includes(x.id)).map((x) => (
        <a key={x.id} href={`#${x.id}`} className={x.id === "delete" ? "danger" : undefined}>
          {t(x.label)}
        </a>
      ))}
    </nav>
  );
}

function Manage({ account, refresh, children }: { account: Account; refresh: () => Promise<void>; children?: React.ReactNode }) {
  const t = useT("account");
  const signOut = async () => {
    await call("/api/account/signout", "POST").catch(() => null);
    forgetAccount();
    await refresh();
  };
  const name = greetName(account);
  const showSignIns = account.providers.length > 0 || account.logins.length > 0;

  return (
    <div className="acct-page">
      <section className="card acct-welcome" data-accent="gold">
        {account.icon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/icons/champions/${account.icon}.webp`} alt="" width={72} height={72} />
        ) : (
          <span className="acct-avatar" aria-hidden="true">
            {(name ?? "?").slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="acct-welcome-text">
          <h2>{name ? t("Welcome, {name}!", { name }) : t("Welcome!")}</h2>
          {account.email && <p className="acct-hint">{account.email}</p>}
          <ul className="acct-status">
            <li className={account.riot ? "ok" : "todo"}>
              {account.riot ? (
                t("Riot account: {name}", { name: account.riot.name })
              ) : (
                <a href="#riot">{t("Connect your Riot account")}</a>
              )}
            </li>
            {!account.name && (
              <li className="todo">
                <a href="#profile">{t("Add a display name and icon")}</a>
              </li>
            )}
            <li className="ok">{t("Settings sync to every browser you sign in on")}</li>
          </ul>
        </div>
        <button type="button" className="btn ghost" onClick={signOut}>
          {t("Sign out")}
        </button>
      </section>

      <SectionNav />

      <section id="riot" className="acct-group">
        <h2>{t("Riot account")}</h2>
        <div className="acct-grid">
          <RiotCard account={account} refresh={refresh} />
        </div>
      </section>

      {children}

      <section id="profile" className="acct-group">
        <h2>{t("Profile")}</h2>
        <div className="acct-grid">
          <ProfileCard account={account} refresh={refresh} />
        </div>
      </section>

      <section id="security" className="acct-group">
        <h2>{t("Sign-in and security")}</h2>
        <div className="acct-grid">
          <PasskeyCard account={account} refresh={refresh} />
          {showSignIns && <ProvidersCard account={account} refresh={refresh} />}
          <EmailCard account={account} refresh={refresh} />
          <PasswordCard account={account} />
        </div>
      </section>

      <section id="delete" className="acct-group">
        <DeleteCard account={account} refresh={refresh} />
      </section>
    </div>
  );
}

const CHAMPIONS = Object.entries(championNames as Record<string, string>);

/** Display name and a champion icon for the account. */
function ProfileCard({ account, refresh }: { account: Account; refresh: () => Promise<void> }) {
  const t = useT("account");
  const names = useNames();
  const [name, setName] = useState(account.name ?? "");
  const [icon, setIcon] = useState(account.icon);
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const q = search.trim().toLowerCase();
  const shown = CHAMPIONS.map(([id, en]) => [id, names("champions", id, en)] as const).filter(([id, n]) => !q || n.toLowerCase().includes(q) || id.toLowerCase().includes(q));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      await call("/api/account/profile", "POST", { name, icon });
      setMsg({ kind: "ok", text: "Saved." });
      await refresh();
    } catch (err) {
      setMsg({ kind: "error", text: errText(err) });
    }
  };

  return (
    <section className="card acct-card" data-accent="lab">
      <h3>{t("Name and icon")}</h3>
      <form className="acct-form" method="post" action="/account" onSubmit={save}>
        <label>
          {t("Display name")}
          <input type="text" name="nickname" autoComplete="nickname" maxLength={24} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <p className="acct-hint">{t("Your name and icon show on your account page. Your name also appears on builds you share in The Kitchen.")}</p>
        <details className="acct-icons">
          <summary>
            {icon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/icons/champions/${icon}.webp`} alt="" width={32} height={32} />
            ) : null}
            {t("Choose an icon")}
          </summary>
          <input type="search" placeholder={t("Search champions")} aria-label={t("Search champions")} value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="acct-icon-grid" role="radiogroup" aria-label={t("Icon")}>
            <button type="button" role="radio" aria-checked={!icon} className={!icon ? "picked" : ""} onClick={() => setIcon(null)}>
              {t("None")}
            </button>
            {shown.map(([id, n]) => (
              <button key={id} type="button" role="radio" aria-checked={icon === id} aria-label={n} title={n} className={icon === id ? "picked" : ""} onClick={() => setIcon(id)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/icons/champions/${id}.webp`} alt="" width={40} height={40} loading="lazy" />
              </button>
            ))}
          </div>
        </details>
        <button type="submit" className="btn">
          {t("Save")}
        </button>
      </form>
      <Note msg={msg} />
    </section>
  );
}

/** The email this account signs in with. */
function EmailCard({ account, refresh }: { account: Account; refresh: () => Promise<void> }) {
  const t = useT("account");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const needPassword = account.hasPassword && !account.passkeySession;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      await call("/api/account/email", "POST", { email, password });
      setEmail("");
      setPassword("");
      setMsg({ kind: "ok", text: "Email changed. Sign in with the new one from now on." });
      await refresh();
    } catch (err) {
      setMsg({ kind: "error", text: errText(err) });
    }
  };

  return (
    <section className="card acct-card" data-accent="info">
      <h3>{account.email ? t("Change email") : t("Add an email")}</h3>
      {account.email && <p className="acct-who">{account.email}</p>}
      <form className="acct-form" method="post" action="/account" onSubmit={submit}>
        <label>
          {t("New email")}
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {needPassword && (
          <label>
            {t("Password")}
            <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
        )}
        <button type="submit" className="btn">
          {t("Save email")}
        </button>
      </form>
      <Note msg={msg} />
    </section>
  );
}

/** The connected Riot account. Connecting starts in Mayhem Stats on the player's computer, which checks it
 * with the Riot Client and sends them here to confirm (MyStatsSection). */
function RiotCard({ account, refresh }: { account: Account; refresh: () => Promise<void> }) {
  const [msg, setMsg] = useState<Msg>(null);
  const t = useT("account");

  const disconnect = async () => {
    try {
      await call("/api/account/riot-code", "DELETE");
      await refresh();
    } catch (err) {
      setMsg({ kind: "error", text: errText(err) });
    }
  };

  return (
    <section className="card acct-card acct-riot-card" data-accent="tier">
      <h3>{account.riot ? t("Connected") : t("Connect your Riot account")}</h3>
      {account.riot ? (
        <>
          <p className="acct-who">{account.riot.name}</p>
          {account.riot.page ? (
            <p>
              <Link className="inline-link" href={account.riot.page}>
                {t("Your player page")}
              </Link>
            </p>
          ) : (
            <p className="acct-hint">{t("Publish a player page from My Stats and it links here.")}</p>
          )}
          <button type="button" className="btn ghost" onClick={disconnect}>
            {t("Disconnect")}
          </button>
        </>
      ) : (
        <p className="acct-hint">
          {t("To connect, open Mayhem Stats on the computer where you play, with League open, and choose Connect to deeparam.com. This page asks you to confirm.")}
        </p>
      )}
      <Note msg={msg} />
    </section>
  );
}

function ProvidersCard({ account, refresh }: { account: Account; refresh: () => Promise<void> }) {
  const [msg, setMsg] = useState<Msg>(null);
  const t = useT("account");
  const remove = async (provider: Provider) => {
    setMsg(null);
    try {
      await call("/api/account/oauth/disconnect", "POST", { provider });
      await refresh();
    } catch (err) {
      setMsg({ kind: "error", text: errText(err) });
    }
  };
  const missing = account.providers.filter((p) => !account.logins.some((l) => l.provider === p));

  return (
    <section className="card acct-card" data-accent="info">
      <h3>{t("Other ways to sign in")}</h3>
      <p className="acct-hint">{t("Sign in to this account with another service you use, instead of a password.")}</p>
      {account.logins.length > 0 && (
        <ul className="acct-list">
          {account.logins.map((l) => (
            <li key={l.provider}>
              <span>
                {l.name}
                {l.email && <small>{l.email}</small>}
              </span>
              <button type="button" className="inline-link" onClick={() => remove(l.provider)} aria-label={t("Stop signing in with {name}", { name: l.name })}>
                {t("Remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <ProviderButtons providers={missing} mode="connect" />
      <Note msg={msg} />
    </section>
  );
}

function PasskeyCard({ account, refresh }: { account: Account; refresh: () => Promise<void> }) {
  const [msg, setMsg] = useState<Msg>(null);
  const [supported, setSupported] = useState(true);
  const t = useT("account");
  useEffect(() => setSupported(browserSupportsWebAuthn()), []);

  const add = async () => {
    setMsg(null);
    try {
      const options = await call("/api/account/passkey", "POST", { step: "add-options" });
      const response = await startRegistration({ optionsJSON: options });
      await call("/api/account/passkey", "POST", { step: "add", response, label: deviceLabel() });
      setMsg({ kind: "ok", text: "Passkey saved. Next time, sign in with it instead of your password." });
      await refresh();
    } catch (err) {
      if (!cancelled(err)) setMsg({ kind: "error", text: errText(err) });
    }
  };

  const remove = async (id: string) => {
    try {
      await call("/api/account/passkey", "POST", { step: "remove", id });
      await refresh();
    } catch (err) {
      setMsg({ kind: "error", text: errText(err) });
    }
  };

  return (
    <section className="card acct-card" data-accent="pbe">
      <h3>{t("Passkeys")}</h3>
      <p className="acct-hint">{t("Sign in with your fingerprint, face or device PIN instead of a password. A passkey is also how you get back in if you forget your password.")}</p>
      {account.passkeys.length > 0 && (
        <ul className="acct-list">
          {account.passkeys.map((k) => (
            <li key={k.id}>
              <span>
                {t(k.label)}
                <small>{around(t("Added {date}"), "date", <LocalDate iso={k.created.slice(0, 10)} options={{ year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }} />)}</small>
              </span>
              <button type="button" className="inline-link" onClick={() => remove(k.id)} aria-label={t("Remove passkey {label}", { label: t(k.label) })}>
                {t("Remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {supported ? (
        <button type="button" className="btn" onClick={add}>
          {t("Add a passkey")}
        </button>
      ) : (
        <p className="acct-hint">{t("This browser can't save passkeys.")}</p>
      )}
      <Note msg={msg} />
    </section>
  );
}

function PasswordCard({ account }: { account: Account }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const needCurrent = account.hasPassword && !account.passkeySession;
  const t = useT("account");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      await call("/api/account/password", "POST", { current, next });
      setCurrent("");
      setNext("");
      setMsg({ kind: "ok", text: "Password changed. Other browsers signed in with the old one are signed out." });
    } catch (err) {
      setMsg({ kind: "error", text: errText(err) });
    }
  };

  return (
    <section className="card acct-card" data-accent="sim">
      <h3>{account.hasPassword ? t("Change password") : t("Set a password")}</h3>
      <form className="acct-form" method="post" action="/account" onSubmit={submit}>
        <input type="text" name="username" autoComplete="username" value={account.email ?? ""} readOnly tabIndex={-1} aria-hidden="true" className="visually-hidden" />
        {needCurrent && (
          <label>
            {t("Current password")}
            <input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
          </label>
        )}
        <label>
          {t("New password")}
          <input type="password" autoComplete="new-password" required minLength={10} value={next} onChange={(e) => setNext(e.target.value)} />
        </label>
        <button type="submit" className="btn">
          {t("Save password")}
        </button>
      </form>
      <Note msg={msg} />
    </section>
  );
}

function DeleteCard({ account, refresh }: { account: Account; refresh: () => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [sure, setSure] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const needPassword = account.hasPassword && !account.passkeySession;
  const t = useT("account");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      await call("/api/account", "DELETE", { password });
      forgetAccount();
      await refresh();
    } catch (err) {
      setMsg({ kind: "error", text: errText(err) });
    }
  };

  return (
    <section className="card acct-card acct-danger">
      <details>
        <summary>{t("Delete account")}</summary>
        <form className="acct-form" method="post" action="/account" onSubmit={submit}>
          <p className="acct-hint">
            {t("This deletes your account, passkeys and synced settings. This browser keeps its own copy. A player page you published from My Stats stays until you remove it there.")}
          </p>
          {needPassword && (
            <label>
              {t("Password")}
              <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
          )}
          <label className="acct-check">
            <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} /> {t("I want to delete my account")}
          </label>
          <button type="submit" className="btn danger" disabled={!sure}>
            {t("Delete account")}
          </button>
        </form>
        <Note msg={msg} />
      </details>
    </section>
  );
}
