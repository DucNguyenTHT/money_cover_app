# Tự xác nhận tiền chuyển khoản (SePay / Casso)

Khi khách quét mã VietQR, nội dung chuyển khoản là **mã đơn** (vd `261023-015`). Nối app với một dịch vụ báo biến động
số dư, app tự đọc tiền vào tài khoản của quán và khớp với đơn:

- Máy POS đang mở màn thanh toán chuyển khoản hiện “Đang chờ tiền về…” rồi **“Đã nhận … ₫”** sau vài giây — thu ngân
  không phải mở điện thoại, không bị lừa bằng ảnh chụp chuyển khoản giả.
- Khách quét QR trên bill in sẵn rồi mới bấm thanh toán: màn thanh toán tự chọn sẵn “Chuyển khoản” với số tiền đã về.
- **Chốt ngày** đối chiếu tiền chuyển khoản như tiền mặt: đơn ghi chuyển khoản mà chưa thấy tiền, tiền về chưa rõ của
  đơn nào (gán tay được).
- Chuông + tin Telegram buổi sáng nhắc đơn các ngày trước chưa thấy tiền về.

## Chọn dịch vụ

|                | SePay                                       | Casso                                    |
| -------------- | ------------------------------------------- | ---------------------------------------- |
| Tốc độ POS báo | vài giây (đọc được 3 lần / giây)            | tới 30 giây ở gói rẻ nhất (2 lần / phút) |
| Môi trường thử | Có (sandbox, giao dịch giả lập)             | —                                        |
| Mã API lấy ở   | my.sepay.vn → Cấu hình công ty → API Access | casso.vn → Tích hợp → API Key            |

Cả hai đều cần: đăng ký tài khoản, **liên kết tài khoản ngân hàng nhận tiền** (đúng tài khoản trong mục VietQR), xem
bảng giá trên trang của họ. App chỉ **đọc** giao dịch tiền vào, không chuyển tiền được.

## Cài đặt

1. Đăng nhập ADMIN → **Hệ thống → Cài đặt → Tự xác nhận tiền chuyển khoản**.
2. Chọn SePay hoặc Casso, dán **mã API** (được mã hoá, không hiện lại), để trống ô tài khoản (= tài khoản VietQR).
3. **Lưu & kiểm tra**: app thử đọc giao dịch ngày gần nhất; mã sai thì báo ngay, không lưu.
4. Thử: mở một đơn nhỏ → Thanh toán → Chuyển khoản → dùng app ngân hàng quét QR, chuyển → POS báo đã nhận.

Máy chủ cần Internet. Mất mạng thì POS vẫn bán bình thường (chỉ không tự báo), có mạng lại app đọc bù.

## Cách khớp tiền với đơn

1. **Theo mã đơn** trong nội dung (ngân hàng thêm chữ / bỏ dấu gạch vẫn nhận ra).
2. **Theo số tiền**: khách tự gõ số tiền, không có mã → gán cho máy POS đang chờ **đúng số tiền đó**, chỉ khi có duy
   nhất một máy chờ số tiền đó.
3. Còn lại: **Gán vào đơn** bằng tay ở Chốt ngày hoặc **Kế toán → Tiền chuyển khoản**. Nhân viên gán được tiền về
   trong ngày; khoản đã gán, các ngày trước, **Bỏ gán** và **Bỏ qua** (tiền không phải bán hàng, vd chủ quán tự chuyển)
   cần ADMIN, có lý do.

## Lỗi thường gặp

| Thông báo                     | Cách xử lý                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| … không nhận mã API / từ chối | Mã sai hoặc đã bị xoá trên trang dịch vụ — tạo mã mới, nhập lại                           |
| Không kết nối được …          | Máy chủ mất Internet; app tự đọc lại sau                                                  |
| Tiền về nhưng không khớp đơn  | Khách sửa nội dung chuyển khoản — gán tay; hoặc tài khoản nhận khác ô “Chỉ đọc tài khoản” |
