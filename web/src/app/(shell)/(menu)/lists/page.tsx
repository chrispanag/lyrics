import { ListsPage } from "@/routes/ListsPages";
import { RequireAuth } from "@/routes/guards";

export default function Page() {
  return (
    <RequireAuth title="Lists">
      <ListsPage />
    </RequireAuth>
  );
}
