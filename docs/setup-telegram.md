# Gửi bản sao lưu và chứng từ qua Telegram

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

## Ảnh / file chứng từ

Bật **Gửi cả ảnh / file chứng từ** (mặc định bật) thì sau mỗi lần sao lưu, bot gửi tiếp các file chứng từ
**chưa gửi**, mỗi file một tin, kèm chú thích để tìm lại bằng ô tìm kiếm của Telegram:

```
📄 03/10/2026 · Mua vào · Chợ Bình Điền · HĐ 0004512 · 1.250.000 đ
hoa-don.jpg
```

- Mỗi file chỉ gửi **một lần**. Lần đầu bật, các chứng từ cũ được gửi dần, tối đa 100 file mỗi lần sao lưu
  (Telegram chỉ cho khoảng 20 tin / phút trong nhóm). Mục Sao lưu dữ liệu ghi "còn … file gửi dần các lần sau".
- Gửi lỗi (mất mạng, bot bị xoá khỏi nhóm…) thì dừng ở file đó, báo trên chuông; lần sao lưu sau gửi tiếp từ đó.
- Chứng từ sửa / xoá trong app: bản đã gửi trên Telegram vẫn giữ nguyên. File thay thế được gửi như file mới.
- Đổi sang cuộc trò chuyện khác: toàn bộ chứng từ được gửi lại từ đầu vào cuộc trò chuyện mới.

## Khôi phục từ Telegram

Mở cuộc trò chuyện → tải file `ketoan-YYYYMMDD-HHmm.dump` mới nhất về thư mục `backups\` trên máy chủ → chạy
lệnh khôi phục ở `setup-store.md` (mục Khôi phục).

Ảnh chứng từ: tải các file trong cuộc trò chuyện về nếu cần đối chiếu. Database đã lưu thông tin chứng từ
(ngày, đối tác, số tiền…); file ảnh khôi phục từ `backups\documents\` / `BACKUP_COPY_DIR` nếu có.

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
