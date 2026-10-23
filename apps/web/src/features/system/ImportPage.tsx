import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, FileUp, Upload } from 'lucide-react';
import type { ImportKind, ImportPreview } from '@ketoan/api/contracts';
import { PageHeader } from '@/components/PageHeader';

import { Button } from '@/components/ui/Button';
import { Badge, Card, Segmented } from '@/components/ui/controls';
import { DataTable } from '@/components/ui/DataTable';
import { Field } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { FormError } from '@/auth/AuthCard';
import { client, errorMessage, ok, tokenStore } from '@/lib/api-client';
import { useBusinessDateState } from '@/lib/business-date';
import { DateInput } from '@/components/DateInput';

const KINDS: { value: ImportKind; label: string; hint: string; dated?: string }[] = [
  { value: 'ingredients', label: 'Nguyên liệu', hint: 'Mã trùng với nguyên liệu đã có sẽ được cập nhật.' },
  {
    value: 'dishes',
    label: 'Món',
    hint: 'Nhóm món chưa có sẽ tự tạo. Giá áp dụng từ ngày chọn.',
    dated: 'Giá áp dụng từ ngày',
  },
  {
    value: 'recipes',
    label: 'Định mức',
    hint: 'Mỗi món một phiên bản định mức mới từ ngày chọn. Nhập nguyên liệu và món trước.',
    dated: 'Định mức áp dụng từ ngày',
  },
  {
    value: 'opening',
    label: 'Tồn đầu',
    hint: 'Tạo một phiếu tồn đầu với số lượng và giá vốn hiện có trong kho.',
    dated: 'Ngày tồn đầu',
  },
  {
    value: 'options',
    label: 'Tuỳ chọn món',
    hint: 'Size, topping, yêu cầu. Nhóm và tuỳ chọn trùng tên sẽ được cập nhật. Nhập nguyên liệu và món trước.',
  },
];

const toBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('Không đọc được file'));
    r.readAsDataURL(file);
  });

export function ImportPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<ImportKind>('ingredients');
  const [date, setDate] = useBusinessDateState();
  const [file, setFile] = useState<{ name: string; b64: string } | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const meta = KINDS.find((k) => k.value === kind)!;

  const doPreview = useMutation({
    mutationFn: async (b64: string) =>
      ok(await client.imports.preview({ params: { kind }, body: { fileBase64: b64, date } })),
    onSuccess: setPreview,
  });
  const commit = useMutation({
    mutationFn: async () =>
      ok(await client.imports.commit({ params: { kind }, body: { fileBase64: file!.b64, date } })),
    onSuccess: (r) => {
      toast(`Đã nhập: ${r.created} mới, ${r.updated} cập nhật`);
      qc.invalidateQueries();
      setFile(null);
      setPreview(null);
    },
  });

  async function downloadTemplate() {
    const res = await fetch(`/api/imports/templates/${kind}`, {
      headers: { authorization: `Bearer ${tokenStore.get()}` },
    });
    if (!res.ok) return toast('Không tải được file mẫu', 'bad');
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `mau-${kind}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Nhập dữ liệu từ Excel"
        subtitle="Tải file mẫu → điền → tải lên để xem trước → nhập. Có dòng lỗi thì không lưu gì."
      />
      <Card className="flex flex-col gap-4 p-5">
        <Segmented
          label="Loại dữ liệu"
          value={kind}
          onChange={(k) => {
            setKind(k);
            setPreview(null);
            setFile(null);
          }}
          options={KINDS.map((k) => ({ value: k.value, label: k.label }))}
        />
        <p className="text-[13px] text-muted">{meta.hint}</p>
        <div className="flex flex-wrap items-end gap-3">
          <Button icon={<Download size={16} />} onClick={downloadTemplate}>
            Tải file mẫu
          </Button>
          {meta.dated && (
            <Field label={meta.dated}>
              {(id) => <DateInput id={id} className="w-44" value={date} onChange={(v) => setDate(v)} />}
            </Field>
          )}
          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-ctl bg-primary-soft px-3.5 text-sm font-semibold text-primary-ink hover:bg-primary-soft-2">
            <FileUp size={16} />
            {file ? file.name : 'Chọn file .xlsx'}
            <input
              type="file"
              accept=".xlsx"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const b64 = await toBase64(f);
                setFile({ name: f.name, b64 });
                doPreview.mutate(b64);
              }}
            />
          </label>
        </div>
        <FormError
          message={
            doPreview.error ? errorMessage(doPreview.error) : commit.error ? errorMessage(commit.error) : null
          }
        />
      </Card>

      {preview && (
        <Card className="mt-4">
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
            <span className="text-sm">
              {preview.total} dòng · <b className="text-good">{preview.valid} hợp lệ</b>
              {preview.total - preview.valid > 0 && (
                <b className="ml-1 text-bad">· {preview.total - preview.valid} lỗi</b>
              )}
            </span>
            <Button
              className="ml-auto"
              variant="primary"
              icon={<Upload size={16} />}
              loading={commit.isPending}
              disabled={preview.valid !== preview.total}
              onClick={() => commit.mutate()}
            >
              Nhập {preview.total} dòng
            </Button>
          </div>
          <DataTable
            rows={preview.rows}
            rowKey={(r) => r.row}
            columns={[
              { key: 'row', header: 'Dòng', cell: (r) => r.row },
              { key: 'label', header: 'Nội dung', cell: (r) => r.label },
              {
                key: 'action',
                header: 'Kết quả',
                cell: (r) =>
                  r.action === 'ERROR' ? (
                    <span className="text-bad">{r.errors.join('; ')}</span>
                  ) : r.action === 'CREATE' ? (
                    <Badge tone="good">Thêm mới</Badge>
                  ) : (
                    <Badge tone="primary">Cập nhật</Badge>
                  ),
              },
            ]}
          />
        </Card>
      )}
    </div>
  );
}
