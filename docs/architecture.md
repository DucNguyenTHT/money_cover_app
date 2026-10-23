# Kiến trúc

> Sơ đồ đầy đủ, luôn khớp phiên bản đang chạy: mở **`/api/docs/architecture`** (dev: http://localhost:4000/api/docs/architecture).
> Trang HTML thuần do API trả về: kiến trúc tổng thể, luồng nghiệp vụ, sơ đồ database (đọc từ Prisma schema) và
> danh sách API kèm quyền (đọc từ contract). Công khai trong LAN giống Swagger (`/api/docs`).

## Tổng quan

```
máy tính bảng / máy thu ngân ── HTTPS (Caddy, CA nội bộ) ──┬── /            → web build (React)
                                                          ├── /api/*       → api (Express, ts-rest)
                                                          └── /socket.io/* → api (Socket.IO)
api ── PostgreSQL 16          api ── TCP 9100 ── máy in nhiệt LAN
api ── pg_dump 02:00 ──► backups/ ──(tuỳ chọn, Internet)──► Telegram bot · Google Drive của chủ quán
```

Monorepo pnpm + Turborepo, 2 app:

| App        | Nội dung                                                                                                                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/api` | `src/domain` nghiệp vụ thuần · `src/contracts` hợp đồng API (ts-rest + zod) · `src/core` hạ tầng (db, auth, audit, period-lock, realtime, printing, redact) · `src/modules/*` router + service · `prisma/` schema, migrations, TypedSQL (`prisma/sql`), seed |
| `apps/web` | `src/features/*` theo màn hình · `src/pos` phần dùng chung của khu bán hàng · `src/components` UI kit tự viết bằng Tailwind · `src/lib` client API, socket, định dạng                                                                                        |

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
- Tiền ra vào két do màn hình khác sinh ra (trả nhà cung cấp, trả lương, tạm ứng) đi qua `modules/cash` (`addTx`,
  `cancelBySourceTx`) trong cùng transaction, đánh dấu `source` / `source_id` để chỉ huỷ được ở màn hình gốc.

## Luồng một yêu cầu

1. Web gọi bằng client sinh từ contract (`client.orders.pay(...)`) → kiểu dữ liệu khớp đầu-cuối.
2. ts-rest kiểm tra dữ liệu bằng zod; `authMiddleware` kiểm `metadata.roles` của route.
3. Service mở transaction (`inTx`), đọc DB → gọi hàm `domain` → ghi kết quả + `writeAudit` trong cùng transaction.
4. Sau commit: phát sự kiện Socket.IO (`order:update`, `table:update`, `kitchen:new`…). Các máy khác refetch.
5. `redactFor(role)` bỏ trường giá vốn / lãi trước khi trả cho STAFF / KITCHEN.

## Báo cáo — TypedSQL

- Mỗi truy vấn báo cáo là một file `apps/api/prisma/sql/*.sql`; `prisma generate --sql` sinh hàm có kiểu (`@prisma/client/sql`).
- **Sinh code cần kết nối DB** (Prisma đọc kiểu cột từ database):
  - máy dev: `pnpm db:generate` khi DB chạy và **API dev server đã dừng** (Windows khoá file engine);
  - CI: migrate DB service rồi `pnpm db:generate`;
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
