#!/usr/bin/env bash
set -euo pipefail

PORT=${PORT:-3003}
BASE_URL="http://localhost:${PORT}"
LOG_FILE="local-server-tests/test-http.log"

echo "[test-http] Starting HTTP endpoint tests against ${BASE_URL}" | tee "${LOG_FILE}"

log_section() {
  echo | tee -a "${LOG_FILE}"
  echo "===== $1 =====" | tee -a "${LOG_FILE}"
}

expect_grep() {
  local pattern="$1" ; shift
  local context="$1" ; shift || true
  if echo "${context}" | grep -qE "${pattern}"; then
    echo "[PASS] Found pattern: ${pattern}" | tee -a "${LOG_FILE}"
  else
    echo "[FAIL] Missing pattern: ${pattern}" | tee -a "${LOG_FILE}"
    echo "Context was:" | tee -a "${LOG_FILE}"
    echo "${context}" | tee -a "${LOG_FILE}"
    exit 1
  fi
}

log_section "GET /healthz should return { ok: true }"
resp=$(curl -sS "${BASE_URL}/healthz")
echo "Response: ${resp}" | tee -a "${LOG_FILE}"
expect_grep '\{"ok":true\}' "${resp}"

log_section "GET /.well-known/mcp-config should be JSON schema"
resp=$(curl -sS "${BASE_URL}/.well-known/mcp-config")
echo "Response: ${resp}" | tee -a "${LOG_FILE}"
expect_grep '"type"\s*:\s*"object"' "${resp}"

log_section "GET /tools should include toolset info"
resp=$(curl -sS "${BASE_URL}/tools")
echo "Response: ${resp}" | tee -a "${LOG_FILE}"
expect_grep '"availableToolsets"' "${resp}"
expect_grep '"toolsetToTools"' "${resp}"

log_section "POST /mcp without body should 400 with Session error"
status=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}/mcp")
echo "Status: ${status}" | tee -a "${LOG_FILE}"
if [[ "${status}" != "400" ]]; then
  echo "[FAIL] Expected status 400, got ${status}" | tee -a "${LOG_FILE}"
  exit 1
fi
echo "[PASS] Got expected 400" | tee -a "${LOG_FILE}"

echo | tee -a "${LOG_FILE}"
echo "[test-http] All HTTP tests passed" | tee -a "${LOG_FILE}"


