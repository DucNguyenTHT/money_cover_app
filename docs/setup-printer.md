# Máy in hoá đơn & phiếu bếp

## Cách hoạt động

- **In từ máy chủ (mặc định, `Cài đặt → Chế độ in = Máy chủ`)**: máy chủ gửi lệnh ESC/POS tới máy in nhiệt LAN qua cổng **9100**.
  In được từ mọi thiết bị (kể cả máy tính bảng Android) vì thiết bị không cần cài driver.
- Mỗi máy in có **trạm**: `BILL` (hoá đơn, phiếu tạm tính), `KITCHEN` (phiếu bếp), `BAR` (phiếu quầy bar).
  Món đi trạm nào theo **nhóm món** (Thực đơn → Nhóm món → trạm).
- Máy in lỗi / tắt: bán hàng vẫn tiếp tục; POS báo "Máy in: …" và **tự in hoá đơn qua trình duyệt**.
  Phiếu bếp vẫn hiện trên màn hình bếp; bấm "In lại phiếu bếp" khi máy in chạy lại.
- **In qua trình duyệt (`Chế độ in = Trình duyệt`)**: khổ 80 mm, dùng máy in cài trên chính máy đang bán.
  Chrome chạy với `--kiosk-printing` để không hiện hộp thoại in.

## Cài máy in nhiệt LAN

1. Cắm dây mạng máy in vào router. Giữ nút FEED khi bật nguồn để in trang tự kiểm tra → xem IP.
2. Đặt **IP cố định** cho máy in (trên router hoặc bằng tiện ích của hãng), ví dụ `192.168.1.21`.
3. **Hệ thống → Máy in & trạm → Thêm**: tên, IP, cổng `9100`, khổ giấy 80 / 58 mm, trạm → **In thử**.
4. Thường dùng: 1 máy `BILL` ở quầy thu ngân, 1 máy `KITCHEN` trong bếp, 1 máy `BAR` ở quầy nước (nếu có).
   Có thể khai báo nhiều máy cùng trạm: phiếu được gửi tới tất cả.

## Lưu ý

- Hầu hết máy in nhiệt không có bảng mã tiếng Việt: phiếu in **không dấu** ("Pho bo tai"). Màn hình và bản in qua trình duyệt vẫn có dấu.
- Mã **VietQR** in trực tiếp bằng lệnh QR của máy in (đa số máy in ESC/POS 80 mm đời mới hỗ trợ). Máy cũ không in được QR thì vẫn in phần chữ.
- Máy chủ chạy trong Docker vẫn tới được máy in trong LAN; nếu "In thử" báo không kết nối được: kiểm tra ping tới IP máy in từ máy chủ, tường lửa, và máy in có đúng cổng 9100.
