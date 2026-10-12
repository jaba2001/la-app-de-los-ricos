// Discovery, Momentum, Seguimiento y el diario de operaciones (y sus herramientas).
export const CARTERA: Record<string, string> = {
  // ── Discovery ──
  "Stocks · S&P 500": "Acciones · S&P 500",
  "Cross-asset": "Multiactivo",
  "Metals, commodities, bonds, equity indices and sectors ranked by <s1>12-1m momentum</s1> — the same factor that drives the validated dual-momentum allocation. A cross-asset map of <s2>what is leading right now</s2>.":
    "Metales, materias primas, bonos, índices de acciones y sectores ordenados por <s1>momentum 12-1m</s1>, el mismo factor que mueve la asignación de momentum dual validada. Un mapa multiactivo de <s2>lo que lidera ahora mismo</s2>.",
  "The S&P 500 ranked by <s1>12-1m momentum</s1>. This is a map of <s2>what is leading right now</s2> — not a list of recommendations, and not a claim that these names will outperform.":
    "El S&P 500 ordenado por <s1>momentum 12-1m</s1>. Es un mapa de <s2>lo que lidera ahora mismo</s2>, no una lista de recomendaciones ni una promesa de que estos valores lo harán mejor.",
  "Momentum leadership is most reliable in low-correlation regimes; when correlation is high, sleeves move together and the ranking carries less edge.":
    "El liderazgo por momentum es más fiable con correlación baja; cuando la correlación es alta, todo se mueve a la vez y la clasificación aporta menos ventaja.",
  "What we measured, before you trust this list": "Lo que medimos, antes de que te fíes de esta lista",
  "Over <s1>192 months (2010–2026)</s1> on the point-in-time S&P 500, picking the top momentum decile returned <s2>+728%</s2> — while holding <s3>the same 400 names equally weighted</s3>, with no selection at all, returned <s4>+908%</s4>. Ranking by momentum<s5> lagged doing nothing by 180 points</s5>, and its information coefficient is statistically indistinguishable from zero. What the data <s6>does</s6> show is that the signal is strongly time-varying — its dispersion is 16× what chance would explain — which is why the regime below matters more than the ranking itself. Use this as a leadership map, not as a buy list.":
    "En <s1>192 meses (2010–2026)</s1> sobre el S&P 500 point-in-time, elegir el decil con más momentum rindió <s2>+728 %</s2>, mientras que mantener <s3>los mismos 400 valores con igual peso</s3>, sin seleccionar nada, rindió <s4>+908 %</s4>. Ordenar por momentum<s5> quedó 180 puntos por detrás de no hacer nada</s5>, y su coeficiente de información no se distingue estadísticamente de cero. Lo que los datos <s6>sí</s6> muestran es que la señal varía mucho con el tiempo —su dispersión es 16 veces la que explicaría el azar—; por eso el régimen de abajo importa más que la propia clasificación. Úsalo como mapa de liderazgo, no como lista de compra.",
  "The discovery feed is being built. The universe is scored weekly.": "La lista de Discovery se está construyendo. El universo se puntúa cada semana.",
  "Instrument": "Instrumento",
  "Class": "Clase",
  "12-1m mom": "Mom. 12-1m",
  "Price": "Precio",
  "As of {x} ·": "A fecha de {x} ·",
  "instruments": "instrumentos",
  "names": "valores",
  "· momentum from free EOD prices ·": "· momentum con precios de cierre gratuitos ·",
  "research/discovery_instruments.mjs": "research/discovery_instruments.mjs",
  "research/discovery.mjs": "research/discovery.mjs",
  "· audited in": "· auditado en",
  "(192 months)": "(192 meses)",
  ". Educational — not investment advice.": ". Educativo, no es asesoramiento de inversión.",

  // ── Momentum ──
  "Market Momentum": "Momentum del mercado",
  "How much of the market is actually participating, and whether credit and risk appetite agree. This answers <s1>“what is the backdrop?”</s1> — not <s2>“what should I buy?”</s2>":
    "Cuánto del mercado está participando de verdad, y si el crédito y el apetito por riesgo coinciden. Responde a <s1>«¿cuál es el contexto?»</s1>, no a <s2>«¿qué compro?»</s2>",
  "What this is measured to do — and what it is not": "Para qué está medido, y para qué no",
  "This is <s1>context, not a timing signal</s1>. We tested three ways of turning market signals into returns in this codebase — a momentum composite, a binary regime gate and sector-relative percentiles — and all three failed out of sample. The one that survived (the correlation gate) improved<s2> risk-adjusted return, not return</s2>. So this page tells you what the market is doing; it does not claim to know what it will do next.":
    "Esto es <s1>contexto, no una señal para entrar o salir</s1>. Probamos tres maneras de convertir señales de mercado en rentabilidad —un compuesto de momentum, un filtro binario de régimen y percentiles dentro del sector— y las tres fallaron fuera de muestra. La que sobrevivió (el filtro de correlación) mejoró<s2> la rentabilidad ajustada por riesgo, no la rentabilidad</s2>. Así que esta página te dice qué está haciendo el mercado; no pretende saber qué hará después.",
  "Not enough market data yet — breadth is aggregated on weekdays.": "Aún no hay datos de mercado suficientes: la amplitud se agrega los días laborables.",
  "of 100": "de 100",
  "Breadth as of {x} ·": "Amplitud a fecha de {x} ·",
  "⚠ Divergence: the index is above its 200-day average while fewer than 45% of names are.": "⚠ Divergencia: el índice está por encima de su media de 200 días mientras menos del 45 % de los valores lo están.",
  "bp": "pb",
  "Selection weight today": "Peso de la selección hoy",
  "Scales continuously with implied correlation. Measured over two independent windows (2010-2018 and 2019-2026) it improved Sharpe — 1.08→1.14 and 0.78→0.86 — but <s1>not total return</s1>. It is risk management, not an edge.":
    "Varía de forma continua con la correlación implícita. Medido en dos periodos independientes (2010-2018 y 2019-2026) mejoró el Sharpe —de 1,08 a 1,14 y de 0,78 a 0,86—, pero <s1>no la rentabilidad total</s1>. Es gestión del riesgo, no una ventaja.",
  "The {x} signals behind it": "Las {x} señales que hay detrás",
  "aggregated daily by": "agregado a diario por",

  // ── Seguimiento ──
  "Add tickers above or use the ★ on any stock page.": "Añade tickers arriba o usa la ★ en la página de cualquier acción.",
  "Your watchlist is empty": "Tu lista de seguimiento está vacía",
  "Change %": "Variación %",
  "Market cap": "Capitalización",
  "Added": "Añadido",
  "AAPL, MSFT…": "AAPL, MSFT…",

  // ── Diario de operaciones ──
  "Trade Journal": "Diario de operaciones",
  "Log your real trades, group them by thesis, and track live P&L. Your own book — separate from the paper fund.":
    "Apunta tus operaciones reales, agrúpalas por tesis y sigue su resultado en vivo. Tu propia cartera, aparte del fondo simulado.",
  "Ticker, shares (>0) and price are required.": "Hacen falta el ticker, las acciones (>0) y el precio.",
  "No live price for {x} yet — try again in a moment.": "Aún no hay precio en vivo de {x}: inténtalo en un momento.",
  "Log a trade": "Apuntar una operación",
  "Thesis / tag (optional)": "Tesis / etiqueta (opcional)",
  "Add trade": "Añadir operación",
  "Open positions": "Posiciones abiertas",
  "No open positions. Log a trade above.": "No hay posiciones abiertas. Apunta una operación arriba.",
  "Side": "Lado",
  "Entry": "Entrada",
  "Mark": "Precio actual",
  "Unreal. P&L": "Resultado latente",
  "Thesis": "Tesis",
  "Close at market": "Cerrar a mercado",
  "Close": "Cerrar",
  "Attribution by thesis": "Atribución por tesis",
  "Cost basis": "Coste",
  "P&L (unreal.+real.)": "Resultado (latente + realizado)",
  "Return": "Rentabilidad",
  "Closed trades": "Operaciones cerradas",
  "Exit": "Salida",
  "Realized P&L": "Resultado realizado",
  "Closed": "Cerrada",
  "Buy": "Compra",
  "Sell": "Venta",
  "Shares": "Acciones",
  "Price $": "Precio $",
  "Ticker": "Ticker",

  // ── Exposición y concentración ──
  "Exposure & concentration": "Exposición y concentración",
  "How your open book is spread across names, sectors and themes — so concentration is seen before it's felt.":
    "Cómo se reparte tu cartera abierta entre valores, sectores y temas, para ver la concentración antes de notarla.",
  "Positions": "Posiciones",
  "Effective bets (1/HHI)": "Apuestas efectivas (1/HHI)",
  "Diversification, not raw count": "Diversificación, no número de valores",
  "Largest name": "Mayor posición",
  "By sector": "Por sector",
  "Loading sectors…": "Cargando sectores…",
  "By theme": "Por tema",
  "Tag trades with a thesis to see themes.": "Etiqueta las operaciones con una tesis para ver los temas.",

  // ── Radiografía por factores ──
  "Factor X-ray · APT (Ross 1976)": "Radiografía por factores · APT (Ross 1976)",
  "Regresses <s1>your portfolio's</s1> returns on the market and on macro surprises. The sector says what each company does; the factor says what moves your money. They rarely match.":
    "Hace una regresión de las rentabilidades de <s1>tu cartera</s1> sobre el mercado y las sorpresas macro. El sector dice a qué se dedica cada empresa; el factor dice qué mueve tu dinero. Rara vez coinciden.",
  "Measuring…": "Midiendo…",
  "✦ Run X-ray": "✦ Hacer la radiografía",
  "Add at least 2 different open positions.": "Añade al menos 2 posiciones abiertas distintas.",
  "At least 2 names with 24+ months of history (and SPY) are needed.": "Hacen falta al menos 2 valores con 24 meses o más de historial (y el SPY).",
  "The model couldn't be fitted (collinear factors or too short a sample).": "No se pudo ajustar el modelo (factores colineales o muestra demasiado corta).",
  "Couldn't build the factor exposure": "No se pudo calcular la exposición a factores",
  "You hold <s1>{a} names</s1> and <s2>{b}</s2> effective independent bets. {c}% of the variance the factors explain comes from <s3>{d}</s3>.":
    "Tienes <s1>{a} valores</s1> y <s2>{b}</s2> apuestas independientes efectivas. El {c}% de la varianza que explican los factores viene de <s3>{d}</s3>.",
  "Counting tickers is not diversifying: in practice this is a single position.": "Contar tickers no es diversificar: en la práctica esto es una sola posición.",
  "Systematic": "Sistemático",
  "Idiosyncratic": "Idiosincrático",
  "Months": "Meses",
  "Your portfolio, in one sentence": "Tu cartera, en una frase",
  "A position {x}.": "Una posición {x}.",
  "Portfolio scenarios": "Escenarios para la cartera",
  "Weights by current market value, betas from a {x}-month regression. Dimmed rows have |t| < 2 and are not distinguishable from zero. Scenarios are linear: they don't capture that betas rise precisely in crises, which is when they matter.":
    "Pesos por valor de mercado actual, betas de una regresión de {x} meses. Las filas atenuadas tienen |t| < 2 y no se distinguen de cero. Los escenarios son lineales: no captan que las betas suben precisamente en las crisis, que es cuando importan.",
  "⚠ Not enough history, excluded from the calculation: {x}.": "⚠ Sin historia suficiente, fuera del cálculo: {x}.",

  // ── Optimizador de cartera ──
  "Portfolio optimizer · Markowitz": "Optimizador de cartera · Markowitz",
  "Min-variance & max-Sharpe weights across your open names, with Ledoit-Wolf shrinkage and resampled uncertainty bands. A tool alongside the regime allocator — not a replacement.":
    "Pesos de mínima varianza y de máximo Sharpe entre tus valores abiertos, con contracción de Ledoit-Wolf y bandas de incertidumbre remuestreadas. Una herramienta junto al asignador de régimen, no en su lugar.",
  "Optimizing…": "Optimizando…",
  "✦ Optimize": "✦ Optimizar",
  "Add at least 2 different open tickers to optimize.": "Añade al menos 2 tickers abiertos distintos para optimizar.",
  "Not enough price history to optimize these names.": "No hay historial de precios suficiente para optimizar estos valores.",
  "Optimization failed": "La optimización falló",
  "Equal wt (1/N)": "Igual peso (1/N)",
  "Min-variance": "Mínima varianza",
  "Max-Sharpe": "Máximo Sharpe",
  "Exp. return": "Rent. esperada",
  "Volatility": "Volatilidad",
  "Sharpe (rf {x})": "Sharpe (rf {x})",
  "Equal weight is here as the control, not as filler: DeMiguel, Garlappi & Uppal (2009) found 1/N beats sample-based optimization out of sample across 14 datasets. If the optimized portfolios don’t clearly beat it, the honest read is that they don’t.":
    "El igual peso está aquí como control, no de relleno: DeMiguel, Garlappi y Uppal (2009) vieron que 1/N bate a la optimización con datos de muestra fuera de muestra en 14 conjuntos de datos. Si las carteras optimizadas no lo baten con claridad, la lectura honesta es que no lo hacen.",
  "Long-only, weights sum to 100%. Built from {x} aligned daily returns": "Solo posiciones largas, los pesos suman el 100 %. Construido con {x} rentabilidades diarias alineadas",
  "· Ledoit-Wolf shrinkage <s1>{x}%</s1> toward a constant-correlation target": "· contracción de Ledoit-Wolf del <s1>{x}%</s1> hacia una correlación constante",
  "The <s1>±</s1> figures are the spread of each weight across {x} bootstrap resamples of the same history — how much the “optimal” weight moves when the past comes out slightly differently.":
    "Las cifras <s1>±</s1> son la dispersión de cada peso en {x} remuestreos bootstrap de la misma historia: cuánto se mueve el peso «óptimo» cuando el pasado sale un poco distinto.",
  "Note that max-Sharpe’s bands are about <s1>{x}×</s1> wider than min-variance’s: it depends on expected returns, which are the worst-estimated input there is (Michaud 1989; Chopra & Ziemba measured errors in means costing ~11× errors in variances).":
    "Fíjate en que las bandas del máximo Sharpe son unas <s1>{x}×</s1> más anchas que las de mínima varianza: depende de las rentabilidades esperadas, que son el dato peor estimado que existe (Michaud 1989; Chopra y Ziemba midieron que los errores en las medias cuestan ~11 veces más que los errores en las varianzas).",

  // ── Tamaño de las posiciones ──
  "Position sizing": "Tamaño de las posiciones",
  "Equal-weight core positions with half-size slots for higher-risk small caps — plus Kelly if you have an edge estimate. A calculator, not advice.":
    "Posiciones principales con igual peso y media posición para las pequeñas compañías de más riesgo, más Kelly si tienes una estimación de ventaja. Una calculadora, no un consejo.",
  "Portfolio $": "Cartera $",
  "Core names": "Valores principales",
  "Half-size (small cap)": "Media posición (pequeñas compañías)",
  "{x} each": "{x} cada uno",
  "If one falls 20%": "Si uno cae un 20 %",
  "portfolio impact": "efecto en la cartera",
  "Cap check": "Comprobación del tope",
  "Over cap": "Por encima del tope",
  "{x}% max/name": "{x}% máx. por valor",
  "Enter a portfolio value and at least one position.": "Introduce el valor de la cartera y al menos una posición.",
  "Kelly (optional edge estimate)": "Kelly (estimación opcional de ventaja)",
  "Win prob %": "Prob. de acierto %",
  "Upside %": "Subida %",
  "Downside %": "Bajada %",
  "Payoff ratio <s1>{a}</s1> · full-Kelly <s2>{b}%</s2> · half-Kelly <s3>{c}%</s3> · capped <s4>{d}%</s4>. Practitioners bet a fraction of full-Kelly.":
    "Ratio de pago <s1>{a}</s1> · Kelly completo <s2>{b}%</s2> · medio Kelly <s3>{c}%</s3> · con tope <s4>{d}%</s4>. Los profesionales apuestan una fracción del Kelly completo.",
  "No positive edge at these inputs → Kelly says don't bet.": "Sin ventaja positiva con estos datos → Kelly dice que no apuestes.",
  "Enter win probability, upside and downside.": "Introduce la probabilidad de acierto, la subida y la bajada.",
};
