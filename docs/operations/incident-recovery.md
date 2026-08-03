# Incident recovery

## Ops API down

1. Check process / container health and host resources.  
2. Confirm `GET /health`.  
3. Check logs for upstream timeouts or invalid tokens.  
4. Restart `ops` service.  

Bots should degrade gracefully (show “ops unavailable”) rather than invent fleet or case state.

## Wrong or empty answers

| Symptom | Check |
|---------|--------|
| Empty fleet | `TAWNY_BASE_URL` / token; upstream `/api/agents` |
| Empty cases | `KELPIE_BASE_URL` / token; case list permissions |
| TI errors | `BROLGA_BASE_URL` / token; `/api/v1/health` on TI API |
| Agent generate fails | Model API key; `MUSTER_MASTRA_MODEL`; network to provider |

Use structured REST routes to isolate whether the fault is LLM or connector.

## Compromised ops token

1. Rotate `MUSTER_OPS_TOKEN`.  
2. Update all bot hosts.  
3. Review access logs on the reverse proxy if available.  
4. Rotate upstream tokens if the ops host may have been fully compromised.  
