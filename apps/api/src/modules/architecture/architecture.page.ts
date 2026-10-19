// GET /api/docs/architecture — one plain HTML page (no images, no scripts from outside): overall architecture,
// business flows, the database and the API. Database and API sections are read live from the Prisma schema
// and the ts-rest contract, so the page always matches the running version.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { api } from '../../contracts';

const esc = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

// ---------------------------------------------------------------- database (live)

type Model = (typeof Prisma.dmmf.datamodel.models)[number];

const GROUP_LABELS: Record<string, string> = {
  'catalog & config': 'Danh mục & cấu hình',
  sales: 'Bán hàng',
  inventory: 'Kho',
  'documents (scanned invoices)': 'Chứng từ',
  system: 'Hệ thống',
};

/** Model → section, from the "// ---- name" headers in schema.prisma (falls back to one group). */
function modelGroups(models: readonly Model[]): { title: string; models: Model[] }[] {
  let text = '';
  try {
    text = readFileSync(path.resolve('prisma/schema.prisma'), 'utf8');
  } catch {
    return [{ title: 'Bảng', models: [...models] }];
  }
  const groups: { title: string; names: string[] }[] = [];
  for (const line of text.split('\n')) {
    const header = /^\/\/ -{10,} (.+)$/.exec(line);
    if (header) groups.push({ title: header[1]!.trim(), names: [] });
    const model = /^model (\w+)/.exec(line);
    if (model) groups.at(-1)?.names.push(model[1]!);
  }
  const byName = new Map(models.map((m) => [m.name, m]));
  const out = groups
    .filter((g) => g.names.length)
    .map((g) => ({
      title: GROUP_LABELS[g.title] ?? g.title,
      models: g.names.map((n) => byName.get(n)).filter((m): m is Model => !!m),
    }));
  const seen = new Set(out.flatMap((g) => g.models.map((m) => m.name)));
  const rest = models.filter((m) => !seen.has(m.name));
  if (rest.length) out.push({ title: 'Khác', models: [...rest] });
  return out;
}

const tableName = (m: Model) => m.dbName ?? m.name;

/** The `///` docs above a model: [Vietnamese name, purpose, "Lưu: …"]. */
function docOf(m: Model): { name: string; purpose: string; stores: string } {
  const lines = (m.documentation ?? '')
    .split(/\\n|\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const stores = lines.find((l) => l.startsWith('Lưu:'));
  const rest = lines.filter((l) => l !== stores);
  return { name: rest[0] ?? m.name, purpose: rest.slice(1).join(' '), stores: stores?.slice(4).trim() ?? '' };
}

/** Columns that point at another table without a database foreign key (kept as plain ids on purpose). */
const LOGICAL_TARGET: Record<string, string> = {
  branchId: 'Branch',
  orderItemId: 'OrderItem',
  splitFromOrderId: 'Order',
  lotId: 'Lot',
};

interface Link {
  from: Model;
  to: Model;
  columns: string[];
  /** true = each row of `from` belongs to at most one row of `to` and vice versa. */
  oneToOne: boolean;
  /** false = id only, no database constraint. */
  enforced: boolean;
  onDelete?: string;
}

/** Every link in the schema: real foreign keys + documented logical links (branch, "*_by" → users…). */
function allLinks(models: readonly Model[]): Link[] {
  const byName = new Map(models.map((m) => [m.name, m]));
  const links: Link[] = [];
  for (const m of models) {
    const fkCols = new Set<string>();
    for (const f of m.fields) {
      if (f.kind !== 'object' || !f.relationFromFields?.length) continue;
      const to = byName.get(f.type);
      if (!to) continue;
      f.relationFromFields.forEach((c) => fkCols.add(c));
      const unique = f.relationFromFields.every((c) => m.fields.find((x) => x.name === c)?.isUnique);
      links.push({
        from: m,
        to,
        columns: f.relationFromFields.map((c) => m.fields.find((x) => x.name === c)?.dbName ?? c),
        oneToOne: unique,
        enforced: true,
        onDelete: f.relationOnDelete,
      });
    }
    for (const f of m.fields) {
      if (f.kind !== 'scalar' || fkCols.has(f.name) || f.isId) continue;
      const target = /ById$/.test(f.name) ? 'User' : LOGICAL_TARGET[f.name];
      const to = target && byName.get(target);
      if (to && to !== m)
        links.push({ from: m, to, columns: [f.dbName ?? f.name], oneToOne: false, enforced: false });
      else if (to === m)
        links.push({ from: m, to, columns: [f.dbName ?? f.name], oneToOne: false, enforced: false });
    }
  }
  return links;
}

const ref = (m: Model) => `<a href="#t-${esc(tableName(m))}">${esc(docOf(m).name)}</a>`;
const ON_DELETE: Record<string, string> = {
  Cascade: 'xoá theo',
  SetNull: 'bỏ liên kết khi xoá',
  Restrict: 'chặn xoá',
};

function linkLine(l: Link, side: 'up' | 'down') {
  const cols = `<code>${l.columns.map(esc).join(', ')}</code>`;
  const kind = l.oneToOne ? '1 – 1' : side === 'up' ? 'n → 1' : '1 → n';
  const extra = [
    !l.enforced ? 'chỉ lưu id' : '',
    l.onDelete && ON_DELETE[l.onDelete] ? ON_DELETE[l.onDelete] : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const text =
    side === 'up'
      ? `thuộc ${ref(l.to)} qua ${cols}`
      : `có nhiều ${ref(l.from)} <small>(${esc(tableName(l.from))}.${l.columns.map(esc).join(', ')})</small>`;
  return `<li class="${l.enforced ? '' : 'logical'}"><span class="card">${kind}</span>${text}${extra ? ` <small>· ${extra}</small>` : ''}</li>`;
}

function modelCard(m: Model, links: Link[]) {
  const doc = docOf(m);
  const fkCol = new Map<string, Link>();
  for (const l of links) if (l.from === m) for (const c of l.columns) fkCol.set(c, l);
  const rows = m.fields
    .filter((f) => f.kind !== 'object')
    .map((f) => {
      const col = f.dbName ?? f.name;
      const l = fkCol.get(col);
      const tags = [
        f.isId ? '<span class="tag pk">PK</span>' : '',
        l
          ? `<a class="tag ${l.enforced ? 'fk' : 'soft'}" href="#t-${esc(tableName(l.to))}" title="${l.enforced ? 'Khoá ngoại' : 'Chỉ lưu id, không ràng buộc'}">${l.enforced ? 'FK' : 'id'} → ${esc(tableName(l.to))}</a>`
          : '',
        f.isUnique ? '<span class="tag uq">UQ</span>' : '',
      ].join('');
      const type = `${f.type}${f.isList ? '[]' : ''}${f.isRequired ? '' : '?'}`;
      return `<tr><td class="col">${esc(col)}</td><td class="type${f.kind === 'enum' ? ' enum' : ''}">${esc(type)}</td><td>${tags}</td></tr>`;
    })
    .join('');
  // Links: users / branches are referenced by almost every table — listed once on their own card, not as children everywhere.
  const common = (t: Model) => t.name === 'User' || t.name === 'Branch';
  const up = links.filter((l) => l.from === m && l.to !== m);
  const upMain = up.filter((l) => l.enforced || !common(l.to));
  const upCommon = up.filter((l) => !l.enforced && common(l.to));
  const down = links.filter((l) => l.to === m && l.from !== m && (l.enforced || !common(m)));
  const self = links.filter((l) => l.from === m && l.to === m);
  const usedBy = common(m) ? links.filter((l) => l.to === m && !l.enforced) : [];
  const uniques = m.uniqueFields.map((u) => `<code>(${u.map(esc).join(', ')})</code>`);
  return `<article class="tbl" id="t-${esc(tableName(m))}">
    <header><div><b>${esc(tableName(m))}</b> <span class="vn">${esc(doc.name)}</span></div><span>${esc(m.name)}</span></header>
    <div class="desc">
      ${doc.purpose ? `<p><b>Tác dụng:</b> ${esc(doc.purpose)}</p>` : ''}
      ${doc.stores ? `<p><b>Lưu:</b> ${esc(doc.stores)}</p>` : ''}
    </div>
    ${
      upMain.length || down.length || self.length || upCommon.length || usedBy.length
        ? `<div class="links"><b>Liên kết</b><ul>
        ${upMain.map((l) => linkLine(l, 'up')).join('')}
        ${self.map((l) => `<li class="logical"><span class="card">n → 1</span>trỏ tới chính bảng này qua <code>${l.columns.map(esc).join(', ')}</code> <small>· chỉ lưu id</small></li>`).join('')}
        ${down.map((l) => linkLine(l, 'down')).join('')}
        ${
          upCommon.length
            ? `<li class="logical"><span class="card">n → 1</span>${[...new Set(upCommon.map((l) => l.to))]
                .map(
                  (t) =>
                    `${ref(t)} qua ${upCommon
                      .filter((l) => l.to === t)
                      .map((l) => `<code>${l.columns.map(esc).join(', ')}</code>`)
                      .join(' ')}`,
                )
                .join('; ')} <small>· chỉ lưu id</small></li>`
            : ''
        }
        ${usedBy.length ? `<li class="logical"><span class="card">1 → n</span>được ${new Set(usedBy.map((l) => l.from)).size} bảng tham chiếu qua các cột ${m.name === 'User' ? '<code>*_by</code>' : '<code>branch_id</code>'} <small>· chỉ lưu id</small></li>` : ''}
      </ul></div>`
        : ''
    }
    <details class="cols"><summary>${m.fields.filter((f) => f.kind !== 'object').length} cột</summary><table>${rows}</table></details>
    ${uniques.length ? `<footer>Duy nhất: ${uniques.join(' ')}</footer>` : ''}
  </article>`;
}

/** One line per group: which tables hang under which (enforced 1 → n links only). */
function relationMap(models: readonly Model[], links: Link[]) {
  const enforced = links.filter((l) => l.enforced && l.from !== l.to);
  const roots = models.filter((m) => !enforced.some((l) => l.from === m) && enforced.some((l) => l.to === m));
  const branch = (m: Model, seen: Set<Model>): string => {
    const kids = enforced.filter((l) => l.to === m && !seen.has(l.from));
    if (!kids.length) return '';
    const next = new Set([...seen, ...kids.map((k) => k.from)]);
    return `<ul>${kids
      .map(
        (k) =>
          `<li><span class="card">${k.oneToOne ? '1–1' : '1→n'}</span>${ref(k.from)} <small>${esc(tableName(k.from))}</small>${branch(k.from, next)}</li>`,
      )
      .join('')}</ul>`;
  };
  return `<div class="map">${roots
    .map(
      (r) =>
        `<div class="map-root"><b>${ref(r)}</b> <small>${esc(tableName(r))}</small>${branch(r, new Set([r]))}</div>`,
    )
    .join('')}</div>`;
}

function databaseSection() {
  const { models, enums } = Prisma.dmmf.datamodel;
  const links = allLinks(models);
  const fkCount = links.filter((l) => l.enforced).length;
  return `
  <p class="lead">${models.length} bảng · ${fkCount} khoá ngoại · ${links.length - fkCount} liên kết chỉ lưu id · ${enums.length} enum — đọc trực tiếp từ <code>prisma/schema.prisma</code>
  (mô tả bảng là chú thích <code>///</code> ngay trên mỗi model). Tiền: Decimal(16,2) VND; số lượng: Decimal(16,4) theo đơn vị kho.
  <span class="tag fk">FK</span> khoá ngoại có ràng buộc · <span class="tag soft">id</span> chỉ lưu id, không ràng buộc.</p>
  <h3>Bản đồ quan hệ</h3>
  <p class="muted">Bảng cha → các bảng con (theo khoá ngoại). Bấm tên bảng để xem chi tiết.</p>
  ${relationMap(models, links)}
  ${modelGroups(models)
    .map(
      (g) => `<h3>${esc(g.title)} <small>(${g.models.length})</small></h3>
      <div class="tables">${g.models.map((m) => modelCard(m, links)).join('')}</div>`,
    )
    .join('')}
  <h3>Enum</h3><dl class="enums">${enums
    .map(
      (e) =>
        `<dt>${esc(e.name)}</dt><dd>${e.values.map((v) => `<code>${esc(v.name)}</code>`).join(' ')}</dd>`,
    )
    .join('')}</dl>`;
}

// ---------------------------------------------------------------- API (live, from the ts-rest contract)

type Route = { method: string; path: string; metadata?: { roles?: string[]; public?: boolean } };
const isRoute = (v: unknown): v is Route =>
  !!v && typeof v === 'object' && 'method' in v && 'path' in v && typeof (v as Route).path === 'string';

function apiSection() {
  const groups = Object.entries(api as unknown as Record<string, Record<string, unknown>>).map(
    ([name, router]) => ({
      name,
      routes: Object.entries(router)
        .filter(([, r]) => isRoute(r))
        .map(([key, r]) => ({ key, ...(r as Route) })),
    }),
  );
  const total = groups.reduce((s, g) => s + g.routes.length, 0);
  const who = (r: Route) =>
    r.metadata?.public
      ? '<span class="role pub">công khai</span>'
      : r.metadata?.roles
        ? r.metadata.roles.map((x) => `<span class="role ${x.toLowerCase()}">${esc(x)}</span>`).join('')
        : '<span class="role any">đã đăng nhập</span>';
  return `
  <p class="lead">${total} route trong ${groups.length} module (contract ts-rest + zod) — chi tiết request/response ở <a href="/api/docs">Swagger</a>.</p>
  <div class="api">${groups
    .map(
      (g) => `<details><summary><b>${esc(g.name)}</b> <small>${g.routes.length} route</small></summary>
      <table class="routes">${g.routes
        .map(
          (r) =>
            `<tr><td><span class="m ${r.method.toLowerCase()}">${esc(r.method)}</span></td><td class="col">${esc(r.path)}</td><td class="muted">${esc(r.key)}</td><td>${who(r)}</td></tr>`,
        )
        .join('')}</table></details>`,
    )
    .join('')}
  <details><summary><b>Route ngoài contract</b> <small>file nhị phân</small></summary><table class="routes">
    <tr><td><span class="m get">GET</span></td><td class="col">/api/document-files/:fileId</td><td class="muted">ảnh / PDF / XML chứng từ (?thumb=1)</td><td><span class="role admin">ADMIN</span><span class="role staff">STAFF</span></td></tr>
    <tr><td><span class="m get">GET</span></td><td class="col">/api/document-export?period&amp;t</td><td class="muted">file .zip chứng từ, link ký 2 phút</td><td><span class="role admin">ADMIN</span></td></tr>
    <tr><td><span class="m post">POST</span></td><td class="col">/api/reports/export.xlsx</td><td class="muted">xuất Excel báo cáo</td><td><span class="role admin">ADMIN</span></td></tr>
    <tr><td><span class="m get">GET</span></td><td class="col">/api/imports/templates/:kind</td><td class="muted">file Excel mẫu</td><td><span class="role admin">ADMIN</span></td></tr>
    <tr><td><span class="m get">WS</span></td><td class="col">/socket.io</td><td class="muted">order:update, table:update, kitchen:new, printer:error…</td><td><span class="role any">đã đăng nhập</span></td></tr>
    <tr><td><span class="m get">GET</span></td><td class="col">/api/health</td><td class="muted">kiểm tra sống</td><td><span class="role pub">công khai</span></td></tr>
  </table></details></div>`;
}

// ---------------------------------------------------------------- static parts: architecture + flows

const box = (title: string, body = '', cls = '') =>
  `<div class="box ${cls}"><b>${title}</b>${body ? `<span>${body}</span>` : ''}</div>`;

const flow = (title: string, note: string, steps: [string, string, string?][]) => `
  <div class="flow"><h3>${title}</h3><p class="muted">${note}</p><ol>${steps
    .map(
      ([name, detail, data]) =>
        `<li><b>${name}</b><span>${detail}</span>${data ? `<code>${data}</code>` : ''}</li>`,
    )
    .join('')}</ol></div>`;

function architectureSection() {
  return `
  <div class="arch">
    <div class="tier">
      <div class="tier-label">Thiết bị trong quán (LAN, trình duyệt / PWA)</div>
      <div class="row">
        ${box('Máy tính bảng thu ngân', '/pos — sơ đồ bàn, gọi món, thanh toán')}
        ${box('Màn hình bếp / bar', '/kitchen — phiếu theo trạm, realtime')}
        ${box('Máy quản lý', '/admin — thực đơn, kho, chứng từ, báo cáo')}
        ${box('Điện thoại', 'chụp hoá đơn, xem báo cáo')}
      </div>
    </div>
    <div class="arrow">HTTPS · WebSocket</div>
    <div class="tier">
      <div class="tier-label">Máy chủ tại quán — Docker Compose</div>
      <div class="row">
        ${box('Caddy (container web)', 'HTTPS bằng CA nội bộ · / → bản build React · /api, /socket.io → api', 'edge')}
      </div>
      <div class="arrow small">reverse proxy</div>
      <div class="row">
        <div class="box big">
          <b>api — Node + Express 4 + ts-rest + Socket.IO</b>
          <div class="layers">
            <div class="layer l1"><b>modules/*</b><span>router (ts-rest) + service: ${Object.keys(api).map(esc).join(' · ')}</span></div>
            <div class="layer-row">
              <div class="layer l2"><b>contracts</b><span>API dùng chung web ↔ api (zod)</span></div>
              <div class="layer l3"><b>domain</b><span>nghiệp vụ thuần: FIFO, giá (theo kênh / app), đơn, kiểm kê, lãi lỗ, thuế, quyền chứng từ, lịch sao lưu</span></div>
              <div class="layer l4"><b>core</b><span>db (Prisma), auth JWT, audit, khoá sổ, realtime, in ESC/POS, storage, mã hoá · lịch sao lưu (modules/backup)</span></div>
            </div>
          </div>
        </div>
      </div>
      <div class="arrow small">Prisma · TypedSQL · file · TCP</div>
      <div class="row">
        ${box('PostgreSQL 16', 'toàn bộ dữ liệu · volume pgdata', 'store')}
        ${box('backups/', 'pg_dump mỗi đêm do api tự chạy (giữ 30 bản)', 'store')}
        ${box('storage/documents', 'ảnh / PDF / XML chứng từ theo năm/tháng · thư mục trên máy', 'store')}
        ${box('Máy in nhiệt LAN', 'ESC/POS cổng 9100 · bill, bếp, bar', 'device')}
      </div>
    </div>
    <div class="arrow">Internet (tuỳ chọn)</div>
    <div class="row">
      ${box('Google Drive của chủ quán', 'bản sao lưu hằng đêm (tự động) · .zip chứng từ (bấm tay) · OAuth mã thiết bị, Client ID nhập trong Cài đặt · quyền drive.file', 'cloud')}
      ${box('Telegram của chủ quán', 'bot gửi file sao lưu hằng đêm + từng file chứng từ mới vào chat / nhóm đã chọn · ≤ 50 MB / file', 'cloud')}
      ${box('Ổ cứng ngoài / OneDrive', 'scripts/backup-db.ps1 lúc 03:00 chép backups/ + ảnh chứng từ → BACKUP_COPY_DIR', 'cloud')}
    </div>
  </div>

  <div class="two">
    <div>
      <h3>Mã nguồn (monorepo pnpm + Turborepo)</h3>
      <ul class="tree">
        <li><b>apps/api</b> — <code>src/domain</code> · <code>src/contracts</code> · <code>src/core</code> · <code>src/modules/*</code> · <code>prisma/</code> (schema, migrations, sql, seed)</li>
        <li><b>apps/web</b> — React + Vite + Tailwind v4: <code>src/features/*</code> theo màn · <code>src/pos</code> · <code>src/components</code> (UI tự viết) · <code>src/lib</code></li>
        <li><b>e2e</b> — Playwright: bán hàng, kiểm kê, chứng từ, a11y, cài mới</li>
        <li><b>docker/</b>, <b>scripts/</b> — Dockerfile, Caddyfile, sao lưu / khôi phục / đặt lại admin</li>
      </ul>
    </div>
    <div>
      <h3>Chiều phụ thuộc (ESLint kiểm tra)</h3>
      <div class="deps">
        <span class="dep">apps/web</span><i>→</i><span class="dep">@ketoan/api/contracts</span><i>→</i><span class="dep">domain</span>
      </div>
      <div class="deps">
        <span class="dep">apps/web</span><i>→</i><span class="dep">@ketoan/api/domain</span>
      </div>
      <div class="deps">
        <span class="dep">modules</span><i>→</i><span class="dep">contracts · domain · core</span>
      </div>
      <p class="muted">domain không import Prisma / Express / Node; web chỉ dùng 2 cổng contracts và domain.</p>
    </div>
  </div>`;
}

function flowsSection() {
  return [
    flow('Một yêu cầu API', 'Mọi thao tác ghi đều đi qua đường này.', [
      ['Web', 'client sinh từ contract, kiểu khớp đầu-cuối', 'client.orders.pay()'],
      ['ts-rest + zod', 'kiểm dữ liệu vào; sai → 400 VALIDATION'],
      ['authMiddleware', 'JWT → user; kiểm metadata.roles của route'],
      ['Service', 'inTx: đọc DB → gọi domain → ghi + writeAudit cùng transaction', 'audit_logs'],
      ['Sau commit', 'phát Socket.IO, máy khác refetch', 'order:update · kitchen:new'],
      ['Trả về', 'redactFor(role) bỏ giá vốn / lãi với STAFF, KITCHEN'],
    ]),
    flow('Bán hàng', 'Doanh thu chỉ đến từ đơn POS.', [
      ['Chọn bàn / mang về / app', 'mở đơn, mã đơn theo ngày kinh doanh', 'orders (OPEN) · order_counters'],
      [
        'Gọi món',
        'giá tại ngày bán: tại quán / mang về = giá quán; app = giá riêng của app → giá app chung → giá quán',
        'order_items · dish_prices.delivery_app_id',
      ],
      [
        'Tuỳ chọn món',
        'size / topping / yêu cầu: + tiền vào giá dòng, size nhân định mức, topping cộng nguyên liệu; lưu bản chụp',
        'option_groups · options · order_item_options · order_item_extras',
      ],
      ['Gửi bếp', 'in phiếu ESC/POS theo trạm, màn bếp nhận realtime', 'kitchen_status · printers'],
      ['Thanh toán', 'nhiều phương thức, VietQR, giảm giá cần PIN khi vượt mức', 'order_payments'],
      [
        'Trừ kho FIFO',
        'theo định mức món; thiếu hàng → nợ kho, không chặn bán',
        'issues SALE_USE · issue_allocations · lots',
      ],
      ['Huỷ đơn / món', 'huỷ không xoá; món đã chế biến ghi hao', 'orders CANCELLED · audit_logs'],
      [
        'Chốt ngày',
        'đối chiếu tiền mặt; ngày còn đơn mở không chốt được (cảnh báo đơn treo từ ngày trước)',
        'day_closings',
      ],
    ]),
    flow('Kho', 'Giá vốn FIFO theo từng lô nhập.', [
      ['Phiếu nhập', 'mỗi dòng tạo một lô giữ giá nhập; tất toán nợ kho', 'receipts · receipt_items · lots'],
      ['Ảnh hoá đơn', 'đính kèm ngay khi nhập (tuỳ chọn)', 'documents.receipt_id'],
      [
        'Xuất kho',
        'huỷ / trả NCC / dùng nội bộ, lấy lô cũ trước',
        'issues · issue_items · issue_allocations',
      ],
      ['Kiểm kê', 'đếm thực tế → thiếu / thừa; thừa thành lô mới', 'stocktakes · stocktake_items'],
      [
        'Phân bổ hao hụt',
        'chia phần thiếu vào món theo lượng dùng',
        'stocktake_allocations · stocktake_dish_allocations',
      ],
    ]),
    flow('Giá món', 'Gợi ý giá theo % nguyên liệu mục tiêu.', [
      ['Định mức', 'nguyên liệu + bao bì cho mỗi món, có ngày hiệu lực', 'dish_recipes · dish_recipe_items'],
      [
        'Bảng tính giá',
        'giá vốn = định mức × giá nhập gần nhất; mỗi app một cột lãi theo phí sàn riêng; % chi phí chung chỉ tính tháng bán trọn vẹn',
        'overhead_expenses · delivery_apps',
      ],
      ['Cảnh báo giá', 'món lỗ (ở bất kỳ app nào) / vượt % mục tiêu sau khi giá nhập đổi'],
      [
        'Áp dụng giá mới',
        'theo ngày, cho quán / app chung / từng app; không lùi về ngày món đã bán; có lịch sử giá',
        'dish_prices',
      ],
      [
        'Tuỳ chọn',
        'nhóm dùng chung (chọn 1 / chọn nhiều, bắt buộc, tối đa), gắn cho món theo thứ tự',
        'option_groups · options · option_ingredients · dish_option_groups',
      ],
    ]),
    flow('Kỳ kế toán (tháng)', 'Lãi lỗ tổng hợp theo tháng; quý / năm = cộng các tháng.', [
      ['Chi phí chung', 'mặt bằng, lương, điện nước… theo tháng', 'overhead_expenses'],
      ['Báo cáo lãi lỗ', 'TypedSQL lấy số thô → domain/period/pnl.ts dựng các dòng', 'prisma/sql/*.sql'],
      [
        'Thuế tạm tính',
        'hộ kinh doanh: GTGT + TNCN luỹ kế từ tháng 1 theo ngành của nhóm món (domain/tax/household.ts); báo cáo Thuế phải nộp',
        'settings.tax_regime · dish_categories.tax_group',
      ],
      ['Khoá sổ', 'chặn mọi ghi vào tháng; chụp số liệu kèm thuế', 'period_locks · monthly_closings'],
      ['Mở khoá', 'ADMIN, bắt buộc lý do, ghi lịch sử', 'audit_logs'],
    ]),
    flow('Chứng từ', 'Kho lưu trữ, không ảnh hưởng số liệu kho / lãi lỗ.', [
      ['Chụp / chọn file', 'ảnh nén trong trình duyệt (~2200px JPEG) + ảnh thu nhỏ'],
      ['Tải lên', 'kiểm loại theo byte (JPG/PNG/WEBP/PDF/XML), chặn trùng sha256', 'document_files.sha256'],
      ['Lưu file', 'ghi nguyên tử vào storage/documents/năm/tháng', 'document_files.path'],
      ['Xem / thay / xoá', 'người tải lên trong 24h hoặc ADMIN (có lý do); xoá mềm', 'deleted_at'],
      ['Sao lưu', 'zip theo tháng/năm → tải về hoặc gửi Google Drive', 'settings.google_drive (mã hoá)'],
    ]),
    flow('Sao lưu dữ liệu', 'api tự chạy, không cần cài lịch Windows.', [
      [
        'Đến giờ',
        'backup_hour (02:00); máy tắt lúc đó → chạy khi bật lại; lỗi → thử lại mỗi giờ',
        'settings.backup_hour',
      ],
      ['pg_dump', 'định dạng custom → backups/ketoan-YYYYMMDD-HHmm.dump, kiểm tra đầu file, giữ 30 bản'],
      [
        'Google Drive',
        'nếu đã kết nối và đang bật: tải lên thư mục Sao lưu dữ liệu, giữ 30 bản; lỗi Drive không huỷ bản trên máy',
        'settings.backup_drive · settings.google_client (mã hoá)',
      ],
      [
        'Telegram',
        'nếu đã chọn cuộc trò chuyện và đang bật: bot gửi file (≤ 50 MB); lỗi không huỷ bản trên máy',
        'settings.backup_telegram · settings.telegram (mã hoá)',
      ],
      [
        'Chứng từ qua Telegram',
        'chạy nền: các file chưa gửi theo thứ tự id, ≤ 100 file / lần, ~3 giây / file; lỗi → dừng, lần sau gửi tiếp',
        'document_files · settings.telegram.docsCursor',
      ],
      ['Ghi kết quả', 'lần chạy gần nhất / lần thành công gần nhất', 'settings.backup_status'],
      ['Cảnh báo', 'chuông + Tổng quan: chưa có / lỗi / quá 2 ngày / chưa gửi được lên Drive / Telegram'],
      ['Khôi phục', 'scripts/restore-db.ps1 với file .dump (trên máy, hoặc tải từ Telegram / Drive)'],
    ]),
  ].join('');
}

// ---------------------------------------------------------------- page

const CSS = `
:root{--bg:#f5f7fb;--card:#fff;--ink:#1d2433;--muted:#5d6678;--line:#dce2ea;--soft:#eaf2fd;--primary:#3573dd;--pink:#fdecea;--green:#e7f5ee;--amber:#fdf3e1;--violet:#efeafd}
@media (prefers-color-scheme:dark){:root{--bg:#11151c;--card:#1a202b;--ink:#e6e9ef;--muted:#9aa3b2;--line:#2c3443;--soft:#1d2b44;--primary:#79a6f2;--pink:#3a2326;--green:#1c3328;--amber:#3a3020;--violet:#2a2440}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 Inter,system-ui,"Segoe UI",sans-serif}
a{color:var(--primary);text-decoration:none}a:hover{text-decoration:underline}
header.top{position:sticky;top:0;z-index:5;background:var(--soft);border-bottom:1px solid var(--line);padding:10px 20px;display:flex;flex-wrap:wrap;gap:6px 18px;align-items:center}
header.top h1{font-size:16px;margin:0 12px 0 0}header.top nav a{font-weight:600;font-size:13px}
main{max-width:1280px;margin:0 auto;padding:16px 20px 60px}
section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin:16px 0}
h2{margin:0 0 4px;font-size:18px}h3{font-size:14px;margin:18px 0 8px}small,.muted{color:var(--muted)}
.lead{color:var(--muted);margin:0 0 8px}code{font:12px ui-monospace,Consolas,monospace;background:var(--soft);padding:1px 5px;border-radius:5px}
.arch{display:flex;flex-direction:column;align-items:stretch;gap:4px;margin-top:10px}
.tier{border:1px dashed var(--line);border-radius:12px;padding:10px}.tier-label{font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px}
.row{display:flex;flex-wrap:wrap;gap:10px}.row>.box{flex:1 1 200px}
.box{border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:var(--card);display:flex;flex-direction:column;gap:2px}
.box b{font-size:13px}.box span{font-size:12px;color:var(--muted)}
.box.edge{background:var(--soft)}.box.store{background:var(--green)}.box.device{background:var(--amber)}.box.cloud{background:var(--violet)}.box.big{flex:1 1 100%}
.arrow{align-self:center;font-size:12px;color:var(--muted);padding:2px 0}.arrow:before{content:"▼ ";color:var(--primary)}.arrow.small{margin:2px 0}
.layers{display:flex;flex-direction:column;gap:6px;margin-top:8px}.layer-row{display:flex;flex-wrap:wrap;gap:6px}.layer-row .layer{flex:1 1 180px}
.layer{border-radius:8px;padding:8px 10px;display:flex;flex-direction:column}.layer span{font-size:12px;color:var(--muted)}
.l1{background:var(--soft)}.l2{background:var(--amber)}.l3{background:var(--green)}.l4{background:var(--violet)}
.two{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}
.tree{margin:0;padding-left:18px}.tree li{margin:4px 0}
.deps{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:6px 0}.dep{border:1px solid var(--line);border-radius:8px;padding:3px 8px;font-size:12px;font-weight:600}.deps i{color:var(--primary);font-style:normal}
.flow ol{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:22px 26px;counter-reset:s}
.flow li{counter-increment:s;position:relative;flex:1 1 170px;max-width:240px;border:1px solid var(--line);border-radius:10px;padding:10px 12px 10px 38px;display:flex;flex-direction:column;gap:3px}
.flow li:before{content:counter(s);position:absolute;left:10px;top:10px;width:20px;height:20px;border-radius:50%;background:var(--primary);color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center}
.flow li:not(:last-child):after{content:"→";position:absolute;right:-20px;top:50%;transform:translateY(-50%);color:var(--primary);font-weight:700}
.flow li span{font-size:12px;color:var(--muted)}.flow li code{align-self:flex-start;font-size:11px}
.flow+.flow{border-top:1px solid var(--line);margin-top:16px}
.tables{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:12px}
.tbl{border:1px solid var(--line);border-radius:10px;overflow:hidden;scroll-margin-top:70px}.tbl:target{outline:3px solid var(--primary)}
.tbl header{background:var(--soft);padding:7px 10px;display:flex;justify-content:space-between;gap:8px}.tbl header span{font-size:12px;color:var(--muted)}
.tbl table{width:100%;border-collapse:collapse;font-size:12px}.tbl td{padding:3px 10px;border-top:1px solid var(--line);vertical-align:top}
.tbl .vn{font-weight:600;color:var(--primary);margin-left:4px}.tbl header div{min-width:0}.desc{padding:8px 10px 2px;font-size:12px}.desc p{margin:0 0 6px}.links{padding:6px 10px 8px;border-top:1px solid var(--line);font-size:12px}.links ul{list-style:none;margin:4px 0 0;padding:0}.links li{margin:3px 0}.links li.logical{color:var(--muted)}.card{display:inline-block;min-width:38px;text-align:center;font:700 10px ui-monospace,monospace;border-radius:5px;padding:0 4px;margin-right:6px;background:var(--soft);color:var(--primary)}details.cols summary{padding:6px 10px;border-top:1px solid var(--line);font-size:12px;cursor:pointer;color:var(--muted)}.map{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;font-size:12px}.map-root{border:1px solid var(--line);border-radius:10px;padding:8px 10px}.map ul{list-style:none;margin:4px 0 0 8px;padding-left:10px;border-left:2px solid var(--line)}.map li{margin:4px 0}.tbl footer{padding:6px 10px;border-top:1px solid var(--line);font-size:12px;color:var(--muted)}
td.col{font-family:ui-monospace,Consolas,monospace}td.type{color:var(--muted)}td.type.enum{color:#9a5b00}
.tag{display:inline-block;font-size:10px;font-weight:700;border-radius:5px;padding:0 5px;margin-right:3px;white-space:nowrap}
.pk{background:#fde7b0;color:#6b4a00}.fk{background:var(--soft);color:var(--primary)}.uq{background:var(--violet)}.soft{border:1px dashed var(--line);color:var(--muted)}
ul.rel{columns:2 260px;font-size:12px;padding-left:18px;margin:0}dl.enums{font-size:12px;margin:0}dl.enums dt{font-weight:700;margin-top:6px}dl.enums dd{margin:2px 0 0}
.api details{border:1px solid var(--line);border-radius:10px;margin:8px 0}.api summary{padding:8px 12px;cursor:pointer}
table.routes{width:100%;border-collapse:collapse;font-size:12px}table.routes td{padding:4px 12px;border-top:1px solid var(--line)}
.m{font:700 11px ui-monospace,monospace;border-radius:5px;padding:1px 6px}.m.get{background:var(--green)}.m.post{background:var(--soft)}.m.put,.m.patch{background:var(--amber)}.m.delete{background:var(--pink)}
.role{font-size:11px;border-radius:5px;padding:0 6px;margin-right:3px;border:1px solid var(--line)}.role.admin{background:var(--pink)}.role.staff{background:var(--green)}.role.kitchen{background:var(--amber)}
@media (max-width:640px){main{padding:10px}section{padding:14px}.flow li{max-width:none}.flow li:not(:last-child):after{content:"↓";right:auto;left:50%;top:auto;bottom:-20px;transform:none}}
`;

export function architectureHtml(): string {
  const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kiến trúc hệ thống</title><style>${CSS}</style></head><body>
<header class="top"><h1>Kế toán quán — kiến trúc hệ thống</h1><nav><a href="#arch">Tổng thể</a> · <a href="#flows">Luồng nghiệp vụ</a> · <a href="#db">Database</a> · <a href="#api">API</a> · <a href="/api/docs">Swagger</a></nav><small>Sinh lúc ${esc(now)}</small></header>
<main>
<section id="arch"><h2>Kiến trúc tổng thể</h2><p class="lead">Một máy chủ tại quán chạy toàn bộ hệ thống, vẫn bán được khi mất Internet.</p>${architectureSection()}</section>
<section id="flows"><h2>Luồng nghiệp vụ</h2><p class="lead">Mỗi bước ghi kèm bảng dữ liệu liên quan.</p>${flowsSection()}</section>
<section id="db"><h2>Sơ đồ database</h2>${databaseSection()}</section>
<section id="api"><h2>API</h2>${apiSection()}</section>
</main></body></html>`;
}

export const architecturePage = Router();
architecturePage.get('/api/docs/architecture', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(architectureHtml());
});
