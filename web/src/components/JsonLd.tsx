const SITE = "https://deeparam.com";

// Structured data for search results. "<" is escaped so page text can't close the script tag.
function JsonLd({ data }: { data: object }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}

/** The trail search results show above a page's title: Home › Champions › Ahri. */
export function Breadcrumbs({ trail }: { trail: [name: string, path: string][] }) {
  const items = [["DeepARAM", "/"], ...trail].map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: SITE + (path === "/" ? "/" : path) }));
  return <JsonLd data={{ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items }} />;
}
