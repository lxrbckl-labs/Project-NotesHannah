import { Lightbulb } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { Page } from "../../components/Page";
import { SearchPanel } from "./SearchPanel";

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  return (
    <Page>
      <h1 className="mb-2 text-3xl font-semibold">Search</h1>
      <Link
        to="/concepts"
        className="mb-4 inline-flex min-h-11 items-center gap-2 rounded-xl text-sm text-accent hover:underline"
      >
        <Lightbulb size={16} aria-hidden /> Browse all concepts
      </Link>
      <SearchPanel
        initialQuery={params.get("q") ?? ""}
        onQueryChange={(q) => setParams(q ? { q } : {}, { replace: true })}
      />
    </Page>
  );
}
