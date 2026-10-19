# Gửi chứng từ lên Google Drive

Tính năng **Chứng từ → Sao lưu / Google Drive** nén ảnh / file chứng từ của một tháng hoặc một năm thành
file `.zip` và tải lên Google Drive của chủ quán. Mỗi lần gửi tạo **một file mới** có ghi ngày giờ trong tên,
nên không bao giờ ghi đè bản cũ. File nằm trong thư mục `Kế toán quán - Chứng từ`.

Sau khi kết nối, **bản sao lưu dữ liệu hằng đêm** cũng tự gửi lên Drive, vào thư mục
`Kế toán quán - Sao lưu dữ liệu` (giữ 30 bản mới nhất). Tắt / bật và xem lần gửi gần nhất ở
**Hệ thống → Cài đặt → Sao lưu dữ liệu**.

App chỉ có quyền `drive.file`: chỉ thấy và ghi được các file do chính nó tạo ra, **không đọc được** các
file khác trong Drive của bạn.

> Không muốn thiết lập Google? Nút **Tải file nén về máy** vẫn dùng được, sau đó bạn tự tải file lên Drive.

## Vì sao đăng nhập bằng mã?

App chạy trong mạng LAN với địa chỉ `pos.local`. Google không cho nút "Đăng nhập Google" chạy trên địa chỉ
như vậy, nên app dùng cách đăng nhập **nhập mã trên thiết bị khác** (giống đăng nhập YouTube trên TV):

1. App hiện một mã, ví dụ `ABCD-EFGH`.
2. Trên điện thoại, bạn mở `google.com/device`, đăng nhập Google rồi nhập mã đó.

## Thiết lập một lần (khoảng 10 phút)

Cần một tài khoản Google bất kỳ, nên dùng chính tài khoản sẽ nhận file. Tất cả đều miễn phí.

1. **Tạo dự án**: mở <https://console.cloud.google.com>, bấm chọn dự án ở thanh trên cùng, chọn
   **New project**, đặt tên ví dụ `Ke toan quan`, rồi bấm **Create**.
2. **Bật Drive API**: vào **APIs & Services → Library**, tìm **Google Drive API** và bấm **Enable**.
3. **Màn hình xin quyền**: vào **Google Auth Platform** (hoặc **APIs & Services → OAuth consent screen**).
   - **Branding**: App name `Kế toán quán`, User support email là email của bạn.
   - **Audience**: User type **External**. Sau đó bấm **Publish app** để chuyển sang **In production**.
     Phải làm bước này: ở chế độ **Testing**, Google tự ngắt kết nối sau 7 ngày. Quyền `drive.file`
     không cần Google duyệt, nên bấm Publish là xong.
   - **Data access**: không cần thêm gì, app tự xin quyền khi kết nối.
4. **Tạo mã ứng dụng**: vào **Clients** (hoặc **Credentials**), chọn **Create client**.
   - Application type: **TVs and Limited Input devices**. Phải chọn đúng loại này.
   - Name: `May chu quan`, rồi bấm **Create**.
   - Chép **Client ID** và **Client secret**.
5. **Nhập vào app**: đăng nhập bằng tài khoản ADMIN, vào **Hệ thống → Cài đặt → Google Drive**, dán
   **Client ID** và **Client secret** rồi bấm **Lưu**. Secret được mã hoá khi lưu và không hiện lại.
   Không cần sửa file hay khởi động lại máy chủ. Hướng dẫn rút gọn các bước 1–4 cũng có ngay trong mục đó.

   > Cách cũ vẫn dùng được: điền `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` trong `.env.prod` rồi chạy lại
   > `docker compose … up -d`. Nếu đã nhập trong Cài đặt thì app dùng thông tin trong Cài đặt.

6. **Kết nối**: cũng ở **Cài đặt → Google Drive** (hoặc **Chứng từ → Sao lưu / Google Drive**), bấm
   **Kết nối Google Drive**. Mở link hiện trên màn hình bằng điện thoại, nhập mã, chọn tài khoản Google
   và bấm **Cho phép**. Màn hình app sẽ tự chuyển sang "Đã kết nối".
   Đổi sang Client ID khác thì kết nối cũ bị ngắt, cần kết nối lại.

## Dùng hằng tháng

Ở trang Chứng từ, chọn tháng (hoặc chuyển sang **Năm**), bấm **Sao lưu / Google Drive**, rồi bấm
**Gửi chứng từ … lên Drive**. Khi xong, app hiện link **Mở trên Google Drive**.

Trong file zip có:

- `Danh sach chung tu.xlsx`: danh sách chứng từ gồm ngày, loại, đối tác, số hoá đơn, số tiền, ghi chú
  và phiếu nhập.
- Mỗi chứng từ một thư mục, ví dụ `2026-10-03 Mua vào - Chợ Bình Điền (HĐ 0004512)/`, chứa ảnh / PDF / XML.

## Khi có sự cố

| Thông báo                                                                                        | Cách xử lý                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "Access blocked: … has not completed the Google verification process" (Error 403: access_denied) | Dự án trên Google Cloud còn ở chế độ **Testing**. Vào **Google Auth Platform → Audience** → **Publish app** (sang _In production_; quyền `drive.file` không cần Google duyệt), rồi bấm **Kết nối Google Drive** lại để lấy mã mới. Thêm email vào **Test users** cũng được nhưng Google tự ngắt kết nối sau 7 ngày |
| Chưa thiết lập Google Drive                                                                      | Làm bước 5: nhập Client ID / secret ở **Hệ thống → Cài đặt → Google Drive**                                                                                                                                                                                                                                        |
| Quyền truy cập Google Drive đã hết hiệu lực                                                      | Bấm **Kết nối Google Drive** lại. Thường do bạn đã gỡ quyền của app trong tài khoản Google, hoặc app vẫn ở chế độ **Testing** (xem bước 3)                                                                                                                                                                         |
| Không kết nối được Google                                                                        | Máy chủ ở quán đang mất Internet                                                                                                                                                                                                                                                                                   |
| Google Drive đã đầy dung lượng                                                                   | Dọn bớt Drive hoặc mua thêm dung lượng                                                                                                                                                                                                                                                                             |

- **Gỡ quyền của app:** vào <https://myaccount.google.com/permissions> rồi xoá **Kế toán quán**. Hoặc bấm
  **Ngắt kết nối** trong app.
- **Bảo mật:** mã kết nối được lưu mã hoá trong database bằng khoá lấy từ `JWT_SECRET`. Nếu đổi `JWT_SECRET`,
  bạn cần kết nối lại Google Drive.
