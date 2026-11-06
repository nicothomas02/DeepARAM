import type { Metadata } from "next";
import { T } from "@/components/I18n";
import answers from "@/data/visitor-answers.json";
import { pageMeta } from "@/lib/meta";

export const metadata: Metadata = pageMeta("/answers", "Answers", "Questions players sent us, and our answers.");

type Answer = { id: string; date: string; lang: string; question: string; answer: string; en?: { question: string; answer: string } };

// Replies to messages from the footer's "Write to us" box (data/visitor-answers.json, newest first). Each entry's id is
// the message's id, so the sender's browser can point them here (components/FeedbackBox.tsx). No names or emails.
export default function Answers() {
  const list = [...(answers as Answer[])].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <>
      <section className="intro compact">
        <p className="eyebrow">
          <T>Answers</T>
        </p>
        <h1>
          <T>Questions players sent us, and our answers.</T>
        </h1>
        <p className="lede">
          <T>Write to us from the box at the bottom of any page. We answer here, without your name.</T>
        </p>
      </section>
      <div className="answers">
        {list.map((a) => (
          <article key={a.id} id={`a-${a.id}`} className="card answer-card">
            <time dateTime={a.date}>{a.date}</time>
            <blockquote lang={a.lang}>{a.question}</blockquote>
            <p lang={a.lang}>{a.answer}</p>
            {a.en && (
              <details>
                <summary>
                  <T>In English</T>
                </summary>
                <blockquote lang="en">{a.en.question}</blockquote>
                <p lang="en">{a.en.answer}</p>
              </details>
            )}
          </article>
        ))}
      </div>
    </>
  );
}
