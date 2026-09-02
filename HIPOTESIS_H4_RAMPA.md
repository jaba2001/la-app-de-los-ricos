# H4 · El precio de la rampa

**Preespecificada el 2026-09-02, ANTES de correr nada.** Se escribe primero para que ni la
predicción ni el criterio de éxito se puedan mover después de ver el resultado. Ensayo nº 343 del
presupuesto.

---

## El hecho de partida, ya medido

El backtest publica dos curvas, y la diferencia entre ellas es enorme:

| | reciente 2018-26 | antigua 2011-18 |
|---|---:|---:|
| **soloPicks** — sólo lo comprado, equiponderado | 209,7 % | 154,8 % |
| **conCaja** — lo que vive el suscriptor | **126 %** | **73,3 %** |
| SPY | 237,3 % | 134,9 % |
| `H3_precioDeLaRampaPp` | **83,7 pp** | 81,5 pp |

La causa está en el modelo A de `valorar()`: **`caja = 100` y cada compra toma
`min(caja, patrimonio / 40)`, con UNA compra por fecha de decisión.** Hacen falta ~40 fechas para
desplegarse. Y la caja parada **renta 0 %**, lo cual está declarado en el propio código.

O sea que la cartera pasa sus primeros años mayoritariamente en efectivo, y encima ese efectivo
no renta nada. Los primeros años son los que más componen.

## La hipótesis

> **H4.** La brecha de 83,7 pp no es un defecto de la selección sino de que el capital está
> parado. Si la parte no invertida se mantiene en el índice en vez de en caja al 0 %, el retorno
> de la cartera real sube sustancialmente.

## El modelo C

**Un solo cambio y CERO parámetros nuevos**, que es deliberado: cada parámetro libre es una
oportunidad de sobreajustar y otro ensayo que gastar.

- Modelo A (actual): la parte no invertida es caja al 0 %.
- **Modelo C (nuevo): la parte no invertida está en SPY.**

Es además lo realista. Nadie tiene el 23 % de su cartera en efectivo durante ocho años esperando
a que salte una regla; lo tiene en el índice. Y convierte a Scora Picks en lo que de verdad
sería: **un sesgo sobre el índice**, no una alternativa a estar invertido.

## La predicción, antes de mirar

**El retorno sube mucho pero NO supera a SPY.** Razón: `soloPicks` (209,7 %) ya es peor que SPY
(237,3 %) en la ventana reciente. Una mezcla de algo peor que SPY con SPY no puede dar más que
SPY. Espero que el modelo C caiga **entre 126 % y 237 %, más cerca del segundo, y por debajo**.

Si saliera POR ENCIMA de SPY, mi razonamiento es incorrecto en algún sitio y hay que encontrar
dónde antes de celebrarlo.

## El criterio de éxito, fijado ahora

Batir al índice significa las dos cosas **a la vez y en las DOS ventanas**:

1. Retorno total del modelo C **> SPY** (237,3 % reciente · 134,9 % antigua)
2. Sharpe del modelo C **≥ Sharpe de SPY** (0,93 reciente · 0,82 antigua)

**Cumplir sólo la 1 no cuenta.** Subir el retorno metiendo más beta lo hace cualquiera con
apalancamiento; lo que hay que demostrar es que aporta por unidad de riesgo. Si sube el retorno y
baja el Sharpe, la conclusión es **«sube el beta, no el alfa»** y se escribe así.

Y por [[cifras-son-banda-no-punto]]: el resultado se lee como banda. Una diferencia menor que el
intercuartil (4-5 pp) no es una diferencia.

## Lo que este ensayo NO prueba

Aunque salga bien: el modelo C **no cambia ni una decisión de compra**. La selección es la misma.
Sólo dice dónde estaba el dinero mientras no había señal. Si el modelo C bate al índice, lo que
lo bate es «índice + sesgo», y hay que decirlo así.

---

# RESULTADO · medido el 2026-09-02

## H4 **NO SE CUMPLE**, en ninguna de las dos ventanas

| | reciente 2019-26 | antigua 2011-18 |
|---|---:|---:|
| modelo A — caja al 0 % | 126,0 % · Sharpe 0,72 · maxDD −26,4 | 73,3 % · 0,68 · −17,2 |
| **modelo C — caja en el índice** | **220,6 % · Sharpe 0,83 · maxDD −34,0** | **130,1 % · 0,74 · −18,2** |
| SPY | 237,3 % · Sharpe 0,93 · maxDD −33,7 | 134,9 % · 0,82 · −18,6 |
| **contra SPY** | **−16,6 pp · Sharpe −0,11** | **−4,8 pp · Sharpe −0,08** |

**La predicción escrita antes de mirar se cumplió**: «cae entre 126 % y 237 %, más cerca del
segundo, y por debajo». Salió 220,6 %.

La rampa era real y **casi toda recuperable**: +94,6 pp sólo por no dejar el dinero parado. Pero
recuperarla no basta. Y el criterio pedía las dos cosas: **falla las dos**, en las dos ventanas.
No hay ambigüedad que discutir.

## Y el drawdown confirma de dónde venía la "ventaja"

El modelo A tenía un maxDD de −26,4 % contra el −33,7 % de SPY. Eso no era gestión de riesgo:
**era estar en efectivo**. Al invertir esa caja, el drawdown se va a −34,0 %, igual que el índice.
La aparente suavidad de la curva la pagaba el 23 % sin invertir.

## Lo que sí explica el resultado, y no es la rampa

| | reciente | antigua |
|---|---:|---:|
| la selección contra SU universo equiponderado | **+37,2 pp** | **+1,3 pp** |
| el índice contra ese mismo universo | **+64,8 pp** | **−18,6 pp** |

En 2019-2026 **la selección sí aporta** —37 pp sobre su universo—, pero el índice ponderado por
capitalización le sacó 65 pp a ese mismo universo. No se pierde por elegir mal: se pierde porque
**no se captura la concentración en las megacapitalizaciones**, que es lo que ha movido al SPY.

En 2011-2018 el índice ponderado PERDÍA contra el equiponderado (−18,6 pp) y aun así el modelo C
no bate al SPY, porque ahí la selección no aporta nada (+1,3 pp, la ventaja que ya se sabía
disuelta — ver [[ventaja-antigua-se-fue-a-cero]]).

## Una advertencia sobre la cifra que solemos citar

`soloPicks` (209,7 % / 154,8 %) **no es una cartera que nadie pueda tener**: se calcula como la
media diaria de los retornos de las posiciones vivas, o sea un equiponderado **reequilibrado cada
día**. Sirve para saber si las elecciones fueron buenas; no para decir lo que gana un suscriptor.
Las cifras publicables son las del modelo A y el modelo C.

## Comprobación de fontanería

`valorar()` afirma ahora que **el modelo C sin ninguna compra reproduce el índice exacto**
(134,9 % vs 134,9 %). Existe porque el modelo C quedó por debajo de sus dos componentes en la
ventana antigua, y sin esta comprobación no había forma de distinguir un efecto de calendario real
de un fallo de fontanería. Es real.

## Conclusión

**Sube el beta, no el alfa.** Ensayo 343 gastado. La rampa está cuantificada y descartada como
explicación suficiente: el problema no es dónde duerme el dinero, es que la selección no supera al
índice ponderado por capitalización en la ventana que importa.
