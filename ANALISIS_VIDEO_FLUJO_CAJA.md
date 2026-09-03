# Análisis · «Tardé años en entender el flujo de caja» — y qué de esto puede dar Scora

**Fecha:** 2026-09-03 · **Fuente:** transcripción completa aportada por Alejandro
**Estado:** analizado y con la cobertura de datos MEDIDA. Pendiente de fundir con los otros dos
vídeos en un plan conjunto.

---

## 1 · La tesis, en una frase

> **«Lo que no es caja, no vale. No mires sólo el beneficio, mira siempre cómo se genera y dónde
> va la caja.»**

El mecanismo que lo explica es el **principio de devengo**: el beneficio reconoce ingresos que aún
no se han cobrado (cuentas por cobrar) y gastos que ya se pagaron hace años (depreciación). Por eso
beneficio y caja divergen, y por eso una empresa puede batir estimaciones y caer en bolsa.

## 2 · Los tres niveles que enseña

### Nivel 1 · La estructura
```
caja inicial + CFO + CFI + CFF + efecto divisa = caja final
```
Su ejemplo (Meta 2025): `115.800 − 102.000 − 20.370 = −6.500`, más 235 M$ de divisa.

### Nivel 2 · El puente (método indirecto)
```
beneficio neto  60.458
  + depreciación            +18.000     no salió caja: el activo se pagó hace años
  + compensación acciones   +20.427     se paga en acciones, no en efectivo
  − Δ cuentas por cobrar     −1.815     se reconoció el ingreso pero no se cobró
  − Δ inventario                        se pagó y aún no se ha vendido
  + Δ proveedores                       se recibió y aún no se ha pagado
  + otros ajustes           +17.000
  = CFO                    115.800
```
**Circulante operativo** = cobros + inventario − proveedores (excluyendo caja y deuda corto plazo).

### Nivel 3 · El juicio — lo aprovechable, porque son reglas comprobables

| señal | regla |
|---|---|
| **Cash conversion** | CFO ÷ beneficio neto. Mala si está **persistentemente < 1** |
| Margen CFO | CFO ÷ ventas, debe expandirse (Meta ~50 %) |
| Crecimiento del CFO | estable y lineal, no a saltos |
| **P/CFO** | en vez del PER. Meta a 11× contra su media de 14-15× a 10 años |
| Capex / ventas | para ver si la inversión se dispara |
| **FCF** | CFO − capex. Meta: `115.800 − 69.691 = 46.000` |
| **FCF yield** | inversa de P/FCF. *«A partir del 4-5 % empieza a ser atractivo.»* Meta al 2,8 % → cotiza a ~40× FCF |
| FCF apalancado vs no | sin apalancar valora el NEGOCIO; apalancado, lo que queda al ACCIONISTA |
| 🚩 | cobros disparados: no te están pagando |
| 🚩 | inventario acumulándose |
| 🚩 | deuda subiendo con CFO débil |
| 🚩 | **recompras financiadas con deuda** — *«red flag de manual»* |
| 🚩 | dividendos financiados con deuda |
| 🚩 | capex disparado que no se traduce en CFO |

⚠️ Y un matiz suyo que conviene conservar: el CFO **vuelve a sumar** la compensación en acciones
porque no hay salida de caja — pero eso **diluye al accionista**. Al llegar al FCF hay que decidir
si se resta o no, y decirlo. Meta: 22.312 M$, casi la mitad de su FCF.

---

## 3 · Cobertura MEDIDA sobre 45 nombres del S&P 500 (2026-09-03)

| dato | cobertura |
|---|---:|
| Flujo de caja operativo (CFO) | **100 %** |
| Beneficio neto | **100 %** |
| **Cash conversion** (la métrica nº 1 del vídeo) | **100 %** |
| Compensación en acciones | 98 % |
| Cuentas por cobrar | 80 % |
| Capex → FCF | 78 % |

**Muy por encima del Sankey de resultados** (85 % dibujable, 32 % completo). Y ya expuestos en
`fundamentalsAsOf`: `buybacksTTM`, `dividendsTTM`, `debt`, `cffTTM`, `fxCashTTM` (el efecto divisa),
`receivables`, `inventory`, `sbcTTM`.

⚠️ **Hipótesis SIN comprobar:** que el 22 % sin capex sean financieras, donde el FCF no es un
concepto con sentido. Hay que medirlo antes de afirmarlo — es exactamente el tipo de suposición
cómoda que ya ha costado caro en este repo.

### Lo que falta
Sólo tres extracciones, y las tres son del **nivel 2**: **D&A**, **proveedores** e **ICF expuesto**.
Los niveles 1 y 3 son construibles hoy.

---

## 4 · Qué construir (borrador, a fundir con los otros dos vídeos)

| # | qué | cobertura | coste |
|---|---|---|---|
| ① | **Sankey de caja** — el gemelo del de resultados: CFO → capex → adquisiciones → recompras → dividendos → deuda → caja final. Mismo listón: si no cuadra con la variación de caja, no se publica | 78-100 % | medio |
| ② | **Diagnóstico de calidad del beneficio** — cash conversion, margen CFO, capex/ventas, FCF yield | **100 %** en la principal | **bajo** |
| ③ | **Las cuatro banderas rojas** — lo que ningún competidor retail enseña. La de recompras-con-deuda es la más valiosa | alta | **bajo** |
| ④ | **Puente beneficio → caja** | requiere las 3 extracciones que faltan | medio |

**Recomendación de arranque: ② y ③.** Cobertura completa en la métrica principal, cero
dependencias nuevas, y encajan con lo que ya está demostrado que funciona en Scora — medir y decir
la verdad, no predecir.

---

## 5 · Dónde encaja esto en el producto

Este vídeo es la **capa MICRO** (empresa). Los otros dos que Alejandro va a pasar cubren:

- **Macro / divisa y soberano** — *The UNTHINKABLE… Japan & the Dollar (Gold Isn't Ready)*
- **Tipos / bonos** — *If You Don't Understand Bonds, You Don't Understand Money*

Huecos ya verificados en esas dos capas: el régimen **no tiene ninguna dimensión de divisa ni
soberano** (sólo `WALCL`, `WTREGEN`, `RRPONTSYD`, `T10Y3M`, `SAHMREALTIME`, `STLFSI4`), y de tipos
sólo usa **un diferencial** (`T10Y3M`) — sin curva, sin tramos, sin tipos reales.

El plan conjunto tiene que decidir el orden entre las tres capas, no construirlas en paralelo.
