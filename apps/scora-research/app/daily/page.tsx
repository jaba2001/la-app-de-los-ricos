// /daily — el cierre más reciente. Server component, público, sin registro.
//
// Es a la vez producto (la razón para volver cada día) y adquisición (compartible e
// indexable). Lo genera el cron `daily-close` (app/api/cron) con una plantilla determinista:
// no hay modelo en el bucle que pueda inventar una cifra.

import type { Metadata } from "next";
import Link from "next/link";
import DailyReportView from "@/components/daily/DailyReportView";
import { fetchDailyClose, fetchDailyDates, dailySummaryLine, formatDayLong } from "@/lib/dailyClose";

export const revalidate = 900;

export async function generateMetadata(): Promise<Metadata> {
  const rep = await fetchDailyClose();
  if (!rep) {
    return {
      title: "Daily close",
      description: "The US market close, measured — sector dispersion, regime and breadth, published every trading day.",
    };
  }
  const summary = dailySummaryLine(rep);
  return {
    // Sin sufijo de marca: el layout ya aplica `template: "%s · Scora Research"`, y
    // añadirlo aquí lo duplicaba en la pestaña y en los resultados de búsqueda.
    title: `Daily close — ${formatDayLong(rep.date)}`,
    description: summary,
    alternates: { canonical: `/daily/${rep.date}` },
    openGraph: {
      title: `Daily close — ${rep.date}`,
      description: summary,
      type: "article",
      url: `/daily/${rep.date}`,
    },
    twitter: { card: "summary_large_image", title: `Daily close — ${rep.date}`, description: summary },
  };
}

export default async function DailyLatestPage() {
  const [report, dates] = await Promise.all([fetchDailyClose(), fetchDailyDates(30)]);

  if (!report) {
    return (
      <div style={{ padding: "var(--sr-sp-6)", maxWidth: 900, margin: "0 auto" }}>
        <h1 style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800, marginBottom: "var(--sr-sp-3)" }}>Daily close</h1>
        <div className="card">
          <div className="sr-hint" style={{ lineHeight: 1.7 }}>
            No close published yet. The report is generated after the US market closes on trading days.
            Meanwhile, see the{" "}
            <Link href="/track-record" style={{ color: "var(--sr-amber)" }}>track record</Link> or the{" "}
            <Link href="/demo" style={{ color: "var(--sr-amber)" }}>live demo</Link>.
          </div>
        </div>
      </div>
    );
  }

  return <DailyReportView report={report} dates={dates} activeDate={report.date} />;
}
