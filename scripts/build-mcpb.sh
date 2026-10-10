#!/usr/bin/env bash
# Build dist-mcpb/google-webtools-mcp-<package.json version>.mcpb.
# Local and CI both enter here. Node, npm, and the mcpb CLI run in Docker.
# Nothing is installed on the host.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

NODE_IMAGE=node:24.21.0-slim
MCPB_CLI=@anthropic-ai/mcpb@2.1.2
UID_GID="$(id -u):$(id -g)"
ROOT=$PWD
OUT="$ROOT/dist-mcpb"
NPM_CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/promo-mcpb-npm"
mkdir -p "$NPM_CACHE"
rm -rf "$OUT"
mkdir -p "$OUT"

VERSION=$(python3 -c 'import json; print(json.load(open("package.json"))["version"])')
case "$VERSION" in
  ""|*[!0-9A-Za-z._+-]*)
    echo "package.json version is not a safe token: ${VERSION}" >&2
    exit 1
    ;;
esac

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
stage="$work/stage"
pack="$work/pack"
mkdir -p "$stage" "$pack"

# Staging is only what the bundle needs to compile. Tests, git metadata,
# and env files are never copied in.
cp package.json package-lock.json tsconfig.json tsup.config.ts "$stage/"
cp -a bin src "$stage/"

docker run --rm -u "$UID_GID" -e HOME=/tmp -e npm_config_cache=/npm \
  -e npm_config_update_notifier=false \
  -v "$NPM_CACHE":/npm -v "$stage":/app -w /app \
  "$NODE_IMAGE" \
  bash -c '
    set -euo pipefail
    npm ci --no-audit --no-fund
    npm run build
    npm ci --omit=dev --ignore-scripts --no-audit --no-fund
    find dist node_modules \( -name "*.d.ts" -o -name "*.map" -o -name "*.tsbuildinfo" \) -delete
    rm -rf node_modules/.cache
  '

test -f "$stage/dist/cli.js" || { echo "dist/cli.js was not built" >&2; exit 1; }

cp "$stage/package.json" "$pack/package.json"
cp -a "$stage/dist" "$pack/dist"
cp -a "$stage/node_modules" "$pack/node_modules"

# Drop type declarations and source maps again in case the copy raced, and
# keep TypeScript sources, env files, and caches out of the archive.
find "$pack" \( -name "*.d.ts" -o -name "*.map" -o -name ".env" -o -name ".env.*" \) -delete
find "$pack" -type d \( -name __pycache__ -o -name .git \) -exec rm -rf {} +

creds="$work/sa.json"
printf '%s' '{"type":"service_account","project_id":"p","private_key_id":"k","private_key":"dummy","client_email":"check@p.iam.gserviceaccount.com","client_id":"1","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token"}' > "$creds"

# tools/list from the build just made. Listing does not call Google.
export UID_GID PACK="$pack" CREDS="$creds" NODE_IMAGE
python3 - "$work/tools.json" <<'PY'
import json, os, select, subprocess, sys, time

out_path = sys.argv[1]
cmd = [
    "docker", "run", "--rm", "-i", "--network", "none",
    "-u", os.environ["UID_GID"],
    "-e", "HOME=/tmp",
    "-e", "GOOGLE_APPLICATION_CREDENTIALS=/creds/sa.json",
    "-v", os.environ["PACK"] + ":/app:ro",
    "-v", os.environ["CREDS"] + ":/creds/sa.json:ro",
    "-w", "/app",
    os.environ["NODE_IMAGE"],
    "node", "dist/cli.js",
]
proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
buf = b""
next_id = 1

def send(obj):
    proc.stdin.write((json.dumps(obj) + "\n").encode())
    proc.stdin.flush()

def request(method, params, timeout):
    global next_id, buf
    rid = next_id
    next_id += 1
    send({"jsonrpc": "2.0", "id": rid, "method": method, "params": params})
    deadline = time.time() + timeout
    while time.time() < deadline:
        while b"\n" in buf:
            line, buf = buf.split(b"\n", 1)
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            if isinstance(msg, dict) and msg.get("id") == rid and "method" not in msg:
                if "error" in msg:
                    raise SystemExit("%s -> %s" % (method, msg["error"]))
                return msg.get("result", {})
        ready, _, _ = select.select([proc.stdout], [], [], 1.0)
        if ready:
            chunk = proc.stdout.read1(65536) if hasattr(proc.stdout, "read1") else proc.stdout.readline()
            if not chunk:
                err = proc.stderr.read().decode("utf-8", "replace")[-2000:]
                raise SystemExit("server closed stdout during %s; stderr: %s" % (method, err))
            buf += chunk
    err = b""
    try:
        err = proc.stderr.read()
    except Exception:
        pass
    raise SystemExit("timeout waiting for %s; stderr: %s" % (method, err.decode("utf-8", "replace")[-2000:]))

try:
    request("initialize", {
        "protocolVersion": "2025-06-18",
        "capabilities": {},
        "clientInfo": {"name": "build-mcpb", "version": "1"},
    }, 120)
    send({"jsonrpc": "2.0", "method": "notifications/initialized"})
    tools, cursor = [], None
    for _ in range(100):
        params = {"cursor": cursor} if cursor else {}
        res = request("tools/list", params, 60)
        tools.extend(res.get("tools", []))
        cursor = res.get("nextCursor")
        if not cursor:
            break
finally:
    try:
        proc.stdin.close()
    except OSError:
        pass
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()

if len(tools) != 39:
    raise SystemExit("expected 39 tools, got %s" % [t.get("name") for t in tools])
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(tools, f)
print("listed %d tools" % len(tools))
PY

python3 - "$ROOT/mcpb/manifest.json" "$work/tools.json" "$pack/manifest.json" "$VERSION" <<'PY'
import json, sys

manifest_path, tools_path, dest, version = sys.argv[1:]
with open(manifest_path, encoding="utf-8") as f:
    doc = json.load(f)
with open(tools_path, encoding="utf-8") as f:
    live = json.load(f)
doc.pop("version", None)
doc["version"] = version
doc["tools"] = [{"name": t["name"], "description": t.get("description") or ""} for t in live]
names = [t["name"] for t in doc["tools"]]
if len(set(names)) != 39:
    raise SystemExit("manifest tools collapsed: %s" % names)
key = doc.get("user_config", {}).get("service_account_key_file")
if not isinstance(key, dict) or key.get("type") != "file":
    raise SystemExit("user_config.service_account_key_file must be a file")
with open(dest, "w", encoding="utf-8") as f:
    json.dump(doc, f, indent=2)
    f.write("\n")
print("manifest version", version)
PY

docker run --rm -u "$UID_GID" -e HOME=/tmp -e npm_config_cache=/npm \
  -v "$NPM_CACHE":/npm -v "$pack":/work -v "$OUT":/dist \
  "$NODE_IMAGE" \
  npx -y "$MCPB_CLI" pack /work "/dist/google-webtools-mcp-${VERSION}.mcpb"

bundle="$OUT/google-webtools-mcp-${VERSION}.mcpb"
test -f "$bundle" || { echo "bundle was not written" >&2; exit 1; }
echo "built $bundle"
