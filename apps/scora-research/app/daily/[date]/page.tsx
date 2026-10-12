// /daily/YYYY-MM-DD — un cierre concreto, con URL propia.
//
// La URL por día es lo que se indexa y lo que se comparte; sin ella, todo el archivo vive
// bajo una sola dirección y no hay nada que enlazar. Server component, con metadata
// generada del propio informe.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import DailyReportView from "@/components/daily/DailyReportView";
import { fetchDailyClose, fetchDailyDates, dailySummaryLine, formatDayLong, isIsoDay } from "@/lib/dailyClose";
import { tServidor } from "@/lib/i18n/servidor";

// Por petición, como /daily. Antes era ISR (revalidate + generateStaticParams), pero desde que la
// página y el layout leen la cookie de idioma (tServidor) Next ya no puede servirla pregenerada:
// cada día respondía 500, y /daily los precarga todos al enlazarlos (recorrido, 12-10-2026).
// Es una consulta pequeña por visita.
export const dynamic = "force-dynamic";

export async function generateMetadata(
  { params }: { params: Promise<{ date: string }> }
): Promise<Metadata> {
  const { date } = await params;
  if (!isIsoDay(date)) return { title: "Daily close" };
  const rep = await fetchDailyClose(date);
  if (!rep) return { title: `Daily close — ${date}` };

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
      publishedTime: rep.generatedAt,
      url: `/daily/${rep.date}`,
    },
    twitter: { card: "summary_large_image", title: `Daily close — ${rep.date}`, description: summary },
  };
}

export default async function DailyByDatePage(
  { params }: { params: Promise<{ date: string }> }
) {
  const t = await tServidor();
  const { date } = await params;
  // Una fecha con formato inválido es un 404, no una query contra la base.
  if (!isIsoDay(date)) notFound();

  const [report, dates] = await Promise.all([fetchDailyClose(date), fetchDailyDates(30)]);

  if (!report) {
    return (
      <div style={{ padding: "var(--sr-sp-6)", maxWidth: 900, margin: "0 auto" }}>
        <h1 style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800, marginBottom: "var(--sr-sp-3)" }}>{t("Daily close")}</h1>
        <div className="card">
          <div className="sr-hint" style={{ lineHeight: 1.7 }}>
            {t(`No close published for ${date} — markets may have been shut that day. See the`)}{" "}
            <Link href="/daily" style={{ color: "var(--sr-amber)" }}>{t("latest close")}</Link>.
          </div>
        </div>
      </div>
    );
  }

  return <DailyReportView report={report} dates={dates} activeDate={date} />;
}
