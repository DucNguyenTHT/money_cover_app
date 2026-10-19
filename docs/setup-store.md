# Cài đặt máy chủ tại quán

Một máy (mini PC hoặc máy thu ngân chạy Windows 10/11) chạy toàn bộ hệ thống trong mạng LAN của quán.
Mất internet vẫn bán và in được; chỉ cần máy chủ và router còn điện.

## 1. Chuẩn bị máy chủ

1. Cắm dây mạng vào router (ổn định hơn Wi-Fi). Nên có **UPS** để mất điện không làm hỏng dữ liệu.
2. Trên router: đặt **IP cố định** cho máy chủ (DHCP reservation), ví dụ `192.168.1.10`.
3. Cài **Docker Desktop** → Settings → General: bật _Start Docker Desktop when you sign in_.
   Windows: bật tự đăng nhập tài khoản chạy Docker (hoặc dùng Docker Engine trên WSL chạy như dịch vụ).
4. Cài **Git**, rồi lấy mã nguồn:
   ```powershell
   git clone <địa chỉ repo> C:\ketoan
   cd C:\ketoan
   ```

## 2. Cấu hình

```powershell
copy .env.prod.example .env.prod
notepad .env.prod
```

| Biến              | Ghi chú                                                                          |
| ----------------- | -------------------------------------------------------------------------------- |
| `DB_PASSWORD`     | Chuỗi ngẫu nhiên dài, ghi lại cất nơi an toàn                                    |
| `JWT_SECRET`      | ≥ 32 ký tự ngẫu nhiên                                                            |
| `SITE_HOSTS`      | Tên / IP mà máy tính bảng dùng, ví dụ `pos.local, 192.168.1.10`                  |
| `PUBLIC_URL`      | Địa chỉ chính, ví dụ `https://pos.local`                                         |
| `BACKUP_COPY_DIR` | Thư mục chép thêm bản sao lưu: ổ cứng ngoài hoặc thư mục Google Drive / OneDrive |

Muốn dùng tên `pos.local`: thêm bản ghi DNS trên router (`pos.local → 192.168.1.10`); nếu router không hỗ trợ, dùng thẳng IP.

## 3. Chạy

```powershell
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.prod logs api | findstr "Mật khẩu"
```

Lần chạy đầu in ra **mật khẩu tạm của tài khoản `admin`**. Các container có `restart: always` nên bật lại máy là app tự chạy.

Cập nhật phiên bản mới: `git pull` rồi chạy lại lệnh `up -d --build` (migration tự chạy khi API khởi động).

## 4. Cài chứng chỉ trên từng máy tính bảng / điện thoại (1 lần)

App chạy HTTPS bằng chứng chỉ do máy chủ tự cấp (cần cho PWA và để trình duyệt không cảnh báo).

1. Trên máy tính bảng mở `http://192.168.1.10:8080/ca.crt` → tải file về.
2. **Android**: Cài đặt → Bảo mật → Mã hoá & thông tin xác thực → Cài chứng chỉ → _Chứng chỉ CA_ → chọn `ca.crt`.
   **iPad / iPhone**: mở file → Cài đặt → Đã tải hồ sơ → Cài đặt; rồi Cài đặt → Cài đặt chung → Giới thiệu → Cài đặt tin cậy chứng nhận → bật cho chứng chỉ vừa cài.
   **Windows**: mở `ca.crt` → Install Certificate → Local Machine → _Trusted Root Certification Authorities_.
3. Mở `https://pos.local` (hoặc `https://192.168.1.10`) → không còn cảnh báo → đăng nhập.
4. Chrome: menu ⋮ → _Thêm vào màn hình chính_ để dùng như app.

## 5. Lần đầu đăng nhập

1. Đăng nhập `admin` + mật khẩu tạm → đổi mật khẩu → đặt **mã PIN duyệt** (4–6 số, dùng để duyệt giảm giá / huỷ đơn tại quầy).
2. **Hệ thống → Cài đặt**: tên quán, địa chỉ, giờ bắt đầu ngày kinh doanh, **loại hình nộp thuế** (hộ kinh doanh / công ty; hộ kinh doanh: cách tính thuế TNCN, đã đăng ký hoá đơn điện tử chưa), phụ thu, tài khoản ngân hàng (VietQR), chế độ in.
   Nhóm món nào không phải đồ ăn uống (vd bán hàng hoá đóng gói) thì đổi **ngành thuế** ở _Thực đơn → Nhóm món_.
3. **Hệ thống → Tài khoản**: tạo tài khoản thu ngân (STAFF), bếp / bar (KITCHEN, chọn trạm).
4. **Hệ thống → Bàn & khu vực**, **App giao hàng** (tên app + % chiết khấu), **Máy in & trạm** (xem `setup-printer.md`).
5. **Hệ thống → Nhập dữ liệu Excel**: tải file mẫu, điền nguyên liệu → món → định mức → **tồn đầu**, nhập theo đúng thứ tự đó.
   File mẫu món có cột **Giá app** (giá chung) và một cột **Giá <tên app>** cho mỗi app — tạo app ở bước 4 trước khi tải mẫu.
   Sau này đổi giá từng app ở _Thực đơn → món → Giá bán_.
6. **Hệ thống → Cài đặt → Telegram** (khuyên dùng, 3 phút, xem `setup-telegram.md`) hoặc **Google Drive**
   (xem `setup-google-drive.md`) để bản sao lưu hằng đêm có thêm một bản ngoài máy chủ.

## 6. Sao lưu

**Dữ liệu (database) — tự động, không cần cài gì thêm.** API tự sao lưu mỗi ngày lúc 02:00 (đổi giờ ở
**Hệ thống → Cài đặt → Sao lưu dữ liệu**) vào `backups\ketoan-YYYYMMDD-HHmm.dump`, giữ 30 bản mới nhất. Máy tắt
lúc 02:00 thì sao lưu ngay khi bật lại. Ở đó cũng có nút **Sao lưu ngay**, xem bản gần nhất và lỗi nếu có;
chuông thông báo báo khi lần sao lưu bị lỗi hoặc quá 2 ngày chưa có bản mới.

**Qua Telegram.** Tạo bot với @BotFather, nhập mã bot ở **Hệ thống → Cài đặt → Telegram** và chọn cuộc trò
chuyện nhận file (xem `setup-telegram.md`). Mỗi bản sao lưu được gửi vào đó (tối đa 50 MB / file).

**Lên Google Drive.** Kết nối Google Drive một lần ở **Hệ thống → Cài đặt → Google Drive** (nhập Client ID / secret rồi bấm Kết nối, xem
`setup-google-drive.md`), sau đó mỗi bản sao lưu tự gửi lên thư mục _Kế toán quán - Sao lưu dữ liệu_ trên
Drive (giữ 30 bản mới nhất). Tắt / bật ở Cài đặt → Sao lưu dữ liệu.

**Chép ra ổ cứng ngoài + ảnh chứng từ** (nên làm thêm):

```powershell
# Cài lịch chép 03:00 hằng đêm (chạy PowerShell "Run as administrator" một lần):
powershell -ExecutionPolicy Bypass -File scripts\install-task.ps1
# Chép tay bất kỳ lúc nào (thêm -Dump để tự xuất database khi API không chạy):
powershell -ExecutionPolicy Bypass -File scripts\backup-db.ps1
```

- Script chép các bản sao lưu chưa có sang `BACKUP_COPY_DIR` (ổ cứng ngoài / thư mục OneDrive…).
- **Ảnh chứng từ** (menu Chứng từ) nằm ở `storage\documents\<năm>\<tháng>\`. Script chép các file
  mới sang `backups\documents\` và `BACKUP_COPY_DIR\documents\`. Bản chép không bao giờ bị xoá bớt, nên ảnh
  lỡ xoá trên máy chủ vẫn còn trong bản sao lưu. Ảnh chứng từ không tự lên Drive; gửi theo tháng / năm ở
  menu Chứng từ (nút Google Drive).
- Nhật ký script: `backups\backup.log`.
- Giữ **một bản `.env.prod`** ngoài máy chủ (USB / trình quản lý mật khẩu): khôi phục trên máy mới cần nó.

### Khôi phục (khi hỏng máy / nhầm dữ liệu)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\restore-db.ps1 -File backups\ketoan-20261012-0200.dump
```

Lệnh hỏi xác nhận (gõ `KHOIPHUC`), thay toàn bộ dữ liệu bằng bản sao lưu rồi khởi động lại API.
Lệnh cũng chép lại các ảnh chứng từ còn thiếu từ `backups\documents\` vào `storage\documents\`. Trên máy
mới, chép thư mục `documents` từ `BACKUP_COPY_DIR` vào `backups\` trước khi chạy lệnh.
Bản trên Telegram / Google Drive: tải file `.dump` (cuộc trò chuyện Telegram, hoặc thư mục _Kế toán quán - Sao lưu
dữ liệu_ trên Drive) về `backups\` rồi chạy lệnh trên.
Máy mới: làm lại bước 1–3 với **cùng `.env.prod`**, sau đó chạy lệnh khôi phục.

**Nên thử khôi phục 1 lần ngay sau khi cài** (sang máy khác hoặc DB trống) để chắc chắn bản sao lưu dùng được.

## 7. Xem từ xa (tuỳ chọn)

Cài **Tailscale** trên máy chủ và điện thoại chủ quán → mở `https://<tên máy tailscale>` để xem báo cáo khi không ở quán
(thêm tên đó vào `SITE_HOSTS`). Không mở cổng router ra internet.

## Xử lý sự cố

| Hiện tượng                   | Kiểm tra                                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| Máy tính bảng không vào được | Máy chủ còn bật? `docker compose -f docker-compose.prod.yml --env-file .env.prod ps`   |
| Cảnh báo chứng chỉ           | Chưa cài `ca.crt` trên máy đó, hoặc truy cập bằng tên / IP không có trong `SITE_HOSTS` |
| POS hiện "Mất kết nối"       | Wi-Fi của máy tính bảng; app tự kết nối lại                                            |
| Không in được                | Xem `setup-printer.md`; POS vẫn bán được và in qua trình duyệt                         |
| Xem lỗi API                  | `docker compose -f docker-compose.prod.yml --env-file .env.prod logs --tail 100 api`   |
| Quên mật khẩu `admin`        | `powershell -ExecutionPolicy Bypass -File scripts\reset-admin.ps1` in mật khẩu tạm mới |
| Mất mật khẩu tạm lần đầu     | Như trên (log chỉ in mật khẩu tạm một lần khi cài)                                     |
