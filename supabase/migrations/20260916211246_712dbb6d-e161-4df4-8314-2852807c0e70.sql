CREATE OR REPLACE FUNCTION public.bump_usage(_max INT DEFAULT 300, _tokens INT DEFAULT 0)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid UUID := auth.uid();
  current INT;
BEGIN
  IF uid IS NULL THEN RETURN FALSE; END IF;
  INSERT INTO public.usage_counters (user_id, day, requests, tokens)
  VALUES (uid, (now() AT TIME ZONE 'utc')::date, 1, GREATEST(_tokens, 0))
  ON CONFLICT (user_id, day) DO UPDATE
    SET requests = public.usage_counters.requests + 1,
        tokens = public.usage_counters.tokens + GREATEST(_tokens, 0)
  RETURNING requests INTO current;
  RETURN current <= GREATEST(_max, 1);
END; $$;
REVOKE ALL ON FUNCTION public.bump_usage(INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bump_usage(INT, INT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.write_audit(_action TEXT, _target TEXT DEFAULT NULL, _metadata JSONB DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid UUID := auth.uid();
BEGIN
  IF uid IS NULL THEN RETURN; END IF;
  INSERT INTO public.audit_log (user_id, action, target, metadata)
  VALUES (uid, left(_action, 120), left(_target, 300), _metadata);
END; $$;
REVOKE ALL ON FUNCTION public.write_audit(TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.write_audit(TEXT, TEXT, JSONB) TO authenticated, service_role;