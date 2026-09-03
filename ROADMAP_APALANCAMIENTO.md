# Roadmap · convertir la ventaja de riesgo en ventaja de retorno

> # ⛔ VÍA CERRADA POR DECISIÓN DE PRODUCTO · 2026-09-03
>
> **«Quisiera evitar apalancamientos, podrían ser peligrosos para una persona sin experiencia.»**
>
> La fase 1 se completó y la idea sobrevivió técnicamente: B a 1,82x da 1.283,3 % frente a
> 670,5 % del índice, con cero llamadas de margen incluso con mantenimiento del 35 %. **Y aun
> así se cierra**, porque un contrato de margen no es un producto para el usuario de Scora: la
> llamada se resuelve en horas, el bróker puede subir el mantenimiento cuando quiera, y el hueco
> de apertura no se deshace.
>
> El ensayo 344 quedó **preregistrado y sin ejecutar**; el registro sigue en 343.
>
> Lo de abajo se conserva **medido y archivado**, no borrado: si algún día hay una audiencia
> distinta, el trabajo está hecho. Ver `PREREGISTRO_ENSAYO_344.md`.

**Fecha:** 2026-09-03 · **Estado:** investigado y medido; **nada implementado**
**Origen:** Alejandro no aceptó que 343 ensayos significaran «no se puede», y tenía razón — no
lo habíamos buscado por aquí.

---

## 0 · Lo medido, sin adornos

| | total | CAGR | Sharpe | vol | caída máx |
|---|---:|---:|---:|---:|---:|
| Scora (como está) | 652,6 % | 10,81 % | **1,010** | 10,8 % | **−17,2 %** |
| S&P 500 | 668,4 % | 10,92 % | 0,722 | 16,3 % | −65,0 % |
| **B** · fijo 1,82x | **1.927,5 %** | 22,78 % | 1,159 | 19,4 % | −30,9 % |
| **C** · volatilidad objetivo, tope 2x | 1.345,8 % | 14,55 % | 0,907 | 16,6 % | −31,2 % |

**El punto de equilibrio: +7,2 pp sobre la letra para B, +6,9 pp para C.** Es un margen muy
ancho — sigue batiendo incluso con un bróker minorista tradicional al +6.

## ⚠️ 1 · Las tres cosas que hay que saber ANTES de ilusionarse

**1. La ventaja de caída depende de incluir 2008.** Comparados sobre el mismo tramo (2012 en
adelante, sin crisis):

| desde 2012 | total | Sharpe | caída máx |
|---|---:|---:|---:|
| B fijo | 1.927,5 % | 1,159 | **−30,9 %** |
| C vol objetivo | 1.035,9 % | 1,099 | −31,2 % |
| S&P 500 | 681,3 % | 1,028 | **−25,4 %** |
| Scora sin apalancar | 491,8 % | **1,193** | −16,6 % |

En una ventana sin crisis, **las versiones apalancadas caen MÁS que el índice**. El «doble
retorno con la mitad de la caída» que dije antes sólo se sostiene con 2008 dentro. Hay que
decirlo así o es publicidad.

**2. Scora sin apalancar tiene el MEJOR Sharpe de los cuatro** (1,193). Apalancar no mejora el
Sharpe: lo baja un poco, que es lo que cuesta la financiación. Lo que hace es **mover el punto
de la recta** — más retorno y más riesgo, en la misma proporción.

**3. La estrategia de debajo sigue teniendo t = 1,47.** No alcanza significación. Apalancar una
ventaja que no es estadísticamente distinta de cero amplifica también su incertidumbre.

## 2 · Las vías de financiación, investigadas

**NINGÚN ETF APALANCADO SIRVE.** Sólo existen sobre índices. No hay instrumento que apalanque
*la cartera de Scora*; usar un 2x del S&P es comprar otra cosa. Eso descarta la vía más obvia y
deja sólo estas:

| vía | diferencial típico | qué exige | riesgo propio |
|---|---:|---|---|
| **Box spread (opciones SPX)** | ~+0,3 pp | permiso de opciones nivel alto y entenderlo | si se hace mal, pérdida grande; vencimiento fijo |
| **Bróker de bajo coste, saldo alto** | ~+1,0 pp | cuenta grande | llamada de margen |
| **Bróker de bajo coste, saldo pequeño** | ~+2,5 pp | — | llamada de margen |
| **Bróker minorista tradicional** | ~+6 pp | — | llamada de margen; el rango habitual es 8-12 % nominal |
| ~~ETF apalancado 2x~~ | — | — | **NO APLICA**: sólo sobre índices, y con decaimiento diario |

⚠️ El ETF apalancado no tiene fila con números **a propósito**. La primera versión le puso un
diferencial «para comparar» y el guardián de variantes idénticas lo cazó: daba exactamente los
mismos totales que la fila del bróker, porque el número no significaba nada. Una fila que
calcula un total para algo que **no se puede hacer** es un no-op con aspecto de resultado.

Los diferenciales son órdenes de magnitud públicos, **no cotizaciones**: hay que verificarlos
con el bróker antes de decidir nada.

**Las cuatro vías viables baten al índice** con este margen de equilibrio. El coste **no es** el
cuello de botella. Los cuellos de botella son otros dos: la llamada de margen y el hueco.

## 3 · B o C

**B (fijo 1,82x) rinde casi el doble que C** y tiene mejor Sharpe. Pero:

- **B no se adapta.** En un régimen de volatilidad alta sigues al 1,82x justo cuando no debes.
- **B tiene un parámetro elegido con 5 años de datos.** C tiene dos (objetivo y tope) pero se
  recalcula con ventana móvil, que es metodológicamente más honesto.
- **B es trivial de implementar; C exige rebalanceo mensual del apalancamiento**, y cada
  rebalanceo son costes y fricción que el backtest no modela del todo.

**Recomendación: preregistrar C, y usar B sólo como cota superior de referencia.** El resultado
de B es más bonito y por eso mismo hay que desconfiar de él.

---

## 4 · El roadmap, en cinco fases

### 🔴 Fase 1 · Modelar el instrumento de verdad *(bloqueante — sin esto no hay nada)*
El backtest actual cobra la financiación y **ya está**. Falta lo que de verdad mata a un
apalancado:

1. **La llamada de margen.** Con Reg T el mantenimiento ronda el 25-30 %. A 1,82x, ¿en qué caída
   salta? Hay que simularlo **mes a mes sobre la serie real**, no en abstracto. Una liquidación
   forzada en el suelo convierte una caída del 31 % en una pérdida permanente.
2. **El hueco.** Un −20 % de apertura a 1,82x son −36 % sin posibilidad de deshacer.
3. **El coste de rebalancear el apalancamiento** en C, mes a mes.

**Criterio de continuación:** si con llamadas de margen simuladas B o C dejan de batir, se
abandona. Y se escribe que se abandonó.

### 🟠 Fase 2 · Preregistrar el ensayo 344
Sólo si la fase 1 sobrevive. Especificación fijada antes: **C**, objetivo = volatilidad del
índice, tope 2x, ventana de 36 meses, financiación al diferencial REAL del bróker elegido.
Criterio: batir al índice **en las dos ventanas** y con la llamada de margen dentro.

### 🟡 Fase 3 · Robustez
- ¿Aguanta con tope 1,5x en vez de 2x? Si sólo funciona al 2x, no funciona.
- ¿Aguanta empezando en otro año? El factor de B sale de los primeros 5 años: hay que ver
  cuánto cambia eligiendo otro tramo.
- Sharpe deflactado con M = 344.

### 🟢 Fase 4 · Producto y encaje legal
Aquí cambia todo: **un producto apalancado no es el mismo producto**. Quien no aguantaba el
−65 % del índice tampoco aguanta un −31 % con llamada de margen. Es otra audiencia, otro perfil
de idoneidad y **otro problema legal**, más gordo que el actual.

**Esto va al abogado JUNTO con lo demás, no después.**

### ⚪ Fase 5 · Sólo entonces, implementación

---

## 5 · Lo que recomiendo hacer mañana

**La fase 1, y sólo la fase 1.** Es la que puede matar la idea, cuesta poco y no gasta ensayo.
Todo lo demás depende de ella.

Y **no cambiar el discurso todavía**. Hoy Scora dice «llegas al mismo sitio sin el pánico». Eso
sigue siendo cierto y es lo único que se puede publicar hasta que la fase 1 esté hecha.
