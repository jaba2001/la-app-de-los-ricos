// Páginas que se generan en el servidor: /daily, /evidence y /picks.
export const SERVIDOR: Record<string, string> = {
  // ── Cierre diario ──
  "No close published yet. The report is generated after the US market closes on trading days. Meanwhile, see the":
    "Aún no se ha publicado ningún cierre. El informe se genera después del cierre del mercado de EE. UU. los días hábiles. Mientras tanto, consulta el",
  "track record": "historial",
  "or the": "o la",
  "live demo": "demo en vivo",
  "No close published for {x} — markets may have been shut that day. See the": "No hay cierre publicado del {x}: puede que el mercado estuviera cerrado ese día. Consulta el",
  "latest close": "último cierre",
  "{x} · measured, not forecast": "{x} · medido, no previsto",
  "Regime change: {a} → {b}": "Cambio de régimen: {a} → {b}",
  "What kind of day it was": "Qué tipo de día fue",
  "Sectors up / down": "Sectores al alza / a la baja",
  "Dispersion": "Dispersión",
  "spread between sectors": "diferencia entre sectores",
  "Agreement": "Coincidencia",
  "on the same side": "del mismo lado",
  "Sectors": "Sectores",
  "Not measured today: {x}.": "Sin medir hoy: {x}.",
  "Built from measured values by a deterministic template — no model writes these numbers, so none can be invented. See how the engine has actually done on":
    "Construido a partir de valores medidos con una plantilla fija: ningún modelo escribe estas cifras, así que ninguna puede inventarse. Mira cómo le ha ido de verdad al motor en",
  "the track record": "el historial",
  ", including the backtest we lost, or try the": ", también el backtest que perdimos, o prueba la",
  "— no signup.": "— sin registrarte.",
  "Previous closes": "Cierres anteriores",

  // ── Libro de evidencia ──
  "Every signal in this product, with what it actually measured — <s1>including the ones that failed</s1>. Fama’s joint-hypothesis problem says market efficiency can never be tested on its own: you always test efficiency <s2>and</s2> a model of expected returns together, so any “edge” may just be a bad model. There is no clean test. The honest response isn’t silence — it’s showing the working.":
    "Cada señal de este producto, con lo que midió de verdad —<s1>también las que fallaron</s1>—. El problema de la hipótesis conjunta de Fama dice que la eficiencia del mercado nunca se puede comprobar por sí sola: siempre compruebas la eficiencia <s2>y</s2> un modelo de rentabilidades esperadas a la vez, así que cualquier «ventaja» puede ser solo un mal modelo. No hay una prueba limpia. La respuesta honesta no es el silencio: es enseñar el trabajo.",
  "The headline: stock selection does not beat the index": "Lo principal: la selección de acciones no bate al índice",
  "Information coefficient": "Coeficiente de información",
  "score vs forward return · ~0 is no predictive power": "puntuación frente a rentabilidad posterior · ~0 es ningún poder predictivo",
  "PSR vs SPY": "PSR frente al SPY",
  "want >95% · probability the true Sharpe beats SPY": "se busca >95 % · probabilidad de que el Sharpe real bata al SPY",
  "Top-minus-bottom decile": "Decil superior menos inferior",
  "best decile minus worst — negative is backwards": "mejor decil menos el peor: negativo es al revés",
  "Universe": "Universo",
  "{x} monthly rebalances · point-in-time membership": "{x} rebalanceos mensuales · composición point-in-time",
  "Verdict:": "Veredicto:",
  "This is the finding the rest of the product is built around. Proving honestly that you <s1>cannot</s1> beat the index by picking stocks on free data is the moat, not the failure — Grossman & Stiglitz (1980) showed markets can’t be perfectly efficient either, because then nobody would pay to gather information. The return to research exists; it just isn’t where retail products claim it is.":
    "Es la conclusión alrededor de la cual está construido el resto del producto. Demostrar con honestidad que <s1>no</s1> se puede batir al índice eligiendo acciones con datos gratuitos es la ventaja, no el fracaso: Grossman y Stiglitz (1980) demostraron que los mercados tampoco pueden ser perfectamente eficientes, porque entonces nadie pagaría por reunir información. La recompensa a la investigación existe; solo que no está donde dicen los productos para particulares.",
  "Scope matters: this is measured on <s1>US large caps with free data</s1>. It is not a claim that no one can ever beat an index. Where margin plausibly remains — less efficient universes, factor combinations gated by regime, risk and drawdown control rather than selection — is a different question, and one that has to be answered with the same measurement discipline rather than asserted.":
    "El alcance importa: esto está medido en <s1>grandes compañías de EE. UU. con datos gratuitos</s1>. No es una afirmación de que nadie pueda batir nunca a un índice. Dónde puede quedar margen —universos menos eficientes, combinaciones de factores filtradas por régimen, control del riesgo y de la caída en lugar de selección— es otra pregunta, y hay que responderla con la misma disciplina de medición en lugar de afirmarla.",
  "How hard we deflate for having searched": "Cuánto corregimos por haber buscado",
  "Test 200 worthless strategies, keep the best, and it will show a healthy Sharpe by luck alone. The deflated Sharpe (Bailey & López de Prado) asks the only question that matters: <s1>is this better than the best you’d expect from M attempts at nothing?</s1> The threshold rises with M — so we publish M.":
    "Prueba 200 estrategias que no valen nada, quédate con la mejor, y enseñará un Sharpe sano solo por suerte. El Sharpe corregido (Bailey y López de Prado) hace la única pregunta que importa: <s1>¿es esto mejor que lo mejor que cabría esperar de M intentos de nada?</s1> El listón sube con M, así que publicamos M.",
  "Trials in this script": "Pruebas en este script",
  "what the backtest itself swept": "lo que barrió el propio backtest",
  "Trials on the same data": "Pruebas sobre los mismos datos",
  "across {x} saved artifacts — a lower bound": "en {x} resultados guardados: un mínimo",
  "Deflated Sharpe · optimistic": "Sharpe corregido · optimista",
  "using this script's M and variance": "con la M y la varianza de este script",
  "Deflated Sharpe · conservative": "Sharpe corregido · conservador",
  "using the full trial count and pooled dispersion": "con todas las pruebas y la dispersión conjunta",
  "The truth sits between those two bounds: pooling different strategy families inflates the variance beyond what the framework assumes, while counting only this script’s three configurations plainly understates the search. Neither bound rescues the verdict — it already fails on PSR. And the trial count is a <s1>lower bound</s1>: it only counts variants that left a file behind.":
    "La verdad está entre esos dos límites: juntar familias de estrategias distintas infla la varianza más de lo que supone el método, mientras que contar solo las tres configuraciones de este script se queda claramente corto. Ninguno de los dos salva el veredicto: ya falla en el PSR. Y el número de pruebas es un <s1>mínimo</s1>: solo cuenta las variantes que dejaron un fichero.",
  "Every factor, graded": "Cada factor, con su nota",
  "Measured information coefficient per correlation regime, from a survivorship-free run ({x} name-months). Each factor is graded on its <s1>best</s1> regime — the most generous reading available — and the grade is still mostly C and D. That is the point.":
    "Coeficiente de información medido por régimen de correlación, en una ejecución sin sesgo de supervivencia ({x} valores-mes). Cada factor se califica en su <s1>mejor</s1> régimen —la lectura más generosa posible— y aun así casi todo son C y D. Esa es la clave.",
  "Best": "Mejor",
  "Grades penalise multiplicity: {x} trials on the same history raise the bar for all of them. Only one market history exists, and every pass spends it.":
    "Las notas castigan la multiplicidad: {x} pruebas sobre la misma historia suben el listón para todas. Solo existe una historia del mercado, y cada pasada la gasta.",
  "What failed, and stayed failed": "Lo que falló, y sigue fallando",
  "The IC-weighted ensemble — the most sophisticated thing in the codebase — was tested out of sample against the plain score and <s1>lost</s1>. So it stays informational: visible in the UI as context, never feeding the score. Signals do not get promoted because they are clever; they get promoted by clearing a gate.":
    "El conjunto ponderado por IC —lo más sofisticado del código— se probó fuera de muestra contra la puntuación simple y <s1>perdió</s1>. Así que se queda como información: visible en la app como contexto, sin entrar nunca en la puntuación. Las señales no ascienden por ser ingeniosas; ascienden superando una prueba.",
  "Ensemble OOS IC": "IC fuera de muestra del conjunto",
  "frozen train-window weights, tested out of sample": "pesos fijados en el periodo de entrenamiento, probados fuera de muestra",
  "Monolithic score OOS IC": "IC fuera de muestra de la puntuación única",
  "the incumbent it had to beat": "la que tenía que batir",
  "Test months": "Meses de prueba",
  "split at {x}": "corte en {x}",
  "Gate": "Prueba",
  "must be >0 AND beat the score": "debe ser >0 Y batir a la puntuación",
  "Out-of-sample gate artifact not present in this build.": "El resultado de la prueba fuera de muestra no está en esta versión.",
  "How to read this page": "Cómo leer esta página",
  "An information coefficient near zero means <s1>no predictive power</s1>. More precisely: this universe’s<s2>minimum detectable effect is IC {x}</s2> at 80% power (measured — the cross-sectional IC has a standard deviation of ~0.22, so 192 months buys you that much resolution and no more). Below it a coefficient is not “weak”, it is <s3>undetectable</s3>: confirming an IC of 0.02 would take seventy-seven years of data. Grades score it as zero, not as partial credit.":
    "Un coeficiente de información cercano a cero significa <s1>ningún poder predictivo</s1>. Más exactamente: en este universo el<s2> efecto mínimo detectable es un IC de {x}</s2> con una potencia del 80 % (medido: el IC transversal tiene una desviación típica de ~0,22, así que 192 meses dan esa resolución y no más). Por debajo, un coeficiente no es «débil»: es <s3>indetectable</s3>; confirmar un IC de 0,02 llevaría setenta y siete años de datos. Las notas lo cuentan como cero, no como medio punto.",
  "Benchmark caveat: the headline compares against SPY. A cap-weighted index is not the only fair yardstick — the same signal can beat SPY and lose badly against its own equal-weighted universe, which is the benchmark that shares the universe’s selection bias. Read single-benchmark claims here, including ours, with that in mind.":
    "Advertencia sobre la referencia: lo principal se compara con el SPY. Un índice ponderado por capitalización no es la única vara de medir justa: la misma señal puede batir al SPY y perder con claridad frente a su propio universo con igual peso, que es la referencia que comparte el sesgo de selección del universo. Lee con eso en mente cualquier afirmación con una sola referencia, también las nuestras.",
  "Point-in-time universe means delisted and removed names are included as of each date — no survivorship bias inflating the result.":
    "Universo point-in-time significa que los valores que dejaron de cotizar o salieron del índice se incluyen en cada fecha: ningún sesgo de supervivencia infla el resultado.",
  "Every number comes from a committed artifact in": "Cada cifra sale de un resultado guardado en",
  ". The test suite fails if a file is missing or if the constants shipped in the code drift from it.": ". Las pruebas fallan si falta un fichero o si las constantes del código se separan de él.",
  "Artifacts generated {a} · trial ledger {b}": "Resultados generados {a} · registro de pruebas {b}",
  "Past measurement is not a forecast. Nothing here is investment advice.": "Una medición pasada no es una previsión. Nada de esto es asesoramiento de inversión.",
  "Strong evidence": "Evidencia sólida",
  "Reasonable evidence": "Evidencia razonable",
  "Weak evidence": "Evidencia débil",
  "No evidence": "Sin evidencia",
  "Low correlation": "Correlación baja",
  "Medium correlation": "Correlación media",
  "High correlation": "Correlación alta",

  // ── Scora Picks ──
  "Scora Picks": "Scora Picks",
  "Fixed rules, no emotion and no hindsight · version {x} · measured live from day one": "Reglas fijas, sin emociones ni ventaja del pasado · versión {x} · medido en vivo desde el primer día",
  "<s1>This is not investment advice or a return forecast.</s1> It is what a system of rules written in advance does, published in full: the parts that work and the parts that don't. The rules were designed by looking at historical data, so their backtest <s2>is not out-of-sample evidence</s2> — it is the reason to test them live, not proof that they work. This track record starts from zero and will only have something to say after 24 months.":
    "<s1>Esto no es asesoramiento de inversión ni una previsión de rentabilidad.</s1> Es lo que hace un sistema de reglas escritas de antemano, publicado entero: lo que funciona y lo que no. Las reglas se diseñaron mirando datos históricos, así que su backtest <s2>no es evidencia fuera de muestra</s2>: es el motivo para probarlas en vivo, no la prueba de que funcionan. Este historial empieza desde cero y no tendrá nada que decir hasta pasados 24 meses.",
  "<s1>And a correction from August 24, 2026, which goes here and not in a footnote.</s1> An audit of the data engine found three defects affecting four of the five metrics used to select. Fixed and re-measured, the signal <s2>no longer beats the equal-weighted eligible universe in both historical windows</s2>: it wins in one and loses in the other. Before, it won in both, and that difference was the defect, not the market. Nor can we keep saying the portfolio falls less than the index: in the recent window it falls <s3>more</s3>. No rule has been changed —changing one now would mean choosing it by looking at the result— but the earlier evidence is weaker than what was published, which is all the more reason why the only thing that will count is what happens here, live.":
    "<s1>Y una corrección del 24 de agosto de 2026, que va aquí y no en una nota al pie.</s1> Una auditoría del motor de datos encontró tres defectos que afectaban a cuatro de las cinco métricas con las que se selecciona. Corregidos y vuelto a medir, la señal <s2>ya no bate al universo elegible con igual peso en los dos periodos históricos</s2>: gana en uno y pierde en el otro. Antes ganaba en los dos, y esa diferencia era el defecto, no el mercado. Tampoco podemos seguir diciendo que la cartera cae menos que el índice: en el periodo reciente cae <s3>más</s3>. No se ha cambiado ninguna regla —cambiarla ahora sería elegirla mirando el resultado—, pero la evidencia anterior es más débil de lo que se publicó, motivo de más para que lo único que cuente sea lo que pase aquí, en vivo.",
  "<s1>And the most uncomfortable part, which also goes here:</s1> the shutdown criterion is published in advance —if after 24 months it is below its benchmark, the result is published and it shuts down—. Applied to the two historical windows, <s2>that criterion would have fired in one of the two</s2>. It is not being relaxed: relaxing a criterion after seeing the result is what empties it of meaning. But anyone putting time or money into this should start from the assumption that <s3>the probability it ends in shutdown is high</s3>, and it was before it started.":
    "<s1>Y lo más incómodo, que también va aquí:</s1> el criterio de cierre está publicado de antemano —si después de 24 meses está por debajo de su referencia, se publica el resultado y se cierra—. Aplicado a los dos periodos históricos, <s2>ese criterio habría saltado en uno de los dos</s2>. No se va a relajar: relajar un criterio después de ver el resultado es lo que lo vacía de sentido. Pero quien dedique tiempo o dinero a esto debería partir de que <s3>la probabilidad de que acabe cerrándose es alta</s3>, y ya lo era antes de empezar.",
  "<s1>Which universe each decision used:</s1> the S&P 500 membership list used in each decision was the one from": "<s1>Qué universo usó cada decisión:</s1> la lista de miembros del S&P 500 que usó cada decisión era la de",
  ", and it is stored with the decision so it can be checked later. <s1>Until August 24, 2026 that snapshot had been frozen for 366 days</s1>, because the historical source stopped updating and this page said — wrongly — that there was no substitute: the candidates reviewed seemed to carry wrong tickers, and it turned out they were the <s2>current</s2> tickers, checked one by one against SEC records. Fixed: the snapshot is now current. Decisions taken before that date used the August 2025 index and are not rewritten.":
    ", y se guarda con la decisión para poder comprobarla después. <s1>Hasta el 24 de agosto de 2026 esa foto llevaba 366 días congelada</s1>, porque la fuente histórica dejó de actualizarse y esta página decía —por error— que no había sustituto: los candidatos revisados parecían tener tickers equivocados, y resultó que eran los tickers <s2>actuales</s2>, comprobados uno a uno con los registros de la SEC. Corregido: la foto ya está al día. Las decisiones tomadas antes de esa fecha usaron el índice de agosto de 2025 y no se reescriben.",
  "<s1>This portfolio holds no banks, and that is not an opinion about banking.</s1> The quality metrics —operating margin, interest coverage, net debt to EBITDA— mean nothing on a bank's balance sheet, where interest is the business and not an expense. Measured: of the 18 largest banks in the index, <s2>none</s2> gets a score. There are no REITs either, for the same kind of reason. It is a permanent sector bias that comes with the product — and it is worth knowing that in both backtest windows banks underperformed the index, so not holding them helped. How much of the historical edge is that and how much is selection <s3>has not been measured yet</s3>. Since 2026-08-23 there is a bank-specific metric set —net interest margin, efficiency, fee share, deposits to assets—, and public data has been checked to support it for the index's 20 commercial banks. What it does <s4>not</s4> support is credit quality (40%) or regulatory capital (30%), so those two aren't computed: ranking by a metric that only exists for 40% is ranking data availability. None of that enters this portfolio yet: adding banks changes the strategy, it doesn't fix a bug, and that requires opening a new rules version and validating it first.":
    "<s1>Esta cartera no tiene bancos, y no es una opinión sobre la banca.</s1> Las métricas de calidad —margen operativo, cobertura de intereses, deuda neta sobre EBITDA— no significan nada en el balance de un banco, donde los intereses son el negocio y no un gasto. Medido: de los 18 mayores bancos del índice, <s2>ninguno</s2> recibe puntuación. Tampoco hay SOCIMIs, por el mismo tipo de motivo. Es un sesgo sectorial permanente que viene con el producto, y conviene saber que en los dos periodos del backtest los bancos lo hicieron peor que el índice, así que no tenerlos ayudó. Cuánto de la ventaja histórica es eso y cuánto es selección <s3>aún no se ha medido</s3>. Desde el 23-08-2026 hay un juego de métricas propio de los bancos —margen de intereses, eficiencia, peso de las comisiones, depósitos sobre activo— y se ha comprobado que los datos públicos lo permiten para los 20 bancos comerciales del índice. Lo que <s4>no</s4> permiten es la calidad crediticia (40 %) ni el capital regulatorio (30 %), así que esas dos no se calculan: ordenar por una métrica que solo existe para el 40 % es ordenar por disponibilidad de datos. Nada de eso entra todavía en esta cartera: añadir bancos cambia la estrategia, no arregla un fallo, y eso exige abrir una nueva versión de las reglas y validarla primero.",
  "No decisions published yet.": "Aún no se ha publicado ninguna decisión.",
  "The system decides on the 1st and the 15th of each month. For the first six weeks the portfolio stays <s1>empty on purpose</s1>: the persistence rule requires a stock to spend {a} days above the threshold before it can enter, and that history has to build up. Buying {b} a month, filling the {c} positions takes about ten months.":
    "El sistema decide los días 1 y 15 de cada mes. Durante las seis primeras semanas la cartera está <s1>vacía a propósito</s1>: la regla de persistencia exige que una acción pase {a} días por encima del umbral antes de poder entrar, y esa historia tiene que acumularse. Comprando {b} al mes, llenar las {c} posiciones lleva unos diez meses.",
  "the portfolio is still being built": "la cartera aún se está formando",
  "portfolio full": "cartera completa",
  "Closed positions": "Posiciones cerradas",
  "no exits yet": "aún sin salidas",
  "{x} positive": "{x} positivas",
  "Average return at exit": "Rentabilidad media a la salida",
  "simple, unweighted": "simple, sin ponderar",
  "Dates with no buys": "Fechas sin compras",
  "an empty slot is a result": "un hueco vacío también es un resultado",
  "The whole portfolio": "La cartera completa",
  "No open positions right now.": "Ahora mismo no hay posiciones abiertas.",
  "Stock": "Acción",
  "Since": "Desde",
  "Percentile at entry": "Percentil a la entrada",
  "Entry price": "Precio de entrada",
  "All {x} that were sold, with their result and their reason. No exceptions: publishing only the winners is what makes the industry's track records worthless.":
    "Las {x} que se vendieron, con su resultado y su motivo. Sin excepciones: publicar solo las ganadoras es lo que deja sin valor los historiales del sector.",
  "No position has been closed yet.": "Aún no se ha cerrado ninguna posición.",
  "Bought": "Comprada",
  "Sold": "Vendida",
  "Why it was sold": "Por qué se vendió",
  "Every decision, including the ones not to buy": "Cada decisión, también las de no comprar",
  "The system looks on the 1st and the 15th. If nothing meets the rules, it doesn't buy — and that date still appears here. Without these rows, a day with no buys would be indistinguishable from a stalled system.":
    "El sistema mira los días 1 y 15. Si nada cumple las reglas, no compra, y esa fecha aparece igualmente aquí. Sin estas filas, un día sin compras no se distinguiría de un sistema parado.",
  "Eligible": "Elegibles",
  "Buys": "Compras",
  "Sells": "Ventas",
  "Portfolio": "Cartera",
  "The rules, in five lines": "Las reglas, en cinco líneas",
  "<s1>What gets bought:</s1> S&P 500 stocks in the top {x}% by quality — gross profitability on assets, ROIC, operating margin, interest coverage and net debt. All from the financial statements; nothing from the price.":
    "<s1>Qué se compra:</s1> acciones del S&P 500 en el {x}% con más calidad: rentabilidad bruta sobre activos, ROIC, margen operativo, cobertura de intereses y deuda neta. Todo de los estados financieros; nada del precio.",
  "<s1>When:</s1> the first business day and the 15th, {x} stocks each time. Fixed dates: not brought forward because the market falls, not delayed because it \"looks expensive\".":
    "<s1>Cuándo:</s1> el primer día hábil y el 15, {x} acciones cada vez. Fechas fijas: no se adelantan porque el mercado caiga ni se retrasan porque «parezca caro».",
  "<s1>Persistence:</s1> the threshold must be met {x} days in a row. Without it you buy a one-day spike.": "<s1>Persistencia:</s1> hay que cumplir el umbral {x} días seguidos. Sin eso compras un pico de un día.",
  "<s1>When it sells:</s1> if the signal falls below the {x}th percentile in two evaluations in a row, if a pillar enters the bottom decile of its sector, or if it stops meeting the universe. <s2>There is no price stop-loss</s2>: a stop is a rule about the price, not about the business.":
    "<s1>Cuándo vende:</s1> si la señal cae por debajo del percentil {x} en dos evaluaciones seguidas, si un pilar entra en el peor decil de su sector o si deja de cumplir el universo. <s2>No hay stop de pérdidas por precio</s2>: un stop es una regla sobre el precio, no sobre el negocio.",
  "<s1>Weights:</s1> equal-weighted, capped at {a} positions, and a stock that is sold can't return for {b} months.": "<s1>Pesos:</s1> igual peso, con un máximo de {a} posiciones, y una acción vendida no puede volver en {b} meses.",
  "It is measured against three benchmarks, and the third is the one that really tells whether selection adds anything: the S&P 500, its equal-weighted version, and the equal-weighted eligible universe. If after 24 months it is below that third one, the result is published and the product is shut down.":
    "Se mide frente a tres referencias, y la tercera es la que de verdad dice si la selección aporta algo: el S&P 500, su versión con igual peso y el universo elegible con igual peso. Si después de 24 meses está por debajo de esa tercera, se publica el resultado y se cierra el producto.",
};
