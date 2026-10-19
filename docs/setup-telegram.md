# Gửi bản sao lưu qua Telegram

Mỗi bản sao lưu dữ liệu hằng đêm (file `.dump`) được bot Telegram gửi vào một cuộc trò chuyện của bạn.
Miễn phí, không giới hạn số file, mỗi file tối đa **50 MB** (dữ liệu của quán thường vài trăm KB đến vài
chục MB). Không cần tên miền hay Google duyệt như Google Drive.

## Thiết lập (khoảng 3 phút)

1. **Tạo bot**: trên Telegram mở [@BotFather](https://t.me/BotFather) → gửi `/newbot` → đặt tên (vd
   `Sao lưu quán`) → đặt username kết thúc bằng `bot` (vd `quanpho_backup_bot`). BotFather trả về một **mã
   bot** dạng `123456789:AAH…`.
2. **Nhập vào app**: đăng nhập ADMIN → **Hệ thống → Cài đặt → Telegram** → dán mã bot → **Lưu**. App kiểm
   tra mã với Telegram trước khi lưu; mã được mã hoá và không hiện lại.
3. **Chọn nơi nhận**, một trong hai:
   - **Chat riêng**: mở bot vừa tạo (link hiện trong app) → bấm **Start**.
   - **Nhóm riêng** (nhiều người cùng xem): tạo nhóm, thêm bot vào nhóm, gửi một tin bất kỳ trong nhóm.

   Quay lại app → **Tìm cuộc trò chuyện** → bấm **Chọn & gửi thử** ở dòng đúng. Bot gửi một tin thử vào đó.

4. Xong. Mục **Sao lưu dữ liệu** (cùng trang) có công tắc **Gửi qua Telegram** và dòng "Đã gửi bản …" sau mỗi
   lần sao lưu. Bấm **Sao lưu ngay** để thử luôn.

## Khôi phục từ Telegram

Mở cuộc trò chuyện → tải file `ketoan-YYYYMMDD-HHmm.dump` mới nhất về thư mục `backups\` trên máy chủ → chạy
lệnh khôi phục ở `setup-store.md` (mục Khôi phục).

## Lưu ý

- **Không xoá** các file trong cuộc trò chuyện: đó là bản sao lưu. Bot không tự xoá bản cũ.
- Đừng thêm bot vào nhóm đông người: ai trong nhóm cũng tải được toàn bộ dữ liệu của quán.
- Mã bot là chìa khoá của bot: không gửi cho ai. Lỡ lộ → trong @BotFather gửi `/revoke` để lấy mã mới, rồi nhập
  lại ở Cài đặt.

| Thông báo                       | Cách xử lý                                                                 |
| ------------------------------- | -------------------------------------------------------------------------- |
| Telegram không nhận mã bot này  | Mã sai hoặc đã bị thu hồi trong @BotFather — chép lại mã, nhập lại         |
| Chưa thấy tin nào gửi cho bot   | Bấm Start với bot (hoặc gửi một tin trong nhóm có bot) rồi bấm Tìm lại     |
| chat not found / bot was kicked | Bot đã bị xoá khỏi nhóm — thêm lại rồi chọn lại cuộc trò chuyện            |
| Không kết nối được Telegram     | Máy chủ ở quán đang mất Internet; bấm Sao lưu ngay khi có mạng lại         |
| File … vượt giới hạn 50 MB      | Dữ liệu đã lớn — dùng thêm Google Drive / ổ cứng ngoài (`BACKUP_COPY_DIR`) |
