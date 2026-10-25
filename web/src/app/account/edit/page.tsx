import type { Metadata } from "next";
import Link from "next/link";
import AdminEditor from "@/components/AdminEditor";
import Intro from "@/components/Intro";
import { isAdmin } from "@/lib/admin-session";
import { FIELDS } from "@/lib/content";

// The site text editor, for the signed-in site owner (lib/accounts.ts). Saving is checked again on the server.
export const metadata: Metadata = { title: "Edit site · DeepARAM", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function EditPage() {
  if (!(await isAdmin())) {
    return (
      <Intro eyebrow="Owner" title="Sign in first.">
        Only the site owner&apos;s account can edit the site.{" "}
        <Link className="inline-link" href="/account">
          Sign in
        </Link>
        , then come back here.
      </Intro>
    );
  }
  return (
    <>
      <Intro eyebrow="Owner" title="Edit the site.">
        Change any text below and save. The site shows it in about a minute.
      </Intro>
      <AdminEditor fields={FIELDS} />
    </>
  );
}
