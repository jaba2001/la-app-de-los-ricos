// Catálogos fijos de lib/: la lectura geopolítica (lib/geopolitics.ts) y la biblioteca de
// análogos históricos (lib/historicalAnalogs.ts). Texto largo y estable: se traduce entero.
export const CATALOGOS: Record<string, string> = {
  // ── Geopolítica: lectura del momento ──
  "Low risk": "Riesgo bajo",
  "Elevated risk": "Riesgo elevado",
  "High risk": "Riesgo alto",
  "Geopolitical-risk composite {a}/100.": "Compuesto de riesgo geopolítico {a}/100.",
  "Oil-shock signal: {a}.": "Señal de choque del petróleo: {a}.",
  "shock ↑": "choque ↑",
  "shock ↓": "choque ↓",
  "Brent ~${a} (WTI {b}% 1m).": "Brent ~{a} $ (WTI {b}% en 1 mes).",
  "Brent ~${a}.": "Brent ~{a} $.",
  "Broad USD index {a} (Fed, trade-weighted) — a stronger dollar tightens global conditions.": "Índice amplio del dólar {a} (Fed, ponderado por comercio): un dólar más fuerte endurece las condiciones globales.",
  "Limited geopolitical inputs in the current snapshot.": "Pocos datos geopolíticos en la foto actual.",
  "Risk-off geopolitics favors energy, defense, gold and the dollar; it pressures import-dependent Europe and long-duration risk.":
    "Una geopolítica de aversión al riesgo favorece la energía, la defensa, el oro y el dólar; presiona a una Europa dependiente de importaciones y al riesgo de larga duración.",
  "Keep some hedges (energy/gold) but the backdrop isn't crisis-level; stay led by the domestic macro regime.":
    "Mantén algunas coberturas (energía/oro), pero el entorno no es de crisis: déjate guiar por el régimen macro doméstico.",
  "Benign geopolitics — let the domestic liquidity/credit regime drive positioning, not headlines.":
    "Geopolítica benigna: que el posicionamiento lo marque el régimen doméstico de liquidez y crédito, no los titulares.",

  // ── Geopolítica: bloques de poder ──
  "United States": "Estados Unidos",
  "Incumbent hegemon; the dollar as both weapon and safe haven.": "Potencia hegemónica; el dólar como arma y como refugio a la vez.",
  "Elections, debt ceiling, Fed policy, semiconductor controls.": "Elecciones, techo de deuda, política de la Fed, controles a los semiconductores.",
  "USD, Treasuries, mega-cap tech.": "Dólar, bonos del Tesoro, grandes tecnológicas.",
  "Structural challenger; manufacturing base and rare-earth chokehold.": "Aspirante estructural; base manufacturera y control de las tierras raras.",
  "Taiwan, local-government & property debt, tech decoupling.": "Taiwán, deuda de gobiernos locales e inmobiliaria, desacoplamiento tecnológico.",
  "Industrial metals, semis, European luxury.": "Metales industriales, semiconductores, lujo europeo.",
  "Russia / Post-Soviet": "Rusia / espacio postsoviético",
  "Resource power — gas, oil, grain.": "Potencia de recursos: gas, petróleo, grano.",
  "Ukraine, energy flows to Europe, sanctions & re-routing.": "Ucrania, flujos de energía hacia Europa, sanciones y desvíos.",
  "European gas, oil, wheat, gold.": "Gas europeo, petróleo, trigo, oro.",
  "Middle East": "Oriente Medio",
  "Oil swing producer (OPEC+) and key shipping lanes.": "Productor bisagra de petróleo (OPEP+) y rutas marítimas clave.",
  "Strait of Hormuz, Israel–Iran, crude risk premia.": "Estrecho de Ormuz, Israel–Irán, primas de riesgo del crudo.",
  "Brent, defense, defensives.": "Brent, defensa, valores defensivos.",
  "Europe / EU": "Europa / UE",
  "Trade bloc dependent on imported energy.": "Bloque comercial dependiente de la energía importada.",
  "Energy security, fiscal fragmentation, industrial competitiveness.": "Seguridad energética, fragmentación fiscal, competitividad industrial.",
  "EUR, autos, industrials.": "Euro, automóvil, industriales.",
  "Latin America": "América Latina",
  "Commodity supplier — copper, lithium, grains, oil.": "Proveedor de materias primas: cobre, litio, grano, petróleo.",
  "Commodity cycle, politics, nearshoring flows.": "Ciclo de materias primas, política, flujos de relocalización cercana.",
  "Copper, lithium, agriculture, energy.": "Cobre, litio, agricultura, energía.",
  "India / South Asia": "India / Sur de Asia",
  "Rising demographic and manufacturing alternative to China.": "Alternativa a China en auge, por demografía y por manufactura.",
  "Supply-chain diversification, energy imports, regional tensions.": "Diversificación de cadenas de suministro, importaciones de energía, tensiones regionales.",
  "EM equity, domestic demand plays.": "Bolsa emergente, apuestas por la demanda interna.",

  // ── Geopolítica: cuellos de botella ──
  "Strait of Hormuz": "Estrecho de Ormuz",
  "Crude oil & LNG (~20% of global oil)": "Crudo y GNL (~20% del petróleo mundial)",
  "Iran–Gulf tension can close or threaten transit → crude spike.": "La tensión entre Irán y el Golfo puede cerrar o amenazar el paso → subida brusca del crudo.",
  "Energy, defense, US shale, tankers.": "Energía, defensa, esquisto de EE. UU., petroleros.",
  "Bab-el-Mandeb / Suez": "Bab el-Mandeb / Suez",
  "Oil & container trade Europe↔Asia": "Petróleo y contenedores Europa↔Asia",
  "Red Sea attacks reroute ships around Africa → freight + delivery costs up.": "Los ataques en el mar Rojo desvían los barcos rodeando África → suben fletes y costes de entrega.",
  "Shipping rates, oil, inventories-heavy retailers hurt.": "Fletes y petróleo; sufren los minoristas con mucho inventario.",
  "Strait of Malacca": "Estrecho de Malaca",
  "Asia-bound oil & trade (~25% of traded goods)": "Petróleo y comercio hacia Asia (~25% de los bienes comerciados)",
  "China's 'Malacca dilemma' — a blockade chokes Chinese energy imports.": "El «dilema de Malaca» de China: un bloqueo ahoga sus importaciones de energía.",
  "Overland pipelines, alt routes, defense.": "Oleoductos terrestres, rutas alternativas, defensa.",
  "Taiwan Strait": "Estrecho de Taiwán",
  "Advanced semiconductors (TSMC ~90% leading-edge)": "Semiconductores avanzados (TSMC ~90% de la vanguardia)",
  "A Taiwan crisis would halt the world's leading-edge chip supply.": "Una crisis en Taiwán pararía el suministro mundial de chips de vanguardia.",
  "Onshore fabs (US/Japan), chip-equipment, defense.": "Fábricas locales (EE. UU./Japón), equipos para chips, defensa.",
  "Russian pipeline gas": "Gas ruso por gasoducto",
  "Natural gas to Europe": "Gas natural hacia Europa",
  "Cut-offs / sanctions force LNG imports → European gas & power prices.": "Cortes y sanciones obligan a importar GNL → precios europeos del gas y la electricidad.",
  "US LNG, Qatar, European utilities hurt, coal.": "GNL de EE. UU., Catar, carbón; sufren las eléctricas europeas.",
  "China rare-earth refining": "Refino chino de tierras raras",
  "Rare earths & processing (~70-90%)": "Tierras raras y su procesado (~70-90%)",
  "Export controls choke magnets for EVs, wind, defense.": "Los controles a la exportación ahogan los imanes para coches eléctricos, eólica y defensa.",
  "Ex-China miners/refiners, recyclers, defense primes.": "Mineras y refinadoras fuera de China, recicladoras, grandes contratistas de defensa.",
  "Panama Canal": "Canal de Panamá",
  "US grain, LNG, container trade": "Grano de EE. UU., GNL, contenedores",
  "Drought cuts transits → longer routes, higher costs.": "La sequía reduce los tránsitos → rutas más largas, costes más altos.",
  "Shipping, US Gulf exporters affected.": "Afecta al transporte marítimo y a los exportadores del golfo de EE. UU.",
  "LatAm copper & lithium": "Cobre y litio latinoamericanos",
  "Copper (Chile/Peru), lithium (Chile/Argentina)": "Cobre (Chile/Perú), litio (Chile/Argentina)",
  "Politics/resource-nationalism disrupts the energy-transition metals.": "La política y el nacionalismo de recursos alteran los metales de la transición energética.",
  "Diversified miners, recyclers, substitutes.": "Mineras diversificadas, recicladoras, sustitutos.",

  // ── Análogos históricos ──
  "2008 Global Financial Crisis": "Crisis financiera global de 2008",
  "Sep 2008 – Mar 2009": "sep 2008 – mar 2009",
  "Lehman Brothers collapse exposed systemic leverage in mortgage-backed securities and the shadow banking system.":
    "La quiebra de Lehman Brothers dejó al descubierto el apalancamiento sistémico en los títulos hipotecarios y en la banca en la sombra.",
  "A housing bubble built over years of subprime lending unwound rapidly once securitized credit froze. Interbank lending seized up, money-market funds broke the buck, and the Fed/Treasury moved to emergency liquidity facilities and bank recapitalization.":
    "Una burbuja inmobiliaria construida durante años de préstamos subprime se deshizo deprisa en cuanto se congeló el crédito titulizado. El préstamo interbancario se paralizó, los fondos monetarios «rompieron el dólar» y la Fed y el Tesoro pasaron a líneas de liquidez de emergencia y a recapitalizar bancos.",
  "Equities bottomed in March 2009 after a ~55% peak-to-trough drawdown. The subsequent recovery was slow and multi-year, but laid the groundwork for the longest bull market on record once QE took hold.":
    "La bolsa tocó fondo en marzo de 2009 tras una caída de ~55% de máximo a mínimo. La recuperación fue lenta y duró años, pero sentó las bases del mercado alcista más largo registrado una vez que el QE hizo efecto.",
  "2011 Eurozone Debt Crisis": "Crisis de deuda de la eurozona de 2011",
  "Jul 2011 – Oct 2011": "jul 2011 – oct 2011",
  "Sovereign-debt fears around Greece, Portugal, Ireland, Italy and Spain raised the risk of a Eurozone banking/currency crisis.":
    "El miedo a la deuda soberana de Grecia, Portugal, Irlanda, Italia y España elevó el riesgo de una crisis bancaria y monetaria en la eurozona.",
  "Contagion concerns spread to European banks holding peripheral sovereign debt; the US lost its AAA credit rating from S&P in the same window, compounding risk-off sentiment globally.":
    "El temor al contagio se extendió a los bancos europeos con deuda soberana periférica; en esas mismas semanas EE. UU. perdió la calificación AAA de S&P, lo que agravó la aversión al riesgo en todo el mundo.",
  "ECB's later 'whatever it takes' commitment (2012) eventually calmed the crisis. US equities recovered within months — sharp but contained relative to 2008.":
    "El posterior compromiso del BCE de hacer «lo que haga falta» (2012) acabó calmando la crisis. La bolsa de EE. UU. se recuperó en meses: un episodio brusco pero contenido comparado con 2008.",
  "2013 Taper Tantrum": "Rabieta del «taper» de 2013",
  "May 2013 – Sep 2013": "may 2013 – sep 2013",
  "Fed Chair Bernanke signaled the central bank could begin tapering QE asset purchases sooner than markets expected.":
    "El presidente de la Fed, Bernanke, dio a entender que el banco central podría empezar a reducir las compras de activos del QE antes de lo que esperaba el mercado.",
  "This was a rates/liquidity-expectations shock rather than a credit or recession event — the real economy was fine, but bond markets repriced the path of future Fed policy violently.":
    "Fue un choque de expectativas de tipos y liquidez, no un episodio de crédito ni de recesión: la economía real estaba bien, pero el mercado de bonos revalorizó con violencia la senda futura de la Fed.",
  "Equities wobbled but stayed resilient (single-digit drawdown); the real damage was concentrated in long-duration bonds and emerging markets, which saw sharp capital outflows.":
    "La bolsa se tambaleó pero aguantó (caída de un dígito); el daño real se concentró en los bonos de larga duración y en los emergentes, que sufrieron fuertes salidas de capital.",
  "2015–16 China Devaluation & Oil Crash": "Devaluación china y desplome del petróleo, 2015–16",
  "Aug 2015 – Feb 2016": "ago 2015 – feb 2016",
  "China's surprise yuan devaluation rattled global growth expectations just as oil prices collapsed on oversupply (shale boom + OPEC non-cuts).":
    "La devaluación sorpresa del yuan sacudió las expectativas de crecimiento mundial justo cuando el petróleo se hundía por exceso de oferta (auge del esquisto y una OPEP que no recortaba).",
  "Fears of a China-led global slowdown combined with energy-sector credit stress (high-yield energy bonds sold off sharply) to produce a broad but ultimately contained risk-off episode.":
    "El miedo a una desaceleración mundial liderada por China se sumó a la tensión de crédito del sector energético (los bonos energéticos de alto rendimiento se desplomaron) y produjo un episodio de aversión al riesgo amplio pero, al final, contenido.",
  "Markets stabilized once oil bottomed (~$26/bbl, Feb 2016) and Chinese policymakers signaled support; no US recession materialized.":
    "Los mercados se estabilizaron cuando el petróleo tocó fondo (~26 $/barril, feb 2016) y las autoridades chinas dieron señales de apoyo; no llegó ninguna recesión en EE. UU.",
  "2018 Q4 Selloff": "Caída del 4.º trimestre de 2018",
  "Oct 2018 – Dec 2018": "oct 2018 – dic 2018",
  "The Fed continued hiking and running QT into visible signs of slowing global growth and an escalating US-China trade war.":
    "La Fed siguió subiendo tipos y reduciendo balance (QT) pese a señales visibles de desaceleración mundial y a una guerra comercial entre EE. UU. y China cada vez más intensa.",
  "Markets priced in a policy mistake — tightening into a slowdown — amplified by thin December liquidity and systematic/quant deleveraging.":
    "El mercado descontó un error de política (endurecer en plena desaceleración), amplificado por la escasa liquidez de diciembre y el desapalancamiento de los fondos sistemáticos y cuantitativos.",
  "The Fed pivoted dovish in January 2019 (the 'Powell pivot'), and equities staged a fast V-shaped recovery.":
    "La Fed giró hacia una postura más laxa en enero de 2019 (el «giro de Powell») y la bolsa protagonizó una rápida recuperación en V.",
  "2020 COVID Crash": "Desplome por la COVID de 2020",
  "Feb 2020 – Mar 2020": "feb 2020 – mar 2020",
  "Global COVID-19 lockdowns triggered an abrupt, simultaneous demand and supply shock across the entire economy.":
    "Los confinamientos mundiales por la COVID-19 provocaron un choque brusco y simultáneo de demanda y de oferta en toda la economía.",
  "This was the fastest bear market on record — a liquidity and growth shock hitting at once. The Fed and Treasury responded within weeks with emergency rate cuts, unlimited QE, and direct fiscal support, an unusually fast liquidity reversal.":
    "Fue el mercado bajista más rápido registrado: un choque de liquidez y de crecimiento a la vez. La Fed y el Tesoro respondieron en semanas con bajadas de tipos de emergencia, QE ilimitado y apoyo fiscal directo, un giro de liquidez inusualmente rápido.",
  "Markets bottomed in just over a month and staged the fastest recovery on record, fueled by emergency liquidity and fiscal stimulus — note the liquidity composite would have V-shaped given the speed of the Fed's response.":
    "El mercado tocó fondo en poco más de un mes y protagonizó la recuperación más rápida registrada, impulsada por la liquidez de emergencia y el estímulo fiscal. Ojo: el compuesto de liquidez habría dibujado una V por la rapidez de la respuesta de la Fed.",
  "2021–22 Inflation Surge": "Repunte de la inflación de 2021–22",
  "Early 2021 – Mid 2022": "principios de 2021 – mediados de 2022",
  "Post-COVID fiscal stimulus, supply-chain disruption, and pent-up demand combined to push inflation to 40-year highs.":
    "El estímulo fiscal tras la COVID, los atascos en las cadenas de suministro y la demanda embalsada llevaron la inflación a máximos de 40 años.",
  "The Fed initially characterized inflation as 'transitory' before reversing course; this period bridges an easy-liquidity reflation regime into the tightening cycle that followed.":
    "La Fed calificó al principio la inflación de «transitoria» antes de dar marcha atrás; este periodo hace de puente entre un régimen de reflación con liquidez abundante y el ciclo de endurecimiento que vino después.",
  "Energy and commodities surged on the inflation/supply story while long-duration growth equities began derating as real yields rose — the bridge into the 2022 bear market.":
    "La energía y las materias primas se dispararon por la inflación y los problemas de oferta, mientras las acciones de crecimiento de larga duración empezaban a perder múltiplo al subir la rentabilidad real: el puente hacia el mercado bajista de 2022.",
  "2022 Rate-Hike Bear Market": "Mercado bajista de las subidas de tipos de 2022",
  "Jan 2022 – Oct 2022": "ene 2022 – oct 2022",
  "The Fed launched its fastest hiking cycle in decades to fight persistent inflation, simultaneously running aggressive QT.":
    "La Fed lanzó su ciclo de subidas más rápido en décadas para combatir una inflación persistente, a la vez que reducía balance (QT) de forma agresiva.",
  "Liquidity contracted sharply (LCC collapsing) while inflation stayed elevated — the textbook stagflationary backdrop. Russia's invasion of Ukraine in February added a geopolitical/energy shock on top.":
    "La liquidez se contrajo con fuerza (el LCC se hundía) mientras la inflación seguía alta: el entorno estanflacionario de manual. La invasión rusa de Ucrania en febrero añadió encima un choque geopolítico y energético.",
  "Equities bottomed in October 2022 once inflation showed signs of peaking and the market began pricing a slower hiking pace; Energy was the only S&P sector to post a positive return for the full year.":
    "La bolsa tocó fondo en octubre de 2022, cuando la inflación dio señales de haber tocado techo y el mercado empezó a descontar subidas más lentas; la energía fue el único sector del S&P con rentabilidad positiva en el año.",
  "2023 SVB / Regional Banking Crisis": "SVB y crisis de la banca regional de 2023",
  "Mar 2023 – May 2023": "mar 2023 – may 2023",
  "Silicon Valley Bank's collapse — driven by unrealized losses on long-duration bonds amid rapid rate hikes plus a concentrated, uninsured deposit base — triggered a regional-bank confidence crisis.":
    "La caída de Silicon Valley Bank —por pérdidas latentes en bonos de larga duración tras unas subidas de tipos rápidas y por una base de depósitos concentrada y sin asegurar— desató una crisis de confianza en la banca regional.",
  "Unlike 2008, this was a narrow, contained credit-stress spike within an otherwise neutral-to-expansion macro backdrop: the broader economy and large-bank balance sheets were not impaired the way they were in the GFC.":
    "A diferencia de 2008, fue un repunte de tensión de crédito estrecho y contenido dentro de un entorno macro entre neutral y expansivo: la economía en general y los balances de los grandes bancos no quedaron dañados como en la crisis financiera.",
  "Swift FDIC/Fed intervention (Bank Term Funding Program) contained contagion. The selloff was sharp but narrow — regional banks were hit hard while mega-cap tech, helped by an emerging AI narrative and flight-to-quality flows, kept rising. A useful 'false-alarm vs. 2008' contrast case despite surface similarity.":
    "La rápida intervención de la FDIC y la Fed (Bank Term Funding Program) contuvo el contagio. La caída fue brusca pero estrecha: la banca regional sufrió mucho mientras las grandes tecnológicas, ayudadas por el relato incipiente de la IA y por la huida hacia la calidad, seguían subiendo. Un caso útil de «falsa alarma frente a 2008» pese al parecido superficial.",
  "2023–24 AI-Led Melt-Up": "Euforia impulsada por la IA, 2023–24",
  "2023 – 2024": "2023 – 2024",
  "Generative-AI capex and earnings momentum (led by a handful of mega-cap names) drove a narrow but powerful equity rally as inflation cooled and rate-cut expectations built.":
    "La inversión en IA generativa y el impulso de los beneficios (liderados por un puñado de grandes compañías) provocaron una subida bursátil estrecha pero potente mientras la inflación se enfriaba y crecían las expectativas de bajadas de tipos.",
  "A genuinely benign expansion regime — included deliberately so the analog library isn't structurally skewed toward only ever surfacing crisis comparisons. Liquidity conditions eased, credit stayed calm, and recession fears receded even as leadership concentrated heavily in Technology and Communication Services.":
    "Un régimen de expansión de verdad benigno, incluido a propósito para que la biblioteca de análogos no esté sesgada a sacar solo comparaciones con crisis. La liquidez se relajó, el crédito siguió tranquilo y el miedo a la recesión se disipó, aunque el liderazgo se concentró mucho en Tecnología y Comunicaciones.",
  "Index-level gains were strong but narrow; breadth lagged the headline indices, a dynamic worth flagging whenever this regime is the closest match.":
    "Las subidas de los índices fueron fuertes pero estrechas; la amplitud se quedó por detrás de los índices principales, algo que conviene señalar siempre que este régimen sea el más parecido.",
};
