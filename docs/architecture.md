# Kiến trúc

> Sơ đồ đầy đủ, luôn khớp phiên bản đang chạy: mở **`/api/docs/architecture`** (dev: http://localhost:4000/api/docs/architecture).
> Trang HTML thuần do API trả về: kiến trúc tổng thể, luồng nghiệp vụ, sơ đồ database (đọc từ Prisma schema) và
> danh sách API kèm quyền (đọc từ contract). Công khai trong LAN giống Swagger (`/api/docs`).

## Tổng quan

```
máy tính bảng / máy thu ngân ── HTTPS (Caddy, CA nội bộ) ──┬── /            → web build (React)
                                                          ├── /api/*       → api (Express, ts-rest)
                                                          └── /socket.io/* → api (Socket.IO)
điện thoại khách (QR trên bàn) ── HTTP :8081 (Caddy) ──┬── /t/*          → guest.html (trang gọi món riêng, nhẹ)
                                                       └── /api/public/* → api (không đăng nhập, giới hạn tần suất)
api ── PostgreSQL 16          api ── TCP 9100 ── máy in nhiệt LAN
api ── pg_dump 02:00 ──► backups/ ──(tuỳ chọn, Internet)──► Telegram bot · Google Drive của chủ quán
api ── telegram_messages (hàng đợi) ──(Internet)──► Telegram: báo cáo chốt ngày, tin sáng, cảnh báo
api ──(Internet, mỗi phút / 4 giây khi POS chờ)──► SePay / Casso: tiền vào tài khoản → bank_transactions
api ── einvoices (hàng đợi) ──(Internet)──► nhà cung cấp hoá đơn điện tử (Giả lập / SePay eInvoice)
máy tính bảng ── HTTP :8080 ── /ca.crt (cài chứng chỉ CA một lần)
```

Dịch vụ bên ngoài đều tuỳ chọn và đi qua hàng đợi trong DB: mất Internet vẫn bán, chốt ngày, in bill; tin / hoá đơn
gửi bù khi có mạng lại.

Monorepo pnpm + Turborepo, 2 app:

| App        | Nội dung                                                                                                                                                                                                                                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api` | `src/domain` nghiệp vụ thuần · `src/contracts` hợp đồng API (ts-rest + zod) · `src/core` hạ tầng (db, auth, audit, period-lock, realtime, printing, redact) · `src/modules/*` router + service · `prisma/` schema, migrations, TypedSQL (`prisma/sql`), seed                                               |
| `apps/web` | 2 trang: `index.html` — app nhân viên (`src/features/*` theo màn hình · `src/pos` phần dùng chung của khu bán hàng · `src/components` UI kit tự viết bằng Tailwind · `src/lib` client API, socket, định dạng) và `guest.html` — trang gọi món của khách (`src/guest`, ~13 KB, `fetch` thẳng `/api/public`) |

## Chiều phụ thuộc (ESLint kiểm tra)

```
apps/web ──► @ketoan/api/contracts ──► apps/api/src/domain
        └──► @ketoan/api/domain
api: modules ──► contracts, domain, core
```

- `domain` không import Prisma / Express / Node / contracts.
- `contracts` chỉ import `domain` và zod.
- Web chỉ import 2 cổng `@ketoan/api/contracts` và `@ketoan/api/domain` (trỏ thẳng vào mã nguồn TS; Vite tự biên dịch).
- Feature bán hàng (`tables`, `order-entry`, `payment`, `order-history`, `kitchen`, `day-closing`, `cash`) và feature quản trị không import lẫn nhau.
- Tiền ra vào két do màn hình khác sinh ra (trả nhà cung cấp, trả lương, tạm ứng, tiền cọc đặt bàn: nhận / trừ vào
  đơn / hoàn) đi qua `modules/cash` (`addTx`, `cancelBySourceTx`) trong cùng transaction, đánh dấu `source` /
  `source_id` để chỉ huỷ được ở màn hình gốc.
- **Đơn hàng gọi hook của module khác trong cùng transaction**: thanh toán → `customers` (trừ / tích điểm),
  `reservations.onOrderPaidTx` (cọc phải nằm trong dòng tiền mặt / chuyển khoản; cọc tiền mặt ghi chi lại),
  `einvoice.queueForPaymentTx`; huỷ đơn đã trả → hoàn điểm, cọc quay lại "đang giữ", hoá đơn điều chỉnh. Mỗi lần
  tính lại đơn (`recompute`) đọc `promotions.rules` và gọi `domain/promotions`.
- **Không import vòng**: module cần sửa đơn gọi `orders` từ phía mình — lưu khuyến mãi → `orders.refreshOpenOrders`,
  nhận yêu cầu QR → `orders.addItems` / `orders.open`; `notify/digests` gọi thẳng `dailyLines` / `morningLines` của
  `bank`, `einvoice` và `reservations.morningLines` (không đăng ký lúc nạp module).

## Luồng một yêu cầu

1. Web gọi bằng client sinh từ contract (`client.orders.pay(...)`) → kiểu dữ liệu khớp đầu-cuối.
2. ts-rest kiểm tra dữ liệu bằng zod; `authMiddleware` kiểm `metadata.roles` của route.
3. Service mở transaction (`inTx`), đọc DB → gọi hàm `domain` → ghi kết quả + `writeAudit` trong cùng transaction.
4. Sau commit: phát sự kiện Socket.IO (`order:update`, `table:update`, `kitchen:new`…). Các máy khác refetch.
5. `redactFor(role)` bỏ trường giá vốn / lãi trước khi trả cho STAFF / KITCHEN.

**Route công khai** (`metadata: { public: true }`, `authMiddleware` bỏ qua): `/api/public/*` của trang gọi món QR,
`/api/auth/login`, `/api/health`. `/api/public` có body ≤ 20 KB và giới hạn riêng theo thiết bị (8 lần gửi + 120 lần
đọc / phút); api đặt `trust proxy = 1` vì luôn đứng sau Caddy (container api không mở cổng). Caddy cổng **8081**
(HTTP, cho điện thoại khách không tin CA của quán) chỉ chuyển `/t/*` → `guest.html`, `/assets/*`, `/api/public/*`;
còn lại 404.

## Tiến trình nền

Chạy trong chính tiến trình api (bật ở `src/main.ts`, không bật khi test — test gọi thẳng hàm xử lý):

| Module     | Nhịp                                                              | Việc                                                                    |
| ---------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `backup`   | `backup_hour` (02:00), lỗi thử lại mỗi giờ                        | `pg_dump` → `backups/`, gửi Drive / Telegram, chứng từ mới lên Telegram |
| `notify`   | mỗi phút + ngay khi có tin; tin sáng lúc `notify_morning_hour`    | gửi `telegram_messages` (giữ 24 giờ, tối đa 5 lần thử)                  |
| `bank`     | 60 giây; 4 giây (SePay) / 30 giây (Casso) khi có máy POS chờ tiền | đọc tiền vào, khớp đơn, phát `bank:txn`                                 |
| `einvoice` | 30 giây + ngay sau thanh toán                                     | gửi / kiểm tra hoá đơn; thử lại sau 1 / 5 / 15 / 60 phút, bỏ sau 3 ngày |

## Tổng tiền đơn

`domain/orders/totals.ts`, tính lại mỗi khi đơn đổi (`orders.service.recompute`), làm tròn đồng ở mỗi bước:

```
tạm tính − giảm giá món (tay) − khuyến mãi (combo trước, rồi giờ vàng; dòng giảm tay thì không)
         − giảm giá đơn − đổi điểm khách quen = doanh số → + phụ thu → + VAT (hoặc tách VAT trong giá)
```

Khuyến mãi, giảm giá đơn và đổi điểm được chia vào từng dòng (`net_amount`) nên lãi theo món, lãi lỗ, hoá đơn điện
tử đều đã trừ. Giới hạn giảm giá của nhân viên chỉ xét giảm tay. Khuyến mãi xét theo giờ gọi món
(`order_items.created_at`) và ngày kinh doanh nên tính lại lúc nào cũng ra cùng kết quả.

## Báo cáo — TypedSQL

- Mỗi truy vấn báo cáo là một file `apps/api/prisma/sql/*.sql`; `prisma generate --sql` sinh hàm có kiểu (`@prisma/client/sql`).
- **Sinh code cần kết nối DB** (Prisma đọc kiểu cột từ database):
  - máy dev: `pnpm db:generate` khi DB chạy và **API dev server đã dừng** (Windows khoá file engine);
  - production: `docker-entrypoint.sh` chạy `migrate deploy` → `generate --sql` trước khi khởi động.
- Lãi lỗ tháng: `domain/period/pnl.ts` dựng dòng báo cáo từ số liệu thô; tháng đã khoá đọc snapshot `monthly_closings`.

## Kiểm thử

| Tầng              | Lệnh        | Ghi chú                                                                                                                                                             |
| ----------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit (domain)     | `pnpm test` | nhanh, nhiều nhất                                                                                                                                                   |
| Integration (api) | `pnpm test` | server cổng ngẫu nhiên + DB `ketoan_test`, TRUNCATE trước mỗi test, chạy tuần tự                                                                                    |
| E2E (Playwright)  | `pnpm e2e`  | tự dựng API :4100 + web :5273 trên DB `ketoan_e2e` (xoá và tạo lại mỗi lần chạy) — không đụng DB dev. Chạy vào app có sẵn: đặt `BASE_URL` + `E2E_USER` / `E2E_PASS` |

Các spec e2e: `pos-order-flow` (bán → bếp → thanh toán → huỷ), `inventory-flow` (kiểm kê → phân bổ → huỷ),
`a11y` (quét axe WCAG A/AA 14 màn chính, lỗi nghiêm trọng là trượt), `onboarding` (cài mới từ đầu → nhập Excel → bán → lãi lỗ).

`onboarding` cần một hệ thống **trắng**. `pnpm e2e` tự lo: `setup-db.mjs` để tài khoản `admin` của DB `ketoan_e2e`
ở trạng thái lần đầu đăng nhập với mật khẩu tạm `ONBOARD_PASS` (mặc định `Tam-thoi-2026`), và project `onboarding`
chạy trước các spec khác (Playwright `dependencies`). Chạy vào bản production vừa dựng:

```powershell
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
$env:ONBOARD_PASS = '<mật khẩu tạm in trong log api>'; $env:BASE_URL = 'https://localhost'
pnpm e2e -- onboarding
```

## Quyết định chính

- **Express 4 + ts-rest**: contract viết một lần cho cả hai đầu; Swagger tự sinh ở `/api/docs`.
- **FIFO theo lô** thay vì giá bình quân: giá vốn đúng theo từng lần nhập, đúng yêu cầu "lưu giá nhập theo từng thời điểm".
- **Nợ kho thay vì chặn bán**: quán không được dừng bán vì quên nhập phiếu; sai số được sửa khi nhập hàng.
- **Server tại quán + Caddy CA nội bộ**: chạy khi mất internet; HTTPS cần cho PWA.
- **In ESC/POS từ server**: máy tính bảng không cần driver; trình duyệt là phương án dự phòng.
- **API tự sao lưu** (`modules/backup`, `pg_dump` cài trong image): không phụ thuộc lịch Windows, có trạng thái và
  cảnh báo trong app, gửi thẳng qua Telegram bot / lên Drive. Script PowerShell chỉ còn chép bản sao lưu ra ổ ngoài.
- **Giá theo app trong cùng bảng `dish_prices`** (`delivery_app_id` rỗng = giá app chung, unique `NULLS NOT DISTINCT`):
  một nơi lưu lịch sử giá; thứ tự chọn giá nằm ở `domain/pricing/price-list.ts`.
- **Cấu hình nhạy cảm trong DB, mã hoá** (`core/secret-box.ts`): mã bot Telegram, Google Client secret, refresh token Drive nằm trong
  `settings` dưới khoá riêng, không thuộc schema cài đặt công khai nên không bao giờ trả ra trình duyệt.
- **Tin cho chủ quán qua hàng đợi** (`modules/notify`): service ghi tin vào `telegram_messages` bằng chính `tx` của
  thao tác (rollback thì không có tin), worker trong API gửi mỗi phút và ngay sau khi có tin; mất mạng thì tin chờ.
  Nội dung tin là hàm thuần (`domain/notify/messages.ts`); số liệu lấy từ `modules/notify/digests.ts`, nơi gọi
  thẳng các module có dòng riêng (vd `bank.dailyLines`) — không dùng đăng ký lúc nạp module để tránh vòng import.
- **Hoá đơn điện tử qua hàng đợi + lớp nhà cung cấp** (`modules/einvoice/providers.ts`): thanh toán chỉ ghi
  `einvoices` (PENDING) trong cùng transaction, worker gửi và theo dõi; nhà cung cấp chọn trong Cài đặt (Giả lập để
  thử, SePay eInvoice). Thêm nhà cung cấp = thêm một provider, không đụng luồng bán.
- **Bán thành phẩm là nguyên liệu có lô riêng**: phiếu chế biến xuất FIFO nguyên liệu và nhập một lô thành phẩm với
  giá vốn thật của mẻ, nên định mức món, nợ kho, kiểm kê dùng chung cơ chế cũ.
- **Điểm khách quen là sổ cái** (`point_entries`, `customers.points` chỉ là số dư cộng dồn): mỗi lần tích / đổi /
  hoàn / chỉnh tay một dòng; điểm chỉ trừ lúc thanh toán (khoá số dư trong transaction).
- **Khuyến mãi tính lại, không lưu tay**: quy tắc trong `promotions`, kết quả theo dòng (`promo_discount`); đổi quy
  tắc thì đơn đang mở được tính lại, đơn đã thanh toán giữ nguyên.
- **Tiền cọc đi qua sổ quỹ** thay vì thêm hình thức thanh toán "Tiền cọc": bill vẫn ghi đủ tiền mặt / chuyển khoản,
  cọc tiền mặt ghi thu hôm nhận và ghi chi hôm trừ vào đơn — báo cáo theo hình thức thanh toán và chốt ngày không phải
  sửa.
- **Gọi món QR không tự tạo đơn**: khách chỉ gửi yêu cầu, nhân viên nhận mới vào đơn — khách nghịch / quét nhầm bàn
  không làm sai số liệu; trang khách là trang riêng (`guest.html`) để điện thoại khách không tải app nhân viên.
- **Tiền chuyển khoản đọc bằng cách hỏi định kỳ** (`modules/bank`), không dùng webhook: máy chủ ở trong LAN của quán,
  không phải mở cổng ra Internet. Đọc mới nhất trước, dừng ở giao dịch đã có; khớp theo mã đơn (mã VietQR) chỉ so chữ
  và số vì ngân hàng tự sửa nội dung. Máy POS đang chờ thì đọc dày hơn và bắt được khoản đúng số tiền mà không ghi mã.
