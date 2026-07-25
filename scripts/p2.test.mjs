// P2 math self-tests — BSM greeks, trend forecast, mean-variance optimizer.
// Run: node --experimental-strip-types --no-warnings scripts/p2.test.mjs
import { blackScholes, breakEven, payoffAtExpiry } from "../lib/greeks.ts";
import { forecastSeries } from "../lib/forecast.ts";
import { minVariance, maxSharpe, portfolioStats, covariance, invert } from "../lib/optimize.ts";

let pass = 0, fail = 0;
function approx(name, got, want, tol = 1e-3) {
  if (Math.abs(got - want) <= tol) { pass++; }
  else { fail++; console.error(`✗ ${name}: got ${got}, want ${want} (tol ${tol})`); }
}
function ok(name, cond) { if (cond) pass++; else { fail++; console.error(`✗ ${name}`); } }

// ── Black-Scholes (textbook: S=K=100, T=1, σ=20%, r=5%, q=0) ──
const call = blackScholes(100, 100, 1, 0.2, 0.05, 0, "call");
const put  = blackScholes(100, 100, 1, 0.2, 0.05, 0, "put");
approx("BSM call price", call.price, 10.4506, 2e-3);
approx("BSM put price",  put.price,  5.5735, 2e-3);
approx("BSM call delta", call.delta, 0.6368, 2e-3);
approx("BSM put delta",  put.delta, -0.3632, 2e-3);
approx("BSM gamma",      call.gamma, 0.018762, 1e-4);
approx("BSM vega(1%)",   call.vega / 100, 0.375240, 1e-3);
// Put-call parity: C − P = S − K·e^(−rT)
approx("put-call parity", call.price - put.price, 100 - 100 * Math.exp(-0.05), 1e-3);
// Expiry degenerate case → intrinsic
approx("BSM at expiry (ITM call)", blackScholes(110, 100, 0, 0.2, 0.05, 0, "call").price, 10, 1e-9);
approx("breakeven call", breakEven(100, 5, "call"), 105, 1e-9);
approx("payoff call ITM net", payoffAtExpiry(120, 100, 5, "call"), 15, 1e-9);

// ── Forecast ──
const geo = forecastSeries([100, 110, 121, 133.1], 2); // perfect +10%/period
ok("forecast geometric method", geo?.method === "geometric");
approx("forecast growth rate", geo.growthRate, 0.10, 1e-3);
approx("forecast next point", geo.points[0], 146.41, 0.05);
approx("forecast r2 ~1", geo.r2, 1, 1e-3);
// non-positive value forces the LINEAR branch: y = 4 − 2·i → next (i=4) = −4
const lin = forecastSeries([4, 2, 0, -2], 1);
ok("forecast linear method", lin?.method === "linear");
approx("forecast linear next", lin.points[0], -4, 1e-6);
ok("forecast too-short → null", forecastSeries([1, 2], 4) === null);

// ── Optimizer ──
const inv = invert([[2, 0], [0, 4]]);
approx("invert diag [0][0]", inv[0][0], 0.5, 1e-9);
approx("invert diag [1][1]", inv[1][1], 0.25, 1e-9);
ok("invert singular → null", invert([[1, 1], [1, 1]]) === null);

const mv = minVariance([[0.04, 0], [0, 0.09]]);
approx("min-var w0", mv[0], 0.6923, 1e-3);
approx("min-var w1", mv[1], 0.3077, 1e-3);
approx("min-var sums to 1", mv[0] + mv[1], 1, 1e-9);

const ms = maxSharpe([0.10, 0.15], [[0.04, 0], [0, 0.09]], 0.02);
approx("max-sharpe w0", ms[0], 0.5806, 1e-3);
approx("max-sharpe w1", ms[1], 0.4194, 1e-3);

const stats = portfolioStats([0.5, 0.5], [0.10, 0.15], [[0.04, 0], [0, 0.09]], 0.02);
approx("port return", stats.ret, 0.125, 1e-9);
approx("port vol", stats.vol, Math.sqrt(0.25 * 0.04 + 0.25 * 0.09), 1e-9);
ok("port sharpe > 0", stats.sharpe > 0);

// covariance sanity: two identical series → equal variances, equal covariance
const cv = covariance([[1, 2, 3, 4], [2, 4, 6, 8]]);
ok("cov symmetric", Math.abs(cv[0][1] - cv[1][0]) < 1e-12);
ok("cov positive var", cv[0][0] > 0 && cv[1][1] > 0);

console.log(`\n${fail === 0 ? "✓" : "✗"} p2 math: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
