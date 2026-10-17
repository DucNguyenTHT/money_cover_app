# Quán ăn — Bán hàng (POS) & Kế toán nội bộ

Bán hàng tại quầy (bàn, bếp / bar, thanh toán + VietQR), kho FIFO theo lô (nhập, xuất, nợ kho, kiểm kê),
giá thành & giá bán từng món, lãi lỗ tháng / quý / năm, khoá sổ.

| App        | Nội dung                                                                                                                                                  |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api` | Express + Socket.IO + Prisma (PostgreSQL). `src/domain` nghiệp vụ thuần, `src/contracts` hợp đồng API (ts-rest), `prisma/sql` truy vấn báo cáo (TypedSQL) |
| `apps/web` | React + Vite + Tailwind v4: `/pos` bán hàng, `/kitchen` bếp / bar, `/admin` quản trị & báo cáo                                                            |
| `e2e`      | Playwright: luồng bán hàng, luồng kiểm kê                                                                                                                 |

Tài liệu: [kiến trúc](docs/architecture.md) · [quy tắc nghiệp vụ](docs/business-rules.md) · [cài máy chủ tại quán](docs/setup-store.md) · [máy in](docs/setup-printer.md)

## Chạy trên máy dev

Cần: Node ≥ 20 (khuyên 24), pnpm (`corepack enable`), Docker Desktop.

```bash
pnpm install
docker compose up -d                       # PostgreSQL ở cổng 5433 (+ DB test ketoan_test)
cp apps/api/.env.example apps/api/.env     # rồi đổi JWT_SECRET
pnpm db:migrate                            # tạo bảng
pnpm db:generate                           # Prisma client + hàm TypedSQL (cần DB đang chạy, API dev server đang tắt)
pnpm db:seed                               # cơ sở, tài khoản admin (in mật khẩu tạm), cài đặt, bàn mẫu
pnpm --filter @ketoan/api db:seed:demo        # (tuỳ chọn) thực đơn, định mức, tồn đầu mẫu
pnpm --filter @ketoan/api db:seed:demo-sales  # (tuỳ chọn) lịch sử bán hàng mẫu từ 01/09 để xem báo cáo
pnpm dev                                   # API :4000 (tài liệu API: /api/docs) + web :5173
```

Mở http://localhost:5173, đăng nhập `admin` bằng mật khẩu tạm in ra ở bước seed → đổi mật khẩu → đặt mã PIN duyệt.

## Lệnh thường dùng

| Lệnh                                                                      | Việc                                                                    |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `pnpm test`                                                               | unit test (domain) + integration test (api, DB test)                    |
| `pnpm e2e`                                                                | Playwright — cần app đang chạy và `E2E_USER` / `E2E_PASS` của một ADMIN |
| `pnpm lint` / `pnpm typecheck` / `pnpm build`                             | kiểm tra & build                                                        |
| `pnpm db:migrate` / `pnpm db:generate` / `pnpm db:seed` / `pnpm db:reset` | quản lý DB                                                              |

Commit chạy `lint-staged` (eslint + prettier) qua husky. CI (`.github/workflows/ci.yml`) chạy lint, typecheck, test, build và e2e.

## Chạy tại quán (production)

```powershell
copy .env.prod.example .env.prod   # điền mật khẩu DB, JWT_SECRET, SITE_HOSTS
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
powershell -ExecutionPolicy Bypass -File scripts\install-task.ps1   # sao lưu tự động 02:00
```

Chi tiết (chứng chỉ cho máy tính bảng, khôi phục bản sao lưu…): [docs/setup-store.md](docs/setup-store.md).

## Quy ước chính

- Nghiệp vụ nằm ở `apps/api/src/domain` (không phụ thuộc DB/HTTP, có unit test); service chỉ đọc/ghi DB và gọi domain.
- API khai báo một lần ở `apps/api/src/contracts`; web chỉ được import `@ketoan/api/contracts` và `@ketoan/api/domain` (ESLint chặn import khác).
- Feature bán hàng và feature quản trị trong `apps/web/src/features` không import lẫn nhau.
- Tiền là số nguyên đồng (Decimal), không dùng `number` để cộng tiền ở backend.
- Mọi sửa / huỷ / xoá / giảm giá / khoá sổ đều có lý do và ghi lịch sử sửa.
