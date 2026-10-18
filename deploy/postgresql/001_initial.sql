-- Explicit reviewed migration step. Runtime startup only reads the ledger.
BEGIN;
CREATE TABLE public.solutiondeploy_schema (
    app_id TEXT PRIMARY KEY,
    version INTEGER NOT NULL
);
CREATE TABLE public.sitedock_favorites (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    document JSONB NOT NULL CHECK (
        jsonb_typeof(document) = 'object'
        AND document ?& ARRAY['revision', 'favorites', 'groups']
        AND jsonb_typeof(document->'revision') = 'number'
        AND (document->>'revision')::numeric BETWEEN 0 AND 9007199254740991
        AND (document->>'revision')::numeric = trunc((document->>'revision')::numeric)
        AND jsonb_typeof(document->'favorites') = 'array'
        AND jsonb_typeof(document->'groups') = 'array'
    )
);
CREATE TABLE public.solutiondeploy_import (
    app_id TEXT PRIMARY KEY,
    source_sha256 TEXT NOT NULL,
    validation JSONB NOT NULL,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE public.sitedock_owner (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    document JSONB NOT NULL CHECK (
        jsonb_typeof(document) = 'object'
        AND document ?& ARRAY['username', 'salt', 'hash', 'version']
        AND document->>'username' <> ''
        AND document->>'salt' ~ '^[0-9a-f]{32}$'
        AND document->>'hash' ~ '^[0-9a-f]{128}$'
        AND document->>'version' ~ '^[0-9a-f-]{36}$'
    )
);
INSERT INTO public.solutiondeploy_schema(app_id, version) VALUES ('site-dock', 1);
COMMIT;
