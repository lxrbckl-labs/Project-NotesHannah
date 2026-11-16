import { Lightbulb, Search } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { Page } from "../../components/Page";
import { PageHeader } from "../../components/ui/page-header";
import { SearchPanel } from "./SearchPanel";

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  return (
    <Page>
      <PageHeader title="Search" icon={<Search />} className="mb-3" />
      <Link
        to="/concepts"
        className="mb-4 inline-flex min-h-11 items-center gap-2 rounded-control text-ui text-accent hover:underline"
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
