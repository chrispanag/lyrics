import { server } from "./server";

/**
 * Records the path of every request that starts, or of those `match` accepts,
 * until `stop`. Stop it in a `finally`, so a failed assertion cannot leave it
 * recording the next spec.
 */
export function recordRequests(match: (pathname: string) => boolean = () => true): {
  paths: string[];
  stop: () => void;
} {
  const paths: string[] = [];
  const record = ({ request }: { request: Request }) => {
    const { pathname } = new URL(request.url);
    if (match(pathname)) paths.push(pathname);
  };
  server.events.on("request:start", record);
  return { paths, stop: () => server.events.removeListener("request:start", record) };
}
