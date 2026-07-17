import { TagExplorer } from "@/components/tags/TagExplorer";
import { buildTagGraph } from "@/lib/tagGraph";

export const dynamic = "force-dynamic";

export default async function TagsPage() {
  const graph = await buildTagGraph();
  return (
    <main className="mx-auto max-w-5xl space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Tag explorer</h1>
        <p className="mt-1 text-sm text-slate">
          Nodes sized by total stake, edges connect tags that co-occur on the same app.
        </p>
      </div>
      <div className="card p-6">
        <TagExplorer nodes={graph.nodes} edges={graph.edges} />
      </div>
    </main>
  );
}
