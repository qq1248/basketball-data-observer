// This file has been removed.
// The middleware previously injected a hardcoded CSRF token into all /api/sync/*
// requests (effectively disabling CSRF protection). Sync endpoint authentication
// is handled by x-sync-token header verification in SportteryController, which
// compares the token against serverSecrets.syncToken via verifySyncToken().
// See: server/modules/sporttery/sporttery.controller.ts
