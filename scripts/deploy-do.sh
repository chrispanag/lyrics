#!/usr/bin/env bash
#
# Create or update the DigitalOcean App Platform app described by .do/app.yaml.
#
# The tracked spec carries placeholders where credentials belong; this fills
# them in from .env at request time, so no secret is ever written to a file that
# could be committed. Values reach the API and the helpers below through stdin
# and the environment rather than argv, which keeps them out of `ps`.
#
# Usage:
#   DIGITALOCEAN_ACCESS_TOKEN=dop_v1_... ./scripts/deploy-do.sh --validate
#   DIGITALOCEAN_ACCESS_TOKEN=dop_v1_... ./scripts/deploy-do.sh
#
# --validate stops after the API's own dry run (POST /v2/apps/propose), which
# checks the spec, the repository access and the resulting bill without creating
# anything. The plain form validates first and then applies: it creates the app
# when no app of this name exists, and updates it in place when one does.
#
# The token may also live in .env, which is where every other credential here
# comes from and is already ignored by git.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

export SPEC=".do/app.yaml"
API="https://api.digitalocean.com/v2"

# `set -a` exports what the file defines, so the helpers below inherit it.
if [[ -f .env ]]; then
	set -a
	# shellcheck disable=SC1091
	source ./.env
	set +a
fi

TOKEN="${DIGITALOCEAN_ACCESS_TOKEN:-${DIGITALOCEAN_TOKEN:-}}"
: "${TOKEN:?set DIGITALOCEAN_ACCESS_TOKEN (a DigitalOcean API token with write scope)}"

VALIDATE_ONLY=false
[[ "${1:-}" == "--validate" ]] && VALIDATE_ONLY=true

python3 -c 'import yaml' 2>/dev/null || {
	echo "error: PyYAML is required to read $SPEC (pip3 install pyyaml)" >&2
	exit 1
}

# --- helpers -----------------------------------------------------------------
#
# The readers below take their program from -c rather than a heredoc: a heredoc
# occupies stdin, which is where the data they are meant to read arrives.

# Renders the spec to JSON on stdout, substituting every placeholder. Nothing is
# piped in, so this one can afford the more legible heredoc form.
render_spec() {
	python3 <<'PY'
import json
import os
import sys

import yaml

# Which environment variable supplies each placeholder. The frontend's app id and
# session domain are the same values as the backend's under a VITE_ name, because
# Vite only exposes variables carrying that prefix — and for the session domain
# that shared source is load-bearing, not a convenience: the token issuer follows
# whichever host the browser authenticates against, so the two copies disagreeing
# means every login is rejected.
SOURCES = {
    "PRELUDE_APP_ID": "PRELUDE_APP_ID",
    "PRELUDE_API_KEY": "PRELUDE_API_KEY",
    "PRELUDE_SESSION_DOMAIN": "PRELUDE_SESSION_DOMAIN",
    "ADMIN_EMAILS": "ADMIN_EMAILS",
    "VITE_PRELUDE_APP_ID": "PRELUDE_APP_ID",
    "VITE_PRELUDE_SDK_KEY": "VITE_PRELUDE_SDK_KEY",
    "VITE_PRELUDE_SESSION_DOMAIN": "PRELUDE_SESSION_DOMAIN",
}

# The session client works without an SDK key, so an empty one is not a failure.
OPTIONAL = {"VITE_PRELUDE_SDK_KEY"}

PLACEHOLDER = "SET_BY_DEPLOY_SCRIPT"

with open(os.environ["SPEC"], encoding="utf-8") as fh:
    spec = yaml.safe_load(fh)

missing = []
for group in ("services", "jobs", "static_sites", "workers"):
    for component in spec.get(group) or []:
        for env in component.get("envs") or []:
            if env.get("value") != PLACEHOLDER:
                continue
            key = env["key"]
            source = SOURCES.get(key)
            value = os.environ.get(source, "").strip() if source else ""
            if not value and key not in OPTIONAL:
                missing.append("{} (from ${})".format(key, source or key))
            env["value"] = value

if missing:
    sys.exit(
        "error: no value for " + ", ".join(missing) + "\n"
        "       set them in .env or the environment before deploying"
    )

json.dump({"spec": spec}, sys.stdout)
PY
}

# Calls the API and appends the HTTP status, which the response body otherwise
# only hints at. Any extra arguments are passed through to curl.
do_api() {
	local method="$1" path="$2"
	shift 2
	curl -sS -X "$method" "$API$path" \
		-H "Authorization: Bearer $TOKEN" \
		-H "Content-Type: application/json" \
		-w '\n%{http_code}' \
		"$@"
}

# Reads what do_api produced and passes the body through only on a 2xx.
check_response() {
	python3 -c '
import json
import sys

body, _, status = sys.stdin.read().rpartition("\n")
try:
    parsed = json.loads(body)
except json.JSONDecodeError:
    parsed = None

if not status.startswith("2"):
    message = (parsed or {}).get("message") or body or "(empty response)"
    sys.exit("error: DigitalOcean returned {}: {}".format(status, message))

sys.stdout.write(json.dumps(parsed) if parsed is not None else body)
'
}

# --- find the app ------------------------------------------------------------

APP_NAME="$(python3 -c 'import os, yaml; print(yaml.safe_load(open(os.environ["SPEC"]))["name"])')"
export APP_NAME

# The app is looked up by name every run rather than recorded here: its id lives
# only in DigitalOcean, so there is no local copy to fall out of date.
APP_ID="$(do_api GET "/apps?per_page=200" | check_response | python3 -c '
import json
import os
import sys

apps = json.load(sys.stdin).get("apps") or []
name = os.environ["APP_NAME"]
print(next((a["id"] for a in apps if a["spec"]["name"] == name), ""))
')"
export APP_ID

SPEC_JSON="$(render_spec)"

# --- validate ----------------------------------------------------------------

if [[ -n "$APP_ID" ]]; then
	echo "==> $APP_NAME exists ($APP_ID); validating an update"
	PROPOSAL="$(python3 -c '
import json
import os
import sys

body = json.load(sys.stdin)
body["app_id"] = os.environ["APP_ID"]
json.dump(body, sys.stdout)
' <<<"$SPEC_JSON")"
else
	echo "==> no app named $APP_NAME; validating a new one"
	PROPOSAL="$SPEC_JSON"
fi

# propose is the API's own dry run: it rejects an invalid spec, reports whether
# the repository is reachable, and prices the result — without creating a thing.
do_api POST "/apps/propose" --data-binary @- <<<"$PROPOSAL" | check_response | python3 -c '
import json
import sys

proposal = json.load(sys.stdin)
print("    spec accepted. monthly cost: {} USD".format(proposal.get("app_cost", "?")))
'

if [[ "$VALIDATE_ONLY" == true ]]; then
	echo "==> --validate given; nothing was created or changed"
	exit 0
fi

# --- apply -------------------------------------------------------------------

if [[ -n "$APP_ID" ]]; then
	echo "==> updating $APP_NAME"
	RESULT="$(do_api PUT "/apps/$APP_ID" --data-binary @- <<<"$SPEC_JSON" | check_response)"
else
	echo "==> creating $APP_NAME"
	RESULT="$(do_api POST "/apps" --data-binary @- <<<"$SPEC_JSON" | check_response)"
fi

python3 -c '
import json
import sys

app = json.load(sys.stdin)["app"]
print("    id:  {}".format(app["id"]))
print("    url: {}".format(
    app.get("live_url") or app.get("default_ingress") or "(assigned once deployed)"))
print()
print("Watch the deploy in the DigitalOcean console, or with:")
print("  curl -H \"Authorization: Bearer $DIGITALOCEAN_ACCESS_TOKEN\" \\")
print("    https://api.digitalocean.com/v2/apps/{}/deployments".format(app["id"]))
' <<<"$RESULT"
