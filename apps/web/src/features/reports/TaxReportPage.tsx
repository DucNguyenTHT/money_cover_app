import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Lock } from 'lucide-react';
import type { MethodComparisonDto, TaxReport } from '@ketoan/api/contracts';
import type { PitMethod } from '@ketoan/api/domain';
import { PageHeader } from '@/components/PageHeader';
import { YearPicker, thisMonth, today } from '@/components/MonthPicker';
import { ExportButton, ReportTable, Signed, StatCard } from '@/components/report';
import { Badge, Card } from '@/components/ui/controls';
import { Button, Spinner } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import { client, ok } from '@/lib/api-client';
import { dateVi, money } from '@/lib/format';

const pct = (v: string | number) => `${String(v).replace('.', ',')}%`;
const monthLabel = (m: string) => `${Number(m.slice(5))}/${m.slice(0, 4)}`;

/** Hộ kinh doanh: what the shop will owe, month by month, with the formulas spelled out. */
export function TaxReportPage() {
  const [year, setYear] = useState(Number(thisMonth().slice(0, 4)));
  const q = useQuery({
    queryKey: ['reports', 'tax', year],
    queryFn: async () => ok(await client.reports.tax({ query: { year } })),
  });
  const r = q.data;

  return (
    <div>
      <PageHeader
        title="Thuế phải nộp"
        subtitle="Tạm tính từ doanh thu và lãi trong app — đối chiếu với kế toán trước khi nộp tờ khai"
        actions={
          <>
            <YearPicker value={year} onChange={setYear} />
            {r && (
              <ExportButton
                filename={`thue-phai-nop-${year}`}
                title={`Thuế phải nộp năm ${year}`}
                sheets={() => exportSheets(r)}
              />
            )}
          </>
        }
      />
      {!r ? (
        <div className="flex justify-center py-16 text-primary-ink">
          <Spinner className="size-6" />
        </div>
      ) : r.regime === 'DEDUCTION' ? (
        <DeductionView r={r} />
      ) : (
        <HouseholdView r={r} />
      )}
    </div>
  );
}

function HouseholdView({ r }: { r: TaxReport }) {
  const revenue = Number(r.total.revenue);
  const threshold = Number(r.threshold);
  const crossed = r.crossedMonth !== null;
  const nextDeadline = r.quarters.find((x) => x.deadline >= today());
  const food = r.groups.find((g) => g.group === 'PRODUCTION');
  return (
    <div className="flex flex-col gap-4">
      {crossed && !r.einvoiceRegistered && (
        <Link
          to="/admin/system/settings"
          className="flex items-start gap-2 rounded-ctl bg-bad-soft px-3 py-2 text-[13px] text-bad-ink hover:underline"
        >
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          Doanh thu năm đã vượt 1 tỷ từ tháng {monthLabel(r.crossedMonth!)}: bắt buộc dùng hoá đơn điện tử
          khởi tạo từ máy tính tiền (đăng ký trong 30 ngày). Đã đăng ký thì bật trong Cài đặt.
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={`Doanh thu năm ${r.year}`}
          value={money(r.total.revenue)}
          sub={
            crossed
              ? `Vượt ngưỡng 1 tỷ từ tháng ${monthLabel(r.crossedMonth!)}`
              : `Còn ${money(threshold - revenue)} đến ngưỡng 1 tỷ`
          }
        />
        <StatCard
          label="Thuế GTGT (tạm tính)"
          value={money(r.total.vat)}
          sub={crossed ? 'Tính trên toàn bộ doanh thu năm' : 'Chưa phải nộp (dưới ngưỡng)'}
        />
        <StatCard
          label="Thuế TNCN (tạm tính)"
          value={money(r.total.pit)}
          sub={
            r.pitMethod === 'INCOME' ? `Theo lãi × ${r.pitIncomeRate}%` : '(Doanh thu − 1 tỷ) × tỷ lệ ngành'
          }
        />
        <StatCard
          label="Tổng thuế phải nộp"
          value={money(Number(r.total.vat) + Number(r.total.pit))}
          sub={
            nextDeadline
              ? `Hạn tờ khai gần nhất: ${dateVi(nextDeadline.deadline)} (quý ${nextDeadline.quarter})`
              : undefined
          }
        />
      </div>

      {r.comparison && <MethodCompare r={r} />}

      <Card className="p-4 text-[13px]">
        <h2 className="mb-2 font-semibold text-ink-strong">Cách tính (hộ kinh doanh)</h2>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-muted">
          <li>
            Doanh thu năm từ 1 tỷ trở xuống: <b className="text-ink">không phải nộp</b> thuế GTGT và TNCN.
          </li>
          <li>
            <b className="text-ink">Thuế GTGT = doanh thu × tỷ lệ ngành</b>, tính trên toàn bộ doanh thu năm
            khi vượt 1 tỷ
            {food && (
              <>
                {' '}
                — ăn uống hiện {pct(food.vatRate)}
                {food.vatRate !== '3' && ' (3% giảm 20% đến hết 31/12/2026)'}
              </>
            )}
            . Tháng vượt ngưỡng gồm cả phần thuế của các tháng trước.
          </li>
          <li>
            <b className="text-ink">Thuế TNCN</b>{' '}
            {r.pitMethod === 'INCOME' ? (
              <>
                = lãi (lợi nhuận trước thuế trong báo cáo lãi lỗ) ×{' '}
                <b className="text-ink">{r.pitIncomeRate}%</b> (15% khi doanh thu 1–3 tỷ, 17% đến 50 tỷ, 20%
                trên 50 tỷ). Tháng lỗ làm giảm thuế luỹ kế.
              </>
            ) : (
              <>= (doanh thu − 1 tỷ) × tỷ lệ TNCN của ngành (ăn uống 1,5%).</>
            )}{' '}
            Đổi cách tính ở{' '}
            <Link to="/admin/system/settings" className="text-primary-ink underline">
              Cài đặt
            </Link>
            .
          </li>
          <li>Tháng đã khoá sổ giữ nguyên số thuế lúc khoá.</li>
        </ul>
      </Card>

      <Card>
        <h2 className="px-4 pt-3 font-semibold text-ink-strong">Theo tháng</h2>
        <ReportTable
          head={[
            'Tháng',
            'Doanh thu',
            'Luỹ kế năm',
            'Lợi nhuận trước thuế',
            'Thuế GTGT',
            'Thuế TNCN',
            'Tổng thuế',
          ]}
          rows={r.months.map((m) => [
            <span key="m" className="inline-flex items-center gap-1.5">
              {monthLabel(m.month)}
              {m.locked && <Lock size={12} className="text-faint" aria-label="Đã khoá sổ" />}
            </span>,
            money(m.revenue),
            money(m.revenueYtd),
            money(m.profit),
            money(m.vat),
            Number(m.pit) < 0 ? `${money(m.pit)}*` : money(m.pit),
            <b key="t">{money(Number(m.vat) + Number(m.pit))}</b>,
          ])}
          total={[
            'Cả năm',
            money(r.total.revenue),
            '',
            money(r.total.profit),
            money(r.total.vat),
            money(r.total.pit),
            money(Number(r.total.vat) + Number(r.total.pit)),
          ]}
          minWidth={820}
        />
        {r.months.some((m) => Number(m.pit) < 0) && (
          <p className="border-t border-line px-4 py-2.5 text-xs text-muted">
            * Điều chỉnh luỹ kế: thuế TNCN tính trên lãi cộng dồn từ tháng 1, nên tháng lỗ làm giảm thuế đã
            tính cho các tháng trước. Tổng cả năm vẫn đúng.
          </p>
        )}
      </Card>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2">
        <Card>
          <h2 className="px-4 pt-3 font-semibold text-ink-strong">Theo quý (kê khai)</h2>
          <ReportTable
            head={['Quý', 'Doanh thu', 'Thuế GTGT', 'Thuế TNCN', 'Hạn nộp tờ khai']}
            rows={r.quarters.map((x) => [
              `Quý ${x.quarter}`,
              money(x.revenue),
              money(x.vat),
              money(x.pit),
              dateVi(x.deadline),
            ])}
            minWidth={520}
          />
        </Card>
        <Card>
          <h2 className="px-4 pt-3 font-semibold text-ink-strong">Theo ngành thuế</h2>
          <ReportTable
            head={['Ngành', 'Doanh thu năm', 'Tỷ lệ GTGT', 'TNCN theo DT']}
            rows={r.groups.map((g) => [g.label, money(g.revenue), pct(g.vatRate), pct(g.pitRate)])}
            minWidth={480}
          />
          <p className="px-4 pb-3 text-xs text-faint">
            Ngành thuế đặt theo nhóm món ở Thực đơn → Món &amp; nhóm món → Nhóm món.
          </p>
        </Card>
      </div>
    </div>
  );
}

const METHOD_LABEL: Record<PitMethod, string> = { REVENUE: 'Theo doanh thu', INCOME: 'Theo lãi' };
const METHOD_FORMULA: Record<PitMethod, string> = {
  REVENUE: '(Doanh thu − 1 tỷ) × tỷ lệ ngành',
  INCOME: 'Lãi × 15% / 17% / 20%',
};

/** One block (so far / whole-year estimate): both methods side by side, cheaper one marked. */
function CompareBlock({ title, c, current }: { title: string; c: MethodComparisonDto; current: PitMethod }) {
  const under = c.cheaper === null && !c.breakEvenProfit;
  const [a, b] = c.methods as [MethodComparisonDto['methods'][0], MethodComparisonDto['methods'][0]];
  const diff = Math.abs(Number(a.total) - Number(b.total));
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-ink-strong">{title}</h3>
        <span className="text-xs text-muted">
          Doanh thu {money(c.revenue)} · lãi trước thuế <Signed v={c.profit} lossTag={false} />
        </span>
      </div>
      {under ? (
        <p className="rounded-ctl bg-good-soft px-3 py-2 text-[13px] text-good">
          Doanh thu năm chưa vượt 1 tỷ: cả hai cách đều không phải nộp thuế.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {c.methods.map((m) => {
            const best = c.cheaper === m.method;
            const blocked = m.method === 'REVENUE' && !c.revenueMethodAllowed;
            return (
              <div
                key={m.method}
                className={cn(
                  'flex flex-col gap-1 rounded-card border p-3',
                  best ? 'border-good bg-good-soft/60' : 'border-line',
                  blocked && 'opacity-60',
                )}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[13px] font-semibold text-ink-strong">{METHOD_LABEL[m.method]}</span>
                  {best && <Badge tone="good">Nộp ít hơn</Badge>}
                  {current === m.method && <Badge tone="primary">Đang chọn</Badge>}
                </div>
                <span className="text-[11px] text-faint">{METHOD_FORMULA[m.method]}</span>
                <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5 text-[13px]">
                  <dt className="text-muted">Thuế GTGT</dt>
                  <dd className="num text-right">{money(m.vat)}</dd>
                  <dt className="text-muted">Thuế TNCN</dt>
                  <dd className="num text-right">{money(m.pit)}</dd>
                  <dt className="font-semibold">Tổng</dt>
                  <dd className="num text-right text-base font-bold text-ink-strong">{money(m.total)}</dd>
                </dl>
                {blocked && (
                  <span className="text-xs text-warn">Không áp dụng được: doanh thu năm trên 3 tỷ</span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {!under && c.cheaper && (
        <p className="text-[13px] text-muted">
          <b className="text-ink">{METHOD_LABEL[c.cheaper]}</b> nộp ít hơn{' '}
          <b className="num text-good">{money(diff)}</b>
          {c.revenueMethodAllowed && c.breakEvenProfit && (
            <>
              . Hai cách bằng nhau khi lãi = <b className="num text-ink">{money(c.breakEvenProfit)}</b>: lãi
              thấp hơn mức này thì tính theo lãi có lợi, cao hơn thì tính theo doanh thu có lợi
            </>
          )}
          .
        </p>
      )}
    </div>
  );
}

function MethodCompare({ r }: { r: TaxReport }) {
  const qc = useQueryClient();
  const toast = useToast();
  const cmp = r.comparison!;
  // Recommend from the whole-year estimate when there is one (the year's total decides the tax).
  const basis = cmp.projected ?? cmp.actual;
  const switchTo = basis.cheaper && basis.cheaper !== r.pitMethod ? basis.cheaper : null;
  const save = useMutation({
    mutationFn: async (m: PitMethod) =>
      ok(await client.settings.update({ body: { settings: { household_pit_method: m } } })),
    onSuccess: (_d, m) => {
      toast(`App sẽ tạm tính thuế TNCN ${METHOD_LABEL[m].toLowerCase()}`);
      void qc.invalidateQueries({ queryKey: ['reports'] });
      void qc.invalidateQueries({ queryKey: ['settings'] });
    },
  });
  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-ink-strong">So sánh 2 cách tính thuế TNCN</h2>
          <p className="text-[13px] text-muted">
            Thuế GTGT giống nhau ở cả hai cách; chỉ thuế TNCN khác nhau. Tính trên số liệu thật của quán.
          </p>
        </div>
        {switchTo && (
          <Button
            variant="tonal"
            loading={save.isPending}
            onClick={() => save.mutate(switchTo)}
            title="Chỉ đổi cách app tạm tính; đổi cách nộp thật phải đăng ký với cơ quan thuế"
          >
            Tạm tính {METHOD_LABEL[switchTo].toLowerCase()}
          </Button>
        )}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-2">
        <CompareBlock title={`Từ đầu năm ${r.year} đến nay (thực tế)`} c={cmp.actual} current={r.pitMethod} />
        {cmp.projected && (
          <CompareBlock
            title={`Ước cả năm ${r.year} (trung bình ${cmp.projected.basisMonths} tháng có số liệu × 12)`}
            c={cmp.projected}
            current={r.pitMethod}
          />
        )}
      </div>
      <p className="mt-3 border-t border-line-soft pt-2 text-xs text-faint">
        Thuế tính theo cả năm, nên hãy chọn theo số <b>ước cả năm</b>. "Lãi" là lợi nhuận trước thuế trong báo
        cáo lãi lỗ — khi tính theo lãi, cơ quan thuế chỉ công nhận chi phí có hoá đơn, chứng từ, nên lãi tính
        thuế có thể cao hơn. Muốn đổi cách nộp thật phải đăng ký với Chi cục Thuế; nút trên chỉ đổi cách app
        tạm tính.
      </p>
    </Card>
  );
}

function DeductionView({ r }: { r: TaxReport }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-ctl bg-primary-soft px-3 py-2 text-[13px] text-primary-ink">
        Công ty khấu trừ thuế: bảng dưới là <b>VAT đầu ra</b> (đã thu trên bill). Thuế phải nộp = đầu ra − đầu
        vào trên hoá đơn mua hàng — phần thuế đầu vào sẽ có ở giai đoạn sau.
      </p>
      <Card>
        <ReportTable
          head={['Tháng', 'Doanh thu thuần', 'VAT đầu ra']}
          rows={r.months.map((m) => [monthLabel(m.month), money(m.revenue), money(m.vat)])}
          total={['Cả năm', money(r.total.revenue), money(r.total.vat)]}
          minWidth={420}
        />
      </Card>
    </div>
  );
}

function exportSheets(r: TaxReport) {
  return [
    {
      name: 'Theo tháng',
      columns: [
        { header: 'Tháng', kind: 'text' as const },
        { header: 'Doanh thu', kind: 'money' as const },
        { header: 'Luỹ kế năm', kind: 'money' as const },
        { header: 'Lợi nhuận trước thuế', kind: 'money' as const },
        { header: 'Thuế GTGT', kind: 'money' as const },
        { header: 'Thuế TNCN', kind: 'money' as const },
        { header: 'Tổng thuế', kind: 'money' as const },
      ],
      rows: [
        ...r.months.map((m) => [
          monthLabel(m.month),
          Number(m.revenue),
          Number(m.revenueYtd),
          Number(m.profit),
          Number(m.vat),
          Number(m.pit),
          Number(m.vat) + Number(m.pit),
        ]),
        [
          'Cả năm',
          Number(r.total.revenue),
          null,
          Number(r.total.profit),
          Number(r.total.vat),
          Number(r.total.pit),
          Number(r.total.vat) + Number(r.total.pit),
        ],
      ],
      bold: [r.months.length],
    },
    {
      name: 'Theo quý',
      columns: [
        { header: 'Quý', kind: 'text' as const },
        { header: 'Doanh thu', kind: 'money' as const },
        { header: 'Thuế GTGT', kind: 'money' as const },
        { header: 'Thuế TNCN', kind: 'money' as const },
        { header: 'Hạn nộp tờ khai', kind: 'text' as const },
      ],
      rows: r.quarters.map((x) => [
        `Quý ${x.quarter}`,
        Number(x.revenue),
        Number(x.vat),
        Number(x.pit),
        dateVi(x.deadline),
      ]),
    },
  ];
}
