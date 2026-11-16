import { useSearchParams } from "react-router";
import { Page } from "../../components/Page";
import { SearchPanel } from "./SearchPanel";

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  return (
    <Page>
      <h1 className="mb-5 text-3xl font-semibold">Search</h1>
      <SearchPanel
        initialQuery={params.get("q") ?? ""}
        onQueryChange={(q) => setParams(q ? { q } : {}, { replace: true })}
      />
    </Page>
  );
}
