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

export const revalidate = 900;
/** Un día que aún no está pregenerado se renderiza a demanda y se cachea. */
export const dynamicParams = true;

/** Pregenera los días ya publicados; el resto entra por `dynamicParams`. */
export async function generateStaticParams(): Promise<{ date: string }[]> {
  const dates = await fetchDailyDates(60);
  return dates.map((date) => ({ date }));
}

export async function generateMetadata(
  { params }: { params: Promise<{ date: string }> }
): Promise<Metadata> {
  const { date } = await params;
  if (!isIsoDay(date)) return { title: "Daily close · Scora Research" };
  const rep = await fetchDailyClose(date);
  if (!rep) return { title: `Daily close — ${date} · Scora Research` };

  const summary = dailySummaryLine(rep);
  return {
    title: `Daily close — ${formatDayLong(rep.date)} · Scora Research`,
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
  const { date } = await params;
  // Una fecha con formato inválido es un 404, no una query contra la base.
  if (!isIsoDay(date)) notFound();

  const [report, dates] = await Promise.all([fetchDailyClose(date), fetchDailyDates(30)]);

  if (!report) {
    return (
      <div style={{ padding: "var(--sr-sp-6)", maxWidth: 900, margin: "0 auto" }}>
        <h1 style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800, marginBottom: "var(--sr-sp-3)" }}>Daily close</h1>
        <div className="card">
          <div className="sr-hint" style={{ lineHeight: 1.7 }}>
            No close published for {date} — markets may have been shut that day. See the{" "}
            <Link href="/daily" style={{ color: "var(--sr-amber)" }}>latest close</Link>.
          </div>
        </div>
      </div>
    );
  }

  return <DailyReportView report={report} dates={dates} activeDate={date} />;
}
