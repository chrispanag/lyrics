#!/usr/bin/env bash
#
# Create or update the DigitalOcean App Platform app described by .do/app.yaml.
#
# Fills the spec's placeholders from .env at request time, so no secret is
# written to a tracked file. Values travel via stdin and env, never argv (`ps`).
#
# Usage:
#   DIGITALOCEAN_ACCESS_TOKEN=dop_v1_... ./scripts/deploy-do.sh --validate
#   DIGITALOCEAN_ACCESS_TOKEN=dop_v1_... ./scripts/deploy-do.sh
#
# --validate stops after the API's dry run (POST /v2/apps/propose). The plain
# form validates, then creates the app or updates it in place.
#
# The token may also live in .env.

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

# The readers below take their program from -c, not a heredoc: their data
# arrives on stdin, which a heredoc would occupy.

# Renders the spec to JSON on stdout, substituting every placeholder.
render_spec() {
	python3 <<'PY'
import json
import os
import sys

import yaml

# Which environment variable supplies each placeholder. Both session domains
# must come from one source: the issuer is per-host, so a mismatch rejects
# every login.
SOURCES = {
    "PRELUDE_APP_ID": "PRELUDE_APP_ID",
    "PRELUDE_API_KEY": "PRELUDE_API_KEY",
    "PRELUDE_SESSION_DOMAIN": "PRELUDE_SESSION_DOMAIN",
    "ADMIN_EMAILS": "ADMIN_EMAILS",
    "NEXT_PUBLIC_PRELUDE_APP_ID": "PRELUDE_APP_ID",
    "NEXT_PUBLIC_PRELUDE_SDK_KEY": "PRELUDE_SDK_KEY",
    "NEXT_PUBLIC_PRELUDE_SESSION_DOMAIN": "PRELUDE_SESSION_DOMAIN",
    "NEXT_PUBLIC_PRELUDE_OTP_LOGIN_CONFIG_ID": "PRELUDE_OTP_LOGIN_CONFIG_ID",
}

# Empty is allowed but warned about: a variable renamed in .env looks the same.
OPTIONAL = {"NEXT_PUBLIC_PRELUDE_SDK_KEY"}

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
            if not value:
                if key in OPTIONAL:
                    print(
                        "warning: {} is empty (from ${})".format(key, source or key),
                        file=sys.stderr,
                    )
                else:
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

APP_NAME="$(python3 -c 'import os, yaml; print(yaml.safe_load(open(os.environ["SPEC"]))["name"])')"
export APP_NAME

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

# propose is a dry run: it validates the spec and repo access and prices it.
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
