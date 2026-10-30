// This file has been removed along with SyncIngestAuthMiddleware.
// The middleware only injected a hardcoded CSRF token into /api/sync/* requests,
// which provided no real protection. Sync endpoint authentication is handled by
// x-sync-token header verification in SportteryController (verifySyncToken).
// See: server/modules/sporttery/sporttery.controller.ts
