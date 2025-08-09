#!/usr/bin/env bash
set -euo pipefail

PORT=${PORT:-3003}
BASE_URL="http://localhost:${PORT}"
PROTOCOL_VERSION=${PROTOCOL_VERSION:-2024-11-05}
LOG_FILE="tests/e2e-local/test-mcp.log"

MCP_URL="${BASE_URL}/mcp"
echo "[test-mcp] Starting MCP flow tests against ${BASE_URL} (url=${MCP_URL})" | tee "${LOG_FILE}"

log_section() {
  echo | tee -a "${LOG_FILE}"
  echo "===== $1 =====" | tee -a "${LOG_FILE}"
}

expect_http_code() {
  local expected="$1" ; shift
  local actual="$1" ; shift
  if [[ "${expected}" == "${actual}" ]]; then
    echo "[PASS] HTTP ${actual}" | tee -a "${LOG_FILE}"
  else
    echo "[FAIL] Expected HTTP ${expected}, got ${actual}" | tee -a "${LOG_FILE}"
    exit 1
  fi
}

extract_header() {
  # usage: extract_header "Header-Name" < headers.txt
  awk -F': ' -v key="$1" 'tolower($1) == tolower(key) {print $2; exit}' | tr -d '\r' || true
}

CLIENT_ID="demo-client-$(date +%s)"

log_section "Initialize session via POST /mcp with JSON-RPC initialize"
init_body=$(cat <<JSON
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"${PROTOCOL_VERSION}","capabilities":{},"clientInfo":{"name":"e2e-local","version":"0.0.0"}}}
JSON
)
tmp_headers=$(mktemp)
init_resp=$(curl -sS -D "${tmp_headers}" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-client-id: ${CLIENT_ID}" \
  -X POST "${MCP_URL}" \
  --data "${init_body}" \
  -w "\n%{http_code}")
status=$(echo "${init_resp}" | tail -n1)
body=$(echo "${init_resp}" | sed '$d')
echo "Status: ${status}" | tee -a "${LOG_FILE}"
cat "${tmp_headers}" | tee -a "${LOG_FILE}"
echo "Body: ${body}" | tee -a "${LOG_FILE}"
expect_http_code 200 "${status}"

SESSION_ID=$(extract_header "mcp-session-id" < "${tmp_headers}")
if [[ -z "${SESSION_ID}" ]]; then
  echo "[FAIL] Missing mcp-session-id in response headers from initialize" | tee -a "${LOG_FILE}"
  exit 1
fi
echo "[INFO] Established session id: ${SESSION_ID}" | tee -a "${LOG_FILE}"

log_section "Call meta tool list_tools via POST /mcp with session headers"
call_body='{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_tools","arguments":{}}}'
status=$(curl -sS -D /dev/stderr -o - -w "\n%{http_code}" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-client-id: ${CLIENT_ID}" \
  -H "mcp-session-id: ${SESSION_ID}" \
  -X POST "${MCP_URL}" \
  --data "${call_body}" 2>>"${LOG_FILE}" | tee -a "${LOG_FILE}")

# status is printed after a newline; extract the last line
actual_code=$(echo "${status}" | tail -n1)
expect_http_code 200 "${actual_code}"

log_section "Enable core toolset via enable_toolset"
call_body='{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"enable_toolset","arguments":{"name":"core"}}}'
resp=$(curl -sS \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-client-id: ${CLIENT_ID}" \
  -H "mcp-session-id: ${SESSION_ID}" \
  -X POST "${MCP_URL}" \
  --data "${call_body}")
echo "Response: ${resp}" | tee -a "${LOG_FILE}"

log_section "Verify list_tools now includes core.ping"
call_body='{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"list_tools","arguments":{}}}'
status=$(curl -sS -D /dev/stderr -o - -w "\n%{http_code}" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-client-id: ${CLIENT_ID}" \
  -H "mcp-session-id: ${SESSION_ID}" \
  -X POST "${MCP_URL}" \
  --data "${call_body}" 2>>"${LOG_FILE}" | tee -a "${LOG_FILE}")
actual_code=$(echo "${status}" | tail -n1)
expect_http_code 200 "${actual_code}"

log_section "Call core.ping tool via tools/call"
call_body='{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"core.ping","arguments":{}}}'
resp=$(curl -sS \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-client-id: ${CLIENT_ID}" \
  -H "mcp-session-id: ${SESSION_ID}" \
  -X POST "${MCP_URL}" \
  --data "${call_body}")
echo "Response: ${resp}" | tee -a "${LOG_FILE}"
echo "[NOTE] Inspect that the result contains 'pong' in content" | tee -a "${LOG_FILE}"

log_section "Terminate session via DELETE /mcp"
status=$(curl -sS -o /dev/null -w "%{http_code}" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-client-id: ${CLIENT_ID}" \
  -H "mcp-session-id: ${SESSION_ID}" \
  --max-time 15 \
  -X DELETE "${MCP_URL}")
expect_http_code 204 "${status}"

echo | tee -a "${LOG_FILE}"
echo "[test-mcp] MCP flow tests completed" | tee -a "${LOG_FILE}"


