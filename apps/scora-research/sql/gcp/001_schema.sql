-- Esquema de Scora para Cloud SQL (PostgreSQL).
--
-- Traducido desde un volcado de la base de Supabase el 25-09-2026. Se conservan las 31
-- tablas que usa esta app con sus tipos, claves, indices y comentarios EXACTOS; el resto
-- del volcado (las 17 tablas de las otras apps del ecosistema, y los esquemas internos
-- auth/storage/realtime de Supabase) se queda fuera a proposito.
--
-- QUE SE QUITO AL TRADUCIR, y por que:
--
--   · 38 politicas RLS y 31 `enable row level security`. Funcionaban porque cada peticion
--     llegaba a Postgres con el JWT del usuario y `auth.uid()` sabia quien era. Aqui la app
--     se conecta con UNA sola identidad de servicio, asi que la base no puede distinguir
--     usuarios y la RLS no filtraria nada. La autorizacion se muda al servidor: ver
--     lib/server/data/policy.ts, que declara por tabla si es privada y añade el filtro de
--     usuario SIEMPRE. Esa mudanza es el punto delicado de toda la migracion.
--
--   · 11 claves ajenas a `auth.users`. Esa tabla era de Supabase y desaparece. Las columnas
--     `user_id` se conservan tal cual (uuid): pasan a guardar el identificador que emita
--     Identity Platform. Sin clave ajena no hay borrado en cascada, asi que dar de baja a un
--     usuario tendra que limpiar sus filas explicitamente.
--
--   · 3 `DEFAULT auth.uid()`. Rellenaban el dueño de la fila solos. Ahora lo pone la capa de
--     datos, que es la unica que conoce al usuario verificado.
--
-- Extensiones: solo pgcrypto (gen_random_uuid). pg_graphql y supabase_vault eran de Supabase.

-- PUENTE ROTO A PROPOSITO: el volcado traia un disparador `trg_snapshot_ic_score` sobre
-- macro_state que, en cada UPDATE, escribia en public.ic_snapshots — una tabla de las OTRAS
-- apps del ecosistema (ic-suite / ic-datalayer-app), que se quedan en Supabase. Aqui esa
-- tabla no existe, asi que el disparador haria fallar el cron macro de las 11:00 cada dia.
-- Se quita. CONSECUENCIA: la app de Alejandro deja de recibir el IC score automaticamente.
-- Hay que decidir si su cron lo escribe por HTTP o si lee el macro de otro sitio.

create extension if not exists pgcrypto;

CREATE TABLE public.ai_audit_log (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    ticker text,
    module text NOT NULL,
    model text,
    prompt_chars integer,
    sources text[],
    output text,
    violations numeric[],
    grounded boolean,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    input_tokens integer,
    output_tokens integer,
    cache_read_tokens integer,
    est_cost_usd numeric(12,6)
);

ALTER TABLE public.ai_audit_log ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.ai_audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.alerts_log (
    id bigint NOT NULL,
    user_id uuid,
    alert_type text,
    threshold numeric,
    actual_value numeric,
    ticker text,
    message text,
    triggered_at timestamp with time zone DEFAULT now()
);

CREATE SEQUENCE public.alerts_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.alerts_log_id_seq OWNED BY public.alerts_log.id;

CREATE TABLE public.ic_briefs (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    regime text,
    conviction numeric,
    dominant_signal text,
    scores jsonb,
    divergences jsonb,
    cartera_action text,
    invalidation_trigger text,
    time_horizon text,
    risk_asymmetry text,
    raw jsonb
);

ALTER TABLE public.ic_briefs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.ic_briefs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.kb_cards (
    id text NOT NULL,
    topic text NOT NULL,
    claim text NOT NULL,
    source text NOT NULL,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    weight integer DEFAULT 5 NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);

COMMENT ON TABLE public.kb_cards IS 'Scora knowledge base (Karpathy-style grounding): validated findings + methodology, each with a source. The AI layer retrieves and cites these so it reasons from Scora''s own research, not training-data consensus. Read-only to authenticated users.';

CREATE TABLE public.kb_chunks (
    id text NOT NULL,
    ticker text NOT NULL,
    cik text,
    form text DEFAULT '10-K'::text NOT NULL,
    accession text,
    section text NOT NULL,
    chunk_idx integer NOT NULL,
    text text NOT NULL,
    filed_date date,
    fiscal_year integer,
    source_url text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tsv tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, text)) STORED
);

CREATE TABLE public.kb_docs (
    id text NOT NULL,
    ticker text NOT NULL,
    cik text,
    form text NOT NULL,
    accession text,
    section text NOT NULL,
    text text NOT NULL,
    filed_date date,
    fiscal_year integer,
    source_url text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.macro_state (
    id integer DEFAULT 1 NOT NULL,
    snapshot_date date DEFAULT CURRENT_DATE,
    credit_stress numeric,
    liquidity_cycle numeric,
    recession_prob numeric,
    geopolitical_risk numeric,
    housing_stress numeric,
    regime_id text,
    regime_label text,
    cartera_quadrant text,
    ic_score numeric,
    updated_at timestamp with time zone DEFAULT now(),
    dgs2 numeric,
    dgs10 numeric,
    dgs30 numeric,
    term_premium_10y numeric,
    curve_steepener text,
    net_liquidity_t numeric,
    net_liquidity_dir text,
    boj_assets numeric,
    claims_trend text,
    profits_trend text,
    recession_gate_active boolean,
    credit_private_proxy numeric,
    credit_divergence boolean,
    fed_room text,
    core_pce_yoy numeric,
    unrate numeric,
    oil_shock text,
    wti_level numeric,
    wti_chg_1m numeric,
    buffett_indicator numeric,
    expected_return_10y numeric,
    ecb_assets numeric,
    global_liquidity_dir text,
    put_call_ratio numeric,
    fear_greed numeric,
    fear_greed_rating text,
    sentiment_signal text,
    hy_oas numeric,
    hy_bb_oas numeric,
    hy_ccc_oas numeric,
    bbb_oas numeric,
    stlfsi4 numeric,
    c_and_i_loans numeric,
    credit_card_delinq numeric,
    t10y2y numeric,
    t10y3m numeric,
    sahm_rule numeric,
    icsa numeric,
    umcsent numeric,
    vix numeric,
    ovx numeric,
    brent numeric,
    dxy numeric,
    usdjpy numeric,
    m2_growth numeric,
    walcl numeric,
    rrpontsyd numeric,
    wresbal numeric,
    sofr numeric,
    fedfunds numeric,
    mortgage_rate numeric,
    home_sales numeric,
    house_starts numeric,
    building_permits numeric,
    case_shiller_yoy numeric,
    dgs1 numeric,
    dgs5 numeric,
    payems numeric,
    breakeven_10y numeric,
    nfci numeric,
    median_home_price_chg numeric,
    gold_price numeric,
    meltup_score numeric,
    bubble_debt numeric,
    bubble_ai numeric,
    core_cpi_yoy numeric,
    hy_oas_momentum numeric,
    ted_spread numeric,
    move_index numeric,
    skew_index numeric,
    dalio_stage integer DEFAULT 4,
    risk_on numeric,
    risk_on_lcc numeric,
    risk_on_rpc numeric,
    risk_on_csc numeric,
    implied_corr numeric,
    cape numeric,
    breadth_200dma numeric,
    breadth_50dma numeric,
    breadth_mom numeric,
    breadth_1m numeric,
    breadth_updated_at timestamp with time zone,
    regime_confirmation text,
    CONSTRAINT macro_state_singleton CHECK ((id = 1))
);

COMMENT ON COLUMN public.macro_state.risk_on IS 'Stationary liquidity-led risk-on gauge (0-100) for the multi-asset allocator. Computed by ic-proxy buildStationaryRiskOn (mirrors scora-research regimeStationary.mjs). Nullable.';

COMMENT ON COLUMN public.macro_state.risk_on_lcc IS 'Stationary liquidity-impulse percentile (0-100), driver of risk_on. Higher = liquidity expanding.';

COMMENT ON COLUMN public.macro_state.risk_on_rpc IS 'Stationary recession-risk percentile (0-100): inverted curve + Sahm. Higher = recession risk.';

COMMENT ON COLUMN public.macro_state.risk_on_csc IS 'Stationary financial-stress percentile (0-100) from STLFSI4. Higher = stress.';

COMMENT ON COLUMN public.macro_state.implied_corr IS 'CBOE 3-month implied correlation (^COR3M). Stock-picking regime for the momentum micro score (Phase 4): low = dispersion (selection pays), high = macro tape (momentum crashes). Nullable.';

COMMENT ON COLUMN public.macro_state.cape IS 'Shiller CAPE (cyclically-adjusted P/E) — secular valuation gauge (Phase 5, Secular Clock). Complements buffett_indicator. Nullable.';

CREATE TABLE public.macro_state_history (
    snapshot_date date NOT NULL,
    liquidity_cycle numeric,
    credit_stress numeric,
    recession_prob numeric,
    geopolitical_risk numeric,
    housing_stress numeric,
    regime_id text,
    ic_score numeric,
    vix numeric,
    spy_price numeric,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.push_alert_state (
    id integer DEFAULT 1 NOT NULL,
    last_confirmation text,
    last_sent timestamp with time zone,
    last_regime text
);

COMMENT ON COLUMN public.push_alert_state.last_regime IS 'Ultimo regime_id observado por el cron push-alerts. NULL = sin referencia, siembra sin notificar.';

CREATE TABLE public.push_subscriptions (
    endpoint text NOT NULL,
    user_id uuid NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.sl_alert_prefs (
    user_id uuid NOT NULL,
    email text NOT NULL,
    macro_alerts boolean DEFAULT true NOT NULL,
    last_emailed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.sl_alerts (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    ticker text NOT NULL,
    kind text NOT NULL,
    threshold numeric,
    note text,
    active boolean DEFAULT true NOT NULL,
    last_triggered_at timestamp with time zone,
    last_value numeric,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    one_shot boolean DEFAULT false NOT NULL
);

ALTER TABLE public.sl_alerts ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sl_alerts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.sl_analyses (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    ticker text NOT NULL,
    analysis_date date DEFAULT CURRENT_DATE NOT NULL,
    score_total integer,
    score_val integer,
    score_hlth integer,
    score_mom integer,
    score_growth integer,
    rating text,
    macro_tilt integer,
    macro_tilt_reasons jsonb,
    sector text,
    raw_metrics jsonb,
    created_at timestamp with time zone DEFAULT now(),
    reverse_dcf jsonb,
    pe numeric,
    ev_ebitda numeric,
    pfcf numeric,
    roic numeric,
    fcf_yield numeric,
    score_version smallint DEFAULT 1 NOT NULL
);

COMMENT ON COLUMN public.sl_analyses.reverse_dcf IS 'Reverse DCF result (gated by SL_FLAGS.REVERSE_DCF_ENABLED in StockLens). Nullable/additive. Shape: {applicable, impliedG1, revCagr, tvShare, impliedExitMultiple, impliedGrowthPremium, realityBand, perShare, wacc, lowConfidence, ...} or {applicable:false, reason}.';

COMMENT ON COLUMN public.sl_analyses.score_version IS 'Versión de la fórmula del score con la que se calculó ESTE análisis: 1 = bandas absolutas · 2 = percentiles sector-relativos (F2, 2026-08). Análisis de versiones distintas no son comparables entre sí.';

CREATE SEQUENCE public.sl_analyses_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.sl_analyses_id_seq OWNED BY public.sl_analyses.id;

CREATE TABLE public.sl_briefings (
    id bigint NOT NULL,
    brief_date date NOT NULL,
    cadence text DEFAULT 'weekly'::text NOT NULL,
    transcript text NOT NULL,
    audio_url text,
    chars integer,
    duration_sec integer,
    macro_snapshot_date date,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.sl_briefings IS 'Spoken macro brief. Transcript is deterministic from macro_state (no LLM); audio_url is optional. Public read, service_role write.';

ALTER TABLE public.sl_briefings ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sl_briefings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.sl_cohort (
    id bigint NOT NULL,
    score_date date NOT NULL,
    ticker text NOT NULL,
    score_total integer,
    ic_score integer,
    sector text,
    raw_price numeric,
    adj_price numeric,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    score_version smallint DEFAULT 1 NOT NULL
);

COMMENT ON COLUMN public.sl_cohort.score_version IS 'Versión de la fórmula del score (lib/scoring.ts): 1 = bandas absolutas · 2 = percentiles sector-relativos (F2, 2026-08). Las cohortes de versiones distintas NO son comparables entre sí: al medir el track record hay que segmentar por esta columna.';

ALTER TABLE public.sl_cohort ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sl_cohort_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.sl_daily_close (
    close_date date NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.sl_daily_close IS 'Informe de cierre diario, construido de forma determinista por lib/dailyClose.js. Lectura publica (contenido), escritura solo con service key.';

CREATE TABLE public.sl_discovery (
    ticker text NOT NULL,
    sector text,
    price numeric,
    mom_12_1 numeric,
    mom_6m numeric,
    score numeric,
    rank integer,
    updated_at timestamp with time zone DEFAULT now(),
    feed text DEFAULT 'equity'::text NOT NULL,
    asset_class text,
    label text
);

COMMENT ON TABLE public.sl_discovery IS 'Momentum/trajectory-ranked S&P 500 universe (Phase 4 validated score) for the discovery screener. Refreshed by research/discovery.mjs. Read-only to authenticated users.';

CREATE TABLE public.sl_journal (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    ticker text NOT NULL,
    side text DEFAULT 'buy'::text NOT NULL,
    shares numeric NOT NULL,
    price numeric NOT NULL,
    trade_date date DEFAULT CURRENT_DATE NOT NULL,
    thesis text,
    sector text,
    status text DEFAULT 'open'::text NOT NULL,
    exit_price numeric,
    exit_date date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sl_journal_price_check CHECK ((price >= (0)::numeric)),
    CONSTRAINT sl_journal_shares_check CHECK ((shares > (0)::numeric))
);

ALTER TABLE public.sl_journal ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sl_journal_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.sl_paper_fund (
    id bigint NOT NULL,
    rebalance_date date NOT NULL,
    weights jsonb NOT NULL,
    risk_on numeric,
    moved_to_cash text[],
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.sl_paper_fund ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sl_paper_fund_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.sl_paper_fund_track (
    as_of date NOT NULL,
    inception date,
    nav numeric,
    spy_nav numeric,
    total_ret numeric,
    spy_ret numeric,
    max_dd numeric,
    sharpe numeric,
    grade text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    bench6040_nav numeric,
    bench6040_ret numeric
);

CREATE TABLE public.sl_picks_position (
    id bigint NOT NULL,
    ticker text NOT NULL,
    rules_version smallint DEFAULT 2 NOT NULL,
    opened_on date NOT NULL,
    open_pctl numeric(6,4) NOT NULL,
    open_price numeric(18,6),
    closed_on date,
    close_price numeric(18,6),
    close_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sl_picks_position_close_reason_check CHECK ((close_reason = ANY (ARRAY['senal_bajo_umbral'::text, 'descalificador'::text, 'fuera_del_universo'::text])))
);

COMMENT ON TABLE public.sl_picks_position IS 'Posiciones de Scora Picks. Las cerradas NO se borran: §7 promete publicar todas las posiciones cerradas con su resultado, incluidas las que salieron mal.';

CREATE SEQUENCE public.sl_picks_position_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.sl_picks_position_id_seq OWNED BY public.sl_picks_position.id;

CREATE TABLE public.sl_picks_run (
    id bigint NOT NULL,
    decision_date date NOT NULL,
    rules_version smallint DEFAULT 2 NOT NULL,
    universe_size integer NOT NULL,
    eligible_count integer NOT NULL,
    bought_count integer NOT NULL,
    sold_count integer NOT NULL,
    positions_after integer NOT NULL,
    not_bought jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    signal jsonb DEFAULT '{}'::jsonb NOT NULL,
    universe_asof date
);

COMMENT ON TABLE public.sl_picks_run IS 'Una fila por fecha de decisión de Scora Picks, SIEMPRE, también cuando no se compró nada. Un hueco vacío es un resultado legítimo (§4) y tiene que quedar registrado como tal, no como ausencia de fila.';

COMMENT ON COLUMN public.sl_picks_run.rules_version IS 'Versión de las reglas (lib/picks.ts PICKS_RULES_VERSION). Las series de versiones distintas NO se mezclan al medir el track record.';

COMMENT ON COLUMN public.sl_picks_run.signal IS 'Panel de señal usado en esta decisión: {ticker: percentil de calidad 0..1}, congelado. De aquí se derivan la persistencia de 60 días y el contador de salida, así que el motor no guarda estado propio. Se congela porque EDGAR restatea: recalcularlo haría irreproducible una decisión ya publicada.';

COMMENT ON COLUMN public.sl_picks_run.universe_asof IS 'Fecha de la foto de miembros del S&P 500 usada en esta decisión, que NO es decision_date: la fuente gratuita del universo dejó de actualizarse el 2025-08-23. Se publica en /picks para que el desfase sea visible y auditable en lugar de silencioso.';

CREATE SEQUENCE public.sl_picks_run_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.sl_picks_run_id_seq OWNED BY public.sl_picks_run.id;

CREATE TABLE public.sl_revisions (
    snap_date date NOT NULL,
    ticker text NOT NULL,
    cons numeric,
    rev numeric,
    n_analysts integer,
    price numeric,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.sl_score_log (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    ticker text NOT NULL,
    score_date date DEFAULT ((now() AT TIME ZONE 'utc'::text))::date NOT NULL,
    scored_at timestamp with time zone DEFAULT now() NOT NULL,
    score_total integer,
    ic_score integer,
    macro_tilt integer,
    rating text,
    sector text,
    regime_id text,
    price_at_score numeric
);

ALTER TABLE public.sl_score_log ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sl_score_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.sl_stripe_events (
    event_id text NOT NULL,
    type text NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.sl_subscriptions (
    user_id uuid NOT NULL,
    stripe_customer_id text NOT NULL,
    stripe_subscription_id text,
    status text NOT NULL,
    price_id text,
    current_period_end timestamp with time zone,
    cancel_at_period_end boolean DEFAULT false NOT NULL,
    last_event_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.sl_track_summary (
    id integer DEFAULT 1 NOT NULL,
    as_of date,
    months_live integer,
    cohorts integer,
    names_scored integer,
    buy_total_return numeric,
    spy_total_return numeric,
    sharpe numeric,
    max_drawdown numeric,
    information_coefficient numeric,
    buy_hit_rate numeric,
    by_horizon jsonb,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    by_version jsonb,
    CONSTRAINT sl_track_summary_one_row CHECK ((id = 1))
);

COMMENT ON COLUMN public.sl_track_summary.by_version IS 'Métricas del track record desglosadas por versión del score (IC, retorno, acierto y nº de nombres de cada una). El agregado de la fila mezcla versiones y por eso no basta por sí solo.';

CREATE TABLE public.sl_waitlist (
    id bigint NOT NULL,
    email text NOT NULL,
    user_id uuid,
    tier text DEFAULT 'pro'::text NOT NULL,
    source text,
    referrer text,
    notified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.sl_waitlist IS 'Pro-tier intent capture. RLS on with NO policies on purpose: only service_role (ic-proxy /api/waitlist) may write, nothing in a browser may read. Do not add a permissive policy.';

ALTER TABLE public.sl_waitlist ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sl_waitlist_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.sl_watchlist (
    id bigint NOT NULL,
    user_id uuid,
    ticker text NOT NULL,
    basket_tag text,
    notes text,
    added_at timestamp with time zone DEFAULT now()
);

CREATE SEQUENCE public.sl_watchlist_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.sl_watchlist_id_seq OWNED BY public.sl_watchlist.id;

CREATE TABLE public.smart_money_top_buyers (
    id bigint NOT NULL,
    month date NOT NULL,
    rank integer NOT NULL,
    ticker text NOT NULL,
    sector text,
    net_insider_buying_usd numeric,
    num_insiders integer,
    score numeric
);

CREATE SEQUENCE public.smart_money_top_buyers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.smart_money_top_buyers_id_seq OWNED BY public.smart_money_top_buyers.id;

CREATE TABLE public.stock_snapshot (
    ticker text NOT NULL,
    snapshot_date date DEFAULT CURRENT_DATE NOT NULL,
    user_id uuid NOT NULL,
    data jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY public.alerts_log ALTER COLUMN id SET DEFAULT nextval('public.alerts_log_id_seq'::regclass);

ALTER TABLE ONLY public.sl_analyses ALTER COLUMN id SET DEFAULT nextval('public.sl_analyses_id_seq'::regclass);

ALTER TABLE ONLY public.sl_picks_position ALTER COLUMN id SET DEFAULT nextval('public.sl_picks_position_id_seq'::regclass);

ALTER TABLE ONLY public.sl_picks_run ALTER COLUMN id SET DEFAULT nextval('public.sl_picks_run_id_seq'::regclass);

ALTER TABLE ONLY public.sl_watchlist ALTER COLUMN id SET DEFAULT nextval('public.sl_watchlist_id_seq'::regclass);

ALTER TABLE ONLY public.smart_money_top_buyers ALTER COLUMN id SET DEFAULT nextval('public.smart_money_top_buyers_id_seq'::regclass);

ALTER TABLE ONLY public.ai_audit_log
    ADD CONSTRAINT ai_audit_log_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.alerts_log
    ADD CONSTRAINT alerts_log_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ic_briefs
    ADD CONSTRAINT ic_briefs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.kb_cards
    ADD CONSTRAINT kb_cards_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.kb_chunks
    ADD CONSTRAINT kb_chunks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.kb_docs
    ADD CONSTRAINT kb_docs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.macro_state_history
    ADD CONSTRAINT macro_state_history_pkey PRIMARY KEY (snapshot_date);

ALTER TABLE ONLY public.macro_state
    ADD CONSTRAINT macro_state_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.push_alert_state
    ADD CONSTRAINT push_alert_state_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (endpoint);

ALTER TABLE ONLY public.sl_alert_prefs
    ADD CONSTRAINT sl_alert_prefs_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.sl_alerts
    ADD CONSTRAINT sl_alerts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sl_analyses
    ADD CONSTRAINT sl_analyses_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sl_analyses
    ADD CONSTRAINT sl_analyses_ticker_date_user_uniq UNIQUE (ticker, analysis_date, user_id);

ALTER TABLE ONLY public.sl_briefings
    ADD CONSTRAINT sl_briefings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sl_cohort
    ADD CONSTRAINT sl_cohort_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sl_cohort
    ADD CONSTRAINT sl_cohort_score_date_ticker_key UNIQUE (score_date, ticker);

ALTER TABLE ONLY public.sl_daily_close
    ADD CONSTRAINT sl_daily_close_pkey PRIMARY KEY (close_date);

ALTER TABLE ONLY public.sl_discovery
    ADD CONSTRAINT sl_discovery_pkey PRIMARY KEY (ticker);

ALTER TABLE ONLY public.sl_journal
    ADD CONSTRAINT sl_journal_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sl_paper_fund
    ADD CONSTRAINT sl_paper_fund_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sl_paper_fund
    ADD CONSTRAINT sl_paper_fund_rebalance_date_key UNIQUE (rebalance_date);

ALTER TABLE ONLY public.sl_paper_fund_track
    ADD CONSTRAINT sl_paper_fund_track_pkey PRIMARY KEY (as_of);

ALTER TABLE ONLY public.sl_picks_position
    ADD CONSTRAINT sl_picks_position_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sl_picks_run
    ADD CONSTRAINT sl_picks_run_decision_date_rules_version_key UNIQUE (decision_date, rules_version);

ALTER TABLE ONLY public.sl_picks_run
    ADD CONSTRAINT sl_picks_run_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sl_revisions
    ADD CONSTRAINT sl_revisions_pkey PRIMARY KEY (snap_date, ticker);

ALTER TABLE ONLY public.sl_score_log
    ADD CONSTRAINT sl_score_log_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sl_score_log
    ADD CONSTRAINT sl_score_log_user_id_ticker_score_date_key UNIQUE (user_id, ticker, score_date);

ALTER TABLE ONLY public.sl_stripe_events
    ADD CONSTRAINT sl_stripe_events_pkey PRIMARY KEY (event_id);

ALTER TABLE ONLY public.sl_subscriptions
    ADD CONSTRAINT sl_subscriptions_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.sl_subscriptions
    ADD CONSTRAINT sl_subscriptions_stripe_customer_id_key UNIQUE (stripe_customer_id);

ALTER TABLE ONLY public.sl_subscriptions
    ADD CONSTRAINT sl_subscriptions_stripe_subscription_id_key UNIQUE (stripe_subscription_id);

ALTER TABLE ONLY public.sl_track_summary
    ADD CONSTRAINT sl_track_summary_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sl_waitlist
    ADD CONSTRAINT sl_waitlist_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sl_watchlist
    ADD CONSTRAINT sl_watchlist_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sl_watchlist
    ADD CONSTRAINT sl_watchlist_user_id_ticker_key UNIQUE (user_id, ticker);

ALTER TABLE ONLY public.smart_money_top_buyers
    ADD CONSTRAINT smart_money_top_buyers_month_rank_key UNIQUE (month, rank);

ALTER TABLE ONLY public.smart_money_top_buyers
    ADD CONSTRAINT smart_money_top_buyers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.stock_snapshot
    ADD CONSTRAINT stock_snapshot_pkey PRIMARY KEY (ticker, snapshot_date, user_id);

CREATE INDEX ai_audit_log_created_module_idx ON public.ai_audit_log USING btree (created_at DESC, module);

CREATE INDEX ai_audit_log_user_idx ON public.ai_audit_log USING btree (user_id, created_at DESC);

CREATE INDEX ic_briefs_user_created_idx ON public.ic_briefs USING btree (user_id, created_at DESC);

CREATE INDEX idx_sl_analyses_sector_date ON public.sl_analyses USING btree (sector, analysis_date DESC) WHERE (sector IS NOT NULL);

CREATE INDEX idx_snapshot_lookup ON public.stock_snapshot USING btree (ticker, snapshot_date, user_id);

CREATE INDEX kb_chunks_ticker_idx ON public.kb_chunks USING btree (ticker, section, chunk_idx);

CREATE INDEX kb_chunks_tsv_idx ON public.kb_chunks USING gin (tsv);

CREATE INDEX kb_docs_ticker_idx ON public.kb_docs USING btree (ticker);

CREATE INDEX macro_state_history_date_idx ON public.macro_state_history USING btree (snapshot_date DESC);

CREATE INDEX sl_alerts_active_idx ON public.sl_alerts USING btree (active, ticker) WHERE active;

CREATE INDEX sl_alerts_user_ticker_idx ON public.sl_alerts USING btree (user_id, ticker);

CREATE INDEX sl_analyses_idx ON public.sl_analyses USING btree (user_id, ticker, analysis_date DESC);

CREATE UNIQUE INDEX sl_briefings_date_idx ON public.sl_briefings USING btree (brief_date, cadence);

CREATE INDEX sl_briefings_recent_idx ON public.sl_briefings USING btree (brief_date DESC);

CREATE INDEX sl_cohort_date_idx ON public.sl_cohort USING btree (score_date);

CREATE INDEX sl_cohort_score_version_idx ON public.sl_cohort USING btree (score_version, score_date DESC);

CREATE INDEX sl_daily_close_date_idx ON public.sl_daily_close USING btree (close_date DESC);

CREATE INDEX sl_discovery_feed_rank_idx ON public.sl_discovery USING btree (feed, rank);

CREATE INDEX sl_journal_user_idx ON public.sl_journal USING btree (user_id, ticker);

CREATE INDEX sl_picks_position_cerradas_idx ON public.sl_picks_position USING btree (rules_version, closed_on DESC) WHERE (closed_on IS NOT NULL);

CREATE UNIQUE INDEX sl_picks_position_una_abierta ON public.sl_picks_position USING btree (ticker, rules_version) WHERE (closed_on IS NULL);

CREATE INDEX sl_picks_run_date_idx ON public.sl_picks_run USING btree (rules_version, decision_date DESC);

CREATE INDEX sl_revisions_date_idx ON public.sl_revisions USING btree (snap_date);

CREATE INDEX sl_score_log_ticker_date_idx ON public.sl_score_log USING btree (ticker, score_date);

CREATE INDEX sl_subscriptions_customer_idx ON public.sl_subscriptions USING btree (stripe_customer_id);

CREATE UNIQUE INDEX sl_waitlist_email_idx ON public.sl_waitlist USING btree (lower(email));




-- ── Funciones ────────────────────────────────────────────────────────────────────────
-- La app llama a search_kb_chunks por RPC (busqueda de texto completo sobre kb_chunks, que
-- tiene 50.000 filas). Es la unica funcion que invoca el navegador, y por eso es la unica
-- que se migra: lib/server/data/policy.ts lleva su lista blanca aparte.
CREATE FUNCTION public.search_kb_chunks(p_ticker text, p_query text DEFAULT NULL::text, p_per_section integer DEFAULT 3) RETURNS TABLE(ticker text, form text, section text, chunk_idx integer, text text, filed_date date, fiscal_year integer, rank real)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  WITH q AS (
    SELECT CASE
             WHEN p_query IS NULL OR btrim(p_query) = '' THEN NULL
             ELSE websearch_to_tsquery('english', p_query)
           END AS tsq_and
  ),
  q2 AS (
    SELECT
      tsq_and,
      CASE
        WHEN tsq_and IS NULL THEN NULL
        ELSE replace(tsq_and::text, ' & ', ' | ')::tsquery
      END AS tsq_or
    FROM q
  ),
  eff AS (
    SELECT CASE
             WHEN tsq_and IS NULL THEN NULL
             WHEN EXISTS (
               SELECT 1 FROM kb_chunks c
                WHERE c.ticker = upper(p_ticker) AND c.tsv @@ tsq_and
             ) THEN tsq_and
             ELSE tsq_or
           END AS tsq
    FROM q2
  ),
  scored AS (
    SELECT c.ticker, c.form, c.section, c.chunk_idx, c.text, c.filed_date, c.fiscal_year,
           CASE WHEN e.tsq IS NULL THEN 0::real ELSE ts_rank(c.tsv, e.tsq) END AS rank,
           ROW_NUMBER() OVER (
             PARTITION BY c.section
             ORDER BY CASE WHEN e.tsq IS NULL THEN 0::real ELSE ts_rank(c.tsv, e.tsq) END DESC,
                      c.chunk_idx ASC
           ) AS rn
      FROM kb_chunks c CROSS JOIN eff e
     WHERE c.ticker = upper(p_ticker)
       AND (e.tsq IS NULL OR c.tsv @@ e.tsq)
  )
  SELECT ticker, form, section, chunk_idx, text, filed_date, fiscal_year, rank
    FROM scored
   WHERE rn <= GREATEST(p_per_section, 1)
   ORDER BY CASE section WHEN 'Risk Factors' THEN 0 WHEN 'MD&A' THEN 1 ELSE 2 END,
            rank DESC, chunk_idx ASC;
$$;
