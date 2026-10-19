import type { Metadata } from "next";
import AccountPanel, { SignedInOnly } from "@/components/AccountPanel";
import ContactMessages from "@/components/ContactMessages";
import KitchenSubmissions from "@/components/KitchenSubmissions";
import { T } from "@/components/I18n";
import Intro from "@/components/Intro";
import MyStatsSection from "@/components/MyStatsSection";
import { pageMeta } from "@/lib/meta";

export const metadata: Metadata = {
  ...pageMeta("/account", "Your account", "Sign in or create a DeepARAM account so your settings follow you to every device."),
  robots: { index: false, follow: true },
};

export default function AccountPage() {
  return (
    <>
      <Intro eyebrow={<T ns="account">Account</T>} title={<T ns="account">Your account.</T>}>
        <T ns="account">Sign in to keep your settings on every device, and connect the Riot account you play on.</T>
      </Intro>
      {/* Sections from other parts of the site sit inside the signed-in page, after the Riot account. */}
      <AccountPanel>
        <MyStatsSection />
        <SignedInOnly>
          <KitchenSubmissions />
        </SignedInOnly>
        <SignedInOnly owner>
          <ContactMessages />
        </SignedInOnly>
      </AccountPanel>
    </>
  );
}
