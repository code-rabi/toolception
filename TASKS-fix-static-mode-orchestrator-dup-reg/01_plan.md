# Fix STATIC mode duplicate tool registration

## Objectives
- Prevent duplicate tool registrations in STATIC mode when multiple clients connect.
- Preserve DYNAMIC mode behavior.
- Optional: ensure DELETE /mcp tears down sessions.

## Plan
1. Reuse initial orchestrator in STATIC mode per-client bundles (preferred)
   - In createMcpServer, if mode === STATIC, return the base orchestrator from createBundle.
   - Ensure no per-client startup enable runs on shared server.
2. Add guard to skip startup enabling for per-client orchestrators (fallback)
   - If we must create per-client orchestrators, pass a flag to skip startup enabling.
3. Tests for duplicate registration prevention
   - Start server in STATIC with a toolset.
   - Simulate two clients; assert tools registered once.
4. Optional: DELETE /mcp enhancements
   - On DELETE, close transport and evict session.
5. Docs updates
   - README: Clarify STATIC vs DYNAMIC bundling and namespacing guidance.

## Tasks
- [ ] Implement STATIC-mode orchestrator reuse in createMcpServer
- [ ] Add duplicate registration tests for STATIC mode
- [ ] Add fallback guard to avoid per-client startup enabling (if needed)
- [ ] Update README examples and notes
- [ ] (Optional) Close and evict sessions on DELETE /mcp

## Verification
- STATIC mode: multiple clients -> no duplicate tool registration.
- DYNAMIC mode unaffected.
- README reflects accurate behavior.
