// La sección Macro: la página y sus pestañas (components/macro/*).
export const MACRO: Record<string, string> = {
  // ── Página (app/macro) ──
  "Refresh macro data": "Actualizar los datos macro",
  "↻ Refresh": "↻ Actualizar",
  "Macro Dashboard": "Panel macro",
  "Composite scores, FRED indicators, market data and AI synthesis. Click below to fetch the latest snapshot.":
    "Puntuaciones compuestas, indicadores de FRED, datos de mercado y síntesis de la IA. Pulsa abajo para cargar la última foto.",
  "Loading…": "Cargando…",
  "Load Macro Data": "Cargar datos macro",
  "Fetching the latest macro snapshot…": "Cargando la última foto macro…",
  "No data — load macro first.": "Sin datos: carga primero la macro.",
  "Filter field…": "Filtrar campo…",
  "Field": "Campo",
  "Value": "Valor",
  "Snapshot: {x}": "Foto: {x}",
  "{a} populated · {b} empty": "{a} con valor · {b} vacíos",
  "Cron: {x}": "Proceso automático: {x}",
  "{x} fields pending (empty in macro_state)": "{x} campos pendientes (vacíos en macro_state)",

  // ── Asignador All-Weather ──
  "All-Weather Allocator": "Asignador All-Weather",
  "Growth mandate: 100% equities when the liquidity-led gauge is risk-on, the defensive basket when it isn't, with a 12-1m trend gate. The return engine.":
    "Mandato Growth: 100 % renta variable cuando el indicador guiado por la liquidez marca apetito por riesgo, la cesta defensiva cuando no, con un filtro de tendencia 12-1m. El motor de rentabilidad.",
  "Defensive mandate: continuous risk-on blend across six ETFs, trend gate and inverse-vol (risk-parity) sizing. The lowest-drawdown engine.":
    "Mandato Defensivo: mezcla continua según el apetito por riesgo entre seis ETFs, filtro de tendencia y pesos por volatilidad inversa (paridad de riesgo). El motor de menor caída.",
  "Risk-on gauge": "Indicador de apetito por riesgo",
  "Moved to cash by the momentum gate": "Pasado a liquidez por el filtro de momentum",
  "→ cash": "→ liquidez",
  "Computing 12-1m momentum trend gate…": "Calculando el filtro de tendencia de momentum 12-1m…",
  "Out-of-sample, net of costs. Growth beats the S&P 500 on every risk-adjusted metric in both sub-periods (never on raw return — no leverage, ever; the index returned more at ~3× the drawdown). Educational — not investment advice; ETF examples, not recommendations.":
    "Fuera de muestra, descontando costes. Growth supera al S&P 500 en todas las métricas ajustadas por riesgo en los dos subperiodos (nunca en rentabilidad bruta: sin apalancamiento, nunca; el índice rindió más con ~3 veces la caída). Educativo, no asesoramiento de inversión; los ETFs son ejemplos, no recomendaciones.",

  // ── Estrés del capital de arbitraje ──
  "Arbitrage capital stress · Shleifer & Vishny (1997)": "Estrés del capital de arbitraje · Shleifer y Vishny (1997)",
  "Real arbitrage is done by a few specialists using <s1>other people’s</s1> money. When a trade moves against them, their investors withdraw capital exactly when the opportunity is best — so arbitrage capital is pro-cyclical and scarcest when it is most needed. This gauge tracks that pressure.":
    "El arbitraje real lo hacen unos pocos especialistas con dinero <s1>ajeno</s1>. Cuando una operación se les pone en contra, sus inversores retiran el capital justo cuando la oportunidad es mejor; así que el capital de arbitraje es procíclico y escasea justo cuando más falta hace. Este indicador sigue esa presión.",
  "Macro data not loaded yet.": "Los datos macro aún no se han cargado.",
  "{x} of 5 inputs available": "{x} de 5 datos disponibles",
  "stress {x}": "estrés {x}",
  "Your structural edge": "Tu ventaja estructural",
  "The same paper, read backwards. Every constraint that forces a professional to liquidate early is one a private investor simply does not have. This is a thesis, not a calculation — it doesn’t pretend to be a number.":
    "El mismo artículo, leído al revés. Cada restricción que obliga a un profesional a liquidar antes de tiempo es una que un inversor particular simplemente no tiene. Es una tesis, no un cálculo: no pretende ser una cifra.",

  // ── Curva de tipos ──
  "FRED didn't return the 10-year yield.": "FRED no devolvió la rentabilidad a 10 años.",
  "Couldn't read the yield curve": "No se pudo leer la curva de tipos",
  "The yield curve · the floor everything else has to beat": "La curva de tipos · el suelo que todo lo demás tiene que batir",
  "A Treasury bond is the closest thing there is to a return with no default risk. If it pays 5%, any risky asset has to beat that 5% to be worth it. That is why, when rates rise, <s1>everything else reprices lower</s1> — the explanation for those days the portfolio falls with no bad news at all.":
    "Un bono del Tesoro es lo más parecido que existe a una rentabilidad sin riesgo de impago. Si paga un 5 %, cualquier activo con riesgo tiene que batir ese 5 % para merecer la pena. Por eso, cuando suben los tipos, <s1>todo lo demás se revaloriza a la baja</s1>: la explicación de esos días en que la cartera cae sin ninguna mala noticia.",
  "Reading FRED…": "Leyendo FRED…",
  "10-year": "10 años",
  "{x} curve": "Curva {x}",
  "Maturity": "Plazo",
  "Yield": "Rentabilidad",
  "What it measures": "Qué mide",
  "Nominal = real + expected inflation": "Nominal = real + inflación esperada",
  "Two periods with the same 4% nominal yield look nothing alike: with expected inflation at 1% it bites much harder than at 3%. The <s1>real yield</s1> comes from TIPS; the breakeven is the difference.":
    "Dos periodos con la misma rentabilidad nominal del 4 % no se parecen en nada: con la inflación esperada al 1 % aprieta mucho más que al 3 %. La <s1>rentabilidad real</s1> sale de los TIPS; la inflación implícita es la diferencia.",
  "Nominal 10y": "Nominal 10 años",
  "Real 10y (TIPS)": "Real 10 años (TIPS)",
  "Breakeven": "Inflación implícita",
  "implied by the two before": "implícita en las dos anteriores",
  "5y, 5y forward": "5 años dentro de 5 años",
  "a different horizon: not averaged in": "otro horizonte: no entra en la media",
  "The credit spread · what the market charges to lend to someone who might default": "El diferencial de crédito · lo que cobra el mercado por prestar a quien podría no pagar",
  "pp": "pp",
  "{a}th percentile of {b} observations since {c}": "percentil {a} de {b} observaciones desde {c}",
  "90 days ago": "hace 90 días",
  "{x} pp": "{x} pp",
  "· delta": "· variación",
  "Declared cutoff: {a} pp in {b} days. It uses BAA10Y (Baa − 10y Treasury) rather than the ICE BofA high-yield series because FRED only serves 786 observations of that one since 2023: it measures the same thing with 41 years instead of three.":
    "Umbral declarado: {a} pp en {b} días. Usa BAA10Y (Baa − Tesoro a 10 años) en vez de la serie high yield de ICE BofA porque FRED solo sirve 786 observaciones de esa desde 2023: mide lo mismo con 41 años en lugar de tres.",
  "The real yield and metals": "La rentabilidad real y los metales",

  // ── Laboratorio de ETFs ──
  "ETF lab · overlap & cost": "Laboratorio de ETFs · solapamiento y coste",
  "Compare two ETFs for expense ratio and top-holdings overlap — two funds that look different can hold the same names. Curated snapshot of the most widely-held funds ({x}).":
    "Compara dos ETFs por comisión y por solapamiento de sus principales posiciones: dos fondos que parecen distintos pueden tener las mismas empresas. Foto seleccionada de los fondos más extendidos ({x}).",
  "vs": "frente a",
  "{x} expense": "comisión {x}",
  "Top-holdings overlap": "Solapamiento de las principales posiciones",
  "Heavily redundant": "Muy redundantes",
  "Partial overlap": "Solapamiento parcial",
  "Largely distinct": "Bastante distintos",
  "No holdings snapshot": "Sin foto de posiciones",
  "Pick two different ETFs to compare.": "Elige dos ETFs distintos para compararlos.",
  "Cheaper of the two: <s1>{a}</s1> at {b}.": "El más barato de los dos: <s1>{a}</s1> con {b}.",
  "Shared top holdings": "Posiciones principales en común",
  "Holding": "Posición",
  "Overlap": "Solapamiento",
  "{x} wt": "peso {x}",
  "Cheaper alternatives to {x}": "Alternativas más baratas a {x}",
  "{a} is already the cheapest in {b}.": "{a} ya es el más barato de {b}.",
  "−{x} bps": "−{x} pb",
  "Overlap is measured on the curated top-10 holdings — directional, not exact. Full-holdings overlap across all listed ETFs is a paid-data upgrade.":
    "El solapamiento se mide sobre las 10 principales posiciones seleccionadas: orientativo, no exacto. El solapamiento completo entre todos los ETFs cotizados requiere datos de pago.",

  // ── Síntesis de la IA ──
  "Email me macro alerts": "Envíame las alertas macro por correo",
  "Daily check — credit blowout, QT acceleration, credit divergence. To {x}": "Revisión diaria: disparada del crédito, aceleración del QT y divergencias de crédito. A {x}",
  "Failed to generate synthesis": "No se pudo generar la síntesis",
  "Save failed: {x}": "No se pudo guardar: {x}",
  "AI Macro Synthesis — OPLA Framework": "Síntesis macro con IA — marco OPLA",
  "Claude Haiku · Druckenmiller Hierarchy · 8-section structured analysis": "Claude Haiku · Jerarquía de Druckenmiller · análisis estructurado en 8 secciones",
  "Exporting…": "Exportando…",
  "⬇ Export HTML": "⬇ Exportar HTML",
  "Saving…": "Guardando…",
  "✓ Saved": "✓ Guardado",
  "↓ Save Brief": "↓ Guardar el resumen",
  "Generating…": "Generando…",
  "Regenerate": "Volver a generar",
  "✦ Generate Analysis": "✦ Generar análisis",
  "8-section OPLA analysis: Regime · Master Signal · Scenarios (Base/Bull/Bear) · Tripwires · Positioning · Dalio Debt Cycle · Historical Analog · 12M Outlook":
    "Análisis OPLA en 8 secciones: Régimen · Señal maestra · Escenarios (base/alcista/bajista) · Disparadores · Posicionamiento · Ciclo de deuda de Dalio · Análogo histórico · Perspectiva a 12 meses",
  "Powered by Druckenmiller Signal Hierarchy + Howell Liquidity Model": "Basado en la jerarquía de señales de Druckenmiller y el modelo de liquidez de Howell",
  "Historical Macro Snapshot": "Foto macro histórica",
  "Historical snapshot data is stored in the macro_state table. IC DataLayer writes snapshots on each refresh cycle.":
    "Las fotos históricas se guardan en la tabla macro_state. IC DataLayer escribe una en cada ciclo de actualización.",
  "Date": "Fecha",
  "IC Score": "Puntuación IC",
  "Regime": "Régimen",
  "Tripwires": "Disparadores",
  "↓ Save to Log": "↓ Guardar en el registro",
  "IC Positioning": "Posicionamiento IC",
  "Signals computed daily by the IC DataLayer engine and stored in macro_state.": "Señales calculadas a diario por el motor IC DataLayer y guardadas en macro_state.",

  // ── Resumen semanal ──
  "Pause the brief": "Pausar el resumen",
  "Play the brief": "Escuchar el resumen",
  "Weekly": "Resumen",
  "macro brief": "macro semanal",
  "Hide transcript": "Ocultar el texto",
  "Read it": "Leerlo",

  // ── Geopolítica ──
  "Geopolitical read": "Lectura geopolítica",
  "Asset tilt:": "Inclinación por activos:",
  "Context layer only — it informs the read, it does not change Scora's validated regime allocator weights.":
    "Solo es contexto: informa la lectura, pero no cambia los pesos del asignador de régimen validado de Scora.",
  "Power blocs — what to watch & the assets they move": "Bloques de poder: qué vigilar y qué activos mueven",
  "Region": "Región",
  "Role": "Papel",
  "What to watch": "Qué vigilar",
  "Assets it moves": "Activos que mueve",
  "Chokepoints & supply concentrations — where a regional shock goes global": "Cuellos de botella y concentraciones de suministro: donde un choque regional se vuelve global",
  "Chokepoint": "Cuello de botella",
  "What flows through": "Qué pasa por ahí",
  "Risk": "Riesgo",
  "Who benefits / is hurt": "A quién beneficia / perjudica",
  "Physical dependencies from the geopolitics knowledge base — narrative context for the read above, not a live signal.":
    "Dependencias físicas de la base de conocimiento geopolítica: contexto narrativo para la lectura de arriba, no una señal en vivo.",
  "{x} risk": "riesgo {x}",

  // ── Análogo histórico ──
  "Macro data unavailable.": "Datos macro no disponibles.",
  "One or more macro composites are null — matching uses 50 as neutral placeholder. Results are directional only.":
    "Falta uno o más compuestos macro: la comparación usa 50 como valor neutro. Los resultados son solo orientativos.",
  "Today's Regime": "El régimen de hoy",
  "IC Health": "Salud IC",
  "Closest historical analogs ranked by weighted distance across Liquidity, Credit, Recession, Geopolitical and Housing composites (same weighting as the IC Health Score).":
    "Los análogos históricos más cercanos, ordenados por distancia ponderada en los compuestos de Liquidez, Crédito, Recesión, Geopolítica y Vivienda (con los mismos pesos que la Puntuación de Salud IC).",
  "similarity": "similitud",
  "Trigger:": "Detonante:",
  "Context:": "Contexto:",
  "What followed:": "Lo que vino después:",
  "SPY drawdown": "Caída del SPY",
  "Duration": "Duración",
  "Recovery": "Recuperación",
  "Outperformed": "Lo hicieron mejor",
  "Underperformed": "Lo hicieron peor",
  "Your Portfolio in This Regime": "Tu cartera en este régimen",
  "Sector exposure cross-referenced against the closest match ({x}) only — illustrative, not a recommendation.":
    "Exposición sectorial cruzada solo con el análogo más cercano ({x}): ilustrativo, no es una recomendación.",
  "Today's matches compare against a curated library of well-known historical episodes. Scora now records a daily macro snapshot — once enough history accumulates, this tab can also compare today against Scora's own recorded past instead of curated estimates only.":
    "Las comparaciones de hoy se hacen contra una biblioteca seleccionada de episodios históricos conocidos. Scora ya guarda una foto macro diaria: cuando haya historia suficiente, esta pestaña podrá comparar también el día de hoy con el pasado registrado por la propia Scora, y no solo con estimaciones seleccionadas.",
  "Historical analogs are illustrative and approximate; past regimes do not predict future returns. Not financial advice.":
    "Los análogos históricos son ilustrativos y aproximados; los regímenes pasados no predicen rentabilidades futuras. No es asesoramiento financiero.",

  // ── Indicadores ──
  "pending": "pendiente",
  "Composite Score Breakdown": "Desglose de las puntuaciones compuestas",
  "Click → sub-drivers. Stored = cron · Computed = frontend approx.": "Pulsa → subfactores. Guardado = proceso automático · Calculado = aproximación en el navegador.",
  "\"pending\" = field not yet written by lib/server/macro.js to macro_state. Add FRED series ID to the macro pipeline to activate.":
    "«pendiente» = campo que lib/server/macro.js aún no escribe en macro_state. Añade el ID de la serie de FRED al proceso macro para activarlo.",
  "FRED Coverage — All 8 Categories": "Cobertura de FRED — las 8 categorías",
  "{a}/{b} live": "{a}/{b} en vivo",
  "Total FRED series": "Series de FRED en total",
  "Sahm Rule — Recession Trigger": "Regla de Sahm — disparador de recesión",
  "Dalio Debt Cycle": "Ciclo de deuda de Dalio",
  "Stage 4/5 — Political Fracture": "Fase 4/5 — fractura política",
  "USD share & Debt/GDP are manually maintained figures, not live series.": "El peso del dólar y la deuda/PIB son cifras que se mantienen a mano, no series en vivo.",

  // ── Mercados ──
  "Sentiment": "Sentimiento",
  "Fear & Greed": "Miedo y codicia",
  "Put/Call Ratio": "Ratio put/call",
  "Sentiment Signal": "Señal de sentimiento",
  "WTI Oil": "Petróleo WTI",
  "Global Liquidity": "Liquidez global",
  "Net Liquidity: <s1>{x}</s1>": "Liquidez neta: <s1>{x}</s1>",
  "Crypto": "Cripto",

  // ── Monitores ──
  "Meltup Monitor": "Monitor de euforia",
  "Bubble Risk Monitor": "Monitor de riesgo de burbuja",
  "Recession Monitor": "Monitor de recesión",
  "Stock / Bond Correlation Regime": "Régimen de correlación acciones / bonos",
  "Inflation data unavailable": "Datos de inflación no disponibles",
  "Commodity Supercycle": "Superciclo de materias primas",
  "Dalio Long-Term Debt Cycle": "Ciclo de deuda a largo plazo de Dalio",
  "⚠ KPIs may be stale ·": "⚠ Los indicadores pueden estar desactualizados ·",
  "Stage {x} — from macro_state": "Fase {x} — de macro_state",
  "reviewed {x}": "revisado el {x}",
  "Stage {x}": "Fase {x}",

  // ── Noticias ──
  "↑ positive": "↑ positiva",
  "↓ negative": "↓ negativa",
  "→ neutral": "→ neutral",
  "No news available for this category.": "No hay noticias para esta categoría.",
  "Source": "Fuente",
  "News Velocity": "Velocidad de las noticias",
  "Articles": "Artículos",
  "Status": "Estado",
  "Category Alignment": "Alineación por categoría",
  "{x} Signal Alignment": "Alineación de señales: {x}",
  "↑ {x} bullish": "↑ {x} alcistas",
  "↓ {x} bearish": "↓ {x} bajistas",
  "Each article is scored by keyword mapping to the macro composite (LCC/CSC/RPC/GRC/HSC). Confidence: HIGH = 3+ keywords, MODERATE = 1-2.":
    "Cada artículo se puntúa asociando palabras clave a cada compuesto macro (LCC/CSC/RPC/GRC/HSC). Confianza: ALTA = 3 o más palabras clave, MODERADA = 1-2.",

  // ── Resumen (Overview) ──
  "↑ = more risk": "↑ = más riesgo",
  "Market Stress Score": "Puntuación de estrés del mercado",
  "High Stress": "Estrés alto",
  "Elevated": "Elevado",
  "Low Stress": "Estrés bajo",
  "Updated {x}": "Actualizado {x}",
  "Data older than 24h": "Datos de hace más de 24 h",
  "IC Score — {x} snapshots": "Puntuación IC — {x} fotos",
  "Current Regime": "Régimen actual",
  "IC Health Score": "Puntuación de salud IC",
  "Signal Hierarchy — Druckenmiller Framework": "Jerarquía de señales — marco de Druckenmiller",
  "Priority 1→5": "Prioridad 1→5",
  "Composite Scores": "Puntuaciones compuestas",
  "Rates & Curve": "Tipos y curva",
  "Fed & Macro": "Fed y macro",
  "Fed Room": "Margen de la Fed",
  "Oil & Sentiment": "Petróleo y sentimiento",
  "Portfolio Positioning": "Posicionamiento de la cartera",
  "Suggested ETFs": "ETFs sugeridos",
  "All quadrant allocations:": "Asignación de cada cuadrante:",
  "Top At Risk — Worst Macro Tilt": "Más en riesgo — peor inclinación macro",
  "Analyze stocks in the Stocks tab to populate this list.": "Analiza acciones en la pestaña Acciones para llenar esta lista.",
  "Sector": "Sector",
  "Score": "Puntuación",
  "Macro Tilt": "Inclinación macro",

  // ── Cartera frente al régimen (pestaña Portfolio) ──
  "Sign in to see your portfolio.": "Entra para ver tu cartera.",
  "Your watchlist is empty": "Tu lista de seguimiento está vacía",
  "Add tickers from a stock page (★) or from the Screener.": "Añade tickers desde la página de una acción (★) o desde el Screener.",
  "Portfolio Heat": "Temperatura de la cartera",
  "Regime:": "Régimen:",
  "position": "posición",
  "positions": "posiciones",
  "Scora Avg": "Media Scora",
  "Regime Coverage Map": "Mapa de cobertura por régimen",
  "How many of your {x} positions provide exposure to each economic regime (sectors may cover multiple)":
    "Cuántas de tus {x} posiciones te dan exposición a cada régimen económico (un sector puede cubrir varios)",
  "{x} position": "{x} posición",
  "⚠ Only {a}% of your portfolio aligns with the current {b} regime — consider rotating toward aligned sectors":
    "⚠ Solo el {a}% de tu cartera encaja con el régimen actual ({b}): plantéate rotar hacia los sectores alineados",
  "Satellite Asset Suggestions": "Ideas de activos satélite",
  "Based on Trainor-Black satellite portfolio theory — complement your core equity holdings with regime-specific hedges":
    "Basado en la teoría de cartera satélite de Treynor-Black: complementa tu núcleo de acciones con coberturas propias de cada régimen",
  "Not investment advice — these are ETF examples for educational purposes only. Research before trading.":
    "No es asesoramiento de inversión: son ejemplos de ETFs con fines educativos. Infórmate antes de operar.",
  "Portfolio Regime Stress Test": "Prueba de estrés de la cartera por régimen",
  "Estimated portfolio drawdown vs SPY in historical macro episodes — based on your portfolio's sector composition":
    "Caída estimada de tu cartera frente al SPY en episodios macro históricos, según la composición sectorial de tu cartera",
  "Episode": "Episodio",
  "SPY Peak-Trough": "SPY de máximo a mínimo",
  "Est. Portfolio": "Cartera estimada",
  "vs SPY": "frente al SPY",
  "Sector Read": "Lectura sectorial",
  "{x} pts": "{x} ptos",
  "{a}{b}pp": "{a}{b}pp",
  "Estimates based on sector classification: outperformers in each episode → ~0.5× SPY drawdown; underperformers → ~1.5× SPY drawdown. Historical analogies are educational — actual outcomes depend on position sizing, correlations, and timing.":
    "Estimaciones según la clasificación sectorial: los que lo hicieron mejor en cada episodio → ~0,5 veces la caída del SPY; los que lo hicieron peor → ~1,5 veces. Las analogías históricas son educativas: el resultado real depende del tamaño de las posiciones, las correlaciones y el momento.",
  "Base: <s1>{x}</s1>": "Base: <s1>{x}</s1>",

  // ── Metales ──
  "Metals · price & positioning": "Metales · precio y posicionamiento",
  "Price from the liquid ETF proxy; positioning from the CFTC Commitments of Traders (weekly) — managed-money net long/short is the honest read of institutional flow.":
    "El precio sale del ETF líquido equivalente; el posicionamiento, del informe Commitments of Traders de la CFTC (semanal): la posición neta larga/corta de los gestores es la lectura honesta del flujo institucional.",
  "Loading metals…": "Cargando metales…",
  "Managed-money net {a}{b} contracts": "Posición neta de los gestores {a}{b} contratos",
  "No COT data": "Sin datos COT",
  "Gold / silver ratio": "Ratio oro / plata",
  "Silver cheap vs gold": "Plata barata frente al oro",
  "Silver rich vs gold": "Plata cara frente al oro",
  "Mid-range": "Rango medio",
  "Needs GLD + SLV": "Necesita GLD + SLV",
  "Real 10-yr yield": "Rentabilidad real a 10 años",
  "10y Treasury − core PCE · gold's biggest macro driver": "Tesoro a 10 años − PCE subyacente · el mayor motor macro del oro",
  "10y breakeven inflation": "Inflación implícita a 10 años",
  "Higher expected inflation supports gold": "Más inflación esperada apoya al oro",
  "Lower real yields lift gold (no coupon to compete with); a high gold/silver ratio historically favors silver. Warehouse & lease-rate depth is a paid-data upgrade.":
    "Rentabilidades reales más bajas empujan al oro (no hay cupón con el que competir); un ratio oro/plata alto ha favorecido históricamente a la plata. Los datos de almacenes y de tipos de arrendamiento requieren datos de pago.",

  // ── Fondo en papel ──
  "Autonomous paper fund": "Fondo simulado autónomo",
  "The model running itself: a cron rebalances monthly by the validated allocator, another measures weekly and auto-grades. No discretion, no hindsight — a risk-managed record, not a “+8% in 30 days” pitch.":
    "El modelo funcionando solo: un proceso rebalancea cada mes con el asignador validado y otro mide cada semana y pone la nota. Sin criterio humano ni ventaja del pasado: un historial con el riesgo controlado, no un «+8 % en 30 días».",
  "Grade": "Nota",
  "NAV (base 100)": "Valor liquidativo (base 100)",
  "Max drawdown": "Caída máxima",
  "Sharpe (ann.)": "Sharpe (anual)",
  "Needs a year of history": "Hace falta un año de historia",
  "Inception {a} · measured {b}": "Inicio {a} · medido {b}",
  "· accruing — the NAV path fills in as the weekly measure runs": "· en curso: la curva del valor liquidativo se completa con cada medición semanal",
  "Interactive allocator · risk-on gauge": "Asignador interactivo · indicador de apetito por riesgo",
  "Blend only — the live fund also applies a 12-1m momentum gate before rebalancing.": "Solo la mezcla: el fondo en vivo aplica además un filtro de momentum 12-1m antes de rebalancear.",
  "Current target allocation · rebalanced {x}": "Asignación objetivo actual · rebalanceada {x}",

  // ── Radar de régimen ──
  "Regime Radar": "Radar de régimen",
  "The macro context behind your allocation — a read of <s1>where we are</s1>, decomposed into the three drivers of the risk-on gauge. Not a forecast.":
    "El contexto macro detrás de tu asignación: una lectura de <s1>dónde estamos</s1>, desglosada en los tres motores del indicador de apetito por riesgo. No es una predicción.",
  "Breadth": "Amplitud",
  "Top-down ↔ bottom-up:": "De arriba abajo ↔ de abajo arriba:",
  "Corr": "Corr.",
  "Stock-picking:": "Selección de acciones:",
  "HY credit": "Crédito high yield",
  "Curve 10y-3m": "Curva 10 años - 3 meses",
  "Broad USD index": "Índice amplio del dólar",
  "The gauge is validated for <s1>allocation</s1> (risk-adjusted), not directional market-timing — a high reading does not predict higher equity returns; its edge is the asset mix it drives above.":
    "El indicador está validado para la <s1>asignación</s1> (ajustada por riesgo), no para acertar la dirección del mercado: una lectura alta no predice más rentabilidad de las acciones; su ventaja es la mezcla de activos que decide arriba.",

  // ── Resumen de Scora (IA) ──
  "Failed to generate brief": "No se pudo generar el resumen",
  "Scora Brief · AI narrator": "Resumen de Scora · narrador con IA",
  "The validated stack — secular, allocation, correlation — narrated. <s1>Grounded</s1>: cites only the real numbers above, never invents.":
    "Las capas validadas —secular, asignación, correlación—, contadas. <s1>Verificado</s1>: solo cita las cifras reales de arriba, nunca se inventa nada.",
  "Writing…": "Escribiendo…",
  "✦ Generate brief": "✦ Generar resumen",
  "A ~180-word read on where we are, what the allocation says, and what would change the view — built only from the Secular Clock, risk-on gauge, and stock-picking regime above.":
    "Una lectura de unas 180 palabras sobre dónde estamos, qué dice la asignación y qué cambiaría la visión, construida solo con el Reloj secular, el indicador de apetito por riesgo y el régimen de selección de acciones de arriba.",

  // ── Rotación sectorial ──
  "Sector rotation · Layer 3": "Rotación sectorial · Nivel 3",
  "Within equities, 12-1m momentum favors some sectors. The top {x} (▲) are what a dual-momentum rotation holds.":
    "Dentro de la renta variable, el momentum 12-1m favorece a algunos sectores. Los {x} primeros (▲) son los que mantendría una rotación de momentum dual.",
  "Favored now": "Favorecidos ahora",
  "Computing sector momentum…": "Calculando el momentum sectorial…",
  "Momentum rotation backtest {a}: top-{b} Sharpe {c} · drawdown {d}% — half of SPY's ({e}%) and above equal-weight sectors ({f} / {g}%). A risk refinement within the equity sleeve.":
    "Backtest de la rotación por momentum {a}: los {b} primeros, Sharpe {c} · caída {d}%, la mitad que el SPY ({e}%) y mejor que los sectores con igual peso ({f} / {g}%). Un ajuste de riesgo dentro de la parte de acciones.",
  "Macro-favored · {x} regime": "Favorecidos por la macro · régimen {x}",
  "Style: {x} leads": "Estilo: lidera {x}",
  "value": "valor",
  "growth": "crecimiento",
  "The regime picks the tailwind, not the name. The <s1>style</s1> rotation is what Scora folds into the score: a regime {x}/":
    "El régimen elige el viento a favor, no la empresa. La rotación de <s1>estilo</s1> es lo que Scora mete en la puntuación: una inclinación de régimen {x}/",
  "tilt earned Sharpe {a} vs the S&P's {b} over {c}. The sectors above are the <s1>historical tendency</s1> for this regime — context, not a live basket (out-of-sample, concentrating into them doesn't beat the index).":
    "obtuvo un Sharpe de {a} frente al {b} del S&P en {c}. Los sectores de arriba son la <s1>tendencia histórica</s1> de este régimen: contexto, no una cesta en vivo (fuera de muestra, concentrarse en ellos no bate al índice).",
  "Avg fwd-1m excess vs SPY +{x}%": "Exceso medio a 1 mes frente al SPY +{x}%",

  // ── Reloj secular ──
  "Secular Clock · Layer 1": "Reloj secular · Nivel 1",
  "Where we are in the long valuation cycle. Sets the <s1>baseline</s1> equity exposure that the tactical allocator tilts around.":
    "Dónde estamos en el ciclo largo de valoración. Fija la exposición <s1>base</s1> a renta variable alrededor de la cual se inclina el asignador táctico.",
  "Valuation": "Valoración",
  "Cheap": "Barata",
  "Fair": "Justa",
  "Expensive": "Cara",
  "Extreme": "Extrema",
  "Buffett Ind.": "Ind. Buffett",
  "Fwd 10y ret.": "Rent. esperada 10 años",
  "Secular equity baseline": "Base secular en renta variable",
  "Long cycle · secular {x}": "Ciclo largo · secular {x}",
  "{a}-stage · ~{b}y in": "fase {a} · ~{b} años dentro",
  "~{x}y typical": "~{x} años lo habitual",
  "{x} start": "inicio {x}",
  "~{x}y avg": "~{x} años de media",

  // ── Backtest de señales ──
  "Backtest failed": "El backtest falló",
  "Signal Backtest — do high scores beat SPY?": "Backtest de señales: ¿las notas altas baten al SPY?",
  "Forward return of each analyzed ticker since its analysis date vs SPY over the same window. Descriptive of your own history — not a forecast.":
    "Rentabilidad de cada ticker analizado desde la fecha del análisis frente al SPY en el mismo periodo. Describe tu propio historial; no es una predicción.",
  "Running…": "Ejecutando…",
  "Re-run": "Volver a ejecutar",
  "Run backtest": "Ejecutar el backtest",
  "Analyze tickers in your watchlist first to build a backtest.": "Analiza primero tickers de tu lista de seguimiento para construir un backtest.",
  "{a} of {b} tickers left out — no price history came back ({c}). The result below covers only the rest.":
    "{a} de {b} tickers se quedan fuera: no llegó su historial de precios ({c}). El resultado de abajo cubre solo el resto.",
  "beat SPY ({x})": "batieron al SPY ({x})",
  "avg alpha": "alfa media",
  "Analyzed": "Analizado",
  "Fwd Return": "Rentabilidad posterior",
  "Alpha": "Alfa",
  "One point per ticker (its latest analysis). A small sample and survivorship in your own picks make this indicative, not statistically robust. Past performance does not predict future results.":
    "Un punto por ticker (su último análisis). Una muestra pequeña y el sesgo de supervivencia de tus propias elecciones hacen que esto sea orientativo, no estadísticamente sólido. La rentabilidad pasada no predice la futura.",

  // ── Prima de riesgo de varianza ──
  "VIX isn't available in the macro snapshot.": "El VIX no está en la foto macro.",
  "Not enough SPY history.": "No hay historial suficiente del SPY.",
  "Couldn't compute realized volatility.": "No se pudo calcular la volatilidad realizada.",
  "Couldn't compute the variance premium": "No se pudo calcular la prima de varianza",
  "Variance risk premium · what the market charges for insurance": "Prima de riesgo de varianza · lo que cobra el mercado por el seguro",
  "VIX is <s1>implied</s1> volatility: what it costs today to hedge. SPY's realized volatility is what volatility <s2>turned out</s2> to be. The difference (IV² − RV²) is the variance risk premium, persistently positive — it is why selling volatility makes money most months and gives it all back at once in a few.":
    "El VIX es la volatilidad <s1>implícita</s1>: lo que cuesta hoy cubrirse. La volatilidad realizada del SPY es la que <s2>resultó</s2> ser. La diferencia (IV² − RV²) es la prima de riesgo de varianza, positiva casi siempre: es la razón por la que vender volatilidad gana dinero la mayoría de los meses y lo devuelve todo de golpe en unos pocos.",
  "Calculating…": "Calculando…",
  "vol pts": "ptos de vol.",
  "VIX {a} vs 1-month realized {b}%": "VIX {a} frente a la realizada a 1 mes del {b}%",
  "Realized window": "Ventana realizada",
  "Realized": "Realizada",
  "VIX − RV (pts vol)": "VIX − RV (ptos vol.)",
  "IV² − RV² (pts var)": "IV² − RV² (ptos var.)",
  "· {x} sessions": "· {x} sesiones",
  "An imperfect comparison on purpose, and worth knowing: VIX is a 30-calendar-day forecast from S&P 500 options, while realized volatility looks backward. The 1-month row is the only one comparing similar horizons; the other two are regime context, not the premium. Bands of ±2 points are treated as estimation noise, not signal.":
    "Una comparación imperfecta a propósito, y conviene saberlo: el VIX es una previsión a 30 días naturales sacada de las opciones del S&P 500, mientras que la volatilidad realizada mira hacia atrás. La fila de 1 mes es la única que compara horizontes parecidos; las otras dos son contexto de régimen, no la prima. Las bandas de ±2 puntos se tratan como ruido de estimación, no como señal.",
};
