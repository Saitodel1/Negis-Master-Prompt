import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  BriefcaseBusiness,
  CalendarDays,
  CreditCard,
  DollarSign,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';
import { PageLayout } from '@/components/layout/PageLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

type NumericKey = 'sales' | 'payments' | 'debt' | 'deals' | 'won' | 'won_conversion';

interface ReportTotals {
  sales: number;
  payments: number;
  debt: number;
  deals: number;
  won: number;
  won_conversion: number;
}

interface BreakdownRow extends ReportTotals {
  name: string;
}

interface ReportSummary {
  totals: ReportTotals;
  by_source: BreakdownRow[];
  by_employee: BreakdownRow[];
  by_stage: BreakdownRow[];
}

const EMPTY_TOTALS: ReportTotals = {
  sales: 0,
  payments: 0,
  debt: 0,
  deals: 0,
  won: 0,
  won_conversion: 0,
};

const TABLE_COLUMNS: Array<{ key: NumericKey; label: string; format: (value: number) => string }> = [
  { key: 'deals', label: 'Сделки', format: formatNumber },
  { key: 'won', label: 'Успешные', format: formatNumber },
  { key: 'won_conversion', label: 'Конверсия в успех', format: formatPercent },
  { key: 'sales', label: 'Продажи', format: formatMoney },
  { key: 'payments', label: 'Оплаты', format: formatMoney },
  { key: 'debt', label: 'Долг', format: formatMoney },
];

function toDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function defaultDateFrom(): string {
  const now = new Date();
  return toDateInput(new Date(now.getFullYear(), now.getMonth(), 1));
}

function defaultDateTo(): string {
  return toDateInput(new Date());
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function asText(row: Record<string, unknown>, keys: string[], fallback: string): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return fallback;
}

function conversionValue(raw: unknown, won: number, deals: number): number {
  const value = asNumber(raw);
  if (value > 1) return value;
  if (value > 0) return value * 100;
  return deals > 0 ? (won / deals) * 100 : 0;
}

function normalizeTotals(input: unknown): ReportTotals {
  const row = asRecord(input);
  const deals = asNumber(row.deals ?? row.deal_count ?? row.total_deals);
  const won = asNumber(row.won ?? row.won_deals ?? row.closed_won);

  return {
    sales: asNumber(row.sales ?? row.revenue ?? row.total_sales),
    payments: asNumber(row.payments ?? row.paid ?? row.total_payments),
    debt: asNumber(row.debt ?? row.balance_due ?? row.total_debt),
    deals,
    won,
    won_conversion: conversionValue(row.won_conversion ?? row.conversion ?? row.conversion_rate, won, deals),
  };
}

function normalizeRows(input: unknown, fallbackPrefix: string): BreakdownRow[] {
  if (!Array.isArray(input)) return [];

  return input.map((item, index) => {
    const row = asRecord(item);
    return {
      name: asText(
        row,
        ['name', 'label', 'source', 'employee', 'employee_name', 'agent_name', 'stage', 'stage_name', 'status'],
        `${fallbackPrefix} ${index + 1}`,
      ),
      ...normalizeTotals(row),
    };
  });
}

function normalizeSummary(input: unknown): ReportSummary {
  const payload = Array.isArray(input) ? input[0] : input;
  const row = asRecord(payload);

  return {
    totals: normalizeTotals(row.totals ?? row),
    by_source: normalizeRows(row.by_source ?? row.sources, 'Источник'),
    by_employee: normalizeRows(row.by_employee ?? row.employees, 'Сотрудник'),
    by_stage: normalizeRows(row.by_stage ?? row.stages, 'Этап'),
  };
}

function formatMoney(value: number, currency: 'KZT' | 'KGS' = 'KZT'): string {
  return `${Math.round(value).toLocaleString('ru-RU')} ${currency === 'KGS' ? 'сом' : '₸'}`;
}

function formatNumber(value: number): string {
  return Math.round(value).toLocaleString('ru-RU');
}

function formatPercent(value: number): string {
  return `${(Math.round(value * 10) / 10).toLocaleString('ru-RU')}%`;
}

function hasAnyData(summary: ReportSummary | null): boolean {
  if (!summary) return false;
  const totals = summary.totals;
  return totals.sales > 0
    || totals.payments > 0
    || totals.debt > 0
    || totals.deals > 0
    || totals.won > 0
    || summary.by_source.length > 0
    || summary.by_employee.length > 0
    || summary.by_stage.length > 0;
}

export default function Reports() {
  const { clinicId, country } = useAuth();
  const currency = country === 'KG' ? 'KGS' : 'KZT';
  const [dateFrom, setDateFrom] = useState(defaultDateFrom);
  const [dateTo, setDateTo] = useState(defaultDateTo);
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    if (!clinicId) {
      setSummary(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    const { data, error: rpcError } = await supabase.rpc('negis_report_summary', {
      target_clinic_id: clinicId,
      date_from: dateFrom,
      date_to: dateTo,
    });

    if (rpcError) {
      console.error('Failed to load report summary', rpcError);
      setSummary(null);
      setError('Не удалось загрузить отчет. Повторите попытку.');
    } else {
      setSummary(normalizeSummary(data));
    }

    setLoading(false);
  }, [clinicId, dateFrom, dateTo]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const totals = summary?.totals ?? EMPTY_TOTALS;
  const empty = useMemo(() => !loading && !error && summary !== null && !hasAnyData(summary), [error, loading, summary]);

  return (
    <PageLayout>
      <div className="mx-auto max-w-[1500px] space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-[#0B1220]">Отчеты</h1>
            <p className="mt-1 text-sm text-[#64748B]">
              Сводка продаж, оплат, долга и воронки за выбранный период.
            </p>
          </div>

          <Card className="shadow-none">
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
              <DateField label="С" value={dateFrom} max={dateTo} onChange={setDateFrom} />
              <DateField label="По" value={dateTo} min={dateFrom} onChange={setDateTo} />
              <Button type="button" onClick={() => void loadReport()} disabled={loading || !clinicId}>
                <RefreshCw className={loading ? 'animate-spin' : ''} />
                Обновить
              </Button>
            </CardContent>
          </Card>
        </div>

        {!clinicId && (
          <StatePanel
            icon={<AlertCircle />}
            title="Рабочее пространство не выбрано"
            text="Войдите в рабочее пространство, чтобы открыть отчеты."
          />
        )}

        {error && (
          <StatePanel
            icon={<AlertCircle />}
            title="Ошибка загрузки"
            text={error}
            tone="error"
          />
        )}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <MetricCard icon={<DollarSign />} title="Продажи" value={loading ? '...' : formatMoney(totals.sales, currency)} />
          <MetricCard icon={<CreditCard />} title="Оплаты" value={loading ? '...' : formatMoney(totals.payments, currency)} />
          <MetricCard icon={<AlertCircle />} title="Долг" value={loading ? '...' : formatMoney(totals.debt, currency)} />
          <MetricCard icon={<BriefcaseBusiness />} title="Сделки" value={loading ? '...' : formatNumber(totals.deals)} />
          <MetricCard icon={<TrendingUp />} title="Конверсия в успех" value={loading ? '...' : formatPercent(totals.won_conversion)} />
        </section>

        {loading && !summary ? (
          <StatePanel icon={<RefreshCw className="animate-spin" />} title="Загрузка отчета" text="Собираем показатели за выбранный период." />
        ) : empty ? (
          <StatePanel icon={<CalendarDays />} title="Нет данных" text="За выбранный период продажи, оплаты и сделки не найдены." />
        ) : (
          <div className="grid gap-4 xl:grid-cols-3">
            <BreakdownTable title="По источникам" rows={summary?.by_source ?? []} emptyText="Нет данных по источникам." currency={currency} />
            <BreakdownTable title="По сотрудникам" rows={summary?.by_employee ?? []} emptyText="Нет данных по сотрудникам." currency={currency} />
            <BreakdownTable title="По этапам" rows={summary?.by_stage ?? []} emptyText="Нет данных по этапам." currency={currency} />
          </div>
        )}
      </div>
    </PageLayout>
  );
}

function DateField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string;
  min?: string;
  max?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="min-w-36 text-xs font-medium text-[#64748B]">
      {label}
      <Input
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 bg-white"
      />
    </label>
  );
}

function MetricCard({ icon, title, value }: { icon: ReactNode; title: string; value: string }) {
  return (
    <Card className="shadow-none">
      <CardHeader className="p-5 pb-2">
        <CardDescription className="flex items-center gap-2">
          <span className="text-[#2859C5] [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
          {title}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-5 pt-0">
        <div className="text-2xl font-semibold text-[#0B1220]">{value}</div>
      </CardContent>
    </Card>
  );
}

function BreakdownTable({ title, rows, emptyText, currency }: { title: string; rows: BreakdownRow[]; emptyText: string; currency: 'KZT' | 'KGS' }) {
  const sortedRows = useMemo(() => [...rows].sort((a, b) => b.sales - a.sales || b.deals - a.deals), [rows]);

  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{rows.length} строк</CardDescription>
      </CardHeader>
      <CardContent>
        {sortedRows.length === 0 ? (
          <div className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-[#64748B]">{emptyText}</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Название</TableHead>
                {TABLE_COLUMNS.map((column) => (
                  <TableHead key={column.key} className="text-right">
                    {column.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRows.map((row) => (
                <TableRow key={row.name}>
                  <TableCell className="min-w-36 font-medium text-[#0B1220]">{row.name}</TableCell>
                  {TABLE_COLUMNS.map((column) => (
                    <TableCell key={column.key} className="text-right">
                      {(['sales', 'payments', 'debt'] as NumericKey[]).includes(column.key)
                        ? formatMoney(row[column.key], currency)
                        : column.format(row[column.key])}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function StatePanel({
  icon,
  title,
  text,
  tone = 'default',
}: {
  icon: ReactNode;
  title: string;
  text: string;
  tone?: 'default' | 'error';
}) {
  const error = tone === 'error';

  return (
    <Card className={error ? 'border-red-200 bg-red-50 text-red-800 shadow-none' : 'shadow-none'}>
      <CardContent className="flex gap-3 p-5">
        <span className={error ? 'text-red-600 [&_svg]:h-5 [&_svg]:w-5' : 'text-[#2859C5] [&_svg]:h-5 [&_svg]:w-5'}>
          {icon}
        </span>
        <div>
          <div className={error ? 'font-semibold text-red-900' : 'font-semibold text-[#0B1220]'}>{title}</div>
          <p className="mt-1 text-sm leading-6">{text}</p>
        </div>
      </CardContent>
    </Card>
  );
}
