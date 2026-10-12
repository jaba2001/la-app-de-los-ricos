// Frases que generan los módulos de lib/ (lecturas, avisos, explicaciones). Se traducen ya
// montadas al pintarlas; los trozos variables que son frases conocidas se traducen solos
// (ver la recursión de lib/i18n/traducir.ts).
export const LIB: Record<string, string> = {
  // ── lib/regimeLoop.ts — el bucle macro ↔ amplitud ──
  "No breadth read": "Sin lectura de amplitud",
  "Breadth data not available yet — the aggregator populates it each weekday.": "Aún no hay datos de amplitud: el proceso los rellena cada día laborable.",
  "Divergence — participation narrowing": "Divergencia — la participación se estrecha",
  "The macro read (risk-on {a}) is running ahead of breadth ({b}% of names above their 200-day). Rallies on shrinking participation are fragile — treat the risk-on tilt with less conviction.":
    "La lectura macro (apetito por riesgo {a}) va por delante de la amplitud ({b}% de los valores por encima de su media de 200 días). Las subidas con cada vez menos participación son frágiles: toma la inclinación hacia el riesgo con menos convicción.",
  "Divergence — participation broadening": "Divergencia — la participación se amplía",
  "Breadth ({a}% above 200-day) is stronger than the cautious macro read (risk-on {b}). Broadening participation ahead of the macro gauge is constructive.":
    "La amplitud ({a}% por encima de la media de 200 días) es más fuerte que la prudente lectura macro (apetito por riesgo {b}). Que la participación se amplíe antes que el indicador macro es buena señal.",
  "Confirmed · risk-on": "Confirmado · apetito por riesgo",
  "Confirmed · risk-off": "Confirmado · aversión al riesgo",
  "Confirmed · neutral": "Confirmado · neutral",
  "Top-down (risk-on {a}) and bottom-up breadth ({b}%) agree{c}.": "La lectura de arriba abajo (apetito por riesgo {a}) y la amplitud de abajo arriba ({b}%) coinciden{c}.",
  "— broad risk-on, high conviction": "— apetito por riesgo amplio, convicción alta",
  "— broad risk-off, defensive with conviction": "— aversión al riesgo amplia, defensivo con convicción",
  "Early warning — participation is narrowing": "Aviso temprano — la participación se estrecha",

  // ── lib/tipos.ts — curva, crédito y rentabilidad real ──
  "Measured over {a} months since {b}: with the real yield falling, gold returns {c}%/month; rising, {d}%. But that is CONTEMPORANEOUS: it measures the same month. Looking at the following month the correlation drops from {e} to {f}. It explains what happened; it doesn't anticipate what comes next.":
    "Medido en {a} meses desde {b}: cuando la rentabilidad real baja, el oro rinde {c}%/mes; cuando sube, {d}%. Pero eso es SIMULTÁNEO: mide el mismo mes. Mirando el mes siguiente, la correlación cae de {e} a {f}. Explica lo que pasó; no anticipa lo que viene.",
  "The real yield has fallen {a} points. {b}": "La rentabilidad real ha bajado {a} puntos. {b}",
  "The real yield has risen {a} points. {b}": "La rentabilidad real ha subido {a} puntos. {b}",
  "The credit spread is not widening beyond the declared cutoff.": "El diferencial de crédito no se está ampliando por encima del umbral declarado.",
  "The spread is widening. Measured context: of {a} warnings like this one since {b}, {c} were followed by a year of more than +20%. The average subsequent drop ({d}%) is not statistically distinguishable from that of any month ({e}%, p = {f}). It is context, not a signal.":
    "El diferencial se está ampliando. Contexto medido: de {a} avisos como este desde {b}, a {c} les siguió un año de más del +20 %. La caída media posterior ({d}%) no se distingue estadísticamente de la de un mes cualquiera ({e}%, p = {f}). Es contexto, no una señal.",
  "The 10-year Treasury pays {a}% with no default risk: any risky asset has to beat that to be worth it.": "El Tesoro a 10 años paga un {a}% sin riesgo de impago: cualquier activo con riesgo tiene que batir eso para merecer la pena.",
  "{a} Net of expected inflation, the real bar is {b}%.": "{a} Descontando la inflación esperada, el listón real es del {b}%.",
  "no value": "sin valor",
  "sample too small: {a} obs, {b} needed": "muestra demasiado pequeña: {a} obs., hacen falta {b}",
  "lending for longer pays more, which is what you would expect.": "prestar a más plazo paga más, que es lo que cabría esperar.",

  // ── lib/frictions.ts — coste de arbitraje y estrés del capital ──
  "Idiosyncratic volatility": "Volatilidad idiosincrática",
  "Short interest (% float)": "Posiciones cortas (% del flotante)",
  "Days to cover": "Días para cubrir",
  "Illiquidity (Amihud)": "Iliquidez (Amihud)",
  "Size (market cap)": "Tamaño (capitalización)",
  "Low friction: a professional can easily correct a mispricing here, so a large one is unlikely to persist.": "Fricción baja: un profesional puede corregir fácilmente un error de precio aquí, así que es difícil que uno grande dure.",
  "Medium friction: convergence is possible but not immediate.": "Fricción media: la convergencia es posible, pero no inmediata.",
  "High friction: expensive and risky to arbitrage. A discount can persist for a long time — or never close.": "Fricción alta: arbitrarlo es caro y arriesgado. Un descuento puede durar mucho tiempo, o no cerrarse nunca.",
  "Dominant component: {a}.": "Componente dominante: {a}.",
  "Computed on {a} of 5 components — missing ones neither penalize nor reward.": "Calculado con {a} de 5 componentes: los que faltan ni penalizan ni premian.",
  "High idiosyncratic vol is the holding cost Pontiff (2006) identifies as the biggest brake on arbitrage: CAPM calls it diversifiable and free, but for whoever holds the position it isn't.":
    "Una volatilidad idiosincrática alta es el coste de mantener que Pontiff (2006) señala como el mayor freno al arbitraje: el CAPM la llama diversificable y gratuita, pero para quien mantiene la posición no lo es.",
  "Spread HY (OAS)": "Diferencial high yield (OAS)",
  "NFCI (Chicago)": "NFCI (Chicago)",
  "STLFSI4 (St. Louis)": "STLFSI4 (San Luis)",
  "MOVE (bond vol)": "MOVE (volatilidad de bonos)",
  "Arbitrage capital under heavy pressure (led by: {a}). Shleifer & Vishny: here spreads widen before they close, and those managing other people's money are forced to liquidate. Distrust reversal signals.":
    "El capital de arbitraje está muy presionado (lo empuja: {a}). Shleifer y Vishny: aquí los diferenciales se amplían antes de cerrarse, y quien gestiona dinero ajeno se ve obligado a liquidar. Desconfía de las señales de giro.",
  "Arbitrage capital is strained (led by: {a}). Price corrections take longer than usual.": "El capital de arbitraje está tenso (lo empuja: {a}). Las correcciones de precio tardan más de lo habitual.",
  "Arbitrage capital in normal conditions.": "Capital de arbitraje en condiciones normales.",
  "Abundant arbitrage capital: mispricings tend to correct quickly.": "Capital de arbitraje abundante: los errores de precio tienden a corregirse rápido.",
  "You have no redemptions": "No tienes reembolsos",
  "The Shleifer & Vishny arbitrageur liquidates because investors pull capital when the position goes against him. Nobody pulls yours: you can sit through the widening that forces him out.":
    "El arbitrajista de Shleifer y Vishny liquida porque sus inversores retiran el capital cuando la posición va en su contra. Nadie retira el tuyo: puedes aguantar la ampliación que a él le obliga a salir.",
  "You have no career risk": "No arriesgas tu carrera",
  "A manager who deviates from the index and loses for 18 months is out of a job, even if eventually proven right. You can't be fired from your own portfolio.":
    "Un gestor que se aparta del índice y pierde durante 18 meses se queda sin trabajo, aunque al final tenga razón. A ti no te pueden despedir de tu propia cartera.",
  "You have no tracking-error mandate": "No tienes un límite de desviación",
  "Institutional funds have limits on how far they can deviate from their index. You can hold 0% of an entire sector for years without anyone forcing you to buy it.":
    "Los fondos institucionales tienen límites a cuánto pueden apartarse de su índice. Tú puedes tener un 0 % de un sector entero durante años sin que nadie te obligue a comprarlo.",
  "Your horizon has no quarters": "Tu horizonte no tiene trimestres",
  "You don't report results to anyone in March. The premia that demand patience (illiquidity, value, slow convergence) are precisely the ones professional capital can't harvest.":
    "No le rindes cuentas a nadie en marzo. Las primas que exigen paciencia (iliquidez, valor, convergencia lenta) son justo las que el capital profesional no puede recoger.",
  "What does NOT give you an edge": "Lo que NO te da ventaja",
  "None of the above is information. You don't know more than the market about a company, and that is exactly the part Scora measures and finds at ~0. Your edge is structural, not informational — confusing the two is the expensive mistake.":
    "Nada de lo anterior es información. No sabes más que el mercado sobre una empresa, y esa es justo la parte que Scora mide y encuentra en ~0. Tu ventaja es estructural, no informativa: confundir las dos es el error caro.",
  "Low": "Baja",
  "Medium": "Media",
  "Calm": "Calma",
  "Normal": "Normal",
  "Strained": "Tensión",
  "Crisis": "Crisis",

  // ── lib/secular.ts — reloj secular ──
  "No secular valuation reading available.": "No hay lectura de valoración secular disponible.",
  "Forward 10y return priced near {a}%.": "Rentabilidad esperada a 10 años en torno al {a}%.",
  "Valuations are stretched ({a}{b}).{c} High valuations compress forward returns — keep the secular equity baseline defensive and lean on tactical allocation + momentum.":
    "Las valoraciones están tensas ({a}{b}).{c} Las valoraciones altas comprimen la rentabilidad futura: mantén defensiva la base secular en renta variable y apóyate en la asignación táctica y el momentum.",
  "Valuations are reasonable ({a}{b}).{c} A higher secular equity baseline is warranted.": "Las valoraciones son razonables ({a}{b}).{c} Está justificada una base secular en renta variable más alta.",
  "Valuations are above average ({a}{b}).{c} A moderate secular baseline.": "Las valoraciones están por encima de la media ({a}{b}).{c} Una base secular moderada.",
  "Valuations are extreme (CAPE {a}), consistent with a late/mature boom — which historically means compressed forward returns, not an imminent crash.":
    "Las valoraciones son extremas (CAPE {a}), propias de un auge tardío o maduro, lo que históricamente significa rentabilidades futuras comprimidas, no un desplome inminente.",
  "Valuations are cheap (CAPE {a}), the reset that typically ends a consolidation and seeds the next boom.": "Las valoraciones son baratas (CAPE {a}), el reinicio que suele cerrar una consolidación y sembrar el siguiente auge.",
  "Valuations are middling (CAPE {a}).": "Las valoraciones están en la zona media (CAPE {a}).",
  "We anchor the current secular bull at {a} (the GFC low), so ~{b} years elapsed vs a ~{c}-year historical average — a {d}-stage boom.{e} This is narrative from only ~3 modern cycles, not a countdown.":
    "Situamos el inicio del mercado alcista secular actual en {a} (el mínimo de la crisis financiera), así que han pasado ~{b} años frente a una media histórica de ~{c}: un auge en fase {d}.{e} Es un relato basado en solo ~3 ciclos modernos, no una cuenta atrás.",
  "late": "tardía",
  "mid": "media",
  "early": "temprana",
  "bull": "alcista",
  "bear": "bajista",

  // ── lib/allocation.ts — asignador ──
  "US Equities": "Acciones de EE. UU.",
  "Long Treasuries": "Bonos del Tesoro largos",
  "7–10y Treasuries": "Bonos del Tesoro 7–10 años",
  "Gold": "Oro",
  "Commodities": "Materias primas",
  "T-Bills (cash)": "Letras (liquidez)",
  "Bitcoin": "Bitcoin",
  "Real asset": "Activo real",
  "Duration": "Duración",
  "Cash": "Liquidez",
  "Digital": "Digital",
  "Liquidity-led risk gauge at {a}/100 → {b}: Growth mandate holds {c} (floor at 50).": "Indicador de riesgo guiado por la liquidez en {a}/100 → {b}: el mandato Growth mantiene {c} (suelo en 50).",
  "100% equities": "un 100 % en renta variable",
  "a 60% equity floor + defensive ballast": "un suelo del 60 % en renta variable + lastre defensivo",
  "Liquidity-led risk gauge at {a}/100 → {b}: blend {c}% risk-on basket / {d}% defensive basket.": "Indicador de riesgo guiado por la liquidez en {a}/100 → {b}: mezcla {c}% cesta de riesgo / {d}% cesta defensiva.",
  "Absolute momentum negative for {a} → those sleeves moved to cash (T-bills).": "Momentum absoluto negativo en {a} → esas partes pasan a liquidez (letras).",
  "All risk sleeves have positive 12-1m momentum → none gated to cash.": "Todas las partes de riesgo tienen momentum 12-1m positivo → ninguna pasa a liquidez.",
  "Momentum data unavailable — showing the risk-on tilt without the trend gate.": "Datos de momentum no disponibles: se enseña la inclinación hacia el riesgo sin el filtro de tendencia.",
  "Inverse-vol (risk-parity) sizing applied — sleeves weighted by 1/volatility (validated: −7.5% max drawdown vs −10.1%).":
    "Pesos por volatilidad inversa (paridad de riesgo) aplicados: cada parte pesa 1/volatilidad (validado: caída máxima del −7,5 % frente al −10,1 %).",
  "Small {a}% Bitcoin sleeve (risk-on + BTC uptrend) carved from equities — a diversifier per CAIA/Grayscale, never leverage. Crypto's past magnitude won't repeat.":
    "Una pequeña parte del {a}% en Bitcoin (apetito por riesgo + tendencia alcista del BTC) sacada de la renta variable: un diversificador según CAIA/Grayscale, nunca apalancamiento. La magnitud pasada de las criptomonedas no se repetirá.",

  // ── lib/microScore.ts — régimen de selección ──
  "No correlation reading — showing momentum ungated.": "Sin lectura de correlación: se enseña el momentum sin filtrar.",
  "Favors selection": "Favorece la selección",
  "favors selection": "favorece la selección",
  "Low correlation — dispersion is high, and this is historically where selection has carried more signal. Selection weight {a}%.":
    "Correlación baja: la dispersión es alta, y es históricamente donde la selección ha aportado más señal. Peso de la selección {a}%.",
  "Middling correlation — the selection edge is muted, so exposure is scaled back rather than switched off. Selection weight {a}%.":
    "Correlación media: la ventaja de la selección se atenúa, así que la exposición se reduce en lugar de apagarse. Peso de la selección {a}%.",
  "Macro tape": "Mercado macro",
  "macro tape": "mercado macro",
  "High correlation — names move as one and momentum crashes here. Selection weight {a}%; lean on allocation.":
    "Correlación alta: los valores se mueven como uno solo y aquí el momentum se hunde. Peso de la selección {a}%; apóyate en la asignación.",
  "Mixed": "Mixto",
  "mixed": "mixto",

  // ── lib/marketMomentum.ts — página Momentum ──
  "Above 200-day": "Por encima de la media de 200 días",
  "Share of the universe in a long-term uptrend": "Parte del universo en tendencia alcista de largo plazo",
  "Above 50-day": "Por encima de la media de 50 días",
  "Short-term participation": "Participación a corto plazo",
  "How broad the momentum is": "Lo amplio que es el momentum",
  "Up last month": "Al alza el último mes",
  "Near-term thrust": "Empuje a corto plazo",
  "Risk appetite": "Apetito por riesgo",
  "Liquidity-led backdrop gauge": "Indicador del contexto guiado por la liquidez",
  "Low correlation means names move on their own merits": "Correlación baja significa que cada valor se mueve por sus propios méritos",
  "Credit": "Crédito",
  "High-yield spread — the market's own risk thermometer": "Diferencial high yield: el termómetro de riesgo del propio mercado",
  "Index trend": "Tendencia del índice",
  "Where the index sits versus its 200-day average": "Dónde está el índice respecto a su media de 200 días",
  "Narrowing": "Estrechándose",
  "The index is holding up while participation thins out — fewer names are doing the work. Historically an early warning, not a sell signal.":
    "El índice aguanta mientras la participación se reduce: cada vez menos valores hacen el trabajo. Históricamente es un aviso temprano, no una señal de venta.",
  "Broad strength": "Fortaleza amplia",
  "Participation, credit and risk appetite are all constructive at once. Rare, and it does not tell you what happens next.":
    "Participación, crédito y apetito por riesgo son favorables a la vez. Es raro, y no dice qué pasará después.",
  "Healthy": "Sano",
  "Most of the market is in an uptrend with credit behaving.": "La mayor parte del mercado está en tendencia alcista y el crédito se porta bien.",
  "No clear read: some parts of the market are working and others are not.": "Sin lectura clara: unas partes del mercado funcionan y otras no.",
  "Weak": "Débil",
  "Weak participation with credit and risk appetite deteriorating. This is where selection historically pays least.":
    "Participación débil, con el crédito y el apetito por riesgo empeorando. Es donde históricamente la selección paga menos.",
  "Not enough market data to read the backdrop.": "No hay datos de mercado suficientes para leer el contexto.",
  "{a} — market breadth score {b}/100 across {c} signals.": "{a} — puntuación de amplitud del mercado {b}/100 con {c} señales.",

  // ── lib/exposure.ts — exposición y concentración ──
  "Software / SaaS": "Software / SaaS",
  "Energy / Oil & Gas": "Energía / petróleo y gas",
  "Gold / Metals": "Oro / metales",
  "Crypto / Blockchain": "Cripto / blockchain",
  "Healthcare / Biotech": "Salud / biotecnología",
  "Industrials / Rail": "Industria / ferrocarril",
  "Only {a} position — a single name can swing the book. {c}+ smooths it out.": "Solo {a} posición: un solo valor puede mover toda la cartera. Con {c} o más se suaviza.",
  "Only {a} positions — a single name can swing the book. {c}+ smooths it out.": "Solo {a} posiciones: un solo valor puede mover toda la cartera. Con {c} o más se suaviza.",
  "{a} is {b}% of the book (> {c}% guide). If it falls 20%, the portfolio takes {d}%.": "{a} es el {b}% de la cartera (> {c}% recomendado). Si cae un 20 %, la cartera pierde un {d}%.",
  "{a} is {b}% of the book (> {c}% guide) — concentrated in one sector.": "{a} es el {b}% de la cartera (> {c}% recomendado): concentrada en un sector.",
  "{a}% sits in the {b} theme — diversify across uncorrelated drivers.": "El {a}% está en el tema {b}: diversifica entre motores no correlacionados.",
  "⚠ {x}": "⚠ {x}",

  // ── Sectores (FMP/GICS) ──
  "Technology": "Tecnología",
  "Healthcare": "Salud",
  "Financial Services": "Servicios financieros",
  "Consumer Cyclical": "Consumo cíclico",
  "Consumer Defensive": "Consumo defensivo",
  "Industrials": "Industria",
  "Energy": "Energía",
  "Utilities": "Servicios públicos",
  "Real Estate": "Inmobiliario",
  "Basic Materials": "Materiales básicos",
  "Communication Services": "Comunicaciones",

  // ── lib/dailyClose.ts — tipo de día ──
  "One-factor day": "Día de un solo factor",
  "Broad move": "Movimiento amplio",
  "Sectors moved together — stock selection had little to work with.": "Los sectores se movieron juntos: la selección de acciones tuvo poco con lo que trabajar.",
  "Rotation": "Rotación",
  "Money moved between sectors rather than in or out of the market.": "El dinero se movió entre sectores más que entrar o salir del mercado.",
  "Most sectors on the same side, with real spread between them.": "La mayoría de sectores del mismo lado, con diferencias reales entre ellos.",
  "Mixed tape": "Mercado mixto",
  "No clean read — the tape disagreed with itself.": "Sin lectura limpia: el mercado se contradijo.",
  "{a} · {b}/{c} sectors up": "{a} · {b}/{c} sectores al alza",
  "Measured market close.": "Cierre de mercado medido.",

  // ── lib/trackRecord.ts — datos del historial ──
  "Jan 2007 – Aug 2026": "Ene 2007 – ago 2026",
  "Jan 2007 – Jun 2026": "Ene 2007 – jun 2026",
  "Jan 2020 – Jun 2026": "Ene 2020 – jun 2026",
  "Growth — 60% equity floor + trend gate + 5% BTC sleeve": "Growth — suelo del 60 % en renta variable + filtro de tendencia + 5 % en BTC",
  "S&P 500 (SPY) buy & hold": "S&P 500 (SPY) comprar y mantener",
  "Static 60/40 (context)": "60/40 fijo (contexto)",
  "Growth without the BTC sleeve": "Growth sin la parte de BTC",
  "Growth mandate": "Mandato Growth",
  "The allocator's drawdown is stable across 8 windows; the index's is not. The one-third ratio depends on including 2008.":
    "La caída del asignador es estable en 8 periodos; la del índice no. El ratio de un tercio depende de incluir 2008.",
  "Capacity at 10% of daily volume, limited by IEF. BIL is excluded because at scale you hold bills, not the ETF. Only applies if there is an investment vehicle: Scora is software.":
    "Capacidad al 10 % del volumen diario, limitada por IEF. BIL se excluye porque, a escala, se tienen letras y no el ETF. Solo aplica si hay un vehículo de inversión: Scora es software.",
  "The Sharpe advantage isn't significant over 236 months. Drawdown and capture ratios are observed facts, not estimates.":
    "La ventaja en Sharpe no es significativa en 236 meses. La caída y los ratios de captura son hechos observados, no estimaciones.",
  "+204% · Sharpe 0.87 · −16% DD": "+204 % · Sharpe 0,87 · caída −16 %",
  "+148% · Sharpe 0.89 · −16% DD": "+148 % · Sharpe 0,89 · caída −16 %",
  "Measured and rejected — none beats SPY on total return with lower drawdown, and we never use leverage: regime-conditional leverage (SSO 1.3-1.5×), CPPI, short-hedge overlays (SH), long-vol (VXX), monthly vol-targeting (beat_index_lab.json). Options collars / protective puts too (options_collar_lab.json, BS-priced via VIX): they barely move the -17% drawdown (-17% to -18.4%) while slashing return (+506%→+256-402%) and every risk-adjusted metric — because the regime switch already provides the drawdown protection an options hedge would, upstream and for free, so the premium is pure drag.":
    "Medidas y descartadas: ninguna bate al SPY en rentabilidad total con menos caída, y nunca usamos apalancamiento: apalancamiento según el régimen (SSO 1,3-1,5×), CPPI, coberturas con cortos (SH), volatilidad larga (VXX), objetivo de volatilidad mensual (beat_index_lab.json). Tampoco los collars con opciones ni las puts de protección (options_collar_lab.json, valoradas con Black-Scholes y el VIX): apenas mueven la caída del −17 % (de −17 % a −18,4 %) y recortan la rentabilidad (+506 %→+256-402 %) y todas las métricas ajustadas por riesgo, porque el cambio de régimen ya da la protección frente a caídas que daría una cobertura con opciones, antes y gratis, así que la prima es puro lastre.",
  "Risk-on tilt + dual-momentum + risk-parity": "Inclinación al riesgo + momentum dual + paridad de riesgo",
  "Risk-on tilt + dual-momentum (no risk-parity)": "Inclinación al riesgo + momentum dual (sin paridad de riesgo)",
  "Dual-momentum only (no regime)": "Solo momentum dual (sin régimen)",
  "SPY buy & hold": "SPY comprar y mantener",
  "pre-2020 (out-of-sample)": "antes de 2020 (fuera de muestra)",
  "Regime-independent control (dual-momentum only) beaten in BOTH sub-periods → the liquidity-led risk-on tilt adds value, not just the trend gate.":
    "El control sin régimen (solo momentum dual) queda batido en LOS DOS subperiodos → la inclinación al riesgo guiada por la liquidez aporta valor, no solo el filtro de tendencia.",
  "Gives up raw return vs a two-decade equity bull (SPY +602%) — this is a risk-managed sleeve: match equity-like results with a fifth of the drawdown and a much higher Sharpe, not beat the index outright.":
    "Renuncia a rentabilidad bruta frente a dos décadas de mercado alcista (SPY +602 %): es una parte con el riesgo controlado; busca resultados de renta variable con una quinta parte de la caída y un Sharpe mucho más alto, no batir al índice sin más.",
  "Composites are stationarized to percentiles (not absolute levels) so the regime is valid across cycles including the GFC.":
    "Los compuestos se convierten en percentiles (no niveles absolutos) para que el régimen sirva en todos los ciclos, la crisis de 2008 incluida.",
  "S&P 500 · point-in-time · survivorship-controlled (delisted incl.)": "S&P 500 · point-in-time · sin sesgo de supervivencia (incluye los que dejaron de cotizar)",
  "Survivorship-controlled: point-in-time S&P 500 membership including delisted names (via Tiingo) — the honest test, not curated survivors.":
    "Sin sesgo de supervivencia: la composición point-in-time del S&P 500, incluidos los valores que dejaron de cotizar (vía Tiingo); la prueba honesta, no supervivientes escogidos.",
  "The micro score alone does NOT beat SPY here (+112% vs +154%); the win comes from the macro↔micro overlay (+157.5%, Sharpe 0.98, half the drawdown). Scora's edge IS the macro regime lens.":
    "La puntuación de empresa por sí sola NO bate al SPY aquí (+112 % frente a +154 %); la ganancia viene de combinar macro y empresa (+157,5 %, Sharpe 0,98, la mitad de la caída). La ventaja de Scora ES la lente del régimen macro.",
  "Raw fine-grained ranking is weak (IC ~0.015, decile spread negative) — the value is in regime-timing and risk, not stock-by-stock ranking.":
    "La clasificación fina en bruto es débil (IC ~0,015, diferencia entre deciles negativa): el valor está en el momento del régimen y el riesgo, no en ordenar acción por acción.",
  "Sector benchmarks held constant; thresholds hand-tuned → the live forward record is the un-backtested proof.":
    "Referencias sectoriales fijas y umbrales ajustados a mano → el historial en vivo es la prueba sin backtest.",
  "Definitive 500-name run (34,405 name-months): value/quality micro +127.6% vs SPY +154.2% (IC 0.007) — confirms stock-picking on value/quality does NOT beat the market on the full survivorship-free universe. The validated edge is the multi-asset allocator (Sharpe 1.01 OOS 2007-2026) and momentum gated by correlation (IC +0.064 in low correlation, −0.05 in high).":
    "Ejecución definitiva con 500 valores (34.405 valores-mes): valor/calidad +127,6 % frente a SPY +154,2 % (IC 0,007). Confirma que elegir acciones por valor/calidad NO bate al mercado en el universo completo sin sesgo de supervivencia. La ventaja validada es el asignador multiactivo (Sharpe 1,01 fuera de muestra 2007-2026) y el momentum filtrado por correlación (IC +0,064 con correlación baja, −0,05 con alta).",

  // ── lib/timeframes.ts — lecturas por horizonte ──
  "Risk-on {a}/100 backdrop": "Contexto de apetito por riesgo {a}/100",
  "Risk-on favors {a} (growth sector)": "El apetito por riesgo favorece a {a} (sector de crecimiento)",
  "Risk-on lifts {a} (cyclical)": "El apetito por riesgo empuja a {a} (cíclico)",
  "{a} lags in a risk-on tape": "{a} se queda atrás con apetito por riesgo",
  "{a} is defensive in risk-off": "{a} es defensivo con aversión al riesgo",
  "{a} (growth) headwind in risk-off": "{a} (crecimiento) tiene viento en contra con aversión al riesgo",
  "{a} (cyclical) soft in risk-off": "{a} (cíclico) flojo con aversión al riesgo",
  "{a}-leaning name {b} macro {c} in {d} (measured factor rotation)": "valor con sesgo {a}: {b} macro {c} en {d} (rotación de factores medida)",
  "Macro tailwind": "Viento a favor macro",
  "Neutral backdrop": "Contexto neutral",
  "Macro headwind": "Viento en contra macro",
  "Leads": "Lidera",
  "Lags": "Va por detrás de",
  "leads": "lidera",
  "lags": "va por detrás de",
  "{a} its sector ({b}{c}pp)": "{a} su sector ({b}{c} pp)",
  "{a} the S&P ({b}{c}pp)": "{a} el S&P ({b}{c} pp)",
  "Strong uptrend · leader": "Tendencia alcista fuerte · líder",
  "Neutral trend": "Tendencia neutral",
  "Downtrend · laggard": "Tendencia bajista · rezagado",
  "RSI {a} — oversold, good entry": "RSI {a} — sobreventa, buena entrada",
  "RSI {a} — pulled back": "RSI {a} — ha retrocedido",
  "RSI {a} — overbought, you're chasing": "RSI {a} — sobrecompra, vas detrás del precio",
  "RSI {a} — extended": "RSI {a} — estirado",
  "RSI {a} — neutral": "RSI {a} — neutral",
  "{a}% above the 200-day — stretched": "{a}% por encima de la media de 200 días — estirado",
  "Below the 200-day — potential value entry (confirm the trend)": "Por debajo de la media de 200 días — posible entrada de valor (confirma la tendencia)",
  "Good entry": "Buena entrada",
  "Fair entry": "Entrada razonable",
  "Chasing · wait for a pullback": "Vas detrás del precio · espera un retroceso",
  "Structural buy — macro tailwind, real uptrend, and not overbought.": "Compra estructural: viento a favor macro, tendencia alcista real y sin sobrecompra.",
  "Leader, but extended — the macro and trend agree; wait for a pullback to enter.": "Líder, pero estirado: la macro y la tendencia coinciden; espera un retroceso para entrar.",
  "Bounce against the macro — the backdrop is a headwind; treat strength as temporary.": "Rebote contra la macro: el contexto va en contra; toma la fortaleza como temporal.",
  "Improving setup — macro tailwind and an oversold entry, but the trend hasn't turned yet.": "Mejorando: viento a favor macro y entrada en sobreventa, pero la tendencia aún no ha girado.",
  "Avoid — macro headwind and a downtrend; no confluence.": "Evitar: viento en contra macro y tendencia bajista; sin confluencia.",
  "Mixed — the timeframes disagree; lower conviction.": "Mixto: los horizontes no coinciden; menos convicción.",
  "Days": "Días",
  "Months": "Meses",
  "Years": "Años",

  // ── lib/rating.ts — nota y convicción ──
  "Strong Buy": "Compra fuerte",
  "Buy": "Compra",
  "Sell": "Venta",
  "Strong Sell": "Venta fuerte",
  "Avoid": "Evitar",
  "High conviction": "Convicción alta",
  "Medium conviction": "Convicción media",
  "Low conviction": "Convicción baja",
  "High": "Alta",
  "Near the median — the call is a lean, not a conviction bet.": "Cerca de la mediana: la dirección es una inclinación, no una apuesta con convicción.",
  "High correlation regime — names move together and selection signal is weak here; conviction capped.": "Régimen de correlación alta: los valores se mueven juntos y la señal de selección es débil; convicción limitada.",
  "Timeframes disagree — the read is mixed, so conviction is trimmed.": "Los horizontes no coinciden: la lectura es mixta, así que se recorta la convicción.",
  "Low correlation — dispersion is high and selection has measured IC; conviction earned.": "Correlación baja: la dispersión es alta y la selección tiene IC medido; convicción merecida.",
  "Trend and macro reads set the direction; conviction scaled to their agreement.": "La tendencia y la macro marcan la dirección; la convicción depende de cuánto coincidan.",
  "{a} conviction · {b}%": "Convicción {a} · {b}%",

  // ── lib/verdict.ts — veredicto ──
  "A close back below the 200-day average, or the macro regime turning, breaks this.": "Un cierre de nuevo por debajo de la media de 200 días, o que gire el régimen macro, lo rompe.",
  "Losing the weekly uptrend would invalidate it; until then the risk is entry price, not thesis.": "Perder la tendencia alcista semanal lo invalidaría; hasta entonces el riesgo es el precio de entrada, no la tesis.",
  "The macro regime turning supportive would upgrade this from a bounce to a trend.": "Que el régimen macro se vuelva favorable convertiría esto de un rebote en una tendencia.",
  "The weekly trend actually turning up is the confirmation this is still missing.": "Que la tendencia semanal gire de verdad al alza es la confirmación que aún falta.",
  "It needs both a macro turn and a trend turn — either one alone is not enough.": "Necesita un giro macro y un giro de tendencia: uno solo no basta.",
  "The timeframes aligning — in either direction — is what would make this decisive.": "Que los horizontes se alineen —en cualquier dirección— es lo que lo haría decisivo.",
  "{a} On a {b} horizon the Scora score ({c}/100) weighs more, and it pulls the call to {d}.": "{a} Con un horizonte de {b}, la puntuación de Scora ({c}/100) pesa más y lleva la dirección a {d}.",
};
