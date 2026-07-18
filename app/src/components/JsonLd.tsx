/** Renders a `<script type="application/ld+json">` for structured data (schema.org). */
export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      // JSON.stringify doesn't escape "<" — a value containing "</script>"
      // would otherwise close the tag early and inject raw HTML/JS.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
