"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ACCOUNT_EVENT, signedIn, syncAccount } from "@/lib/account-sync";
import { useT } from "./I18n";

// Top-right account button: opens the account page, where you sign in, create an account, or manage yours.
// The ring turns the accent colour while you're signed in. It also keeps a signed-in visitor's Favorites
// and settings in step with their account (lib/account-sync.ts), once per visit.

export default function AccountButton() {
  const pathname = usePathname();
  const [on, setOn] = useState(false);
  const t = useT();

  useEffect(() => {
    const sync = () => setOn(signedIn());
    sync();
    void syncAccount().then(sync);
    window.addEventListener(ACCOUNT_EVENT, sync);
    return () => window.removeEventListener(ACCOUNT_EVENT, sync);
  }, []);

  const here = pathname === "/account" || pathname.startsWith("/account/");
  return (
    <div className="account">
      <Link
        href="/account"
        className={on ? "account-btn signed-in" : "account-btn"}
        aria-label={on ? t("Your account") : t("Sign in or create an account")}
        aria-current={here ? "page" : undefined}
        title={on ? t("Your account") : t("Sign in")}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20a8 8 0 0 1 16 0" />
        </svg>
      </Link>
    </div>
  );
}
