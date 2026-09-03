# Preregistro · ensayo 343 — ¿mejoran las capas nuevas el score?

**Escrito el 2026-09-03 ANTES de medir nada.** El registro de ensayos va por 342.

> Alejandro pidió abrirlo: *«prueba absolutamente todo, quiero que todo sume y bata el índice»*.
> Este documento existe para que ese deseo no decida el resultado. Se escribe primero la regla,
> se mide después, y se publica lo que salga.

---

## 1 · La hipótesis

> **H7.** Añadir al score micro las medidas de calidad de caja —conversión a caja y banderas
> rojas— y de calidad contable —vida útil implícita y precio de recompra— mejora el perfil
> ajustado al riesgo de la cartera de picks frente al score actual.

Se prueban en este orden, y cada una es **una hipótesis separada**:

| # | medida | disponible point-in-time |
|---|---|---|
| H7a | Conversión a caja (CFO/beneficio) | ✅ ya |
| H7b | Nº de banderas rojas de caja | ✅ ya |
| H7c | Vida útil implícita | ❌ requiere extraer `PropertyPlantAndEquipmentGross` |
| H7d | Retorno desde el precio de recompra | ❌ requiere extraer `TreasuryStockSharesAcquired` |

## 2 · El criterio, escrito antes

Una medida **entra** sólo si cumple **las tres**:

1. **Sharpe mejor que el score actual en las DOS ventanas** (2011-2018 y 2019-2026). No vale
   mejorar en una y empeorar en la otra: eso es elegir la ventana.
2. **Sharpe deflactado > 0** con `M = 343` ensayos. Con 342 gastados, el listón de un hallazgo
   nuevo es alto y ésa es exactamente la razón de llevar el registro.
3. **La mejora sobrevive al coste**: 10 pb por lado de rotación, ya incluidos en el motor.

Y una condición de honestidad que no es negociable:

4. **Una sola especificación por medida. Cero barridos.** El peso de la nueva señal se fija
   ANTES (ver §3) y no se ajusta. Si el resultado no gusta, se escribe que no gustó.

## 3 · La especificación, fijada ahora

- La medida entra como **un quinto componente del score micro**, con peso **10 %**, reescalando
  los cuatro pilares actuales a 90 %. El 10 % no está optimizado: es el peso más pequeño que
  puede mover algo, elegido para minimizar el daño si la señal es ruido.
- Cada medida se convierte a **percentil del universo en esa fecha** (0-100), igual que hacen
  los pilares. Sin umbrales nuevos, sin bandas, sin parámetros libres.
- Las empresas **sin el dato reciben el percentil 50** — neutro. No se las excluye, porque
  excluirlas cambiaría el universo y eso es otra cosa.
- **Signo declarado ahora**, antes de mirar:
  - conversión a caja: **más es mejor**
  - banderas rojas: **menos es mejor**
  - vida útil implícita: **menos es mejor** (alargarla infla el beneficio)
  - retorno desde la recompra: **más es mejor** (compraron barato)

## 4 · Lo que este ensayo NO va a hacer

- No se prueban combinaciones de las cuatro. Cada una por separado; combinarlas después de ver
  cuál gana es el barrido que el registro de ensayos existe para impedir.
- No se ajusta el 10 %. Si la señal sólo funciona al 30 %, es que no funciona.
- No se cambia el universo, ni las reglas de rotación, ni el gate de correlación.
- No se prueba sobre una sola ventana.

## 5 · Qué se publica

**Salga lo que salga.** Si las cuatro fallan, se escribe que fallaron y las capas se quedan
donde están —explicativas, que ya es su sitio— y el registro sube a 343.

El precedente está a mano: el aviso de ensanchamiento del crédito también era información nueva
y ortogonal, y resultó **p = 0,146**. Que una medida sea distinta de lo que hay no la hace útil.
