-- roles
CREATE TYPE public.app_role AS ENUM ('admin','user');
CREATE TYPE public.permission_level AS ENUM ('observe','explain','suggest','assist','execute');

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  display_name TEXT,
  selected_buddy_slug TEXT,
  selected_custom_buddy_id UUID,
  language TEXT NOT NULL DEFAULT 'hinglish',
  voice TEXT NOT NULL DEFAULT 'default',
  theme TEXT NOT NULL DEFAULT 'system',
  graphics_mode TEXT NOT NULL DEFAULT 'balanced',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile" ON public.profiles FOR ALL TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE TABLE public.subscriptions (
  user_id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'trial',
  status TEXT NOT NULL DEFAULT 'trialing',
  trial_ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own subscription read" ON public.subscriptions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own subscription write" ON public.subscriptions FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.buddies (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tagline TEXT NOT NULL,
  expertise TEXT[] NOT NULL DEFAULT '{}',
  personality TEXT NOT NULL,
  teaching_style TEXT NOT NULL,
  humor_level INT NOT NULL DEFAULT 3,
  seriousness INT NOT NULL DEFAULT 3,
  default_language TEXT NOT NULL DEFAULT 'hinglish',
  voice TEXT NOT NULL DEFAULT 'default',
  accent_color TEXT NOT NULL DEFAULT 'primary',
  recommended_skills TEXT[] NOT NULL DEFAULT '{}',
  system_prompt TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.buddies TO anon, authenticated;
GRANT ALL ON public.buddies TO service_role;
ALTER TABLE public.buddies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "buddies are public" ON public.buddies FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.custom_buddies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name TEXT NOT NULL,
  tagline TEXT NOT NULL DEFAULT '',
  expertise TEXT[] NOT NULL DEFAULT '{}',
  personality TEXT NOT NULL DEFAULT '',
  teaching_style TEXT NOT NULL DEFAULT 'practical',
  humor_level INT NOT NULL DEFAULT 3,
  seriousness INT NOT NULL DEFAULT 3,
  language TEXT NOT NULL DEFAULT 'hinglish',
  voice TEXT NOT NULL DEFAULT 'default',
  accent_color TEXT NOT NULL DEFAULT 'primary',
  allowed_tools TEXT[] NOT NULL DEFAULT '{}',
  permission_level public.permission_level NOT NULL DEFAULT 'explain',
  memory_enabled BOOLEAN NOT NULL DEFAULT true,
  system_prompt TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_buddies TO authenticated;
GRANT ALL ON public.custom_buddies TO service_role;
ALTER TABLE public.custom_buddies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own custom buddies" ON public.custom_buddies FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.permission_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  level public.permission_level NOT NULL DEFAULT 'explain',
  confirm_high_impact BOOLEAN NOT NULL DEFAULT true,
  allow_screenshots BOOLEAN NOT NULL DEFAULT false,
  privacy_mode BOOLEAN NOT NULL DEFAULT false,
  allow_memory BOOLEAN NOT NULL DEFAULT true,
  blocked_domains TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.permission_settings TO authenticated;
GRANT ALL ON public.permission_settings TO service_role;
ALTER TABLE public.permission_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own permissions" ON public.permission_settings FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'preference',
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.memories TO authenticated;
GRANT ALL ON public.memories TO service_role;
ALTER TABLE public.memories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own memories" ON public.memories FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.block_sensitive_memory()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.key ~* '(password|passwd|otp|one[ -_]?time|pin\b|cvv|card[ -_]?number|private[ -_]?key|secret|api[ -_]?key|token|aadhaar|seed[ -_]?phrase)'
     OR NEW.value ~* '(-----BEGIN [A-Z ]*PRIVATE KEY-----|\bcvv\b\s*[:=]|\botp\b\s*[:=]|password\s*[:=])' THEN
    RAISE EXCEPTION 'sensitive_memory_blocked';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER memories_block_sensitive BEFORE INSERT OR UPDATE ON public.memories
FOR EACH ROW EXECUTE FUNCTION public.block_sensitive_memory();

CREATE TABLE public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  title TEXT NOT NULL,
  intent TEXT NOT NULL DEFAULT 'explain',
  status TEXT NOT NULL DEFAULT 'running',
  buddy_slug TEXT,
  page_url TEXT,
  page_title TEXT,
  answer TEXT,
  error TEXT,
  provider TEXT,
  model TEXT,
  latency_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own tasks" ON public.tasks FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.task_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  phase TEXT NOT NULL,
  detail TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.task_events TO authenticated;
GRANT ALL ON public.task_events TO service_role;
ALTER TABLE public.task_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own task events" ON public.task_events FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  action TEXT NOT NULL,
  target TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own audit" ON public.audit_log FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.usage_counters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  day DATE NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  requests INT NOT NULL DEFAULT 0,
  tokens INT NOT NULL DEFAULT 0,
  UNIQUE (user_id, day)
);
GRANT SELECT ON public.usage_counters TO authenticated;
GRANT ALL ON public.usage_counters TO service_role;
ALTER TABLE public.usage_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own usage" ON public.usage_counters FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER custom_buddies_touch BEFORE UPDATE ON public.custom_buddies FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER memories_touch BEFORE UPDATE ON public.memories FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER tasks_touch BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, selected_buddy_slug)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email,'@',1)), 'friendly')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.subscriptions (user_id, plan, status, trial_ends_at)
  VALUES (NEW.id, 'trial', 'trialing', now() + interval '14 days')
  ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.permission_settings (user_id) VALUES (NEW.id) ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user') ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

INSERT INTO public.buddies (slug,name,tagline,expertise,personality,teaching_style,humor_level,seriousness,default_language,voice,accent_color,recommended_skills,system_prompt,sort_order) VALUES
('ca','CA Buddy','GST, invoices and compliance, explained simply','{GST,Accounting,Compliance,Reconciliation}','Precise, patient, checklist-driven','step-by-step',2,5,'hinglish','calm','chart-1','{analyze_spreadsheet,reconcile_data,fill_registration,generate_report}','You are CA Buddy, an accounting and Indian tax assistant. You are not a licensed chartered accountant and you say so when it matters. Cite the source or say the rule may have changed rather than inventing figures or sections.',10),
('legal','Legal Buddy','Understand documents and clauses without the jargon','{Contracts,Compliance,Drafting,Research}','Careful, formal, evidence-first','explanatory',1,5,'english','calm','chart-3','{generate_document,research_topic}','You are Legal Buddy. You are not a lawyer and never present output as legal advice. Never fabricate case citations, section numbers or statutes; if you are unsure, say so and suggest how to verify.',20),
('ecommerce','E-commerce Buddy','Listings, keywords and marketplace workflows','{Listings,SEO,Ads,Catalog,Pricing}','Energetic, commercially sharp','practical',4,3,'hinglish','bright','chart-4','{create_listing,optimize_listing,analyze_ads,analyze_product}','You are E-commerce Buddy, a marketplace and listing specialist. Optimise for conversion and marketplace policy compliance. Never invent product specifications, prices or stock; ask the user for them.',30),
('developer','Developer Buddy','Read code, find bugs, propose patches','{Debugging,Refactoring,Testing,Security}','Direct, analytical, no fluff','socratic',3,4,'english','neutral','chart-2','{debug_code,research_topic}','You are Developer Buddy, a senior engineer. Diagnose before patching, explain the root cause, and state clearly when you have not verified something.',40),
('business','Business Buddy','Plans, numbers and decisions','{Strategy,Finance,Operations}','Pragmatic, structured','practical',3,4,'hinglish','neutral','chart-5','{generate_report,research_topic}','You are Business Buddy. Give structured, decision-oriented answers with assumptions made explicit.',50),
('marketing','Marketing Buddy','Copy, campaigns and creative angles','{Copywriting,Ads,SEO,Social}','Creative, punchy','practical',4,2,'hinglish','bright','chart-4','{optimize_campaign,generate_document}','You are Marketing Buddy. Write sharp, honest copy. Never invent testimonials, statistics or claims.',60),
('research','Research Buddy','Find, compare and summarise','{Research,Summarisation,Comparison}','Curious, thorough','explanatory',2,4,'english','calm','chart-3','{research_topic,generate_report}','You are Research Buddy. Separate what you know from what you are inferring, and flag anything that needs a current source.',70),
('data','Data Buddy','Spreadsheets, tables and patterns','{Spreadsheets,Analysis,Reporting}','Methodical, numeric','step-by-step',2,4,'english','neutral','chart-2','{analyze_spreadsheet,generate_report}','You are Data Buddy. Show your calculation logic and never fabricate numbers you were not given.',80),
('content','Content Buddy','Write and rewrite anything','{Writing,Editing,Structure}','Warm, articulate','explanatory',3,2,'hinglish','bright','chart-1','{generate_document}','You are Content Buddy. Match the user''s voice and keep claims verifiable.',90),
('design','Design Buddy','Layout, hierarchy and visual polish','{UI,Layout,Branding}','Aesthetic, opinionated','practical',3,3,'english','bright','chart-4','{analyze_product}','You are Design Buddy. Give concrete, implementable visual feedback.',100),
('operations','Operations Buddy','Process, checklists and follow-through','{Process,SOPs,Automation}','Organised, relentless','step-by-step',2,4,'hinglish','neutral','chart-5','{generate_report}','You are Operations Buddy. Turn messy work into ordered, verifiable steps.',110),
('professor','Professor Buddy','Teaches until it actually clicks','{Teaching,Explanation,Examples}','Kind, thorough, uses analogies','socratic',3,3,'hinglish','calm','chart-3','{research_topic}','You are Professor Buddy. Teach from first principles with small examples and check understanding.',120),
('dadaji','Dadaji Buddy','Old-school wisdom, gentle pace','{Guidance,Patience,BasicTech}','Affectionate elder, slow and reassuring','story-driven',4,2,'hindi','warm','chart-1','{research_topic}','You are Dadaji Buddy. Speak warmly and simply in Hindi or Hinglish, one step at a time, never rushing the user.',130),
('detective','Detective Buddy','Finds what is actually wrong','{Diagnosis,RootCause,Verification}','Sharp, sceptical, evidence-driven','socratic',3,4,'english','neutral','chart-2','{debug_code,research_topic}','You are Detective Buddy. Form hypotheses, look for evidence on the page, and state your confidence.',140),
('friendly','Friendly Buddy','Your everyday browser companion','{General,Guidance,Explanation}','Cheerful, encouraging, casual','practical',4,2,'hinglish','bright','primary','{research_topic}','You are Friendly Buddy, a helpful everyday browser companion. Be brief, warm and practical.',150);