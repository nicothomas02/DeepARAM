// A page's title block. `art` puts a Howling Abyss painting behind it (/assets/art/, the game's loading-screen
// backgrounds: maps only, no champions), faded into the page so the text stays readable in both themes.
export default function Intro({
  eyebrow,
  title,
  art,
  children,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  art?: string;
  children?: React.ReactNode;
}) {
  return (
    <section
      className={art ? "intro compact has-art" : "intro compact"}
      style={art ? ({ "--art": `url(/assets/art/${art}.webp)` } as React.CSSProperties) : undefined}
    >
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1>{title}</h1>
      {children && <p className="lede">{children}</p>}
    </section>
  );
}
